"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { logActivity } from "@/lib/utils/activity";

// เก็บกวาด push ที่ค้างจากเวอร์ชันเก่าเมื่อเปิดแอปมาแล้วไม่มี session
// การ unsubscribe ฝั่ง browser ทำให้ push endpoint ใช้งานไม่ได้ทันที; cron จะลบแถว server เมื่อได้รับ 410
async function clearLoggedOutPush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const subscription = await reg?.pushManager?.getSubscription?.();
    if (subscription) await subscription.unsubscribe();
    const notifications = await reg?.getNotifications?.();
    (notifications || []).forEach((notification) => notification.close());
    if ("clearAppBadge" in navigator) await navigator.clearAppBadge();
  } catch {
    /* browser ไม่รองรับก็ข้าม */
  }
}

// mount ที่ root layout ตลอดชีวิตของแอป — คอยดู auth state เพื่อบันทึก login/ล้าง push ตอน logout
export default function AuthListener() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) clearLoggedOutPush();
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") logActivity("login");
      if (event === "SIGNED_OUT") clearLoggedOutPush();
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  return null;
}
