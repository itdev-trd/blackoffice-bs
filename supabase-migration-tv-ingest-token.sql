-- token สำหรับรับคุกกี้อัตโนมัติจาก Chrome extension (ต่อแบรนด์)
-- extension ยิง POST { token, sessionid, sessionid_sign } มาที่ edge function → เก็บคุกกี้ให้แบรนด์นั้น
-- รันใน Supabase SQL Editor (ต้องรัน tv-brands มาก่อน)
create extension if not exists pgcrypto;
alter table public.tv_brands add column if not exists ingest_token text;

-- สร้าง token ให้แบรนด์ที่ยังไม่มี (สุ่มไม่ซ้ำ)
update public.tv_brands
set ingest_token = replace(gen_random_uuid()::text, '-', '')
where ingest_token is null;

-- กันซ้ำ
create unique index if not exists tv_brands_ingest_token_uk on public.tv_brands (ingest_token);

-- เช็ค: select id, name, ingest_token from public.tv_brands;
