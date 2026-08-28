-- รายชื่อที่อ่านจาก TradingView โดยตรงต้องแยกจาก tv_access
-- tv_access = ประวัติสมาชิกที่ติดต่อ/ได้รับสิทธิ์ผ่านแอป
-- tv_external_members = snapshot ล่าสุดจาก TradingView ใช้ตรวจสอบ/ทำรายงานภายนอก
create table if not exists public.tv_external_members (
  id bigint generated always as identity primary key,
  username text not null,
  pine_id text not null references public.tv_scripts(pine_id) on delete cascade,
  brand_id bigint references public.tv_brands(id) on delete set null,
  expiration timestamptz,
  status text not null default 'active',
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (username, pine_id)
);
create index if not exists tv_external_members_brand_idx on public.tv_external_members (brand_id);
create index if not exists tv_external_members_synced_idx on public.tv_external_members (synced_at desc);
alter table public.tv_external_members enable row level security;
drop policy if exists "tv external members read" on public.tv_external_members;
create policy "tv external members read" on public.tv_external_members
  for select to authenticated using (public.app_has_tab('tv_members'));
