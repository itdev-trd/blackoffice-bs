import { test } from "node:test";
import assert from "node:assert/strict";
import { purgeAtFromDate } from "../supabase/functions/_shared/retention-date.ts";

// 25 ก.ย. 2569 เวลา 10:00 น. ไทย
const NOW = Date.parse("2026-09-25T10:00:00+07:00");

test("วันที่เลือก = เที่ยงคืนต้นวันนั้นตามเวลาไทย", () => {
  assert.equal(purgeAtFromDate("2026-10-01", NOW), "2026-09-30T17:00:00.000Z");
});

test("เลือกวันนี้ได้ (ลบรอบถัดไปของ cron)", () => {
  assert.equal(purgeAtFromDate("2026-09-25", NOW), "2026-09-24T17:00:00.000Z");
});

test("วันในอดีต / เกิน 1 ปี / รูปแบบผิด / วันที่ไม่มีจริง → null", () => {
  assert.equal(purgeAtFromDate("2026-09-24", NOW), null);
  assert.equal(purgeAtFromDate("2027-12-01", NOW), null);
  assert.equal(purgeAtFromDate("25/10/2569", NOW), null);
  assert.equal(purgeAtFromDate("2026-02-31", Date.parse("2026-01-01T00:00:00Z")), null);
  assert.equal(purgeAtFromDate(null, NOW), null);
});
