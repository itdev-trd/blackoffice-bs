// supabase/functions/set-openai-key/index.ts
// ให้แอดมินสูงสุดใส่/แก้ OpenAI API key ได้จากหน้าตั้งค่า — เก็บใน app_secrets (RLS ปิดสนิท อ่าน/เขียนได้เฉพาะ service role)
// action: "status" (เช็คว่าตั้งไว้หรือยัง, ไม่คืนคีย์เต็ม) | "save" (ตรวจคีย์ก่อนบันทึก)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
const mask = (key: string) => (key.length > 8 ? `${key.slice(0, 4)}••••${key.slice(-4)}` : "••••");

async function verifyKey(key: string) {
  try {
    const resp = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) return { valid: true };
    const body = await resp.json().catch(() => ({}));
    return { valid: false, error: body?.error?.message || `OpenAI ${resp.status}` };
  } catch (error) {
    return { valid: false, error: String(error instanceof Error ? error.message : error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // admin เท่านั้น — ไม่เปิดผ่าน allowed_settings เหมือน setting อื่นๆ เพราะเป็นคีย์ที่ใช้ร่วมกันทั้งระบบ
    const auth = await authorizeRequest(req, { admin: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));

    if (body.action === "status") {
      const { data } = await admin.from("app_secrets").select("value, updated_at").eq("key", "openai_api_key").maybeSingle();
      const value = String(data?.value || "");
      return json({ ok: true, configured: !!value, masked: value ? mask(value) : null, updated_at: data?.updated_at || null });
    }

    const apiKey = String(body.api_key || "").trim();
    if (!apiKey) throw new Error("กรุณากรอก API key");
    const check = await verifyKey(apiKey);
    if (!check.valid) throw new Error(`คีย์ใช้ไม่ได้: ${check.error}`);

    const now = new Date().toISOString();
    const { error } = await admin.from("app_secrets").upsert({ key: "openai_api_key", value: apiKey, updated_at: now });
    if (error) throw error;
    return json({ ok: true, saved: true, configured: true, masked: mask(apiKey), updated_at: now });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
