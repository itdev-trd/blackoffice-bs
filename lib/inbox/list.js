// รวมผลลิสต์แชทซ้าย — แยกออกมาจาก ChatInboxTab ให้ทดสอบได้ (tests/inbox-list.test.mjs)

const at = (r) => Date.parse(r?.last_message_at || "") || 0;

// poll ดึงแค่หน้าแรก (top) มารวมกับลิสต์เดิม (prev) โดยไม่ทิ้งแชทเก่าที่เลื่อนโหลดมาแล้ว
//   sameKey = false (เปลี่ยนตัวกรอง) หรือหน้าแรกไม่เต็ม (ไม่มีแชทเก่ากว่านี้แล้ว) → ใช้ top อย่างเดียว
//   แถวที่ขยับขึ้นมาอยู่หน้าแรกใช้ของใหม่ · แถวเดิมที่อยู่ในช่วงหน้าแรกแต่ไม่อยู่ใน top แล้ว = ไม่ตรงตัวกรองแล้ว ทิ้ง
export function mergeTopPage(prev, top, { pageSize, sameKey }) {
  if (!sameKey || !Array.isArray(prev) || top.length < pageSize) return top;
  const topIds = new Set(top.map((r) => r.id));
  const cutoff = at(top[top.length - 1]);
  const older = prev.filter((r) => !topIds.has(r.id) && at(r) <= cutoff);
  return [...top, ...older];
}

// ต่อแถวใหม่ท้ายลิสต์โดยไม่ซ้ำ id (โหลดแชทเก่าหน้าถัดไป)
export function appendUnique(prev, rows) {
  const have = new Set((prev || []).map((r) => r.id));
  return [...(prev || []), ...rows.filter((r) => !have.has(r.id))];
}

// ผนวกผลค้นหาจากฐานข้อมูลแล้วเรียงใหม่ตามข้อความล่าสุด
export function mergeSearchResults(prev, rows) {
  return appendUnique(prev, rows).sort((a, b) => at(b) - at(a));
}
