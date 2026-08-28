"use client";

// supabase-js ไม่ใส่ error message จริงจาก Edge Function ไว้ใน error.message ตรงๆ
// ต้องดึง response body จาก error.context (FunctionsHttpError) เพื่ออ่านข้อความจริงที่ฟังก์ชันส่งกลับมา
// แปลงค่า error เป็นข้อความเสมอ (บางแพลตฟอร์มส่ง error เป็น object -> กัน "[object Object]")
export async function readFunctionErrorMessage(error) {
  const toMsg = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object") return v.message || v.msg || v.error_description || JSON.stringify(v);
    return String(v);
  };
  try {
    if (error?.context?.json) {
      const body = await error.context.json();
      const m = toMsg(body?.error) || toMsg(body?.message);
      if (m) return m;
    } else if (error?.context?.text) {
      const text = await error.context.text();
      if (text) return text;
    }
  } catch {
    // เผื่ออ่าน body ซ้ำไม่ได้ (เช่นถูกอ่านไปแล้ว) — ใช้ fallback ด้านล่างแทน
  }
  return toMsg(error?.message) || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ";
}
