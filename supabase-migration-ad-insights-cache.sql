-- Cache ผลแดชบอร์ด ads (ad-insights) ใช้ร่วมกันทุก user — ใครดึงแล้วคนอื่นเปิดได้เลย ไม่ยิง Meta ซ้ำ
-- key = "{level}:{node_id}:{range_key}" · เก็บ payload ทั้งก้อน + เวลาที่ดึง
create table if not exists public.ad_insights_cache (
  cache_key text primary key,
  node_id text not null,
  level text not null,
  range_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
create index if not exists ad_insights_cache_fetched_idx on public.ad_insights_cache (fetched_at);
create index if not exists ad_insights_cache_node_idx on public.ad_insights_cache (node_id);

-- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น
alter table public.ad_insights_cache enable row level security;

-- ตั้งค่า TTL cache (นาที) เก็บใน settings.insights_cache_ttl_min (ว่าง = ใช้ค่าเริ่มต้นในโค้ด 360 นาที)
-- ตั้งค่าช่วงเวลาที่ให้ cron ดึงล่วงหน้าใน settings.insights_prefetch (ทำใน Phase ถัดไป)
