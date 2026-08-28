# Meta API Rate Limit Fix

แก้ปัญหา endpoint `GET /me/accounts` ถูกเรียกซ้ำจำนวนมาก

## สิ่งที่แก้

1. เพิ่ม cache กลางใน `supabase/functions/_shared/meta-pages.ts`
   - เก็บรายชื่อเพจและ Page Access Token ในตาราง `app_secrets`
   - อายุ cache 6 ชั่วโมง
   - Edge Functions ทุกตัวใช้ cache เดียวกัน แม้เกิด cold start

2. แก้ Edge Functions ต่อไปนี้ให้ใช้ cache
   - `messenger-reply`
   - `page-labels`
   - `meta-push-labels`
   - `subscribe-webhook`

3. ปรับ `sync-conversations`
   - เปลี่ยน cache จาก 30 นาทีเป็น 6 ชั่วโมง

4. ป้องกัน `mark_seen` ซ้ำ
   - ถ้าบทสนทนาเป็นสถานะอ่านแล้ว จะไม่เรียก Meta API ซ้ำ

## ขั้นตอนนำขึ้นระบบ

ต้อง deploy Edge Functions ที่แก้ทั้งหมด ไม่ใช่ deploy หน้าเว็บอย่างเดียว

```bash
supabase functions deploy messenger-reply
supabase functions deploy page-labels
supabase functions deploy meta-push-labels
supabase functions deploy subscribe-webhook
supabase functions deploy sync-conversations
```

หากใช้คำสั่ง deploy functions ทั้งหมดของโปรเจกต์อยู่แล้ว สามารถใช้วิธีเดิมได้

## ผลที่คาดหวัง

`GET /me/accounts` จะถูกเรียกประมาณหนึ่งครั้งต่อ 6 ชั่วโมง แทนการเรียกทุกครั้งที่เปิดแชท ส่งข้อความ ดึงรูปโปรไฟล์ หรือ mark seen

หมายเหตุ: ครั้งแรกหลัง deploy จะยังมีการเรียก `/me/accounts` หนึ่งครั้งเพื่อสร้าง cache ซึ่งเป็นพฤติกรรมปกติ
