// service worker — PWA + Web Push
// เวอร์ชันนี้ตั้งใจให้ "เบา" ที่สุด เพราะแอปเป็น SPA ที่พึ่ง realtime/ข้อมูลสด
// จึงใช้กลยุทธ์ network-first สำหรับ navigation (ไม่ค้าง cache เก่า) + cache แค่ shell ขั้นต่ำไว้เปิดตอนออฟไลน์
const CACHE = "aiads-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

// หน้าเว็บสั่งให้ SW ตัวใหม่ทำงานทันที (ตอนกด "อัปเดตเลย") — ไม่ต้องรอปิดทุกแท็บก่อน
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));   // ลบ cache เก่า
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // แตะเฉพาะไฟล์ของเราเอง ไม่ยุ่ง Supabase/Meta

  // หน้าเว็บ (navigation): เอาสดก่อนเสมอ ออฟไลน์ค่อย fallback shell — กันแอปค้างเวอร์ชันเก่า
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }
  // ไฟล์ static: cache-first (asset มี hash ในชื่ออยู่แล้ว เปลี่ยนเวอร์ชัน = ชื่อเปลี่ยน)
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname))) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => caches.match("/"))));
});

// ---- Web Push: ปลุก SW เมื่อมีแชทค้าง แม้ปิดแท็บแอปไปแล้ว ----
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : "" }; }
  const title = data.title || "🔴 มีแชทค้างอ่าน";
  const opts = {
    body: data.body || "มีลูกค้ารอตอบ",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "overdue-chat",     // tag เดิม = แทนที่ ไม่กองซ้อน
    renotify: true,
    // ข้อความใหม่ (เหมือน Messenger) ให้เด้งแล้วหายเองได้ ; แชทค้างให้ค้างจนกดปิด
    requireInteraction: data.requireInteraction !== false && !(data.tag && String(data.tag).startsWith("newmsg-")),
    data: { url: data.url || "/?tab=inbox" },
  };
  // ตั้งจุดแดงบนไอคอนแอป (Badging API) — เด้งบนหน้าจอโฮม/Dock แม้ปิดแอป (iOS 16.4+ PWA, macOS)
  const badge = Number(data.badge);
  e.waitUntil((async () => {
    await self.registration.showNotification(title, opts);
    try {
      if (self.navigator && "setAppBadge" in self.navigator) {
        if (badge > 0) await self.navigator.setAppBadge(badge);
        else if (Number.isFinite(badge)) await self.navigator.clearAppBadge();
        else await self.navigator.setAppBadge();   // ไม่รู้จำนวน → โชว์จุดเฉยๆ
      }
    } catch { /* บางเบราว์เซอร์ไม่รองรับ */ }
  })());
});

// กดที่แจ้งเตือน → เปิด/โฟกัสแท็บแอป แล้วไปหน้าที่กำหนด
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/?tab=inbox";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { c.navigate(target).catch(() => {}); return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
