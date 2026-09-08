"use client";

import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";

/**
 * ส่ง "ระยะข้อมูลลูกค้า" ของห้องเดียวขึ้น Meta (Conversions API for Business Messaging)
 *
 * ทำไมต้องผ่าน event: Meta ไม่มี API ให้ตั้งค่า dropdown "ระยะข้อมูลลูกค้า" ใน Leads Center
 * ตรง ๆ (ตรวจแล้วทั้ง /{page}/lead_stages และ /{page}/crm_lead_stages = ไม่มี path นี้
 * และอ่านตัว dataset ก็ติด whitelist) ทางเดียวที่เปิดคือส่ง event เข้า dataset ของเพจ
 * แล้ว Leads Center ขยับระยะตาม event ที่ได้รับ
 *
 * ข้อจำกัดของ Meta ที่ต้องรู้: รับ event ย้อนหลังไม่เกิน 7 วันนับจากข้อความล่าสุดของลูกค้า
 * ห้องที่เงียบไปนานกว่านั้นจะถูกข้าม และฝั่ง server บันทึกเหตุผลไว้ใน meta_push_error
 *
 * คืนค่า { state, note } เพื่อให้แต่ละหน้าเอาไปแสดงตามสไตล์ของตัวเอง
 *   ok | skipped | error
 */
export async function pushLeadStageToMeta(id) {
  try {
    const { data, error } = await supabase.functions.invoke("push-lead-status", { body: { ids: [id] } });
    if (error || !data?.ok) {
      return { state: "error", note: data?.error || (await readFunctionErrorMessage(error)) || "ส่งสถานะไม่สำเร็จ" };
    }
    if (data.success > 0) return { state: "ok", note: "" };
    if (data.skipped > 0) return { state: "skipped", note: data.errors?.[0] || "Meta ไม่รับสถานะนี้" };
    if (data.failed > 0) return { state: "error", note: data.errors?.[0] || "Meta ปฏิเสธ" };
    // eligible = 0 คือสถานะนี้ส่งไปแล้ว ไม่มีอะไรต้องทำ = ตรงกันอยู่แล้ว
    return { state: "ok", note: "" };
  } catch (e) {
    return { state: "error", note: e instanceof Error ? e.message : String(e) };
  }
}
