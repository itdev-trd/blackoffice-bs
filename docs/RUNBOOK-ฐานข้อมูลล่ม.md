# คู่มือ: เว็บช้า / ฐานข้อมูลล่ม

ฐานข้อมูล Supabase โปรเจกต์ `Blackoffice-bs` (`nmetbatfjiagpjbbmowp`) เป็นเครื่อง **MICRO** (RAM 1 GB, connection สูงสุด 60)
งานพร้อมกันเยอะเกินไปเมื่อไหร่ ทั้งเว็บจะช้าหรือค้างพร้อมกัน

## อาการ

| เห็นอะไร | แปลว่า |
|---|---|
| หน้าเว็บขาวขึ้น `504 MIDDLEWARE_INVOCATION_TIMEOUT` | ฐานข้อมูลช้ามาก (ตั้งแต่ 8 ต.ค. 69 middleware ไม่รอเกิน 2.5 วิแล้ว ควรเจอน้อยลง) |
| "โหลดแชทไม่สำเร็จ: AbortError" | ฐานข้อมูลตอบไม่ทันใน 12 วิ |
| เปิดแชทช้า กดอะไรก็หมุนนาน | ฐานข้อมูลเริ่มแน่น |
| อีเมลจาก GitHub ว่า workflow **db-watchdog** ล้ม (สีแดง) | ฐานข้อมูลไม่ตอบติดกัน ~3 นาที (เช็คจากข้างนอกทุก 5 นาที) |

## ขั้นตอนกู้ (ทำตามลำดับ)

### 1. ยืนยันว่าล่มจริง (1 นาที)
- เปิด https://supabase.com/dashboard/project/nmetbatfjiagpjbbmowp
- หน้าแรกขึ้นสถานะไม่ปกติ หรือเมนู SQL Editor รัน `select 1` แล้วค้าง/หมดเวลา = ล่มจริง
- ถ้า `select 1` ผ่านเร็ว แต่เว็บยังช้า → ไปข้อ 4

### 2. Restart project (แก้ได้เกือบทุกครั้ง)
- Settings → **General** → Project availability → กดปุ่ม **Restart project** (ปุ่มหลัก ไม่ใช่ Fast database reboot)
- รอ 5–25 นาที (8 ต.ค. 69 ใช้ราว 25 นาที) ระหว่างนี้เว็บใช้ไม่ได้ เป็นเรื่องปกติ
- กลับมาแล้วให้แอดมินทุกคน **รีเฟรชหน้าเว็บ / ปิดเปิดแอปใหม่**

### 3. ถ้า Restart แล้วยังไม่ขึ้นเกิน 30 นาที
- Settings → **Infrastructure** → ดู **Disk**: ถ้าใกล้เต็ม (เช่น 1.9/2 GB) กดขยายดิสก์
- ยังไม่ได้ → ติดต่อ Supabase Support (แพ็กเกจ Pro มีสิทธิ์) แนบ project ref `nmetbatfjiagpjbbmowp` และช่วงเวลาที่ล่ม

### 4. หลังกลับมา: หาสาเหตุ (ให้คนดูแลระบบ/AI ทำ)
รันใน SQL Editor:

```sql
-- connection ใช้อยู่เท่าไหร่ (เกิน ~50 จาก 60 = อันตราย)
select count(*), count(*) filter (where state = 'active') active from pg_stat_activity;

-- งานที่ค้างนานสุด
select pid, usename, state, now() - query_start as running, left(query, 120)
from pg_stat_activity where state <> 'idle' order by query_start limit 20;

-- Realtime ค้างไหม (lag ควรเป็นหลัก KB)
select slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) lag
from pg_replication_slots;
```

และดูความเร็วย้อนหลังใน Logs Explorer (edge_logs → `response.origin_time` ของ `/rest/v1/chat_customers`)
ปกติเฉลี่ย ~0.1–0.2 วิ

## สิ่งที่ห้ามทำ (เคยทำให้ล่มมาแล้ว)
- ห้ามสร้าง index หรือ trigger ที่ประมวลผล `chat_customers.transcript` ทั้งก้อนทุกครั้งที่แชทอัปเดต (7 ต.ค. 69)
- ห้ามเอา `chat_customers` กลับเข้า Realtime publication — ใช้ตาราง `chat_live` แทน (8 ต.ค. 69)
- ห้ามรันคำสั่งสแกนข้อมูลหนัก ๆ ซ้ำ ๆ บนระบบจริงตอนกลางวัน
- ก่อนเพิ่ม polling/realtime ในหน้าเว็บ ให้คูณจำนวนเครื่องแอดมินที่เปิดพร้อมกันเสมอ

## ทางแก้ถาวร
อัปเกรดเครื่อง: Settings → **Infrastructure** → Compute size → **SMALL** (2 GB) หรือสูงกว่า
(มีค่าใช้จ่ายเพิ่มรายชั่วโมง · ระหว่างอัปเกรดฐานข้อมูลดับ ~2 นาที)
