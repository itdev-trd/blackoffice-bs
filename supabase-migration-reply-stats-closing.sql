-- แยก "ลูกค้าปิดบทสนทนาเอง" ออกจาก "ยังไม่ตอบ"
-- ปัญหา: ลูกค้าพิมพ์ "ขอบคุณครับ" หรือกดไลก์เป็นข้อความสุดท้ายแล้วแอดมินไม่ตอบ (ซึ่งถูกต้องแล้ว)
--        ระบบเดิมนับเป็น "ยังไม่ตอบ" ค้างตลอดไป → ตัวเลขดูแย่เกินจริงและโทษพนักงานผิด
alter table public.reply_stats add column if not exists is_closing boolean not null default false;

comment on column public.reply_stats.is_closing is 'true = ข้อความสุดท้ายเป็นการปิดบทสนทนาของลูกค้าเอง (ขอบคุณ/ไลก์/สติกเกอร์) ไม่นับเป็นค้างตอบ';

-- คำที่ถือว่า "ปิดบทสนทนา" — แก้ได้ในหน้าสถิติการตอบแชท
-- ครอบคลุมไทย/อังกฤษ/ตากาล็อก/อินโดฯ ตามภาษาลูกค้าที่เพจรับจริง
update public.settings
set value = value || jsonb_build_object('closing_words', to_jsonb(array[
  'ขอบคุณ','ขอบคุณครับ','ขอบคุณค่ะ','ขอบใจ','ครับ','ค่ะ','คับ','จ้า','โอเค','ตกลง','รับทราบ','ได้ครับ','ได้ค่ะ','เข้าใจแล้ว','ไว้ติดต่อใหม่',
  'thank','thanks','thank you','tq','ok','okay','noted','got it','alright','sure',
  'salamat','sige','ok po','opo','thank you po','salamat po',
  'terima kasih','makasih','oke','baik','siap',
  'cảm ơn','ok ạ'
]::text[]))
where key = 'office_hours';
