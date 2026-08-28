-- แยกงาน AI ออกจากการซิงก์:
--   ปุ่มซิงก์  = ดึงข้อมูลลูกค้าอย่างเดียว (กฎฟรี + แท็กแอดมิน) ไม่ใช้ AI
--   ปุ่ม AI เล็ก = จัดสถานะลูกค้าที่ยัง ≠ สร้างคอนเวอร์ชั่น และเนื้อหาแชทอัปเดต  → มาร์ค "โดย AI"
--   ปุ่ม AI ใหญ่ = ตรวจซ้ำลูกค้าสถานะ สร้างคอนเวอร์ชั่น + มีคุณสมบัติ            → มาร์ค "AI ✓"
alter table public.chat_customers add column if not exists content_hash text;                          -- hash เนื้อหาแชทล่าสุด (ไว้เทียบว่ามีอัปเดตไหม)
alter table public.chat_customers add column if not exists needs_ai boolean not null default true;      -- ต้องให้ AI ตัวเล็กจัดสถานะ (มีข้อมูลอัปเดต)
alter table public.chat_customers add column if not exists needs_verify boolean not null default false; -- ต้องให้ AI ตัวใหญ่ตรวจซ้ำ

-- index บางส่วน (เฉพาะแถวที่ต้องทำงาน) — ให้ปุ่ม AI ดึง candidate ได้เร็ว
create index if not exists chat_customers_needs_ai_idx on public.chat_customers (last_message_at desc) where needs_ai;
create index if not exists chat_customers_needs_verify_idx on public.chat_customers (last_message_at desc) where needs_verify;
