"use client";

import { useEffect } from "react";

/**
 * กันเลขในช่อง <input type="number"> เปลี่ยนเองตอนเลื่อนลูกกลิ้งเมาส์
 *
 * อาการที่เจอ: ฟอร์มเพิ่มสิทธิ์อินดี้ (จำกัดวัน) พิมพ์ 30 แล้วเลื่อนจอต่อ → เบราว์เซอร์เอา wheel ไปบวก/ลบเลขแทน
 * วิธีแก้: ถ้าเลื่อนลูกกลิ้งบนช่องตัวเลขที่โฟกัสอยู่ ให้ blur ทิ้ง — เลขไม่เปลี่ยน และหน้าเลื่อนต่อได้ตามปกติ
 */
export default function NumberWheelGuard() {
  useEffect(() => {
    const onWheel = (e) => {
      const el = document.activeElement;
      if (el && el.tagName === "INPUT" && el.type === "number" && el === e.target) el.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true, capture: true });
    return () => document.removeEventListener("wheel", onWheel, { capture: true });
  }, []);
  return null;
}
