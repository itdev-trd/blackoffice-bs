import { test } from "node:test";
import assert from "node:assert/strict";
import { expiryStatus, worsened, overall } from "../supabase/functions/_shared/health-rules.ts";

const NOW = Date.parse("2026-09-25T00:00:00Z");
const inDays = (d) => Math.floor((NOW + d * 86400000) / 1000);

test("token ตอบแชทหมด 4 พ.ย. = อีก 40 วัน ยังปกติ · เหลือ < 21 วันเตือน · < 7 วัน/หมดแล้วเป็นปัญหา", () => {
  assert.deepEqual(expiryStatus(Date.parse("2026-11-04T00:00:00Z") / 1000, NOW), { status: "ok", days_left: 40 });
  assert.equal(expiryStatus(inDays(20), NOW).status, "warn");
  assert.equal(expiryStatus(inDays(6), NOW).status, "error");
  assert.equal(expiryStatus(inDays(-1), NOW).status, "error");
  assert.deepEqual(expiryStatus(0, NOW), { status: "ok", days_left: null });   // System User token ไม่หมดอายุ
});

test("แจ้งเตือนเฉพาะรายการที่เพิ่งแย่ลง ไม่แจ้งซ้ำตัวเดิม", () => {
  const prev = [{ key: "a", status: "warn" }, { key: "b", status: "ok" }, { key: "c", status: "error" }];
  const next = [{ key: "a", status: "warn" }, { key: "b", status: "error" }, { key: "c", status: "error" }, { key: "d", status: "warn" }];
  assert.deepEqual(worsened(prev, next).map((c) => c.key), ["b", "d"]);
  assert.deepEqual(worsened(null, [{ key: "x", status: "ok" }]), []);
});

test("สถานะรวม = ตัวที่แย่ที่สุด", () => {
  assert.equal(overall([{ status: "ok" }, { status: "warn" }]), "warn");
  assert.equal(overall([{ status: "warn" }, { status: "error" }]), "error");
  assert.equal(overall([]), "ok");
});
