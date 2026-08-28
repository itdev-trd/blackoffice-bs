-- ================================================================
-- เก็บ "โลโก้เพจ" ไว้ในระบบเราเอง — ดึงจาก Meta ครั้งเดียว แล้วเก็บรูปลง Storage + URL ลง DB
-- หลังจากนั้นแอปใช้ URL จาก DB (Supabase Storage) ตลอด ไม่ต้องยิง Meta อีก (เสถียร ไม่หลุด)
-- รันใน Supabase SQL Editor
-- ================================================================

-- (1) คอลัมน์เก็บ URL โลโก้ + เวลาที่อัปเดตล่าสุด (ไว้เช็ครีเฟรชเป็นระยะ)
alter table public.page_lead_config add column if not exists picture_url text;
alter table public.page_lead_config add column if not exists picture_updated_at timestamptz;

-- (2) bucket เก็บไฟล์โลโก้เพจ (public = อ่านได้เลย ไม่ต้องเซ็นชื่อ URL)
insert into storage.buckets (id, name, public)
values ('page-logos', 'page-logos', true)
on conflict (id) do update set public = true;

-- หมายเหตุ: การเขียนไฟล์ทำผ่าน edge function (service role) ซึ่ง bypass RLS อยู่แล้ว
-- อ่านเป็น public เพราะ bucket public — ไม่ต้องตั้ง policy เพิ่ม
