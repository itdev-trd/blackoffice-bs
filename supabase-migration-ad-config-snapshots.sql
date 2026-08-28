-- เก็บ snapshot การตั้งค่าโฆษณา (targeting/creative/งบ) เป็นเวอร์ชัน เพื่อดูย้อนหลัง/เทียบ diff
-- บันทึกเฉพาะเมื่อค่าเปลี่ยน (เทียบ hash) เพื่อประหยัดพื้นที่
create table if not exists public.ad_config_snapshots (
  id bigint generated always as identity primary key,
  node_id text not null,
  node_level text not null,          -- campaign / adset / ad
  account_id text,
  hash text not null,
  config jsonb not null,             -- ค่าที่ตั้งไว้ (targeting/creative/งบ ฯลฯ)
  summary text,                      -- สรุปสั้นๆ อ่านง่าย
  captured_at timestamptz not null default now()
);
create index if not exists ad_config_snapshots_node_idx on public.ad_config_snapshots (node_id, captured_at desc);

alter table public.ad_config_snapshots enable row level security;
drop policy if exists "read ad_config_snapshots" on public.ad_config_snapshots;
create policy "read ad_config_snapshots" on public.ad_config_snapshots for select using (auth.role() = 'authenticated');
-- insert ทำผ่าน service role (ฟังก์ชัน snapshot-config) เท่านั้น
