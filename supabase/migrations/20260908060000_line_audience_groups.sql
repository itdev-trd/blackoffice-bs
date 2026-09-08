-- จดว่าแท็กไหนถูกอัปโหลดเป็น "กลุ่มผู้ชม" ของ LINE ไปแล้ว และมีใครอยู่ในกลุ่มนั้น
--
-- ทำไมต้องจดเอง: LINE ไม่มี API อ่านรายชื่อสมาชิกของกลุ่มผู้ชม
-- (มีแต่ audienceCount เป็นตัวเลขรวม) จึงเทียบไม่ได้ว่าใครอยู่ในกลุ่มแล้วบ้าง
-- ถ้าไม่จดไว้ ทางเดียวคือลบทั้งกลุ่มแล้วสร้างใหม่ทุกครั้งที่แท็กเปลี่ยน
-- ซึ่งทำให้ audienceGroupId เปลี่ยน และบรอดแคสต์ที่ตั้งไว้ใน LINE OA Manager พัง
--
-- มีตารางนี้แล้ว: เพิ่มคนใหม่ใช้ PUT /audienceGroup/upload (id เดิม ไม่พัง)
-- ต้องลบทั้งกลุ่มเฉพาะกรณีมีคนถูกถอดแท็กออก เพราะ LINE ไม่มี endpoint ลบสมาชิกทีละคน
create table if not exists public.line_audience_groups (
  tag text primary key,
  audience_group_id bigint not null,
  -- รายชื่อ LINE userId ที่เราอัปโหลดเข้ากลุ่มนี้ไปแล้ว
  member_psids text[] not null default '{}',
  -- LINE ให้กลุ่มอายุ 180 วัน ต้องสร้างใหม่ก่อนหมด ไม่งั้นกลุ่มหายไปเอง
  expire_at timestamptz,
  last_synced_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now()
);

comment on table public.line_audience_groups is
  'แท็กในระบบ → กลุ่มผู้ชมของ LINE (แท็กแชทของ LINE ไม่มี API จึงใช้กลุ่มผู้ชมแทน)';

alter table public.line_audience_groups enable row level security;

-- อ่านได้ทุกคนที่เข้าหน้าตอบแชทได้ (ไว้โชว์สถานะซิงก์) เขียนได้เฉพาะฝั่งเซิร์ฟเวอร์
drop policy if exists line_audience_groups_read on public.line_audience_groups;
create policy line_audience_groups_read on public.line_audience_groups
  for select to authenticated
  using (public.app_has_any_tab(array['inbox', 'chat']));

revoke all on public.line_audience_groups from anon, authenticated;
grant select on public.line_audience_groups to authenticated;
