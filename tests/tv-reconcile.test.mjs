import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileTvAccess } from "../supabase/functions/_shared/tv-reconcile.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const tv = (list) => new Map(list.map((u) => [u.username.toLowerCase(), u]));

test("แอปค้างวันเก่า แต่ TradingView ต่ออายุแล้ว → ใช้วันของ TV และเก็บวันเดิมไว้ (เคส patie52546)", () => {
  const [p] = reconcileTvAccess(
    [{ id: 1, username: "patie52546", status: "active", expiration: "2026-09-05T23:59:59.999Z", tv_access_verified: true }],
    tv([{ username: "patie52546", expiration: "2026-10-07T07:03:22.072Z" }]), NOW);
  assert.equal(p.patch.expiration, "2026-10-07T07:03:22.072Z");
  assert.equal(p.patch.status, "active");
  assert.equal(p.patch.previous_expiration, "2026-09-05T23:59:59.999Z");
});

test("แอปขึ้นมีสิทธิ์ แต่ TradingView ไม่มีแล้ว → expired", () => {
  const [p] = reconcileTvAccess([{ id: 2, username: "gone", status: "active", expiration: "2026-09-01T00:00:00Z" }], tv([]), NOW);
  assert.equal(p.patch.status, "expired");
  assert.equal(p.patch.tv_access_verified, false);
});

test("วันของ TV ผ่านไปแล้ว → expired · ตลอดชีพบน TV → expiration null", () => {
  const out = reconcileTvAccess(
    [{ id: 3, username: "a", status: "active", expiration: null }, { id: 4, username: "b", status: "expired", expiration: "2026-01-01T00:00:00Z" }],
    tv([{ username: "A", expiration: "2026-09-30T00:00:00Z" }, { username: "b", expiration: null }]), NOW);
  assert.equal(out.find((x) => x.id === 3).patch.status, "expired");
  const b = out.find((x) => x.id === 4).patch;
  assert.equal(b.expiration, null);
  assert.equal(b.status, "active");
});

test("ตรงกันอยู่แล้ว = ไม่เขียนซ้ำ · ถอนสิทธิ์แล้ว (revoked) และ TV ไม่มี = ไม่แตะ · TV ไม่ส่งวันหมดอายุ = ไม่เดา", () => {
  const out = reconcileTvAccess([
    { id: 5, username: "ok", status: "active", expiration: "2026-11-01T00:00:00.000Z", tv_expiration: "2026-11-01T00:00:00Z", tv_access_verified: true },
    { id: 6, username: "rv", status: "revoked", expiration: null },
    { id: 7, username: "unk", status: "active", expiration: "2026-09-01T00:00:00Z" },
  ], tv([{ username: "ok", expiration: "2026-11-01T00:00:00Z" }, { username: "unk" }]), NOW);
  assert.deepEqual(out, []);
});

import { missingFromApp } from "../supabase/functions/_shared/tv-reconcile.ts";

test("นำเข้าคนที่มีบน TradingView แต่แอปไม่มีแถว — เฉพาะที่ยังไม่หมดอายุ", () => {
  const out = missingFromApp(
    [{ username: "Have" }],
    tv([
      { username: "have", expiration: null },                     // มีในแอปแล้ว (ตัวพิมพ์ต่างกัน)
      { username: "NewLife", expiration: null },                  // ตลอดชีพ
      { username: "newTimed", expiration: "2026-10-07T00:00:00Z" },
      { username: "old", expiration: "2026-09-01T00:00:00Z" },    // หมดแล้ว
      { username: "unknown" },                                    // ไม่รู้วันหมดอายุ
    ]), NOW);
  assert.deepEqual(out.map((u) => u.username), ["NewLife", "newTimed"]);
});

test("รันซ้ำ = ไม่แก้อะไร (แถวหมดอายุที่ปรับแล้วต้องไม่ถูกเขียนซ้ำทุกคืน)", () => {
  const users = tv([{ username: "x", expiration: "2026-09-01T00:00:00Z" }]);
  const [first] = reconcileTvAccess([{ id: 9, username: "x", status: "active", expiration: "2026-09-01T00:00:00Z" }], users, NOW);
  const after = { id: 9, username: "x", ...first.patch };
  assert.deepEqual(reconcileTvAccess([after], users, NOW), []);
});
