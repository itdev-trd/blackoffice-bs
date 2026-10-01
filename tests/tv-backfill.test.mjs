import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBackfill, backfillExpiration, choiceFor } from "../supabase/functions/_shared/tv-backfill.ts";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const MONTH = "2026-10-31T00:00:00.000Z";
const STR = "PUB;str", ORCA = "PUB;orca";
const row = (username, pine_id, expiration, extra = {}) => ({ username, pine_id, expiration, updated_at: "2026-09-01T00:00:00Z", ...extra });

const src = [
  row("Alice", STR, "2026-11-01T00:00:00Z"), row("alice", ORCA, "2026-12-01T00:00:00Z"),   // ไม่มีตลอดชีพ (ตัวพิมพ์ต่างกัน)
  row("bob", STR, null),                                                                    // ตลอดชีพตัวเดียว ไม่มี Orca
  row("carol", ORCA, "2026-09-01T00:00:00Z"),                                               // หมดอายุแล้ว
  row("dave", STR, "2026-10-20T00:00:00Z"), row("dave", ORCA, null),                        // ตลอดชีพแค่ Orca
  row("erin", STR, "2026-10-15T00:00:00Z"),                                                 // มีตัวใหม่อยู่แล้ว
  row("frank", STR, null), row("frank", ORCA, null),                                        // ตลอดชีพทั้งสองตัว
];
const tgt = [{ username: "Erin", status: "active", expiration: null }];
const build = (mode = "any") => buildBackfill(src, tgt, [STR, ORCA], mode, NOW);
const byKey = (list) => Object.fromEntries(list.map((c) => [c.key, c]));

test("แบ่งกลุ่ม: ตลอดชีพครบ / ตลอดชีพบางตัว (ต้องตัดสินใจ) / ไม่มีตลอดชีพ · ข้ามหมดอายุและคนที่มีอยู่แล้ว", () => {
  const { summary, pending } = build();
  assert.deepEqual(pending.map((c) => [c.key, c.tier]), [["alice", "timed"], ["bob", "decide"], ["dave", "decide"], ["frank", "lifetime"]]);
  assert.deepEqual(summary, { candidates: 5, already: 1, pending: 4, lifetime: 1, decide: 2, timed: 1 });
});

test("ตลอดชีพครบทั้ง One STR และ Orca = PO3 ตลอดชีพเสมอ ไม่สนตัวเลือก", () => {
  const c = byKey(build().pending).frank;
  assert.equal(backfillExpiration(c, "month", NOW), null);
});

test("ตลอดชีพแค่ตัวเดียว = ตามที่แอดมินเลือก (1 เดือน หรือ ตลอดชีพ)", () => {
  const { bob, dave } = byKey(build().pending);
  assert.equal(backfillExpiration(bob, "month", NOW), MONTH);
  assert.equal(backfillExpiration(dave, "lifetime", NOW), null);
});

test("ไม่มีตลอดชีพ = วันหมดอายุที่ไกลที่สุดของตัวเดิม", () => {
  assert.equal(backfillExpiration(byKey(build().pending).alice, "lifetime", NOW), "2026-12-01T00:00:00.000Z");
});

test("เลือกรายคนชนะค่าตั้งต้นของกลุ่ม", () => {
  const { bob, dave } = byKey(build().pending);
  const overrides = { dave: "lifetime" };
  assert.equal(choiceFor(bob, "month", overrides), "month");
  assert.equal(choiceFor(dave, "month", overrides), "lifetime");
  assert.equal(choiceFor(bob, "month", { bob: "junk" }), "month");
});

test("โหมด 'ต้องมีครบทุกตัว'", () => {
  assert.deepEqual(build("all").pending.map((c) => c.key), ["alice", "dave", "frank"]);
});

test("สิทธิ์ตัวใหม่ที่หมดอายุแล้ว = ยังต้องให้ใหม่", () => {
  const { pending } = buildBackfill([row("erin", STR, null)], [{ username: "erin", status: "active", expiration: "2026-09-01T00:00:00Z" }], [STR], "any", NOW);
  assert.equal(pending.length, 1);
});

test("ข้อมูลลูกค้าใช้จากแถวที่แก้ล่าสุด", () => {
  const rows = [row("x", STR, null, { trade_id: "old", updated_at: "2026-08-01T00:00:00Z" }), row("x", ORCA, null, { trade_id: "new", updated_at: "2026-09-20T00:00:00Z" })];
  assert.equal(buildBackfill(rows, [], [STR, ORCA], "any", NOW).pending[0].profile.trade_id, "new");
});
