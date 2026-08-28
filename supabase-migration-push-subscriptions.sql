-- Web Push: เก็บ subscription ของแต่ละเครื่อง/เบราว์เซอร์ ผูกกับอีเมลผู้ใช้
-- 1 คนมีได้หลายเครื่อง (คอม + มือถือ) → คีย์ที่ endpoint (ไม่ซ้ำต่อ subscription)
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  email text not null,                 -- ผู้ใช้ที่เป็นเจ้าของ subscription นี้
  endpoint text not null unique,       -- URL ของ push service (unique ต่อ subscription)
  p256dh text not null,                -- กุญแจเข้ารหัสของ subscription
  auth text not null,
  pages jsonb not null default '[]'::jsonb,  -- เพจที่เครื่องนี้อยากรับแจ้งเตือน (ว่าง = ตามสิทธิ์ผู้ใช้)
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,              -- ส่งสำเร็จล่าสุด (ไว้ดูว่ายัง active ไหม)
  updated_at timestamptz not null default now()
);
create index if not exists push_subs_email_idx on public.push_subscriptions (email);

-- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น
alter table public.push_subscriptions enable row level security;

-- กันส่งแจ้งเตือนซ้ำ: จำว่าเคยส่งแชทค้างรายไหนไปแล้วเมื่อไหร่
create table if not exists public.push_sent_log (
  conversation_id text not null,
  endpoint text not null,
  sent_at timestamptz not null default now(),
  primary key (conversation_id, endpoint)
);
alter table public.push_sent_log enable row level security;

-- ลงทะเบียนงาน cron: เช็คแชทค้างแล้วส่ง push ทุก 2 นาที (เบามาก ไม่เรียก Meta/AI)
insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled)
values ('pushcheck', 'push-overdue-2min', 'ส่งแจ้งเตือนแชทค้าง (Push)',
        'เช็คแชทค้างอ่านเกินเกณฑ์ แล้วส่ง Web Push ไปเครื่องพนักงาน แม้ปิดแท็บแอปไปแล้ว',
        'send-push', '*/2 * * * *', true)
on conflict (key) do nothing;
