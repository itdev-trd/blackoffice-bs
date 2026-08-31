import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// อ่านคีย์ OpenAI — เช็คจากตาราง app_secrets (ตั้งได้จากหน้าตั้งค่า โดยแอดมินเท่านั้น) ก่อนเสมอ
// ถ้ายังไม่เคยตั้งผ่านหน้าเว็บ ค่อย fallback ไปที่ secret เดิมของ Supabase project (IMAGE_API_KEY)
// เพื่อไม่ให้ของเดิมที่ deploy ไว้แล้วพัง ระหว่างที่ยังไม่มีใครตั้งค่าใหม่
export async function getOpenAIKey(): Promise<string> {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await admin.from("app_secrets").select("value").eq("key", "openai_api_key").maybeSingle();
  return String(data?.value || "").trim() || Deno.env.get("IMAGE_API_KEY") || "";
}
