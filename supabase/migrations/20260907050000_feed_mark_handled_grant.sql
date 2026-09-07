-- หน้าฟีดต้องปิดงานคอมเมนต์เองได้ (คอมเมนต์ที่ไม่ต้องตอบ เช่น อีโมจิ/สแปม)
-- awaiting_reply เป็นธง workflow ของแอปเอง ไม่ใช่ข้อมูลจาก Meta จึงให้หน้าเว็บเขียนได้
-- (คอลัมน์อื่นที่กระทบข้อมูลลูกค้ายังล็อกไว้เหมือนเดิม — ดู grant ชุดหลักใน chat-rls-columns)
grant update (awaiting_reply) on public.chat_customers to authenticated;
