// แปลงวันลบที่แอดมินเลือก ("YYYY-MM-DD" ตามปฏิทินไทย) เป็นเวลาเริ่มวันนั้นตามเวลาไทย
// คืน null ถ้ารูปแบบผิด อยู่ก่อนวันนี้ หรือไกลเกิน maxDays
// ไม่มี import ภายนอก — tests/retention-date.test.mjs เรียกไฟล์นี้ตรงด้วย node
export const MAX_PURGE_DAYS = 365;

export function purgeAtFromDate(v: unknown, nowMs = Date.now(), maxDays = MAX_PURGE_DAYS): string | null {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+07:00`);
  if (!Number.isFinite(t)) return null;
  // Date.parse ยอม "2026-02-31" (เลื่อนไปเดือนถัดไป) — เช็กว่าวันที่ออกมาตรงกับที่ส่งมา
  if (new Date(t + 7 * 3600000).toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  const todayTh = Date.parse(new Date(nowMs + 7 * 3600000).toISOString().slice(0, 10) + "T00:00:00+07:00");
  if (t < todayTh || t > nowMs + maxDays * 86400000) return null;
  return new Date(t).toISOString();
}
