// service worker — PWA + Web Push
// เวอร์ชันนี้ตั้งใจให้ "เบา" ที่สุด เพราะแอปเป็น SPA ที่พึ่ง realtime/ข้อมูลสด
// จึงใช้กลยุทธ์ network-first สำหรับ navigation (ไม่ค้าง cache เก่า) + cache แค่ shell ขั้นต่ำไว้เปิดตอนออฟไลน์
const CACHE = "aiads-shell-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

// ---- เก็บ config (supabase url/anon key/vapid) ลง IndexedDB เพื่อให้ SW ต่ออายุ push ได้แม้แอปปิด ----
// pushsubscriptionchange ทำงานตอนแอปไม่เปิด → ต้องมีค่าพวกนี้ค้างไว้ ไม่งั้นต่ออายุ subscription ไม่ได้
function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("aiads-push", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("cfg");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  await new Promise((res, rej) => { const tx = db.transaction("cfg", "readwrite"); tx.objectStore("cfg").put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function idbGet(key) {
  const db = await idbOpen();
  return await new Promise((res, rej) => { const tx = db.transaction("cfg", "readonly"); const g = tx.objectStore("cfg").get(key); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); });
}
function b64ToUint8(b64) {
  const s = String(b64 || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.padEnd(s.length + (4 - (s.length % 4)) % 4, "=");
  const raw = atob(pad);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// หน้าเว็บสั่งให้ SW ตัวใหม่ทำงานทันที (ตอนกด "อัปเดตเลย") — ไม่ต้องรอปิดทุกแท็บก่อน
// + รับ config สำหรับต่ออายุ push (type:"push-config")
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") { self.skipWaiting(); return; }
  if (e.data && e.data.type === "push-config") {
    e.waitUntil(idbSet("push", { url: e.data.url, anonKey: e.data.anonKey, vapidKey: e.data.vapidKey }).catch(() => {}));
  }
});

// ---- ต่ออายุ push subscription อัตโนมัติเมื่อระบบหมุน/ยกเลิก (เกิดตอนแอปปิดได้) ----
// นี่คือหัวใจที่ทำให้แจ้งเตือน "ไม่หยุดหลังปิดแอปไปสักพัก" — เดิมไม่มี handler นี้ subscription เลยตายเงียบ
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    try {
      const cfg = await idbGet("push");
      if (!cfg || !cfg.url || !cfg.anonKey) return;
      const oldEndpoint = (e.oldSubscription && e.oldSubscription.endpoint) || null;
      // ใช้ applicationServerKey เดิมถ้ามี ไม่งั้นใช้ vapid key ที่เก็บไว้
      const appKey = (e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey) || (cfg.vapidKey ? b64ToUint8(cfg.vapidKey) : null);
      if (!appKey) return;
      const newSub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      await fetch(`${cfg.url}/functions/v1/send-push`, {
        method: "POST",
        headers: { "content-type": "application/json", "apikey": cfg.anonKey, "Authorization": `Bearer ${cfg.anonKey}` },
        body: JSON.stringify({ action: "resubscribe", old_endpoint: oldEndpoint, subscription: newSub.toJSON() }),
      });
    } catch (_e) { /* ต่อไม่ได้รอบนี้ก็ไปต่อตอนเปิดแอปครั้งหน้า */ }
  })());
});

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
  // ไฟล์ static (asset มี hash ในชื่อ): cache-first แล้วค่อย network
  // สำคัญ: ถ้าโหลดไม่ได้ "ห้าม" fallback เป็น index.html เด็ดขาด — เพราะจะได้ HTML มาเป็น CSS/JS
  // (MIME ผิด) เบราว์เซอร์จะทิ้ง stylesheet ทั้งหน้าเลยไม่มีสไตล์ ปล่อยให้ fetch พังตามจริงดีกว่า
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && url.pathname.startsWith("/assets/")) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  })));
});

// ---- Web Push: ปลุก SW เมื่อมีแชทค้าง แม้ปิดแท็บแอปไปแล้ว ----
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : "" }; }
  // สถานะเงียบ: มีคนอ่าน/ตอบจากอีกเครื่องแล้ว ล้าง notification เดิมและปรับ badge โดยไม่เด้งข้อความใหม่
  if (data.action === "sync_state") {
    e.waitUntil((async () => {
      const notifications = await self.registration.getNotifications();
      const chatTag = data.conversation_id ? `newmsg-${data.conversation_id}` : "";
      for (const notification of notifications) {
        if ((chatTag && notification.tag === chatTag) || (Number(data.badge) === 0 && notification.tag === "overdue-chat")) notification.close();
      }
      try {
        if (self.navigator && "setAppBadge" in self.navigator) {
          if (Number(data.badge) > 0) await self.navigator.setAppBadge(Number(data.badge));
          else await self.navigator.clearAppBadge();
        }
      } catch { /* ไม่รองรับ */ }
    })());
    return;
  }
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
