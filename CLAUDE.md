# CLAUDE.md

- ตอบผู้ใช้เป็นภาษาไทย

## ขอบเขตงานแชท
- คำสั่งทุกอย่างที่เกี่ยวกับแชท (ดึง/ซิงก์/ตอบ/ป้าย/สถิติ/export) หมายถึง **เพจ BeSight (page_id `438134449376109`) และ LINE OA ของ BeSight** เป็นหลัก
- ข้อยกเว้น (19 ต.ค. 69): **Jr 1Shot (`1272538665947061`) = ดูอย่างเดียว** ดึงมาไว้สรุปข้อมูล เห็นเฉพาะ danaiwut077 กับ tip
  - คุมด้วย `page_lead_config.chat_viewers` (ใครเห็น · RLS `app_hidden_chat_pages()`) และ `chat_read_only` (ห้ามตอบ/ป้าย/CAPI/แจ้งเตือน/สถิติ-แต้ม) — owner ตั้งได้ที่ ตั้งค่า › สิทธิ์ผู้ใช้ › ใครเห็นแชทเพจไหน
  - edge function ที่ใช้ service role อ่านแชทต้องเช็คเองด้วย `_shared/chat-pages.ts` (RLS ไม่ช่วย) · หน้าเว็บใช้ `lib/constants/chat-pages.js`
- token ตอบแชท (แอป Refund-ads) เห็นเพจของธุรกิจอื่น 20+ เพจ — เปิดดึงแชทเฉพาะเพจที่ owner สั่ง (`page_lead_config.sync_enabled`) ไม่งั้นแชทธุรกิจอื่นไหลเข้า
- หลังแก้อะไรที่แตะการดึงแชท ให้เช็คว่า `chat_customers` ไม่มีแถวของ `page_id` อื่นนอกจาก BeSight / LINE OA BeSight / Jr 1Shot

## ฐานข้อมูล (compute MICRO — ล่มมาแล้ว 7–8 ต.ค. 69)
- อ่าน `docs/RUNBOOK-ฐานข้อมูลล่ม.md` ก่อนแตะ index/trigger/realtime/polling
- ห้าม index/trigger ที่ประมวลผล `chat_customers.transcript` ทั้งก้อน · ห้ามเอา `chat_customers` กลับเข้า Realtime (ใช้ `chat_live`)
- `.github/workflows/db-watchdog.yml` เฝ้าฐานข้อมูลจากภายนอกทุก 5 นาที
