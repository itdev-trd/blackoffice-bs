// Shared cache สำหรับผลลิสต์จาก Meta (แคมเปญ/ชุด/โฆษณา) — ใช้ตาราง ad_insights_cache ร่วมกัน
// เก็บ payload ทั้งก้อน · ใครดึงบัญชี/แคมเปญไหนแล้ว user อื่นได้จาก cache เลย ไม่ยิง Meta ซ้ำ (ลด #17 ต่อบัญชี)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let _admin: any = null;
function admin() {
  return _admin ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// อ่าน cache — คืน payload ถ้ายังไม่เกิน ttlMs, ไม่งั้นคืน null
export async function cacheGet(key: string, ttlMs: number): Promise<{ payload: any; fetched_at: string } | null> {
  try {
    const { data } = await admin().from("ad_insights_cache").select("payload, fetched_at").eq("cache_key", key).maybeSingle();
    if (data?.payload && data.fetched_at && (Date.now() - new Date(data.fetched_at).getTime()) < ttlMs) return { payload: data.payload, fetched_at: data.fetched_at };
  } catch { /* cache พลาด = ดึงสด */ }
  return null;
}

export async function cacheSet(key: string, node_id: string, level: string, range_key: string, payload: any): Promise<void> {
  try {
    await admin().from("ad_insights_cache").upsert({ cache_key: key, node_id: String(node_id), level, range_key, payload, fetched_at: new Date().toISOString() });
  } catch { /* เขียน cache พลาดไม่กระทบผล */ }
}

// อ่านค่า TTL (นาที) จาก settings.meta_list_cache_ttl_min (ว่าง = ค่าเริ่มต้น 60 วัน — อัปเดตเมื่อกดรีเฟรชเอง)
export async function listCacheTtlMs(): Promise<number> {
  try {
    const { data } = await admin().from("settings").select("value").eq("key", "meta_list_cache_ttl_min").maybeSingle();
    const n = Number(data?.value);
    if (n > 0) return n * 60 * 1000;
  } catch { /* ใช้ค่าเริ่มต้น */ }
  return 60 * 24 * 60 * 60 * 1000;   // 60 วัน
}
