-- ============================================================
-- Multi-brand TradingView: หลายแบรนด์ = คุกกี้คนละตัว + pub (สคริปต์) คนละชุด
-- แบรนด์เก็บ metadata ที่นี่ · คุกกี้ (sessionid/sign) เก็บใน app_secrets (service role เท่านั้น)
-- รันใน Supabase SQL Editor (ต้องรัน tv-members + security-hardening มาก่อน)
-- ============================================================

create table if not exists public.tv_brands (
  id bigint generated always as identity primary key,
  name text not null,
  tv_base text,                                   -- ว่าง = https://www.tradingview.com
  pages jsonb not null default '[]'::jsonb,       -- page_id ของแชทที่โชว์ฟอร์มเพิ่ม TV ของแบรนด์นี้ (ว่าง = ไม่ผูกเพจ)
  show_in_manager boolean not null default true,  -- โชว์ในหน้าจัดการสมาชิก TV ไหม
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tv_scripts add column if not exists brand_id bigint references public.tv_brands(id) on delete set null;
alter table public.tv_access  add column if not exists brand_id bigint;   -- โยงแบรนด์ (denormalized เพื่อ query/นับเร็ว)
create index if not exists tv_scripts_brand_idx on public.tv_scripts (brand_id);
create index if not exists tv_access_brand_idx  on public.tv_access (brand_id);

-- RLS: อ่านได้ถ้ามีสิทธิ์แท็บ tv_members ; เขียนทำผ่าน edge function (service role) เท่านั้น
alter table public.tv_brands enable row level security;
drop policy if exists "tv_brands read" on public.tv_brands;
create policy "tv_brands read" on public.tv_brands for select to authenticated using (public.app_has_tab('tv_members'));

-- Realtime (ให้ UI เห็นแบรนด์ที่เพิ่ม/แก้แบบสด)
alter table public.tv_brands replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tv_brands') then
    alter publication supabase_realtime add table public.tv_brands;
  end if;
end $$;

-- ---- ยกของเดิมเป็น "แบรนด์เริ่มต้น" ----
-- สร้างแบรนด์เริ่มต้นถ้ายังไม่มีแบรนด์ใดเลย แล้ว backfill สคริปต์/สมาชิกเดิมเข้าไป
do $$
declare def_id bigint;
begin
  if not exists (select 1 from public.tv_brands) then
    insert into public.tv_brands (name, show_in_manager) values ('BeSight', true) returning id into def_id;
    update public.tv_scripts set brand_id = def_id where brand_id is null;
    update public.tv_access a set brand_id = def_id where brand_id is null;
  end if;
end $$;

-- เช็ค: select * from public.tv_brands;  select pine_id, name, brand_id from public.tv_scripts;
