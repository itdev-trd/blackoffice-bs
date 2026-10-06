import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CACHE_KEY = "meta_pages_cache";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// แคชแยกตาม cacheKey — page access token ผูกกับ "แอปที่ออก user token" ที่เอาไปแลก
// ถ้าใช้ช่องเดียวร่วมกัน token ตอบแชท (แอปที่มีสิทธิ์ส่งถึงลูกค้า) จะถูกแคชของงานโฆษณาทับ
// แล้วการส่งจะกลับไปใช้ page token ของแอปที่ส่งไม่ได้ = ตั้ง token ตอบแชทแล้วไม่มีผล
type CacheSlot = { pages: any[] | null; updatedAt: number; inFlight: Promise<any> | null };
const slots = new Map<string, CacheSlot>();
const slotOf = (key: string): CacheSlot => {
  let slot = slots.get(key);
  if (!slot) { slot = { pages: null, updatedAt: 0, inFlight: null }; slots.set(key, slot); }
  return slot;
};

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  return await response.json().catch(() => ({}));
}

function parseCachedValue(value: unknown): any[] {
  if (!value) return [];
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray((parsed as any)?.pages)) return (parsed as any).pages;
  if (Array.isArray((parsed as any)?.data)) return (parsed as any).data;
  return [];
}

/**
 * Returns Meta pages and Page access tokens from a shared DB cache.
 * - Cache TTL defaults to 24 hours.
 * - Keeps an in-memory copy inside warm Edge isolates.
 * - Coalesces simultaneous calls in the same isolate.
 * - Falls back to stale DB cache if Meta is rate-limited or unavailable.
 */
export async function getMetaPages(
  base: string,
  userToken: string,
  options: {
    ttlMs?: number;
    forceRefresh?: boolean;
    mustIncludePageId?: string;
    mustIncludeInstagramAccountId?: string;
    mustIncludeInstagramForPageId?: string;
    cacheKey?: string;
  } = {},
): Promise<any> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cacheKey = options.cacheKey || CACHE_KEY;
  const slot = slotOf(cacheKey);
  const now = Date.now();
  // ถ้าระบุว่า "ต้องมีเพจนี้" แล้ว cache ไม่มี (เช่นเพิ่งลิงก์เพจใหม่) → บังคับดึงสด 1 ครั้ง
  const lacks = (pages: any[] | null) => {
    const rows = pages ?? [];
    if (options.mustIncludePageId && !rows.some((p: any) => String(p?.id) === String(options.mustIncludePageId))) return true;
    if (options.mustIncludeInstagramAccountId && !rows.some((p: any) =>
      String(p?.instagram_business_account?.id || "") === String(options.mustIncludeInstagramAccountId)
    )) return true;
    if (options.mustIncludeInstagramForPageId && !rows.some((p: any) =>
      String(p?.id) === String(options.mustIncludeInstagramForPageId) && !!p?.instagram_business_account?.id
    )) return true;
    return false;
  };

  if (!options.forceRefresh && slot.pages?.length && now - slot.updatedAt < ttlMs && !lacks(slot.pages)) {
    return { data: slot.pages, cached: true, cache: "memory" };
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let stalePages: any[] = [];
  let staleUpdatedAt = 0;

  try {
    const { data: row } = await admin
      .from("app_secrets")
      .select("value, updated_at")
      .eq("key", cacheKey)
      .maybeSingle();

    if (row?.value) {
      stalePages = parseCachedValue(row.value);
      staleUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      const age = now - staleUpdatedAt;
      if (!options.forceRefresh && stalePages.length && age >= 0 && age < ttlMs && !lacks(stalePages)) {
        slot.pages = stalePages;
        slot.updatedAt = staleUpdatedAt || now;
        return { data: stalePages, cached: true, cache: "database", age_ms: age };
      }
    }
  } catch (error) {
    console.warn("meta pages cache read failed", error);
  }

  if (slot.inFlight) return await slot.inFlight;

  slot.inFlight = (async () => {
    const fresh = await fetchJson(
      `${base}/me/accounts?fields=id,name,access_token,picture.width(96).height(96){url},instagram_business_account{id,username,profile_picture_url}&limit=100&access_token=${userToken}`,
    );

    if (Array.isArray(fresh?.data) && fresh.data.length) {
      const updatedAt = new Date().toISOString();
      slot.pages = fresh.data;
      slot.updatedAt = Date.now();
      const { error } = await admin.from("app_secrets").upsert({
        key: cacheKey,
        value: JSON.stringify(fresh.data),
        updated_at: updatedAt,
      });
      if (error) console.warn("meta pages cache write failed", error.message);
      return { ...fresh, cached: false, cache: "meta" };
    }

    // Do not keep hammering Meta when it is unavailable/rate-limited.
    if (stalePages.length) {
      slot.pages = stalePages;
      slot.updatedAt = staleUpdatedAt || Date.now();
      return { data: stalePages, cached: true, stale: true, cache: "database-stale", meta_error: fresh?.error ?? null };
    }

    return fresh;
  })();

  try {
    return await slot.inFlight;
  } finally {
    slot.inFlight = null;
  }
}

/**
 * เพจสำหรับงาน "อ่านแชท" (ดึงห้องแชท/IG/คอมเมนต์/webhook) — รวมเพจจาก token ตอบแชทกับ token หลัก
 *
 * ทำไม: 6 ต.ค. 69 แอปหลัก (besight-backend) โดน Meta ตอบ "API access blocked." ทุกคำขอ
 * page token ที่แลกจาก token หลัก (แคชไว้ 24 ชม.) ใช้ไม่ได้ทั้งหมด → ดึงแชทไม่ได้เลยทั้งที่ token ตอบแชท
 * (แอปที่มี Advanced Access) ยังใช้ได้และเห็นเพจเดียวกัน
 * จึงเอา page token ของ token ตอบแชทก่อน แล้วเติมเพจที่มีแค่ฝั่ง token หลักต่อท้าย
 * ไม่ได้ตั้ง token ตอบแชท = ได้ผลเหมือน getMetaPages(token หลัก) เดิมทุกอย่าง
 */
export async function getChatPages(
  base: string,
  options: { forceRefresh?: boolean; mustIncludePageId?: string; mustIncludeInstagramAccountId?: string; mustIncludeInstagramForPageId?: string } = {},
): Promise<any> {
  const { getMetaMessagingContext, getMetaToken } = await import("./meta.ts");
  const msg = await getMetaMessagingContext();
  const mainToken = await getMetaToken();
  const lists: any[][] = [];
  let firstError: any = null;
  // เพจของระบบนี้ = เพจที่ token หลักเห็น (getMetaPages คืนแคชเก่าให้แม้ token หลักใช้ไม่ได้)
  // token ตอบแชทเป็นของแอปอื่นที่เห็นเพจของธุรกิจอื่นด้วย (20+ เพจ) — ห้ามดึงแชทเพจพวกนั้นเข้ามา
  // (เคยหลุด 6 ต.ค. 69: ดึงแชทเพจคนอื่นเข้ามา ~450 ห้องในรอบเดียว) · page_lead_config ใช้แยกไม่ได้
  // เพราะมีแถว sync_enabled=true ของทุกเพจที่ token ตอบแชทเห็นอยู่แล้ว
  let mainPages: any[] = [];
  if (mainToken) {
    const r = await getMetaPages(base, mainToken, options);
    if (Array.isArray(r?.data)) mainPages = r.data; else firstError = r?.error;
  }
  const allowed = new Set(mainPages.map((p: any) => String(p?.id || "")));
  if (msg.dedicated && msg.token) {
    // ไม่ส่ง mustInclude* ให้ฝั่งตอบแชท — เพจที่ token นี้ไม่เห็นจะทำให้ดึงสดทุกครั้งโดยเปล่าประโยชน์
    const r = await getMetaPages(base, msg.token, { forceRefresh: options.forceRefresh, cacheKey: msg.cacheKey });
    if (Array.isArray(r?.data)) lists.push(r.data.filter((p: any) => allowed.has(String(p?.id || ""))));
    else firstError = firstError || r?.error;
  }
  lists.push(mainPages);
  const byId = new Map<string, any>();
  for (const list of lists) for (const p of list) {
    const id = String(p?.id || "");
    if (!id) continue;
    const cur = byId.get(id);
    if (!cur) byId.set(id, p);
    else if (!cur.instagram_business_account && p.instagram_business_account) byId.set(id, { ...cur, instagram_business_account: p.instagram_business_account });
  }
  const data = [...byId.values()];
  return data.length ? { data } : (firstError ? { error: firstError } : { data: [] });
}
