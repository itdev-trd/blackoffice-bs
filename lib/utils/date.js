// แปลงค่าจาก <input type="date"> ที่บางเครื่อง (locale ไทย) คืนปีเป็น พ.ศ. → ค.ศ. เสมอ
// เช่น "2569-09-20" → "2026-09-20" (กันบันทึกวันหมดอายุเพี้ยนไปปี 2569)
export const beToCe = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
  if (!m) return d;
  const y = Number(m[1]);
  return y > 2400 ? `${y - 543}-${m[2]}-${m[3]}` : d;
};

export const bangkokDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
};
