-- ================================================================
-- ทำไมพนักงาน (analyze_only) ไม่เห็นเรียลไทม์ แต่ admin เห็น
-- รันทีละบล็อกใน Supabase SQL Editor แล้วส่งผลมาให้ดู
-- ================================================================

-- (1) migration ปรับ RLS ให้เร็ว ถูก apply แล้วไหม? — ต้องเจอฟังก์ชัน app_allowed_pages
select proname
from pg_proc
where proname in ('app_allowed_pages', 'app_has_page', 'app_is_admin');

-- (2) policy อ่าน chat_customers ตอนนี้เป็นเวอร์ชันไหน (ควรมี app_allowed_pages = เวอร์ชันเร็ว)
select polname, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.chat_customers'::regclass and polcmd = 'r';

-- (3) chat_customers อยู่ใน publication ของ Realtime ไหม (ถ้าไม่มี = ไม่มีใครได้เรียลไทม์)
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'chat_customers';

-- (4) สิทธิ์ของพนักงานตั้งถูกไหม — allowed_tabs ต้องมี inbox/chat, allowed_pages ต้องมี page_id ที่เขาต้องเห็น
--     (role admin จะไม่ต้องมี allowed_pages เพราะลัดผ่าน)
select email, role,
       allowed_tabs,
       jsonb_array_length(coalesce(allowed_pages,'[]'::jsonb)) as page_count,
       allowed_pages
from public.user_permissions
where role <> 'admin'
order by email;

-- (5) เทียบ: page_id ที่มีแชทจริง (พนักงานต้องมี id พวกนี้ใน allowed_pages ถึงจะเห็น+เรียลไทม์)
select page_id, page_name, count(*) as chats
from public.chat_customers
group by page_id, page_name
order by chats desc
limit 20;
