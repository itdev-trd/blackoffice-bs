# Sticker transparent background fix v2

สาเหตุที่แท้จริง: ตอนแก้สติกเกอร์ซ้ำ ระบบถูกเปลี่ยนให้ URL จาก webhook (`payload.url`) ชนะ URL จาก Conversations API ทุกกรณี แต่ URL webhook ของสติกเกอร์บางชุดเป็นภาพ preview พื้นขาว ขณะที่ `messages.sticker` จาก Conversations API เป็นไฟล์โปร่งใส

การแก้ไข:
- ยังรวมข้อความซ้ำด้วย `mid` เหมือนเดิม จึงไม่กลับมาเบิ้ล
- ถ้าเป็นสติกเกอร์ ให้ URL จาก `sync-conversations` / `m.sticker` ชนะ
- ถ้าเป็นรูปหรือวิดีโอทั่วไป ให้ URL จาก webhook ชนะเหมือนเดิม
- ป้องกัน webhook echo เขียนทับ URL สติกเกอร์ที่ sync บันทึกไว้
- หน้าเว็บเลือกข้อมูลฝั่ง sync เมื่อพบสติกเกอร์ `mid` เดียวกัน

ต้อง deploy ใหม่:
1. `meta-webhook`
2. `sync-conversations`
3. หน้าเว็บ

หลัง deploy ให้กดซิงก์บทสนทนาอีกครั้ง เพื่อให้รายการสติกเกอร์เดิมถูกแทนด้วย URL โปร่งใสจาก Conversations API
