import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTopPage, appendUnique, mergeSearchResults } from "../lib/inbox/list.js";

const r = (id, day) => ({ id, last_message_at: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z` });

test("ลูกค้าใหม่ทักเข้ามา แชทเก่าที่โหลดไว้ต้องไม่หลุดจากลิสต์ (บั๊ก limit 200)", () => {
  const prev = [r("a", 20), r("b", 19), r("old1", 5), r("old2", 4)];
  const top = [r("new", 21), r("a", 20)];   // หน้าแรกเต็ม (pageSize 2) — b หลุดลงไปอยู่นอกหน้าแรก
  const out = mergeTopPage(prev, top, { pageSize: 2, sameKey: true });
  assert.deepEqual(out.map((x) => x.id), ["new", "a", "b", "old1", "old2"]);
});

test("เปลี่ยนตัวกรอง = ใช้หน้าแรกใหม่อย่างเดียว", () => {
  const out = mergeTopPage([r("x", 1)], [r("a", 2), r("b", 1)], { pageSize: 2, sameKey: false });
  assert.deepEqual(out.map((x) => x.id), ["a", "b"]);
});

test("หน้าแรกไม่เต็ม = ไม่มีแชทเก่ากว่านี้ที่ตรงตัวกรองแล้ว ทิ้งของเก่า", () => {
  const out = mergeTopPage([r("a", 2), r("gone", 1)], [r("a", 2)], { pageSize: 5, sameKey: true });
  assert.deepEqual(out.map((x) => x.id), ["a"]);
});

test("แถวที่อยู่ในช่วงหน้าแรกแต่ไม่อยู่ใน top แล้ว (เช่นถูกบล็อก) ต้องหายไป", () => {
  const prev = [r("a", 20), r("blocked", 19), r("b", 18)];
  const top = [r("a", 20), r("b", 18)];
  assert.deepEqual(mergeTopPage(prev, top, { pageSize: 2, sameKey: true }).map((x) => x.id), ["a", "b"]);
});

test("โหลดหน้าถัดไป/ผลค้นหา ไม่ซ้ำ id และผลค้นหาเรียงใหม่", () => {
  assert.deepEqual(appendUnique([r("a", 3)], [r("a", 3), r("b", 2)]).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(mergeSearchResults([r("a", 3), r("c", 1)], [r("b", 2)]).map((x) => x.id), ["a", "b", "c"]);
});
