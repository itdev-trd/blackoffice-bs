import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getLineConfig, lineApi } from "../_shared/line.ts";

const enc = new TextEncoder();
const LINE_INGEST_ENABLED = true;
async function verifySignature(raw: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  let binary = "";
  for (const byte of signed) binary += String.fromCharCode(byte);
  const expected = btoa(binary);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const labelOf = (message: any) => {
  if (message?.type === "text") return String(message.text || "");
  if (message?.type === "image") return "[รูปภาพ]";
  if (message?.type === "video") return "[วิดีโอ]";
  if (message?.type === "audio") return "[เสียง]";
  if (message?.type === "file") return `[ไฟล์: ${message.fileName || "attachment"}]`;
  if (message?.type === "sticker") return "[สติกเกอร์]";
  if (message?.type === "location") return `[ตำแหน่ง: ${message.address || message.title || "พิกัด"}]`;
  return `[${message?.type || "ข้อความ"}]`;
};

// LINE ไม่เปิด endpoint ดาวน์โหลดภาพ sticker ที่รับมา แต่ webhook มี stickerId;
// ใช้ asset CDN ของ LINE แบบ best-effort และให้ UI fallback เป็นข้อความหาก asset ไม่มี/โหลดไม่ได้
const stickerImageUrl = (message: any) => message?.type === "sticker" && message?.stickerId
  ? `https://stickershop.line-scdn.net/stickershop/v1/sticker/${encodeURIComponent(String(message.stickerId))}/android/sticker.png`
  : null;

async function notify(conversationId: string, pageId: string, pageName: string, customerName: string, text: string) {
  try {
    const sb = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    await fetch(`${sb}/functions/v1/send-push`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ action: "notify_new", conversation_id: conversationId, page_id: pageId, page_name: pageName, customer_name: customerName, text }) });
  } catch (_) { /* push must not break webhook */ }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const cfg = await getLineConfig();
  if (!cfg.channelSecret || !cfg.accessToken) return new Response("webhook not configured", { status: 503 });
  if (!await verifySignature(raw, req.headers.get("x-line-signature") || "", cfg.channelSecret)) return new Response("bad signature", { status: 401 });
  if (!LINE_INGEST_ENABLED) return new Response("ok", { status: 200 });
  try {
    const payload = JSON.parse(raw || "{}");
    // ปุ่ม Verify ของ LINE ส่ง signed POST ที่ events ว่างมาเพื่อตรวจการเชื่อมต่อ
    // ต้องตอบ 200 ทันที ไม่ควรเรียก Profile/Bot API หรือฐานข้อมูลโดยไม่จำเป็น
    if (!Array.isArray(payload.events) || payload.events.length === 0) return new Response("ok", { status: 200 });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let bot: any = {};
    try { bot = await lineApi("/v2/bot/info", cfg.accessToken); } catch (_) { /* optional */ }
    const pageId = `line:${bot.userId || "oa"}`;
    const pageName = bot.displayName || "LINE OA";
    for (const event of Array.isArray(payload.events) ? payload.events : []) {
      if (event?.type !== "message" || event?.source?.type !== "user" || !event?.source?.userId) continue;
      const userId = String(event.source.userId);
      const id = `line_${(bot.userId || "oa").replace(/[^A-Za-z0-9_-]/g, "")}_${userId}`;
      const text = labelOf(event.message);
      const at = new Date(Number(event.timestamp) || Date.now()).toISOString();
      let profile: any = {};
      try { profile = await lineApi(`/v2/bot/profile/${encodeURIComponent(userId)}`, cfg.accessToken); } catch (_) { /* user may block OA */ }
      const { data: old } = await admin.from("chat_customers").select("transcript,message_count,user_message_count,created_at").eq("id", id).maybeSingle();
      const transcript = Array.isArray(old?.transcript) ? old.transcript : [];
      const mid = String(event.message?.id || event.webhookEventId || "");
      if (mid && transcript.some((m: any) => String(m?.mid || "") === mid)) continue;
      const stickerUrl = stickerImageUrl(event.message);
      const item = {
        w: "u", t: text, at, mid: mid || null, via: "line", line_type: event.message?.type || "unknown",
        ...(event.message?.quoteToken ? { quote_token: String(event.message.quoteToken) } : {}),
        ...(stickerUrl ? { img: stickerUrl, sticker: true, sticker_id: String(event.message.stickerId), package_id: String(event.message.packageId || "") } : {}),
        ...(event.message?.markAsReadToken ? { mark_as_read_token: String(event.message.markAsReadToken) } : {}),
      };
      const row = {
        id, source: "line", page_id: pageId, page_name: pageName, psid: userId,
        customer_name: profile.displayName || "ลูกค้า LINE", profile_pic: profile.pictureUrl || null,
        transcript: [...transcript, item].slice(-100), last_user_text: text.slice(0, 1000), last_message_at: at,
        message_count: Number(old?.message_count || 0) + 1, user_message_count: Number(old?.user_message_count || 0) + 1,
        awaiting_reply: true, unread: true, synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      const { error } = await admin.from("chat_customers").upsert(row);
      if (error) throw error;
      await notify(id, pageId, pageName, row.customer_name, text);
    }
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("LINE webhook", error);
    return new Response("ok");
  }
});
