-- รูปโปรไฟล์ลูกค้า (Messenger) — ดึงจาก User Profile API แล้วเก็บไว้ ไม่ต้องดึงซ้ำทุกครั้ง
alter table public.chat_customers add column if not exists profile_pic text;
