#!/usr/bin/env bash
# รัน migration ทั้งหมดเข้า Supabase Postgres ทีเดียว
#
# วิธีใช้:
#   1) เอา connection string จาก Supabase: Project Settings → Database → Connection string (URI)
#      (แนะนำใช้แบบ "Direct connection" หรือ Session pooler)
#   2) รัน:
#        export DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[REF].supabase.co:5432/postgres"
#        bash run-migrations.sh
#
# ต้องมี psql ติดตั้งไว้ (mac: brew install libpq && brew link --force libpq)

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ ยังไม่ได้ตั้ง DATABASE_URL"
  echo '   export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"'
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ ไม่พบคำสั่ง psql — ติดตั้งก่อน (mac: brew install libpq && brew link --force libpq)"
  exit 1
fi

cd "$(dirname "$0")"

# ลำดับสำคัญ: chat-customers ต้องมาก่อนไฟล์ที่ ALTER ตารางนั้น
FILES=(
  "supabase-migration-user-permissions.sql"
  "supabase-migration-activity-log.sql"
  "supabase-migration-chat-customers.sql"
  "supabase-migration-chat-leadconfig.sql"
  "supabase-migration-chat-sync-config.sql"
  "supabase-migration-chat-ai.sql"
  "supabase-migration-ad-config-snapshots.sql"
  "supabase-migration-ai-attempts.sql"       # ตัวนับความพยายาม AI (ต้องรันก่อน deploy sync-conversations/meta-webhook รุ่นใหม่)
  "supabase-migration-chat-rls-columns.sql"  # จำกัดคอลัมน์ที่ผู้ใช้แก้ได้
)

echo "▶ เริ่มรัน migration (${#FILES[@]} ไฟล์)"
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "  → $f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  else
    echo "  ⚠ ข้าม (ไม่พบไฟล์): $f"
  fi
done

echo "✅ เสร็จแล้ว"
echo ""
echo "หมายเหตุ: ไฟล์ cron (supabase-migration-cron.sql / supabase-migration-chat-sync-cron.sql)"
echo "ต้องเปิด extension pg_cron + pg_net และแก้ค่า project url/service key ก่อน จึงไม่รวมในสคริปต์นี้"
