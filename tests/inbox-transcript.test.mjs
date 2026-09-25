import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeTranscript } from "../lib/inbox/transcript.js";

test("ข้อความเดียวกันจาก webhook + sync (mid เดียวกัน) แสดงครั้งเดียว", () => {
  const out = dedupeTranscript([
    { w: "u", t: "สวัสดี", mid: "m1", at: "2026-09-01T00:00:00Z", img_source: "sync" },
    { w: "u", t: "สวัสดี", mid: "m1", at: "2026-09-01T00:00:00Z", img_source: "webhook" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].img_source, "webhook");
});

test("ข้อความเหมือนกันติดกันภายใน 90 วิ ยุบ · ห่างกันเกินนั้นแสดงทั้งคู่", () => {
  const a = { w: "p", t: "ok", at: "2026-09-01T00:00:00Z" };
  assert.equal(dedupeTranscript([a, { ...a, at: "2026-09-01T00:00:30Z" }]).length, 1);
  assert.equal(dedupeTranscript([a, { ...a, at: "2026-09-01T00:05:00Z" }]).length, 2);
});

test("ต่างฝั่งกันไม่ยุบ", () => {
  assert.equal(dedupeTranscript([{ w: "u", t: "ok" }, { w: "p", t: "ok" }]).length, 2);
});
