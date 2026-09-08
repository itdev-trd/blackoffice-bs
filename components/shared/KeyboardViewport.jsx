"use client";

import { useEffect } from "react";

/**
 * แก้จอเพี้ยนบนมือถือตอนคีย์บอร์ดเด้งขึ้นมา
 *
 * อาการที่เจอ (iOS): เปิดห้องแชทแล้วแตะช่องพิมพ์ → ครึ่งจอบนกลายเป็นสีดำว่าง
 * ข้อความหายไป ช่องพิมพ์ลอยกลางจอ และแถบเมนูล่างที่ควรถูกทับโผล่ขึ้นมา
 *
 * สาเหตุ: คีย์บอร์ดย่อ "visual viewport" แต่ไม่ย่อ "layout viewport"
 *   - 100dvh คิดจาก layout viewport → ยังสูงเท่าเดิม กล่องจึงยาวเกินพื้นที่ที่มองเห็น
 *   - position: fixed ยึดกับ layout viewport → iOS เลื่อน layout viewport ขึ้นเพื่อโชว์ช่องพิมพ์
 *     ทำให้ของที่ยึดขอบจอเลื่อนตามไปด้วย และเห็นพื้นที่ใต้กล่องที่ควรถูกทับ
 *
 * วิธีแก้: อ่านความสูงจริงจาก window.visualViewport แล้วเก็บเป็นตัวแปร CSS
 * ให้กล่องเต็มจอใช้ค่านี้แทน 100dvh (ดู --app-vh ใน globals.css)
 * พร้อมดึง layout viewport กลับที่เดิมเมื่อ iOS เลื่อนมันขึ้นไป
 *
 * Android Chrome แก้ด้วย interactiveWidget: "resizes-content" ใน viewport meta อยู่แล้ว
 * ตัวนี้จึงมีผลจริงกับ iOS เป็นหลัก แต่ปล่อยให้ทำงานทุกที่ได้ ไม่เสียหาย
 */
export default function KeyboardViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    let raf = 0;

    const apply = () => {
      raf = 0;
      // ปัดเศษลงกัน sub-pixel ทำให้เกิดเส้นขอบ 1px โผล่ใต้กล่อง
      root.style.setProperty("--app-vh", `${Math.floor(vv.height)}px`);
      // เกิน 80px ถือว่าคีย์บอร์ดเปิด (แถบ URL ที่ยืดหดปกติไม่ถึงเท่านี้)
      const keyboardOpen = window.innerHeight - vv.height > 80;
      root.classList.toggle("keyboard-open", keyboardOpen);
      // iOS เลื่อน layout viewport ขึ้นเพื่อโชว์ช่องพิมพ์ — ของที่ fixed จึงหลุดกรอบ
      // ดึงกลับที่เดิม เพราะกล่องแชทย่อตาม --app-vh ให้ช่องพิมพ์อยู่ในจอแล้ว
      if (keyboardOpen && (vv.offsetTop > 0 || window.scrollY > 0)) window.scrollTo(0, 0);
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      root.style.removeProperty("--app-vh");
      root.classList.remove("keyboard-open");
    };
  }, []);

  return null;
}
