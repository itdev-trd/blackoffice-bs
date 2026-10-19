-- กำหนดว่า "ใครเห็นแชทเพจไหน" + เพจแบบดูอย่างเดียว (เพิ่ม 19 ต.ค. 69 สำหรับเพจ Jr 1Shot)
--   page_lead_config.chat_viewers   = อีเมลที่เห็นแชทเพจนี้ · null = ทุกคนที่มีสิทธิ์แชทตามเดิม
--     ใช้กับ "ทุกบทบาท" รวม owner/admin/ads (เดิม app_is_admin() เห็นทุกเพจ) — เพจที่จำกัดคนเห็นต้องเห็นเฉพาะที่ระบุจริง ๆ
--   page_lead_config.chat_read_only = ดึงมาไว้ดู/สรุปข้อมูลอย่างเดียว: ไม่ติดยังไม่อ่าน ไม่แจ้งเตือน ตอบไม่ได้
--     ไม่ส่งป้าย/สถานะกลับ Meta ไม่นับสถิติการตอบ/แต้ม (บังคับใน edge function)
-- ประสิทธิภาพ (DB micro): app_hidden_chat_pages() อ่านตารางเล็กครั้งเดียวต่อ query (เรียกผ่าน (select ...) = initplan)

alter table public.page_lead_config add column if not exists chat_viewers text[];
alter table public.page_lead_config add column if not exists chat_read_only boolean not null default false;

-- เพจที่ผู้ใช้ปัจจุบัน "มองไม่เห็น" (ว่าง = เห็นทุกเพจตามสิทธิ์เดิม)
create or replace function public.app_hidden_chat_pages()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.page_id), '{}')
  from public.page_lead_config p
  where p.chat_viewers is not null
    and not (lower(coalesce(auth.jwt() ->> 'email', '')) = any (select lower(v) from unnest(p.chat_viewers) v));
$$;
grant execute on function public.app_hidden_chat_pages() to authenticated;

drop policy if exists "read chat_customers" on public.chat_customers;
create policy "read chat_customers" on public.chat_customers for select
using (
  not (page_id = any ((select public.app_hidden_chat_pages())::text[]))
  and (
    app_is_admin()
    or (
      app_has_any_tab(array['inbox','chat','customerdb','feed','ad_chats'])
      and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(app_allowed_pages()))))
    )
  )
);

drop policy if exists "update chat_customers" on public.chat_customers;
create policy "update chat_customers" on public.chat_customers for update
using (
  not (page_id = any ((select public.app_hidden_chat_pages())::text[]))
  and (
    app_is_admin()
    or (
      app_has_any_tab(array['inbox','chat','customerdb','feed'])
      and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(app_allowed_pages()))))
    )
  )
)
with check (
  not (page_id = any ((select public.app_hidden_chat_pages())::text[]))
  and (
    app_is_admin()
    or (
      app_has_any_tab(array['inbox','chat','customerdb','feed'])
      and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(app_allowed_pages()))))
    )
  )
);

drop policy if exists "read chat_live" on public.chat_live;
create policy "read chat_live" on public.chat_live for select
using (
  not (page_id = any ((select public.app_hidden_chat_pages())::text[]))
  and (
    app_is_admin()
    or (
      app_has_any_tab(array['inbox','chat','customerdb','feed','ad_chats'])
      and (page_id like 'line:%' or page_id = any (array(select jsonb_array_elements_text(app_allowed_pages()))))
    )
  )
);

-- ค้นข้อความ: ตารางนี้ไม่มี page_id ต้องเช็คผ่านห้องแชท — ใช้ฟังก์ชัน security definer
-- (ถ้า subquery chat_customers ตรง ๆ จะโดน RLS ของ chat_customers กรองห้องที่ซ่อนออกไปก่อน → not exists เป็นจริง → รั่ว)
create or replace function public.app_chat_in_pages(p_chat_id text, p_pages text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_customers c where c.id = p_chat_id and c.page_id = any (p_pages));
$$;
grant execute on function public.app_chat_in_pages(text, text[]) to authenticated;

drop policy if exists "read chat message search" on public.chat_message_search;
create policy "read chat message search"
  on public.chat_message_search for select to authenticated
  using (
    ((select public.app_is_admin()) or (select public.app_has_any_tab(array['inbox','chat','customerdb','feed','ad_chats'])))
    and (
      (select cardinality(public.app_hidden_chat_pages())) = 0
      or not public.app_chat_in_pages(chat_message_search.chat_id, (select public.app_hidden_chat_pages()))
    )
  );

-- Jr 1Shot: ดึงมาเพื่อสรุปข้อมูลอย่างเดียว เห็นเฉพาะ owner (danaiwut077) กับ tip
-- sync_enabled ยังไม่เปิดที่นี่ — เปิดหลัง deploy edge function ที่กันผลข้างเคียงแล้ว
update public.page_lead_config
set chat_viewers = array['danaiwut077@gmail.com', 'tip@gmail.com'], chat_read_only = true, updated_at = now()
where page_id = '1272538665947061';
