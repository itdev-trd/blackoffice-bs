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
 *
 * สำคัญ: ล็อก body ไม่ให้เลื่อน (keyboard-open) กับดึง scroll กลับไปบนสุด (scrollTo)
 * ใช้ได้เฉพาะตอนอยู่ในกล่องเต็มจอแบบ fixed (.app-screen — ห้องแชทบนมือถือ) เท่านั้น
 * หน้าอื่น (เช่นตั้งค่า) เลื่อนด้วย body scroll ปกติ ถ้าล็อกด้วยกฎเดียวกัน พอคีย์บอร์ดเปิด
 * จะเลื่อนหน้าไปหาช่องที่พิมพ์ต่อไม่ได้เลย (เจอกับฟอร์ม "ข้อความบันทึกไว้" ที่มีหลายช่อง
 * ต่อกันยาว — แตะช่องล่าง ๆ แล้วเลื่อนจอไม่ได้อีกเพราะ body ถูกล็อกไปแล้ว)
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
      // มี .app-screen อยู่ในจอไหม — มีแค่ตอนเปิดห้องแชทบนมือถือ (ChatInboxTab)
      // หน้าอื่นทั้งหมด (ตั้งค่า, ลูกค้า, ฯลฯ) ไม่มีกล่องนี้ จึงไม่ต้องล็อก scroll เลย
      const fixedScreenActive = !!document.querySelector(".app-screen");
      // iOS เลื่อน layout viewport ขึ้นเพื่อโชว์ช่องพิมพ์ — ของที่ fixed จึงหลุดกรอบ
      // ต้องดึงกลับ "ก่อน" ใส่คลาส keyboard-open เพราะ overflow:hidden ล็อกตำแหน่ง scroll ไว้
      // แล้ว scrollTo หลังจากนั้นจะไม่มีผลบน iOS
      // ทำเฉพาะตอน fixedScreenActive — หน้าปกติต้องปล่อยให้เลื่อนหาช่องที่แตะได้ตามปกติ
      if (fixedScreenActive && keyboardOpen && window.scrollY > 0) window.scrollTo(0, 0);
      // ระยะที่ iOS ดันพื้นที่มองเห็นลงมาจากขอบ layout viewport
      // กล่องเต็มจอ (fixed) ต้องเกาะค่านี้ ไม่งั้นทั้งกล่องหลุดขึ้นไปเหนือจอตอนคีย์บอร์ดเปิด
      root.style.setProperty("--app-vv-top", `${Math.round(vv.offsetTop)}px`);
      root.classList.toggle("keyboard-open", keyboardOpen && fixedScreenActive);
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
      root.style.removeProperty("--app-vv-top");
      root.classList.remove("keyboard-open");
    };
  }, []);

  return null;
}
