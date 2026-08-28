alter table public.tv_access
  add column if not exists last_granted_at timestamptz;

-- ผลการตรวจสิทธิ์ล่าสุดบน TradingView (กดตรวจจากหน้าจัดการสมาชิก)
alter table public.tv_access
  add column if not exists tv_access_verified boolean,
  add column if not exists tv_verified_at timestamptz,
  add column if not exists tv_verify_error text;

update public.tv_access
-- แถวเดิมอาจเคยถูกกดให้สิทธิ์ซ้ำก่อนมีคอลัมน์นี้ โดยเวลาล่าสุดถูกเก็บใน edited_at/updated_at
set last_granted_at = greatest(granted_at, edited_at, updated_at, created_at)
where last_granted_at is null;

create index if not exists idx_tv_access_last_granted_at
  on public.tv_access (last_granted_at desc);
