-- สิทธิ์ตอบแชท = สิทธิ์ระดับ "แท็บ" ไม่ผูกกับเพจอีกต่อไป
--
-- ของเดิมผูกกับ user_permissions.allowed_pages ซึ่งพังใช้งานจริง 2 แบบ:
--   1) LINE OA ใช้ page_id 'line:<userId>' ที่ไม่มีวันอยู่ในลิสต์นั้น (ลิสต์มีแต่เพจ Meta)
--      รอบก่อนแก้ RLS ให้ LINE ผ่านแล้ว แต่ edge function ยังเช็ค allowed_pages อยู่
--      พนักงานจึงกดตอบ/พรีวิวแชท LINE ไม่ได้ ขึ้น "ไม่มีสิทธิ์เข้าถึงเพจนี้"
--   2) เพิ่มเพจใหม่ทีไร ทุกคนตอบเพจนั้นไม่ได้จนแอดมินไปติ๊กให้รายคน
--
-- ใหม่: ใครมีสิทธิ์แท็บ inbox/chat/customerdb เห็นและตอบแชทได้ทุกเพจและทุก LINE OA
-- (allowed_pages ยังใช้คุมงานโฆษณา/ตั้งค่าระดับเพจตามเดิม — เมนูข้อความ, dataset, ป้ายกำกับแบบ bulk)
drop policy if exists "read chat_customers" on public.chat_customers;
create policy "read chat_customers" on public.chat_customers
  for select to authenticated
  using (
    (select app_is_admin())
    or (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text]))
  );

drop policy if exists "update chat_customers" on public.chat_customers;
create policy "update chat_customers" on public.chat_customers
  for update to authenticated
  using (
    (select app_is_admin())
    or (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text]))
  )
  with check (
    (select app_is_admin())
    or (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text]))
  );

-- เช็ค: select policyname, qual from pg_policies where tablename = 'chat_customers';
