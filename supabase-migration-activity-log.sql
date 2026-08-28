-- บันทึกกิจกรรมการใช้งาน (audit log): ใครเข้าใช้ เมื่อไหร่ ทำอะไร จากที่ไหน device อะไร
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  email text,
  event text not null,           -- login / logout / pull_report / open_dashboard / ai_analyze ...
  detail jsonb,                  -- รายละเอียดเพิ่ม เช่น ชื่อแคมเปญ/แอดที่เปิด
  ip text,
  location text,                 -- เมือง, ประเทศ (จาก IP)
  user_agent text,
  device text,                   -- สรุปอุปกรณ์/เบราว์เซอร์
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx on public.activity_log (created_at desc);
create index if not exists activity_log_email_idx on public.activity_log (email);

-- ล็อกให้เขียน/อ่านผ่าน edge function (service role) เท่านั้น — ไม่เปิด policy ให้ client เข้าตรง
alter table public.activity_log enable row level security;
