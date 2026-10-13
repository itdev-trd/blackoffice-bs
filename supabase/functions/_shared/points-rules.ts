// กติกาคิดแต้มโบนัส (logic ล้วน ไม่แตะฐานข้อมูล) — ใช้ร่วมกันทั้งตอนบันทึกแต้มจริงและตอน backfill
// แต้มถูก "แช่แข็ง" ลงสมุด point_events ตอนบันทึก แก้กติกา/เวลาทำการทีหลังจึงไม่เปลี่ยนแต้มที่ได้ไปแล้ว

export type Slot = { office: boolean; holiday: boolean; label: string; fast: number; slow: number };
export type OfficeHours = {
  days: number[]; open: string; close: string; break_start?: string; break_end?: string;
  slow_min: number; holidays: string[]; exclude: string[];
};
export type PointRules = {
  // [ชั่วโมงเริ่ม, ชั่วโมงสิ้นสุด, แต้มทันเวลา, แต้มช้า] — นอกเวลาทำการ
  off_table: { workday: number[][]; holiday: number[][] };
  office: [number, number];                       // ในเวลาทำการ [ทันเวลา, ช้า]
  tv: { grant: number; renew: number; revoke_void_days: number };
  caps: { office_per_conv_day: number; off_per_conv_day: number };   // 0 = ไม่จำกัด
  dispute_days: number;                           // ยื่นโต้แย้งได้กี่วันหลังสิ้นเดือน ก่อน owner ปิดยอด
};

export const DEFAULT_RULES: PointRules = {
  off_table: {
    workday: [[12, 13, 1, 0.5], [17, 20, 2, 1], [20, 24, 4, 2], [0, 5, 8, 6], [5, 9, 4, 2]],
    holiday: [[9, 17, 2, 1], [17, 20, 4, 2], [20, 24, 8, 4], [0, 5, 16, 12], [5, 9, 8, 4]],
  },
  office: [0.5, 0.25],
  tv: { grant: 3, renew: 2, revoke_void_days: 7 },
  // ไม่จำกัดรอบต่อห้อง: รอบใหม่เกิดได้ต่อเมื่อลูกค้าพิมพ์มาเอง พนักงานปั่นรอบไม่ได้
  // (เคยตั้ง 3/5 แล้วตัดแต้มแชทที่คุยยาวจริงไป 34% ของรอบในเดือน ต.ค. 69)
  caps: { office_per_conv_day: 0, off_per_conv_day: 0 },
  dispute_days: 3,
};

export const DEFAULT_OFFICE_HOURS: OfficeHours = {
  days: [1, 2, 3, 4, 5], open: "09:00", close: "17:00", break_start: "12:00", break_end: "13:00",
  slow_min: 5, holidays: [], exclude: [],
};

const TZ_MS = 7 * 3600 * 1000;
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
const toMin = (s: unknown) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };

export function normalizeOfficeHours(raw: any): OfficeHours {
  const v = { ...DEFAULT_OFFICE_HOURS, ...(raw || {}) };
  return {
    days: Array.isArray(v.days) ? v.days.map(Number) : DEFAULT_OFFICE_HOURS.days,
    open: String(v.open || "09:00"), close: String(v.close || "17:00"),
    break_start: v.break_start ? String(v.break_start) : "", break_end: v.break_end ? String(v.break_end) : "",
    slow_min: Math.max(1, num(v.slow_min, 5)),
    holidays: (Array.isArray(v.holidays) ? v.holidays : []).map((d: unknown) => String(d).slice(0, 10)),
    exclude: (Array.isArray(v.exclude) ? v.exclude : []).map((x: unknown) => String(x).toLowerCase().trim()).filter(Boolean),
  };
}

// รวมกติกาที่บันทึกไว้กับค่าเริ่มต้น — คีย์ที่หายไปใช้ค่าเริ่มต้น
export function normalizeRules(raw: any): PointRules {
  const r = raw || {};
  const table = (t: unknown, d: number[][]) => (Array.isArray(t) && t.every((row) => Array.isArray(row) && row.length === 4)
    ? (t as unknown[][]).map((row) => row.map(Number)) : d);
  const pair = (p: unknown, d: [number, number]): [number, number] => (Array.isArray(p) && p.length === 2 ? [num(p[0], d[0]), num(p[1], d[1])] : d);
  return {
    off_table: { workday: table(r.off_table?.workday, DEFAULT_RULES.off_table.workday), holiday: table(r.off_table?.holiday, DEFAULT_RULES.off_table.holiday) },
    office: pair(r.office, DEFAULT_RULES.office),
    tv: {
      grant: num(r.tv?.grant, DEFAULT_RULES.tv.grant), renew: num(r.tv?.renew, DEFAULT_RULES.tv.renew),
      revoke_void_days: Math.max(0, num(r.tv?.revoke_void_days, DEFAULT_RULES.tv.revoke_void_days)),
    },
    caps: {
      office_per_conv_day: Math.max(0, num(r.caps?.office_per_conv_day, DEFAULT_RULES.caps.office_per_conv_day)),
      off_per_conv_day: Math.max(0, num(r.caps?.off_per_conv_day, DEFAULT_RULES.caps.off_per_conv_day)),
    },
    dispute_days: Math.max(0, num(r.dispute_days, DEFAULT_RULES.dispute_days)),
  };
}

// แปลงกติกาจากหน้าตั้งค่า — ตรวจรูปแบบเข้ม ผิดแม้แต่ช่องเดียวก็ปฏิเสธ (ห้ามบันทึกกติกาครึ่ง ๆ กลาง ๆ)
export function validateRules(raw: any): { ok: true; rules: PointRules } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  const okNum = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000;
  for (const key of ["workday", "holiday"] as const) {
    const t = raw?.off_table?.[key];
    if (!Array.isArray(t)) return bad(`ตารางแต้มนอกเวลา (${key}) ไม่ถูกต้อง`);
    for (const row of t) {
      if (!Array.isArray(row) || row.length !== 4 || !row.every(okNum)) return bad(`แถวในตาราง ${key} ต้องเป็น [ชม.เริ่ม, ชม.จบ, แต้มทัน, แต้มช้า]`);
      if (row[0] >= row[1] || row[1] > 24) return bad(`ช่วงชั่วโมงในตาราง ${key} ไม่ถูกต้อง: ${row[0]}–${row[1]}`);
    }
  }
  if (!Array.isArray(raw?.office) || raw.office.length !== 2 || !raw.office.every(okNum)) return bad("แต้มในเวลาทำการต้องเป็น [ทันเวลา, ช้า]");
  if (!okNum(raw?.tv?.grant) || !okNum(raw?.tv?.renew) || !okNum(raw?.tv?.revoke_void_days)) return bad("แต้ม TradingView ไม่ถูกต้อง");
  if (!okNum(raw?.caps?.office_per_conv_day) || !okNum(raw?.caps?.off_per_conv_day)) return bad("เพดานแต้มต่อห้องแชทไม่ถูกต้อง");
  if (!okNum(raw?.dispute_days)) return bad("จำนวนวันยื่นโต้แย้งไม่ถูกต้อง");
  return { ok: true, rules: normalizeRules(raw) };
}

export function thaiParts(ms: number) {
  const t = new Date(ms + TZ_MS);
  const iso = t.toISOString();
  return { day: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60, date: iso.slice(0, 10), period: iso.slice(0, 7) };
}
export const periodOf = (ms: number) => thaiParts(ms).period;
export const thaiDateOf = (ms: number) => thaiParts(ms).date;

// ขอบเวลาของเดือน (YYYY-MM ตามเวลาไทย) เป็น ms แบบ [start, end)
export function periodRange(period: string): { startMs: number; endMs: number } {
  const [y, m] = period.split("-").map(Number);
  return { startMs: Date.UTC(y, m - 1, 1) - TZ_MS, endMs: Date.UTC(y, m, 1) - TZ_MS };
}
export function thaiDayRange(ms: number): { startMs: number; endMs: number } {
  const [y, m, d] = thaiDateOf(ms).split("-").map(Number);
  const startMs = Date.UTC(y, m - 1, d) - TZ_MS;
  return { startMs, endMs: startMs + 86400000 };
}

export function isHoliday(ms: number, oh: OfficeHours) {
  const p = thaiParts(ms);
  return !oh.days.includes(p.day) || oh.holidays.includes(p.date);
}
export function isOfficeTime(ms: number, oh: OfficeHours) {
  if (isHoliday(ms, oh)) return false;
  const { min } = thaiParts(ms);
  const inBreak = !!(oh.break_start && oh.break_end && min >= toMin(oh.break_start) && min < toMin(oh.break_end));
  return min >= toMin(oh.open) && min < toMin(oh.close) && !inBreak;
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
export function slotOf(ms: number, oh: OfficeHours, rules: PointRules): Slot {
  const holiday = isHoliday(ms, oh);
  if (isOfficeTime(ms, oh)) return { office: true, holiday: false, label: "ในเวลาทำการ", fast: rules.office[0], slow: rules.office[1] };
  const { min } = thaiParts(ms);
  const table = holiday ? rules.off_table.holiday : rules.off_table.workday;
  const row = table.find(([a, b]) => min >= a * 60 && min < b * 60);
  const tag = holiday ? "วันหยุด" : "วันทำงาน";
  if (!row) return { office: false, holiday, label: `นอกเวลา (${tag}) ช่วงที่ไม่มีแต้ม`, fast: 0, slow: 0 };
  return { office: false, holiday, label: `นอกเวลา ${hh(row[0])}–${hh(row[1])} (${tag})`, fast: row[2], slow: row[3] };
}

export type ReplyScore = {
  points: number; kind: "reply_office" | "reply_offhours"; in_time: boolean; wait_min: number;
  slot_msg: string; slot_reply: string; used: "msg" | "reply";
};

// คิดแต้มคำตอบหนึ่งรอบ
//  - ทันเวลา = ตอบภายใน slow_min นาทีนับจากข้อความแรกของลูกค้าในรอบนั้น
//  - ใช้ช่วงเวลาที่ "ตอบ" แต่ไม่ให้แต้มสูงกว่าช่วงที่ลูกค้าทัก (ใช้ช่วงที่แต้มต่ำกว่า)
//    ทัก 08:59 ตอบ 09:30 = แต้มในเวลา · ทัก 16:50 รอตอบ 17:01 ก็ได้แต้มในเวลา (กันรอเพื่อเอาแต้มนอกเวลา)
export function scoreReply(msgAtMs: number, replyAtMs: number, oh: OfficeHours, rules: PointRules): ReplyScore {
  const waitMin = Math.max(0, (replyAtMs - msgAtMs) / 60000);
  const inTime = waitMin <= oh.slow_min;
  const sMsg = slotOf(msgAtMs, oh, rules);
  const sReply = slotOf(replyAtMs, oh, rules);
  const pMsg = inTime ? sMsg.fast : sMsg.slow;
  const pReply = inTime ? sReply.fast : sReply.slow;
  const useMsg = pMsg < pReply;
  const chosen = useMsg ? sMsg : sReply;
  return {
    points: Math.round((useMsg ? pMsg : pReply) * 100) / 100,
    kind: chosen.office ? "reply_office" : "reply_offhours",
    in_time: inTime, wait_min: Math.round(waitMin * 10) / 10,
    slot_msg: sMsg.label, slot_reply: sReply.label, used: useMsg ? "msg" : "reply",
  };
}

export function capFor(kind: string, rules: PointRules) {
  return kind === "reply_office" ? rules.caps.office_per_conv_day : rules.caps.off_per_conv_day;
}
// เกินเพดานหรือยัง — เพดาน 0 = ไม่จำกัด
export const overCap = (used: number, cap: number) => cap > 0 && used >= cap;

// ให้สิทธิ์ TradingView ได้แต้มแบบไหน
//  - ไม่เคยมีสิทธิ์สคริปต์นี้มาก่อน = ให้สิทธิ์ใหม่
//  - เคยมีแล้ว = ต่ออายุ ได้แต้มเฉพาะเมื่อวันหมดอายุเลื่อนออกไปจริง (กดซ้ำ/ถอนแล้วให้ใหม่ ปั่นแต้มไม่ได้)
//  - เป็นตลอดชีพอยู่แล้ว = ไม่มีอะไรต่อ
export function tvEventKind(existing: { expiration?: string | null } | null | undefined, newExpiration: string | null): "tv_grant" | "tv_renew" | null {
  if (!existing) return "tv_grant";
  const oldExp = existing.expiration ? new Date(existing.expiration).getTime() : null;
  if (oldExp === null) return null;
  if (newExpiration === null) return "tv_renew";
  return new Date(newExpiration).getTime() > oldExp ? "tv_renew" : null;
}

export function isExcludedCustomer(oh: OfficeHours, customerName: unknown, conversationId: unknown) {
  if (!oh.exclude.length) return false;
  const name = String(customerName || "").toLowerCase();
  const conv = String(conversationId || "").toLowerCase();
  return oh.exclude.some((e) => (name && name.includes(e)) || conv === e);
}

// hash ที่ owner/พนักงานใช้ตรวจว่ารายการแต้มของเดือนที่ปิดแล้วไม่ถูกแก้ — ลำดับตาม id
export function ledgerFingerprint(rows: { id: number | string; points: number | string; staff_email: string }[]) {
  return [...rows].sort((a, b) => Number(a.id) - Number(b.id)).map((r) => `${r.id}:${r.staff_email}:${Number(r.points).toFixed(2)}`).join("\n");
}
