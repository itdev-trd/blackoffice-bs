-- ขยายสิทธิ์: เลือกเมนูที่เข้าถึงได้ + เพจที่เข้าถึงได้ (ตอบแชท) ต่อผู้ใช้
alter table public.user_permissions add column if not exists allowed_tabs jsonb not null default '[]'::jsonb;   -- คีย์เมนู เช่น ["inbox","customerdb"]  (ว่าง = ไม่มีสิทธิ์)
alter table public.user_permissions add column if not exists allowed_pages jsonb not null default '[]'::jsonb;  -- page_id ที่เข้าถึงได้ (ว่าง = ไม่เห็นเพจ)
