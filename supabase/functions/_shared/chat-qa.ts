// ดึงคู่ "ลูกค้าถาม → แอดมินตอบ" จาก transcript ของห้องแชท (ใช้ทำ AI ช่วยร่างคำตอบ)
// ไม่มี import ภายนอก — tests/chat-qa.test.mjs เรียกตรงด้วย node
//
// กติกา:
//   · คำถาม = ข้อความลูกค้าที่ติดกัน (รวมเป็นก้อนเดียว) · คำตอบ = ข้อความแอดมินที่ติดกันถัดจากนั้น
//   · ข้ามข้อความอัตโนมัติ: auto_reply (เช่น ตอบอัตโนมัติ LINE OA) และข้อความที่ส่งจากแอปอื่น (มี app = บอท/แชทบอท)
//   · ลูกค้าส่งแต่รูป/สติกเกอร์ = ไม่มีคำถามเป็นข้อความ ข้าม · แอดมินตอบแต่รูป = เก็บจำนวนรูปไว้ (คำตอบเป็นข้อความว่าง)
//   · ลูกค้าต่างชาติ: เก็บทั้งต้นฉบับและคำแปลไทย (th) ที่ระบบแปลไว้แล้ว
//   · ปิดบังข้อมูลส่วนตัวก่อนเก็บ: อีเมล / เบอร์โทร / ตัวเลขยาว (ไอดีเทรด เลขบัญชี) / ลิงก์ที่มี token
export type QaPair = {
  q_key: string; a_key: string;
  q_text: string; q_th: string | null; a_text: string; a_images: number;
  q_at: string; a_at: string; response_sec: number | null; answered_by: string | null; context: string | null;
};

const MAX_Q = 800, MAX_A = 1500, MAX_CTX = 300;

export function maskPii(text: string): string {
  return String(text || "")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[อีเมล]")
    .replace(/(\+?66|0)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}\b/g, "[เบอร์โทร]")
    .replace(/(?<!\d)\d{6,}(?!\d)/g, "[ตัวเลข]")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g, "$1");
}

// กุญแจรวบแพทเทิร์นซ้ำ: ตัดชื่อลูกค้า (คุณXXX) ช่องว่าง เครื่องหมาย อีโมจิ แล้ว hash
//   แอดมินส่งข้อความบันทึกเดิมซ้ำ ๆ / ลูกค้าถามประโยคเดิม → ได้กุญแจเดียวกัน (chat_qa_patterns นับรวมให้)
export function normKey(text: string): string {
  const n = String(text || "").toLocaleLowerCase("th")
    .replace(/คุณ\s*\S+/g, "คุณ")
    .replace(/\[(อีเมล|เบอร์โทร|ตัวเลข)\]/g, "#")
    .replace(/https?:\/\/\S+/g, "url")
    .replace(/[^\p{L}\p{N}#]/gu, "");
  if (!n) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < n.length; i++) { h ^= n.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${n.length}:${h.toString(36)}`;
}

// ข้อความระบบที่ Meta/แอปแทรกไว้ใน transcript (ไม่ใช่คำพูดของคน) — ตัดทิ้งก่อนจับคู่
const SYSTEM_RE = /^(ตั้งระยะข้อมูลลูกค้าเป็น|Facebook สร้างแชทนี้|คุณได้ตอบกลับโฆษณา|.{0,40} ตอบกลับโฆษณา$|You replied to|.{0,40} replied to an ad)/;
export const isSystemText = (t: string) => SYSTEM_RE.test(String(t || "").trim());

const isAuto = (m: any) => !!m?.auto_reply || !!m?.app || /ตอบอัตโนมัติ/.test(String(m?.by || ""));
const textOf = (m: any) => String(m?.t || "").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export function extractQaPairs(transcript: unknown): QaPair[] {
  const msgs = (Array.isArray(transcript) ? transcript : [])
    .filter((m: any) => m && (m.w === "u" || m.w === "p") && m.at && !m.pending && !m._tmp && !isSystemText(m.t))
    .sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at));
  // ก้อนข้อความติดกันฝั่งเดียวกัน — ข้อความอัตโนมัติฝั่งเพจตัดก้อนทิ้ง (ไม่ใช่คำตอบของคน)
  type Block = { w: "u" | "p"; msgs: any[]; auto: boolean };
  const blocks: Block[] = [];
  for (const m of msgs) {
    const auto = m.w === "p" && isAuto(m);
    const last = blocks[blocks.length - 1];
    if (last && last.w === m.w && last.auto === auto) last.msgs.push(m);
    else blocks.push({ w: m.w, msgs: [m], auto });
  }
  const out: QaPair[] = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    const q = blocks[i], a = blocks[i + 1];
    if (q.w !== "u" || a.w !== "p" || a.auto) continue;
    const qText = q.msgs.map(textOf).filter(Boolean).join("\n");
    if (!qText) continue;
    const qTh = q.msgs.some((m) => m.th) ? q.msgs.map((m) => String(m.th || m.t || "").trim()).filter(Boolean).join("\n") : null;
    const aText = a.msgs.map(textOf).filter(Boolean).join("\n");
    const aImages = a.msgs.filter((m) => m.img || m.image || m.attachments).length;
    if (!aText && !aImages) continue;
    const qAt = q.msgs[q.msgs.length - 1].at, aAt = a.msgs[0].at;
    const sec = Math.round((Date.parse(aAt) - Date.parse(qAt)) / 1000);
    // บริบท = ข้อความสุดท้ายก่อนคำถาม (มักเป็นสิ่งที่แอดมินถามไปก่อน เช่น "ขอไอดีเทรดค่ะ")
    const prev = blocks[i - 1];
    const ctx = prev ? prev.msgs.map(textOf).filter(Boolean).slice(-2).join("\n") : "";
    const by = a.msgs.map((m) => String(m.by || "")).find(Boolean) || null;
    const qMasked = maskPii(qText), aMasked = maskPii(aText);
    out.push({
      q_key: normKey(qMasked) || "empty",
      a_key: normKey(aMasked) || `img:${aImages}`,
      q_text: clip(qMasked, MAX_Q),
      q_th: qTh && qTh !== qText ? clip(maskPii(qTh), MAX_Q) : null,
      a_text: clip(aMasked, MAX_A),
      a_images: aImages,
      q_at: qAt, a_at: aAt,
      response_sec: Number.isFinite(sec) && sec >= 0 ? sec : null,
      answered_by: by,
      context: ctx ? clip(maskPii(ctx), MAX_CTX) : null,
    });
  }
  return out;
}

// ---------- ค้นแพทเทิร์นที่ใกล้กับคำถามล่าสุด (ใช้ตอน AI ร่างคำตอบ) ----------
// ภาษาไทยไม่เว้นวรรค → เทียบด้วย "ตัวอักษรติดกันทีละ 2 ตัว" (bigram) แทนคำ · ไม่ต้องมี index/embedding (DB micro)
const simNorm = (s: string) => String(s || "").toLocaleLowerCase("th")
  .replace(/คุณ\s*\S+/g, "คุณ").replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}]/gu, "");
function bigrams(s: string): Set<string> {
  const n = simNorm(s), out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  if (n.length === 1) out.add(n);
  return out;
}
// Dice coefficient 0..1
export function textSimilarity(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

export type PatternLike = { a_key?: string; a_text: string; uses?: number; q_samples?: string[] | null };
// คะแนน = ความเหมือนกับตัวอย่างคำถามที่ใกล้สุด + โบนัสเล็กน้อยตามจำนวนครั้งที่แอดมินเคยใช้คำตอบนี้
//   min = ตัดตัวที่ไม่เกี่ยวเลยทิ้ง (ส่งให้ AI น้อยแต่ตรง ดีกว่าส่งเยอะแล้วมันหยิบผิด)
//   (เกณฑ์ min เทียบกับความเหมือนล้วน ๆ — โบนัสจำนวนครั้งใช้แค่จัดลำดับ ไม่ให้คำตอบยอดฮิตหลุดเข้ามาทั้งที่ไม่เกี่ยว)
export function rankPatterns<T extends PatternLike>(query: string, patterns: T[], k = 6, min = 0.25): (T & { score: number })[] {
  if (!simNorm(query)) return [];
  return patterns
    .map((p) => {
      const best = Math.max(0, ...(p.q_samples || []).map((q) => textSimilarity(query, q)));
      return { ...p, sim: best, score: best + Math.min(0.08, Math.log10(1 + Number(p.uses || 0)) * 0.03) };
    })
    .filter((p) => p.sim >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------- ตรวจร่างของ AI ก่อนคืนให้แอดมิน ----------
// ลิงก์ในร่างต้องมีอยู่จริงในบทสนทนา/คำตอบอ้างอิง (เทียบแบบตัด query) — ไม่มี = AI แต่งขึ้น ตัดทิ้ง
// [ตัวเลข]/[อีเมล]/[เบอร์โทร] คือข้อมูลที่เราปิดไว้ ห้ามหลุดไปถึงลูกค้า → เว้นเป็น ___ ให้แอดมินเติม
const urlBase = (u: string) => u.replace(/[?#].*$/, "").replace(/[).,!]+$/, "").toLowerCase();
export function groundDraft(reply: string, allowedText: string): { reply: string; removedLinks: string[]; blanks: number } {
  const allowed = new Set((String(allowedText || "").match(/https?:\/\/[^\s]+/g) || []).map(urlBase));
  const removedLinks: string[] = [];
  let out = String(reply || "").replace(/https?:\/\/[^\s]+/g, (u) => {
    if (allowed.has(urlBase(u))) return u;
    removedLinks.push(u);
    return "";
  });
  let blanks = 0;
  out = out.replace(/\[(ตัวเลข|อีเมล|เบอร์โทร)\]/g, () => { blanks++; return "___"; });
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { reply: out, removedLinks, blanks };
}

// ความมั่นใจ = ค่าที่ AI ให้ตัวเอง แต่ "ไม่เกินเพดาน" ตามหลักฐานจริง
//   AI มักให้ตัวเอง 100% เสมอ — เพดานมาจากความเหมือนของคำถามกับแพทเทิร์นที่ใกล้สุด
export function draftConfidence(model: number, topSim: number, opts: { removedLinks?: number; adminSpokeLast?: boolean } = {}): number {
  let cap = topSim >= 0.6 ? 0.95 : topSim >= 0.45 ? 0.8 : topSim >= 0.3 ? 0.6 : 0.45;
  if (opts.adminSpokeLast) cap = Math.min(cap, 0.6);
  if (opts.removedLinks) cap = Math.min(cap, 0.35);
  const m = Number.isFinite(model) ? Math.max(0, Math.min(1, model)) : 0.5;
  return Math.round(Math.min(m, cap) * 100) / 100;
}
