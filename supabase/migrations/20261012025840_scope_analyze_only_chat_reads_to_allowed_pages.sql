-- ช่องโหว่: นโยบาย RLS เดิมของ chat_customers/chat_live เช็กแค่สิทธิ์แท็บ ไม่เช็ก allowed_pages
-- บทบาท analyze_only (ใช้กับบัญชี reviewer ของ Meta ด้วย) จึงอ่านแชทของทุกเพจได้ผ่าน REST ตรงๆ
-- (ตัวกรองเพจเดิมอยู่แค่ฝั่ง JS หน้าเว็บ) ทั้งที่ owner/admin/ads เห็นทุกเพจอยู่แล้วผ่าน app_is_admin()
-- จึงจำกัดเฉพาะกรณีที่ไม่ใช่ admin-tier ให้ต้องอยู่ใน allowed_pages หรือเป็นห้อง LINE (ทุกคนที่มีสิทธิ์แท็บเห็น LINE ร่วมกันตามดีไซน์เดิม)

drop policy if exists "read chat_customers" on public.chat_customers;
create policy "read chat_customers" on public.chat_customers for select
using (
  app_is_admin()
  or (
    app_has_any_tab(array['inbox','chat','customerdb','feed','ad_chats'])
    and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(app_allowed_pages()))))
  )
);

drop policy if exists "update chat_customers" on public.chat_customers;
create policy "update chat_customers" on public.chat_customers for update
using (
  app_is_admin()
  or (
    app_has_any_tab(array['inbox','chat','customerdb','feed'])
    and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(app_allowed_pages()))))
  )
)
with check (
  app_is_admin()
  or (
    app_has_any_tab(array['inbox','chat','customerdb','feed'])
    and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(app_allowed_pages()))))
  )
);

drop policy if exists "read chat_live" on public.chat_live;
create policy "read chat_live" on public.chat_live for select
using (
  app_is_admin()
  or (
    app_has_any_tab(array['inbox','chat','customerdb','feed','ad_chats'])
    and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(app_allowed_pages()))))
  )
);
