-- เก็บ "ใครแก้ไขล่าสุด + เมื่อไหร่" แยกจากคนเพิ่มเดิม (granted_by/granted_at ไม่โดนทับตอนแก้วัน)
-- รันใน Supabase SQL Editor
alter table public.tv_access add column if not exists edited_by text;        -- ชื่อเล่นคนแก้ไขล่าสุด
alter table public.tv_access add column if not exists edited_at timestamptz;  -- เวลาที่แก้ไขล่าสุด

-- เช็ค: select username, granted_by, granted_at, edited_by, edited_at from public.tv_access limit 5;
