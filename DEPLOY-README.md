# วิธีเอา AI Ads Automation ขึ้นใช้งานจริง

โค้ดชุดนี้ใช้ stack เดียวกับ AlphardVIP: React + Vite + Supabase (ฐานข้อมูล + auth + edge functions) + Vercel (hosting)
เหลือแค่คุณสมัครบัญชี ใส่ค่าที่ได้ลงไฟล์ `.env` และตั้งค่า Meta Marketing API

---

## 1. สร้างโปรเจกต์ Supabase (ฟรี — หรือใช้โปรเจกต์เดียวกับ AlphardVIP ก็ได้ แต่แนะนำแยกโปรเจกต์เพราะเป็นคนละธุรกิจ)
1. ไปที่ https://supabase.com → สมัคร/ล็อกอิน → New Project
2. ตั้งชื่อโปรเจกต์ ตั้งรหัสผ่านฐานข้อมูล เลือก region ใกล้ไทย (Singapore) → Create

## 2. สร้างตารางข้อมูล
1. ในโปรเจกต์ Supabase ไปที่เมนู **SQL Editor** → New query
2. รัน `supabase-schema.sql` ก่อน แล้วรันไฟล์ `supabase-migration-*.sql` ที่เกี่ยวข้อง
3. รัน `supabase-migration-security-hardening.sql` **เป็นไฟล์สุดท้ายเสมอ** เพื่อเปิด RLS แบบจำกัด role/page/account

## 3. คัดลอกกุญแจเชื่อมต่อ
1. ไปที่ **Project Settings → API**
2. คัดลอก `Project URL` และ `anon public` key
3. สร้างไฟล์ชื่อ `.env` ในโฟลเดอร์นี้ (คัดลอกจาก `.env.example`) แล้ววางค่า:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

## 4. สร้างบัญชีผู้ใช้ (แอดมิน)
1. ไปที่ **Authentication → Users → Add user** สร้างอีเมล/รหัสผ่านสำหรับตัวเอง (และทีมที่จะช่วยดูแลแคมเปญ)
2. บัญชีใหม่เริ่มแบบไม่มีสิทธิ์ ผู้ดูแลต้องเพิ่ม/แก้แถวใน `user_permissions` และกำหนด role/tab/page/account ให้ชัดเจน
3. ต้องมี admin อย่างน้อยหนึ่งบัญชีแบบ explicit ห้ามอาศัยพฤติกรรม “ไม่มีแถว = admin”

## 5. Deploy Edge Functions

แนะนำ deploy จาก Supabase CLI เพื่อให้ทุกฟังก์ชันและไฟล์ `_shared` ตรงกับ repository:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>

# ทุกฟังก์ชันยกเว้น Meta webhook ต้องเปิด JWT verification
for fn in $(find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name _shared -exec basename {} \;); do
  if [ "$fn" = "meta-webhook" ]; then
    supabase functions deploy "$fn" --no-verify-jwt
  else
    supabase functions deploy "$fn"
  fi
done
```

`meta-webhook` เป็นฟังก์ชันเดียวที่ปิด JWT เพราะ Meta ไม่มี Supabase token แต่โค้ดบังคับตรวจ `x-hub-signature-256` ด้วย `META_APP_SECRET` และจะปฏิเสธ request หากไม่ได้ตั้ง secret

### ตั้งค่า Secrets
ไปที่เมนู **Edge Functions → Manage secrets** → กด **Add new secret** ทีละตัว:

| Name | Value | ใช้ในฟังก์ชัน |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key ของคุณ | generate-ad-content |
| `IMAGE_API_KEY` | API key ของ image-gen provider ที่เลือกใช้ | generate-ad-content |
| `META_ACCESS_TOKEN` | System User long-lived token (ดูวิธีสร้างใน `META-SETUP-README.md`) | launch-campaign, monitor-ads, scale-budget |
| `META_APP_SECRET` | App Secret ของ Meta (บังคับ) | meta-webhook |
| `META_VERIFY_TOKEN` | ค่าสุ่มสำหรับยืนยัน webhook | meta-webhook |
| `TELEGRAM_BOT_TOKEN` | (ไม่บังคับ) token จาก @BotFather ถ้าอยากได้แจ้งเตือนเข้า Telegram ด้วย | monitor-ads |
| `TELEGRAM_CHAT_ID` | (ไม่บังคับ) chat id ที่จะรับแจ้งเตือน | monitor-ads |

> หมายเหตุ: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ระบบใส่ให้อัตโนมัติอยู่แล้วทุกฟังก์ชัน ไม่ต้องตั้งเอง (ชื่อขึ้นต้นด้วย `SUPABASE_` เป็นชื่อสงวน ตั้งเองไม่ได้ด้วย)

## 6. ตั้งเวลาให้ระบบมอนิเตอร์ทำงานอัตโนมัติ (pg_cron)
1. ไปที่ **Database → Extensions** เปิดใช้งาน `pg_cron` และ `pg_net`
2. เปิดไฟล์ `supabase-migration-cron.sql` อ่านคำแนะนำด้านบนไฟล์ (มี 2 วิธีให้เลือกตามที่โปรเจกต์คุณรองรับ)
3. คัดลอกไปวางใน **SQL Editor → New query** แล้วกด **Run**
4. เช็คว่าตั้งสำเร็จ: รัน `select * from cron.job;` ควรเห็น job ชื่อ `ai-ads-monitor-every-15min`

## 7. ตั้งค่า Meta Marketing API
**ทำตามไฟล์ `META-SETUP-README.md` ในโฟลเดอร์นี้ก่อน** — มีขั้นตอน App Review, สร้าง System User, สร้าง Custom/Lookalike Audience ที่จำเป็นต้องมีก่อนใช้งานจริง

## 8. รันทดสอบในเครื่อง
```
npm ci
npm run check
npm run dev
```
เปิดเบราว์เซอร์ตาม URL ที่ขึ้น (ปกติ http://localhost:5173) แล้วลองล็อกอิน

## 9. Deploy ขึ้นให้มี URL จริง (Vercel — ฟรี)

### 9.1 เอาโค้ดขึ้น GitHub
1. เปิด **GitHub Desktop** → Sign in → **File → Add local repository...** → เลือกโฟลเดอร์นี้
2. ถ้าถามว่าจะสร้าง git repository ไหม → กด **create a repository**
3. ใส่ชื่อ repo (เช่น `ai-ads-automation`) → **Create Repository**
4. ช่อง Summary พิมพ์ `Initial commit` → **Commit to main**
5. กด **Publish repository** → เลือก Private (แนะนำ) → **Publish**

### 9.2 Deploy บน Vercel
1. ไปที่ https://vercel.com → **Sign Up** → **Continue with GitHub**
2. Dashboard → **Add New → Project** → หา repo ที่สร้าง → **Import**
3. Vercel ตรวจพบว่าเป็นโปรเจกต์ Vite เองอัตโนมัติ ไม่ต้องแก้อะไร
4. เปิด **Environment Variables** → เพิ่ม:
   - `VITE_SUPABASE_URL` = Project URL จาก Supabase
   - `VITE_SUPABASE_ANON_KEY` = anon public key จาก Supabase
5. กด **Deploy** รอประมาณ 1 นาที
6. กด **Visit** เปิดเว็บที่ deploy เสร็จแล้ว เช่น `https://ai-ads-automation.vercel.app`

ทุกครั้งที่ push โค้ดใหม่ขึ้น GitHub Vercel จะ deploy เวอร์ชันใหม่ให้อัตโนมัติ

---

## ทดสอบก่อนใช้จริง (สำคัญ)
1. ตั้งค่า `daily_budget_thb` ในแท็บ "ตั้งค่า" ให้ต่ำไว้ก่อน (เช่น 100-300 บาท/วัน)
2. ลองสร้างคอนเทนต์ 1 ก้อน → อนุมัติ → เช็คว่า Campaign/AdSet/Ad ถูกสร้างจริงใน Meta Ads Manager (จะเห็นสถานะ ACTIVE)
3. ปล่อยให้ pg_cron รัน 1-2 รอบ เช็คว่า `metrics_log` มีข้อมูลเข้ามา และ auto-pause logic ทำงานถูกต้อง (ลองปรับ `target_cpa_thb` ให้ trigger ง่ายๆ ดูก่อนได้)
4. มั่นใจแล้วค่อยเพิ่มงบและปล่อยให้ทำงานต่อเนื่อง

## ข้อควรระวัง
- โฆษณาสายการเงิน/เทรด เข้าข่าย special ad category ของ Meta — อ่าน copy ที่ AI สร้างทุกครั้งก่อนกดอนุมัติจริงๆ อย่ากดอนุมัติรัวๆ
- การเพิ่มงบ (`scale-budget`) ถูกออกแบบให้ต้องมีคนกดอนุมัติในเว็บแอปเสมอ — ถ้าจะปลดล็อกให้ auto เต็มรูปแบบทีหลัง ต้องแก้ `monitor-ads` เอง (ไม่แนะนำจนกว่าจะมั่นใจใน logic การวัดผล)
