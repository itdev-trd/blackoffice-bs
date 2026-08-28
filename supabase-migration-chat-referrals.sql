-- เก็บ referral จาก Messenger webhook (ลูกค้ามาจากแอด/ลิงก์ไหน) ต่อ (page_id, psid)
-- webhook มักมาก่อนที่ sync จะดึงบทสนทนาเข้ามา จึงพักไว้ที่นี่ แล้ว sync ค่อย join เติม source/entry_ad_id
create table if not exists public.chat_referrals (
  page_id text not null,
  psid text not null,
  ad_id text,                 -- แอด Click-to-Messenger (ถ้ามาจากแอด)
  ref text,                   -- ค่า ref ในลิงก์ m.me?ref=
  source text,                -- ADS / SHORTLINK / CUSTOMER_CHAT_PLUGIN / ...
  ads_context jsonb,          -- ข้อมูลแอดเพิ่มเติม (ชื่อแอด/รูป) ถ้ามี
  received_at timestamptz not null default now(),
  primary key (page_id, psid)
);

alter table public.chat_referrals enable row level security;
drop policy if exists "read chat_referrals" on public.chat_referrals;
create policy "read chat_referrals" on public.chat_referrals for select using (auth.role() = 'authenticated');
-- insert/update ทำผ่าน service role (webhook) เท่านั้น — ไม่ต้องมี policy
