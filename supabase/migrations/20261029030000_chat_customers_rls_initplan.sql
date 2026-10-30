-- กฎสิทธิ์ chat_customers เรียก app_is_admin()/app_has_any_tab() ซ้ำทุกแถว (4k แถว ≈ 1 วินาที ต่อการโหลดรายการแชท)
-- ครอบด้วย (select ...) ให้ Postgres คำนวณครั้งเดียวต่อ query (InitPlan) — เงื่อนไขเหมือนเดิมทุกตัว
alter policy "read chat_customers" on public.chat_customers using (
  not (page_id = any ((select public.app_hidden_chat_pages())::text[]))
  and (
    (select public.app_is_admin())
    or (
      (select public.app_has_any_tab(array['inbox','chat','customerdb','feed','ad_chats']))
      and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(public.app_allowed_pages()))))
    )
  )
);

alter policy "update chat_customers" on public.chat_customers using (
  not (page_id = any ((select public.app_hidden_chat_pages())::text[]))
  and (
    (select public.app_is_admin())
    or (
      (select public.app_has_any_tab(array['inbox','chat','customerdb','feed']))
      and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(public.app_allowed_pages()))))
    )
  )
) with check (
  not (page_id = any ((select public.app_hidden_chat_pages())::text[]))
  and (
    (select public.app_is_admin())
    or (
      (select public.app_has_any_tab(array['inbox','chat','customerdb','feed']))
      and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(public.app_allowed_pages()))))
    )
  )
);
