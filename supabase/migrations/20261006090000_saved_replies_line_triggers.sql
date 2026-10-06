-- คำที่ลูกค้าพิมพ์/กดเมนูใน LINE OA แล้ว LINE ตอบอัตโนมัติเอง (ตั้งใน LINE OA Manager)
-- LINE ไม่ส่งข้อความตอบอัตโนมัติพวกนั้นมาทาง webhook แอดมินจึงไม่เห็นว่าลูกค้าได้อะไรไปแล้ว
-- ใส่คำเดียวกับที่ตั้งใน LINE ไว้ที่ข้อความบันทึกไว้ → line-webhook บันทึกข้อความนั้นลงแชทให้เห็น (ไม่ส่งซ้ำให้ลูกค้า)
alter table public.saved_replies add column if not exists line_triggers text[] not null default '{}';
