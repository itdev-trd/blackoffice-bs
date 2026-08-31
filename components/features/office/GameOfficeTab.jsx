"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Gamepad2 } from "lucide-react";

let _pixiLoad = null;
function loadPixi() {
  if (window.PIXI) return Promise.resolve(window.PIXI);
  if (_pixiLoad) return _pixiLoad;
  _pixiLoad = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.4.2/pixi.min.js";
    s.onload = () => resolve(window.PIXI);
    s.onerror = () => reject(new Error("โหลด PixiJS ไม่สำเร็จ"));
    document.head.appendChild(s);
  });
  return _pixiLoad;
}
// สีตามช่องทาง (ตามสเปก): ออร์แกนิค เขียว / แอด ฟ้า / VIP เหลือง / Lost ดำ
const srcColor = (c) => {
  const stage = String(c.stage || "");
  if (stage === "disqualified") return 0x475569;         // Lost = เทาเข้ม
  if (stage === "converted") return 0xf59e0b;            // ปิดได้/VIP = เหลือง
  if (c.entry_ad_id || c.source === "ad") return 0x3b82f6; // Ads = ฟ้า
  return 0x22c55e;                                        // Organic = เขียว
};
const STAGE_TH = { new: "มาใหม่", qualified: "สนใจ", converted: "ปิดได้", disqualified: "หลุด" };
// วาด "คนพิกเซล" ด้วยโค้ด (sprite ตัวเล็กมองมุมบน) — ตัว/เสื้อสีตามช่องทาง
function drawPixelPerson(g, shirt, hair = 0x2a1f16) {
  g.clear();
  g.beginFill(0x000000, 0.22).drawEllipse(0, 15, 9, 3.5).endFill();       // เงาใต้เท้า
  g.beginFill(0x1f2937).drawRect(-4, 7, 3, 7).drawRect(1, 7, 3, 7).endFill();  // ขา (กางเกงเข้ม)
  g.beginFill(shirt).drawRoundedRect(-6, -3, 12, 12, 3).endFill();        // ลำตัว (เสื้อ)
  g.beginFill(shirt).drawRect(-8, -1, 3, 8).drawRect(5, -1, 3, 8).endFill(); // แขน
  g.beginFill(0xf3c19b).drawCircle(0, -9, 5).endFill();                   // หัว (ผิว)
  g.beginFill(hair).drawRoundedRect(-5, -15, 10, 6, 2).endFill();         // ผม
}
// วาดโต๊ะทำงาน + จอเรืองแสง + เก้าอี้ (pseudo-3D)
function drawDesk(g, x, y, screen = 0x22d3ee) {
  g.beginFill(0x000000, 0.25).drawEllipse(x + 22, y + 34, 30, 8).endFill();     // เงาโต๊ะ
  g.beginFill(0x3b2f24).drawRoundedRect(x, y + 14, 46, 16, 3).endFill();        // โต๊ะไม้ (หน้า)
  g.beginFill(0x5a4632).drawRoundedRect(x, y + 10, 46, 8, 3).endFill();         // ผิวโต๊ะบน
  g.beginFill(0x0f172a).drawRoundedRect(x + 12, y - 6, 22, 15, 2).endFill();    // จอ (กรอบ)
  g.beginFill(screen, 0.9).drawRoundedRect(x + 14, y - 4, 18, 11, 1).endFill(); // หน้าจอเรืองแสง
  g.beginFill(0x1e293b).drawRoundedRect(x + 8, y + 6, 30, 4, 1).endFill();      // คีย์บอร์ด
  g.beginFill(0x334155).drawRoundedRect(x + 16, y + 30, 14, 12, 3).endFill();   // เก้าอี้
}
function drawPlant(g, x, y) {
  g.beginFill(0x000000, 0.2).drawEllipse(x, y + 12, 8, 3).endFill();
  g.beginFill(0x7c4a2d).drawRoundedRect(x - 5, y + 2, 10, 10, 2).endFill();     // กระถาง
  g.beginFill(0x22c55e).drawCircle(x, y - 4, 8).endFill();                      // ใบ
  g.beginFill(0x16a34a).drawCircle(x - 4, y, 5).drawCircle(x + 4, y, 5).endFill();
}

export default function GameOfficeTab({ allowedPages = null, onOpenChat }) {
  const hostRef = useRef(null);
  const appRef = useRef(null);
  const spritesRef = useRef(new Map());   // id -> { cont, data, tx, ty }
  const custRef = useRef([]);
  const openRef = useRef(onOpenChat);
  openRef.current = onOpenChat;
  const [err, setErr] = useState("");
  const [pages, setPages] = useState([]);
  const [scopePages, setScopePages] = useState(null);   // null = ยังไม่โหลด/ทุกเพจ ; array = เพจที่เลือกในหน้าตอบแชท
  const [scopeLabel, setScopeLabel] = useState("");
  const [count, setCount] = useState({ waiting: 0, active: 0, total: 0, overQ: 0, overD: 0 });
  const scopeRef = useRef(null);
  scopeRef.current = scopePages;
  const scopeReadyRef = useRef(false);
  const bgUrlRef = useRef("");   // ลิงก์ภาพฉากหลัง (ผู้ใช้ตั้งได้จากตั้งค่า) — ว่าง = วาดฉากด้วยโค้ด
  const spCfgRef = useRef(null);  // ตั้งค่า sprite sheet ตัวละคร (ว่าง = ใช้คนวาดโค้ด)

  // โซนออฟฟิศ (top-down) — x,y,w,h,label,color
  const ZONES = [
    { key: "reception", label: "Reception", x: 20, y: 20, w: 200, h: 90, c: 0x1e293b },
    { key: "organic", label: "Organic เข้า", x: 20, y: 130, w: 200, h: 90, c: 0x14532d },
    { key: "ads", label: "Ads Dept", x: 20, y: 240, w: 200, h: 110, c: 0x1e3a8a },
    { key: "queue", label: "คิวรอ (Waiting)", x: 240, y: 20, w: 430, h: 150, c: 0x312e81 },
    { key: "desk1", label: "Admin A", x: 240, y: 190, w: 200, h: 120, c: 0x334155 },
    { key: "desk2", label: "Admin B", x: 460, y: 190, w: 200, h: 120, c: 0x334155 },
    { key: "account", label: "เปิดบัญชี", x: 690, y: 20, w: 220, h: 150, c: 0x422006 },
    { key: "done", label: "ปิดได้ (Active)", x: 690, y: 190, w: 220, h: 160, c: 0x064e3b },
  ];
  const zoneMap = Object.fromEntries(ZONES.map((z) => [z.key, z]));

  // ตำแหน่งเป้าหมายของลูกค้าตามสถานะ (business → game)
  function layoutTargets(list) {
    const waiting = [], active = [];
    for (const c of list) (c.awaiting_reply ? waiting : active).push(c);
    const pos = {}; const hidden = new Set();
    // จัดคนให้อยู่ "ในกรอบโซน" เสมอ: คำนวณ cols/rows จากขนาดโซน ถ้าเกินความจุ → ซ่อนตัวเกิน (โชว์ +N)
    const packInZone = (arr, z) => {
      const padX = 22, padTop = 30, cellW = 30, cellH = 34;
      const cols = Math.max(1, Math.floor((z.w - padX * 2 + cellW) / cellW));
      const rows = Math.max(1, Math.floor((z.h - padTop - 10 + cellH) / cellH));
      const cap = cols * rows;
      arr.forEach((c, i) => {
        if (i >= cap) { hidden.add(c.id); return; }
        const col = i % cols, row = Math.floor(i / cols);
        pos[c.id] = { x: z.x + padX + col * cellW, y: z.y + padTop + row * cellH };
      });
      return Math.max(0, arr.length - cap);
    };
    const overQ = packInZone(waiting, zoneMap.queue);
    const overD = packInZone(active, zoneMap.done);
    return { pos, hidden, waiting: waiting.length, active: active.length, overQ, overD };
  }

  // โหลดรายชื่อเพจ + "ขอบเขตเพจที่เลือกในหน้าตอบแชท" (settings.inbox_page_filter:<email>) — ไม่มี dropdown ในหน้านี้
  useEffect(() => {
    (async () => {
      const { data: pg } = await supabase.from("page_lead_config").select("page_id, page_name").order("page_name");
      const opts = (pg || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })).filter((p) => !allowedPages || allowedPages.includes(p.id));
      setPages(opts);
      const nameOf = (id) => opts.find((o) => o.id === id)?.name || id;
      const { data: { user } } = await supabase.auth.getUser();
      const key = user?.email ? `inbox_page_filter:${user.email}` : "inbox_page_filter";
      let { data: s } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
      if (!s?.value && key !== "inbox_page_filter") ({ data: s } = await supabase.from("settings").select("value").eq("key", "inbox_page_filter").maybeSingle());
      const v = s?.value || {};
      let scope = v.mode === "single" ? (v.single ? [v.single] : []) : (Array.isArray(v.multi) ? v.multi : []);
      if (allowedPages) scope = scope.filter((p) => allowedPages.includes(p));
      const finalScope = scope.length ? scope : (allowedPages || null);   // ไม่เลือก = ทุกเพจที่มีสิทธิ์
      scopeRef.current = finalScope; scopeReadyRef.current = true;
      setScopePages(finalScope);
      loadData();   // โหลดครั้งแรกด้วย scope ที่ถูกต้อง (กันกรณี dep ไม่เปลี่ยนแล้ว effect ไม่ยิงซ้ำ)
      setScopeLabel(!finalScope ? "ทุกเพจ" : finalScope.length === 1 ? nameOf(finalScope[0]) : `${finalScope.length} เพจ (ตามที่เลือกในหน้าตอบแชท)`);
    })();
  }, []);

  // สร้าง Pixi + วาดโซน (ครั้งเดียว) — โหลดลิงก์ฉากหลังก่อน
  useEffect(() => {
    let disposed = false;
    Promise.all([
      loadPixi(),
      supabase.from("settings").select("value").eq("key", "game_office").maybeSingle().then(({ data }) => { bgUrlRef.current = (data?.value?.bg || "").trim(); spCfgRef.current = (data?.value?.sprite && data.value.sprite.url) ? data.value.sprite : null; }),
    ]).then(([PIXI]) => {
      if (disposed || !hostRef.current) return;
      const app = new PIXI.Application({ background: 0x0b1120, antialias: true, resizeTo: hostRef.current });
      hostRef.current.appendChild(app.view);
      appRef.current = { app, PIXI };
      const world = new PIXI.Container();
      app.stage.addChild(world);
      // ---- ฉากหลัง ----
      if (bgUrlRef.current) {
        // ผู้ใช้ใส่ลิงก์ภาพฉาก (เช่น pixel-art office ที่เจนเอง) → ใช้เป็นพื้นหลัง sprite ลอยทับ
        try { const s = PIXI.Sprite.from(bgUrlRef.current); s.width = 940; s.height = 370; world.addChild(s); } catch { /* โหลดไม่ได้ ใช้ฉากโค้ดแทน */ }
      } else {
        // ฉากออฟฟิศวาดด้วยโค้ด (พื้นไม้ + โซน + เฟอร์นิเจอร์ มีมิติ)
        const bg = new PIXI.Graphics();
        bg.beginFill(0x141d30).drawRect(0, 0, 940, 370).endFill();
        bg.lineStyle(1, 0x1b2740, 0.5);
        for (let x = 0; x <= 940; x += 24) bg.moveTo(x, 0).lineTo(x, 370);
        for (let y = 0; y <= 370; y += 24) bg.moveTo(0, y).lineTo(940, y);
        world.addChild(bg);
        for (const z of ZONES) {
          const g = new PIXI.Graphics();
          g.beginFill(0x000000, 0.18).drawRoundedRect(z.x + 3, z.y + 4, z.w, z.h, 10).endFill();   // เงาโซน
          g.beginFill(z.c, 0.6).lineStyle(2, 0x64748b, 0.7).drawRoundedRect(z.x, z.y, z.w, z.h, 10).endFill(); // พื้นโซน
          g.beginFill(0xffffff, 0.04).drawRoundedRect(z.x, z.y, z.w, 14, 10).endFill();             // ไฮไลต์ขอบบน
          world.addChild(g);
          const t = new PIXI.Text(z.label, { fontFamily: "sans-serif", fontSize: 11, fill: 0xe2e8f0, fontWeight: "700" });
          t.x = z.x + 8; t.y = z.y + 6; world.addChild(t);
        }
        // เฟอร์นิเจอร์
        const f = new PIXI.Graphics();
        drawDesk(f, zoneMap.desk1.x + 60, zoneMap.desk1.y + 46, 0x38bdf8);
        drawDesk(f, zoneMap.desk2.x + 60, zoneMap.desk2.y + 46, 0xa78bfa);
        drawDesk(f, zoneMap.ads.x + 30, zoneMap.ads.y + 52, 0x34d399);
        drawDesk(f, zoneMap.account.x + 90, zoneMap.account.y + 52, 0xf59e0b);
        drawPlant(f, zoneMap.reception.x + 175, zoneMap.reception.y + 60);
        drawPlant(f, zoneMap.done.x + 190, zoneMap.done.y + 120);
        drawPlant(f, zoneMap.organic.x + 175, zoneMap.organic.y + 55);
        drawPlant(f, zoneMap.queue.x + 400, zoneMap.queue.y + 120);
        // server rack ใน ads
        f.beginFill(0x0b1120).drawRoundedRect(zoneMap.ads.x + 140, zoneMap.ads.y + 20, 44, 80, 3).endFill();
        for (let i = 0; i < 6; i++) f.beginFill([0x22d3ee, 0x22c55e, 0xf59e0b][i % 3]).drawRect(zoneMap.ads.x + 146, zoneMap.ads.y + 28 + i * 12, 32, 5).endFill();
        world.addChild(f);
      }
      const custLayer = new PIXI.Container();
      world.addChild(custLayer);
      appRef.current.custLayer = custLayer;
      appRef.current.world = world;
      // ---- สร้างเฟรมตัวละครจาก sprite sheet (ถ้าตั้งค่าไว้) ----
      const sc = spCfgRef.current;
      if (sc?.url) {
        try {
          const base = PIXI.BaseTexture.from(sc.url);
          const fw = sc.fw || 32, fh = sc.fh || 32, n = Math.max(1, sc.frames || 4);
          const mk = (row) => Array.from({ length: n }, (_, i) => new PIXI.Texture(base, new PIXI.Rectangle(i * fw, row * fh, fw, fh)));
          appRef.current.frames = { down: mk(sc.rowDown || 0), left: mk(sc.rowLeft || 0), right: mk(sc.rowRight || 0), up: mk(sc.rowUp || 0) };
          appRef.current.spCfg = sc;
        } catch { appRef.current.frames = null; }
      }
      // สเกลให้พอดีความกว้าง
      const fit = () => { const s = Math.min(app.renderer.width / 940, app.renderer.height / 370); world.scale.set(s > 0 ? s : 1); world.x = (app.renderer.width - 940 * world.scale.x) / 2; };
      fit();
      app.renderer.on("resize", fit);
      // ticker: เลื่อนตัวละครเข้าหาเป้าหมาย (เดิน) + แอนิเมชันรอ
      const frames = appRef.current.frames, animMs = (appRef.current.spCfg?.ms || 150);
      app.ticker.add(() => {
        const now = Date.now();
        for (const [, sp] of spritesRef.current) {
          const dx = sp.tx - sp.cont.x, dy = sp.ty - sp.cont.y;
          sp.cont.x += dx * 0.12; sp.cont.y += dy * 0.12;
          const moving = Math.abs(dx) + Math.abs(dy) > 1.5;
          // แอนิเมชันตัวละคร sprite: เลือกทิศจากทิศทางเดิน + วนเฟรมตอนเดิน
          if (frames && sp.spr) {
            if (moving) sp.face = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
            const set = frames[sp.face] || frames.down;
            if (moving) { if (now - (sp.ft || 0) > animMs) { sp.ft = now; sp.fi = ((sp.fi || 0) + 1) % set.length; } }
            else sp.fi = 0;
            const tex = set[sp.fi || 0]; if (tex && sp.spr.texture !== tex) sp.spr.texture = tex;
          }
          // แอนิเมชันรอนาน: เด้งเล็กน้อย + โชว์ !
          if (sp.data.awaiting_reply && sp.wait) {
            const mins = (now - new Date(sp.data.last_message_at || now).getTime()) / 60000;
            sp.wait.visible = mins >= 10;
            const bob = mins >= 5 && !moving ? Math.sin(now / 200) * 1.5 : 0;
            (sp.spr || sp.body).y = bob;
          }
        }
      });
      renderCustomers();
    }).catch((e) => setErr(String(e.message || e)));
    return () => { disposed = true; try { appRef.current?.app?.destroy(true, { children: true }); } catch {} appRef.current = null; spritesRef.current.clear(); };
  }, []);

  // สร้าง/อัปเดต sprite ของลูกค้าให้ตรงกับ custRef
  function renderCustomers() {
    const ctx = appRef.current; if (!ctx) return;
    const { PIXI, custLayer } = ctx;
    const list = custRef.current;
    const { pos, hidden, waiting, active, overQ, overD } = layoutTargets(list);
    setCount({ waiting, active, total: list.length, overQ, overD });
    const seen = new Set();
    for (const c of list) {
      if (hidden.has(c.id)) { const old = spritesRef.current.get(c.id); if (old) { old.cont.destroy({ children: true }); spritesRef.current.delete(c.id); } continue; }  // เกินความจุโซน = ไม่วาด
      seen.add(c.id);
      let sp = spritesRef.current.get(c.id);
      if (!sp) {
        const cont = new PIXI.Container();
        cont.eventMode = "static"; cont.cursor = "pointer";
        cont.on("pointertap", () => openRef.current?.(c.id));
        const ring = new PIXI.Graphics();          // วงแดง = ยังไม่อ่าน
        let body = null, spr = null;
        if (ctx.frames) {                          // โหมด sprite sheet จริง
          spr = new PIXI.Sprite(ctx.frames.down[0]);
          spr.anchor.set(0.5, 0.85); spr.scale.set(ctx.spCfg?.scale || 1.4);
        } else {                                   // fallback: คนวาดด้วยโค้ด
          body = new PIXI.Graphics();
        }
        const badge = new PIXI.Text("", { fontFamily: "sans-serif", fontSize: 9, fill: 0xffffff });
        badge.anchor.set(0.5); badge.y = 16;
        const name = new PIXI.Text("", { fontFamily: "sans-serif", fontSize: 9, fill: 0x94a3b8 });
        name.anchor.set(0.5); name.y = 27;
        const chat = new PIXI.Text("💬", { fontFamily: "sans-serif", fontSize: 13 }); chat.anchor.set(0.5); chat.y = -26; chat.visible = false;
        const wait = new PIXI.Text("!", { fontFamily: "sans-serif", fontSize: 15, fill: 0xf43f5e, fontWeight: "900" }); wait.anchor.set(0.5); wait.y = -28; wait.visible = false;
        cont.addChild(ring); if (spr) cont.addChild(spr); if (body) cont.addChild(body);
        cont.addChild(badge, name, chat, wait);
        const start = pos[c.id] || { x: zoneMap.reception.x + 40, y: zoneMap.reception.y + 45 };
        cont.x = start.x; cont.y = start.y;
        custLayer.addChild(cont);
        sp = { cont, body, spr, ring, badge, name, chat, wait, data: c, tx: start.x, ty: start.y, face: "down", fi: 0, ft: 0 };
        spritesRef.current.set(c.id, sp);
      }
      sp.data = c;
      const t = pos[c.id]; if (t) { sp.tx = t.x; sp.ty = t.y; }
      // ตัวละคร: sprite ใช้เฟรมจาก sheet (อัปเดตใน ticker) ; fallback วาดคนด้วยโค้ด
      if (sp.body) drawPixelPerson(sp.body, srcColor(c));
      sp.ring.clear();
      if (c.unread) sp.ring.lineStyle(2, 0xf43f5e).drawCircle(0, sp.spr ? -8 : -2, sp.spr ? 16 : 15);
      // ที่จำนวนเยอะ (500 ตัว) ข้อความชื่อ/ป้ายจะทับกันรก → ซ่อน เหลือแค่สี+💬+! (ดูรายละเอียดตอนคลิก)
      sp.badge.text = "";
      sp.name.text = "";
      sp.chat.visible = !!c.unread;
    }
    // ลบตัวที่หายไป
    for (const [id, sp] of spritesRef.current) {
      if (!seen.has(id)) { sp.cont.destroy({ children: true }); spritesRef.current.delete(id); }
    }
  }

  // โหลดข้อมูล + Realtime (อ่านอย่างเดียว — ชุดเดียวกับ inbox)
  async function loadData() {
    if (!scopeReadyRef.current) return;   // ยังไม่รู้ขอบเขตเพจ (จากหน้าตอบแชท) — รอก่อน กันโหลดทุกเพจ
    const scope = scopeRef.current;
    let q = supabase.from("chat_customers")
      .select("id, customer_name, last_message_at, page_id, page_name, source, entry_ad_id, stage, unread, awaiting_reply")
      .order("last_message_at", { ascending: false }).limit(500);
    if (Array.isArray(scope) && scope.length) q = q.in("page_id", scope);   // ซิงก์เฉพาะเพจที่เลือกในหน้าตอบแชท
    const { data } = await q;
    custRef.current = data || [];
    renderCustomers();
  }
  useEffect(() => {
    loadData();
    let deb;
    const ch = supabase.channel("game-office")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_customers" }, () => { clearTimeout(deb); deb = setTimeout(loadData, 400); })
      .subscribe();
    const iv = setInterval(loadData, 30000);
    return () => { clearTimeout(deb); clearInterval(iv); supabase.removeChannel(ch); };
  }, [scopePages ? scopePages.join(",") : "null"]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ height: "82vh" }}>
      <div className="p-2.5 border-b border-slate-200 flex items-center gap-3 flex-wrap">
        <div className="font-semibold text-slate-800 flex items-center gap-1.5"><Gamepad2 size={16} /> ออฟฟิศจำลอง</div>
        <span className="text-xs text-slate-500 px-2 py-1 rounded-lg bg-slate-100">เพจ: {scopeLabel || "…"}</span>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">คิวรอ {count.waiting}{count.overQ ? ` (+${count.overQ})` : ""}</span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">คุยแล้ว {count.active}{count.overD ? ` (+${count.overD})` : ""}</span>
          <span>รวม {count.total}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400 ml-auto">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />ออร์แกนิค</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" />แอด</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />ปิดได้</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-500" />หลุด</span>
        </div>
      </div>
      {err && <div className="text-xs text-rose-600 bg-rose-50 px-3 py-2">{err}</div>}
      <div ref={hostRef} className="flex-1 min-h-0 bg-[#0b1120]" />
      <div className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100">คลิกตัวละครลูกค้าเพื่อเปิดแชท · ตัวที่มี 💬 = ยังไม่อ่าน · "!" = รอนานเกิน 10 นาที</div>
    </div>
  );
}
