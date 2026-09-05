// supabase/functions/sync-conversations/index.ts
// ดึงแชท Messenger เข้ามาเก็บใน chat_customers (แยกตามเพจ)
// ตั้งค่าได้จาก settings.chat_sync_config: per_page, messages
// เลือกเพจที่ซิงก์ได้จาก page_lead_config.sync_enabled
// โหมด:
//   body {}                          = ซิงก์ปกติทุกเพจที่เปิด (คิวล่าสุดตาม per_page)
//   body { full:true, page_id, after } = ดึงย้อนหลังเพจเดียวแบบทยอย (resume ด้วย cursor `after`)
// upsert เป็นชุดๆ ทันที (ไม่สะสมใน memory) กัน "not enough compute resources"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { contentHashOf } from "../_shared/chat-extract.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getMetaBackgroundGuard, recordMetaUsage } from "../_shared/meta-rate.ts";
import { readJsonBody } from "../_shared/security.ts";

const GRAPH_VERSION = "v22.0"; // v19 หมดอายุแล้ว (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_LOOPS_PER_CALL = 2; // full mode: ต่อการเรียก 1 ครั้ง (2 x 100 = ~200 แชท) แล้ว resume — เบาลงกัน compute limit เมื่อเปิด two-stage AI
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004]); // Meta rate limit (app/user/page/custom)
const READ_STATUS_STATE_KEY = "messenger_read_status_sync";
const RECENT_STATE_KEY = "messenger_recent_sync";
const RECENT_COOLDOWN_MS = 25 * 1000;   // cooldown ร่วมต่อเพจ — หลายเครื่อง/หลายแท็บเปิดพร้อมกันก็ยิง Meta รอบเดียว
const RECENT_LIMIT = 25;                // Meta เรียง conversations ตาม updated_time ล่าสุดก่อน
const DEFAULT_READ_STATUS_COOLDOWN_MS = 5 * 60 * 1000;
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
// ชื่อ/ข้อความย่อก็วิ่งผ่าน JSON body เดียวกัน ถ้ามี surrogate ค้างก็ล้มทั้งคำขอ
const safeShort = (v: unknown, n: number) => stripLoneSurrogates(String(v || "").slice(0, n)) || null;

const timeMs = (v: unknown) => {
  const t = v ? new Date(String(v)).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
};

// เดาภาษา/ประเทศจาก "สคริปต์" ที่ลูกค้าพิมพ์ — ฟรีและชัดเจน (ไทยกับลาวคนละบล็อก Unicode)
// เดิมช่องประเทศจะว่างจนกว่าจะมีคนเปิดแชท (ตัวแปล AI เป็นคนเติม) ห้องใหม่เลยไม่มีประเทศให้ดูในลิสต์
// ใช้เฉพาะห้องที่ยังไม่มีค่า — ตัวแปลตอนเปิดแชทเขียนทับด้วยค่าที่แม่นกว่าได้ตามเดิม
function guessOriginFromScript(text: string): { country: string; lang: string } | null {
  if (/[\u0E80-\u0EFF]/.test(text)) return { country: "ลาว", lang: "Lao" };   // อักษรลาว
  if (/[\u0E00-\u0E7F]/.test(text)) return { country: "ไทย", lang: "Thai" };  // อักษรไทย
  return null;
}

// "ยังไม่อ่าน" ของแอป = มีข้อความลูกค้าค้างรอตอบ ที่ใหม่กว่าเวลาที่เราอ่าน/ตอบล่าสุด
// ห้ามเชื่อ unread_count ของ Meta เพียว ๆ: ค่านั้นค้าง > 0 ตลอดถ้าไม่มีใครเปิดอ่านในกล่องข้อความเพจ
// และ conversation.updated_time (ที่เราเก็บเป็น last_message_at) ขยับตอน "เพจตอบ" ด้วย
// ผลเดิมคือแอดมินอ่าน/ตอบในแอปแล้ว รอบ sync ถัดไปดันกลับมาเป็นยังไม่อ่าน
function shouldFlagUnread(row: any): boolean {
  if (row?.awaiting_reply === false) return false;      // ข้อความล่าสุดเป็นของเพจ = ตอบแล้ว ไม่ใช่ของค้างอ่าน
  const lastAt = timeMs(row?.last_message_at);
  if (!lastAt) return false;
  const readAt = timeMs(row?.read_at);
  // ไม่มีเวลาอ่าน (แถวเก่าที่ถูกล้าง unread จาก webhook echo/sync) → เทียบกับเวลาตอบล่าสุดของเราแทน
  const seenAt = readAt || timeMs(row?.last_reply_at);
  return lastAt > seenAt;
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
  } catch (_e) { /* badge sync พลาดต้องไม่ทำให้งาน sync หลักล้ม */ }
}

// ดึง JSON พร้อม retry + backoff เมื่อเจอ error ชั่วคราวของ Meta (code 1/2 = unknown/บริการชั่วคราว, 4/17/32/341/613 = rate limit)
// หรือ network throw — กัน backfill ล้มทั้งงานเพราะสะดุดครั้งเดียว
async function fetchJson(url: string, tries = 3): Promise<any> {
  const TRANSIENT = new Set([1, 2, 4, 17, 32, 341, 368, 613]);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j?.error && TRANSIENT.has(Number(j.error.code)) && i < tries - 1) {
        await new Promise((res) => setTimeout(res, 800 * (i + 1)));
        continue;
      }
      return j;
    } catch (e) {
      if (i < tries - 1) { await new Promise((res) => setTimeout(res, 800 * (i + 1))); continue; }
      return { error: { message: String(e instanceof Error ? e.message : e) } };
    }
  }
  return { error: { message: "fetch failed" } };
}

// รายชื่อเพจและ Page token ใช้ cache กลางจาก _shared/meta-pages.ts
// contentHashOf → ../_shared/chat-extract.ts

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await readJsonBody(req, 64 * 1024);
    const full = body?.full === true;
    const onlyPage = body?.page_id ? String(body.page_id) : null;
    // ตัดยอดวันที่: ไม่เอาแชทที่เก่ากว่านี้ (โหมด full) — เพจที่คุยกับลูกค้ามานานมีเป็นหมื่นแชท
    // ดึงหมดทำให้เปลืองโควตา Meta และหน้าเว็บอืดโดยไม่ได้ใช้ข้อมูลเก่าจริง
    const sinceMs = (() => {
      const v = body?.since;
      if (!v) return null;
      const t = new Date(String(v));
      return Number.isNaN(t.getTime()) ? null : t.getTime();
    })();
    const after = body?.after ? String(body.after) : null;
    const job = body?.job ? String(body.job) : "sync";  // "sync" = ดึงข้อมูลอย่างเดียว | "classify" = AI เล็ก | "verify" = AI ใหญ่
    const auth = (job === "read_status" || job === "recent") && !full
      // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้าตอบแชทได้ ก็ตอบได้ทุกเพจและทุก LINE OA
      ? await authorizeRequest(req, { tab: ["inbox", "chat"], allowService: true })
      : await authorizeRequest(req, { admin: true, setting: "synccfg", pageId: onlyPage, allowService: true });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    // guard เวลาต่อการเรียก 1 ครั้ง — คืนผลบางส่วนก่อนโดนตัด แล้ว frontend ทำต่อเอง (auto-retry)
    const aiDeadline = Date.now() + 130000;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const base = `https://graph.facebook.com/${GRAPH_VERSION}`;

    const { data: cfgRow } = await admin.from("settings").select("value").eq("key", "chat_sync_config").maybeSingle();
    const cfg = (cfgRow?.value || {}) as any;
    const perPage = Math.min(2000, Math.max(20, Number(cfg.per_page) || 200));
    const msgLimit = Math.min(100, Math.max(5, Number(cfg.messages) || 30));
    let stoppedEarly = false; // true = ทำไม่ครบ (หมดเวลา/หมด budget/รอ AI) → ให้ frontend ซิงก์ต่อ

    const { data: cfgRows } = await admin.from("page_lead_config").select("page_id, sync_enabled");
    const enabledMap: Record<string, boolean> = {};
    for (const c of cfgRows ?? []) enabledMap[c.page_id] = c.sync_enabled !== false;

    const jsonResp = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...corsHeaders, "content-type": "application/json" } });

    // เช็คว่า deploy เวอร์ชันที่มี job แล้วหรือยัง (ไม่แตะ Meta/AI) — ใช้ยืนยันการ deploy
    if (job === "ping") return jsonResp({ ok: true, version: "sync-v5", jobs: ["sync", "recent", "read_status"], note: "classify/verify ย้ายไป function chat-ai" });

    // ================= เช็คสถานะ "อ่าน/ยังไม่อ่าน" แบบเบา (ดึงแค่ unread_count ไม่ดึงข้อความ) =================
    if (job === "read_status") {
      const token = await getMetaToken();
      if (!token) return jsonResp({ ok: false, error: "ยังไม่ได้ตั้งค่า Meta access token" });
      const pagesData = await getMetaPages(base, token, { mustIncludePageId: onlyPage || undefined });
      let pages = (pagesData?.data ?? []).filter((p: any) => p.access_token);
      pages = onlyPage ? pages.filter((p: any) => p.id === onlyPage) : pages.filter((p: any) => enabledMap[p.id] !== false);
      if (!auth.isService && auth.permission?.role !== "admin") {
        pages = pages.filter((p: any) =>
          auth.permission?.allowedPages.includes(String(p.id)),
        );
      }
      const guard = await getMetaBackgroundGuard(admin);
      if (guard.blocked) return jsonResp({ ok: true, job, updated: 0, skipped: "rate_guard" });
      // ใช้เวลาแจ้งเตือนแชทที่แอดมินตั้งให้พนักงานเป็นรอบตรวจ Facebook Page ด้วย
      // ถ้าหลายคนตั้งไม่เท่ากัน ใช้ค่าที่สั้นที่สุด เพื่อให้ทุกคนเห็นสถานะทันตาม SLA ที่เข้มที่สุด
      const { data: alertRows } = await admin.from("user_permissions").select("alert_minutes, chat_alert");
      const configuredMinutes = (alertRows ?? [])
        .filter((r: any) => r.chat_alert !== false)
        .map((r: any) => Number(r.alert_minutes))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      const configuredMin = configuredMinutes.length ? Math.min(...configuredMinutes) : DEFAULT_READ_STATUS_COOLDOWN_MS / 60000;
      const readStatusCooldownMs = Math.max(1, Math.min(15, configuredMin)) * 60 * 1000;
      const { data: stateRow } = await admin.from("settings").select("value").eq("key", READ_STATUS_STATE_KEY).maybeSingle();
      const state = stateRow?.value || {};
      const lastByPage = state.last_by_page && typeof state.last_by_page === "object" ? state.last_by_page : {};
      // cooldown ต่อเพจ: ผู้ใช้หลายเครื่องหรือคนละตัวกรองก็ไม่ทำให้เพจเดียวกันถูกเรียกซ้ำ
      pages = pages.filter((p: any) => Date.now() - new Date(lastByPage[String(p.id)] || 0).getTime() >= readStatusCooldownMs);
      if (!pages.length) return jsonResp({ ok: true, job, updated: 0, skipped: "cooldown", interval_minutes: readStatusCooldownMs / 60000 });
      const checkedAt = new Date().toISOString();
      for (const p of pages) lastByPage[String(p.id)] = checkedAt;
      // Claim before Graph calls: only one staff device performs this fallback scan per page.
      await admin.from("settings").upsert({ key: READ_STATUS_STATE_KEY, value: { last_by_page: lastByPage }, updated_at: checkedAt });
      let updated = 0;
      let changedConversationId = "";
      for (const page of pages) {
        if (Date.now() > aiDeadline) break;
        let url = `${base}/${page.id}/conversations?platform=messenger&fields=id,unread_count,participants.limit(10){id}&limit=100&access_token=${page.access_token}`;
        for (let loop = 0; loop < 4 && url; loop++) {
          const response = await fetch(url);
          const usage = await recordMetaUsage(admin, response, "messenger_read_status");
          const data = await response.json().catch(() => ({}));
          if (usage.blocked) break;
          if (data?.error) break;
          const convs = (data?.data ?? []) as any[];
          const readConvs = convs.filter((c) => (Number(c.unread_count) || 0) === 0);
          const readIds = readConvs.map((c) => c.id);
          const readPsids = [...new Set(readConvs.map((c: any) =>
            (c?.participants?.data ?? []).find((p: any) => String(p?.id || "") !== String(page.id))?.id,
          ).filter(Boolean).map(String))];
          const unreadIds = convs.filter((c) => (Number(c.unread_count) || 0) > 0).map((c) => c.id);
          // อัปเดตเฉพาะที่ค่าจะเปลี่ยนจริง (กัน realtime เด้งฟรี)
          const readAt = new Date().toISOString();
          if (readIds.length) {
            const r = await admin.from("chat_customers").update({ unread: false, read_at: readAt, updated_at: readAt }).in("id", readIds).eq("unread", true).select("id");
            updated += (r.data?.length || 0);
            if (!changedConversationId && r.data?.[0]?.id) changedConversationId = String(r.data[0].id);
          }
          // id ของ Meta conversation และ id ในฐานข้อมูลเก่าบางชุดไม่ตรงกัน จึง match page + PSID ซ้ำอีกชั้น
          if (readPsids.length) {
            const r = await admin.from("chat_customers").update({ unread: false, read_at: readAt, updated_at: readAt })
              .eq("page_id", page.id).in("psid", readPsids).eq("unread", true)
              .not("id", "like", "fbc_%").or("source.is.null,source.neq.comment").select("id");
            updated += (r.data?.length || 0);
            if (!changedConversationId && r.data?.[0]?.id) changedConversationId = String(r.data[0].id);
          }
          if (unreadIds.length) {
            // อย่าทับสถานะ "อ่านในแอปแล้ว" — unread_count ของ Meta ค้าง > 0 ได้เรื่อย ๆ ถ้าไม่มีใครเปิดอ่านในกล่องข้อความเพจ
            // จึงตั้ง unread=true เฉพาะกรณีที่ "มีข้อความลูกค้าค้างรอตอบจริง" และใหม่กว่าเวลาอ่าน/เวลาตอบล่าสุดของเรา
            const { data: cand } = await admin.from("chat_customers")
              .select("id, read_at, last_message_at, last_reply_at, awaiting_reply").in("id", unreadIds).eq("unread", false);
            const toFlag = (cand ?? []).filter((c: any) => shouldFlagUnread(c)).map((c: any) => c.id);
            if (toFlag.length) await admin.from("chat_customers").update({ unread: true, updated_at: new Date().toISOString() }).in("id", toFlag);
          }
          url = data?.paging?.next ?? "";
        }
      }
      if (changedConversationId) await syncPushState(changedConversationId);
      return jsonResp({ ok: true, job, updated, interval_minutes: readStatusCooldownMs / 60000 });
    }

    // ================= งาน AI (classify/verify) ย้ายไป function "chat-ai" ถาวร =================
    // เหตุผล: แยกโควตาทรัพยากรจากงานซิงก์/เช็คสถานะอ่าน — เดิมแย่ง worker กันจนชน "not enough compute resources"
    if (job === "classify" || job === "verify") {
      return jsonResp({ ok: false, error: `งาน AI ย้ายไปที่ function "chat-ai" แล้ว — รีเฟรชหน้าเว็บเป็นเวอร์ชันล่าสุด แล้ว deploy: supabase functions deploy chat-ai` });
    }

    // ================= ปุ่มซิงก์: ดึงข้อมูลลูกค้าอย่างเดียว (ไม่ใช้ AI) =================
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token (ตั้งได้ในหน้าตั้งค่า)");
    const pagesData = await getMetaPages(base, token, { mustIncludePageId: onlyPage || undefined });
    if (pagesData?.error) throw new Error(pagesData.error.message || "ดึงรายชื่อเพจไม่สำเร็จ (ต้องมีสิทธิ์ pages_show_list/pages_messaging)");
    let pages = (pagesData?.data ?? []).filter((p: any) => p.access_token);
    if (onlyPage) pages = pages.filter((p: any) => p.id === onlyPage);
    else pages = pages.filter((p: any) => enabledMap[p.id] !== false);
    if (pages.length === 0) throw new Error("ไม่มีเพจให้ซิงก์ (เช็คสิทธิ์ หรือเปิดเพจในตั้งค่า)");

    // อ่าน 1 หน้าผลลัพธ์และ upsert โดยไม่สกัดข้อมูลลูกค้าจากข้อความ
    async function processBatch(page: any, convs: any[], _aiOn: boolean): Promise<{ upserted: number; worked: number }> {
      const rows: any[] = [];
      for (const c of convs) {
        const participants = c.participants?.data ?? [];
        const customer = participants.find((p: any) => p.id !== page.id) || {};
        const msgs = (c.messages?.data ?? []) as any[];
        // ลูกค้า = เฉพาะข้อความที่ "ไม่ได้มาจากเพจ" เท่านั้น
        // (กันเผลอสกัดเบอร์/ไอดีจากข้อความหรือออโต้รีพลายของเพจเอง เมื่อระบุตัวลูกค้าไม่ได้ — เดิม fallback ไปใช้เพจเป็น "ลูกค้า")
        const userMsgs = msgs.filter((m) => m.from?.id && m.from.id !== page.id);
        const userTexts = userMsgs.map((m) => m.message).filter(Boolean);
        const lastAt = c.updated_time || msgs[0]?.created_time || null;
        // เก็บบทสนทนา (ทั้งสองฝั่ง) ไว้ให้กดดูรายคนได้ว่าดึงอะไรมาวิเคราะห์ — เรียงเก่า→ใหม่, จำกัดความยาว
        // รวม "สื่อ" (รูป/วิดีโอ/ไฟล์) ด้วย — เดิมกรองทิ้งเพราะไม่มี message ทำให้รูปที่ webhook เก็บไว้หายทุกครั้งที่ซิงก์ทับ
        // และเก็บ mid (message id) ให้ตรงกับ webhook — ใช้กันข้อความเบิ้ลตอน echo
        const transcript = msgs
          .filter((m) => m.message || m.attachments?.data?.length || m.sticker)
          .slice(0, 60)
          .map((m) => {
            const att = (m.attachments?.data ?? [])[0];
            const mt = String(att?.mime_type || "");
            // สติกเกอร์: conversations API ส่งมาเป็น field "sticker" (url) หรือ attachment ที่ image_data ชี้ CDN สติกเกอร์
            const isSticker = !!m.sticker || /facebook.*sticker|stickers/i.test(String(att?.image_data?.url || ""));
            const label = isSticker ? "[สติกเกอร์]" : !att ? "" : mt.startsWith("image") ? "[รูปภาพ]" : mt.startsWith("video") ? "[วิดีโอ]" : mt.startsWith("audio") ? "[เสียง]" : "[ไฟล์]";
            const isPage = m.from?.id === page.id;
            const e: any = { w: isPage ? "p" : "u", t: transcriptText(m.message) || label || "[สื่อ]", at: m.created_time || null };
            // เลือก URL รูป: เลี่ยงตัวที่มี stp=dst-jpg (Facebook แปลงเป็น JPG พื้นขาว) — เอาตัวโปร่งใสก่อน
            const cands = [m.sticker, att?.image_data?.url, att?.image_data?.preview_url, att?.video_data?.url].filter(Boolean) as string[];
            const img = cands.find((u) => !/dst-jpg/.test(u)) || cands[0] || null;
            if (img) { e.img = img; e.img_source = "sync"; }
            if (isSticker) e.sticker = true;
            if (m.id) e.mid = m.id;
            // ชื่อแอดมินที่ตอบ — ถ้า from.name มีและไม่ใช่ชื่อเพจ (บางเพจ Graph ส่งชื่อแอดมินจริงมา)
            if (isPage && m.from?.name && m.from.name !== page.name) e.by_name = m.from.name;
            return e;
          })
          .reverse();
        // ข้อความล่าสุดฝั่งเพจ — ไว้โชว์บนป้ายชื่อซ้าย (ข้อ 3)
        const lastPageMsg = [...transcript].reverse().find((m: any) => m.w === "p");
        rows.push({
          id: c.id, page_id: page.id, page_name: page.name,
          psid: customer.id ?? null, customer_name: safeShort(customer.name, 300),
          message_count: c.message_count ?? msgs.length, user_message_count: userMsgs.length,
          phone: null, trade_id: null, username: null, email: null,
          last_user_text: safeShort(userTexts[0], 300),
          last_reply_text: lastPageMsg ? safeShort(lastPageMsg.t, 300) : null,
          last_reply_by: lastPageMsg?.by_name ?? null,
          last_reply_at: lastPageMsg?.at ?? null,
          last_message_at: lastAt, transcript,
          stage_auto: "new", classified_by: "manual", ai_reason: null, ai_hash: null,
          _unread_count: typeof c.unread_count === "number" ? c.unread_count : undefined,
        });
      }
      if (!rows.length) return { upserted: 0, worked: 0 };
      const ids = rows.map((r) => r.id);
      const manualMap: Record<string, string> = {};
      const prevMap: Record<string, any> = {};
      const { data: existing } = await admin.from("chat_customers").select("id, stage_manual, stage_auto, ai_hash, ai_reason, classified_by, phone, trade_id, username, email, ai_verified, verify_hash, content_hash, source, entry_ad_id, unread, read_at, ai_attempts, verify_attempts, manual_data, transcript, country, cust_lang").in("id", ids);
      for (const e of existing ?? []) { if (e.stage_manual) manualMap[e.id] = e.stage_manual; prevMap[e.id] = e; }

      // รวม transcript โดยใช้ mid เป็นตัวเดียวกัน แต่เลือก URL ให้ถูกชนิดสื่อ
      // - สติกเกอร์: ใช้ URL จาก Conversations API (m.sticker) เพราะเป็นไฟล์โปร่งใส
      // - รูป/วิดีโอทั่วไป: ให้ URL จาก webhook ชนะ เพื่อคงรูปแบบ real-time เดิม
      for (const r of rows) {
        const prevTr = Array.isArray(prevMap[r.id]?.transcript) ? prevMap[r.id].transcript : null;
        if (!prevTr || !Array.isArray(r.transcript)) continue;
        const previousByMid: Record<string, any> = {};
        for (const pm of prevTr) {
          if (pm?.mid) previousByMid[String(pm.mid)] = pm;
        }
        for (const it of r.transcript) {
          if (!it?.mid) continue;
          const old = previousByMid[String(it.mid)];
          if (!old) continue;

          // คง metadata ที่แอปบันทึกไว้ตอนส่ง โดยเฉพาะ th = ต้นฉบับภาษาไทยของแอดมิน
          // Conversations API คืนเฉพาะข้อความปลายทาง จึงสร้างข้อมูลเหล่านี้กลับมาเองไม่ได้
          if (typeof old.th === "string" && old.th.trim()) it.th = old.th;
          if (old.by) it.by = old.by;
          if (old.by_name && !it.by_name) it.by_name = old.by_name;
          if (old.via) it.via = old.via;

          const isSticker = !!it.sticker || !!old.sticker || it.t === "[สติกเกอร์]" || old.t === "[สติกเกอร์]";
          if (isSticker) {
            it.sticker = true;
            // เลือก URL สติกเกอร์ที่ "โปร่งใส" (ไม่มี stp=dst-jpg) ระหว่างของ sync (ใหม่) กับ webhook (เดิม)
            // สำคัญ: webhook (payload.url) มักเป็น PNG โปร่งใส ห้ามให้ sync (image_data dst-jpg พื้นขาว) เขียนทับ
            const clean = [it.img, old.img].find((u) => u && !/dst-jpg/.test(String(u)));
            if (clean) it.img = clean;
            else if (old.img) it.img = old.img;   // ทั้งคู่ไม่โปร่งใส → คงของเดิมไว้
          } else if (old.img_source === "webhook" && old.img) {
            it.img = old.img;
            it.img_source = "webhook";
          }
        }
      }

      // join referral (มาจากแอดไหน) จาก webhook — คีย์ (page_id, psid)
      const psids = [...new Set(rows.map((r) => r.psid).filter(Boolean))];
      const refMap: Record<string, any> = {};
      if (psids.length) {
        const { data: refs } = await admin.from("chat_referrals").select("psid, ad_id, source").eq("page_id", page.id).in("psid", psids);
        for (const rf of refs ?? []) refMap[rf.psid] = rf;
      }

      // คงข้อมูลและสถานะเดิมไว้; ซิงก์ข้อความห้ามเติมช่องข้อมูลลูกค้า
      for (const r of rows) {
        const prev = prevMap[r.id];
        if (!prev) continue;
        r.phone = r.phone || prev.phone || null;
        r.trade_id = r.trade_id || prev.trade_id || null;
        r.username = r.username || prev.username || null;
        r.email = r.email || prev.email || null;
        r.stage_auto = prev.stage_auto || "new";
        r.classified_by = prev.classified_by || r.classified_by;
        r.ai_reason = prev.ai_reason ?? null;
      }

      const now = new Date().toISOString();
      const payload = rows.map((r) => {
        const prev = prevMap[r.id];
        const manualData = prev?.manual_data === true;   // แอดมินป้อนข้อมูลติดต่อเอง = ล็อก ห้ามซิงก์ทับ
        const isManual = !!manualMap[r.id];
        const ch = contentHashOf(r.transcript);                    // hash เนื้อหาแชทปัจจุบัน
        const refRow = r.psid ? refMap[r.psid] : null;
        const stageAuto = prev?.stage_auto || r.stage_auto || "new";
        const classifiedBy = prev?.classified_by || r.classified_by || "manual";
        const aiReason = prev?.ai_reason ?? null;
        const finalStage = isManual ? manualMap[r.id] : stageAuto;
        const awaitingReply = Array.isArray(r.transcript) && r.transcript.length > 0 && r.transcript[r.transcript.length - 1]?.w === "u";
        const originGuess = prev?.country ? null : guessOriginFromScript(String(r.last_user_text || ""));
        return {
          id: r.id, page_id: r.page_id, page_name: r.page_name, psid: r.psid, customer_name: r.customer_name,
          message_count: r.message_count, user_message_count: r.user_message_count,
          phone: manualData ? (prev?.phone ?? null) : r.phone, trade_id: manualData ? (prev?.trade_id ?? null) : r.trade_id, username: manualData ? (prev?.username ?? null) : r.username, email: manualData ? (prev?.email ?? null) : r.email,
          last_user_text: r.last_user_text, last_reply_text: r.last_reply_text, last_reply_by: r.last_reply_by, last_reply_at: r.last_reply_at,
          last_message_at: r.last_message_at, transcript: r.transcript,
          stage_auto: stageAuto, stage: finalStage,
          classified_by: classifiedBy, ai_reason: aiReason,
          ai_hash: prev?.ai_hash ?? null, ai_verified: prev?.ai_verified === true, verify_hash: prev?.verify_hash ?? null,
          content_hash: ch, needs_ai: false, needs_verify: false,
          ai_attempts: prev?.ai_attempts ?? 0, verify_attempts: prev?.verify_attempts ?? 0,
          // มาจากแอดไหน — ใช้ referral จาก webhook ถ้ามี ไม่งั้นคงค่าเดิม
          source: refRow || prev?.entry_ad_id ? "ad" : (prev?.source ?? null),
          entry_ad_id: refRow?.ad_id ?? prev?.entry_ad_id ?? null,
          // ยังไม่ได้ตอบ = ข้อความล่าสุดใน transcript มาจากลูกค้า (w === "u")
          awaiting_reply: awaitingReply,
          // ค่าที่มีอยู่แล้วชนะเสมอ (มาจากตัวแปล AI ตอนเปิดแชท ซึ่งแม่นกว่าการเดาจากสคริปต์)
          country: prev?.country ?? originGuess?.country ?? null,
          cust_lang: prev?.cust_lang ?? originGuess?.lang ?? null,
          // ไม่ส่ง unread มากับ upsert เลย — จัดการหลัง upsert แบบมีการ์ดแทน
          // (upsert อ่าน prev.read_at มาก่อนหน้านี้หลายวินาที ถ้าแอดมินเพิ่งอ่าน/ตอบระหว่างนั้นจะถูกทับกลับเป็นยังไม่อ่าน)
          // ห้ามใส่แบบมีบ้างไม่มีบ้างในชุดเดียวกัน: PostgREST รวมคอลัมน์จากทุกออบเจกต์แล้วเติม NULL
          // ให้ตัวที่ไม่มีคีย์ → แถวใหม่ 1 แถวทำให้ทั้ง batch ล้มด้วย 23502 (unread เป็น NOT NULL)
          // แถวใหม่ที่ไม่ส่งคอลัมน์นี้เลยจะได้ค่า default false แล้วรอบล่างค่อยยกธงให้
          synced_at: now, updated_at: now,
        };
      });
      const { error } = await admin.from("chat_customers").upsert(payload, { onConflict: "id" });
      if (error) throw error;
      // ---- สถานะอ่าน/ยังไม่อ่านของแถวเดิม: อัปเดตแยกจาก upsert และอ่าน read_at สด ๆ ก่อนตัดสิน ----
      // Meta บอกได้แค่ว่า "กล่องข้อความเพจ" อ่านหรือยัง (unread_count) จึงใช้ปิดจุดแดงได้ แต่ห้ามใช้เปิดเอง
      // รวมแถวใหม่ด้วย (เพิ่งถูก insert ด้วยค่า default unread=false) — การ์ด .eq("unread", ...) กันเขียนซ้ำอยู่แล้ว
      const metaReadIds = rows.filter((r) => r._unread_count === 0).map((r) => r.id);
      const metaUnreadIds = rows.filter((r) => (r._unread_count ?? 0) > 0).map((r) => r.id);
      if (metaReadIds.length) {
        await admin.from("chat_customers").update({ unread: false, read_at: now, updated_at: now })
          .in("id", metaReadIds).eq("unread", true);
      }
      if (metaUnreadIds.length) {
        const { data: fresh } = await admin.from("chat_customers")
          .select("id, read_at, last_message_at, last_reply_at, awaiting_reply").in("id", metaUnreadIds).eq("unread", false);
        const toFlag = (fresh ?? []).filter((c: any) => shouldFlagUnread(c)).map((c: any) => c.id);
        if (toFlag.length) {
          await admin.from("chat_customers").update({ unread: true, updated_at: new Date().toISOString() })
            .in("id", toFlag).eq("unread", false);
        }
      }
      // worked = รายที่เนื้อหาเปลี่ยน (มีอะไรให้ทำต่อ) — ใช้เติมโควตา perPage
      const worked = rows.filter((r) => prevMap[r.id]?.content_hash !== contentHashOf(r.transcript)).length;
      return { upserted: payload.length, worked };
    }

    const fieldsQ = `id,updated_time,message_count,unread_count,participants,messages.limit(${msgLimit}){id,message,from,created_time,sticker,attachments{mime_type,name,image_data,video_data,file_url}}`;
    const buildUrl = (page: any) => `${base}/${page.id}/conversations?platform=messenger&fields=${encodeURIComponent(fieldsQ)}&limit=100&access_token=${page.access_token}`;

    // อัปเดตรายชื่อเพจใน config (ไม่ทับของเดิม)
    const uniquePages = [...new Map(pages.map((p: any) => [p.id, p.name])).entries()].map(([id, name]) => ({ page_id: id, page_name: name }));
    if (uniquePages.length) await admin.from("page_lead_config").upsert(uniquePages, { onConflict: "page_id", ignoreDuplicates: true });

    // ---- โหมดดึงย้อนหลังเพจเดียวแบบทยอย (resume ด้วย cursor) ----
    // next_after = "cursor" เปล่าๆ เท่านั้น — เดิมส่ง URL เต็มที่ฝัง access_token ของเพจกลับไปหน้าเว็บ (token รั่วให้ผู้ใช้ทุกคนเห็น)
    if (full && onlyPage) {
      const page = pages[0];
      // รองรับ cursor แบบเก่า (URL เต็ม) ที่อาจค้างอยู่ฝั่ง frontend — แกะเอาเฉพาะค่า after
      let cursor: string | null = null;
      if (after) {
        if (after.startsWith("http")) { try { cursor = new URL(after).searchParams.get("after"); } catch { cursor = null; } }
        else cursor = after;
      }
      const urlFor = (cur: string | null) => buildUrl(page) + (cur ? `&after=${encodeURIComponent(cur)}` : "");
      let processed = 0;
      let skippedOld = 0;
      let done = false;
      for (let i = 0; i < MAX_LOOPS_PER_CALL; i++) {
        const data = await fetchJson(urlFor(cursor));
        if (data?.error) {
          // โดน Meta rate limit (app/page/user) — ไม่ error ดิบ ให้หยุดพักแล้ว resume จาก cursor เดิมได้
          if (RATE_LIMIT_CODES.has(Number(data.error.code))) {
            return new Response(JSON.stringify({ ok: true, full: true, page: page.name, processed, skipped_old: skippedOld, next_after: cursor, done: false, rate_limited: true }), { headers: { ...corsHeaders, "content-type": "application/json" } });
          }
          return new Response(JSON.stringify({ ok: false, error: `[${page.name}] ${data.error.message || data.error}` }), { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } });
        }
        const batchAll = (data?.data ?? []) as any[];
        // Meta คืน conversations เรียงตาม updated_time ใหม่→เก่า
        // เมื่อเจอหน้าที่ "ไม่มีแชทใหม่กว่ายอดเลย" = ที่เหลือเก่ากว่าทั้งหมด หยุดได้เลย ไม่ต้องไล่ต่อ
        // นี่คือจุดที่ประหยัดโควตาที่สุด ไม่ใช่แค่กรองทิ้งหลังดึงมาแล้ว
        const batch = sinceMs
          ? batchAll.filter((c: any) => {
              const t = c?.updated_time ? new Date(c.updated_time).getTime() : NaN;
              return Number.isNaN(t) ? true : t >= sinceMs;
            })
          : batchAll;
        const rb = await processBatch(page, batch, false);
        processed += rb.upserted;
        if (sinceMs && batchAll.length > 0 && batch.length === 0) {
          skippedOld += batchAll.length;
          done = true; cursor = null; break;
        }
        skippedOld += batchAll.length - batch.length;
        if (!data?.paging?.next) { done = true; cursor = null; break; }
        cursor = data?.paging?.cursors?.after ?? null;
        if (!cursor) { done = true; break; }
        if (Date.now() > aiDeadline) break;
      }
      return new Response(JSON.stringify({ ok: true, full: true, page: page.name, processed, skipped_old: skippedOld, next_after: done ? null : cursor, done }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    // ================= ซิงก์ "แชทล่าสุด" แบบเบา: 1 คำขอ/เพจ =================
    // Meta ส่ง webhook ข้อความของลูกค้าทั่วไปให้ไม่ได้จนกว่าแอปจะได้ Advanced Access ของ pages_messaging
    // (ตอนนี้ push เฉพาะคนที่มี role ในแอป) แชทใหม่จึงเข้าระบบได้ทางเดียวคือ "ดึงเอง"
    // cron ทุก 15 นาทีช้าเกินสำหรับกล่องตอบแชท จ็อบนี้ให้หน้าเว็บเรียกได้ทุก ~30 วิ
    // ดึงแค่ 25 ห้องที่ขยับล่าสุด และ upsert เฉพาะห้องที่ updated_time ใหม่กว่าที่เก็บไว้ (กัน WAL/realtime เด้งฟรี)
    if (job === "recent") {
      const guard = await getMetaBackgroundGuard(admin);
      if (guard.blocked) return jsonResp({ ok: true, job, upserted: 0, changed: 0, skipped: "rate_guard" });
      let recentPages = pages;
      if (!auth.isService && auth.permission?.role !== "admin") {
        recentPages = recentPages.filter((p: any) => auth.permission?.allowedPages.includes(String(p.id)));
      }
      if (!recentPages.length) return jsonResp({ ok: true, job, upserted: 0, changed: 0, skipped: "no_pages" });
      const { data: recentState } = await admin.from("settings").select("value").eq("key", RECENT_STATE_KEY).maybeSingle();
      const recentBy = (recentState?.value?.last_by_page && typeof recentState.value.last_by_page === "object")
        ? recentState.value.last_by_page : {};
      const due = recentPages.filter((p: any) => Date.now() - new Date(recentBy[String(p.id)] || 0).getTime() >= RECENT_COOLDOWN_MS);
      if (!due.length) return jsonResp({ ok: true, job, upserted: 0, changed: 0, skipped: "cooldown" });
      const claimedAt = new Date().toISOString();
      for (const p of due) recentBy[String(p.id)] = claimedAt;
      // จับคิวก่อนยิง Meta — เครื่องอื่นที่เข้ามาพร้อมกันจะเห็นว่าเพจนี้มีคนดึงอยู่แล้ว
      await admin.from("settings").upsert({ key: RECENT_STATE_KEY, value: { last_by_page: recentBy }, updated_at: claimedAt });
      let recentUpserted = 0;
      let recentChanged = 0;
      const recentErrors: { page: string; error: string }[] = [];
      for (const page of due) {
        const url = `${base}/${page.id}/conversations?platform=messenger&fields=${encodeURIComponent(fieldsQ)}&limit=${RECENT_LIMIT}&access_token=${page.access_token}`;
        const data = await fetchJson(url, 2);
        if (data?.error) { recentErrors.push({ page: page.name, error: data.error.message || String(data.error) }); continue; }
        const convs = (data?.data ?? []) as any[];
        if (!convs.length) continue;
        const { data: known } = await admin.from("chat_customers").select("id, last_message_at").in("id", convs.map((c: any) => String(c.id)));
        const knownAt = new Map((known ?? []).map((r: any) => [String(r.id), timeMs(r.last_message_at)]));
        const fresh = convs.filter((c: any) => {
          const prev = knownAt.get(String(c.id));
          if (prev === undefined) return true;                     // ห้องใหม่ที่ยังไม่มีในฐานข้อมูล
          const at = timeMs(c.updated_time);
          return !at || at > prev;                                 // มีความเคลื่อนไหวใหม่กว่าที่เก็บไว้
        });
        if (!fresh.length) continue;
        const rb = await processBatch(page, fresh, false);
        recentUpserted += rb.upserted;
        recentChanged += rb.worked;
      }
      return jsonResp({ ok: recentErrors.length === 0, job, pages: due.length, upserted: recentUpserted, changed: recentChanged, errors: recentErrors });
    }

    // ---- โหมดปกติ: ทุกเพจที่เปิด ดึงจนได้ "งานที่ต้องทำ" ครบ per_page ----
    // นับเฉพาะรายที่ยังต้องทำงาน (ข้ามคนที่ verified/frozen หรือไม่มีข้อความใหม่) แล้วดึงลึกต่อเพื่อเติมให้ครบ
    let convCount = 0;
    const pageErrors: { page: string; error: string }[] = [];
    const pageStats: { page: string; page_id: string; conversations: number; error: string | null }[] = []; // สรุปรายเพจ (โชว์ให้เห็นทุกเพจ)
    const CONV_CAP = 300; // เพดานจำนวนแชทที่ประมวลผลต่อการเรียก 1 ครั้ง — กัน compute limit (ที่เหลือ frontend ทำต่อ)
    for (const page of pages) {
      let url = buildUrl(page);
      let worked = 0, seen = 0, pageConv = 0, pageErr: string | null = null;
      for (let loop = 0; loop < 30 && url; loop++) {
        if (Date.now() > aiDeadline || seen >= CONV_CAP) { stoppedEarly = true; break; }
        const data = await fetchJson(url);
        if (data?.error) { pageErr = data.error.message || String(data.error); pageErrors.push({ page: page.name, error: pageErr }); break; }
        const batch = data?.data ?? [];
        seen += batch.length;
        const rb = await processBatch(page, batch, false);
        convCount += rb.upserted;
        pageConv += rb.upserted;
        worked += rb.worked;
        url = data?.paging?.next ?? "";
        if (worked >= perPage) break; // เติม "งานที่ต้องทำ" ครบโควตาแล้ว
      }
      // piggyback: ดึงโฟลเดอร์สแปมของเพจ (1 คำขอ) → บล็อกแชทที่แอดมินกดสแปมจากฝั่งเพจให้อัตโนมัติ
      // (ถูกมาก ~1 call/เพจ/รอบ · ไม่ auto-unblock — ปลดเองได้จากแอป)
      try {
        const spamRes = await fetch(`${base}/${page.id}/conversations?folder=spam&fields=participants.limit(10){id}&limit=100&access_token=${page.access_token}`);
        await recordMetaUsage(admin, spamRes, "spam_folder_poll");
        const spamData = await spamRes.json().catch(() => ({}));
        const spamPsids = [...new Set((spamData?.data ?? []).map((c: any) =>
          (c?.participants?.data ?? []).find((p: any) => String(p?.id || "") !== String(page.id))?.id,
        ).filter(Boolean).map(String))];
        if (spamPsids.length) {
          const nowIso = new Date().toISOString();
          await admin.from("chat_customers")
            .update({ blocked_at: nowIso, blocked_by: "spam-folder", updated_at: nowIso })
            .eq("page_id", page.id).in("psid", spamPsids).is("blocked_at", null);
        }
      } catch (_e) { /* spam poll พลาดไม่กระทบการซิงก์หลัก */ }
      pageStats.push({ page: page.name, page_id: page.id, conversations: pageConv, error: pageErr });
    }

    return new Response(JSON.stringify({ ok: true, pages: pages.length, conversations: convCount, upserted: convCount, pages_with_error: pageErrors.length, errors: pageErrors.slice(0, 5), page_stats: pageStats, done: !stoppedEarly }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
