-- คอมเมนต์ใต้โฆษณา/โพสต์ — เก็บเป็น "บทสนทนา" ในกล่องแชทเดียวกัน (source = 'comment')
-- id ของแถวใช้รูปแบบ  fbc_<comment_id>  เพื่อไม่ชนกับ conversation id ของ Messenger
alter table public.chat_customers
  add column if not exists comment_post_id  text,   -- post id ของโพสต์/แอดที่ถูกคอมเมนต์
  add column if not exists comment_permalink text,   -- ลิงก์เปิดดูคอมเมนต์/โพสต์บน Facebook
  add column if not exists comment_ad_name  text;    -- ชื่อแอด (ถ้ารู้จากตอนดึงย้อนหลัง)

-- ช่วยกรอง/แสดงเฉพาะคอมเมนต์ได้เร็ว
create index if not exists chat_customers_source_idx on public.chat_customers (source);
