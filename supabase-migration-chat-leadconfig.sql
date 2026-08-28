-- เพิ่มฟิลด์ให้ chat_customers + ตั้งค่าข้อมูลที่ต้องการต่อเพจ (page_lead_config)

alter table public.chat_customers add column if not exists source text;          -- organic / ad / unknown
alter table public.chat_customers add column if not exists entry_ad_id text;      -- แอดที่ทักเข้ามา (ถ้ารู้)
alter table public.chat_customers add column if not exists trade_id text;         -- ไอดีเทรด MT4/MT5
alter table public.chat_customers add column if not exists username text;         -- username TradingView

-- ตั้งค่ารายเพจ: ต้องได้ข้อมูลอะไรถึงนับเป็น "สร้างคอนเวอร์ชั่นแล้ว" (ได้อย่างน้อย 1 อย่าง)
--   required_fields = อาเรย์ของ: "phone" | "trade_id" | "username"
create table if not exists public.page_lead_config (
  page_id text primary key,
  page_name text,
  required_fields jsonb not null default '["phone","trade_id","username"]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.page_lead_config enable row level security;
drop policy if exists "read page_lead_config" on public.page_lead_config;
create policy "read page_lead_config" on public.page_lead_config for select using (auth.role() = 'authenticated');
drop policy if exists "write page_lead_config" on public.page_lead_config;
create policy "write page_lead_config" on public.page_lead_config for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
