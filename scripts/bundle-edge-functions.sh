#!/usr/bin/env bash
# รวม Edge Function แต่ละตัวให้เป็นไฟล์เดียว (self-contained) ก่อน deploy
#
# ทำไมต้อง bundle: ช่องทาง deploy ที่เราใช้ (Supabase Management API ผ่าน MCP)
# ไม่ resolve relative import ข้ามโฟลเดอร์ฟังก์ชัน — `import ... from "../_shared/x.ts"`
# จะพังด้วย "Module not found" ถ้าส่งเป็นหลายไฟล์
# esbuild จึงรวม _shared/*.ts เข้ามาในไฟล์เดียว และ rename ตัวแปรที่ชื่อชนกันให้เอง
# (เช่น createClient ที่ import ซ้ำหลายโมดูล -> createClient2, createClient3)
#
# import ที่เป็น URL (https://esm.sh/..., npm:, jsr:, node:) ถูก mark external ไว้
# Deno runtime ของ Supabase โหลดเองตอน runtime — ไม่ต้อง bundle เข้ามา
#
# ใช้งาน:  ./scripts/bundle-edge-functions.sh [ชื่อฟังก์ชัน ...]
#          ไม่ใส่ชื่อ = bundle ทุกตัว
# ผลลัพธ์:  /tmp/edge-bundles/<ชื่อฟังก์ชัน>.ts

set -uo pipefail

ESBUILD_VERSION="0.24.0"
FUNCTIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/functions"
OUT_DIR="${EDGE_BUNDLE_OUT:-/tmp/edge-bundles}"

mkdir -p "$OUT_DIR"

if [ "$#" -gt 0 ]; then
  targets=("$@")
else
  targets=()
  for dir in "$FUNCTIONS_DIR"/*/; do
    name="$(basename "$dir")"
    # _shared เป็นโค้ดร่วม ไม่ใช่ฟังก์ชันที่ deploy เดี่ยวได้
    [ "$name" = "_shared" ] && continue
    [ -f "$dir/index.ts" ] || continue
    targets+=("$name")
  done
fi

ok=0
failed=()

for name in "${targets[@]}"; do
  entry="$FUNCTIONS_DIR/$name/index.ts"
  if [ ! -f "$entry" ]; then
    echo "ไม่พบ: $entry" >&2
    failed+=("$name")
    continue
  fi

  if npx --yes "esbuild@$ESBUILD_VERSION" "$entry" \
      --bundle --format=esm --platform=neutral --target=esnext \
      --external:'https://*' --external:'npm:*' --external:'jsr:*' --external:'node:*' \
      --outfile="$OUT_DIR/$name.ts" >/dev/null 2>"$OUT_DIR/$name.err"; then
    rm -f "$OUT_DIR/$name.err"
    # กันกรณี bundle ผ่านแต่ entrypoint หลุด (ทุกฟังก์ชันต้องมี Deno.serve)
    if grep -q "Deno.serve" "$OUT_DIR/$name.ts"; then
      ok=$((ok + 1))
    else
      echo "bundle ได้แต่ไม่มี Deno.serve: $name" >&2
      failed+=("$name")
    fi
  else
    echo "bundle ไม่ผ่าน: $name (ดู $OUT_DIR/$name.err)" >&2
    failed+=("$name")
  fi
done

echo "bundle สำเร็จ $ok ตัว -> $OUT_DIR"
if [ "${#failed[@]}" -gt 0 ]; then
  echo "ไม่สำเร็จ ${#failed[@]} ตัว: ${failed[*]}" >&2
  exit 1
fi
