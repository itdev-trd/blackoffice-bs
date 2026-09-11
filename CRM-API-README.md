# CRM API — แชร์ข้อมูลให้โปรเจกต์อื่นดึงไป

API อ่านข้อมูลอย่างเดียวสำหรับโปรเจกต์ภายนอก เรียกผ่าน `Authorization: Bearer <api key>` — ไม่ใช่ JWT ของคน (`verify_jwt = false` ใน `supabase/config.toml`, ตรวจ key เองในโค้ด)

> **หมายเหตุประวัติ:** ตารางคีย์ (`api_clients`) กับช่องข้อมูลลูกค้าแชท (`crm_customers_page`, `crm_deleted_customers_page`, `crm_rate_limit_hit`, `api_rate_limits`) ถูก deploy ไว้ก่อนไฟล์นี้จะเข้า repo — มาจากอีก session หนึ่งที่ทำเรื่องเดียวกันตรงไปที่ฐานข้อมูล/edge function โดยไม่ได้เก็บ migration ไว้ในนี้ ไฟล์ `20260911090000_crm_api_tradingview.sql` ในนี้จึง "ต่อ" จากของเดิม ไม่ได้สร้างมันขึ้นมาใหม่

**มีสองช่อง แยก scope กันเด็ดขาด — คีย์ที่ให้ scope เดียวจะเรียกอีกช่องไม่ได้ (403)**

| ช่อง | scope ที่ต้องมี | ได้อะไร |
|---|---|---|
| `/tradingview`, `/tradingview/deleted` | `tradingview:read` | สิทธิ์อินดี้ TradingView — username, trade ID, อินดี้, lot, สถานะ, วันหมดอายุ **ไม่มีข้อมูลแชทเลย** |
| `/` (ค่าเริ่มต้น), `/deleted` | `customers:read` | ลูกค้าจากแชท — ชื่อ เบอร์ อีเมล ระยะ ที่มาจากแอด |
| `?include=transcript` | เพิ่ม `customers:transcript` | บทสนทนาเต็มของลูกค้า |

**server-to-server เท่านั้น** — ไม่มี CORS header เลย ตั้งใจ ใครเอาคีย์ไปใส่หน้าเว็บ/แอปมือถือจะโดนเบราว์เซอร์บล็อกเองก่อนถึงคีย์จริงด้วยซ้ำ

---

## Endpoint

```
BASE = https://nmetbatfjiagpjbbmowp.supabase.co/functions/v1/crm-customers
Authorization: Bearer <api key>
```

| path | ได้ |
|---|---|
| `GET {BASE}/tradingview` | สิทธิ์อินดี้ TradingView ทั้งหมด (คนหนึ่งมีได้หลายแถว = หลายอินดี้) |
| `GET {BASE}/tradingview/deleted` | สิทธิ์ที่ถูกลบไปแล้ว (tombstone) |
| `GET {BASE}` | ลูกค้าจากแชท |
| `GET {BASE}/deleted` | ลูกค้าที่ถูกลบไปแล้ว |

**พารามิเตอร์ร่วมทุกช่อง**

| | |
|---|---|
| `since` | เอาแถวที่เปลี่ยนตั้งแต่เวลานี้ (ISO 8601) — ใช้ตอนเริ่ม sync รอบใหม่ |
| `cursor` | หน้าถัดไป ใส่ค่า `next_cursor` จากรอบก่อนตรง ๆ (ห้ามแกะ/ประกอบเอง) — อย่าส่ง `since` มาพร้อมกัน |
| `limit` | 1–1000 ค่าเริ่มต้น 200 |
| `id` | ดึงรายการเดียวตาม id (ไม่มี pagination envelope) |

**ฟิลเตอร์เฉพาะ `/tradingview`:** `username`, `trade_id`, `pine_id`, `brand_id`, `status`
**ฟิลเตอร์เฉพาะช่องแชท:** `page_id`, `stage`, `include=transcript`

**คำตอบ**

```json
{
  "ok": true,
  "resource": "tradingview",
  "data": [ { "id": 1, "username": "sunboy220150", "...": "..." } ],
  "count": 200,
  "has_more": true,
  "next_cursor": "eyJhdCI6...",
  "next_since": null,
  "server_time": "2026-09-11T03:17:03.833Z"
}
```

**ผิดพลาด** — `{ "ok": false, "error": "...", "code": "..." }`

| สถานะ | เมื่อไหร่ |
|---|---|
| 401 | ไม่ส่งคีย์ / คีย์ผิด / คีย์ถูกถอนสิทธิ์ |
| 403 | คีย์ไม่มี scope ของช่องที่เรียก |
| 404 | path ไม่ใช่ช่องที่มีอยู่ |
| 429 | ยิงถี่เกิน (120 คำขอ/นาที/คีย์) — ดู header `retry-after` |
| 503 | ตรวจสอบคีย์/rate limit ไม่ได้ ปฏิเสธไว้ก่อน (fail closed) |

---

## ฟิลด์ที่ได้ — `/tradingview`

หนึ่งแถว = ลูกค้าหนึ่งคนต่ออินดี้หนึ่งตัว (ปัจจุบัน 757 แถว)

- **ตัวตน** — `id` (primary key ใช้ผูกกับฝั่งที่ดึงไป), `username` (TradingView), `display_name`, `email`, `trade_id`
- **อินดี้** — `pine_id`, `indicator_name`, `script_key`, `brand_id`, `brand_name`
- **สิทธิ์** — `status`, `lot`, `membership_type`, `member_type`, `channel`, `contact_channel`
- **วันเวลา** — `granted_at`, `last_granted_at`, `tv_granted_at`, `expiration`, `tv_expiration`, `tv_access_verified`, `tv_verified_at`, `created_at`, `updated_at`

`expiration` = วันหมดอายุที่ระบบนี้ถือไว้ · `tv_expiration` = ที่อ่านกลับจาก TradingView จริง **สองค่านี้ต่างกันได้** = ยังไม่ซิงก์ ฝั่งที่ดึงไปควรโชว์ `expiration` เป็นหลัก

**ที่ตั้งใจไม่ปล่อยออก** — `granted_by`/`edited_by` (อีเมลพนักงานที่ให้สิทธิ์ เป็น PII ของทีมเรา ไม่ใช่ของลูกค้า), `last_error`/`tv_verify_error` (debug ภายใน), `previous_expiration`/`new_expiration` (ค่าชั่วคราวตอนต่ออายุ), `last_synced_at`

คอลัมน์ที่ปล่อยออกล็อกไว้ที่ `RETURNS TABLE` ของ `crm_tradingview_page()` ใน [20260911090000_crm_api_tradingview.sql](supabase/migrations/20260911090000_crm_api_tradingview.sql) ที่เดียว — เพิ่มคอลัมน์ใน `tv_access` เฉย ๆ ไม่รั่วออก API

---

## วิธี sync ที่ถูกต้อง

```
รอบ 1 — ของที่เปลี่ยน
  GET {BASE}/tradingview?since=<last_synced_at>&limit=500
  upsert ทุกแถวด้วย id
  ยัง has_more อยู่ → GET {BASE}/tradingview?cursor=<next_cursor>&limit=500  (ห้ามส่ง since ด้วย)
  จน has_more = false → เก็บ next_since ไว้เป็น last_synced_at ของรอบหน้า

รอบ 2 — ของที่ถูกลบ (ต้องทำ ไม่งั้นสิทธิ์ที่ถูกลบจะค้างเป็นผีฝั่งที่ดึงไปตลอด)
  GET {BASE}/tradingview/deleted?since=<last_deleted_sync_at>&limit=500
  ลบ id เหล่านั้นออก
  วนด้วย cursor เหมือนกัน แล้วเก็บ next_since
```

ครั้งแรกไม่ต้องส่ง `since` เลย จะได้ทั้งฐานเรียงตาม `updated_at` แล้วไล่ `cursor` จนหมด

---

## ออกคีย์ใหม่ (ทำผ่าน SQL Editor ของ Supabase)

```sql
-- 1) คิดคีย์ขึ้นมาเอง (ตัวอย่างรูปแบบ) แล้ว sha256 มันในเครื่องตัวเอง — เก็บแค่ hash ลง DB
--    เช่น: python3 -c "import secrets,hashlib; k='crm_'+secrets.token_urlsafe(32); print(k); print(hashlib.sha256(k.encode()).hexdigest())"

insert into public.api_clients (name, key_hash, scopes)
values ('<ชื่อผู้เรียก>', '<sha256 hex ของคีย์>', '{tradingview:read}');
```

คีย์ตัวจริงไม่ถูกเก็บลง DB เลย — เห็นได้ครั้งเดียวตอนสร้าง ฐานข้อมูลรั่วก็ยังใช้คีย์ต่อไม่ได้

**ถอนสิทธิ์:**
```sql
update public.api_clients set revoked_at = now() where name = '<ชื่อผู้เรียก>';
```

**คีย์ที่มีอยู่ตอนนี้** (ดูใน `api_clients`, ไม่มีคีย์ตัวจริงเก็บไว้ที่ไหนเลย ต้องไปหาในที่ที่เคยส่งให้ผู้รับ):
- `besight-crm` — scopes ว่าง `{}` (เรียกอะไรไม่ได้จนกว่าจะเติม scope ให้)
- `tradingview-share` — `{tradingview:read}` (สร้างไว้ให้ทดสอบ/แชร์ TradingView โดยเฉพาะ)

---

## ข้อควรรู้

**อ่านอย่างเดียว** — ยังไม่มีทางเขียนกลับ (ต่ออายุ/แก้สถานะ) ต้องทำ endpoint แยกถ้าต้องการ

**ข้อมูลอ่อนไหว** — `/tradingview` มีอีเมลกับ trade ID ของลูกค้า · ผู้รับคีย์มีภาระดูแลข้อมูลนี้เช่นเดียวกับต้นทาง

**`tv_scripts`/`tv_brands` join แบบ LEFT JOIN** — ถ้าลบสคริปต์/แบรนด์แล้วยังไม่ลบ `tv_access` ที่อ้างถึง `indicator_name`/`brand_name` จะเป็น `null` ไม่ error

**tombstone ไม่มีวันหมดอายุ** — `crm_deleted_tv_access` โตขึ้นเรื่อย ๆ ถ้าจะตัดของเก่าทิ้งวันไหน ต้องมั่นใจว่าผู้รับ sync ผ่านช่วงนั้นไปแล้ว ไม่งั้นผีจะกลับมา
