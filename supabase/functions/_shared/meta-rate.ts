const RATE_GUARD_KEY = "meta_background_rate_guard";
const WARN_AT = 80;
const STOP_AT = 90;

type AppUsage = { call_count?: number; total_cputime?: number; total_time?: number };

function appUsageFrom(response: Response): AppUsage | null {
  const raw = response.headers.get("x-app-usage");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function maxUsage(usage: AppUsage | null): number {
  if (!usage) return 0;
  return Math.max(
    Number(usage.call_count) || 0,
    Number(usage.total_cputime) || 0,
    Number(usage.total_time) || 0,
  );
}

export async function getMetaBackgroundGuard(admin: any): Promise<{ blocked: boolean; until: string | null; usage: AppUsage | null }> {
  try {
    const { data } = await admin.from("settings").select("value").eq("key", RATE_GUARD_KEY).maybeSingle();
    const value = data?.value || {};
    const until = value.until ? String(value.until) : null;
    return { blocked: !!until && new Date(until).getTime() > Date.now(), until, usage: value.usage || null };
  } catch {
    return { blocked: false, until: null, usage: null };
  }
}

export async function recordMetaUsage(admin: any, response: Response, source: string): Promise<{ max: number; blocked: boolean }> {
  const usage = appUsageFrom(response);
  const max = maxUsage(usage);
  if (!usage || max < WARN_AT) return { max, blocked: false };
  const now = Date.now();
  // At 90% stop background traffic for a rolling hour. Between 80-89%, pause briefly
  // so foreground replies still have headroom and the rolling score can fall.
  const until = new Date(now + (max >= STOP_AT ? 60 : 10) * 60_000).toISOString();
  try {
    await admin.from("settings").upsert({
      key: RATE_GUARD_KEY,
      value: { at: new Date(now).toISOString(), until, source, usage },
      updated_at: new Date(now).toISOString(),
    });
  } catch { /* usage logging must never break the user action */ }
  return { max, blocked: max >= STOP_AT };
}

