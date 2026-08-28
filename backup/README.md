# สำรองข้อมูล Supabase ลงเครื่องตัวเอง

สำรองฐานข้อมูลของทุกโปรเจกต์ Supabase มาเก็บไว้ที่เครื่องคุณ — อ่านอย่างเดียว ไม่แตะข้อมูลบนเซิร์ฟเวอร์

## ติดตั้งครั้งแรก (ทำครั้งเดียว ~10 นาที)

### 1. ติดตั้ง pg_dump เวอร์ชัน 17

Supabase ใช้ Postgres 17 — `pg_dump` ต้องเวอร์ชันเท่ากันหรือใหม่กว่า ไม่งั้นสำรองไม่ผ่าน

```bash
brew install libpq
brew link --force libpq
pg_dump --version     # ต้องขึ้น 17.x ขึ้นไป
```

ถ้ายังขึ้นเวอร์ชันเก่า แปลว่า PATH ชี้ไปตัวเก่าของ macOS ให้เพิ่มบรรทัดนี้ใน `~/.zshrc` แล้วเปิด Terminal ใหม่:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"     # Apple Silicon (M1/M2/M3)
# export PATH="/usr/local/opt/libpq/bin:$PATH"      # Intel Mac
```

### 2. สร้างไฟล์ตั้งค่า

```bash
cd /Applications/ai-ads-automation-app/backup
bash backup-supabase.sh --init
```

จะได้ไฟล์ `~/.config/supabase-backup/projects.conf` (สิทธิ์ 600 — อ่านได้เฉพาะคุณ)

### 3. ใส่ connection string ของทั้งสองโปรเจกต์

เปิดไฟล์ `~/.config/supabase-backup/projects.conf` แล้วใส่ทีละบรรทัด รูปแบบ `ชื่อสั้น|connection string`

**เอา connection string จากไหน:** Supabase Dashboard → เลือกโปรเจกต์ → Project Settings → Database → Connection string → **เลือกแท็บ "Session pooler"** → คัดลอก URI → แทน `[YOUR-PASSWORD]` ด้วยรหัสผ่านฐานข้อมูลจริง

> ใช้ **Session pooler** ไม่ใช่ Direct connection เพราะ Direct เป็น IPv6 อย่างเดียว ซึ่งเน็ตบ้านในไทยส่วนใหญ่ต่อไม่ได้ — ถ้าใช้ Direct แล้วค้างหรือ timeout นี่คือสาเหตุ

```
ai-ads|postgresql://postgres.xxxx:รหัสผ่าน@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
project-2|postgresql://postgres.yyyy:รหัสผ่าน@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
```

### 4. ทดสอบ

```bash
bash backup-supabase.sh
```

ได้ไฟล์ที่ `~/Backups/supabase/` ถ้าขึ้น ✅ ครบทั้งสองโปรเจกต์ = ใช้ได้

## ตั้งให้สำรองอัตโนมัติทุกวัน (ตี 3)

```bash
cp com.aphiwat.supabase-backup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.aphiwat.supabase-backup.plist
launchctl start com.aphiwat.supabase-backup     # ทดสอบรันทันที
```

ก่อน copy ให้เปิดไฟล์ plist เช็ค path ให้ตรงกับเครื่องคุณก่อน (มีคอมเมนต์บอกไว้ในไฟล์)

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `launchctl list \| grep supabase-backup` | เช็คว่าตั้งเวลาไว้แล้ว |
| `launchctl unload ~/Library/LaunchAgents/com.aphiwat.supabase-backup.plist` | ปิดชั่วคราว |
| `tail -f ~/Backups/supabase/logs/backup-$(date +%F).log` | ดู log วันนี้ |

ถ้าเครื่องปิดหรือหลับตอนตี 3 → launchd จะรันให้ทันทีที่เปิดเครื่องครั้งถัดไป

## การกู้ข้อมูลกลับ

```bash
# ดูว่าไฟล์มีอะไรข้างใน (ไม่แก้อะไร)
pg_restore --list ~/Backups/supabase/ai-ads_latest.dump | less

# กู้เฉพาะข้อมูลแอป (schema public) — ที่ใช้บ่อยสุด
bash restore-supabase.sh ~/Backups/supabase/ai-ads_latest.dump "postgresql://..." public

# กู้ทั้งฐาน (ใช้กับโปรเจกต์ใหม่ที่ยังว่าง)
bash restore-supabase.sh ~/Backups/supabase/ai-ads_latest.dump "postgresql://..."
```

สคริปต์จะแสดงรายละเอียดไฟล์ + ปลายทาง แล้วให้พิมพ์ `RESTORE` ยืนยันก่อนเสมอ

> **ซ้อมกู้ข้อมูลปีละครั้ง** — สร้างโปรเจกต์ Supabase ใหม่ (ฟรี) แล้วลองกู้ลงไปดู
> backup ที่ไม่เคยลองกู้ ไม่นับว่าเป็น backup เพราะยังไม่รู้ว่าใช้ได้จริงไหม

## สิ่งที่ **ไม่ได้** อยู่ในไฟล์สำรองนี้

ไฟล์ dump มีเฉพาะฐานข้อมูล (ตาราง ข้อมูล ฟังก์ชัน RLS policy) — สิ่งเหล่านี้ต้องเก็บ/ตั้งใหม่แยก:

| ไม่ได้สำรอง | ทำยังไง |
|---|---|
| ไฟล์ใน Storage (`chat-media`, `brand-assets`) | ดาวน์โหลดแยก — ยังไม่ได้ทำในสคริปต์นี้ |
| Secrets ของ edge functions (META_ACCESS_TOKEN ฯลฯ) | จดเก็บไว้ในที่ปลอดภัย เช่น password manager |
| โค้ด edge functions | อยู่ใน git repo นี้แล้ว |
| ตาราง cron (pg_cron) | รัน `supabase-migration-scheduled-jobs.sql` ใหม่ |

## ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `pg_dump: command not found` | ยังไม่ได้ `brew link --force libpq` |
| `server version mismatch` | pg_dump เก่ากว่า 17 — ดูขั้นตอนที่ 1 |
| ค้างนานแล้ว timeout | ใช้ Direct connection อยู่ ให้เปลี่ยนเป็น Session pooler |
| `password authentication failed` | รหัสผ่านผิด หรือลืมแทน `[YOUR-PASSWORD]` — รีเซ็ตได้ที่ Dashboard → Database → Reset password |
| ไฟล์ลงท้าย `.suspect` | สำรองไม่สมบูรณ์ (ไฟล์เล็กผิดปกติ/เปิดไม่ได้) สคริปต์กันไม่ให้เข้าใจผิดว่าใช้ได้ — ดู log แล้วรันใหม่ |

## หมายเหตุความปลอดภัย

- `projects.conf` มีรหัสผ่านฐานข้อมูล → เก็บที่ `~/.config/` สิทธิ์ 600 และ `.gitignore` กันไว้แล้ว
- ไฟล์ `.dump` มีข้อมูลส่วนบุคคลของลูกค้าทั้งหมด (เบอร์ อีเมล ไอดีเทรด) → อย่าวางในโฟลเดอร์ที่แชร์/ซิงก์สาธารณะ และควรเปิด FileVault บนเครื่อง
- ถ้าจะเก็บสำเนาสำรองไว้ที่อื่นด้วย (แนะนำ) ให้เข้ารหัสก่อน เช่น `gpg -c ไฟล์.dump`
