import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("inbox realtime patches local state instead of reloading the full list after every event", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /function rowMatchesCurrentList\(row\)/);
  assert.match(frontend, /const \{ transcript: _transcript, ads_context: _adsContext, \.\.\.lightRow \} = row/);
  assert.doesNotMatch(frontend, /debounce = setTimeout\(\(\) => loadRef\.current\(\{ refreshAfterCurrent: true \}\), 400\)/);
  assert.match(frontend, /if \(countChanged\) scheduleUnreadRefresh\(\)/);
});

test("opening a chat cancels stale requests and guards all asynchronous state updates", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /openRequestRef\.current\.controller\?\.abort\(\)/);
  assert.match(frontend, /abortSignal\(controller\.signal\)/);
  assert.match(frontend, /if \(openSeq !== openRequestRef\.current\.seq\) return/);
  assert.match(frontend, /โหลดแชทเกิน 12 วินาที/);
  assert.match(frontend, /const translationPromise = supabase\.functions\.invoke/);
});

test("inbox fallback jobs are client-coalesced and ad metadata is cached", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const adDetails = await read("supabase/functions/ad-source-details/index.ts");
  assert.match(frontend, /runGuardedSync\("comments"/);
  assert.match(frontend, /runGuardedSync\("instagram"/);
  assert.match(frontend, /focusRefreshAtRef\.current < 1500/);
  assert.match(frontend, /adSourceCacheRef\.current\.get\(cacheKey\)/);
  assert.match(adDetails, /const CACHE_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(adDetails, /adCache\.get\(adId\)/);
});

test("chat update latency keeps a bounded local diagnostic trail without customer message text", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /window\.__CHAT_LATENCY__/);
  assert.match(frontend, /meta_to_db_ms/);
  assert.match(frontend, /db_to_ui_ms/);
  assert.match(frontend, /history\.slice\(-99\)/);
});
