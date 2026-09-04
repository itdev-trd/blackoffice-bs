-- ประเภทสมาชิก แบ่งตามที่มาของสิทธิ์ (ฟรี / จ่ายเงิน / โปรโมชั่น) — แอดมินเลือกตอนเพิ่มสิทธิ์ TV
-- เก็บเป็น key เหมือน contact_channel เพื่อให้เปลี่ยนคำเรียกบนหน้าจอได้โดยไม่ต้องแก้ข้อมูลเก่า
alter table public.tv_access add column if not exists member_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tv_access_member_type_check') then
    alter table public.tv_access
      add constraint tv_access_member_type_check
      check (member_type is null or member_type in ('free', 'paid', 'promotion'));
  end if;
end $$;

-- เช็ค: select username, member_type, contact_channel from public.tv_access limit 5;
