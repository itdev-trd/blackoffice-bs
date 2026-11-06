import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignRunning, keepsLongerAccess } from "../lib/tv/campaigns.js";

const at = (s) => Date.parse(`${s}T12:00:00+07:00`);

test("กิจกรรมเปิดเฉพาะในช่วงวันที่ (รวมวันจบ)", () => {
  const c = { active: true, pine_ids: ["p1"], start_date: "2026-11-06", end_date: "2026-11-10" };
  assert.equal(campaignRunning(c, at("2026-11-05")), false);
  assert.equal(campaignRunning(c, at("2026-11-06")), true);
  assert.equal(campaignRunning(c, at("2026-11-10")), true);
  assert.equal(campaignRunning(c, at("2026-11-11")), false);
  assert.equal(campaignRunning({ ...c, active: false }, at("2026-11-07")), false);
  assert.equal(campaignRunning({ active: true, pine_ids: [] }, at("2026-11-07")), false);
  assert.equal(campaignRunning({ active: true, pine_ids: ["p1"] }, at("2027-01-01")), true);
});

test("ไม่ตัดสิทธิ์ที่ยาวกว่าให้สั้นลง", () => {
  const now = at("2026-11-06");
  assert.equal(keepsLongerAccess(null, 7, now), false);
  assert.equal(keepsLongerAccess({ status: "active", expiration: null }, 7, now), true);            // ตลอดชีพ
  assert.equal(keepsLongerAccess({ status: "active", expiration: "2026-12-30T00:00:00Z" }, 7, now), true);
  assert.equal(keepsLongerAccess({ status: "active", expiration: "2026-11-08T00:00:00Z" }, 7, now), false);
  assert.equal(keepsLongerAccess({ status: "revoked", expiration: null }, 7, now), false);
});
