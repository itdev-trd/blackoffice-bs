-- ติดตามการส่งสถานะไป Meta (Conversion Leads) — กันส่งซ้ำ + retry เฉพาะที่ล้มเหลว
alter table public.chat_customers add column if not exists meta_push_status text;     -- 'success' | 'failed'
alter table public.chat_customers add column if not exists meta_push_stage  text;     -- สถานะที่ส่งไปครั้งล่าสุด
alter table public.chat_customers add column if not exists meta_push_error  text;     -- ข้อความ error ถ้าไม่สำเร็จ
alter table public.chat_customers add column if not exists meta_push_at     timestamptz;

create index if not exists chat_customers_push_idx on public.chat_customers (meta_push_status);

-- Dataset ID เก็บใน settings.chat_sync_config.meta_dataset_id (ตั้งในหน้าตั้งค่าการซิงก์แชท)
