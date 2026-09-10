// ลงทะเบียน service worker (/sw.js) และรอให้มันพร้อมใช้
//
// ทำไมต้องมีไฟล์นี้: ก่อนหน้านี้ทั้งแอปไม่มีที่ไหนเรียก navigator.serviceWorker.register เลย
// ไฟล์ public/sw.js มีอยู่ครบ (push, notificationclick, ต่ออายุ subscription) แต่ไม่มีใครติดตั้งมันเลย
// ผลคือ:
//   - navigator.serviceWorker.ready ไม่ resolve ตลอดกาล (มันรอ registration ที่ active
//     ซึ่งไม่มีวันมี) ปุ่ม "เปิดแจ้งเตือน" จึงค้างเงียบ ๆ ไม่ error ไม่สำเร็จ
//   - ตาราง push_subscriptions ว่างเปล่า = ไม่มีใครเคยสมัครสำเร็จ แจ้งเตือนบนมือถือจึงไม่เคยมา
//   - UpdateBanner กด "อัปเดตเลย" ก็ล้าง cache ของ SW ไม่ได้ เพราะไม่มี SW

export const SW_PATH = "/sw.js";

const supported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator;

// เรียกซ้ำได้ — register ด้วย url/scope เดิมจะคืน registration ที่มีอยู่ ไม่ติดตั้งใหม่
export async function registerServiceWorker() {
  if (!supported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  } catch (e) {
    console.warn("service worker register failed", e);
    return null;
  }
}

// รอ SW พร้อมแบบมีเพดานเวลา
//
// navigator.serviceWorker.ready ไม่เคย reject — ติดตั้งไม่ได้ก็ค้างรอเฉย ๆ
// ซึ่งเป็นสาเหตุที่บั๊กนี้ซ่อนอยู่ได้นาน (ปุ่มหมุนแล้วไม่มีอะไรเกิดขึ้น ไม่มีข้อความบอก)
// จึงจับเวลาไว้ ให้ผู้ใช้เห็นสาเหตุจริงแทนที่จะรอเฉย ๆ
export async function serviceWorkerReady(timeoutMs = 15000) {
  if (!supported()) throw new Error("เบราว์เซอร์นี้ไม่รองรับ Service Worker");
  await registerServiceWorker();
  let timer;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_res, rej) => {
        timer = setTimeout(
          () => rej(new Error("ติดตั้ง service worker ไม่สำเร็จ (/sw.js โหลดไม่ได้หรือถูกบล็อก) — ลองรีเฟรชหน้านี้อีกครั้ง")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
