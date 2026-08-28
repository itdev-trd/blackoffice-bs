#!/usr/bin/env bash
# backup-supabase.sh — สำรองฐานข้อมูล Supabase ทุกโปรเจกต์ลงเครื่องตัวเอง
#
# ใช้ครั้งแรก:
#   1) ติดตั้ง pg_dump 17+   : brew install libpq && brew link --force libpq
#   2) สร้างไฟล์ตั้งค่า      : bash backup-supabase.sh --init
#   3) ใส่ connection string ของแต่ละโปรเจกต์ลงไฟล์นั้น แล้วรัน: bash backup-supabase.sh
#
# ออกแบบให้รันซ้ำได้ปลอดภัย (ไม่แตะข้อมูลบน Supabase — อ่านอย่างเดียว)
# เขียนสำหรับ bash 3.2 (เวอร์ชันที่ macOS มีมาให้) จึงไม่ใช้ associative array

set -uo pipefail

# ---------- ค่าตั้งต้น (override ได้ด้วย environment variable) ----------
CONFIG_FILE="${SUPABASE_BACKUP_CONFIG:-$HOME/.config/supabase-backup/projects.conf}"
BACKUP_DIR="${SUPABASE_BACKUP_DIR:-$HOME/Backups/supabase}"
KEEP_DAYS="${SUPABASE_BACKUP_KEEP_DAYS:-30}"   # เก็บย้อนหลังกี่วัน
MIN_SIZE_BYTES="${SUPABASE_BACKUP_MIN_SIZE:-51200}"  # ไฟล์เล็กกว่านี้ = ผิดปกติ (50KB)

STAMP="$(date +%Y%m%d-%H%M%S)"
TODAY="$(date +%Y-%m-%d)"
LOG_DIR="$BACKUP_DIR/logs"
LOG_FILE="$LOG_DIR/backup-$TODAY.log"

# ---------- ตัวช่วย ----------
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
die() { log "❌ $*"; exit 1; }

# แจ้งเตือนเข้า Telegram เมื่อ backup ล้มเหลว (ไม่บังคับ)
# ตั้ง TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ไว้ในไฟล์ config ถ้าอยากให้เตือน
notify() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -s -o /dev/null -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" -d "text=$1" >/dev/null 2>&1 || true
}

# ---------- โหมดสร้างไฟล์ตั้งค่า ----------
if [ "${1:-}" = "--init" ]; then
  mkdir -p "$(dirname "$CONFIG_FILE")"
  if [ -f "$CONFIG_FILE" ]; then
    echo "มีไฟล์ตั้งค่าอยู่แล้ว: $CONFIG_FILE"
    exit 0
  fi
  cat > "$CONFIG_FILE" <<'CONF'
# โปรเจกต์ Supabase ที่จะสำรอง — บรรทัดละ 1 โปรเจกต์  รูปแบบ:  ชื่อสั้น|connection string
#
# เอา connection string จาก Supabase Dashboard:
#   Project Settings → Database → Connection string → เลือกแท็บ "Session pooler" → URI
#   (ใช้ Session pooler เพราะต่อผ่าน IPv4 ได้ ส่วน Direct connection เป็น IPv6 ซึ่งเน็ตบ้านไทยส่วนใหญ่ต่อไม่ได้)
#   อย่าลืมแทน [YOUR-PASSWORD] ด้วยรหัสผ่านฐานข้อมูลจริง
#
# ชื่อสั้นใช้ตั้งชื่อไฟล์ ใช้ตัวอักษร/ตัวเลข/ขีดกลาง เท่านั้น
#
# ตัวอย่าง:
# ai-ads|postgresql://postgres.abcdefghijkl:RAHATPASSWORD@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
# โปรเจกต์สอง|postgresql://postgres.mnopqrstuvwx:RAHATPASSWORD@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres

ai-ads|วางconnectionstringตรงนี้
project-2|วางconnectionstringตรงนี้

# (ไม่บังคับ) แจ้งเตือนเข้า Telegram เมื่อสำรองข้อมูลล้มเหลว
# TELEGRAM_BOT_TOKEN=xxx
# TELEGRAM_CHAT_ID=xxx
CONF
  chmod 600 "$CONFIG_FILE"
  echo "✅ สร้างไฟล์ตั้งค่าแล้ว: $CONFIG_FILE  (สิทธิ์ 600 — อ่านได้เฉพาะคุณ)"
  echo "   เปิดแก้แล้วใส่ connection string ของทั้งสองโปรเจกต์ จากนั้นรัน: bash $0"
  exit 0
fi

# ---------- ตรวจความพร้อม ----------
mkdir -p "$BACKUP_DIR" "$LOG_DIR"

[ -f "$CONFIG_FILE" ] || die "ไม่พบไฟล์ตั้งค่า: $CONFIG_FILE — สร้างก่อนด้วย: bash $0 --init"

command -v pg_dump >/dev/null 2>&1 || die "ไม่พบคำสั่ง pg_dump — ติดตั้งด้วย: brew install libpq && brew link --force libpq"

# pg_dump ต้องเวอร์ชัน >= เซิร์ฟเวอร์ (Supabase ใช้ Postgres 17) ไม่งั้น dump ไม่ผ่าน
PGD_VER="$(pg_dump --version | sed -E 's/.* ([0-9]+).*/\1/')"
if [ "$PGD_VER" -lt 17 ] 2>/dev/null; then
  die "pg_dump เวอร์ชัน $PGD_VER เก่าเกินไป (เซิร์ฟเวอร์เป็น Postgres 17)
   แก้ด้วย: brew install libpq && brew link --force libpq
   แล้วเช็คว่า PATH ชี้ไปตัวใหม่: which pg_dump"
fi

# โหลดค่า TELEGRAM_* จาก config (ถ้ามี) — อ่านเฉพาะบรรทัด KEY=VALUE
eval "$(grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=' "$CONFIG_FILE" 2>/dev/null | sed 's/^/export /')" 2>/dev/null || true

log "=========================================="
log "เริ่มสำรองข้อมูล (pg_dump v$PGD_VER) → $BACKUP_DIR"

# ---------- วนสำรองทีละโปรเจกต์ ----------
TOTAL=0; OK_COUNT=0; FAIL_COUNT=0; FAILED_NAMES=""

while IFS='|' read -r NAME CONN || [ -n "$NAME" ]; do
  # ข้ามบรรทัดว่าง / คอมเมนต์ / บรรทัดตั้งค่า KEY=VALUE
  case "$NAME" in
    ''|'#'*) continue ;;
    *=*) continue ;;
  esac
  NAME="$(echo "$NAME" | tr -d '[:space:]')"
  CONN="$(echo "${CONN:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

  [ -n "$CONN" ] || { log "⚠️  ข้าม \"$NAME\" — ยังไม่ได้ใส่ connection string"; continue; }
  case "$CONN" in
    postgresql://*|postgres://*) ;;
    *) log "⚠️  ข้าม \"$NAME\" — connection string ไม่ถูกรูปแบบ (ต้องขึ้นต้น postgresql://)"; continue ;;
  esac

  TOTAL=$((TOTAL + 1))
  OUT="$BACKUP_DIR/${NAME}_${STAMP}.dump"
  log "--- [$NAME] กำลังสำรอง..."

  # --format=custom  : บีบอัดในตัว + เลือก restore เฉพาะบางตารางได้ทีหลัง
  # --no-owner/--no-privileges : ให้ restore เข้าโปรเจกต์อื่นได้ง่าย (เจ้าของ role ไม่ตรงกัน)
  # ไม่ใส่ --clean : กันเผลอ restore ทับของจริง ต้องตั้งใจใส่เองตอน restore
  if pg_dump "$CONN" \
      --format=custom \
      --no-owner \
      --no-privileges \
      --quote-all-identifiers \
      --file="$OUT" 2>>"$LOG_FILE"; then

    SIZE=$(wc -c < "$OUT" | tr -d ' ')

    # ตรวจว่าไฟล์ไม่เล็กผิดปกติ
    if [ "$SIZE" -lt "$MIN_SIZE_BYTES" ]; then
      log "❌ [$NAME] ไฟล์เล็กผิดปกติ ($SIZE bytes) — น่าจะสำรองไม่สมบูรณ์"
      mv "$OUT" "$OUT.suspect"
      FAIL_COUNT=$((FAIL_COUNT + 1)); FAILED_NAMES="$FAILED_NAMES $NAME"
      continue
    fi

    # ตรวจว่าไฟล์อ่านได้จริง (ไม่ใช่ไฟล์เสีย) + นับจำนวนอ็อบเจกต์
    # แยกเช็ค exit status ของ pg_restore กับจำนวนบรรทัด — อย่ารวมเป็นบรรทัดเดียวด้วย `|| echo 0`
    # เพราะ grep -c พิมพ์ "0" อยู่แล้วเมื่อไม่เจอ จะได้ค่า "0\n0" ทำให้เงื่อนไขข้างล่างพัง
    # แล้ว "ไฟล์เสียจะถูกนับว่าสำเร็จ" ซึ่งอันตรายที่สุดสำหรับระบบสำรองข้อมูล
    if LIST_OUT=$(pg_restore --list "$OUT" 2>/dev/null); then
      OBJS=$(printf '%s\n' "$LIST_OUT" | grep -c ';')
    else
      OBJS=0
    fi
    case "$OBJS" in *[!0-9]*|'') OBJS=0 ;; esac   # กันค่าเพี้ยนทุกกรณี
    if [ "$OBJS" -lt 1 ]; then
      log "❌ [$NAME] ไฟล์เปิดไม่ได้ / ไม่มีข้อมูลข้างใน"
      mv "$OUT" "$OUT.suspect"
      FAIL_COUNT=$((FAIL_COUNT + 1)); FAILED_NAMES="$FAILED_NAMES $NAME"
      continue
    fi

    HUMAN=$(echo "$SIZE" | awk '{printf "%.1f MB", $1/1048576}')
    log "✅ [$NAME] สำเร็จ — $HUMAN ($OBJS อ็อบเจกต์) → $(basename "$OUT")"
    # ทางลัดไปไฟล์ล่าสุด
    ln -sf "$(basename "$OUT")" "$BACKUP_DIR/${NAME}_latest.dump"
    OK_COUNT=$((OK_COUNT + 1))
  else
    log "❌ [$NAME] pg_dump ล้มเหลว — ดูรายละเอียดใน $LOG_FILE"
    rm -f "$OUT"
    FAIL_COUNT=$((FAIL_COUNT + 1)); FAILED_NAMES="$FAILED_NAMES $NAME"
  fi
done < "$CONFIG_FILE"

# ---------- ลบไฟล์เก่าเกินกำหนด ----------
if [ "$OK_COUNT" -gt 0 ]; then
  DELETED=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete 2>/dev/null | wc -l | tr -d ' ')
  [ "$DELETED" -gt 0 ] && log "🧹 ลบไฟล์เก่าเกิน $KEEP_DAYS วัน: $DELETED ไฟล์"
  find "$LOG_DIR" -name '*.log' -type f -mtime +90 -delete 2>/dev/null || true
fi

# ---------- สรุป ----------
log "สรุป: สำเร็จ $OK_COUNT / $TOTAL โปรเจกต์"
if [ "$TOTAL" -eq 0 ]; then
  die "ไม่มีโปรเจกต์ให้สำรอง — เช็คไฟล์ตั้งค่า $CONFIG_FILE"
fi
if [ "$FAIL_COUNT" -gt 0 ]; then
  log "❌ ล้มเหลว:$FAILED_NAMES"
  notify "⚠️ Supabase backup ล้มเหลว$FAILED_NAMES ($(date '+%d/%m %H:%M')) — เช็ค $LOG_FILE"
  exit 1
fi

TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
log "🎉 เสร็จสมบูรณ์ — พื้นที่ที่ใช้ทั้งหมด: $TOTAL_SIZE"
exit 0
