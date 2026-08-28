// supabase/functions/_shared/chat-extract.ts
// ตัวช่วยสกัด/normalize ข้อมูลจากข้อความแชท — ใช้ร่วมกันระหว่าง sync-conversations (ซิงก์) และ chat-ai (งาน AI)
// สำคัญ: contentHashOf ต้องเป็นสูตรเดียวกันทั้งสองฝั่ง ไม่งั้นธง needs_ai/needs_verify จะเพี้ยน

// ตัด "ลิงก์" ออกก่อนสกัดเบอร์/ไอดี — กันเลขในลิงก์สมัคร/แอฟฟิลิเอต/โฆษณา (เช่น ?id=615649559, m.me/...?ref=, profile.php?id=)
// ถูกจับเป็นเบอร์/ไอดีทั้งที่ลูกค้าไม่ได้พิมพ์เอง
export function stripLinks(t: string): string {
  let s = String(t || "");
  // กันอีเมลโดนตัดกฎโดเมน (เช่น "abc@gmail.com" เคยเหลือ "abc@ ") — mask อีเมลไว้ก่อน แล้วคืนหลังตัดลิงก์
  // อีเมลที่อยู่ "ในลิงก์" ยังถูกตัดทิ้งพร้อมลิงก์ตามเดิม (mask โดนกลืนไปกับ URL)
  const emails: string[] = [];
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => { emails.push(m); return `\x00E${emails.length - 1}\x00`; });
  s = s
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/\b[\w.-]+\.(?:com|net|org|co|io|me|link|xyz|info|app|shop|store|club)\b\S*/gi, " ")
    .replace(/\bm\.me\/\S+/gi, " ");
  return s.replace(/\x00E(\d+)\x00/g, (_m, i) => emails[Number(i)] ?? " ");
}

// ---- เบอร์โทรหลายประเทศ (ลูกค้ามีทั้งไทย/ฟิลิปปินส์/อินโด/เวียดนาม/มาเลย์) → normalize เป็น E.164 ----
const CC_RULES: Record<string, RegExp> = {
  "66": /^[689]\d{8}$/,     // ไทย: มือถือ 9 หลักหลัง 0
  "63": /^9\d{9}$/,          // ฟิลิปปินส์: 10 หลักหลัง 0 ขึ้น 9
  "62": /^8\d{8,11}$/,       // อินโดนีเซีย: 08xx ยาว 9-12 หลักหลัง 0
  "84": /^[35789]\d{8}$/,    // เวียดนาม: 9 หลักหลัง 0
  "60": /^1\d{8,9}$/,        // มาเลเซีย: 01x
};
const COUNTRY_CC: Record<string, string> = { "ไทย": "66", "ฟิลิปปินส์": "63", "อินโดนีเซีย": "62", "เวียดนาม": "84", "มาเลเซีย": "60" };
export function normalizePhone(raw: string, country?: string | null): string | null {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length < 9 || d.length > 15) return null;
  // มาแบบมีรหัสประเทศแล้ว
  for (const cc of Object.keys(CC_RULES)) {
    if (d.startsWith(cc)) { const rest = d.slice(cc.length).replace(/^0/, ""); if (CC_RULES[cc].test(rest)) return `+${cc}${rest}`; }
  }
  // มาแบบ 0 นำหน้า → เดารหัสประเทศจาก country ที่รู้ (จากตัวตรวจภาษา) ก่อน แล้วค่อยเดาจากรูปแบบ
  if (d.startsWith("0")) {
    const rest = d.slice(1);
    const hint = country ? COUNTRY_CC[String(country)] : null;
    if (hint && CC_RULES[hint].test(rest)) return `+${hint}${rest}`;
    for (const cc of ["63", "66", "84", "60", "62"]) if (CC_RULES[cc].test(rest)) return `+${cc}${rest}`; // 63 ก่อน 66 (11 หลักชัดกว่า)
  }
  return null;
}

// hash แบบ sync (djb2) — เบา ไม่ต้อง await
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// hash เนื้อหาแชท "ฝั่งลูกค้า" จาก transcript (ใช้ร่วมกันทั้งตอนซิงก์และงาน AI เพื่อให้เทียบกันได้)
// ใช้เฉพาะ 10 ข้อความล่าสุดของลูกค้า — เสถียรต่อการที่ข้อความเก่าหลุดหน้าต่างดึง (ไม่ trigger AI ฟรี)
export function contentHashOf(transcript: any): string {
  const arr = Array.isArray(transcript) ? transcript : [];
  const userTexts = arr.filter((m) => m?.w === "u").map((m) => String(m?.t || ""));
  return hashText(userTexts.slice(-10).join("\n"));
}

// ข้อความ "หลักฐาน" จากทั้ง transcript (มีตัวเลข/อีเมล/@handle) — แนบให้ AI แม้อยู่นอกหน้าต่างข้อความท้าย
// แก้ปัญหาแชทยาว: ลูกค้าให้เบอร์/ไอดีไว้ตอนต้น แล้วโมเดล (โดยเฉพาะตัวตรวจ) มองไม่เห็นจนลบข้อมูลถูกทิ้ง
export function evidenceOf(convo: { w: string; t: string }[], keepLast: number): { who: string; t: string }[] {
  const arr = Array.isArray(convo) ? convo : [];
  const tail = new Set(arr.slice(-keepLast));
  return arr
    .filter((m) => !tail.has(m) && m?.w === "u")
    .filter((m) => { const s = stripLinks(String(m?.t || "")); return /\d{4,}/.test(s) || /@/.test(s) || /(trading\s?view|ยูส|user)/i.test(s); })
    .slice(-12)
    .map((m) => ({ who: "user", t: stripLinks(String(m.t || "")).slice(0, 160) }));
}
