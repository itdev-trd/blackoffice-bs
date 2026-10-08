# CLAUDE.md

- ตอบผู้ใช้เป็นภาษาไทย

## ขอบเขตงานแชท
- คำสั่งทุกอย่างที่เกี่ยวกับแชท (ดึง/ซิงก์/ตอบ/ป้าย/สถิติ/export) หมายถึง **เพจ BeSight (page_id `438134449376109`) และ LINE OA ของ BeSight เท่านั้น**
- token ตอบแชท (แอป Refund-ads) เห็นเพจของธุรกิจอื่น 20+ เพจ — โค้ดที่ไล่เพจต้องจำกัดเพจเสมอ (ดู `getChatPages` ใน `supabase/functions/_shared/meta-pages.ts`)
- หลังแก้อะไรที่แตะการดึงแชท ให้เช็คว่า `chat_customers` ไม่มีแถวของ `page_id` อื่นโผล่เข้ามา

## ฐานข้อมูล (compute MICRO — ล่มมาแล้ว 7–8 ต.ค. 69)
- อ่าน `docs/RUNBOOK-ฐานข้อมูลล่ม.md` ก่อนแตะ index/trigger/realtime/polling
- ห้าม index/trigger ที่ประมวลผล `chat_customers.transcript` ทั้งก้อน · ห้ามเอา `chat_customers` กลับเข้า Realtime (ใช้ `chat_live`)
- `.github/workflows/db-watchdog.yml` เฝ้าฐานข้อมูลจากภายนอกทุก 5 นาที
