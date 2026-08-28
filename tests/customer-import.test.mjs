import test from "node:test";
import assert from "node:assert/strict";
import { detectCustomerImportColumns, normalizeCustomerName } from "../customer-import.js";

test("customer Excel import normalizes names without destroying word boundaries", () => {
  assert.equal(normalizeCustomerName("  Aphiwat   Ch  "), "aphiwat ch");
  assert.equal(normalizeCustomerName("สมชาย   ใจดี"), "สมชาย ใจดี");
});

test("customer Excel import recognizes common Thai and English headers", () => {
  assert.deepEqual(
    detectCustomerImportColumns(["ชื่อลูกค้า", "ไอดีเทรด", "เบอร์โทรศัพท์", "E-mail", "Username (TradingView)", "สถานะ"]),
    { customer_name: 0, trade_id: 1, phone: 2, email: 3, username: 4, stage: 5 },
  );
});
