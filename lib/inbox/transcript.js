// ยุบข้อความซ้ำในบทสนทนาก่อนแสดง — แยกออกมาจาก ChatInboxTab ให้ทดสอบได้ (tests/inbox-transcript.test.mjs)
// ตาข่ายกันสุดท้าย ไม่ว่า transcript ใน DB จะเบิ้ลด้วยเหตุใด (race webhook / echo+sync คนละ id)
// ยุบเฉพาะข้อความ "เหมือนกันเป๊ะ + อยู่ติดกัน" (ฝั่งเดียวกัน + รูป/ข้อความเดียวกัน) ภายใน ~90 วิ
// — ยังปล่อยให้ส่งข้อความเดิมซ้ำโดยตั้งใจแบบเว้นช่วงได้
export function dedupeTranscript(items) {
  const out = [];
  for (const m of items || []) {
    const prev = out[out.length - 1];
    if (prev && prev.w === m.w) {
      const sameMid = m.mid && prev.mid && m.mid === prev.mid;
      const sameImg = m.img && prev.img && m.img === prev.img;
      const sameText = !m.img && !prev.img && m.t && prev.t && m.t === prev.t;
      const near = (!m.at || !prev.at) || Math.abs(new Date(m.at).getTime() - new Date(prev.at).getTime()) < 90 * 1000;
      if (sameMid) {
        // รายการเดียวกันจาก sync + webhook: สติกเกอร์เลือก URL sync (โปร่งใส), สื่อทั่วไปเลือก webhook
        const isSticker = !!m.sticker || !!prev.sticker || m.t === "[สติกเกอร์]" || prev.t === "[สติกเกอร์]";
        if (isSticker) {
          if (m.img_source === "sync" && prev.img_source !== "sync") out[out.length - 1] = { ...prev, ...m, sticker: true };
        } else if (m.img_source === "webhook" && prev.img_source !== "webhook") {
          out[out.length - 1] = { ...prev, ...m };
        }
        continue;
      }
      if ((sameImg || sameText) && near) continue;
    }
    out.push(m);
  }
  return out;
}
