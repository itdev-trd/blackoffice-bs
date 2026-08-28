import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../ai-ads-app.jsx", import.meta.url), "utf8");
const tradingview = await readFile(new URL("../supabase/functions/tradingview/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260822120000_tv_access_last_granted_at.sql", import.meta.url), "utf8");
const grantedAtMigration = await readFile(new URL("../supabase/migrations/20260823013000_tv_granted_at.sql", import.meta.url), "utf8");
const syncMigration = await readFile(new URL("../supabase-migration-tv-sync-cron.sql", import.meta.url), "utf8");
const disableSyncMigration = await readFile(new URL("../supabase/migrations/20260823020000_disable_tv_sync.sql", import.meta.url), "utf8");
const n8n = await readFile(new URL("../n8n-tv-access-code.js", import.meta.url), "utf8");
const n8nWorkflow = JSON.parse(await readFile(new URL("../n8n-tv-access-webhook.json", import.meta.url), "utf8"));

test("TV member date filter uses the latest grant timestamp", () => {
  assert.match(app, /const memberGrantedAt = \(a\) => a\.last_granted_at \|\| a\.granted_at \|\| a\.created_at/);
  assert.match(tradingview, /last_granted_at: nowIso/);
  assert.match(migration, /add column if not exists last_granted_at timestamptz/);
  assert.match(migration, /greatest\(granted_at, edited_at, updated_at, created_at\)/);
  assert.match(grantedAtMigration, /add column if not exists tv_granted_at timestamptz/);
});

test("renaming a TV user revokes the old username and grants the new username", () => {
  const updateStart = tradingview.indexOf('if (action === "update_member")');
  const validateStart = tradingview.indexOf('if (action === "validate_user")', updateStart);
  const updateBlock = tradingview.slice(updateStart, validateStart);
  const revokeIndex = updateBlock.indexOf('action: "revoke", username: oldUsername');
  const grantIndex = updateBlock.indexOf('action: "grant", username: requestedUsername');
  assert.ok(revokeIndex >= 0, "old username must be revoked");
  assert.ok(grantIndex > revokeIndex, "new username must be granted after the old username is revoked");
  assert.match(updateBlock, /USER TV .*มีอยู่ในสคริปต์นี้แล้ว/);
  assert.match(updateBlock, /ชดเชยสิทธิ์เดิมทันที/);
  assert.match(app, /ย้ายสิทธิ์จาก USER TV/);
  assert.doesNotMatch(app, /แก้ USER TV เปลี่ยนเฉพาะข้อมูลในระบบ/);
});

test("TV access verification checks TradingView and persists the latest result", () => {
  assert.match(tradingview, /action === "check_access"/);
  assert.match(tradingview, /tv_access_verified: found/);
  assert.match(tradingview, /tv_verified_at: nowIso/);
  assert.match(tradingview, /callN8n\(\{ action: "check_access", username: row\.username/);
  assert.match(tradingview, /callN8n/);
  assert.match(app, /ตรวจสิทธิ์บน TradingView/);
  assert.match(app, /TV: มีสิทธิ์/);
  assert.match(app, /TV: ไม่พบสิทธิ์/);
  assert.match(migration, /add column if not exists tv_access_verified boolean/);
  assert.match(n8n, /action==='check_access'/);
  assert.match(n8n, /pine_perm\/list_users/);
  assert.match(n8n, /const listed = await listAccess\(pine\)/);
  assert.match(n8n, /userGrantedAt/);
  assert.match(n8n, /tv_granted_at:userGrantedAt/);
  assert.doesNotMatch(n8n, /limit:500/);
  assert.match(n8nWorkflow.nodes.find((n) => n.name === "TV Access").parameters.jsCode, /action==='check_access'/);
  assert.match(n8nWorkflow.nodes.find((n) => n.name === "TV Access").parameters.jsCode, /const listed = await listAccess\(pine\)/);
  assert.match(n8nWorkflow.nodes.find((n) => n.name === "TV Access").parameters.jsCode, /userGrantedAt/);
});

test("nightly TV sync is batch-based and fails safe", () => {
  assert.match(syncMigration, /tv-sync-midnight-th/);
  assert.match(syncMigration, /'5 17 \* \* \*'/);
  assert.match(tradingview, /action === "sync"/);
  assert.match(tradingview, /action: "list_users", pine_id: pineId/);
  assert.match(tradingview, /res\.complete !== true/);
  assert.match(tradingview, /tv_external_members/);
  assert.match(tradingview, /stored_in: "tv_external_members"/);
  assert.match(tradingview, /ไม่แตะ tv_access/);
  assert.doesNotMatch(tradingview.slice(tradingview.indexOf('if (action === "sync")'), tradingview.indexOf('if (action === "ingest_cookie")')), /from\("tv_access"\)\.update/);
  assert.match(n8n, /action==='list_users'/);
  assert.match(n8n, /listAccess\(pineId\)/);
  assert.match(n8n, /offset/);
  assert.match(n8nWorkflow.nodes.find((n) => n.name === "TV Access").parameters.jsCode, /action==='list_users'/);
});

test("TV sync controls are disabled and removed from the UI", () => {
  assert.match(disableSyncMigration, /app_set_cron/);
  assert.match(disableSyncMigration, /'tv-sync-midnight-th'/);
  assert.match(disableSyncMigration, /false\s*\);/);
  assert.match(disableSyncMigration, /where key = 'tv_sync'/);
  assert.match(app, /filter\(\(job\) => job\.key !== "tv_sync"\)/);
  assert.doesNotMatch(app, /ดึงจาก TV/);
  assert.doesNotMatch(app, /อัปเดตทันที/);
});

test("TV member export mirrors the table columns and labels multiple indicators", () => {
  assert.match(app, /const includeIndicator = sel\.length > 1/);
  assert.match(app, /"ชื่อลูกค้า", "User TV"/);
  assert.match(app, /"เพิ่มสิทธิ์บน TV", "Create", "คนเพิ่ม", "แก้ไขโดย"/);
  assert.match(app, /scriptNames\.get\(a\.pine_id\)/);
  assert.match(app, /st\.label/);
  assert.match(app, /tvGrantedLabel\(a\)/);
  assert.match(app, /editedBy/);
});

test("grant and member edits verify TradingView immediately", () => {
  assert.match(tradingview, /async function verifyTvAccessRow/);
  assert.match(tradingview, /ให้สิทธิ์\/ต่ออายุสำเร็จแล้วเช็กกับ TradingView ทันที/);
  assert.match(tradingview, /const verification = await verifyTvAccessRow\(db, savedRow, cookie\)/);
  assert.match(tradingview, /เปลี่ยน USER TV สำเร็จแล้ว ตรวจชื่อใหม่ทันที/);
  assert.match(tradingview, /tv_access_verified: found/);
  assert.match(tradingview, /last_synced_at: nowIso/);
  assert.match(tradingview, /tv_granted_at/);
  assert.match(app, /เพิ่มสิทธิ์บน TV/);
});

test("revoking access rechecks TradingView before updating the badge", () => {
  const revokeStart = tradingview.indexOf('if (action === "revoke")');
  const revokeBlock = tradingview.slice(revokeStart);
  assert.match(revokeBlock, /status: "revoked"/);
  assert.match(revokeBlock, /verifyTvAccessRow\(db, row, cookie\)/);
  assert.match(revokeBlock, /verification\.found === true/);
  assert.match(revokeBlock, /verification\.found === false/);
  const expireBlock = tradingview.slice(tradingview.indexOf('if (action === "expire")'), tradingview.indexOf('if (action === "sync")'));
  assert.match(expireBlock, /status: "expired"/);
  assert.match(expireBlock, /tv_access_verified: false/);
});
