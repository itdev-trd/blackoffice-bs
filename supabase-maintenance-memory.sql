-- ================================================================
-- ลดภาระ memory/CPU ของ Postgres — รันใน Supabase SQL Editor (รันทีละบล็อก)
-- อ้างอิงจากผล pg_stat_statements จริง: ตัวกินหลักคือ (1) Realtime ถอดรหัส WAL 2.46 ล้านครั้ง
--   จากการที่ chat_customers ถูก "อัปเดตซ้ำ" บ่อยมาก และ (2) list query ช้าเพราะตารางบวม (bloat)
-- ================================================================

-- ----------------------------------------------------------------
-- (1) คลาย bloat ของ chat_customers (อัปเดตวันละหลายหมื่นแถว → dead rows เยอะ → scan ช้า 0.2–4 วิ)
--     VACUUM ธรรมดา = ปลอดภัย ไม่ล็อกตาราง
-- ----------------------------------------------------------------
vacuum (analyze) public.chat_customers;

-- ----------------------------------------------------------------
-- (2) ตั้ง autovacuum ให้ "ไล่เก็บถี่ขึ้น" เฉพาะตารางที่อัปเดตหนัก — กัน bloat กลับมา
--     ค่าเดิม (scale_factor 0.2 = รอ dead ถึง 20% ของตารางก่อน vacuum) ช้าไปสำหรับตารางนี้
-- ----------------------------------------------------------------
alter table public.chat_customers set (
  autovacuum_vacuum_scale_factor = 0.05,   -- vacuum เมื่อ dead ~5% (ถี่ขึ้น)
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_cost_delay = 2,
  fillfactor = 90                            -- เผื่อที่ให้ HOT update (ลดการสร้างแถวใหม่/บวม index)
);
-- fillfactor มีผลกับข้อมูลใหม่ทันที; ของเดิมจะค่อย ๆ ปรับเมื่อ vacuum/อัปเดต
-- ถ้าอยากบีบของเดิมทันที (ล็อกตารางสั้น ๆ ช่วง traffic น้อย): vacuum full public.chat_customers;

-- ----------------------------------------------------------------
-- (3) index ช่วย list query ฝั่งแชท (ตัวกรอง source แบบ OR ที่ทำให้ scan ช้า)
--     ครอบ "แชท Messenger ปกติ" (ไม่ใช่คอมเมนต์/ไลน์) เรียงตามข้อความล่าสุด
-- ----------------------------------------------------------------
-- ใช้ CONCURRENTLY = ไม่ล็อกการเขียนตอนสร้าง (แชทไม่สะดุดแม้แวบเดียว) — ต้องรันบรรทัดนี้เดี่ยว ๆ ไม่อยู่ใน transaction
create index concurrently if not exists chat_customers_inbox_msg_idx
  on public.chat_customers (last_message_at desc)
  where (source is null or (source <> 'comment' and source <> 'line')) and id not like 'fbc_%';

-- หมายเหตุ: "ไม่" ลดความถี่ cron ดึงแชท และ "ไม่" ลด polling ฝั่งแอป
--   เพราะ priority อันดับ 1 คือแชทสด/แจ้งเตือนไว/เรียลไทม์ที่สุดเสมอ
--   การลด memory ในไฟล์นี้เป็นแบบ "ไม่แตะความไว" ทั้งหมด (ตัด write ขยะ + คลาย bloat + index)

-- ----------------------------------------------------------------
-- (4) ตรวจผลหลังทำ: ดู dead rows ลดลง + index ใหม่ถูกใช้
-- ----------------------------------------------------------------
select relname, n_live_tup as live, n_dead_tup as dead, last_autovacuum
from pg_stat_user_tables where relname = 'chat_customers';
