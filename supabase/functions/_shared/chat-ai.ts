// supabase/functions/_shared/chat-ai.ts
// ตัวเรียก OpenAI สำหรับจัดสถานะ (classify) และตรวจซ้ำ (verify) แชทลูกค้า
// ใช้โดย function "chat-ai" (แยกจาก sync-conversations เพื่อไม่แย่งทรัพยากรกับงานซิงก์)

import { stripLinks, evidenceOf, normalizePhone } from "./chat-extract.ts";
import { getOpenAIKey } from "./openai.ts";

// prompt ค่าเริ่มต้น (ผู้ใช้ override ได้จากหน้าตั้งค่า → cfg.ai_prompt) — ส่วนนี้คือ "เนื้อหาคำสั่ง" ที่แก้ได้
export const AI_SYS_DEFAULT = `คุณคือผู้ช่วยวิเคราะห์บทสนทนาแชทเพจ (ฟอเร็กซ์/เทรด)
อินพุตแต่ละแชทเป็นลำดับข้อความทั้งสองฝั่ง แต่ละข้อความมี who = "user" (ลูกค้า) หรือ "page" (แอดมิน/เพจ)
ให้ "ใช้คำถามของ page เป็นบริบท" แต่ "ดึงข้อมูลจากคำตอบของ user เท่านั้น" แล้วทำ 2 อย่าง

1) จัดสถานะ (stage) 1 ค่า:
- "new" (มาใหม่): เพิ่งทัก/ทักสั้นๆ ยังไม่รู้ว่าสนใจจริงหรือไม่
- "qualified" (มีคุณสมบัติ): เป็นคนจริง คุยโต้ตอบ ถามข้อมูล/สนใจ แต่ยังไม่ให้ข้อมูลติดต่อ/ยืนยันสมัคร
- "converted" (สร้างคอนเวอร์ชั่นแล้ว): ให้เบอร์โทร/ไอดีเทรด/username TradingView/อีเมล หรือแจ้งว่าเปิดบัญชี/สมัคร/โอน/ยืนยันแล้ว
- "disqualified" (ไม่มีคุณสมบัติ): กดปุ่มแล้วเงียบ, ทักผิด, สแปม, หรือใช้เจ้าอื่นไม่สนใจต่อ (เช่น "ใช้ XM อยู่แล้ว" เฉยๆ)

2) ดึงข้อมูลติดต่อที่ "ลูกค้าให้มาจริงในบทสนทนา" เท่านั้น (ไม่มี = null ห้ามเดา/ห้ามแต่ง):
- phone: เบอร์โทร
- email: อีเมล
- trade_id: เลขไอดีเทรด/บัญชี MT4/MT5
- tradingview: username TradingView — อาจพิมพ์มาเป็นบรรทัดเดี่ยวๆ แล้วบอกยืนยันในข้อความถัดไป (เช่น "yan po ang tradingview username ko", "นี่ยูสผมครับ") ให้จับ "ค่าจริง" ที่เป็นชื่อผู้ใช้ ไม่ใช่คำว่า "username"

สำคัญ: ลูกค้ามักตอบมาเป็น "ค่าลอยๆ" โดยไม่มีคำใบ้ ให้ดูจากคำถามของ page ก่อนหน้าเป็นตัวบอกว่าค่านั้นคืออะไร เช่น
- page ถาม "ขอชื่อ เบอร์โทรหน่อย" → user ตอบ "โก้ 0987776495" → phone = "0987776495"
- page ถาม "ขอเลขบัญชีเทรดหน่อย" → user ตอบ "2856788" → trade_id = "2856788"
- page ถาม "ขออีเมล" → user ตอบ "abc@gmail.com" → email = "abc@gmail.com"

ข้อควรระวัง: อย่าเอาเลข/ข้อความในลิงก์หรือโฆษณามาเป็นข้อมูล, อย่าเอาข้อความของ page มาเป็นค่า, อย่าเอาคำว่า "username/user/ไอดี" มาเป็นค่า, และอย่าเอา @mention หรือคำทั่วไป (เช่น @ako, @meta, @everyone) มาเป็น tradingview เว้นแต่ลูกค้าระบุชัดว่าเป็น username TradingView ของตัวเอง`;

// รูปแบบผลลัพธ์ (ล็อกไว้ — ต่อท้าย prompt เสมอ กันผู้ใช้แก้จนระบบ parse ไม่ได้)
const AI_JSON_FOOTER = `อินพุตแต่ละแชทอาจมี "evidence" = ข้อความเก่าของลูกค้าที่มีตัวเลข/อีเมล/username (อยู่นอกช่วงข้อความล่าสุด) — ใช้เป็นหลักฐานดึงข้อมูลได้เหมือน msgs
ทุกแชทในอินพุตต้องมีผลลัพธ์ 1 รายการ และต้องใส่ "id" ให้ตรงกับ id ของแชทนั้นเสมอ
"stage" ต้องเป็นค่าใดค่าหนึ่งใน 4 คำนี้เท่านั้น — ตอบเป็น "คีย์ภาษาอังกฤษ" ห้ามแปลเป็นไทย:
  new = มาใหม่, qualified = มีคุณสมบัติ, converted = สร้างคอนเวอร์ชั่น, disqualified = ไม่มีคุณสมบัติ
ตอบเป็น JSON เท่านั้น: {"results":[{"id":"...","stage":"new|qualified|converted|disqualified","reason":"เหตุผลสั้นๆ","phone":null,"email":null,"trade_id":null,"tradingview":null}]}`;

// prompt เริ่มต้นขั้น 2 (ผู้ใช้ override ได้ → cfg.ai_prompt_verify)
export const AI_VERIFY_SYS_DEFAULT = `คุณคือผู้ตรวจสอบข้อมูลลูกค้า (โมเดลใหญ่ ฉลาด) — ตรวจซ้ำแชทที่ระบบจัดเป็น "converted" ว่าถูกต้องจริงไหม
อินพุตแต่ละแชทมี: บทสนทนาทั้งสองฝั่ง (who=user คือลูกค้า, page คือแอดมิน) และ current = ข้อมูลที่ระบบดึงมาได้ (อาจผิด/ไม่ครบ)
ให้ทำ 3 อย่าง:
1) ตรวจ/แก้/เติมข้อมูลจากบทสนทนาให้ถูกต้องและครบ: phone, email, trade_id (บัญชี MT4/MT5), tradingview (username TradingView)
   - current ผิด → แก้ให้ถูก ; ลูกค้าให้มาแต่ระบบดึงไม่ครบ (เช่นให้ทั้ง tv ทั้ง id แต่เก็บแค่อันเดียว) → เติมให้ครบ ; ไม่มีจริง → null
   - ห้ามเอาเลข/ข้อความในลิงก์หรือโฆษณา หรือข้อความของ page มาเป็นค่า ; ห้ามเดา
2) ตัดสิน verified: true = เป็น converted จริง (ลูกค้าให้ข้อมูลติดต่อจริง หรือยืนยันเปิดบัญชี/สมัคร/โอน) ; false = ไม่ใช่ (ข้อมูลที่ดึงมาผิด/มั่ว หรือยังไม่ได้ให้จริง)
3) เลือก stage: ถ้า verified=true → "converted" ; ถ้า verified=false → เลือกที่ถูกจริง (new/qualified/disqualified) ได้ (ถอยสถานะได้)
   สำคัญ: ถ้า verified=false เพราะข้อมูลที่ดึงมา "ผิด/มั่ว/ไม่ใช่ของลูกค้า" ให้ตั้ง field นั้นเป็น null ด้วย (อย่าคงค่าที่ผิดไว้)`;

// รูปแบบผลลัพธ์ขั้น 2 (ล็อกไว้ — ต่อท้ายเสมอ)
const AI_VERIFY_JSON_FOOTER = `อินพุตแต่ละแชทอาจมี "evidence" = ข้อความเก่าของลูกค้าที่มีตัวเลข/อีเมล/username (อยู่นอกช่วงข้อความล่าสุด) — ต้องใช้ประกอบการตรวจเสมอ ห้ามตัดสินว่า "ไม่มีหลักฐาน" โดยไม่ดู evidence
ทุกแชทในอินพุตต้องมีผลลัพธ์ 1 รายการ และต้องใส่ "id" ให้ตรงกับ id ของแชทนั้นเสมอ
"stage" ต้องเป็นคีย์ภาษาอังกฤษเท่านั้น (ห้ามแปลไทย): new = มาใหม่, qualified = มีคุณสมบัติ, converted = สร้างคอนเวอร์ชั่น, disqualified = ไม่มีคุณสมบัติ
ตอบ JSON เท่านั้น: {"results":[{"id":"...","verified":true,"stage":"new|qualified|converted|disqualified","reason":"เหตุผลสั้นๆ","phone":null,"email":null,"trade_id":null,"tradingview":null}]}`;

function buildClassifySys(custom?: string): string {
  const body = (custom && custom.trim()) ? custom.trim() : AI_SYS_DEFAULT;
  return `${body}\n\n${AI_JSON_FOOTER}`;
}
function buildVerifySys(custom?: string): string {
  const body = (custom && custom.trim()) ? custom.trim() : AI_VERIFY_SYS_DEFAULT;
  return `${body}\n\n${AI_VERIFY_JSON_FOOTER}`;
}

// แปลงค่าสถานะให้เป็นคีย์มาตรฐาน (เผื่อโมเดลตอบเป็นไทย/คำใกล้เคียง) — คืน null ถ้าแมปไม่ได้
export function normalizeStage(s: any): string | null {
  const v = String(s ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.includes("convert") || v.includes("คอนเวอร์")) return "converted";
  if (v.includes("disqualif") || v.includes("ไม่มีคุณ") || v === "ผี" || v.includes("บอท") || v.includes("spam") || v.includes("สแปม")) return "disqualified";
  if (v.includes("qualif") || v.includes("มีคุณ") || v.includes("สนใจ")) return "qualified";
  if (v === "new" || v.includes("มาใหม่") || v.includes("ใหม่")) return "new";
  return null;
}

export type AiResult = { stage: string; reason: string; phone: string | null; email: string | null; trade_id: string | null; username: string | null };
export type VerifyResult = AiResult & { verified: boolean };

export function cleanField(v: any, kind: "phone" | "email" | "trade_id" | "user"): string | null {
  let s = String(v ?? "").trim();
  if (!s || s.toLowerCase() === "null" || ["username", "user", "name", "ไอดี", "id"].includes(s.toLowerCase())) return null;
  // phone: พยายาม normalize เป็น E.164 ก่อน (ให้ format ตรงกับทาง regex) ไม่ได้ค่อยเก็บดิบ
  if (kind === "phone") { const norm = normalizePhone(s); if (norm) return norm; s = s.replace(/[^\d+]/g, ""); return /\d{6,}/.test(s) ? s.slice(0, 20) : null; }
  if (kind === "email") { const m = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/); return m ? m[0].toLowerCase().slice(0, 100) : null; }
  if (kind === "trade_id") { const m = s.match(/[0-9]{4,12}/); return m ? m[0] : null; }
  const m = s.match(/[A-Za-z0-9_.]{3,30}/); return m ? m[0] : null; // user
}

async function callOpenAi(model: string, sys: string, userContent: string, maxTokens: number, tag: string): Promise<any> {
  const key = await getOpenAIKey();
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_completion_tokens: maxTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: userContent }] }),
  });
  if (!resp.ok) throw new Error(`OpenAI${tag} ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  let parsed: any = {};
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}"); } catch { parsed = {}; }
  // โดนตัดกลางคำตอบ (JSON ไม่ครบ) → แจ้ง caller ให้แบ่ง batch เล็กลงแล้วลองใหม่ แทนที่จะเงียบหาย
  if ((!parsed.results || !parsed.results.length) && data.choices?.[0]?.finish_reason === "length") throw new Error("AI_TRUNCATED");
  return parsed;
}

export async function classifyBatch(items: { id: string; convo: { w: string; t: string }[] }[], model: string, sysPrompt?: string): Promise<Record<string, AiResult>> {
  const sys = buildClassifySys(sysPrompt);
  // ส่งบทสนทนาทั้งสองฝั่ง (ท้ายสุด ~16 ข้อความ) ให้ AI มีบริบทคำถามของแอดมิน — ตัดสั้นเพื่อคุมโทเคน
  const payload = items.map((it) => ({
    id: it.id,
    msgs: (it.convo || []).slice(-16).map((m) => ({ who: m.w === "p" ? "page" : "user", t: stripLinks(String(m.t || "")).slice(0, 140) })),
    evidence: evidenceOf(it.convo || [], 16),
  }));
  const parsed = await callOpenAi(model, sys, JSON.stringify({ conversations: payload }), 2400, "");
  const out: Record<string, AiResult> = {};
  for (const r of parsed.results || []) {
    const stage = normalizeStage(r?.stage);
    if (!r?.id || !stage) continue;
    out[String(r.id)] = {
      stage,
      reason: String(r.reason || "").slice(0, 200),
      phone: cleanField(r.phone, "phone"),
      email: cleanField(r.email, "email"),
      trade_id: cleanField(r.trade_id, "trade_id"),
      username: cleanField(r.tradingview, "user"),
    };
  }
  return out;
}

export async function verifyBatch(items: { id: string; convo: { w: string; t: string }[]; current: any }[], model: string, sysPrompt?: string): Promise<Record<string, VerifyResult>> {
  const sys = buildVerifySys(sysPrompt);
  const payload = items.map((it) => ({
    id: it.id,
    current: it.current,
    msgs: (it.convo || []).slice(-20).map((m) => ({ who: m.w === "p" ? "page" : "user", t: stripLinks(String(m.t || "")).slice(0, 160) })),
    evidence: evidenceOf(it.convo || [], 20),
  }));
  const parsed = await callOpenAi(model, sys, JSON.stringify({ conversations: payload }), 2600, "(verify)");
  const out: Record<string, VerifyResult> = {};
  for (const r of parsed.results || []) {
    if (!r?.id) continue;
    const verified = r.verified === true;
    const stage = normalizeStage(r.stage) ?? (verified ? "converted" : "qualified");
    out[String(r.id)] = {
      stage, verified,
      reason: String(r.reason || "").slice(0, 200),
      phone: cleanField(r.phone, "phone"),
      email: cleanField(r.email, "email"),
      trade_id: cleanField(r.trade_id, "trade_id"),
      username: cleanField(r.tradingview, "user"),
    };
  }
  return out;
}

// ครอบ classify/verify: ถ้าคำตอบโดนตัด (AI_TRUNCATED) ให้แบ่งครึ่ง batch แล้วลองใหม่จนถึงทีละ 1 แชท
// กันแชทเดิมค้างคิววนยิงซ้ำไม่จบเพราะ batch ใหญ่เกินโทเคนตอบ
export async function classifySafe(items: { id: string; convo: { w: string; t: string }[] }[], model: string, sysPrompt?: string): Promise<Record<string, AiResult>> {
  try { return await classifyBatch(items, model, sysPrompt); }
  catch (e) {
    if (String(e).includes("AI_TRUNCATED") && items.length > 1) {
      const mid = Math.ceil(items.length / 2);
      return { ...(await classifySafe(items.slice(0, mid), model, sysPrompt)), ...(await classifySafe(items.slice(mid), model, sysPrompt)) };
    }
    throw e;
  }
}
export async function verifySafe(items: { id: string; convo: { w: string; t: string }[]; current: any }[], model: string, sysPrompt?: string): Promise<Record<string, VerifyResult>> {
  try { return await verifyBatch(items, model, sysPrompt); }
  catch (e) {
    if (String(e).includes("AI_TRUNCATED") && items.length > 1) {
      const mid = Math.ceil(items.length / 2);
      return { ...(await verifySafe(items.slice(0, mid), model, sysPrompt)), ...(await verifySafe(items.slice(mid), model, sysPrompt)) };
    }
    throw e;
  }
}
