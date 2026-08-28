// supabase/functions/_shared/ai-prompts.ts
// ตัวช่วยกลาง: ให้ผู้ใช้กำหนด "system prompt" เองต่อฟีเจอร์ AI ได้ (override ค่าเริ่มต้นในโค้ด)
// เก็บใน settings key = "ai_prompts" เป็น JSON map { <featureKey>: "<prompt ที่ผู้ใช้เขียน>" }
// ถ้าไม่มี/ว่าง → ใช้ค่าเริ่มต้น (fallback) ของแต่ละฟังก์ชันตามเดิม
// อ่านด้วย service role (bypass RLS) เหมือน getMetaToken

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ดึง prompt override ทั้งชุด (เรียกครั้งเดียวต่อ request แล้วส่งต่อได้)
export async function getPromptOverrides(): Promise<Record<string, string>> {
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await admin
      .from("settings")
      .select("value")
      .eq("key", "ai_prompts")
      .maybeSingle();
    const map = (data?.value ?? {}) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) if (typeof v === "string") out[k] = v;
    return out;
  } catch (_e) {
    return {};
  }
}

// ดึง prompt override ของฟีเจอร์เดียว (คืน "" ถ้าไม่มี)
export async function getPromptOverride(featureKey: string): Promise<string> {
  const all = await getPromptOverrides();
  const v = all[featureKey];
  return typeof v === "string" ? v.trim() : "";
}

// เลือกใช้: override ถ้าผู้ใช้กำหนดไว้ ไม่งั้นใช้ค่าเริ่มต้น
export function withOverride(fallback: string, override?: string): string {
  return override && override.trim() ? override.trim() : fallback;
}
