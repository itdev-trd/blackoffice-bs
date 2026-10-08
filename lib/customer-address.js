// ที่อยู่ลูกค้า (เก็บใน chat_customers.address แบบ jsonb) — แยกจากข้อมูลเทรด/สิทธิ์อินดิเคเตอร์โดยสิ้นเชิง
// ใช้ร่วมกันระหว่างหน้าตอบแชท (กรอก/วางจากข้อความลูกค้า) และหน้าจัดการลูกค้า (ดู/คัดลอก/แก้)

export const ADDRESS_FIELDS = ["name", "phone", "line1", "subdistrict", "district", "province", "postcode", "note"];
export const EMPTY_ADDRESS = Object.freeze(Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, ""])));

const BANGKOK = /^(กรุงเทพ(มหานคร|ฯ)?|กทม\.?|bangkok)$/i;
export const isBangkok = (province) => BANGKOK.test(String(province || "").trim());

export function hasAddress(a) {
  return !!a && typeof a === "object" && ["line1", "subdistrict", "district", "province", "postcode"].some((k) => String(a[k] || "").trim());
}

// แถวที่ 2 ของที่อยู่ (ตำบล อำเภอ จังหวัด รหัส) — กรุงเทพใช้ แขวง/เขต ที่เหลือใช้ ต./อ./จ.
export function areaLine(a) {
  if (!a) return "";
  const bkk = isBangkok(a.province);
  return [
    a.subdistrict && `${bkk ? "แขวง" : "ต."}${a.subdistrict}`,
    a.district && `${bkk ? "เขต" : "อ."}${a.district}`,
    a.province && (bkk ? "กรุงเทพมหานคร" : `จ.${a.province}`),
    a.postcode,
  ].filter(Boolean).join(" ");
}

// ข้อความพร้อมแปะใบจ่าหน้า/ส่งให้ขนส่ง
export function formatAddress(a, { withName = true } = {}) {
  if (!hasAddress(a)) return "";
  const head = withName ? [a.name, a.phone && `โทร ${a.phone}`].filter(Boolean).join(" ") : "";
  return [head, a.line1, areaLine(a)].filter(Boolean).join("\n");
}

// สรุปสั้นสำหรับช่องในตาราง — "จ.เชียงใหม่ 50000"
export function shortArea(a) {
  if (!a) return "";
  const prov = a.province ? (isBangkok(a.province) ? "กรุงเทพฯ" : `จ.${a.province}`) : "";
  return [prov, a.postcode].filter(Boolean).join(" ");
}

const take = (s, re) => {
  const m = s.match(re);
  return m ? { value: m[1].trim(), rest: s.replace(m[0], " ") } : { value: "", rest: s };
};

// แยกข้อความที่อยู่ที่ลูกค้าพิมพ์มาเป็นช่อง ๆ — เดาอย่างระวัง ช่องไหนไม่แน่ใจปล่อยว่าง
// แอดมินตรวจก่อนกดบันทึกเสมอ ข้อความที่แยกไม่ได้ทั้งหมดจะไปกองที่ line1 ไม่หายไปไหน
export function parseAddress(text) {
  const out = { ...EMPTY_ADDRESS };
  let s = String(text || "").replace(/\r/g, "").trim();
  if (!s) return out;

  // ชื่อผู้รับ: บรรทัดแรกที่ไม่มีตัวเลขและสั้น หรือขึ้นต้นด้วย "ชื่อ"
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  const named = s.match(/(?:ชื่อ(?:ผู้รับ)?|ผู้รับ|name)\s*[:：]?\s*([^\n\d]{2,60})/i);
  if (named) { out.name = named[1].trim(); s = s.replace(named[0], " "); }
  else if (lines.length > 1 && !/\d/.test(lines[0]) && lines[0].length <= 40 && !/(ต\.|อ\.|จ\.|ตำบล|อำเภอ|จังหวัด|แขวง|เขต|ถนน|ซอย|หมู่)/.test(lines[0])) {
    out.name = lines[0]; s = lines.slice(1).join("\n");
  }

  // เบอร์โทรไทย 9-10 หลัก (มีขีด/เว้นวรรคได้) หรือ +66
  const ph = s.match(/(?<!\d)(?:\+?66[\s-]?|0)\d(?:[\s-]?\d){7,8}(?!\d)/);
  if (ph) { out.phone = ph[0].replace(/[\s-]/g, "").replace(/^\+?66/, "0"); s = s.replace(ph[0], " "); }
  s = s.replace(/(?:เบอร์(?:โทร)?|โทร|tel)\s*[:：.]?\s*(?=\s|$)/gi, " ");

  // รหัสไปรษณีย์ 5 หลัก (ตัวสุดท้ายในข้อความ — บ้านเลขที่มักอยู่ต้น)
  const pcs = [...s.matchAll(/(?<!\d)(\d{5})(?!\d)/g)];
  if (pcs.length) { const m = pcs[pcs.length - 1]; out.postcode = m[1]; s = s.slice(0, m.index) + " " + s.slice(m.index + 5); }

  const TH = "([ก-๙][ก-๙ .]*?)(?=\\s|,|$)";
  let r;
  const bkk = s.match(/(?:จ\.|จังหวัด)?\s*(?:กรุงเทพมหานคร|กรุงเทพฯ?|กทม\.?)/);
  if (bkk) { out.province = "กรุงเทพมหานคร"; s = s.replace(bkk[0], " "); }
  else { r = take(s, new RegExp(`(?:จังหวัด|จ\\.)\\s*${TH}`)); out.province = r.value; s = r.rest; }
  r = take(s, new RegExp(`(?:อำเภอ|อ\\.|เขต)\\s*${TH}`)); out.district = r.value; s = r.rest;
  r = take(s, new RegExp(`(?:ตำบล|ต\\.|แขวง)\\s*${TH}`)); out.subdistrict = r.value; s = r.rest;

  out.line1 = s.replace(/(?:ที่อยู่(?:จัดส่ง)?|address)\s*[:：]?/gi, " ")
    .replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  return out;
}

// ทำความสะอาดก่อนส่งบันทึก — ตัดช่องว่างและจำกัดความยาว (ฝั่ง server ตรวจซ้ำอีกชั้น)
export function cleanAddress(a) {
  const out = {};
  for (const k of ADDRESS_FIELDS) {
    const v = String(a?.[k] ?? "").trim().slice(0, k === "line1" || k === "note" ? 300 : 120);
    if (v) out[k] = v;
  }
  return out;
}
