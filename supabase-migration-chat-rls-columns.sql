-- จำกัดคอลัมน์ที่ผู้ใช้ (authenticated) แก้ได้ใน chat_customers
-- เดิม policy เปิด update ทุกคอลัมน์ — ผู้ใช้ role analyze_only ก็แก้ needs_ai/ai_verified/meta_push_status ฯลฯ ได้ผ่าน supabase-js ตรงๆ
-- หน้าเว็บใช้จริงแค่: แก้สถานะเอง + แก้ข้อมูลติดต่อ inline + ธงยังไม่อ่าน
revoke update on public.chat_customers from authenticated;
revoke update on public.chat_customers from anon;
grant update (stage, stage_manual, phone, trade_id, username, email, unread, updated_at)
  on public.chat_customers to authenticated;
-- หมายเหตุ: edge functions ใช้ service role จึงไม่กระทบ
