-- เก็บอีเมลลูกค้าในตาราง tv_access (โชว์ในหน้าจัดการสมาชิก TV + ส่งมาจากหน้าตอบแชท)
-- รันใน Supabase SQL Editor
alter table public.tv_access add column if not exists email text;   -- อีเมลลูกค้า (ถ้ามี)

-- เช็ค: select username, email from public.tv_access limit 5;
