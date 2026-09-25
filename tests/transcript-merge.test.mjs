import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTranscript, needsHistory } from "../supabase/functions/_shared/transcript-merge.ts";

const m = (mid, at, extra = {}) => ({ w: "u", t: mid, at, mid, ...extra });

test("ข้อความเดิมที่ Meta ไม่ได้คืนมารอบนี้ต้องอยู่ต่อ (บั๊กประวัติหายตอน sync ดึงแค่ 10 ข้อความ)", () => {
  const prev = [m("a", "2026-09-01T00:00:00Z"), m("b", "2026-09-02T00:00:00Z")];
  const fresh = [m("c", "2026-09-03T00:00:00Z")];
  assert.deepEqual(mergeTranscript(prev, fresh).map((x) => x.mid), ["a", "b", "c"]);
});

test("ข้อความที่ซ้ำ mid ไม่เบิ้ล และเรียงตามเวลา", () => {
  const prev = [m("b", "2026-09-02T00:00:00Z"), m("a", "2026-09-01T00:00:00Z")];
  const fresh = [m("a", "2026-09-01T00:00:00Z"), m("b", "2026-09-02T00:00:00Z")];
  assert.deepEqual(mergeTranscript(prev, fresh).map((x) => x.mid), ["a", "b"]);
});

test("คงต้นฉบับไทยของแอดมิน (th) และรูปจาก webhook ที่ Meta สร้างคืนให้ไม่ได้", () => {
  const prev = [m("a", "2026-09-01T00:00:00Z", { w: "p", th: "สวัสดีค่ะ", by: "nat", img: "https://hook/x.png", img_source: "webhook" })];
  const fresh = [m("a", "2026-09-01T00:00:00Z", { w: "p", img: "https://sync/x.jpg", img_source: "sync" })];
  const [out] = mergeTranscript(prev, fresh);
  assert.equal(out.th, "สวัสดีค่ะ");
  assert.equal(out.by, "nat");
  assert.equal(out.img, "https://hook/x.png");
});

test("เกินเพดานแล้วเก็บเฉพาะข้อความล่าสุด", () => {
  const prev = Array.from({ length: 5 }, (_, i) => m(`p${i}`, `2026-09-0${i + 1}T00:00:00Z`));
  const out = mergeTranscript(prev, [], 3);
  assert.deepEqual(out.map((x) => x.mid), ["p2", "p3", "p4"]);
});

test("needsHistory: ข้ามห้องที่ดึงครบแล้ว จนกว่าจะมีข้อความใหม่", () => {
  const row = { transcript: [1, 2], message_count: 5, history_synced_count: null };
  assert.equal(needsHistory(row), true);
  assert.equal(needsHistory({ ...row, history_synced_count: 5 }), false);
  assert.equal(needsHistory({ ...row, history_synced_count: 5, message_count: 6 }), true);
  assert.equal(needsHistory({ transcript: [1, 2, 3], message_count: 3 }), false);
});
