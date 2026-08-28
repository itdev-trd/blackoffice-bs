import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CACHE_KEY = "meta_pages_cache";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

let memoryPages: any[] | null = null;
let memoryUpdatedAt = 0;
let inFlight: Promise<any> | null = null;

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
  } = {},
): Promise<any> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
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

  if (!options.forceRefresh && memoryPages?.length && now - memoryUpdatedAt < ttlMs && !lacks(memoryPages)) {
    return { data: memoryPages, cached: true, cache: "memory" };
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
      .eq("key", CACHE_KEY)
      .maybeSingle();

    if (row?.value) {
      stalePages = parseCachedValue(row.value);
      staleUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      const age = now - staleUpdatedAt;
      if (!options.forceRefresh && stalePages.length && age >= 0 && age < ttlMs && !lacks(stalePages)) {
        memoryPages = stalePages;
        memoryUpdatedAt = staleUpdatedAt || now;
        return { data: stalePages, cached: true, cache: "database", age_ms: age };
      }
    }
  } catch (error) {
    console.warn("meta pages cache read failed", error);
  }

  if (inFlight) return await inFlight;

  inFlight = (async () => {
    const fresh = await fetchJson(
      `${base}/me/accounts?fields=id,name,access_token,picture.width(96).height(96){url},instagram_business_account{id,username,profile_picture_url}&limit=100&access_token=${userToken}`,
    );

    if (Array.isArray(fresh?.data) && fresh.data.length) {
      const updatedAt = new Date().toISOString();
      memoryPages = fresh.data;
      memoryUpdatedAt = Date.now();
      const { error } = await admin.from("app_secrets").upsert({
        key: CACHE_KEY,
        value: JSON.stringify(fresh.data),
        updated_at: updatedAt,
      });
      if (error) console.warn("meta pages cache write failed", error.message);
      return { ...fresh, cached: false, cache: "meta" };
    }

    // Do not keep hammering Meta when it is unavailable/rate-limited.
    if (stalePages.length) {
      memoryPages = stalePages;
      memoryUpdatedAt = staleUpdatedAt || Date.now();
      return { data: stalePages, cached: true, stale: true, cache: "database-stale", meta_error: fresh?.error ?? null };
    }

    return fresh;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
