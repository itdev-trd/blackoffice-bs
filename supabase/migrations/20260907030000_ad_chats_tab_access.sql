-- หน้า "แอดไหนได้ลูกค้า" (ad_chats) อ่านตาราง chat_customers ชุดเดียวกับกล่องตอบแชท
-- (นับที่มาจาก entry_ad_id / comment_ad_ids) จึงต้องนับเป็นแท็บที่มีสิทธิ์อ่านด้วย
drop policy if exists "read chat_customers" on public.chat_customers;
create policy "read chat_customers" on public.chat_customers
  for select to authenticated
  using (
    (select app_is_admin())
    or (select app_has_any_tab(array['inbox'::text, 'chat'::text, 'customerdb'::text, 'feed'::text, 'ad_chats'::text]))
  );
