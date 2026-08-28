-- ข้อความบันทึกไว้ (canned replies) ที่ทำในแอปเราเอง — ใช้แทน Saved Replies ของ Meta ที่ปิด API แล้ว
create table if not exists public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  page_id text,                          -- null = ใช้ได้ทุกเพจ
  title text,
  message text not null default '',
  image_url text,                        -- รูปแนบ (เก็บใน storage chat-media)
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.saved_replies enable row level security;
drop policy if exists "rw saved_replies" on public.saved_replies;
create policy "rw saved_replies" on public.saved_replies for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
