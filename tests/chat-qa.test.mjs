import { test } from "node:test";
import assert from "node:assert/strict";
import { extractQaPairs, maskPii, textSimilarity, rankPatterns, groundDraft, draftConfidence } from "../supabase/functions/_shared/chat-qa.ts";

const at = (m) => `2026-10-20T10:${String(m).padStart(2, "0")}:00Z`;

test("รวมข้อความลูกค้าติดกันเป็นคำถาม แล้วจับคู่กับคำตอบแอดมินถัดไป", () => {
  const pairs = extractQaPairs([
    { w: "u", t: "สวัสดีครับ", at: at(0) },
    { w: "u", t: "อินดี้ใช้ยังไง", at: at(1) },
    { w: "p", t: "สวัสดีค่ะ", at: at(3), by: "a@x.com" },
    { w: "p", t: "ดูคลิปนี้ได้เลยค่ะ", at: at(4), by: "a@x.com" },
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].q_text, "สวัสดีครับ\nอินดี้ใช้ยังไง");
  assert.equal(pairs[0].a_text, "สวัสดีค่ะ\nดูคลิปนี้ได้เลยค่ะ");
  assert.equal(pairs[0].response_sec, 120);
  assert.equal(pairs[0].answered_by, "a@x.com");
});

test("ข้ามตอบอัตโนมัติ / ข้อความจากแอปอื่น / คำถามที่มีแต่รูป", () => {
  const pairs = extractQaPairs([
    { w: "u", t: "สนใจ", at: at(0) },
    { w: "p", t: "ขอบคุณที่ทักมา", at: at(0), auto_reply: "line_oa", by: "ตอบอัตโนมัติ (LINE OA)" },
    { w: "u", t: "", img: "x.jpg", at: at(1) },
    { w: "p", t: "ได้รับรูปแล้วค่ะ", at: at(2), by: "a@x.com" },
    { w: "u", t: "ราคาเท่าไหร่", at: at(3) },
    { w: "p", t: "bot", at: at(3), app: "263902037430900" },
  ]);
  assert.equal(pairs.length, 0);
});

test("เก็บคำแปลไทย + บริบทก่อนหน้า + ปิดบังข้อมูลส่วนตัว", () => {
  const pairs = extractQaPairs([
    { w: "p", t: "ขอไอดีเทรดค่ะ", at: at(0), by: "a@x.com" },
    { w: "u", t: "my id 12345678 mail me@test.com", th: "ไอดีผม 12345678", at: at(1) },
    { w: "p", t: "เพิ่มสิทธิ์ให้แล้วค่ะ", at: at(2) },
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].q_text, "my id [ตัวเลข] mail [อีเมล]");
  assert.equal(pairs[0].q_th, "ไอดีผม [ตัวเลข]");
  assert.equal(pairs[0].context, "ขอไอดีเทรดค่ะ");
});

test("maskPii เบอร์โทรไทย", () => {
  assert.equal(maskPii("โทร 081-234-5678 นะ"), "โทร [เบอร์โทร] นะ");
});

test("normKey: ข้อความเดิมต่างชื่อลูกค้า/เว้นวรรค/อีโมจิ = กุญแจเดียวกัน", async () => {
  const { normKey } = await import("../supabase/functions/_shared/chat-qa.ts");
  assert.equal(normKey("สวัสดีค่ะ คุณสมชาย 😊 สนใจอินดี้ไหมคะ"), normKey("สวัสดีค่ะคุณมาลี สนใจอินดี้ไหมคะ!!"));
  assert.notEqual(normKey("ราคาเท่าไหร่"), normKey("ใช้ยังไง"));
});

test("ตัดข้อความระบบ (ตั้งระยะ/Facebook สร้างแชท) ออกก่อนจับคู่", () => {
  const pairs = extractQaPairs([
    { w: "u", t: "สนใจครับ", at: at(0) },
    { w: "p", t: 'ตั้งระยะข้อมูลลูกค้าเป็น "มีคุณสมบัติ" แล้ว', at: at(1) },
    { w: "p", t: "มีบัญชี XM หรือยังคะ", at: at(2), by: "a@x.com" },
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a_text, "มีบัญชี XM หรือยังคะ");
});

test("ค้นแพทเทิร์น: คำถามคล้ายกันได้คำตอบที่เคยใช้ · ไม่เกี่ยวเลย = ไม่ส่ง", () => {
  const patterns = [
    { a_text: "เปิดบัญชี XM ตามลิงก์นี้ค่ะ", uses: 200, q_samples: ["อยากเปิดบัญชี xm ทำยังไงครับ", "สมัคร xm ยังไง"] },
    { a_text: "ส่งยูส TradingView มาได้เลยค่ะ", uses: 150, q_samples: ["ขออินดิเคเตอร์หน่อยครับ", "เพิ่มอินดี้ให้หน่อย"] },
  ];
  assert.ok(textSimilarity("เปิดบัญชี xm ยังไง", "อยากเปิดบัญชี xm ทำยังไงครับ") > 0.5);
  assert.equal(rankPatterns("อยากเปิดบัญชี XM ค่ะ", patterns)[0].a_text, "เปิดบัญชี XM ตามลิงก์นี้ค่ะ");
  assert.equal(rankPatterns("ขออินดิเคเตอร์ครับ", patterns)[0].a_text, "ส่งยูส TradingView มาได้เลยค่ะ");
  assert.deepEqual(rankPatterns("กินข้าวหรือยัง", patterns), []);
  assert.deepEqual(rankPatterns("", patterns), []);
});

test("ร่าง AI: ตัดลิงก์ที่แต่งขึ้น · เก็บลิงก์ที่มีจริง (แม้ query ต่างกัน) · ข้อมูลที่ปิดไว้กลายเป็นช่องว่างให้เติม", () => {
  const g = groundDraft("ดูคลิป https://youtu.be/abc?si=x และสมัครที่ https://fake.example/xm ค่ะ เลขบัญชี [ตัวเลข]", "[แอดมิน] https://youtu.be/abc");
  assert.equal(g.reply, "ดูคลิป https://youtu.be/abc?si=x และสมัครที่  ค่ะ เลขบัญชี ___");
  assert.deepEqual(g.removedLinks, ["https://fake.example/xm"]);
  assert.equal(g.blanks, 1);
});

test("ความมั่นใจ: AI ให้ตัวเอง 100% ก็ไม่เกินเพดานตามหลักฐาน", () => {
  assert.equal(draftConfidence(1, 0.7), 0.95);
  assert.equal(draftConfidence(1, 0.2), 0.45);
  assert.equal(draftConfidence(1, 0.7, { adminSpokeLast: true }), 0.6);
  assert.equal(draftConfidence(1, 0.7, { removedLinks: 1 }), 0.35);
  assert.equal(draftConfidence(0.3, 0.7), 0.3);
});
