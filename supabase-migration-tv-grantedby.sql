-- เก็บ "ใครเป็นคนเพิ่มสิทธิ์ + เมื่อไหร่" ในตาราง tv_access
alter table public.tv_access add column if not exists granted_by text;   -- ชื่อเล่นแอดมินที่กดเพิ่ม (fallback = อีเมล)
alter table public.tv_access add column if not exists granted_at timestamptz;  -- เวลาที่กดเพิ่ม/ต่อสิทธิ์ล่าสุด
