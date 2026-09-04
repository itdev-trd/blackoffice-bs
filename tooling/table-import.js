// tooling/table-import.js
// อ่านไฟล์ Excel/CSV ที่ export มาจากระบบเก่า แล้วเดาว่าเป็นข้อมูลของตารางไหน
//
// โชคดีที่ export จากระบบเก่าใช้ select * ทำให้หัวตารางเป็น "ชื่อคอลัมน์จริง" อยู่แล้ว
// จึงไม่ต้องมีตารางแปลชื่อหัวคอลัมน์แบบ customer-import.js (ที่ต้องเดาจากคำไทยหลายแบบ)
// แค่ normalize ตัวพิมพ์กับช่องว่างก็พอ

/** ตารางที่รองรับ — ต้องตรงกับ allowlist ใน edge function import-table */
export const IMPORT_TABLES = {
  chat_customers:    { label: "ลูกค้า",              key: ["id"] },
  tv_access:         { label: "สิทธิ์ TradingView",   key: ["username", "pine_id"] },
  chat_referrals:    { label: "ที่มาจากโฆษณา",        key: ["page_id", "psid", "ad_id"] },
  saved_replies:     { label: "คลังข้อความ",          key: ["id"] },
  trade_id_cache:    { label: "ผลเช็คไอดีเทรด",       key: ["trade_id"] },
  page_lead_config:  { label: "ตั้งค่าเพจ",           key: ["page_id"] },
  user_permissions:  { label: "สิทธิ์ผู้ใช้",          key: ["email"] },
};

// คอลัมน์ที่ใช้ชี้ว่าไฟล์นี้เป็นของตารางไหน (ไม่ต้องครบทุกคอลัมน์)
const FINGERPRINT = {
  chat_customers:   ["id", "page_id", "psid", "customer_name"],
  tv_access:        ["username", "pine_id", "expiration"],
  chat_referrals:   ["page_id", "psid", "ad_id", "received_at"],
  saved_replies:    ["id", "message", "sort"],
  trade_id_cache:   ["trade_id", "pass", "checked_at"],
  page_lead_config: ["page_id", "page_name", "required_fields"],
  user_permissions: ["email", "role", "allowed_tabs"],
};

const norm = (v) => String(v ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "_");

function cellText(cell) {
  if (cell == null) return "";
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || "").join("");
    if (value.text != null) return String(value.text);
    return JSON.stringify(value);   // jsonb ที่ ExcelJS อ่านมาเป็น object
  }
  return String(value);
}

/**
 * เดาว่าไฟล์เป็นของตารางไหน
 * เงื่อนไข: ต้องมีคอลัมน์คีย์ครบทุกตัว ไม่งั้นจับคู่แถวไม่ได้ → ไม่ให้ผ่าน
 * ถ้าเข้าเงื่อนไขหลายตาราง เลือกตัวที่ตรง fingerprint มากที่สุด
 */
export function detectTable(headers) {
  const set = new Set(headers.map(norm));
  let best = null;
  for (const [table, spec] of Object.entries(IMPORT_TABLES)) {
    if (!spec.key.every((k) => set.has(k))) continue;
    const score = (FINGERPRINT[table] || []).filter((c) => set.has(c)).length;
    if (!best || score > best.score) best = { table, score };
  }
  return best?.table ?? null;
}

/**
 * อ่านไฟล์ → { table, headers, rows }
 * rows เป็น object ที่ key = ชื่อคอลัมน์จริง ส่งให้ edge function ได้ตรงๆ
 * ฝั่ง edge function จะกรองคอลัมน์นอก allowlist และแปลงชนิดค่าเอง
 */
export async function parseTableFile(file, forcedTable = null) {
  const name = String(file?.name || "").toLowerCase();
  const rowsRaw = name.endsWith(".csv") ? await readCsv(file) : await readXlsx(file);
  if (!rowsRaw.length) throw new Error("ไฟล์นี้ไม่มีข้อมูล");

  const headers = rowsRaw[0].map((h) => norm(h));

  // ไฟล์ export จากหน้าเว็บระบบเก่า ต้องแปลงชื่อสคริปต์ → pine_id ก่อน
  // ซึ่งต้องอ่านตาราง tv_scripts จากฐาน — ทำที่นี่ไม่ได้ จึงคืนข้อมูลดิบให้ผู้เรียกแปลงต่อ
  if (!forcedTable && isTvLegacyExport(headers)) {
    const rawRows = [];
    for (let i = 1; i < rowsRaw.length; i++) {
      const r = rowsRaw[i];
      if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;
      const obj = {};
      headers.forEach((h, idx) => { if (h) obj[h] = r[idx] ?? null; });
      rawRows.push(obj);
    }
    return { legacy: "tv_access", table: "tv_access", headers, rawRows, needsScript: tvLegacyNeedsScript(headers) };
  }

  const table = forcedTable || detectTable(headers);
  if (!table) {
    throw new Error(
      "เดาไม่ออกว่าไฟล์นี้เป็นข้อมูลของตารางไหน — ต้องมีคอลัมน์คีย์ครบ " +
      "เช่น id (ลูกค้า) หรือ username+pine_id (สิทธิ์ TradingView) · เลือกตารางเองได้จากช่องด้านล่าง"
    );
  }

  const rows = [];
  for (let i = 1; i < rowsRaw.length; i++) {
    const r = rowsRaw[i];
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;   // ข้ามแถวว่าง
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = r[idx] ?? null; });
    rows.push(obj);
  }
  if (!rows.length) throw new Error("ไฟล์มีแต่หัวตาราง ไม่มีข้อมูล");
  return { table, headers, rows };
}

async function readXlsx(file) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("ไฟล์นี้ไม่มีชีตข้อมูล");
  const out = [];
  const width = Math.max(ws.columnCount, 1);
  ws.eachRow({ includeEmpty: false }, (row) => {
    out.push(Array.from({ length: width }, (_, i) => cellText(row.getCell(i + 1))));
  });
  return out;
}

// CSV ที่ Supabase ดาวน์โหลดมาใช้ , คั่น และครอบ " เมื่อมี , หรือขึ้นบรรทัดใหม่ข้างใน
// ต้อง parse แบบเข้าใจ quote ไม่งั้น jsonb (transcript/ads_context) ที่มี , จะแตกคอลัมน์
async function readCsv(file) {
  const text = (await file.text()).replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // "" = เครื่องหมายคำพูดจริง
        else inQuote = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuote = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || String(r[0] ?? "").trim() !== "");
}

// ────────────────────────────────────────────────────────────
//  รูปแบบพิเศษ: ไฟล์ที่ export จาก "หน้าเว็บ" ของระบบเก่า (ไม่ใช่ DB ตรงๆ)
// ────────────────────────────────────────────────────────────
//  ต่างจาก export แบบ select * ตรงที่:
//    · หัวตารางเป็นภาษาไทยที่คนอ่าน ไม่ใช่ชื่อคอลัมน์ในฐาน
//    · คอลัมน์ Indicator เก็บ "ชื่อสคริปต์" ไม่ใช่ pine_id → ต้องแปลงก่อน
//    · วันที่เป็น พ.ศ. แบบย่อ เช่น "03 ต.ค. 69" หรือ "01 ก.ย. 2569 16:04"
//    · "—" คือค่าว่าง · "ตลอดชีพ" คือไม่มีวันหมดอายุ (expiration = null)

const TV_LEGACY_MAP = {
  "indicator": "_script_name",
  "ชื่อลูกค้า": "display_name",
  "user_tv": "username",
  "อีเมล": "email",
  "ประเภทสมาชิก": "membership_type",
  "ช่องทาง": "channel",
  "สถานะ": "status",
  "trade_id": "trade_id",
  "วันหมดอายุเดิม": "previous_expiration",
  "หมดอายุ": "expiration",
  "เพิ่มสิทธิ์บน_tv": "tv_granted_at",
  "create": "granted_at",
  "คนเพิ่ม": "granted_by",
  "แก้ไขโดย": "edited_by",
};

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "03 ต.ค. 69" / "01 ก.ย. 2569 16:04" → ISO · คืน null ถ้าแปลงไม่ได้ */
export function parseThaiDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "—" || s === "-" || s === "ตลอดชีพ") return null;
  const m = s.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  const day = Number(m[1]);
  const mi = THAI_MONTHS.indexOf(m[2]);
  if (mi < 0) return null;
  // ปีอาจมาแบบ 2 หลัก (69) หรือ 4 หลัก (2569) — ทั้งคู่เป็น พ.ศ. ต้องลบ 543
  let year = Number(m[3]);
  if (year < 100) year += 2500;
  year -= 543;
  const hh = m[4] ? String(m[4]).padStart(2, "0") : "00";
  const mm = m[5] || "00";
  const iso = `${year}-${String(mi + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${hh}:${mm}:00+07:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ไฟล์นี้เป็น export หน้าเว็บของระบบเก่าไหม */
export function isTvLegacyExport(headers) {
  const set = new Set(headers.map(norm));
  // ไฟล์ที่ export จากมุมมอง "สคริปต์เดียว" จะไม่มีคอลัมน์ Indicator เลย
  // ยังถือว่าเป็นข้อมูล tv_access แต่ต้องให้ผู้ใช้เลือกสคริปต์เอง (ดู needsScript)
  return set.has("user_tv") && set.has("หมดอายุ");
}

/** ไฟล์นี้ต้องให้ผู้ใช้ระบุสคริปต์เองไหม (ไม่มีคอลัมน์ Indicator) */
export function tvLegacyNeedsScript(headers) {
  return !new Set(headers.map(norm)).has("indicator");
}

/**
 * แปลงไฟล์ export หน้าเว็บ → แถวของตาราง tv_access
 * @param scripts รายการสคริปต์จากฐานใหม่ [{ pine_id, name }] ใช้แปลงชื่อ → pine_id
 * @returns { rows, unmatchedScripts } — ชื่อสคริปต์ที่หา pine_id ไม่เจอจะถูกรายงานกลับ ไม่เดา
 */
export function convertTvLegacyRows(rawRows, headers, scripts, fallbackPineId = null) {
  const byName = new Map((scripts || []).map((s) => [norm(s.name), s.pine_id]));
  const rows = [];
  const unmatched = new Set();

  for (const raw of rawRows) {
    const o = {};
    headers.forEach((h) => {
      const field = TV_LEGACY_MAP[h];
      if (!field) return;
      let v = raw[h];
      v = String(v ?? "").trim();
      if (v === "—" || v === "-") v = "";
      if (["previous_expiration", "expiration", "tv_granted_at", "granted_at"].includes(field)) {
        o[field] = parseThaiDate(v);
      } else {
        o[field] = v || null;
      }
    });

    // "ตลอดชีพ" = ไม่มีวันหมดอายุ · parseThaiDate คืน null ให้แล้ว จึงตรงกับความหมายในฐาน
    const scriptName = o._script_name;
    delete o._script_name;
    // ไม่มีคอลัมน์ Indicator → ใช้สคริปต์ที่ผู้ใช้เลือก
    const pine = scriptName ? byName.get(norm(scriptName)) : fallbackPineId;
    if (!pine) { unmatched.add(scriptName || "(ไฟล์ไม่มีคอลัมน์ Indicator — ต้องเลือกสคริปต์เอง)"); continue; }
    o.pine_id = pine;

    if (!o.username) continue;             // ไม่มี username = ระบุแถวไม่ได้
    rows.push(o);
  }
  return { rows, unmatchedScripts: [...unmatched] };
}
