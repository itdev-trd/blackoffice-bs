-- เพิ่มบทบาท owner / ads และลดสิทธิ์การ "มองเห็น" ของ admin
--
-- โครงเดิมมีสองบทบาท: admin (เห็นทุกอย่าง) กับ analyze_only (เลือกเมนูเอง)
-- ของใหม่แยก "อำนาจกับข้อมูล" ออกจาก "เมนู/ตั้งค่าที่มองเห็น":
--   owner        — ทำได้ทุกอย่าง
--   ads (ยิงแอด) — เห็นทุกเมนู แต่ตั้งค่าเห็นแค่ข้อความบันทึกไว้
--   admin        — เห็นเมนูงานลูกค้า ตั้งค่าเห็นแค่ข้อความบันทึกไว้
--                  แต่ยังตอบแชททุกเพจ แก้ข้อมูลลูกค้า และให้สิทธิ์ TradingView ได้เต็มที่
--   analyze_only — เหมือนเดิม (เลือกเมนู/เพจ/บัญชี/หัวข้อตั้งค่าเองทีละอัน)
--
-- สำคัญ: app_is_admin() ยังเป็นจริงกับ owner/admin/ads เพราะ policy เขียนข้อมูลลูกค้าทั้งระบบ
-- อ้างฟังก์ชันนี้อยู่ ถ้าตัด admin ออกจากตัวนี้ แอดมินจะแก้ข้อมูลลูกค้าไม่ได้ทันที
-- ซึ่งขัดกับที่ต้องการ (แอดมินต้องทำงานลูกค้าได้เหมือนสิทธิ์สูงสุด)
-- ส่วนการจำกัด "เมนู/ตั้งค่า" ไปอยู่ที่ app_role_tabs() / app_has_setting() แทน

-- บทบาทที่ยอมรับ (กันค่าพิมพ์ผิดหลุดเข้ามาแล้วกลายเป็นไม่มีสิทธิ์อะไรเลยแบบเงียบ ๆ)
alter table public.user_permissions drop constraint if exists user_permissions_role_check;
alter table public.user_permissions
  add constraint user_permissions_role_check
  check (role in ('owner', 'ads', 'admin', 'analyze_only'));

create or replace function public.app_role()
returns text
language sql
stable
set search_path = public
as $$
  select p.role
  from public.user_permissions p
  where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

revoke all on function public.app_role() from public;
grant execute on function public.app_role() to authenticated;

create or replace function public.app_is_owner()
returns boolean
language sql
stable
set search_path = public
as $$ select public.app_role() = 'owner' $$;

revoke all on function public.app_is_owner() from public;
grant execute on function public.app_is_owner() to authenticated;

-- "มีอำนาจกับข้อมูลเต็มที่" — ชื่อฟังก์ชันยังเป็น app_is_admin เพราะ policy ทั้งระบบเรียกชื่อนี้
create or replace function public.app_is_admin()
returns boolean
language sql
stable
set search_path = public
as $$ select public.app_role() in ('owner', 'admin', 'ads') $$;

-- เมนูที่บทบาทนั้นเห็น — null = เห็นทุกเมนู (ต้องตรงกับ lib/constants/roles.js)
create or replace function public.app_role_tabs()
returns jsonb
language sql
stable
set search_path = public
as $$
  select case public.app_role()
    when 'owner' then null
    when 'ads' then null
    when 'admin' then '["overview","inbox","ad_chats","feed","customerdb","customer_list","leaderboard","tv_members","settings"]'::jsonb
    else coalesce((
      select p.allowed_tabs from public.user_permissions p
      where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1
    ), '[]'::jsonb)
  end
$$;

revoke all on function public.app_role_tabs() from public;
grant execute on function public.app_role_tabs() to authenticated;

-- เมนูนี้เข้าได้ไหม — owner/ads ได้ทุกเมนู, admin ตามลิสต์, analyze_only ตามที่มอบไว้
create or replace function public.app_has_any_tab(required_tabs text[])
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when public.app_role() is null then false
    when public.app_role_tabs() is null then true
    else public.app_role_tabs() ?| required_tabs
  end
$$;

-- หัวข้อตั้งค่านี้แก้ได้ไหม — owner ได้ทุกหัวข้อ, admin/ads ได้แค่ข้อความบันทึกไว้
create or replace function public.app_has_setting(required_setting text)
returns boolean
language sql
stable
set search_path = public
as $$
  select case public.app_role()
    when 'owner' then true
    when 'admin' then required_setting = 'savedreplies'
    when 'ads' then required_setting = 'savedreplies'
    when 'analyze_only' then exists(
      select 1 from public.user_permissions p
      where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and p.allowed_tabs ? 'settings'
        and p.allowed_settings ? required_setting)
    else false
  end
$$;

-- เพจที่จำกัดไว้ — ใช้กับ analyze_only เท่านั้นเหมือนเดิม
-- (owner/admin/ads ผ่านทาง app_is_admin() อยู่แล้ว จึงตอบเป็นลิสต์ว่างได้)
create or replace function public.app_allowed_pages()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select p.allowed_pages
    from public.user_permissions p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.role = 'analyze_only'
    limit 1
  ), '[]'::jsonb)
$$;

-- บัญชีเจ้าของระบบต้องเป็น owner ไม่งั้นพอ admin ถูกลดสิทธิ์
-- จะเข้าหน้าตั้งค่า/สิทธิ์ผู้ใช้ไม่ได้อีกเลย (ล็อกตัวเองออกจากระบบของตัวเอง)
-- ที่เหลือคงเป็น admin ไว้ตามที่เจ้าของระบบเลือก แล้วปรับเป็นบทบาทอื่นได้เองในหน้าสิทธิ์ผู้ใช้
update public.user_permissions set role = 'owner'
where lower(email) = 'danaiwut077@gmail.com';
