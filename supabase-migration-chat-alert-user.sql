-- สิทธิ์รับแจ้งเตือน "แชทค้างอ่าน" ต่อผู้ใช้ (admin เปิด/ปิดให้แต่ละคนได้จากหน้าจัดการสิทธิ์)
alter table public.user_permissions add column if not exists chat_alert boolean not null default true;
-- เด้งเตือน "ทุกข้อความใหม่" ทันที (เหมือน Messenger) — admin เปิด/ปิดต่อผู้ใช้
alter table public.user_permissions add column if not exists alert_new boolean not null default true;
