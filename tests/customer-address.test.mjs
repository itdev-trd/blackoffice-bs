import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAddress, formatAddress, shortArea, hasAddress, cleanAddress } from "../lib/customer-address.js";

test("แยกที่อยู่แบบหลายบรรทัด (ชื่อ / ที่อยู่ / เบอร์)", () => {
  const a = parseAddress("สมชาย ใจดี\n99/1 หมู่ 5 ถ.สุเทพ ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200\nโทร 081-234-5678");
  assert.equal(a.name, "สมชาย ใจดี");
  assert.equal(a.phone, "0812345678");
  assert.equal(a.subdistrict, "สุเทพ");
  assert.equal(a.district, "เมือง");
  assert.equal(a.province, "เชียงใหม่");
  assert.equal(a.postcode, "50200");
  assert.equal(a.line1, "99/1 หมู่ 5 ถ.สุเทพ");
});

test("กรุงเทพใช้ แขวง/เขต และจัดรูปแบบตามนั้น", () => {
  const a = parseAddress("ชื่อ: มานี มีนา 12 ซ.ลาดพร้าว 101 แขวงคลองจั่น เขตบางกะปิ กทม. 10240 0899999999");
  assert.equal(a.name, "มานี มีนา");
  assert.equal(a.province, "กรุงเทพมหานคร");
  assert.equal(a.district, "บางกะปิ");
  assert.equal(a.subdistrict, "คลองจั่น");
  assert.equal(a.postcode, "10240");
  assert.equal(a.phone, "0899999999");
  assert.equal(formatAddress(a), "มานี มีนา โทร 0899999999\n12 ซ.ลาดพร้าว 101\nแขวงคลองจั่น เขตบางกะปิ กรุงเทพมหานคร 10240");
  assert.equal(shortArea(a), "กรุงเทพฯ 10240");
});

test("ที่อยู่ต่างประเทศที่แยกไม่ได้ ไปกองที่ line1 ไม่หาย", () => {
  const a = parseAddress("Blk 5 Lot 3, Brgy San Isidro, Cebu City 6000");
  assert.equal(a.postcode, "");   // ฟิลิปปินส์ 4 หลัก ไม่เดา
  assert.match(a.line1, /Cebu City 6000/);
  assert.ok(hasAddress(a));
});

test("cleanAddress ตัดช่องว่างทิ้งและไม่เก็บช่องเปล่า", () => {
  assert.deepEqual(cleanAddress({ name: "  ", line1: " 1 ถ.ก ", postcode: "10110" }), { line1: "1 ถ.ก", postcode: "10110" });
  assert.equal(hasAddress({ name: "x" }), false);
});
