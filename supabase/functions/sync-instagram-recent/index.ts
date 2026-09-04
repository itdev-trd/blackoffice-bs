// Safety net สำหรับ Instagram DM: ดึงเฉพาะบทสนทนาล่าสุดเมื่อ webhook IG ไม่ส่ง event เข้ามา
// Webhook ยังเป็นทางหลัก; ฟังก์ชันนี้มี shared cooldown ต่อเพจและหยุดเองเมื่อ webhook ของเพจนั้นยังปกติ

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest, canAccessPage } from "../_shared/permissions.ts";
import { getMetaBackgroundGuard, recordMetaUsage } from "../_shared/meta-rate.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const STATE_KEY = "instagram_recent_fallback_sync";
const ERROR_KEY = "instagram_recent_fallback_error";
const COOLDOWN_MS = 10 * 60 * 1000;
const WEBHOOK_HEALTH_MS = 15 * 60 * 1000;
const MAX_TRANSCRIPT_TEXT = 10_000;
const transcriptText = (value: unknown) => String(value || "").slice(0, MAX_TRANSCRIPT_TEXT);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

const timeMs = (v: unknown) => {
  const t = v ? new Date(String(v)).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
};
const mediaLabel = (att: any, sticker: unknown) => sticker ? "[สติกเกอร์]"
  : String(att?.mime_type || "").startsWith("image") ? "[รูปภาพ]"
  : String(att?.mime_type || "").startsWith("video") ? "[วิดีโอ]"
  : String(att?.mime_type || "").startsWith("audio") ? "[เสียง]" : "[ไฟล์]";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // allowService = ให้ cron/service เรียกได้ด้วย ไม่ใช่แค่ตอนมีคนเปิดหน้าตอบแชท
    // (เดิมคำขอจาก service role ถูกตอบ 401 ทำให้เอาไปตั้ง cron ไม่ได้เลย)
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"], allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    const requested = [...new Set((Array.isArray(body?.page_ids) ? body.page_ids : []).map(String).filter(Boolean))];
    if (auth.permission && requested.some((id) => !canAccessPage(auth.permission!, id))) return json({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงเพจนี้" }, 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await getMetaBackgroundGuard(admin);
    if (guard.blocked) return json({ ok: true, upserted: 0, skipped: "rate_guard" });
    const token = await getMetaToken();
    if (!token) return json({ ok: false, error: "ยังไม่ได้ตั้งค่า Meta access token" });
    const pagesData = await getMetaPages(GRAPH_BASE, token);
    let pages = (pagesData?.data ?? []).filter((p: any) => p.access_token && p.instagram_business_account?.id);
    if (requested.length) pages = pages.filter((p: any) => requested.includes(String(p.id)));
    if (auth.permission && auth.permission.role !== "admin") pages = pages.filter((p: any) => canAccessPage(auth.permission!, String(p.id)));
    if (!pages.length) return json({ ok: true, upserted: 0, skipped: "no_instagram_pages" });

    // เดิมข้ามเพจที่ webhook "ปกติ" (มี event ล่าสุด) เพื่อประหยัด API — แต่ IG webhook ส่งเฉพาะข้อความจากบัญชีที่มี
    // role ในแอป (บัญชีทดสอบ) ลูกค้าจริงไม่ push มา ทำให้แชทลูกค้าจริงหลุด → เปลี่ยนเป็น poll สม่ำเสมอ (จำกัดด้วย cooldown)
    const { data: stateRow } = await admin.from("settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const state = stateRow?.value || {};
    const lastByPage = state.last_by_page && typeof state.last_by_page === "object" ? state.last_by_page : {};
    pages = pages.filter((p: any) => Date.now() - new Date(lastByPage[String(p.id)] || 0).getTime() >= COOLDOWN_MS);
    if (!pages.length) return json({ ok: true, upserted: 0, skipped: "cooldown" });
    const checkedAt = new Date().toISOString();
    for (const page of pages) lastByPage[String(page.id)] = checkedAt;
    await admin.from("settings").upsert({ key: STATE_KEY, value: { last_by_page: lastByPage }, updated_at: checkedAt });

    let upserted = 0;
    const errors: Array<{ page_id: string; error: string }> = [];
    const fieldsFull = "id,updated_time,message_count,unread_count,participants,messages.limit(30){id,message,from,created_time,sticker,attachments{mime_type,name,image_data,video_data,file_url}}";
    // ชุดเบา: ใช้ลองซ้ำเมื่อ Meta ตอบ "reduce the amount of data" (code 1) หรือ query timeout (code -2)
    const fieldsLite = "id,updated_time,message_count,unread_count,participants,messages.limit(10){id,message,from,created_time,sticker}";
    const attempts: Array<{ fields: string; limit: number }> = [
      { fields: fieldsFull, limit: 25 },
      { fields: fieldsLite, limit: 8 },
      { fields: fieldsLite, limit: 3 },
    ];
    for (const page of pages) {
      const pageId = String(page.id);
      const igId = String(page.instagram_business_account.id);
      let result: any = {};
      for (const attempt of attempts) {
        const response = await fetch(`${GRAPH_BASE}/${pageId}/conversations?platform=instagram&fields=${encodeURIComponent(attempt.fields)}&limit=${attempt.limit}&access_token=${page.access_token}`);
        await recordMetaUsage(admin, response, "instagram_recent_fallback");
        result = await response.json().catch(() => ({}));
        // code 1 = ขอข้อมูลหนักเกิน · code -2/subcode 2534084 = query timeout เพราะสิทธิ์ instagram_manage_messages
        // ยังเป็น Standard Access (Meta เสิร์ฟได้แค่ห้องของผู้ใช้ที่มี role ในแอป) → ลองชุดที่เบากว่า
        const code = Number(result?.error?.code);
        if (!result?.error || (code !== 1 && code !== -2)) break;
      }
      if (result?.error) {
        const detail = result.error.error_user_msg || result.error.message || "Meta error";
        errors.push({ page_id: pageId, error: detail });
        // เก็บ error ล่าสุดไว้ให้หน้าเว็บ/หน้าตั้งค่าอ่านได้ — เดิมพังเงียบทุกรอบจนดูเหมือน "IG ไม่มีแชท"
        await admin.from("settings").upsert({
          key: ERROR_KEY,
          value: { at: new Date().toISOString(), page_id: pageId, code: result.error.code ?? null, subcode: result.error.error_subcode ?? null, error: detail },
          updated_at: new Date().toISOString(),
        });
        continue;
      }
      await admin.from("settings").upsert({ key: ERROR_KEY, value: { at: new Date().toISOString(), page_id: pageId, error: null }, updated_at: new Date().toISOString() });
      const convs = result?.data ?? [];
      const psids = [...new Set(convs.map((c: any) =>
        (c?.participants?.data ?? []).find((p: any) => ![pageId, igId].includes(String(p?.id || "")))?.id,
      ).filter(Boolean).map(String))];
      const { data: existingRows } = psids.length
        ? await admin.from("chat_customers").select("id,psid,customer_name,read_at,last_message_at,stage,stage_auto,stage_manual,classified_by,transcript").eq("page_id", pageId).eq("source", "instagram").in("psid", psids)
        : { data: [] as any[] };
      const existingByPsid = new Map((existingRows ?? []).map((r: any) => [String(r.psid), r]));

      for (const conv of convs) {
        const participants = conv?.participants?.data ?? [];
        const customer = participants.find((p: any) => ![pageId, igId].includes(String(p?.id || "")));
        const psid = customer?.id ? String(customer.id) : "";
        if (!psid) continue;
        const existing: any = existingByPsid.get(psid);
        const messages = (conv?.messages?.data ?? []) as any[];
        const transcript = messages.filter((m: any) => m.message || m.sticker || m.attachments?.data?.length).slice(0, 60).map((m: any) => {
          const isPage = [pageId, igId].includes(String(m?.from?.id || ""));
          const att = m?.attachments?.data?.[0];
          const label = att || m.sticker ? mediaLabel(att, m.sticker) : "[สื่อ]";
          const item: any = { w: isPage ? "p" : "u", t: transcriptText(m.message) || label, at: m.created_time || null, via: "instagram" };
          const img = m.sticker || att?.image_data?.url || att?.image_data?.preview_url || att?.video_data?.url || null;
          if (img) item.img = img;
          if (m.sticker) item.sticker = true;
          if (m.id) item.mid = m.id;
          return item;
        }).reverse();
        if (!transcript.length) continue;
        const lastAt = conv.updated_time || transcript[transcript.length - 1]?.at || checkedAt;
        const lastUser = [...transcript].reverse().find((m: any) => m.w === "u");
        const lastPage = [...transcript].reverse().find((m: any) => m.w === "p");
        const awaitingReply = transcript[transcript.length - 1]?.w === "u";
        // ยังไม่อ่าน = มีข้อความลูกค้าค้างรอตอบ ที่ใหม่กว่าเวลาที่เราอ่าน/ตอบล่าสุด
        // ห้ามเทียบกับ conv.updated_time เพราะขยับตอน "เพจตอบ" ด้วย → ตอบเสร็จแล้วเด้งกลับเป็นยังไม่อ่าน
        const inboundAt = timeMs(lastUser?.at) || (awaitingReply ? timeMs(lastAt) : 0);
        const seenAt = timeMs(existing?.read_at) || timeMs(lastPage?.at);
        const unread = (Number(conv.unread_count) || 0) > 0 && awaitingReply && inboundAt > seenAt;
        const hasNewContent = !existing?.last_message_at || new Date(lastAt).getTime() > new Date(existing.last_message_at).getTime();
        const common = {
          source: "instagram", page_id: pageId, page_name: page.name || page.instagram_business_account?.username || null,
          psid, customer_name: customer?.name || customer?.username || existing?.customer_name || "Instagram user",
          transcript, message_count: conv.message_count ?? transcript.length,
          user_message_count: transcript.filter((m: any) => m.w === "u").length,
          last_user_text: lastUser?.t || null, last_reply_text: lastPage?.t || null, last_reply_at: lastPage?.at || null,
          last_message_at: lastAt, awaiting_reply: awaitingReply, unread,
          ...(hasNewContent && awaitingReply ? { needs_ai: true, needs_verify: true } : {}),
          synced_at: checkedAt, updated_at: checkedAt,
        };
        if (existing?.id) {
          const { error } = await admin.from("chat_customers").update(common).eq("id", existing.id);
          if (!error) upserted++;
        } else {
          const { error } = await admin.from("chat_customers").insert({
            id: `ig_${igId}_${psid}`, ...common, stage: "new", stage_auto: "new", classified_by: "pending",
          });
          if (!error) upserted++;
        }
      }
    }
    return json({ ok: errors.length === 0, upserted, checked_pages: pages.length, errors });
  } catch (error) {
    return json({ ok: false, error: String(error instanceof Error ? error.message : error) }, 200);
  }
});
