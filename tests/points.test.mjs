import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RULES, normalizeOfficeHours, normalizeRules, validateRules, scoreReply, slotOf, periodOf,
  periodRange, thaiDayRange, tvEventKind, isExcludedCustomer, capFor, overCap, ledgerFingerprint,
} from "../supabase/functions/_shared/points-rules.ts";

const OH = normalizeOfficeHours({ holidays: ["2026-10-13"] });   // อังคาร 13 ต.ค. 69 เป็นวันหยุดพิเศษ
const R = DEFAULT_RULES;
// เวลาไทย → ms
const th = (s) => Date.parse(`${s}+07:00`);
const MIN = 60000;

test("ตารางนอกเวลา วันทำงาน (จันทร์ 12 ต.ค.) ทันเวลา/ช้า ตรงกับตารางเดิม", () => {
  const cells = [["12:30", 1, 0.5], ["18:00", 2, 1], ["21:00", 4, 2], ["02:00", 8, 6], ["06:00", 4, 2]];
  for (const [t, fast, slow] of cells) {
    const at = th(`2026-10-12T${t}:00`);
    assert.equal(scoreReply(at, at + 2 * MIN, OH, R).points, fast, `ทัน ${t}`);
    assert.equal(scoreReply(at, at + 6 * MIN, OH, R).points, slow, `ช้า ${t}`);
  }
});

test("ตารางวันหยุด (เสาร์ 10 ต.ค. และวันหยุดพิเศษ 13 ต.ค.)", () => {
  const cells = [["10:00", 2, 1], ["18:00", 4, 2], ["21:00", 8, 4], ["02:00", 16, 12], ["06:00", 8, 4]];
  for (const day of ["2026-10-10", "2026-10-13"]) {
    for (const [t, fast, slow] of cells) {
      const at = th(`${day}T${t}:00`);
      assert.equal(scoreReply(at, at + 1 * MIN, OH, R).points, fast, `${day} ทัน ${t}`);
      assert.equal(scoreReply(at, at + 30 * MIN, OH, R).points, slow, `${day} ช้า ${t}`);
    }
  }
});

test("ในเวลาทำการ ได้แต้มในเวลา (ค่าเริ่มต้น 0.5 / 0.25)", () => {
  const at = th("2026-10-12T10:00:00");
  const fast = scoreReply(at, at + 3 * MIN, OH, R);
  assert.equal(fast.points, 0.5);
  assert.equal(fast.kind, "reply_office");
  assert.equal(scoreReply(at, at + 20 * MIN, OH, R).points, 0.25);
});

test("ทันเวลา = ไม่เกิน slow_min นาทีพอดี", () => {
  const at = th("2026-10-12T21:00:00");
  assert.equal(scoreReply(at, at + 5 * MIN, OH, R).in_time, true);
  assert.equal(scoreReply(at, at + 5 * MIN + 1000, OH, R).in_time, false);
});

test("ทัก 08:59 ตอบ 09:30 = แต้มในเวลา (นับตามเวลาที่ตอบ)", () => {
  const s = scoreReply(th("2026-10-12T08:59:00"), th("2026-10-12T09:30:00"), OH, R);
  assert.equal(s.kind, "reply_office");
  assert.equal(s.points, 0.25);
  assert.equal(s.used, "reply");
});

test("ทัก 16:50 รอตอบ 17:01 ไม่ได้แต้มนอกเวลา (ใช้ช่วงที่แต้มต่ำกว่า)", () => {
  const s = scoreReply(th("2026-10-12T16:50:00"), th("2026-10-12T17:01:00"), OH, R);
  assert.equal(s.kind, "reply_office");
  assert.equal(s.points, 0.25);
  assert.equal(s.used, "msg");
});

test("ทักดึกวันศุกร์ ตอบเช้าวันเสาร์ — ได้ช่วงที่ต่ำกว่า", () => {
  // ทัก 23:50 ศุกร์ (วันทำงาน 20–24 ช้า=2) ตอบ 00:20 เสาร์ (วันหยุด 0–5 ช้า=12) → 2
  const s = scoreReply(th("2026-10-09T23:50:00"), th("2026-10-10T00:20:00"), OH, R);
  assert.equal(s.points, 2);
  assert.equal(s.kind, "reply_offhours");
});

test("เดือนตัดตามเวลาไทย ไม่ใช่ UTC", () => {
  assert.equal(periodOf(th("2026-10-31T23:59:59")), "2026-10");
  assert.equal(periodOf(th("2026-11-01T00:00:00")), "2026-11");
  const r = periodRange("2026-10");
  assert.equal(r.startMs, th("2026-10-01T00:00:00"));
  assert.equal(r.endMs, th("2026-11-01T00:00:00"));
  const d = thaiDayRange(th("2026-10-12T00:30:00"));
  assert.equal(d.startMs, th("2026-10-12T00:00:00"));
});

test("TradingView: ให้ใหม่ / ต่ออายุจริง / ไม่เลื่อนวัน = ไม่มีแต้ม", () => {
  assert.equal(tvEventKind(null, "2026-11-12T00:00:00Z"), "tv_grant");
  assert.equal(tvEventKind({ expiration: "2026-11-01T00:00:00Z" }, "2026-12-01T00:00:00Z"), "tv_renew");
  assert.equal(tvEventKind({ expiration: "2026-11-01T00:00:00Z" }, "2026-11-01T00:00:00Z"), null);
  assert.equal(tvEventKind({ expiration: "2026-11-01T00:00:00Z" }, "2026-10-20T00:00:00Z"), null);
  assert.equal(tvEventKind({ expiration: "2026-11-01T00:00:00Z" }, null), "tv_renew");   // อัปเป็นตลอดชีพ
  assert.equal(tvEventKind({ expiration: null }, null), null);                             // ตลอดชีพอยู่แล้ว
  assert.equal(tvEventKind({ expiration: null }, "2026-12-01T00:00:00Z"), null);
});

test("บัญชีเทสถูกตัด", () => {
  const oh = normalizeOfficeHours({ exclude: ["Test Bot", "conv_9"] });
  assert.equal(isExcludedCustomer(oh, "นาย test bot 2", "x"), true);
  assert.equal(isExcludedCustomer(oh, "ลูกค้าจริง", "conv_9"), true);
  assert.equal(isExcludedCustomer(oh, "ลูกค้าจริง", "conv_1"), false);
});

test("เพดาน: ค่าเริ่มต้นไม่จำกัด (0) · ตั้งค่าแล้วแยกตามประเภท", () => {
  assert.equal(capFor("reply_office", R), 0);
  assert.equal(overCap(999, 0), false);
  const capped = normalizeRules({ caps: { office_per_conv_day: 3, off_per_conv_day: 5 } });
  assert.equal(capFor("reply_office", capped), 3);
  assert.equal(capFor("reply_offhours", capped), 5);
  assert.equal(overCap(2, 3), false);
  assert.equal(overCap(3, 3), true);
});

test("validateRules ปฏิเสธกติกาที่ผิดรูปแบบ", () => {
  assert.equal(validateRules(DEFAULT_RULES).ok, true);
  assert.equal(validateRules({ ...DEFAULT_RULES, office: [0.5] }).ok, false);
  assert.equal(validateRules({ ...DEFAULT_RULES, off_table: { workday: [[20, 17, 1, 1]], holiday: [] } }).ok, false);
  assert.equal(validateRules({ ...DEFAULT_RULES, tv: { grant: -1, renew: 2, revoke_void_days: 7 } }).ok, false);
  assert.deepEqual(normalizeRules({ office: [1, 0.5] }).office, [1, 0.5]);
  assert.deepEqual(normalizeRules({}).tv, DEFAULT_RULES.tv);
});

test("ช่องที่ไม่มีในตารางได้ 0", () => {
  const rules = normalizeRules({ off_table: { workday: [], holiday: [] } });
  const s = slotOf(th("2026-10-12T21:00:00"), OH, rules);
  assert.equal(s.fast, 0);
});

test("fingerprint เรียงตาม id และเปลี่ยนเมื่อแต้มเปลี่ยน", () => {
  const a = ledgerFingerprint([{ id: 2, points: 1, staff_email: "b" }, { id: 1, points: "0.5", staff_email: "a" }]);
  assert.equal(a, "1:a:0.50\n2:b:1.00");
  assert.notEqual(a, ledgerFingerprint([{ id: 1, points: 0.5, staff_email: "a" }, { id: 2, points: 2, staff_email: "b" }]));
});
