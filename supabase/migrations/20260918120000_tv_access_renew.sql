-- ต่ออายุสิทธิ์: แอดมินกดต่อเองจากหน้าแชทได้ และสถานะต้องขึ้นว่า "ต่ออายุ" ไม่ใช่ "ลูกค้าใหม่"
--   member_type = 'renew' → ป้าย Plan โชว์ "ต่ออายุ"
--   renewed_at / renew_count → รู้ว่าต่อครั้งล่าสุดเมื่อไหร่ และต่อมาแล้วกี่ครั้ง
alter table public.tv_access drop constraint if exists tv_access_member_type_check;
alter table public.tv_access
  add constraint tv_access_member_type_check check (member_type in ('new', 'free', 'premium', 'renew'));

alter table public.tv_access add column if not exists renewed_at timestamptz;
alter table public.tv_access add column if not exists renew_count integer not null default 0;

comment on column public.tv_access.member_type is 'plan: new (ทดลอง 1 เดือน) / free (ผ่านทดลองแล้ว) / premium (ครบโควตาติดกัน 3 รอบ) / renew (ต่ออายุแล้ว)';
comment on column public.tv_access.renewed_at is 'เวลาที่ต่ออายุครั้งล่าสุด (แอดมินกดปุ่มต่ออายุ)';
comment on column public.tv_access.renew_count is 'จำนวนครั้งที่ต่ออายุ';
