-- เก็บ "ชื่อโฆษณา" ที่ resolve ได้จากหน้าตอบแชท (ad_id -> ad name ผ่าน Meta)
-- ใช้แสดงในคอลัมน์แหล่งที่มาของหน้าฐานข้อมูลลูกค้า (บรรทัดบน = ชื่อแอด, บรรทัดล่าง = ads id)
-- รันใน Supabase SQL Editor
alter table public.chat_customers add column if not exists entry_ad_name text;

-- เช็ค: select customer_name, entry_ad_id, entry_ad_name from public.chat_customers where entry_ad_id is not null limit 10;
