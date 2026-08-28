-- ปรับตรรกะ "ติดป้ายสถานะบน Meta" + "AI ตรวจซ้ำ" (รันครั้งเดียวใน SQL editor)
-- ไม่มีคอลัมน์ใหม่ — แค่เคลียร์/ปรับข้อมูลเดิมให้เข้ากับตรรกะใหม่

-- 1) ล็อกสถานะระดับคอนเวอร์ชั่น: ไม่ต้องจัด/ตรวจซ้ำอีก (เคลียร์ธงที่ค้างจากตรรกะเก่า)
--    ทำให้ตัวเลข "รอตรวจซ้ำ" ไม่ค้างเพราะแถว converted เดิม
update public.chat_customers
   set needs_verify = false, needs_ai = false
 where stage in ('converted', 'account_opened')
   and (needs_verify is true or needs_ai is true);

-- 2) (ไม่บังคับ) ทำให้ลูกค้าที่ "สร้างคอนเวอร์ชั่น/เปิดบัญชี" อยู่แล้ว ส่งป้ายได้
--    ตรรกะใหม่ยิงป้ายเฉพาะ classified_by = 'ai-verify' หรือ ตั้งเอง (stage_manual)
--    ถ้าต้องการให้คอนเวอร์ชั่นเดิม (ที่ได้ข้อมูลครบ) ถือว่า "ยืนยันแล้ว" และส่งป้ายได้ทันที
--    ปลดคอมเมนต์บล็อกด้านล่างแล้วรัน:
-- update public.chat_customers
--    set classified_by = 'ai-verify'
--  where stage in ('converted', 'account_opened')
--    and stage_manual is null
--    and classified_by in ('ai', 'rule', 'pending')
--    and (phone is not null or trade_id is not null or username is not null);
