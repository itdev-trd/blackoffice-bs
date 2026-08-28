#!/usr/bin/env bash
# restore-supabase.sh — กู้ข้อมูลจากไฟล์สำรองกลับเข้าฐานข้อมูล
#
# ⚠️ คำสั่งนี้ "เขียนทับ" ฐานข้อมูลปลายทาง — ต้องพิมพ์ยืนยันก่อนเสมอ
#
# ใช้:
#   bash restore-supabase.sh <ไฟล์.dump> <connection string ปลายทาง> [ชื่อ schema]
#
# ตัวอย่าง:
#   # กู้ทั้งฐาน (ปกติใช้กับโปรเจกต์ใหม่/เปล่า)
#   bash restore-supabase.sh ~/Backups/supabase/ai-ads_latest.dump "postgresql://..."
#
#   # กู้เฉพาะ schema public (ข้อมูลแอป — ไม่แตะระบบล็อกอิน) ← ที่ใช้บ่อยสุด
#   bash restore-supabase.sh ~/Backups/supabase/ai-ads_latest.dump "postgresql://..." public
#
# ก่อนกู้จริง แนะนำให้ลองกับ Supabase โปรเจกต์เปล่าที่สร้างใหม่ก่อนเสมอ

set -uo pipefail

FILE="${1:-}"
CONN="${2:-}"
SCHEMA="${3:-}"

if [ -z "$FILE" ] || [ -z "$CONN" ]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

[ -f "$FILE" ] || { echo "❌ ไม่พบไฟล์: $FILE"; exit 1; }
command -v pg_restore >/dev/null 2>&1 || { echo "❌ ไม่พบ pg_restore — brew install libpq && brew link --force libpq"; exit 1; }

# ---------- แสดงข้อมูลไฟล์ให้ดูก่อน ----------
echo "=========================================="
echo "ไฟล์สำรอง : $FILE"
echo "ขนาด      : $(du -h "$FILE" | cut -f1)"
echo "สร้างเมื่อ : $(date -r "$FILE" '+%d/%m/%Y %H:%M' 2>/dev/null || stat -c %y "$FILE" 2>/dev/null)"
echo "อ็อบเจกต์  : $(pg_restore --list "$FILE" 2>/dev/null | grep -c ';') รายการ"
echo "ตารางที่มี :"
pg_restore --list "$FILE" 2>/dev/null | grep -i 'TABLE DATA' | awk '{print "            - " $(NF-1) "." $NF}' | head -25
TBL_TOTAL=$(pg_restore --list "$FILE" 2>/dev/null | grep -ci 'TABLE DATA')
[ "$TBL_TOTAL" -gt 25 ] && echo "            ... และอีก $((TBL_TOTAL - 25)) ตาราง"

# ปลายทาง (ซ่อนรหัสผ่าน)
SAFE_CONN=$(echo "$CONN" | sed -E 's#://([^:]+):[^@]+@#://\1:***@#')
echo "------------------------------------------"
echo "ปลายทาง   : $SAFE_CONN"
[ -n "$SCHEMA" ] && echo "เฉพาะ schema: $SCHEMA" || echo "ขอบเขต    : ทั้งฐานข้อมูล"
echo "=========================================="
echo ""
echo "⚠️  ข้อมูลเดิมในปลายทางที่ชื่อชนกันจะถูกเขียนทับ และกู้กลับไม่ได้"
printf 'พิมพ์ RESTORE เพื่อยืนยัน (อย่างอื่น = ยกเลิก): '
read -r ANSWER
[ "$ANSWER" = "RESTORE" ] || { echo "ยกเลิกแล้ว — ไม่มีอะไรถูกเปลี่ยน"; exit 0; }

# ---------- กู้ข้อมูล ----------
echo ""
echo "กำลังกู้ข้อมูล... (ใช้เวลาสักครู่)"

SCHEMA_ARG=""
[ -n "$SCHEMA" ] && SCHEMA_ARG="--schema=$SCHEMA"

# --clean --if-exists : ลบของเดิมก่อนสร้างใหม่ (กัน error ซ้ำซ้อน)
# --no-owner/--no-privileges : ไม่ยัด role เดิมที่ปลายทางอาจไม่มี
# --single-transaction ไม่ใช้ เพราะถ้าพังกลางทางจะ rollback ทั้งหมด — ใช้ --exit-on-error=off ให้ทำต่อแล้วดู error ท้ายสุดแทน
pg_restore \
  --dbname="$CONN" \
  --clean --if-exists \
  --no-owner --no-privileges \
  $SCHEMA_ARG \
  --verbose \
  "$FILE" 2>&1 | tail -40

echo ""
echo "✅ กู้ข้อมูลเสร็จ"
echo ""
echo "สิ่งที่ต้องทำต่อหลังกู้เข้าโปรเจกต์ใหม่:"
echo "  1) ตั้ง secrets ของ edge functions ใหม่ (META_ACCESS_TOKEN, IMAGE_API_KEY ฯลฯ)"
echo "  2) deploy edge functions: supabase functions deploy"
echo "  3) ตั้ง cron ใหม่ (pg_cron ไม่ติดมากับ dump): รัน supabase-migration-scheduled-jobs.sql"
echo "  4) สร้าง storage bucket 'chat-media' และ 'brand-assets' ใหม่ (ไฟล์ใน storage ไม่อยู่ใน dump นี้)"
echo "  5) แก้ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ในหน้าเว็บให้ชี้โปรเจกต์ใหม่"
echo "  6) อัปเดต Webhook URL ในแอป Meta ให้ชี้โปรเจกต์ใหม่"
