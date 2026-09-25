import { test } from "node:test";
import assert from "node:assert/strict";
import { tvErrorText } from "../supabase/functions/_shared/tradingview-direct.ts";

test("username ไม่มีจริง → บอกให้เช็กตัวสะกด ไม่ใช่ 'ตอบ 422' เฉย ๆ", () => {
  const body = JSON.stringify({ code: "username_recip_not_found", detail: "User not found: jamestradeaccount" });
  assert.match(tvErrorText(422, body), /ไม่พบ username นี้ใน TradingView/);
});

test("error อื่นแสดง detail ของ TradingView ต่อท้าย", () => {
  assert.equal(tvErrorText(400, JSON.stringify({ detail: "bad request" })), "TradingView ตอบ 400: bad request");
});

test("คำตอบที่ไม่ใช่ JSON ยังได้ข้อความ", () => {
  assert.equal(tvErrorText(502, "<html>"), "TradingView ตอบ 502");
});
