import { getMetaBackgroundGuard, recordMetaUsage } from "./meta-rate.ts";

const MAP_KEY = "comment_ad_post_map";
// The ad -> post relationship changes much less often than comments. Rebuilding it scans
// every accessible ad account, so keep it for six hours instead of doing that per Inbox open.
const MAP_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAP_REFRESH_LEASE_MS = 2 * 60 * 1000;

export type CommentAd = { ad_id: string; ad_name: string | null; page_id: string };
type CommentAdMap = Record<string, CommentAd[]>;
let mapRefreshInFlight: Promise<CommentAdMap> | null = null;

function explicitPageIds(value: any): string[] {
  if (!value || typeof value !== "object") return [];
  if (value.mode === "single") return value.single ? [String(value.single)] : [];
  if (value.mode === "multi") return Array.isArray(value.multi) ? value.multi.map(String).filter(Boolean) : [];
  return [];
}

export async function getSelectedCommentPageIds(admin: any): Promise<string[]> {
  const { data, error } = await admin.from("settings")
    .select("key,value")
    .like("key", "inbox_page_filter:%");
  if (error) throw new Error(`อ่านเพจที่เลือกไว้ไม่สำเร็จ: ${error.message}`);
  const ids = new Set<string>();
  // multi=[] ในหน้า Inbox แปลว่า "ทุกเพจ" ไม่ใช่ไม่เลือกเพจ จึงต้องขยายตามสิทธิ์ของเจ้าของ filter
  const needsAll = (data || []).filter((row: any) => row?.value?.mode === "multi" && Array.isArray(row.value.multi) && row.value.multi.length === 0);
  let allPageIds: string[] = [];
  const permissionByEmail: Record<string, any> = {};
  if (needsAll.length) {
    const [{ data: pages }, { data: permissions }] = await Promise.all([
      admin.from("page_lead_config").select("page_id"),
      admin.from("user_permissions").select("email,role,allowed_pages"),
    ]);
    allPageIds = (pages || []).map((p: any) => String(p.page_id));
    for (const permission of permissions || []) permissionByEmail[String(permission.email || "")] = permission;
  }
  for (const row of data || []) {
    const explicit = explicitPageIds(row.value);
    for (const id of explicit) ids.add(id);
    if (row?.value?.mode === "multi" && Array.isArray(row.value.multi) && row.value.multi.length === 0) {
      const email = String(row.key || "").slice("inbox_page_filter:".length);
      const permission = permissionByEmail[email];
      const scope = permission?.role === "analyze_only" && Array.isArray(permission.allowed_pages)
        ? permission.allowed_pages.map(String)
        : allPageIds;
      for (const id of scope) ids.add(id);
    }
  }
  return [...ids];
}

async function graphAll(admin: any, url: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < 10; page++) {
    const r = await fetch(next);
    const usage = await recordMetaUsage(admin, r, "comment_ad_map");
    if (usage.blocked) throw new Error("Meta usage reached the background safety threshold");
    const j = await r.json().catch(() => ({}));
    if (j?.error) throw new Error(j.error.error_user_msg || j.error.message || "Meta Graph API error");
    out.push(...(j?.data || []));
    next = j?.paging?.next || null;
  }
  return out;
}

export async function refreshCommentAdMap(admin: any, base: string, token: string, selectedPageIds: string[]): Promise<CommentAdMap> {
  if (mapRefreshInFlight) return await mapRefreshInFlight;
  mapRefreshInFlight = (async () => {
  const selected = new Set(selectedPageIds.map(String));
  const map: CommentAdMap = {};
  const nowIso = new Date().toISOString();
  // Best-effort cross-isolate lease. A second Edge isolate will reuse the existing map
  // instead of starting another full Marketing API scan at the same time.
  const { data: currentRow } = await admin.from("settings").select("value").eq("key", MAP_KEY).maybeSingle();
  const currentValue = currentRow?.value || {};
  const refreshingAge = Date.now() - new Date(currentValue.refreshing_at || 0).getTime();
  if (Number.isFinite(refreshingAge) && refreshingAge >= 0 && refreshingAge < MAP_REFRESH_LEASE_MS) {
    return currentValue.posts && typeof currentValue.posts === "object" ? currentValue.posts : {};
  }
  await admin.from("settings").upsert({
    key: MAP_KEY,
    value: { ...currentValue, refreshing_at: nowIso },
    updated_at: nowIso,
  });
  if (selected.size) {
    const accounts = await graphAll(admin, `${base}/me/adaccounts?fields=account_id&limit=100&access_token=${encodeURIComponent(token)}`);
    for (const account of accounts) {
      const accountId = String(account.account_id || account.id || "").replace(/^act_/, "");
      if (!accountId) continue;
      const fields = "id,name,effective_status,creative{effective_object_story_id}";
      const ads = await graphAll(admin, `${base}/act_${accountId}/ads?fields=${encodeURIComponent(fields)}&limit=500&access_token=${encodeURIComponent(token)}`);
      for (const ad of ads) {
        const postId = ad?.creative?.effective_object_story_id ? String(ad.creative.effective_object_story_id) : "";
        const pageId = postId.split("_")[0] || "";
        if (!postId || !selected.has(pageId)) continue;
        const item: CommentAd = { ad_id: String(ad.id), ad_name: ad.name ? String(ad.name) : null, page_id: pageId };
        const list = map[postId] || [];
        if (!list.some((x) => x.ad_id === item.ad_id)) list.push(item);
        map[postId] = list;
      }
    }
  }
  const { error } = await admin.from("settings").upsert({
    key: MAP_KEY,
    value: { updated_at: new Date().toISOString(), refreshing_at: null, selected_page_ids: [...selected], posts: map },
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`บันทึกแผนที่โฆษณาไม่สำเร็จ: ${error.message}`);
  return map;
  })();
  try {
    return await mapRefreshInFlight;
  } finally {
    mapRefreshInFlight = null;
  }
}

export async function getOrRefreshCommentAdMap(
  admin: any,
  base: string,
  token: string,
  selectedPageIds: string[],
  options: { force?: boolean } = {},
): Promise<{ posts: CommentAdMap; refreshed: boolean; rate_guarded: boolean }> {
  const { data } = await admin.from("settings").select("value").eq("key", MAP_KEY).maybeSingle();
  const value = data?.value || {};
  const posts: CommentAdMap = value.posts && typeof value.posts === "object" ? value.posts : {};
  const cachedSelected = Array.isArray(value.selected_page_ids) ? value.selected_page_ids.map(String).sort() : [];
  const currentSelected = selectedPageIds.map(String).sort();
  const age = Date.now() - new Date(value.updated_at || 0).getTime();
  const scopeChanged = JSON.stringify(cachedSelected) !== JSON.stringify(currentSelected);
  if (!options.force && !scopeChanged && Number.isFinite(age) && age >= 0 && age < MAP_MAX_AGE_MS) {
    return { posts, refreshed: false, rate_guarded: false };
  }
  const guard = await getMetaBackgroundGuard(admin);
  if (guard.blocked) return { posts, refreshed: false, rate_guarded: true };
  return { posts: await refreshCommentAdMap(admin, base, token, selectedPageIds), refreshed: true, rate_guarded: false };
}

export async function resolveCommentAds(
  admin: any,
  base: string,
  token: string,
  postId: string,
  selectedPageIds: string[],
): Promise<CommentAd[]> {
  const { posts } = await getOrRefreshCommentAdMap(admin, base, token, selectedPageIds);
  return Array.isArray(posts[postId]) ? posts[postId] : [];
}
