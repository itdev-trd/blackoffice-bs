# วิธีเปิดใช้งาน Meta Marketing API สำหรับระบบยิงโฆษณาอัตโนมัติ

ต้องทำก่อนใช้งานจริง เพราะ Facebook ต้องตรวจสอบแอปก่อนอนุญาตให้สร้าง/แก้แคมเปญผ่าน API ได้ (ใช้เวลารอตรวจหลายวัน แนะนำเริ่มขั้นตอนนี้ตั้งแต่วันแรก)

## 1. สร้าง Facebook App
1. ไปที่ https://developers.facebook.com/apps → **Create App**
2. เลือกประเภท **Business**
3. ตั้งชื่อแอป (เช่น "AI Ads Automation") → Create App

## 2. เพิ่ม Marketing API product
1. ในหน้าแอป → **Add Product** → หา **Marketing API** → **Set Up**

## 3. ยื่น App Review สำหรับ permission `ads_management`
1. เมนูซ้าย **App Review → Permissions and Features**
2. ค้นหา `ads_management` → กด **Request**
3. กรอกรายละเอียดการใช้งาน (ใช้ภายในองค์กรเพื่อจัดการแคมเปญโฆษณาของธุรกิจตัวเอง) พร้อมแนบวิดีโอ screen-record สาธิตการใช้งานตามที่ Facebook กำหนด
4. ส่งตรวจ แล้วรอผล (ปกติ 2-7 วัน) — ถ้าแอปยังอยู่ในโหมด **Development** และ ad account ที่ใช้เป็นของคุณเอง (คุณเป็น admin/owner) มักทดสอบได้เลยโดยไม่ต้องรอผ่าน Review แต่ก่อนใช้งานจริงกับ ad account อื่นหรือ scale ใหญ่ ควรผ่าน Review ให้เรียบร้อย

## 4. สร้าง System User (แนะนำแทนการใช้ token ส่วนตัว เพราะไม่หมดอายุง่ายและตัดขาดจากบัญชีคนใดคนหนึ่ง)
1. ไปที่ **Business Settings** (business.facebook.com/settings) → เลือกธุรกิจของคุณ
2. เมนูซ้าย **Users → System Users** → **Add**
3. ตั้งชื่อ (เช่น "AI Ads Bot") → เลือกบทบาท **Admin** → Create System User
4. กด **Add Assets** → เลือก **Ad Accounts** → เลือก ad account ที่จะใช้ → ให้สิทธิ์ **Manage campaigns**
5. กด **Generate New Token** → เลือกแอปที่สร้างไว้ในขั้นตอนที่ 1 → ติ๊ก permission `ads_management`, `ads_read`, `business_management` → **Generate Token**
6. **คัดลอก token นี้เก็บไว้ทันที** (จะไม่แสดงซ้ำอีก) → นำไปตั้งเป็น secret `META_ACCESS_TOKEN` ตามที่บอกไว้ใน `DEPLOY-README.md`

## 5. หาค่า ID ที่ต้องใช้
1. **Ad Account ID**: ไปที่ https://business.facebook.com/adsmanager → มุมบนซ้ายจะเห็นเลข Account ID (ตัวเลขล้วน ไม่ต้องมี `act_` นำหน้าตอนกรอกในแอป)
2. **Page ID**: ไปที่เพจ Facebook ของธุรกิจ → **Settings → About** เลื่อนหา Page ID หรือดูจาก URL `facebook.com/profile.php?id=XXXXXXXXX`
3. **Pixel ID** (ถ้ายิง conversion เข้าเว็บ): **Events Manager** → เลือก Pixel → คัดลอก ID ที่แสดงด้านบน

## 6. สร้าง Custom Audience / Lookalike Audience
1. ไปที่ **Ads Manager → Audiences → Create Audience**
2. **Custom Audience**: อัปโหลดลิสต์ลูกค้าที่ยินยอมให้ใช้ข้อมูล (เช่น export จาก CRM n8n ที่มีอยู่แล้ว) หรือเชื่อมจาก Pixel/Page engagement
3. **Lookalike Audience**: เลือก Custom Audience ที่ quality ดี (เช่น ลูกค้าที่ OpenAI classify ว่า quality สูง) เป็น source → เลือกประเทศไทย → เลือกขนาด 1-3%
4. คัดลอก Audience ID (คลิกเข้าไปดูรายละเอียด audience จะเห็น ID ใน URL) → นำไปกรอกในแท็บ "ตั้งค่า" ของเว็บแอป

## 7. ทดสอบ
1. ในเว็บแอป ไปที่แท็บ "ตั้งค่า" กรอก Ad Account ID, Page ID, Pixel ID, Audience ID, Landing URL ให้ครบ
2. ไปแท็บ "สร้างคอนเทนต์" → สร้างคอนเทนต์ 1 ก้อน → ไปแท็บ "รออนุมัติ" → กด "อนุมัติ & ลอนช์"
3. เช็คใน **Ads Manager** ว่ามี Campaign ใหม่ขึ้นสถานะ ACTIVE พร้อม budget ที่ตั้งไว้จริง

## ข้อควรระวังเรื่อง policy
โฆษณาสายการเงิน/การลงทุน/forex เข้าข่าย **Special Ad Category** บางกรณี และมีนโยบายเข้มงวดเรื่องคำโฆษณา (ห้ามการันตีผลตอบแทน, ห้ามอ้างกำไรที่ไม่สมจริง) — ระบบ AI ที่เขียน copy ให้ถูกกำกับด้วย system prompt ที่ห้ามอ้างการันตีกำไรไว้แล้ว แต่ควรอ่านทุกชิ้นก่อนอนุมัติจริง เพราะ Facebook อาจระงับ ad account ได้ถ้าละเมิดซ้ำๆ
