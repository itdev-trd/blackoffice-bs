-- ระบบบล็อก/สแปมแชท (chat_customers)
-- แชทที่ถูกบล็อก = ซ่อนจากลิสต์ + ข้อความใหม่ไม่เด้ง/ไม่แจ้งเตือน (แต่ยังเก็บประวัติไว้)
-- ตั้ง/ปลดผ่าน edge function "block-customer" (service role) หรือ sync spam-folder poll
alter table public.chat_customers add column if not exists blocked_at timestamptz;      -- เวลาที่ถูกบล็อก (null = ปกติ)
alter table public.chat_customers add column if not exists blocked_by text;             -- ใครบล็อก (อีเมลพนักงาน) หรือ "spam-folder" (จากเพจ)
alter table public.chat_customers add column if not exists blocked_reason text;          -- เหตุผล (ไม่บังคับ)

-- index บางส่วน: ดึงรายการที่ถูกบล็อกได้เร็ว (หน้า "ดูที่บล็อกไว้")
create index if not exists chat_customers_blocked_idx on public.chat_customers (last_message_at desc) where blocked_at is not null;

-- หมายเหตุ: การตั้ง/ปลด blocked_at ทำผ่าน service role (edge function) เท่านั้น
-- client (authenticated) อ่าน blocked_at ได้ (ใช้กรองลิสต์) แต่แก้ไม่ได้ (ไม่อยู่ใน grant update ของ chat-rls-columns)
