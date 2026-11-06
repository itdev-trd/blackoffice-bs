// กิจกรรมแจก Indicator (settings.tv_campaigns) — ใช้ร่วมกันระหว่างหน้าตั้งค่ากับปุ่ม 🎁 กิจกรรม ในข้อมูลลูกค้าของแชท
export const CAMPAIGNS_KEY = "tv_campaigns";

// วันนี้ตามเวลาไทย "YYYY-MM-DD"
export const todayBangkok = (now = Date.now()) => new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);

// กิจกรรมเปิดอยู่และอยู่ในช่วงวันที่ (start/end ว่าง = ไม่จำกัดฝั่งนั้น · นับรวมวันจบ)
export function campaignRunning(c, now = Date.now()) {
  if (!c?.active || !Array.isArray(c.pine_ids) || !c.pine_ids.length) return false;
  const today = todayBangkok(now);
  if (c.start_date && today < c.start_date) return false;
  if (c.end_date && today > c.end_date) return false;
  return true;
}

// สิทธิ์เดิมยาวกว่าที่กิจกรรมจะให้ไหม — ยาวกว่า/ตลอดชีพ = ข้ามสคริปต์นั้น ห้ามให้กิจกรรมไปตัดวันลูกค้าให้สั้นลง
export function keepsLongerAccess(existing, days, now = Date.now()) {
  if (!existing || existing.status === "revoked") return false;
  if (existing.expiration == null) return true;
  return new Date(existing.expiration).getTime() >= now + Number(days) * 86400000;
}
