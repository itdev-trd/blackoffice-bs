// Safety net สำหรับ Instagram DM: ดึงเฉพาะบทสนทนาล่าสุดเมื่อ webhook IG ไม่ส่ง event เข้ามา
// Webhook ยังเป็นทางหลัก; ฟังก์ชันนี้มี shared cooldown ต่อเพจและหยุดเองเมื่อ webhook ของเพจนั้นยังปกติ

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest, canAccessPage } from "../_shared/permissions.ts";
import { getMetaBackgroundGuard, recordMetaUsage } from "../_shared/meta-rate.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const STATE_KEY = "instagram_recent_fallback_sync";
const COOLDOWN_MS = 10 * 60 * 1000;
const WEBHOOK_HEALTH_MS = 15 * 60 * 1000;
const MAX_TRANSCRIPT_TEXT = 10_000;
const transcriptText = (value: unknown) => String(value || "").slice(0, MAX_TRANSCRIPT_TEXT);
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

const mediaLabel = (att: any, sticker: unknown) => sticker ? "[สติกเกอร์]"
  : String(att?.mime_type || "").startsWith("image") ? "[รูปภาพ]"
  : String(att?.mime_type || "").startsWith("video") ? "[วิดีโอ]"
  : String(att?.mime_type || "").startsWith("audio") ? "[เสียง]" : "[ไฟล์]";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"] });
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
    const fields = "id,updated_time,message_count,unread_count,participants,messages.limit(30){id,message,from,created_time,sticker,attachments{mime_type,name,image_data,video_data,file_url}}";
    for (const page of pages) {
      const pageId = String(page.id);
      const igId = String(page.instagram_business_account.id);
      const response = await fetch(`${GRAPH_BASE}/${pageId}/conversations?platform=instagram&fields=${encodeURIComponent(fields)}&limit=25&access_token=${page.access_token}`);
      await recordMetaUsage(admin, response, "instagram_recent_fallback");
      const result = await response.json().catch(() => ({}));
      if (result?.error) { errors.push({ page_id: pageId, error: result.error.error_user_msg || result.error.message || "Meta error" }); continue; }
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
        const unread = (Number(conv.unread_count) || 0) > 0 && (!existing?.read_at || new Date(lastAt).getTime() > new Date(existing.read_at).getTime());
        const awaitingReply = transcript[transcript.length - 1]?.w === "u";
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
