-- plan ของสมาชิก Indicator (เดิมช่อง member_type เก็บ free/paid/promotion ซึ่งไม่ได้ใช้จริง)
--   new     = ลูกค้าใหม่ อยู่ในช่วงทดลอง 1 เดือน
--   free    = ผ่านช่วงทดลองแล้ว ต่ออายุได้ถ้าเทรดครบโควตา
--   premium = เทรดครบโควตาติดกัน 3 รอบ (ตกโควตาเมื่อไหร่ลดกลับเป็น free)
alter table public.tv_access drop constraint if exists tv_access_member_type_check;

update public.tv_access
set member_type = 'new'
where member_type is null or member_type in ('paid', 'promotion');

alter table public.tv_access
  add constraint tv_access_member_type_check check (member_type in ('new', 'free', 'premium'));

alter table public.tv_access
  alter column member_type set default 'new';

-- จำนวนรอบที่เทรดครบโควตาติดต่อกัน — ใช้ตัดสินเลื่อนขั้นเป็น premium (ครบ 3 รอบ)
alter table public.tv_access
  add column if not exists qualify_streak integer not null default 0;

comment on column public.tv_access.member_type is 'plan: new (ทดลอง 1 เดือน) / free (ผ่านทดลองแล้ว) / premium (ครบโควตาติดกัน 3 รอบ)';
comment on column public.tv_access.qualify_streak is 'จำนวนรอบติดต่อกันที่เทรดครบโควตา — ครบ 3 เลื่อนเป็น premium, ตกโควตารีเซ็ตเป็น 0';
