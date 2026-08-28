-- ระบุ "เครื่อง" ที่ใช้งาน (นับได้ว่าเมลเดียวกันล็อกอินพร้อมกันกี่เครื่อง)
alter table public.activity_log add column if not exists device_id text;
create index if not exists activity_log_recent_idx on public.activity_log (created_at desc, email, device_id);
