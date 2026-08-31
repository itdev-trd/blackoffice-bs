"use client";

import { useEffect, useState } from "react";
import { lsGet, lsSet } from "@/lib/utils/storage";

// รีโหลดแบบ "สะอาดจริง" สำหรับ PWA — ล้าง cache ของ service worker + สั่ง SW ตัวใหม่ทำงานก่อน
// ไม่งั้น location.reload() เฉยๆ จะดึง JS/CSS ตัวเก่าจาก cache กลับมา (เหตุที่ต้องลบแอปเพิ่มใหม่)
async function hardReload() {
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.waiting) reg.waiting.postMessage("skipWaiting");
      }
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ล้างไม่ได้ก็รีโหลดตรงๆ */
  }
  window.location.reload();
}

// ---------------------------------------------------------------
// อัปเดตอัตโนมัติหลัง deploy: poll version.json เทียบกับ build id ที่ฝังมา
// เจอเวอร์ชันใหม่ → แท็บที่ไม่ได้เปิดดูอยู่รีโหลดเอง / แท็บที่เปิดอยู่โชว์แถบกดอัปเดต
// ---------------------------------------------------------------
const APP_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (APP_BUILD_ID === "dev") return; // โหมด dev ไม่ต้องเช็ค
    let stop = false;
    async function check() {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (stop || !j?.id) return;
        const target = String(j.id);
        if (target === APP_BUILD_ID) {
          // ตรงกันแล้ว = อัปเดตสำเร็จ ล้าง marker กันลูปทิ้ง เพื่อให้ deploy รอบหน้าเด้งได้ปกติ
          if (lsGet("ui.reloaded_for", null)) lsSet("ui.reloaded_for", null);
          return;
        }

        // กันลูปรีโหลด: ถ้าเคยรีโหลดเพื่อ id นี้ไปแล้วแต่ build ที่โหลดมายัง "ไม่ขยับ"
        // (host/CDN/service worker ยังเสิร์ฟไฟล์เก่า) → อย่ารีโหลดซ้ำอีก มันจะวนไม่จบ
        // แสดงแถบให้กดเองแทน (กดแล้วยังไม่หายค่อยเป็นเรื่อง hosting ไม่ใช่เด้งเองรัวๆ)
        const already = lsGet("ui.reloaded_for", null);
        if (already === target) {
          setReady(true);
          return;
        }

        // เจอเวอร์ชันใหม่จริงครั้งแรก → จำ id ที่กำลังจะรีโหลดไป กันวนรอบถัดไป
        lsSet("ui.reloaded_for", target);
        if (document.visibilityState === "hidden") hardReload(); // ไม่ได้ดูอยู่ = รีโหลดเงียบๆ (ล้าง cache PWA ด้วย)
        else setReady(true); // กำลังใช้งาน = แจ้งให้กดเอง (กันพิมพ์ค้างแล้วหาย)
      } catch {
        /* เน็ตสะดุดก็ข้ามรอบนี้ */
      }
    }
    const iv = setInterval(check, 3 * 60 * 1000); // ทุก 3 นาที
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    }; // กลับมาโฟกัส = เช็คทันที
    document.addEventListener("visibilitychange", onVis);
    check();
    return () => {
      stop = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  if (!ready) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-brand-600 text-white rounded-full shadow-lg px-4 py-2.5 flex items-center gap-3">
      <span className="text-sm font-medium">มีเวอร์ชันใหม่ของแอป</span>
      <button onClick={hardReload} className="bg-white text-brand-700 rounded-full px-3 py-1 text-xs font-semibold hover:bg-brand-50">
        อัปเดตเลย
      </button>
    </div>
  );
}
