"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/utils/service-worker";

// ติดตั้ง service worker ตอนแอปเปิด — ต้องมีตัวนี้ ไม่งั้น Web Push ใช้ไม่ได้เลย
// (ดูเหตุผลเต็ม ๆ ใน lib/utils/service-worker.js)
//
// วางไว้ใน root layout เพราะ SW เป็นของทั้งแอป ไม่ใช่ของหน้าใดหน้าเดียว
// และต้องติดตั้งแม้ผู้ใช้ยังไม่เคยเข้าหน้าตอบแชท/ตั้งค่า — ไม่งั้นตอนกดเปิดแจ้งเตือน
// ครั้งแรกจะต้องรอติดตั้งกันสด ๆ ซึ่งเป็นจุดที่พลาดได้ง่าย
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
