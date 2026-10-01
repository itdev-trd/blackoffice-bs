import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBackfill, backfillExpiration } from "../supabase/functions/_shared/tv-backfill.ts";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const STR = "PUB;str", ORCA = "PUB;orca", NEW = "PUB;new";
const row = (username, pine_id, expiration, extra = {}) => ({ username, pine_id, expiration, updated_at: "2026-09-01T00:00:00Z", ...extra });

const src = [
  row("Alice", STR, "2026-11-01T00:00:00Z"), row("alice", ORCA, "2026-12-01T00:00:00Z"),   // ทั้งสองตัว ตัวพิมพ์ต่างกัน
  row("bob", STR, null),                                                                    // ตลอดชีพ ตัวเดียว
  row("carol", ORCA, "2026-09-01T00:00:00Z"),                                               // หมดอายุแล้ว
  row("dave", STR, "2026-10-20T00:00:00Z"), row("dave", ORCA, null),                        // มีตลอดชีพสักตัว
  row("erin", STR, "2026-10-15T00:00:00Z"),                                                 // มีตัวใหม่อยู่แล้ว
];
const tgt = [{ username: "Erin", status: "active", expiration: null }];

test("โหมด 'อย่างน้อย 1 ตัว': ข้ามคนหมดอายุและคนที่มีตัวใหม่อยู่แล้ว", () => {
  const { summary, pending } = buildBackfill(src, tgt, [STR, ORCA], "any", NOW);
  assert.deepEqual(pending.map((c) => c.key), ["alice", "bob", "dave"]);
  assert.deepEqual(summary, { candidates: 4, already: 1, pending: 3, lifetime: 2 });
});

test("โหมด 'ต้องมีครบทุกตัว'", () => {
  const { pending } = buildBackfill(src, tgt, [STR, ORCA], "all", NOW);
  assert.deepEqual(pending.map((c) => c.key), ["alice", "dave"]);
});

test("วันหมดอายุ = วันที่ไกลที่สุด · มีตลอดชีพสักตัว = ตลอดชีพ", () => {
  const { pending } = buildBackfill(src, tgt, [STR, ORCA], "any", NOW);
  const by = Object.fromEntries(pending.map((c) => [c.key, backfillExpiration(c)]));
  assert.equal(by.alice, "2026-12-01T00:00:00.000Z");
  assert.equal(by.bob, null);
  assert.equal(by.dave, null);
});

test("สิทธิ์ตัวใหม่ที่หมดอายุแล้ว = ยังต้องให้ใหม่", () => {
  const { pending } = buildBackfill([row("erin", STR, null)], [{ username: "erin", status: "active", expiration: "2026-09-01T00:00:00Z" }], [STR], "any", NOW);
  assert.equal(pending.length, 1);
});

test("ข้อมูลลูกค้าใช้จากแถวที่แก้ล่าสุด", () => {
  const rows = [row("x", STR, null, { trade_id: "old", updated_at: "2026-08-01T00:00:00Z" }), row("x", ORCA, null, { trade_id: "new", updated_at: "2026-09-20T00:00:00Z" })];
  assert.equal(buildBackfill(rows, [], [STR, ORCA], "any", NOW).pending[0].profile.trade_id, "new");
});
