-- ================================================================
-- ระบบจัดการสมาชิก TradingView (ให้สิทธิ์เข้า pine script + วันหมดอายุ)
-- รันใน Supabase SQL Editor  (ต้องรัน security-hardening ก่อนแล้ว เพราะใช้ app_has_tab/app_is_admin)
-- ================================================================

-- สคริปต์ (pine) ที่เราให้สิทธิ์ได้
create table if not exists public.tv_scripts (
  pine_id text primary key,               -- รูปแบบ TradingView เช่น PUB;75ee20d5bee6431c9bdef0282d58fdd3
  name text not null,                     -- ชื่อที่โชว์ เช่น BeSight ONE.STR Model Execution
  script_key text,                        -- ชื่อย่อภายใน เช่น script_a
  created_at timestamptz not null default now()
);

-- สิทธิ์การเข้าถึงต่อ (สมาชิก × สคริปต์)
create table if not exists public.tv_access (
  id bigint generated always as identity primary key,
  username text not null,                 -- TradingView username
  pine_id text not null references public.tv_scripts(pine_id) on delete cascade,
  display_name text,                      -- ชื่อเล่น/ชื่อจริง (ถ้ามี)
  expiration timestamptz,                 -- null = ตลอดชีพ
  lot text,                               -- ข้อมูลเสริม (เช่น lot ที่เทรด)
  trade_id text,                          -- เลข trade id (โยงกับลูกค้า)
  status text not null default 'active',  -- active | expired | error
  last_synced_at timestamptz,             -- ครั้งล่าสุดที่ sync/ยืนยันกับ TradingView
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (username, pine_id)
);
create index if not exists tv_access_username_idx on public.tv_access (username);
create index if not exists tv_access_expiration_idx on public.tv_access (expiration) where status = 'active';

-- RLS: อ่านได้ถ้ามีสิทธิ์แท็บ tv_members ; เขียนทำผ่าน edge function (service role) เท่านั้น
alter table public.tv_scripts enable row level security;
alter table public.tv_access  enable row level security;
drop policy if exists "tv_scripts read" on public.tv_scripts;
create policy "tv_scripts read" on public.tv_scripts for select to authenticated using (public.app_has_tab('tv_members'));
drop policy if exists "tv_access read" on public.tv_access;
create policy "tv_access read" on public.tv_access for select to authenticated using (public.app_has_tab('tv_members'));

-- เปิด Realtime ให้ tv_access (ฟีดสมาชิกสดในหน้า) — ต้องมี replica identity full ให้ RLS เช็คคอลัมน์ได้
alter table public.tv_access replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tv_access') then
    alter publication supabase_realtime add table public.tv_access;
  end if;
end $$;

-- (ตัวอย่าง) ใส่สคริปต์แรกไว้เลย — แก้ pine_id/ชื่อให้ตรงของจริง หรือเพิ่มผ่านหน้าเว็บทีหลัง
insert into public.tv_scripts (pine_id, name, script_key)
values ('PUB;75ee20d5bee6431c9bdef0282d58fdd3', 'BeSight ONE.STR Model Execution', 'script_a')
on conflict (pine_id) do nothing;
