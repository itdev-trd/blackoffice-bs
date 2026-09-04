// supabase/functions/meta-webhook/index.ts
// Messenger webhook — รับ event แบบ real-time จาก Meta
//   GET  : ยืนยัน webhook (hub.challenge) ด้วย META_VERIFY_TOKEN
//   POST : รับข้อความ/referral — เก็บ ad_id (มาจากแอดไหน) + ต่อข้อความเข้า inbox ทันที
// ต้อง deploy แบบเปิดสาธารณะ:  supabase functions deploy meta-webhook --no-verify-jwt
// ตั้ง secret:  META_VERIFY_TOKEN (ตั้งเอง, ใส่ให้ตรงกับ Meta), META_APP_SECRET (ตรวจลายเซ็น)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { getSelectedCommentPageIds, resolveCommentAds } from "../_shared/comment-realtime.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const MAX_TRANSCRIPT_TEXT = 10_000;
// อิโมจิ/อักขระเสริมถูกเก็บเป็น surrogate pair 2 ตัว ถ้าลูกค้าส่งมาไม่ครบคู่
// (หรือถูกเราตัดกลางคู่ตอน slice) Postgres จะปฏิเสธ "Unicode low surrogate must follow a high surrogate"
// แล้วล้มการเขียนทั้ง batch — ต้องตัดตัวเดี่ยวที่ค้างออกหลัง slice เสมอ
function stripLoneSurrogates(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
const transcriptText = (value: unknown) => stripLoneSurrogates(String(value || "").slice(0, MAX_TRANSCRIPT_TEXT));

// ตรวจลายเซ็น X-Hub-Signature-256 = sha256=HMAC_SHA256(app_secret, rawBody)
async function verifySig(rawBody: string, sigHeader: string | null, secret: string): Promise<boolean> {
  if (!sigHeader || !sigHeader.startsWith("sha256=")) return false;
  const expected = sigHeader.slice(7);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // เทียบแบบ length-safe
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ข้อความย่อของ attachment (ไว้โชว์บนป้ายชื่อซ้าย) — สติกเกอร์/รูป/วิดีโอ ฯลฯ
function msgAttachPreview(attachments: any[]): string {
  const a = (attachments || [])[0];
  if (!a) return "[สื่อ]";
  if (a?.payload?.sticker_id) return "[สติกเกอร์]";
  return a.type === "image" ? "[รูปภาพ]" : a.type === "video" ? "[วิดีโอ]" : a.type === "audio" ? "[เสียง]" : a.type === "file" ? "[ไฟล์]" : "[สื่อ]";
}

// หา "ข้อความฝั่งเพจตัวสุดท้าย" จาก transcript เพื่อโชว์บนป้ายชื่อซ้าย (last_reply_*)
// ใช้ลำดับใน transcript เป็นตัวตัดสิน (แอปต่อรายการตามลำดับส่งจริง) แทนที่จะเชื่อเวลาที่ echo วิ่งมาถึง
// กันเคส echo มาสลับลำดับ (echo รูปมาช้ากว่า echo ข้อความ) แล้วป้ายค้างเป็น "[รูปภาพ]"
function lastReplyFromTranscript(tr: any[]): { text: string; at: string; by: string } | null {
  for (let i = (tr?.length || 0) - 1; i >= 0; i--) {
    const m = tr[i];
    if (m?.w === "p") {
      const text = (String(m.t || "").trim() || (m.img ? "[รูปภาพ]" : "")).slice(0, 300);
      return { text, at: String(m.at || new Date().toISOString()), by: String(m.by_name || "") };
    }
  }
  return null;
}

async function syncPushState(conversationId: string) {
  try {
    const sb = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!sb || !serviceKey) return;
    await fetch(`${sb}/functions/v1/send-push`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ action: "sync_state", conversation_id: conversationId }),
    });
  } catch (_e) { /* ไม่กระทบ webhook หลัก */ }
}

// ยิง push "ข้อความใหม่ทันที" ไปหาเครื่องที่สมัครไว้ (ทำงานแม้ปิดแอป) — fire-and-forget
async function notifyNewMessage(payload: { page_id: string; page_name: string | null; customer_name: string | null; conversation_id: string; text: string | null }) {
  try {
    const sb = Deno.env.get("SUPABASE_URL") || "";
    const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!sb || !sk) return;
    await fetch(`${sb}/functions/v1/send-push`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sk}` },
      body: JSON.stringify({ action: "notify_new", ...payload }),
    });
  } catch (_e) { /* แจ้งเตือนพลาดไม่กระทบ webhook หลัก */ }
}

// ปุ่มเมนูในแชท (Persistent Menu / Ice Breakers) และปุ่มใน template: Meta ส่งมาเป็น ev.postback ไม่ใช่ ev.message
// เดิมอ่านแค่ postback.referral (เอา ad_id) ตัวการกดปุ่มเลยหายไป ไม่ขึ้นในกล่องแชทและไม่เด้งแจ้งเตือน
// แปลงเป็นรูปทรงเดียวกับ message เพื่อใช้ pipeline เดิมทั้งชุด (กันซ้ำด้วย mid / สร้างลูกค้าใหม่ / ยิง push)
function postbackAsMessage(pb: any) {
  if (!pb) return null;
  // title = ข้อความบนปุ่มที่ลูกค้าเห็น, payload = โค้ดที่เราตั้งเอง — เอา title ก่อนเพราะแอดมินอ่านรู้เรื่องกว่า
  const label = String(pb.title || pb.payload || "").trim();
  if (!label) return null;
  return { mid: pb.mid ? String(pb.mid) : null, text: `[กดปุ่ม] ${label}` };
}

// Echo จาก Meta หมายถึงมีคนตอบผ่าน Page Inbox หรืออุปกรณ์อื่นแล้ว
// ล้างสถานะทุกแถวของลูกค้าคนเดียวกัน เพื่อให้ทุก user/device เห็นจุดแดงหายพร้อมกัน
async function clearRelatedUnread(admin: any, pageId: string, psid: string, source: string | null, nowIso: string) {
  let query = admin.from("chat_customers")
    .update({ unread: false, awaiting_reply: false, read_at: nowIso, updated_at: nowIso })
    .eq("page_id", pageId).eq("psid", psid);
  query = source === "instagram"
    ? query.eq("source", "instagram")
    : query.not("id", "like", "fbc_%").or("source.is.null,source.neq.comment");
  // การ์ดกันเขียนเปล่า: แตะเฉพาะแถวที่ยังไม่อ่าน/ยังรอตอบจริง — ลด WAL ที่ Realtime ต้องถอดรหัส (ตัวกิน memory อันดับ 1)
  query = query.or("unread.eq.true,awaiting_reply.eq.true");
  return await query.select("id");
}

// หมายเหตุ: echo webhook ของ Meta ส่ง sender.id เป็น PAGE_ID เสมอ และ "ไม่มี" ฟิลด์ระบุตัวแอดมิน
// (ตรวจเอกสารแล้ว — Meta ปกปิดตัวตนแอดมินโดยเจตนา เพจส่งข้อความในนามเพจ ไม่ใช่บุคคล)
// จึงรู้ชื่อคนตอบได้เฉพาะข้อความที่ "ส่งผ่านแอปเรา" (มี by = อีเมลผู้ล็อกอิน) เท่านั้น

Deno.serve(async (req) => {
  // ---- ยืนยัน webhook ----
  if (req.method === "GET") {
    const u = new URL(req.url);
    const mode = u.searchParams.get("hub.mode");
    const tok = u.searchParams.get("hub.verify_token");
    const challenge = u.searchParams.get("hub.challenge") || "";
    const verifyToken = Deno.env.get("META_VERIFY_TOKEN") || "";
    if (mode === "subscribe" && verifyToken && tok === verifyToken) return new Response(challenge, { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  try {
    const raw = await req.text();
    const secret = Deno.env.get("META_APP_SECRET");
    if (!secret) {
      console.error("META_APP_SECRET is required for webhook signature verification");
      return new Response("webhook not configured", { status: 503 });
    }
    const ok = await verifySig(raw, req.headers.get("x-hub-signature-256"), secret);
    if (!ok) return new Response("bad signature", { status: 401 });
    let payload: any = {};
    try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
    if (payload.object !== "page" && payload.object !== "instagram") return new Response("ignored", { status: 200 });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Instagram Messaging webhook ใช้ IG account id ที่ entry.id แต่ระบบกรองสิทธิ์ด้วย Facebook Page id
    // จึง map IG → Page ก่อนบันทึก และเก็บ source=instagram เพื่อแยกช่องทางใน Inbox
    if (payload.object === "instagram") {
      let received = 0, stored = 0, commentsReceived = 0, commentsStored = 0;
      const mappedPageIds = new Set<string>();
      const unmappedInstagramIds: string[] = [];
      // เก็บ payload ดิบล่าสุดไว้ดีบัก — เฉพาะ event ที่ "มีเนื้อหา" (คอมเมนต์/ข้อความ) ไม่ทับด้วย read/seen/delivery
      // (กันไม่ให้ event "อ่านแล้ว" มาทับ payload คอมเมนต์ที่เรากำลังตามหา)
      const igHasContent = (payload.entry || []).some((e: any) =>
        e?.field === "comments" || e?.field === "live_comments" ||
        (Array.isArray(e?.changes) && e.changes.length > 0) ||
        (Array.isArray(e?.messaging) && e.messaging.some((m: any) => m?.message || m?.postback || m?.referral))
      );
      if (igHasContent) {
        try { await admin.from("settings").upsert({ key: "meta_webhook_last_instagram_raw", value: payload, updated_at: new Date().toISOString() }); } catch { /* debug only */ }
      }
      const selectedCommentPageIds = await getSelectedCommentPageIds(admin);
      const userToken = await getMetaToken();
      let pagesData = await getMetaPages(GRAPH_BASE, userToken);
      let pages = pagesData?.data ?? [];
      // Refresh only when a genuinely new IG account is not in the 24h cache.
      // Previously every IG message/echo bypassed the cache and called /me/accounts.
      const missingIg = (payload.entry || []).map((entry: any) => String(entry.id || "")).find((igId: string) =>
        igId && !pages.some((p: any) => String(p?.instagram_business_account?.id || "") === igId)
      );
      if (missingIg) {
        pagesData = await getMetaPages(GRAPH_BASE, userToken, { mustIncludeInstagramAccountId: missingIg });
        pages = pagesData?.data ?? [];
      }
      for (const entry of payload.entry || []) {
        const igId = String(entry.id || "");
        received += Array.isArray(entry.messaging) ? entry.messaging.length : 0;
        const page = pages.find((p: any) => String(p?.instagram_business_account?.id || "") === igId);
        if (!page?.id || !page?.access_token) {
          console.warn("instagram webhook account is not linked to an accessible page", igId);
          if (igId) unmappedInstagramIds.push(igId);
          continue;
        }
        const pageId = String(page.id);
        mappedPageIds.add(pageId);
        const pageName = page.name || page.instagram_business_account?.username || null;

        // Instagram comment webhooks arrive as entry.field/value (not entry.changes like Page feed).
        // Keep them in the same comments-only Inbox lane as Facebook, with an igc_ id prefix
        // so the UI and reply endpoint can clearly distinguish the platform.
        // คอมเมนต์ IG มาได้ 2 ทรง: entry.field/value (ตรง ๆ) หรือ entry.changes[].value (เหมือน Page feed ของ FB)
        // รองรับทั้งคู่ ให้คอมเมนต์ IG เข้าเลนความคิดเห็นแบบเดียวกับ FB
        const igCommentValues: any[] = [];
        if (entry.field === "comments" || entry.field === "live_comments") {
          const vals = Array.isArray(entry.value) ? entry.value : [entry.value];
          igCommentValues.push(...vals.filter(Boolean));
        }
        for (const ch of entry.changes || []) {
          if (ch?.field === "comments" || ch?.field === "live_comments") {
            const vals = Array.isArray(ch.value) ? ch.value : [ch.value];
            igCommentValues.push(...vals.filter(Boolean));
          }
        }
        if (igCommentValues.length && selectedCommentPageIds.includes(pageId)) {
          for (const v of igCommentValues) {
            commentsReceived++;
            const commentId = v?.id ? String(v.id) : "";
            if (!commentId) continue;
            const fromId = v?.from?.id ? String(v.from.id) : null;
            const username = v?.from?.username ? String(v.from.username) : null;
            const text = transcriptText(v?.text);
            const mediaId = v?.media?.id ? String(v.media.id) : null;
            const parentId = v?.parent_id ? String(v.parent_id) : v?.parent?.id ? String(v.parent.id) : null;
            const entryTime = Number(entry.time);
            const entryTimeMs = Number.isFinite(entryTime) && entryTime > 0 ? (entryTime < 1e12 ? entryTime * 1000 : entryTime) : Date.now();
            const createdTime = Number(v?.created_time);
            const atIso = Number.isFinite(createdTime) && createdTime > 0
              ? new Date(createdTime < 1e12 ? createdTime * 1000 : createdTime).toISOString()
              : typeof v?.created_time === "string" && !Number.isNaN(Date.parse(v.created_time))
                ? new Date(v.created_time).toISOString()
                : new Date(entryTimeMs).toISOString();
            const ownUsername = String(page.instagram_business_account?.username || "").toLowerCase();
            const isOwnReply = fromId === igId || (!!username && username.toLowerCase() === ownUsername);

            // A reply made directly in Instagram/Business Suite closes the parent alert in our app.
            if (isOwnReply) {
              if (!parentId) continue;
              const targetId = `igc_${parentId}`;
              const { data: target } = await admin.from("chat_customers").select("id,transcript").eq("id", targetId).maybeSingle();
              if (!target) continue;
              const tr = Array.isArray(target.transcript) ? target.transcript : [];
              const already = tr.some((m: any) => String(m?.mid || "") === commentId);
              const replyText = text || "[ตอบจาก Instagram]";
              const nextTr = already ? tr : [...tr, { w: "p", t: replyText, at: atIso, mid: commentId, via: "instagram_comment", by_name: "ตอบจาก Instagram" }].slice(-80);
              await admin.from("chat_customers").update({
                transcript: nextTr, awaiting_reply: false, unread: false, read_at: atIso,
                last_reply_text: replyText, last_reply_by: "ตอบจาก Instagram", last_reply_at: atIso,
                updated_at: new Date().toISOString(),
              }).eq("id", targetId);
              await syncPushState(targetId);
              commentsStored++;
              continue;
            }

            const mediaType = String(v?.media?.media_product_type || v?.media_product_type || v?.media?.product_type || "").toUpperCase();
            const adId = v?.ad_id ? String(v.ad_id) : v?.media?.ad_id ? String(v.media.ad_id) : null;
            const isAd = !!adId || mediaType === "AD" || mediaType.includes("ADS");
            const permalink = v?.permalink || v?.media?.permalink || (ownUsername ? `https://www.instagram.com/${ownUsername}/` : null);
            const rowId = `igc_${commentId}`;
            const { data: existing } = await admin.from("chat_customers").select("id,transcript,customer_name").eq("id", rowId).maybeSingle();
            if (existing) {
              const tr = Array.isArray(existing.transcript) ? existing.transcript : [];
              const already = tr.some((m: any) => String(m?.mid || "") === commentId);
              const nextTr = already ? tr : [...tr, { w: "u", t: text, at: atIso, mid: commentId, via: "instagram_comment" }].slice(-80);
              await admin.from("chat_customers").update({
                source: "comment", comment_promoted_to_inbox: false,
                customer_name: username || existing.customer_name || "Instagram user",
                last_user_text: text, last_message_at: atIso, comment_permalink: permalink,
                comment_post_id: mediaId, entry_ad_id: adId,
                comment_ad_name: isAd ? "Instagram Ads" : null,
                comment_ad_ids: adId ? [adId] : [], comment_ad_names: isAd ? ["Instagram Ads"] : [],
                comment_is_ad: isAd, transcript: nextTr,
                unread: true, awaiting_reply: true, updated_at: new Date().toISOString(),
              }).eq("id", rowId);
            } else {
              await admin.from("chat_customers").insert({
                id: rowId, source: "comment", page_id: pageId, page_name: pageName,
                psid: fromId, customer_name: username || "Instagram user",
                last_user_text: text, last_message_at: atIso,
                comment_post_id: mediaId, comment_permalink: permalink,
                entry_ad_id: adId, comment_ad_name: isAd ? "Instagram Ads" : null,
                comment_ad_ids: adId ? [adId] : [], comment_ad_names: isAd ? ["Instagram Ads"] : [],
                comment_is_ad: isAd, comment_promoted_to_inbox: false,
                transcript: [{ w: "u", t: text, at: atIso, mid: commentId, via: "instagram_comment" }],
                user_message_count: 1, message_count: 1,
                unread: true, awaiting_reply: true, updated_at: new Date().toISOString(),
              });
            }
            commentsStored++;
          }
        }

        for (const ev of entry.messaging || []) {
          const msg = ev.message || postbackAsMessage(ev.postback);
          const referral = ev.referral || ev.postback?.referral;
          const referralAdId = referral?.ad_id ? String(referral.ad_id) : null;
          const isEcho = !!msg?.is_echo || String(ev.sender?.id || "") === igId;
          const igsid = String(isEcho ? (ev.recipient?.id || "") : (ev.sender?.id || ""));
          if (!igsid) continue;
          const nowIso = new Date(Number(ev.timestamp) || Date.now()).toISOString();
          const { data: rows } = await admin.from("chat_customers")
            .select("id,transcript,stage,stage_manual,ai_verified,blocked_at,manual_data,customer_name,page_name")
            .eq("page_id", pageId).eq("psid", igsid).eq("source", "instagram")
            .order("last_message_at", { ascending: false }).limit(1);
          const row = rows?.[0];

          if (referralAdId) {
            await admin.from("chat_referrals").upsert({
              page_id: pageId, psid: igsid, ad_id: referralAdId, ref: referral?.ref ?? null,
              source: "instagram", ads_context: referral?.ads_context_data ?? null, received_at: nowIso,
            }, { onConflict: "page_id,psid,ad_id" });
            if (row) await admin.from("chat_customers").update({ entry_ad_id: referralAdId, updated_at: nowIso }).eq("id", row.id);
          }

          if (msg && (msg.text || msg.attachments?.length)) {
            const mid = msg.mid ? String(msg.mid) : null;

            // ที่มาจากสตอรี่ IG — แอดมินต้องรู้ว่าลูกค้าทักมาเพราะเห็นสตอรี่ ไม่ใช่ทักมาลอย ๆ
            // ตอบสตอรี่  -> msg.reply_to.story = { url, id }
            // แท็ก/เมนชันในสตอรี่ -> attachments[].type === "story_mention"
            const storyReply = msg?.reply_to?.story || null;
            const storyMention = (msg.attachments || []).find((a: any) => a?.type === "story_mention") || null;
            const storyUrl = storyReply?.url || storyMention?.payload?.url || null;
            const storyId = storyReply?.id ? String(storyReply.id) : null;
            const storyKind = storyReply ? "reply" : storyMention ? "mention" : null;
            // แปะไว้ทุก item ของ event นี้ เพื่อให้หน้าเว็บโชว์ป้าย "จากสตอรี่" ที่ข้อความนั้นได้ตรงตัว
            const storyMeta = storyKind
              ? { via: "instagram_story", story_kind: storyKind, ...(storyUrl ? { story_url: storyUrl } : {}), ...(storyId ? { story_id: storyId } : {}) }
              : { via: "instagram" };

            const items: any[] = [];
            if (msg.text) items.push({ w: isEcho ? "p" : "u", t: transcriptText(msg.text), at: nowIso, ...(mid ? { mid } : {}), ...storyMeta });
            for (const att of msg.attachments || []) {
              const type = att?.type;
              const url = att?.payload?.url || null;
              // story_mention ไม่ใช่ "สื่อที่ลูกค้าส่ง" แต่คือภาพสตอรี่ของเราที่เขาแท็ก — ป้ายต้องบอกให้ชัด
              const label = type === "story_mention" ? "[แท็กเราในสตอรี่]"
                : type === "image" ? "[รูปภาพ]" : type === "video" ? "[วิดีโอ]" : type === "audio" ? "[เสียง]" : type === "file" ? "[ไฟล์]" : "[สื่อ]";
              items.push({ w: isEcho ? "p" : "u", t: label, at: nowIso, ...(mid ? { mid } : {}), ...(url ? { img: url, img_source: "webhook" } : {}), ...storyMeta });
            }
            const oldTr = Array.isArray(row?.transcript) ? row.transcript : [];
            if (mid && oldTr.some((m: any) => String(m?.mid || "") === mid)) continue;
            const transcript = [...oldTr, ...items].slice(-80);
            const preview = msg.text ? String(msg.text).slice(0, 300) : items[items.length - 1]?.t || "[สื่อ]";
            // ลูกค้าถูกบล็อก/สแปม → เก็บประวัติเงียบ ๆ ไม่เด้ง/ไม่แจ้งเตือน/ไม่ตั้งธง AI
            if (row?.blocked_at) {
              await admin.from("chat_customers").update({ transcript, last_message_at: nowIso, updated_at: nowIso }).eq("id", row.id);
              stored++;
              continue;
            }
            if (row) {
              const update: Record<string, unknown> = isEcho
                ? { transcript, awaiting_reply: false, unread: false, read_at: nowIso, last_reply_text: preview, last_reply_at: nowIso, last_message_at: nowIso, updated_at: nowIso }
                : { transcript, awaiting_reply: true, unread: true, last_user_text: preview, last_message_at: nowIso, updated_at: nowIso, needs_ai: false, needs_verify: false };
              if (referralAdId) update.entry_ad_id = referralAdId;
              await admin.from("chat_customers").update(update).eq("id", row.id);
              stored++;
              if (isEcho) {
                await clearRelatedUnread(admin, pageId, igsid, "instagram", nowIso);
                await syncPushState(row.id);
              } else {
                // ลูกค้า IG ทักเข้ามา → ยิง push ทันที (เดิมสาย IG ไม่เตือนตอนปิดแอปเลย)
                await notifyNewMessage({ page_id: pageId, page_name: row.page_name || pageName || null, customer_name: row.customer_name || null, conversation_id: row.id, text: preview });
              }
            } else if (!isEcho) {
              let profile: any = {};
              try {
                profile = await (await fetch(`${GRAPH_BASE}/${igsid}?fields=name,username,profile_pic&access_token=${page.access_token}`)).json();
              } catch { /* ชื่อโหลดไม่ได้ก็ยังต้องสร้างห้องทันที */ }
              await admin.from("chat_customers").upsert({
                id: `ig_${igId}_${igsid}`, page_id: pageId, page_name: pageName, psid: igsid,
                customer_name: profile?.name || profile?.username || "Instagram user", profile_pic: profile?.profile_pic || null,
                source: "instagram", transcript, last_user_text: preview, last_message_at: nowIso,
                entry_ad_id: referralAdId,
                message_count: items.length, user_message_count: items.length,
                stage: "new", stage_auto: "new", classified_by: "manual",
                awaiting_reply: true, unread: true, needs_ai: false, needs_verify: false,
                synced_at: nowIso, updated_at: nowIso,
              }, { onConflict: "id", ignoreDuplicates: false });
              stored++;
              // ลูกค้า IG ใหม่ทักเข้ามา → ยิง push ทันที
              await notifyNewMessage({ page_id: pageId, page_name: pageName || null, customer_name: profile?.name || profile?.username || null, conversation_id: `ig_${igId}_${igsid}`, text: preview });
            }
          }
          if (ev.read?.watermark) {
            await admin.from("chat_customers").update({ cust_read_at: new Date(Number(ev.read.watermark)).toISOString(), updated_at: nowIso })
              .eq("page_id", pageId).eq("psid", igsid).eq("source", "instagram");
          }
        }
      }
      await admin.from("settings").upsert({
        key: "meta_webhook_last_instagram_event",
        value: { at: new Date().toISOString(), received, stored, comments_received: commentsReceived, comments_stored: commentsStored, page_ids: [...mappedPageIds], unmapped_instagram_ids: unmappedInstagramIds },
        updated_at: new Date().toISOString(),
      });
      return new Response("ok", { status: 200 });
    }
    // เก็บเฉพาะ metadata ล่าสุดไว้ตรวจสุขภาพ webhook (ไม่เก็บข้อความ/ชื่อผู้คอมเมนต์)
    await admin.from("settings").upsert({
      key: "meta_webhook_last_event",
      value: {
        at: new Date().toISOString(),
        pages: (payload.entry || []).map((entry: any) => ({
          page_id: String(entry.id || ""),
          messaging_count: Array.isArray(entry.messaging) ? entry.messaging.length : 0,
          changes: (entry.changes || []).map((ch: any) => ({
            field: ch.field || null,
            item: ch.value?.item || null,
            verb: ch.value?.verb || null,
            has_comment_id: !!ch.value?.comment_id,
            has_post_id: !!ch.value?.post_id,
          })),
        })),
      },
      updated_at: new Date().toISOString(),
    });

    for (const entry of payload.entry || []) {
      const pageId = String(entry.id);
      for (const ev of entry.messaging || []) {
        const psid = ev.sender?.id ? String(ev.sender.id) : null;
        if (!psid) continue;
        const nowIso = new Date().toISOString();

        // ซ่อมข้อมูลจากเวอร์ชันเก่าที่เคยผูก PSID/เปลี่ยน source ของแถวคอมเมนต์ผิด
        // ทำเฉพาะ PSID ที่กำลังมี event และเฉพาะแถวที่ source เสีย จึงไม่สแกนทั้งตารางทุก webhook
        await admin.from("chat_customers").update({ source: "comment", comment_promoted_to_inbox: false, updated_at: nowIso })
          .eq("page_id", pageId).eq("psid", psid).like("id", "fbc_%").neq("source", "comment");

        // ---- referral: ลูกค้ามาจากแอด/ลิงก์ ----
        const ref = ev.referral || ev.postback?.referral;
        if (ref) {
          const adId = ref.ad_id ? String(ref.ad_id) : null;
          // เก็บ referral ต่อแอด (ลูกค้าทักจากหลายแอด = เก็บครบทุกตัว) — เฉพาะที่มี ad_id
          if (adId) {
            await admin.from("chat_referrals").upsert({
              page_id: pageId, psid, ad_id: adId, ref: ref.ref ?? null, source: ref.source ?? null,
              ads_context: ref.ads_context_data ?? null, received_at: nowIso,
            }, { onConflict: "page_id,psid,ad_id" });
          }
          // ถ้ามีแถวลูกค้าแล้ว เติมทันที (entry_ad_id = แอดล่าสุดที่ทักเข้ามา)
          const upd: Record<string, unknown> = { source: "ad", updated_at: nowIso };
          if (adId) upd.entry_ad_id = adId;
          await admin.from("chat_customers").update(upd)
            .eq("page_id", pageId).eq("psid", psid)
            .not("id", "like", "fbc_%").or("source.is.null,source.neq.comment");
        }

        // ---- ข้อความจากลูกค้า (real-time) — รองรับทั้งข้อความและรูป/ไฟล์แนบ ----
        const msg = ev.message || postbackAsMessage(ev.postback);
        if (msg && !msg.is_echo && (msg.text || (msg.attachments?.length))) {
          const inMid = msg.mid ? String(msg.mid) : null;
          const items: any[] = [];
          if (msg.text) items.push({ w: "u", t: transcriptText(msg.text), at: nowIso, ...(inMid ? { mid: inMid } : {}) });
          for (const att of (msg.attachments || [])) {
            const aType = att?.type;
            const aUrl = att?.payload?.url || null;
            // ไลก์/สติกเกอร์ Meta ส่งมาเป็น attachment type "image" เหมือนรูปทั่วไป แต่มี sticker_id ติดมา
            // ต้องแยกให้ออก เพราะ "กดไลก์ปิดท้าย" ไม่ใช่เรื่องที่ต้องตอบ (ใช้ตอนคิดสถิติค้างตอบ)
            const isSticker = !!att?.payload?.sticker_id || !!msg.sticker_id;   // Meta อาจใส่ sticker_id ที่ระดับ message
            const label = isSticker ? "[สติกเกอร์]"
              : aType === "image" ? "[รูปภาพ]" : aType === "video" ? "[วิดีโอ]" : aType === "audio" ? "[เสียง]" : aType === "file" ? "[ไฟล์]" : "[สื่อ]";
            const it: any = { w: "u", t: label, at: nowIso, ...(inMid ? { mid: inMid } : {}) };
            if (isSticker) it.sticker = true;
            // ข้อ 4: สติกเกอร์ลูกค้ามี url ให้โชว์รูปได้ (เดิมเงื่อนไขตัดสติกเกอร์ทิ้ง เลยขึ้นแต่ตัวหนังสือ)
            if (aUrl && (isSticker || aType === "image" || aType === "video")) { it.img = aUrl; it.img_source = "webhook"; }
            items.push(it);
          }
          if (!items.length) items.push({ w: "u", t: "[สื่อ]", at: nowIso, ...(inMid ? { mid: inMid } : {}) });
          const lastText = msg.text ? String(msg.text).slice(0, 300) : items[items.length - 1].t;
          const { data: rows } = await admin.from("chat_customers")
            .select("id, transcript, stage, stage_manual, ai_verified, blocked_at, manual_data, customer_name, page_name, profile_pic").eq("page_id", pageId).eq("psid", psid)
            .not("id", "like", "fbc_%").or("source.is.null,source.neq.comment")
            .order("last_message_at", { ascending: false }).limit(1);
          const row = rows?.[0];
          let notifyPush: any = null;   // ข้อมูลไว้ยิง push "ข้อความใหม่" หลังอัปเดต DB เสร็จ
          // ลูกค้าถูกบล็อก/สแปม → เก็บประวัติเงียบ ๆ ไม่เด้ง ไม่แจ้งเตือน ไม่ตั้งธง AI
          if (row?.blocked_at) {
            const btr = Array.isArray(row.transcript) ? row.transcript : [];
            if (!(inMid && btr.some((m: any) => String(m?.mid || "") === inMid))) {
              await admin.from("chat_customers").update({ transcript: [...btr, ...items].slice(-80), last_message_at: nowIso, updated_at: nowIso }).eq("id", row.id);
            }
            continue;
          }
          if (row) {
            const tr = Array.isArray(row.transcript) ? row.transcript : [];
            // กันข้อความลูกค้าเบิ้ล — Meta อาจส่ง event ซ้ำ (retry) mid เดิม → ข้าม
            const firstUrl = (msg.attachments || [])[0]?.payload?.url || null;
            const isDup = (inMid && tr.some((m: any) => m?.mid === inMid)) ||
              (firstUrl && tr.slice(-12).some((m: any) => m?.w === "u" && m.img === firstUrl && m.at && (Date.now() - new Date(m.at).getTime()) < 2 * 60 * 1000));
            if (isDup) {
              // ถ้า sync มาถึงก่อน webhook: ห้ามแค่ข้าม เพราะจะค้าง URL preview แบบพื้นขาว
              // ให้รวมข้อมูล webhook เข้า message เดิม โดย URL จาก payload.url เป็นตัวหลัก แล้วไม่เพิ่มแถวใหม่
              const incomingMedia = items.find((m: any) => m?.img);
              if (incomingMedia?.img) {
                let changed = false;
                const mergedTr = tr.map((m: any) => {
                  const sameMid = inMid && m?.mid && String(m.mid) === inMid;
                  const sameRecentMedia = !inMid && firstUrl && m?.w === "u" && m?.img === firstUrl && m?.at && (Date.now() - new Date(m.at).getTime()) < 2 * 60 * 1000;
                  if (!sameMid && !sameRecentMedia) return m;
                  changed = true;
                  const sticker = !!incomingMedia.sticker || !!m.sticker || incomingMedia.t === "[สติกเกอร์]" || m.t === "[สติกเกอร์]";
                  // ถ้า sync มี URL สติกเกอร์โปร่งใสอยู่แล้ว ให้รักษา URL นั้นไว้
                  if (sticker && m.img_source === "sync" && m.img) {
                    return { ...m, sticker: true, t: incomingMedia.t || m.t };
                  }
                  return { ...m, img: incomingMedia.img, img_source: "webhook", sticker, t: incomingMedia.t || m.t };
                });
                if (changed) {
                  await admin.from("chat_customers").update({ transcript: mergedTr, updated_at: nowIso }).eq("id", row.id);
                }
              }
              continue;
            }
            const newTr = [...tr, ...items].slice(-80);
            const upd: Record<string, unknown> = {
              transcript: newTr, awaiting_reply: true, unread: true,
              last_user_text: lastText, last_message_at: nowIso, updated_at: nowIso,
            };
            // ปิดระบบสกัด/จัดสถานะอัตโนมัติ ฐานข้อมูลแก้ได้จากแอดมินหรือ Import เท่านั้น
            upd.needs_ai = false; upd.needs_verify = false;
            // หมายเหตุ: ไม่ดึงรูปโปรไฟล์ FB — Meta ปิด User Profile API (GET /{psid}?fields=profile_pic คืน error 100/33)
            //   ยิงไปก็ล้มเหลวเปล่า ๆ เปลือง Graph call · ใช้ตัวอักษรย่อแทน (IG ยังดึงรูปได้ตามปกติ)
            await admin.from("chat_customers").update(upd).eq("id", row.id);
            notifyPush = { page_id: pageId, page_name: row.page_name || null, customer_name: row.customer_name || null, conversation_id: row.id, text: lastText };
          } else {
            // ลูกค้าใหม่เอี่ยม → สร้างแถวทันที (ไม่รอ cron sync) — ใช้ page token จาก cache, ยิง Graph แค่ 1 ครั้ง/ลูกค้าใหม่
            try {
              const { data: cacheRow } = await admin.from("app_secrets").select("value").eq("key", "meta_pages_cache").maybeSingle();
              let pageTok = (JSON.parse(cacheRow?.value || "[]") as any[]).find((p) => String(p.id) === pageId)?.access_token;
              if (!pageTok) {
                // เพจใหม่ยังไม่อยู่ใน cache → ดึงสด 1 ครั้ง (เช่นเพิ่งลิงก์เพจ) แล้วอัปเดต cache
                const { data: tokRow } = await admin.from("app_secrets").select("value").eq("key", "meta_access_token").maybeSingle();
                const userTok = tokRow?.value || Deno.env.get("META_ACCESS_TOKEN") || "";
                if (userTok) {
                  const fresh = await (await fetch(`https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${userTok}`)).json();
                  if (Array.isArray(fresh?.data) && fresh.data.length) {
                    await admin.from("app_secrets").upsert({ key: "meta_pages_cache", value: JSON.stringify(fresh.data), updated_at: new Date().toISOString() });
                    pageTok = fresh.data.find((p: any) => String(p.id) === pageId)?.access_token;
                  }
                }
              }
              if (pageTok) {
                // หา conversation id (PK) + ชื่อลูกค้า จาก psid — คำขอเดียว
                const cv = await (await fetch(`https://graph.facebook.com/v22.0/${pageId}/conversations?user_id=${psid}&fields=id,participants&access_token=${pageTok}`)).json();
                const conv = cv?.data?.[0];
                if (conv?.id) {
                  const who = (conv.participants?.data ?? []).find((p: any) => String(p.id) !== pageId);
                  const { data: pageCfg } = await admin.from("page_lead_config").select("page_name").eq("page_id", pageId).maybeSingle();
                  // ไม่ดึงรูปโปรไฟล์ FB — Meta ปิด User Profile API แล้ว (ยิงไปก็ error) ใช้ตัวอักษรย่อแทน
                  await admin.from("chat_customers").upsert({
                    id: conv.id, page_id: pageId, page_name: pageCfg?.page_name ?? null,
                    psid, customer_name: who?.name ?? null,
                    message_count: items.length, user_message_count: items.length,
                    transcript: items, last_user_text: lastText, last_message_at: nowIso,
                    stage: "new", stage_auto: "new", classified_by: "manual",
                    awaiting_reply: true, unread: true, needs_ai: false, needs_verify: false,
                    synced_at: nowIso, updated_at: nowIso,
                  }, { onConflict: "id", ignoreDuplicates: false });
                  notifyPush = { page_id: pageId, page_name: pageCfg?.page_name || null, customer_name: who?.name || null, conversation_id: conv.id, text: lastText };
                }
              }
            } catch (_e) { /* พลาดก็ปล่อยให้ sync รอบถัดไปเก็บ */ }
          }
          // ยิง push "ข้อความใหม่ทันที" (เหมือน Messenger) — fire-and-forget ผ่าน send-push
          if (notifyPush) {
            try {
              const SB = Deno.env.get("SUPABASE_URL")!;
              const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
              await fetch(`${SB}/functions/v1/send-push`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${SK}` },
                body: JSON.stringify({ action: "notify_new", ...notifyPush }),
              });
            } catch (_e) { /* push พลาดไม่กระทบการรับข้อความ */ }
          }
        }

        // ---- echo: เพจส่งข้อความเอง (ตอบจากแชทเพจ/แอปอื่น) → ลูกค้าคือ recipient (ไม่ใช่ sender=เพจ) ----
        // ปลดธง "ยังไม่ได้ตอบ" + ต่อ transcript ให้เห็นว่าแอดมินตอบอะไรไป
        if (msg?.is_echo) {
          const custPsid = ev.recipient?.id ? String(ev.recipient.id) : null;
          if (custPsid) {
            const { data: rows } = await admin.from("chat_customers")
              .select("id, transcript").eq("page_id", pageId).eq("psid", custPsid)
              .not("id", "like", "fbc_%").or("source.is.null,source.neq.comment")
              .order("last_message_at", { ascending: false }).limit(1);
            const row = rows?.[0];
            if (row) {
              const tr = Array.isArray(row.transcript) ? row.transcript : [];
              // กันข้อความเบิ้ล — เช็คหลายทาง เพราะ echo/sync/แอป ใช้ id คนละชุด และสติกเกอร์ไม่มีข้อความ
              const mid = msg.mid ? String(msg.mid) : null;
              const tail = tr.slice(-12);
              const firstUrl = (msg.attachments || [])[0]?.payload?.url || null;
              const dupByMid = mid && tr.some((m: any) => m?.mid && m.mid === mid);   // เช็คทั้ง transcript (เดิมเช็คแค่ 10 ท้าย)
              const echoText = msg.text ? transcriptText(msg.text) : null;
              const recent = (m: any) => m?.at && (Date.now() - new Date(m.at).getTime()) < 2 * 60 * 1000;
              const dupByText = echoText && tail.some((m: any) => m?.w === "p" && m.t === echoText && recent(m));
              // สติกเกอร์/รูป: กันเบิ้ลด้วย url ของสื่อ (echo กับที่ append ไว้ url เดียวกัน) ในช่วง 2 นาที
              const dupByUrl = firstUrl && tail.some((m: any) => m?.w === "p" && m.img === firstUrl && recent(m));
              // Meta ไม่ส่งตัวตนแอดมินมากับ echo (sender.id = PAGE_ID เสมอ) → ตอบจากเพจ = ไม่ระบุชื่อ
              const adminName: string | null = null;
              // ข้อความล่าสุดฝั่งเพจ — เอาไปโชว์บนป้ายชื่อซ้าย (ข้อ 3: เดิมโชว์แต่ข้อความลูกค้า)
              const echoPreview = msg.text ? String(msg.text).slice(0, 300)
                : msgAttachPreview(msg.attachments || []);
              if (dupByMid || dupByText || dupByUrl) {
                // echo ซ้ำกับรายการที่แอป/sync ใส่ไว้แล้ว: อัปเกรด URL สื่อเป็น payload.url จาก webhook
                // แต่ไม่ append รายการใหม่ จึงแก้ทั้งพื้นขาวและสติกเกอร์เบิ้ลพร้อมกัน
                let mergedTr = tr;
                if (firstUrl) {
                  let changed = false;
                  mergedTr = tr.map((m: any) => {
                    const sameMid = mid && m?.mid && String(m.mid) === mid;
                    const sameRecent = m?.w === "p" && recent(m) && ((firstUrl && m?.img === firstUrl) || (echoText && m?.t === echoText));
                    if (!sameMid && !sameRecent) return m;
                    changed = true;
                    const sticker = !!((msg.attachments || [])[0]?.payload?.sticker_id || msg.sticker_id) || !!m.sticker || m.t === "[สติกเกอร์]";
                    // สติกเกอร์จาก sync เป็น URL โปร่งใส ห้าม echo payload.url เขียนทับ
                    if (sticker && m.img_source === "sync" && m.img) return { ...m, sticker: true };
                    return { ...m, img: firstUrl, img_source: "webhook", sticker };
                  });
                  if (!changed) mergedTr = tr;
                }
                const lpDup = lastReplyFromTranscript(mergedTr);   // เอาข้อความเพจตัวสุดท้ายตามลำดับจริง (กัน echo สลับลำดับ)
                await admin.from("chat_customers").update({
                  transcript: mergedTr, awaiting_reply: false, unread: false, read_at: nowIso,
                  last_reply_text: lpDup ? lpDup.text : echoPreview,
                  last_reply_by: (lpDup?.by) || adminName,
                  last_reply_at: lpDup ? lpDup.at : nowIso,
                  updated_at: nowIso,
                }).eq("id", row.id);
              } else {
                const items: any[] = [];
                if (msg.text) items.push({ w: "p", t: transcriptText(msg.text), at: nowIso, mid, ...(adminName ? { by_name: adminName } : {}) });
                for (const att of (msg.attachments || [])) {
                  const aType = att?.type; const aUrl = att?.payload?.url || null;
                  const isSticker = !!att?.payload?.sticker_id || !!msg.sticker_id;
                  const it: any = {
                    w: "p", at: nowIso, mid,
                    t: isSticker ? "[สติกเกอร์]" : aType === "image" ? "[รูปภาพ]" : aType === "video" ? "[วิดีโอ]" : aType === "audio" ? "[เสียง]" : aType === "file" ? "[ไฟล์]" : "[สื่อ]",
                    ...(adminName ? { by_name: adminName } : {}),
                  };
                  if (isSticker) it.sticker = true;
                  if (aUrl && (isSticker || aType === "image" || aType === "video")) { it.img = aUrl; it.img_source = "webhook"; }  // ข้อ 2: มี url ก็โชว์รูปสติกเกอร์
                  items.push(it);
                }
                const newTr = items.length ? [...tr, ...items].slice(-80) : tr;
                const lpNew = lastReplyFromTranscript(newTr);   // ข้อความเพจตัวสุดท้ายตามลำดับจริง
                await admin.from("chat_customers").update({
                  transcript: newTr, awaiting_reply: false, unread: false, read_at: nowIso,
                  last_reply_text: lpNew ? lpNew.text : echoPreview,
                  last_reply_by: (lpNew?.by) || adminName,
                  last_reply_at: lpNew ? lpNew.at : nowIso,
                  last_message_at: nowIso, updated_at: nowIso,
                }).eq("id", row.id);
              }
              await clearRelatedUnread(admin, pageId, custPsid, null, nowIso);
              await syncPushState(row.id);
            }
          }
        }

        // ---- read: ลูกค้าเปิดอ่านข้อความของเราแล้ว (ต้อง subscribe field message_reads) ----
        // ev.read.watermark = เวลา (ms) ที่ลูกค้าอ่านถึง — เก็บไว้โชว์ "อ่านแล้ว เวลา..." ในแอป
        if (ev.read?.watermark && psid) {
          const readIso = new Date(Number(ev.read.watermark)).toISOString();
          await admin.from("chat_customers")
            .update({ cust_read_at: readIso, updated_at: nowIso })
            .eq("page_id", pageId).eq("psid", psid)
            .not("id", "like", "fbc_%").or("source.is.null,source.neq.comment");
        }
      }

      // ---- feed: คอมเมนต์ใต้โพสต์/โฆษณา (ต้อง subscribe field "feed") ----
      const changes = entry.changes || [];
      if (changes.length) {
        // รับเฉพาะเพจที่มีผู้ใช้เลือกไว้ในหน้า Inbox เท่านั้น
        const selectedPageIds = await getSelectedCommentPageIds(admin);
        if (!selectedPageIds.includes(pageId)) continue;
        let pageName: string | null = null;
        try {
          const { data: pRow } = await admin.from("page_lead_config").select("page_name").eq("page_id", pageId).maybeSingle();
          pageName = pRow?.page_name ?? null;
        } catch { /* ไม่มีก็ปล่อยว่าง */ }
        for (const ch of changes) {
          if (ch.field !== "feed") continue;
          const v = ch.value || {};
          if (v.item !== "comment") continue;
          if (v.verb !== "add" && v.verb !== "edited") continue;
          const commentId = v.comment_id ? String(v.comment_id) : null;
          if (!commentId) continue;
          const fromId = v.from?.id ? String(v.from.id) : null;
          const text = transcriptText(v.message);
          const atIso = v.created_time ? new Date(Number(v.created_time) * 1000).toISOString() : new Date().toISOString();
          // แอดมินตอบจาก Facebook Page โดยตรง: ไม่สร้างแจ้งเตือนใหม่ แต่ปิดสถานะค้างของคอมเมนต์แม่
          if (fromId && fromId === pageId) {
            const parentId = v.parent_id ? String(v.parent_id) : null;
            if (!parentId) continue;
            const targetId = `fbc_${parentId}`;
            const { data: target } = await admin.from("chat_customers").select("id, transcript").eq("id", targetId).maybeSingle();
            if (!target) continue;
            const tr = Array.isArray(target.transcript) ? target.transcript : [];
            const replyText = text || (v.photo || v.photos ? "[รูปภาพ]" : "[ตอบจากเพจ]");
            const already = tr.some((m: any) => m?.mid === commentId);
            const nextTr = already ? tr : [...tr, { w: "p", t: replyText, at: atIso, mid: commentId, via: "facebook_page", by_name: "ตอบจากเพจ" }].slice(-80);
            await admin.from("chat_customers").update({
              transcript: nextTr, awaiting_reply: false, unread: false, read_at: atIso,
              last_reply_text: replyText, last_reply_by: "ตอบจากเพจ", last_reply_at: atIso,
              updated_at: new Date().toISOString(),
            }).eq("id", targetId);
            await syncPushState(targetId);
            continue;
          }
          const rowId = `fbc_${commentId}`;
          const permalink = v.post?.permalink_url || `https://www.facebook.com/${commentId}`;
          const postId = v.post_id ? String(v.post_id) : null;
          if (!postId) continue;
          // feed มีทั้งโพสต์ทั่วไปและโฆษณา: resolve ad ถ้ามี แต่โพสต์ทั่วไปก็รับเข้ามา
          const metaToken = await getMetaToken();
          const ads = metaToken ? await resolveCommentAds(admin, GRAPH_BASE, metaToken, postId, selectedPageIds) : [];
          const adIds = ads.map((a) => a.ad_id);
          const adNames = ads.map((a) => a.ad_name).filter(Boolean);
          const primaryAd = ads[0] || null;
          const { data: existing } = await admin.from("chat_customers").select("id, transcript").eq("id", rowId).maybeSingle();
          if (existing) {
            const tr = Array.isArray(existing.transcript) ? existing.transcript : [];
            const nextTr = v.verb === "edited" ? tr : [...tr, { w: "u", t: text, at: atIso }].slice(-80);
            await admin.from("chat_customers").update({
              source: "comment", comment_promoted_to_inbox: false,
              last_user_text: text, last_message_at: atIso, comment_permalink: permalink,
              comment_post_id: postId, entry_ad_id: primaryAd?.ad_id || null, comment_ad_name: primaryAd?.ad_name || null,
              comment_ad_ids: adIds, comment_ad_names: adNames, transcript: nextTr,
              comment_is_ad: ads.length > 0,
              unread: true, awaiting_reply: true, updated_at: new Date().toISOString(),
            }).eq("id", rowId);
          } else {
            await admin.from("chat_customers").insert({
              id: rowId, source: "comment", page_id: pageId, page_name: pageName,
              psid: null, customer_name: v.from?.name || "(ผู้คอมเมนต์)",   // ยังไม่มี PSID ส่ง Messenger จริง (ได้จาก private reply ตอนตอบ)
              last_user_text: text, last_message_at: atIso,
              comment_post_id: postId, comment_permalink: permalink,
              entry_ad_id: primaryAd?.ad_id || null, comment_ad_name: primaryAd?.ad_name || null,
              comment_ad_ids: adIds, comment_ad_names: adNames,
              comment_is_ad: ads.length > 0, comment_promoted_to_inbox: false,
              transcript: [{ w: "u", t: text, at: atIso }],
              user_message_count: 1, message_count: 1,
              unread: true, awaiting_reply: true,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (e) {
    console.error("meta-webhook processing failed:", e instanceof Error ? e.message : e);
    try {
      const diag = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await diag.from("settings").upsert({
        key: "meta_webhook_last_error",
        value: { at: new Date().toISOString(), error: String(e instanceof Error ? e.message : e).slice(0, 500) },
        updated_at: new Date().toISOString(),
      });
    } catch { /* ต้องตอบ Meta ให้ทันเสมอ */ }
    // ต้องตอบ 200 เสมอ ไม่งั้น Meta จะ retry รัว ๆ
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
});
