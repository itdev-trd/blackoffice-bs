-- แอดมินป้อนข้อมูลลูกค้าเอง (ไอดีเทรด/username/เบอร์/อีเมล) จากหน้าตอบแชท
-- มาร์คว่า "ป้อนโดยแอดมิน" + ใครป้อน + เมื่อไหร่ · AI/sync/webhook ต้องไม่แก้ทับข้อมูลชุดนี้
alter table public.chat_customers add column if not exists manual_data boolean not null default false;  -- true = ข้อมูลติดต่อถูกแอดมินป้อนเอง (ล็อก ไม่ให้ AI แก้)
alter table public.chat_customers add column if not exists manual_data_by text;                          -- อีเมลแอดมินที่ป้อน
alter table public.chat_customers add column if not exists manual_data_at timestamptz;                   -- เวลาที่ป้อน

-- หมายเหตุ: การตั้ง manual_data/manual_data_by ทำผ่าน service role (edge function save-lead-fields) เท่านั้น
-- client อ่านได้ (โชว์ในหน้าฐานข้อมูล) แต่แก้ไม่ได้ (ไม่อยู่ใน grant update ของ chat-rls-columns) กันปลอมชื่อผู้ป้อน
