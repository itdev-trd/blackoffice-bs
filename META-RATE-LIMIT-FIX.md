# Meta /me/accounts Rate Limit Fix

แก้การเรียก `GET /me/accounts` ซ้ำจากหลาย Edge Functions โดยรวมให้ใช้ cache กลางใน `app_secrets`

## สิ่งที่แก้

- เพิ่ม `supabase/functions/_shared/meta-pages.ts`
- cache รายชื่อเพจและ Page Access Token เป็นเวลา 6 ชั่วโมง
- ใช้ stale cache ต่อได้เมื่อ Meta ตอบ error หรือ rate limit
- เปลี่ยนฟังก์ชันต่อไปนี้ให้ใช้ cache กลาง:
  - sync-conversations
  - messenger-reply
  - page-labels
  - meta-push-labels
  - subscribe-webhook

## Deploy

รันจากโฟลเดอร์โปรเจกต์:

```bash
supabase functions deploy sync-conversations
supabase functions deploy messenger-reply
supabase functions deploy page-labels
supabase functions deploy meta-push-labels
supabase functions deploy subscribe-webhook
```

ไฟล์ `_shared/meta-pages.ts` จะถูก bundle ไปพร้อมกับแต่ละ function โดยอัตโนมัติ

## ทดสอบ

1. Deploy ทั้ง 5 functions
2. ปิดแท็บเว็บทั้งหมด แล้วเปิดใหม่ 1 แท็บ
3. รีเฟรช 5 ครั้ง
4. ตรวจ `app_secrets` ว่ามี key `meta_pages_cache`
5. ค่า `updated_at` ไม่ควรเปลี่ยนทุกครั้งที่รีเฟรช แต่ประมาณทุก 6 ชั่วโมง

หมายเหตุ: `meta_accounts_cache` เป็น cache ของบัญชีโฆษณา (`/me/adaccounts`) คนละตัวกับ `meta_pages_cache` ซึ่งใช้กับ `/me/accounts`
