-- แท็บ "ฟีด" (ตอบคอมเมนต์) อ่าน/เขียนตาราง chat_customers ชุดเดียวกับกล่องตอบแชท
-- (คอมเมนต์เก็บเป็นแถว id ขึ้นต้น fbc_/igc_) จึงต้องนับ 'feed' เป็นแท็บที่มีสิทธิ์ด้วย
-- ไม่งั้นพนักงานที่ได้สิทธิ์เฉพาะหน้าฟีดจะเปิดหน้าได้แต่ไม่เห็นคอมเมนต์สักอัน
drop policy if exists "read chat_customers" on public.chat_customers;
create policy "read chat_customers" on public.chat_customers
  for select to authenticated
  using (
    (select app_is_admin())
    or (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text, 'feed'::text]))
  );

drop policy if exists "update chat_customers" on public.chat_customers;
create policy "update chat_customers" on public.chat_customers
  for update to authenticated
  using (
    (select app_is_admin())
    or (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text, 'feed'::text]))
  )
  with check (
    (select app_is_admin())
    or (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text, 'feed'::text]))
  );
