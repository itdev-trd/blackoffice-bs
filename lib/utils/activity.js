"use client";

import { supabase } from "@/lib/supabase/client";

// id ประจำเบราว์เซอร์/เครื่อง (สุ่มครั้งเดียวเก็บใน localStorage) — ใช้นับว่าเมลเดียวออนไลน์กี่เครื่อง
export function getDeviceId() {
  try {
    let id = localStorage.getItem("ui.device_id");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("ui.device_id", id);
    }
    return id;
  } catch {
    return null;
  }
}

// บันทึกกิจกรรมการใช้งาน (audit log) — fire-and-forget ไม่ให้กระทบ UX
export async function logActivity(event, detail) {
  try {
    await supabase.functions.invoke("log-activity", {
      body: { event, detail: detail ?? null, user_agent: navigator.userAgent, device_id: getDeviceId() },
    });
  } catch {
    /* เงียบไว้ */
  }
}
