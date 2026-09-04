-- LINE OA ไม่ได้ผูกกับเพจ Facebook — page_id ของแชท LINE คือ 'line:<userId>' ซึ่งไม่มีวันอยู่ใน
-- allowed_pages ของใครเลย (ลิสต์นั้นมีแต่เพจ Meta) ผลคือมีแต่แอดมินที่เห็นแชท LINE
-- ส่วนคนที่ถูกจำกัดเพจจะไม่เห็นเลยแม้จะมีสิทธิ์แท็บตอบแชท
--
-- เปลี่ยนเป็น: ใครมีสิทธิ์แท็บ inbox/chat/customerdb ก็เห็นและตอบแชท LINE ได้ทุกคน
-- แชท Messenger/Instagram ยังจำกัดรายเพจเหมือนเดิม ไม่แตะ

drop policy if exists "read chat_customers" on public.chat_customers;
create policy "read chat_customers" on public.chat_customers
  for select to authenticated
  using (
    (select app_is_admin())
    or (
      (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text]))
      and ((select app_allowed_pages()) ? page_id or page_id like 'line:%')
    )
  );

drop policy if exists "update chat_customers" on public.chat_customers;
create policy "update chat_customers" on public.chat_customers
  for update to authenticated
  using (
    (select app_is_admin())
    or (
      (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text]))
      and ((select app_allowed_pages()) ? page_id or page_id like 'line:%')
    )
  )
  with check (
    (select app_is_admin())
    or (
      (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text]))
      and ((select app_allowed_pages()) ? page_id or page_id like 'line:%')
    )
  );

-- เช็ค: select policyname, qual from pg_policies where tablename = 'chat_customers';
