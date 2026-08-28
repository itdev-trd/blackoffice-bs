// supabase/functions/_shared/meta.ts
// ตัวช่วยกลาง: ดึง META access token จากตาราง app_secrets (ตั้งจากหน้าเว็บแอปได้)
// ถ้าไม่มีในฐานข้อมูล จะ fallback ไปใช้ env META_ACCESS_TOKEN (ของเดิม)
// ใช้ service role client (bypass RLS) จึงอ่าน app_secrets ได้ ทั้งที่ฝั่ง client อ่านไม่ได้

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_CACHE_MS = 5 * 60 * 1000;
let cachedToken = "";
let cachedTokenAt = 0;

export async function getMetaToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < TOKEN_CACHE_MS) return cachedToken;
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data } = await admin
      .from("app_secrets")
      .select("value")
      .eq("key", "meta_access_token")
      .maybeSingle();
    if (data?.value) {
      cachedToken = String(data.value);
      cachedTokenAt = now;
      return cachedToken;
    }
  } catch (_e) {
    // เงียบไว้ แล้วไป fallback env
  }
  cachedToken = Deno.env.get("META_ACCESS_TOKEN") ?? "";
  cachedTokenAt = now;
  return cachedToken;
}
