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
// ชื่อป้ายที่ใช้แทนระยะใน Meta — ต้องตรงกับ CHAT_STAGES และกับ STAGE_LABELS ฝั่ง edge function
const STAGE_LABEL_BY_KEY = {
  new: "มาใหม่",
  qualified: "มีคุณสมบัติ",
  converted: "สร้างคอนเวอร์ชั่นแล้ว",
  account_opened: "ลูกค้าเปิดบัญชีใหม่",
  disqualified: "ไม่มีคุณสมบัติ",
};

/**
 * ติด "ป้าย" ชื่อเดียวกับระยะให้ด้วย เพื่อให้เห็นระยะในกล่องข้อความของ Meta
 *
 * ทำไมต้องมีทั้งสองอย่าง: ดรอปดาวน์ "ระยะข้อมูลลูกค้า" ใน Leads Center เขียนผ่าน API ไม่ได้
 * (ไม่มี endpoint) event ที่ส่งผ่าน CAPI เป็นสัญญาณให้ระบบโฆษณาเรียนรู้ ไม่ได้เปลี่ยนค่าในช่องนั้น
 * ส่วนป้ายกำกับเขียนได้และเห็นข้างบทสนทนา จึงใช้ป้ายเป็นตัวสะท้อนระยะให้ตรงกันเท่าที่ทำได้
 */
export async function pushStageLabelToMeta(id, stageKey) {
  const label = STAGE_LABEL_BY_KEY[stageKey];
  if (!label) return { state: "skipped", note: "ระยะนี้ไม่มีป้ายคู่กัน" };
  try {
    const { data, error } = await supabase.functions.invoke("chat-labels", {
      body: { action: "stage_label", id, stage_label: label },
    });
    if (error || !data?.ok) {
      return { state: "error", note: data?.error || (await readFunctionErrorMessage(error)) || "ติดป้ายระยะไม่สำเร็จ" };
    }
    return { state: "ok", note: "" };
  } catch (e) {
    return { state: "error", note: e instanceof Error ? e.message : String(e) };
  }
}

export async function pushLeadStageToMeta(id) {
  try {
    const { data, error } = await supabase.functions.invoke("push-lead-status", { body: { ids: [id] } });
    if (error || !data?.ok) {
      return { state: "error", note: data?.error || (await readFunctionErrorMessage(error)) || "ส่งสถานะไม่สำเร็จ" };
    }
    if (data.success > 0) return { state: "ok", note: "" };
    if (data.skipped > 0) return { state: "skipped", note: data.errors?.[0] || "Meta ไม่รับสถานะนี้" };
    if (data.failed > 0) return { state: "error", note: data.errors?.[0] || "Meta ปฏิเสธ" };
    // eligible = 0 คือไม่มีอะไรต้องส่ง — อย่ารายงานว่า "ส่งแล้ว" เพราะรอบนี้ไม่ได้ส่งอะไรเลย
    // (เคยทำให้เข้าใจผิด: ตอนบันทึกระยะล้มเหลว สถานะเดิมยังตรงกับที่ส่งไป จึงขึ้นว่าสำเร็จ)
    return { state: "insync", note: "" };
  } catch (e) {
    return { state: "error", note: e instanceof Error ? e.message : String(e) };
  }
}
