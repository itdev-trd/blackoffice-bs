# ตั้งค่า Messenger Webhook (real-time + ที่มาจากแอด)

Webhook ปลดล็อก 3 อย่าง: ข้อความเด้งเข้า inbox ทันที, รู้ว่าลูกค้ามาจากแอดไหน (ad_id), และเป็นฐานให้ CAPI

## 1) รัน migration
รันใน Supabase → SQL Editor:
- `supabase-migration-chat-referrals.sql`
- `supabase-migration-chat-inbox.sql` (ถ้ายังไม่ได้รัน)
- `supabase-migration-chat-ai-jobs.sql` (ถ้ายังไม่ได้รัน)

## 2) ตั้ง secret ของ Edge Function
ใน Supabase → Edge Functions → Secrets (หรือ `supabase secrets set`):
- `META_VERIFY_TOKEN` = webhookaichatbot — ต้องใส่ให้ตรงกับ Meta ในขั้นตอนที่ 4
- `META_APP_SECRET` = App Secret จาก Meta App (ใช้ตรวจลายเซ็นความปลอดภัย)

## 3) Deploy ฟังก์ชัน (ต้องเปิดสาธารณะ)
```
supabase functions deploy meta-webhook --no-verify-jwt
supabase functions deploy sync-conversations
supabase functions deploy messenger-reply
```
`--no-verify-jwt` สำคัญมาก เพราะ Meta เรียกเข้ามาโดยไม่มี token ของ Supabase

URL ของ webhook จะเป็น:
`https://<PROJECT-REF>.supabase.co/functions/v1/meta-webhook`

## 4) ตั้งค่าใน Meta App Dashboard
ไปที่ developers.facebook.com → App ของคุณ → Messenger → Settings → Webhooks:
1. **Callback URL** = URL ด้านบน
2. **Verify Token** = ค่าเดียวกับ `META_VERIFY_TOKEN`
3. กด Verify and Save (Meta จะยิง GET มาเช็ค — ฟังก์ชันตอบ challenge ให้อัตโนมัติ)
4. **Subscribe เพจ** ของคุณ แล้วติ๊กฟิลด์: `messages`, `messaging_postbacks`, `messaging_referrals` (และ `message_echoes` ถ้าต้องการปลดธง "ยังไม่ได้ตอบ" เมื่อตอบจาก Messenger โดยตรง)

## เสร็จแล้วจะได้อะไร
- ลูกค้าพิมพ์เข้ามา → เด้งขึ้นในหน้า "ตอบแชท" เกือบทันที (ต่อ transcript + ตั้งธงยังไม่ได้ตอบ)
- ลูกค้าที่กดจากแอด Click-to-Messenger → เก็บ `ad_id` อัตโนมัติ → คอลัมน์ "แหล่งที่มา" ขึ้นว่า "โฆษณา #<ad_id>"
- ตอบจาก Messenger เอง (ไม่ได้ตอบผ่านแอป) → ธง "ยังไม่ได้ตอบ" ถูกปลดให้

## ข้อจำกัด
- ได้ ad_id เฉพาะทราฟฟิกจากแอด CTM (คนทักเองผ่านเพจ/คอมเมนต์จะไม่มี)
- ได้เฉพาะลูกค้า "ตั้งแต่ตั้ง webhook เป็นต้นไป" (ย้อนหลังไม่ได้ — Meta ไม่เก็บ referral ให้)
- ลูกค้าใหม่เอี่ยม (ยังไม่มีแถวในระบบ) ข้อความแรกจะเข้าเมื่อ sync รอบถัดไปดึงมา จากนั้น webhook จะ real-time
