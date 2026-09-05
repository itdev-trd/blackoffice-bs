// supabase/functions/messenger-reply/index.ts
// หน้า "ตอบแชท" — แปลข้อความลูกค้าเป็นไทย + ส่งคำตอบกลับ (แปลไทย→ภาษาลูกค้า) ผ่าน Meta Send API
//   { action: "translate", id }            → คืนคำแปลไทยของข้อความลูกค้า + ตรวจภาษา/ประเทศ (เก็บลง DB)
//   { action: "send", id, text_th }        → แปลไทย→ภาษาลูกค้า แล้วส่งเข้า Messenger + ต่อ transcript
// ต้องมีสิทธิ์ pages_messaging และส่งได้ภายในกรอบ 24 ชม.หลังลูกค้าพิมพ์ล่าสุด (messaging_type=RESPONSE)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getLineConfig, lineApi } from "../_shared/line.ts";
import { readJsonBody } from "../_shared/security.ts";
import { getOpenAIKey } from "../_shared/openai.ts";

const GRAPH_VERSION = "v22.0"; // v19 หมดอายุแล้ว (sunset ต้นปี 2026)
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: init?.signal || AbortSignal.timeout(12_000) });
  return await r.json().catch(() => ({}));
}

// แอป Meta ที่ยังไม่ผ่าน App Review (Standard Access ของ pages_messaging) ส่งข้อความได้เฉพาะบัญชี
// ที่มี role ในแอป (แอดมิน/ผู้พัฒนา/ผู้ทดสอบ) — Meta คืน code 10 เหมือนกรณี "เกิน 24 ชม." เป๊ะ
// ถ้าไม่แยกออก ข้อความ error จะโทษกรอบเวลาแทน ทั้งที่ตอบลูกค้าทั่วไปไม่ได้เลยสักคน
const APP_REVIEW_HINT = "แอป Meta ยังเป็น Standard Access — ส่งข้อความได้เฉพาะบัญชีที่มี role ในแอป (แอดมิน/ผู้พัฒนา/ผู้ทดสอบ) "
  + "ต้องยื่น App Review ขอ Advanced Access ของ pages_messaging ก่อนถึงจะตอบลูกค้าทั่วไปได้ · แชท LINE ไม่เกี่ยวกับข้อจำกัดนี้";
const isAppReviewBlock = (...errs: any[]) => errs.some((e) => {
  const text = `${e?.message || ""} ${e?.error_user_msg || ""} ${e?.error_user_title || ""}`;
  return /pages_messaging/i.test(text) && /(ผู้ทดสอบ|ผู้พัฒนา|testers|developers)/i.test(text);
});

// ส่งเข้า Messenger: ลอง RESPONSE ก่อน (กรอบ 24 ชม.) ถ้า Meta ปฏิเสธ → retry ด้วย Human Agent tag (ขยายเป็น 7 วัน)
// message = object ของ Send API (เช่น { text } หรือ { attachment })
async function sendMessage(pageId: string, pageTok: string, psid: string, message: any, version: string, preferHumanAgent = false, extra: Record<string, unknown> = {}) {
  const url = `https://graph.facebook.com/${version}/${pageId}/messages?access_token=${pageTok}`;
  const post = (body: any) => fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  // รู้อยู่แล้วว่าเกิน 24 ชม. → ส่ง HUMAN_AGENT ตรง ไม่เสียเวลายิง RESPONSE ที่ Meta ต้องปฏิเสธก่อน
  let res = preferHumanAgent
    ? await post({ recipient: { id: psid }, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT", message, ...extra })
    : await post({ recipient: { id: psid }, messaging_type: "RESPONSE", message, ...extra });
  if (preferHumanAgent && !res?.error) return { ...res, _delivery_mode: "human_agent" };
  // Meta อาจคืน code 10, 200 หรือ subcode อื่นเมื่อเกิน 24 ชม. จึงลอง HUMAN_AGENT ทุกครั้งที่ RESPONSE ถูกปฏิเสธ
  if (res?.error) {
    const firstErr = res.error;   // error ของการยิงครั้งแรก (RESPONSE ถ้าอยู่ในกรอบ)
    const retry = preferHumanAgent ? res : await post({ recipient: { id: psid }, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT", message, ...extra });
    if (!retry?.error) return { ...retry, _delivery_mode: "human_agent" };
    // ยัง error → วินิจฉัยตามบริบทจริง (อยู่ในกรอบ 24 ชม.หรือไม่) พร้อม code/subcode
    const code = Number(retry.error.code);
    const subcode = retry.error.error_subcode ? Number(retry.error.error_subcode) : null;
    const metaMsg = retry.error.error_user_msg || firstErr?.error_user_msg || "";
    console.warn("[messenger send failed]", JSON.stringify({ preferHumanAgent, firstErr, retryErr: retry.error }));
    // ติดสิทธิ์ระดับแอป ไม่ใช่ระดับห้องแชท — บอกให้ตรงสาเหตุ ไม่งั้นแอดมินจะไล่แก้ผิดทาง
    if (isAppReviewBlock(firstErr, retry.error)) throw new Error(APP_REVIEW_HINT);
    // อยู่ในกรอบ 24 ชม.แต่ยังส่งไม่ได้ = ไม่ใช่เรื่องหมดเวลา — มักเป็นลูกค้าบล็อกเพจ/ปิดรับข้อความ/บัญชีถูกจำกัด
    if (!preferHumanAgent) {
      throw new Error(`ส่งไม่สำเร็จ (ยังอยู่ในกรอบ 24 ชม.): ${metaMsg || "Meta ปฏิเสธการส่ง"} — สาเหตุที่พบบ่อย: ลูกค้าบล็อกเพจ/ปิดรับข้อความ, บัญชีลูกค้าถูกจำกัด, หรือลิงก์/เนื้อหาถูกบล็อก (code ${code}${subcode ? `, subcode ${subcode}` : ""})`);
    }
    if (code === 10 || code === 200 || code === 613 || code === 551) {
      throw new Error(`Meta ไม่อนุญาตให้ส่งนอกกรอบ 24 ชม.ด้วย HUMAN_AGENT — อาจเกิน 7 วันหรือแอปยังไม่ได้รับสิทธิ์ Human Agent (code ${code}${subcode ? `, subcode ${subcode}` : ""})`);
    }
    throw new Error(`${metaMsg || retry.error.message || "ส่งข้อความไม่สำเร็จ"}${subcode ? ` (code ${code}, subcode ${subcode})` : ` (code ${code})`}`);
  }
  return { ...res, _delivery_mode: "response" };
}

// Facebook Login flow ใช้ Page access token และส่งผ่าน /{PAGE_ID}/messages;
// recipient เป็น IGSID แล้ว Meta จะ route ไปยัง Instagram ที่เชื่อมกับเพจเอง
async function sendInstagramMessage(pageId: string, pageTok: string, igsid: string, message: any, extra: Record<string, unknown> = {}) {
  const res = await fetchJson(`${GRAPH_BASE}/${pageId}/messages?access_token=${pageTok}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: igsid }, messaging_type: "RESPONSE", message, ...extra }),
  });
  if (res?.error) {
    if (isAppReviewBlock(res.error)) throw new Error(APP_REVIEW_HINT);
    throw new Error(res.error.error_user_msg || res.error.message || "ส่ง Instagram DM ไม่สำเร็จ");
  }
  return { ...res, _delivery_mode: "instagram" };
}

// ปลุกทุกอุปกรณ์ให้ล้าง notification/จุดแดงหลังมีคนอ่านหรือตอบจากเครื่องใดเครื่องหนึ่ง
async function syncPushState(conversationId: string) {
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const sb = Deno.env.get("SUPABASE_URL") || "";
    if (!serviceKey || !sb) return;
    const task = fetch(`${sb}/functions/v1/send-push`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ action: "sync_state", conversation_id: conversationId }),
    }).catch(() => null);
    // การล้าง notification/badge ทุกอุปกรณ์อาจใช้เวลาหลายวินาที ห้ามขวาง response การส่งแชท
    // Supabase Edge Runtime จะคง task นี้ไว้หลังส่ง HTTP response กลับหน้าเว็บแล้ว
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(task);
  } catch (_e) { /* การ sync badge พลาดต้องไม่ทำให้การตอบแชทล้ม */ }
}

// สถานะอ่านเป็นสถานะกลางของเพจ ไม่ใช่ต่อผู้ใช้ในแอป
// ข้อมูลเก่าบางชุดมีมากกว่าหนึ่งแถวต่อ page + PSID จึงต้องล้างทุกแถวของห้องเดียวกันพร้อมกัน
async function clearRelatedUnread(admin: any, row: any, nowIso: string, answered = false): Promise<string[]> {
  const state = { unread: false, read_at: nowIso, updated_at: nowIso, ...(answered ? { awaiting_reply: false } : {}) };
  // การ์ดกันเขียนเปล่า: แตะเฉพาะแถวที่ "ยังไม่อ่าน/ยังรอตอบ" จริง ๆ — ไม่งั้นเขียนทับซ้ำทุกครั้งที่ mark_seen/echo
  // ปั่น WAL ให้ Realtime โดยไม่จำเป็น (เป็นตัวกิน memory/CPU อันดับ 1) และทำให้ตารางบวม
  const guard = (q: any) => answered ? q.or("unread.eq.true,awaiting_reply.eq.true") : q.eq("unread", true);
  if (!row?.page_id || !row?.psid || row?.source === "comment") {
    const { data } = await guard(admin.from("chat_customers").update(state).eq("id", row.id)).select("id");
    return (data ?? []).map((r: any) => String(r.id));
  }
  let query = admin.from("chat_customers")
    .update(state)
    .eq("page_id", row.page_id).eq("psid", row.psid);
  query = row.source === "instagram"
    ? query.eq("source", "instagram")
    : row.source === "line"
      ? query.eq("source", "line")
    : query.not("id", "like", "fbc_%").or("source.is.null,source.neq.comment");
  const { data } = await guard(query).select("id");
  return (data ?? []).map((r: any) => String(r.id));
}

// เรียก OpenAI (ตัวเดียวกับที่ทั้งระบบใช้ — IMAGE_API_KEY) คืน JSON
// gpt-5 เป็น reasoning model — ถ้าไม่กำหนด reasoning_effort จะคิดลึกทุกครั้งและกิน token มาก
// งานในไฟล์นี้ไม่เท่ากันเรื่องความสำคัญ จึงแยกระดับ:
//   translate / summarize = อ่านให้แอดมินเข้าใจ (ภายใน) -> "low" พอ ประหยัดได้เยอะเพราะยิงบ่อยสุด
//   reply = ข้อความที่ "ลูกค้าได้รับจริง" -> ไม่ลด ปล่อยค่าเริ่มต้น เพราะแปลผิดคือเสียลูกค้า
// reasoning_effort ใช้ได้เฉพาะ reasoning model (ตระกูล gpt-5 / o-series)
// โมเดลเริ่มต้นจริงของระบบคือ gpt-4.1 ซึ่งตอบ 400 "Unrecognized request argument supplied:
// reasoning_effort" ทำให้การแปลพังทั้งหมด — ต้องเช็คก่อนส่ง ไม่ใช่ส่งเสมอ
// max_completion_tokens ก็เป็นพารามิเตอร์ของโมเดลรุ่นใหม่ รุ่นเก่าใช้ max_tokens
function isReasoningModel(model: string) {
  const m = String(model || "").toLowerCase();
  return m.startsWith("gpt-5") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
}

async function openaiJson(
  model: string,
  sys: string,
  user: string,
  opts: { effort?: "low" | "medium" | "high"; maxTokens?: number } = {}
): Promise<any> {
  const key = await getOpenAIKey();
  const reasoning = isReasoningModel(model);
  const tokenCap = opts.maxTokens ?? 2000;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      ...(reasoning ? { max_completion_tokens: tokenCap } : { max_tokens: tokenCap }),
      ...(reasoning && opts.effort ? { reasoning_effort: opts.effort } : {}),
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  try { return JSON.parse(data.choices?.[0]?.message?.content || "{}"); } catch { return {}; }
}

// ลูกค้าไทยไหม — นับสัดส่วนตัวอักษรไทย (ไม่ต้องเรียก AI)
function isMostlyThai(s: string): boolean {
  const thai = (s.match(/[฀-๿]/g) || []).length;
  const letters = (s.match(/\p{L}/gu) || []).length;
  return letters > 0 && thai / letters > 0.5;
}

// อักษรลาวอยู่คนละ Unicode block กับไทย จึงตรวจได้แม่นกว่าการเดาจากชื่อ/ประเทศเดิมของแชท
// ใช้ค่าจากข้อความล่าสุดเพื่อแก้กรณี cache คำแปล hit แล้วไม่ได้เรียก AI ตรวจภาษาอีกรอบ
function isMostlyLao(s: string): boolean {
  const lao = (s.match(/[\u0E80-\u0EFF]/g) || []).length;
  const letters = (s.match(/\p{L}/gu) || []).length;
  return letters > 0 && lao / letters > 0.35;
}

// จุดเริ่ม "รอบรอตอบ" = ข้อความแรกของลูกค้าหลังการตอบครั้งล่าสุดของเพจ (คืน null ถ้าไม่ได้อยู่ในสถานะรอ)
function waitingStartAt(transcript: any[]): string | null {
  if (!Array.isArray(transcript) || !transcript.length) return null;
  if (transcript[transcript.length - 1]?.w !== "u") return null; // ข้อความท้ายไม่ใช่ของลูกค้า = ไม่ได้รออยู่ (เป็นการส่งตาม)
  let start: string | null = null;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m?.w === "p") break;
    if (m?.w === "u" && m?.at) start = m.at;
  }
  return start;
}
// บันทึกสถิติการตอบ (fire-and-forget — พังก็ไม่กระทบการส่ง)
async function recordReplyStat(admin: any, row: any, by: string, transcript: any[], nowIso: string) {
  try {
    const msgAt = waitingStartAt(transcript);
    if (!msgAt) return; // ไม่ใช่การตอบรอบรอ (เช่นพิมพ์ตามหลายข้อความ) — ไม่นับซ้ำ
    await admin.from("reply_stats").insert({
      email: by || null, page_id: row.page_id ?? null, page_name: row.page_name ?? null,
      conversation_id: row.id, customer_name: row.customer_name ?? null,
      msg_at: msgAt, replied_at: nowIso,
      response_ms: Math.max(0, new Date(nowIso).getTime() - new Date(msgAt).getTime()),
    });
  } catch (_e) { /* เงียบไว้ */ }
}

// hash ข้อความ (ไว้ทำ cache คำแปล — ข้อความเดิม = ใช้คำแปลเดิม ไม่ต้องแปลซ้ำ)
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// PWA/แท็บเก่าบางเครื่องอาจยังส่ง preview รุ่นเดิมที่ฝัง "↪ [รูปภาพ]" ไว้ใน approved_text
// กรองที่ server อีกชั้น เพื่อไม่ให้ข้อความเทียมนี้หลุดไปหาลูกค้า แม้ client ยังไม่ได้ refresh
function stripLegacyMediaReplyPrefix(value: string): string {
  return String(value || "").replace(/^↪\s*\[(?:รูปภาพ|วิดีโอ|เสียง|ไฟล์แนบ|สติกเกอร์)\]\s*\r?\n/i, "").trim();
}

// ทางถอยเมื่อทำ native reply ไม่ได้ (mid เก่า/ถูกลบ, ตอบใต้คอมเมนต์) — ส่งบริบทเป็นข้อความย่อแทน
// จำกัดเฉพาะส่วนอ้างอิงไม่เกิน 320 ตัวอักษร และไม่สร้างข้อความ [รูปภาพ] เทียม
function composeCustomerReplyText(replyText: string, replyToText: string, replyToImg: string): string {
  const answer = String(replyText || "").trim();
  const quote = String(replyToText || "").replace(/\s+/g, " ").trim();
  const isMedia = !!replyToImg || /^\[(?:รูปภาพ|วิดีโอ|เสียง|ไฟล์แนบ|สติกเกอร์)\]$/i.test(quote);
  if (!quote || isMedia) return answer;
  const prefix = "↩︎ “";
  const suffix = "”\n\n";
  const available = Math.min(320, 2000 - answer.length - prefix.length - suffix.length);
  if (available < 20) return answer;
  const excerpt = quote.length <= available ? quote : `${quote.slice(0, available - 1)}…`;
  return `${prefix}${excerpt}${suffix}${answer}`;
}

// Send API ทำ native reply ได้แล้ว โดย reply_to ต้องอยู่ "ระดับบนสุด" ของ body คู่กับ recipient/message
// ห้ามใส่ใน message เพราะ Meta ตอบ (#100) Invalid keys "reply_to" were found in param "message".
// ลูกค้าจะเห็นข้อความที่เราอ้างถึงลอยอยู่เหนือคำตอบ และกดเพื่อเลื่อนไปดูต้นฉบับได้ เหมือน quote ของ LINE
//
// mid ที่เก่าเกินไปหรือถูกลบแล้ว Meta จะปฏิเสธทั้งคำขอ ห้ามให้คำตอบหลุดหาย
// จึงถอยไปส่งแบบเดิม (ไม่มี reply_to แต่เติมข้อความอ้างอิงในเนื้อหา) ให้คำตอบถึงลูกค้าเสมอ
async function sendWithNativeReply(
  send: (message: any, extra: Record<string, unknown>) => Promise<any>,
  nativeText: string,
  quotedText: string,
  mid: string
) {
  if (!mid) {
    const res = await send({ text: quotedText }, {});
    return { ...res, _delivered_text: quotedText, _reply_mode: "text_quote" };
  }
  try {
    const res = await send({ text: nativeText }, { reply_to: { mid } });
    return { ...res, _delivered_text: nativeText, _reply_mode: "native" };
  } catch (e) {
    console.warn("[native reply ถูกปฏิเสธ ถอยไปใช้ข้อความอ้างอิง]", e instanceof Error ? e.message : e);
    const res = await send({ text: quotedText }, {});
    return { ...res, _delivered_text: quotedText, _reply_mode: "text_quote_fallback" };
  }
}

// คลังความรู้ต้องไม่เก็บข้อมูลระบุตัวลูกค้าที่หลุดมากับบทสนทนา
function redactKnowledgeText(value: string): string {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[อีเมล]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[เบอร์/เลขบัญชี]")
    .replace(/https?:\/\/\S+/gi, "[ลิงก์]")
    .trim();
}

// prompt แปลข้อความลูกค้า → ไทย (โทน "คนเทรดทอง/ฟอเร็กซ์")
const TRANSLATE_SYS = `คุณคือล่ามของเพจธุรกิจ "เทรดทอง/ฟอเร็กซ์" แปลข้อความลูกค้าเป็น "ภาษาไทยแบบคนเทรดทองคุยกันจริง"
- แปลเอาความหมาย ไม่แปลตรงตัว อ่านลื่น เป็นภาษาพูด/แชท สุภาพเป็นกันเอง
- ใช้ศัพท์สายเทรดให้เป็นธรรมชาติเมื่อตรงบริบท (ทองคำ/XAUUSD, ลอต, จุด/pip, TP/SL, พอร์ต, มาร์จิน, รีเบต/คืนค่าคอม, โบรกเกอร์)
- ห้ามทับศัพท์คำทั่วไป (Halo/Hello→สวัสดี, iklan→โฆษณา, bot→บอท) คงชื่อแบรนด์/ลิงก์/ตัวเลข/โค้ดไว้ตามเดิม
- ถ้าเป็นคำถาม แปลเป็นประโยคคำถามไทยธรรมชาติ (ลงท้าย ไหม/หรือเปล่า/คะ/ครับ ตามบริบท)
พร้อมตรวจภาษา/ประเทศลูกค้า (เอเชียตะวันออกเฉียงใต้: ลาว เวียดนาม มาเลเซีย ฟิลิปปินส์ อินโดนีเซีย ไทย)
- ต้องแปลทุกข้อความในรายการ รวมข้อความภาษาลาวและข้อความที่ผสมอักษรลาวกับอังกฤษ ห้ามข้ามรายการ
อินพุตเป็นรายการข้อความ แต่ละอันมี i (คีย์) กับ t (ข้อความ) — ต้องส่ง i กลับให้ตรงเดิม
ตอบ JSON เท่านั้น: {"lang":"ชื่อภาษา (เช่น Lao, Vietnamese, Bahasa Indonesia, Tagalog, Bahasa Malaysia, Thai, English)","country":"ประเทศ(ภาษาไทย)","items":[{"i":"<คีย์เดิม>","th":"คำแปลไทยที่เป็นธรรมชาติ"}]}`;

// prompt สรุปบทสนทนา — กดเองจากปุ่มในหน้าตอบแชท ไม่ auto
const SUMMARIZE_SYS = `คุณคือแอดมินเพจ "เทรดทอง/ฟอเร็กซ์" สรุปบทสนทนากับลูกค้าให้เพื่อนแอดมินอ่านต่อได้เร็ว
- สรุปเป็นภาษาไทย กระชับ 3-5 ประโยค ครอบคลุม: ลูกค้าสนใจอะไร/ถามอะไร, สถานะล่าสุดของการคุย (รอลูกค้าตอบ/รอแอดมินตอบ/ปิดจบแล้ว), ข้อมูลสำคัญที่หลุดมา (เช่น เบอร์/Trade ID/งบที่พูดถึง) ถ้ามี
- ห้ามเดาข้อมูลที่ไม่มีในบทสนทนา ถ้าไม่มีข้อมูลด้านไหนให้ข้ามไปเลย ไม่ต้องเขียนว่า "ไม่มีข้อมูล"
ตอบ JSON เท่านั้น: {"summary":"ข้อความสรุป"}`;

// prompt แปลคำตอบแอดมิน (ไทย) → ภาษาลูกค้า โดยอิงภาษาจาก "ข้อความล่าสุดของลูกค้า"
const REPLY_SYS = `คุณคือแอดมินเพจ "เทรดทอง/ฟอเร็กซ์"
งาน: แปล admin_reply_th (คำตอบภาษาไทยของแอดมิน) เป็นภาษา known_lang ที่ระบบบันทึกไว้
- ให้ฟังเหมือนเทรดเดอร์เจ้าของภาษาพิมพ์เอง สุภาพเป็นกันเอง ใช้ศัพท์สายเทรดทอง/ฟอเร็กซ์ให้เป็นธรรมชาติ
- คงอิโมจิ ลิงก์ โค้ดพาร์ทเนอร์ ชื่อแบรนด์ ตัวเลข ไว้ตามเดิมเป๊ะ
- ถ้ามี known_lang ต้องใช้ภาษานั้นเสมอ ห้ามตรวจหรือเปลี่ยนภาษาจาก customer_last_message
- ใช้ customer_last_message เพื่อตรวจภาษาเฉพาะเมื่อ known_lang ว่างเท่านั้น; ถ้าไม่มีทั้งคู่ใช้ English
- ตอบเฉพาะข้อความที่จะส่งให้ลูกค้า ห้ามมีคำอธิบายอื่น
ตอบ JSON: {"lang":"ภาษาที่แปลไป","text":"คำแปล"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const body = await readJsonBody(req, 1024 * 1024);
    const action = String(body?.action || "");
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"] });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    // ---------- ดึง "ข้อความตอบกลับที่บันทึกไว้" (Saved Replies) ของเพจ ----------
    if (action === "saved_replies") {
      const pageId = body?.page_id ? String(body.page_id) : null;
      if (!pageId) throw new Error("ต้องส่ง page_id");
      // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้าตอบแชทได้ ก็ตอบได้ทุกเพจและทุก LINE OA
      const token = await getMetaToken();
      if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token");
      const pd = await getMetaPages(GRAPH_BASE, token, { mustIncludePageId: pageId });
      const pageTok = (pd?.data ?? []).find((p: any) => p.id === pageId)?.access_token;
      if (!pageTok) throw new Error("ไม่พบ access token ของเพจนี้ (เช็คสิทธิ์ pages_messaging)");
      let r = await fetchJson(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/saved_message_responses?fields=id,title,message,image,is_enabled&limit=200&access_token=${pageTok}`);
      if (r?.error) r = await fetchJson(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/saved_message_responses?fields=id,title,message&limit=200&access_token=${pageTok}`);
      if (r?.error) return json({ ok: false, error: r.error.message || "ดึงข้อความตอบกลับไม่ได้ (เพจอาจไม่รองรับ/ไม่มีสิทธิ์)" });
      const replies = (r?.data ?? []).map((x: any) => ({ id: x.id, title: x.title ?? null, message: x.message ?? "", image: x.image ?? null, enabled: x.is_enabled !== false })).filter((x: any) => x.message || x.title);
      return json({ ok: true, replies });
    }

    const id = body?.id ? String(body.id) : null;
    if (!id) throw new Error("ต้องส่ง id ของบทสนทนา");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // โมเดลแปล: ปรับได้จาก settings (ai_model_reply) ไม่งั้นใช้โมเดลใหญ่ (ai_model_verify) เพื่อคุณภาพการแปล
    const { data: cfgRow } = await admin.from("settings").select("value").eq("key", "chat_sync_config").maybeSingle();
    const cfg: any = cfgRow?.value || {};
    const model = (typeof cfg.ai_model_reply === "string" && cfg.ai_model_reply) || (typeof cfg.ai_model_verify === "string" && cfg.ai_model_verify) || "gpt-4.1";

    const { data: row } = await admin.from("chat_customers").select("id, page_id, page_name, psid, transcript, cust_lang, country, customer_name, profile_pic, unread, source, last_user_text, last_message_at, comment_post_id, comment_permalink, entry_ad_id, comment_ad_name").eq("id", id).maybeSingle();
    if (!row) throw new Error("ไม่พบบทสนทนา");
    // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้าตอบแชทได้ ก็ตอบได้ทุกเพจและทุก LINE OA
    const transcript = Array.isArray(row.transcript) ? row.transcript : [];

    // ---------- แปลข้อความลูกค้าเป็นไทย + ตรวจภาษา/ประเทศ ----------
    if (action === "translate") {
      // แปลทั้งสองฝั่ง: ฝั่งลูกค้า (เข้าใจว่าลูกค้าพูดอะไร) + ฝั่งเพจ (ย้อนดูว่าแอดมินตอบอะไรไป)
      // ข้อความฝั่งเพจที่ส่งจากแอปเรามี th (ต้นฉบับไทย) ติดมาอยู่แล้ว → ข้ามไปเลย ไม่ต้องเสียโทเคนแปล
      const allMsgs = transcript
        .map((m: any, i: number) => ({ i, w: m.w, t: String(m.t || ""), th: typeof m.th === "string" ? m.th : null }))
        .filter((m: any) => m.t.trim())
        .map((m: any) => ({ ...m, h: hashText(m.t) }));
      const userMsgs = allMsgs.filter((m: any) => m.w === "u");
      if (!allMsgs.length) return json({ ok: true, translations: {}, lang: row.cust_lang || null, country: row.country || null });

      // ตรวจภาษา "รายข้อความ": ข้อความไทยไม่แปล, ที่มี th ติดมาแล้วก็ไม่แปล (ประหยัดโทเคน)
      const needTranslate = allMsgs.filter((m: any) => !m.th && !isMostlyThai(m.t));

      // ดึงคำแปลที่เคยแปลไว้จาก cache — cache ใช้ hash ของ "ตัวข้อความ" จึงใช้ร่วมกันได้ทั้งสองฝั่ง
      const hashes = [...new Set(needTranslate.map((m: any) => m.h))];
      const cacheMap: Record<string, string> = {};
      if (hashes.length) {
        const { data: cachedRows } = await admin.from("chat_translations").select("hash, th").in("hash", hashes);
        // แคชเก่าบางรายการเคยเก็บภาษาปลายทางซ้ำไว้ในช่อง th ทำให้ใต้ธงไทยยังเป็นภาษาต่างประเทศ
        // รับเฉพาะค่าที่เป็นภาษาไทยจริง รายการเสียจะกลายเป็น miss และถูก AI แปล/เขียนทับใหม่
        for (const c of cachedRows ?? []) {
          const translated = String(c?.th || "").trim();
          if (translated && isMostlyThai(translated)) cacheMap[c.hash] = translated;
        }
      }

      let lang = row.cust_lang || null, country = row.country || null;
      const misses = needTranslate.filter((m: any) => !(m.h in cacheMap));
      if (misses.length) {
        // แปลเฉพาะข้อความใหม่ (ตัดซ้ำด้วย hash) — ส่ง hash เป็นคีย์ให้ AI คืนกลับ
        // แบ่งเป็นชุดย่อยเพื่อไม่ให้ JSON ถูกตัดเมื่อ transcript ยาว ซึ่งเดิมทำให้คำแปลทั้งแชทหาย
        const uniq = [...new Map(misses.map((m: any) => [m.h, m])).values()];
        const batches: any[][] = [];
        let batch: any[] = [], chars = 0;
        for (const m of uniq) {
          const size = m.t.length;
          if (batch.length && (batch.length >= 10 || chars + size > 3500)) {
            batches.push(batch); batch = []; chars = 0;
          }
          batch.push(m); chars += size;
        }
        if (batch.length) batches.push(batch);
        for (const part of batches) {
          // แปลให้แอดมินอ่าน (ภายใน) — low พอ และนี่คือตัวที่เรียกบ่อยสุดในระบบ
          const out = await openaiJson(model, TRANSLATE_SYS, JSON.stringify({ messages: part.map((m: any) => ({ i: m.h, t: m.t })) }), { effort: "low" });
          for (const it of (out?.items || [])) { const k = String(it?.i ?? ""); if (k) cacheMap[k] = String(it.th || ""); }
          // ภาษา/ประเทศ = ของ "ลูกค้า" เท่านั้น — batch หลังสุดที่มีข้อความลูกค้าจะตรงกับข้อความล่าสุดกว่า
          if (part.some((m: any) => m.w === "u")) {
            lang = out?.lang ? String(out.lang) : lang;
            country = out?.country ? String(out.country) : country;
          }
        }
        const toStore = uniq.map((m: any) => ({ hash: m.h, th: cacheMap[m.h] || "", lang })).filter((x: any) => x.th);
        if (toStore.length) await admin.from("chat_translations").upsert(toStore, { onConflict: "hash" });
      }

      // แมป "hash ของข้อความ" → คำแปล (ไม่ใช้ index เพราะ transcript ฝั่งหน้าเว็บ/DB ยาวไม่เท่ากัน index เลื่อน แปลผิดข้อความ)
      // frontend จะ hash ตัวข้อความเองแล้ว lookup — ตรงตัวเสมอ ไม่ขึ้นกับตำแหน่ง
      const translations: Record<string, string> = {};
      for (const m of allMsgs) {
        if (m.th) { translations[m.h] = m.th; continue; }
        if (!isMostlyThai(m.t) && cacheMap[m.h]) translations[m.h] = cacheMap[m.h];
      }
      // ภาษาที่แสดง = ภาษาของ "ข้อความล่าสุด" ของลูกค้า
      // Lao/Thai ตรวจจากตัวอักษรโดยตรง เพื่อไม่ให้ภาษาเก่าค้างเมื่อคำแปลทั้งหมดมาจาก cache
      const latest = userMsgs[userMsgs.length - 1];
      const latestIsThai = !!latest && isMostlyThai(latest.t);
      const latestIsLao = !!latest && isMostlyLao(latest.t);
      const dispLang = latestIsThai ? "Thai" : latestIsLao ? "Lao" : (lang || row.cust_lang || null);
      const dispCountry = latestIsThai ? (row.country || "ไทย") : latestIsLao ? "ลาว" : country;
      await admin.from("chat_customers").update({ cust_lang: dispLang, country: dispCountry, updated_at: new Date().toISOString() }).eq("id", id);
      return json({ ok: true, translations, lang: dispLang, country: dispCountry, translated: misses.length });
    }

    // ---------- สรุปบทสนทนา (กดเอง จากปุ่มในหน้าตอบแชท) ----------
    if (action === "summarize") {
      if (!transcript.length) throw new Error("ยังไม่มีข้อความในบทสนทนานี้");
      // ส่งเฉพาะ 60 ข้อความล่าสุดพอ กันพร้อมท์ยาวเกินกับแชทเก่าที่คุยมานาน
      const recent = transcript.slice(-60).map((m: any) => ({
        who: m.w === "u" ? "ลูกค้า" : "แอดมิน",
        text: String(m.th || m.t || (m.img ? "[รูปภาพ/ไฟล์แนบ]" : "")).trim(),
      })).filter((m: any) => m.text);
      if (!recent.length) throw new Error("ไม่มีข้อความตัวอักษรให้สรุป");
      // สรุปบทสนทนาให้แอดมินอ่าน (ภายใน) — low + จำกัด token เพราะสรุปแค่ 3-5 ประโยค
      const out = await openaiJson(model, SUMMARIZE_SYS, JSON.stringify({
        customer_name: row.customer_name || null,
        messages: recent,
      }), { effort: "low", maxTokens: 1200 });
      const summary = String(out?.summary || "").trim();
      if (!summary) throw new Error("สรุปไม่สำเร็จ ลองใหม่อีกครั้ง");
      const nowIso = new Date().toISOString();
      await admin.from("chat_customers").update({ ai_summary: summary, ai_summary_at: nowIso }).eq("id", id);
      return json({ ok: true, summary, summarized_at: nowIso });
    }

    // ---------- แปลคำตอบไทย → ภาษาลูกค้า แล้วส่งเข้า Messenger ----------
    if (action === "preview" || action === "send") {
      const textTh = String(body?.text_th || "").trim();
      if (!textTh) throw new Error("ยังไม่มีข้อความจะส่ง");
      const isInstagramComment = id.startsWith("igc_");
      const isComment = id.startsWith("fbc_") || isInstagramComment || row.source === "comment";
      const commentReplyMode = isComment && body?.comment_reply_mode === "private" ? "private" : "public";
      // คอมเมนต์ที่ยังไม่เคยเข้า Messenger = ยังไม่มี PSID จริง — จะส่งผ่าน Private Reply แทน (ไม่ต้องมี PSID)
      if (!row.psid && !isComment) throw new Error("บทสนทนานี้ไม่มี PSID ส่งไม่ได้");

      // ภาษาปลายทางต้องตรงกับค่าที่แสดงบนหัวแชท (cust_lang) — ห้ามตรวจใหม่จากข้อความล่าสุดแล้วขัดกัน
      // force_lang = แอดมินเลือกเอง มีลำดับสูงสุด; ถ้ายังไม่มี cust_lang จริง ๆ จึงค่อย fallback ตรวจข้อความล่าสุด
      const forceLang = body?.force_lang ? String(body.force_lang).trim() : null;
      const detectedLang = row.cust_lang ? String(row.cust_lang).trim() : null;
      const targetLang = forceLang || detectedLang;
      const lastUser = [...transcript].reverse().find((m: any) => m.w === "u");
      const lastUserText = lastUser ? String(lastUser.t || "") : "";
      // เก็บบริบทการตอบกลับไว้ใน transcript ของแอป แยกจากข้อความที่ส่งจริง
      // เพราะ Meta Send API ไม่รองรับการสร้าง native inline reply และข้อความมีเพดาน 2,000 ตัวอักษร
      const replyToText = String(body?.reply_to_text ?? body?.reply_to ?? "").trim();
      const replyToMid = String(body?.reply_to_mid || "").trim();
      const replyToImg = String(body?.reply_to_img || "").trim();
      const replyToAt = String(body?.reply_to_at || "").trim();
      const replyToQuoteToken = String(body?.reply_to_quote_token || "").trim();
      const approvedText = action === "send" && body?.approved_text ? String(body.approved_text).trim() : "";
      let replyText: string, lang: string;
      if (approvedText) {
        replyText = stripLegacyMediaReplyPrefix(approvedText);
        if (!replyText) throw new Error("ยังไม่มีข้อความจะส่ง");
        lang = body?.approved_lang ? String(body.approved_lang) : (targetLang || "Thai");
      } else if (targetLang === "Thai" || (!targetLang && isMostlyThai(lastUserText))) {
        // ภาษาที่บันทึกไว้เป็นไทย (หรือยังไม่มีค่าและข้อความล่าสุดเป็นไทย) → ส่งไทยตรง ๆ
        replyText = textTh; lang = "Thai";
      } else {
        // เมื่อมีภาษาบนหัวแชท ส่งข้อความล่าสุดเป็นค่าว่างเพื่อไม่ให้ AI ตรวจใหม่แล้วเลือกคนละภาษา
        // ตั้งใจ "ไม่ลด" effort ที่นี่ — นี่คือข้อความที่ลูกค้าได้รับจริง แปลเพี้ยนคือเสียลูกค้า
        // (translate/summarize ที่เป็นงานภายในถูกลดเป็น low ไปแล้ว)
        const tr = await openaiJson(model, REPLY_SYS, JSON.stringify({
          customer_last_message: targetLang ? "" : lastUserText,
          known_lang: targetLang,
          admin_reply_th: textTh,
        }));
        replyText = tr?.text ? String(tr.text) : textTh;
        lang = targetLang || (tr?.lang ? String(tr.lang) : "English");
      }
      // แอดมินเลือกภาษาเอง → จำไว้ที่บทสนทนา (อัปเดต cust_lang ให้ป้าย/รอบถัดไปตรง)
      if (forceLang) { try { await admin.from("chat_customers").update({ cust_lang: forceLang, updated_at: new Date().toISOString() }).eq("id", id); } catch { /* ไม่กระทบการส่ง */ } }
      // Preview แปลอย่างเดียว ยังไม่แตะ Meta/DB ผู้ใช้แก้ข้อความปลายทางและกดอนุมัติก่อนส่งจริง
      if (action === "preview") return json({ ok: true, preview_text: replyText, lang, source_text: textTh });

      // ช่องทางที่ทำ native quote ได้ ลูกค้าเห็นต้นฉบับที่เราอ้างถึงอยู่แล้ว จึงไม่ต้องเติมข้อความอ้างอิงซ้ำในเนื้อหา
      //   LINE                  -> quoteToken
      //   Messenger / Instagram -> message.reply_to.mid
      const quotedText = composeCustomerReplyText(replyText, replyToText, replyToImg);
      const lineNative = row.source === "line" && !!replyToQuoteToken;
      // ตอบใต้คอมเมนต์ใช้ native reply ไม่ได้ — mid ที่ถืออยู่เป็น comment id ไม่ใช่ message id
      const metaNativeMid = !isComment && replyToMid ? replyToMid : "";
      const outText = lineNative ? replyText : quotedText;

      // ส่งจริง
      let send: any, gotPsid: string | null = row.psid || null;
      if (row.source === "line") {
        const cfg = await getLineConfig();
        if (!cfg.accessToken) throw new Error("ยังไม่ได้ตั้งค่า LINE Channel access token");
        send = await lineApi("/v2/bot/message/push", cfg.accessToken, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: row.psid, messages: [{ type: "text", text: outText, ...(replyToQuoteToken ? { quoteToken: replyToQuoteToken } : {}) }] }),
        });
        send = { ...send, message_id: send?.sentMessages?.[0]?.id || null, quote_token: send?.sentMessages?.[0]?.quoteToken || null, _delivery_mode: "line_push" };
      } else {
        // ช่องทาง Meta เท่านั้นจึงต้องดึง Page access token
        const token = await getMetaToken();
        const pagesData = await getMetaPages(GRAPH_BASE, token, {
          mustIncludePageId: row.page_id,
          mustIncludeInstagramForPageId: row.source === "instagram" || isInstagramComment ? row.page_id : undefined,
        });
        const pageTok = (pagesData?.data ?? []).find((p: any) => p.id === row.page_id)?.access_token;
        const metaPage = (pagesData?.data ?? []).find((p: any) => p.id === row.page_id);
        const instagramId = row.source === "instagram" ? String(metaPage?.instagram_business_account?.id || "") : "";
        if (!pageTok) throw new Error("ไม่พบ access token ของเพจนี้ (เช็คสิทธิ์ pages_messaging)");
        if (row.source === "instagram" && !instagramId) throw new Error("ไม่พบบัญชี Instagram Business ที่เชื่อมกับเพจนี้");
        if (isInstagramComment && commentReplyMode === "public") {
        // Instagram comment moderation uses /{ig-comment-id}/replies.
        const commentId = id.replace(/^igc_/, "");
        const cr = await fetchJson(`${GRAPH_BASE}/${commentId}/replies?access_token=${pageTok}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: outText }),
        });
        if (cr?.error) throw new Error(cr.error.error_user_msg || cr.error.message || "ตอบใต้คอมเมนต์ Instagram ไม่สำเร็จ (ตรวจสิทธิ์ instagram_manage_comments)");
        send = { message_id: cr?.id || null };
      } else if (isComment && commentReplyMode === "public") {
        // ตอบใต้คอมเมนต์โดยตรงเหมือน Facebook Page (ต้องมี pages_manage_engagement)
        const commentId = id.replace(/^fbc_/, "");
        const cr = await fetchJson(`${GRAPH_BASE}/${commentId}/comments?access_token=${pageTok}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: outText }),
        });
        if (cr?.error) throw new Error(cr.error.error_user_msg || cr.error.message || "ตอบใต้คอมเมนต์ไม่สำเร็จ (ตรวจสิทธิ์ pages_manage_engagement)");
        send = { message_id: cr?.id || null };
      } else if (!row.psid && isComment) {
        // Facebook Page Private Reply ต้องส่งผ่าน Send API โดยใช้ recipient.comment_id
        // (endpoint /{comment-id}/private_replies ใช้ไม่ได้กับ Facebook Page comment รูปแบบนี้)
        const commentId = id.replace(/^fbc_/, "");
        const pr = await fetchJson(`${GRAPH_BASE}/${row.page_id}/messages?access_token=${pageTok}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recipient: { comment_id: commentId },
            messaging_type: "RESPONSE",
            message: { text: outText },
          }),
        });
        if (pr?.error) throw new Error(pr.error.error_user_msg || pr.error.message || "ส่งข้อความส่วนตัว (private reply) ไม่สำเร็จ — คอมเมนต์อาจเก่าเกินกรอบเวลา หรือเคยตอบไปแล้ว");
        send = { message_id: pr?.id || pr?.message_id || null };
        gotPsid = pr?.recipient_id ? String(pr.recipient_id) : null;
        } else if (row.source === "instagram") {
          send = await sendWithNativeReply(
            (message, extra) => sendInstagramMessage(row.page_id, pageTok, row.psid, message, extra),
            replyText, quotedText, metaNativeMid
          );
        } else {
          // ส่งผ่าน Send API (RESPONSE ก่อน, เกิน 24 ชม.ค่อย fallback Human Agent)
          const lastCustomerAt = [...transcript].reverse().find((m: any) => m?.w === "u" && m?.at)?.at;
          const outsideResponseWindow = !!lastCustomerAt && Date.now() - new Date(lastCustomerAt).getTime() > 23.9 * 60 * 60 * 1000;
          send = await sendWithNativeReply(
            (message, extra) => sendMessage(row.page_id, pageTok, row.psid, message, GRAPH_VERSION, outsideResponseWindow, extra),
            replyText, quotedText, metaNativeMid
          );
        }
      }

      // ต่อ transcript ฝั่งเพจ + ปลดธง "ยังไม่ได้ตอบ"
      const nowIso = new Date().toISOString();
      // สถิติการตอบ: บันทึกก่อน append (transcript ตอนนี้คือสภาพ "กำลังรอ")
      const statTask = recordReplyStat(admin, row, String(body?.by || ""), transcript, nowIso);
      const statRuntime = (globalThis as any).EdgeRuntime;
      if (statRuntime?.waitUntil) statRuntime.waitUntil(statTask);
      const via = row.source === "line" ? "line" : isInstagramComment ? "instagram_comment_public" : isComment ? (commentReplyMode === "public" ? "comment_public" : "private_reply") : row.source === "instagram" ? "instagram" : "messenger";
      const replyItem = {
        w: "p", t: replyText, at: nowIso, by: String(body?.by || ""), mid: send?.message_id || null, via,
        ...(replyToText ? { reply_to_text: replyToText.slice(0, 10_000) } : {}),
        ...(replyToMid ? { reply_to_mid: replyToMid } : {}),
        ...(replyToImg ? { reply_to_img: replyToImg } : {}),
        ...(replyToAt ? { reply_to_at: replyToAt } : {}),
        ...(send?.quote_token ? { quote_token: send.quote_token } : {}),
        ...(replyText !== textTh ? { th: textTh } : {}),
      };
      const newTranscript = [...transcript, replyItem];
      const updSend: Record<string, unknown> = { transcript: newTranscript, awaiting_reply: false, unread: false, read_at: nowIso, cust_lang: lang, last_reply_text: String(replyText || "").slice(0, 300), last_reply_by: String(body?.by || ""), last_reply_at: nowIso, last_message_at: nowIso, updated_at: nowIso };
      let conversationId = id;
      let mergedIntoExisting = false;

      if (isComment && commentReplyMode === "private" && gotPsid) {
        // Meta คืน PSID หลัง Private Reply: ถ้าคนนี้เคยแชทกับเพจแล้ว ให้ต่อเข้าแชทเดิมแทนการสร้างห้องซ้ำ
        const { data: oldRows } = await admin.from("chat_customers")
          .select("id, transcript")
          .eq("page_id", row.page_id).eq("psid", gotPsid).neq("id", id)
          .not("id", "like", "fbc_%").or("source.is.null,source.neq.comment")
          .order("last_message_at", { ascending: false }).limit(1);
        const old = oldRows?.[0];
        if (old) {
          const oldTranscript = Array.isArray(old.transcript) ? old.transcript : [];
          const commentId = id.replace(/^fbc_/, "");
          const hasContext = oldTranscript.some((m: any) => m?.comment_id === commentId);
          const commentItem = {
            w: "u", t: `💬 คอมเมนต์: ${String(row.last_user_text || "").slice(0, 500)}`,
            at: row.last_message_at || nowIso, via: "comment", comment_id: commentId,
          };
          const mergedTranscript = [...oldTranscript, ...(hasContext ? [] : [commentItem]), replyItem].slice(-80);
          await admin.from("chat_customers").update({
            transcript: mergedTranscript,
            last_user_text: row.last_user_text || null,
            last_reply_text: replyText,
            last_reply_by: String(body?.by || ""),
            last_reply_at: nowIso,
            last_message_at: nowIso,
            awaiting_reply: false, unread: false, updated_at: nowIso,
          }).eq("id", old.id);
          // เก็บคอมเมนต์ไว้ในแท็บความคิดเห็น แต่ไม่ promote เป็นห้องใหม่และไม่ผูก PSID ซ้ำ
          await admin.from("chat_customers").update({
            transcript: newTranscript, awaiting_reply: false, unread: false,
            comment_promoted_to_inbox: false, updated_at: nowIso,
          }).eq("id", id);
          conversationId = old.id;
          mergedIntoExisting = true;
        }
      }

      if (!mergedIntoExisting) {
        if (gotPsid && !row.psid) updSend.psid = gotPsid;   // ไม่มีแชทเดิม → ใช้แถวนี้เป็นห้อง Messenger ใหม่
        if (isComment && commentReplyMode === "private") updSend.comment_promoted_to_inbox = true;
        await admin.from("chat_customers").update(updSend).eq("id", id);
      }
      // สร้างคู่คำถาม/คำตอบเป็น candidate เท่านั้น (ยังค้นไม่เจอจนกว่าแอดมินอนุมัติ)
      // เก็บเฉพาะช่วงคำถามล่าสุด ไม่คัดลอกประวัติทั้งห้อง และตัด PII ก่อนบันทึก
      const recentQuestions: string[] = [];
      for (let i = transcript.length - 1; i >= 0 && recentQuestions.length < 3; i--) {
        const m = transcript[i];
        if (m?.w === "p") break;
        if (m?.w === "u" && String(m?.t || "").trim()) recentQuestions.unshift(String(m.t));
      }
      const knowledgeQuestion = redactKnowledgeText(recentQuestions.join("\n"));
      const knowledgeAnswer = redactKnowledgeText(textTh);
      if (knowledgeQuestion.length >= 3 && knowledgeAnswer.length >= 4) {
        const sourceKey = `${conversationId}:${send?.message_id || hashText(`${nowIso}|${knowledgeQuestion}|${knowledgeAnswer}`)}`;
        const saveCandidate = admin.from("knowledge_qa").upsert({
          source_key: sourceKey, page_id: row.page_id, source: row.source || "messenger",
          source_chat_id: conversationId, question: knowledgeQuestion, answer: knowledgeAnswer,
          language: lang || row.cust_lang || null, status: "pending", created_by: String(body?.by || "") || null,
          updated_at: nowIso,
        }, { onConflict: "source_key", ignoreDuplicates: true });
        if (statRuntime?.waitUntil) statRuntime.waitUntil(saveCandidate); else await saveCandidate;
      }
      if (!isComment) await clearRelatedUnread(admin, { ...row, id: conversationId, psid: gotPsid || row.psid }, nowIso, true);
      await syncPushState(conversationId);
      return json({ ok: true, sent_text: replyText, delivered_text: send?._delivered_text || outText, reply_mode: send?._reply_mode || null, lang, message_id: send?.message_id || null, quote_token: send?.quote_token || null, via, delivery_mode: send?._delivery_mode || null, conversation_id: conversationId, merged_into_existing: mergedIntoExisting, reply_to_text: replyToText || null, reply_to_mid: replyToMid || null, reply_to_img: replyToImg || null, reply_to_at: replyToAt || null });
    }

    // ---------- ดึงรูปโปรไฟล์ลูกค้า (เก็บไว้ใช้ในลิสต์) ----------
    if (action === "profile") {
      if (!row.psid) return json({ ok: true, profile_pic: row.profile_pic || null });
      // เฉพาะ IG เท่านั้น — FB ปิด User Profile API แล้ว (GET /{psid}?fields=profile_pic คืน error 100/33) ยิงไปก็เปล่า
      if (row.source !== "instagram") return json({ ok: true, profile_pic: row.profile_pic || null });
      const token = await getMetaToken();
      const pd = await getMetaPages(GRAPH_BASE, token, {
        mustIncludePageId: row.page_id,
        mustIncludeInstagramForPageId: row.source === "instagram" ? row.page_id : undefined,
      });
      const pageTok = (pd?.data ?? []).find((p: any) => p.id === row.page_id)?.access_token;
      if (!pageTok) return json({ ok: true, profile_pic: row.profile_pic || null });
      const prof = await fetchJson(`https://graph.facebook.com/${GRAPH_VERSION}/${row.psid}?fields=name,username,profile_pic&access_token=${pageTok}`);
      const pic = prof?.profile_pic || null;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (pic) upd.profile_pic = pic;
      if (prof?.name && !row.customer_name) upd.customer_name = prof.name;
      await admin.from("chat_customers").update(upd).eq("id", id);
      return json({ ok: true, profile_pic: pic, name: prof?.name || null });
    }

    // ---------- ส่งไฟล์/รูปภาพเข้า Messenger (รับเป็น URL ที่อัปโหลดไว้แล้ว) ----------
    if (action === "send_attachment") {
      if (!row.psid) throw new Error("บทสนทนานี้ไม่มี PSID ส่งไม่ได้");
      const url = String(body?.url || "");
      const type = ["image", "video", "audio", "file"].includes(String(body?.type)) ? String(body.type) : "file";
      const filename = String(body?.filename || "");
      if (!url) throw new Error("ไม่มีไฟล์");
      let send: any;
      if (row.source === "line") {
        if (!['image', 'video', 'audio'].includes(type)) throw new Error("LINE OA รองรับการส่งรูป วิดีโอ และเสียงจากแอปนี้ แต่ยังไม่รองรับไฟล์ทั่วไป");
        const cfg = await getLineConfig();
        if (!cfg.accessToken) throw new Error("ยังไม่ได้ตั้งค่า LINE Channel access token");
        const lineMessage = type === "image"
          ? { type: "image", originalContentUrl: url, previewImageUrl: url }
          : type === "video"
            ? { type: "video", originalContentUrl: url, previewImageUrl: url }
            : { type: "audio", originalContentUrl: url, duration: Number(body?.duration || 1000) };
        send = await lineApi("/v2/bot/message/push", cfg.accessToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: row.psid, messages: [lineMessage] }) });
        send = { ...send, message_id: send?.sentMessages?.[0]?.id || null };
      } else {
        const token = await getMetaToken();
        const pd = await getMetaPages(GRAPH_BASE, token, {
          mustIncludePageId: row.page_id,
          mustIncludeInstagramForPageId: row.source === "instagram" ? row.page_id : undefined,
        });
        const metaPage = (pd?.data ?? []).find((p: any) => p.id === row.page_id);
        const pageTok = metaPage?.access_token;
        if (!pageTok) throw new Error("ไม่พบ access token ของเพจนี้");
        if (row.source === "instagram" && !metaPage?.instagram_business_account?.id) throw new Error("ไม่พบบัญชี Instagram Business ที่เชื่อมกับเพจนี้");
        const attachment = { attachment: { type, payload: { url, is_reusable: false } } };
        send = row.source === "instagram"
          ? await sendInstagramMessage(row.page_id, pageTok, row.psid, attachment)
          : await sendMessage(row.page_id, pageTok, row.psid, attachment, GRAPH_VERSION);
      }
      const nowIso = new Date().toISOString();
      const label = type === "image" ? "[รูปภาพ]" : type === "video" ? "[วิดีโอ]" : type === "audio" ? "[เสียง]" : `[ไฟล์: ${filename || "attachment"}]`;
      const statTask = recordReplyStat(admin, row, String(body?.by || ""), transcript, nowIso); // สถิติการตอบ (ก่อน append)
      const statRuntime = (globalThis as any).EdgeRuntime;
      if (statRuntime?.waitUntil) statRuntime.waitUntil(statTask); else await statTask;
      const item: Record<string, unknown> = { w: "p", t: label, at: nowIso, by: String(body?.by || ""), mid: send?.message_id || null, via: row.source === "line" ? "line" : row.source === "instagram" ? "instagram" : "messenger" };
      if (type === "image" || type === "video") item.img = url;   // เก็บ URL ไว้แสดงรูปในแชท
      const newTr = [...transcript, item];
      await admin.from("chat_customers").update({ transcript: newTr, awaiting_reply: false, unread: false, read_at: nowIso, last_reply_text: label, last_reply_by: String(body?.by || ""), last_reply_at: nowIso, last_message_at: nowIso, updated_at: nowIso }).eq("id", id);
      await clearRelatedUnread(admin, row, nowIso, true);
      await syncPushState(id);
      return json({ ok: true, type, img: (type === "image" || type === "video") ? url : null, message_id: send?.message_id || null });
    }

    // ---------- แจ้ง Meta ว่าเพจ "อ่านแล้ว" (mark_seen) — ให้สถานะตรงกับกล่องข้อความเพจ ----------
    if (action === "mark_seen") {
      // read_at = เวลาอ่านในแอป — sync/read_status จะไม่ทับกลับเป็น unread ถ้าไม่มีข้อความใหม่กว่านี้
      const nowIso = new Date().toISOString();
      const clearedIds = await clearRelatedUnread(admin, row, nowIso);
      // แถวที่เคยถูกล้าง unread จากเส้นทางอื่น (echo ของเพจ / รอบ sync) จะไม่มี read_at
      // ซึ่งทำให้ read_status/sync มองว่า "ยังไม่รู้ว่าอ่านหรือยัง" แล้วดันกลับมาเป็นยังไม่อ่าน
      // เปิดอ่านในแอปคือหลักฐานการอ่านที่แน่นอนที่สุด → ประทับเวลาอ่านให้ทุกครั้ง
      if (!clearedIds.length) {
        await admin.from("chat_customers").update({ read_at: nowIso, updated_at: nowIso }).eq("id", id).is("read_at", null);
      }
      if (row.source === "line") {
        const lastReadToken = [...transcript].reverse().find((m: any) => m?.w === "u" && m?.mark_as_read_token)?.mark_as_read_token;
        if (lastReadToken) {
          try {
            const cfg = await getLineConfig();
            if (cfg.accessToken) await lineApi("/v2/bot/chat/markAsRead", cfg.accessToken, {
              method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ markAsReadToken: lastReadToken }),
            });
          } catch (_e) { /* อ่านในแอปสำเร็จแม้ LINE mark-as-read ชั่วคราวล้ม */ }
        }
      }
      // was_unread = หน้าเว็บเพิ่งเขียน unread=false ลงฐานข้อมูลเองก่อนเรียกมา (กันจุดแดงเด้งกลับตอน poll)
      // ถ้าเช็คแค่ row.unread จะกลายเป็นไม่เคยแจ้ง Meta เลย ทำให้กล่องข้อความเพจยังขึ้นว่ายังไม่อ่าน
      if ((row.unread || body?.was_unread === true) && row.psid && row.source !== "line") {
        const token = await getMetaToken();
        const pd = await getMetaPages(GRAPH_BASE, token, { mustIncludePageId: row.page_id });
        const pageTok = (pd?.data ?? []).find((p: any) => p.id === row.page_id)?.access_token;
        if (pageTok) {
          await fetchJson(`${GRAPH_BASE}/${row.page_id}/messages?access_token=${pageTok}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ recipient: { id: row.psid }, sender_action: "mark_seen" }),
          });
        }
      }
      await syncPushState(id);
      return json({ ok: true, cleared: clearedIds.length });
    }

    throw new Error("action ไม่ถูกต้อง (translate | preview | send | send_attachment | profile | saved_replies | mark_seen | summarize)");
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 200);
  }
});
