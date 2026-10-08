-- ที่อยู่ลูกค้า (แอดมินกรอก/วางจากแชท) — แยกจากข้อมูลเทรด/สิทธิ์อินดิเคเตอร์
-- { name, phone, line1, subdistrict, district, province, postcode, note, updated_by, updated_at }
-- คอลัมน์ nullable ไม่มี default = เปลี่ยนแค่ metadata ไม่ rewrite ตาราง (ปลอดภัยกับ compute MICRO)
-- ไม่ทำ index — ไม่ได้ค้นด้วยที่อยู่ อ่านเฉพาะตอนเปิดแชท/รายงานลูกค้า
alter table public.chat_customers add column if not exists address jsonb;
