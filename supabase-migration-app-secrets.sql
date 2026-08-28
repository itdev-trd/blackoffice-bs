-- ============================================================
-- Migration: เก็บ META_ACCESS_TOKEN ในฐานข้อมูล เพื่อให้ตั้ง/ต่ออายุได้จากหน้าเว็บแอป
-- ตารางนี้ "ฝั่งเว็บ (authenticated) อ่าน/เขียนตรงไม่ได้" — มีแต่ service role (Edge Functions) เท่านั้น
-- การตั้งค่า token ต้องผ่าน Edge Function `set-meta-token` เท่านั้น (กัน token หลุดไปฝั่ง client)
-- รันใน Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- ============================================================

create table if not exists public.app_secrets (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;
-- ไม่สร้าง policy ใดๆ ให้ anon/authenticated => เข้าถึงตรงไม่ได้เลย
-- service role (Edge Functions) bypass RLS อยู่แล้ว จึงอ่าน/เขียนได้ฝ่ายเดียว
