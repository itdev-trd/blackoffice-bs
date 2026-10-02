import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// อ่านคีย์ OpenAI — เช็คจากตาราง app_secrets (ตั้งได้จากหน้าตั้งค่า โดยแอดมินเท่านั้น) ก่อนเสมอ
// ถ้ายังไม่เคยตั้งผ่านหน้าเว็บ ค่อย fallback ไปที่ secret เดิมของ Supabase project (IMAGE_API_KEY)
// เพื่อไม่ให้ของเดิมที่ deploy ไว้แล้วพัง ระหว่างที่ยังไม่มีใครตั้งค่าใหม่
export async function getOpenAIKey(): Promise<string> {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await admin.from("app_secrets").select("value").eq("key", "openai_api_key").maybeSingle();
  return String(data?.value || "").trim() || Deno.env.get("IMAGE_API_KEY") || "";
}

// แปลง error ของ OpenAI เป็นข้อความที่แอดมินรู้ว่าต้องทำอะไร — เดิมโชว์ JSON ดิบ ๆ ทั้งก้อนใต้ช่องพิมพ์
// (เจอจริง 2 ต.ค. 69: เครดิตหมด → แปลไม่ได้ และส่งหาลูกค้าที่ไม่ได้พิมพ์ไทยไม่ได้เลย)
export function openAIErrorText(status: number, body: string): string {
  let code = "", msg = "";
  try { const j = JSON.parse(body); code = String(j?.error?.code || j?.error?.type || ""); msg = String(j?.error?.message || ""); } catch { /* ไม่ใช่ JSON */ }
  if (code === "credit_balance_exhausted" || code === "insufficient_quota") {
    return "เครดิต OpenAI หมด แปลข้อความไม่ได้ — เจ้าของระบบต้องเติมเครดิตที่ platform.openai.com → Billing · ระหว่างนี้เลือก \"แปลเป็น: ไทย\" เพื่อส่งโดยไม่แปล";
  }
  if (status === 401 || code === "invalid_api_key") return "คีย์ OpenAI ใช้ไม่ได้ — ตั้งใหม่ที่ ตั้งค่า → OpenAI API Key";
  if (status === 429) return "OpenAI ถูกเรียกถี่เกินไป ลองใหม่อีกครั้งในไม่กี่วินาที";
  if (status >= 500) return "OpenAI ขัดข้องชั่วคราว ลองใหม่อีกครั้ง";
  return `OpenAI ตอบ ${status}${msg ? `: ${msg.slice(0, 160)}` : ""}`;
}
