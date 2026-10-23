-- ให้สคริปต์ใหม่อัตโนมัติตาม lot (22 ต.ค. 69 — เริ่มจาก BeSight AMD Cycle)
-- auto_grant_min_lots = เกณฑ์ lot รวมใน auto_grant_lot_days วันล่าสุด (null = ปิด)
-- ตั้งได้ที่ ตั้งค่า › TradingView ต่อสคริปต์ · cron tradingview {"action":"lot_auto_grant_cron"} ทุก 30 นาที
alter table public.tv_scripts
  add column if not exists auto_grant_min_lots numeric,
  add column if not exists auto_grant_lot_days int not null default 30;

insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled, body_json)
values (
  'tv_lot_auto_grant', 'tv-lot-auto-grant-30m', 'ให้ Indicator ใหม่ตาม Lot',
  'ทุก 30 นาที: สคริปต์ที่ตั้งเกณฑ์ lot ไว้ — ลูกค้าที่มีสคริปต์อื่นของแบรนด์เดียวกัน + lot ถึงเกณฑ์ ได้สคริปต์นั้นอัตโนมัติ (หมดอายุพร้อมตัวเดิม)',
  'tradingview', '*/30 * * * *', true, '{"action":"lot_auto_grant_cron"}'
)
on conflict (key) do update set
  jobname = excluded.jobname, label = excluded.label, description = excluded.description,
  function_name = excluded.function_name, body_json = excluded.body_json, updated_at = now();
-- ตัว cron จริงสร้างผ่าน manage-cron (action "save" key "tv_lot_auto_grant")
