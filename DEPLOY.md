# Deploy ขึ้น Vercel

repo: `itdev-trd/blackoffice-bs` · framework: Next.js 15 (App Router)

---

## 1. ตั้งค่าโปรเจกต์บน Vercel

Import repo จาก GitHub แล้วปล่อยค่าเริ่มต้นไว้ทั้งหมด — Vercel ตรวจเจอ Next.js เองและ
`next.config.js` กำหนด security header กับกฎแคชไว้ให้แล้ว

| ช่อง | ค่า |
|---|---|
| Framework Preset | Next.js (ตรวจเจอเอง) |
| Build Command | ปล่อยว่าง (ใช้ `next build`) |
| Output Directory | ปล่อยว่าง |
| Install Command | ปล่อยว่าง |
| Node.js Version | 22.x (ล็อกไว้แล้วใน `package.json` → `engines` และ `.nvmrc`) |
| Production Branch | เลือก branch ที่จะใช้จริง — ตอนนี้งานอยู่บน `nextjs-migration` |
| Function Region | **Singapore (sin1)** → Settings → Functions → Function Region |

> ตั้ง region เป็นสิงคโปร์เพราะฐานข้อมูล Supabase อยู่ที่ `ap-southeast-1`
> ถ้าปล่อยเป็นค่าเริ่มต้น (สหรัฐฯ) ทุก request จะวิ่งข้ามโลกไปกลับ ช้าขึ้นหลายร้อย ms
> ตั้งจากหน้าเว็บแทนการใส่ใน `vercel.json` เพราะบางแพลนจำกัด region และจะทำให้ deploy ล้ม

---

## 2. Environment Variables (สำคัญที่สุด — ลืมแล้วเว็บไม่ขึ้น)

ใส่ที่ **Project → Settings → Environment Variables** ให้ครบทั้ง 3 สภาพแวดล้อม
(Production / Preview / Development)

```
NEXT_PUBLIC_SUPABASE_URL       = https://nmetbatfjiagpjbbmowp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  = <anon key จาก Supabase → Settings → API>
```

**แค่ 2 ตัวนี้เท่านั้น**

- ทั้งคู่ขึ้นต้นด้วย `NEXT_PUBLIC_` = ถูกฝังลงในหน้าเว็บและผู้ใช้เห็นได้
  จึงต้องเป็น **anon key** เท่านั้น · **ห้ามใส่ `service_role` key เด็ดขาด**
  (ความปลอดภัยจริงมาจาก RLS ในฐานข้อมูล ไม่ใช่การซ่อน key)
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` **ไม่ต้องใส่บน Vercel** — ตัวเว็บไม่ได้อ่านเลย
  คนที่ใช้คือ Supabase Edge Functions ซึ่งเก็บ secret ของตัวเองอยู่ที่
  Supabase → Edge Functions → Secrets

**ถ้าลืมใส่ → build จะล้มทันที** พร้อมข้อความบนสุดของ log ว่า:

```
Error: ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY —
ถ้า deploy บน Vercel ให้ไปเพิ่มที่ Project → Settings → Environment Variables แล้ว redeploy
```

ตั้งใจให้ล้มตั้งแต่ build ดีกว่าปล่อยเว็บที่เปิดไม่ได้ขึ้น production

---

## 3. ฝั่ง Supabase — ไม่ต้องแก้อะไร

ระบบล็อกอินใช้ **อีเมล + รหัสผ่าน** (`signInWithPassword`) ไม่ได้ใช้ OAuth
จึง **ไม่ต้องไปเพิ่ม Redirect URL** ของโดเมน Vercel

สิ่งที่ต้องมีอยู่แล้ว (มีครบแล้วตอนนี้):
- ผู้ใช้ในตาราง `user_permissions` ที่ `role` = `admin` หรือ `analyze_only`
  — คนที่ไม่มีแถวจะเข้าได้แต่เจอหน้า "บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน"
- Edge Functions deploy แล้ว + secret ครบ (คนละที่กับ Vercel)

---

## 4. ก่อนกด Deploy — เช็คในเครื่อง

```bash
npm run check
```

รวม `lint` + `build` ถ้าผ่านทั้งคู่ Vercel ก็จะ build ผ่าน

---

## 5. หลัง deploy — ตรวจ 6 ข้อ

1. เปิดโดเมน → เด้งไป `/login` (middleware ทำงาน)
2. ล็อกอิน → เข้า `/overview` และตัวเลขขึ้นครบ
3. `/inbox` เปิดแชทได้ · ส่งข้อความได้
4. สลับธีมสว่าง/มืด แล้วรีเฟรช → ธีมยังอยู่
5. เปิดบนมือถือ → มีแถบเมนูล่าง · เพิ่มลงหน้าจอโฮมได้ (PWA)
6. เปิด DevTools → Application → Service Workers → ต้องขึ้น `sw.js` สถานะ activated

---

## เรื่องที่ตั้งไว้แล้วใน `next.config.js` (ไม่ต้องแตะ)

| อะไร | ทำไม |
|---|---|
| `/version.json` → `no-store` | ไฟล์นี้คือกลไกตรวจว่ามี deploy ใหม่ ถ้า CDN แคชไว้ผู้ใช้จะไม่มีวันได้เวอร์ชันใหม่ |
| `/sw.js` → `no-store` | service worker ต้องอัปเดตได้ทันที ไม่งั้นค้างเวอร์ชันเก่าเป็นวัน |
| security headers | `nosniff` · `Referrer-Policy` · `X-Frame-Options` (กันเว็บอื่นเอาไปครอบใน iframe) · `Permissions-Policy` · HSTS |

ตั้งใน `next.config.js` ไม่ใช่ `vercel.json` เพราะแบบนี้ `next start` ในเครื่องก็ใส่ header ให้ด้วย
ทดสอบได้ก่อน deploy — ถ้าอยู่ใน `vercel.json` จะเห็นผลก็ต่อเมื่อขึ้น production แล้วเท่านั้น

ตรวจเองได้ด้วย:

```bash
npm run build && npx next start -p 3999
curl -sI http://localhost:3999/version.json | grep -i cache-control
```

---

## เจอปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| เว็บขึ้นข้อความเรื่อง env | ยังไม่ได้ใส่ตัวแปรใน Vercel หรือใส่แล้วแต่ยังไม่ redeploy (env ใหม่ต้อง build ใหม่) |
| ล็อกอินแล้วเด้งกลับ `/login` วนไม่จบ | anon key ผิดโปรเจกต์ / URL กับ key มาจากคนละโปรเจกต์ |
| เข้าได้แต่ขึ้น "ยังไม่มีสิทธิ์ใช้งาน" | อีเมลนั้นไม่มีแถวใน `user_permissions` |
| deploy ใหม่แล้วผู้ใช้ยังเห็นของเก่า | hard refresh หนึ่งครั้ง · ปกติแบนเนอร์ "มีเวอร์ชันใหม่" จะขึ้นเองภายใน 3 นาที |
