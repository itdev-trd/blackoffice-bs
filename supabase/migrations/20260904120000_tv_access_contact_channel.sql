-- ช่องทางที่ลูกค้าติดต่อเข้ามา เก็บตอนแอดมินกดเพิ่มสิทธิ์ TV (แอดมินเลือกเอง ไม่ได้เดาจาก source ของแชท)
-- ค่าเป็น key ตายตัว ฝั่งหน้าจอค่อยแปลงเป็นป้าย (FB / LINE / IG / ...) จะได้เปลี่ยนคำเรียกได้โดยไม่ต้องแก้ข้อมูลเก่า
alter table public.tv_access add column if not exists contact_channel text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tv_access_contact_channel_check') then
    alter table public.tv_access
      add constraint tv_access_contact_channel_check
      check (contact_channel is null or contact_channel in ('facebook', 'line', 'instagram', 'telegram', 'tiktok', 'youtube'));
  end if;
end $$;

-- เช็ค: select username, contact_channel from public.tv_access limit 5;
