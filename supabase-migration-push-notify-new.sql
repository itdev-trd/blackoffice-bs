-- เปิด/ปิด "เตือนทุกข้อความใหม่ทันที" (เหมือน Messenger) ต่อเครื่อง/subscription
-- true = เด้งทุกครั้งที่ลูกค้าทัก ; false = เตือนเฉพาะแชทค้างเกินเกณฑ์ (cron)
alter table public.push_subscriptions add column if not exists notify_new boolean not null default true;
