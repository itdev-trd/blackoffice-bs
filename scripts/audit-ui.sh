#!/usr/bin/env bash
# ตรวจความไม่สม่ำเสมอของ UI ที่เคยเป็นปัญหาในโปรเจกต์นี้
# ไม่ใช่ linter ทั่วไป — เป็นรายการเฉพาะที่เคยทำให้หน้าตาแต่ละหน้าไม่ตรงกัน
#
# ใช้งาน:  ./scripts/audit-ui.sh          ตรวจรายการหลัก
#          ./scripts/audit-ui.sh --all    รวมรายการที่ต้องใช้สายตาตัดสิน (empty state)
# คืนค่า 0 = สะอาด, 1 = พบรายการที่ควรดู

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

SRC=(components app)
SHOW_SOFT=0
[ "${1:-}" = "--all" ] && SHOW_SOFT=1
found=0

# กรองบรรทัดที่ไม่ใช่ปัญหาจริง:
#  - บรรทัดคอมเมนต์ (// หรือ /*) — มักเป็นคำอธิบายที่อ้างถึงปัญหาเดิม
#  - ตัวช่วยแปลข้อความ error (มี regex ของข้อความอังกฤษอยู่ในตัว โดยเจตนา)
# หมายเหตุสองข้อ:
#  - ใช้ [[:space:]] ไม่ใช่ \s เพราะ grep บน macOS เป็น BSD ซึ่งไม่รองรับ \s
#  - anchor เป็น :<เลขบรรทัด>: ไม่ใช่ ^ เพราะ NOISE กรองผลลัพธ์ของ grep -rn
#    ซึ่งมี "ไฟล์:บรรทัด:" นำหน้าอยู่แล้ว การใช้ ^ จะไม่แมตช์อะไรเลย
NOISE=':[0-9]+:[[:space:]]*(//|\*|/\*)|\{/\*|\.test\(|thaiAuthError|technical ='

report() { # ชื่อ, เหตุผล, pattern, [pattern ที่ให้ข้าม]
  local title="$1" why="$2" pattern="$3" skip="${4:-}"
  local hits
  hits="$(grep -rnE "$pattern" "${SRC[@]}" --include="*.jsx" 2>/dev/null | grep -vE "$NOISE" || true)"
  [ -n "$skip" ] && hits="$(printf '%s\n' "$hits" | grep -vE "$skip" || true)"
  if [ -n "$hits" ]; then
    found=1
    echo "▸ $title"
    echo "  $why"
    printf '%s\n' "$hits" | sed 's/^/    /' | cut -c1-160
    echo ""
  fi
}

echo "=== ตรวจ UI: AdFlow OS ==="
echo ""

report "ซากธีมมืด: คลาส theme-dark / theme-light" \
  "แอปใช้ธีมสว่างเดียว คลาสเหล่านี้ไม่มี CSS รองรับแล้ว" \
  'theme-(dark|light)'

report "น้ำเงินซ้ำระบบ: indigo" \
  "indigo เกือบเหมือน brand แต่ไม่เท่ากัน ทำให้เห็นน้ำเงินสองเฉดในหน้าเดียว — ใช้ brand-* แทน" \
  '(bg|text|border|ring|hover:bg|hover:text|focus:ring)-indigo-'

report "accent นอกพาเลตต์" \
  "พาเลตต์มี brand (สิ่งที่กดได้) + ok/warn/danger (สถานะ) เท่านั้น" \
  '(bg|text|border)-(cyan|teal|lime|orange|yellow|pink)-[0-9]' \
  'fuchsia'

report "ปุ่มหลักสีเทาเข้ม (ซากก่อนมี brand)" \
  "ปุ่มหลักต้องเป็น bg-brand-600 ทั้งแอป ผู้ใช้จะได้รู้ว่าอะไรคือปุ่มหลัก" \
  'bg-slate-(800|900|950)\b'

# text-*-300 บนพื้นสว่างคอนทราสต์ไม่ผ่าน — แต่ใช้กับไอคอน/เส้นประเป็นของตกแต่งได้
# จึงข้ามบรรทัดที่มี size={ (ไอคอน) หรือ border-dashed (กรอบ placeholder)
report "ตัวอักษรจางเกินอ่านบนพื้นสว่าง" \
  "text-*-300 บนพื้นขาวคอนทราสต์ไม่ผ่าน (ตัวเลข/ข้อความต้องอ่านออก — ไอคอนตกแต่งข้ามได้)" \
  'text-(slate|brand|emerald|rose|amber|sky|violet)-300\b' \
  'size=\{|border-dashed'

report "ปุ่มสลับธีมที่ถูกถอดออกแล้ว" \
  "ธีมมืดถูกตัดไปแล้ว ปุ่มนี้กดแล้วไม่มีอะไรเกิดขึ้น" \
  '(ThemeToggle|useTheme|applyTheme|storedTheme)'

report "ข้อความ error ดิบภาษาอังกฤษถึงผู้ใช้" \
  "ผู้ใช้เป็นพนักงานไทย ข้อความเทคนิคอังกฤษอ่านแล้วไม่รู้ว่าต้องทำอะไรต่อ" \
  'non-2xx|Invalid login credentials'

if [ "$SHOW_SOFT" -eq 1 ]; then
  # empty state ระดับหน้า/พาเนล (py-6 ขึ้นไป และตัวอักษร text-sm ขึ้นไป) ควรใช้ <EmptyState>
  # ข้ามกรณีที่ข้อความกลางจอเหมาะสมอยู่แล้ว:
  #   - text-xs = ลิสต์ย่อยหรือกราฟเล็กที่ซ้อนในการ์ดใบใหญ่ ไม่ต้องมีไอคอนซ้ำ
  #   - border-dashed = กรอบเส้นประที่สื่อ "ช่องว่าง" ด้วยตัวมันเองแล้ว
  #   - คำใบ้สั้นๆ ใน dropdown (py-1.5/py-2) ไม่เข้าเงื่อนไข py-6 อยู่แล้ว
  loose="$(grep -rnE 'py-(6|8|10|14)[^"]*text-slate-(400|500)|text-slate-(400|500)[^"]*py-(6|8|10|14)' "${SRC[@]}" --include="*.jsx" 2>/dev/null \
    | grep -E '>(ยังไม่|ไม่มี|ไม่พบ)' | grep -vE "$NOISE" | grep -vE 'text-xs|border-dashed' || true)"
  if [ -n "$loose" ]; then
    found=1
    echo "▸ empty state ระดับหน้าที่ยังเป็นประโยคลอย"
    echo "  หน้าว่างที่มีแค่ข้อความกลางจอดูเหมือนหน้าพัง — ใช้ <EmptyState> ที่บอกสาเหตุและทางไปต่อ"
    printf '%s\n' "$loose" | sed 's/^/    /' | cut -c1-160
    echo ""
  fi
fi

if [ "$found" -eq 0 ]; then
  echo "สะอาด — ไม่พบรายการที่ตรวจ"
  exit 0
fi
exit 1
