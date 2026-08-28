// cache รายงาน/มุมมองของหน้า "ฐานข้อมูลลูกค้า" — เก็บเฉพาะระหว่าง session, ต้องล้างตอนออกจากระบบ
// อยู่แยกเป็นโมดูลเล็กๆ (ไม่ผูกกับ CustomerDatabaseTab.jsx ทั้งไฟล์) เพื่อให้โค้ด logout ที่อยู่ใน
// shared dashboard nav ไม่ต้อง import ฟีเจอร์ customerdb ทั้งก้อนเข้าไปในทุกหน้า
export const customerDatabaseReportCache = new Map();

let customerDatabaseViewCache = null;

export function getCustomerDatabaseViewCache() {
  return customerDatabaseViewCache;
}

export function setCustomerDatabaseViewCache(next) {
  customerDatabaseViewCache = next;
}

export function clearCustomerDatabaseCaches() {
  customerDatabaseReportCache.clear();
  customerDatabaseViewCache = null;
}
