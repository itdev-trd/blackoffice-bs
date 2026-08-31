#!/usr/bin/env bash
# หาบั๊ก "อ้างตัวแปรที่ไม่มีอยู่จริง" ใน Edge Functions
#
# ทำไมต้องมี: edge function เขียนเป็น TypeScript แต่ไม่มีขั้นตอน type check ที่ไหนเลย
# (esbuild แค่ลบ type ทิ้ง ไม่ตรวจ) บั๊กแบบอ้างตัวแปรที่ไม่ได้ประกาศจึงหลุดไปถึง production
# แล้วระเบิดเป็น ReferenceError ตอน runtime — ที่เคยเจอคือ `userData` ใน
# ai-suggest-pairing (พังหลังเรียก AI ไปแล้ว) และ launch-campaign
# (พังหลังสร้างแคมเปญบน Facebook แล้ว = แอดขึ้นจริงแต่ไม่มีแถวในระบบ)
#
# สนใจเฉพาะ TS2304 "Cannot find name" ที่ไม่ใช่ global ของ Deno
# error ชนิดอื่น (TS2307 ไม่พบ module, TS5097 import ลงท้าย .ts, TS2339/TS2345 เรื่อง type)
# เป็นเรื่องปกติของโค้ดสไตล์ Deno ที่รันผ่าน tsc ธรรมดา ไม่ใช่บั๊ก
#
# ใช้งาน: ./scripts/typecheck-edge-functions.sh
# คืนค่า 0 = ไม่พบบั๊ก, 1 = พบ

set -uo pipefail

TS_VERSION="5.6.3"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$(mktemp -t tsconfig-edge-XXXXXX.json)"
trap 'rm -f "$CONFIG"' EXIT

cat > "$CONFIG" <<JSON
{
  "compilerOptions": {
    "noEmit": true,
    "skipLibCheck": true,
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": [],
    "lib": ["esnext", "dom"],
    "strict": false,
    "noImplicitAny": false
  },
  "include": ["$ROOT/supabase/functions/**/*.ts"]
}
JSON

# หมายเหตุ: ต้องเรียกผ่าน --package เพราะแพ็กเกจ typescript ไม่มี bin ชื่อ "typescript"
# (bin คือ "tsc") — `npx typescript@x tsc` จะล้มเงียบๆ แล้วดูเหมือนว่าไม่มี error
output="$(npx --yes --package="typescript@$TS_VERSION" tsc -p "$CONFIG" 2>&1)"

findings="$(printf '%s\n' "$output" \
  | grep 'TS2304' \
  | grep -viE "Cannot find name '(Deno|EdgeRuntime)'" \
  | sed "s|$ROOT/supabase/functions/||")"

if [ -z "$findings" ]; then
  echo "ไม่พบตัวแปรที่อ้างแล้วไม่มีอยู่จริง"
  exit 0
fi

echo "พบตัวแปรที่อ้างแล้วไม่มีอยู่จริง (จะพังตอน runtime):"
printf '%s\n' "$findings" | sed 's/^/  /'
echo ""
echo "จำนวน: $(printf '%s\n' "$findings" | wc -l | tr -d ' ')"
exit 1
