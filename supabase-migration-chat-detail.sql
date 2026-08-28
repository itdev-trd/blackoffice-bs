-- ฟิลด์เพิ่มสำหรับหน้า "ฐานข้อมูลลูกค้า":
--   email      = อีเมลที่พบในข้อความลูกค้า (ถ้ามี)
--   transcript = บทสนทนาที่ดึงมา (ทั้งสองฝั่ง) ไว้กดดูรายคนว่าดึงอะไรมาวิเคราะห์
--                รูปแบบ: [{ "w": "u"|"p", "t": "ข้อความ", "at": "timestamp" }, ...]  (u = ลูกค้า, p = เพจ)
alter table public.chat_customers add column if not exists email text;
alter table public.chat_customers add column if not exists transcript jsonb;

-- หมายเหตุ: source / entry_ad_id (แหล่งที่มา/แอดตัวไหน) มีคอลัมน์อยู่แล้วจาก migration ก่อนหน้า
-- แต่การรู้ว่ามาจาก "แอดตัวไหน" ต้องรับค่า ad_id จาก Messenger referral webhook (แยกต่างหาก)
