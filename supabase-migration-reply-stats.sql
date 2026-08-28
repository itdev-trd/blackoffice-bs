-- สถิติการตอบแชท: บันทึก 1 แถวต่อ "การตอบครั้งแรกของรอบรอ" (ลูกค้าทัก → แอดมินตอบ)
create table if not exists public.reply_stats (
  id bigint generated always as identity primary key,
  email text,                      -- แอดมินที่ตอบ (จากปุ่มส่งในแอป)
  page_id text,
  page_name text,
  conversation_id text,
  customer_name text,
  msg_at timestamptz,              -- เวลาข้อความลูกค้า (จุดเริ่มรอ)
  replied_at timestamptz not null, -- เวลาที่แอดมินตอบ
  response_ms bigint,              -- เวลารอจริงแบบดิบ (ms) — ตัวเลขตามเวลาทำการคำนวณตอนดูรายงาน
  created_at timestamptz not null default now()
);
create index if not exists reply_stats_time_idx on public.reply_stats (replied_at desc);
create index if not exists reply_stats_email_idx on public.reply_stats (email, page_id);

-- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น
alter table public.reply_stats enable row level security;

-- ค่าเริ่มต้นเวลาทำการ (แก้ได้ในหน้า "สถิติการตอบแชท")
insert into public.settings (key, value)
values ('office_hours', '{"days":[1,2,3,4,5],"open":"09:00","close":"17:00","break_start":"12:00","break_end":"13:00","slow_min":5}'::jsonb)
on conflict (key) do nothing;
