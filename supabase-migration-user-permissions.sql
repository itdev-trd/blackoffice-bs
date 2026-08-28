-- สิทธิ์การใช้งานต่อผู้ใช้ (role-based access)
--   role = 'admin'         -> เห็นทุกเมนู ทุกบัญชีโฆษณา (ต้องมีแถว explicit เท่านั้น)
--   role = 'analyze_only'  -> เห็นแค่หน้า "วิเคราะห์" และเห็นเฉพาะบัญชีใน allowed_ad_accounts
-- allowed_ad_accounts = อาเรย์ของ account_id (เฉพาะตัวเลข เช่น "759642435880672") ที่อนุญาตให้เห็น

create table if not exists public.user_permissions (
  email text primary key,
  role text not null default 'analyze_only' check (role in ('admin', 'analyze_only')),
  allowed_ad_accounts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_permissions enable row level security;

-- ผู้ใช้อ่านสิทธิ์ของตัวเองได้ (ใช้ทั้งฝั่งเว็บและ edge function ที่รันในนามผู้ใช้)
drop policy if exists "read own permission" on public.user_permissions;
create policy "read own permission" on public.user_permissions
  for select to authenticated
  using (lower(auth.jwt() ->> 'email') = lower(email));

-- ตั้งเจ้าของระบบเป็น admin (ผู้ใช้อื่นที่ไม่มีแถวจะถูกปฏิเสธโดย security-hardening migration)
insert into public.user_permissions (email, role, allowed_ad_accounts)
values ('aphiwat@traderidermedia.com', 'admin', '[]'::jsonb)
on conflict (email) do update set role = 'admin', updated_at = now();

-- ตัวอย่างวิธีเพิ่มผู้ใช้แบบ "เห็นแค่หน้าวิเคราะห์ + เฉพาะบางบัญชี":
-- insert into public.user_permissions (email, role, allowed_ad_accounts)
-- values ('staff@example.com', 'analyze_only', '["759642435880672","609435807268597"]'::jsonb)
-- on conflict (email) do update set role = excluded.role, allowed_ad_accounts = excluded.allowed_ad_accounts, updated_at = now();
