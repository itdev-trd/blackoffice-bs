import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./lib/supabaseClient.js";
import { calculateVatInclusiveBudget } from "./budget-vat.js";
import { getCustomerDateRange } from "./customer-date-filter.js";
// Design system — ชุด component กลาง (Dark Luxury Fintech)
import { Card as DsCard, StatCard as DsStatCard, SectionTitle, Badge, Button as DsButton, EmptyState } from "./ui.jsx";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Settings as SettingsIcon,
  LogOut,
  Loader2,
  RefreshCw,
  LayoutDashboard,
  ImageIcon,
  PauseCircle,
  ArrowUpCircle,
  Wand2,
  Trash2,
  BarChart3,
  AlertTriangle,
  ArrowDownCircle,
  Minus,
  FileDown,
  Upload,
  ArrowLeft,
  GitCompare,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Moon,
  Sun,
  MessageSquare,
  Bell,
  Home,
  Database,
  Search,
  ChevronUp,
  ArrowUpDown,
  Menu,
  X,
  Send,
  Inbox,
  Paperclip,
  Gamepad2,
  Trophy,
  Medal,
  Crown,
  Tv,
  ExternalLink,
  Eye,
  EyeOff,
  Clock,
  Users,
  CalendarX2,
  CalendarPlus,
  Pencil,
  Plus,
} from "lucide-react";

// ตัวเลือกอิโมจิชุดเต็มมีข้อมูลจำนวนมาก — โหลดเฉพาะตอนเปิดใช้ ไม่ถ่วงหน้าแชท/PWA ตอนเริ่มต้น
const EmojiPicker = React.lazy(() => import("emoji-picker-react").then((module) => ({ default: module.default })));

// ---------------------------------------------------------------
// เก็บ/อ่านสถานะ UI ลง localStorage (กันรีเฟรชแล้วหลุดหน้า/ต้องดึงข้อมูลใหม่)
// ---------------------------------------------------------------
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
// แปลงค่าจาก <input type="date"> ที่บางเครื่อง (locale ไทย) คืนปีเป็น พ.ศ. → ค.ศ. เสมอ
// เช่น "2569-09-20" → "2026-09-20" (กันบันทึกวันหมดอายุเพี้ยนไปปี 2569)
const beToCe = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
  if (!m) return d;
  const y = Number(m[1]);
  return y > 2400 ? `${y - 543}-${m[2]}-${m[3]}` : d;
};
const bangkokDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
};

// รีโหลดแบบ "สะอาดจริง" สำหรับ PWA — ล้าง cache ของ service worker + สั่ง SW ตัวใหม่ทำงานก่อน
// ไม่งั้น location.reload() เฉยๆ จะดึง JS/CSS ตัวเก่าจาก cache กลับมา (เหตุที่ต้องลบแอปเพิ่มใหม่)
async function hardReload() {
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.update(); if (reg.waiting) reg.waiting.postMessage("skipWaiting"); }
    }
    if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
  } catch { /* ล้างไม่ได้ก็รีโหลดตรงๆ */ }
  window.location.reload();
}

// เก็บกวาด push ที่ค้างจากเวอร์ชันเก่าเมื่อเปิดแอปมาแล้วไม่มี session
// การ unsubscribe ฝั่ง browser ทำให้ push endpoint ใช้งานไม่ได้ทันที; cron จะลบแถว server เมื่อได้รับ 410
async function clearLoggedOutPush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const subscription = await reg?.pushManager?.getSubscription?.();
    if (subscription) await subscription.unsubscribe();
    const notifications = await reg?.getNotifications?.();
    (notifications || []).forEach((notification) => notification.close());
    if ("clearAppBadge" in navigator) await navigator.clearAppBadge();
  } catch { /* browser ไม่รองรับก็ข้าม */ }
}

// กลับหน้าแรก (ภาพรวม) จากทุกที่ — ปิด overlay ที่จำไว้ แล้วรีโหลดให้สะอาด
function goHome() {
  try {
    localStorage.setItem("ui.tab", JSON.stringify("overview"));
    ["meta.showOverview", "ov.dashItem", "ov.expandedCamps"].forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
  window.location.reload();
}

// ปุ่ม Home ใช้ซ้ำได้ทุกหน้า overlay
function HomeButton({ className = "text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm shrink-0" }) {
  return (
    <button onClick={goHome} className={className} title="กลับหน้าแรก">
      <Home size={18} /> หน้าแรก
    </button>
  );
}

// ---------------------------------------------------------------
// อัปเดตอัตโนมัติหลัง deploy: poll version.json เทียบกับ build id ที่ฝังมา
// เจอเวอร์ชันใหม่ → แท็บที่ไม่ได้เปิดดูอยู่รีโหลดเอง / แท็บที่เปิดอยู่โชว์แถบกดอัปเดต
// ---------------------------------------------------------------
const APP_BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (APP_BUILD_ID === "dev") return; // โหมด dev ไม่ต้องเช็ค
    let stop = false;
    async function check() {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (stop || !j?.id) return;
        const target = String(j.id);
        if (target === APP_BUILD_ID) { // ตรงกันแล้ว = อัปเดตสำเร็จ ล้าง marker กันลูปทิ้ง เพื่อให้ deploy รอบหน้าเด้งได้ปกติ
          if (lsGet("ui.reloaded_for", null)) lsSet("ui.reloaded_for", null);
          return;
        }

        // กันลูปรีโหลด: ถ้าเคยรีโหลดเพื่อ id นี้ไปแล้วแต่ build ที่โหลดมายัง "ไม่ขยับ"
        // (host/CDN/service worker ยังเสิร์ฟไฟล์เก่า) → อย่ารีโหลดซ้ำอีก มันจะวนไม่จบ
        // แสดงแถบให้กดเองแทน (กดแล้วยังไม่หายค่อยเป็นเรื่อง hosting ไม่ใช่เด้งเองรัวๆ)
        const already = lsGet("ui.reloaded_for", null);
        if (already === target) { setReady(true); return; }

        // เจอเวอร์ชันใหม่จริงครั้งแรก → จำ id ที่กำลังจะรีโหลดไป กันวนรอบถัดไป
        lsSet("ui.reloaded_for", target);
        if (document.visibilityState === "hidden") hardReload(); // ไม่ได้ดูอยู่ = รีโหลดเงียบๆ (ล้าง cache PWA ด้วย)
        else setReady(true); // กำลังใช้งาน = แจ้งให้กดเอง (กันพิมพ์ค้างแล้วหาย)
      } catch { /* เน็ตสะดุดก็ข้ามรอบนี้ */ }
    }
    const iv = setInterval(check, 3 * 60 * 1000); // ทุก 3 นาที
    const onVis = () => { if (document.visibilityState === "visible") check(); }; // กลับมาโฟกัส = เช็คทันที
    document.addEventListener("visibilitychange", onVis);
    check();
    return () => { stop = true; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  if (!ready) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-indigo-600 text-white rounded-full shadow-lg px-4 py-2.5 flex items-center gap-3">
      <span className="text-sm font-medium">มีเวอร์ชันใหม่ของแอป</span>
      <button onClick={hardReload} className="bg-white text-indigo-700 rounded-full px-3 py-1 text-xs font-semibold hover:bg-indigo-50">
        อัปเดตเลย
      </button>
    </div>
  );
}

// id ประจำเบราว์เซอร์/เครื่อง (สุ่มครั้งเดียวเก็บใน localStorage) — ใช้นับว่าเมลเดียวออนไลน์กี่เครื่อง
function getDeviceId() {
  try {
    let id = localStorage.getItem("ui.device_id");
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem("ui.device_id", id); }
    return id;
  } catch { return null; }
}

// บันทึกกิจกรรมการใช้งาน (audit log) — fire-and-forget ไม่ให้กระทบ UX
async function logActivity(event, detail) {
  try {
    await supabase.functions.invoke("log-activity", { body: { event, detail: detail ?? null, user_agent: navigator.userAgent, device_id: getDeviceId() } });
  } catch { /* เงียบไว้ */ }
}

// ธีม — เก็บค่าระดับเครื่องและส่ง event ให้ทุกหน้าที่เปิดอยู่ใน React อัปเดตพร้อมกัน
const THEME_EVENT = "aiads:theme-change";
function storedTheme() {
  try { return localStorage.getItem("ui.theme") === "light" ? "light" : "dark"; } catch { return "dark"; }
}
function applyTheme(next = storedTheme()) {
  const theme = next === "light" ? "light" : "dark";
  const root = document.documentElement;
  root.classList.toggle("theme-dark", theme === "dark");
  root.classList.toggle("theme-light", theme === "light");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#F4F7FB" : "#090B10");
  try { localStorage.setItem("ui.theme", theme); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
  return theme;
}
function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.classList.contains("theme-light") ? "light" : storedTheme());
  useEffect(() => {
    const sync = (event) => setTheme(event?.detail === "light" || storedTheme() === "light" ? "light" : "dark");
    const storage = (event) => { if (event.key === "ui.theme") applyTheme(event.newValue); };
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", storage);
    setTheme(applyTheme(theme));
    return () => { window.removeEventListener(THEME_EVENT, sync); window.removeEventListener("storage", storage); };
  }, []);
  return { theme, toggle: () => applyTheme(theme === "dark" ? "light" : "dark") };
}
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const light = theme === "light";
  return (
    <button type="button" onClick={toggle} className="theme-toggle" aria-label={light ? "เปลี่ยนเป็นธีมมืด" : "เปลี่ยนเป็นธีมสว่าง"} title={light ? "ธีมมืด" : "ธีมสว่าง"}>
      {light ? <Moon size={17} /> : <Sun size={17} />}
      <span className="theme-toggle-label">{light ? "มืด" : "สว่าง"}</span>
    </button>
  );
}

// ---------------------------------------------------------------
// Small shared UI bits
// ---------------------------------------------------------------
// ช่องกรอกตัวเลขที่ "ลบให้ว่างได้จริง"
// ปัญหาเดิม: onChange แปลงเป็นตัวเลขทันที (Number(v) || ค่าเริ่มต้น) พอลบตัวสุดท้ายค่าจะเด้งกลับทันที
// จึงลบไม่หมดและพิมพ์ใหม่ทั้งหมดไม่ได้ — ตรงนี้เก็บเป็นข้อความระหว่างพิมพ์ ให้ว่างได้
// ออกจากช่องแล้วยังว่างอยู่ = ใส่ 0 ให้ (ตามที่ต้องการ) ; ถ้าพิมพ์เกินขอบเขต min/max จะดึงกลับให้อยู่ในกรอบ
function NumInput({ value, onChange, min, max, className = "", disabled, step, placeholder, title }) {
  const [txt, setTxt] = useState(value == null ? "" : String(value));
  const typing = useRef(false);
  // ค่าจากภายนอกเปลี่ยน (เช่นโหลดค่าตั้งใหม่) → sync เฉพาะตอนที่ผู้ใช้ไม่ได้พิมพ์อยู่ กันตัวเลขกระตุก
  useEffect(() => { if (!typing.current) setTxt(value == null ? "" : String(value)); }, [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min} max={max} step={step} disabled={disabled} placeholder={placeholder} title={title}
      className={className}
      value={txt}
      onFocus={() => { typing.current = true; }}
      onChange={(e) => {
        const v = e.target.value;
        setTxt(v);                       // ปล่อยให้ว่างได้ระหว่างพิมพ์
        if (v === "" || v === "-") return;   // ยังไม่ส่งค่าออกจนกว่าจะเป็นตัวเลขจริง
        const n = Number(v);
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => {
        typing.current = false;
        if (txt === "" || !Number.isFinite(Number(txt))) { setTxt("0"); onChange(0); return; }
        let n = Number(txt);
        if (min != null && n < min) n = min;
        if (max != null && n > max) n = max;
        setTxt(String(n)); onChange(n);
      }}
    />
  );
}

function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
      <Loader2 className="animate-spin" size={20} />
      <span>{label || "กำลังโหลด..."}</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone = "slate", onClick }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-rose-100 text-rose-700",
    blue: "bg-blue-100 text-blue-700",
  };
  const clickable = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={`rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-3 shadow-sm ${
        clickable
          ? "cursor-pointer transition hover:border-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-800"
          : ""
      }`}
    >
      <div className={`rounded-xl p-2.5 ${tones[tone]}`}>
        <Icon size={22} />
      </div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-xl font-semibold text-slate-800">{value}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending_approval: ["รออนุมัติ", "bg-amber-100 text-amber-700"],
    rejected: ["ปฏิเสธแล้ว", "bg-slate-200 text-slate-600"],
    active: ["กำลังใช้งาน", "bg-emerald-100 text-emerald-700"],
    paused_auto: ["หยุดอัตโนมัติ", "bg-rose-100 text-rose-700"],
    paused_manual: ["หยุดโดยแอดมิน", "bg-slate-200 text-slate-600"],
    deleted_on_meta: ["ถูกลบในตัวจัดการโฆษณา", "bg-slate-200 text-slate-500"],
  };
  const [label, cls] = map[status] || [status, "bg-slate-100 text-slate-600"];
  return <span className={`text-xs px-2 py-1 rounded-full font-medium ${cls}`}>{label}</span>;
}

// ช่องรหัสผ่านที่มีปุ่มดวงตา (กดสลับแสดง/ซ่อนรหัสที่พิมพ์) — ใช้ซ้ำได้ทุกที่
function PasswordInput({ className = "", wrapperClass = "", ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${wrapperClass}`}>
      <input {...props} type={show ? "text" : "password"} className={`${className} pr-10`} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
        aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        title={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Login screen
// ---------------------------------------------------------------
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8 space-y-4 border border-slate-100">
        <div className="text-center mb-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-slate-900 text-white mb-3">
            <Sparkles size={22} />
          </div>
          <h1 className="text-lg font-semibold text-slate-800">AI Ads Automation</h1>
          <p className="text-sm text-slate-500">เข้าสู่ระบบเพื่อจัดการแคมเปญ</p>
        </div>
        <div>
          <label className="text-sm text-slate-600">อีเมล</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">รหัสผ่าน</label>
          <PasswordInput
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            wrapperClass="mt-1"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
          />
        </div>
        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : null}
          เข้าสู่ระบบ
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------
function OverviewTab({ adContent, adCopies = [], adImages = [], metricsToday, onNavigate }) {
  // นับจากแหล่งเดียวกับหน้า "รออนุมัติ" (copies + images ที่ยัง pending) ไม่ใช่แถวเก่าค้างใน ad_content
  const pending =
    adCopies.filter((c) => c.status === "pending_approval").length +
    adImages.filter((im) => im.status === "pending_approval").length;
  const active = adContent.filter((a) => a.status === "active").length;
  const pausedAuto = adContent.filter((a) => a.status === "paused_auto").length;
  const scaleSuggestions = adContent.filter((a) => a.scale_suggested).length;
  const spendToday = metricsToday.reduce((sum, m) => sum + (m.spend || 0), 0);

  const needsAttention = pending + pausedAuto + scaleSuggestions;

  return (
    <div className="space-y-7 max-w-6xl">
      <SectionTitle
        eyebrow="Overview"
        title="ภาพรวม"
        subtitle="สรุปสถานะระบบยิงโฆษณาอัตโนมัติแบบเรียลไทม์"
        right={
          needsAttention > 0 ? (
            <Badge tone="gold">{needsAttention} รายการรอดำเนินการ</Badge>
          ) : (
            <Badge tone="green">ทุกอย่างเรียบร้อย</Badge>
          )
        }
      />

      {/* Hero — ยอดใช้จ่ายวันนี้ */}
      <DsCard
        glass
        className="p-6 sm:p-7 relative overflow-hidden cursor-pointer ds-hover-lift"
        onClick={() => onNavigate?.("campaigns", "active")}
      >
        <div className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full blur-3xl opacity-20" style={{ background: "#F7C948" }} />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] text-slate-400 font-medium flex items-center gap-2">
              <TrendingUp size={15} style={{ color: "#F7C948" }} />
              ยอดใช้จ่ายรวมวันนี้
            </div>
            <div className="mt-2 flex items-end gap-2">
              <span className="ds-figure text-[48px] sm:text-[58px]">
                {spendToday.toLocaleString()}
              </span>
              <span className="text-slate-400 text-lg mb-1.5">บาท</span>
            </div>
            <div className="text-[12px] text-slate-500 mt-2">รวมจากโฆษณาที่กำลังใช้งาน {active} ชิ้น</div>
          </div>
          <div className="rounded-2xl p-3.5 shrink-0" style={{ background: "rgba(157,107,255,.12)", color: "#9D6BFF" }}>
            <BarChart3 size={26} />
          </div>
        </div>
      </DsCard>

      {/* การ์ดสถิติ */}
      <div>
        <div className="text-[12px] uppercase tracking-wider text-slate-500 font-semibold mb-3">สถานะโฆษณา</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <DsStatCard icon={Wand2} label="รออนุมัติ" value={pending} tone="gold" onClick={() => onNavigate?.("review")} />
          <DsStatCard icon={CheckCircle2} label="กำลังใช้งาน" value={active} tone="green" onClick={() => onNavigate?.("campaigns", "active")} />
          <DsStatCard icon={PauseCircle} label="หยุดอัตโนมัติ" value={pausedAuto} tone="red" onClick={() => onNavigate?.("campaigns", "paused_auto")} />
          <DsStatCard icon={TrendingUp} label="รออนุมัติเพิ่มงบ" value={scaleSuggestions} tone="blue" onClick={() => onNavigate?.("campaigns", "scale")} />
        </div>
      </div>

      {/* การกระทำด่วน */}
      <div>
        <div className="text-[12px] uppercase tracking-wider text-slate-500 font-semibold mb-3">การกระทำด่วน</div>
        <div className="flex flex-wrap gap-3">
          <DsButton variant="primary" icon={Sparkles} onClick={() => onNavigate?.("generate")}>สร้างคอนเทนต์ใหม่</DsButton>
          <DsButton variant="secondary" icon={CheckCircle2} onClick={() => onNavigate?.("review")}>ตรวจรออนุมัติ{pending > 0 ? ` (${pending})` : ""}</DsButton>
          <DsButton variant="secondary" icon={BarChart3} onClick={() => onNavigate?.("analyze")}>วิเคราะห์ผล</DsButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Generate tab
// ---------------------------------------------------------------
// ตัวเลือกขนาด/อัตราส่วนรูป (map เป็น size ที่ OpenAI image API รองรับ)
const IMAGE_SIZE_OPTIONS = [
  { value: "1024x1024", label: "จัตุรัส 1:1 · 1024×1024 (ฟีด)" },
  { value: "1024x1536", label: "แนวตั้ง 2:3 · 1024×1536 (ฟีด/สตอรี่/รีลส์)" },
  { value: "1536x1024", label: "แนวนอน 3:2 · 1536×1024" },
];
const COPY_LENGTH_OPTIONS = [
  { value: "auto", label: "ให้ AI แนะนำ" },
  { value: "short", label: "สั้น (~15-25 คำ)" },
  { value: "medium", label: "กลาง (~30-50 คำ)" },
  { value: "long", label: "ยาว (~60-90 คำ)" },
];
// แปลงอัตราส่วนที่ AI แนะนำ (จาก launch_config) เป็น size ที่รองรับ
function aspectRatioToSize(ratio) {
  const portrait = ["4:5", "2:3", "9:16"];
  const landscape = ["1.91:1", "3:2", "16:9"];
  if (portrait.includes(ratio)) return "1024x1536";
  if (landscape.includes(ratio)) return "1536x1024";
  return "1024x1024";
}

// รองรับทั้งโครงสร้าง CI แบบเดิม (object เดียว) และแบบใหม่ที่แยกหลายแบรนด์
function normalizeBrandConfig(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  if (Array.isArray(value.brands) && value.brands.length) {
    const brands = value.brands.map((brand, index) => ({
      id: String(brand?.id || `brand-${index + 1}`),
      name: String(brand?.name || `แบรนด์ ${index + 1}`),
      assets: brand?.assets && typeof brand.assets === "object" ? brand.assets : {},
    }));
    const activeBrandId = brands.some((brand) => brand.id === value.active_brand_id) ? value.active_brand_id : brands[0].id;
    return { active_brand_id: activeBrandId, brands };
  }
  const legacyAssets = { ...value };
  delete legacyAssets.brands;
  delete legacyAssets.active_brand_id;
  return {
    active_brand_id: "default",
    brands: [{ id: "default", name: "แบรนด์หลัก", assets: legacyAssets }],
  };
}

// ย่อภาพสินค้าในเบราว์เซอร์ก่อนส่งเข้า Image Edit API เพื่อลด payload/เวลารอ
// ภาพนี้ใช้เป็น reference เฉพาะคำขอสร้างรูป และไม่ถูกเก็บลงฐานข้อมูล
async function prepareProductReferenceImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, WEBP)");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("รูปสินค้าแต่ละไฟล์ต้องมีขนาดไม่เกิน 12 MB");
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("อ่านรูปสินค้าไม่สำเร็จ"));
      img.src = sourceUrl;
    });
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    // WEBP รองรับ alpha และมีขนาดเล็กกว่าไฟล์ต้นฉบับมากใน browser รุ่นปัจจุบัน
    const compressed = canvas.toDataURL("image/webp", 0.86);
    return compressed.startsWith("data:image/") ? compressed : canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function GenerateTab({ settings, onGenerated }) {
  const brandVoice = settings.brand_voice || {};
  const brandConfig = normalizeBrandConfig(settings.brand_assets);
  const brandOptions = brandConfig.brands;
  const [form, setForm] = useState({
    brand_id: brandConfig.active_brand_id || brandOptions[0]?.id || "default",
    product_name: "Exness IB Rebate Program",
    offer: "รับ rebate สูงสุด X% ต่อ lot พร้อมสัญญาณเทรดฟรี",
    target_audience_desc: brandVoice.target_audience_desc || "",
    brand_voice: brandVoice.brand_voice || "",
    num_copies: 4,
    num_images: 4,
    image_model: settings.ai_models?.image || "gpt-image-1",
    image_size: aspectRatioToSize(settings.launch_config?.image_aspect_ratio), // ค่าเริ่มต้นตามที่ AI แนะนำ
    copy_length: settings.launch_config?.copy_length || "auto", // ค่าเริ่มต้นตามที่ AI แนะนำ
    text_model: settings.ai_models?.content_text || "openai",
    custom_prompt: "",
    custom_prompt_mode: "merge", // "merge" = ผสมกับ prompt เดิม, "override" = สั่งเองทั้งหมด ไม่ใช้ prompt เดิม
    image_custom_prompt: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [audienceInfo, setAudienceInfo] = useState(null); // { interests, reasoning } จาก resolve-audience-interests ล่าสุด
  const [productReferences, setProductReferences] = useState([]);
  const [productReferenceError, setProductReferenceError] = useState("");

  async function handleProductReferenceFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setProductReferenceError("");
    const remaining = Math.max(0, 4 - productReferences.length);
    if (files.length > remaining) {
      setProductReferenceError("แนบรูปสินค้าได้สูงสุด 4 รูปต่อการสร้างคอนเทนต์");
    }
    const accepted = files.slice(0, remaining);
    try {
      const prepared = await Promise.all(accepted.map(prepareProductReferenceImage));
      setProductReferences((current) => [...current, ...prepared].slice(0, 4));
    } catch (err) {
      setProductReferenceError(err.message || "เตรียมรูปสินค้าไม่สำเร็จ");
    }
  }

  function handleAiFillFromSettings() {
    // ดึงค่าที่เคยเซฟไว้ในหน้า "ตั้งค่า" (settings.brand_voice) มาเติมฟอร์มทันที
    // ไม่ต้องเรียก API เพิ่ม เพราะข้อมูลนี้มีอยู่แล้วใน prop settings ที่โหลดมาตั้งแต่ต้น
    const current = settings.brand_voice || {};
    setForm({
      ...form,
      product_name: current.product_name || form.product_name,
      offer: current.offer || form.offer,
      target_audience_desc: current.target_audience_desc || form.target_audience_desc,
      brand_voice: current.brand_voice || form.brand_voice,
    });
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    setProgress("");

    try {
      // ขั้นที่ 0: หา interests/behaviors targeting บน Meta จากกลุ่มเป้าหมายที่กรอกไว้ (ถ้ามี)
      // ระบบเดิมตั้ง targeting แค่อายุ+ประเทศเท่านั้น ทำให้กลุ่มเป้าหมายกว้างเกินไป
      // ขั้นนี้ให้ AI แปลเป็นคำค้นแล้วยิงหา interest ID จริงบน Meta มาเก็บไว้ใช้ตอนลอนช์
      // ถ้าขั้นนี้พัง ไม่ควรทำให้การสร้างคอนเทนต์ทั้งหมดล้ม — แค่ fallback เป็น targeting แบบเดิม (อายุ+ประเทศ)
      if (form.target_audience_desc.trim()) {
        setProgress("กำลังวิเคราะห์กลุ่มเป้าหมายสำหรับ Meta targeting...");
        try {
          const { data: audData, error: audError } = await supabase.functions.invoke("resolve-audience-interests", {
            body: { target_audience_desc: form.target_audience_desc, text_model: form.text_model },
          });
          if (audError) {
            console.error("resolve-audience-interests ไม่สำเร็จ:", await readFunctionErrorMessage(audError));
            setAudienceInfo(null);
          } else {
            setAudienceInfo({ interests: audData?.interests || [], reasoning: audData?.reasoning || "", warning: audData?.warning || "" });
          }
        } catch (audErr) {
          console.error("resolve-audience-interests ไม่สำเร็จ:", audErr);
          setAudienceInfo(null);
        }
      } else {
        setAudienceInfo(null);
      }

      // ขั้นที่ 1: สร้าง copy ทั้งหมด + ขอ image_prompts กลับมา (คำขอเดียว เร็ว ไม่เสี่ยง timeout)
      setProgress("กำลังสร้างข้อความโฆษณา...");
      const { data: copyData, error: copyError } = await supabase.functions.invoke("generate-ad-content", {
        body: { ...form, mode: "copies_only" },
      });
      if (copyError) throw new Error(await readFunctionErrorMessage(copyError));

      const imagePrompts = copyData?.image_prompts || [];
      const images = [];

      // ขั้นที่ 2: สร้างรูปทีละ 1 ใบต่อคำขอ (กันคำขอเดียวรวมหลายรูปแล้วชน timeout ของ Edge Function)
      for (let i = 0; i < imagePrompts.length; i++) {
        setProgress(`กำลังสร้างรูปที่ ${i + 1}/${imagePrompts.length}...`);
        const { data: imgData, error: imgError } = await supabase.functions.invoke("generate-ad-content", {
          body: {
            mode: "single_image",
            brand_id: form.brand_id,
            image_prompt: imagePrompts[i],
            image_model: form.image_model,
            image_size: form.image_size,
            reference_images: productReferences,
            image_custom_prompt: form.image_custom_prompt,
          },
        });
        if (imgError) {
          // รูปเดียวพังไม่ควรทำให้ทั้ง batch ล้ม — log ไว้แล้วข้ามไปรูปถัดไป
          console.error(`สร้างรูปที่ ${i + 1} ไม่สำเร็จ:`, await readFunctionErrorMessage(imgError));
          continue;
        }
        if (imgData?.images?.[0]) images.push(imgData.images[0]);
      }

      setProgress("");
      setResult({
        ok: true,
        created_copies: copyData?.copies?.length || 0,
        created_images: images.length,
        copies: copyData?.copies || [],
        images,
      });
      onGenerated?.();
    } catch (err) {
      setError(err.message || "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  const hasSavedBrandVoice = Boolean(brandVoice.brand_voice || brandVoice.target_audience_desc);

  return (
    <div className="max-w-xl space-y-5">
      <form onSubmit={handleGenerate} className="space-y-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">กรอกด้วยตัวเอง หรือดึงค่าจากหน้า "ตั้งค่า" มาเติมให้อัตโนมัติ</span>
          <button
            type="button"
            disabled={!hasSavedBrandVoice}
            onClick={handleAiFillFromSettings}
            className="flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 rounded-lg px-3 py-1.5 font-medium hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
            title={hasSavedBrandVoice ? "" : "ยังไม่มีค่าที่เซฟไว้ในหน้าตั้งค่า"}
          >
            <Wand2 size={13} />
            ให้ AI ช่วยกรอก
          </button>
        </div>
        {brandOptions.length > 0 && (
          <div>
            <label className="text-sm text-slate-600">แบรนด์ CI ที่ใช้สร้างคอนเทนต์</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={form.brand_id}
              onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
            >
              {brandOptions.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">ระบบจะใช้โลโก้ ริบบิ้น และคำอธิบาย CI ของแบรนด์ที่เลือกกับรูปที่สร้าง</p>
          </div>
        )}
        <div>
          <label className="text-sm text-slate-600">ชื่อสินค้า/โปรแกรม</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={form.product_name}
            onChange={(e) => setForm({ ...form, product_name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">ข้อเสนอ / Offer</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            value={form.offer}
            onChange={(e) => setForm({ ...form, offer: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">กลุ่มเป้าหมาย</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            value={form.target_audience_desc}
            onChange={(e) => setForm({ ...form, target_audience_desc: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">โทนแบรนด์</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            value={form.brand_voice}
            onChange={(e) => setForm({ ...form, brand_voice: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">รูปสินค้าอ้างอิง (ไม่บังคับ)</label>
          <p className="mt-1 text-xs text-slate-400">AI จะใช้รูปนี้เป็นต้นแบบสินค้าในภาพโปรโมทที่สร้างใหม่ · แนบได้สูงสุด 4 รูป</p>
          <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-3">
              {productReferences.map((src, index) => (
                <div key={`${src.slice(0, 32)}-${index}`} className="relative">
                  <img src={src} alt={`สินค้าอ้างอิง ${index + 1}`} className="h-20 w-20 rounded-lg border border-slate-200 bg-white object-cover" />
                  <button
                    type="button"
                    onClick={() => setProductReferences((current) => current.filter((_, i) => i !== index))}
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white shadow hover:bg-rose-600"
                    aria-label={`ลบรูปสินค้า ${index + 1}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {productReferences.length < 4 && (
                <label className="flex h-20 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-600 hover:border-slate-500 hover:bg-slate-100">
                  <Upload size={18} />
                  เพิ่มรูปสินค้า
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={handleProductReferenceFiles} className="hidden" />
                </label>
              )}
            </div>
            {productReferences.length > 0 && <p className="mt-2 text-xs text-slate-500">แนบแล้ว {productReferences.length}/4 รูป · ระบบจะย่อรูปก่อนส่งเพื่อให้สร้างภาพเร็วขึ้น</p>}
            {productReferenceError && <p className="mt-2 text-xs text-rose-600">{productReferenceError}</p>}
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-600">คำสั่งเพิ่มเติมสำหรับรูปภาพ (ไม่บังคับ)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            placeholder='เช่น "วางสินค้าไว้ด้านขวา ใช้พื้นหลังสีดำทอง และเว้นพื้นที่ด้านบนสำหรับหัวข้อ"'
            value={form.image_custom_prompt}
            onChange={(e) => setForm({ ...form, image_custom_prompt: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-400">คำสั่งนี้ใช้กับรูปที่ AI สร้างเท่านั้น ไม่กระทบข้อความโฆษณา</p>
        </div>
        <div>
          <label className="text-sm text-slate-600">คำสั่งเพิ่มเติม (ไม่บังคับ)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            placeholder='เช่น "เน้นโปรโมชั่นช่วงสิ้นปี" หรือ "ห้ามใช้คำว่าฟรี"'
            value={form.custom_prompt}
            onChange={(e) => setForm({ ...form, custom_prompt: e.target.value })}
          />
          {form.custom_prompt.trim() && (
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="radio"
                  checked={form.custom_prompt_mode === "merge"}
                  onChange={() => setForm({ ...form, custom_prompt_mode: "merge" })}
                />
                ผสมกับคำสั่งเดิมของระบบ (แนะนำ — ยังคุมกฎ Meta/ความหลากหลายของ copy อยู่)
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="radio"
                  checked={form.custom_prompt_mode === "override"}
                  onChange={() => setForm({ ...form, custom_prompt_mode: "override" })}
                />
                สั่งเองทั้งหมด (ไม่ใช้คำสั่งเดิมของระบบเลย)
              </label>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="text-sm text-slate-600">จำนวน copy</label>
            <NumInput min={1} max={10}
              className="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.num_copies}
              onChange={(n) => setForm({ ...form, num_copies: n })}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">จำนวนรูป</label>
            <NumInput min={0} max={10}
              className="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.num_images}
              onChange={(n) => setForm({ ...form, num_images: n })}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">โมเดลเขียนคอนเทนต์</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={form.text_model}
              onChange={(e) => setForm({ ...form, text_model: e.target.value })}
            >
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">โมเดลสร้างรูป</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={form.image_model}
              onChange={(e) => setForm({ ...form, image_model: e.target.value })}
            >
              <option value="gpt-image-1">GPT Image 1</option>
              <option value="gpt-image-2">GPT Image 2 (ล่าสุด)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">ขนาด/อัตราส่วนรูป</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={form.image_size}
              onChange={(e) => setForm({ ...form, image_size: e.target.value })}
            >
              {IMAGE_SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">ความยาวคอนเทนต์</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={form.copy_length}
              onChange={(e) => setForm({ ...form, copy_length: e.target.value })}
            >
              {COPY_LENGTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        {settings.launch_config?.image_aspect_ratio || settings.launch_config?.copy_length ? (
          <p className="text-[11px] text-slate-400 -mt-1">ค่าเริ่มต้นด้านบนตั้งตามที่ AI แนะนำไว้ ปรับเองได้</p>
        ) : null}
        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
        {loading && progress && (
          <div className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2 flex items-center gap-2">
            <Loader2 className="animate-spin" size={14} />
            {progress}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          สร้างคอนเทนต์
        </button>
      </form>
      {audienceInfo && (
        <div className="text-sm bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 space-y-1.5">
          {audienceInfo.warning ? (
            <div className="text-amber-700">{audienceInfo.warning}</div>
          ) : (
            <>
              <div className="text-blue-800 font-medium">Meta targeting (ความสนใจ/พฤติกรรม) ที่ใช้:</div>
              <div className="flex flex-wrap gap-1.5">
                {audienceInfo.interests.map((i) => (
                  <span key={i.id} className="text-xs bg-white text-blue-700 border border-blue-200 rounded-full px-2.5 py-1">
                    {i.name}
                  </span>
                ))}
              </div>
              {audienceInfo.reasoning && <div className="text-xs text-blue-600">{audienceInfo.reasoning}</div>}
            </>
          )}
        </div>
      )}
      {result && (
        <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
          สร้างสำเร็จ {result.created_copies} copy และ {result.created_images} รูป — ไปดูที่แท็บ "รออนุมัติ" ได้เลย
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Review (approval) tab
// ---------------------------------------------------------------
async function readFunctionErrorMessage(error) {
  // supabase-js ไม่ใส่ error message จริงจาก Edge Function ไว้ใน error.message ตรงๆ
  // ต้องดึง response body จาก error.context (FunctionsHttpError) เพื่ออ่านข้อความจริงที่ฟังก์ชันส่งกลับมา
  // แปลงค่า error เป็นข้อความเสมอ (บางแพลตฟอร์มส่ง error เป็น object -> กัน "[object Object]")
  const toMsg = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object") return v.message || v.msg || v.error_description || JSON.stringify(v);
    return String(v);
  };
  try {
    if (error?.context?.json) {
      const body = await error.context.json();
      const m = toMsg(body?.error) || toMsg(body?.message);
      if (m) return m;
    } else if (error?.context?.text) {
      const text = await error.context.text();
      if (text) return text;
    }
  } catch {
    // เผื่ออ่าน body ซ้ำไม่ได้ (เช่นถูกอ่านไปแล้ว) — ใช้ fallback ด้านล่างแทน
  }
  return toMsg(error?.message) || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ";
}

function ScoreBadge({ score }) {
  if (score === null || score === undefined) return null;
  const tone = score >= 75 ? "bg-emerald-100 text-emerald-700" : score >= 50 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${tone}`}>{Math.round(score)}</span>;
}

function CopyCard({ item, selected, onToggle }) {
  return (
    <div
      onClick={() => onToggle(item.id)}
      className={`rounded-xl border p-3 cursor-pointer transition ${
        selected ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-slate-800 text-sm">{item.headline}</div>
        <ScoreBadge score={item.ai_score} />
      </div>
      <div className="text-xs text-slate-600 mt-1 whitespace-pre-line">{item.primary_text}</div>
      <div className="text-xs text-slate-400 mt-1">CTA: {item.cta}</div>
      {item.ai_rationale && <div className="text-xs text-blue-600 mt-1.5">{item.ai_rationale}</div>}
    </div>
  );
}

function ImageCard({ item, selected, onToggle }) {
  return (
    <div
      onClick={() => onToggle(item.id)}
      className={`rounded-xl border overflow-hidden cursor-pointer transition ${
        selected ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div className="aspect-square bg-slate-100 flex items-center justify-center relative">
        {item.image_url ? (
          <img src={item.image_url} alt={item.image_prompt} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="text-slate-300" size={32} />
        )}
        <div className="absolute top-1.5 right-1.5">
          <ScoreBadge score={item.ai_score} />
        </div>
      </div>
      {item.ai_rationale && <div className="text-xs text-blue-600 p-1.5">{item.ai_rationale}</div>}
    </div>
  );
}

function ReviewTab({ adCopies, adImages, onChanged, brandConfig }) {
  const brandOptions = Array.isArray(brandConfig?.brands) ? brandConfig.brands : [];
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const brandNameFor = (brandId) => {
    if (!brandId) return "ไม่ระบุแบรนด์";
    return brandOptions.find((brand) => brand.id === brandId)?.name || `แบรนด์ ${brandId}`;
  };
  const matchesBrand = (item) => {
    if (!selectedBrandId) return true;
    if (selectedBrandId === "__unassigned") return !item.brand_id;
    return item.brand_id === selectedBrandId;
  };
  const pendingCopies = adCopies
    .filter((c) => c.status === "pending_approval" && matchesBrand(c))
    .sort((a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1));
  const pendingImages = adImages
    .filter((im) => im.status === "pending_approval" && matchesBrand(im))
    .sort((a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1));

  const totalPending = adCopies.filter((c) => c.status === "pending_approval").length + adImages.filter((im) => im.status === "pending_approval").length;

  const [selectedCopyIds, setSelectedCopyIds] = useState([]);
  const [selectedImageIds, setSelectedImageIds] = useState([]);
  const [scoring, setScoring] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [textModel, setTextModel] = useState("openai");
  const [suggestion, setSuggestion] = useState(null); // { pairs, suggested_mode, mode_rationale }
  const [mode, setMode] = useState("separate_campaigns");
  const [manualPairs, setManualPairs] = useState([]); // [{copy_id, image_id}] ใช้เมื่อไม่ได้ตาม suggestion

  function toggleCopy(id) {
    setSelectedCopyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSuggestion(null);
  }
  function toggleImage(id) {
    setSelectedImageIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSuggestion(null);
  }

  async function handleScore() {
    setScoring(true);
    setError("");
    const { error: fnError } = await supabase.functions.invoke("score-ad-assets", {
      body: { text_model: textModel },
    });
    setScoring(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    onChanged?.();
  }

  async function handleSuggestPairing() {
    if (!selectedCopyIds.length || !selectedImageIds.length) {
      setError("ต้องเลือกอย่างน้อย 1 copy และ 1 รูป ก่อนขอคำแนะนำ");
      return;
    }
    setSuggesting(true);
    setError("");
    setSuggestion(null);
    const { data, error: fnError } = await supabase.functions.invoke("ai-suggest-pairing", {
      body: { copy_ids: selectedCopyIds, image_ids: selectedImageIds, text_model: textModel },
    });
    setSuggesting(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    if (!data?.ok) {
      setError(data?.error || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ");
      return;
    }
    setSuggestion(data);
    setMode(data.suggested_mode || "separate_campaigns");
  }

  // จับคู่แบบง่าย (ไม่ผ่าน AI) เผื่อแอดมินอยากลอนช์เองตรงๆ โดยจับคู่ตามลำดับที่เลือกไว้
  function buildManualPairs() {
    const n = Math.min(selectedCopyIds.length, selectedImageIds.length);
    const pairs = [];
    for (let i = 0; i < n; i++) {
      pairs.push({ copy_id: selectedCopyIds[i], image_id: selectedImageIds[i] });
    }
    return pairs;
  }

  async function handleLaunch() {
    const pairs = suggestion?.pairs?.length
      ? suggestion.pairs.map((p) => ({ copy_id: p.copy_id, image_id: p.image_id }))
      : buildManualPairs();
    if (!pairs.length) {
      setError("ยังไม่มีคู่ที่จะลอนช์ — เลือก copy และรูปให้ครบ หรือขอคำแนะนำจาก AI ก่อน");
      return;
    }
    setLaunching(true);
    setError("");
    setNotice("");
    const { data, error: fnError } = await supabase.functions.invoke("launch-campaign", {
      body: { action: "launch", pairs, mode },
    });
    setLaunching(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    setNotice(`ลอนช์สำเร็จ ${data.launched} แคมเปญ/โฆษณา (โหมด: ${mode === "separate_campaigns" ? "แยกแคมเปญ" : "รวมแคมเปญเดียว"})`);
    setSelectedCopyIds([]);
    setSelectedImageIds([]);
    setSuggestion(null);
    onChanged?.();
  }

  async function handleReject(kind, id) {
    return handleRejectMany(kind, [id]);
  }

  // ลบได้ทีละหลายรายการพร้อมกัน — เรียก launch-campaign action "reject" วนทีละ id
  // (ฝั่ง Edge Function เดิมรองรับแค่ id เดียวต่อคำขอ ยังไม่คุ้มค่าที่จะแก้ backend สำหรับแค่การลบ)
  const [rejectingCopies, setRejectingCopies] = useState(false);
  const [rejectingImages, setRejectingImages] = useState(false);

  async function handleRejectMany(kind, ids) {
    if (!ids.length) return;
    setError("");
    if (kind === "copy") setRejectingCopies(true);
    else setRejectingImages(true);

    const failed = [];
    for (const id of ids) {
      const { error: fnError } = await supabase.functions.invoke("launch-campaign", {
        body: { action: "reject", [kind === "copy" ? "copy_id" : "image_id"]: id },
      });
      if (fnError) failed.push(id);
    }

    // เอาเฉพาะ id ที่ "ลบสำเร็จแล้ว" ออกจากรายการที่เลือกไว้ — id ที่ลบไม่สำเร็จ (อยู่ใน failed) ให้ยังคงเลือกอยู่เหมือนเดิม
    const succeededIds = ids.filter((id) => !failed.includes(id));
    if (kind === "copy") {
      setRejectingCopies(false);
      setSelectedCopyIds((prev) => prev.filter((x) => !succeededIds.includes(x)));
    } else {
      setRejectingImages(false);
      setSelectedImageIds((prev) => prev.filter((x) => !succeededIds.includes(x)));
    }

    if (failed.length) {
      setError(`ลบไม่สำเร็จ ${failed.length} รายการ`);
    }
    onChanged?.();
  }

  function handleDeleteSelected(kind) {
    const ids = kind === "copy" ? selectedCopyIds : selectedImageIds;
    if (!ids.length) return;
    if (!confirm(`ยืนยันลบ${kind === "copy" ? " copy" : "รูป"}ที่เลือกไว้ ${ids.length} รายการ?`)) return;
    handleRejectMany(kind, ids);
  }

  function handleDeleteAll(kind) {
    const ids = (kind === "copy" ? pendingCopies : pendingImages).map((x) => x.id);
    if (!ids.length) return;
    if (!confirm(`ยืนยันลบ${kind === "copy" ? " copy" : "รูป"}รออนุมัติทั้งหมด ${ids.length} รายการ? ทำแล้วกู้คืนไม่ได้`)) return;
    handleRejectMany(kind, ids);
  }

  if (totalPending === 0) {
    return <div className="text-sm text-slate-500 py-10 text-center">ยังไม่มีคอนเทนต์รออนุมัติ — ไปสร้างที่แท็บ "สร้างคอนเทนต์" ได้เลย</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          แบรนด์ CI
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-44"
            value={selectedBrandId}
            onChange={(e) => {
              setSelectedBrandId(e.target.value);
              setSelectedCopyIds([]);
              setSelectedImageIds([]);
              setSuggestion(null);
            }}
          >
            <option value="">ทุกแบรนด์ ({totalPending})</option>
            {brandOptions.map((brand) => {
              const count = adCopies.filter((item) => item.status === "pending_approval" && item.brand_id === brand.id).length
                + adImages.filter((item) => item.status === "pending_approval" && item.brand_id === brand.id).length;
              return <option key={brand.id} value={brand.id}>{brand.name} ({count})</option>;
            })}
            <option value="__unassigned">ไม่ระบุแบรนด์ ({adCopies.filter((item) => item.status === "pending_approval" && !item.brand_id).length + adImages.filter((item) => item.status === "pending_approval" && !item.brand_id).length})</option>
          </select>
        </label>
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          value={textModel}
          onChange={(e) => setTextModel(e.target.value)}
        >
          <option value="claude">Claude (ต้องมี API key)</option>
          <option value="openai">OpenAI (GPT-5)</option>
        </select>
        <button
          onClick={handleScore}
          disabled={scoring}
          className="flex items-center gap-1.5 text-sm bg-slate-900 text-white rounded-lg px-4 py-2 font-medium hover:bg-slate-800 disabled:opacity-60"
        >
          {scoring ? <Loader2 className="animate-spin" size={15} /> : <Wand2 size={15} />}
          ให้ AI ให้คะแนนทั้งหมด
        </button>
        <button
          onClick={handleSuggestPairing}
          disabled={suggesting || !selectedCopyIds.length || !selectedImageIds.length}
          className="flex items-center gap-1.5 text-sm bg-blue-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          {suggesting ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
          ให้ AI แนะนำการจับคู่ ({selectedCopyIds.length} copy × {selectedImageIds.length} รูป)
        </button>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{notice}</div>}

      {suggestion && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-2">
          <div className="text-sm font-semibold text-blue-800">คำแนะนำจาก AI</div>
          <div className="text-sm text-blue-700">{suggestion.mode_rationale}</div>
          <ul className="text-xs text-blue-700 space-y-1 pl-4 list-disc">
            {(suggestion.pairs || []).map((p, i) => (
              <li key={i}>
                {adCopies.find((c) => c.id === p.copy_id)?.headline || p.copy_id} × รูป #{i + 1} — {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="text-sm font-semibold text-slate-800">โหมดการลอนช์</div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="radio" checked={mode === "separate_campaigns"} onChange={() => setMode("separate_campaigns")} />
            แยกเป็นหลายแคมเปญ (งบแยกอิสระ เทียบผลตรงๆ)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="radio" checked={mode === "single_campaign_multi_ad"} onChange={() => setMode("single_campaign_multi_ad")} />
            รวมแคมเปญเดียว หลายโฆษณา (งบก้อนเดียว ให้ Meta หมุนเอง)
          </label>
        </div>
        <button
          onClick={handleLaunch}
          disabled={launching || (!selectedCopyIds.length && !suggestion)}
          className="flex items-center gap-1.5 text-sm bg-emerald-600 text-white rounded-lg px-5 py-2.5 font-medium hover:bg-emerald-700 disabled:opacity-60"
        >
          {launching ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
          ยืนยันลอนช์
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-slate-700">Copy รออนุมัติ ({pendingCopies.length})</h3>
            <div className="flex items-center gap-2">
              {selectedCopyIds.length > 0 && (
                <button
                  onClick={() => handleDeleteSelected("copy")}
                  disabled={rejectingCopies}
                  className="flex items-center gap-1 text-xs bg-rose-50 text-rose-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-rose-100 disabled:opacity-60"
                >
                  <Trash2 size={13} />
                  ลบที่เลือก ({selectedCopyIds.length})
                </button>
              )}
              {pendingCopies.length > 0 && (
                <button
                  onClick={() => handleDeleteAll("copy")}
                  disabled={rejectingCopies}
                  className="flex items-center gap-1 text-xs bg-slate-100 text-slate-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-slate-200 disabled:opacity-60"
                >
                  {rejectingCopies ? <Loader2 className="animate-spin" size={13} /> : <Trash2 size={13} />}
                  ลบทั้งหมด
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {pendingCopies.map((item) => (
              <div key={item.id} className="relative group">
                <div className="mb-1 px-1 text-[11px] font-medium text-indigo-600">แบรนด์: {brandNameFor(item.brand_id)}</div>
                <CopyCard item={item} selected={selectedCopyIds.includes(item.id)} onToggle={toggleCopy} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReject("copy", item.id);
                  }}
                  className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"
                  title="ปฏิเสธ copy นี้"
                >
                  <XCircle size={16} />
                </button>
              </div>
            ))}
            {pendingCopies.length === 0 && <div className="text-xs text-slate-400 py-4 text-center">ไม่มี copy รออนุมัติ</div>}
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-slate-700">รูปรออนุมัติ ({pendingImages.length})</h3>
            <div className="flex items-center gap-2">
              {selectedImageIds.length > 0 && (
                <button
                  onClick={() => handleDeleteSelected("image")}
                  disabled={rejectingImages}
                  className="flex items-center gap-1 text-xs bg-rose-50 text-rose-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-rose-100 disabled:opacity-60"
                >
                  <Trash2 size={13} />
                  ลบที่เลือก ({selectedImageIds.length})
                </button>
              )}
              {pendingImages.length > 0 && (
                <button
                  onClick={() => handleDeleteAll("image")}
                  disabled={rejectingImages}
                  className="flex items-center gap-1 text-xs bg-slate-100 text-slate-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-slate-200 disabled:opacity-60"
                >
                  {rejectingImages ? <Loader2 className="animate-spin" size={13} /> : <Trash2 size={13} />}
                  ลบทั้งหมด
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">
            AI สร้างข้อความภาษาไทยในรูปได้ไม่แม่นยำ 100% — ซูมเช็คตัวสะกดในรูปก่อนเลือกใช้เสมอ
          </div>
          <div className="grid grid-cols-2 gap-2">
            {pendingImages.map((item) => (
              <div key={item.id} className="relative group">
                <div className="mb-1 px-1 text-[11px] font-medium text-indigo-600">แบรนด์: {brandNameFor(item.brand_id)}</div>
                <ImageCard item={item} selected={selectedImageIds.includes(item.id)} onToggle={toggleImage} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReject("image", item.id);
                  }}
                  className="absolute top-1.5 left-1.5 bg-white/90 rounded-full p-0.5 text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"
                  title="ปฏิเสธรูปนี้"
                >
                  <XCircle size={16} />
                </button>
              </div>
            ))}
            {pendingImages.length === 0 && <div className="text-xs text-slate-400 py-4 text-center col-span-2">ไม่มีรูปรออนุมัติ</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Campaigns (monitor) tab
// ---------------------------------------------------------------
// กล่องแจ้งเตือน "แชทผี" + ปุ่มอนุมัติหยุด/ไม่ใช่แชทผี (โหมด alert — รอแอดมินตัดสิน)
function GhostAlert({ item, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!item.ghost_flagged) return null;

  async function resolve(action) {
    setBusy(true);
    setError("");
    const { error: fnError } = await supabase.functions.invoke("resolve-ghost", {
      body: { ad_content_id: item.id, action },
    });
    setBusy(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    onChanged?.();
  }

  return (
    <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 space-y-2">
      <div className="text-sm text-rose-700 flex gap-1.5">
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <span>👻 {item.ghost_reason || "สงสัยว่าเป็นแชทผี (ทักแล้วเงียบ)"}</span>
      </div>
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => resolve("pause")}
          className="text-xs bg-rose-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-rose-700 disabled:opacity-60 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="animate-spin" size={13} /> : <PauseCircle size={13} />}
          อนุมัติให้หยุด
        </button>
        <button
          disabled={busy}
          onClick={() => resolve("dismiss")}
          className="text-xs bg-white border border-rose-200 text-rose-700 rounded-lg px-3 py-1.5 font-medium hover:bg-rose-100 disabled:opacity-60"
        >
          ไม่ใช่แชทผี (คงไว้)
        </button>
      </div>
      {error && <div className="text-xs text-rose-600">{error}</div>}
    </div>
  );
}

function CampaignRow({ item, latestMetric, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function respondScale(approve) {
    setBusy(true);
    setError("");
    const { error: fnError } = await supabase.functions.invoke("scale-budget", {
      body: { ad_content_id: item.id, approve },
    });
    setBusy(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    onChanged?.();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-slate-800">{item.headline}</div>
          <div className="text-xs text-slate-400 mt-0.5">
            งบ/วัน: {item.daily_budget_thb ?? "-"} บาท · Ad ID: {item.ad_id || "-"}
          </div>
        </div>
        <StatusBadge status={item.status} />
      </div>
      {latestMetric && (
        <div className="flex gap-4 text-sm text-slate-600 pt-1">
          <span>Spend: {latestMetric.spend?.toLocaleString?.() ?? latestMetric.spend}</span>
          <span>Leads: {latestMetric.leads}</span>
          <span>CPA: {latestMetric.cpa ? Math.round(latestMetric.cpa).toLocaleString() : "-"}</span>
        </div>
      )}
      {item.status === "paused_auto" && item.notes && (
        <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5">{item.notes}</div>
      )}
      <GhostAlert item={item} onChanged={onChanged} />
      {error && <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5">{error}</div>}
      {item.scale_suggested && (
        <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2 mt-2">
          <div className="text-sm text-blue-700 flex items-center gap-1.5">
            <ArrowUpCircle size={16} />
            เสนอเพิ่มงบเป็น {item.suggested_budget_thb} บาท/วัน
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => respondScale(true)}
              className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              อนุมัติ
            </button>
            <button
              disabled={busy}
              onClick={() => respondScale(false)}
              className="text-xs bg-white border border-blue-200 text-blue-700 rounded-lg px-3 py-1.5 font-medium hover:bg-blue-100 disabled:opacity-60"
            >
              ข้ามไปก่อน
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- ล้างรายการ (ซ่อน) แบบติ๊กเลือก — ใช้ร่วมกันทั้งหน้าแคมเปญและหน้าวิเคราะห์ ----
// ไม่ลบข้อมูลจริง เพราะ metrics_log ผูกแบบ cascade (ลบแอด = ประวัติผลหายถาวร)
// ใช้ธง archived_at แทน → หายจากรายการ แต่กดกู้คืนได้ตลอด
function useArchive(onChanged) {
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const isSel = (id) => sel.includes(id);
  async function run(ids, restore) {
    if (!ids.length) return;
    setBusy(true); setMsg("");
    const { error } = await supabase.from("ad_content")
      .update({ archived_at: restore ? null : new Date().toISOString() })
      .in("id", ids);
    setBusy(false);
    if (error) { setMsg(`ไม่สำเร็จ: ${error.message}`); return; }
    setMsg(restore ? `กู้คืนแล้ว ${ids.length} รายการ` : `ซ่อนแล้ว ${ids.length} รายการ (กดดูที่ซ่อนไว้เพื่อกู้คืน)`);
    setSel([]);
    onChanged?.();
    setTimeout(() => setMsg(""), 4000);
  }
  return { sel, setSel, toggle, isSel, busy, msg, showArchived, setShowArchived, archive: (ids) => run(ids, false), restore: (ids) => run(ids, true) };
}

// แถบเครื่องมือด้านบนรายการ: เลือกทั้งหมด/ล้างที่เลือก/สลับดูที่ซ่อนไว้
function ArchiveBar({ a, visibleIds, archivedCount }) {
  const allSel = visibleIds.length > 0 && visibleIds.every((id) => a.isSel(id));
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      {visibleIds.length > 0 && (
        <button onClick={() => a.setSel(allSel ? [] : visibleIds)} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">
          {allSel ? "เอาออกทั้งหมด" : `เลือกทั้งหมด (${visibleIds.length})`}
        </button>
      )}
      {a.sel.length > 0 && (
        <>
          <span className="text-slate-500">เลือกไว้ {a.sel.length} รายการ</span>
          {a.showArchived ? (
            <button onClick={() => a.restore(a.sel)} disabled={a.busy} className="rounded-lg bg-emerald-600 text-white px-3 py-1 font-medium hover:bg-emerald-700 disabled:opacity-50">
              {a.busy ? "กำลังกู้คืน..." : "กู้คืนที่เลือก"}
            </button>
          ) : (
            <button onClick={() => a.archive(a.sel)} disabled={a.busy} className="rounded-lg bg-rose-600 text-white px-3 py-1 font-medium hover:bg-rose-700 disabled:opacity-50">
              {a.busy ? "กำลังซ่อน..." : `ล้างที่เลือก (${a.sel.length})`}
            </button>
          )}
          <button onClick={() => a.setSel([])} className="text-slate-400 hover:text-slate-600">ยกเลิก</button>
        </>
      )}
      <button
        onClick={() => { a.setShowArchived(!a.showArchived); a.setSel([]); }}
        className={`rounded-lg border px-2 py-1 ml-auto ${a.showArchived ? "bg-slate-800 text-white border-slate-800" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}
      >
        {a.showArchived ? "← กลับไปรายการปกติ" : `ดูที่ซ่อนไว้ (${archivedCount})`}
      </button>
      {a.msg && <span className={a.msg.startsWith("ไม่สำเร็จ") ? "text-rose-600 w-full" : "text-emerald-600 w-full"}>{a.msg}</span>}
    </div>
  );
}

function CampaignsTab({ adContent, metricsByAdId, onChanged, filter = "all", onFilterChange }) {
  const arch = useArchive(onChanged);
  // แยกรายการที่ถูกซ่อนออกจากรายการปกติ — สลับดูได้จากปุ่ม "ดูที่ซ่อนไว้"
  const archivedAll = adContent.filter((a) => a.archived_at);
  const pool = adContent.filter((a) => (arch.showArchived ? a.archived_at : !a.archived_at));

  const launched = pool.filter((a) => a.status === "active" || a.status === "paused_auto");
  const filters = [
    { key: "all", label: "ทั้งหมด", count: launched.length },
    { key: "active", label: "กำลังใช้งาน", count: pool.filter((a) => a.status === "active").length },
    { key: "paused_auto", label: "หยุดอัตโนมัติ", count: pool.filter((a) => a.status === "paused_auto").length },
    { key: "scale", label: "รออนุมัติเพิ่มงบ", count: pool.filter((a) => a.scale_suggested).length },
  ];

  let campaigns;
  if (filter === "active") campaigns = pool.filter((a) => a.status === "active");
  else if (filter === "paused_auto") campaigns = pool.filter((a) => a.status === "paused_auto");
  else if (filter === "scale") campaigns = pool.filter((a) => a.scale_suggested);
  else campaigns = launched;

  return (
    <div className="space-y-3">
      <ArchiveBar a={arch} visibleIds={campaigns.map((c) => c.id)} archivedCount={archivedAll.length} />
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilterChange?.(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium border transition ${
              filter === f.key
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>
      {campaigns.length === 0 ? (
        <div className="text-sm text-slate-500 py-10 text-center">
          {arch.showArchived ? "ไม่มีรายการที่ซ่อนไว้ในหมวดนี้" : "ยังไม่มีแคมเปญในหมวดนี้"}
        </div>
      ) : (
        campaigns.map((item) => (
          <div key={item.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={arch.isSel(item.id)}
              onChange={() => arch.toggle(item.id)}
              className="w-4 h-4 mt-4 shrink-0 cursor-pointer"
              title={arch.showArchived ? "เลือกเพื่อกู้คืน" : "เลือกเพื่อซ่อนออกจากรายการ"}
            />
            <div className="flex-1 min-w-0">
              <CampaignRow item={item} latestMetric={metricsByAdId[item.id]} onChanged={onChanged} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Analyze tab (วิเคราะห์ผลโฆษณา)
// ---------------------------------------------------------------
const VERDICT_META = {
  underperform: { label: "ต่ำกว่าเป้า", cls: "bg-rose-100 text-rose-700", Icon: ArrowDownCircle },
  outperform: { label: "ดีเกินเป้า", cls: "bg-emerald-100 text-emerald-700", Icon: ArrowUpCircle },
  on_target: { label: "ตามเป้า", cls: "bg-blue-100 text-blue-700", Icon: CheckCircle2 },
  insufficient_data: { label: "ข้อมูลยังน้อย", cls: "bg-slate-100 text-slate-600", Icon: Minus },
};

function VerdictBadge({ verdict }) {
  const m = VERDICT_META[verdict];
  if (!m) return null;
  const { label, cls, Icon } = m;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${cls}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("th-TH", { maximumFractionDigits: digits });
}

// ---------------------------------------------------------------
// แดชบอร์ดเจาะลึกรายแอด (charts / gauges แบบ SVG ไม่พึ่งไลบรารีนอก)
// ---------------------------------------------------------------
function KpiTile({ label, value, sub, tone = "slate", secondaryLabel, secondaryValue }) {
  const tones = { slate: "text-slate-800", green: "text-emerald-600", rose: "text-rose-600", blue: "text-blue-600", amber: "text-amber-600" };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 min-w-0">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums break-words ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
      {secondaryLabel && secondaryValue != null && (
        <div className="mt-2 pt-2 border-t border-slate-200/80 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span className="text-[11px] text-slate-500">{secondaryLabel}</span>
          <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${tones[tone]}`}>{secondaryValue}</span>
        </div>
      )}
    </div>
  );
}

function GaugeMeter({ value, max = 100, label, display, tone = "#9D6BFF" }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = 52, cx = 70, cy = 66;
  const pt = (frac) => {
    const t = Math.PI * (1 - frac); // left(π)->right(0)
    return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  };
  const [lx, ly] = pt(0);
  const [ex, ey] = pt(pct);
  const [rx, ry] = pt(1);
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 84" className="w-full max-w-[150px]">
        <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${rx} ${ry}`} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="12" strokeLinecap="round" />
        <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke={tone} strokeWidth="12" strokeLinecap="round" />
        <text x="70" y="60" textAnchor="middle" className="fill-slate-800" style={{ fontSize: 18, fontWeight: 700 }}>{display}</text>
      </svg>
      <div className="text-xs text-slate-500 -mt-1">{label}</div>
    </div>
  );
}

function BarList({ items, valueKey = "impressions", labelMap, format, tone = "#9D6BFF", empty = "ไม่มีข้อมูล" }) {
  const list = (items || []).filter((i) => (i[valueKey] || 0) > 0).sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
  if (list.length === 0) return <div className="text-xs text-slate-400 py-3 text-center">{empty}</div>;
  const maxVal = Math.max(1, ...list.map((i) => i[valueKey] || 0));
  return (
    <div className="space-y-1.5">
      {list.map((it) => {
        const v = it[valueKey] || 0;
        const label = labelMap ? labelMap(it.key) : it.key;
        return (
          <div key={it.key} className="flex items-center gap-2 text-xs">
            <div className="w-24 shrink-0 truncate text-slate-600" title={label}>{label}</div>
            <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
              <div className="h-3 rounded-full" style={{ width: `${(v / maxVal) * 100}%`, background: tone }} />
            </div>
            <div className="w-16 shrink-0 text-right text-slate-700">{format ? format(v, it) : fmtNum(v)}</div>
          </div>
        );
      })}
    </div>
  );
}

// รายการแท่งแบบหลายมิติพร้อมกัน — แต่ละมิติเป็นสีของตัวเอง (แต่ละมิติสเกลตามค่าสูงสุดของตัวเอง)
function BarListMulti({ items, metrics, labelMap, empty = "ไม่มีข้อมูล" }) {
  const list = (items || []).filter((i) => metrics.some((m) => (i[m.key] || 0) > 0));
  if (list.length === 0) return <div className="text-xs text-slate-400 py-3 text-center">{empty}</div>;
  const sortVal = (i) => metrics.reduce((s, m) => s + (i[m.key] || 0), 0);
  const sorted = [...list].sort((a, b) => sortVal(b) - sortVal(a));
  const single = metrics.length === 1;
  // มิติเดียว: หลอดสเกลตามค่าสูงสุด (ดูการกระจายในมิติเดียว)
  // หลายมิติ: หลอด = สัดส่วน % ภายในมิตินั้น เพื่อเทียบข้ามมิติได้ (ค่าคนละสเกลกัน)
  const maxByKey = {}, totalByKey = {};
  metrics.forEach((m) => {
    maxByKey[m.key] = Math.max(1, ...sorted.map((i) => i[m.key] || 0));
    totalByKey[m.key] = Math.max(1, sorted.reduce((s, i) => s + (i[m.key] || 0), 0));
  });
  return (
    <div className="space-y-2.5">
      {sorted.map((it) => {
        const label = labelMap ? labelMap(it.key) : it.key;
        return (
          <div key={it.key} className="text-xs">
            <div className="text-slate-600 mb-1 truncate" title={label}>{label}</div>
            <div className="space-y-1">
              {metrics.map((m) => {
                const v = it[m.key] || 0;
                const pct = (v / totalByKey[m.key]) * 100;
                const width = single ? (v / maxByKey[m.key]) * 100 : pct;
                return (
                  <div key={m.key} className="flex items-center gap-2">
                    {!single && <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: m.color }} title={m.label} />}
                    <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div className="h-2.5 rounded-full" style={{ width: `${width}%`, background: m.color }} />
                    </div>
                    <div className="w-20 shrink-0 text-right text-slate-700">
                      {fmtNum(v)}{!single && <span className="text-slate-400"> · {Math.round(pct)}%</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GenderDonut({ gender, valueKey = "impressions" }) {
  const items = (gender || []).filter((g) => (g[valueKey] || 0) > 0);
  const total = items.reduce((s, g) => s + (g[valueKey] || 0), 0);
  if (total === 0) return <div className="text-xs text-slate-400 py-3 text-center">ไม่มีข้อมูล</div>;
  const colors = { male: "#3b82f6", female: "#ec4899", unknown: "#94a3b8" };
  const labels = { male: "ชาย", female: "หญิง", unknown: "ไม่ระบุ" };
  const C = 2 * Math.PI * 42;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0">
        <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="16" />
        {items.map((g) => {
          const frac = (g[valueKey] || 0) / total;
          const seg = (
            <circle
              key={g.key}
              cx="60" cy="60" r="42" fill="none"
              stroke={colors[g.key] || "#94a3b8"} strokeWidth="16"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += frac * C;
          return seg;
        })}
      </svg>
      <div className="space-y-1 text-xs">
        {items.map((g) => (
          <div key={g.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[g.key] || "#94a3b8" }} />
            <span className="text-slate-600">{labels[g.key] || g.key}</span>
            <span className="text-slate-400">{Math.round(((g[valueKey] || 0) / total) * 100)}%</span>
            <span className="text-slate-300">· {fmtNum(g[valueKey] || 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// กราฟเทรนด์รายวัน — มีแกน X (วันที่) / แกน Y (ค่า) + เส้นกริด, รองรับหลายเส้นพร้อมกัน
function DailyMultiChart({ points, series }) {
  const data = points || [];
  if (data.length === 0) return <div className="text-xs text-slate-400 py-6 text-center">ไม่มีข้อมูลรายวัน</div>;
  const list = (series || []).length ? series : [{ key: "spend", label: "ค่าใช้จ่าย", color: "#9D6BFF" }];
  const single = list.length === 1;
  const W = 640, H = 220, mL = 46, mR = 14, mT = 12, mB = 28;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const n = data.length;
  const x = (i) => mL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const maxByKey = {};
  list.forEach((s) => { maxByKey[s.key] = Math.max(1, ...data.map((d) => d[s.key] || 0)); });
  // แกน Y: มิติเดียว = ค่าจริง, หลายมิติ = 0-100% (แต่ละเส้นเทียบจุดสูงสุดของตัวเอง)
  const yTop = single ? maxByKey[list[0].key] : 1;
  const yOf = (v, key) => mT + plotH - (single ? v / yTop : v / maxByKey[key]) * plotH;
  const yTicks = [0, 0.5, 1].map((f) => ({ yy: mT + plotH - f * plotH, label: single ? fmtNum(yTop * f) : `${Math.round(f * 100)}%` }));
  const fmtDate = (ds) => { if (!ds) return ""; const p = String(ds).split("-"); return p.length === 3 ? `${+p[2]}/${+p[1]}` : ds; };
  const step = Math.max(1, Math.ceil(n / 5));
  const xTicks = [];
  for (let i = 0; i < n; i += step) xTicks.push(i);
  if (n > 1 && xTicks[xTicks.length - 1] !== n - 1) xTicks.push(n - 1);
  return (
    <div>
      {!single && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
          {list.map((s) => (
            <div key={s.key} className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label} <span className="text-slate-400">· สูงสุด {fmtNum(maxByKey[s.key])}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-slate-500" style={{ height: "auto" }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={mL} y1={t.yy} x2={W - mR} y2={t.yy} stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
            <text x={mL - 6} y={t.yy + 3} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.7">{t.label}</text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 9} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.7">{fmtDate(data[i]?.date)}</text>
        ))}
        {list.map((s) => {
          const pts = data.map((d, i) => `${x(i)},${yOf(d[s.key] || 0, s.key)}`).join(" ");
          const area = `${x(0)},${mT + plotH} ${pts} ${x(n - 1)},${mT + plotH}`;
          return (
            <g key={s.key}>
              {single && <polygon points={area} fill={s.color} opacity="0.12" />}
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
      <div className="text-[10px] text-slate-400 text-center mt-1">
        แกนนอน = วันที่ · แกนตั้ง = {single ? list[0].label : "สัดส่วน % เทียบจุดสูงสุดของแต่ละเส้น (ค่าจริงดูที่คำอธิบายด้านบน)"}
      </div>
    </div>
  );
}

function Funnel({ impressions, clicks, leads }) {
  const stages = [
    { label: "การมองเห็น (Impressions)", value: impressions, color: "#6366f1" },
    { label: "คลิก (Clicks)", value: clicks, color: "#0ea5e9" },
    { label: "ลีด (Leads)", value: leads, color: "#10b981" },
  ];
  const top = Math.max(1, impressions);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev && prev > 0 ? Math.round((s.value / prev) * 100 * 10) / 10 : null;
        return (
          <div key={s.label}>
            <div className="flex justify-between text-xs text-slate-600">
              <span>{s.label}</span>
              <span className="font-medium text-slate-800">
                {fmtNum(s.value)}
                {conv != null && <span className="text-slate-400 font-normal"> · {conv}%</span>}
              </span>
            </div>
            <div className="bg-slate-100 rounded-md h-5 mt-0.5 overflow-hidden">
              <div className="h-5 rounded-md" style={{ width: `${Math.max(2, (s.value / top) * 100)}%`, background: s.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const AGE_LABEL = (k) => k;
const REGION_LABEL = (k) => k;
const BD_METRIC_LABEL = { impressions: "การมองเห็น", leads: "ลีด", replies: "ตอบกลับจริง" };
const BD_METRIC_META = {
  impressions: { label: "การมองเห็น", color: "#0ea5e9" },
  leads: { label: "ลีด", color: "#10b981" },
  replies: { label: "ตอบกลับจริง", color: "#8b5cf6" },
};
const BD_KEYS = ["impressions", "leads", "replies"];
const GENDER_LABEL = (k) => ({ male: "ชาย", female: "หญิง", unknown: "ไม่ระบุ" }[k] || k);
// วัตถุประสงค์แคมเปญ (objective จาก Meta) -> ป้ายภาษาไทย
const OBJECTIVE_LABEL = (k) => {
  if (!k) return "";
  const m = {
    OUTCOME_LEADS: "หาลีด",
    OUTCOME_SALES: "ยอดขาย",
    OUTCOME_ENGAGEMENT: "การมีส่วนร่วม/ข้อความ",
    OUTCOME_TRAFFIC: "ทราฟฟิก",
    OUTCOME_AWARENESS: "การรับรู้",
    OUTCOME_APP_PROMOTION: "โปรโมทแอป",
    LEAD_GENERATION: "หาลีด",
    MESSAGES: "ข้อความ",
    CONVERSIONS: "คอนเวอร์ชัน",
    LINK_CLICKS: "คลิกลิงก์",
    POST_ENGAGEMENT: "มีส่วนร่วมโพสต์",
    PAGE_LIKES: "ไลก์เพจ",
    REACH: "การเข้าถึง",
    BRAND_AWARENESS: "การรับรู้แบรนด์",
    VIDEO_VIEWS: "ดูวิดีโอ",
    PRODUCT_CATALOG_SALES: "ขายสินค้าแคตตาล็อก",
    STORE_VISITS: "เข้าร้าน",
  };
  return m[k] || k;
};
const DEVICE_LABEL = (k) => {
  const m = { mobile_app: "แอปมือถือ", mobile_web: "เว็บมือถือ", desktop: "เดสก์ท็อป", mobile_tablet: "แท็บเล็ต" };
  return m[k] || k;
};

const DATE_PRESETS = [
  { value: "maximum", label: "มากที่สุด" },
  { value: "today", label: "วันนี้" },
  { value: "yesterday", label: "เมื่อวานนี้" },
  { value: "last_3d", label: "3 วันที่ผ่านมา" },
  { value: "last_7d", label: "7 วันที่ผ่านมา" },
  { value: "last_14d", label: "14 วันที่ผ่านมา" },
  { value: "last_28d", label: "28 วันที่ผ่านมา" },
  { value: "last_30d", label: "30 วันที่ผ่านมา" },
  { value: "last_90d", label: "90 วันที่ผ่านมา" },
  { value: "this_week_mon_today", label: "สัปดาห์นี้" },
  { value: "last_week_mon_sun", label: "สัปดาห์ที่แล้ว" },
  { value: "this_month", label: "เดือนนี้" },
  { value: "last_month", label: "เดือนที่แล้ว" },
  { value: "custom", label: "กำหนดเอง" },
];

// แปลงค่าช่วงวันเป็น body ที่ส่งให้ฟังก์ชัน (preset หรือ time_range)
function rangeToBody(r) {
  if (r?.preset === "custom" && r.since && r.until) return { time_range: { since: r.since, until: r.until } };
  return { date_preset: r?.preset || "last_30d" };
}
function rangeLabel(r) {
  if (r?.preset === "custom") return r.since && r.until ? `${r.since} - ${r.until}` : "กำหนดเอง";
  return DATE_PRESETS.find((p) => p.value === r?.preset)?.label || "";
}

// ตัวเลือกช่วงวันแบบ Meta (preset + กำหนดเองด้วยปฏิทิน)
function RangePicker({ value, onChange, disabled }) {
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <select
        value={value.preset}
        onChange={(e) => onChange({ ...value, preset: e.target.value })}
        disabled={disabled}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      {value.preset === "custom" && (
        <div className="flex items-center gap-1">
          <input type="date" value={value.since || ""} max={value.until || undefined} onChange={(e) => onChange({ ...value, since: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          <span className="text-xs text-slate-400">-</span>
          <input type="date" value={value.until || ""} min={value.since || undefined} onChange={(e) => onChange({ ...value, until: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
        </div>
      )}
    </div>
  );
}

// การ์ดลูก (ชุดโฆษณา/โฆษณา) สำหรับ drill-down — มีปุ่มแดชบอร์ด และกางดูลูกต่อได้
function DrillCard({ node, level, range, onDash }) {
  const [expanded, setExpanded] = useState(false);
  const isAdset = level === "adsets";
  const m = node.metrics || {};
  return (
    <div className={`rounded-lg border ${isAdset ? "border-indigo-100 bg-indigo-50/40" : "border-slate-200 bg-white"} p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          {isAdset ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-slate-600 hover:text-slate-900 mt-0.5 shrink-0"
              title={expanded ? "ซ่อนโฆษณา" : "ดูโฆษณาในชุดนี้"}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium text-slate-800 text-sm truncate">{node.name}</div>
            <div className="text-[11px] text-slate-400">
              {isAdset ? "ชุดโฆษณา" : "โฆษณา"} · {node.effective_status}
              {node.daily_budget_thb ? ` · งบ/วัน ${fmtNum(node.daily_budget_thb)}฿` : ""}
            </div>
          </div>
        </div>
        <button
          onClick={() => onDash({ ad_id: node.id, headline: node.name, level })}
          className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 text-slate-600 hover:bg-slate-50 flex items-center gap-1 shrink-0"
        >
          <BarChart3 size={13} /> แดชบอร์ด
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>Spend: <b>{fmtNum(m.spend)}฿</b></span>
        <span>Leads: <b>{fmtNum(m.leads)}</b></span>
        <span>CPL: <b>{m.cpl ? fmtNum(m.cpl) + "฿" : "—"}</b></span>
        <span>CTR: {fmtNum(m.ctr, 2)}%</span>
        <span>CPM: {fmtNum(m.cpm)}฿</span>
        <span>คลิก: {fmtNum(m.clicks)}</span>
        {m.reply_rate != null && <span className={m.reply_rate < 0.4 ? "text-rose-600" : ""}>อัตราตอบ: {Math.min(100, Math.round(m.reply_rate * 100))}%</span>}
      </div>
      {isAdset && expanded && (
        <div className="pl-3 border-l-2 border-indigo-200 mt-2">
          <ChildrenList parentId={node.id} level="ads" range={range} onDash={onDash} />
        </div>
      )}
    </div>
  );
}

// โหลดและแสดงรายการลูกของ node หนึ่ง (adsets ในแคมเปญ หรือ ads ในชุดโฆษณา)
function ChildrenList({ parentId, level, range, onDash }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nodes, setNodes] = useState([]);
  const rangeKey = JSON.stringify(rangeToBody(range));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const { data, error: fnError } = await supabase.functions.invoke("list-children", {
        body: { parent_id: parentId, level, ...rangeToBody(range) },
      });
      if (cancelled) return;
      setLoading(false);
      if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
      if (!data?.ok) { setError(data?.error || "โหลดไม่สำเร็จ"); return; }
      setNodes(data.nodes || []);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, level, rangeKey]);

  if (loading) return <div className="py-2"><Spinner label={level === "adsets" ? "กำลังโหลดชุดโฆษณา..." : "กำลังโหลดโฆษณา..."} /></div>;
  if (error) return <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5">{error}</div>;
  if (nodes.length === 0) return <div className="text-xs text-slate-400 py-2">{level === "adsets" ? "ไม่พบชุดโฆษณาในแคมเปญนี้" : "ไม่พบโฆษณาในชุดนี้"}</div>;

  return (
    <div className="space-y-2">
      {nodes.map((n) => (
        <DrillCard key={n.id} node={n} level={level} range={range} onDash={onDash} />
      ))}
    </div>
  );
}

// แปลง preset/ช่วงเป็นวันที่จริง (YYYY-MM-DD) เพื่อใช้แบ่ง segment
function presetToDates(range) {
  const fmt = bangkokDate;
  if (range.preset === "custom") return range.since && range.until ? { since: range.since, until: range.until } : null;
  const today = new Date();
  const back = (n) => { const x = new Date(today); x.setDate(x.getDate() - n); return x; };
  const nd = { last_3d: 3, last_7d: 7, last_14d: 14, last_30d: 30, last_90d: 90 };
  if (range.preset === "today") return { since: fmt(today), until: fmt(today) };
  if (range.preset === "yesterday") return { since: fmt(back(1)), until: fmt(back(1)) };
  if (nd[range.preset]) return { since: fmt(back(nd[range.preset] - 1)), until: fmt(today) };
  return null; // maximum/this_month/last_month → ไม่แบ่ง (โชว์แค่ log)
}
const dayMinus1 = (d) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

// แผงประวัติการเปลี่ยนแปลง + เทียบผลก่อน/หลังแก้
function ChangeComparePanel({ adId, range }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [segs, setSegs] = useState(null);
  const [err, setErr] = useState("");
  const dates = presetToDates(range);
  const key = JSON.stringify([adId, dates]);
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setErr(""); setSegs(null); setEvents([]);
      if (!adId) { setLoading(false); return; }
      const body = { node_id: adId };
      if (dates) { body.since = dates.since; body.until = dates.until; }
      const { data, error } = await supabase.functions.invoke("ad-activities", { body });
      if (cancel) return;
      if (error) { setErr(await readFunctionErrorMessage(error)); setLoading(false); return; }
      if (!data?.ok) { setErr(data?.error || ""); setLoading(false); return; }
      const evs = data.events || [];
      setEvents(evs);
      if (dates && evs.length) {
        const byDate = {};
        evs.forEach((e) => { const d = String(e.time).slice(0, 10); (byDate[d] = byDate[d] || []).push(e.label); });
        const chDates = Object.keys(byDate).filter((d) => d > dates.since && d <= dates.until).sort();
        if (chDates.length) {
          const segRanges = []; let start = dates.since;
          chDates.forEach((cd) => { const end = dayMinus1(cd); if (end >= start) segRanges.push({ since: start, until: end, label: segRanges.length === 0 ? `ก่อนแก้ (ถึง ${end})` : start }); start = cd; });
          segRanges.push({ since: start, until: dates.until, label: `หลังแก้ ${chDates[chDates.length - 1]} (${(byDate[chDates[chDates.length - 1]] || []).join(", ")})` });
          const { data: ins } = await supabase.functions.invoke("ad-insights", { body: { ad_id: adId, time_range: { since: dates.since, until: dates.until }, segments: segRanges } });
          if (cancel) return;
          if (ins?.ok && ins.segments) setSegs(ins.segments.map((s, i) => ({ ...s, label: segRanges[i]?.label || `${s.since}–${s.until}` })));
        }
      }
      setLoading(false);
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-4"><Spinner label="กำลังดึงประวัติการเปลี่ยนแปลง..." /></div>;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="font-medium text-slate-800 text-sm">การเปลี่ยนแปลง & เทียบผลก่อน/หลังแก้</div>
      {err && <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5">{err}</div>}
      {events.length === 0 && !err && <div className="text-xs text-slate-400">ไม่พบการเปลี่ยนแปลงในช่วงนี้</div>}

      {segs && segs.length >= 2 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 pr-2 font-medium">ช่วง</th><th className="py-1.5 px-2 font-medium">Spend</th><th className="py-1.5 px-2 font-medium">ลีด</th><th className="py-1.5 px-2 font-medium">ตอบกลับ</th><th className="py-1.5 px-2 font-medium">CPL</th><th className="py-1.5 px-2 font-medium">CTR</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {segs.map((s, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2 text-slate-700">{s.label}<div className="text-[10px] text-slate-400">{s.since} – {s.until}</div></td>
                  <td className="py-1.5 px-2">{fmtNum(s.overall.spend)}฿</td>
                  <td className="py-1.5 px-2">{fmtNum(s.overall.leads)}</td>
                  <td className="py-1.5 px-2">{fmtNum(s.overall.replies)}</td>
                  <td className="py-1.5 px-2">{s.overall.cpl ? fmtNum(s.overall.cpl) + "฿" : "—"}</td>
                  <td className="py-1.5 px-2">{fmtNum(s.overall.ctr, 2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-slate-400 mt-1.5">* 2-3 วันแรกหลังแก้ Meta อาจรีเซ็ตการเรียนรู้ (ตัวเลขแกว่ง) และลีดบางส่วนอาจ attribute คาบเกี่ยวช่วง</div>
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-slate-400">บันทึกการเปลี่ยนแปลง</div>
          {events.slice(0, 15).map((e, i) => (
            <div key={i} className="text-xs text-slate-600 flex gap-2">
              <span className="text-slate-400 shrink-0">{String(e.time).slice(0, 10)}</span>
              <span>{e.label}{e.actor ? ` · ${e.actor}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ประวัติการตั้งค่า (snapshot ที่เราเก็บเอง)
function ConfigHistoryPanel({ adId, refresh }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("ad_config_snapshots").select("*").eq("node_id", adId).order("captured_at", { ascending: false }).limit(20);
      setRows(data || []);
    })();
  }, [adId, refresh]);
  const fmtT = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); } catch { return t; } };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
      <div className="font-medium text-slate-800 text-sm">ประวัติการตั้งค่า (เก็บเองจากที่เปิดดู)</div>
      {rows === null ? <Spinner label="กำลังโหลด..." /> : rows.length === 0 ? (
        <div className="text-xs text-slate-400">ยังไม่มีประวัติ — ระบบเริ่มเก็บ snapshot ตั้งแต่ครั้งนี้เป็นต้นไป ทุกครั้งที่ค่าตั้งเปลี่ยน</div>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {rows.map((r, i) => (
            <div key={r.id} className="px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700">{r.summary || "(การตั้งค่า)"}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{i === 0 ? "ปัจจุบัน · " : ""}{fmtT(r.captured_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// รายละเอียดการตั้งค่าทั้งหมด (แคมเปญ/ชุดโฆษณา/โฆษณา) แบบเต็มไม่ตัด
function FullConfigPanel({ adId, level, onNavigate }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  // ไม่ดึงอัตโนมัติแล้ว (ลดการยิง Meta) — เปลี่ยน node = ล้างของเดิม รอกดปุ่มดึงเอง
  useEffect(() => { setData(null); setErr(""); setLoading(false); }, [adId, level]);
  async function load() {
    setLoading(true); setErr("");
    const { data: res, error } = await supabase.functions.invoke("ad-config-full", { body: { node_id: adId, level: level || "ad" } });
    setLoading(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!res?.ok) { setErr(res?.error || ""); return; }
    setData(res);
  }

  const Row = ({ label, value }) => {
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
    return <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">{label}</span><span className="text-slate-700 min-w-0 break-words whitespace-pre-wrap">{value}</span></div>;
  };
  const Chips = ({ items }) => !items?.length ? null : (
    <span className="flex flex-wrap gap-1">{items.map((x, i) => <span key={i} className="bg-slate-100 rounded px-1.5 py-0.5 text-[11px] text-slate-600">{x}</span>)}</span>
  );
  const budget = (a) => a.daily_budget_thb ? `${fmtNum(a.daily_budget_thb)}฿/วัน` : a.lifetime_budget_thb ? `${fmtNum(a.lifetime_budget_thb)}฿ ตลอด` : "—";
  const placeText = (p) => p === "advantage_plus_auto" ? "Advantage+ (อัตโนมัติ)" : null;

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-4"><Spinner label="กำลังดึงรายละเอียดการตั้งค่า..." /></div>;
  // ยังไม่ได้ดึง → โชว์ปุ่มให้กดดึงเอง (ไม่ยิง Meta อัตโนมัติ)
  if (!data) return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="font-medium text-slate-800 text-sm mb-2">รายละเอียดการตั้งค่าทั้งหมด</div>
      {err && <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5 mb-2">{err}</div>}
      <button onClick={load} className="text-xs bg-slate-900 text-white rounded-lg px-3 py-2 font-medium flex items-center gap-1.5 hover:bg-slate-800">
        <RefreshCw size={13} /> ดึงรายละเอียดการตั้งค่า
      </button>
      <div className="text-[11px] text-slate-400 mt-1.5">กดเพื่อดึงจาก Meta (ไม่ดึงอัตโนมัติ เพื่อลดการยิง API)</div>
    </div>
  );
  const c = data.campaign;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-slate-800 text-sm">รายละเอียดการตั้งค่าทั้งหมด</div>
        <button onClick={load} className="text-[11px] text-slate-400 hover:text-slate-700 flex items-center gap-1"><RefreshCw size={12} /> ดึงใหม่</button>
      </div>

      {c && (
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs font-semibold text-slate-700 mb-1">แคมเปญ</div>
          <Row label="ชื่อ" value={c.name} />
          <Row label="วัตถุประสงค์" value={c.objective} />
          <Row label="สถานะ" value={c.status} />
          <Row label="ประเภทการซื้อ" value={c.buying_type} />
          <Row label="Bid strategy" value={c.bid_strategy} />
          <Row label="งบแคมเปญ" value={c.daily_budget_thb ? `${fmtNum(c.daily_budget_thb)}฿/วัน` : c.lifetime_budget_thb ? `${fmtNum(c.lifetime_budget_thb)}฿ ตลอด` : null} />
          <Row label="หมวดพิเศษ" value={(c.special_ad_categories || []).join(", ")} />
        </div>
      )}

      {(data.adsets || []).map((a, idx) => (
        <div key={a.id || idx} className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-xs font-semibold text-slate-700">ชุดโฆษณา{data.adsets.length > 1 ? ` #${idx + 1}` : ""}</div>
            {onNavigate && a.id && (
              <button onClick={() => onNavigate({ ad_id: a.id, headline: a.name, level: "adsets" })} className="text-[11px] border border-slate-300 rounded-lg px-2 py-0.5 text-slate-600 hover:bg-white flex items-center gap-1">
                <BarChart3 size={12} /> แดชบอร์ดชุดนี้
              </button>
            )}
          </div>
          <Row label="ชื่อ" value={a.name} />
          <Row label="สถานะ" value={a.status} />
          <Row label="เป้าหมายการยิง" value={a.optimization_goal} />
          <Row label="การเก็บเงิน" value={a.billing_event} />
          <Row label="งบ" value={budget(a)} />
          <Row label="Bid" value={a.bid_thb ? `${fmtNum(a.bid_thb)}฿` : null} />
          <Row label="เริ่ม–สิ้นสุด" value={a.start_time ? `${String(a.start_time).slice(0, 10)}${a.end_time ? " – " + String(a.end_time).slice(0, 10) : ""}` : null} />
          <Row label="อายุ" value={a.age?.[0] ? `${a.age[0]}–${a.age[1] || "65+"}` : null} />
          <Row label="เพศ" value={Array.isArray(a.genders) ? a.genders.join(", ") : a.genders} />
          <Row label="ภาษา" value={(a.locales || []).join(", ")} />
          <Row label="ประเทศ" value={(a.countries || []).join(", ")} />
          {a.regions?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">ภูมิภาค/จังหวัด</span><Chips items={a.regions} /></div> : null}
          {a.cities?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">เมือง</span><Chips items={a.cities} /></div> : null}
          {a.interests?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">ความสนใจ ({a.interests.length})</span><Chips items={a.interests} /></div> : null}
          {a.behaviors?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">พฤติกรรม ({a.behaviors.length})</span><Chips items={a.behaviors} /></div> : null}
          {a.demographics?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">ข้อมูลประชากร</span><Chips items={a.demographics} /></div> : null}
          {a.custom_audiences?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">Custom Audience</span><Chips items={a.custom_audiences} /></div> : null}
          {a.excluded_custom_audiences?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">ยกเว้น Audience</span><Chips items={a.excluded_custom_audiences} /></div> : null}
          {placeText(a.placements) ? <Row label="การจัดวาง" value={placeText(a.placements)} /> : a.placements ? (
            <>
              <Row label="แพลตฟอร์ม" value={(a.placements.platforms || []).join(", ")} />
              <Row label="ตำแหน่ง FB" value={(a.placements.facebook_positions || []).join(", ")} />
              <Row label="ตำแหน่ง IG" value={(a.placements.instagram_positions || []).join(", ")} />
              <Row label="ตำแหน่ง Messenger" value={(a.placements.messenger_positions || []).join(", ")} />
              <Row label="ตำแหน่ง Audience Network" value={(a.placements.audience_network_positions || []).join(", ")} />
              <Row label="อุปกรณ์" value={(a.placements.device_platforms || []).join(", ")} />
            </>
          ) : null}
          <Row label="Advantage+ Audience" value={a.advantage_audience != null ? String(a.advantage_audience) : null} />

          {(a.ads || []).map((ad2, j) => (
            <div key={ad2?.id || j} className="rounded-lg border border-slate-200 bg-white p-3 mt-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-xs font-semibold text-slate-700">โฆษณา{a.ads.length > 1 ? ` #${j + 1}` : ""}</div>
                {onNavigate && ad2?.id && (
                  <button onClick={() => onNavigate({ ad_id: ad2.id, headline: ad2.name, level: "ads" })} className="text-[11px] border border-slate-300 rounded-lg px-2 py-0.5 text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                    <BarChart3 size={12} /> แดชบอร์ดโฆษณานี้
                  </button>
                )}
              </div>
              <div className="flex gap-3 flex-col sm:flex-row">
                {ad2?.video_url ? (
                  <video src={ad2.video_url} poster={ad2.image_url || undefined} controls className="w-48 rounded border border-slate-200 shrink-0" />
                ) : ad2?.image_url ? (
                  <img src={ad2.image_url} alt="" className="w-48 rounded object-contain border border-slate-200 shrink-0" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <Row label="ชื่อโฆษณา" value={ad2?.name} />
                  <Row label="สถานะ" value={ad2?.status} />
                  <Row label="ประเภทสื่อ" value={ad2?.media_type === "video" ? "วิดีโอ" : "รูปภาพ"} />
                  <Row label="หัวข้อ" value={ad2?.headline} />
                  <Row label="ข้อความ (แคปชั่น)" value={ad2?.body} />
                  <Row label="คำอธิบาย" value={ad2?.description} />
                  <Row label="ปุ่ม CTA" value={ad2?.cta} />
                  <Row label="ลิงก์" value={ad2?.link} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AdDashboardModal({ ad, ai, onClose, onNavigate }) {
  const [range, setRange] = useState({ preset: "today", since: "", until: "" }); // เริ่มที่ "วันนี้" ให้ตรงกับการ์ด
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [dailyKeys, setDailyKeys] = useState(["spend"]); // เลือกได้หลายเส้นพร้อมกัน
  const [bdMetrics, setBdMetrics] = useState(["impressions"]); // เลือกได้หลายมิติพร้อมกัน
  const [aiResult, setAiResult] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const rangeKey = JSON.stringify(rangeToBody(range));

  // ---- งบยิงโฆษณา (ป้อนเอง + บันทึกจำไว้) — เก็บบนระบบใน settings.ad_budgets แยกตามระดับ+id ----
  const budgetKey = `${ad.level || "ad"}:${ad.ad_id || ""}`;
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetSaved, setBudgetSaved] = useState(null);   // ค่าที่บันทึกไว้ล่าสุด (number|null)
  const [budgetMsg, setBudgetMsg] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);   // เมนูเลือกฟอร์แมต export
  const [trackerBusy, setTrackerBusy] = useState(false); // กำลังดึงทั้งแคมเปญเพื่อทำฟอร์แมตงบยิง Ads
  const [reloadTick, setReloadTick] = useState(0);       // สั่งดึงใหม่ (force) — ข้าม cache
  const forceRef = useRef(false);
  const refreshInsights = () => { forceRef.current = true; setReloadTick((t) => t + 1); };
  const dashRef = useRef(null);
  async function runTracker(fmt) {
    setTrackerBusy(true);
    logActivity("export", { format: `งบยิง Ads (${fmt})`, name: ad.headline, ad_id: ad.ad_id });
    try {
      const { campaignName, rows } = await fetchCampaignTree(ad, data, range);
      if (!rows.length) { alert("ไม่พบโฆษณาในแคมเปญนี้ (หรือดึงข้อมูลไม่สำเร็จ)"); return; }
      if (fmt === "pdf") exportTrackerPdf(campaignName, rows);
      else if (fmt === "excel") await exportTrackerExcel(campaignName, rows);
      else exportTrackerCsv(campaignName, rows);
    } catch (error) {
      alert(`สร้างไฟล์ไม่สำเร็จ: ${error?.message || error}`);
    } finally { setTrackerBusy(false); }
  }
  useEffect(() => {
    if (!ad?.ad_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "ad_budgets").maybeSingle();
      if (cancelled) return;
      const v = data?.value?.[budgetKey];
      if (v != null) { setBudgetInput(String(v)); setBudgetSaved(Number(v)); }
      else { setBudgetInput(""); setBudgetSaved(null); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetKey]);
  async function saveBudget() {
    const n = Math.max(0, Number(budgetInput) || 0);
    setBudgetSaving(true); setBudgetMsg("");
    const { data } = await supabase.from("settings").select("value").eq("key", "ad_budgets").maybeSingle();
    const cur = (data?.value && typeof data.value === "object") ? { ...data.value } : {};
    cur[budgetKey] = n;
    const { error } = await supabase.from("settings").upsert({ key: "ad_budgets", value: cur, updated_at: new Date().toISOString() });
    setBudgetSaving(false);
    if (error) { setBudgetMsg("บันทึกไม่สำเร็จ"); }
    else { setBudgetSaved(n); setBudgetMsg("บันทึกแล้ว ✓"); setTimeout(() => setBudgetMsg(""), 2500); }
  }

  const [snapRefresh, setSnapRefresh] = useState(0);
  // บันทึกว่ามีการเปิดแดชบอร์ดรายชิ้น + เก็บ snapshot การตั้งค่าปัจจุบัน (ครั้งเดียวตอน mount)
  useEffect(() => {
    if (!ad?.ad_id) return;
    logActivity("open_dashboard", { ad_id: ad.ad_id, name: ad.headline });
    (async () => {
      try {
        await supabase.functions.invoke("snapshot-config", { body: { node_id: ad.ad_id, level: ad.level || "ad" } });
        setSnapRefresh((x) => x + 1);
      } catch { /* เงียบไว้ */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.ad_id]);

  async function runDashboardAI() {
    if (!data) return;
    logActivity("ai_analyze", { ad_id: ad.ad_id, name: ad.headline });
    setAiBusy(true);
    setAiError("");
    const { data: res, error: fnErr } = await supabase.functions.invoke("analyze-dashboard", {
      body: {
        headline: ad.headline,
        objective: data.objective,
        overall: data.overall,
        age: data.age, gender: data.gender, region: data.region, placement: data.placement, device: data.device,
        text_model: "openai",
      },
    });
    setAiBusy(false);
    if (fnErr) { setAiError(await readFunctionErrorMessage(fnErr)); return; }
    if (!res?.ok) { setAiError(res?.error || "วิเคราะห์ไม่สำเร็จ"); return; }
    setAiResult(res);
  }
  // เปลี่ยนช่วงเวลา = ล้างผล AI เดิม (เพราะข้อมูลเปลี่ยน)
  useEffect(() => { setAiResult(null); setAiError(""); }, [rangeKey]);
  // toggle แบบเลือกหลายอัน (ต้องเหลืออย่างน้อย 1)
  const makeToggle = (setArr) => (k) => setArr((prev) => (prev.includes(k) ? (prev.length > 1 ? prev.filter((x) => x !== k) : prev) : [...prev, k]));
  const toggleDaily = makeToggle(setDailyKeys);
  const toggleBd = makeToggle(setBdMetrics);
  const customIncomplete = range.preset === "custom" && (!range.since || !range.until);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const useForce = forceRef.current; forceRef.current = false;
      const { data: res, error: fnError } = await supabase.functions.invoke("ad-insights", {
        body: { ad_id: ad.ad_id, level: ad.level || "ad", ...rangeToBody(range), ...(useForce ? { force: true } : {}) },
      });
      if (cancelled) return;
      setLoading(false);
      if (fnError) {
        setError(await readFunctionErrorMessage(fnError));
        return;
      }
      if (!res?.ok) {
        setError(res?.error || "ดึงข้อมูลไม่สำเร็จ");
        return;
      }
      // "ลูกค้าเปิดบัญชีใหม่" ต่อวัน — คำนวณฝั่ง server แล้ว (roll-up ตามระดับ โฆษณา/ชุด/แคมเปญ)
      if (cancelled) return;
      setData({ ...res, accountOpensByDate: res.account_opens_by_date || {} });
    }
    if (!ad.ad_id) {
      setLoading(false);
      setError("แอดนี้ไม่มี Ad ID");
    } else if (customIncomplete) {
      setLoading(false); // รอเลือกวันเริ่ม-สิ้นสุดให้ครบก่อน
    } else load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.ad_id, rangeKey, reloadTick]);

  const o = data?.overall;
  // คะแนนสุขภาพแอด (heuristic รวม CTR / ความถี่ / อัตราตอบแชท)
  let health = null;
  if (o) {
    const parts = [];
    parts.push(Math.min(1, (o.ctr || 0) / 2)); // CTR 2% = เต็ม
    parts.push(o.frequency ? Math.max(0, Math.min(1, (4 - o.frequency) / 3)) : 0.6); // freq<=1 ดี, >=4 แย่
    if (o.reply_rate != null) parts.push(o.reply_rate);
    health = Math.round((parts.reduce((s, p) => s + p, 0) / parts.length) * 100);
  }
  const metricColors = { spend: "#6366f1", impressions: "#0ea5e9", clicks: "#f59e0b", leads: "#10b981", replies: "#8b5cf6" };
  const metricLabels = { spend: "ค่าใช้จ่าย", impressions: "การมองเห็น", clicks: "คลิก", leads: "ลีด", replies: "ตอบกลับจริง" };
  // ช่องกรอกเป็นวงเงินรวม VAT แล้ว ส่วนงบที่นำไปตั้งใน Meta ต้องย้อนกลับเป็นยอดก่อน VAT
  const budgetInfo = calculateVatInclusiveBudget(budgetInput, o?.spend || 0);
  const {
    totalWithVat: budgetTotalWithVat,
    beforeVat: budgetBeforeVat,
    vatAmount: budgetVatAmount,
    spentWithVat,
    remainBeforeVat: budgetRemainBeforeVat,
    remainWithVat: budgetRemainWithVat,
  } = budgetInfo;

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="safe-top sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="w-full px-4 sm:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm shrink-0">
              <ArrowLeft size={18} /> กลับ
            </button>
            <HomeButton />
            <div className="min-w-0">
              <div className="font-semibold text-slate-800 truncate">
                {ad.headline || "แดชบอร์ดแอด"}
                {data?.objective ? <span className="text-slate-500 font-normal"> ({OBJECTIVE_LABEL(data.objective)})</span> : ""}
              </div>
              <div className="text-[11px] text-slate-400">Ad ID: {ad.ad_id || "-"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:shrink-0 sm:justify-end">
            <ThemeToggle />
            <button
              onClick={runDashboardAI}
              disabled={!data || aiBusy}
              className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5"
            >
              {aiBusy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} AI วิเคราะห์
            </button>
            <div className="relative">
              <button
                onClick={() => setExportMenu((v) => !v)}
                disabled={!data}
                className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
              >
                <FileDown size={14} /> Export <ChevronDown size={13} />
              </button>
              {trackerBusy && (
                <div className="absolute right-0 mt-1 z-30 bg-white border border-slate-200 rounded-lg shadow px-3 py-2 text-xs text-slate-600 flex items-center gap-1.5 whitespace-nowrap">
                  <Loader2 className="animate-spin" size={13} /> กำลังดึงข้อมูลทั้งแคมเปญ...
                </div>
              )}
              {exportMenu && data && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportMenu(false)} />
                  <div className="absolute right-0 mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[210px] overflow-hidden">
                    <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-slate-400">แดชบอร์ดรายวัน</div>
                    {[
                      ["PDF (พิมพ์/บันทึก)", () => exportAdDashboardPdf(ad, data, budgetInfo)],
                      ["Excel (.xls)", () => exportAdDashboardExcel(ad, data, budgetInfo)],
                      ["CSV (ตารางรายวัน)", () => exportAdDashboardCsv(ad, data)],
                    ].map(([label, fn]) => (
                      <button key={label} onClick={() => { logActivity("export", { format: label, name: ad.headline, ad_id: ad.ad_id }); fn(); setExportMenu(false); }}
                        className="w-full text-left text-xs px-3 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                        <FileDown size={13} className="text-slate-400" /> {label}
                      </button>
                    ))}
                    <div className="my-1 border-t border-slate-100" />
                    <div className="px-3 pt-0.5 pb-0.5 text-[10px] font-semibold text-slate-400">ฟอร์แมตงบยิง Ads (ทั้งแคมเปญ)</div>
                    {[
                      ["งบยิง Ads (PDF)", () => runTracker("pdf")],
                      ["งบยิง Ads (Excel)", () => runTracker("excel")],
                      ["งบยิง Ads (CSV)", () => runTracker("csv")],
                    ].map(([label, fn]) => (
                      <button key={label} onClick={() => { fn(); setExportMenu(false); }}
                        className="w-full text-left text-xs px-3 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                        <FileDown size={13} className="text-emerald-500" /> {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <RangePicker value={range} onChange={setRange} />
          </div>
        </div>
      </div>

      {data && (
        <div className="w-full px-4 sm:px-6 pt-3">
          <div className={`flex items-center justify-between gap-2 flex-wrap rounded-lg border px-3 py-2 text-xs ${data.cached ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
            <span className="inline-flex items-center gap-1.5">
              {data.cached ? "🗂️ ข้อมูลจากแคช" : "🟢 ข้อมูลสด"} · ดึงเมื่อ {data.fetched_at ? new Date(data.fetched_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-"}
              {data.cached ? " · กด \"ดึงใหม่\" เพื่ออัปเดตจาก Meta" : ""}
            </span>
            <button onClick={refreshInsights} disabled={loading} className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-300 text-slate-700 px-2.5 py-1 font-medium hover:bg-slate-50 disabled:opacity-50 shrink-0"><RefreshCw size={12} className={loading ? "animate-spin" : ""} /> ดึงใหม่ (สด)</button>
          </div>
        </div>
      )}

      <div ref={dashRef} className="w-full p-4 sm:p-6 space-y-4">
          {customIncomplete ? (
            <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-4 text-center">เลือกวันเริ่มต้นและวันสิ้นสุดเพื่อดูข้อมูล</div>
          ) : loading ? (
            <div className="py-16"><Spinner label="กำลังดึงข้อมูลจาก Meta..." /></div>
          ) : error ? (
            <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-3">
              {error}
              <div className="text-xs text-slate-500 mt-1">ต้องตั้งค่า META_ACCESS_TOKEN และแอดต้องมีข้อมูลในช่วงเวลาที่เลือก</div>
            </div>
          ) : data ? (
            <>
              {aiError && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{aiError}</div>}
              {(() => { const a = aiResult || ai; return (a?.result_th || a?.recommendation_th) ? (
                <div className="space-y-1.5">
                  {a.result_th && <div className="text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2">{a.result_th}</div>}
                  {a.recommendation_th && <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">แนะนำ: {a.recommendation_th}</div>}
                </div>
              ) : null; })()}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <KpiTile label="ค่าใช้จ่าย" value={`${fmtNum(o.spend)}฿`} />
                <KpiTile label="การมองเห็น" value={fmtNum(o.impressions)} sub={`เข้าถึง ${fmtNum(o.reach)} คน`} />
                <KpiTile label="ลีด" value={fmtNum(o.leads)} tone="green" sub={o.cpl ? `CPL ${fmtNum(o.cpl)}฿` : "—"} />
                <KpiTile label="CTR" value={`${fmtNum(o.ctr, 2)}%`} tone="blue" sub={`CPC ${fmtNum(o.cpc)}฿`} />
                <KpiTile label="CPM" value={`${fmtNum(o.cpm)}฿`} />
                <KpiTile label="คลิก" value={fmtNum(o.clicks)} sub={`ลิงก์ ${fmtNum(o.link_clicks)}`} />
                <KpiTile label="ความถี่" value={fmtNum(o.frequency, 2)} tone={o.frequency > 3 ? "rose" : "slate"} sub="ครั้ง/คน" />
                <KpiTile label="Conv. rate" value={o.cvr != null ? `${fmtNum(o.cvr, 1)}%` : "—"} sub="ลีด/คลิกลิงก์" />
              </div>

              {/* งบยิงโฆษณา (ป้อนเอง + บันทึกจำไว้) */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="font-medium text-slate-800 text-sm mb-3">งบยิงโฆษณา (ป้อนเอง)</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-500 mb-1">งบรวม VAT 7% แล้ว</div>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" inputMode="decimal" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="0"
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-lg font-semibold text-slate-800" />
                      <span className="text-slate-500 text-sm">฿</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <button onClick={saveBudget} disabled={budgetSaving} className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-slate-800 disabled:opacity-50">{budgetSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
                      {budgetMsg
                        ? <span className={`text-[11px] ${budgetMsg.includes("✓") ? "text-emerald-600" : "text-rose-600"}`}>{budgetMsg}</span>
                        : (budgetSaved != null && <span className="text-[11px] text-slate-400">บันทึกงบรวมไว้ {fmtNum(budgetSaved, 2)}฿</span>)}
                    </div>
                  </div>
                  <KpiTile
                    label="งบยิง Ads (ก่อน VAT 7%)"
                    value={`${fmtNum(budgetBeforeVat, 2)}฿`}
                    tone="blue"
                    sub={`งบรวม ${fmtNum(budgetTotalWithVat, 2)}฿ − VAT ${fmtNum(budgetVatAmount, 2)}฿`}
                  />
                  <KpiTile
                    label="งบคงเหลือ (รวม VAT)"
                    value={`${fmtNum(budgetRemainWithVat, 2)}฿`}
                    tone={budgetRemainWithVat >= 0 ? "green" : "rose"}
                    sub={`หักค่าใช้จ่ายรวม VAT ${fmtNum(spentWithVat, 2)}฿`}
                    secondaryLabel="คงเหลือก่อน VAT 7%"
                    secondaryValue={`${fmtNum(budgetRemainBeforeVat, 2)}฿`}
                  />
                </div>
                <div className="text-[11px] text-slate-400 mt-2">งบที่กรอกคือยอดรวม VAT 7% แล้ว · ตัวเลขในการ์ดสีน้ำเงินคือยอดก่อน VAT ที่นำไปตั้งงบยิง Ads ได้ · งบคงเหลือหักค่าใช้จ่ายจาก Meta หลังบวก VAT 7% แล้ว · ระบบบันทึกตัวเลขไว้ให้อัตโนมัติ</div>
              </div>

              {o.conversations > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <KpiTile label="แชทเริ่ม" value={fmtNum(o.conversations)} />
                  <KpiTile label="ตอบกลับจริง" value={fmtNum(o.replies)} sub="ลูกค้าส่ง ≥2 ข้อความ (กันกดปุ่มแล้วเงียบ)" />
                  <KpiTile label="อัตราตอบ" value={o.reply_rate != null ? `${Math.min(100, Math.round(o.reply_rate * 100))}%` : "—"} tone={o.reply_rate != null && o.reply_rate < 0.4 ? "rose" : "green"} sub="คุยต่อจริง/แชทเริ่ม (สูงสุด 100%)" />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col items-center justify-center">
                  <GaugeMeter value={health ?? 0} max={100} display={`${health ?? "-"}`} label="คะแนนสุขภาพแอด" tone={health >= 66 ? "#10b981" : health >= 40 ? "#f59e0b" : "#ef4444"} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col items-center justify-center">
                  <GaugeMeter value={o.ctr || 0} max={3} display={`${fmtNum(o.ctr, 2)}%`} label="CTR (เทียบ 3%)" tone="#0ea5e9" />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col items-center justify-center">
                  <GaugeMeter value={o.reply_rate != null ? Math.min(100, o.reply_rate * 100) : 0} max={100} display={o.reply_rate != null ? `${Math.min(100, Math.round(o.reply_rate * 100))}%` : "—"} label="อัตราตอบแชท" tone="#8b5cf6" />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="font-medium text-slate-800 text-sm mb-2">ช่องทางการเปลี่ยนผู้ชมเป็นลีด (Funnel)</div>
                <Funnel impressions={o.impressions} clicks={o.link_clicks || o.clicks} leads={o.leads} />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="font-medium text-slate-800 text-sm">เทรนด์รายวัน</div>
                  <div className="flex gap-1 flex-wrap">
                    {Object.keys(metricLabels).map((m) => (
                      <button key={m} onClick={() => toggleDaily(m)} className={`text-[11px] px-2 py-1 rounded-full ${dailyKeys.includes(m) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                        {metricLabels[m]}
                      </button>
                    ))}
                    <button
                      onClick={() => setDailyKeys(dailyKeys.length === Object.keys(metricLabels).length ? ["spend"] : Object.keys(metricLabels))}
                      className={`text-[11px] px-2 py-1 rounded-full ${dailyKeys.length === Object.keys(metricLabels).length ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}
                    >
                      ทั้งหมด
                    </button>
                  </div>
                </div>
                <DailyMultiChart points={data.daily} series={dailyKeys.map((k) => ({ key: k, label: metricLabels[k], color: metricColors[k] }))} />
              </div>

              {(() => { const bdSeries = bdMetrics.map((k) => ({ key: k, ...BD_METRIC_META[k] })); const emptyMsg = `ไม่มี${bdMetrics.map((k) => BD_METRIC_LABEL[k]).join("/")}ในช่วงนี้`; return (
              <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium text-slate-800">การกระจายตัว (Breakdown)</div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[11px] text-slate-400 mr-1">ดูตาม:</span>
                  {BD_KEYS.map((k) => (
                    <button
                      key={k}
                      onClick={() => toggleBd(k)}
                      className={`text-[11px] px-2 py-1 rounded-full flex items-center gap-1 ${bdMetrics.includes(k) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                    >
                      <span className="w-2 h-2 rounded-sm" style={{ background: BD_METRIC_META[k].color }} />
                      {BD_METRIC_META[k].label}
                    </button>
                  ))}
                  <button
                    onClick={() => setBdMetrics(bdMetrics.length === BD_KEYS.length ? ["impressions"] : [...BD_KEYS])}
                    className={`text-[11px] px-2 py-1 rounded-full ${bdMetrics.length === BD_KEYS.length ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    ทั้งหมด
                  </button>
                </div>
              </div>
              {bdMetrics.includes("replies") && (
                <div className="text-[11px] text-slate-500 bg-indigo-50 rounded-lg px-2.5 py-1.5">
                  "ตอบกลับจริง" = บทสนทนาที่ลูกค้าส่งข้อความ ≥2 ครั้ง (ตัดคนกดปุ่มแล้วเงียบ) — ใช้ดูว่าลีดจริงมาจากกลุ่ม/พื้นที่/ตำแหน่งไหน
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="font-medium text-slate-800 text-sm mb-3">ช่วงอายุ</div>
                  <BarListMulti items={data.age} metrics={bdSeries} labelMap={AGE_LABEL} empty={emptyMsg} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="font-medium text-slate-800 text-sm mb-3">เพศ</div>
                  {bdMetrics.length === 1 ? <GenderDonut gender={data.gender} valueKey={bdMetrics[0]} /> : <BarListMulti items={data.gender} metrics={bdSeries} labelMap={GENDER_LABEL} empty={emptyMsg} />}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="font-medium text-slate-800 text-sm mb-3">พื้นที่ (Top จังหวัด/ภูมิภาค)</div>
                  <BarListMulti items={data.region} metrics={bdSeries} labelMap={REGION_LABEL} empty={emptyMsg} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="font-medium text-slate-800 text-sm mb-3">ตำแหน่งจัดวาง (Placement)</div>
                  <BarListMulti items={data.placement} metrics={bdSeries} empty={emptyMsg} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 sm:col-span-2">
                  <div className="font-medium text-slate-800 text-sm mb-3">อุปกรณ์</div>
                  <BarListMulti items={data.device} metrics={bdSeries} labelMap={DEVICE_LABEL} empty={emptyMsg} />
                </div>
              </div>
              </>
              ); })()}

              <FullConfigPanel adId={ad.ad_id} level={ad.level} onNavigate={onNavigate} />
              <ChangeComparePanel adId={ad.ad_id} range={range} />
              <ConfigHistoryPanel adId={ad.ad_id} refresh={snapRefresh} />

              <div className="text-[11px] text-slate-400 text-center">ข้อมูลจาก Meta · ช่วง {rangeLabel(range)} · อัปเดต {new Date(data.generated_at).toLocaleString("th-TH")}</div>
            </>
          ) : null}
      </div>
    </div>
  );
}

// ตารางเปรียบเทียบหลายแอด/แคมเปญ (เต็มหน้าจอ, เลือกได้มากกว่า 2)
const COMPARE_METRICS = [
  { key: "spend", label: "ค่าใช้จ่าย (฿)", fmt: (v) => fmtNum(v) },
  { key: "impressions", label: "การมองเห็น", fmt: (v) => fmtNum(v) },
  { key: "reach", label: "เข้าถึง", fmt: (v) => fmtNum(v) },
  { key: "leads", label: "ลีด", fmt: (v) => fmtNum(v), better: "high" },
  { key: "cpl", label: "CPL (฿)", fmt: (v) => (v != null ? fmtNum(v) : "—"), better: "low" },
  { key: "ctr", label: "CTR (%)", fmt: (v) => fmtNum(v, 2), better: "high" },
  { key: "cpm", label: "CPM (฿)", fmt: (v) => fmtNum(v), better: "low" },
  { key: "cpc", label: "CPC (฿)", fmt: (v) => fmtNum(v), better: "low" },
  { key: "clicks", label: "คลิก", fmt: (v) => fmtNum(v), better: "high" },
  { key: "frequency", label: "ความถี่", fmt: (v) => fmtNum(v, 2), better: "low" },
  { key: "reply_rate", label: "อัตราตอบแชท (%)", fmt: (v) => (v != null ? Math.round(v * 100) : "—"), better: "high" },
];

function CompareView({ items, onClose, aiModel }) {
  const [range, setRange] = useState({ preset: "today", since: "", until: "" });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  const rangeKey = JSON.stringify(rangeToBody(range));
  const customIncomplete = range.preset === "custom" && (!range.since || !range.until);

  useEffect(() => {
    if (customIncomplete) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setAiResult(null);
      const res = await Promise.all(
        items.map(async (it) => {
          const { data, error } = await supabase.functions.invoke("ad-insights", { body: { ad_id: it.ad_id, ...rangeToBody(range) } });
          return { item: it, overall: !error && data?.ok ? data.overall : null };
        })
      );
      if (!cancelled) {
        setRows(res);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, items]);

  async function analyzeAI() {
    setAiBusy(true);
    setAiError("");
    setAiResult(null);
    const payloadItems = rows.filter((r) => r.overall).map((r) => ({ headline: r.item.headline, overall: r.overall }));
    const { data, error } = await supabase.functions.invoke("analyze-compare", { body: { items: payloadItems, text_model: aiModel || "openai" } });
    setAiBusy(false);
    if (error) { setAiError(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setAiError(data?.error || "วิเคราะห์ไม่สำเร็จ"); return; }
    setAiResult(data);
  }

  // หา index ที่ดีที่สุดของแต่ละ metric
  function bestIndex(metric) {
    if (!metric.better) return -1;
    let best = -1, bestVal = null;
    rows.forEach((r, i) => {
      const v = r.overall?.[metric.key];
      if (v == null) return;
      if (bestVal == null || (metric.better === "high" ? v > bestVal : v < bestVal)) {
        bestVal = v;
        best = i;
      }
    });
    return best;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto">
      <div className="safe-top sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="w-full px-4 sm:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm shrink-0">
              <ArrowLeft size={18} /> กลับ
            </button>
            <HomeButton />
            <div className="font-semibold text-slate-800 truncate">เปรียบเทียบ {items.length} รายการ</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:justify-end">
            <ThemeToggle />
            <button onClick={analyzeAI} disabled={loading || aiBusy} className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5">
              {aiBusy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} AI วิเคราะห์
            </button>
            <button onClick={() => exportComparePdf(rows, range)} disabled={loading} className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5">
              <FileDown size={14} /> Export PDF
            </button>
            <RangePicker value={range} onChange={setRange} />
          </div>
        </div>
      </div>
      <div className="w-full p-4 sm:p-6 space-y-3">
        {(aiResult || aiError) && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5">
            {aiError ? (
              <div className="text-sm text-rose-600">{aiError}</div>
            ) : (
              <>
                {aiResult.summary_th && <div className="text-sm text-slate-700">{aiResult.summary_th}</div>}
                {aiResult.winner_th && <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">🏆 {aiResult.winner_th}</div>}
                {aiResult.recommendation_th && <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">แนะนำ: {aiResult.recommendation_th}</div>}
              </>
            )}
          </div>
        )}
        {customIncomplete ? (
          <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-4 text-center">เลือกวันเริ่มต้นและวันสิ้นสุดเพื่อดูข้อมูล</div>
        ) : loading ? (
          <div className="py-16"><Spinner label="กำลังดึงข้อมูลเปรียบเทียบ..." /></div>
        ) : (
          <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left p-3 text-slate-500 font-medium sticky left-0 bg-white">ตัวชี้วัด</th>
                  {rows.map((r, i) => (
                    <th key={i} className="text-right p-3 text-slate-700 font-medium min-w-[140px] max-w-[200px] truncate" title={r.item.headline}>{r.item.headline}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_METRICS.map((m) => {
                  const best = bestIndex(m);
                  return (
                    <tr key={m.key} className="border-b border-slate-100">
                      <td className="p-3 text-slate-600 sticky left-0 bg-white">{m.label}</td>
                      {rows.map((r, i) => {
                        const v = r.overall?.[m.key];
                        return (
                          <td key={i} className={`p-3 text-right ${i === best ? "text-emerald-700 font-semibold bg-emerald-50" : "text-slate-700"}`}>
                            {v == null ? "—" : m.fmt(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">ช่องสีเขียว = ดีที่สุดในแถวนั้น · ข้อมูลจาก Meta</p>
      </div>
    </div>
  );
}

// แถบนำทางสำหรับหน้า Export/PDF โดยเฉพาะ PWA (iOS ไม่มี browser back bar)
// ซ่อนอัตโนมัติเวลาพิมพ์ จึงไม่ติดเข้า PDF
function exportPageNavHtml(backTab = "analyze") {
  const base = `${window.location.origin}${window.location.pathname}`;
  const backUrl = `${base}?tab=${encodeURIComponent(backTab)}`;
  const homeUrl = `${base}?tab=overview`;
  return `<style>
    .export-nav{position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:8px;padding:calc(8px + env(safe-area-inset-top)) 12px 8px;background:rgba(255,255,255,.96);border-bottom:1px solid #e2e8f0;box-shadow:0 2px 10px rgba(15,23,42,.08);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
    .export-nav button{appearance:none;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#1e293b;font:600 14px system-ui,-apple-system,sans-serif;padding:8px 12px;min-height:40px;cursor:pointer}
    .export-nav .home{margin-left:auto;background:#0f172a;border-color:#0f172a;color:#fff}
    @media print{.export-nav{display:none!important}}
  </style>
  <nav class="export-nav noprint" aria-label="เมนูหน้า Export">
    <button type="button" onclick="exportGoBack()">← ย้อนกลับ</button>
    <button type="button" class="home" onclick="location.replace('${homeUrl}')">⌂ กลับหน้าหลัก</button>
  </nav>
  <script>function exportGoBack(){try{if(window.opener&&!window.opener.closed){window.opener.focus();window.close();return}}catch(e){}try{if(history.length>1){history.back();return}}catch(e){}location.replace('${backUrl}')}</script>`;
}

function buildCompareHtml(rows, preset) {
  const esc = escHtml;
  const head = rows.map((r) => `<th>${esc(r.item.headline)}</th>`).join("");
  const body = COMPARE_METRICS.map((m) => {
    const cells = rows.map((r) => {
      const v = r.overall?.[m.key];
      return `<td style="text-align:right">${v == null ? "—" : esc(m.fmt(v))}</td>`;
    }).join("");
    return `<tr><th>${esc(m.label)}</th>${cells}</tr>`;
  }).join("");
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>เปรียบเทียบโฆษณา</title>
<style>body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:24px}
h1{font-size:18px} table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
th,td{border:1px solid #e2e8f0;padding:6px 8px} th{background:#f8fafc;text-align:left}
@page{margin:12mm;size:landscape}</style></head><body>${exportPageNavHtml("analyze")}
<h1>เปรียบเทียบโฆษณา (${rows.length} รายการ)</h1>
<div style="color:#64748b;font-size:12px">อัปเดต ${esc(new Date().toLocaleString("th-TH"))}</div>
<table><tr><th>ตัวชี้วัด</th>${head}</tr>${body}</table>
<script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
}
function exportComparePdf(rows, preset) {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่"); return; }
  w.document.open();
  w.document.write(buildCompareHtml(rows, preset));
  w.document.close();
}

function AdAnalysisCard({ ad, latestMetric, history, ai, onChanged, compareChecked, onToggleCompare }) {
  const [openDash, setOpenDash] = useState(false);
  const verdict = latestMetric?.verdict;
  const spend = latestMetric?.spend;
  const leads = latestMetric?.leads;
  const cpa = latestMetric?.cpa;
  const hasChat = ad.conversations != null && ad.conversations > 0;
  const stop = (e) => e.stopPropagation();

  return (
    <div
      onClick={() => ad.ad_id && setOpenDash(true)}
      className={`rounded-xl border border-slate-200 p-3 space-y-2 transition ${ad.ad_id ? "cursor-pointer hover:border-slate-400 hover:shadow-sm" : ""}`}
    >
      {openDash && <AdDashboardModal ad={ad} ai={ai} onClose={() => setOpenDash(false)} />}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-slate-800 text-sm flex items-center gap-1.5">
            {ad.headline || "(ไม่มีชื่อ)"}
            {ad.ad_id && <BarChart3 size={13} className="text-slate-400" />}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Ad ID: {ad.ad_id || "-"}{ad.adset_id ? ` · Ad set: ${ad.adset_id}` : ""} · งบ/วัน {fmtNum(ad.daily_budget_thb)} บาท
          </div>
        </div>
        <div className="flex items-start gap-2 shrink-0">
          {ad.ad_id && onToggleCompare && (
            <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer" onClick={stop}>
              <input type="checkbox" checked={!!compareChecked} onChange={() => onToggleCompare(ad)} className="w-3.5 h-3.5" />
              เทียบ
            </label>
          )}
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={ad.status} />
            <VerdictBadge verdict={verdict} />
          </div>
        </div>
      </div>

      {latestMetric ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">วันนี้</span>
          <span>Spend: <b className="text-slate-800">{fmtNum(spend)}</b></span>
          <span>Leads: <b className="text-slate-800">{fmtNum(leads)}</b></span>
          <span>CPA: <b className="text-slate-800">{cpa ? fmtNum(cpa) : "-"}</b></span>
          {latestMetric.ctr != null && <span>CTR: {fmtNum(latestMetric.ctr, 2)}%</span>}
          {latestMetric.cpm != null && <span>CPM: {fmtNum(latestMetric.cpm)}</span>}
        </div>
      ) : (
        <div className="text-xs text-slate-400">ยังไม่มีข้อมูลผล — รอรอบวิเคราะห์อัตโนมัติ หรือกด "วิเคราะห์ตอนนี้"</div>
      )}

      {hasChat && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>แชทเริ่ม: <b className="text-slate-800">{fmtNum(ad.conversations)}</b></span>
          <span>ตอบกลับจริง: <b className="text-slate-800">{fmtNum(ad.replies)}</b></span>
          <span className={ad.reply_rate != null && ad.reply_rate < 0.4 ? "text-rose-600" : ""}>
            อัตราตอบ: <b>{ad.reply_rate != null ? Math.min(100, Math.round(ad.reply_rate * 100)) + "%" : "-"}</b>
          </span>
        </div>
      )}

      <div onClick={stop}>
        <GhostAlert item={ad} onChanged={onChanged} />
      </div>

      {ad.scale_suggested && (
        <div className="text-xs text-blue-700 bg-blue-50 rounded-lg px-2.5 py-1.5">
          ระบบเสนอเพิ่มงบเป็น {fmtNum(ad.suggested_budget_thb)} บาท/วัน (รออนุมัติในหน้าแคมเปญ)
        </div>
      )}

      {(ai?.result_th || ai?.recommendation_th) && (
        <div className="space-y-1.5 pt-1">
          {ai.result_th && (
            <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-slate-400">ผลเป็นยังไง · </span>
              {ai.result_th}
            </div>
          )}
          {ai.recommendation_th && (
            <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-emerald-600">ควรทำต่อ · </span>
              {ai.recommendation_th}
            </div>
          )}
        </div>
      )}

      {history && history.length > 0 && (
        <details className="text-xs" onClick={stop}>
          <summary className="cursor-pointer text-slate-400 hover:text-slate-600">ดูประวัติผล ({history.length})</summary>
          <div className="mt-1.5 space-y-0.5">
            {history.slice(0, 8).map((h) => (
              <div key={h.id} className="flex justify-between text-slate-500 border-b border-slate-100 py-0.5">
                <span>{new Date(h.checked_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span>Spend {fmtNum(h.spend)} · Leads {fmtNum(h.leads)} · CPA {h.cpa ? fmtNum(h.cpa) : "-"}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ปุ่มอนุมัติการเปลี่ยนแปลงทีละรายการ (แตะบัญชีจริงเมื่อกดเท่านั้น)
function ApplyChangeButton({ change, onDone, label, tone = "slate" }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const tones = {
    slate: "bg-slate-900 text-white hover:bg-slate-800",
    rose: "bg-rose-600 text-white hover:bg-rose-700",
    emerald: "bg-emerald-600 text-white hover:bg-emerald-700",
    blue: "bg-blue-600 text-white hover:bg-blue-700",
  };
  async function apply() {
    setBusy(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("apply-ad-change", { body: change });
    setBusy(false);
    if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
    if (!data?.ok) { setError(data?.error || "ไม่สำเร็จ"); return; }
    setDone(true);
    logActivity("apply_change", { action: change?.action, target_type: change?.target_type, target_id: change?.target_id, name: label });
    onDone?.();
  }
  if (done) return <span className="text-xs text-emerald-700">✓ ทำแล้ว</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={apply} disabled={busy} className={`text-xs rounded-lg px-3 py-1.5 font-medium disabled:opacity-60 flex items-center gap-1.5 ${tones[tone]}`}>
        {busy ? <Loader2 className="animate-spin" size={13} /> : null}
        {label || "อนุมัติ"}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </span>
  );
}

const CHANGE_LABEL = { pause: "หยุด", resume: "เปิด", set_budget: "ตั้งงบ", exclude_audience_network: "ตัด Audience Network" };

function MetaBrowsePanel({ settings, restricted = false, allowedAccounts = [] }) {
  // จำสถานะไว้ใน localStorage เพื่อไม่ให้รีเฟรชแล้วต้องเลือกบัญชี/แคมเปญ/เปิดแดชบอร์ดใหม่ทุกครั้ง
  const [open, setOpen] = useState(() => lsGet("meta.open", false));
  const [accounts, setAccounts] = useState(null);
  const [acctDebug, setAcctDebug] = useState(null);
  const [loadingAcc, setLoadingAcc] = useState(false);
  const [account, setAccount] = useState(() => lsGet("meta.account", ""));
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCamp, setLoadingCamp] = useState(false);
  const [campMeta, setCampMeta] = useState(null);   // { cached, fetched_at } ของรายการแคมเปญ
  const [selected, setSelected] = useState(() => lsGet("meta.selected", [])); // campaign ids
  const [textModel, setTextModel] = useState(settings.ai_models?.analyze_ads || "openai");
  const [range, setRange] = useState({ preset: "today", since: "", until: "" });   // ล็อกเป็น "วันนี้" — ซ่อน picker
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(() => lsGet("meta.result", null));
  const [error, setError] = useState("");
  const [dashItem, setDashItem] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [showOverview, setShowOverview] = useState(() => lsGet("meta.showOverview", false));
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const close = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [accountMenuOpen]);

  async function loadAccounts(refresh = false) {
    setOpen(true);
    if (accounts && !refresh) return;
    setLoadingAcc(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("list-ad-accounts", { body: { refresh: refresh === true } });
    setLoadingAcc(false);
    if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
    if (!data?.ok) { setError(data?.error || "โหลดบัญชีไม่สำเร็จ"); return; }
    // analyze_only: กรองซ้ำฝั่งเว็บอีกชั้น (เผื่อ cache) ให้เห็นเฉพาะบัญชีที่อนุญาต
    const accs = data.accounts || [];
    const allow = (allowedAccounts || []).map((v) => String(v).replace(/^act_/, ""));
    setAccounts(restricted ? accs.filter((a) => allow.includes(String(a.account_id))) : accs);
    setAcctDebug(data.debug || null);
  }

  async function fetchCampaigns(id, force = false) {
    if (!id) return;
    setLoadingCamp(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("list-campaigns", { body: { ad_account_id: id, ...(force ? { refresh: true } : {}) } });
    setLoadingCamp(false);
    if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
    if (!data?.ok) { setError(data?.error || "โหลดแคมเปญไม่สำเร็จ"); return; }
    // เรียงแคมเปญที่ ACTIVE ขึ้นก่อน (คงลำดับเดิมภายในกลุ่ม)
    const camps = (data.campaigns || []).slice().sort((a, b) => (b.effective_status === "ACTIVE" ? 1 : 0) - (a.effective_status === "ACTIVE" ? 1 : 0));
    setCampaigns(camps);
    setCampMeta({ cached: !!data.cached, fetched_at: data.fetched_at || null });
  }

  async function pickAccount(id) {
    setAccount(id);
    setCampaigns([]);
    setSelected([]); // เปลี่ยนบัญชีเอง = ล้างการเลือกเดิม
    setResult(null);
    await fetchCampaigns(id);
  }

  // จำสถานะไว้ให้รีเฟรชแล้วยังอยู่ที่เดิม
  useEffect(() => { lsSet("meta.open", open); }, [open]);
  useEffect(() => { lsSet("meta.account", account); }, [account]);
  useEffect(() => { lsSet("meta.selected", selected); }, [selected]);
  useEffect(() => { lsSet("meta.range", range); }, [range]);
  useEffect(() => { lsSet("meta.result", result); }, [result]);
  useEffect(() => { lsSet("meta.showOverview", showOverview); }, [showOverview]);

  // ตอนโหลดหน้าใหม่: ถ้าเคยเปิดแผงและเลือกบัญชีไว้ ให้ดึงบัญชี+แคมเปญกลับมาเอง (ไม่ล้างการเลือกที่จำไว้)
  useEffect(() => {
    if (open) {
      loadAccounts();
      if (account) fetchCampaigns(account);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // ดึงรายงาน (ตัวเลขล้วน ยังไม่เรียก AI) แล้วเด้งเข้าหน้า overview เต็มจอ
  async function pullReport() {
    if (selected.length === 0) return;
    logActivity("pull_report", { campaigns: selected.length, account });
    setAnalyzing(true);
    setError("");
    setResult(null);
    const { data, error: fnError } = await supabase.functions.invoke("analyze-campaigns", {
      body: { campaign_ids: selected, ...rangeToBody(range), use_ai: false },
    });
    setAnalyzing(false);
    if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
    if (!data?.ok) { setError(data?.error || "ดึงรายงานไม่สำเร็จ"); return; }
    // รายงานชุดใหม่ = ล้างสถานะ drill-down/แดชบอร์ดเก่าที่จำไว้
    lsSet("ov.dashItem", null);
    lsSet("ov.expandedCamps", {});
    setResult(data);
    setShowOverview(true);
  }

  const selectedCampaignObjs = campaigns.filter((c) => selected.includes(c.id));
  const compareItems = selectedCampaignObjs.map((c) => ({ ad_id: c.id, headline: c.name }));
  const sortedAccountGroups = (() => {
    const byName = (a, b) => String(a.business || "อื่นๆ").localeCompare(String(b.business || "อื่นๆ"), "th")
      || String(a.name || "").localeCompare(String(b.name || ""), "th");
    const visible = accounts || [];
    return [
      { key: "active", label: "บัญชีที่ใช้งานอยู่", tone: "#16a34a", rows: visible.filter((a) => Number(a.status) === 1).sort(byName) },
      { key: "inactive", label: "บัญชีที่ปิด/ยังไม่พร้อมใช้งาน", tone: "#dc2626", rows: visible.filter((a) => Number(a.status) !== 1).sort(byName) },
    ];
  })();
  const selectedAccount = (accounts || []).find((a) => String(a.account_id) === String(account));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      {dashItem && <AdDashboardModal ad={dashItem} ai={null} onClose={() => setDashItem(null)} onNavigate={setDashItem} />}
      {showCompare && <CompareView items={compareItems} onClose={() => setShowCompare(false)} aiModel={textModel} />}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-800">ดึงจากบัญชี Meta ทั้งหมด</h3>
          <p className="text-xs text-slate-500 mt-0.5">เลือกบัญชีโฆษณาที่เข้าถึงได้ แล้วเลือกแคมเปญเพื่อวิเคราะห์/เปรียบเทียบ/ดูแดชบอร์ด</p>
        </div>
        {!open && (
          <button onClick={() => loadAccounts()} className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-800 shrink-0">
            เปิด
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-600">บัญชีโฆษณา {accounts ? `(${accounts.length})` : ""}</label>
              <div ref={accountMenuRef} className="relative mt-1">
                <button
                  type="button"
                  disabled={loadingAcc}
                  onClick={() => setAccountMenuOpen((v) => !v)}
                  className="w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm flex items-center justify-between gap-2 disabled:opacity-60"
                  aria-haspopup="listbox"
                  aria-expanded={accountMenuOpen}
                >
                  <span className="min-w-0 truncate text-slate-700">
                    {loadingAcc ? "กำลังโหลด..." : selectedAccount ? (
                      <>{selectedAccount.business || "อื่นๆ"} — {selectedAccount.name} ({selectedAccount.account_id}) · <span className={Number(selectedAccount.status) === 1 ? "meta-status-active" : "meta-status-inactive"}>{selectedAccount.status_label}</span></>
                    ) : "— เลือกบัญชี —"}
                  </span>
                  <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${accountMenuOpen ? "rotate-180" : ""}`} />
                </button>
                {accountMenuOpen && !loadingAcc && (
                  <div role="listbox" className="meta-account-menu absolute z-50 mt-1 max-h-[min(70vh,32rem)] w-full min-w-[20rem] overflow-y-auto rounded-xl border p-1.5 shadow-2xl sm:min-w-[34rem]">
                    {sortedAccountGroups.filter((group) => group.rows.length > 0).map((group) => (
                      <div key={group.key} className="mb-1 last:mb-0">
                        <div className="meta-account-heading sticky top-0 z-10 rounded-md px-2.5 py-1.5 text-xs font-semibold">
                          {group.label} ({group.rows.length})
                        </div>
                        {group.rows.map((a) => {
                          const active = Number(a.status) === 1;
                          const chosen = String(a.account_id) === String(account);
                          return (
                            <button
                              type="button"
                              role="option"
                              aria-selected={chosen}
                              key={a.account_id}
                              onClick={() => { setAccountMenuOpen(false); pickAccount(a.account_id); }}
                              className={`meta-account-option flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${chosen ? "is-selected" : ""}`}
                            >
                              <span className="w-4 shrink-0">{chosen ? "✓" : ""}</span>
                              <span className="break-words">{a.business || "อื่นๆ"} — {a.name} ({a.account_id}) · <span className={active ? "meta-status-active" : "meta-status-inactive"}>{a.status_label}</span></span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {acctDebug && (
                <div className="mt-1.5 text-[11px] text-slate-400 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span>เจอ {accounts?.length || 0} บัญชี{acctDebug.enumerated ? " · ไล่รายธุรกิจแล้ว" : ""}</span>
                    <button onClick={() => loadAccounts(true)} className="text-slate-500 hover:text-slate-700 underline">รีเฟรช</button>
                  </div>
                  {acctDebug.rate_limited && (
                    <div className="text-amber-600">⚠ Meta จำกัดจำนวนคำขอชั่วคราว (rate limit) — รอสัก 1-2 นาทีแล้วกดรีเฟรช อาจเห็นบัญชียังไม่ครบ</div>
                  )}
                  {acctDebug.direct_error && <div className="text-rose-500">{acctDebug.direct_error}</div>}
                </div>
              )}
            </div>
          </div>

          {campMeta && campaigns.length > 0 && (
            <div className={`flex items-center justify-between gap-2 flex-wrap rounded-lg border px-3 py-2 text-xs ${campMeta.cached ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
              <span>{campMeta.cached ? "🗂️ รายชื่อแคมเปญจากแคช" : "🟢 รายชื่อแคมเปญสด"} · ดึงเมื่อ {campMeta.fetched_at ? new Date(campMeta.fetched_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-"}{campMeta.cached ? " · กดรีเฟรชเพื่อดึงสด" : ""}</span>
              <button onClick={() => fetchCampaigns(account, true)} disabled={loadingCamp} className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-300 text-slate-700 px-2.5 py-1 font-medium hover:bg-slate-50 disabled:opacity-50 shrink-0"><RefreshCw size={12} className={loadingCamp ? "animate-spin" : ""} /> รีเฟรชแคมเปญ</button>
            </div>
          )}
          {loadingCamp ? (
            <Spinner label="กำลังโหลดแคมเปญ..." />
          ) : campaigns.length > 0 ? (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 text-xs text-slate-500">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.length === campaigns.length && campaigns.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? campaigns.map((c) => c.id) : [])}
                  />
                  เลือกทั้งหมด ({campaigns.length})
                </label>
                <span>เลือกแล้ว {selected.length}</span>
              </div>
              {campaigns.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="flex-1 min-w-0 truncate text-slate-700">{c.name}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${c.effective_status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.effective_status}</span>
                </label>
              ))}
            </div>
          ) : account ? (
            <div className="text-sm text-slate-400 py-4 text-center">บัญชีนี้ยังไม่มีแคมเปญ</div>
          ) : null}

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button onClick={pullReport} disabled={analyzing} className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2">
                {analyzing ? <Loader2 className="animate-spin" size={16} /> : <BarChart3 size={16} />}
                ดึงรายงาน ({selected.length})
              </button>
              {!restricted && selected.length >= 2 && (
                <button onClick={() => setShowCompare(true)} className="border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
                  <GitCompare size={16} /> เปรียบเทียบ
                </button>
              )}
              {result && (
                <button onClick={() => setShowOverview(true)} className="border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
                  <BarChart3 size={16} /> ดูรายงานล่าสุด
                </button>
              )}
            </div>
          )}

          {showOverview && result && (
            <CampaignOverviewView
              initialResult={result}
              campaignIds={selected}
              range={range}
              textModel={textModel}
              restricted={restricted}
              onClose={() => { setShowOverview(false); lsSet("ov.dashItem", null); lsSet("ov.expandedCamps", {}); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// หน้า overview เต็มจอของแคมเปญที่เลือก — ตัวเลขล้วนก่อน แล้วมีปุ่ม "AI วิเคราะห์" ในหน้านี้
function CampaignOverviewView({ initialResult, campaignIds, range, textModel, onClose, restricted = false }) {
  const [result, setResult] = useState(initialResult);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [dashItem, setDashItem] = useState(() => lsGet("ov.dashItem", null));
  const [expandedCamps, setExpandedCamps] = useState(() => lsGet("ov.expandedCamps", {}));
  const toggleCamp = (id) => setExpandedCamps((prev) => ({ ...prev, [id]: !prev[id] }));
  useEffect(() => { lsSet("ov.dashItem", dashItem); }, [dashItem]);
  useEffect(() => { lsSet("ov.expandedCamps", expandedCamps); }, [expandedCamps]);

  async function runAI() {
    setAiBusy(true);
    setAiError("");
    const { data, error } = await supabase.functions.invoke("analyze-campaigns", {
      body: { campaign_ids: campaignIds, ...rangeToBody(range), text_model: textModel, use_ai: true },
    });
    setAiBusy(false);
    if (error) { setAiError(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setAiError(data?.error || "วิเคราะห์ไม่สำเร็จ"); return; }
    setResult(data);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto">
      {dashItem && <AdDashboardModal ad={dashItem} ai={null} onClose={() => setDashItem(null)} onNavigate={setDashItem} />}
      <div className="safe-top sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="w-full px-4 sm:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm shrink-0">
              <ArrowLeft size={18} /> กลับ
            </button>
            <HomeButton />
            <div className="font-semibold text-slate-800 truncate">รายงานแคมเปญ ({result.campaigns.length}) · {rangeLabel(range)}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:justify-end">
            <ThemeToggle />
            <button onClick={runAI} disabled={aiBusy} className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-1.5">
              {aiBusy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} AI วิเคราะห์
            </button>
            <button onClick={() => exportCampaignAnalysisPdf(result)} className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
              <FileDown size={14} /> Export PDF
            </button>
          </div>
        </div>
      </div>

      <div className="w-full p-4 sm:p-6 space-y-3">
        {aiError && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{aiError}</div>}
        {result.ai === "failed" && <div className="text-xs text-amber-600">คำวิเคราะห์ AI ไม่สำเร็จ (แสดงเฉพาะตัวเลข)</div>}
        {result.campaigns.map((c) => (
          <div key={c.campaign_id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => toggleCamp(c.campaign_id)} className="min-w-0 flex items-start gap-2 text-left group">
                <span className="text-slate-600 group-hover:text-slate-900 mt-0.5 shrink-0">
                  {expandedCamps[c.campaign_id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-slate-800 text-sm truncate group-hover:underline">{c.name}</span>
                  <span className="block text-[11px] text-slate-400">{c.objective} · {c.effective_status} · แตะเพื่อดูชุดโฆษณา</span>
                </span>
              </button>
              <button onClick={() => setDashItem({ ad_id: c.campaign_id, headline: c.name, level: "campaign" })} className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 text-slate-600 hover:bg-slate-50 flex items-center gap-1 shrink-0">
                <BarChart3 size={13} /> แดชบอร์ด
              </button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>Spend: <b>{fmtNum(c.metrics.spend)}฿</b></span>
              <span>Leads: <b>{fmtNum(c.metrics.leads)}</b></span>
              <span>CPL: <b>{c.metrics.cpl ? fmtNum(c.metrics.cpl) + "฿" : "—"}</b></span>
              <span>CTR: {fmtNum(c.metrics.ctr, 2)}%</span>
              <span>CPM: {fmtNum(c.metrics.cpm)}฿</span>
              <span>คลิก: {fmtNum(c.metrics.clicks)}</span>
              {c.metrics.reply_rate != null && <span className={c.metrics.reply_rate < 0.4 ? "text-rose-600" : ""}>อัตราตอบ: {Math.min(100, Math.round(c.metrics.reply_rate * 100))}%</span>}
            </div>
            {c.result_th && <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-2.5 py-1.5">{c.result_th}</div>}
            {c.recommendation_th && <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-2.5 py-1.5">แนะนำ: {c.recommendation_th}</div>}

            {!restricted && (c.recommended_changes || []).length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-medium text-slate-400">สิ่งที่ AI แนะนำให้ปรับ (กดอนุมัติทีละรายการ)</div>
                {c.recommended_changes.map((ch, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-2.5 py-1.5">
                    <div className="text-xs text-slate-600 min-w-0">
                      <span className="font-medium text-slate-800">{ch.label_th || CHANGE_LABEL[ch.action] || ch.action}</span>
                      {ch.reason_th ? ` — ${ch.reason_th}` : ""}
                    </div>
                    <ApplyChangeButton
                      change={{ action: ch.action, target_type: ch.target_type, target_id: ch.target_id, value: ch.value }}
                      tone={ch.action === "pause" ? "rose" : ch.action === "resume" ? "emerald" : "slate"}
                      label="อนุมัติ"
                    />
                  </div>
                ))}
              </div>
            )}

            {!restricted && (
              <div className="flex gap-2 pt-1">
                {c.effective_status === "ACTIVE" ? (
                  <ApplyChangeButton change={{ action: "pause", target_type: "campaign", target_id: c.campaign_id }} tone="rose" label="หยุดแคมเปญนี้" />
                ) : (
                  <ApplyChangeButton change={{ action: "resume", target_type: "campaign", target_id: c.campaign_id }} tone="emerald" label="เปิดแคมเปญนี้" />
                )}
              </div>
            )}

            {expandedCamps[c.campaign_id] && (
              <div className="pt-2 mt-1 border-t border-slate-100">
                <div className="text-[11px] font-medium text-slate-400 mb-2">ชุดโฆษณาในแคมเปญนี้ (แตะชุดเพื่อดูโฆษณา · ปุ่มแดชบอร์ดดูผลรายชิ้น)</div>
                <ChildrenList parentId={c.campaign_id} level="adsets" range={range} onDash={setDashItem} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function exportCampaignAnalysisPdf(result) {
  const esc = escHtml;
  const cards = (result.campaigns || [])
    .map((c) => {
      const m = c.metrics || {};
      const changes = (c.recommended_changes || []).map((ch) => `<li>${esc(ch.label_th || ch.action)}${ch.reason_th ? " — " + esc(ch.reason_th) : ""}</li>`).join("");
      return `<div class="c"><h2>${esc(c.name)}</h2>
        <div class="meta">${esc(c.objective || "")} · ${esc(c.effective_status || "")}</div>
        <table><tr><th>Spend</th><td>${esc(Math.round(m.spend || 0).toLocaleString())}฿</td><th>Leads</th><td>${esc(Math.round(m.leads || 0).toLocaleString())}</td></tr>
        <tr><th>CPL</th><td>${m.cpl ? Math.round(m.cpl).toLocaleString() + "฿" : "—"}</td><th>CTR</th><td>${esc((m.ctr || 0).toFixed(2))}%</td></tr></table>
        ${c.result_th ? `<p><b>ผล:</b> ${esc(c.result_th)}</p>` : ""}
        ${c.recommendation_th ? `<p><b>แนะนำ:</b> ${esc(c.recommendation_th)}</p>` : ""}
        ${changes ? `<p><b>สิ่งที่ควรปรับ:</b></p><ul>${changes}</ul>` : ""}</div>`;
    })
    .join("");
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>วิเคราะห์แคมเปญ</title>
<style>body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:24px;line-height:1.5}
h1{font-size:18px}h2{font-size:14px;margin:4px 0}.meta{color:#64748b;font-size:12px}
.c{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:10px 0;break-inside:avoid}
table{border-collapse:collapse;font-size:12px;margin:6px 0}th,td{border:1px solid #e2e8f0;padding:4px 8px;text-align:left}
ul{margin:4px 0 0 18px;font-size:12.5px}p{font-size:12.5px;margin:4px 0}@page{margin:14mm}</style></head><body>${exportPageNavHtml("campaigns")}
<h1>ผลวิเคราะห์แคมเปญ (${(result.campaigns || []).length} รายการ)</h1>
<div class="meta">อัปเดต ${esc(new Date(result.generated_at || Date.now()).toLocaleString("th-TH"))}</div>
${cards}
<script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่"); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function AnalyzeTab({ adContent, metricsHistoryByAd, settings, onChanged, restricted = false, allowedAccounts = [] }) {
  const [textModel, setTextModel] = useState(settings.ai_models?.analyze_ads || "openai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [compareSet, setCompareSet] = useState([]); // [{ad_id, headline}]
  const [showCompare, setShowCompare] = useState(false);

  function toggleCompare(ad) {
    setCompareSet((prev) =>
      prev.some((x) => x.ad_id === ad.ad_id)
        ? prev.filter((x) => x.ad_id !== ad.ad_id)
        : [...prev, { ad_id: ad.ad_id, headline: ad.headline || ad.ad_id }]
    );
  }

  const arch = useArchive(onChanged);
  // แยกรายการที่ถูกซ่อน — ใช้ธงเดียวกับหน้าแคมเปญ (ซ่อนที่หนึ่ง = ซ่อนทั้งสองหน้า)
  const archivedAll = adContent.filter((a) => a.archived_at);
  const pool = adContent.filter((a) => (arch.showArchived ? a.archived_at : !a.archived_at));

  const launched = pool.filter((a) => a.status === "active" || a.status === "paused_auto");
  const saved = settings.ads_analysis || null;
  const intervalMin = settings.optimization_thresholds?.monitor_interval_minutes;

  // ผล AI ที่บันทึกไว้ล่าสุด — จับคู่ตาม id แอด / campaign_id
  const aiByAd = {};
  const aiByCampaign = {};
  (saved?.campaigns || []).forEach((c) => {
    aiByCampaign[c.campaign_id] = c;
    (c.ads || []).forEach((a) => (aiByAd[a.id] = a));
  });

  // จัดกลุ่มแอดที่ลอนช์แล้วตามแคมเปญ
  const groups = {};
  launched.forEach((ad) => {
    const key = ad.campaign_id || "ungrouped";
    (groups[key] = groups[key] || { campaign_id: key, launch_mode: ad.launch_mode, ads: [] }).ads.push(ad);
  });
  const campaignGroups = Object.values(groups);

  async function handleAnalyzeNow() {
    setBusy(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("analyze-ads", {
      body: { text_model: textModel },
    });
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      setBusy(false);
      return;
    }
    if (!data?.ok) {
      setError(data?.error || "วิเคราะห์ไม่สำเร็จ");
      setBusy(false);
      return;
    }
    await onChanged?.(); // โหลดผล + metric ล่าสุดกลับมาแสดง
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <MetaBrowsePanel settings={settings} restricted={restricted} allowedAccounts={allowedAccounts} />

      {false && !restricted && (<>   {/* ซ่อนส่วน "วิเคราะห์ผลโฆษณา" ออกจากหน้านี้ทั้งหมด */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-800">วิเคราะห์ผลโฆษณา</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              ระบบวิเคราะห์อัตโนมัติ{intervalMin ? `ทุก ~${intervalMin} นาที` : "ตามรอบที่ตั้งไว้"} (auto-pause แอดที่ผลต่ำกว่าเป้า และเสนอเพิ่มงบแอดที่ผลดี)
              — หรือกด "วิเคราะห์ตอนนี้" เพื่อดึงผลสดจาก Meta พร้อมคำวิเคราะห์จาก AI ทันที
            </p>
            {saved?.generated_at && (
              <p className="text-[11px] text-slate-400 mt-1">
                วิเคราะห์ล่าสุด {new Date(saved.generated_at).toLocaleString("th-TH")}
                {saved.source === "db" ? " · ใช้ข้อมูลที่บันทึกไว้ (ดึงสดจาก Meta ไม่ได้)" : saved.source === "meta" ? " · ดึงสดจาก Meta" : ""}
                {saved.ai === "failed" ? " · คำวิเคราะห์ AI ไม่สำเร็จรอบล่าสุด" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white"
              value={textModel}
              onChange={(e) => setTextModel(e.target.value)}
              disabled={busy}
            >
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
            <button
              onClick={handleAnalyzeNow}
              disabled={busy || launched.length === 0}
              className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <BarChart3 size={16} />}
              {busy ? "กำลังวิเคราะห์..." : "วิเคราะห์ตอนนี้"}
            </button>
          </div>
        </div>
        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-3">{error}</div>}
      </div>

      {/* ติ๊กเลือกแอดแล้วกดล้าง = ซ่อนออกจากรายการ (ข้อมูล/ประวัติผลยังอยู่ กู้คืนได้) */}
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-2.5 shadow-sm">
        <ArchiveBar a={arch} visibleIds={launched.map((a) => a.id)} archivedCount={archivedAll.length} />
      </div>

      {launched.length === 0 ? (
        <div className="text-sm text-slate-500 py-10 text-center">
          {arch.showArchived ? "ไม่มีรายการที่ซ่อนไว้" : "ยังไม่มีแอดที่ลอนช์แล้วให้วิเคราะห์"}
        </div>
      ) : (
        campaignGroups.map((g) => {
          const totals = g.ads.reduce(
            (acc, ad) => {
              const m = metricsHistoryByAd[ad.id]?.[0];
              acc.spend += m?.spend || 0;
              acc.leads += m?.leads || 0;
              return acc;
            },
            { spend: 0, leads: 0 }
          );
          const blendedCpa = totals.leads > 0 ? totals.spend / totals.leads : null;
          const campAi = aiByCampaign[g.campaign_id];
          const isMulti = g.launch_mode === "single_campaign_multi_ad" || g.ads.length > 1;

          return (
            <div key={g.campaign_id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-800 flex items-center gap-2">
                    {isMulti ? "แคมเปญ (หลายโฆษณา)" : "แคมเปญ"}
                    <span className="text-xs font-normal text-slate-400">{g.ads.length} โฆษณา</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Campaign ID: {g.campaign_id === "ungrouped" ? "ไม่ได้ระบุ" : g.campaign_id}
                  </div>
                </div>
                <div className="text-xs text-slate-600 text-right">
                  <div>รวม Spend <b className="text-slate-800">{fmtNum(totals.spend)}</b> · Leads <b className="text-slate-800">{fmtNum(totals.leads)}</b></div>
                  <div>CPA เฉลี่ย <b className="text-slate-800">{blendedCpa ? fmtNum(blendedCpa) : "-"}</b> บาท</div>
                </div>
              </div>

              {(campAi?.summary_th || campAi?.recommendation_th) && (
                <div className="space-y-1.5">
                  {campAi.summary_th && (
                    <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{campAi.summary_th}</div>
                  )}
                  {campAi.recommendation_th && (
                    <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2 flex gap-1.5">
                      <AlertTriangle size={15} className="shrink-0 mt-0.5 text-emerald-600" />
                      <span>{campAi.recommendation_th}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {g.ads.map((ad) => (
                  <div key={ad.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={arch.isSel(ad.id)}
                      onChange={() => arch.toggle(ad.id)}
                      className="w-4 h-4 mt-4 shrink-0 cursor-pointer"
                      title={arch.showArchived ? "เลือกเพื่อกู้คืน" : "เลือกเพื่อซ่อนออกจากรายการ"}
                    />
                    <div className="flex-1 min-w-0">
                      <AdAnalysisCard
                        ad={ad}
                        latestMetric={metricsHistoryByAd[ad.id]?.[0]}
                        history={metricsHistoryByAd[ad.id]}
                        ai={aiByAd[ad.id]}
                        onChanged={onChanged}
                        compareChecked={compareSet.some((x) => x.ad_id === ad.ad_id)}
                        onToggleCompare={toggleCompare}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* แถบเปรียบเทียบลอยด้านล่างเมื่อเลือก >= 2 */}
      {compareSet.length >= 2 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-full shadow-lg px-4 py-2.5 flex items-center gap-3">
          <span className="text-sm">เลือกเปรียบเทียบ {compareSet.length} รายการ</span>
          <button onClick={() => setShowCompare(true)} className="bg-white text-slate-900 rounded-full px-3 py-1 text-xs font-medium flex items-center gap-1.5">
            <GitCompare size={14} /> เปรียบเทียบ
          </button>
          <button onClick={() => setCompareSet([])} className="text-slate-300 hover:text-white text-xs">ล้าง</button>
        </div>
      )}
      {showCompare && <CompareView items={compareSet} onClose={() => setShowCompare(false)} aiModel={textModel} />}
      </>)}
    </div>
  );
}

// ---------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------
// แสดงค่าเป็นแถว label/value — ข้ามอัตโนมัติถ้าไม่มีค่า
function ReportRow({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <div className="col-span-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="col-span-2 text-sm text-slate-700 whitespace-pre-line">{value}</div>
    </div>
  );
}

function ReportChips({ label, items, tone = "slate" }) {
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return null;
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    rose: "bg-rose-100 text-rose-700",
  };
  return (
    <div className="py-1.5 border-b border-slate-100 last:border-0">
      <div className="text-xs font-medium text-slate-500 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {list.map((it, i) => (
          <span key={i} className={`text-xs px-2 py-1 rounded-full ${tones[tone]}`}>{it}</span>
        ))}
      </div>
    </div>
  );
}

function ReportSection({ title, children }) {
  return (
    <details open className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer select-none px-4 py-2.5 font-semibold text-slate-800 text-sm">{title}</summary>
      <div className="px-4 pb-3 pt-1">{children}</div>
    </details>
  );
}

// รายงานวิเคราะห์แบบละเอียด (playbook) จาก AI
function AnalysisReport({ analysis }) {
  if (!analysis) return null;
  const recs = analysis.campaign_recommendations || [];
  const cl = analysis.campaign_level || {};
  const as = analysis.adset_level || {};
  const ad = analysis.ad_level || {};
  const dt = as.detailed_targeting || {};

  return (
    <div className="space-y-3">
      {analysis.summary && (
        <div className="text-sm text-slate-700 bg-slate-50 rounded-xl px-4 py-3 whitespace-pre-line">
          {analysis.summary}
        </div>
      )}

      {recs.length > 0 && (
        <ReportSection title="แนะนำประเภทแคมเปญ (เรียงตามลำดับแนะนำ)">
          <div className="space-y-2.5">
            {recs.map((r, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-semibold">
                    {r.rank ?? i + 1}
                  </span>
                  <span className="font-medium text-slate-800 text-sm">{r.objective_th || r.meta_objective}</span>
                  {r.meta_objective && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">{r.meta_objective}</span>
                  )}
                </div>
                <div className="space-y-1">
                  <ReportRow label="จุดเก็บ Conversion" value={r.conversion_location_th} />
                  <ReportRow label="ทำไมแนะนำ" value={r.why} />
                  <ReportRow label="เหมาะกับ" value={r.best_for} />
                  <ReportRow label="ข้อควรระวัง" value={r.watchouts} />
                </div>
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {Object.keys(cl).length > 0 && (
        <ReportSection title="ตั้งค่าระดับแคมเปญ (Campaign)">
          <ReportRow label="วัตถุประสงค์" value={cl.recommended_objective_th} />
          <ReportRow label="ประเภทการซื้อ" value={cl.buying_type_th} />
          <ReportRow label="หมวดโฆษณาพิเศษ" value={cl.special_ad_category_th} />
          <ReportRow label="การตั้งงบ" value={cl.budget_type_th} />
          <ReportRow label="งบ/วัน (บาท)" value={cl.recommended_daily_budget_thb} />
          <ReportRow label="กลยุทธ์บิด" value={cl.bid_strategy_th} />
          <ReportRow label="A/B Test" value={cl.ab_test_th} />
          <ReportRow label="หมายเหตุ" value={cl.notes} />
        </ReportSection>
      )}

      {Object.keys(as).length > 0 && (
        <ReportSection title="ตั้งค่าระดับชุดโฆษณา (Ad set)">
          <ReportRow label="ปรับให้เหมาะกับ" value={as.optimization_event_th} />
          <ReportRow label="ที่ตั้ง Conversion" value={as.conversion_location_th} />
          <ReportRow label="Advantage+ Audience" value={as.advantage_audience_th} />
          <ReportRow label="ขยายกลุ่มอัตโนมัติ" value={as.advantage_detailed_targeting_expansion_th} />
          <ReportChips label="ความสนใจ (Interests)" items={dt.interests} tone="green" />
          <ReportChips label="พฤติกรรม (Behaviors)" items={dt.behaviors} tone="green" />
          <ReportRow label="วิธีจัดกลุ่มเป้าหมาย" value={dt.notes} />
          <ReportRow label="อายุ" value={as.age_th} />
          <ReportRow label="เพศ" value={as.gender_th} />
          <ReportRow label="พื้นที่" value={as.locations_th} />
          <ReportRow label="ภาษา" value={as.languages_th} />
          <ReportRow label="ตำแหน่งจัดวาง (Placements)" value={as.placements_recommendation_th} />
          <ReportChips label="ตำแหน่งที่แนะนำ" items={as.recommended_placements} tone="green" />
          <ReportChips label="ตำแหน่งที่ควรเลี่ยง" items={as.placements_to_avoid} tone="rose" />
          <ReportRow label="การตั้งเวลา" value={as.schedule_th} />
          <ReportRow label="Attribution" value={as.attribution_setting_th} />
          <ReportRow label="หมายเหตุ" value={as.notes} />
        </ReportSection>
      )}

      {Object.keys(ad).length > 0 && (
        <ReportSection title="ตั้งค่าระดับโฆษณา (Ad)">
          <ReportRow label="รูปแบบโฆษณา" value={ad.format_th} />
          <ReportRow label="Advantage+ Creative" value={ad.advantage_plus_creative_th} />
          <ReportRow label="ข้อความหลัก" value={ad.primary_text_tips_th} />
          <ReportRow label="พาดหัว" value={ad.headline_tips_th} />
          <ReportRow label="คำอธิบาย" value={ad.description_tips_th} />
          <ReportRow label="ปุ่ม CTA" value={ad.cta_button_th} />
          <ReportRow label="ปลายทาง" value={ad.destination_th} />
          <ReportRow label="เคล็ดลับครีเอทีฟ" value={ad.creative_tips_th} />
          <ReportRow label="นโยบายโฆษณา" value={ad.compliance_th} />
          <ReportRow label="หมายเหตุ" value={ad.notes} />
        </ReportSection>
      )}

      {(analysis.testing_plan_th || analysis.kpis_th) && (
        <ReportSection title="แผนทดสอบ & ตัวชี้วัด (KPI)">
          <ReportRow label="แผนทดสอบ/สเกล" value={analysis.testing_plan_th} />
          <ReportRow label="KPI ที่ต้องจับตา" value={analysis.kpis_th} />
        </ReportSection>
      )}

      {analysis.generated_at && (
        <div className="text-[11px] text-slate-400">
          วิเคราะห์เมื่อ {new Date(analysis.generated_at).toLocaleString("th-TH")}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Export คำแนะนำ AI เป็น PDF (ผ่านหน้าพิมพ์ของเบราว์เซอร์ -> Save as PDF)
// ใช้วิธีนี้เพราะรองรับภาษาไทยได้สมบูรณ์และไม่ต้องเพิ่มไลบรารีภายนอก
// ---------------------------------------------------------------
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function buildAnalysisHtml(analysis) {
  const a = analysis || {};
  const cl = a.campaign_level || {};
  const as = a.adset_level || {};
  const ad = a.ad_level || {};
  const dt = as.detailed_targeting || {};
  const lc = a.launch_config || null;
  const pref = a.preferences || null;

  const CONV = { instant_form: "เก็บลีดผ่านฟอร์ม", messaging: "ทักแชท", website: "เว็บ/แลนดิ้ง", calls: "โทร" };
  const FMT = { image: "รูปภาพ", video: "วิดีโอ", mixed: "ผสมรูป+วิดีโอ", auto: "ให้ AI แนะนำ" };
  const LANG = { th: "ไทย", en: "อังกฤษ", th_en: "ไทย+อังกฤษ", other: "อื่นๆ", auto: "ให้ AI แนะนำ" };
  const STYLE = {
    auto: "ให้ AI แนะนำ",
    lead_form: "เก็บลีดผ่านฟอร์ม",
    chat: "ทักแชท",
    traffic: "ส่งเข้าเว็บ",
    conversions: "ปิดการขายบนเว็บ",
  };

  const rows = (pairs) =>
    pairs
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([l, v]) => `<tr><th>${escHtml(l)}</th><td>${escHtml(v)}</td></tr>`)
      .join("");

  const chips = (arr) =>
    (arr || []).filter(Boolean).map((x) => `<span class="chip">${escHtml(x)}</span>`).join(" ");

  const recsHtml = (a.campaign_recommendations || [])
    .map(
      (r, i) => `
      <div class="rec">
        <div class="rec-h"><span class="rank">${escHtml(r.rank ?? i + 1)}</span> ${escHtml(r.objective_th || r.meta_objective || "")} ${
        r.meta_objective ? `<code>${escHtml(r.meta_objective)}</code>` : ""
      }</div>
        <table>${rows([
          ["จุดเก็บ Conversion", r.conversion_location_th],
          ["ทำไมแนะนำ", r.why],
          ["เหมาะกับ", r.best_for],
          ["ข้อควรระวัง", r.watchouts],
        ])}</table>
      </div>`
    )
    .join("");

  const section = (title, inner) => (inner ? `<h2>${escHtml(title)}</h2>${inner}` : "");

  const prefHtml = pref
    ? `<table>${rows([
        ["สะดวกยิงแบบ", STYLE[pref.campaign_style] || pref.campaign_style],
        ["รูปแบบครีเอทีฟ", FMT[pref.creative_format] || pref.creative_format],
        ["ภาษา", LANG[pref.language] || pref.language],
      ])}</table>`
    : "";

  const lcHtml = lc
    ? `<table>${rows([
        ["ประเภทแคมเปญ", lc.objective ? `${lc.objective}${lc.conversion_location ? " · " + (CONV[lc.conversion_location] || lc.conversion_location) : ""}` : null],
        ["รูปแบบครีเอทีฟ", FMT[lc.creative_format] || lc.creative_format],
        ["ภาษา", LANG[lc.language] || lc.language],
        ["Advantage+ Audience", lc.advantage_audience === 1 ? "เปิด" : "ปิด"],
        ["ตำแหน่งจัดวาง", lc.placements?.mode === "manual" ? `กำหนดเอง${(lc.placements.publisher_platforms || []).length ? " · " + lc.placements.publisher_platforms.join(", ") : ""}` : "Advantage+ (อัตโนมัติ)"],
        ["กลยุทธ์บิด", lc.bid_strategy],
        ["Advantage+ Creative", lc.advantage_plus_creative ? "เปิด" : "ปิด"],
        ["ปุ่ม CTA เริ่มต้น", lc.default_cta],
        ["หมวดโฆษณาพิเศษ", Array.isArray(lc.special_ad_categories) && lc.special_ad_categories.length ? lc.special_ad_categories.join(", ") : "ไม่มี"],
      ])}</table>`
    : "";

  const generatedAt = a.generated_at ? new Date(a.generated_at).toLocaleString("th-TH") : new Date().toLocaleString("th-TH");

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>คำแนะนำ AI Ads</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun','Noto Sans Thai','Prompt',system-ui,-apple-system,'Segoe UI',sans-serif; color:#1e293b; margin:32px; line-height:1.55; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:15px; margin:22px 0 8px; padding-bottom:4px; border-bottom:2px solid #0f172a; }
  .meta { color:#64748b; font-size:12px; margin-bottom:4px; }
  .summary { background:#f1f5f9; border-radius:8px; padding:12px; font-size:13px; margin-top:10px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; margin:6px 0 4px; }
  th { text-align:left; width:34%; color:#64748b; font-weight:600; vertical-align:top; padding:5px 8px; border-bottom:1px solid #e2e8f0; }
  td { padding:5px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; white-space:pre-line; }
  .rec { border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin:8px 0; break-inside:avoid; }
  .rec-h { font-weight:600; margin-bottom:2px; }
  .rank { display:inline-block; width:20px; height:20px; line-height:20px; text-align:center; background:#0f172a; color:#fff; border-radius:50%; font-size:12px; margin-right:4px; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:11px; color:#475569; }
  .chip { display:inline-block; background:#e2e8f0; color:#334155; border-radius:999px; padding:2px 8px; font-size:11px; margin:1px 0; }
  h2, .rec, table { break-inside:avoid; }
  @page { margin:16mm; }
</style></head><body>${exportPageNavHtml("analyze")}
  <h1>คำแนะนำการยิงโฆษณา (AI Playbook)</h1>
  <div class="meta">สร้างเมื่อ ${escHtml(generatedAt)}</div>
  ${a.business_desc ? `<div class="meta">โจทย์: ${escHtml(a.business_desc)}</div>` : ""}
  ${a.summary ? `<div class="summary">${escHtml(a.summary)}</div>` : ""}
  ${section("ตัวเลือกที่เลือกไว้", prefHtml)}
  ${section("แนะนำประเภทแคมเปญ (เรียงตามลำดับ)", recsHtml)}
  ${section(
    "ตั้งค่าระดับแคมเปญ",
    rows([
      ["วัตถุประสงค์", cl.recommended_objective_th],
      ["ประเภทการซื้อ", cl.buying_type_th],
      ["หมวดโฆษณาพิเศษ", cl.special_ad_category_th],
      ["การตั้งงบ", cl.budget_type_th],
      ["งบ/วัน (บาท)", cl.recommended_daily_budget_thb],
      ["กลยุทธ์บิด", cl.bid_strategy_th],
      ["A/B Test", cl.ab_test_th],
      ["หมายเหตุ", cl.notes],
    ])
      ? `<table>${rows([
          ["วัตถุประสงค์", cl.recommended_objective_th],
          ["ประเภทการซื้อ", cl.buying_type_th],
          ["หมวดโฆษณาพิเศษ", cl.special_ad_category_th],
          ["การตั้งงบ", cl.budget_type_th],
          ["งบ/วัน (บาท)", cl.recommended_daily_budget_thb],
          ["กลยุทธ์บิด", cl.bid_strategy_th],
          ["A/B Test", cl.ab_test_th],
          ["หมายเหตุ", cl.notes],
        ])}</table>`
      : ""
  )}
  ${section(
    "ตั้งค่าระดับชุดโฆษณา (Ad set)",
    `<table>${rows([
      ["ปรับให้เหมาะกับ", as.optimization_event_th],
      ["ที่ตั้ง Conversion", as.conversion_location_th],
      ["Advantage+ Audience", as.advantage_audience_th],
      ["ขยายกลุ่มอัตโนมัติ", as.advantage_detailed_targeting_expansion_th],
      ["อายุ", as.age_th],
      ["เพศ", as.gender_th],
      ["พื้นที่", as.locations_th],
      ["ภาษา", as.languages_th],
      ["ตำแหน่งจัดวาง", as.placements_recommendation_th],
      ["การตั้งเวลา", as.schedule_th],
      ["Attribution", as.attribution_setting_th],
      ["หมายเหตุ", as.notes],
    ])}</table>
    ${dt.interests?.length ? `<div><b>ความสนใจ:</b> ${chips(dt.interests)}</div>` : ""}
    ${dt.behaviors?.length ? `<div><b>พฤติกรรม:</b> ${chips(dt.behaviors)}</div>` : ""}
    ${dt.notes ? `<div style="font-size:12.5px;margin-top:4px;">${escHtml(dt.notes)}</div>` : ""}
    ${as.recommended_placements?.length ? `<div style="margin-top:4px;"><b>ตำแหน่งที่แนะนำ:</b> ${chips(as.recommended_placements)}</div>` : ""}
    ${as.placements_to_avoid?.length ? `<div><b>ตำแหน่งที่ควรเลี่ยง:</b> ${chips(as.placements_to_avoid)}</div>` : ""}`
  )}
  ${section(
    "ตั้งค่าระดับโฆษณา (Ad)",
    `<table>${rows([
      ["รูปแบบโฆษณา", ad.format_th],
      ["Advantage+ Creative", ad.advantage_plus_creative_th],
      ["ข้อความหลัก", ad.primary_text_tips_th],
      ["พาดหัว", ad.headline_tips_th],
      ["คำอธิบาย", ad.description_tips_th],
      ["ปุ่ม CTA", ad.cta_button_th],
      ["ปลายทาง", ad.destination_th],
      ["เคล็ดลับครีเอทีฟ", ad.creative_tips_th],
      ["นโยบายโฆษณา", ad.compliance_th],
      ["หมายเหตุ", ad.notes],
    ])}</table>`
  )}
  ${section(
    "แผนทดสอบ & KPI",
    rows([["แผนทดสอบ/สเกล", a.testing_plan_th], ["KPI", a.kpis_th]])
      ? `<table>${rows([["แผนทดสอบ/สเกล", a.testing_plan_th], ["KPI", a.kpis_th]])}</table>`
      : ""
  )}
  ${section("ค่าที่จะใช้ตอนลอนช์ (Launch config)", lcHtml)}
  <script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
}

function exportAnalysisPdf(analysis) {
  const html = buildAnalysisHtml(analysis);
  const w = window.open("", "_blank");
  if (!w) {
    alert("เบราว์เซอร์บล็อกป็อปอัป — กรุณาอนุญาต popup สำหรับหน้านี้แล้วลองใหม่");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ตารางสรุปรายวัน — ใช้ทั้ง export ปกติ (fallback) และ export แบบภาพเต็มหน้า
//   จำนวนทัก = ดึงจาก Meta (leads) · จำนวนคนที่ทัก/แอด = นับจากแชทเพจจริง (page_chats_by_date) · ราคาต่อผลลัพธ์ = ค่าใช้จ่าย ÷ จำนวนทัก
function dailyTableHtml(ad, data) {
  const esc = escHtml;
  const list = (data?.daily || []).filter(Boolean);
  if (!list.length) return "";
  const opensByDate = data?.accountOpensByDate || {};
  const pageChatsByDate = data?.page_chats_by_date || {};
  const num = (v, d = 0) => (v == null || isNaN(v)) ? "-" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const beDate = (ds) => { if (!ds) return "-"; const p = String(ds).split("-").map(Number); if (p.length !== 3) return String(ds); return `${p[2]}/${p[1]}/${String((p[0] + 543) % 100).padStart(2, "0")}`; };
  let tLeads = 0, tPage = 0, tOpens = 0, tImpr = 0, tSpend = 0;
  const body = list.map((d) => {
    const day = String(d.date).slice(0, 10);
    // จำนวนทัก = การเริ่มการสนทนา (conversations) ให้ตรงกับ "แชทเริ่ม" · ราคาต่อผลลัพธ์ = ค่าใช้จ่าย ÷ จำนวนทัก
    const taks = Number(d.conversations != null ? d.conversations : d.leads) || 0;
    const cpa = (taks > 0) ? d.spend / taks : null;
    const opens = opensByDate[day] || 0;
    const pc = pageChatsByDate[day];
    const pageChat = pc != null ? pc : d.replies;
    tLeads += taks; tPage += Number(pageChat) || 0; tOpens += opens; tImpr += Number(d.impressions) || 0; tSpend += Number(d.spend) || 0;
    return `<tr><td>${esc(beDate(d.date))}</td><td class="lft">${esc(ad.headline || "-")}</td><td>${esc(num(taks))}</td><td>${esc(num(pageChat))}</td><td>${opens > 0 ? esc(num(opens)) : "-"}</td><td>${cpa == null ? "-" : esc(num(cpa, 2))}</td><td>${esc(num(d.impressions))}</td><td>${esc(num(d.spend, 2))}</td></tr>`;
  }).join("");
  const cprTotal = tLeads > 0 ? tSpend / tLeads : null;   // ราคาต่อผลลัพธ์รวม = ค่าใช้จ่ายรวม ÷ จำนวนทักรวม
  const totalRow = `<tr class="total"><td colspan="2" class="lft">รวมทั้งหมด</td><td>${esc(num(tLeads))}</td><td>${esc(num(tPage))}</td><td>${tOpens > 0 ? esc(num(tOpens)) : "-"}</td><td>${cprTotal == null ? "-" : esc(num(cprTotal, 2))}</td><td>${esc(num(tImpr))}</td><td>${esc(num(tSpend, 2))}</td></tr>`;
  const sub = (t) => `<br><span style="font-weight:400;font-size:9.5px;opacity:.8">${t}</span>`;
  return `<h2>สรุปรายวัน</h2><table class="daily"><thead><tr><th>Date</th><th>Link</th><th>จำนวนทัก${sub("(ดึงจาก Meta)")}</th><th>จำนวนคนที่ทัก / แอด${sub("(นับจากแชทเพจ · ทักครั้งแรก)")}</th><th>ลูกค้าที่เปิดบัญชี</th><th>ราคาต่อผลลัพธ์</th><th>ผลลัพธ์การมอง</th><th>ค่าใช้จ่ายปัจจุบัน</th></tr></thead><tbody>${body}${totalRow}</tbody></table>`;
}

// สร้าง PDF สรุปแดชบอร์ดรายแอด (KPI + งบ + breakdown + ตารางสรุปรายวัน) ผ่านหน้าพิมพ์ — รูปแบบ HTML อ่านง่าย
function buildDashboardHtml(ad, data, budget) {
  const o = data?.overall || {};
  const esc = escHtml;
  const kpiRow = (label, val) => `<tr><th>${esc(label)}</th><td>${esc(val)}</td></tr>`;
  const breakdownTable = (title, items, labelFn) => {
    const list = (items || []).filter((i) => (i.impressions || 0) > 0).slice(0, 12);
    if (!list.length) return "";
    const max = Math.max(1, ...list.map((i) => i.impressions));
    const rows = list
      .map((i) => {
        const pct = Math.round((i.impressions / max) * 100);
        return `<tr><td style="width:34%">${esc(labelFn ? labelFn(i.key) : i.key)}</td><td><div style="background:#e2e8f0;border-radius:6px;overflow:hidden"><div style="width:${pct}%;background:#4f46e5;height:12px"></div></div></td><td style="width:18%;text-align:right">${esc(Math.round(i.impressions).toLocaleString())}</td></tr>`;
      })
      .join("");
    return `<h2>${esc(title)}</h2><table>${rows}</table>`;
  };
  const devLabel = (k) => ({ mobile_app: "แอปมือถือ", mobile_web: "เว็บมือถือ", desktop: "เดสก์ท็อป", mobile_tablet: "แท็บเล็ต" }[k] || k);
  const genLabel = (k) => ({ male: "ชาย", female: "หญิง", unknown: "ไม่ระบุ" }[k] || k);


  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>Dashboard ${esc(ad.headline || "")}</title>
<style>
  body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:28px;line-height:1.5}
  h1{font-size:19px;margin:0 0 2px} h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #0f172a;padding-bottom:3px}
  .meta{color:#64748b;font-size:12px} table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0}
  th{text-align:left;color:#64748b;font-weight:600;padding:4px 8px;border-bottom:1px solid #e2e8f0;width:40%;vertical-align:top}
  td{padding:4px 8px;border-bottom:1px solid #e2e8f0;vertical-align:middle}
  .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
  .kpi{border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;min-width:120px}
  .kpi .l{font-size:11px;color:#64748b}.kpi .v{font-size:16px;font-weight:700}
  table.daily{border-collapse:collapse;width:100%;font-size:11.5px;margin:6px 0}
  table.daily th{background:#3f6f5e;color:#fff;border:1px solid #2c4f43;padding:6px 6px;text-align:center;font-weight:600;vertical-align:middle;width:auto}
  table.daily td{border:1px solid #94a3b8;padding:5px 7px;text-align:center;color:#1e293b;vertical-align:middle}
  table.daily td.lft{text-align:left;white-space:nowrap}
  table.daily tbody tr:nth-child(even) td{background:#eef1f4}
  table.daily tr.total td{background:#dfe8e3;font-weight:700;border-top:2px solid #3f6f5e}
  @page{margin:14mm}
</style></head><body>${exportPageNavHtml("analyze")}
  <h1>แดชบอร์ดโฆษณา — ${esc(ad.headline || "")}</h1>
  <div class="meta">Ad ID: ${esc(ad.ad_id || "-")} · ช่วง ${esc(data?.date_preset || "")} · ${esc(new Date(data?.generated_at || Date.now()).toLocaleString("th-TH"))}</div>
  <div class="kpis">
    <div class="kpi"><div class="l">ค่าใช้จ่าย</div><div class="v">${esc(Math.round(o.spend || 0).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">การมองเห็น</div><div class="v">${esc(Math.round(o.impressions || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">เข้าถึง</div><div class="v">${esc(Math.round(o.reach || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">ลีด</div><div class="v">${esc(Math.round(o.leads || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">CPL</div><div class="v">${o.cpl ? Math.round(o.cpl).toLocaleString() + "฿" : "—"}</div></div>
    <div class="kpi"><div class="l">CTR</div><div class="v">${esc((o.ctr || 0).toFixed(2))}%</div></div>
    <div class="kpi"><div class="l">CPC</div><div class="v">${esc(Math.round(o.cpc || 0).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">CPM</div><div class="v">${esc(Math.round(o.cpm || 0).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">คลิก</div><div class="v">${esc(Math.round(o.clicks || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">ความถี่</div><div class="v">${esc((o.frequency || 0).toFixed(2))}</div></div>
    <div class="kpi"><div class="l">Conv. rate</div><div class="v">${o.cvr != null ? esc(o.cvr.toFixed(1)) + "%" : "—"}</div></div>
  </div>
  ${o.conversations > 0 ? `<h2>แชท</h2><div class="kpis">
    <div class="kpi"><div class="l">แชทเริ่ม</div><div class="v">${esc(Math.round(o.conversations).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">ตอบกลับจริง</div><div class="v">${esc(Math.round(o.replies || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">อัตราตอบ</div><div class="v">${o.reply_rate != null ? Math.min(100, Math.round(o.reply_rate * 100)) + "%" : "—"}</div></div>
  </div>` : ""}
  ${budget && budget.totalWithVat > 0 ? `<h2>งบยิงโฆษณา</h2><div class="kpis">
    <div class="kpi"><div class="l">งบรวม VAT 7% แล้ว</div><div class="v">${esc(Math.round(budget.totalWithVat).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">งบยิง Ads (ก่อน VAT 7%)</div><div class="v">${esc(budget.beforeVat.toLocaleString("th-TH", { maximumFractionDigits: 2 }))}฿</div></div>
    <div class="kpi"><div class="l">ใช้จริงก่อน VAT</div><div class="v">${esc(Math.round(budget.spentBeforeVat).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">ใช้จริงรวม VAT</div><div class="v">${esc(Math.round(budget.spentWithVat).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">งบคงเหลือก่อน VAT 7%</div><div class="v" style="color:${budget.remainBeforeVat >= 0 ? "#059669" : "#dc2626"}">${esc(budget.remainBeforeVat.toLocaleString("th-TH", { maximumFractionDigits: 2 }))}฿</div></div>
    <div class="kpi"><div class="l">งบคงเหลือ (รวม VAT)</div><div class="v" style="color:${budget.remainWithVat >= 0 ? "#059669" : "#dc2626"}">${esc(Math.round(budget.remainWithVat).toLocaleString())}฿</div></div>
  </div>` : ""}
  ${dailyTableHtml(ad, data)}
  ${breakdownTable("ช่วงอายุ", data.age)}
  ${breakdownTable("เพศ", data.gender, genLabel)}
  ${breakdownTable("พื้นที่", data.region)}
  ${breakdownTable("ตำแหน่งจัดวาง", data.placement)}
  ${breakdownTable("อุปกรณ์", data.device, devLabel)}
  <script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
}

function exportAdDashboardPdf(ad, data, budget) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("เบราว์เซอร์บล็อกป็อปอัป — กรุณาอนุญาต popup แล้วลองใหม่");
    return;
  }
  w.document.open();
  w.document.write(buildDashboardHtml(ad, data, budget));
  w.document.close();
}

// ---- Export แดชบอร์ดเป็น Excel (.xls) / CSV (ไม่ต้องใช้ไลบรารีเพิ่ม) ----
const beDateTH = (ds) => { if (!ds) return "-"; const p = String(ds).split("-").map(Number); if (p.length !== 3) return String(ds); return `${p[2]}/${p[1]}/${String((p[0] + 543) % 100).padStart(2, "0")}`; };
function dashDailyRows(ad, data) {
  const list = (data?.daily || []).filter(Boolean);
  const opensByDate = data?.accountOpensByDate || {};
  const pcByDate = data?.page_chats_by_date || {};
  return list.map((d) => {
    const day = String(d.date).slice(0, 10);
    const taks = Number(d.conversations != null ? d.conversations : d.leads) || 0;   // จำนวนทัก = การเริ่มการสนทนา (แชทเริ่ม)
    const pc = pcByDate[day];
    const pageChat = pc != null ? pc : (Number(d.replies) || 0);
    const cpr = taks > 0 ? d.spend / taks : null;
    return { date: beDateTH(d.date), link: ad.headline || "-", taks, pageChat, opens: opensByDate[day] || 0, cpr, impr: Number(d.impressions) || 0, spend: Number(d.spend) || 0 };
  });
}
function dashTotals(rows) {
  const t = rows.reduce((a, r) => ({ taks: a.taks + r.taks, pageChat: a.pageChat + r.pageChat, opens: a.opens + (r.opens || 0), impr: a.impr + r.impr, spend: a.spend + r.spend }), { taks: 0, pageChat: 0, opens: 0, impr: 0, spend: 0 });
  t.cpr = t.taks > 0 ? t.spend / t.taks : null;
  return t;
}
function safeFileName(ad, ext) { return `dashboard-${String(ad.headline || "ad").replace(/[^\w ก-๙-]+/g, "_").slice(0, 40)}.${ext}`; }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
const DAILY_HEADERS = ["Date", "Link", "จำนวนทัก (Meta)", "จำนวนคนที่ทัก/แอด (เพจ, ทักครั้งแรก)", "ลูกค้าเปิดบัญชี", "ราคาต่อผลลัพธ์", "ผลลัพธ์การมอง", "ค่าใช้จ่าย"];
function exportAdDashboardCsv(ad, data) {
  const rows = dashDailyRows(ad, data);
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [DAILY_HEADERS.join(",")];
  for (const r of rows) lines.push([r.date, r.link, r.taks, r.pageChat, r.opens || 0, r.cpr == null ? "" : r.cpr.toFixed(2), r.impr, r.spend.toFixed(2)].map(esc).join(","));
  const t = dashTotals(rows);
  lines.push(["รวมทั้งหมด", "", t.taks, t.pageChat, t.opens, t.cpr == null ? "" : t.cpr.toFixed(2), t.impr, t.spend.toFixed(2)].map(esc).join(","));
  downloadBlob(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), safeFileName(ad, "csv"));
}
function exportAdDashboardExcel(ad, data, budget) {
  const esc = escHtml;
  const o = data?.overall || {};
  const rows = dashDailyRows(ad, data);
  const kpi = [["ค่าใช้จ่าย", Math.round(o.spend || 0)], ["การมองเห็น", Math.round(o.impressions || 0)], ["เข้าถึง", Math.round(o.reach || 0)], ["ลีด", Math.round(o.leads || 0)], ["CPL", o.cpl ? Math.round(o.cpl) : ""], ["CTR (%)", (o.ctr || 0).toFixed(2)], ["CPC", Math.round(o.cpc || 0)], ["CPM", Math.round(o.cpm || 0)], ["คลิก", Math.round(o.clicks || 0)], ["ความถี่", (o.frequency || 0).toFixed(2)], ["Conv. rate (%)", o.cvr != null ? o.cvr.toFixed(1) : ""]];
  if (o.conversations > 0) kpi.push(["แชทเริ่ม", Math.round(o.conversations)], ["ตอบกลับจริง", Math.round(o.replies || 0)], ["อัตราตอบ (%)", o.reply_rate != null ? Math.min(100, Math.round(o.reply_rate * 100)) : ""]);
  const budgetRows = (budget && budget.totalWithVat > 0) ? [
    ["งบรวม VAT 7% แล้ว", Math.round(budget.totalWithVat)],
    ["งบยิง Ads (ก่อน VAT 7%)", Number(budget.beforeVat.toFixed(2))],
    ["VAT 7%", Number(budget.vatAmount.toFixed(2))],
    ["ใช้จริงก่อน VAT", Math.round(budget.spentBeforeVat)],
    ["ใช้จริงรวม VAT", Math.round(budget.spentWithVat)],
    ["งบคงเหลือก่อน VAT 7%", Number(budget.remainBeforeVat.toFixed(2))],
    ["งบคงเหลือ (รวม VAT)", Math.round(budget.remainWithVat)],
  ] : [];
  const th = (t) => `<th style="background:#3f6f5e;color:#fff">${esc(t)}</th>`;
  const kv = (arr, title) => `<table border="1"><tr>${th(title)}${th("")}</tr>${arr.map(([l, v]) => `<tr><td>${esc(l)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
  const t = dashTotals(rows);
  const totalRow = `<tr style="font-weight:bold;background:#dfe8e3"><td>รวมทั้งหมด</td><td></td><td>${t.taks}</td><td>${t.pageChat}</td><td>${t.opens}</td><td>${t.cpr == null ? "" : t.cpr.toFixed(2)}</td><td>${t.impr}</td><td>${t.spend.toFixed(2)}</td></tr>`;
  const dailyTable = `<table border="1"><tr>${DAILY_HEADERS.map(th).join("")}</tr>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.link)}</td><td>${r.taks}</td><td>${r.pageChat}</td><td>${r.opens || 0}</td><td>${r.cpr == null ? "" : r.cpr.toFixed(2)}</td><td>${r.impr}</td><td>${r.spend.toFixed(2)}</td></tr>`).join("")}${totalRow}</table>`;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><h3>แดชบอร์ดโฆษณา — ${esc(ad.headline || "")}</h3><div>Ad ID: ${esc(ad.ad_id || "-")} · ช่วง ${esc(data?.date_preset || "")}</div><br/>${kv(kpi, "สรุป KPI")}${budgetRows.length ? "<br/>" + kv(budgetRows, "งบยิงโฆษณา") : ""}<br/><h4>สรุปรายวัน</h4>${dailyTable}</body></html>`;
  downloadBlob(new Blob(["﻿" + html], { type: "application/vnd.ms-excel" }), safeFileName(ad, "xls"));
}

// ---- Export "ฟอร์แมตงบยิง Ads" (ตารางติดตามงบ แบบชีต) — ดึงทั้งแคมเปญ: ชุดโฆษณา→โฆษณา ทุกตัว ----
//   เติมจาก Meta: ชื่อแคมเปญ/ชุด/โฆษณา, รูป, ID, ค่าใช้จ่าย (ใช้ไปทั้งหมด), วันเปิด (created), วันปิด (updated ถ้าไม่ ACTIVE = สีแดง)
//   คอลัมน์กรอกมือ (BG ของแคมเปญ/คงเหลือ/ยอดซื้อ/เหตุผลปิด) เว้นว่างเป็นเทมเพลต
const TRACKER_HEADERS = ["Campaign", "ชุดโฆษณา", "โฆษณา", "ภาพ ADS", "ID โฆษณา", "BG ของแคมเปญ (งบรวม VAT)", "ค่าใช้จ่ายปัจจุบัน (ใช้ไปทั้งหมด)", "คงเหลือ", "วันที่เปิด ADS", "วันที่ปิด ADS", "ยอดซื้อรวม", "เหตุผลที่ปิด ADS"];
const gregDate = (iso) => { if (!iso) return ""; const p = String(iso).slice(0, 10).split("-"); return p.length === 3 ? `${Number(p[2])}/${Number(p[1])}/${p[0]}` : String(iso).slice(0, 10); };
const money2 = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function trackerFileName(campaignName, ext) { return `งบยิงแอด-${String(campaignName || "campaign").replace(/[^\w ก-๙-]+/g, "_").slice(0, 40)}.${ext}`; }

// ดึงทั้งทรีของแคมเปญ (ชุดโฆษณา→โฆษณา) ผ่าน list-children · ค่าใช้จ่าย = ตามช่วงเวลาที่เลือกในแดชบอร์ด
async function fetchCampaignTree(ad, data, range) {
  const preset = range ? rangeToBody(range) : { date_preset: "maximum" };
  const campaignName = ad.level === "campaign" ? (ad.headline || ad.name || "") : (ad.campaign_name || ad.headline || ad.name || "");
  const rows = [];
  const mkRow = (adsetName, n) => {
    const st = n.effective_status || "";
    const stopped = !!st && st !== "ACTIVE";
    const spend = n.metrics?.spend != null ? Number(n.metrics.spend) : (n.spend != null ? Number(n.spend) : null);
    return {
      adset: adsetName || "", ad: n.name || "", thumb: n.thumbnail || "", ad_id: n.id || "", status: st,
      spend, start: gregDate(n.created_time), stopDate: stopped ? gregDate(n.updated_time) : "", stopped,
    };
  };
  try {
    if (ad.level === "campaign") {
      const { data: aset } = await supabase.functions.invoke("list-children", { body: { parent_id: ad.ad_id, level: "adsets", ...preset } });
      for (const adset of (aset?.nodes || [])) {
        const { data: adsRes } = await supabase.functions.invoke("list-children", { body: { parent_id: adset.id, level: "ads", ...preset } });
        for (const a of (adsRes?.nodes || [])) rows.push(mkRow(adset.name, a));
      }
    } else if (ad.level === "adset" || ad.level === "adsets") {
      const { data: adsRes } = await supabase.functions.invoke("list-children", { body: { parent_id: ad.ad_id, level: "ads", ...preset } });
      for (const a of (adsRes?.nodes || [])) rows.push(mkRow(ad.adset_name || ad.headline || "", a));
    } else {
      rows.push(mkRow(ad.adset_name || "", { id: ad.ad_id, name: ad.name || ad.headline, metrics: { spend: data?.overall?.spend } }));
    }
  } catch (_e) { /* ใช้ rows เท่าที่ดึงได้ */ }
  return { campaignName, rows };
}

function exportTrackerCsv(campaignName, rows) {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [
    [`สรุปงบยิงโฆษณา — ${campaignName}`].map(esc).join(","),
    ["BG คงเหลือเดือนที่แล้ว", "", "BG เดือนนี้", "", "ยอดรวม", ""].map(esc).join(","),
    TRACKER_HEADERS.map(esc).join(","),
  ];
  let total = 0, campShown = false, lastAdset = null;
  for (const r of rows) {
    if (r.spend != null) total += r.spend;
    const camp = campShown ? "" : campaignName; campShown = true;
    const adset = r.adset === lastAdset ? "" : r.adset; lastAdset = r.adset;
    lines.push([camp, adset, r.ad, r.thumb || "", r.ad_id, "", r.spend != null ? money2(r.spend) : "", "", r.start, r.stopDate, "", ""].map(esc).join(","));
  }
  lines.push(["ผลรวม", "", "", "", "", "", money2(total), "", "", "", "", ""].map(esc).join(","));
  downloadBlob(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), trackerFileName(campaignName, "csv"));
}
function trackerBodyHtml(campaignName, rows, { withImg }) {
  const esc = escHtml;
  let total = 0, campShown = false, lastAdset = null;
  const body = rows.map((r) => {
    if (r.spend != null) total += r.spend;
    const camp = campShown ? "" : esc(campaignName); campShown = true;
    const adset = r.adset === lastAdset ? "" : esc(r.adset); lastAdset = r.adset;
    const img = withImg && r.thumb ? `<img src="${esc(r.thumb)}" width="46" height="46" style="object-fit:cover;border-radius:4px">` : "";
    const stop = r.stopDate ? `<span style="color:#dc2626;font-weight:700">${esc(r.stopDate)}</span>` : "";
    const spend = r.spend != null ? esc(money2(r.spend)) : "";
    return `<tr><td class="l">${camp}</td><td class="l">${adset}</td><td class="l">${esc(r.ad)}</td><td>${img}</td><td>${esc(r.ad_id)}</td><td></td><td>${spend}</td><td></td><td>${esc(r.start)}</td><td>${stop}</td><td></td><td></td></tr>`;
  }).join("");
  const totalRow = `<tr class="total"><td class="l" colspan="6">ผลรวม</td><td>${esc(money2(total))}</td><td></td><td></td><td></td><td></td><td></td></tr>`;
  const head = `<tr>${TRACKER_HEADERS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  return { head, body, totalRow };
}
async function imageDataForWorkbook(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`โหลดรูปไม่สำเร็จ (${res.status})`);
    const blob = await res.blob();
    const mime = String(blob.type || "image/jpeg").toLowerCase();
    if (!mime.startsWith("image/")) throw new Error("ไฟล์ที่ได้ไม่ใช่รูปภาพ");
    const extension = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpeg";
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return base64 ? { base64, extension } : null;
  } catch {
    // CDN ของ Meta บาง URL ไม่อนุญาต CORS ในเบราว์เซอร์ ใช้ proxy ที่ตรวจสิทธิ์และจำกัด host เป็น fallback
    try {
      const { data, error } = await supabase.functions.invoke("export-ad-image", { body: { url } });
      if (error || !data?.ok || !data?.base64) return null;
      const mime = String(data.content_type || "image/jpeg").toLowerCase();
      return { base64: data.base64, extension: mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpeg" };
    } catch { return null; }
  }
}

async function exportTrackerExcel(campaignName, rows) {
  // โหลด ExcelJS เฉพาะตอนกด Export เพื่อไม่เพิ่มภาระให้หน้า Analyze ตอนเปิดใช้งานปกติ
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "AI Ads Automation";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const report = wb.addWorksheet("รายงานงบ Ads", {
    views: [{ state: "frozen", ySplit: 8, showGridLines: false }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  const raw = wb.addWorksheet("ข้อมูลดิบ", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  const navy = "172033", green = "256D5A", paleGold = "FFF2B8", paleGreen = "E6F4EE", white = "FFFFFF", slate = "475569", border = "CBD5E1";
  const thinBorder = { top: { style: "thin", color: { argb: border } }, left: { style: "thin", color: { argb: border } }, bottom: { style: "thin", color: { argb: border } }, right: { style: "thin", color: { argb: border } } };

  report.columns = [18, 24, 30, 13, 20, 20, 18, 18, 15, 15, 15, 28].map((width) => ({ width }));
  report.mergeCells("A1:L2");
  report.getCell("A1").value = `สรุปงบยิงโฆษณา — ${campaignName}`;
  report.getCell("A1").font = { name: "Sarabun", size: 18, bold: true, color: { argb: white } };
  report.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
  report.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  report.getRow(1).height = 28; report.getRow(2).height = 18;
  report.mergeCells("A3:L3");
  report.getCell("A3").value = "กรอกเฉพาะช่องสีเหลือง · ช่องสีเขียวคำนวณอัตโนมัติ · ข้อมูลจาก Meta อยู่ในชีตข้อมูลดิบ";
  report.getCell("A3").font = { name: "Sarabun", size: 10, italic: true, color: { argb: slate } };

  const spendFormula = rows.length ? `=SUM(G9:G${8 + rows.length})` : "=0";
  const cards = [["A4:B4", "A5:B6", "BG คงเหลือเดือนที่แล้ว", 0], ["D4:E4", "D5:E6", "BG เดือนนี้", 0], ["G4:H4", "G5:H6", "ยอดรวม", { formula: "=A5+D5", result: 0 }], ["J4:K4", "J5:K6", "ใช้จริงรวม", { formula: spendFormula, result: rows.reduce((s, r) => s + (Number(r.spend) || 0), 0) }]];
  for (const [labelRange, valueRange, label, value] of cards) {
    report.mergeCells(labelRange); report.mergeCells(valueRange);
    const lc = report.getCell(labelRange.split(":")[0]), vc = report.getCell(valueRange.split(":")[0]);
    lc.value = label; lc.font = { name: "Sarabun", size: 10, bold: true, color: { argb: white } }; lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } }; lc.alignment = { horizontal: "center" };
    vc.value = value; vc.font = { name: "Sarabun", size: 16, bold: true, color: { argb: navy } }; vc.alignment = { horizontal: "center", vertical: "middle" }; vc.numFmt = '#,##0.00" ฿"'; vc.border = thinBorder;
    vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: typeof value === "number" ? paleGold : paleGreen } };
  }
  report.getCell("A5").note = "กรอกงบคงเหลือที่ยกมาจากเดือนก่อน";
  report.getCell("D5").note = "กรอกงบรวม VAT ของเดือนนี้";
  for (const cell of ["A5", "D5"]) report.getCell(cell).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: "กรอกตัวเลขเท่านั้น", error: "กรุณากรอกจำนวนตั้งแต่ 0 ขึ้นไป" };

  const headerRow = 8, firstDataRow = 9, lastDataRow = 8 + rows.length, totalRow = Math.max(firstDataRow, lastDataRow + 1);
  report.getRow(headerRow).values = TRACKER_HEADERS;
  report.getRow(headerRow).height = 42;
  report.getRow(headerRow).eachCell((cell) => { cell.font = { name: "Sarabun", size: 9, bold: true, color: { argb: white } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.border = thinBorder; });
  report.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, lastDataRow), column: 12 } };

  rows.forEach((r, idx) => {
    const rowNo = firstDataRow + idx;
    const row = report.getRow(rowNo);
    row.values = [campaignName, r.adset, r.ad, "", String(r.ad_id || ""), "", r.spend == null ? "" : Number(r.spend), "", r.start, r.stopDate, "", ""];
    row.height = 58;
    row.eachCell({ includeEmpty: true }, (cell, col) => { cell.font = { name: "Sarabun", size: 9, color: { argb: navy } }; cell.alignment = { vertical: "middle", horizontal: [1, 2, 3, 12].includes(col) ? "left" : "center", wrapText: true }; cell.border = thinBorder; });
    for (const col of [6, 11, 12]) row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: paleGold } };
    row.getCell(8).value = { formula: `=IF(F${rowNo}="","",F${rowNo}-G${rowNo})`, result: null };
    row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: paleGreen } };
    for (const col of [6, 7, 8, 11]) row.getCell(col).numFmt = '#,##0.00" ฿"';
    for (const col of [6, 11]) row.getCell(col).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: "กรอกตัวเลขเท่านั้น", error: "กรุณากรอกจำนวนตั้งแต่ 0 ขึ้นไป" };
    if (r.stopDate) row.getCell(10).font = { name: "Sarabun", size: 9, bold: true, color: { argb: "DC2626" } };
  });

  report.mergeCells(`A${totalRow}:F${totalRow}`);
  report.getCell(`A${totalRow}`).value = "ผลรวม";
  report.getCell(`G${totalRow}`).value = { formula: rows.length ? `=SUM(G${firstDataRow}:G${lastDataRow})` : "=0", result: rows.reduce((s, r) => s + (Number(r.spend) || 0), 0) };
  report.getCell(`H${totalRow}`).value = { formula: rows.length ? `=SUM(H${firstDataRow}:H${lastDataRow})` : "=0", result: 0 };
  report.getCell(`K${totalRow}`).value = { formula: rows.length ? `=SUM(K${firstDataRow}:K${lastDataRow})` : "=0", result: 0 };
  report.getRow(totalRow).eachCell({ includeEmpty: true }, (cell) => { cell.font = { name: "Sarabun", size: 10, bold: true, color: { argb: navy } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: paleGreen } }; cell.border = thinBorder; cell.alignment = { vertical: "middle", horizontal: "center" }; });
  for (const col of [7, 8, 11]) report.getRow(totalRow).getCell(col).numFmt = '#,##0.00" ฿"';
  if (rows.length) report.addConditionalFormatting({ ref: `H${firstDataRow}:H${lastDataRow}`, rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], style: { font: { color: { argb: "DC2626" }, bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FEE2E2" }, fgColor: { argb: "FEE2E2" } } } }] });

  raw.columns = [22, 26, 34, 58, 20, 16, 16, 16, 16].map((width) => ({ width }));
  raw.addRow(["Campaign", "ชุดโฆษณา", "โฆษณา", "URL รูป", "ID โฆษณา", "สถานะ", "ค่าใช้จ่าย", "วันที่เปิด", "วันที่ปิด"]);
  rows.forEach((r) => raw.addRow([campaignName, r.adset, r.ad, r.thumb || "", String(r.ad_id || ""), r.status || "", r.spend == null ? "" : Number(r.spend), r.start, r.stopDate]));
  raw.getRow(1).eachCell((cell) => { cell.font = { name: "Sarabun", size: 10, bold: true, color: { argb: white } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } }; cell.alignment = { horizontal: "center", vertical: "middle" }; cell.border = thinBorder; });
  raw.autoFilter = `A1:I${Math.max(1, rows.length + 1)}`;
  raw.getColumn(7).numFmt = '#,##0.00" ฿"';
  raw.eachRow((row, rowNumber) => { if (rowNumber > 1) row.eachCell({ includeEmpty: true }, (cell) => { cell.font = { name: "Sarabun", size: 9 }; cell.border = thinBorder; cell.alignment = { vertical: "middle", wrapText: false }; }); });

  // ฝังรูปทีละภาพแบบจำกัด concurrency เพื่อลดโอกาสเบราว์เซอร์ค้างเมื่อแคมเปญมีโฆษณาจำนวนมาก
  for (let idx = 0; idx < rows.length; idx += 4) {
    const batch = rows.slice(idx, idx + 4);
    const images = await Promise.all(batch.map((r) => imageDataForWorkbook(r.thumb)));
    images.forEach((img, off) => {
      if (!img) return;
      const rowNo = firstDataRow + idx + off;
      const imageId = wb.addImage(img);
      report.addImage(imageId, { tl: { col: 3.12, row: rowNo - 0.9 }, ext: { width: 70, height: 70 }, editAs: "oneCell" });
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), trackerFileName(campaignName, "xlsx"));
}
function exportTrackerPdf(campaignName, rows) {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — กรุณาอนุญาต popup แล้วลองใหม่"); return; }
  const esc = escHtml;
  const { head, body, totalRow } = trackerBodyHtml(campaignName, rows, { withImg: true });
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>งบยิง Ads</title>
<style>
 body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:16px;font-size:10.5px}
 h1{font-size:16px;margin:0 0 8px}
 table{border-collapse:collapse;width:100%;margin:6px 0}
 table.sum td{border:1px solid #cbd5e1;padding:4px 8px;font-size:11px}
 table.trk th{background:#3f6f5e;color:#fff;border:1px solid #2c4f43;padding:6px;text-align:center;font-size:9px;vertical-align:middle}
 table.trk td{border:1px solid #94a3b8;padding:5px;text-align:center;vertical-align:middle}
 table.trk td.l{text-align:left}
 table.trk tr.total td{background:#dfe8e3;font-weight:700;border-top:2px solid #3f6f5e}
 @page{size:A4 landscape;margin:8mm}
</style></head><body>${exportPageNavHtml("analyze")}
 <h1>สรุปงบยิงโฆษณา — ${esc(campaignName)}</h1>
 <table class="sum"><tr><td>BG คงเหลือเดือนที่แล้ว</td><td>&nbsp;</td><td>BG เดือนนี้</td><td>&nbsp;</td><td>ยอดรวม</td><td>&nbsp;</td></tr></table>
 <table class="trk">${head}${body}${totalRow}</table>
 <script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},600);</script>
</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}

// การ์ดสรุป launch_config + ปุ่ม "เซ็ต ads ตาม AI" — บันทึกค่าที่ AI แนะนำไว้ใช้ตอนลอนช์จริง
function LaunchConfigCard({ config, currentApplied, onApplied }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (!config) return null;

  const placements = config.placements || {};
  const isManual = placements.mode === "manual";
  const platforms = (placements.publisher_platforms || []).join(", ");
  const isCurrent = currentApplied && currentApplied.applied_at;

  async function handleApply() {
    setBusy(true);
    setError("");
    setDone(false);
    const { error: upErr } = await supabase.from("settings").upsert({
      key: "launch_config",
      value: { ...config, applied_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setDone(true);
    onApplied?.();
  }

  const CONV_LABEL = { instant_form: "เก็บลีดผ่านฟอร์ม", messaging: "ทักแชท", website: "เว็บ/แลนดิ้ง", calls: "โทร" };
  const FORMAT_LABEL = { image: "รูปภาพ", video: "วิดีโอ", mixed: "ผสมรูป+วิดีโอ" };
  const LANG_LABEL = { th: "ไทย", en: "อังกฤษ", th_en: "ไทย+อังกฤษ", other: "อื่นๆ" };

  const rows = [
    ["ประเภทแคมเปญ", config.objective ? `${config.objective}${config.conversion_location ? " · " + (CONV_LABEL[config.conversion_location] || config.conversion_location) : ""}` : null],
    ["รูปแบบครีเอทีฟ", FORMAT_LABEL[config.creative_format] || config.creative_format || null],
    ["ภาษา", LANG_LABEL[config.language] || config.language || null],
    ["Advantage+ Audience", config.advantage_audience === 1 ? "เปิด" : "ปิด"],
    ["ตำแหน่งจัดวาง", isManual ? `กำหนดเอง${platforms ? " · " + platforms : ""}` : "Advantage+ (อัตโนมัติ)"],
    ["กลยุทธ์บิด", config.bid_strategy || "-"],
    ["Advantage+ Creative", config.advantage_plus_creative ? "เปิด" : "ปิด"],
    ["ปุ่ม CTA เริ่มต้น", config.default_cta || "-"],
    [
      "หมวดโฆษณาพิเศษ",
      Array.isArray(config.special_ad_categories) && config.special_ad_categories.length
        ? config.special_ad_categories.join(", ")
        : "ไม่มี",
    ],
  ].filter(([, v]) => v !== null && v !== undefined);

  return (
    <div className="rounded-xl border border-slate-900/10 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-slate-800 text-sm">ค่าที่จะใช้ตอนลอนช์ (ตาม AI)</div>
        {isCurrent && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">กำลังใช้ค่านี้อยู่</span>
        )}
      </div>
      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-2 gap-2 px-3 py-1.5">
            <span className="text-xs text-slate-500">{label}</span>
            <span className="text-sm text-slate-700">{value}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleApply}
          disabled={busy}
          className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2"
        >
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
          เซ็ต ads ตาม AI
        </button>
        {done && <span className="text-sm text-emerald-700">เซ็ตแล้ว — จะถูกใช้ตอนลอนช์ครั้งต่อไป</span>}
      </div>
      <p className="text-[11px] text-slate-400">
        กดแล้วระบบจะนำค่าเหล่านี้ไปใช้อัตโนมัติทุกครั้งที่ลอนช์แคมเปญ (จนกว่าจะเซ็ตใหม่) — ไม่กระทบ Ad Account / Page / Pixel / Landing URL
      </p>
      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
    </div>
  );
}

const PREF_OPTIONS = {
  campaign_style: {
    label: "สะดวกยิงแคมเปญแบบไหน",
    options: [
      { value: "auto", label: "ให้ AI แนะนำ" },
      { value: "lead_form", label: "เก็บลีดผ่านฟอร์ม (Instant Form)" },
      { value: "chat", label: "ทักแชท (Messenger / IG DM)" },
      { value: "traffic", label: "ส่งเข้าเว็บ / แลนดิ้ง" },
      { value: "conversions", label: "ปิดการขายบนเว็บ (Conversions)" },
    ],
  },
  creative_format: {
    label: "ใช้วิดีโอหรือรูปภาพ",
    options: [
      { value: "auto", label: "ให้ AI แนะนำ" },
      { value: "image", label: "รูปภาพ" },
      { value: "video", label: "วิดีโอ" },
      { value: "mixed", label: "ผสมรูป + วิดีโอ" },
    ],
  },
  language: {
    label: "ต้องการยิงภาษาไหน",
    options: [
      { value: "auto", label: "ให้ AI แนะนำ" },
      { value: "th", label: "ไทย" },
      { value: "en", label: "อังกฤษ" },
      { value: "th_en", label: "ไทย + อังกฤษ" },
      { value: "other", label: "อื่นๆ" },
    ],
  },
};

function AiAssistPanel({ onApplied, initialAnalysis, initialLaunchConfig, onConfigApplied, defaultModel }) {
  const [businessDesc, setBusinessDesc] = useState(initialAnalysis?.business_desc || "");
  const [textModel, setTextModel] = useState(defaultModel || "openai");
  const [prefs, setPrefs] = useState({
    campaign_style: initialAnalysis?.preferences?.campaign_style || "auto",
    creative_format: initialAnalysis?.preferences?.creative_format || "auto",
    language: initialAnalysis?.preferences?.language || "auto",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rationale, setRationale] = useState("");
  const [analysis, setAnalysis] = useState(initialAnalysis || null);

  async function handleAnalyze(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setRationale("");
    const { data, error: fnError } = await supabase.functions.invoke("ai-analyze-settings", {
      body: { business_desc: businessDesc, text_model: textModel, preferences: prefs },
    });
    setLoading(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    if (!data?.ok) {
      setError(data?.error || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ");
      return;
    }
    setRationale(data.rationale || "");
    setAnalysis(data.analysis || null);
    onApplied?.(data.applied);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">ให้ AI วิเคราะห์และตั้งค่าให้อัตโนมัติ</h3>
        <p className="text-xs text-slate-500 mt-1">
          อธิบายธุรกิจ/สินค้า/ข้อเสนอสั้นๆ แล้ว AI จะวิเคราะห์ละเอียด — แนะนำประเภทแคมเปญ 3 อันดับ พร้อมการตั้งค่าครบทั้งระดับแคมเปญ ชุดโฆษณา และโฆษณา (ตำแหน่งจัดวาง, Advantage+, targeting ฯลฯ)
          และบันทึกค่าตัวเลข (งบ/อายุ/CPA/โทนแบรนด์) ทับค่าปัจจุบันทันที (ไม่แตะ Ad Account ID / Page ID / Pixel ID / Audience ID / Landing URL)
        </p>
      </div>
      <form onSubmit={handleAnalyze} className="space-y-3">
        <textarea
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          placeholder="เช่น: โปรแกรม IB Rebate สำหรับนักเทรด forex/gold มือใหม่-กลาง เน้นความน่าเชื่อถือ ไม่การันตีกำไร งบไม่มาก เริ่มทดสอบตลาด"
          value={businessDesc}
          onChange={(e) => setBusinessDesc(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.entries(PREF_OPTIONS).map(([key, group]) => (
            <div key={key}>
              <label className="text-sm text-slate-600">{group.label}</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                value={prefs[key]}
                onChange={(e) => setPrefs({ ...prefs, [key]: e.target.value })}
              >
                {group.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 -mt-1">
          เลือก "ให้ AI แนะนำ" ได้ถ้าไม่แน่ใจ — AI จะเลือกแบบที่เหมาะที่สุดให้พร้อมเหตุผล
        </p>

        <div>
          <label className="text-sm text-slate-600">โมเดล AI ที่ใช้วิเคราะห์</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            value={textModel}
            onChange={(e) => setTextModel(e.target.value)}
          >
            <option value="claude">Claude (ต้องมี API key)</option>
            <option value="openai">OpenAI (GPT-5)</option>
          </select>
        </div>
        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
        {rationale && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{rationale}</div>}
        <button
          type="submit"
          disabled={loading}
          className="bg-slate-900 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
          {loading ? "กำลังวิเคราะห์ละเอียด อาจใช้เวลาสักครู่..." : "ให้ AI วิเคราะห์และบันทึกทันที"}
        </button>
      </form>

      {analysis && (
        <div className="pt-2 border-t border-slate-200 space-y-4">
          {analysis.launch_config && (
            <LaunchConfigCard
              config={analysis.launch_config}
              currentApplied={initialLaunchConfig}
              onApplied={onConfigApplied}
            />
          )}
          <div>
            <div className="flex items-center justify-between mb-3 gap-2">
              <h4 className="font-semibold text-slate-800 text-sm">ผลวิเคราะห์แบบละเอียด (Playbook)</h4>
              <button
                type="button"
                onClick={() => exportAnalysisPdf(analysis)}
                className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shrink-0"
              >
                <FileDown size={14} />
                Export PDF
              </button>
            </div>
            <AnalysisReport analysis={analysis} />
          </div>
        </div>
      )}
    </div>
  );
}

const LOGO_POSITIONS = [
  { value: "top-left", label: "มุมบนซ้าย" },
  { value: "top-center", label: "กึ่งกลางบน" },
  { value: "top-right", label: "มุมบนขวา" },
  { value: "bottom-left", label: "มุมล่างซ้าย" },
  { value: "bottom-center", label: "กึ่งกลางล่าง" },
  { value: "bottom-right", label: "มุมล่างขวา" },
];

function BrandAssetUploader({ label, urlKey, positionKey, scaleKey, assets, setAssets }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const fileExt = file.name.split(".").pop();
    const fileName = `${urlKey}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from("brand-assets").upload(fileName, file, { upsert: true });
    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from("brand-assets").getPublicUrl(fileName);
    setAssets({ ...assets, [urlKey]: publicUrlData.publicUrl });
    setUploading(false);
  }

  return (
    <div className="space-y-2">
      <label className="text-sm text-slate-600">{label}</label>
      <div className="flex items-center gap-3">
        {assets[urlKey] ? (
          <img src={assets[urlKey]} alt={label} className="w-14 h-14 object-contain rounded-lg border border-slate-200 bg-slate-50" />
        ) : (
          <div className="w-14 h-14 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-slate-300">
            <ImageIcon size={20} />
          </div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          disabled={uploading}
          className="text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-slate-200"
        />
        {uploading && <Loader2 className="animate-spin text-slate-400" size={16} />}
      </div>
      {error && <div className="text-xs text-rose-600">{error}</div>}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs text-slate-500">ตำแหน่งที่จะวาง</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
            value={assets[positionKey] ?? "bottom-right"}
            onChange={(e) => setAssets({ ...assets, [positionKey]: e.target.value })}
          >
            {LOGO_POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <label className="text-xs text-slate-500">ขนาด (% ของภาพ)</label>
          <NumInput min={5} max={60}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            value={assets[scaleKey] ?? 15}
            onChange={(n) => setAssets({ ...assets, [scaleKey]: n })}
          />
        </div>
      </div>
    </div>
  );
}

function CiStyleUploader({ assets, setAssets }) {
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [textModel, setTextModel] = useState("openai");

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const fileExt = file.name.split(".").pop();
    const fileName = `ci-reference-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from("brand-assets").upload(fileName, file, { upsert: true });
    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from("brand-assets").getPublicUrl(fileName);
    setAssets({ ...assets, ci_reference_image_url: publicUrlData.publicUrl });
    setUploading(false);
  }

  async function handleAnalyze() {
    if (!assets.ci_reference_image_url) {
      setError("อัปโหลดภาพตัวอย่าง CI ก่อนถึงจะให้ AI ช่วยสกัดสไตล์ได้");
      return;
    }
    setAnalyzing(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("analyze-brand-ci", {
      body: { image_url: assets.ci_reference_image_url, text_model: textModel },
    });
    setAnalyzing(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    if (!data?.ok) {
      setError(data?.error || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ");
      return;
    }
    setAssets({ ...assets, ci_style_description: data.style_description });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm text-slate-600">ภาพตัวอย่าง CI แบรนด์ (ไม่บังคับ)</label>
        <div className="flex flex-wrap items-center gap-3 mt-1">
          {assets.ci_reference_image_url ? (
            <img
              src={assets.ci_reference_image_url}
              alt="CI reference"
              className="w-14 h-14 object-cover rounded-lg border border-slate-200 bg-slate-50"
            />
          ) : (
            <div className="w-14 h-14 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-slate-300">
              <ImageIcon size={20} />
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            disabled={uploading}
            className="text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-slate-200"
          />
          {uploading && <Loader2 className="animate-spin text-slate-400" size={16} />}
          <select
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
            value={textModel}
            onChange={(e) => setTextModel(e.target.value)}
          >
            <option value="claude">Claude (ต้องมี API key)</option>
            <option value="openai">OpenAI (GPT-5)</option>
          </select>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing || !assets.ci_reference_image_url}
            className="flex items-center gap-1.5 text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-slate-800 disabled:opacity-40"
          >
            {analyzing ? <Loader2 className="animate-spin" size={13} /> : <Wand2 size={13} />}
            ให้ AI สกัดสไตล์จากภาพ
          </button>
        </div>
      </div>
      {error && <div className="text-xs text-rose-600">{error}</div>}
      <div>
        <label className="text-sm text-slate-600">คำอธิบายสไตล์ CI (สี/ฟอนต์/โทนภาพ)</label>
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          placeholder="พิมพ์เองได้เลย หรือกด 'ให้ AI สกัดสไตล์จากภาพ' ด้านบนแล้วมาแก้ต่อ เช่น: โทนน้ำเงินเข้ม-ทอง พื้นหลังไล่เฉดมืด ฟอนต์หนาสไตล์ modern fintech"
          value={assets.ci_style_description ?? ""}
          onChange={(e) => setAssets({ ...assets, ci_style_description: e.target.value })}
        />
        <p className="text-xs text-slate-400 mt-1">คำอธิบายนี้จะถูกฝังเข้าไปในทุก prompt ตอนสร้างรูปใหม่ เพื่อให้ภาพออกมาตรงโทน CI ของแบรนด์</p>
      </div>
    </div>
  );
}

// แผงตั้ง/ต่ออายุ Meta access token จากหน้าเว็บ (เก็บแบบปลอดภัย ฝั่งเว็บอ่านค่าเดิมไม่ได้)
function MetaTokenPanel() {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function loadStatus() {
    const { data, error } = await supabase.functions.invoke("set-meta-token", { body: { action: "status" } });
    if (error || !data?.ok) return;
    setStatus(data);
  }
  useEffect(() => {
    loadStatus();
  }, []);

  async function save() {
    if (!token.trim()) return;
    setBusy(true);
    setErr("");
    setMsg("");
    const { data, error } = await supabase.functions.invoke("set-meta-token", { body: { action: "save", token } });
    setBusy(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "บันทึกไม่สำเร็จ"); return; }
    setMsg(`บันทึกแล้ว${data.name ? " · เจ้าของ: " + data.name : ""}`);
    setToken("");
    loadStatus();
  }

  const exp = status?.expires_at ? new Date(status.expires_at * 1000).toLocaleDateString("th-TH") : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
      <div>
        <h3 className="font-semibold text-slate-800">Meta Access Token</h3>
        <p className="text-xs text-slate-500 mt-1">วาง token เพื่อตั้ง/ต่ออายุได้เลยที่นี่ ไม่ต้องเข้า Supabase — เก็บแบบปลอดภัย (ฝั่งเว็บอ่านค่าเดิมไม่ได้ ใช้เฉพาะระบบหลังบ้าน)</p>
      </div>

      {status && (
        <div className="text-xs">
          {status.has_token ? (
            status.valid ? (
              <span className="text-emerald-700">
                ● เชื่อมต่ออยู่{status.name ? " · " + status.name : ""}{exp ? " · หมดอายุ " + exp : ""}{status.source === "env" ? " · (จาก env)" : ""}
              </span>
            ) : (
              <span className="text-rose-600">● token มีปัญหา: {status.error || "ใช้ไม่ได้"}</span>
            )
          ) : (
            <span className="text-amber-600">● ยังไม่ได้ตั้ง token</span>
          )}
          {/* สิทธิ์ที่ token มี — ใช้เช็คว่าขาด page_events (จำเป็นสำหรับส่งสถานะไป Meta) ไหม */}
          {status.valid && status.missing_scopes?.length > 0 && (
            <div className="mt-1 text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
              token นี้ยังขาดสิทธิ์: <span className="font-mono">{status.missing_scopes.join(", ")}</span>
              {status.missing_scopes.includes("page_events") && " — page_events จำเป็นสำหรับ \"ส่งสถานะไป Meta\" (Conversion Leads)"}
            </div>
          )}
          {status.valid && status.scopes?.length > 0 && status.missing_scopes?.length === 0 && (
            <div className="mt-1 text-emerald-700">✓ สิทธิ์ครบทุกตัวที่ระบบต้องใช้</div>
          )}
        </div>
      )}

      <PasswordInput
        placeholder="วาง Meta access token ที่นี่..."
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        autoComplete="off"
      />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy || !token.trim()} className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2">
          {busy ? <Loader2 className="animate-spin" size={16} /> : null}
          บันทึก token
        </button>
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
      </div>
      {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
      <p className="text-[11px] text-slate-400">
        แนะนำใช้ long-lived user token (อายุ ~60 วัน) — พอใกล้หมดค่อยวางตัวใหม่ทับได้เลย ระบบตรวจสอบ token กับ Meta ก่อนบันทึกให้อัตโนมัติ
      </p>
    </div>
  );
}

function LineOAPanel() {
  const [status, setStatus] = useState(null);
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  async function loadStatus() {
    const { data } = await supabase.functions.invoke("set-line-config", { body: { action: "status" } });
    if (data?.ok) setStatus(data);
  }
  useEffect(() => { loadStatus(); }, []);
  async function save() {
    setBusy(true); setErr(""); setMsg("");
    const { data, error } = await supabase.functions.invoke("set-line-config", { body: { action: "save", channel_secret: secret, access_token: token } });
    setBusy(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "บันทึกไม่สำเร็จ"); return; }
    setSecret(""); setToken(""); setStatus(data); setMsg("เชื่อมต่อ LINE OA แล้ว");
  }
  const webhookUrl = status?.webhook_url || "https://zaozcluzvbiwpmubmecu.supabase.co/functions/v1/line-webhook";
  return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
    <div><h3 className="font-semibold text-slate-800">LINE Official Account</h3><p className="text-xs text-slate-500 mt-1">รับแชทแบบเรียลไทม์และตอบกลับจากหน้าตอบแชท โดยเก็บข้อมูลลับไว้เฉพาะระบบหลังบ้าน</p></div>
    {status && <div className={`text-xs ${status.configured && status.valid ? "text-emerald-700" : status.configured ? "text-rose-600" : "text-amber-600"}`}>{status.configured ? status.valid ? `● เชื่อมต่ออยู่${status.bot?.displayName ? " · " + status.bot.displayName : ""}` : `● token มีปัญหา: ${status.error || "ใช้ไม่ได้"}` : "● ยังไม่ได้เชื่อมต่อ"}</div>}
    <PasswordInput value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Channel secret" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" autoComplete="off" />
    <PasswordInput value={token} onChange={(e) => setToken(e.target.value)} placeholder="Channel access token (long-lived)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" autoComplete="off" />
    <button onClick={save} disabled={busy || !secret.trim() || !token.trim()} className="rounded-lg bg-[#06C755] text-white px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-2">{busy && <Loader2 size={15} className="animate-spin" />}บันทึกและตรวจสอบ</button>
    {msg && <div className="text-sm text-emerald-700">{msg}</div>}{err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1"><div className="font-medium text-slate-700">Webhook URL</div><code className="block text-[11px] break-all text-slate-600 select-all">{webhookUrl}</code><p className="text-slate-500">นำ URL นี้ไปใส่ใน LINE Developers → Messaging API → Webhook settings จากนั้นกด Verify และเปิด Use webhook</p></div>
  </div>;
}

// จัดการสิทธิ์ผู้ใช้ (เฉพาะ admin) — เพิ่ม/แก้/ลบ user, เลือก role และบัญชีที่อนุญาต
// เมนูที่มอบสิทธิ์ได้ (รวม "ตั้งค่า" — แต่เลือกหัวข้อย่อยในตั้งค่าได้อีกที)
const GRANTABLE_TABS = [
  { key: "overview", label: "ภาพรวม" }, { key: "generate", label: "สร้างคอนเทนต์" },
  { key: "review", label: "รออนุมัติ" }, { key: "campaigns", label: "แคมเปญ" },
  { key: "analyze", label: "วิเคราะห์" }, { key: "inbox", label: "ตอบแชท" },
  { key: "customerdb", label: "รีพอร์ตลูกค้าทักแชท" },
  { key: "tv_members", label: "จัดการสมาชิก TV" },
  { key: "settings", label: "ตั้งค่า" },
];
function PermissionsPanel() {
  const [rows, setRows] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null); // { email, role, allowed:[], tabs:[], pages:[] }
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    const [permRes, acctRes, pgRes] = await Promise.all([
      supabase.functions.invoke("manage-permissions", { body: { action: "list" } }),
      supabase.functions.invoke("list-ad-accounts", { body: {} }),
      supabase.from("page_lead_config").select("page_id, page_name").order("page_name"),
    ]);
    setLoading(false);
    if (permRes.error) { setError(await readFunctionErrorMessage(permRes.error)); return; }
    if (!permRes.data?.ok) { setError(permRes.data?.error || "โหลดสิทธิ์ไม่สำเร็จ"); return; }
    setRows(permRes.data.rows || []);
    if (acctRes.data?.ok) setAccounts(acctRes.data.accounts || []);
    setPages((pgRes.data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })));
  }
  useEffect(() => { load(); }, []);
  const toggleTab = (k) => setEditing((e) => ({ ...e, tabs: e.tabs.includes(k) ? e.tabs.filter((x) => x !== k) : [...e.tabs, k] }));
  const togglePage = (id) => setEditing((e) => ({ ...e, pages: e.pages.includes(id) ? e.pages.filter((x) => x !== id) : [...e.pages, id] }));
  const toggleSetting = (k) => setEditing((e) => ({ ...e, settings: e.settings.includes(k) ? e.settings.filter((x) => x !== k) : [...e.settings, k] }));
  // หัวข้อย่อยในตั้งค่าที่มอบสิทธิ์ได้ — ตัด "สิทธิ์ผู้ใช้" ออก (กันการมอบสิทธิ์ให้คนอื่นตั้งสิทธิ์เองซึ่งเป็นช่องยกระดับสิทธิ์)
  const grantableSettings = SETTINGS_SECTIONS.filter((s) => s.key !== "permissions" && s.key !== "tv_settings");

  async function save() {
    if (!editing?.email) { setError("กรอกอีเมลก่อน"); return; }
    setSaving(true);
    setError("");
    setNotice("");
    const { data, error: fnErr } = await supabase.functions.invoke("manage-permissions", {
      body: { action: "upsert", email: editing.email.trim(), role: editing.role, nickname: editing.nickname || "", allowed_ad_accounts: editing.role === "analyze_only" ? editing.allowed : [], allowed_tabs: editing.role === "analyze_only" ? editing.tabs : [], allowed_pages: editing.role === "analyze_only" ? editing.pages : [], allowed_settings: editing.role === "analyze_only" && editing.tabs.includes("settings") ? editing.settings : [], chat_alert: editing.chatAlert !== false, alert_minutes: editing.alertMinutes ?? 3, alert_pages: editing.alertPages || [], alert_sound: editing.alertSound !== false, alert_new: editing.alertNew !== false },
    });
    setSaving(false);
    if (fnErr) { setError(await readFunctionErrorMessage(fnErr)); return; }
    if (!data?.ok) { setError(data?.error || "บันทึกไม่สำเร็จ"); return; }
    setNotice("บันทึกแล้ว");
    setEditing(null);
    load();
  }

  async function remove(email) {
    if (!confirm(`ลบสิทธิ์ของ ${email}?`)) return;
    const { data, error: fnErr } = await supabase.functions.invoke("manage-permissions", { body: { action: "delete", email } });
    if (fnErr) { setError(await readFunctionErrorMessage(fnErr)); return; }
    if (!data?.ok) { setError(data?.error || "ลบไม่สำเร็จ"); return; }
    load();
  }

  const toggleAcc = (id) => setEditing((e) => ({ ...e, allowed: e.allowed.includes(id) ? e.allowed.filter((x) => x !== id) : [...e.allowed, id] }));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800">จัดการสิทธิ์ผู้ใช้</h3>
          <p className="text-xs text-slate-500 mt-0.5">กำหนดว่าใครเห็นทุกเมนู (admin) หรือจำกัดสิทธิ์ — เลือกได้ว่าเข้าถึงเมนูไหน / เพจไหน (ตอบแชท) / บัญชีโฆษณาไหน</p>
        </div>
        <button onClick={() => setEditing({ email: "", nickname: "", role: "analyze_only", allowed: [], tabs: [], pages: [], settings: [], chatAlert: true, alertMinutes: 3, alertPages: [], alertSound: true, alertNew: true })} className="text-sm bg-slate-900 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-slate-800 shrink-0">+ เพิ่มผู้ใช้</button>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{notice}</div>}

      {loading ? (
        <Spinner label="กำลังโหลดสิทธิ์..." />
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {(rows || []).length === 0 && <div className="text-sm text-slate-400 py-4 text-center">ยังไม่มีข้อมูลสิทธิ์</div>}
          {(rows || []).map((r) => (
            <div key={r.email} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="text-slate-800 truncate">{r.nickname ? <><span className="font-medium">{r.nickname}</span> <span className="text-slate-400 font-normal">· {r.email}</span></> : r.email}</div>
                <div className="text-[11px] text-slate-400">
                  {r.role === "admin" ? "ผู้ดูแล (เห็นทุกอย่าง)" : `จำกัดสิทธิ์ · ${(r.allowed_tabs || []).length} เมนู${(r.allowed_tabs || []).includes("settings") ? ` (ตั้งค่า ${(r.allowed_settings || []).length || "ทุก"} หัวข้อ)` : ""} · ${(r.allowed_pages || []).length || "ทุก"} เพจ · ${(r.allowed_ad_accounts || []).length} บัญชีโฆษณา`}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${r.role === "admin" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>{r.role === "admin" ? "admin" : "จำกัด"}</span>
                <button onClick={() => setEditing({ email: r.email, nickname: r.nickname || "", role: r.role, allowed: (r.allowed_ad_accounts || []).map(String), tabs: (r.allowed_tabs || []).map(String), pages: (r.allowed_pages || []).map(String), settings: (r.allowed_settings || []).map(String), chatAlert: r.chat_alert !== false, alertMinutes: r.alert_minutes ?? 3, alertPages: (r.alert_pages || []).map(String), alertSound: r.alert_sound !== false, alertNew: r.alert_new !== false })} className="text-slate-500 hover:text-slate-800 text-xs underline">แก้ไข</button>
                <button onClick={() => remove(r.email)} className="text-rose-500 hover:text-rose-700"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="border border-slate-300 rounded-xl p-4 space-y-3 bg-slate-50">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600">อีเมลผู้ใช้</label>
              <input value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="user@example.com" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs text-slate-600">ชื่อเล่น (จำง่าย)</label>
              <input value={editing.nickname} onChange={(e) => setEditing({ ...editing, nickname: e.target.value })} placeholder="เช่น พี่แอ๊ด, น้องมิ้น" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs text-slate-600">สิทธิ์</label>
              <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
                <option value="analyze_only">จำกัดสิทธิ์ (เลือกเมนู/เพจ/บัญชีเอง)</option>
                <option value="admin">ผู้ดูแล (admin — เห็นทุกอย่าง)</option>
              </select>
            </div>
          </div>

          {/* ---- แจ้งเตือนแชทค้างอ่าน (ตั้งรายคน — ผู้ใช้ปรับเองไม่ได้) ---- */}
          <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-3 space-y-2.5">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer font-medium">
              <input type="checkbox" checked={editing.chatAlert !== false} onChange={(e) => setEditing({ ...editing, chatAlert: e.target.checked })} className="w-4 h-4" />
              🔔 เปิดแจ้งเตือน "แชทค้างอ่าน" ให้ผู้ใช้คนนี้
            </label>
            <p className="text-[11px] text-slate-500 -mt-1">ผู้ใช้จะปิดเองหรือเปลี่ยนค่าไม่ได้ · แจ้งเตือนจะเด้งทับแอปอื่นเสมอ (ผู้ใช้กดอนุญาตครั้งแรกครั้งเดียว)</p>

            {editing.chatAlert !== false && (<>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-slate-600">เตือนเมื่อค้างอ่านเกิน</span>
                <select
                  value={editing.alertMinutes ?? 3}
                  onChange={(e) => setEditing({ ...editing, alertMinutes: Number(e.target.value) })}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs bg-white"
                >
                  {[1, 2, 3, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} นาที</option>)}
                </select>
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 ml-2">
                  <input type="checkbox" checked={editing.alertSound !== false} onChange={(e) => setEditing({ ...editing, alertSound: e.target.checked })} className="w-3.5 h-3.5" />
                  🔊 เสียงเตือน
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={editing.alertNew !== false} onChange={(e) => setEditing({ ...editing, alertNew: e.target.checked })} className="w-4 h-4" />
                💬 เด้งเตือน "ทุกข้อความใหม่" ทันที (เหมือน Messenger — ไม่ต้องรอค้าง)
              </label>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-600">
                    เพจที่ให้เตือน ({(editing.alertPages || []).length === 0 ? "ทุกเพจที่เข้าถึงได้" : `${editing.alertPages.length} เพจ`})
                  </span>
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={() => setEditing({ ...editing, alertPages: pages.map((p) => p.id) })} className="text-indigo-600 hover:underline">เลือกทุกเพจ</button>
                    <button onClick={() => setEditing({ ...editing, alertPages: [] })} className="text-slate-500 hover:underline">ล้าง</button>
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 space-y-0.5">
                  {pages.length === 0 && <div className="text-[11px] text-slate-400 px-1 py-1">ยังไม่มีรายชื่อเพจ (กดซิงก์แชทก่อน)</div>}
                  {pages.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={(editing.alertPages || []).includes(p.id)}
                        onChange={(e) => {
                          const cur = editing.alertPages || [];
                          setEditing({ ...editing, alertPages: e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id) });
                        }}
                        className="w-3.5 h-3.5"
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">ไม่ติ๊กเลย = เตือนทุกเพจที่ผู้ใช้คนนี้เข้าถึงได้ · เพจที่ติ๊กแต่ผู้ใช้ไม่มีสิทธิ์เข้าถึง จะถูกข้ามอัตโนมัติ</p>
              </div>
            </>)}
          </div>

          {editing.role === "analyze_only" && (<>
            {/* เมนูที่เข้าถึงได้ */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-600">เมนูที่เข้าถึงได้ ({editing.tabs.length} เมนู)</label>
                <div className="flex gap-2 text-[11px]">
                  <button onClick={() => setEditing({ ...editing, tabs: GRANTABLE_TABS.map((t) => t.key) })} className="text-slate-500 hover:text-slate-800 underline">เลือกทั้งหมด</button>
                  <button onClick={() => setEditing({ ...editing, tabs: [] })} className="text-slate-500 hover:text-slate-800 underline">ล้าง</button>
                </div>
              </div>
              <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {GRANTABLE_TABS.map((t) => (
                  <label key={t.key} className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={editing.tabs.includes(t.key)} onChange={() => toggleTab(t.key)} /> {t.label}
                  </label>
                ))}
              </div>
            </div>
            {/* หัวข้อย่อยในตั้งค่า — โผล่เมื่อมอบสิทธิ์เมนู "ตั้งค่า" */}
            {editing.tabs.includes("settings") && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-600">หัวข้อในตั้งค่าที่เข้าถึงได้ ({editing.settings.length || "ทุก"} หัวข้อ)</label>
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={() => setEditing({ ...editing, settings: grantableSettings.map((s) => s.key) })} className="text-slate-500 hover:text-slate-800 underline">เลือกทั้งหมด</button>
                    <button onClick={() => setEditing({ ...editing, settings: [] })} className="text-slate-500 hover:text-slate-800 underline">ล้าง</button>
                  </div>
                </div>
                <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {grantableSettings.map((s) => (
                    <label key={s.key} className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={editing.settings.includes(s.key)} onChange={() => toggleSetting(s.key)} /> {s.label}
                    </label>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">ไม่เลือกเลย = เข้าถึงได้ทุกหัวข้อที่มอบได้ · "สิทธิ์ผู้ใช้" สงวนให้ admin เท่านั้น</div>
              </div>
            )}
            {/* เพจที่เข้าถึงได้ (ตอบแชท) */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-600">เพจที่เข้าถึงได้ ตอบแชท ({editing.pages.length || "ทุก"} เพจ)</label>
                <div className="flex gap-2 text-[11px]">
                  <button onClick={() => setEditing({ ...editing, pages: pages.map((p) => p.id) })} className="text-slate-500 hover:text-slate-800 underline">เลือกทั้งหมด</button>
                  <button onClick={() => setEditing({ ...editing, pages: [] })} className="text-slate-500 hover:text-slate-800 underline">ล้าง</button>
                </div>
              </div>
              <div className="mt-1 border border-slate-200 rounded-lg max-h-40 overflow-y-auto bg-white divide-y divide-slate-100">
                {pages.length === 0 && <div className="text-xs text-slate-400 py-3 text-center">ยังไม่มีเพจ (ซิงก์ก่อน)</div>}
                {pages.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={editing.pages.includes(p.id)} onChange={() => togglePage(p.id)} />
                    <span className="flex-1 min-w-0 truncate text-slate-700">{p.name}</span>
                  </label>
                ))}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">ไม่เลือกเลย = เข้าถึงได้ทุกเพจ</div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-600">บัญชีโฆษณาที่อนุญาต ({editing.allowed.length} เลือก)</label>
                <div className="flex gap-2 text-[11px]">
                  <button onClick={() => setEditing({ ...editing, allowed: accounts.map((a) => String(a.account_id)) })} className="text-slate-500 hover:text-slate-800 underline">เลือกทั้งหมด</button>
                  <button onClick={() => setEditing({ ...editing, allowed: [] })} className="text-slate-500 hover:text-slate-800 underline">ล้าง</button>
                </div>
              </div>
              <div className="mt-1 border border-slate-200 rounded-lg max-h-56 overflow-y-auto bg-white divide-y divide-slate-100">
                {accounts.length === 0 && <div className="text-xs text-slate-400 py-3 text-center">ไม่พบบัญชีโฆษณา (ลองตั้งค่า Meta token ก่อน)</div>}
                {accounts.map((a) => (
                  <label key={a.account_id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={editing.allowed.includes(String(a.account_id))} onChange={() => toggleAcc(String(a.account_id))} />
                    <span className="flex-1 min-w-0 truncate text-slate-700">{a.name} <span className="text-slate-400">({a.account_id})</span></span>
                    {a.business && <span className="text-[11px] text-slate-400 shrink-0">{a.business}</span>}
                  </label>
                ))}
              </div>
            </div>
          </>)}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="text-sm bg-slate-900 text-white rounded-lg px-4 py-2 font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="animate-spin" size={15} /> : null} บันทึก
            </button>
            <button onClick={() => setEditing(null)} className="text-sm border border-slate-300 text-slate-700 rounded-lg px-4 py-2 font-medium hover:bg-slate-50">ยกเลิก</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ประวัติการเข้าใช้งาน (เฉพาะ admin) — ใครออนไลน์อยู่ + log ล่าสุด
const ACTIVITY_LABEL = {
  login: "เข้าสู่ระบบ", logout: "ออกจากระบบ", pull_report: "ดึงรายงาน",
  open_dashboard: "เปิดแดชบอร์ด", ai_analyze: "ให้ AI วิเคราะห์", view_tab: "เปิดหน้า",
  // แชท
  send_reply: "ส่งข้อความตอบลูกค้า", send_file: "ส่งไฟล์/รูปให้ลูกค้า", push_label: "ส่งป้ายสถานะไป Meta",
  block_customer: "บล็อกลูกค้า (สแปม)", unblock_customer: "ปลดบล็อกลูกค้า",
  save_lead_fields: "บันทึกข้อมูลลูกค้า (ป้อนเอง)", set_stage: "เปลี่ยนป้ายสถานะลูกค้า",
  check_trade_id: "เช็คไอดีเทรด", confirm_account_opened: "ยืนยันเปิดบัญชีใหม่", mark_unread: "ทำเป็นยังไม่อ่าน", mark_read: "ทำเป็นอ่านแล้ว",
  open_chat: "เปิดแชทลูกค้า", save_knowledge: "บันทึกเข้าคลังคำตอบ",
  // โฆษณา
  export: "Export รายงาน", apply_change: "ปรับแอด", push_labels_all: "ติดป้ายสถานะทั้งหมดบน Meta",
  // ระบบ/ตั้งค่า
  sync_chats: "ซิงก์แชท", save_setting: "บันทึกการตั้งค่า", export_customers: "Export ฐานข้อมูลลูกค้า",
};
const TAB_LABEL = { overview: "ภาพรวม", generate: "สร้างคอนเทนต์", review: "รออนุมัติ", campaigns: "แคมเปญ", analyze: "วิเคราะห์", chat: "ตอบแชท", inbox: "ตอบแชท", customerdb: "รีพอร์ตลูกค้าทักแชท", leaderboard: "กระดานแต้ม", settings: "ตั้งค่า" };
const actLabel = (r) => {
  if (r.event === "view_tab" && r.detail?.tab) return `เปิดหน้า “${TAB_LABEL[r.detail.tab] || r.detail.tab}”`;
  const base = ACTIVITY_LABEL[r.event] || r.event;
  const d = r.detail || {};
  const stageLbl = d.stage ? (CHAT_STAGES.find((s) => s.key === d.stage)?.label || d.stage) : "";
  const extra = d.customer_name || d.name || stageLbl || d.label || d.format || d.action || d.section || (d.campaigns ? `${d.campaigns} แคมเปญ` : "") || "";
  return base + (extra ? ` (${extra})` : "");
};
function ActivityPanel() {
  const [rows, setRows] = useState(null);
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [focusEmail, setFocusEmail] = useState(null);   // เจาะดูราย user (null = ทุกคน)
  async function load(email = focusEmail) {
    setLoading(true);
    setError("");
    const { data, error: fnErr } = await supabase.functions.invoke("list-activity", { body: { limit: email ? 500 : 200, email: email || undefined } });
    setLoading(false);
    if (fnErr) { setError(await readFunctionErrorMessage(fnErr)); return; }
    if (!data?.ok) { setError(data?.error || "โหลดประวัติไม่สำเร็จ"); return; }
    setRows(data.rows || []);
    if (!email) setActive(data.active || []);   // active มาจากคำขอ "ทุกคน" เท่านั้น
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [focusEmail]);

  const fmtTime = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); } catch { return t; } };
  // สรุป "ใช้หน้าไหน/ทำอะไรกี่ครั้ง" ของ user ที่เจาะดู
  const summary = useMemo(() => {
    if (!focusEmail || !rows) return null;
    const tabs = {}, events = {}; let first = null, last = null;
    for (const r of rows) {
      if (r.event === "view_tab" && r.detail?.tab) tabs[r.detail.tab] = (tabs[r.detail.tab] || 0) + 1;
      else events[r.event] = (events[r.event] || 0) + 1;
      const t = new Date(r.created_at).getTime();
      if (last === null || t > last) last = t;
      if (first === null || t < first) first = t;
    }
    return {
      tabs: Object.entries(tabs).sort((a, b) => b[1] - a[1]),
      events: Object.entries(events).sort((a, b) => b[1] - a[1]),
      first, last, total: rows.length,
    };
  }, [focusEmail, rows]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
            ประวัติการเข้าใช้งาน
            {focusEmail && <span className="text-xs font-normal bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">เจาะดู: {focusEmail}</span>}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">{focusEmail ? "ประวัติ + สรุปการใช้งานของผู้ใช้คนนี้" : "ใครเข้าใช้ เมื่อไหร่ ทำอะไร จาก IP/ตำแหน่ง และอุปกรณ์ใด · คลิกที่ชื่อผู้ใช้เพื่อดูแยกราย user"}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {focusEmail && <button onClick={() => setFocusEmail(null)} className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 text-slate-600 hover:bg-slate-50">← ดูทุกคน</button>}
          <button onClick={() => load()} className="text-slate-400 hover:text-slate-700" title="รีเฟรช"><RefreshCw size={16} /></button>
        </div>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <Spinner label="กำลังโหลดประวัติ..." />
      ) : (
        <>
          {/* สรุปการใช้งานของ user ที่เจาะดู */}
          {focusEmail && summary && (
            <div className="rounded-xl border border-slate-200 p-3 space-y-3 bg-slate-50/50">
              <div className="text-xs text-slate-500">
                กิจกรรมทั้งหมด <span className="font-semibold text-slate-800">{summary.total}</span> รายการ
                {summary.last && <> · ล่าสุด {fmtTime(summary.last)}</>}
                {summary.first && <> · เก่าสุด {fmtTime(summary.first)}</>}
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">หน้าที่เปิดบ่อย</div>
                {summary.tabs.length === 0 ? <div className="text-[11px] text-slate-400">ไม่มีข้อมูล (เริ่มเก็บหลังอัปเดตนี้)</div> : (
                  <div className="flex flex-wrap gap-1.5">
                    {summary.tabs.map(([t, n]) => (
                      <span key={t} className="text-[11px] bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium">{TAB_LABEL[t] || t} · {n}</span>
                    ))}
                  </div>
                )}
              </div>
              {summary.events.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium text-slate-500 mb-1">การกระทำอื่น</div>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.events.map(([e, n]) => (
                      <span key={e} className="text-[11px] bg-slate-200 text-slate-600 rounded-full px-2 py-0.5">{ACTIVITY_LABEL[e] || e} · {n}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!focusEmail && (
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1.5">
              กำลังใช้งานอยู่ ({active.length} คน · {active.reduce((s, a) => s + (a.device_count || 1), 0)} เครื่อง) · 15 นาทีล่าสุด
            </div>
            {active.length === 0 ? (
              <div className="text-xs text-slate-400">ไม่มีใครใช้งานอยู่ตอนนี้</div>
            ) : (
              <div className="space-y-1.5">
                {active.map((a) => (
                  <div key={a.email} className="flex flex-wrap items-center gap-1.5">
                    <button onClick={() => setFocusEmail(a.email)} className={`text-xs rounded-full px-2.5 py-1 flex items-center gap-1.5 font-medium hover:ring-2 hover:ring-indigo-300 ${(a.device_count || 1) > 1 ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${(a.device_count || 1) > 1 ? "bg-amber-500" : "bg-emerald-500"}`} />
                      {a.email} · {a.device_count || 1} เครื่อง
                    </button>
                    {(a.devices || [{ device: a.device, location: a.location, ip: a.ip }]).map((d, i) => (
                      <span key={i} className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5" title={d.ip || ""}>
                        {d.device || "-"}{d.location ? ` · ${d.location}` : ""}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {(rows || []).length === 0 && <div className="text-sm text-slate-400 py-4 text-center">ยังไม่มีประวัติ</div>}
              {(rows || []).map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="text-slate-800 truncate">
                      {r.email
                        ? <button onClick={() => setFocusEmail(r.email)} className="font-medium hover:text-indigo-600 hover:underline">{r.email}</button>
                        : <span className="font-medium">-</span>}
                      <span className="text-slate-400"> · {actLabel(r)}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">{r.device || "-"}{r.location ? ` · ${r.location}` : ""}{r.ip ? ` · ${r.ip}` : ""}</div>
                  </div>
                  <div className="text-[11px] text-slate-400 shrink-0 text-right">{fmtTime(r.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ฟีเจอร์ AI ที่ให้ผู้ใช้กำหนด prompt เองได้ (key ต้องตรงกับฝั่ง backend getPromptOverride)
const AI_PROMPT_FEATURES = [
  { key: "analyze_ads", label: "วิเคราะห์โฆษณา (Ads)", desc: "สรุป/วิเคราะห์ประสิทธิภาพโฆษณา" },
  { key: "analyze_campaigns", label: "วิเคราะห์แคมเปญ", desc: "ภาพรวมแคมเปญ + คำแนะนำ" },
  { key: "analyze_dashboard", label: "วิเคราะห์แดชบอร์ด", desc: "สรุปตัวเลขหน้าแดชบอร์ด" },
  { key: "analyze_compare", label: "เปรียบเทียบโฆษณา", desc: "เทียบหลายชิ้นแล้วสรุป" },
  { key: "analyze_settings", label: "AI ช่วยตั้งค่า", desc: "แนะนำ targeting/งบ/เกณฑ์จาก brief" },
  { key: "suggest_pairing", label: "แนะนำการจับคู่คอนเทนต์", desc: "จับคู่ copy กับรูป/กลุ่มเป้าหมาย" },
  { key: "score_ad_assets", label: "ให้คะแนนชิ้นงานโฆษณา", desc: "รีวิว/ให้คะแนน draft assets" },
  { key: "resolve_audience_interests", label: "แปลงกลุ่มเป้าหมายเป็นคีย์เวิร์ด", desc: "ไทย → คำค้น interest อังกฤษ" },
  { key: "analyze_brand_ci", label: "วิเคราะห์แบรนด์/CI จากรูป", desc: "อ่านรูปอ้างอิงแล้วสรุปสไตล์" },
];

// หน้าตั้งค่า "คำสั่ง AI (Prompt)" รวม — override system prompt ของแต่ละฟีเจอร์ (เก็บใน settings key = ai_prompts)
function AiPromptsPanel() {
  const [prompts, setPrompts] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "ai_prompts").maybeSingle();
      setPrompts((data?.value && typeof data.value === "object") ? data.value : {});
    })();
  }, []);
  async function save() {
    setSaving(true); setSaved(false); setSaveError("");
    const { error } = await supabase.from("settings").upsert({ key: "ai_prompts", value: prompts, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) { setSaveError(error.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }
  if (!prompts) return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"><Spinner label="กำลังโหลด..." /></div>;
  const setOne = (k, v) => setPrompts({ ...prompts, [k]: v });
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">คำสั่ง AI (Prompt) ของแต่ละฟีเจอร์</h3>
        <p className="text-xs text-slate-500 mt-1">กำหนด system prompt เองได้ต่อฟีเจอร์ · <span className="text-slate-600">เว้นว่าง = ใช้ค่าเริ่มต้นของระบบ</span> · แก้แล้วกด "บันทึกทั้งหมด" ด้านล่าง (มีผลรอบถัดไปที่เรียกใช้ฟีเจอร์นั้น)</p>
        <p className="text-[11px] text-slate-400 mt-1">prompt ของ "เขียนคอนเทนต์โฆษณา" ปรับได้ในหน้าสร้างคอนเทนต์ (โหมด merge/override)</p>
      </div>
      <div className="space-y-3">
        {AI_PROMPT_FEATURES.map((f) => (
          <div key={f.key} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-medium text-slate-800">{f.label}</div>
                <p className="text-[11px] text-slate-500">{f.desc} · <span className="font-mono text-slate-400">{f.key}</span></p>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded ${prompts[f.key]?.trim() ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-500"}`}>{prompts[f.key]?.trim() ? "ใช้ prompt ของคุณ" : "ค่าเริ่มต้น"}</span>
            </div>
            <textarea rows={4} value={prompts[f.key] || ""} onChange={(e) => setOne(f.key, e.target.value)} placeholder="(เว้นว่าง = ใช้ค่าเริ่มต้นของระบบ)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono leading-relaxed" />
            {prompts[f.key] ? <button type="button" onClick={() => setOne(f.key, "")} className="text-[11px] text-rose-600 hover:underline">ล้าง (กลับไปใช้ค่าเริ่มต้น)</button> : null}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60">{saving ? "กำลังบันทึก..." : "บันทึกทั้งหมด"}</button>
        {saved && <span className="text-sm text-emerald-600">บันทึกแล้ว ✓</span>}
        {saveError && <span className="text-sm text-rose-600">{saveError}</span>}
      </div>
    </div>
  );
}

// ตั้งค่าการเชื่อมต่อและซิงก์แชท (ไม่ใช้ AI หรือคีย์เวิร์ดจัดสถานะลูกค้า)
function ChatSyncConfigPanel() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [labelTest, setLabelTest] = useState(null);   // ผลทดสอบดึงป้ายกำกับจาก Meta
  const [labelTesting, setLabelTesting] = useState(false);
  const [dsLoading, setDsLoading] = useState(false);   // กำลังดึง Dataset ของทุกเพจ
  const [dsResult, setDsResult] = useState(null);      // ผลการดึง Dataset รายเพจ
  const [webhookBusy, setWebhookBusy] = useState("");   // "" | "subscribe" | "status"
  const [webhookRes, setWebhookRes] = useState(null);
  async function runWebhook(action) {
    setWebhookBusy(action); setWebhookRes(null);
    const { data, error } = await supabase.functions.invoke("subscribe-webhook", { body: { action } });
    setWebhookBusy("");
    if (error) { setWebhookRes({ ok: false, error: await readFunctionErrorMessage(error) }); return; }
    setWebhookRes(data);
  }
  const [labelPages, setLabelPages] = useState([]);   // รายชื่อเพจสำหรับเลือกทดสอบ
  const [labelPageId, setLabelPageId] = useState("");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("page_lead_config").select("page_id, page_name").order("page_name");
      const ps = (data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id }));
      setLabelPages(ps);
      if (ps.length) setLabelPageId(ps[0].id);
    })();
  }, []);
  async function testLabels() {
    setLabelTesting(true); setLabelTest(null);
    const { data, error } = await supabase.functions.invoke("page-labels", { body: labelPageId ? { page_id: labelPageId } : {} });
    setLabelTesting(false);
    if (error) { setLabelTest({ ok: false, error: await readFunctionErrorMessage(error) }); return; }
    if (data && data.ok === false) { setLabelTest({ ok: false, error: data.error || "ดึงไม่สำเร็จ" }); return; }
    setLabelTest(data);
  }
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "chat_sync_config").maybeSingle();
      setCfg(data?.value || { per_page: 200, messages: 30 });
    })();
  }, []);
  async function save() {
    setSaving(true);
    // ล้างค่า legacy ที่เคยสั่ง AI/regex/คีย์เวิร์ดกรอกหรือจัดสถานะฐานข้อมูลลูกค้า
    const clean = { ...cfg };
    ["ai_enabled", "keywords", "keywords_qualified", "keywords_disqualified", "ai_model", "ai_model_verify", "ai_verify_enabled", "ai_mode", "ai_max_per_run", "ai_prompt", "ai_prompt_verify", "strict_trade_id", "lead_tags"].forEach((key) => delete clean[key]);
    await supabase.from("settings").upsert({ key: "chat_sync_config", value: clean, updated_at: new Date().toISOString() });
    setCfg(clean);
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500);
  }
  // ดึง Dataset ID ของทุกเพจจาก Meta (1 เพจ = 1 dataset) แล้วเก็บลง page_lead_config
  async function fetchDatasets() {
    setDsLoading(true); setDsResult(null);
    const { data, error } = await supabase.functions.invoke("page-datasets", { body: {} });
    setDsLoading(false);
    if (error) { setDsResult({ total: 0, success: 0, failed: 1, results: [], hint: await readFunctionErrorMessage(error) }); return; }
    if (data && data.ok === false) { setDsResult({ total: 0, success: 0, failed: 1, results: [], hint: data.error }); return; }
    setDsResult(data);
  }
  if (!cfg) return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"><Spinner label="กำลังโหลด..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">ตั้งค่าการซิงก์แชท</h3>
        <p className="text-xs text-slate-500 mt-0.5">ตั้งค่าการเชื่อมต่อและปริมาณการซิงก์แชท โดยไม่กรอกข้อมูลหรือเปลี่ยนสถานะลูกค้าอัตโนมัติ</p>
      </div>

      {/* Dataset ของ Conversion Leads — Meta กำหนดว่า 1 เพจ = 1 dataset จึงต้องดึงแยกรายเพจ */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-2">
        <div className="text-sm font-medium text-slate-800">Dataset สำหรับส่งสถานะไป Meta (Conversion Leads)</div>
        <p className="text-[11px] text-slate-500">
          Meta กำหนดให้ 1 เพจผูกกับ 1 ชุดข้อมูลเท่านั้น — กดปุ่มนี้ให้ระบบดึง Dataset ID ของแต่ละเพจมาเก็บอัตโนมัติ
          (ถ้าเพจไหนยังไม่มี Meta จะสร้างให้ · กดซ้ำได้ ไม่สร้างซ้ำ) · ต้องมีสิทธิ์ page_events บน token
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={fetchDatasets} disabled={dsLoading}
            className="rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
            {dsLoading ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} ดึง Dataset ของทุกเพจ
          </button>
          {dsResult && (
            <span className={`text-xs ${dsResult.failed ? "text-amber-700" : "text-emerald-700"}`}>
              สำเร็จ {dsResult.success}/{dsResult.total} เพจ{dsResult.failed ? ` · ไม่สำเร็จ ${dsResult.failed}` : ""}
            </span>
          )}
        </div>
        {dsResult?.hint && <div className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">{dsResult.hint}</div>}
        {dsResult?.results?.length > 0 && (
          <div className="max-h-40 overflow-y-auto space-y-0.5 text-[11px]">
            {dsResult.results.map((r) => (
              <div key={r.page_id} className="flex items-center gap-2">
                <span className={r.ok ? "text-emerald-600" : "text-rose-500"}>{r.ok ? "✓" : "✕"}</span>
                <span className="text-slate-600 truncate flex-1">{r.page}</span>
                <span className="text-slate-400 font-mono">{r.ok ? r.dataset_id : (r.error || "").slice(0, 60)}</span>
              </div>
            ))}
          </div>
        )}
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer">ตั้ง Dataset ID เองแบบเดิม (ใช้เป็นตัวสำรองเมื่อเพจไม่มีของตัวเอง)</summary>
          <input value={cfg.meta_dataset_id || ""} onChange={(e) => setCfg({ ...cfg, meta_dataset_id: e.target.value.trim() })} placeholder="เช่น 123456789012345" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </details>
      </div>

      {/* ผูกเพจกับ webhook (real-time) — ต้องกดครั้งเดียวหลังตั้ง webhook ใน Meta */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium text-slate-800">Webhook (ข้อความเรียลไทม์ + ที่มาจากแอด)</div>
            <p className="text-[11px] text-slate-500 mt-0.5">กด "ผูกเพจ" 1 ครั้งเพื่อให้ Meta ส่งข้อความ/referral มาที่แอปทันที (subscribed_apps) · ต้อง deploy meta-webhook + ตั้งค่าใน Meta ให้ verify ผ่านก่อน</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => runWebhook("status")} disabled={!!webhookBusy} className="border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5">
              {webhookBusy === "status" ? <Loader2 className="animate-spin" size={14} /> : null} เช็คสถานะ
            </button>
            <button onClick={() => runWebhook("subscribe")} disabled={!!webhookBusy} className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-1.5">
              {webhookBusy === "subscribe" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} ผูกเพจกับ webhook
            </button>
          </div>
        </div>
        {webhookRes && (
          <div className="text-xs bg-white rounded-lg border border-slate-200 p-2.5 space-y-1 max-h-52 overflow-y-auto">
            {webhookRes.ok === false ? <div className="text-rose-600">ผิดพลาด: {webhookRes.error}</div>
              : (webhookRes.results || []).map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="text-slate-700 truncate">{r.page}</span>
                  {r.error ? <span className="text-rose-500 shrink-0">{r.error}</span>
                    : r.success ? <span className="text-emerald-600 shrink-0">✓ ผูกแล้ว</span>
                    : r.subscribed ? (
                        // เช็คเจาะจงว่ามี message_reads (สถานะ "อ่านแล้ว") ไหม — ไม่ใช่แค่นับจำนวน
                        (r.fields || []).includes("message_reads")
                          ? <span className="text-emerald-600 shrink-0" title={(r.fields || []).join(", ")}>✓ ครบ (มี message_reads)</span>
                          : <span className="text-amber-600 shrink-0" title={(r.fields || []).join(", ")}>⚠ ขาด message_reads — กด "ผูกเพจ" อีกครั้ง</span>
                      )
                    : <span className="text-amber-600 shrink-0">✗ ยังไม่ผูก</span>}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* โมเดลแปลหน้า "ตอบแชท" */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-1.5">
        <div className="text-sm font-medium text-slate-800">โมเดลแปลหน้า "ตอบแชท"</div>
        <p className="text-[11px] text-slate-500">ใช้แปลข้อความลูกค้า→ไทย และคำตอบ→ภาษาลูกค้า · ตัวใหญ่แปลเป็นธรรมชาติกว่า · เว้นว่าง = ใช้โมเดลตรวจซ้ำ (AI ตัวใหญ่)</p>
        <input list="ai-model-list" value={cfg.ai_model_reply || ""} onChange={(e) => setCfg({ ...cfg, ai_model_reply: e.target.value })} placeholder="gpt-4.1 (แนะนำ) / gpt-5.4 (คุณภาพสูงสุด)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" />
        <datalist id="ai-model-list">
          <option value="gpt-4.1-mini">gpt-4.1-mini — ถูก/เร็ว</option>
          <option value="gpt-4.1">gpt-4.1 — แม่นกว่า</option>
          <option value="gpt-5.4">gpt-5.4 — ฉลาดสุด (แพง)</option>
        </datalist>
      </div>

      {/* ทดสอบดึงป้ายกำกับจาก Meta — เช็คก่อนว่าดึงได้จริงไหม (เช่น "ชำระเงินแล้ว") + นับจำนวนได้ไหม */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-medium text-slate-800">ป้ายกำกับจาก Meta (ทดสอบดึง)</div>
          <div className="flex items-center gap-2">
            {labelPages.length > 0 && (
              <select value={labelPageId} onChange={(e) => setLabelPageId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white max-w-[180px]">
                {labelPages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <button onClick={testLabels} disabled={labelTesting} className="bg-slate-900 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-1.5">
              {labelTesting ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} ทดสอบดึงป้าย
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">เช็คว่า Meta token ของคุณดึง "ป้ายกำกับ" (custom labels) ของเพจได้ไหม เช่น "ชำระเงินแล้ว" และนับจำนวนคนต่อป้ายได้หรือเปล่า — ถ้าได้ ผมจะทำการ์ดสรุปให้ต่อ</p>
        {labelTest && (
          <div className="text-xs bg-white rounded-lg border border-slate-200 p-3 space-y-3 max-h-72 overflow-y-auto">
            {labelTest.ok === false ? (
              <div className="text-rose-600">ดึงไม่สำเร็จ: {labelTest.error}</div>
            ) : (
              <>
                <div>
                  <div className="font-medium text-slate-700 mb-1">ป้ายในเพจ {labelTest.page} ({(labelTest.label_names || []).length} ชื่อ)</div>
                  {(labelTest.label_names || []).length === 0 ? (
                    <div className="text-slate-400">— ไม่พบป้าย</div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {labelTest.label_names.map((l, i) => (
                        <span key={i} className={`px-1.5 py-0.5 rounded ${l.is_ad ? "bg-purple-50 text-purple-600" : "bg-slate-100 text-slate-700"}`} title={l.is_ad ? "ป้ายบอกที่มาจากแอด" : ""}>{l.name}{l.objects > 1 ? ` ×${l.objects}` : ""}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="font-medium text-slate-700 mb-1">ทดสอบดึงป้ายรายลูกค้า (นับได้ไหม): {labelTest.reverse_ok ? <span className="text-emerald-600">✓ ได้</span> : <span className="text-rose-600">✗ ไม่ได้</span>}</div>
                  <ul className="space-y-0.5">
                    {(labelTest.sample || []).map((s, i) => (
                      <li key={i} className="text-slate-600">
                        <span className="text-slate-800">{s.name}</span>: {s.error ? <span className="text-rose-500">{s.error}</span> : (s.labels?.length ? s.labels.join(", ") : <span className="text-slate-400">ไม่มีป้าย</span>)}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-slate-600">จำนวนแชทต่อเพจ (รอบซิงก์ปกติ)</label>
          <NumInput min={20} value={cfg.per_page ?? 200} onChange={(n) => setCfg({ ...cfg, per_page: n })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-sm text-slate-600">จำนวนข้อความที่อ่านต่อแชท</label>
          <NumInput min={5} max={100} value={cfg.messages ?? 30} onChange={(n) => setCfg({ ...cfg, messages: n })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-xs text-emerald-800">
        ระบบจะเก็บเฉพาะข้อมูลที่แอดมินป้อนเองหรือ Import จาก Excel เท่านั้น ไม่มีการอ่านแชทเพื่อกรอกข้อมูลลูกค้าอัตโนมัติ
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-slate-900 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={15} /> : null} บันทึก
        </button>
        {saved && <span className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">บันทึกแล้ว</span>}
      </div>
    </div>
  );
}

// เลือกเพจที่ให้ระบบซิงก์ — เก็บเฉพาะสวิตช์ที่ยังจำเป็น
function PageLeadConfigPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);

  async function load() {
    const { data, error: e } = await supabase.from("page_lead_config").select("*").order("page_name");
    if (e) { setError(e.message); return; }
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  async function toggleSync(row) {
    const next = row.sync_enabled === false;
    setRows((prev) => prev.map((r) => (r.page_id === row.page_id ? { ...r, sync_enabled: next } : r)));
    setSavingId(row.page_id);
    await supabase.from("page_lead_config").update({ sync_enabled: next, updated_at: new Date().toISOString() }).eq("page_id", row.page_id);
    setSavingId(null); setSavedId(row.page_id); setTimeout(() => setSavedId(null), 1500);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">เพจที่ซิงก์แชท</h3>
        <p className="text-xs text-slate-500 mt-0.5">เปิดเฉพาะเพจที่ต้องการให้ระบบดึงแชทเข้ามา ฟังก์ชันกำหนดข้อมูลเพื่อเปลี่ยนสถานะอัตโนมัติถูกนำออกแล้ว</p>
      </div>
      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
      {rows === null ? (
        <Spinner label="กำลังโหลด..." />
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-400 py-4 text-center">ยังไม่มีเพจในระบบ</div>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.page_id} className="flex items-center justify-between gap-3 px-3 py-2.5 flex-wrap">
              <div className="text-sm text-slate-800 min-w-0">
                {r.page_name || r.page_id}
                {savingId === r.page_id && <span className="ml-2 text-[11px] text-slate-400">กำลังบันทึก...</span>}
                {savedId === r.page_id && <span className="ml-2 text-[11px] text-emerald-600">บันทึกแล้ว</span>}
              </div>
              <div className="flex gap-3 flex-wrap items-center">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={r.sync_enabled !== false} onChange={() => toggleSync(r)} /> ซิงก์เพจนี้
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// จัดการงานอัตโนมัติ (cron) ผ่านแอป — เปิด/ปิด + ตั้งความถี่ + ดูรันล่าสุด
const CRON_FREQ = [
  { v: "*/15 * * * *", l: "ทุก 15 นาที" },
  { v: "*/30 * * * *", l: "ทุก 30 นาที" },
  { v: "0 * * * *", l: "ทุก 1 ชั่วโมง" },
  { v: "0 */2 * * *", l: "ทุก 2 ชั่วโมง" },
  { v: "0 */6 * * *", l: "ทุก 6 ชั่วโมง" },
  { v: "0 1 * * *", l: "วันละครั้ง (08:00 น.)" },
];
function ScheduledJobsPanel() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [savingKey, setSavingKey] = useState(null);
  async function load() {
    setErr("");
    const { data, error } = await supabase.functions.invoke("manage-cron", { body: { action: "list" } });
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "โหลดไม่สำเร็จ"); return; }
    setRows((data.rows || []).filter((job) => job.key !== "tv_sync"));
  }
  useEffect(() => { load(); }, []);
  async function save(job, patch) {
    const next = { ...job, ...patch };
    setRows((prev) => prev.map((r) => (r.key === job.key ? next : r)));
    setSavingKey(job.key); setErr("");
    const { data, error } = await supabase.functions.invoke("manage-cron", { body: { action: "save", key: job.key, cron_expr: next.cron_expr, enabled: next.enabled } });
    setSavingKey(null);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "บันทึกไม่สำเร็จ"); return; }
    load();
  }
  const fmtT = (t) => { try { return t ? new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-"; } catch { return "-"; } };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">งานอัตโนมัติ (ตั้งเวลา)</h3>
        <p className="text-xs text-slate-500 mt-0.5">เปิด/ปิด และตั้งความถี่ให้ระบบทำงานเองเป็นรอบ · เวลาแสดงตามโซนไทย</p>
      </div>
      {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
      {rows === null ? <Spinner label="กำลังโหลด..." /> : rows.length === 0 ? (
        <div className="text-sm text-slate-400 py-3 text-center">ยังไม่มีงาน — รัน migration scheduled-jobs ก่อน</div>
      ) : (
        <div className="space-y-3">
          {rows.map((job) => {
            const known = CRON_FREQ.some((f) => f.v === job.cron_expr);
            return (
              <div key={job.key} className="border border-slate-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 text-sm">{job.label}
                      {job.active === false && <span className="ml-2 text-[10px] text-slate-400">(ปิดอยู่)</span>}
                      {savingKey === job.key && <span className="ml-2 text-[11px] text-slate-400">กำลังบันทึก...</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 max-w-xl">{job.description}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">รันล่าสุด: {fmtT(job.last_run)}{job.last_status ? ` · ${job.last_status}` : ""}</div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer shrink-0">
                    <input type="checkbox" checked={job.enabled !== false} onChange={(e) => save(job, { enabled: e.target.checked })} /> เปิดใช้งาน
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-slate-500">ความถี่:</span>
                  <select value={job.cron_expr} onChange={(e) => save(job, { cron_expr: e.target.value })} disabled={job.enabled === false} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white disabled:opacity-50">
                    {!known && <option value={job.cron_expr}>กำหนดเอง ({job.cron_expr})</option>}
                    {CRON_FREQ.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ปฏิทินเลือกวันหยุด — เห็นวันที่ตั้งไว้ (ไฮไลต์ม่วง) คลิกวันเพื่อเพิ่ม/ลบ ได้ทันที
function HolidayCalendar({ holidays = [], onToggle }) {
  const set = new Set(holidays);
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  const pad = (n) => String(n).padStart(2, "0");
  const startWd = new Date(ym.y, ym.m, 1).getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const dstr = (d) => `${ym.y}-${pad(ym.m + 1)}-${pad(d)}`;
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const cells = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const prev = () => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  const next = () => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));
  const monthCount = holidays.filter((h) => String(h).startsWith(`${ym.y}-${pad(ym.m + 1)}`)).length;
  return (
    <div className="rounded-xl border border-slate-200 p-3 w-full max-w-[300px] bg-white">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={prev} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={16} /></button>
        <div className="text-sm font-semibold text-slate-700">{TH_MONTHS[ym.m]} {ym.y + 543}</div>
        <button type="button" onClick={next} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WD.map((w, i) => <div key={`w${i}`} className="text-[10px] text-slate-400 font-medium py-0.5">{w}</div>)}
        {cells.map((d, i) => d === null ? <div key={`e${i}`} /> : (() => {
          const ds = dstr(d);
          const on = set.has(ds);
          const isToday = ds === todayStr;
          return (
            <button
              type="button"
              key={ds}
              onClick={() => onToggle(ds)}
              title={on ? "คลิกเพื่อลบวันหยุดนี้" : "คลิกเพื่อตั้งเป็นวันหยุด"}
              className={`aspect-square rounded-lg text-xs flex items-center justify-center transition ${on ? "text-white font-semibold shadow-sm" : isToday ? "text-indigo-600 font-semibold ring-1 ring-slate-300" : "text-slate-600 hover:bg-slate-100"}`}
              style={on ? { backgroundImage: "linear-gradient(135deg,#9D6BFF,#7C4DFF)" } : undefined}
            >
              {d}
            </button>
          );
        })())}
      </div>
      <div className="text-[10px] text-slate-400 mt-2 text-center">
        {monthCount > 0 ? `เดือนนี้ตั้งไว้ ${monthCount} วัน · ` : ""}คลิกวันที่เพื่อเพิ่ม/ลบ (บันทึกทันที)
      </div>
    </div>
  );
}

// สถิติการตอบแชท (admin) — ความเร็วเฉลี่ย/ตอบช้าเกินเกณฑ์ ต่อ user × เพจ + ช่วงเวลาที่ช้าบ่อย
function ReplyStatsPanel({ onOpenChat }) {
  const fmtD = bangkokDate;
  const [cfg, setCfg] = useState(null);          // office_hours
  const [since, setSince] = useState(() => fmtD(new Date(Date.now() - 30 * 86400000)));
  const [until, setUntil] = useState(() => fmtD(new Date()));
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState("");
  const [showEvidence, setShowEvidence] = useState(false);
  const [evFilter, setEvFilter] = useState("slow");   // slow | all | unanswered
  const [pageOpts, setPageOpts] = useState([]);       // รายชื่อเพจทั้งหมด
  const [selPages, setSelPages] = useState([]);       // เพจที่ติ๊กไว้ ([] = ทุกเพจ)
  const [pageMenu, setPageMenu] = useState(false);
  const [newHoliday, setNewHoliday] = useState("");   // วันหยุดพิเศษที่กำลังจะเพิ่ม
  const [holidayMsg, setHolidayMsg] = useState("");   // สถานะบันทึกวันหยุด (ทันที)
  const [excludeInput, setExcludeInput] = useState("");
  const [excludeMsg, setExcludeMsg] = useState("");
  const [customerNameOptions, setCustomerNameOptions] = useState([]);
  const [evSort, setEvSort] = useState("msg_at");   // คอลัมน์ที่เรียงในลิสต์หลักฐาน
  const [evDir, setEvDir] = useState("desc");
  const [evLimit, setEvLimit] = useState(300);     // แสดงกี่แถว (กดดูเพิ่มได้)
  const [hourView, setHourView] = useState("chart");  // กราฟ | ตาราง ของช่วงเวลาที่ตอบช้า
  const [hourSort, setHourSort] = useState("slow");
  const [hourDir, setHourDir] = useState("desc");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("page_lead_config").select("page_id, page_name").order("page_name");
      setPageOpts((data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })));
      const { data: customers } = await supabase.from("chat_customers").select("customer_name").not("customer_name", "is", null).order("updated_at", { ascending: false }).limit(5000);
      const names = [...new Set((customers || []).map((row) => String(row.customer_name || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "th", { sensitivity: "base" }));
      setCustomerNameOptions(names);
    })();
  }, []);
  const pagesArg = selPages.length ? { pages: selPages } : {};   // ไม่ติ๊ก = ทุกเพจ
  const [viewMode, setViewMode] = useState("summary");   // summary = รวมทั้งช่วง | daily = แยกรายวัน
  const [sortKey, setSortKey] = useState("avg");         // avg | alerts | slow | unanswered | name
  const [sortDir, setSortDir] = useState("asc");         // avg + asc = ตอบไวสุดขึ้นก่อน

  // ---- วันที่แบบ "เวลาไทย" (ให้ตรงกับที่ backend ใช้ +07:00) ----
  const thDay = (offsetDays = 0) => {
    const d = new Date(Date.now() + 7 * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };
  const thMonth = (monthOffset, which) => {
    const d = new Date(Date.now() + 7 * 3600 * 1000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + monthOffset + (which === "end" ? 1 : 0));
    if (which === "end") d.setUTCDate(0);   // วันสุดท้ายของเดือนนั้น
    return d.toISOString().slice(0, 10);
  };
  // ช่วงเวลาสำเร็จรูป — กดแล้วโหลดทันที
  const PRESETS = [
    ["วันนี้", () => [thDay(0), thDay(0)]],
    ["เมื่อวาน", () => [thDay(-1), thDay(-1)]],
    ["3 วันล่าสุด", () => [thDay(-2), thDay(0)]],
    ["7 วันล่าสุด", () => [thDay(-6), thDay(0)]],
    ["14 วันล่าสุด", () => [thDay(-13), thDay(0)]],
    ["30 วันล่าสุด", () => [thDay(-29), thDay(0)]],
    ["เดือนนี้", () => [thMonth(0, "start"), thDay(0)]],
    ["เดือนที่แล้ว", () => [thMonth(-1, "start"), thMonth(-1, "end")]],
    ["3 เดือนล่าสุด", () => [thMonth(-2, "start"), thDay(0)]],
    ["6 เดือนล่าสุด", () => [thMonth(-5, "start"), thDay(0)]],
    ["ปีนี้", () => { const d = new Date(Date.now() + 7 * 3600 * 1000); return [`${d.getUTCFullYear()}-01-01`, thDay(0)]; }],
  ];
  const fmtDMY = (iso) => { const [y, m, d] = String(iso).split("-"); return `${Number(d)}/${Number(m)}/${y}`; };
  // เวลาไทยแบบ วว/ดด ชช:นน — ใช้ในตารางหลักฐานเพื่อให้ตรวจสอบตัวเลขได้
  const fmtClock = (iso) => { try { return new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return "-"; } };
  const rangeLabel = since === until ? fmtDMY(since) : `${fmtDMY(since)} - ${fmtDMY(until)}`;

  // รวมทุกวันเป็น "สรุปรายเพจ" ของทั้งช่วง (ใช้ sum/answered ที่ backend ส่งมา จึงได้ค่าเฉลี่ยถ่วงน้ำหนักที่ถูกต้อง)
  const perPage = useMemo(() => {
    const m = {};
    for (const d of res?.daily || []) {
      const k = d.page_id || "?";
      const a = (m[k] = m[k] || { page_id: d.page_id, page_name: d.page_name, alerts: 0, answered: 0, slow: 0, unanswered: 0, closed: 0, sum: 0, days: 0, read_slow: 0, unread: 0, read_sum: 0, read_count: 0 });
      a.alerts += d.alerts || 0; a.answered += d.answered || 0; a.slow += d.slow || 0;
      a.unanswered += d.unanswered || 0; a.closed += d.closed || 0; a.sum += d.sum || 0; a.days++;
      a.read_slow += d.read_slow || 0; a.unread += d.unread || 0;
      a.read_sum += d.read_sum || 0; a.read_count += d.read_count || 0;
    }
    return Object.values(m).map((a) => ({
      ...a,
      avg_min: a.answered ? a.sum / a.answered : null,
      avg_read_min: a.read_count ? a.read_sum / a.read_count : null,
    }));
  }, [res]);

  const sortRows = (rows) => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      if (sortKey === "name") return dir * String(x.page_name || "").localeCompare(String(y.page_name || ""));
      if (sortKey === "avg") {
        // เพจที่ยังไม่มีใครตอบเลย (avg = null) ให้ไปท้ายเสมอ ไม่ว่าจะเรียงทางไหน
        if (x.avg_min == null && y.avg_min == null) return 0;
        if (x.avg_min == null) return 1;
        if (y.avg_min == null) return -1;
        return dir * (x.avg_min - y.avg_min);
      }
      return dir * ((x[sortKey] || 0) - (y[sortKey] || 0));
    });
  };
  // ---- Export ----
  const totals = () => perPage.reduce((a, p) => ({
    alerts: a.alerts + p.alerts, answered: a.answered + p.answered,
    slow: a.slow + p.slow, unanswered: a.unanswered + p.unanswered, closed: a.closed + (p.closed || 0), sum: a.sum + p.sum,
    read_slow: a.read_slow + (p.read_slow || 0), unread: a.unread + (p.unread || 0),
    read_sum: a.read_sum + (p.read_sum || 0), read_count: a.read_count + (p.read_count || 0),
  }), { alerts: 0, answered: 0, slow: 0, unanswered: 0, closed: 0, sum: 0, read_slow: 0, unread: 0, read_sum: 0, read_count: 0 });

  function exportSummaryCsv() {
    const rows = viewMode === "summary" ? sortRows(perPage) : res.daily;
    const head = viewMode === "summary"
      ? ["ช่วงเวลา", "เพจ", "ลูกค้าทัก(ครั้ง)", "ตอบแล้ว", "เฉลี่ย(นาที)", `ช้าเกิน${res.slow_min}นาที`, "ยังไม่ตอบ"]
      : ["วันที่", "เพจ", "ลูกค้าทัก(ครั้ง)", "ตอบแล้ว", "เฉลี่ย(นาที)", `ช้าเกิน${res.slow_min}นาที`, "ยังไม่ตอบ"];
    const body = rows.map((d) => [viewMode === "summary" ? rangeLabel : d.day, d.page_name, d.alerts, d.answered, d.answered ? d.avg_min.toFixed(1) : "", d.slow, d.unanswered]);
    if (viewMode === "summary") { const t = totals(); body.push(["รวมทุกเพจ", `${perPage.length} เพจ`, t.alerts, t.answered, t.answered ? (t.sum / t.answered).toFixed(1) : "", t.slow, t.unanswered]); }
    const csv = "﻿" + [head, ...body].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = `สถิติการตอบแชท_${since}_${until}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // PDF ผ่านหน้าพิมพ์ของเบราว์เซอร์ (เลือก "บันทึกเป็น PDF") — แนวเดียวกับ export ที่มีอยู่ในแอป
  function exportPdf() {
    const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const rows = viewMode === "summary" ? sortRows(perPage) : res.daily;
    const t = totals();
    const pageScope = selPages.length === 0 ? "ทุกเพจ" : selPages.map((id) => pageOpts.find((p) => p.id === id)?.name || id).join(", ");
    const off = res.office || {};
    const dayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
    const body = rows.map((d) => `<tr>
      <td>${esc(viewMode === "summary" ? rangeLabel : d.day)}</td>
      <td>${esc(d.page_name)}</td>
      <td class="n b">${d.alerts}</td>
      <td class="n">${d.answered}</td>
      <td class="n b">${d.answered ? esc(fmtMin(d.avg_min)) : "-"}</td>
      <td class="n ${d.slow > 0 ? "bad" : "good"}">${d.slow}</td>
      <td class="n ${d.unanswered > 0 ? "warn" : ""}">${d.unanswered}</td></tr>`).join("");
    const totalRow = viewMode === "summary" ? `<tr class="total">
      <td>รวมทุกเพจ</td><td>${perPage.length} เพจ</td>
      <td class="n">${t.alerts}</td><td class="n">${t.answered}</td>
      <td class="n">${t.answered ? esc(fmtMin(t.sum / t.answered)) : "-"}</td>
      <td class="n bad">${t.slow}</td><td class="n warn">${t.unanswered}</td></tr>` : "";
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>สถิติการตอบแชท ${esc(rangeLabel)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box} body{font-family:'Sarabun',sans-serif;margin:28px;color:#0f172a;font-size:12px}
  h1{font-size:19px;margin:0 0 4px} .sub{color:#64748b;font-size:11px;margin-bottom:2px}
  .cards{display:flex;gap:8px;margin:14px 0}
  .card{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px}
  .card .k{color:#64748b;font-size:10px} .card .v{font-size:17px;font-weight:700;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left}
  th{background:#f8fafc;font-size:11px;color:#475569}
  td.n,th.n{text-align:center} .b{font-weight:700}
  .bad{color:#e11d48;font-weight:700} .good{color:#059669} .warn{color:#d97706;font-weight:700}
  tr.total td{background:#f1f5f9;font-weight:700;border-top:2px solid #cbd5e1}
  .foot{margin-top:14px;color:#94a3b8;font-size:10px;border-top:1px solid #e2e8f0;padding-top:8px}
  @media print{body{margin:12mm} .noprint{display:none}}
</style></head><body>${exportPageNavHtml("settings")}
<h1>สถิติการตอบแชท</h1>
<div class="sub">ช่วงเวลา: <b>${esc(rangeLabel)}</b> · เพจ: ${esc(pageScope)}</div>
<div class="sub">เวลาทำการที่ใช้คำนวณ: ${esc((off.days || []).map((d) => dayNames[d]).join(" "))} ${esc(off.open || "")}-${esc(off.close || "")} (พัก ${esc(off.break_start || "-")}-${esc(off.break_end || "-")}) · เกณฑ์ช้า ${res.slow_min} นาที</div>
<div class="cards">
  <div class="card"><div class="k">ลูกค้าทักทั้งหมด</div><div class="v">${t.alerts}</div></div>
  <div class="card"><div class="k">ตอบแล้ว</div><div class="v">${t.answered}</div></div>
  <div class="card"><div class="k">เฉลี่ย</div><div class="v">${t.answered ? esc(fmtMin(t.sum / t.answered)) : "-"}</div></div>
  <div class="card"><div class="k">ช้าเกินเกณฑ์</div><div class="v" style="color:#e11d48">${t.slow}</div></div>
  <div class="card"><div class="k">ยังไม่ตอบ</div><div class="v" style="color:#d97706">${t.unanswered}</div></div>
</div>
<table><thead><tr>
  <th>${viewMode === "summary" ? "ช่วงเวลา" : "วันที่"}</th><th>เพจ</th>
  <th class="n">ลูกค้าทัก</th><th class="n">ตอบแล้ว</th><th class="n">เฉลี่ย</th>
  <th class="n">ช้าเกิน ${res.slow_min} น.</th><th class="n">ยังไม่ตอบ</th>
</tr></thead><tbody>${body}${totalRow}</tbody></table>
<div class="foot">ไม่นับรอบที่ลูกค้าทักนอกเวลาทำการ (${res.skipped} รอบ) · เวลาที่ใช้ตอบนับเฉพาะนาทีในเวลาทำการ · ออกรายงาน ${new Date().toLocaleString("th-TH")}</div>
<script>window.onload=()=>{setTimeout(()=>window.print(),400)}<\/script>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — อนุญาต popup สำหรับหน้านี้แล้วลองใหม่"); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ลิสต์หลักฐานหลังกรอง + เรียงตามคอลัมน์ที่คลิก
  const evRows = useMemo(() => {
    const list = (res?.evidence || []).filter((e) => evFilter === "all" || (evFilter === "unanswered" ? !e.answered : e.slow));
    const dir = evDir === "asc" ? 1 : -1;
    const num = (v) => (v == null ? null : Number(v));
    return [...list].sort((x, y) => {
      if (evSort === "minutes" || evSort === "read_minutes") {
        const a = num(x[evSort]), b = num(y[evSort]);
        // ค่าว่าง (ยังไม่ตอบ/ยังไม่อ่าน) ให้ไปท้ายเสมอ ไม่ว่าจะเรียงทางไหน
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return dir * (a - b);
      }
      if (evSort === "msg_at" || evSort === "replied_at" || evSort === "day") {
        const a = x[evSort] ? new Date(x[evSort]).getTime() : null;
        const b = y[evSort] ? new Date(y[evSort]).getTime() : null;
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return dir * (a - b);
      }
      return dir * String(x[evSort] ?? "").localeCompare(String(y[evSort] ?? ""), "th");
    });
  }, [res, evFilter, evSort, evDir]);

  const SortTh = ({ k, children, center }) => (
    <th className={`px-3 py-2 font-medium ${center ? "text-center" : ""}`}>
      <button
        onClick={() => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir(k === "avg" || k === "name" ? "asc" : "desc"); } }}
        className={`inline-flex items-center gap-0.5 hover:text-slate-800 ${sortKey === k ? "text-slate-800 font-semibold" : ""}`}
      >
        {children}
        {sortKey === k && <span className="text-[9px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      setCfg({ holidays: [], ...(data?.value || { days: [1, 2, 3, 4, 5], open: "09:00", close: "17:00", break_start: "12:00", break_end: "13:00", slow_min: 5 }) });
    })();
  }, []);
  async function saveCfg() {
    setSaving(true);
    await supabase.from("settings").upsert({ key: "office_hours", value: cfg, updated_at: new Date().toISOString() });
    setSaving(false);
    load();
  }
  // เพิ่ม/ลบวันหยุด แล้วเซฟลง DB ทันที (ถาวร) — แยกจากปุ่ม "บันทึก" ใหญ่ และไม่ดึงสถิติใหม่
  // ผสานกับค่าในฐานข้อมูลปัจจุบัน เพื่อไม่ทับฟิลด์เวลาทำการอื่นที่อาจแก้ค้างไว้
  async function persistHolidays(nextHolidays) {
    setCfg((c) => ({ ...c, holidays: nextHolidays }));
    setHolidayMsg("กำลังบันทึก...");
    try {
      const { data } = await supabase.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const base = data?.value || {};
      const { error } = await supabase.from("settings").upsert({ key: "office_hours", value: { ...base, holidays: nextHolidays }, updated_at: new Date().toISOString() });
      if (error) { setHolidayMsg("บันทึกไม่สำเร็จ: " + error.message); return; }
      setHolidayMsg(`✓ บันทึกลงฐานข้อมูลแล้ว (${nextHolidays.length} วัน)`);
    } catch (e) {
      setHolidayMsg("บันทึกไม่สำเร็จ: " + (e?.message || e));
    }
    setTimeout(() => setHolidayMsg(""), 4000);
  }
  async function persistExcludedNames(nextNames) {
    setCfg((current) => ({ ...current, exclude: nextNames }));
    setExcludeMsg("กำลังบันทึก...");
    try {
      const { data } = await supabase.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const base = data?.value || {};
      const { error } = await supabase.from("settings").upsert({ key: "office_hours", value: { ...base, exclude: nextNames }, updated_at: new Date().toISOString() });
      if (error) { setExcludeMsg("บันทึกไม่สำเร็จ: " + error.message); return false; }
      setExcludeMsg(`✓ บันทึกแล้ว (${nextNames.length} รายชื่อ)`);
      setTimeout(() => setExcludeMsg(""), 4000);
      load();
      return true;
    } catch (e) {
      setExcludeMsg("บันทึกไม่สำเร็จ: " + (e?.message || e));
      return false;
    }
  }
  async function addExcludedName() {
    const typed = excludeInput.trim().replace(/\s+/g, " ");
    if (!typed) return;
    const matchedName = customerNameOptions.find((name) => name.toLocaleLowerCase("th") === typed.toLocaleLowerCase("th"));
    if (!matchedName) {
      setExcludeMsg("ไม่พบชื่อนี้ในรายชื่อลูกค้า กรุณาเลือกชื่อจากรายการแนะนำเพื่อป้องกันการสะกดผิด");
      return;
    }
    const current = cfg.exclude || [];
    if (current.some((name) => String(name).toLocaleLowerCase("th") === matchedName.toLocaleLowerCase("th"))) {
      setExcludeMsg("รายชื่อนี้ถูกเพิ่มไว้แล้ว");
      return;
    }
    const saved = await persistExcludedNames([...current, matchedName]);
    if (saved) setExcludeInput("");
  }
  // สลับโหมดการนับ (24 ชม. ทุกวัน ↔ กรองวันหยุด/เวลาทำการ) — บันทึกทันทีแบบผสานกับค่าเดิม แล้วดึงสถิติใหม่
  async function persistMode(m) {
    setCfg((c) => ({ ...c, mode: m }));
    try {
      const { data } = await supabase.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const base = data?.value || {};
      await supabase.from("settings").upsert({ key: "office_hours", value: { ...base, mode: m }, updated_at: new Date().toISOString() });
      load();
    } catch { /* เงียบไว้ — สถิติจะรีเฟรชรอบถัดไป */ }
  }
  async function load(sinceArg, untilArg) {
    const s = sinceArg || since, u = untilArg || until;   // รับค่ามาตรงๆ ได้ (กดปุ่มช่วงเวลาแล้วโหลดทันที ไม่ต้องรอ state)
    setBusy(true); setErr("");
    const { data, error } = await supabase.functions.invoke("reply-stats", { body: { since: s, until: u, ...pagesArg } });
    setBusy(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "โหลดไม่สำเร็จ"); return; }
    setRes(data);
  }
  // ดึงสถิติจากบทสนทนาจริง — ครอบคลุมทั้งที่ตอบผ่านแอปและที่พนักงานตอบจากกล่องข้อความเพจโดยตรง
  async function rebuild() {
    setRebuilding(true); setErr(""); setRebuildMsg("กำลังอ่านบทสนทนาย้อนหลัง...");
    const days = Math.max(1, Math.ceil((new Date(until) - new Date(since)) / 86400000) + 1);
    const { data, error } = await supabase.functions.invoke("rebuild-reply-stats", { body: { since_days: Math.min(365, days), ...pagesArg } });
    setRebuilding(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); setRebuildMsg(""); return; }
    if (!data?.ok) {
      // กัน error ที่เป็นออบเจ็กต์ (หรือสตริง "[object Object]") ไม่ให้แสดงจนอ่านไม่รู้เรื่อง
      const raw = data?.error;
      const msg = typeof raw === "string" && raw !== "[object Object]" ? raw
        : raw && typeof raw === "object" ? (raw.message || raw.details || raw.hint || JSON.stringify(raw))
        : "ดึงไม่สำเร็จ (ไม่ได้รับรายละเอียด) — เช็คว่า deploy rebuild-reply-stats เวอร์ชันใหม่แล้วหรือยัง";
      setErr(msg); setRebuildMsg(""); return;
    }
    setRebuildMsg(`สแกน ${data.scanned} แชท เก็บ ${data.rounds} รอบเข้าฐานข้อมูล${data.done ? "" : " (ยังไม่ครบ กดซ้ำเพื่อทำต่อ)"} — ตารางด้านบนจะแสดงเฉพาะช่วงวันที่ที่เลือก`);
    load();
  }
  useEffect(() => { if (cfg) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cfg === null]);
  const DAYS = [["1", "จ"], ["2", "อ"], ["3", "พ"], ["4", "พฤ"], ["5", "ศ"], ["6", "ส"], ["0", "อา"]];
  const fmtMin = (m) => (m < 1 ? `${Math.round(m * 60)} วิ` : m < 60 ? `${m.toFixed(1)} นาที` : `${(m / 60).toFixed(1)} ชม.`);
  const maxSlow = res ? Math.max(1, ...res.slow_hours) : 1;
  const maxAll = res ? Math.max(1, ...res.all_hours) : 1;   // สเกลแท่งตาม "จำนวนที่ลูกค้าทัก" ทั้งหมด
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">สถิติการตอบแชท</h3>
        <p className="text-xs text-slate-500 mt-0.5">ความเร็วการตอบต่อ user แยกรายเพจ — {cfg?.mode === "24_7" ? "นับทุกแชท 24 ชม. ทุกวัน (เวลาตอบคิดจากเวลาจริง)" : "นับเฉพาะแชทที่ลูกค้าทักใน \"เวลาทำการ\" และหักเวลาพัก/นอกเวลาออกจากการคำนวณ"}</p>
      </div>
      {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}

      {cfg && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="text-xs font-medium text-slate-600">เวลาทำการ (ใช้คำนวณ)</div>

          {/* โหมดการนับ: นับทุกวัน 24 ชม. หรือ กรองวันหยุด/เวลาทำการ */}
          <div>
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
              <button type="button" onClick={() => persistMode("24_7")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${cfg.mode === "24_7" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                นับทุกวัน 24 ชม.
              </button>
              <button type="button" onClick={() => persistMode("office")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${cfg.mode !== "24_7" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                กรองวันหยุด / เวลาทำการ
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {cfg.mode === "24_7"
                ? "กำลังนับทุกแชท 24 ชม. ทุกวัน (ไม่กรองวันหยุด/เวลาทำการ) — เวลาตอบคิดจากเวลาจริง"
                : "นับเฉพาะแชทในวัน-เวลาทำการที่ตั้งด้านล่าง และหักเวลาพัก/นอกเวลา/วันหยุดออก"}
            </p>
          </div>

          {/* วันทำงาน — ปุ่มใหญ่พอให้กดบนมือถือ (ปิดใช้งานเมื่อเลือกโหมด 24 ชม.) */}
          <div className={cfg.mode === "24_7" ? "opacity-40 pointer-events-none" : ""}>
            <div className="text-[11px] text-slate-400 mb-1">วันทำงาน</div>
            <div className="grid grid-cols-7 gap-1">
              {DAYS.map(([d, l]) => (
                <label key={d} className={`py-2 rounded-lg border cursor-pointer text-xs text-center select-none ${cfg.days?.includes(Number(d)) ? "bg-indigo-100 border-indigo-300 text-indigo-700 font-semibold" : "border-slate-200 text-slate-500"}`}>
                  <input type="checkbox" className="hidden" checked={cfg.days?.includes(Number(d)) || false}
                    onChange={(e) => setCfg({ ...cfg, days: e.target.checked ? [...(cfg.days || []), Number(d)] : (cfg.days || []).filter((x) => x !== Number(d)) })} />{l}
                </label>
              ))}
            </div>
          </div>

          {/* เวลา — จัดเป็นคู่ มีป้ายกำกับชัด ไม่ตัดบรรทัดมั่วบนมือถือ (ปิดใช้งานเมื่อเลือกโหมด 24 ชม.) */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs ${cfg.mode === "24_7" ? "opacity-40 pointer-events-none" : ""}`}>
            <div>
              <div className="text-[11px] text-slate-400 mb-1">เปิด</div>
              <input type="time" value={cfg.open || "09:00"} onChange={(e) => setCfg({ ...cfg, open: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
            <div>
              <div className="text-[11px] text-slate-400 mb-1">ปิด</div>
              <input type="time" value={cfg.close || "17:00"} onChange={(e) => setCfg({ ...cfg, close: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
            <div>
              <div className="text-[11px] text-slate-400 mb-1">พักตั้งแต่</div>
              <input type="time" value={cfg.break_start || "12:00"} onChange={(e) => setCfg({ ...cfg, break_start: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
            <div>
              <div className="text-[11px] text-slate-400 mb-1">ถึง</div>
              <input type="time" value={cfg.break_end || "13:00"} onChange={(e) => setCfg({ ...cfg, break_end: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
          </div>

          <div className="flex items-end gap-2 text-xs">
            <div className="flex-1 sm:flex-none">
              <div className="text-[11px] text-slate-400 mb-1">ถือว่าช้าเมื่อเกิน (นาที)</div>
              <NumInput min={1} value={cfg.slow_min ?? 5} onChange={(n) => setCfg({ ...cfg, slow_min: n })} className="w-full sm:w-24 rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
            <button onClick={saveCfg} disabled={saving} className="bg-slate-900 text-white rounded-lg px-4 py-1.5 font-medium disabled:opacity-60 shrink-0">{saving ? "..." : "บันทึก"}</button>
          </div>

          {/* วันหยุดพิเศษ — วันที่ในนี้จะถูกตัดออกจากการคำนวณทั้งหมด (เหมือนวันหยุดประจำสัปดาห์) · ไม่ใช้ในโหมด 24 ชม. */}
          <div className={`border-t border-slate-200 pt-2 mt-1 ${cfg.mode === "24_7" ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex items-center gap-2 flex-wrap text-xs mb-1.5">
              <span className="font-medium text-slate-600">วันหยุดพิเศษ ({(cfg.holidays || []).length} วัน)</span>
              <span className="text-slate-400">— เช่น สงกรานต์ ปีใหม่ วันหยุดชดเชย · ตัดออกจากการคำนวณเวลาตอบ</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <input
                type="date"
                value={newHoliday}
                onChange={(e) => setNewHoliday(e.target.value)}
                className="rounded-lg border border-slate-300 px-1.5 py-1"
              />
              <button
                onClick={() => {
                  if (!newHoliday) return;
                  const cur = cfg.holidays || [];
                  if (cur.includes(newHoliday)) { setNewHoliday(""); return; }
                  persistHolidays([...cur, newHoliday].sort());
                  setNewHoliday("");
                }}
                disabled={!newHoliday}
                className="rounded-lg bg-indigo-600 text-white px-2.5 py-1 font-medium hover:bg-indigo-700 disabled:opacity-40"
              >
                + เพิ่มวันหยุด
              </button>
              {(cfg.holidays || []).length > 0 && (
                <button onClick={() => persistHolidays([])} className="text-slate-400 hover:text-rose-600">ล้างทั้งหมด</button>
              )}
              {holidayMsg
                ? <span className={`text-[10px] ${holidayMsg.startsWith("✓") ? "text-emerald-600" : holidayMsg.startsWith("กำลัง") ? "text-slate-400" : "text-rose-600"}`}>{holidayMsg}</span>
                : <span className="text-[10px] text-slate-400">กดเพิ่ม/ลบ = บันทึกลงฐานข้อมูลทันที (ถาวร)</span>}
            </div>
            {/* ปฏิทิน — เห็นวันหยุดที่ตั้งไว้ (ไฮไลต์ม่วง) คลิกวันเพื่อเพิ่ม/ลบ */}
            <div className="mt-2">
              <HolidayCalendar
                holidays={cfg.holidays || []}
                onToggle={(ds) => {
                  const cur = cfg.holidays || [];
                  persistHolidays(cur.includes(ds) ? cur.filter((x) => x !== ds) : [...cur, ds].sort());
                }}
              />
            </div>
            {(cfg.holidays || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {(cfg.holidays || []).map((h) => (
                  <span key={h} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 rounded-full px-2 py-0.5 text-[11px]">
                    {fmtDMY(h)}
                    <button onClick={() => persistHolidays((cfg.holidays || []).filter((x) => x !== h))} className="text-slate-400 hover:text-rose-600" title="ลบวันหยุดนี้ (บันทึกทันที)">✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ตัดลูกค้าที่ไม่ต้องการนับสถิติ (เช่น เฟสส่วนตัวที่ใช้เทสระบบ) */}
          <div className="border-t border-slate-200 pt-2 mt-1">
            <div className="text-xs font-medium text-slate-600 mb-1">ไม่นับสถิติของลูกค้าเหล่านี้ (เช่น บัญชีเทส)</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                list="reply-stats-customer-names"
                value={excludeInput}
                onChange={(e) => { setExcludeInput(e.target.value); setExcludeMsg(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExcludedName(); } }}
                placeholder="พิมพ์แล้วเลือกชื่อลูกค้าจากรายการ เช่น Aphiwat Ch"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <datalist id="reply-stats-customer-names">{customerNameOptions.map((name) => <option key={name} value={name} />)}</datalist>
              <button type="button" onClick={addExcludedName} disabled={!excludeInput.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">เพิ่มและบันทึก</button>
            </div>
            {(cfg.exclude || []).length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
              {(cfg.exclude || []).map((name) => <span key={name} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                {name}
                <button type="button" onClick={() => persistExcludedNames((cfg.exclude || []).filter((item) => item !== name))} className="text-slate-400 hover:text-rose-600" title="ลบและบันทึก">✕</button>
              </span>)}
            </div>}
            {excludeMsg && <p className={`mt-1 text-[10px] ${excludeMsg.startsWith("✓") ? "text-emerald-600" : excludeMsg.startsWith("กำลัง") ? "text-slate-400" : "text-rose-600"}`}>{excludeMsg}</p>}
            <p className="text-[10px] text-slate-400 mt-1">เลือกจากชื่อลูกค้าที่ระบบเคยดึงมา เพื่อลดการสะกดผิด · รองรับชื่อที่มีเว้นวรรค · เพิ่มหรือลบแล้วบันทึกทันที</p>
          </div>

          {/* คำที่ถือว่า "ลูกค้าปิดบทสนทนาเอง" — ไม่นับเป็นค้างตอบ */}
          <div className="border-t border-slate-200 pt-2 mt-1">
            <div className="text-xs mb-1.5">
              <span className="font-medium text-slate-600">คำที่ถือว่าลูกค้าปิดบทสนทนาเอง</span>
              <span className="text-slate-400"> — ถ้าข้อความสุดท้ายเป็นคำพวกนี้ (หรือกดไลก์/สติกเกอร์/อีโมจิล้วน) จะไม่นับว่าค้างตอบ</span>
            </div>
            <textarea
              value={(cfg.closing_words || []).join(", ")}
              onChange={(e) => setCfg({ ...cfg, closing_words: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
              rows={2}
              placeholder="ขอบคุณ, โอเค, รับทราบ, thanks, ok, salamat, terima kasih"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              คั่นด้วยเครื่องหมายจุลภาค · ระบบตัดคำลงท้ายสุภาพ (ครับ/ค่ะ/po/ya) ให้อัตโนมัติ
              และจะ<b>ไม่</b>ถือว่าปิดถ้าข้อความมีเครื่องหมายคำถามหรือยาวเกิน 40 ตัวอักษร
              {(cfg.closing_words || []).length === 0 && " · เว้นว่าง = ใช้ชุดคำเริ่มต้น (ไทย/อังกฤษ/ตากาล็อก/อินโดฯ)"}
            </p>
          </div>
        </div>
      )}

      {/* ช่วงเวลาสำเร็จรูป — กดแล้วโหลดทันที */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(([label, fn]) => {
          const [s, u] = fn();
          const active = s === since && u === until;
          return (
            <button
              key={label}
              onClick={() => { setSince(s); setUntil(u); load(s, u); }}
              className={`text-[11px] rounded-full px-2.5 py-1 font-medium border transition ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs relative">
        <span className="text-slate-400">ช่วงวันที่</span>
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="rounded-lg border border-slate-300 px-1.5 py-1" />
        <span className="text-slate-400">ถึง</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-lg border border-slate-300 px-1.5 py-1" />

        {/* เลือกเพจ — ติ๊กได้หลายเพจ ไม่ติ๊ก = ทุกเพจ */}
        <button onClick={() => setPageMenu((o) => !o)} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 flex items-center gap-1">
          เพจ: {selPages.length === 0 ? "ทุกเพจ" : selPages.length === 1
            ? (pageOpts.find((p) => p.id === selPages[0])?.name || "1 เพจ")
            : `${selPages.length} เพจ`}
          <ChevronDown size={12} className={`transition-transform ${pageMenu ? "rotate-180" : ""}`} />
        </button>
        {pageMenu && (
          <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-2 w-72">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[10px] text-slate-400">ไม่ติ๊กเลย = ทุกเพจ</span>
              <div className="flex gap-2 text-[11px]">
                <button onClick={() => setSelPages(pageOpts.map((p) => p.id))} className="text-indigo-600 hover:underline">เลือกทั้งหมด</button>
                <button onClick={() => setSelPages([])} className="text-slate-500 hover:underline">ล้าง</button>
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {pageOpts.length === 0 && <div className="text-[11px] text-slate-400 px-1 py-1">ยังไม่มีรายชื่อเพจ</div>}
              {pageOpts.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={selPages.includes(p.id)}
                    onChange={(e) => setSelPages(e.target.checked ? [...selPages, p.id] : selPages.filter((x) => x !== p.id))}
                    className="w-3.5 h-3.5"
                  />
                  <span className="truncate">{p.name}</span>
                </label>
              ))}
            </div>
            <button onClick={() => { setPageMenu(false); load(); }} className="w-full mt-2 bg-slate-900 text-white rounded-lg px-2 py-1.5 text-[11px] font-medium hover:bg-slate-800">
              ใช้ตัวกรองนี้
            </button>
          </div>
        )}
        <button onClick={load} disabled={busy} className="border border-slate-300 text-slate-700 rounded-lg px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1">
          {busy ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} ดูสถิติ
        </button>
        <button onClick={rebuild} disabled={rebuilding || busy} className="bg-indigo-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1">
          {rebuilding ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} ดึงจากแชทจริง
        </button>
        {res && <span className="text-slate-400">ตอบแล้ว {res.counted} · ยังไม่ตอบ {res.unanswered ?? 0} · ข้ามนอกเวลาทำการ {res.skipped}</span>}
      </div>
      {rebuildMsg && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{rebuildMsg}</div>}

      {/* ---- KPI สรุปรวม (การ์ดใหญ่แบบ enterprise) ---- */}
      {res && perPage.length > 0 && (() => {
        const t = totals();
        const avg = t.answered ? t.sum / t.answered : 0;
        const rate = t.alerts ? Math.round((t.answered / t.alerts) * 100) : 0;
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <DsStatCard icon={MessageSquare} label="ลูกค้าทักทั้งหมด" value={t.alerts.toLocaleString()} tone="purple" sub={`${perPage.length} เพจ · ${rangeLabel}`} />
            <DsStatCard icon={CheckCircle2} label="ตอบแล้ว" value={t.answered.toLocaleString()} tone="green" sub={`คิดเป็น ${rate}%`} />
            <DsStatCard icon={Clock} label="เวลาตอบเฉลี่ย" value={fmtMin(avg)} tone="blue" sub={`ช้าเกินเกณฑ์ ${t.slow} รอบ`} />
            <DsStatCard icon={AlertTriangle} label="ค้างตอบ" value={t.unanswered.toLocaleString()} tone={t.unanswered > 0 ? "red" : "green"} sub={`ลูกค้าปิดเอง ${t.closed}`} />
          </div>
        );
      })()}

      {/* ---- สรุปรายวัน × เพจ: จำนวนครั้งที่ต้องตอบ / ตอบแล้ว / ช้า / ยังไม่ตอบ ---- */}
      {res?.daily?.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-slate-600">
              {viewMode === "summary" ? `สรุปรายเพจ · ${rangeLabel}` : "แยกรายวัน · ตามเพจ"}
            </span>
            <div className="flex gap-1 ml-auto text-[11px]">
              {[["summary", "รวมทั้งช่วง"], ["daily", "แยกรายวัน"]].map(([k, l]) => (
                <button key={k} onClick={() => setViewMode(k)} className={`rounded-full px-2.5 py-1 font-medium ${viewMode === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
              ))}
              <button onClick={exportPdf} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50 flex items-center gap-1">📄 PDF</button>
              <button onClick={exportSummaryCsv} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">⤓ CSV</button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2 font-medium">{viewMode === "summary" ? "ช่วงเวลา" : "วันที่"}</th>
              <SortTh k="name">เพจ</SortTh>
              <SortTh k="alerts" center>ลูกค้าทัก (ครั้ง)</SortTh>
              <th className="px-3 py-2 font-medium text-center">ตอบแล้ว</th>
              <SortTh k="avg" center>เฉลี่ย</SortTh>
              <SortTh k="slow" center>ตอบช้าเกิน {res.slow_min} น.</SortTh>
              <SortTh k="unanswered" center>ยังไม่ตอบ</SortTh>
              <SortTh k="closed" center>ลูกค้าปิดเอง</SortTh>
              <SortTh k="read_slow" center>อ่านช้าเกิน {res.slow_min} น.</SortTh>
              <SortTh k="unread" center>ยังไม่อ่าน</SortTh>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(viewMode === "summary" ? sortRows(perPage) : res.daily).map((d, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{viewMode === "summary" ? rangeLabel : d.day}</td>
                  <td className="px-3 py-2 text-slate-700 truncate max-w-[220px]" title={d.page_name}>{d.page_name}</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-800">{d.alerts}</td>
                  <td className="px-3 py-2 text-center text-slate-600">{d.answered}</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-800">{d.answered ? fmtMin(d.avg_min) : "-"}</td>
                  <td className={`px-3 py-2 text-center font-semibold ${d.slow > 0 ? "text-rose-600" : "text-emerald-600"}`}>{d.slow}</td>
                  <td className={`px-3 py-2 text-center font-semibold ${d.unanswered > 0 ? "text-amber-600" : "text-slate-400"}`}>{d.unanswered}</td>
                  <td className="px-3 py-2 text-center text-slate-500" title="ลูกค้าพิมพ์ขอบคุณ/กดไลก์ปิดท้าย — ไม่ต้องตอบ ไม่นับเป็นค้าง">{d.closed ?? 0}</td>
                  <td className={`px-3 py-2 text-center ${d.read_slow > 0 ? "text-rose-500 font-semibold" : "text-slate-400"}`} title={d.avg_read_min != null ? `เฉลี่ยกว่าจะอ่าน ${fmtMin(d.avg_read_min)}` : ""}>{d.read_slow ?? 0}</td>
                  <td className={`px-3 py-2 text-center ${d.unread > 0 ? "text-amber-600 font-semibold" : "text-slate-400"}`}>{d.unread ?? 0}</td>
                </tr>
              ))}
              {/* แถวรวมทุกเพจ — ตอบคำถาม "ทั้งช่วงนี้มีกี่แชท" */}
              {viewMode === "summary" && perPage.length > 0 && (() => {
                const t = perPage.reduce((a, p) => ({
                  alerts: a.alerts + p.alerts, answered: a.answered + p.answered,
                  slow: a.slow + p.slow, unanswered: a.unanswered + p.unanswered, sum: a.sum + p.sum,
                }), { alerts: 0, answered: 0, slow: 0, unanswered: 0, sum: 0 });
                return (
                  <tr className="bg-slate-100 font-semibold">
                    <td className="px-3 py-2 text-slate-700">รวมทุกเพจ</td>
                    <td className="px-3 py-2 text-slate-500">{perPage.length} เพจ</td>
                    <td className="px-3 py-2 text-center text-slate-900">{t.alerts}</td>
                    <td className="px-3 py-2 text-center text-slate-700">{t.answered}</td>
                    <td className="px-3 py-2 text-center text-slate-900">{t.answered ? fmtMin(t.sum / t.answered) : "-"}</td>
                    <td className="px-3 py-2 text-center text-rose-600">{t.slow}</td>
                    <td className="px-3 py-2 text-center text-amber-600">{t.unanswered}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{t.closed}</td>
                    <td className="px-3 py-2 text-center text-rose-500">{t.read_slow}</td>
                    <td className="px-3 py-2 text-center text-amber-600">{t.unread}</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- ลิสต์หลักฐานรายแชท ---- */}
      {res?.evidence?.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <button onClick={() => setShowEvidence((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700">
            <span>รายการหลักฐาน — ดูรายแชทว่าใครตอบ/ช้ากี่นาที ({res.evidence_total} รายการ)</span>
            <ChevronDown size={14} className={`transition-transform ${showEvidence ? "rotate-180" : ""}`} />
          </button>
          {showEvidence && (<>
            <div className="flex gap-1 px-3 py-2 border-b border-slate-200 text-[11px]">
              {[["slow", `ช้าเกินเกณฑ์ + ยังไม่ตอบ`], ["unanswered", "เฉพาะยังไม่ตอบ"], ["all", "ทั้งหมด"]].map(([k, l]) => (
                <button key={k} onClick={() => { setEvFilter(k); setEvLimit(300); }} className={`rounded-full px-2.5 py-1 font-medium ${evFilter === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
              ))}
              <button
                onClick={() => {
                  const list = evRows;
                  const head = ["วันที่", "เพจ", "ลูกค้า", "ลูกค้าทักเมื่อ", "ตอบเมื่อ", "ใช้เวลา(นาที)", "ผู้ตอบ", "ช่องทาง", "conversation_id"];
                  const rows = list.map((e) => [e.day, e.page_name, e.customer_name || "", e.msg_at, e.replied_at || "ยังไม่ตอบ", e.minutes == null ? "" : e.minutes.toFixed(1), e.by || "", e.source, e.conversation_id]);
                  const csv = "﻿" + [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
                  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
                  const a = document.createElement("a"); a.href = url; a.download = `หลักฐานการตอบแชท_${since}_${until}.csv`; a.click(); URL.revokeObjectURL(url);
                }}
                className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
              >
                ⤓ Export CSV
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-50 z-10"><tr className="text-left text-slate-600 border-b border-slate-200">
                  {[["day", "วันที่", ""], ["page_name", "เพจ", ""], ["customer_name", "ลูกค้า", ""],
                    ["msg_at", "ลูกค้าทัก", "text-center"], ["replied_at", "ตอบเมื่อ", "text-center"],
                    ["minutes", "ใช้เวลา", "text-center"], ["read_minutes", "อ่านเมื่อ", "text-center"],
                    ["by", "ผู้ตอบ", ""]].map(([k, label, cls]) => (
                    <th key={k} className={`px-3 py-1.5 font-medium ${cls}`}>
                      <button
                        onClick={() => { if (evSort === k) setEvDir((d) => (d === "asc" ? "desc" : "asc")); else { setEvSort(k); setEvDir(k === "minutes" || k === "read_minutes" ? "desc" : "asc"); } }}
                        className={`inline-flex items-center gap-0.5 hover:text-slate-800 ${evSort === k ? "text-slate-800 font-semibold" : ""}`}
                      >
                        {label}{evSort === k && <span className="text-[8px]">{evDir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {evRows.slice(0, evLimit).map((e, i) => (
                    // ใช้ bg-*-50 ตัวเต็ม (ไม่ใส่ /40) เพราะธีมมืดมี override ให้เฉพาะตัวเต็ม
                    // ถ้าใส่ opacity จะได้สีอ่อนของโหมดสว่างมาทับพื้นเข้ม ทำให้ตัวหนังสือจมอ่านไม่ออก
                    // + ใช้แถบสีซ้ายเป็นตัวบอกสถานะแทนการพึ่งพื้นหลังอย่างเดียว
                    <tr key={i} className={`${!e.answered && !e.is_closing ? "bg-amber-50" : e.slow ? "bg-rose-50" : ""} hover:bg-slate-100 transition-colors`}>
                      <td className={`px-3 py-1.5 text-slate-600 whitespace-nowrap border-l-2 ${!e.answered && !e.is_closing ? "border-amber-500" : e.slow ? "border-rose-500" : "border-transparent"}`}>{e.day}</td>
                      <td className="px-3 py-1.5 text-slate-600 truncate max-w-[140px]" title={e.page_name}>{e.page_name}</td>
                      <td className="px-3 py-1.5 max-w-[180px]">
                        {onOpenChat ? (
                          <button
                            onClick={() => onOpenChat(e.conversation_id, e.msg_at)}
                            className="text-indigo-600 hover:text-indigo-500 hover:underline font-medium truncate max-w-full text-left flex items-center gap-1"
                            title="เปิดแชทนี้และเลื่อนไปยังข้อความที่ตอบช้า/ยังไม่ตอบ"
                          >
                            <span className="truncate">{e.customer_name || e.conversation_id}</span>
                            <ArrowUpCircle size={11} className="shrink-0 rotate-45 opacity-60" />
                          </button>
                        ) : (
                          <span className="text-slate-700 truncate block">{e.customer_name || e.conversation_id}</span>
                        )}
                      </td>
                      {/* เวลาจริง — ไว้ตรวจสอบว่าตัวเลข "ใช้เวลา" มาจากช่วงไหน (รอบเริ่มที่ข้อความแรกที่ยังไม่มีใครตอบ) */}
                      <td className="px-3 py-1.5 text-center text-slate-500 whitespace-nowrap" title={e.msg_at}>{fmtClock(e.msg_at)}</td>
                      <td className="px-3 py-1.5 text-center text-slate-500 whitespace-nowrap" title={e.replied_at || ""}>{e.replied_at ? fmtClock(e.replied_at) : "-"}</td>
                      <td className={`px-3 py-1.5 text-center font-semibold whitespace-nowrap ${!e.answered ? (e.is_closing ? "text-slate-500" : "text-amber-600") : e.slow ? "text-rose-600" : "text-emerald-600"}`}>
                        {e.answered ? fmtMin(e.minutes) : e.is_closing ? "ลูกค้าปิดเอง" : "ยังไม่ตอบ"}
                      </td>
                      <td className={`px-3 py-1.5 text-center whitespace-nowrap ${e.is_unread ? "text-amber-600 font-semibold" : "text-slate-500"}`} title={e.read_at || ""}>
                        {e.is_unread ? "ยังไม่อ่าน" : e.read_at ? `${fmtClock(e.read_at)}${e.read_minutes != null ? ` (${fmtMin(e.read_minutes)})` : ""}` : "-"}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500 truncate max-w-[160px]" title={e.by || ""}>{e.by || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 text-[11px] text-slate-500">
              <span>แสดง {Math.min(evLimit, evRows.length)} จาก {evRows.length} รายการ{evRows.length !== res.evidence_total ? ` (ทั้งหมด ${res.evidence_total})` : ""}</span>
              {evRows.length > evLimit && (
                <button onClick={() => setEvLimit((n) => n + 500)} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">
                  ดูเพิ่มอีก 500 รายการ
                </button>
              )}
              {evLimit > 300 && (
                <button onClick={() => setEvLimit(300)} className="text-slate-400 hover:text-slate-600">ย่อกลับ</button>
              )}
            </div>
          </>)}
        </div>
      )}

      {res && res.stats.length === 0 && (res.daily?.length ?? 0) === 0 && (
        <div className="text-sm text-slate-400 py-3 text-center">
          ยังไม่มีข้อมูลในช่วงนี้ — กด "ดึงจากแชทจริง" เพื่ออ่านย้อนหลังจากบทสนทนาที่ซิงก์ไว้
        </div>
      )}
      {/* สรุปต่อผู้ใช้ (รวมทุกเพจ) — จำนวนรอบที่ตอบ + ความเร็วเฉลี่ย */}
      {res && (res.users?.length ?? 0) > 0 && (
        <div>
          <div className="text-xs font-medium text-slate-600 mb-1">สรุปต่อผู้ใช้ (รวมทุกเพจ) — ในเวลาทำการ</div>
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 font-medium">ผู้ตอบ</th>
                <th className="px-3 py-2 font-medium text-center">ตอบ (รอบ)</th>
                <th className="px-3 py-2 font-medium text-center">เพจ</th>
                <th className="px-3 py-2 font-medium text-center">เฉลี่ย</th>
                <th className="px-3 py-2 font-medium text-center">เร็วสุด/ช้าสุด</th>
                <th className="px-3 py-2 font-medium text-center">ช้าเกิน {res.slow_min} นาที</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {res.users.map((u, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-slate-800 font-medium">{u.email}</td>
                    <td className="px-3 py-2 text-center">{u.count}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{u.pages}</td>
                    <td className="px-3 py-2 text-center font-semibold text-slate-800">{fmtMin(u.avg_min)}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{fmtMin(u.fastest_min)} / {fmtMin(u.slowest_min)}</td>
                    <td className={`px-3 py-2 text-center font-semibold ${u.slow > 0 ? "text-rose-600" : "text-emerald-600"}`}>{u.slow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ช่วงนอกเวลา/พัก/วันหยุด — ไม่นับในค่าเฉลี่ยหลัก แต่วิเคราะห์ด้วยเวลาจริง */}
      {res && res.off && res.off.total > 0 && (
        <div className="ds-card p-4">
          <div className="text-sm font-semibold text-amber-600 mb-1 flex items-center gap-1.5">🌙 ช่วงนอกเวลาทำการ / พักเบรก / วันหยุด <span className="text-[11px] font-normal text-slate-500">(ไม่นับในค่าเฉลี่ยหลัก)</span></div>
          <div className="text-[11px] text-slate-600 mb-2">
            ลูกค้าทักช่วงนี้ทั้งหมด <b>{res.off.total}</b> รอบ · ตอบแล้ว <b className="text-emerald-700">{res.off.answered}</b> · ยังไม่ตอบ <b className="text-rose-600">{res.off.unanswered}</b> · เฉลี่ยเวลาตอบจริง <b>{fmtMin(res.off.avg_min)}</b>
            <span className="text-slate-400"> (นับเวลาจริง ไม่หักเวลาทำการ)</span>
          </div>
          {(res.off.by_user?.length ?? 0) > 0 && (
            <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 font-medium">ผู้ตอบ</th>
                  <th className="px-3 py-2 font-medium text-center">ทัก (รอบ)</th>
                  <th className="px-3 py-2 font-medium text-center">ตอบ</th>
                  <th className="px-3 py-2 font-medium text-center">ยังไม่ตอบ</th>
                  <th className="px-3 py-2 font-medium text-center">เฉลี่ย (เวลาจริง)</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {res.off.by_user.map((o, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-slate-800">{o.email}</td>
                      <td className="px-3 py-2 text-center">{o.count}</td>
                      <td className="px-3 py-2 text-center text-emerald-700">{o.answered}</td>
                      <td className="px-3 py-2 text-center text-rose-600">{o.unanswered}</td>
                      <td className="px-3 py-2 text-center font-semibold text-slate-800">{o.answered ? fmtMin(o.avg_min) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* แต้มพิเศษ (ตอบนอกเวลาทำการ) — ต่อผู้ใช้ */}
      {res && res.points && (res.points.by_user?.length ?? 0) > 0 && (
        <div className="ds-card p-4">
          <div className="text-sm font-semibold mb-1 flex items-center gap-1.5" style={{ color: "#c4a9ff" }}>🏆 แต้มพิเศษ — ตอบแชทนอกเวลาทำการ <span className="text-[11px] font-normal text-slate-500">รวม {res.points.total} แต้ม</span></div>
          <div className="text-[11px] text-slate-500 mb-2">ยิ่งตอบดึก/วันหยุด/เร็ว = ยิ่งได้แต้มเยอะ (ทัน 3 นาที = แต้มเต็ม, ช้ากว่า = ครึ่ง)</div>
          <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 font-medium">ผู้ตอบ</th>
                <th className="px-3 py-2 font-medium text-center">แต้มรวม</th>
                <th className="px-3 py-2 font-medium text-center">ตอบนอกเวลา (ครั้ง)</th>
                <th className="px-3 py-2 font-medium text-center">ทัน 3 นาที</th>
                <th className="px-3 py-2 font-medium text-center">ช้ากว่า</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {res.points.by_user.map((p, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-slate-800 font-medium">{i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}{p.email}</td>
                    <td className="px-3 py-2 text-center"><span className="font-bold text-[13px] text-amber-600 tabular-nums">{p.points}</span></td>
                    <td className="px-3 py-2 text-center text-slate-300 tabular-nums">{p.count}</td>
                    <td className="px-3 py-2 text-center text-emerald-600 font-medium tabular-nums">{p.in_time}</td>
                    <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{p.slow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {res && res.stats.length > 0 && (
        <div>
        <div className="text-xs font-medium text-slate-600 mb-1">แยกตามผู้ใช้ × เพจ — ในเวลาทำการ</div>
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
              <th className="px-3 py-2 font-medium">ผู้ตอบ</th><th className="px-3 py-2 font-medium">เพจ</th>
              <th className="px-3 py-2 font-medium text-center">ตอบ (ครั้ง)</th>
              <th className="px-3 py-2 font-medium text-center">เฉลี่ย</th>
              <th className="px-3 py-2 font-medium text-center">เร็วสุด/ช้าสุด</th>
              <th className="px-3 py-2 font-medium text-center">ช้าเกิน {res.slow_min} นาที</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {res.stats.map((s, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-slate-800">{s.email}</td>
                  <td className="px-3 py-2 text-slate-600">{s.page_name}</td>
                  <td className="px-3 py-2 text-center">{s.count}</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-800">{fmtMin(s.avg_min)}</td>
                  <td className="px-3 py-2 text-center text-slate-500">{fmtMin(s.fastest_min)} / {fmtMin(s.slowest_min)}</td>
                  <td className={`px-3 py-2 text-center font-semibold ${s.slow > 0 ? "text-rose-600" : "text-emerald-600"}`}>{s.slow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {res && res.slow_hours.some((n) => n > 0) && (
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs font-medium text-slate-600">ลูกค้าทักตามช่วงเวลา &amp; สัดส่วนที่ตอบช้า (เวลาไทย)</span>
            <div className="flex gap-1 ml-auto text-[11px]">
              {[["chart", "กราฟ"], ["table", "ตาราง"]].map(([k, l]) => (
                <button key={k} onClick={() => setHourView(k)} className={`rounded-full px-2.5 py-1 font-medium ${hourView === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
              ))}
            </div>
          </div>

          {hourView === "chart" ? (<>
            <div className="flex items-center gap-3 text-[10px] text-slate-500 mb-1">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300 inline-block" /> ลูกค้าทักทั้งหมด</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" /> ในนั้นตอบช้าเกิน {res.slow_min} นาที</span>
            </div>
            {/* คำนวณความสูงเป็น "พิกเซล" ตรงๆ — ใช้ % ไม่ได้เพราะกล่องแม่ในเลย์เอาต์ flex ไม่มีความสูงที่แน่นอน
                (เดิมแท่งเลยยุบเหลือ 3px กลายเป็นขีดบางๆ) */}
            {/* items-stretch + h-full ที่คอลัมน์ — ให้ทั้งแถบแนวตั้งรับเมาส์ได้ ไม่ใช่เฉพาะตัวแท่ง
                (เดิม tooltip ติดกับกล่องที่สูงเท่าเนื้อหา ชี้เหนือแท่งเตี้ยๆ แล้วไม่ขึ้นอะไร) */}
            <div className="flex items-stretch gap-1" style={{ height: 200 }}>
              {res.slow_hours.map((n, h) => {
                const all = res.all_hours[h] || 0;
                const pct = all ? Math.round((n / all) * 100) : 0;
                const BAR_MAX = 150;                                        // ความสูงสูงสุดของแท่ง (px)
                const barH = all ? Math.max(6, Math.round((all / maxAll) * BAR_MAX)) : 0;
                const slowH = all ? Math.round((n / all) * barH) : 0;
                return (
                  <div key={h} className="flex-1 h-full flex flex-col items-center justify-end min-w-0 rounded hover:bg-slate-100 cursor-default"
                    title={all > 0
                      ? `${String(h).padStart(2, "0")}:00-${String(h).padStart(2, "0")}:59 น.\nลูกค้าทัก ${all} ครั้ง\nตอบช้าเกิน ${res.slow_min} นาที ${n} ครั้ง (${pct}%)`
                      : `${String(h).padStart(2, "0")}:00-${String(h).padStart(2, "0")}:59 น. — ไม่มีลูกค้าทักในช่วงนี้`}>
                    {/* ตัวเลข: ช้า / ทั้งหมด */}
                    <span className="text-[10px] leading-tight text-center mb-1 whitespace-nowrap">
                      {all > 0 ? (<><span className="font-bold text-rose-600">{n}</span><span className="text-slate-400">/{all}</span></>) : ""}
                    </span>
                    {/* แท่งเทา = ลูกค้าทักทั้งหมด · ส่วนแดงที่ฐาน = ที่ตอบช้า */}
                    <div className="w-full rounded-t bg-slate-300 flex flex-col justify-end overflow-hidden"
                      style={{ height: barH }}>
                      <div className="w-full bg-rose-500" style={{ height: slowH }} />
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1">{h}</span>
                  </div>
                );
              })}
            </div>
          </>) : (
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-slate-600 border-b border-slate-200">
                  {[["hour", "ช่วงเวลา"], ["slow", "ช้า (ครั้ง)"], ["all", "ทั้งหมด (ครั้ง)"], ["pct", "% ที่ช้า"]].map(([k, l]) => (
                    <th key={k} className={`px-3 py-1.5 font-medium ${k === "hour" ? "" : "text-center"}`}>
                      <button
                        onClick={() => { if (hourSort === k) setHourDir((d) => (d === "asc" ? "desc" : "asc")); else { setHourSort(k); setHourDir(k === "hour" ? "asc" : "desc"); } }}
                        className={`inline-flex items-center gap-0.5 hover:text-slate-800 ${hourSort === k ? "text-slate-800 font-semibold" : ""}`}
                      >
                        {l}{hourSort === k && <span className="text-[8px]">{hourDir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {res.slow_hours
                    .map((n, h) => ({ hour: h, slow: n, all: res.all_hours[h] || 0, pct: res.all_hours[h] ? (n / res.all_hours[h]) * 100 : 0 }))
                    .filter((r) => r.all > 0)
                    .sort((a, b) => (hourDir === "asc" ? 1 : -1) * (a[hourSort] - b[hourSort]))
                    .map((r) => (
                      <tr key={r.hour} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 text-slate-700">{String(r.hour).padStart(2, "0")}:00 - {String(r.hour).padStart(2, "0")}:59</td>
                        <td className={`px-3 py-1.5 text-center font-semibold ${r.slow > 0 ? "text-rose-600" : "text-slate-400"}`}>{r.slow}</td>
                        <td className="px-3 py-1.5 text-center text-slate-600">{r.all}</td>
                        <td className={`px-3 py-1.5 text-center font-semibold ${r.pct >= 50 ? "text-rose-600" : r.pct > 0 ? "text-amber-600" : "text-emerald-600"}`}>{r.pct.toFixed(0)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ตั้งค่าการมองเห็นเมนู "ออฟฟิศจำลอง" (Game) — เปิด/ปิด + จำกัดเฉพาะอีเมล
function GameOfficeSettingsPanel() {
  const [cfg, setCfg] = useState(null);
  const [emailsText, setEmailsText] = useState("");
  const [bg, setBg] = useState("");
  const [sp, setSp] = useState({ url: "", fw: 32, fh: 32, frames: 4, rowDown: 0, rowLeft: 1, rowRight: 2, rowUp: 3, ms: 150, scale: 1.4 });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "game_office").maybeSingle().then(({ data }) => {
      const v = data?.value || { enabled: true, emails: [] };
      setCfg({ enabled: v.enabled !== false });
      setEmailsText((Array.isArray(v.emails) ? v.emails : []).join(", "));
      setBg(v.bg || "");
      if (v.sprite && typeof v.sprite === "object") setSp((s) => ({ ...s, ...v.sprite }));
    });
  }, []);
  const spNum = (k, v) => setSp((s) => ({ ...s, [k]: Number(v) || 0 }));
  async function save() {
    setSaving(true); setMsg("");
    const emails = emailsText.split(/[,\n]/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const { error } = await supabase.from("settings").upsert({ key: "game_office", value: { enabled: cfg.enabled, emails, bg: bg.trim(), sprite: { ...sp, url: sp.url.trim() } }, updated_at: new Date().toISOString() });
    setSaving(false);
    setMsg(error ? "บันทึกไม่สำเร็จ: " + error.message : "บันทึกแล้ว ✓ (ผู้ใช้ต้องรีเฟรชหน้าเพื่อเห็นผล)");
  }
  if (!cfg) return <div className="bg-white rounded-2xl border border-slate-200 p-5"><Spinner label="กำลังโหลด..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Gamepad2 size={16} /> เมนูออฟฟิศจำลอง (Game)</h3>
        <p className="text-xs text-slate-500 mt-0.5">คุมว่าใครจะเห็นแท็บ "ออฟฟิศจำลอง" บ้าง — เป็นฟีเจอร์ทดลอง (beta) แยกจากระบบแชทเดิม ปิดได้โดยไม่กระทบอะไร</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="w-4 h-4" />
        เปิดใช้งานเมนูนี้
      </label>
      <div className={cfg.enabled ? "" : "opacity-40 pointer-events-none"}>
        <label className="text-xs text-slate-600">จำกัดเฉพาะอีเมล (คั่นด้วย , — เว้นว่าง = ทุกคนเห็น)</label>
        <textarea value={emailsText} onChange={(e) => setEmailsText(e.target.value)} rows={2} placeholder="เช่น you@example.com, boss@example.com" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <p className="text-[11px] text-slate-400 mt-1">ใส่เฉพาะอีเมลตัวเอง = ซ่อนจากพนักงานคนอื่น เห็นแค่คุณคนเดียว</p>
      </div>
      <div className={cfg.enabled ? "" : "opacity-40 pointer-events-none"}>
        <label className="text-xs text-slate-600">ลิงก์ภาพฉากหลัง (ไม่บังคับ)</label>
        <input value={bg} onChange={(e) => setBg(e.target.value)} placeholder="https://.../office-pixel.png (เว้นว่าง = ใช้ฉากที่วาดด้วยโค้ด)" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <p className="text-[11px] text-slate-400 mt-1">เจนภาพออฟฟิศ pixel-art แนว AGENT HQ (ขนาดแนวนอน ~940×370) แล้ววางลิงก์ที่นี่ → ตัวละคร sprite จะเดินทับบนภาพ · เว้นว่างไว้จะใช้ฉากที่วาดด้วยโค้ด</p>
      </div>
      {/* ตัวละคร sprite sheet (แบบ Pixel Agents / Metro City) */}
      <div className={"border-t border-slate-200 pt-3 " + (cfg.enabled ? "" : "opacity-40 pointer-events-none")}>
        <div className="text-sm font-medium text-slate-700 mb-1">ตัวละคร (Sprite Sheet)</div>
        <p className="text-[11px] text-slate-400 mb-2">โหลดชุดตัวละคร top-down ฟรี เช่น Metro City (jik-a-4.itch.io/metrocity-free-topdown-character-pack) แล้ววางลิงก์รูป sheet + ปรับค่าเฟรมให้ตรง · เว้นลิงก์ว่าง = ใช้คนวาดด้วยโค้ด</p>
        <label className="text-xs text-slate-600">ลิงก์รูป sprite sheet (.png)</label>
        <input value={sp.url} onChange={(e) => setSp({ ...sp, url: e.target.value })} placeholder="https://.../character.png" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
          <label className="flex flex-col gap-1">กว้าง/เฟรม (px)<input type="number" value={sp.fw} onChange={(e) => spNum("fw", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">สูง/เฟรม (px)<input type="number" value={sp.fh} onChange={(e) => spNum("fh", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">จำนวนเฟรมเดิน<input type="number" value={sp.frames} onChange={(e) => spNum("frames", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">แถวหันลง<input type="number" value={sp.rowDown} onChange={(e) => spNum("rowDown", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">แถวหันซ้าย<input type="number" value={sp.rowLeft} onChange={(e) => spNum("rowLeft", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">แถวหันขวา<input type="number" value={sp.rowRight} onChange={(e) => spNum("rowRight", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">แถวหันขึ้น<input type="number" value={sp.rowUp} onChange={(e) => spNum("rowUp", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">ความเร็ว (ms/เฟรม)<input type="number" value={sp.ms} onChange={(e) => spNum("ms", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">ขยาย (scale)<input type="number" step="0.1" value={sp.scale} onChange={(e) => spNum("scale", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">ค่าเริ่มต้นเดา sheet 4 แถว (ลง/ซ้าย/ขวา/ขึ้น) เฟรมละ 32×32 · ถ้าตัวละครเพี้ยน ปรับตัวเลขให้ตรง sheet ที่โหลดมา แล้วบันทึก+รีเฟรช</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60">{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
        {msg && <span className={`text-xs ${msg.startsWith("บันทึกแล้ว") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ตั้งค่ากระดานแต้ม (แอดมินเท่านั้น) — ใครเห็นบ้าง + เพจไหนที่นับแต้ม
function LeaderboardSettingsPanel() {
  const [cfg, setCfg] = useState(null);
  const [emailsText, setEmailsText] = useState("");
  const [pages, setPages] = useState([]);        // page_id ที่นับ ([] = ทุกเพจ)
  const [pageOpts, setPageOpts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "leaderboard").maybeSingle().then(({ data }) => {
      const v = data?.value || { enabled: true, emails: [], pages: [] };
      setCfg({ enabled: v.enabled !== false });
      setEmailsText((Array.isArray(v.emails) ? v.emails : []).join(", "));
      setPages(Array.isArray(v.pages) ? v.pages.map(String) : []);
    });
    supabase.from("page_lead_config").select("page_id, page_name").order("page_name").then(({ data }) => {
      setPageOpts((data || []).map((p) => ({ id: String(p.page_id), name: p.page_name || p.page_id })));
    });
  }, []);
  const toggle = (id) => setPages((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  async function save() {
    setSaving(true); setMsg("");
    const emails = emailsText.split(/[,\n]/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const { error } = await supabase.from("settings").upsert({ key: "leaderboard", value: { enabled: cfg.enabled, emails, pages }, updated_at: new Date().toISOString() });
    setSaving(false);
    setMsg(error ? "บันทึกไม่สำเร็จ: " + error.message : "บันทึกแล้ว ✓ (ผู้ใช้รีเฟรชหน้าเพื่อเห็นผล)");
  }
  if (!cfg) return <div className="bg-white rounded-2xl border border-slate-200 p-5"><Spinner label="กำลังโหลด..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Trophy size={16} /> กระดานแต้ม (Leaderboard)</h3>
        <p className="text-xs text-slate-500 mt-0.5">คุมว่าใครเห็นเมนู "กระดานแต้ม" และเพจไหนบ้างที่นับแต้ม — ผู้ใช้เลือกเพจเองไม่ได้ ใช้ตามที่ตั้งที่นี่</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="w-4 h-4" />
        เปิดเมนูกระดานแต้ม
      </label>
      <div className={cfg.enabled ? "" : "opacity-40 pointer-events-none"}>
        <label className="text-xs text-slate-600">จำกัดเฉพาะอีเมล (คั่นด้วย , — เว้นว่าง = ทุกคนเห็น)</label>
        <textarea value={emailsText} onChange={(e) => setEmailsText(e.target.value)} rows={2} placeholder="เว้นว่าง = พนักงานทุกคนเห็นได้" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div className={cfg.enabled ? "" : "opacity-40 pointer-events-none"}>
        <label className="text-xs text-slate-600">เพจที่นับแต้ม (ไม่ติ๊ก = ทุกเพจ)</label>
        <div className="mt-1 max-h-52 overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
          {pageOpts.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">ยังไม่มีเพจ</div>}
          {pageOpts.map((p) => (
            <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
              <input type="checkbox" checked={pages.includes(p.id)} onChange={() => toggle(p.id)} className="w-4 h-4" />
              <span className="text-slate-700">{p.name}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">เลือกเฉพาะเพจที่ต้องการให้เข้าแข่ง · เว้นทั้งหมด = นับทุกเพจ</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60">{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
        {msg && <span className={`text-xs ${msg.startsWith("บันทึกแล้ว") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ตั้งค่า "ดึงรีพอร์ตออโต้" — เลือกบัญชี→แคมเปญ→ชุดโฆษณา→โฆษณา + ช่วงเวลา แล้ว cron ดึงมา cache ล่วงหน้า
// เลือกลึกแค่ไหน = ดึงระดับนั้น (ติ๊กแคมเปญ = ระดับแคมเปญ, ติ๊กชุดแต่ไม่ติ๊กโฆษณา = ระดับชุด, ติ๊กโฆษณา = ระดับโฆษณา)
const PREFETCH_RANGES = [["yesterday", "เมื่อวาน"], ["last_3d", "3 วันล่าสุด"], ["last_7d", "7 วันล่าสุด"], ["last_14d", "14 วันล่าสุด"], ["last_30d", "30 วันล่าสุด"], ["maximum", "ทั้งหมด"]];
function InsightsPrefetchPanel() {
  const [cfg, setCfg] = useState({ enabled: false, ranges: [], targets: [] });   // targets: [{account_id,account_name,id,level,name}]
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [accounts, setAccounts] = useState(null);
  const [acct, setAcct] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCamp, setLoadingCamp] = useState(false);
  const [kids, setKids] = useState({});      // parentId -> { loading, nodes: [] }
  const [expanded, setExpanded] = useState({});
  const [custom, setCustom] = useState({ since: "", until: "" });

  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "insights_prefetch").maybeSingle().then(({ data }) => {
      const v = data?.value && typeof data.value === "object" ? data.value : {};
      setCfg({ enabled: v.enabled === true, ranges: Array.isArray(v.ranges) ? v.ranges : [], targets: Array.isArray(v.targets) ? v.targets : [] });
      setLoaded(true);
    });
    supabase.functions.invoke("list-ad-accounts", { body: {} }).then(({ data }) => setAccounts(data?.accounts || []));
  }, []);

  async function loadCampaigns(id) {
    setAcct(id); setCampaigns([]); setExpanded({}); setKids({});
    if (!id) return;
    setLoadingCamp(true);
    const { data } = await supabase.functions.invoke("list-campaigns", { body: { ad_account_id: id } });
    setLoadingCamp(false);
    setCampaigns((data?.campaigns || []).slice().sort((a, b) => (b.effective_status === "ACTIVE" ? 1 : 0) - (a.effective_status === "ACTIVE" ? 1 : 0)));
  }
  async function loadKids(parentId, level) {
    if (kids[parentId]) { setExpanded((e) => ({ ...e, [parentId]: !e[parentId] })); return; }
    setKids((k) => ({ ...k, [parentId]: { loading: true, nodes: [] } }));
    setExpanded((e) => ({ ...e, [parentId]: true }));
    const { data } = await supabase.functions.invoke("list-children", { body: { parent_id: parentId, level } });
    setKids((k) => ({ ...k, [parentId]: { loading: false, nodes: data?.nodes || [] } }));
  }

  const acctName = (accounts || []).find((a) => String(a.account_id) === String(acct))?.name || acct;
  const isPicked = (id) => cfg.targets.some((t) => String(t.id) === String(id));
  // ติ๊ก/ปลด node — ลูก/แม่ในสายเดียวกันเป็น exclusive (ติ๊กลูก = เอาแม่ออก, ติ๊กแม่ = เอาลูกออก)
  function togglePick(node, ancestorIds, descendantIds) {
    setCfg((c) => {
      if (c.targets.some((t) => String(t.id) === String(node.id))) return { ...c, targets: c.targets.filter((t) => String(t.id) !== String(node.id)) };
      const drop = new Set([...(ancestorIds || []), ...(descendantIds || [])].map(String));
      const kept = c.targets.filter((t) => !drop.has(String(t.id)));
      return { ...c, targets: [...kept, { account_id: acct, account_name: acctName, id: String(node.id), level: node.level, name: node.name }] };
    });
  }
  function pickAll(nodes, level, parentAncestors) {
    setCfg((c) => {
      const ids = new Set(nodes.map((n) => String(n.id)));
      const dropAnc = new Set((parentAncestors || []).map(String));
      const kept = c.targets.filter((t) => !ids.has(String(t.id)) && !dropAnc.has(String(t.id)));
      const add = nodes.map((n) => ({ account_id: acct, account_name: acctName, id: String(n.id), level, name: n.name }));
      return { ...c, targets: [...kept, ...add] };
    });
  }
  const toggleRange = (r) => setCfg((c) => ({ ...c, ranges: c.ranges.some((x) => JSON.stringify(x) === JSON.stringify(r)) ? c.ranges.filter((x) => JSON.stringify(x) !== JSON.stringify(r)) : [...c.ranges, r] }));
  const rangeLabel = (r) => typeof r === "string" ? (PREFETCH_RANGES.find(([k]) => k === r)?.[1] || r) : `${r.since}–${r.until}`;

  async function save() {
    setSaving(true); setMsg("");
    const { error } = await supabase.from("settings").upsert({ key: "insights_prefetch", value: cfg, updated_at: new Date().toISOString() });
    setSaving(false);
    setMsg(error ? "บันทึกไม่สำเร็จ: " + error.message : "บันทึกแล้ว ✓ — cron จะดึงตามที่เลือก (ตี 1 + ทยอยเช็ค rate)");
  }

  if (!loaded) return <div className="bg-white rounded-2xl border border-slate-200 p-5"><Spinner label="กำลังโหลด..." /></div>;
  const statusBadge = (st) => <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{st}</span>;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 max-w-3xl">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><BarChart3 size={16} /> ดึงรีพอร์ตออโต้ (cache)</h3>
        <p className="text-xs text-slate-500 mt-0.5">เลือกบัญชี/แคมเปญ/ชุด/โฆษณา + ช่วงเวลา แล้วระบบจะดึงมา cache ล่วงหน้า (ตี 1 ทุกวัน · ทยอยดึง + เช็ค rate limit) เปิดดูจะเร็วและไม่ยิง Meta ซ้ำ</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} className="w-4 h-4" />
        เปิดดึงรีพอร์ตออโต้
      </label>

      {cfg.enabled && (
        <div className="space-y-4">
          {/* ช่วงเวลา */}
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">ช่วงเวลาที่จะดึง (เลือกได้หลายอัน)</div>
            <div className="flex flex-wrap gap-1.5">
              {PREFETCH_RANGES.map(([k, l]) => (
                <button key={k} onClick={() => toggleRange(k)} className={`text-xs rounded-full px-2.5 py-1 border ${cfg.ranges.includes(k) ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{l}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-xs flex-wrap">
              <span className="text-slate-400">กำหนดเอง:</span>
              <input type="date" value={custom.since} onChange={(e) => setCustom((s) => ({ ...s, since: e.target.value }))} className="rounded-lg border border-slate-300 px-1.5 py-1" />
              <span>–</span>
              <input type="date" value={custom.until} onChange={(e) => setCustom((s) => ({ ...s, until: e.target.value }))} className="rounded-lg border border-slate-300 px-1.5 py-1" />
              <button disabled={!custom.since || !custom.until} onClick={() => { toggleRange({ since: custom.since, until: custom.until }); setCustom({ since: "", until: "" }); }} className="rounded-lg bg-slate-900 text-white px-2.5 py-1 disabled:opacity-40">+ เพิ่มช่วง</button>
            </div>
            {cfg.ranges.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {cfg.ranges.map((r, i) => <span key={i} className="inline-flex items-center gap-1 bg-slate-100 rounded-full px-2 py-0.5 text-[11px] text-slate-700">{rangeLabel(r)}<button onClick={() => toggleRange(r)} className="text-slate-400 hover:text-rose-600">✕</button></span>)}
              </div>
            )}
          </div>

          {/* บัญชี → แคมเปญ → ชุด → โฆษณา */}
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">เลือกบัญชีโฆษณา</div>
            <select value={acct} onChange={(e) => loadCampaigns(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">— เลือกบัญชี —</option>
              {(accounts || []).map((a) => <option key={a.account_id} value={a.account_id}>{a.name} ({a.account_id})</option>)}
            </select>
          </div>

          {loadingCamp && <Spinner label="กำลังโหลดแคมเปญ..." />}
          {!loadingCamp && acct && campaigns.length > 0 && (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-96 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 text-[11px] text-slate-500">
                <span>แคมเปญ · ติ๊ก = ดึงระดับแคมเปญ · กดลูกศรเพื่อเลือกลึกลงไป</span>
                <button onClick={() => pickAll(campaigns.map((c) => ({ id: c.id, name: c.name })), "campaign")} className="text-indigo-600 hover:underline">เลือกทุกแคมเปญ</button>
              </div>
              {campaigns.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center gap-2 px-3 py-2 text-sm">
                    <input type="checkbox" checked={isPicked(c.id)} onChange={() => togglePick({ id: c.id, name: c.name, level: "campaign" }, [], (kids[c.id]?.nodes || []).map((s) => s.id))} className="w-4 h-4" />
                    <button onClick={() => loadKids(c.id, "adsets")} className="text-slate-400 hover:text-slate-700">{expanded[c.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                    <span className="flex-1 min-w-0 truncate text-slate-700">{c.name}</span>
                    {statusBadge(c.effective_status)}
                  </div>
                  {expanded[c.id] && (
                    <div className="pl-8 pr-2 pb-1">
                      {kids[c.id]?.loading ? <div className="text-[11px] text-slate-400 py-1">กำลังโหลดชุดโฆษณา...</div> : (kids[c.id]?.nodes || []).length === 0 ? <div className="text-[11px] text-slate-400 py-1">ไม่มีชุดโฆษณา</div> : (
                        <>
                          <button onClick={() => pickAll((kids[c.id].nodes).map((s) => ({ id: s.id, name: s.name })), "adset", [c.id])} className="text-[11px] text-indigo-600 hover:underline">เลือกทุกชุดในแคมเปญนี้</button>
                          {(kids[c.id].nodes).map((s) => (
                            <div key={s.id}>
                              <div className="flex items-center gap-2 py-1 text-sm">
                                <input type="checkbox" checked={isPicked(s.id)} onChange={() => togglePick({ id: s.id, name: s.name, level: "adset" }, [c.id], (kids[s.id]?.nodes || []).map((a) => a.id))} className="w-4 h-4" />
                                <button onClick={() => loadKids(s.id, "ads")} className="text-slate-400 hover:text-slate-700">{expanded[s.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
                                <span className="flex-1 min-w-0 truncate text-slate-600">{s.name}</span>
                                {statusBadge(s.effective_status)}
                              </div>
                              {expanded[s.id] && (
                                <div className="pl-7 pb-1">
                                  {kids[s.id]?.loading ? <div className="text-[11px] text-slate-400 py-1">กำลังโหลดโฆษณา...</div> : (kids[s.id]?.nodes || []).length === 0 ? <div className="text-[11px] text-slate-400 py-1">ไม่มีโฆษณา</div> : (
                                    <>
                                      <button onClick={() => pickAll((kids[s.id].nodes).map((a) => ({ id: a.id, name: a.name })), "ad", [c.id, s.id])} className="text-[11px] text-indigo-600 hover:underline">เลือกทุกโฆษณาในชุดนี้</button>
                                      {(kids[s.id].nodes).map((a) => (
                                        <div key={a.id} className="flex items-center gap-2 py-0.5 text-sm">
                                          <input type="checkbox" checked={isPicked(a.id)} onChange={() => togglePick({ id: a.id, name: a.name, level: "ad" }, [c.id, s.id], [])} className="w-4 h-4" />
                                          <span className="flex-1 min-w-0 truncate text-slate-500">{a.name}</span>
                                          {statusBadge(a.effective_status)}
                                        </div>
                                      ))}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* รายการที่เลือกไว้ (ทุกบัญชี) */}
          {cfg.targets.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">ที่เลือกไว้ ({cfg.targets.length})</div>
              <div className="flex flex-wrap gap-1">
                {cfg.targets.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 bg-slate-100 rounded-full px-2 py-0.5 text-[11px] text-slate-700">
                    <span className="text-slate-400">{t.level === "campaign" ? "แคมเปญ" : t.level === "adset" ? "ชุด" : "โฆษณา"}:</span> {t.name || t.id}
                    <button onClick={() => setCfg((c) => ({ ...c, targets: c.targets.filter((x) => x.id !== t.id) }))} className="text-slate-400 hover:text-rose-600">✕</button>
                  </span>
                ))}
                <button onClick={() => setCfg((c) => ({ ...c, targets: [] }))} className="text-[11px] text-slate-400 hover:text-rose-600 px-1">ล้างทั้งหมด</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <button onClick={save} disabled={saving} className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60">{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
        {cfg.enabled && cfg.targets.length > 0 && (
          <button onClick={async () => { setMsg("กำลังเริ่มดึง..."); await save(); const { data } = await supabase.functions.invoke("prefetch-insights", { body: { seed: true } }); setMsg(data?.ok ? `เริ่มดึงแล้ว ✓ (คิว ${data.remaining ?? "-"} งาน · ทยอยดึงทุก 15 นาที)` : "เริ่มดึงไม่สำเร็จ — อาจยังไม่ได้ deploy prefetch-insights"); }} className="border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-50">เริ่มดึงตอนนี้</button>
        )}
        {msg && <span className={`text-xs ${msg.startsWith("บันทึกแล้ว") || msg.startsWith("เริ่มดึงแล้ว") ? "text-emerald-600" : "text-slate-500"}`}>{msg}</span>}
      </div>
    </div>
  );
}

// พาเนลตั้งค่า "แจ้งเตือน (Push)" — เปิด/ต่ออายุ, ทดสอบส่ง, ตรวจระบบ (ครบในตัว ไม่ผูกกับหน้าแชท)
function PushNotificationPanel() {
  const [perm, setPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "unsupported"));
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [diag, setDiag] = useState(null);
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = (typeof navigator !== "undefined" && navigator.standalone === true) || (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)")?.matches);
  const iosNeedsInstall = isIos && !standalone;

  // subscribe เครื่องนี้ — ขอบเขต push ตาม "เพจที่เลือกดูในหน้าตอบแชท" (settings.inbox_page_filter) ให้ตรงกัน
  // + ส่ง config ให้ SW ต่ออายุเองตอนปิดแอป
  async function subscribeDevice() {
    if (location.protocol !== "https:") throw new Error("ต้องเปิดผ่าน https");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("เบราว์เซอร์นี้ไม่รองรับ Push (iPhone ต้องเพิ่มเป็นแอปหน้าจอโฮมก่อน)");
    const reg = await navigator.serviceWorker.ready;
    const { data: vk } = await supabase.functions.invoke("send-push", { body: { action: "vapid_public" } });
    if (!vk?.ok || !vk.key) throw new Error("backend ยังไม่มี VAPID key (ตั้ง secret + deploy send-push แล้วหรือยัง)");
    const b64 = vk.key.replace(/-/g, "+").replace(/_/g, "/").padEnd(vk.key.length + (4 - (vk.key.length % 4)) % 4, "=");
    const appKey = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    try { reg.active?.postMessage({ type: "push-config", url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, vapidKey: vk.key }); } catch { /* ไม่กระทบ */ }
    // อ่านเพจที่เลือกไว้ (คีย์ผูกอีเมล) เพื่อให้ push เด้งเฉพาะเพจที่เลือก ไม่ใช่ทุกเพจ
    const { data: u } = await supabase.auth.getUser();
    const email = u?.user?.email;
    let scope = [];
    let ps = null;
    if (email) {
      let { data: s } = await supabase.from("settings").select("value").eq("key", `inbox_page_filter:${email}`).maybeSingle();
      if (!s?.value) ({ data: s } = await supabase.from("settings").select("value").eq("key", "inbox_page_filter").maybeSingle());
      ps = s?.value || null;
    }
    if (ps) scope = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (Array.isArray(ps.multi) ? ps.multi : []);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    const { data: sr, error: se } = await supabase.functions.invoke("send-push", { body: { action: "subscribe", subscription: sub.toJSON(), pages: scope, notify_new: true, device_id: getDeviceId() } });
    if (se || !sr?.ok) throw new Error("บันทึก subscription ไม่สำเร็จ: " + (sr?.error || (se ? await readFunctionErrorMessage(se) : "")));
  }

  async function enable() {
    setBusy("enable"); setMsg("");
    try {
      if (typeof Notification === "undefined") throw new Error("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน");
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") { setMsg(p === "denied" ? "🚫 ถูกบล็อกไว้ — เปิดสิทธิ์แจ้งเตือนของเว็บนี้ในตั้งค่าเครื่อง/เบราว์เซอร์ก่อน" : "ยังไม่ได้อนุญาต"); return; }
      await subscribeDevice();
      setMsg("✓ เปิด/ต่ออายุแล้ว — จะเด้งตามเพจที่เลือกในหน้าตอบแชท แม้ปิดแอป");
    } catch (e) { setMsg("✗ " + (e?.message || e)); }
    finally { setBusy(""); }
  }

  async function test() {
    setBusy("test"); setMsg("");
    try {
      await subscribeDevice();
      const { data, error } = await supabase.functions.invoke("send-push", { body: { action: "test" } });
      if (error) { setMsg("✗ เรียกฟังก์ชันไม่ได้: " + (await readFunctionErrorMessage(error))); return; }
      if (!data?.ok) { setMsg("✗ " + (data?.error || (data?.errors?.[0]) || "ส่งไม่สำเร็จ")); return; }
      setMsg(`✓ ส่งทดสอบแล้ว ${data.sent}/${data.total ?? data.sent} เครื่อง — ลองล็อกจอ/ปิดแอป ควรเห็นเด้ง`);
    } catch (e) { setMsg("✗ " + (e?.message || e)); }
    finally { setBusy(""); }
  }

  async function runDiag() {
    setBusy("diag"); setDiag("loading"); setMsg("");
    const { data, error } = await supabase.functions.invoke("send-push", { body: { action: "diag" } });
    setBusy("");
    if (error || !data?.ok) { setDiag(null); setMsg("✗ ตรวจไม่สำเร็จ: " + (data?.error || (error ? await readFunctionErrorMessage(error) : "ต้องเป็นแอดมิน"))); return; }
    setDiag(data);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Bell size={18} /> แจ้งเตือนข้อความใหม่ (Push)</h3>
        <p className="text-xs text-slate-500 mt-1">เด้งเตือนแม้ปิดแอป · ตามเพจที่เลือกในหน้าตอบแชท · ต้องเปิด/ต่ออายุ 1 ครั้งต่อเครื่อง</p>
      </div>

      {iosNeedsInstall && (
        <div className="rounded-lg bg-sky-50 border border-sky-200 text-sky-800 px-3 py-2 text-xs">
          📲 บน iPhone: กดปุ่มแชร์ ⬆️ → <b>"เพิ่มไปยังหน้าจอโฮม"</b> แล้วเปิดแอปจากไอคอนนั้น การแจ้งเตือนตอนปิดแอปถึงจะทำงาน
        </div>
      )}

      <div className="text-xs text-slate-600">
        สถานะสิทธิ์แจ้งเตือนบนเครื่องนี้: <b className={perm === "granted" ? "text-emerald-600" : perm === "denied" ? "text-rose-600" : "text-amber-600"}>
          {perm === "granted" ? "อนุญาตแล้ว" : perm === "denied" ? "ถูกบล็อก" : "ยังไม่อนุญาต"}</b>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={enable} disabled={!!busy}
          className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {busy === "enable" ? "กำลังทำ..." : perm === "granted" ? "🔔 ต่ออายุการแจ้งเตือน" : "🔔 เปิดการแจ้งเตือน"}
        </button>
        <button onClick={test} disabled={!!busy || perm !== "granted"}
          className="rounded-lg bg-slate-100 text-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">
          {busy === "test" ? "กำลังส่ง..." : "ทดสอบส่ง"}
        </button>
        <button onClick={runDiag} disabled={!!busy}
          className="rounded-lg bg-slate-100 text-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">
          {busy === "diag" ? "กำลังตรวจ..." : "ตรวจระบบ"}
        </button>
      </div>

      {msg && <div className="text-xs text-slate-600 whitespace-pre-wrap">{msg}</div>}

      {diag && diag !== "loading" && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1">
          <div className="font-semibold text-slate-700">ผลตรวจระบบ</div>
          <div>VAPID (คีย์ฝั่ง server): {diag.vapid_ok ? "✓ ตั้งค่าแล้ว" : "✗ ยังไม่ตั้ง — ตั้ง secret VAPID + deploy send-push"}</div>
          <div>subscription ของเมลคุณ: <b>{diag.subscriptions_mine}</b> เครื่อง · ทั้งระบบ: {diag.subscriptions_all} เครื่อง</div>
          <div>แชทค้างอ่านตอนนี้: {diag.unread_total} (เกินเวลา {diag.alertMin} นาที: {diag.overdue_now})</div>
          {diag.latest_chat && <div>ข้อความล่าสุดเข้าระบบ: {new Date(diag.latest_chat.updated_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>}
          {diag.subscriptions_mine === 0 && <div className="text-rose-600">⚠️ ยังไม่มี subscription ของเครื่องนี้ — กด "เปิด/ต่ออายุการแจ้งเตือน" ด้านบน</div>}
        </div>
      )}
    </div>
  );
}

const SETTINGS_SECTIONS = [
  { key: "general", label: "AI ช่วยตั้งค่า", icon: Sparkles, form: false },
  { key: "campaign", label: "ค่าเริ่มต้นแคมเปญ", icon: TrendingUp, form: true },
  { key: "decision", label: "เกณฑ์ตัดสินใจอัตโนมัติ", icon: BarChart3, form: true },
  { key: "brand", label: "แบรนด์ / โลโก้ / CI", icon: ImageIcon, form: true },
  { key: "ai_models", label: "โมเดล AI", icon: Wand2, form: true },
  { key: "ai_prompts", label: "คำสั่ง AI (Prompt)", icon: Sparkles, form: false },
  { key: "ghost", label: "ป้องกันแชทผี", icon: AlertTriangle, form: true },
  { key: "leadfields", label: "เพจที่ซิงก์แชท", icon: CheckCircle2, form: false },
  { key: "synccfg", label: "ตั้งค่าการซิงก์แชท", icon: RefreshCw, form: false },
  { key: "notifications", label: "แจ้งเตือน (Push)", icon: Bell, form: false },
  { key: "jobs", label: "งานอัตโนมัติ (ตั้งเวลา)", icon: RefreshCw, form: false },
  { key: "prefetch", label: "ดึงรีพอร์ตออโต้ (cache)", icon: BarChart3, form: false },
  { key: "savedreplies", label: "ข้อความบันทึกไว้", icon: MessageSquare, form: false },
  { key: "knowledge", label: "คลังคำถาม–คำตอบ", icon: Database, form: false },
  { key: "meta", label: "Meta Token", icon: SettingsIcon, form: false },
  { key: "line", label: "LINE OA", icon: MessageSquare, form: false },
  { key: "permissions", label: "สิทธิ์ผู้ใช้", icon: CheckCircle2, form: false },
  { key: "tv_settings", label: "ตั้งค่า TV", icon: Tv, form: false },
  { key: "replystats", label: "สถิติการตอบแชท", icon: BarChart3, form: false },
  { key: "leaderboard", label: "กระดานแต้ม", icon: Trophy, form: false },
  { key: "activity", label: "ประวัติการใช้งาน", icon: RefreshCw, form: false },
];

// ตั้งค่า TV (เฉพาะแอดมิน) — จัดการแบรนด์ (คุกกี้/เพจ/โชว์), สคริปต์ต่อแบรนด์, n8n, ปล่อยอัปเดต
function TvAdminSettingsPanel() {
  const [msg, setMsg] = useState("");
  const [scripts, setScripts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [pages, setPages] = useState([]);           // เพจแชททั้งหมด (page_lead_config)
  const [checkingId, setCheckingId] = useState(null);
  const [whOpen, setWhOpen] = useState(false);
  const [whUrl, setWhUrl] = useState("");
  const [whSecret, setWhSecret] = useState("");
  const [whSaving, setWhSaving] = useState(false);
  const [released, setReleased] = useState(null);
  const [relSaving, setRelSaving] = useState(false);
  const [be, setBe] = useState(null);               // แบรนด์ที่กำลังแก้ { id?, name, sessionid, sign, tv_base, pages, show_in_manager }
  const [beSaving, setBeSaving] = useState(false);

  async function loadScripts() { const { data } = await supabase.from("tv_scripts").select("*").order("created_at"); setScripts(data || []); }
  async function loadBrands() { const { data } = await supabase.functions.invoke("tradingview", { body: { action: "list_brands" } }); setBrands(data?.brands || []); }
  async function loadPages() { const { data } = await supabase.from("page_lead_config").select("page_id, page_name").order("page_name"); setPages((data || []).map((p) => ({ id: String(p.page_id), name: p.page_name || p.page_id }))); }
  async function loadReleased() { const { data } = await supabase.from("settings").select("value").eq("key", "tv_features").maybeSingle(); setReleased(data?.value?.released === true); }
  useEffect(() => { loadScripts(); loadBrands(); loadPages(); loadReleased(); }, []);

  async function toggleReleased() {
    const next = !released;
    if (!confirm(next ? "ปล่อยฟีเจอร์ TV ใหม่ให้ผู้ใช้ทุกคนเห็น?" : "ซ่อนฟีเจอร์ TV ใหม่กลับไปให้เห็นเฉพาะแอดมิน?")) return;
    setRelSaving(true);
    const { error } = await supabase.from("settings").upsert({ key: "tv_features", value: { released: next }, updated_at: new Date().toISOString() });
    setRelSaving(false);
    if (error) { setMsg("✗ บันทึกไม่สำเร็จ: " + error.message); return; }
    setReleased(next);
    setMsg(next ? "✓ ปล่อยอัปเดตให้ผู้ใช้ทุกคนแล้ว" : "✓ ซ่อนไว้ให้เห็นเฉพาะแอดมินแล้ว");
  }
  async function openWebhook() {
    setWhOpen(true); setWhSecret("");
    const { data } = await supabase.functions.invoke("tradingview", { body: { action: "get_webhook" } });
    if (data?.ok) setWhUrl(data.url || "");
  }
  async function saveWebhook() {
    const url = whUrl.trim();
    if (!url) { setMsg("ใส่ n8n Webhook URL ก่อน"); return; }
    setWhSaving(true);
    const bodyReq = { action: "set_webhook", url };
    if (whSecret.trim()) bodyReq.secret = whSecret.trim();
    const { data, error } = await supabase.functions.invoke("tradingview", { body: bodyReq });
    setWhSaving(false);
    if (error || !data?.ok) { setMsg("✗ บันทึกไม่สำเร็จ: " + (data?.error || "")); return; }
    setWhOpen(false); setMsg("✓ บันทึก n8n Webhook แล้ว");
  }
  async function checkBrand(b) {
    setCheckingId(b.id);
    setMsg(`กำลังตรวจคุกกี้ของ "${b.name}"...`);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "webhook_status", brand_id: b.id } });
    setCheckingId(null);
    if (error || !data?.ok) { setMsg("✗ ตรวจไม่สำเร็จ: " + (data?.error || "")); return; }
    if (!data.reachable) { setMsg(`✗ [${b.name}] ต่อ n8n ไม่ได้: ` + (data.error || "เช็ค URL/workflow active")); return; }
    setMsg(data.authed
      ? `✓ [${b.name}] TradingView ล็อกอินอยู่ — พร้อมให้สิทธิ์`
      : `⚠️ [${b.name}] ต่อ n8n ได้ แต่ TradingView ยังไม่ล็อกอิน (คุกกี้หมดอายุ?)\nHTTP ${data.status_code ?? "?"} · sid ${data.sid_len ?? "?"} · sign ${data.sign_len ?? "?"}\nTV: ${(data.sample || "").slice(0, 140)}`);
  }
  function newBrand() { setBe({ name: "", sessionid: "", sign: "", tv_base: "", pages: [], show_in_manager: true }); }
  function editBrand(b) { setBe({ id: b.id, name: b.name, sessionid: "", sign: "", tv_base: b.tv_base || "", pages: (b.pages || []).map(String), show_in_manager: b.show_in_manager !== false, has_cookie: b.has_cookie, ingest_token: b.ingest_token || "" }); }
  const ingestUrl = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/tradingview";
  async function saveBrand() {
    if (!be?.name.trim()) { setMsg("ใส่ชื่อแบรนด์ก่อน"); return; }
    setBeSaving(true);
    const bodyReq = { action: "save_brand", id: be.id, name: be.name.trim(), tv_base: be.tv_base.trim(), pages: be.pages, show_in_manager: be.show_in_manager };
    if (be.sessionid.trim()) { bodyReq.sessionid = be.sessionid.trim(); bodyReq.sign = be.sign.trim(); }
    const { data, error } = await supabase.functions.invoke("tradingview", { body: bodyReq });
    setBeSaving(false);
    if (error || !data?.ok) { setMsg("✗ บันทึกแบรนด์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setBe(null); setMsg("✓ บันทึกแบรนด์แล้ว"); loadBrands();
  }
  async function deleteBrand(b) {
    if (!confirm(`ลบแบรนด์ "${b.name}"?\n(ต้องไม่มีสคริปต์เหลือในแบรนด์นี้)`)) return;
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "delete_brand", id: b.id } });
    if (error || !data?.ok) { setMsg("✗ ลบแบรนด์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setMsg("✓ ลบแบรนด์แล้ว"); loadBrands();
  }
  async function addScript(brandId) {
    const pine_id = prompt("Pine ID (เช่น PUB;xxxxxxxxxxxx)"); if (!pine_id) return;
    const name = prompt("ชื่อสคริปต์ที่จะแสดง"); if (!name) return;
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "add_script", pine_id: pine_id.trim(), name: name.trim(), brand_id: brandId } });
    if (error || !data?.ok) { setMsg("✗ เพิ่มสคริปต์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setMsg("✓ เพิ่มสคริปต์แล้ว"); loadScripts();
  }
  async function deleteScript(s) {
    if (!confirm(`ลบสคริปต์ "${s.name}"?\n(ลบเฉพาะในแอป ไม่ถอนสิทธิ์บน TradingView — สมาชิกในสคริปต์นี้จะหายจากลิสต์ด้วย)`)) return;
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "delete_script", pine_id: s.pine_id } });
    if (error || !data?.ok) { setMsg("✗ ลบสคริปต์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setMsg("✓ ลบสคริปต์แล้ว"); loadScripts();
  }
  const pageName = (id) => pages.find((p) => p.id === String(id))?.name || id;

  return (
    <div className="space-y-4">
      {/* modal ตั้งค่า n8n webhook (global) */}
      {whOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => setWhOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">ตั้งค่า n8n Webhook (ใช้ร่วมทุกแบรนด์)</h3>
              <button onClick={() => setWhOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <p className="text-xs text-slate-500">n8n เป็นตัวยิง TradingView (ส่ง cookie ได้) — ใช้ workflow เดียวทุกแบรนด์ เพราะแอปส่งคุกกี้ของแต่ละแบรนด์ไปให้เอง</p>
            <div>
              <label className="text-xs text-slate-500">n8n Webhook URL</label>
              <input value={whUrl} onChange={(e) => setWhUrl(e.target.value)} placeholder="https://your-n8n/webhook/tv-access" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Secret (เว้นว่าง = ไม่เปลี่ยนของเดิม)</label>
              <input value={whSecret} onChange={(e) => setWhSecret(e.target.value)} placeholder="ต้องตรงกับ secret ใน node Config ของ n8n" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setWhOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">ยกเลิก</button>
              <button onClick={saveWebhook} disabled={whSaving} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{whSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}

      {/* modal เพิ่ม/แก้แบรนด์ */}
      {be && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => setBe(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">{be.id ? "แก้ไขแบรนด์" : "เพิ่มแบรนด์ TradingView"}</h3>
              <button onClick={() => setBe(null)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div>
              <label className="text-xs text-slate-500">ชื่อแบรนด์</label>
              <input value={be.name} onChange={(e) => setBe({ ...be, name: e.target.value })} placeholder="เช่น BeSight / Brand B" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500">TradingView sessionid {be.has_cookie && <span className="text-emerald-600">· มีคุกกี้แล้ว (เว้นว่าง = ไม่เปลี่ยน)</span>}</label>
              <input value={be.sessionid} onChange={(e) => setBe({ ...be, sessionid: e.target.value })} placeholder="คุกกี้ sessionid" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-500">sessionid_sign</label>
              <input value={be.sign} onChange={(e) => setBe({ ...be, sign: e.target.value })} placeholder="คุกกี้ sessionid_sign" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-500">TradingView base URL (เว้นว่าง = ค่าเริ่มต้น)</label>
              <input value={be.tv_base} onChange={(e) => setBe({ ...be, tv_base: e.target.value })} placeholder="https://www.tradingview.com" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-500">เพจแชทที่ให้โชว์ฟอร์มเพิ่ม TV ของแบรนด์นี้</label>
              <div className="mt-1 rounded-lg border border-slate-300 divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {pages.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">ยังไม่มีเพจ</div>}
                {pages.map((p) => {
                  const on = be.pages.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={on} onChange={() => setBe({ ...be, pages: on ? be.pages.filter((x) => x !== p.id) : [...be.pages, p.id] })} />
                      <span className="truncate">{p.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={be.show_in_manager} onChange={(e) => setBe({ ...be, show_in_manager: e.target.checked })} /> โชว์ในหน้าจัดการสมาชิก TV
            </label>
            {be.id && be.ingest_token && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-600">รับคุกกี้อัตโนมัติจาก Chrome extension</div>
                <div className="text-[11px] text-slate-400">ตั้งค่า extension ให้ยิง POST มาที่ URL นี้ พร้อม token ของแบรนด์ (body: {`{action:"ingest_cookie", token, sessionid, sessionid_sign}`})</div>
                <div><span className="text-[10px] text-slate-400">Endpoint URL</span><div className="flex gap-1"><input readOnly value={ingestUrl} onFocus={(e) => e.target.select()} className="flex-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-mono bg-white" /><button onClick={() => navigator.clipboard?.writeText(ingestUrl)} className="px-2 rounded border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-100">คัดลอก</button></div></div>
                <div><span className="text-[10px] text-slate-400">Token (แบรนด์นี้)</span><div className="flex gap-1"><input readOnly value={be.ingest_token} onFocus={(e) => e.target.select()} className="flex-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-mono bg-white" /><button onClick={() => navigator.clipboard?.writeText(be.ingest_token)} className="px-2 rounded border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-100">คัดลอก</button></div></div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setBe(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">ยกเลิก</button>
              <button onClick={saveBrand} disabled={beSaving} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{beSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-800">ตั้งค่า TradingView (แอดมิน)</h3>
            <p className="text-xs text-slate-500 mt-1">จัดการหลายแบรนด์ — แต่ละแบรนด์คุกกี้/สคริปต์แยกกัน · เลือกเพจแชทที่ให้โชว์ + จะโชว์ในหน้าจัดการ TV ไหม</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={openWebhook} className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">ตั้งค่า n8n</button>
            <button onClick={newBrand} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">+ เพิ่มแบรนด์</button>
          </div>
        </div>
        {msg && <div className="text-sm rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-slate-700 whitespace-pre-line">{msg}</div>}
      </div>

      {/* ปล่อยฟีเจอร์ TV ใหม่ */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Tv size={16} /> ปล่อยอัปเดต TV ให้ผู้ใช้ทุกคน</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md">ปิดอยู่ = เห็นเฉพาะแอดมิน, เปิด = ผู้ใช้ทุกคนเห็น (คอลัมน์อีเมล + ตัวเลือก TV ในหน้าตอบแชท)</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-xs font-medium ${released ? "text-emerald-600" : "text-slate-400"}`}>{released == null ? "..." : released ? "ปล่อยแล้ว" : "เฉพาะแอดมิน"}</span>
            <button onClick={toggleReleased} disabled={relSaving || released == null} className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${released ? "bg-emerald-500" : "bg-slate-300"}`}>
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${released ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* รายการแบรนด์ + สคริปต์ต่อแบรนด์ */}
      {brands.length === 0 && <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-400">ยังไม่มีแบรนด์ — กด "+ เพิ่มแบรนด์"</div>}
      {brands.map((b) => {
        const bs = scripts.filter((s) => s.brand_id === b.id);
        return (
          <div key={b.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 truncate flex items-center gap-2">{b.name}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.has_cookie ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>{b.has_cookie ? "มีคุกกี้" : "ยังไม่มีคุกกี้"}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.show_in_manager ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{b.show_in_manager ? "โชว์ในหน้าจัดการ" : "ซ่อนหน้าจัดการ"}</span>
                </div>
                <div className="text-[11px] text-slate-400 truncate mt-0.5">เพจ: {(b.pages || []).length ? (b.pages || []).map(pageName).join(", ") : "— (ไม่ผูกเพจ)"}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => checkBrand(b)} disabled={checkingId === b.id} className="px-2 py-1 rounded-md border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50">{checkingId === b.id ? "ตรวจ..." : "ตรวจระบบ"}</button>
                <button onClick={() => addScript(b.id)} className="px-2 py-1 rounded-md bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700">+ สคริปต์</button>
                <button onClick={() => editBrand(b)} className="px-2 py-1 rounded-md border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-50">แก้ไข</button>
                <button onClick={() => deleteBrand(b)} className="px-2 py-1 rounded-md text-[11px] text-rose-600 hover:bg-rose-50"><Trash2 size={12} /></button>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {bs.length === 0 ? <div className="px-4 py-4 text-center text-xs text-slate-400">ยังไม่มีสคริปต์ — กด "+ สคริปต์"</div> : bs.map((s) => (
                <div key={s.pine_id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate text-sm">{s.name}</div>
                    <div className="text-[11px] text-slate-400 truncate font-mono">{s.pine_id}</div>
                  </div>
                  <button onClick={() => deleteScript(s)} className="flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 rounded-md px-2 py-1 shrink-0" title="ลบสคริปต์นี้"><Trash2 size={13} /> ลบ</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {/* สคริปต์ที่ยังไม่มีแบรนด์ (ถ้ามี) */}
      {scripts.some((s) => !s.brand_id) && (
        <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 font-medium text-amber-700 text-sm">สคริปต์ที่ยังไม่มีแบรนด์ — แนะนำให้ลบแล้วเพิ่มใหม่ในแบรนด์ที่ต้องการ</div>
          <div className="divide-y divide-slate-100">
            {scripts.filter((s) => !s.brand_id).map((s) => (
              <div key={s.pine_id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0"><div className="font-medium text-slate-800 truncate text-sm">{s.name}</div><div className="text-[11px] text-slate-400 truncate font-mono">{s.pine_id}</div></div>
                <button onClick={() => deleteScript(s)} className="text-[11px] font-medium text-rose-600 hover:bg-rose-50 rounded-md px-2 py-1 shrink-0"><Trash2 size={13} /> ลบ</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ settings, onSaved, allowedSettings = null, allowedPages = null, onOpenChat }) {
  // allowedSettings = null → เห็นทุกหัวข้อ (admin) ; array → เห็นเฉพาะหัวข้อที่ได้รับสิทธิ์ (permissions สงวนให้ admin เสมอ)
  const visibleSections = allowedSettings
    ? SETTINGS_SECTIONS.filter((s) => s.key !== "permissions" && s.key !== "tv_settings" && allowedSettings.includes(s.key))
    : SETTINGS_SECTIONS;
  const [section, setSection] = useState(() => visibleSections[0]?.key || "general");
  const [secMenuOpen, setSecMenuOpen] = useState(false);   // (เดิม) มือถือ: กางรายการหัวข้อตั้งค่า
  const [mobileDetail, setMobileDetail] = useState(false);  // มือถือ: false = โชว์ลิสต์เมนู (แบบหน้าโฮม), true = เข้าไปดูเนื้อหาหัวข้อ
  // ถ้าหัวข้อปัจจุบันไม่มีสิทธิ์เข้า → เด้งไปหัวข้อแรกที่เข้าได้
  useEffect(() => { if (visibleSections.length && !visibleSections.some((s) => s.key === section)) setSection(visibleSections[0].key); }, [allowedSettings]);
  const [campaignDefaults, setCampaignDefaults] = useState(settings.campaign_defaults || {});
  const [thresholds, setThresholds] = useState(settings.optimization_thresholds || {});
  const [brandVoice, setBrandVoice] = useState(settings.brand_voice || {});
  const [brandConfig, setBrandConfig] = useState(() => normalizeBrandConfig(settings.brand_assets));
  const [ghost, setGhost] = useState(
    settings.ghost_protection || { enabled: true, exclude_audience_network: true, min_conversations: 10, min_reply_rate: 0.4, action: "alert" }
  );
  const [aiModels, setAiModels] = useState(
    settings.ai_models || { content_text: "openai", image: "gpt-image-1", analyze_ads: "openai", analyze_settings: "openai" }
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError("");
    const now = new Date().toISOString();
    const rowsBySection = {
      campaign: [{ key: "campaign_defaults", value: campaignDefaults, updated_at: now }],
      decision: [{ key: "optimization_thresholds", value: thresholds, updated_at: now }],
      brand: [
        { key: "brand_voice", value: brandVoice, updated_at: now },
        { key: "brand_assets", value: brandConfig, updated_at: now },
      ],
      ai_models: [{ key: "ai_models", value: aiModels, updated_at: now }],
      ghost: [{ key: "ghost_protection", value: ghost, updated_at: now }],
    };
    const rows = rowsBySection[cur?.key] || [];
    const results = await Promise.all(rows.map((row) => supabase.from("settings").upsert(row)));
    setSaving(false);
    const error = results.find((result) => result.error)?.error;
    if (error) { setSaveError(error.message); return; }
    setSaved(true);
    onSaved?.();
  }

  function handleAiApplied(applied) {
    // Edge Function เซฟลง DB ให้เรียบร้อยแล้ว — ตรงนี้แค่ sync state ฝั่งหน้าเว็บให้ตรงกับสิ่งที่บันทึกไปจริง
    // เพื่อให้แอดมินเห็นค่าที่ AI ตั้งให้ทันที และแก้ต่อแบบ custom ได้ถ้าต้องการ
    if (applied?.campaign_defaults) setCampaignDefaults(applied.campaign_defaults);
    if (applied?.optimization_thresholds) setThresholds(applied.optimization_thresholds);
    if (applied?.brand_voice) setBrandVoice(applied.brand_voice);
    onSaved?.();
  }

  const selectedBrandId = brandConfig.active_brand_id || brandConfig.brands[0]?.id || "default";
  const selectedBrand = brandConfig.brands.find((brand) => brand.id === selectedBrandId) || brandConfig.brands[0];
  const brandAssets = selectedBrand?.assets || {};

  function setBrandAssets(nextAssets) {
    if (!selectedBrand) return;
    setBrandConfig((current) => ({
      ...current,
      active_brand_id: selectedBrand.id,
      brands: current.brands.map((brand) => brand.id === selectedBrand.id ? { ...brand, assets: nextAssets } : brand),
    }));
  }

  function selectBrand(brandId) {
    setBrandConfig((current) => ({ ...current, active_brand_id: brandId }));
  }

  function addBrand() {
    const id = `brand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setBrandConfig((current) => ({
      ...current,
      active_brand_id: id,
      brands: [...current.brands, { id, name: `แบรนด์ ${current.brands.length + 1}`, assets: {} }],
    }));
  }

  function renameSelectedBrand(name) {
    setBrandConfig((current) => ({
      ...current,
      brands: current.brands.map((brand) => brand.id === selectedBrandId ? { ...brand, name } : brand),
    }));
  }

  function removeSelectedBrand() {
    if (!selectedBrand || brandConfig.brands.length <= 1) return;
    if (!window.confirm(`ลบการตั้งค่า CI ของ “${selectedBrand.name}” ใช่หรือไม่`)) return;
    setBrandConfig((current) => {
      const brands = current.brands.filter((brand) => brand.id !== selectedBrand.id);
      return { ...current, active_brand_id: brands[0].id, brands };
    });
  }

  function field(obj, setObj, key, label, type = "text") {
    return (
      <div>
        <label className="text-sm text-slate-600">{label}</label>
        <input
          type={type}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={obj[key] ?? ""}
          onChange={(e) => setObj({ ...obj, [key]: type === "number" ? parseFloat(e.target.value) : e.target.value })}
        />
      </div>
    );
  }

  const cur = visibleSections.find((s) => s.key === section) || visibleSections[0];
  if (!cur) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">ยังไม่ได้รับสิทธิ์เข้าถึงหัวข้อย่อยในหน้าตั้งค่า</div>;
  }

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* แถบเมนูตั้งค่า — มือถือ: โชว์เป็นลิสต์เหมือนหน้าโฮม (ซ่อนเมื่อเข้าไปดูหัวข้อ) */}
      <div className={`md:w-60 shrink-0 ${mobileDetail ? "hidden md:block" : "block"}`}>
        {/* มือถือ: ลิสต์หัวข้อแนวตั้งแบบเมนูหน้าโฮม แตะเพื่อเข้าไปดูเนื้อหา */}
        <nav className="md:hidden flex flex-col gap-0.5 bg-white rounded-2xl border border-slate-200 p-2">
          {visibleSections.map((s) => (
            <button
              key={s.key}
              onClick={() => { setSection(s.key); setMobileDetail(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="flex items-center gap-2.5 px-3 py-3 rounded-xl text-sm font-medium text-left text-slate-700 hover:bg-slate-100"
            >
              <s.icon size={18} className="shrink-0 text-slate-500" />
              <span className="truncate flex-1">{s.label}</span>
              <ChevronDown size={16} className="-rotate-90 text-slate-300 shrink-0" />
            </button>
          ))}
        </nav>

        {/* เดสก์ท็อป: รายการแนวตั้งติดขอบจอ */}
        <div className="hidden md:flex md:flex-col gap-1 bg-white rounded-2xl border border-slate-200 p-2 md:sticky md:top-24">
          {visibleSections.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap text-left shrink-0 ${
                section === s.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <s.icon size={16} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* เนื้อหาของหมวดที่เลือก — มือถือโชว์เฉพาะตอนเข้าไปในหัวข้อ (มีปุ่มย้อนกลับ) */}
      <div className={`flex-1 min-w-0 space-y-6 ${mobileDetail ? "block" : "hidden md:block"}`}>
        {/* มือถือ: ปุ่มย้อนกลับไปลิสต์เมนู + ชื่อหัวข้อปัจจุบัน */}
        <button
          onClick={() => { setMobileDetail(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="md:hidden flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 -mb-2"
        >
          <ChevronDown size={18} className="rotate-90 shrink-0" />
          <span>ตั้งค่า</span>
          {cur && <span className="text-slate-400">/ {cur.label}</span>}
        </button>
      {section === "general" && (
        <AiAssistPanel
          onApplied={handleAiApplied}
          initialAnalysis={settings.ai_analysis}
          initialLaunchConfig={settings.launch_config}
          onConfigApplied={onSaved}
          defaultModel={settings.ai_models?.analyze_settings || "openai"}
        />
      )}

      {section === "leadfields" && <PageLeadConfigPanel />}
      {section === "synccfg" && <ChatSyncConfigPanel />}
      {section === "notifications" && <PushNotificationPanel />}
      {section === "jobs" && <ScheduledJobsPanel />}
      {section === "prefetch" && <InsightsPrefetchPanel />}
      {section === "savedreplies" && <SavedRepliesPanel allowedPages={allowedPages} />}
      {section === "knowledge" && <KnowledgeBasePanel allowedPages={allowedPages} />}
      {section === "ai_prompts" && <AiPromptsPanel />}
      {section === "meta" && <MetaTokenPanel />}
      {section === "line" && <LineOAPanel />}
      {section === "permissions" && <PermissionsPanel />}
      {section === "tv_settings" && <TvAdminSettingsPanel />}
      {section === "replystats" && <ReplyStatsPanel onOpenChat={onOpenChat} />}
      {section === "leaderboard" && <LeaderboardSettingsPanel />}
      {section === "activity" && <ActivityPanel />}

      {section === "campaign" && (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-800">ค่าเริ่มต้นแคมเปญ (Meta)</h3>
        {field(campaignDefaults, setCampaignDefaults, "ad_account_id", "Ad Account ID (ไม่ต้องมี act_ นำหน้า)")}
        {field(campaignDefaults, setCampaignDefaults, "page_id", "Facebook Page ID")}
        {field(campaignDefaults, setCampaignDefaults, "pixel_id", "Pixel ID")}
        {field(campaignDefaults, setCampaignDefaults, "audience_id", "Custom/Lookalike Audience ID (เว้นว่างได้ถ้ายังไม่มี — จะยิงแบบกว้างแทน)")}
        {field(campaignDefaults, setCampaignDefaults, "age_min", "อายุขั้นต่ำ (ใช้เมื่อยังไม่มี Audience ID)", "number")}
        {field(campaignDefaults, setCampaignDefaults, "age_max", "อายุสูงสุด (ใช้เมื่อยังไม่มี Audience ID)", "number")}
        <div>
          <label className="text-sm text-slate-600">ความสนใจ/พฤติกรรม (Interests targeting)</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(campaignDefaults.interests || []).length === 0 ? (
              <span className="text-xs text-slate-400">
                ยังไม่มี — ระบบจะหาให้อัตโนมัติจากช่อง "กลุ่มเป้าหมาย" ทุกครั้งที่กดสร้างคอนเทนต์ในแท็บ "สร้างคอนเทนต์"
              </span>
            ) : (
              campaignDefaults.interests.map((i) => (
                <span key={i.id} className="text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-1">
                  {i.name}
                </span>
              ))
            )}
          </div>
        </div>
        {field(campaignDefaults, setCampaignDefaults, "landing_url", "Landing Page URL")}
        {field(campaignDefaults, setCampaignDefaults, "daily_budget_thb", "งบเริ่มต้น/วัน (บาท)", "number")}
      </div>
      )}

      {section === "decision" && (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-800">เกณฑ์การตัดสินใจอัตโนมัติ</h3>
        {field(thresholds, setThresholds, "target_cpa_thb", "เป้า CPA (บาท)", "number")}
        {field(thresholds, setThresholds, "min_spend_before_judging_thb", "Spend ขั้นต่ำก่อนตัดสิน (บาท)", "number")}
        {field(thresholds, setThresholds, "underperform_multiplier", "ตัวคูณ underperform (เช่น 1.5)", "number")}
        {field(thresholds, setThresholds, "outperform_multiplier", "ตัวคูณ outperform (เช่น 0.7)", "number")}
        {field(thresholds, setThresholds, "scale_up_pct", "% เพิ่มงบเมื่อผลดี", "number")}
      </div>
      )}

      {section === "brand" && (<>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">จัดการแบรนด์ CI</h3>
          <p className="text-xs text-slate-500 mt-1">แยกโลโก้ ริบบิ้น และสไตล์ภาพของแต่ละแบรนด์ แล้วเลือกใช้แบรนด์ที่ต้องการได้ในหน้าสร้างคอนเทนต์</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={selectedBrandId}
            onChange={(e) => selectBrand(e.target.value)}
          >
            {brandConfig.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
          <button type="button" onClick={addBrand} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            <Plus size={15} /> เพิ่มแบรนด์
          </button>
          <button type="button" onClick={removeSelectedBrand} disabled={brandConfig.brands.length <= 1} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40">
            ลบแบรนด์
          </button>
        </div>
        <div>
          <label className="text-sm text-slate-600">ชื่อแบรนด์</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={selectedBrand?.name || ""}
            onChange={(e) => renameSelectedBrand(e.target.value)}
            placeholder="เช่น BeSight, AlphardVIP"
          />
        </div>
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">กำลังแก้ไข: {selectedBrand?.name || "-"} · กด “บันทึก” ด้านล่างเพื่อเก็บการตั้งค่า</div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-800">โทนแบรนด์ (ใช้เป็นค่าเริ่มต้นตอนสร้างคอนเทนต์)</h3>
        {field(brandVoice, setBrandVoice, "brand_voice", "โทนแบรนด์")}
        {field(brandVoice, setBrandVoice, "target_audience_desc", "กลุ่มเป้าหมาย")}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5">
        <div>
          <h3 className="font-semibold text-slate-800">โลโก้ / ป้ายริบบิ้นแบรนด์</h3>
          <p className="text-xs text-slate-500 mt-1">
            อัปโหลดไว้ครั้งเดียว ระบบจะซ้อนภาพนี้ลงบนรูปโฆษณาทุกรูปที่สร้างใหม่ตามตำแหน่งที่กำหนด
            (แนะนำไฟล์ PNG พื้นหลังโปร่งใส เพื่อความคมชัดตอนซ้อนภาพ)
          </p>
        </div>
        <BrandAssetUploader
          label="โลโก้แบรนด์"
          urlKey="logo_url"
          positionKey="logo_position"
          scaleKey="logo_scale_pct"
          assets={brandAssets}
          setAssets={setBrandAssets}
        />
        <BrandAssetUploader
          label="ป้ายริบบิ้น / Badge"
          urlKey="ribbon_url"
          positionKey="ribbon_position"
          scaleKey="ribbon_scale_pct"
          assets={brandAssets}
          setAssets={setBrandAssets}
        />
        <div>
          <label className="text-sm text-slate-600">หมายเหตุตำแหน่งเพิ่มเติม (ไม่บังคับ)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            placeholder="เช่น อยากให้โลโก้อยู่มุมขวาล่างเสมอ ห่างขอบนิดหน่อย ไม่บังข้อความในภาพ"
            value={brandAssets.placement_notes ?? ""}
            onChange={(e) => setBrandAssets({ ...brandAssets, placement_notes: e.target.value })}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">CI แบรนด์ (โทนสี / สไตล์ภาพ)</h3>
          <p className="text-xs text-slate-500 mt-1">
            อัปโหลดภาพตัวอย่างงานดีไซน์ของแบรนด์ (โปสเตอร์ โบรชัวร์ หรือรูปโฆษณาเก่า) แล้วให้ AI ช่วยสกัดเป็นคำอธิบายสี/สไตล์
            หรือพิมพ์อธิบายเองก็ได้ — ใช้เป็นแนวทางตอนสร้างรูปโฆษณาใหม่ให้เข้ากับ CI
          </p>
        </div>
        <CiStyleUploader assets={brandAssets} setAssets={setBrandAssets} />
      </div>
      </>)}

      {section === "ai_models" && (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">โมเดล AI เริ่มต้นของแต่ละงาน</h3>
          <p className="text-xs text-slate-500 mt-1">เลือกว่าจะใช้ AI ตัวไหนเป็นค่าเริ่มต้นในแต่ละงาน (ปรับเฉพาะครั้งได้ในหน้านั้นๆ)</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-600">เขียนคอนเทนต์</label>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={aiModels.content_text} onChange={(e) => setAiModels({ ...aiModels, content_text: e.target.value })}>
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">สร้างรูป</label>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={aiModels.image} onChange={(e) => setAiModels({ ...aiModels, image: e.target.value })}>
              <option value="gpt-image-1">GPT Image 1</option>
              <option value="gpt-image-2">GPT Image 2 (ล่าสุด)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">วิเคราะห์ ads</label>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={aiModels.analyze_ads} onChange={(e) => setAiModels({ ...aiModels, analyze_ads: e.target.value })}>
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">วิเคราะห์+ตั้งค่าแคมเปญ</label>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={aiModels.analyze_settings} onChange={(e) => setAiModels({ ...aiModels, analyze_settings: e.target.value })}>
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
          </div>
        </div>
      </div>

      )}

      {section === "ghost" && (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">ป้องกันแชทผี (Ghost chats)</h3>
          <p className="text-xs text-slate-500 mt-1">
            กันแชทผี/ลีดขยะ (บอท, มิสคลิก, ทักแล้วเงียบ) — ตัด Audience Network ตอนลอนช์ และเฝ้าดูอัตราการตอบกลับ ถ้าต่ำผิดปกติจะแจ้งเตือนให้อนุมัติหยุด
          </p>
        </div>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-700">เปิดฟีเจอร์ป้องกันแชทผี</span>
          <input type="checkbox" checked={!!ghost.enabled} onChange={(e) => setGhost({ ...ghost, enabled: e.target.checked })} className="w-4 h-4" />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-700">ตัด Audience Network ตอนลอนช์ (แนะนำ)</span>
          <input type="checkbox" checked={!!ghost.exclude_audience_network} onChange={(e) => setGhost({ ...ghost, exclude_audience_network: e.target.checked })} className="w-4 h-4" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-sm text-slate-600">แชทขั้นต่ำก่อนตัดสิน</label>
            <NumInput min={0}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={ghost.min_conversations ?? 10}
              onChange={(n) => setGhost({ ...ghost, min_conversations: n })}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">อัตราตอบขั้นต่ำ (%)</label>
            <NumInput min={0} max={100}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={Math.round((ghost.min_reply_rate ?? 0.4) * 100)}
              onChange={(n) => setGhost({ ...ghost, min_reply_rate: n / 100 })}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">เมื่อพบแชทผี</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={ghost.action || "alert"}
              onChange={(e) => setGhost({ ...ghost, action: e.target.value })}
            >
              <option value="alert">แจ้งเตือนรออนุมัติ</option>
              <option value="auto_pause">หยุดอัตโนมัติ</option>
            </select>
          </div>
        </div>
      </div>
      )}

      {cur?.form && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-slate-900 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : null}
            บันทึกตั้งค่า
          </button>
          {saved && <span className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">บันทึกแล้ว</span>}
          {saveError && <span className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{saveError}</span>}
        </div>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// ระยะสถานะลูกค้า
// ---------------------------------------------------------------
const CHAT_STAGES = [
  { key: "new", label: "มาใหม่", cls: "bg-sky-100 text-sky-700" },
  { key: "qualified", label: "มีคุณสมบัติ", cls: "bg-amber-100 text-amber-700" },
  { key: "converted", label: "สร้างคอนเวอร์ชั่นแล้ว", cls: "bg-emerald-100 text-emerald-700" },
  { key: "account_opened", label: "ลูกค้าเปิดบัญชีใหม่", cls: "bg-indigo-100 text-indigo-700" },
  { key: "disqualified", label: "ไม่มีคุณสมบัติ", cls: "bg-rose-100 text-rose-700" },
];
// ช่องแก้ไขในตารางแบบ inline — ดูเหมือนข้อความ พอคลิก/โฟกัสถึงเป็นช่องกรอก บันทึกอัตโนมัติเมื่อออกจากช่อง
function EditableCell({ row, field, onSaved, numeric }) {
  const [val, setVal] = useState(row[field] || "");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setVal(row[field] || ""); }, [row.id, row[field]]);
  async function save() {
    const nv = val.trim() || null;
    if (nv === (row[field] || null)) return;
    const { error } = await supabase.from("chat_customers").update({ [field]: nv, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) { setVal(row[field] || ""); return; }
    onSaved?.(row.id, { [field]: nv });
    setSaved(true); setTimeout(() => setSaved(false), 1000);
  }
  return (
    <input
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setVal(row[field] || ""); e.currentTarget.blur(); } }}
      inputMode={numeric ? "numeric" : undefined}
      placeholder="—"
      title="คลิกเพื่อแก้ไข"
      className={`w-full min-w-0 rounded px-1.5 py-0.5 text-[11px] bg-transparent border ${saved ? "border-emerald-400 bg-emerald-50" : "border-transparent hover:border-slate-300 focus:border-slate-400 focus:bg-white"}`}
    />
  );
}
// ค่าเริ่มต้นของ "แท็กสรุปจากแอดมิน" — prefix ที่ระบบใช้ parse (แก้ได้ในหน้าตั้งค่า)

// จัดการ "ข้อความบันทึกไว้" (canned replies) — เพิ่ม/แก้/ลบ + แนบรูป
function SavedRepliesPanel({ allowedPages = null }) {
  const [items, setItems] = useState(null);
  const [pages, setPages] = useState([]);
  const [saving, setSaving] = useState("");
  const pageOk = (id) => !allowedPages || allowedPages.includes(String(id));
  async function load() {
    const { data } = await supabase.from("saved_replies").select("*").order("sort").order("created_at");
    // จำกัดสิทธิ์: เห็นเฉพาะข้อความกลาง (ทุกเพจ) + ข้อความของเพจที่ตัวเองมีสิทธิ์
    setItems((data || []).filter((r) => !r.page_id || pageOk(r.page_id)));
  }
  useEffect(() => {
    load();
    supabase.from("page_lead_config").select("page_id, page_name").order("page_name").then(({ data }) =>
      setPages((data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })).filter((p) => pageOk(p.id))));
  }, []);
  const addNew = () => setItems((it) => [{ _new: true, tmp: Date.now(), title: "", message: "", image_url: null, page_id: null }, ...(it || [])]);
  const setField = (idx, k, v) => setItems((it) => it.map((x, i) => (i === idx ? { ...x, [k]: v } : x)));
  async function uploadImg(idx, file) {
    if (!file) return;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `saved/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
    if (error) { alert("อัปโหลดรูปไม่สำเร็จ: " + error.message); return; }
    setField(idx, "image_url", supabase.storage.from("chat-media").getPublicUrl(path).data.publicUrl);
  }
  async function save(idx) {
    const it = items[idx];
    if (!it.message?.trim() && !it.image_url) { alert("ต้องมีข้อความหรือรูปอย่างน้อยอย่างหนึ่ง"); return; }
    setSaving(it.id || it.tmp);
    const payload = { page_id: it.page_id || null, title: it.title || null, message: it.message || "", image_url: it.image_url || null, updated_at: new Date().toISOString() };
    if (it.id) await supabase.from("saved_replies").update(payload).eq("id", it.id);
    else await supabase.from("saved_replies").insert(payload);
    setSaving(""); load();
  }
  async function del(idx) {
    const it = items[idx];
    if (it.id) { if (!window.confirm("ลบข้อความนี้?")) return; await supabase.from("saved_replies").delete().eq("id", it.id); }
    setItems((list) => list.filter((_, i) => i !== idx));
  }
  if (!items) return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"><Spinner label="กำลังโหลด..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-800">ข้อความบันทึกไว้</h3>
          <p className="text-xs text-slate-500 mt-0.5">ข้อความสำเร็จรูปสำหรับกดใช้ในหน้า "ตอบแชท" (แนบรูปได้) · เลือกได้ว่าใช้ทุกเพจหรือเฉพาะเพจ</p>
        </div>
        <button onClick={addNew} className="bg-slate-900 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-800">+ เพิ่มใหม่</button>
      </div>
      {items.length === 0 && <div className="text-sm text-slate-400 py-6 text-center">ยังไม่มีข้อความบันทึกไว้ — กด "เพิ่มใหม่"</div>}
      <div className="space-y-3">
        {items.map((it, idx) => (
          <div key={it.id || it.tmp} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={it.title || ""} onChange={(e) => setField(idx, "title", e.target.value)} placeholder="หัวข้อ (เช่น ทักทาย, ราคา, วิธีสมัคร)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <select value={it.page_id || ""} onChange={(e) => setField(idx, "page_id", e.target.value || null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
                <option value="">ทุกเพจ</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <textarea rows={3} value={it.message || ""} onChange={(e) => setField(idx, "message", e.target.value)} placeholder="ข้อความ..." className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="flex items-center gap-3 flex-wrap">
              {it.image_url && <img src={it.image_url} alt="" className="w-14 h-14 rounded object-cover border border-slate-200" />}
              <label className="text-xs text-indigo-600 hover:underline cursor-pointer">{it.image_url ? "เปลี่ยนรูป" : "แนบรูป"}<input type="file" accept="image/*" className="hidden" onChange={(e) => uploadImg(idx, e.target.files?.[0])} /></label>
              {it.image_url && <button onClick={() => setField(idx, "image_url", null)} className="text-xs text-rose-500 hover:underline">ลบรูป</button>}
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => del(idx)} className="text-xs text-rose-600 hover:underline">ลบ</button>
                <button onClick={() => save(idx)} disabled={saving === (it.id || it.tmp)} className="bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-indigo-700 disabled:opacity-60">{saving === (it.id || it.tmp) ? "กำลังบันทึก..." : "บันทึก"}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeBasePanel({ allowedPages = null }) {
  const [items, setItems] = useState(null);
  const [approvedItems, setApprovedItems] = useState(null);
  const [approvedSearch, setApprovedSearch] = useState("");
  const [approvedPage, setApprovedPage] = useState("");
  const [approvedPageNumber, setApprovedPageNumber] = useState(1);
  const [approvedPageSize, setApprovedPageSize] = useState(10);
  const [approvedTotal, setApprovedTotal] = useState(0);
  const [expandedApproved, setExpandedApproved] = useState(null);
  const [pages, setPages] = useState([]);
  const [draft, setDraft] = useState({ page_id: "", question: "", answer: "" });
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState("");
  async function load() {
    setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "list", status: "pending" } });
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "โหลดไม่สำเร็จ"); setItems([]); return; }
    setItems(data.items || []);
  }
  async function loadApproved(search = approvedSearch, pageId = approvedPage, page = approvedPageNumber, pageSize = approvedPageSize) {
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "list", status: "approved", q: search, page_id: pageId || null, page, page_size: pageSize } });
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "โหลดรายการที่ใช้งานอยู่ไม่สำเร็จ"); setApprovedItems([]); return; }
    setApprovedItems(data.items || []);
    setApprovedTotal(data.total || 0);
  }
  useEffect(() => {
    load();
    supabase.from("page_lead_config").select("page_id, page_name").order("page_name").then(({ data, error }) => {
      if (error) { setMsg(error.message || "โหลดรายชื่อเพจไม่สำเร็จ"); return; }
      const allowed = allowedPages ? new Set(allowedPages.map(String)) : null;
      const options = (data || [])
        .map((p) => ({ id: String(p.page_id), name: p.page_name || p.page_id }))
        .filter((p) => !allowed || allowed.has(p.id));
      setPages(options);
      setDraft((current) => current.page_id || !options[0] ? current : { ...current, page_id: options[0].id });
    });
  }, [allowedPages]);
  useEffect(() => {
    const timer = setTimeout(() => loadApproved(approvedSearch, approvedPage, approvedPageNumber, approvedPageSize), 250);
    return () => clearTimeout(timer);
  }, [approvedSearch, approvedPage, approvedPageNumber, approvedPageSize]);
  const edit = (id, key, value) => setItems((rows) => rows.map((r) => r.id === id ? { ...r, [key]: value } : r));
  const editApproved = (id, key, value) => setApprovedItems((rows) => rows.map((r) => r.id === id ? { ...r, [key]: value } : r));
  async function createManual() {
    if (!draft.page_id || !draft.question.trim() || !draft.answer.trim()) { setMsg("กรุณาเลือกเพจและกรอกคำค้นกับคำตอบให้ครบ"); return; }
    setSaving("manual"); setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "create", ...draft } });
    setSaving("");
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "เพิ่มคำตอบไม่สำเร็จ"); return; }
    setDraft((current) => ({ ...current, question: "", answer: "" }));
    setMsg(data.merged ? "พบคำตอบเดิม จึงเพิ่มคำค้นเข้า Keywords ของรายการเดิมแล้ว ✓" : "เพิ่มเข้าคลังและอนุมัติพร้อมใช้งานแล้ว ✓");
    setApprovedPageNumber(1);
    loadApproved(approvedSearch, approvedPage, 1, approvedPageSize);
  }
  async function review(item, status) {
    setSaving(item.id); setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "review", id: item.id, status, question: item.question, answer: item.answer } });
    setSaving("");
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "บันทึกไม่สำเร็จ"); return; }
    setItems((rows) => rows.filter((r) => r.id !== item.id));
    if (status === "approved") {
      setApprovedPageNumber(1);
      loadApproved(approvedSearch, approvedPage, 1, approvedPageSize);
    }
  }
  async function saveApproved(item) {
    if (!item.question.trim() || !item.answer.trim()) { setMsg("คำค้นและคำตอบต้องไม่ว่าง"); return; }
    setSaving(item.id); setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "review", id: item.id, status: "approved", question: item.question, answer: item.answer } });
    setSaving("");
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "บันทึกการแก้ไขไม่สำเร็จ"); return; }
    setMsg("บันทึกการแก้ไขแล้ว ✓");
    loadApproved(approvedSearch, approvedPage, approvedPageNumber, approvedPageSize);
  }
  async function deleteApproved(item) {
    if (!window.confirm(`ลบคำค้นนี้ออกจากคลัง?\n\n${item.question}`)) return;
    setSaving(item.id); setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "delete", id: item.id } });
    setSaving("");
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "ลบไม่สำเร็จ"); return; }
    setExpandedApproved((id) => id === item.id ? null : id);
    if ((approvedItems || []).length === 1 && approvedPageNumber > 1) setApprovedPageNumber((page) => page - 1);
    else loadApproved(approvedSearch, approvedPage, approvedPageNumber, approvedPageSize);
    setMsg("ลบรายการแล้ว ✓");
  }
  const pageNameById = new Map(pages.map((page) => [page.id, page.name]));
  const approvedPageCount = Math.max(1, Math.ceil(approvedTotal / approvedPageSize));
  const approvedPageButtons = (() => {
    if (approvedPageCount <= 7) return Array.from({ length: approvedPageCount }, (_, index) => index + 1);
    const buttons = [1];
    if (approvedPageNumber > 3) buttons.push("left-gap");
    for (let page = Math.max(2, approvedPageNumber - 1); page <= Math.min(approvedPageCount - 1, approvedPageNumber + 1); page += 1) buttons.push(page);
    if (approvedPageNumber < approvedPageCount - 2) buttons.push("right-gap");
    buttons.push(approvedPageCount);
    return buttons;
  })();
  if (items === null) return <div className="bg-white rounded-2xl border border-slate-200 p-5"><Spinner label="กำลังโหลดคลังคำตอบ..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">คลังคำถาม–คำตอบ</h3>
        <p className="text-xs text-slate-500 mt-1">กำหนดคำค้นหรือวลีสำคัญหลายแบบให้คำตอบเดียว · คั่นแต่ละคำด้วยจุลภาคหรือขึ้นบรรทัดใหม่ · การค้นหาจะแยกตามเพจ</p>
      </div>
      <div className="knowledge-manual-card rounded-xl p-4 space-y-3">
        <div className="knowledge-manual-title font-medium text-sm">เพิ่มคำถาม–คำตอบเอง</div>
        <label className="knowledge-manual-label block text-xs">เพจ
          <select value={draft.page_id} onChange={(e) => setDraft({ ...draft, page_id: e.target.value })} className="knowledge-manual-field mt-1 w-full rounded-lg px-3 py-2 text-sm">
            <option value="">— เลือกเพจ —</option>
            {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
          </select>
        </label>
        <label className="knowledge-manual-label block text-xs">คำค้น / Keywords
          <textarea rows={2} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} placeholder="เช่น เปิดบัญชีเพิ่ม, เพิ่มบัญชี XM, มีบัญชีแล้วสมัครเพิ่ม" className="knowledge-manual-field mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          <span className="mt-1 block text-[10px] text-slate-400">ใส่ได้หลายคำหรือหลายวลี โดยคั่นด้วยจุลภาค (,) หรือขึ้นบรรทัดใหม่</span>
        </label>
        <label className="knowledge-manual-label block text-xs">คำตอบ
          <textarea rows={3} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} placeholder="กรอกคำตอบที่พนักงานสามารถนำไปใช้ได้" className="knowledge-manual-field mt-1 w-full rounded-lg px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end">
          <button onClick={createManual} disabled={saving === "manual" || !draft.page_id || !draft.question.trim() || !draft.answer.trim()} className="ds-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40">{saving === "manual" ? "กำลังเพิ่ม..." : "เพิ่มและอนุมัติใช้งาน"}</button>
        </div>
      </div>
      {msg && <div className={`text-xs ${msg.includes("✓") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</div>}
      <div className="flex items-center justify-between gap-3 pt-2">
        <h4 className="text-sm font-semibold text-slate-700">รายการรอตรวจสอบ</h4>
        <span className="text-xs text-slate-400">{items.length} รายการ</span>
      </div>
      {items.length === 0 && <div className="text-sm text-slate-400 text-center py-8">ไม่มีรายการรอตรวจสอบ</div>}
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="text-[11px] text-slate-400">เพจ {item.page_id} · {item.source || "Messenger"} · ผู้ตอบ {item.created_by || "ไม่ระบุ"}</div>
            <label className="block text-xs text-slate-500">คำค้น / Keywords<textarea rows={2} value={item.question} onChange={(e) => edit(item.id, "question", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" /></label>
            <label className="block text-xs text-slate-500">คำตอบ<textarea rows={3} value={item.answer} onChange={(e) => edit(item.id, "answer", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" /></label>
            <div className="flex justify-end gap-2">
              <button onClick={() => review(item, "rejected")} disabled={saving === item.id} className="rounded-lg border border-rose-200 text-rose-600 px-3 py-1.5 text-xs disabled:opacity-50">ไม่ใช้</button>
              <button onClick={() => review(item, "approved")} disabled={saving === item.id || !item.question.trim() || !item.answer.trim()} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs disabled:opacity-50">อนุมัติ</button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 pt-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-semibold text-slate-800">รายการคำถาม–คำตอบที่ใช้งานอยู่</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">เรียงตามตัวอักษร ก–ฮ และ A–Z · แก้ไขหรือลบได้</p>
          </div>
          <span className="text-xs text-slate-400">ทั้งหมด {approvedTotal.toLocaleString()} รายการ</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_auto] gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={approvedSearch} onChange={(e) => { setApprovedSearch(e.target.value); setApprovedPageNumber(1); }} placeholder="ค้นหาคำถามหรือคำตอบ..." className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm" />
          </div>
          <select value={approvedPage} onChange={(e) => { setApprovedPage(e.target.value); setApprovedPageNumber(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">ทุกเพจ</option>
            {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-500 whitespace-nowrap">แสดง
            <select value={approvedPageSize} onChange={(e) => { setApprovedPageSize(Number(e.target.value)); setApprovedPageNumber(1); }} className="bg-transparent text-sm font-medium text-slate-700 outline-none">
              {[5, 10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            รายการ
          </label>
        </div>
        {approvedItems === null ? <Spinner label="กำลังโหลดรายการที่ใช้งานอยู่..." /> : approvedItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">ไม่พบรายการที่ตรงกับการค้นหา</div>
        ) : (
          <div className="space-y-2">
            {approvedItems.map((item) => {
              const expanded = expandedApproved === item.id;
              return <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button type="button" onClick={() => setExpandedApproved(expanded ? null : item.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50">
                  <ChevronDown size={17} className={`shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{item.question}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-400">เพจ {pageNameById.get(String(item.page_id)) || item.page_id} · ใช้แล้ว {item.use_count || 0} ครั้ง</span>
                  </span>
                </button>
                {expanded && <div className="space-y-3 border-t border-slate-200 bg-slate-50/60 p-3">
                  <label className="block text-xs text-slate-500">คำค้น / Keywords
                    <textarea rows={2} value={item.question} onChange={(e) => editApproved(item.id, "question", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
                  </label>
                  <label className="block text-xs text-slate-500">คำตอบ
                    <textarea rows={4} value={item.answer} onChange={(e) => editApproved(item.id, "answer", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => deleteApproved(item)} disabled={saving === item.id} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">ลบทิ้ง</button>
                    <button onClick={() => saveApproved(item)} disabled={saving === item.id || !item.question.trim() || !item.answer.trim()} className="ds-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{saving === item.id ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}</button>
                  </div>
                </div>}
              </div>
            })}
          </div>
        )}
        {approvedTotal > 0 && <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-center text-xs text-slate-400 sm:text-left">แสดง {(approvedPageNumber - 1) * approvedPageSize + 1}–{Math.min(approvedPageNumber * approvedPageSize, approvedTotal)} จาก {approvedTotal.toLocaleString()}</span>
          <div className="flex flex-wrap items-center justify-center gap-1">
            <button type="button" aria-label="หน้าก่อนหน้า" onClick={() => setApprovedPageNumber((page) => Math.max(1, page - 1))} disabled={approvedPageNumber <= 1} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft size={15} /></button>
            {approvedPageButtons.map((page) => typeof page === "number" ? <button type="button" key={page} onClick={() => setApprovedPageNumber(page)} className={`min-w-8 rounded-lg border px-2 py-1.5 text-xs font-medium ${approvedPageNumber === page ? "border-amber-400 bg-amber-400 text-slate-950" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{page}</button> : <span key={page} className="px-1 text-xs text-slate-400">…</span>)}
            <button type="button" aria-label="หน้าถัดไป" onClick={() => setApprovedPageNumber((page) => Math.min(approvedPageCount, page + 1))} disabled={approvedPageNumber >= approvedPageCount} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight size={15} /></button>
          </div>
        </div>}
      </div>
    </div>
  );
}

const INBOX_LINE_OA_ENABLED = false; // พัก LINE OA ชั่วคราวโดยไม่ลบข้อมูล/การตั้งค่าเดิม
const INBOX_COMMENTS_ENABLED = false; // พักระบบ "ความคิดเห็น" (ซ่อนแท็บ + หยุดดึงความคิดเห็น) โดยไม่ลบข้อมูลเดิม
const MSG_REPLY_ENABLED = false;      // ซ่อนปุ่ม "ตอบกลับข้อความนี้" ชั่วคราว (ไม่ลบโค้ด)
const MSG_EMOJI_ENABLED = false;      // ซ่อนปุ่มอีโมจิในช่องตอบแชท ชั่วคราว (ไม่ลบโค้ด)

// หน้า "ตอบแชท" — Inbox สไตล์ Messenger + แปลไทยอัตโนมัติ + ส่งกลับเป็นภาษาลูกค้า
// allowedPages = จำกัดเพจที่เข้าถึงได้ (null = ทุกเพจ)
// การแจ้งเตือนแชทค้างอ่านทั้งหมด (เปิด/ปิด, กี่นาที, เพจไหน, เสียง) มาจากที่แอดมินตั้งให้รายคน
// ผู้ใช้ปรับเองไม่ได้และไม่เห็นปุ่มตั้งค่า — กันพนักงานปิดแจ้งเตือนเองแล้วแชทค้าง
function ChatInboxTab({ allowedPages = null, alertAllowed = true, alertMin = 3, alertPages = [], alertSound = true, alertNew = true, gotoChat = null, onGotoDone, active = true }) {
  const isInstagramComment = (row) => String(row?.id || "").startsWith("igc_");
  const isCommentChat = (row) => row?.source === "comment" || String(row?.id || "").startsWith("fbc_") || isInstagramComment(row);
  const normalizeChatSource = (row) => isCommentChat(row) && row?.source !== "comment" ? { ...row, source: "comment" } : row;
  const [list, setList] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);   // สลับดูแชทที่บล็อกไว้ (สแปม)
  const [blocking, setBlocking] = useState(false);
  const [selected, setSelected] = useState(null);      // full row (มี transcript)
  const [translations, setTranslations] = useState({});
  const [translating, setTranslating] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendPreview, setSendPreview] = useState(null); // { text, lang, sourceText, replyTo }
  const [sendMsg, setSendMsg] = useState("");
  const [q, setQ] = useState("");
  const [adSources, setAdSources] = useState([]);   // แอดที่ลูกค้าทักมา (หลายตัวได้)
  const [adLoading, setAdLoading] = useState(false);
  const [savedReplies, setSavedReplies] = useState([]);   // ข้อความตอบกลับที่บันทึกไว้ในเพจ
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedErr, setSavedErr] = useState("");
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeResults, setKnowledgeResults] = useState([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeErr, setKnowledgeErr] = useState("");
  const [messageMenu, setMessageMenu] = useState(null); // { index, text, img, mid, at, side } เมนูเมื่อคลิกข้อความลูกค้าหรือแอดมิน
  const [lightbox, setLightbox] = useState(null);       // URL รูปที่กดดูแบบขยายเต็มจอ (คลิกรูปในแชท)
  const [knowledgeCapture, setKnowledgeCapture] = useState(null); // { step, question, answer, answerIndex }
  const [knowledgeCaptureSaving, setKnowledgeCaptureSaving] = useState(false);
  const [knowledgeCaptureMsg, setKnowledgeCaptureMsg] = useState("");
  const savedCacheRef = useRef({});
  const [listTab, setListTab] = useState("all");    // all | line | comments
  const [messengerUnreadCount, setMessengerUnreadCount] = useState(0);
  const [commentUnreadCount, setCommentUnreadCount] = useState(0);
  const [lineUnreadCount, setLineUnreadCount] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);   // ไฟล์ที่พักไว้รอกดส่ง [{file,name,type,preview}]
  const [replyTo, setReplyTo] = useState(null);           // { text, img, mid, at, side } ข้อความ/รูปที่กำลัง reply อ้างอิง
  const [forceLang, setForceLang] = useState("auto");     // ภาษาที่แอดมินเลือกเอง (auto = ให้ AI ตรวจ)
  const fileInputRef = useRef(null);
  const loadRef = useRef(() => {});
  const openRef = useRef(() => {});
  const bottomRef = useRef(null);
  const [highlightAt, setHighlightAt] = useState(null);   // เวลาของข้อความที่ต้องเลื่อนไปหา+ไฮไลต์
  const highlightAtRef = useRef(null);                    // ใช้กันไม่ให้ตัวเลื่อนลงล่างสุดมาแย่งจังหวะ
  const selRef = useRef(null);
  const [pageOptions, setPageOptions] = useState([]);      // เพจทั้งหมดที่เชื่อมได้
  const [pagePics, setPagePics] = useState({});            // รูปโปรไฟล์เพจ { page_id: url } — ดึงจาก cache กลาง (page-pictures) แทนโหลดตรงจาก graph ทีละรูป
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [pageSel, setPageSel] = useState({ mode: "multi", single: null, multi: [] });  // เลือกเพจเดียว/หลายเพจ
  const pageSelRef = useRef(pageSel);   // ให้ตัวเช็คแจ้งเตือน (ที่รันทุก 30 วิ) อ่านค่าล่าสุดได้โดยไม่ต้อง re-subscribe
  const commentSubscriptionCheckedRef = useRef(false); // กันทุกแท็บ/ทุกการ render สั่งสร้าง webhook + ไล่ดึง ads ซ้ำ
  const listSeqRef = useRef(0);   // เลขลำดับคำขอโหลดลิสต์ (กัน response เก่าทับใหม่)
  const listLoadRef = useRef(null); // รวมคำขอซ้ำที่ใช้ตัวกรองเดียวกัน ไม่ยิง Supabase ซ้อน
  const listRef = useRef(null);
  const latestListKeyRef = useRef("");
  const queuedListLoadRef = useRef(false);
  const listFilterRef = useRef(null); // Realtime ต้องอ่านตัวกรองล่าสุดโดยไม่ต้องสร้าง channel ใหม่
  const pageOptionsRef = useRef([]);
  const unreadRefreshTimerRef = useRef(null);
  const transcriptRefreshTimerRef = useRef(null);
  const focusRefreshAtRef = useRef(0);
  const syncGuardRef = useRef({ inFlight: new Map(), lastRun: new Map() });
  const openRequestRef = useRef({ seq: 0, controller: null });
  const adSourceCacheRef = useRef(new Map());
  const [labelMsg, setLabelMsg] = useState(null);   // ผลการส่งป้ายไป Meta {type: loading|ok|err, text}
  const [overdueAlert, setOverdueAlert] = useState(null);   // { count, pages: [ชื่อเพจ] } → โชว์ popup
  // แจ้งเตือนระดับระบบปฏิบัติการ (เด้งทับแอปอื่น) — บังคับเปิดเสมอ ผู้ใช้ปิดเองไม่ได้
  // เหลืออย่างเดียวที่ต้องให้ผู้ใช้กดคือ "อนุญาต" ตอนแรก เพราะเบราว์เซอร์บังคับว่าต้องมาจากการคลิกของผู้ใช้
  const [notifPerm, setNotifPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "unsupported"));
  // iOS เปิดใน Safari (ยังไม่ได้เพิ่มหน้าจอโฮม) — Web Push ใช้ไม่ได้จนกว่าจะเปิดเป็น PWA
  const iosSafariNotStandalone = /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true);
  const notifiedRef = useRef({ ids: "", at: 0 });   // กันเด้งรัวซ้ำเรื่องเดิม

  // เสียงเตือนสั้นๆ (สร้างด้วย WebAudio ไม่ต้องมีไฟล์เสียง) — ต้องเคยคลิกในหน้าเว็บมาก่อนเบราว์เซอร์ถึงยอมเล่น
  function playPing() {
    if (!alertSound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const beep = (startAt, freq) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
        gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + 0.28);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + startAt); osc.stop(ctx.currentTime + startAt + 0.3);
      };
      beep(0, 880); beep(0.32, 1170);   // ตี๊ด-ต๊าด
      setTimeout(() => ctx.close().catch(() => {}), 1500);
    } catch { /* เล่นเสียงไม่ได้ก็ข้าม */ }
  }

  // ขออนุญาตแจ้งเตือน — ต้องเรียกจากการคลิกของผู้ใช้เท่านั้น (เบราว์เซอร์บังคับ)
  async function askNotifPermission() {
    // iOS: Web Push ใช้ได้เฉพาะใน PWA (เพิ่มหน้าจอโฮม) — Safari ปกติไม่มี Notification API
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
    if (typeof Notification === "undefined") {
      if (isIOS && !isStandalone) {
        alert("บน iPhone/iPad ต้องเปิดแอปจากไอคอนหน้าจอโฮมก่อน แจ้งเตือนถึงจะใช้ได้\n\nวิธีเพิ่ม: กดปุ่มแชร์ ⬆️ ด้านล่าง → เลื่อนหา \"เพิ่มไปยังหน้าจอโฮม\" → เปิดแอปจากไอคอนนั้น");
      } else {
        alert("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน");
      }
      return;
    }
    if (Notification.permission === "denied") {
      alert("การแจ้งเตือนถูกบล็อกไว้\n\nเปิดใหม่ได้ที่: กดไอคอนแม่กุญแจ 🔒 ข้างช่อง URL → การแจ้งเตือน → อนุญาต\nแล้วรีเฟรชหน้านี้");
      return;
    }
    const p = await Notification.requestPermission();
    setNotifPerm(p);
    if (p === "granted") {
      playPing();
      new Notification("เปิดแจ้งเตือนแล้ว ✅", { body: "จะเด้งเตือนแม้สลับไปแอปอื่น", tag: "test" });
      subscribePush();   // สมัคร Web Push ด้วย — เตือนได้แม้ปิดแท็บ (PWA)
    }
  }

  // ทดสอบส่ง push หาตัวเอง — บอกชัดว่าติดชั้นไหน (VAPID / subscription / delivery)
  const [pushTesting, setPushTesting] = useState(false);
  const [pushTestMsg, setPushTestMsg] = useState("");
  async function testPush() {
    setPushTesting(true); setPushTestMsg("");
    try {
      await subscribePush(true);   // เผื่อยังไม่เคย subscribe บนเครื่องนี้ ให้สมัครก่อน (โยน error ให้เห็นสาเหตุ)
      const { data, error } = await supabase.functions.invoke("send-push", { body: { action: "test" } });
      if (error) { setPushTestMsg("✗ เรียกฟังก์ชันไม่ได้: " + (await readFunctionErrorMessage(error))); return; }
      if (!data?.ok) { setPushTestMsg("✗ " + (data?.error || (data?.errors?.[0]) || "ส่งไม่สำเร็จ")); return; }
      setPushTestMsg(`✓ ส่งแล้ว ${data.sent}/${data.total} เครื่อง — รอสักครู่ควรเห็นแจ้งเตือนเด้ง`);
    } catch (e) { setPushTestMsg("✗ " + (e?.message || e)); }
    finally { setPushTesting(false); setTimeout(() => setPushTestMsg(""), 15000); }
  }

  // ตรวจระบบแจ้งเตือน (admin) — ชี้ชั้นที่ติด
  const [pushDiag, setPushDiag] = useState(null);
  async function runPushDiag() {
    setPushDiag("loading");
    const { data, error } = await supabase.functions.invoke("send-push", { body: { action: "diag" } });
    if (error || !data?.ok) { setPushDiag(null); alert("ตรวจไม่สำเร็จ: " + (data?.error || (error ? await readFunctionErrorMessage(error) : ""))); return; }
    setPushDiag(data);
  }

  // ---- Web Push: สมัครรับแจ้งเตือนแม้ปิดแท็บแอป (ต้องมี service worker + VAPID) ----
  // throwErr = true → โยน error ออกไปให้ปุ่มทดสอบแสดงสาเหตุ (ปกติเรียกแบบเงียบตอนเปิดแอป)
  async function subscribePush(throwErr = false) {
    try {
      if (location.protocol !== "https:") throw new Error("ต้องเปิดผ่าน https (Web Push ใช้บน http/localhost ไม่ได้)");
      if (!("serviceWorker" in navigator)) throw new Error("เบราว์เซอร์นี้ไม่รองรับ Service Worker");
      if (!("PushManager" in window)) throw new Error("เบราว์เซอร์นี้ไม่รองรับ Push (iOS ต้องเพิ่มเป็นแอปหน้าจอโฮมก่อน)");
      const reg = await navigator.serviceWorker.ready;
      const { data: vk } = await supabase.functions.invoke("send-push", { body: { action: "vapid_public" } });
      if (!vk?.ok || !vk.key) throw new Error("backend ยังไม่มี VAPID public key (ตั้ง secret + deploy send-push แล้วหรือยัง)");
      // แปลง base64url → Uint8Array
      const b64 = vk.key.replace(/-/g, "+").replace(/_/g, "/").padEnd(vk.key.length + (4 - (vk.key.length % 4)) % 4, "=");
      const appKey = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      // ส่ง config ให้ SW เก็บไว้ต่ออายุ push เอง (pushsubscriptionchange) ตอนแอปปิด
      try { reg.active?.postMessage({ type: "push-config", url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, vapidKey: vk.key }); } catch { /* ไม่กระทบการ subscribe */ }
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      // ขอบเขต push = "เพจที่เลือกดู" (ตรงกับการแจ้งเตือนในแอป) — ไม่เลือกเจาะจงค่อย fallback เป็นเพจที่ตั้งให้เตือน, ไม่มีเลย = ทุกเพจที่มีสิทธิ์
      const viewing = pageSel.mode === "single" ? (pageSel.single ? [pageSel.single] : []) : (pageSel.multi || []);
      const pushScope = viewing.length ? viewing : (Array.isArray(alertPages) && alertPages.length ? alertPages : []);
      const { data: sr, error: se } = await supabase.functions.invoke("send-push", { body: { action: "subscribe", subscription: sub.toJSON(), pages: pushScope, notify_new: alertNew !== false, device_id: getDeviceId() } });
      if (se || !sr?.ok) throw new Error("บันทึก subscription ไม่สำเร็จ: " + (sr?.error || (se ? await readFunctionErrorMessage(se) : "")));
      return true;
    } catch (e) {
      console.warn("push subscribe failed", e);
      if (throwErr) throw e;
      return false;
    }
  }
  // สมัคร push อัตโนมัติถ้าเคยอนุญาตไว้แล้ว + re-subscribe เมื่อเปลี่ยนเพจที่เลือก
  // (สำคัญ: server ยิง push ตาม sub.pages ที่เก็บไว้ → ต้องอัปเดตทุกครั้งที่ user เปลี่ยนเพจในหน้าตอบแชท
  //  ไม่งั้น push จะมาจากเพจอื่นที่ไม่ได้เลือก)
  useEffect(() => { if (alertAllowed && notifPerm === "granted") subscribePush(); /* eslint-disable-next-line */ },
    [alertAllowed, notifPerm, alertNew, pageSel.mode, pageSel.single, pageSel.multi.join(",")]);

  // ---- แจ้งเตือน "ข้อความใหม่ทันที" เมื่อลูกค้าทักเข้ามา (ต่างจาก "ค้างอ่านเกิน X นาที") ----
  const instantSeenRef = useRef({});   // กันเตือนซ้ำข้อความเดิม (คีย์ = chat id → เวลาข้อความล่าสุด)
  const instantNotifyRef = useRef(null);
  instantNotifyRef.current = (row) => {
    if (!alertAllowed) return;
    if (isCommentChat(row)) return;                     // ความคิดเห็นมีแท็บ/จุดแดงของตัวเอง ไม่ปนแจ้งเตือน Messenger
    if (!row?.unread) return;                          // อ่านแล้ว/ไม่ใช่ข้อความใหม่ = ไม่เตือน
    if (selRef.current?.id === row.id && (document.visibilityState === "visible" && document.hasFocus())) return; // เปิดแชทนี้ดูอยู่แล้ว
    // เพจอยู่ในขอบเขตที่ควรเตือนไหม (สิทธิ์ + เพจที่เลือกดู)
    const ps = pageSelRef.current;
    const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
    if (allowedPages && !allowedPages.includes(row.page_id)) return;
    if (viewing.length && !viewing.includes(row.page_id)) return;
    if (!viewing.length && alertPages.length && !alertPages.includes(row.page_id)) return;
    // กันเตือนซ้ำ: ข้อความล่าสุดของแชทนี้เตือนไปแล้ว
    const key = String(row.id);
    const stamp = String(row.last_message_at || "");
    if (instantSeenRef.current[key] === stamp) return;
    instantSeenRef.current[key] = stamp;

    const away = document.visibilityState !== "visible" || !document.hasFocus();
    const name = row.customer_name || "ลูกค้า";
    const text = (row.last_user_text || "ส่งข้อความใหม่").slice(0, 80);
    if (away && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const n = new Notification(`💬 ${name}${row.page_name ? ` · ${row.page_name}` : ""}`, {
          body: text, tag: `newmsg-${row.id}`, renotify: true, icon: "/icon-192.png",
        });
        n.onclick = () => { window.focus(); openChat({ id: row.id, customer_name: row.customer_name, page_id: row.page_id }); n.close(); };
      } catch { /* บางเบราว์เซอร์บล็อก */ }
    }
    playPing();
  };

  // ยิงแจ้งเตือนระบบ (เด้งทับแอปอื่น) — เรียกจากตัวเช็คด้านล่าง
  function fireOsNotification(count, pageNames) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const n = new Notification(`🔴 มี ${count} แชทค้างอ่านเกิน ${alertMin} นาที`, {
        body: pageNames.length ? `เพจ: ${pageNames.join(", ")}\nคลิกเพื่อเปิดกล่องข้อความ` : "คลิกเพื่อเปิดกล่องข้อความ",
        tag: "overdue-chat",        // ใช้ tag เดิม = แทนที่อันเก่า ไม่กองซ้อนกันเต็มจอ
        renotify: true,
        requireInteraction: true,   // ค้างบนจอจนกว่าจะกด (ไม่หายเองใน 5 วิ) — ใกล้เคียง "กล่องทับแอปอื่น" ที่สุด
      });
      n.onclick = () => { window.focus(); setListTab("all"); n.close(); };
    } catch { /* บางเบราว์เซอร์บล็อก constructor ตรงๆ */ }
  }
  // เช็คจาก DB ตรงทุก 30 วิ (ไม่ผูกกับฟิลเตอร์หน้าจอ): แชท "ยังไม่อ่าน" ค้างเกินเกณฑ์ ในเพจที่เลือกเตือน
  useEffect(() => {
    if (!alertAllowed) { setOverdueAlert(null); document.title = "AI Ads Automation"; return; }
    let stop = false;
    async function check() {
      const cutoff = new Date(Date.now() - alertMin * 60 * 1000).toISOString();
      let q = supabase.from("chat_customers")
        .select("id, page_id, page_name")
        // Messenger รุ่นเก่าบางแถวมี source=NULL; รวมเงื่อนไขไว้ใน OR เดียว
        // เพราะการต่อ .neq("source", "line") จะแอบตัด NULL ทิ้งตามกฎ SQL
        .eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,and(source.neq.comment,source.neq.line)").lte("last_message_at", cutoff).limit(100);
      // ข้อ 5: เตือนเฉพาะเพจที่ "user เลือกดูอยู่ในหน้าตอบแชท" ตอนนี้
      //   - เลือกเพจเดียว/หลายเพจ = เตือนเฉพาะเพจนั้น
      //   - ดูทุกเพจ = เตือนตามที่แอดมินตั้งให้ (alertPages) ไม่งั้นทุกเพจที่เข้าถึงได้
      const ps = pageSelRef.current;
      const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
      let pageScope;
      if (viewing.length) pageScope = viewing.filter((p) => !allowedPages || allowedPages.includes(p));
      else pageScope = alertPages.length ? alertPages.filter((p) => !allowedPages || allowedPages.includes(p)) : allowedPages;
      if (pageScope && pageScope.length === 0) {
        if (!stop) { setOverdueAlert(null); document.title = "AI Ads Automation"; }
        return;
      }
      if (pageScope) q = q.in("page_id", pageScope);
      const { data } = await q;
      if (stop) return;
      const rows = data || [];
      if (rows.length) {
        const pageNames = [...new Set(rows.map((r) => r.page_name || r.page_id))].slice(0, 4);
        // เก็บ page_id ไว้ด้วย — ใช้ตอนกด "ดูเลย" เพื่อสลับตัวกรองเพจไปยังเพจที่มีแชทค้าง
        // (เดิมกดแล้วไม่เห็นอะไร ถ้าแชทค้างอยู่คนละเพจกับที่กำลังเปิดดู)
        const pageIds = [...new Set(rows.map((r) => r.page_id).filter(Boolean))];
        // แชทค้างเหล่านี้อยู่นอกเพจที่กำลังกรองดูอยู่ไหม (ใช้ ref กันต้อง re-subscribe ทุกครั้งที่เปลี่ยนเพจ)
        const ps = pageSelRef.current;
        const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
        const outOfView = viewing.length > 0 && !pageIds.some((id) => viewing.includes(id));
        setOverdueAlert({ count: rows.length, pages: pageNames, pageIds, outOfView });
        document.title = `🔴 (${rows.length}) แชทค้างอ่านเกิน ${alertMin} นาที`;
        // ---- แจ้งเตือนระดับ OS: เด้งทับแอปอื่นเมื่อพนักงานไม่ได้อยู่ที่หน้านี้ ----
        // เงื่อนไขกันรำคาญ: เด้งเมื่อ (ก) มีแชทค้างรายใหม่ หรือ (ข) ยังค้างเหมือนเดิมแต่ผ่านไปแล้ว 5 นาที
        const idsKey = rows.map((r) => r.id).sort().join(",");
        const prev = notifiedRef.current;
        const isNew = idsKey !== prev.ids;
        const isStale = Date.now() - prev.at > 5 * 60 * 1000;
        const away = document.visibilityState !== "visible" || !document.hasFocus();
        if ((isNew || isStale) && away) {
          notifiedRef.current = { ids: idsKey, at: Date.now() };
          fireOsNotification(rows.length, pageNames);
          playPing();
        } else if (isNew) {
          // อยู่หน้านี้อยู่แล้ว เห็น popup ในแอป — เตือนแค่เสียง ไม่ต้องเด้งซ้อน
          notifiedRef.current = { ids: idsKey, at: Date.now() };
          playPing();
        }
      } else {
        setOverdueAlert(null);
        document.title = "AI Ads Automation";
        notifiedRef.current = { ids: "", at: 0 };   // เคลียร์หมดแล้ว → รอบหน้าถือเป็นเรื่องใหม่
      }
    }
    check();
    const iv = setInterval(check, 30 * 1000);
    return () => { stop = true; clearInterval(iv); document.title = "AI Ads Automation"; };
  }, [alertAllowed, alertMin, alertPages.join(","), allowedPages ? allowedPages.join(",") : "", pageSel.mode, pageSel.single, pageSel.multi.join(",")]);
  const [infoOpen, setInfoOpen] = useState(false);         // มือถือ: ขยายรายละเอียดแอด
  const [statusMenuOpen, setStatusMenuOpen] = useState(false); // มือถือ: เมนูแฮมเบอร์เกอร์ปรับสถานะ
  // รูปเพจ: ใช้ URL fbcdn ตรงเพจจาก cache กลางก่อน (เสถียร/ตรงเพจ) — ถ้ายังไม่มีค่อย fallback graph endpoint เดิม
  const pagePic = (id) => pagePics[id] || `https://graph.facebook.com/${id}/picture?type=square&width=96&height=96`;
  async function savePageSel(next) {
    setPageSel(next);
    // เก็บ "รายคน" (คีย์ผูกอีเมล) — ไม่ใช้คีย์กลางร่วมกัน กันพนักงานทับตัวเลือกของ admin และกลับกัน
    const { data: u } = await supabase.auth.getUser();
    const key = u?.user?.email ? `inbox_page_filter:${u.user.email}` : "inbox_page_filter";
    const { error } = await supabase.from("settings").upsert({ key, value: next, updated_at: new Date().toISOString() });
    if (error) { setSendMsg("บันทึกเพจที่เลือกไม่สำเร็จ: " + error.message); return; }
    // ซิงก์ scope ฝั่ง Meta + แผนที่ post→ad; webhook ยังตรวจ scope ซ้ำอีกชั้นก่อนบันทึก
    const { data: sync, error: syncErr } = await supabase.functions.invoke("subscribe-webhook", { body: { action: "sync_comments", force: true } });
    if (syncErr || !sync?.ok) setSendMsg("บันทึกเพจแล้ว แต่เปิดรับคอมเมนต์ไม่สำเร็จ: " + (sync?.error || syncErr?.message || ""));
    else setSendMsg(`เปิดรับคอมเมนต์ Ads แบบเรียลไทม์ ${sync.selected_comment_pages?.length || 0} เพจแล้ว ✓`);
  }
  const renderAd = (ad) => (
    <div key={ad.ad_id} className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50/50">
      {ad.media_url && (ad.media_type === "video"
        ? <video src={ad.media_url} poster={ad.thumb_url || undefined} controls className="w-full max-h-40 object-cover bg-black" />
        : <img src={ad.media_url} alt="" className="w-full max-h-40 object-cover" />)}
      <div className="p-2 space-y-0.5">
        {ad.error ? <div className="text-[11px] text-slate-400">โหลดรายละเอียดแอดไม่ได้ — แอดอาจถูกลบ หรือไม่มีสิทธิ์เข้าถึงบัญชีโฆษณานี้</div> : (<>
          <div className="text-[11px] text-slate-500">แคมเปญ: <span className="text-slate-700">{ad.campaign_name || "-"}</span></div>
          <div className="text-[11px] text-slate-500">ชุดโฆษณา: <span className="text-slate-700">{ad.adset_name || "-"}</span></div>
          <div className="text-[11px] text-slate-500">โฆษณา: <span className="text-slate-700">{ad.name || "-"}</span></div>
        </>)}
        <div className="text-[10px] text-slate-400 break-all">ad_id: {ad.ad_id}</div>
      </div>
    </div>
  );
  // ภาษาที่เลือกส่งได้เอง (กัน AI ตรวจภาษาลูกค้าผิด) — value = ชื่อภาษาอังกฤษที่ backend/AI เข้าใจ
  // ครอบคลุมภาษาหลักของโลกตามที่แพลตฟอร์มยอดนิยมรองรับ
  const LANG_OPTIONS = [
    ["auto", "อัตโนมัติ (ตามภาษาหัวแชท)"],
    // ภาษาหลักที่ทีมใช้บ่อย — เรียงตามลำดับงานจริงที่แอดมินกำหนด
    ["English", "อังกฤษ"], ["Thai", "ไทย"], ["Tagalog", "ฟิลิปปินส์ (Tagalog)"],
    ["Bahasa Malaysia", "มาเลเซีย"], ["Bahasa Indonesia", "อินโดนีเซีย"], ["Vietnamese", "เวียดนาม"],
    ["Korean", "เกาหลี"], ["Lao", "ลาว"], ["Chinese (Simplified)", "จีน"], ["Japanese", "ญี่ปุ่น"],
    ["Chinese (Traditional)", "ไต้หวัน (จีนตัวเต็ม)"], ["Hindi", "อินเดีย (ฮินดี)"],
    // ภาษาอื่นเรียงโดยประมาณตามจำนวนผู้ใช้และความถี่ในงานบริการลูกค้าทั่วโลก
    ["Spanish", "สเปน"], ["Arabic", "อาหรับ"], ["Portuguese", "โปรตุเกส"], ["French", "ฝรั่งเศส"],
    ["German", "เยอรมัน"], ["Russian", "รัสเซีย"], ["Bengali", "เบงกาลี"], ["Urdu", "อูรดู"],
    ["Turkish", "ตุรกี"], ["Italian", "อิตาลี"], ["Burmese", "พม่า"], ["Khmer", "เขมร (กัมพูชา)"],
    ["Tamil", "ทมิฬ"], ["Telugu", "เตลูกู"], ["Punjabi", "ปัญจาบ"], ["Persian (Farsi)", "เปอร์เซีย (ฟาร์ซี)"],
    ["Dutch", "ดัตช์"], ["Polish", "โปแลนด์"], ["Ukrainian", "ยูเครน"], ["Romanian", "โรมาเนีย"],
    ["Greek", "กรีก"], ["Czech", "เช็ก"], ["Swedish", "สวีเดน"], ["Danish", "เดนมาร์ก"],
    ["Norwegian", "นอร์เวย์"], ["Finnish", "ฟินแลนด์"], ["Hungarian", "ฮังการี"], ["Nepali", "เนปาล"],
    ["Sinhala", "สิงหล"], ["Hebrew", "ฮีบรู"], ["Swahili", "สวาฮีลี"],
  ];
  const initial = (n) => (String(n || "?").trim()[0] || "?").toUpperCase();
  const [myEmail, setMyEmail] = useState("");
  const fmtMsgTime = (t) => { try { return new Date(t).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

  function recordInboxLatency(stage, row, extra = {}) {
    if (!row?.id || typeof window === "undefined") return;
    const now = Date.now();
    const dbAt = Date.parse(row.updated_at || row.synced_at || "");
    const transcript = Array.isArray(row.transcript) ? row.transcript : [];
    const messageAt = Date.parse(transcript[transcript.length - 1]?.at || row.last_message_at || "");
    const sample = {
      stage,
      chat_id: row.id,
      page_id: row.page_id || null,
      measured_at: new Date(now).toISOString(),
      meta_to_db_ms: Number.isFinite(messageAt) && Number.isFinite(dbAt) ? Math.max(0, dbAt - messageAt) : null,
      db_to_ui_ms: Number.isFinite(dbAt) ? Math.max(0, now - dbAt) : null,
      ...extra,
    };
    const history = Array.isArray(window.__CHAT_LATENCY__) ? window.__CHAT_LATENCY__ : [];
    window.__CHAT_LATENCY__ = [...history.slice(-99), sample];
    if (import.meta.env.DEV) console.debug("[chat-latency]", sample);
  }

  function currentPageIds({ includeAll = false } = {}) {
    const ps = pageSelRef.current;
    const explicit = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
    const permitted = (ids) => ids.filter((id) => !allowedPages || allowedPages.includes(id));
    if (explicit.length || !includeAll) return permitted(explicit);
    if (allowedPages) return [...allowedPages];
    return permitted((pageOptionsRef.current || []).map((page) => page.id));
  }

  function rowMatchesCurrentList(row) {
    if (!row?.id) return false;
    const filters = listFilterRef.current;
    if (!filters) return false;
    const isBlocked = !!row.blocked_at;
    if (isBlocked !== filters.showBlocked) return false;
    if (allowedPages && !allowedPages.includes(String(row.page_id || ""))) return false;
    const selectedPages = currentPageIds();
    if (selectedPages.length && !selectedPages.includes(String(row.page_id || ""))) return false;
    if (filters.listTab === "comments") return isCommentChat(row);
    if (filters.listTab === "line") return row.source === "line" && INBOX_LINE_OA_ENABLED;
    return !isCommentChat(row) && row.source !== "line";
  }

  function scheduleUnreadRefresh(delay = 500) {
    clearTimeout(unreadRefreshTimerRef.current);
    unreadRefreshTimerRef.current = setTimeout(() => {
      void Promise.allSettled([
        updateAppBadge(),
        loadCommentUnreadCount(),
        loadMessengerUnreadCount(),
        ...(INBOX_LINE_OA_ENABLED ? [loadLineUnreadCount()] : []),
      ]);
    }, delay);
  }

  async function runGuardedSync(name, key, cooldownMs, task) {
    const guard = syncGuardRef.current;
    const jobKey = `${name}:${key || "all"}`;
    if (guard.inFlight.has(jobKey)) return guard.inFlight.get(jobKey);
    if (Date.now() - (guard.lastRun.get(jobKey) || 0) < cooldownMs) return null;
    guard.lastRun.set(jobKey, Date.now());
    const promise = Promise.resolve().then(task).finally(() => guard.inFlight.delete(jobKey));
    guard.inFlight.set(jobKey, promise);
    return promise;
  }

  async function loadSavedReplies(pageId, openSeq = openRequestRef.current.seq) {
    setSavedErr("");
    if (String(pageId || "").startsWith("line:")) { setSavedReplies([]); return; }
    const cacheKey = String(pageId || "__global__");
    const cached = savedCacheRef.current[cacheKey];
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
      if (openSeq === openRequestRef.current.seq) setSavedReplies(cached.items);
      return;
    }
    const orFilter = pageId ? `page_id.is.null,page_id.eq.${pageId}` : "page_id.is.null";
    const { data, error } = await supabase.from("saved_replies").select("*").or(orFilter).order("sort").order("created_at");
    if (openSeq !== openRequestRef.current.seq) return;
    if (error) { setSavedErr(error.message); setSavedReplies([]); return; }
    const items = (data || []).map((r) => ({ id: r.id, title: r.title, message: r.message || "", image: r.image_url || null }));
    savedCacheRef.current[cacheKey] = { at: Date.now(), items };
    setSavedReplies(items);
  }

  async function searchKnowledge(term = knowledgeQuery) {
    const text = String(term || "").trim();
    if (!selected?.page_id || text.length < 2) { setKnowledgeResults([]); return; }
    setKnowledgeLoading(true); setKnowledgeErr("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "search", page_id: selected.page_id, q: text } });
    setKnowledgeLoading(false);
    if (error || !data?.ok) { setKnowledgeErr(data?.error || error?.message || "ค้นหาไม่สำเร็จ"); setKnowledgeResults([]); return; }
    setKnowledgeResults(data.items || []);
  }

  function openKnowledgeSearch() {
    const latest = [...(selected?.transcript || [])].reverse().find((m) => m?.w === "u" && String(m?.t || "").trim());
    const term = latest ? (thOf(latest) || latest.t) : "";
    setKnowledgeQuery(term); setKnowledgeOpen(true); setSavedOpen(false);
    if (String(term).trim().length >= 2) searchKnowledge(term);
  }

  async function loadList({ refreshAfterCurrent = false, lean = false } = {}) {
    const key = JSON.stringify({
      listTab,
      showBlocked,
      pageMode: pageSel.mode,
      pageSingle: pageSel.single || null,
      pageMulti: pageSel.multi || [],
      allowedPages,
    });
    latestListKeyRef.current = key;

    // React effects, focus และ realtime อาจเรียกพร้อมกัน ให้ใช้ promise เดิมเมื่อเงื่อนไขเดียวกัน
    if (listLoadRef.current) {
      if (refreshAfterCurrent) queuedListLoadRef.current = true;
      if (listLoadRef.current.key === key) return listLoadRef.current.promise;
      queuedListLoadRef.current = true;
      return listLoadRef.current.promise;
    }

    const seq = ++listSeqRef.current;
    if (!lean) setLoadingList(true);   // lean poll (ทุก 10 วิ) = เงียบ ไม่โชว์สปินเนอร์/ไม่ยิง count
    setListError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const promise = (async () => {
      try {
        let query = supabase.from("chat_customers")
          .select("id, customer_name, last_user_text, last_reply_text, last_reply_by, last_reply_at, last_message_at, page_id, page_name, country, cust_lang, source, entry_ad_id, entry_ad_name, comment_ad_name, comment_ad_ids, comment_ad_names, comment_is_ad, comment_promoted_to_inbox, stage, stage_manual, psid, profile_pic, awaiting_reply, unread, cust_read_at, blocked_at, synced_at, updated_at")
          .order("last_message_at", { ascending: false }).limit(200);
        query = showBlocked ? query.not("blocked_at", "is", null) : query.is("blocked_at", null);
        if (listTab === "comments") query = query.or("source.eq.comment,id.like.fbc_%");
        else if (listTab === "line") query = query.eq("source", "line");
        else query = query.not("id", "like", "fbc_%").or("source.is.null,and(source.neq.comment,source.neq.line)");

        if (listTab === "line") {
          if (allowedPages !== null) query = query.eq("page_id", "__line_permission_required__");
        } else {
          if (pageSel.mode === "single" && pageSel.single) query = query.eq("page_id", pageSel.single);
          else if (pageSel.mode === "multi" && pageSel.multi.length) query = query.in("page_id", pageSel.multi);
          if (allowedPages) query = query.in("page_id", allowedPages);
        }

        const { data, error } = await query.abortSignal(controller.signal);
        if (error) throw error;
        if (seq !== listSeqRef.current || key !== latestListKeyRef.current) return;
        setList((data || []).map(normalizeChatSource));
        // นับ unread/badge (count query หลายตัว) — ข้ามในโหมด lean เพื่อให้ poll 10 วิ ยิงแค่ query ลิสต์ตัวเดียว
        if (!lean) {
          void Promise.allSettled([
            updateAppBadge(),
            loadCommentUnreadCount(),
            loadMessengerUnreadCount(),
            ...(INBOX_LINE_OA_ENABLED ? [loadLineUnreadCount()] : []),
          ]);
        }
      } catch (error) {
        if (seq === listSeqRef.current && key === latestListKeyRef.current) {
          setListError(error?.name === "AbortError" ? "ฐานข้อมูลตอบสนองเกิน 15 วินาที กรุณาลองใหม่" : (error?.message || "โหลดรายการแชทไม่สำเร็จ"));
        }
      } finally {
        clearTimeout(timeout);
        if (listLoadRef.current?.promise === promise) listLoadRef.current = null;
        if (seq === listSeqRef.current && !lean) setLoadingList(false);
        if (queuedListLoadRef.current || key !== latestListKeyRef.current) {
          queuedListLoadRef.current = false;
          queueMicrotask(() => loadRef.current());
        }
      }
    })();
    listLoadRef.current = { key, promise };
    return promise;
  }
  async function loadMessengerUnreadCount() {
    const ps = pageSelRef.current;
    let mq = supabase.from("chat_customers").select("id", { count: "exact", head: true })
      .eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,and(source.neq.comment,source.neq.line)");
    if (ps.mode === "single" && ps.single) mq = mq.eq("page_id", ps.single);
    else if (ps.mode === "multi" && ps.multi.length) mq = mq.in("page_id", ps.multi);
    if (allowedPages) mq = mq.in("page_id", allowedPages);
    const { count } = await mq;
    setMessengerUnreadCount(count || 0);
  }
  async function loadLineUnreadCount() {
    let lq = supabase.from("chat_customers").select("id", { count: "exact", head: true }).eq("source", "line").eq("unread", true);
    if (allowedPages) lq = lq.in("page_id", allowedPages);
    const { count } = await lq; setLineUnreadCount(count || 0);
  }
  async function loadCommentUnreadCount() {
    const ps = pageSelRef.current;
    let cq = supabase.from("chat_customers").select("id", { count: "exact", head: true }).or("source.eq.comment,id.like.fbc_%").eq("unread", true);
    if (ps.mode === "single" && ps.single) cq = cq.eq("page_id", ps.single);
    else if (ps.mode === "multi" && ps.multi.length) cq = cq.in("page_id", ps.multi);
    if (allowedPages) cq = cq.in("page_id", allowedPages);
    const { count } = await cq;
    setCommentUnreadCount(count || 0);
  }
  // จุดแดงบนไอคอนแอป (Badging API) = จำนวนแชทค้างอ่าน "เฉพาะเพจที่เลือกดูในหน้าตอบแชท" (ไม่อิงแท็บ)
  async function updateAppBadge() {
    try {
      if (!("setAppBadge" in navigator)) return;
      const ps = pageSelRef.current;
      const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
      // เลือกเพจไว้ = นับเฉพาะเพจนั้น ; ไม่เลือก (ดูทุกเพจ) = นับทุกเพจที่มีสิทธิ์
      const scope = viewing.length ? viewing.filter((p) => !allowedPages || allowedPages.includes(p)) : allowedPages;
      let cq = supabase.from("chat_customers").select("id", { count: "exact", head: true }).eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,and(source.neq.comment,source.neq.line)");
      if (scope && scope.length === 0) { navigator.clearAppBadge(); return; }
      if (scope) cq = cq.in("page_id", scope);
      const { count } = await cq;
      if (count && count > 0) navigator.setAppBadge(count); else navigator.clearAppBadge();
    } catch { /* ไม่รองรับ/เกิดข้อผิดพลาด = ข้าม */ }
  }
  // ดึงข้อความใหม่ของ "แชทที่เปิดอยู่" (ให้เด้งเองโดยไม่ต้องกดที่ลิสต์)
  async function refreshOpenTranscript(id) {
    const { data } = await supabase.from("chat_customers").select("id, page_id, transcript, unread, awaiting_reply, last_message_at, synced_at, updated_at").eq("id", id).maybeSingle();
    if (!data) return;
    const cur = selRef.current;
    if (!cur || cur.id !== id) return;
    const newTr = Array.isArray(data.transcript) ? data.transcript : [];
    const oldLen = Array.isArray(cur.transcript) ? cur.transcript.length : 0;
    const grew = newTr.length > oldLen;
    if (!grew && cur.unread === data.unread && cur.awaiting_reply === data.awaiting_reply) return;
    recordInboxLatency("transcript_refresh", data);
    setSelected((s) => {
      if (!s || s.id !== id) return s;
      // ห้ามเขียนทับ transcript เดิมด้วยของที่สั้น/ว่างกว่า (กันข้อความกระพริบหาย)
      const keepTr = (Array.isArray(s.transcript) && s.transcript.length > newTr.length) ? s.transcript : newTr;
      return { ...s, transcript: keepTr, unread: data.unread, awaiting_reply: data.awaiting_reply };
    });
    if (grew) {
      const { data: tr } = await supabase.functions.invoke("messenger-reply", { body: { action: "translate", id } });
      if (tr?.ok) setTranslations(tr.translations || {});
      // มีข้อความใหม่ในแชทที่เปิดอยู่ = ถือว่าอ่านแล้ว (เราเห็นอยู่)
      supabase.functions.invoke("messenger-reply", { body: { action: "mark_seen", id } });
    }
  }
  selRef.current = selected;
  listRef.current = list;
  listFilterRef.current = { listTab, showBlocked };
  pageOptionsRef.current = pageOptions;
  loadRef.current = loadList;
  openRef.current = () => { const s = selRef.current; if (s?.id) refreshOpenTranscript(s.id); };
  const syncCommentReplies = async () => {
    if (!INBOX_COMMENTS_ENABLED) return;   // พักระบบดึงความคิดเห็น (ข้อมูลเดิมยังอยู่)
    const pageIds = currentPageIds({ includeAll: true });
    if (!pageIds.length) return;
    return runGuardedSync("comments", [...pageIds].sort().join(","), 12 * 60 * 1000, async () => {
      const { data } = await supabase.functions.invoke("sync-comment-replies", { body: { page_ids: pageIds } });
      if (data?.reconciled > 0) { loadRef.current(); openRef.current(); scheduleUnreadRefresh(0); }
      return data;
    });
  };
  const syncInstagramRecent = async () => {
    const pageIds = currentPageIds({ includeAll: true });
    const key = pageIds.length ? [...pageIds].sort().join(",") : "all";
    return runGuardedSync("instagram", key, 10 * 60 * 1000, async () => {
      const { data } = await supabase.functions.invoke("sync-instagram-recent", { body: { page_ids: pageIds } });
      if (data?.upserted > 0) { loadRef.current(); openRef.current(); scheduleUnreadRefresh(0); }
      return data;
    });
  };

  // ดึงแอดทั้งหมดที่ลูกค้าคนนี้ทักเข้ามา + รายละเอียด (แคมเปญ/ชุด/โฆษณา/รูป-วิดีโอ)
  async function loadAdSources(row, openSeq = openRequestRef.current.seq) {
    if (row?.source === "line") return;
    if (!row?.psid || !row?.page_id) return;
    const { data: refs } = await supabase.from("chat_referrals").select("ad_id, received_at").eq("page_id", row.page_id).eq("psid", row.psid).order("received_at", { ascending: true });
    if (openSeq !== openRequestRef.current.seq || selRef.current?.id !== row.id) return;
    let adIds = [...new Set((refs || []).map((r) => r.ad_id).filter(Boolean))];
    if (!adIds.length && row.entry_ad_id) adIds = [row.entry_ad_id];
    if (!adIds.length) return;
    // แชท DM ที่เริ่มจากแอด/คอมเมนต์แอดบางครั้ง Meta ส่ง ad id มา แต่ source เดิมยังเป็น null
    // แก้ข้อมูลต้นทางให้ฐานข้อมูลและ Export เห็นว่าเป็น Ads ตรงกับหน้าแชท
    if (row.source !== "ad" && !isCommentChat(row) && row.source !== "instagram") {
      const sourcePatch = { source: "ad", entry_ad_id: row.entry_ad_id || adIds[adIds.length - 1], updated_at: new Date().toISOString() };
      const { data: saved } = await supabase.functions.invoke("save-lead-fields", { body: { action: "mark_ad_source", id: row.id } });
      if (saved?.ok) {
        if (openSeq !== openRequestRef.current.seq) return;
        setSelected((s) => (s?.id === row.id ? { ...s, ...sourcePatch, entry_ad_id: saved.entry_ad_id || sourcePatch.entry_ad_id } : s));
        setList((items) => (items || []).map((item) => item.id === row.id ? { ...item, ...sourcePatch, entry_ad_id: saved.entry_ad_id || sourcePatch.entry_ad_id } : item));
      }
    }
    const cacheKey = [...adIds].sort().join(",");
    const cached = adSourceCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      if (openSeq === openRequestRef.current.seq && selRef.current?.id === row.id) setAdSources(cached.ads);
      return;
    }
    setAdLoading(true);
    try {
      const { data: det } = await supabase.functions.invoke("ad-source-details", { body: { ad_ids: adIds } });
      if (openSeq !== openRequestRef.current.seq || selRef.current?.id !== row.id) return;
      if (det?.ok) {
        const ads = det.ads || [];
        adSourceCacheRef.current.set(cacheKey, { at: Date.now(), ads });
        if (adSourceCacheRef.current.size > 50) adSourceCacheRef.current.delete(adSourceCacheRef.current.keys().next().value);
        setAdSources(ads);
        // เก็บชื่อโฆษณาตัวหลักไว้ใน DB (โชว์ในหน้าฐานข้อมูล) — เลือกตัวที่ตรง entry_ad_id ไม่งั้นตัวล่าสุด
        const primary = ads.find((x) => x.ad_id === row.entry_ad_id && x.name) || [...ads].reverse().find((x) => x.name);
        const adName = primary?.name || "";
        if (adName && adName !== row.entry_ad_name) {
          supabase.functions.invoke("save-lead-fields", { body: { action: "save_ad_name", id: row.id, ad_name: adName, ad_id: primary?.ad_id } }).then(({ data }) => {
            if (!data?.ok) return;
            setSelected((s) => (s?.id === row.id ? { ...s, entry_ad_name: adName } : s));
            setList((items) => (items || []).map((it) => (it.id === row.id ? { ...it, entry_ad_name: adName } : it)));
          }).catch(() => {});
        }
      }
    } finally {
      if (openSeq === openRequestRef.current.seq && selRef.current?.id === row.id) setAdLoading(false);
    }
  }
  // โหลด + Realtime + poll — ทำงานเฉพาะตอน "เปิดแท็บตอบแชทอยู่" (active) เพื่อประหยัด egress
  // เมื่อสลับไปแท็บอื่น: หยุด subscription/poll ทั้งหมด (การแจ้งเตือนตอนปิดแอปยังทำงานผ่าน push/cron ฝั่ง server — ไม่กระทบ)
  useEffect(() => {
    if (!active) return;
    loadRef.current();
    let stopped = false;
    // Realtime: subscribe การเปลี่ยนแปลงของ chat_customers → เด้งทันที
    const channel = supabase.channel("inbox-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_customers" }, (payload) => {
        const row = payload.new;
        if (payload.eventType === "DELETE") {
          const deletedId = String(payload.old?.id || "");
          if (deletedId) {
            setList((items) => (items || []).filter((item) => item.id !== deletedId));
            if (selRef.current?.id === deletedId) setSelected(null);
          }
          scheduleUnreadRefresh();
          return;
        }
        // ใช้ payload อัปเดตลิสต์โดยตรง ไม่โหลด 200 ห้องใหม่ทุกครั้งที่ข้อความ/สถานะเปลี่ยน
        if (row?.id) {
          recordInboxLatency("realtime_received", row);
          const existingBefore = (listRef.current || []).find((item) => item.id === row.id);
          const countChanged = !existingBefore
            || existingBefore.unread !== row.unread
            || existingBefore.source !== row.source
            || existingBefore.page_id !== row.page_id
            || !!existingBefore.blocked_at !== !!row.blocked_at;
          setList((items) => {
            if (!items) return items;
            const visible = rowMatchesCurrentList(row);
            const exists = items.some((item) => item.id === row.id);
            if (!visible) return exists ? items.filter((item) => item.id !== row.id) : items;
            // transcript อาจใหญ่มาก เก็บไว้เฉพาะ selected pane ไม่ยัดลงลิสต์ซ้าย 200 ห้อง
            const { transcript: _transcript, ads_context: _adsContext, ...lightRow } = row;
            const nextRow = normalizeChatSource(lightRow);
            const next = exists
              ? items.map((item) => item.id === row.id ? normalizeChatSource({ ...item, ...nextRow }) : item)
              : [nextRow, ...items];
            return next
              .sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime())
              .slice(0, 200);
          });
          if (countChanged) scheduleUnreadRefresh();
        }
        // อัปเดตแชทที่เปิดอยู่ทันทีจากข้อมูลที่ส่งมา (ไม่ต้อง query)
        if (row && selRef.current?.id === row.id) {
          const cur = selRef.current;
          const newTr = Array.isArray(row.transcript) ? row.transcript : null;   // payload อาจไม่ส่ง transcript มา
          const oldLen = Array.isArray(cur.transcript) ? cur.transcript.length : 0;
          const grew = newTr && newTr.length > oldLen;
          setSelected((s) => {
            if (!s || s.id !== row.id) return s;
            // ห้ามเขียนทับ transcript เดิมด้วยของว่าง/สั้นกว่า (กันข้อความกระพริบหาย)
            const keepTr = (!newTr || (Array.isArray(s.transcript) && s.transcript.length > newTr.length)) ? s.transcript : newTr;
            // อัปเดต cust_read_at ด้วย → สถานะ "อ่านแล้ว" เด้งทันทีเมื่อลูกค้าเปิดอ่าน (realtime)
            return { ...s, transcript: keepTr, unread: row.unread ?? s.unread, awaiting_reply: row.awaiting_reply ?? s.awaiting_reply, cust_read_at: row.cust_read_at ?? s.cust_read_at };
          });
          // ถ้า payload ส่ง transcript มาไม่ครบ ให้ดึงของจริงจาก DB (กันกรณี payload ใหญ่เกินถูกตัด)
          if (!newTr) {
            clearTimeout(transcriptRefreshTimerRef.current);
            transcriptRefreshTimerRef.current = setTimeout(() => refreshOpenTranscript(row.id), 250);
          }
          if (grew) {
            supabase.functions.invoke("messenger-reply", { body: { action: "translate", id: row.id } }).then(({ data: tr }) => { if (tr?.ok) setTranslations(tr.translations || {}); });
            supabase.functions.invoke("messenger-reply", { body: { action: "mark_seen", id: row.id } });
          }
        }
        // ---- แจ้งเตือน "ข้อความใหม่ทันที" (ไม่ต้องรอค้างครบ X นาที) ----
        // ลูกค้าเพิ่งทักเข้ามา = row.unread true + awaiting_reply true + ข้อความล่าสุดเป็นของลูกค้า
        if (row && payload.eventType !== "DELETE") {
          instantNotifyRef.current?.(row);
        }
      })
      .subscribe((status) => {
        if (stopped) return;
        // โหลดใหม่เฉพาะเมื่อ socket มีปัญหา; ตอน SUBSCRIBED มี initial load อยู่แล้ว
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          loadRef.current({ refreshAfterCurrent: true }); scheduleUnreadRefresh(0);
        }
      });
    // fallback: เผื่อ realtime หลุด — poll ทุก 10 วิ (จุดแดงข้อความใหม่ช้าสุด ~10 วิ)
    //   lean = ยิงแค่ query ลิสต์ตัวเดียว (จุดแดงในลิสต์สด) · เต็ม (นับ unread/badge) ทุก ~30 วิ
    let ftick = 0;
    const fallback = setInterval(() => { ftick++; loadRef.current({ lean: ftick % 3 !== 0 }); openRef.current(); }, 10000);
    // Facebook ไม่มี webhook เมื่อแอดมินเพียง "เปิดอ่าน" ใน Page Inbox จึงใช้ fallback เบา ๆ
    // ฝั่ง server มี shared cooldown ต่อเพจ ป้องกันหลายเครื่องเรียก Meta ซ้ำกัน
    const readSync = () => {
      const ps = pageSelRef.current;
      const selectedPages = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
      const onePage = selectedPages.length === 1 ? selectedPages[0] : null;
      const key = onePage || "all";
      return runGuardedSync("read", key, Math.max(1, Math.min(15, Number(alertMin) || 3)) * 60 * 1000, () =>
        supabase.functions.invoke("sync-conversations", { body: { job: "read_status", ...(onePage ? { page_id: onePage } : {}) } }).catch(() => null));
    };
    readSync();
    const readEveryMs = Math.max(1, Math.min(15, Number(alertMin) || 3)) * 60 * 1000;
    const readTimer = setInterval(readSync, readEveryMs);
    // Webhook เป็นทางหลักและเด้งทันทีอยู่แล้ว; polling นี้เป็น safety net เมื่อ Meta พลาด event เท่านั้น
    const commentReplyTimer = setInterval(syncCommentReplies, 15 * 60 * 1000);
    const instagramFallbackTimer = setInterval(syncInstagramRecent, 10 * 60 * 1000);
    // เปิด/โฟกัสแอป → เคลียร์แจ้งเตือนค้าง + รีเฟรชจุดแดงบนไอคอน (iOS ผูก badge กับ notification ที่ค้างใน Notification Center)
    const clearNotifs = async () => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration?.();
        const ns = await reg?.getNotifications?.();
        (ns || []).forEach((n) => n.close());
      } catch { /* ข้าม */ }
    };
    const onFocus = () => {
      const now = Date.now();
      if (now - focusRefreshAtRef.current < 1500) return;
      focusRefreshAtRef.current = now;
      loadRef.current(); openRef.current(); readSync(); syncCommentReplies(); syncInstagramRecent(); clearNotifs();
    };
    clearNotifs();   // ตอนเปิดแอปครั้งแรก
    const onVis = () => { if (document.visibilityState === "visible") onFocus(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => { stopped = true; clearTimeout(unreadRefreshTimerRef.current); clearTimeout(transcriptRefreshTimerRef.current); clearInterval(fallback); clearInterval(readTimer); clearInterval(commentReplyTimer); clearInterval(instagramFallbackTimer); supabase.removeChannel(channel); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVis); };
  }, [active, alertMin]);
  useEffect(() => { setList(null); loadList(); }, [listTab]);   // เปลี่ยนแท็บ = แสดงสถานะโหลด ไม่สรุปผิดว่าไม่มีแชท
  useEffect(() => { setSelected(null); setList(null); loadList(); }, [showBlocked]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("page_lead_config").select("page_id, page_name, picture_url").order("page_name");
      const opts = (data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })).filter((o) => !allowedPages || allowedPages.includes(o.id));
      setPageOptions(opts);
      // โลโก้เพจที่เก็บไว้ใน DB (Supabase Storage) — โชว์ได้ทันที ไม่ต้องยิง Meta
      const seed = {};
      for (const p of data || []) if (p.picture_url) seed[p.page_id] = p.picture_url;
      if (Object.keys(seed).length) setPagePics((prev) => ({ ...seed, ...prev }));
      // เรียกให้ระบบดึงรูปจาก Meta "ครั้งเดียว" มาเก็บลง Storage ให้ครบ (เพจที่ยังไม่มี/เก่า) แล้วอัปเดต map
      supabase.functions.invoke("page-pictures", { body: {} }).then(({ data: pp }) => {
        if (pp?.ok && pp.pictures) setPagePics((prev) => ({ ...prev, ...pp.pictures }));
      }).catch(() => { /* ไม่มีรูปก็ fallback ตัวย่อชื่อเพจ */ });
      const { data: u } = await supabase.auth.getUser();
      setMyEmail(u?.user?.email || "");
      // โหลดตัวเลือกเพจ "ของคนนี้" ก่อน (คีย์ผูกอีเมล) — ไม่มีค่อย fallback คีย์กลางเดิม
      const myKey = u?.user?.email ? `inbox_page_filter:${u.user.email}` : "inbox_page_filter";
      let { data: s } = await supabase.from("settings").select("value").eq("key", myKey).maybeSingle();
      if (!s?.value && myKey !== "inbox_page_filter") ({ data: s } = await supabase.from("settings").select("value").eq("key", "inbox_page_filter").maybeSingle());
      if (s?.value) {
        // กรองตัวเลือกที่จำไว้ให้เหลือเฉพาะเพจที่คนนี้มีสิทธิ์ (กันตัวเลข/ตัวกรองเกินสิทธิ์ เช่นค้าง 5 เพจทั้งที่เห็นได้ 3)
        const ok = (id) => !allowedPages || allowedPages.includes(id);
        const multi = (Array.isArray(s.value.multi) ? s.value.multi : []).filter(ok);
        const single = s.value.single && ok(s.value.single) ? s.value.single : null;
        setPageSel({ mode: s.value.mode === "single" ? "single" : "multi", single, multi });
      } else {
        // ค่าเริ่มต้นที่หน้า UI แสดงว่า "ทุกเพจ" ต้องบันทึกไว้ด้วย เพื่อให้ webhook รู้ว่าต้องรับคอมเมนต์ทุกเพจในสิทธิ์คนนี้
        const initialFilter = { mode: "multi", single: null, multi: [] };
        await supabase.from("settings").upsert({ key: myKey, value: initialFilter, updated_at: new Date().toISOString() });
      }
    })();
  }, []);
  // ตรวจ webhook เฉพาะเมื่อผู้ใช้เข้าหน้าตอบแชทจริง และไม่เกินหนึ่งครั้งต่อ app session
  // ฝั่ง server มี cache 6 ชั่วโมงอีกชั้น จึงไม่ยิง Meta ซ้ำเมื่อหลายเครื่องเปิดพร้อมกัน
  useEffect(() => {
    if (!active || commentSubscriptionCheckedRef.current) return;
    commentSubscriptionCheckedRef.current = true;
    supabase.functions.invoke("subscribe-webhook", { body: { action: "sync_comments" } }).then(({ data: sync }) => {
      if (sync && !sync.ok) setSendMsg("เปิดรับความคิดเห็นไม่สำเร็จ: " + (sync.error || ""));
    });
  }, [active]);
  useEffect(() => { pageSelRef.current = pageSel; }, [pageSel]);
  useEffect(() => {
    if (!active || !pageOptions.length) return;
    syncCommentReplies();
    syncInstagramRecent();
  }, [active, pageSel.mode, pageSel.single, pageSel.multi.join(","), pageOptions.map((page) => page.id).join(",")]);
  useEffect(() => { setList(null); loadList(); }, [pageSel.mode, pageSel.single, pageSel.multi.join(",")]);
  useEffect(() => () => {
    openRequestRef.current.controller?.abort();
    clearTimeout(unreadRefreshTimerRef.current);
    clearTimeout(transcriptRefreshTimerRef.current);
  }, []);
  // เปิดแชท/มีข้อความใหม่ = เลื่อนไปข้อความล่าสุด (ล่างสุด) อัตโนมัติ
  // ยกเว้นตอนที่ถูกสั่งให้ไปหาข้อความเจาะจง (จากลิสต์หลักฐาน) — ไม่งั้นจะแย่งกันเลื่อนแล้วเด้งลงล่างสุดแทน
  useEffect(() => {
    if (!selected?.transcript || highlightAtRef.current) return;
    // เลื่อนล่างสุดหลายจังหวะ กันรูป/สติกเกอร์โหลดช้าแล้วดันความสูง (เปิดแชทค้างกลางจอ)
    const toBottom = () => bottomRef.current?.scrollIntoView({ block: "end" });
    toBottom();
    const t1 = setTimeout(toBottom, 120);
    const t2 = setTimeout(toBottom, 400);
    const t3 = setTimeout(toBottom, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [selected?.id, Array.isArray(selected?.transcript) ? selected.transcript.length : 0]);

  // เปิดแชทที่ถูกสั่งมาจากหน้าอื่น (ลิสต์หลักฐานในสถิติการตอบแชท)
  // ต้องสลับตัวกรองเพจไปเพจของแชทนั้นด้วย ไม่งั้นเปิดได้แต่ลิสต์ซ้ายไม่มีรายการนั้น = งง
  useEffect(() => {
    if (!gotoChat || (!gotoChat.id && !gotoChat.trade_id && !gotoChat.username)) return;
    let cancelled = false;
    (async () => {
      // เปิดตาม id ตรงๆ หรือค้นจาก trade_id / username (ลิงก์มาจากหน้าจัดการสมาชิก TV)
      let data = null;
      if (gotoChat.id) {
        ({ data } = await supabase.from("chat_customers").select("id, page_id, customer_name").eq("id", gotoChat.id).maybeSingle());
      } else if (gotoChat.trade_id) {
        const r = await supabase.from("chat_customers").select("id, page_id, customer_name").eq("trade_id", String(gotoChat.trade_id)).order("last_message_at", { ascending: false }).limit(1);
        data = r.data?.[0] || null;
      } else if (gotoChat.username) {
        const r = await supabase.from("chat_customers").select("id, page_id, customer_name").eq("username", String(gotoChat.username)).order("last_message_at", { ascending: false }).limit(1);
        data = r.data?.[0] || null;
      }
      if (cancelled) return;
      if (!data) { onGotoDone?.(); return; }
      const ps = pageSelRef.current;
      const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
      if (data.page_id && viewing.length > 0 && !viewing.includes(data.page_id)) {
        await savePageSel({ ...ps, mode: "single", single: data.page_id });
      }
      setListTab("all");
      // จำเวลาข้อความเป้าหมายไว้ — พอ transcript โหลดเสร็จจะเลื่อนไปหาและไฮไลต์ให้
      highlightAtRef.current = gotoChat.at || null;
      setHighlightAt(gotoChat.at || null);
      openChat({ id: data.id, customer_name: data.customer_name, page_id: data.page_id });
      onGotoDone?.();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gotoChat?.id, gotoChat?.at, gotoChat?.trade_id, gotoChat?.username]);

  // เลื่อนไปยัง "ข้อความที่ตอบช้า/ยังไม่ตอบ" แล้วไฮไลต์ไว้สักครู่ — ไม่ต้องไล่หาเอง
  useEffect(() => {
    if (!highlightAt || !Array.isArray(selected?.transcript)) return;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-msg-at="${CSS.escape(String(highlightAt))}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      highlightAtRef.current = null;
      // ปล่อยไฮไลต์ทิ้งไว้ 6 วิ ให้ทันเห็นว่าเป็นข้อความไหน แล้วค่อยจางหาย
      const t2 = setTimeout(() => setHighlightAt(null), 6000);
      return () => clearTimeout(t2);
    }, 120);   // รอ DOM วาด transcript เสร็จก่อน
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightAt, selected?.id, Array.isArray(selected?.transcript) ? selected.transcript.length : 0]);

  async function openChat(item) {
    const openSeq = openRequestRef.current.seq + 1;
    openRequestRef.current.controller?.abort();
    const controller = new AbortController();
    openRequestRef.current = { seq: openSeq, controller };
    const startedAt = performance.now();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    setSelected({ ...item, transcript: null });
    logActivity("open_chat", { id: item.id, customer_name: item.customer_name, page_id: item.page_id });
    setTranslations({}); setReply(""); setSendPreview(null); setSendMsg(""); setAdSources([]); setAdLoading(false); setSavedReplies([]); setSavedOpen(false); setKnowledgeOpen(false); setKnowledgeResults([]); setReplyTo(null); setMessageMenu(null); setKnowledgeCapture(null); setKnowledgeCaptureMsg(""); setEmojiOpen(false); setInfoOpen(false); setStatusMenuOpen(false); setLabelMsg(null);
    setForceLang(lsGet(`ui.forceLang.${item.id}`, "auto"));   // ภาษาที่เคยเลือกไว้ของแชทนี้ (จำต่อเครื่อง)
    setTranslating(true);
    // แปลทำคู่ขนานกับการดึง transcript เพื่อไม่ต้องรอ query แรกจบแล้วค่อยเริ่ม Edge Function
    const translationPromise = supabase.functions.invoke("messenger-reply", { body: { action: "translate", id: item.id } });
    // ดึงเฉพาะคอลัมน์ที่หน้าแชทใช้จริง (เลี่ยง select * ที่ลากคอลัมน์หนักที่ไม่ได้ใช้ เช่น ads_context/hash → เปิดแชทไวขึ้นมากในแชทใหญ่)
    const CHAT_COLS = "id, page_id, page_name, psid, customer_name, source, stage, stage_manual, classified_by, needs_ai, needs_verify, manual_data, manual_data_by, manual_data_at, trade_id, username, phone, email, awaiting_reply, unread, cust_read_at, cust_lang, country, profile_pic, transcript, account_opened_at, entry_ad_id, entry_ad_name, last_user_text, last_reply_text, last_reply_by, last_reply_at, last_message_at, comment_ad_name, comment_ad_ids, comment_ad_names, comment_is_ad, comment_promoted_to_inbox, comment_permalink, blocked_at, synced_at, updated_at";
    try {
      const { data, error } = await supabase.from("chat_customers").select(CHAT_COLS).eq("id", item.id).maybeSingle().abortSignal(controller.signal);
      if (openSeq !== openRequestRef.current.seq) return;
      if (error) throw error;
      if (!data) throw new Error("ไม่พบข้อมูลแชทนี้");
      const normalized = normalizeChatSource(data);
      recordInboxLatency("chat_opened", normalized, { query_ms: Math.round(performance.now() - startedAt) });
      setSelected(normalized);
      void loadAdSources(normalized, openSeq);
      void loadSavedReplies(normalized.page_id, openSeq);
      // เปิดอ่านแล้ว → ปิดจุดแดง + แจ้ง Meta ว่าเพจอ่านแล้ว (mark_seen) ให้สถานะตรงกับกล่องข้อความเพจ
      if (data.unread) {
        setSelected((s) => (s && s.id === data.id ? { ...s, unread: false } : s));
        setList((l) => (l || []).map((x) => (x.id === data.id ? { ...x, unread: false } : x)));
        supabase.functions.invoke("messenger-reply", { body: { action: "mark_seen", id: data.id } }).then(() => {
          if (openSeq === openRequestRef.current.seq) scheduleUnreadRefresh(0);
        });
        if (isCommentChat(data)) setCommentUnreadCount((n) => Math.max(0, n - 1));
      }
      if (!data.profile_pic) {
        supabase.functions.invoke("messenger-reply", { body: { action: "profile", id: data.id } }).then(({ data: p }) => {
          if (openSeq === openRequestRef.current.seq && p?.ok && p.profile_pic) {
            setSelected((s) => (s && s.id === data.id ? { ...s, profile_pic: p.profile_pic } : s));
            setList((l) => (l || []).map((x) => (x.id === data.id ? { ...x, profile_pic: p.profile_pic } : x)));
          }
        });
      }
    } catch (error) {
      if (openSeq === openRequestRef.current.seq) {
        const aborted = error?.name === "AbortError";
        setSendMsg(aborted ? "โหลดแชทเกิน 12 วินาที กรุณากดลองใหม่" : `โหลดแชทไม่สำเร็จ: ${error?.message || error}`);
        setSelected((s) => (s?.id === item.id ? { ...s, transcript: [] } : s));
      }
    } finally {
      clearTimeout(timeout);
      if (openSeq === openRequestRef.current.seq) openRequestRef.current.controller = null;
    }
    try {
      const { data: tr } = await Promise.race([
        translationPromise,
        new Promise((resolve) => setTimeout(() => resolve({ data: { ok: false, timeout: true } }), 20_000)),
      ]);
      if (openSeq !== openRequestRef.current.seq) return;
      setTranslating(false);
      if (tr?.ok) {
        setTranslations(tr.translations || {});
        setSelected((s) => (s?.id === item.id ? { ...s, cust_lang: tr.lang || s.cust_lang, country: tr.country || s.country } : s));
      } else if (tr?.error) setSendMsg("แปลไม่สำเร็จ: " + tr.error);
    } catch (error) {
      if (openSeq === openRequestRef.current.seq) { setTranslating(false); setSendMsg("แปลไม่สำเร็จ: " + (error?.message || error)); }
    }
  }

  // เลือกไฟล์ = พักไว้ก่อน (ยังไม่ส่ง) รอกดปุ่มส่ง
  function onFile(e) {
    const files = Array.from(e.target.files || []); if (e.target) e.target.value = "";
    if (!files.length) return;
    const ok = files.filter((f) => f.size <= 20 * 1024 * 1024);
    if (ok.length < files.length) setSendMsg("บางไฟล์ใหญ่เกิน 20MB ถูกข้าม");
    const staged = ok.map((f) => ({
      file: f, name: f.name,
      type: f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : "file",
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
    }));
    setPendingFiles((p) => [...p, ...staged]);
  }
  function removePending(idx) {
    setPendingFiles((p) => { const c = [...p]; const [rm] = c.splice(idx, 1); if (rm?.preview && String(rm.preview).startsWith("blob:")) URL.revokeObjectURL(rm.preview); return c; });
  }
  async function uploadToStorage(file) {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${selected.page_id || "p"}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw error;
    return supabase.storage.from("chat-media").getPublicUrl(path).data.publicUrl;
  }

  async function prepareSendPreview() {
    if (!selected || sending) return;
    const hasText = reply.trim().length > 0;
    if (!hasText && pendingFiles.length === 0) return;
    if (isCommentChat(selected) && pendingFiles.length) {
      setSendMsg("การตอบใต้คอมเมนต์รองรับข้อความ/อิโมจิเท่านั้น กรุณาลบไฟล์แนบก่อนส่ง");
      return;
    }
    // ส่งรูป/ไฟล์ที่ไม่มีข้อความประกอบ → ส่งเลย ไม่ต้องเปิดกล่องตัวอย่าง (ไม่มีคำแปลให้รีวิว)
    if (!hasText && pendingFiles.length > 0) {
      await sendReply({ text: "", lang: "", sourceText: "", replyTo: replyTo ? { ...replyTo } : null });
      return;
    }
    setSending(true); setSendMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("messenger-reply", { body: {
        action: "preview", id: selected.id, text_th: reply.trim(),
        force_lang: forceLang !== "auto" ? forceLang : undefined,
      } });
      if (error) { setSendMsg("สร้างตัวอย่างไม่สำเร็จ: " + (await readFunctionErrorMessage(error))); return; }
      if (!data?.ok) { setSendMsg("สร้างตัวอย่างไม่สำเร็จ: " + (data?.error || "")); return; }
      setSendPreview({ text: data.preview_text || reply.trim(), lang: data.lang || "Thai", sourceText: reply.trim(), replyTo: replyTo ? { ...replyTo } : null });
    } finally { setSending(false); }
  }

  async function sendReply(approved = sendPreview) {
    if (!selected || sending) return;
    const hasText = reply.trim().length > 0;
    if (!hasText && pendingFiles.length === 0) return;
    if (isCommentChat(selected) && pendingFiles.length) {
      setSendMsg("การตอบใต้คอมเมนต์รองรับข้อความ/อิโมจิเท่านั้น กรุณาลบไฟล์แนบก่อนส่ง");
      return;
    }
    if (!approved) { await prepareSendPreview(); return; }
    setSending(true); setSendMsg("");
    // ปิดกล่องอนุมัติทันทีหลังผู้ใช้ยืนยัน เพื่อไม่ให้ดูเหมือนกล่องค้างระหว่างส่งไฟล์/ข้อความ
    setSendPreview(null);

    // Optimistic UI: ข้อความล้วน (ไม่มีไฟล์แนบ) → โชว์บับเบิลทันทีในสถานะ "กำลังส่ง" + เคลียร์ช่องพิมพ์
    // แล้วค่อยแทนที่ด้วยผลจริงเมื่อเซิร์ฟเวอร์ตอบ · ถ้าพลาด ถอนบับเบิลออกและคืนข้อความให้พิมพ์ใหม่
    // (มีไฟล์แนบ/ไม่มีข้อความ = ใช้ flow เดิมทั้งหมด ไม่แตะ)
    const optimistic = hasText && pendingFiles.length === 0;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optAt = new Date().toISOString();
    const sourceText = approved.sourceText || reply.trim();
    const makeReplyToFields = (src) => ({
      ...(src?.text ? { reply_to_text: src.text } : {}),
      ...(src?.mid ? { reply_to_mid: src.mid } : {}),
      ...(src?.img ? { reply_to_img: src.img } : {}),
      ...(src?.at ? { reply_to_at: src.at } : {}),
    });
    if (optimistic) {
      const optItem = { w: "p", t: approved.text || sourceText, at: optAt, by: myEmail, _tmp: tempId, pending: true, ...makeReplyToFields(approved.replyTo) };
      setSelected((s) => (s ? { ...s, transcript: [...(s.transcript || []), optItem], awaiting_reply: false } : s));
      setReply(""); setReplyTo(null);
    }
    const rollbackOptimistic = () => {
      if (!optimistic) return;
      setSelected((s) => (s ? { ...s, transcript: (s.transcript || []).filter((m) => m._tmp !== tempId) } : s));
      setReply(sourceText);
    };

    // Optimistic UI สำหรับไฟล์: โชว์บับเบิลรูป/ไฟล์ทันทีจากพรีวิวในเครื่อง (สถานะกำลังส่ง)
    // + เคลียร์ช่องแนบทันที แล้วค่อยสลับเป็น URL จริงเมื่อเซิร์ฟเวอร์ตอบ · ถ้าพลาด ถอนออก+คืนไฟล์
    const fileLabel = (pf) => pf.type === "image" ? "[รูปภาพ]" : pf.type === "video" ? "[วิดีโอ]" : "[ไฟล์แนบ]";
    const filesSnapshot = pendingFiles;
    const fileTemps = filesSnapshot.map((pf, i) => ({ pf, tmp: `tmpf_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}` }));
    if (fileTemps.length > 0) {
      const optFileItems = fileTemps.map(({ pf, tmp }) => {
        const it = { w: "p", t: fileLabel(pf), at: new Date().toISOString(), by: myEmail, _tmp: tmp, pending: true };
        if ((pf.type === "image" || pf.type === "video") && pf.preview) it.img = pf.preview;
        return it;
      });
      setSelected((s) => (s ? { ...s, transcript: [...(s.transcript || []), ...optFileItems], awaiting_reply: false } : s));
      setPendingFiles([]);   // เคลียร์ช่องแนบทันทีให้ดูส่งไปแล้ว
    }
    const removeFileTemps = () => setSelected((s) => (s ? { ...s, transcript: (s.transcript || []).filter((m) => !fileTemps.some((f) => f.tmp === m._tmp)) } : s));
    const restoreFiles = () => { removeFileTemps(); if (fileTemps.length) setPendingFiles(filesSnapshot); };

    try {
      // อัปโหลดขึ้น storage (ถ้ายังไม่มี URL) แล้วส่งทีละไฟล์
      let prepared;
      try {
        prepared = await Promise.all(fileTemps.map(async (f) => ({ ...f, url: f.pf.url || await uploadToStorage(f.pf.file) })));
      } catch (er) {
        restoreFiles(); rollbackOptimistic();
        setSendMsg("อัปโหลดไฟล์ไม่สำเร็จ: " + (er?.message || er));
        return;
      }
      for (const { pf, tmp, url } of prepared) {
        const { data, error } = await supabase.functions.invoke("messenger-reply", { body: { action: "send_attachment", id: selected.id, url, type: pf.type, filename: pf.name, by: myEmail } });
        if (error) { restoreFiles(); rollbackOptimistic(); setSendMsg("ส่งไฟล์ไม่สำเร็จ: " + (await readFunctionErrorMessage(error))); return; }
        if (!data?.ok) { restoreFiles(); rollbackOptimistic(); setSendMsg("ส่งไฟล์ไม่สำเร็จ: " + (data?.error || "")); return; }
        // reconcile: แทนบับเบิลชั่วคราวด้วยผลจริง (URL จาก storage + message_id)
        setSelected((s) => {
          if (!s) return s;
          const tr = s.transcript || [];
          const idx = tr.findIndex((m) => m._tmp === tmp);
          const real = { w: "p", t: fileLabel(pf), at: idx >= 0 ? tr[idx].at : new Date().toISOString(), by: myEmail, mid: data.message_id || null };
          if (data.img) real.img = data.img;
          if (idx >= 0) { const next = tr.slice(); next[idx] = real; return { ...s, transcript: next }; }
          return { ...s, transcript: [...tr, real] };
        });
      }
      filesSnapshot.forEach((pf) => pf.preview && String(pf.preview).startsWith("blob:") && URL.revokeObjectURL(pf.preview));
      // ส่งข้อความ (ถ้ามี)
      if (hasText) {
        const { data, error } = await supabase.functions.invoke("messenger-reply", { body: {
          action: "send", id: selected.id, text_th: sourceText,
          approved_text: approved.text, approved_lang: approved.lang, by: myEmail,
          reply_to_text: approved.replyTo?.text || null, reply_to_mid: approved.replyTo?.mid || null,
          reply_to_img: approved.replyTo?.img || null, reply_to_at: approved.replyTo?.at || null,
          force_lang: forceLang !== "auto" ? forceLang : undefined,
          comment_reply_mode: isCommentChat(selected) ? "public" : undefined,
        } });
        if (error) { rollbackOptimistic(); setSendMsg("ส่งไม่สำเร็จ: " + (await readFunctionErrorMessage(error))); return; }
        if (!data?.ok) { rollbackOptimistic(); setSendMsg("ส่งไม่สำเร็จ: " + (data?.error || "")); return; }
        const realItem = { w: "p", t: data.sent_text, at: optAt, by: myEmail, mid: data.message_id || null, ...(data.reply_to_text ? { reply_to_text: data.reply_to_text } : {}), ...(data.reply_to_mid ? { reply_to_mid: data.reply_to_mid } : {}), ...(data.reply_to_img ? { reply_to_img: data.reply_to_img } : {}), ...(data.reply_to_at ? { reply_to_at: data.reply_to_at } : {}) };
        setSelected((s) => {
          if (!s) return s;
          const tr = s.transcript || [];
          const idx = optimistic ? tr.findIndex((m) => m._tmp === tempId) : -1;
          if (idx >= 0) { const next = tr.slice(); next[idx] = realItem; return { ...s, transcript: next, awaiting_reply: false }; }
          return { ...s, transcript: [...tr, realItem], awaiting_reply: false };
        });
        if (!optimistic) { setReply(""); setReplyTo(null); }
        setSendPreview(null);
        setSendMsg(`${data.delivery_mode === "human_agent" ? "ส่งติดตามด้วย Human Agent แล้ว" : data.via === "comment_public" ? "ตอบใต้คอมเมนต์แล้ว" : data.via === "private_reply" ? "ส่ง DM แล้ว" : "ส่งแล้ว"} (${data.lang}) ✓`);
        logActivity("send_reply", { id: selected.id, customer_name: selected.customer_name, page_id: selected.page_id, lang: data.lang, via: data.via });
      } else {
        setSelected((s) => (s ? { ...s, awaiting_reply: false } : s));
        setReply(""); setReplyTo(null); setSendPreview(null);
        setSendMsg("ส่งไฟล์แล้ว ✓");
        logActivity("send_file", { id: selected.id, customer_name: selected.customer_name, page_id: selected.page_id });
      }
      setEmojiOpen(false);
      loadList();
    } finally { setSending(false); }
  }

  async function blockCustomer(id, block) {
    if (!id || blocking) return;
    if (block && !window.confirm("บล็อกแชทนี้เป็นสแปม? แชทจะถูกซ่อนจากลิสต์ และข้อความใหม่ของลูกค้าคนนี้จะไม่เด้ง/ไม่แจ้งเตือน (ปลดบล็อกภายหลังได้จาก \"ดูที่บล็อกไว้\")")) return;
    setBlocking(true); setSendMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("block-customer", { body: { id, block } });
      if (error || !data?.ok) { setSendMsg((block ? "บล็อกไม่สำเร็จ: " : "ปลดบล็อกไม่สำเร็จ: ") + (data?.error || error?.message || "ลองใหม่อีกครั้ง — อาจยังไม่ได้ deploy block-customer")); return; }
      logActivity(block ? "block_customer" : "unblock_customer", { id, customer_name: selected?.customer_name });
      setList((l) => (l || []).filter((x) => x.id !== id));   // ออกจากลิสต์ปัจจุบันทันที
      setSelected((s) => (s && s.id === id ? null : s));
      setSendMsg(block ? "บล็อกแล้ว ✓ (ย้ายไป \"ดูที่บล็อกไว้\")" : "ปลดบล็อกแล้ว ✓");
    } finally { setBlocking(false); }
  }

  async function setStage(id, stage) {
    const nowIso = new Date().toISOString();
    const openedAt = stage === "account_opened" && selected?.id === id && !selected.account_opened_at ? nowIso : selected?.account_opened_at;
    const patch = { stage, stage_manual: stage, classified_by: "manual", needs_ai: false, needs_verify: false, ...(stage === "account_opened" && openedAt ? { account_opened_at: openedAt } : {}), updated_at: nowIso };
    setSelected((s) => (s && s.id === id ? { ...s, ...patch } : s));
    setList((l) => (l || []).map((x) => x.id === id ? { ...x, ...patch } : x));
    await supabase.from("chat_customers").update(patch).eq("id", id);
    logActivity("set_stage", { id, stage, customer_name: selected?.id === id ? selected?.customer_name : undefined });
  }
  async function confirmInstagramAccountOpened() {
    if (!selected || selected.source !== "instagram") return;
    setLabelMsg({ type: "loading", text: "กำลังบันทึกลูกค้าเปิดบัญชีใหม่..." });
    await setStage(selected.id, "account_opened");
    setLabelMsg({ type: "ok", text: "✓ บันทึกเปิดบัญชีใหม่แล้ว — รวมใน Analytics และ Export" });
  }
  // ทำเครื่องหมายอ่านแล้ว/ยังไม่อ่าน เอง (คุมจุดแดง)
  async function setUnread(val) {
    if (!selected) return;
    const id = selected.id;
    setSelected((s) => (s ? { ...s, unread: val } : s));
    setList((l) => (l || []).map((x) => (x.id === id ? { ...x, unread: val } : x)));
    if (val) {
      await supabase.from("chat_customers").update({ unread: true, updated_at: new Date().toISOString() }).eq("id", id);
    } else {
      // อ่านแล้ว → แจ้ง Meta (mark_seen) ด้วย กันซิงก์ดึงจุดแดงกลับ
      await supabase.functions.invoke("messenger-reply", { body: { action: "mark_seen", id } });
    }
    loadList();
    updateAppBadge();   // อัปเดตจุดแดงบนไอคอนทันที
  }
  async function pushLabel(id) {
    setLabelMsg({ type: "loading", text: "กำลังส่งป้ายไป Meta..." });
    const { data, error } = await supabase.functions.invoke("meta-push-labels", { body: { id } });
    if (error || !data?.ok) { setLabelMsg({ type: "err", text: data?.error || (error ? await readFunctionErrorMessage(error) : "ส่งป้ายไม่สำเร็จ — ลองใหม่ได้") }); return; }
    const r0 = data.results?.[0];
    logActivity("push_label", { id, label: r0?.label, assigned: !!r0?.assigned });
    if (r0?.assigned) setLabelMsg({ type: "ok", text: `✓ ติดป้าย "${r0.label}" บน Meta แล้ว` });
    else if (r0?.skipped) setLabelMsg({ type: "ok", text: "✓ มีป้ายสร้างคอนเวอร์ชั่นบน Meta อยู่แล้ว (ข้าม)" });
    else setLabelMsg({ type: "err", text: r0?.error || "ส่งป้ายไม่สำเร็จ — ลองใหม่ได้" });
  }
  // กล่องสถานะผลการส่งป้าย — สีเด่น อยู่ติดปุ่ม
  const LabelMsgBox = () => !labelMsg ? null : (
    <div className={`mt-2 text-sm font-medium rounded-lg px-3 py-2 flex items-center gap-2 ${
      labelMsg.type === "ok" ? "bg-emerald-600 text-white" : labelMsg.type === "err" ? "bg-rose-600 text-white" : "bg-blue-600 text-white"
    }`}>
      {labelMsg.type === "loading" && <Loader2 className="animate-spin shrink-0" size={15} />}
      <span className="min-w-0 break-words">{labelMsg.text}</span>
    </div>
  );

  function openMessageMenu(index, message, side) {
    const value = String(message?.t || "").trim() || (message?.img ? "[รูปภาพ]" : "");
    if (!value) return;
    setMessageMenu((current) => current?.index === index ? null : { index, text: value, img: message?.img || null, mid: message?.mid || null, at: message?.at || null, side });
  }
  function goToReplyTarget(message) {
    const mid = String(message?.reply_to_mid || "");
    const at = String(message?.reply_to_at || "");
    const selector = mid
      ? `[data-msg-mid="${CSS.escape(mid)}"]`
      : at ? `[data-msg-at="${CSS.escape(at)}"]` : "";
    const el = selector ? document.querySelector(selector) : null;
    if (!el) { setSendMsg("ไม่พบข้อความต้นทางในประวัติที่โหลดอยู่"); return; }
    if (at) { highlightAtRef.current = at; setHighlightAt(at); }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function beginKnowledgeCapture(text) {
    setMessageMenu(null);
    setKnowledgeCaptureMsg("");
    setKnowledgeCapture({ step: "question", question: String(text || "").trim(), answer: "", answerIndex: null });
  }
  async function saveKnowledgeCapture() {
    if (!selected?.page_id || !knowledgeCapture?.question?.trim() || !knowledgeCapture?.answer?.trim()) return;
    setKnowledgeCaptureSaving(true); setKnowledgeCaptureMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", {
      body: { action: "create", page_id: selected.page_id, question: knowledgeCapture.question.trim(), answer: knowledgeCapture.answer.trim() },
    });
    setKnowledgeCaptureSaving(false);
    if (error || !data?.ok) { setKnowledgeCaptureMsg(data?.error || error?.message || "บันทึกเข้าคลังไม่สำเร็จ"); return; }
    setKnowledgeCapture(null);
    setKnowledgeCaptureMsg(data.merged ? "คำตอบนี้มีอยู่แล้ว จึงเพิ่มคำถามเข้า Keywords เดิมให้แล้ว ✓" : "บันทึกคำถาม–คำตอบเข้าคลังของเพจนี้แล้ว ✓");
    setTimeout(() => setKnowledgeCaptureMsg(""), 3500);
  }

  const fmt = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); } catch { return t || ""; } };
  const filtered = (list || []).filter((x) => !q.trim() || `${x.customer_name || ""} ${x.last_user_text || ""} ${x.country || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const tItemsRaw = Array.isArray(selected?.transcript) ? selected.transcript : [];
  // กันแสดงซ้ำ — ตาข่ายกันสุดท้าย ไม่ว่า transcript ใน DB จะเบิ้ลด้วยเหตุใด (race webhook / echo+sync คนละ id)
  // ยุบเฉพาะข้อความ "เหมือนกันเป๊ะ + อยู่ติดกัน" (ฝั่งเดียวกัน + รูป/ข้อความเดียวกัน) ภายใน ~90 วิ
  // — ยังปล่อยให้ส่งข้อความเดิมซ้ำโดยตั้งใจแบบเว้นช่วงได้
  const tItems = (() => {
    const out = [];
    for (const m of tItemsRaw) {
      const prev = out[out.length - 1];
      if (prev && prev.w === m.w) {
        const sameMid = m.mid && prev.mid && m.mid === prev.mid;
        const sameImg = m.img && prev.img && m.img === prev.img;
        const sameText = !m.img && !prev.img && m.t && prev.t && m.t === prev.t;
        const near = (!m.at || !prev.at) || Math.abs(new Date(m.at).getTime() - new Date(prev.at).getTime()) < 90 * 1000;
        if (sameMid) {
          // รายการเดียวกันจาก sync + webhook: สติกเกอร์เลือก URL sync (โปร่งใส), สื่อทั่วไปเลือก webhook
          const isSticker = !!m.sticker || !!prev.sticker || m.t === "[สติกเกอร์]" || prev.t === "[สติกเกอร์]";
          if (isSticker) {
            if (m.img_source === "sync" && prev.img_source !== "sync") out[out.length - 1] = { ...prev, ...m, sticker: true };
          } else if (m.img_source === "webhook" && prev.img_source !== "webhook") {
            out[out.length - 1] = { ...prev, ...m };
          }
          continue;
        }
        if ((sameImg || sameText) && near) continue;
      }
      out.push(m);
    }
    return out;
  })();
  // index ของข้อความฝั่งเพจ "อันสุดท้าย" — โชว์สถานะอ่านแค่อันเดียว
  const lastPageIdx = (() => { for (let k = tItems.length - 1; k >= 0; k--) if (tItems[k]?.w === "p") return k; return -1; })();
  const isLastPageMsg = (i) => i === lastPageIdx;
  // ลูกค้าอ่านข้อความนี้แล้วหรือยัง (เทียบ cust_read_at กับเวลาข้อความ)
  const custReadStatus = (m) => {
    if (!m?.at) return null;
    const rd = selected?.cust_read_at ? new Date(selected.cust_read_at).getTime() : 0;
    const mt = new Date(m.at).getTime();
    if (rd && rd >= mt - 1000) return { read: true, label: `อ่านแล้ว ${fmtMsgTime(selected.cust_read_at)}` };
    return { read: false, label: "ส่งแล้ว" };
  };
  // บล็อกป้อนข้อมูล/เช็คไอดีเทรด (+ให้สิทธิ์ TV) แสดงเฉพาะเพจ BeSight เท่านั้น
  // เพจที่ผูกกับแบรนด์ TV — ฟอร์มป้อนข้อมูล/เช็คไอดี/เพิ่ม TV จะโชว์เฉพาะเพจเหล่านี้ (ตั้งที่ ตั้งค่า → ตั้งค่า TV)
  const [tvBrandPages, setTvBrandPages] = useState(null);   // Set<page_id> | null (ยังโหลดไม่เสร็จ)
  useEffect(() => {
    supabase.from("tv_brands").select("pages, active").then(({ data }) => {
      const s = new Set();
      for (const b of data || []) if (b.active !== false && Array.isArray(b.pages)) for (const p of b.pages) s.add(String(p));
      setTvBrandPages(s);
    });
  }, []);
  const isBeSightPage = (r) => !!tvBrandPages && tvBrandPages.has(String(r?.page_id || ""));
  // ข้อความนี้คือข้อความที่ถูกอ้างถึงจากลิสต์หลักฐานไหม (เทียบที่ระดับวินาที กันคลาดจากรูปแบบ ISO ที่ต่างกัน)
  const isHl = (m) => {
    if (!highlightAt || !m?.at) return false;
    const a = new Date(m.at).getTime(), b = new Date(highlightAt).getTime();
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1000;
  };
  // ข้อความนี้เป็นไทยเป็นหลักไหม (เช็คฝั่งเบราว์เซอร์ ตรรกะเดียวกับฝั่งเซิร์ฟเวอร์)
  // ใช้ตัดสินว่าจะขึ้น "กำลังแปล..." ใต้ข้อความไหน — ข้อความไทยไม่ต้องแปลอยู่แล้ว ไม่ต้องขึ้นให้รก
  const isThaiText = (s) => {
    const str = String(s || "");
    const thai = (str.match(/[฀-๿]/g) || []).length;
    const letters = (str.match(/\p{L}/gu) || []).length;
    return letters > 0 && thai / letters > 0.5;
  };
  // hash ข้อความ (djb2) — ต้องตรงกับฝั่ง edge (messenger-reply) เพื่อ lookup คำแปลด้วยตัวข้อความ ไม่ใช่ index
  const hashText = (s) => { let h = 5381; const str = String(s || ""); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };
  const thOf = (m) => translations[hashText(String(m?.t || ""))];   // คำแปลของ "ข้อความนี้" (จับด้วย hash)
  // ควรโชว์บรรทัดคำแปลใต้ข้อความนี้ไหม
  const showTh = (m) => !!thOf(m) || (translating && !isThaiText(m.t));
  const srcLabel = (r) => (r?.source === "line" ? "LINE OA" : r?.source === "instagram" ? "Instagram" : r?.entry_ad_id ? `#${r.entry_ad_id}` : r?.source === "ad" ? "โฆษณา (ไม่ทราบ id)" : r?.source === "organic" ? "ออร์แกนิก" : "ไม่ทราบ");

  const activeIds = pageSel.mode === "single" ? (pageSel.single ? [pageSel.single] : []) : pageSel.multi;
  // รูปหัวมุมซ้าย: โชว์เฉพาะเมื่อเจาะจงได้ว่าเป็น "เพจเดียว" จริง ๆ — ไม่งั้น (ทุกเพจ/หลายเพจ) โชว์ไอคอนกลาง
  // เดิม fallback ไป pageOptions[0] ทำให้ขึ้นรูปเพจแรกทั้งที่ชื่อบอกว่า "ทุกเพจ" = ดูเหมือนรูปผิดเพจ
  const headerPageId = activeIds.length === 1 ? activeIds[0] : null;
  const showPageBadge = new Set((list || []).map((x) => x.page_id)).size > 1;  // แสดงเพจต่อลูกค้าเมื่อดูหลายเพจ
  const headerName = pageSel.mode === "single"
    ? (pageOptions.find((p) => p.id === pageSel.single)?.name || "เลือกเพจ")
    : (activeIds.length === 0 ? "ทุกเพจ" : activeIds.length === 1 ? (pageOptions.find((p) => p.id === activeIds[0])?.name || "") : `${activeIds.length} เพจ`);

  return (
    // มือถือ: เต็มจอ (chat-shell ใช้ dvh ใน index.css) ไม่มีขอบมน — เดสก์ท็อป: การ์ด 82vh มีขอบมน
    <div className="chat-shell bg-white md:rounded-2xl border-0 md:border border-slate-200 md:shadow-sm overflow-hidden flex relative">
      {/* ดูรูปแบบขยายเต็มจอ (คลิกรูปในแชท) — กดพื้นดำ/ปุ่ม X เพื่อปิด · คลิกขวาที่รูปเพื่อ Save ได้ */}
      {lightbox && (
        <div className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)", right: "calc(env(safe-area-inset-right, 0px) + 16px)" }}
            className="fixed w-12 h-12 rounded-full bg-white text-slate-900 flex items-center justify-center shadow-lg hover:bg-slate-100 z-20"
            aria-label="ปิด"
          >
            <X size={26} />
          </button>
          {/* คลิกที่รูปไม่ปิด (กันปิดตอนจะคลิกขวา Save) — คลิกพื้นดำรอบ ๆ ถึงจะปิด */}
          <img
            src={lightbox}
            alt="รูปขยาย"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
          <a
            href={lightbox}
            download
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
            className="fixed left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white text-slate-900 text-sm font-medium shadow-lg hover:bg-slate-100 z-20"
          >
            ⬇︎ บันทึกรูป
          </a>
        </div>
      )}
      {/* popup เตือนแชทค้างอ่าน — กะพริบจนกว่าจะเปิดอ่าน/กดปิด */}
      {overdueAlert && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 animate-pulse">
          <div className="bg-rose-600 text-white rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-3 border-2 border-rose-300">
            <span className="text-sm font-bold whitespace-nowrap">🔴 {overdueAlert.count} แชทค้างอ่านเกิน {alertMin} นาที</span>
            <span className="text-xs opacity-90 hidden sm:inline truncate max-w-[260px]">({overdueAlert.pages.join(", ")})</span>
            {/* บอกให้ชัดว่าแชทที่ค้างอยู่คนละเพจกับที่กำลังเปิดดู — กันงงว่า "ไม่เห็นมีแชทค้างสักหน่อย" */}
            {overdueAlert.outOfView && (
              <span className="text-[11px] bg-white/20 rounded px-1.5 py-0.5 shrink-0">อยู่เพจอื่น</span>
            )}
            <button
              onClick={() => {
                // ถ้าแชทค้างอยู่นอกเพจที่กรองอยู่ ให้สลับตัวกรองไปเพจนั้นก่อน ไม่งั้นกดแล้วจอว่าง
                const ids = overdueAlert.pageIds || [];
                if (overdueAlert.outOfView && ids.length) {
                  savePageSel(ids.length === 1
                    ? { ...pageSel, mode: "single", single: ids[0] }
                    : { ...pageSel, mode: "multi", multi: ids });
                }
                setListTab("all");
                setOverdueAlert(null);
              }}
              className="bg-white text-rose-700 rounded-full px-2.5 py-1 text-xs font-semibold shrink-0 hover:bg-rose-50"
            >
              ดูเลย
            </button>
            <button onClick={() => setOverdueAlert(null)} className="text-white/80 hover:text-white shrink-0" title="ปิดชั่วคราว (จะเด้งอีกถ้ายังค้าง)"><X size={15} /></button>
          </div>
        </div>
      )}
      {/* ซ้าย: หัวเพจ + แท็บ + ลิสต์ (มือถือ: เต็มจอ, ซ่อนเมื่อเปิดแชท) */}
      <div className={`w-full md:w-80 border-r border-slate-200 flex-col shrink-0 ${selected ? "hidden md:flex" : "flex"}`}>
        {/* หัว: โลโก้+ชื่อเพจ + dropdown เลือกเพจ */}
        <div className="p-2.5 border-b border-slate-200 relative">
          <button onClick={() => setPageMenuOpen((o) => !o)} className="flex items-center gap-2 w-full text-left hover:bg-slate-50 rounded-lg p-1">
            <div className="w-9 h-9 rounded-full bg-slate-100 overflow-hidden shrink-0 border border-slate-200 flex items-center justify-center relative">
              {headerPageId ? (
                <>
                  {/* ตัวย่อชื่อเพจเป็นพื้นหลังเสมอ — ถ้ารูปโหลดไม่ขึ้นก็ยังเห็นตัวอักษร ไม่ว่างเปล่า */}
                  <span className="text-[11px] font-bold text-slate-500">{(headerName || "?").slice(0, 2)}</span>
                  {/* key=URL → พอ pagePics โหลด URL ที่ดีมา img จะ remount แล้วลองใหม่ (แก้บั๊กซ่อนถาวรเมื่อ fallback graph พลาด) */}
                  <img key={pagePic(headerPageId)} src={pagePic(headerPageId)} alt="" referrerPolicy="no-referrer" decoding="async" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                </>
              ) : <MessageSquare size={16} className="text-slate-400" />}
            </div>
            <span className="font-bold text-slate-800 truncate flex-1">{headerName}</span>
            <ChevronDown size={18} className={`text-slate-400 shrink-0 transition-transform ${pageMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {pageMenuOpen && (
            <div className="absolute top-full left-2.5 right-2.5 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 p-2">
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 text-xs mb-2">
                {[["single", "เพจเดียว"], ["multi", "หลายเพจ"]].map(([k, l]) => (
                  <button key={k} onClick={() => savePageSel({ ...pageSel, mode: k })} className={`flex-1 rounded-md px-2 py-1 font-medium ${pageSel.mode === k ? "seg-on" : "text-slate-500"}`}>{l}</button>
                ))}
              </div>
              <div className="max-h-60 overflow-y-auto space-y-0.5">
                {pageOptions.length === 0 && <div className="text-xs text-slate-400 px-2 py-2">ยังไม่มีเพจ (ซิงก์ก่อน)</div>}
                {pageOptions.map((p) => pageSel.mode === "single" ? (
                  <button key={p.id} onClick={() => { savePageSel({ ...pageSel, single: p.id }); setPageMenuOpen(false); }} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 ${pageSel.single === p.id ? "bg-indigo-50" : ""}`}>
                    <img src={pagePic(p.id)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="w-7 h-7 rounded-full object-cover bg-slate-100 shrink-0" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    <span className="text-sm text-slate-700 truncate">{p.name}</span>
                  </button>
                ) : (
                  <label key={p.id} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={pageSel.multi.includes(p.id)} onChange={(e) => { const m = e.target.checked ? [...pageSel.multi, p.id] : pageSel.multi.filter((x) => x !== p.id); savePageSel({ ...pageSel, multi: m }); }} className="w-4 h-4" />
                    <img src={pagePic(p.id)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="w-7 h-7 rounded-full object-cover bg-slate-100 shrink-0" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    <span className="text-sm text-slate-700 truncate">{p.name}</span>
                  </label>
                ))}
              </div>
              {pageSel.mode === "multi" && <div className="text-[10px] text-slate-400 mt-1 px-1">ติ๊กเพจที่ต้องการดูรวมกัน (ไม่ติ๊ก = ทุกเพจ)</div>}
            </div>
          )}
        </div>
        {/* แท็บ + ค้นหา */}
        <div className="p-2.5 border-b border-slate-200 space-y-2">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 text-xs">
            {[["all", "Messenger"], ...(INBOX_LINE_OA_ENABLED ? [["line", "LINE OA"]] : []), ...(INBOX_COMMENTS_ENABLED ? [["comments", "ความคิดเห็น"]] : [])].map(([k, label]) => (
              <button key={k} onClick={() => setListTab(k)} className={`relative flex-1 rounded-md px-1.5 py-1 font-medium whitespace-nowrap ${listTab === k ? "seg-on" : "text-slate-500 hover:text-slate-700"}`}>
                {label}
                {k === "comments" && commentUnreadCount > 0 && <span className="absolute top-0.5 right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" title={`มีความคิดเห็นใหม่ ${commentUnreadCount} รายการ`} />}
                {k === "line" && lineUnreadCount > 0 && <span className="absolute top-0.5 right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" title={`มีแชท LINE ใหม่ ${lineUnreadCount} รายการ`} />}
                {k === "all" && messengerUnreadCount > 0 && <span className="absolute top-0.5 right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" title={`มีแชท Messenger ใหม่ ${messengerUnreadCount} รายการ`} />}
              </button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ/ข้อความ/ประเทศ" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <button onClick={() => setShowBlocked((v) => !v)} className={`mt-1 self-start text-[11px] font-medium flex items-center gap-1 ${showBlocked ? "text-rose-600" : "text-slate-400 hover:text-slate-600"}`}>
            <AlertTriangle size={12} /> {showBlocked ? "← กลับไปแชทปกติ" : "ดูที่บล็อกไว้ (สแปม)"}
          </button>
          {/* แจ้งเตือนแชทค้างอ่าน — แอดมินคุมทั้งหมด ผู้ใช้ไม่มีปุ่มปรับ
              เหลือแค่แถบ "ขออนุญาตแจ้งเตือน" ที่ต้องให้ผู้ใช้กดเอง เพราะเบราว์เซอร์บังคับว่า
              ต้องมาจากการคลิกของผู้ใช้เท่านั้น สั่งเปิดจากโค้ดล่วงหน้าไม่ได้ */}
          {/* iOS + เปิดใน Safari (ไม่ใช่ PWA) = แจ้งเตือนใช้ไม่ได้ → บอกให้ไปเพิ่มหน้าจอโฮมแทน */}
          {alertAllowed && notifPerm !== "granted" && iosSafariNotStandalone && (
            <div className="w-full rounded-lg bg-sky-50 border border-sky-200 text-sky-800 px-2 py-1.5 text-[11px]">
              📲 บน iPhone: กดปุ่มแชร์ ⬆️ ด้านล่าง → <b>"เพิ่มไปยังหน้าจอโฮม"</b> แล้วเปิดแอปจากไอคอนนั้น แจ้งเตือนถึงจะใช้ได้
            </div>
          )}
          {alertAllowed && notifPerm !== "granted" && !iosSafariNotStandalone && (
            <button
              onClick={askNotifPermission}
              className="w-full rounded-lg bg-amber-500 text-white px-2 py-1.5 text-[11px] font-medium hover:bg-amber-600 text-left"
              title="ต้องอนุญาตครั้งเดียวต่อเครื่อง เพื่อให้แจ้งเตือนเด้งทับแอปอื่นได้"
            >
              {notifPerm === "denied"
                ? "🚫 การแจ้งเตือนถูกบล็อกไว้ — กดเพื่อดูวิธีเปิด (จำเป็นสำหรับเตือนแชทค้าง)"
                : "🔔 กดเพื่อเปิดการแจ้งเตือนแชทค้างอ่าน (ต้องทำครั้งเดียวต่อเครื่อง)"}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {listError && list === null ? (
            <div className="p-6 text-center space-y-3">
              <div className="text-sm font-semibold text-rose-600">โหลดแชทไม่สำเร็จ</div>
              <div className="text-xs text-slate-500 break-words">{listError}</div>
              <button type="button" onClick={() => loadList()} disabled={loadingList} className="px-4 py-2 rounded-lg bg-amber-400 text-slate-950 text-xs font-semibold hover:bg-amber-300 disabled:opacity-50">
                {loadingList ? "กำลังลองใหม่..." : "ลองโหลดใหม่"}
              </button>
            </div>
          ) : list === null ? <div className="p-4"><Spinner label="กำลังโหลด..." /></div>
            : filtered.length === 0 ? <div className="p-6 text-center text-xs text-slate-400">ไม่มีแชท</div>
              : filtered.map((x) => (
                <button key={x.id} onClick={() => openChat(x)} className={`w-full text-left p-3 hover:bg-slate-50 flex gap-2.5 ${selected?.id === x.id ? "bg-indigo-50 chat-item-active" : ""}`}>
                  <div className="relative shrink-0">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-semibold relative overflow-hidden">
                      <span>{initial(x.customer_name)}</span>
                      {x.profile_pic && <img src={x.profile_pic} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                    </div>
                    {x.unread && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 border-2 border-white shadow" />}
                    {showPageBadge && x.page_id && <img src={pagePic(x.page_id)} alt="" title={x.page_name || ""} referrerPolicy="no-referrer" loading="lazy" decoding="async" className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white bg-white object-cover shadow" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {x.unread && <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />}
                        <span className={`text-sm truncate ${x.unread ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>{x.customer_name || "(ไม่มีชื่อ)"}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">{fmt(x.last_message_at)}</span>
                    </div>
                    {/* ข้อ 3: ถ้าแอดมินตอบทีหลังลูกค้า ให้โชว์ข้อความแอดมินพร้อมชื่อคนตอบ ไม่งั้นโชว์ข้อความลูกค้า */}
                    {(() => {
                      const replyNewer = x.last_reply_at && (!x.last_message_at || new Date(x.last_reply_at).getTime() >= new Date(x.last_message_at).getTime() - 1000) && x.last_reply_text;
                      if (replyNewer) return (
                        <div className="text-xs text-slate-500 truncate">
                          <span className="text-emerald-600 font-medium">{x.last_reply_by ? `${x.last_reply_by}: ` : "เพจ: "}</span>
                          {x.last_reply_text}
                        </div>
                      );
                      return <div className="text-xs text-slate-500 truncate">{x.last_user_text || "-"}</div>;
                    })()}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {(showPageBadge || isCommentChat(x)) && x.page_name && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 max-w-[160px]">
                          <img src={pagePic(x.page_id)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="w-4 h-4 rounded-full object-cover shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          <span className="truncate">{x.page_name}</span>
                        </span>
                      )}
                      {x.country && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-600">{x.country}</span>}
                      {isCommentChat(x)
                        ? <>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${isInstagramComment(x) ? "bg-fuchsia-100 text-fuchsia-700" : "bg-sky-100 text-sky-700"}`}>
                              {isInstagramComment(x) ? "◎ IG" : "f Facebook"} · {x.comment_is_ad ? "คอมเมนต์จาก Ads" : "คอมเมนต์จากโพสต์"}
                            </span>
                            {x.comment_is_ad && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 max-w-[180px] truncate" title={x.comment_ad_name || x.entry_ad_id || ""}>
                              {x.comment_ad_name || `Ad ID ${x.entry_ad_id || "-"}`}
                            </span>}
                          </>
                        : x.source === "line"
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#06C755]/15 text-[#009b43] font-semibold">LINE OA</span>
                        : x.source === "instagram"
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 font-semibold">◎ Instagram</span>
                          : (x.entry_ad_id || x.source === "ad") && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">{x.entry_ad_id ? `แอด` : "โฆษณา"}</span>}
                    </div>
                  </div>
                </button>
              ))}
        </div>
      </div>

      {/* กลาง: หน้าต่างแชท — มือถือ: fixed เต็มจอแบบ Messenger (header ติดบน / ข้อความเลื่อนกลาง / ช่องพิมพ์ติดล่าง)
          เดสก์ท็อป: inline ในการ์ดปกติ */}
      <div className={`min-w-0 flex-col ${selected
        ? "flex fixed inset-0 z-40 bg-white h-[100dvh] md:static md:z-auto md:h-auto md:inset-auto md:flex-1"
        : "hidden md:flex md:flex-1"}`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">เลือกลูกค้าเพื่อเริ่มตอบ</div>
        ) : (
            <>
              {/* หัวแชท: back(มือถือ) + รูปลูกค้า + ชื่อ + มาจากแอด(กดขยาย) + แฮมเบอร์เกอร์
                  บนมือถือ (fixed เต็มจอ) เว้น safe-area บน กัน header ทับแถบสถานะ/นาฬิกา */}
              <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 shrink-0 bg-white" style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}>
                <button className="md:hidden p-1 -ml-1 text-slate-600" onClick={() => { setSelected(null); setInfoOpen(false); setStatusMenuOpen(false); }}><ArrowLeft size={20} /></button>
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-semibold shrink-0 relative overflow-hidden">
                  <span>{initial(selected.customer_name)}</span>
                  {selected.profile_pic && <img src={selected.profile_pic} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800 truncate">{selected.customer_name || "(ไม่มีชื่อ)"}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selected.page_name && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 max-w-[45vw] sm:max-w-[240px]">
                        <img src={pagePic(selected.page_id)} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        <span className="truncate">{selected.page_name}</span>
                      </span>
                    )}
                    <button onClick={() => setInfoOpen((o) => !o)} className="text-[11px] text-slate-500 flex items-center gap-1 hover:text-indigo-600 shrink-0">
                      มาจาก {adSources.length ? `แอด ${adSources.length} ตัว` : srcLabel(selected)} <ChevronDown size={12} className={infoOpen ? "rotate-180" : ""} />
                    </button>
                  </div>
                </div>
                <button onClick={() => setStatusMenuOpen((o) => !o)} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded md:hidden"><Menu size={20} /></button>
              </div>

              {/* แผงรายละเอียดแอด (กดขยายจากหัวแชท) */}
              {infoOpen && (
                <div className="border-b border-slate-200 p-3 max-h-72 overflow-y-auto bg-slate-50/60 space-y-2">
                  <div className="text-[11px] text-slate-500">ประเทศ: {selected.country || "ไม่ทราบ"} · ภาษา: {selected.cust_lang || "-"} · {selected.source === "line" ? "LINE User ID" : "FB"} {selected.psid || "-"}</div>
                  <div className="text-xs text-slate-400">มาจากแอด{adSources.length ? ` (${adSources.length})` : ""}</div>
                  {adLoading && <div className="text-[11px] text-slate-400">กำลังโหลดข้อมูลแอด...</div>}
                  {!adLoading && adSources.length === 0 && <div className="text-[11px] text-slate-500">{srcLabel(selected)}</div>}
                  {adSources.map(renderAd)}
                </div>
              )}
              {/* แผงปรับสถานะ (แฮมเบอร์เกอร์ — มือถือ) */}
              {statusMenuOpen && (
                <div className="border-b border-slate-200 p-3 space-y-2 bg-white md:hidden">
                  <div className="flex gap-2">
                    {selected.unread
                      ? <button onClick={() => setUnread(false)} className="flex-1 text-xs border border-emerald-300 text-emerald-700 rounded-lg px-2 py-1.5">ทำเป็นอ่านแล้ว</button>
                      : <button onClick={() => setUnread(true)} className="flex-1 text-xs border border-slate-300 text-slate-500 rounded-lg px-2 py-1.5">ทำเป็นยังไม่อ่าน</button>}
                  </div>
                  {isBeSightPage(selected) && <>
                    <CustomerDataForm row={selected} onSaved={(v) => { setSelected((s) => (s ? { ...s, ...v } : s)); setList((l) => (l || []).map((x) => (x.id === selected.id ? { ...x, ...v } : x))); }} />
                    <TradeIdChecker />
                  </>}
                  <button onClick={() => blockCustomer(selected.id, !selected.blocked_at)} disabled={blocking}
                    className={`w-full text-xs rounded-lg px-2 py-1.5 font-medium flex items-center justify-center gap-1 disabled:opacity-50 ${selected.blocked_at ? "border border-emerald-300 text-emerald-700" : "border border-rose-200 text-rose-600"}`}>
                    {blocking ? <Loader2 className="animate-spin" size={13} /> : <AlertTriangle size={13} />} {selected.blocked_at ? "ปลดบล็อก" : "บล็อก (สแปม)"}
                  </button>
                </div>
              )}
              {/* แบนเนอร์บอกแพลตฟอร์มและว่าเป็นคอมเมนต์จากโพสต์/แอดไหน */}
              {isCommentChat(selected) && (
                <div className={`px-3 py-2 border-b text-[11px] shrink-0 ${isInstagramComment(selected) ? "border-fuchsia-200 bg-fuchsia-50" : "border-sky-200 bg-sky-50"}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-white font-semibold ${isInstagramComment(selected) ? "bg-gradient-to-r from-fuchsia-600 to-orange-500" : "bg-sky-600"}`}>
                        {isInstagramComment(selected) ? "◎ IG" : "f Facebook"} · {selected.comment_is_ad ? "คอมเมนต์จาก Ads" : "คอมเมนต์จากโพสต์ปกติ"}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-white border border-sky-200 text-sky-800 max-w-full truncate">เพจ: {selected.page_name || selected.page_id}</span>
                      {selected.comment_is_ad && <span className="px-2 py-0.5 rounded-full bg-white border border-purple-200 text-purple-800 max-w-full truncate">
                        Ads: {(selected.comment_ad_names?.length ? selected.comment_ad_names.join(", ") : selected.comment_ad_name) || "-"}
                      </span>}
                      {selected.comment_is_ad && <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 max-w-full break-all">
                        Ad ID: {(selected.comment_ad_ids?.length ? selected.comment_ad_ids.join(", ") : selected.entry_ad_id) || "-"}
                      </span>}
                    </div>
                  {selected.comment_permalink && (
                    <a href={selected.comment_permalink} target="_blank" rel="noopener noreferrer" className="shrink-0 text-indigo-600 hover:text-indigo-500 hover:underline inline-flex items-center gap-1 font-medium">
                      {isInstagramComment(selected) ? "Instagram" : "Facebook"} <ArrowUpCircle size={11} className="rotate-45" />
                    </a>
                  )}
                  </div>
                  <div className="mt-2 inline-flex rounded-lg border border-sky-200 bg-white px-2.5 py-1 font-semibold text-sky-700">ตอบใต้คอมเมนต์</div>
                </div>
              )}
              {selected.source === "instagram" && (
                <div className="px-3 py-2 border-b border-fuchsia-200 bg-fuchsia-50 text-[11px] shrink-0 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-fuchsia-600 to-orange-500 text-white font-semibold">◎ Instagram DM</span>
                  <span className="text-fuchsia-800 truncate">บัญชี: {selected.page_name || selected.page_id}</span>
                </div>
              )}
              {selected.source === "line" && (
                <div className="px-3 py-2 border-b border-emerald-200 bg-emerald-50 text-[11px] shrink-0 flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-[#06C755] text-white font-semibold">LINE OA</span>
                  <span className="text-emerald-800 truncate">บัญชี: {selected.page_name || "LINE Official Account"}</span>
                  <span className="text-amber-700 md:ml-auto">คำตอบจาก LINE OA Manager ไม่ถูกส่งออกทาง API · ตอบจากแอปนี้เพื่อให้ประวัติครบ</span>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50/40">
                {selected.transcript === null ? <Spinner label="กำลังโหลดบทสนทนา..." /> : <>{tItems.map((m, i) => (
                  m.w === "p" ? (
                    <div key={i} data-msg-at={m.at || undefined} data-msg-mid={m.mid || undefined} className={`flex flex-col items-end group ${isHl(m) ? "scroll-mt-20" : ""} ${m.pending ? "opacity-60" : ""}`}>
                      <div className="relative max-w-[80%] flex flex-col items-end">
                        {m.reply_to_text && (
                          <button type="button" onClick={() => goToReplyTarget(m)} className="mb-1 w-full max-h-32 overflow-y-auto rounded-xl border border-indigo-300/40 bg-slate-900/70 px-3 py-2 text-left text-[11px] leading-relaxed text-slate-300 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400">
                            <span className="mb-1 block font-semibold text-indigo-300">↩︎ ตอบกลับ · คลิกเพื่อไปยังข้อความต้นทาง</span>
                            <span className="flex items-start gap-2">
                              {m.reply_to_img && <img src={m.reply_to_img} alt="รูปที่ตอบกลับ" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
                              <span className="min-w-0 whitespace-pre-wrap break-words">{m.reply_to_text}</span>
                            </span>
                          </button>
                        )}
                        {m.img
                          ? <button type="button" onClick={() => setLightbox(m.img)} className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-300 cursor-zoom-in" aria-label="ดูรูปขยาย">
                              {(m.sticker || m.t === "[สติกเกอร์]")
                                ? <img src={m.img} alt="สติกเกอร์" className="w-40 max-w-full object-contain" />
                                : <img src={m.img} alt="รูปที่ส่ง" className="max-w-full max-h-60 rounded-2xl object-contain" />}
                            </button>
                          : <>
                            <button type="button" onClick={() => openMessageMenu(i, m, "admin")} className="chat-bubble-me block w-full text-left text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-300">{m.t}</button>
                            {showTh(m) && (
                              <div className="text-[11px] text-indigo-300 mt-0.5 px-1 whitespace-pre-wrap break-words text-right">🇹🇭 {thOf(m) || "กำลังแปล..."}</div>
                            )}
                          </>}
                        {MSG_REPLY_ENABLED && messageMenu?.index === i && messageMenu?.side === "admin" && (
                          <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                            <button onClick={() => { setReplyTo({ text: messageMenu.text, img: messageMenu.img, mid: messageMenu.mid, at: messageMenu.at, side: "admin" }); setMessageMenu(null); }} className="block w-full px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">↩︎ ตอบกลับข้อความนี้</button>
                          </div>
                        )}
                      </div>
                      {/* ผู้ตอบ: ส่งจากแอปเรารู้อีเมล (m.by) · ตอบจากกล่องข้อความเพจ Meta ไม่ส่งชื่อมา = "ตอบจากเพจ" */}
                      <div className="text-[10px] text-slate-400 mt-0.5 pr-1 flex items-center gap-1">
                        <span className="text-emerald-600 font-medium">{m.by || "ตอบจากเพจ"}</span>
                        <span>{fmtMsgTime(m.at)}</span>
                        {m.pending
                          ? <span className="text-amber-500">· กำลังส่ง…</span>
                          : isLastPageMsg(i) && custReadStatus(m) && (
                            <span className={custReadStatus(m).read ? "text-sky-500" : "text-slate-400"}>· {custReadStatus(m).label}</span>
                          )}
                      </div>
                    </div>
                  ) : (
                    <div key={i} data-msg-at={m.at || undefined} data-msg-mid={m.mid || undefined} className="flex flex-col items-start group scroll-mt-20">
                      {/* ไฮไลต์ข้อความที่ถูกอ้างถึงจากลิสต์หลักฐาน (ตอบช้า/ยังไม่ตอบ) */}
                      {isHl(m) && (
                        <div className="text-[10px] font-semibold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 mb-1">
                          ⬇ ข้อความนี้คือรอบที่{selected?.awaiting_reply && i === tItems.length - 1 ? "ยังไม่ได้ตอบ" : "ตอบช้า"}
                        </div>
                      )}
                      <div className={`relative max-w-[80%] ${isHl(m) ? "ring-2 ring-amber-400 rounded-2xl" : ""}`}>
                        {m.img
                          ? <button type="button" onClick={() => setLightbox(m.img)} className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-zoom-in" aria-label="ดูรูปขยาย">
                              {(m.sticker || m.t === "[สติกเกอร์]")
                                ? <img src={m.img} alt="สติกเกอร์" className="w-40 max-w-full object-contain" />
                                : <img src={m.img} alt="รูปลูกค้า" className="max-w-full max-h-60 rounded-2xl object-contain" />}
                            </button>
                          : <>
                              <button type="button" onClick={() => openMessageMenu(i, m, "customer")} className="block w-full text-left bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words text-slate-800 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300">{m.t}</button>
                              {showTh(m) && (
                                <div className="text-[11px] text-emerald-700 mt-0.5 px-1 whitespace-pre-wrap break-words">🇹🇭 {thOf(m) || "กำลังแปล..."}</div>
                              )}
                            </>}
                        {messageMenu?.index === i && messageMenu?.side === "customer" && (
                          <div className="absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                            {MSG_REPLY_ENABLED && <button onClick={() => { setReplyTo({ text: messageMenu.text, img: messageMenu.img, mid: messageMenu.mid, at: messageMenu.at, side: "customer" }); setMessageMenu(null); }} className="block w-full px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">↩︎ ตอบกลับข้อความนี้</button>}
                            {!m.img && <button onClick={() => beginKnowledgeCapture(m.t)} className="block w-full border-t border-slate-100 px-3 py-2.5 text-left text-xs font-medium text-indigo-700 hover:bg-indigo-50">บันทึกเข้าคลังคำถาม</button>}
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 pl-1">{fmtMsgTime(m.at)}</div>
                    </div>
                  )
                ))}<div ref={bottomRef} /></>}
              </div>
              {sendMsg && <div className="px-4 py-1.5 text-[11px] text-slate-600 border-t border-slate-100 whitespace-pre-wrap break-words">{sendMsg}</div>}
              {knowledgeCaptureMsg && !knowledgeCapture && <div className="px-4 py-1.5 text-[11px] font-medium text-emerald-700 border-t border-emerald-100 bg-emerald-50">{knowledgeCaptureMsg}</div>}
              <div className="p-3 border-t border-slate-200 relative shrink-0" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
                <div className="chat-compose-guide flex items-center gap-2 mb-2 flex-wrap rounded-xl px-3 py-2">
                  <div className="text-[11px] font-medium">✦ พิมพ์ไทย — ระบบแปลแล้วส่ง <span className="opacity-60">(Ctrl/⌘+Enter = ส่ง)</span></div>
                  <label className="chat-language-control text-[11px] flex items-center gap-1.5 ml-auto rounded-lg px-2 py-1">
                    <span className="font-semibold">🌐 แปลเป็น</span>
                    <select value={forceLang} onChange={(e) => { setForceLang(e.target.value); if (selected) lsSet(`ui.forceLang.${selected.id}`, e.target.value); }}
                      className="rounded-md border-0 px-2 py-1 text-[11px] font-semibold bg-white">
                      {LANG_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  {forceLang === "auto" && selected.cust_lang && <span className="chat-language-hint rounded-full px-2 py-1 text-[10px] font-medium">อ้างอิงภาษาหัวแชท: {selected.cust_lang}</span>}
                </div>
                {savedOpen && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto z-10 divide-y divide-slate-100">
                    {savedReplies.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-slate-500">{savedErr ? `ดึงไม่ได้: ${savedErr}` : "เพจนี้ยังไม่มีข้อความตอบกลับที่บันทึกไว้ (หรือ token ยังไม่มีสิทธิ์ pages_messaging)"}</div>
                    ) : savedReplies.map((s) => (
                      <button key={s.id} onClick={() => { if (s.message) setReply((r) => (r ? r + "\n" + s.message : s.message)); if (s.image) setPendingFiles((p) => [...p, { url: s.image, name: "saved-image", type: "image", preview: s.image }]); setSavedOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex gap-2">
                        {s.image && <img src={s.image} alt="" className="w-9 h-9 rounded object-cover border border-slate-200 shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-700 truncate">{s.title || "(ไม่มีชื่อ)"}</div>
                          <div className="text-[11px] text-slate-500 line-clamp-2 whitespace-pre-wrap break-words">{s.message}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {knowledgeOpen && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-80 overflow-hidden z-20 flex flex-col">
                    <div className="p-2 border-b border-slate-100 flex gap-2">
                      <input value={knowledgeQuery} onChange={(e) => setKnowledgeQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchKnowledge(); }} placeholder="ค้นหาคำถามหรือคำตอบเก่า..." className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                      <button onClick={() => searchKnowledge()} disabled={knowledgeLoading} className="rounded-lg bg-slate-900 text-white px-3 text-xs disabled:opacity-50">{knowledgeLoading ? "ค้นหา..." : "ค้นหา"}</button>
                      <button onClick={() => setKnowledgeOpen(false)} className="text-slate-400 px-1"><X size={16} /></button>
                    </div>
                    <div className="overflow-y-auto divide-y divide-slate-100">
                      {knowledgeErr && <div className="p-3 text-xs text-rose-600">{knowledgeErr}</div>}
                      {!knowledgeLoading && !knowledgeErr && knowledgeResults.length === 0 && <div className="p-4 text-xs text-slate-400 text-center">ยังไม่พบคำตอบที่อนุมัติแล้ว</div>}
                      {knowledgeResults.map((item) => (
                        <button key={item.id} onClick={() => {
                          setReply((r) => r ? `${r}\n${item.answer}` : item.answer);
                          setKnowledgeOpen(false);
                          supabase.functions.invoke("knowledge-base", { body: { action: "used", page_id: selected.page_id, id: item.id } });
                        }} className="w-full text-left p-3 hover:bg-slate-50">
                          <div className="text-xs font-medium text-slate-700 whitespace-pre-wrap">KW: {item.question}</div>
                          <div className="text-xs text-emerald-700 mt-1 whitespace-pre-wrap">A: {item.answer}</div>
                          <div className="text-[10px] text-slate-400 mt-1">เคยใช้ {item.use_count || 0} ครั้ง</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {replyTo && (
                  <div className="flex items-start justify-between gap-2 bg-slate-100 rounded-lg px-3 py-2 mb-1 text-xs">
                    <div className="min-w-0 flex items-start gap-2">
                      {replyTo.img && <img src={replyTo.img} alt="รูปที่อ้างอิง" className="h-10 w-10 shrink-0 rounded-md object-cover" />}
                      <span className="text-slate-600 whitespace-pre-wrap break-words line-clamp-3">↩︎ ตอบกลับ: {String(replyTo.text)}</span>
                    </div>
                    <button onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-slate-700 shrink-0"><X size={14} /></button>
                  </div>
                )}
                {/* รูป/ไฟล์ที่พักไว้รอส่ง — ลบได้ */}
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pendingFiles.map((pf, idx) => (
                      <div key={idx} className="relative group">
                        {pf.preview
                          ? <img src={pf.preview} alt="" className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
                          : <div className="w-16 h-16 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-[9px] text-slate-500 text-center p-1 break-all">{pf.name}</div>}
                        <button onClick={() => removePending(idx)} className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center shadow" title="ลบ"><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="chat-tool-row flex flex-wrap items-center gap-1.5 mb-2 relative overflow-visible pb-1">
                  {MSG_EMOJI_ENABLED && <button onClick={() => setEmojiOpen((o) => !o)} className={`chat-tool-button chat-tool-emoji ${emojiOpen ? "is-active" : ""}`} title="อิโมจิ (แทรกในข้อความ)"><span className="text-base leading-none">😊</span><span>อีโมจิ</span></button>}
                  <button onClick={() => fileInputRef.current?.click()} disabled={isCommentChat(selected)} className="chat-tool-button chat-tool-attach disabled:opacity-30" title={isCommentChat(selected) ? "การตอบใต้คอมเมนต์ไม่รองรับไฟล์แนบ" : "แนบไฟล์/รูป"}><Paperclip size={16} /><span>แนบไฟล์</span></button>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFile} accept="image/*,video/*,application/pdf" />
                  <button onClick={() => setSavedOpen((o) => !o)} className={`chat-tool-button chat-tool-saved ${savedOpen ? "is-active" : ""}`} title="ข้อความตอบกลับที่บันทึกไว้"><MessageSquare size={16} /><span>ข้อความบันทึก</span><b>{savedReplies.length}</b></button>
                  <button onClick={openKnowledgeSearch} className={`chat-tool-button chat-tool-knowledge ${knowledgeOpen ? "is-active" : ""}`} title="ค้นหาคำตอบเก่าที่อนุมัติแล้ว"><Search size={16} /><span>คลังคำตอบ</span></button>
                  {MSG_EMOJI_ENABLED && emojiOpen && (
                    <div className="absolute bottom-full left-0 z-40 mb-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
                      <React.Suspense fallback={<Spinner label="กำลังโหลดอิโมจิ..." />}>
                        <EmojiPicker theme="dark" emojiStyle="facebook" width="100%" height={390} lazyLoadEmojis searchPlaceHolder="ค้นหาอิโมจิ..." previewConfig={{ showPreview: false }} onEmojiClick={(emojiData) => { setReply((current) => current + emojiData.emoji); setSendPreview(null); }} />
                      </React.Suspense>
                    </div>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <textarea value={reply} onChange={(e) => { setReply(e.target.value); setSendPreview(null); }} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) prepareSendPreview(); }} rows={2} placeholder="พิมพ์คำตอบเป็นไทย..." className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none" />
                  <button onClick={prepareSendPreview} disabled={sending || (!reply.trim() && pendingFiles.length === 0)} className="ds-btn-primary text-white rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5 shrink-0">
                    {sending ? <Loader2 className="animate-spin" size={15} /> : (!reply.trim() && pendingFiles.length > 0) ? <ArrowUpCircle size={15} /> : <Eye size={15} />} {(!reply.trim() && pendingFiles.length > 0) ? "ส่งรูป" : "ตัวอย่าง"}
                  </button>
                </div>
              </div>
              {knowledgeCapture && (
                <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !knowledgeCaptureSaving) setKnowledgeCapture(null); }}>
                  <div className="w-full max-w-xl max-h-[85dvh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
                      <div>
                        <div className="font-semibold text-slate-800">บันทึกเข้าคลังคำถาม</div>
                        <div className="text-xs text-slate-500 mt-0.5">เพจ: {selected.page_name || selected.page_id} · ขั้นตอน {knowledgeCapture.step === "question" ? "1/2 กำหนดคำค้น" : "2/2 เลือกคำตอบของแอดมิน"}</div>
                      </div>
                      <button onClick={() => setKnowledgeCapture(null)} disabled={knowledgeCaptureSaving} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50"><X size={18} /></button>
                    </div>
                    {knowledgeCapture.step === "question" ? (
                      <div className="p-4 space-y-3">
                        <label className="block text-xs text-slate-600">คำค้น / Keywords
                          <textarea autoFocus rows={5} value={knowledgeCapture.question} onChange={(e) => setKnowledgeCapture((current) => ({ ...current, question: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 resize-y" />
                          <span className="mt-1 block text-[10px] text-slate-400">ปรับให้เหลือคำหรือวลีสำคัญ เช่น เปิดบัญชีเพิ่ม, เพิ่มบัญชี XM</span>
                        </label>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setKnowledgeCapture(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">ยกเลิก</button>
                          <button onClick={() => setKnowledgeCapture((current) => ({ ...current, step: "answer" }))} disabled={!knowledgeCapture.question.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">ตกลง เลือกคำตอบ</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="overflow-y-auto p-4 space-y-2">
                          <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 whitespace-pre-wrap"><span className="font-semibold">คำค้น:</span> {knowledgeCapture.question}</div>
                          <div className="text-xs font-medium text-slate-600 pt-1">เลือกข้อความที่แอดมินตอบเพื่อใช้เป็นคำตอบ</div>
                          {tItems.filter((message) => message.w === "p" && !message.img && String(message.t || "").trim()).length === 0 && <div className="rounded-lg border border-slate-200 p-4 text-center text-xs text-slate-400">ยังไม่มีข้อความคำตอบจากแอดมินในแชทนี้</div>}
                          {tItems
                            .map((message, index) => ({ message, index }))
                            .filter(({ message }) => message.w === "p" && !message.img && String(message.t || "").trim())
                            .reverse()
                            .map(({ message: answerMessage, index: answerIndex }, displayIndex) => (
                              <button key={answerIndex} onClick={() => setKnowledgeCapture((current) => ({ ...current, answer: answerMessage.t, answerIndex }))} className={`w-full rounded-xl border p-3 text-left transition-colors ${knowledgeCapture.answerIndex === answerIndex ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-400" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"}`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">{answerMessage.t}</div>
                                  {displayIndex === 0 && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">ล่าสุด</span>}
                                </div>
                                <div className="mt-1 text-[10px] text-slate-400">{answerMessage.by || "ตอบจากเพจ"} · {fmtMsgTime(answerMessage.at)}</div>
                              </button>
                            ))}
                          {knowledgeCaptureMsg && <div className="text-xs text-rose-600">{knowledgeCaptureMsg}</div>}
                        </div>
                        <div className="flex justify-between gap-2 border-t border-slate-100 p-4">
                          <button onClick={() => setKnowledgeCapture((current) => ({ ...current, step: "question" }))} disabled={knowledgeCaptureSaving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-50">ย้อนกลับ</button>
                          <button onClick={saveKnowledgeCapture} disabled={knowledgeCaptureSaving || !knowledgeCapture.answer?.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 flex items-center gap-1.5">
                            {knowledgeCaptureSaving && <Loader2 className="animate-spin" size={15} />} บันทึกเข้าคลัง
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              {sendPreview && (
                <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setSendPreview(null); }}>
                  <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-800">ตรวจข้อความก่อนส่ง</div>
                        <div className="text-xs text-slate-500">ภาษาที่จะส่ง: {sendPreview.lang || selected.cust_lang || "-"} · แก้ไขข้อความปลายทางได้</div>
                      </div>
                      <button onClick={() => setSendPreview(null)} className="p-1 text-slate-400 hover:text-slate-700"><X size={18} /></button>
                    </div>
                    {sendPreview.sourceText && sendPreview.sourceText !== sendPreview.text && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 whitespace-pre-wrap"><span className="font-semibold">ต้นฉบับไทย:</span> {sendPreview.sourceText}</div>
                    )}
                    {sendPreview.replyTo && (
                      <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2.5">
                        <div className="mb-1 text-xs font-semibold text-indigo-700">↩︎ ข้อความที่ตอบกลับ</div>
                        <div className="flex items-start gap-2">
                          {sendPreview.replyTo.img && <img src={sendPreview.replyTo.img} alt="รูปที่ตอบกลับ" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
                          <div className="max-h-48 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">{sendPreview.replyTo.text}</div>
                        </div>
                      </div>
                    )}
                    <textarea value={sendPreview.text} onChange={(e) => setSendPreview((p) => ({ ...p, text: e.target.value }))} rows={6} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm resize-y" autoFocus />
                    {pendingFiles.length > 0 && <div className="text-xs text-slate-500">ไฟล์แนบที่รอส่ง: {pendingFiles.length} รายการ</div>}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setSendPreview(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">กลับไปแก้ไข</button>
                      <button onClick={() => sendReply(sendPreview)} disabled={sending || (!sendPreview.text.trim() && pendingFiles.length === 0)} className="ds-btn-primary rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-1.5">
                        {sending ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} อนุมัติและส่ง
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ขวา: ข้อมูล + สถานะ (เดสก์ท็อปเท่านั้น — มือถือใช้แผงขยาย/แฮมเบอร์เกอร์) */}
        {selected && (
          <div className="hidden md:block md:w-64 border-l border-slate-200 p-4 space-y-4 shrink-0 overflow-y-auto">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-lg font-semibold shrink-0 relative overflow-hidden">
                <span>{initial(selected.customer_name)}</span>
                {selected.profile_pic && <img src={selected.profile_pic} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-slate-400">ลูกค้า</div>
                <div className="font-medium text-slate-800 truncate">{selected.customer_name || "-"}</div>
                <div className="text-[10px] text-slate-400 break-all">{selected.source === "line" ? "LINE" : "FB"} {selected.psid || "-"}</div>
              </div>
            </div>
            <div className="text-xs space-y-1.5">
              <div><span className="text-slate-400">ประเทศ:</span> <span className="text-slate-700">{selected.country || "ไม่ทราบ"}</span></div>
              <div><span className="text-slate-400">ภาษา:</span> <span className="text-slate-700">{selected.cust_lang || "-"}</span></div>
            </div>
            {/* มาจากแอด — โชว์ทุกแอดที่ลูกค้าทักเข้ามา พร้อมรายละเอียด + รูป/วิดีโอ */}
            <div className="space-y-2">
              <div className="text-xs text-slate-400">มาจากแอด{adSources.length ? ` (${adSources.length})` : ""}</div>
              {adLoading && <div className="text-[11px] text-slate-400">กำลังโหลดข้อมูลแอด...</div>}
              {!adLoading && adSources.length === 0 && <div className="text-[11px] text-slate-500">{srcLabel(selected)}</div>}
              {adSources.map((ad) => (
                <div key={ad.ad_id} className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50/50">
                  {ad.media_url && (ad.media_type === "video"
                    ? <video src={ad.media_url} poster={ad.thumb_url || undefined} controls className="w-full max-h-40 object-cover bg-black" />
                    : <img src={ad.media_url} alt="" className="w-full max-h-40 object-cover" />)}
                  <div className="p-2 space-y-0.5">
                    {ad.error ? <div className="text-[11px] text-slate-400">โหลดรายละเอียดแอดไม่ได้ — แอดอาจถูกลบ หรือไม่มีสิทธิ์เข้าถึงบัญชีโฆษณานี้</div> : (
                      <>
                        <div className="text-[11px] text-slate-500">แคมเปญ: <span className="text-slate-700">{ad.campaign_name || "-"}</span></div>
                        <div className="text-[11px] text-slate-500">ชุดโฆษณา: <span className="text-slate-700">{ad.adset_name || "-"}</span></div>
                        <div className="text-[11px] text-slate-500">โฆษณา: <span className="text-slate-700">{ad.name || "-"}</span></div>
                      </>
                    )}
                    <div className="text-[10px] text-slate-400 break-all">ad_id: {ad.ad_id}</div>
                  </div>
                </div>
              ))}
            </div>
            {isBeSightPage(selected) && <>
              <CustomerDataForm row={selected} onSaved={(v) => { setSelected((s) => (s ? { ...s, ...v } : s)); setList((l) => (l || []).map((x) => (x.id === selected.id ? { ...x, ...v } : x))); }} />
              <TradeIdChecker />
            </>}
            <button onClick={() => blockCustomer(selected.id, !selected.blocked_at)} disabled={blocking}
              className={`w-full rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 ${selected.blocked_at ? "border border-emerald-300 text-emerald-700 hover:bg-emerald-50" : "border border-rose-200 text-rose-600 hover:bg-rose-50"}`}>
              {blocking ? <Loader2 className="animate-spin" size={14} /> : <AlertTriangle size={14} />} {selected.blocked_at ? "ปลดบล็อก" : "บล็อก (สแปม)"}
            </button>
          </div>
        )}
      </div>
  );
}

// เช็คเลขไอดีเทรด (XM) แบบแมนวล — ยิงผ่าน edge function verify-trade-id
// เช็ค API ก่อน ถ้าไม่ผ่านค่อยเช็คอีเมล · ผ่านช่องไหนบอกช่องนั้น
function TradeIdChecker() {
  const [tid, setTid] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  async function check() {
    const id = tid.trim();
    if (!id || busy) return;
    setBusy(true); setRes(null);
    const { data, error } = await supabase.functions.invoke("verify-trade-id", { body: { trade_id: id } });
    setBusy(false);
    if (error || !data?.ok) { setRes({ error: data?.error || error?.message || "เช็คไม่สำเร็จ — อาจยังไม่ได้ deploy ฟังก์ชัน verify-trade-id" }); return; }
    setRes(data);
    logActivity("check_trade_id", { trade_id: id, pass: !!data.pass, via: data.via });
  }
  return (
    <div className="border-t border-slate-200 pt-3 mt-1 space-y-1.5">
      <label className="text-xs text-slate-400 flex items-center gap-1"><CheckCircle2 size={13} /> เช็คไอดีเทรด (XM)</label>
      <div className="flex gap-1.5">
        <input
          value={tid}
          onChange={(e) => { setTid(e.target.value); if (res) setRes(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") check(); }}
          inputMode="numeric" placeholder="วางเลขไอดีเทรด"
          className="flex-1 min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        <button onClick={check} disabled={busy || !tid.trim()}
          className="shrink-0 bg-slate-900 text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
          {busy ? <Loader2 className="animate-spin" size={14} /> : null} เช็ค
        </button>
      </div>
      {res && (res.error
        ? <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{res.error}</div>
        : res.pass
          ? <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <div className="font-semibold flex items-center gap-1"><CheckCircle2 size={14} /> ไอดีผ่าน (เช็คจาก{res.via === "email" ? "อีเมล" : " API"})</div>
              {res.via === "email" && (res.platform || res.insertdate) && (
                <div className="text-[11px] text-emerald-600 mt-0.5">{[res.platform, res.insertdate].filter(Boolean).join(" · ")}</div>
              )}
            </div>
          : <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 font-medium flex items-center gap-1">
              <AlertTriangle size={14} /> เช็คทั้งสองช่องทางแล้วไม่ผ่าน
            </div>
      )}
    </div>
  );
}

// แอดมินป้อนข้อมูลลูกค้าเอง (ไอดีเทรด/TradingView/เบอร์/อีเมล) จากหน้าตอบแชท
// บันทึกผ่าน save-lead-fields → มาร์ค manual_data + ผู้ป้อน · AI/sync/webhook จะไม่แก้ทับ
function CustomerDataForm({ row, onSaved }) {
  const [f, setF] = useState({ trade_id: "", username: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // {ok, text}
  // ฟีเจอร์ TV ในหน้าแชท — เห็นเฉพาะแอดมินจนกว่าจะกดปล่อย (settings.tv_features.released)
  const [tvOn, setTvOn] = useState(false);
  const [scripts, setScripts] = useState([]);
  const [pineIds, setPineIds] = useState([]);   // เลือก Indicator ได้หลายอัน
  // วันหมดอายุแยกต่อสคริปต์ — { [pine_id]: { mode, days, expDate } }
  const [dur, setDur] = useState({});
  const getDur = (pid) => dur[pid] || { mode: "days", days: 30, expDate: "" };
  const setDurFor = (pid, patch) => setDur((d) => ({ ...d, [pid]: { ...getDur(pid), ...patch } }));
  const toggleScript = (pid, on) => {
    setPineIds((cur) => on ? cur.filter((p) => p !== pid) : [...cur, pid]);
    if (!on) setDur((d) => (d[pid] ? d : { ...d, [pid]: { mode: "days", days: 30, expDate: "" } }));
  };
  const durLabel = (d) => d.mode === "lifetime" ? "ตลอดชีพ" : d.mode === "date" ? `ถึง ${d.expDate ? new Date(`${d.expDate}T00:00:00+07:00`).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}` : `${Number(d.days) || 30} วัน`;
  const todayTH = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const daysFromDate = (d) => { if (!d) return 0; const t = new Date(`${d}T23:59:59+07:00`).getTime(); return Math.max(1, Math.ceil((t - Date.now()) / 86400000)); };

  useEffect(() => {
    setF({ trade_id: row?.trade_id || "", username: row?.username || "", phone: row?.phone || "", email: row?.email || "" });
    setMsg(null);
  }, [row?.id, row?.trade_id, row?.username, row?.phone, row?.email]);

  // โหลด role + flag ปล่อยอัปเดต + สคริปต์ ครั้งเดียว
  // โหลด role + สถานะปล่อยอัปเดต (ครั้งเดียว)
  useEffect(() => {
    let stop = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      let admin = false;
      const email = u?.user?.email;
      if (email) { const { data: p } = await supabase.from("user_permissions").select("role").eq("email", email).maybeSingle(); admin = p?.role === "admin"; }
      const { data: tf } = await supabase.from("settings").select("value").eq("key", "tv_features").maybeSingle();
      if (stop) return;
      setTvOn(admin || tf?.value?.released === true);
    })();
    return () => { stop = true; };
  }, []);
  // โหลดสคริปต์ที่โชว์ได้ในเพจนี้ (ตามแบรนด์ที่ผูกเพจของแชท) — รีเฟรชเมื่อเปลี่ยนแชท/เพจ
  useEffect(() => {
    if (!tvOn) { setScripts([]); return; }
    let stop = false;
    (async () => {
      const [{ data: sc }, { data: br }] = await Promise.all([
        supabase.from("tv_scripts").select("*").order("created_at"),
        supabase.from("tv_brands").select("id, pages").eq("active", true),
      ]);
      if (stop) return;
      const pageId = String(row?.page_id || "");
      const allowed = new Set((br || []).filter((b) => Array.isArray(b.pages) && b.pages.map(String).includes(pageId)).map((b) => b.id));
      const list = (sc || []).filter((s) => allowed.has(s.brand_id));
      setScripts(list);
      setPineIds((cur) => cur.filter((p) => list.some((s) => s.pine_id === p)));
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvOn, row?.page_id]);

  // บันทึกลงฐานข้อมูลลูกค้า (save-lead-fields) — ใช้ซ้ำหลายเส้นทาง
  async function saveLeadFields(extraMsg) {
    const { data, error } = await supabase.functions.invoke("save-lead-fields", { body: { id: row.id, ...f } });
    if (error || !data?.ok) return { ok: false, error: data?.error || error?.message || "อาจยังไม่ได้ deploy save-lead-fields" };
    logActivity("save_lead_fields", { id: row.id, customer_name: row?.customer_name });
    onSaved?.({ trade_id: data.trade_id, username: data.username, phone: data.phone, email: data.email, manual_data: true, classified_by: "manual", needs_ai: false, needs_verify: false, manual_data_by: data.manual_data_by, manual_data_at: data.manual_data_at });
    return { ok: true };
  }

  async function save() {
    if (busy) return;
    const tradeId = f.trade_id.trim();
    const userTv = f.username.trim();
    setBusy(true); setMsg(null);

    // เส้นทางฟีเจอร์ TV (แอดมิน/ปล่อยแล้ว) และมีการป้อนไอดีเทรด/user TV
    if (tvOn && (tradeId || userTv)) {
      if (userTv && !tradeId) { setBusy(false); setMsg({ ok: false, text: "ต้องใส่ไอดีเทรดด้วยเมื่อจะเพิ่ม user TV" }); return; }
      if (userTv && !pineIds.length) { setBusy(false); setMsg({ ok: false, text: "เลือก Indicator (สคริปต์) อย่างน้อย 1 อัน" }); return; }
      if (userTv) { for (const pid of pineIds) { const d = getDur(pid); if (d.mode === "date" && (!d.expDate || d.expDate < todayTH)) { setBusy(false); setMsg({ ok: false, text: `เลือกวันหมดอายุของ "${scripts.find((s) => s.pine_id === pid)?.name || pid}" ให้ถูกต้องก่อน` }); return; } } }

      // 1) เช็คไอดีเทรด — ไม่ผ่าน = ไม่บันทึกอะไรเลย
      setMsg({ ok: true, text: "กำลังเช็คไอดีเทรด..." });
      const { data: vt, error: ve } = await supabase.functions.invoke("verify-trade-id", { body: { trade_id: tradeId } });
      if (ve || !vt?.ok) { setBusy(false); setMsg({ ok: false, text: "เช็คไอดีเทรดไม่สำเร็จ: " + (vt?.error || "ลองใหม่") }); return; }
      if (!vt.pass) { setBusy(false); setMsg({ ok: false, text: `ไอดีเทรด "${tradeId}" ไม่ผ่าน — ยังไม่บันทึก` }); return; }

      // 2) ป้อนแค่ไอดีเทรด (ไม่มี user TV) → บันทึกลงฐานข้อมูลอย่างเดียว ไม่แตะหน้าจัดการ TV
      if (!userTv) {
        const r = await saveLeadFields();
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: "✓ ไอดีเทรดผ่าน + บันทึกลงฐานข้อมูลแล้ว (ไม่ได้เพิ่ม TV — ไม่ได้ใส่ user TV)" } : { ok: false, text: "ไอดีเทรดผ่าน แต่บันทึกไม่สำเร็จ: " + r.error });
        return;
      }

      // 3) มี user TV → เช็ค user TV ต้องผ่าน
      setMsg({ ok: true, text: "ไอดีเทรดผ่าน — กำลังเช็ค user TV..." });
      const vBrandId = scripts.find((s) => s.pine_id === pineIds[0])?.brand_id || null;
      const { data: vu, error: vue } = await supabase.functions.invoke("tradingview", { body: { action: "validate_user", username: userTv, brand_id: vBrandId } });
      if (vue || !vu?.ok) { setBusy(false); setMsg({ ok: false, text: "เช็ค user TV ไม่สำเร็จ: " + (vu?.error || "ลองใหม่") }); return; }
      if (!vu.exists) { setBusy(false); setMsg({ ok: false, text: `user TV "${userTv}" ไม่ผ่าน (ไม่พบผู้ใช้นี้) — ยังไม่บันทึก` }); return; }

      // 4) ผ่านทั้งคู่ → ให้สิทธิ์ทีละสคริปต์ (แต่ละตัวใช้วันหมดอายุของตัวเอง)
      const summ = []; const fails = [];
      for (const pid of pineIds) {
        const d = getDur(pid);
        const expIso = d.mode === "date" && d.expDate ? new Date(`${beToCe(d.expDate)}T23:59:59+07:00`).toISOString() : null;
        const effDays = d.mode === "days" ? (Number(d.days) || 30) : 0;
        const name = scripts.find((s) => s.pine_id === pid)?.name || pid;
        setMsg({ ok: true, text: `ผ่านทั้งคู่ — กำลังเพิ่ม "${name}"...` });
        const { data: g, error: ge } = await supabase.functions.invoke("tradingview", { body: {
          action: "grant", username: userTv, display_name: row?.customer_name || null, email: f.email.trim() || null,
          pine_ids: [pid], lifetime: d.mode === "lifetime", days: effDays, expiration: expIso, trade_id: tradeId,
        } });
        if (ge || !g?.ok) fails.push(`${name}: ${g?.error || g?.results?.[0]?.error || "ลองใหม่"}`);
        else summ.push(`${name} (${durLabel(d)})`);
      }
      if (!summ.length) { setBusy(false); setMsg({ ok: false, text: "เพิ่มสิทธิ์ TV ไม่สำเร็จ: " + (fails.join(" · ") || "ลองใหม่") }); return; }
      logActivity("tv_grant_from_chat", { id: row.id, username: userTv });

      // 5) บันทึกลงฐานข้อมูลลูกค้าด้วย (เก็บแยกกัน)
      const r = await saveLeadFields();
      setBusy(false);
      setMsg(r.ok
        ? { ok: true, text: `✓ เพิ่ม user TV: ${summ.join(", ")}${fails.length ? ` · ไม่สำเร็จ: ${fails.join(" · ")}` : ""} + บันทึกฐานข้อมูลแล้ว` }
        : { ok: false, text: "เพิ่มสิทธิ์ TV แล้ว แต่บันทึกฐานข้อมูลไม่สำเร็จ: " + r.error });
      return;
    }

    // เส้นทางเดิม — บันทึกฐานข้อมูลตรงๆ
    const r = await saveLeadFields();
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "บันทึกแล้ว ✓ (ป้อนโดยแอดมิน — AI จะไม่แก้)" } : { ok: false, text: "บันทึกไม่สำเร็จ: " + r.error });
  }

  const inp = (k, label, ph) => (
    <div className="min-w-0">
      <label className="text-[11px] text-slate-400">{label}</label>
      <input value={f[k]} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} placeholder={ph}
        className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
    </div>
  );
  return (
    <div className="border-t border-slate-200 pt-3 mt-1 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="text-xs font-medium text-slate-500 flex items-center gap-1"><CheckCircle2 size={13} /> ข้อมูลลูกค้า (แอดมินป้อนเอง)</label>
        {row?.manual_data && row?.manual_data_by && (
          <span className="text-[10px] text-emerald-600 font-medium">✓ ป้อนโดย {String(row.manual_data_by).split("@")[0]}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {inp("trade_id", "ไอดีเทรด", "เลขบัญชีเทรด")}
        {inp("username", "User TradingView", "username TV")}
        {inp("phone", "เบอร์โทร", "เบอร์โทร")}
        {inp("email", "อีเมล", "อีเมล")}
      </div>

      {/* ตัวเลือก TV (เหมือนหน้าจัดการสมาชิก TV) — เห็นเฉพาะแอดมินจนกว่าจะปล่อย */}
      {tvOn && (
        <div className="rounded-lg border border-slate-300 p-2.5 space-y-2">
          <div className="text-[11px] font-semibold text-slate-600 flex items-center gap-1"><Tv size={12} /> เพิ่มสิทธิ์ TradingView (ถ้าใส่ user TV จะเช็คไอดีเทรด+user TV แล้วเพิ่มให้)</div>
          <div>
            <label className="text-[11px] text-slate-400">Indicator (สคริปต์) — เลือกได้หลายอัน · กำหนดวันหมดอายุแยกแต่ละตัว</label>
            <div className="mt-0.5 rounded-lg border border-slate-300 divide-y divide-slate-100 max-h-60 overflow-y-auto bg-white">
              {scripts.length === 0 && <div className="px-2 py-1.5 text-sm text-slate-400">ยังไม่มีสคริปต์</div>}
              {scripts.map((s) => {
                const on = pineIds.includes(s.pine_id);
                const d = getDur(s.pine_id);
                return (
                  <div key={s.pine_id} className={on ? "bg-indigo-50/40" : ""}>
                    <label className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={on} onChange={() => toggleScript(s.pine_id, on)} />
                      <span className="truncate flex-1">{s.name}</span>
                      {on && <span className="text-[10px] text-slate-400 shrink-0">{durLabel(d)}</span>}
                    </label>
                    {on && (
                      <div className="px-2 pb-2 pl-7 space-y-1">
                        <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[12px]">
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "lifetime"} onChange={() => setDurFor(s.pine_id, { mode: "lifetime" })} /> ตลอดชีพ</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "days"} onChange={() => setDurFor(s.pine_id, { mode: "days" })} /> จำกัดวัน</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "date"} onChange={() => setDurFor(s.pine_id, { mode: "date" })} /> เลือกวัน</label>
                        </div>
                        {d.mode === "days" && <input type="number" min={1} value={d.days} onChange={(e) => setDurFor(s.pine_id, { days: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm" />}
                        {d.mode === "date" && <input type="date" value={d.expDate} min={todayTH} onChange={(e) => setDurFor(s.pine_id, { expDate: beToCe(e.target.value) })} className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {pineIds.length > 0 && <div className="text-[11px] text-slate-400 mt-0.5">เลือกแล้ว {pineIds.length} สคริปต์</div>}
          </div>
        </div>
      )}

      <button onClick={save} disabled={busy} className="w-full rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
        {busy ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />} บันทึกข้อมูล
      </button>
      {msg && <div className={`text-[11px] whitespace-pre-line ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</div>}
    </div>
  );
}


// ---------------------------------------------------------------
// ฐานข้อมูลลูกค้า — ตารางข้อมูลที่ซิงก์มา (ค้นหา + filter + เรียงลำดับ + export)
// ---------------------------------------------------------------
const SOURCE_LABELS = { ad: "โฆษณา", organic: "ออร์แกนิก", unknown: "ไม่ทราบ" };

// เก็บรายงานฐานข้อมูลล่าสุดไว้เฉพาะ session ที่แอปกำลังเปิดอยู่
// ไม่ใช้ localStorage เพื่อไม่ให้ข้อมูลลูกค้าค้างข้ามการ logout/ปิดแอป
const customerDatabaseReportCache = new Map();
let customerDatabaseViewCache = null;

function CustomerDatabaseTab({ onOpenChat }) {
  const initialViewRef = useRef(customerDatabaseViewCache);
  const initialView = initialViewRef.current;
  const [rows, setRows] = useState(() => initialView?.rows ?? null);   // เฉพาะแถวของหน้าปัจจุบัน (server-side)
  const [total, setTotal] = useState(() => initialView?.total ?? 0);    // จำนวนทั้งหมดที่ตรงเงื่อนไข (นับจาก DB จริง)
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [q, setQ] = useState(() => initialView?.q ?? "");
  const [qDeb, setQDeb] = useState(() => initialView?.qDeb ?? "");     // ค่าค้นหาแบบหน่วงเวลา (กันยิง query ทุกคีย์)
  const [pageFilter, setPageFilter] = useState(() => initialView?.pageFilter ?? "");      // ต้องเลือกเพจก่อน จึงจะอนุญาตให้ดึงรายงาน
  const [reportPageId, setReportPageId] = useState(() => initialView?.reportPageId ?? "");  // เพจที่ผู้ใช้กด "ดึงรายงาน" แล้ว
  const [stageFilter, setStageFilter] = useState(() => initialView?.stageFilter ?? "all");
  const [dataFilter, setDataFilter] = useState(() => initialView?.dataFilter ?? "all");   // all | has | none
  const [sourceFilter, setSourceFilter] = useState(() => initialView?.sourceFilter ?? "all"); // all | ad | organic | unknown
  const [dateFilter, setDateFilter] = useState(() => initialView?.dateFilter ?? "");      // ต้องเลือกก่อนดึงรายงาน
  const [dateFrom, setDateFrom] = useState(() => initialView?.dateFrom ?? "");          // กำหนดเอง (YYYY-MM-DD)
  const [dateTo, setDateTo] = useState(() => initialView?.dateTo ?? "");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDateFilter, setExportDateFilter] = useState("");
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [reportRefreshedAt, setReportRefreshedAt] = useState(() => initialView?.reportRefreshedAt ?? null);
  const [reportRefreshedBy, setReportRefreshedBy] = useState(() => initialView?.reportRefreshedBy ?? null);
  const [sortKey, setSortKey] = useState(() => initialView?.sortKey === "last_message_at" ? "first_customer_message_at" : (initialView?.sortKey ?? "first_customer_message_at"));
  const [sortDir, setSortDir] = useState(() => initialView?.sortDir ?? "desc");
  const [page, setPage] = useState(() => initialView?.page ?? 1);
  const [pageOpts, setPageOpts] = useState([]);         // รายชื่อเพจสำหรับ dropdown
  const [importState, setImportState] = useState(null); // { fileName, sheetName, columns, records, preview, applying, result }
  const importInputRef = useRef(null);
  const reportRequestRef = useRef(0);                   // กันรายงานเพจเดิมที่กำลังโหลดกลับมาทับหลังเปลี่ยนเพจ
  const previousPageFilterRef = useRef(pageFilter);     // กัน effect รอบแรกไปล้าง cache ที่เพิ่ง restore
  const previousDateSelectionRef = useRef(`${dateFilter}|${dateFrom}|${dateTo}`);
  const PAGE_SIZE = 50;

  const reportCacheKey = (selectedPageId = reportPageId) => JSON.stringify({
    version: 2, pageId: selectedPageId, page, q: qDeb, stageFilter, dataFilter, sourceFilter,
    dateFilter, dateFrom, dateTo, sortKey, sortDir,
  });

  // map ปุ่มเรียง → คอลัมน์จริงใน DB
  const SORT_COL = { customer_name: "customer_name", page_name: "page_name", trade_id: "trade_id", phone: "phone", email: "email", username: "username", psid: "psid", source: "source", messages: "user_message_count", stage: "stage", first_customer_message_at: "first_customer_message_at", last_message_at: "first_customer_message_at", synced_at: "first_customer_message_at" };
  const EXPORT_DB_COLS = ["customer_name", "page_name", "trade_id", "phone", "email", "username", "psid", "source", "entry_ad_id", "first_customer_message_at"];
  const EXPORT_COLUMNS = [
    ["ชื่อเฟสบุค", (row) => row.customer_name || ""],
    ["เพจ", (row) => row.page_name || ""],
    ["ไอดีเทรด", (row) => row.trade_id || ""],
    ["เบอร์โทร", (row) => row.phone || ""],
    ["อีเมล", (row) => row.email || ""],
    ["user tradingview", (row) => row.username || ""],
    ["เฟสบุคไอดี", (row) => row.psid || ""],
    ["แหล่งที่มา", (row) => sourceText(row)],
    ["วันที่", (row) => fmtTime(row.first_customer_message_at)],
  ];

  // รายชื่อเพจจาก page_lead_config (คงอยู่แม้ตารางลูกค้าจะแบ่งหน้า)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("page_lead_config").select("page_id, page_name").order("page_name");
      setPageOpts((data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })));
    })();
  }, []);

  // หน่วงช่องค้นหา
  useEffect(() => { const t = setTimeout(() => setQDeb(q), 350); return () => clearTimeout(t); }, [q]);

  // ใส่เงื่อนไขฟิลเตอร์ทั้งหมดลงใน query (ใช้ร่วมทั้งโหลดหน้า + export)
  function hasCompleteDateRange(preset, from = "", to = "") {
    if (!preset) return false;
    if (preset !== "custom") return true;
    return !!from && !!to && from <= to;
  }

  function applyFilters(query, options = {}) {
    const selectedPageId = options.pageId ?? reportPageId;
    const selectedDateFilter = options.dateFilter ?? dateFilter;
    const selectedDateFrom = options.dateFrom ?? dateFrom;
    const selectedDateTo = options.dateTo ?? dateTo;
    query = query.eq("page_id", selectedPageId);
    if (stageFilter !== "all") query = query.eq("stage", stageFilter);
    if (dataFilter === "has") query = query.or("phone.not.is.null,trade_id.not.is.null,username.not.is.null");
    if (dataFilter === "none") query = query.is("phone", null).is("trade_id", null).is("username", null);
    if (sourceFilter === "ad") query = query.or("source.eq.ad,entry_ad_id.not.is.null");
    else if (sourceFilter === "organic") query = query.eq("source", "organic");
    else if (sourceFilter === "unknown") query = query.is("entry_ad_id", null).or("source.is.null,source.not.in.(ad,organic)");
    if (selectedDateFilter === "custom") {
      if (selectedDateFrom) query = query.gte("first_customer_message_at", new Date(selectedDateFrom + "T00:00:00+07:00").toISOString());
      if (selectedDateTo) {
        const endExclusive = new Date(new Date(selectedDateTo + "T00:00:00+07:00").getTime() + 864e5).toISOString();
        query = query.lt("first_customer_message_at", endExclusive);
      }
    } else if (selectedDateFilter !== "all") {
      const range = getCustomerDateRange(selectedDateFilter);
      if (range?.from) query = query.gte("first_customer_message_at", range.from);
      if (range?.toExclusive) query = query.lt("first_customer_message_at", range.toExclusive);
    }
    const s = qDeb.trim().replace(/[%,()]/g, " ").trim();
    if (s) {
      const like = `%${s}%`;
      query = query.or(["customer_name", "phone", "trade_id", "username", "email", "psid", "last_user_text", "page_name", "entry_ad_id"].map((c) => `${c}.ilike.${like}`).join(","));
    }
    return query;
  }

  async function load(force = true) {
    if (!reportPageId || reportPageId !== pageFilter) return;
    const selectedPageId = reportPageId;
    const cacheKey = reportCacheKey(selectedPageId);
    if (!force) {
      const cached = customerDatabaseReportCache.get(cacheKey);
      if (cached) {
        setRows(cached.rows);
        setTotal(cached.total);
        setReportRefreshedAt(cached.refreshedAt || null);
        setReportRefreshedBy(cached.refreshedBy || null);
        setError("");
        setLoading(false);
        return;
      }
    }
    const requestId = ++reportRequestRef.current;
    setLoading(true); setError("");
    const { data, error: e } = await supabase.functions.invoke("customer-report", { body: {
      page_id: selectedPageId, date_filter: dateFilter, date_from: dateFrom, date_to: dateTo,
      page, q: qDeb, stage_filter: stageFilter, data_filter: dataFilter, source_filter: sourceFilter,
      sort_key: sortKey, sort_dir: sortDir, force,
    } });
    if (requestId !== reportRequestRef.current || selectedPageId !== pageFilter) return;
    if (e || !data?.ok) { setError(data?.error || (e ? await readFunctionErrorMessage(e) : "ดึงรายงานไม่สำเร็จ")); if (rows === null) setRows([]); }
    else {
      const nextRows = data.rows || [];
      const nextTotal = data.total || 0;
      const refreshedAt = data.refreshed_at || null;
      const refreshedBy = data.refreshed_by || null;
      setRows(nextRows); setTotal(nextTotal);
      setReportRefreshedAt(refreshedAt); setReportRefreshedBy(refreshedBy);
      customerDatabaseReportCache.set(cacheKey, { rows: nextRows, total: nextTotal, refreshedAt, refreshedBy });
    }
    setLoading(false);
  }
  async function invalidateSharedReportCache() {
    if (!reportPageId) return;
    await supabase.functions.invoke("customer-report", { body: {
      action: "invalidate", page_id: reportPageId, date_filter: dateFilter, date_from: dateFrom, date_to: dateTo,
    } });
  }
  // reset ไปหน้า 1 เมื่อเปลี่ยนฟิลเตอร์/การเรียง
  useEffect(() => { setPage(1); }, [qDeb, stageFilter, dataFilter, sourceFilter, dateFilter, dateFrom, dateTo, sortKey, sortDir]);
  // เปลี่ยนเพจ = ล้างรายงานเดิมทันที และรอให้กดดึงรายงานใหม่ ห้าม query ข้อมูลลูกค้าอัตโนมัติ
  useEffect(() => {
    if (previousPageFilterRef.current === pageFilter) return;
    previousPageFilterRef.current = pageFilter;
    setReportPageId("");
    setRows(null);
    setTotal(0);
    setReportRefreshedAt(null);
    setReportRefreshedBy(null);
    setError("");
    setPage(1);
    reportRequestRef.current += 1;
    setLoading(false);
  }, [pageFilter]);
  // เปลี่ยนช่วงเวลา = ต้องกดดึงรายงานใหม่ ห้ามโหลด snapshot คนละช่วงให้อัตโนมัติ
  useEffect(() => {
    const next = `${dateFilter}|${dateFrom}|${dateTo}`;
    if (previousDateSelectionRef.current === next) return;
    previousDateSelectionRef.current = next;
    setReportPageId(""); setRows(null); setTotal(0);
    setReportRefreshedAt(null); setReportRefreshedBy(null);
    setPage(1); setError(""); reportRequestRef.current += 1; setLoading(false);
  }, [dateFilter, dateFrom, dateTo]);
  // โหลดจาก cache ก่อนเมื่อกลับเข้าเมนู/ย้อนมาฟิลเตอร์เดิม เพื่อลด API
  useEffect(() => { if (reportPageId && reportPageId === pageFilter) load(false); }, [reportPageId, page, qDeb, stageFilter, dataFilter, sourceFilter, dateFilter, dateFrom, dateTo, sortKey, sortDir]);

  // จำหน้ารายงานล่าสุดในหน่วยความจำของแอป เผื่อคอมโพเนนต์ถูก remount ระหว่างสลับเมนู
  useEffect(() => {
    if (!reportPageId || reportPageId !== pageFilter || rows === null) return;
    const snapshot = {
      rows, total, q, qDeb, pageFilter, reportPageId, stageFilter, dataFilter,
      sourceFilter, dateFilter, dateFrom, dateTo, sortKey, sortDir, page, reportRefreshedAt, reportRefreshedBy,
    };
    customerDatabaseViewCache = snapshot;
    customerDatabaseReportCache.set(reportCacheKey(), { rows, total, refreshedAt: reportRefreshedAt, refreshedBy: reportRefreshedBy });
  }, [rows, total, q, qDeb, pageFilter, reportPageId, stageFilter, dataFilter, sourceFilter, dateFilter, dateFrom, dateTo, sortKey, sortDir, page, reportRefreshedAt, reportRefreshedBy]);

  function pullReport() {
    if (!pageFilter) { setError("กรุณาเลือกเพจก่อนดึงรายงาน"); return; }
    if (!dateFilter) { setError("กรุณาเลือกช่วงเวลาก่อนดึงรายงาน"); return; }
    if (dateFilter === "custom" && (!dateFrom || !dateTo)) { setError("กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุดให้ครบ"); return; }
    if (dateFilter === "custom" && dateFrom > dateTo) { setError("วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด"); return; }
    setError("");
    setRows(null);
    setTotal(0);
    customerDatabaseReportCache.clear();
    // ถ้ากดซ้ำบนเพจเดิม reportPageId จะไม่เปลี่ยนและ effect จะไม่ทำงาน
    // จึงสั่งโหลดเองเมื่ออยู่หน้า 1; ถ้าอยู่หน้าอื่น การเปลี่ยน page เป็น 1 จะเป็นตัวเริ่มโหลด
    if (reportPageId === pageFilter) {
      if (page === 1) load(false);
      else setPage(1);
      return;
    }
    setPage(1);
    setReportPageId(pageFilter);
  }

  async function setStage(id, stage) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, stage, stage_manual: stage } : r)));
    await supabase.from("chat_customers").update({ stage, stage_manual: stage, updated_at: new Date().toISOString() }).eq("id", id);
    await invalidateSharedReportCache();
  }

  const pages = pageOpts;
  const srcOf = (r) => (r.source === "ad" || r.entry_ad_id ? "ad" : r.source === "organic" ? "organic" : "unknown");
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageRows = rows || [];   // แถวของหน้าปัจจุบัน (กรอง/เรียง/แบ่งหน้าที่ DB แล้ว)

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "customer_name" || key === "page_name" ? "asc" : "desc"); }
  }

  // Export = ดึงทุกแถวที่ตรงเงื่อนไข (ทีละ 1,000 วนจนครบ) ไม่ใช่แค่หน้าปัจจุบัน
  function openExportDialog() {
    if (!pageFilter) { setError("กรุณาเลือกเพจก่อน Export CSV"); return; }
    setError("");
    setExportDateFilter("");
    setExportDateFrom("");
    setExportDateTo("");
    setExportDialogOpen(true);
  }

  async function exportCsv() {
    if (!pageFilter || !hasCompleteDateRange(exportDateFilter, exportDateFrom, exportDateTo)) return;
    if (exportDateFilter === "custom" && exportDateFrom > exportDateTo) return;
    setExporting(true);
    try {
      const B = 1000;
      let all = [], from = 0;
      for (let guard = 0; guard < 200; guard++) {
        let query = supabase.from("chat_customers").select(EXPORT_DB_COLS.join(","));
        query = applyFilters(query, { pageId: pageFilter, dateFilter: exportDateFilter, dateFrom: exportDateFrom, dateTo: exportDateTo })
          .order(SORT_COL[sortKey] || "first_customer_message_at", { ascending: sortDir === "asc", nullsFirst: false }).range(from, from + B - 1);
        const { data, error: e } = await query;
        if (e) { setError("Export ล้มเหลว: " + e.message); return; }
        all = all.concat(data || []);
        if (!data || data.length < B) break;
        from += B;
      }
      const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = [EXPORT_COLUMNS.map(([header]) => esc(header)).join(","), ...all.map((row) => EXPORT_COLUMNS.map(([, getValue]) => esc(getValue(row))).join(","))].join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `customers_${bangkokDate()}.csv`;
      a.click(); URL.revokeObjectURL(url);
      setExportDialogOpen(false);
    } finally {
      setExporting(false);
    }
  }

  async function chooseImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!pageFilter) { setError("กรุณาเลือกเพจก่อน Import Excel"); return; }
    setError("");
    setImportState({ fileName: file.name, loading: true });
    try {
      const { parseCustomerImportExcel } = await import("./customer-import.js");
      const parsed = await parseCustomerImportExcel(file);
      const { data, error: invokeError } = await supabase.functions.invoke("import-chat-customers", {
        body: { mode: "preview", page_id: pageFilter, records: parsed.records },
      });
      if (invokeError) throw new Error(await readFunctionErrorMessage(invokeError));
      if (!data?.ok) throw new Error(data?.error || "ตรวจสอบไฟล์ไม่สำเร็จ");
      setImportState({ fileName: file.name, ...parsed, preview: data, loading: false, applying: false, result: null });
    } catch (err) {
      setImportState(null);
      setError(`Import Excel ไม่สำเร็จ: ${err?.message || err}`);
    }
  }

  async function applyImport() {
    if (!importState?.records?.length || importState.applying) return;
    setImportState((state) => ({ ...state, applying: true, result: null }));
    const { data, error: invokeError } = await supabase.functions.invoke("import-chat-customers", {
      body: { mode: "apply", page_id: pageFilter, records: importState.records },
    });
    if (invokeError || !data) {
      const message = invokeError ? await readFunctionErrorMessage(invokeError) : "ระบบไม่ตอบกลับ";
      setImportState((state) => ({ ...state, applying: false, result: { ok: false, error: message } }));
      return;
    }
    setImportState((state) => ({ ...state, applying: false, result: data }));
    if (data.updated > 0) {
      customerDatabaseReportCache.clear();
      customerDatabaseViewCache = null;
      if (reportPageId === pageFilter) load(true);
    }
  }

  const fmtTime = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); } catch { return t || "-"; } };
  // ชื่อ ADS + ad id (สำหรับคอลัมน์แหล่งที่มา 2 บรรทัด)
  const adNameOf = (r) => r.entry_ad_name || (r.comment_ad_names?.length ? r.comment_ad_names.filter(Boolean).join(", ") : r.comment_ad_name) || "";
  const adIdOf = (r) => r.entry_ad_id || (r.comment_ad_ids?.length ? r.comment_ad_ids.filter(Boolean).join(", ") : "");
  const sourceText = (r) => srcOf(r) === "ad"
    ? `Ads ${adNameOf(r) || "โฆษณา"}${adIdOf(r) ? ` (ads id: ${adIdOf(r)})` : ""}`
    : SOURCE_LABELS[srcOf(r)];
  const patchRow = (id, patch) => { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); invalidateSharedReportCache(); };
  const selCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white";

  const SortHead = ({ k, children, className = "" }) => (
    <th className={`px-3 py-2 font-medium ${className}`}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-slate-800">
        {children}
        {sortKey === k ? (sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={13} className="text-slate-300" />}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-800">รีพอร์ตลูกค้าทักแชท</h3>
            <p className="text-xs text-slate-500 mt-0.5">ข้อมูลลูกค้าทั้งหมดที่ซิงก์มาจาก Supabase — ค้นหา กรอง เรียงลำดับ และดาวน์โหลดได้</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={importInputRef} type="file" accept=".xlsx,.xlsm" onChange={chooseImportFile} className="hidden" />
            <button onClick={() => pageFilter ? importInputRef.current?.click() : setError("กรุณาเลือกเพจก่อน Import Excel")} disabled={!!importState?.loading} title="จับคู่ด้วยชื่อลูกค้าในเพจที่เลือก และเขียนทับเฉพาะช่องที่มีข้อมูลในไฟล์" className="border border-emerald-300 text-emerald-700 rounded-lg px-3 py-2 text-sm font-medium hover:bg-emerald-50 disabled:opacity-50 flex items-center gap-1.5">
              {importState?.loading ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />} Import Excel
            </button>
            <button onClick={() => { customerDatabaseReportCache.clear(); load(true); }} disabled={loading || !reportPageId} title="คลิกเพื่อดึงข้อมูลปัจจุบันจากฐานข้อมูลและอัปเดตให้ทุก user" className="bg-cyan-500 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-cyan-400 shadow-sm shadow-cyan-500/30 disabled:opacity-50 flex items-center gap-1.5">
              {loading ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} รีเฟรชข้อมูลล่าสุด
            </button>
            <button onClick={openExportDialog} disabled={!pageFilter || exporting} className="bg-slate-900 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5">
              {exporting ? <Loader2 className="animate-spin" size={15} /> : <FileDown size={15} />} Export CSV
            </button>
          </div>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา ชื่อ / เบอร์ / ไอดีเทรด / username / ข้อความ" className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm" />
        </div>

        <div className="flex flex-wrap gap-2">
          <select value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} className={selCls} title="เพจ">
            <option value="">— เลือกเพจ —</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={selCls} title="ช่วงวันที่">
            <option value="">— เลือกช่วงเวลา —</option>
            <option value="all">ทุกช่วงเวลา</option>
            <option value="today">วันนี้</option>
            <option value="yesterday">เมื่อวาน</option>
            <option value="last3">3 วันล่าสุด</option>
            <option value="this_week">สัปดาห์นี้</option>
            <option value="last_week">สัปดาห์ที่แล้ว</option>
            <option value="this_month">เดือนนี้</option>
            <option value="last_month">เดือนที่แล้ว</option>
            <option value="this_year">ปีนี้</option>
            <option value="last_year">ปีที่แล้ว</option>
            <option value="7">7 วันล่าสุด</option>
            <option value="30">30 วันล่าสุด</option>
            <option value="90">90 วันล่าสุด</option>
            <option value="custom">กำหนดเอง…</option>
          </select>
          {dateFilter === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={selCls} title="ตั้งแต่วันที่" />
              <span className="text-slate-400 text-sm">–</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={selCls} title="ถึงวันที่" />
            </div>
          )}
          <button onClick={pullReport} disabled={!pageFilter || !hasCompleteDateRange(dateFilter, dateFrom, dateTo) || loading} className="bg-amber-400 text-slate-950 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-amber-300 disabled:opacity-50 flex items-center gap-1.5">
            {loading ? <Loader2 className="animate-spin" size={15} /> : <FileDown size={15} />} ดึงรายงาน
          </button>
          <select value={dataFilter} onChange={(e) => setDataFilter(e.target.value)} className={selCls} title="ข้อมูลติดต่อ">
            <option value="all">ข้อมูลติดต่อ: ทั้งหมด</option>
            <option value="has">มีข้อมูลติดต่อ</option>
            <option value="none">ยังไม่มีข้อมูล</option>
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={selCls} title="ที่มา">
            <option value="all">ที่มา: ทั้งหมด</option>
            <option value="ad">โฆษณา</option>
            <option value="organic">ออร์แกนิก</option>
            <option value="unknown">ไม่ทราบ</option>
          </select>
        </div>

        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
        {!reportPageId && !error && <div className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-3">เลือกเพจและช่วงเวลา แล้วกด “ดึงรายงาน” ระบบจึงจะเริ่มโหลดข้อมูลลูกค้า</div>}
        {reportPageId && reportRefreshedAt && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5">
            <div className="text-sm font-medium text-cyan-900">ข้อมูลชุดนี้ดึงล่าสุด: {new Date(reportRefreshedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "medium" })}{reportRefreshedBy ? <span className="ml-1 text-xs font-normal text-cyan-700">โดย {reportRefreshedBy}</span> : null}</div>
            <div className="text-xs text-cyan-800">หากต้องการข้อมูลปัจจุบัน ให้คลิกปุ่ม “รีเฟรชข้อมูลล่าสุด” ด้านบน</div>
          </div>
        )}
        {reportPageId && <div className="text-xs text-slate-500">พบ {total.toLocaleString()} รายการ{total > PAGE_SIZE ? ` — แสดงหน้า ${curPage}/${totalPages}` : ""}</div>}
      </div>

      {exportDialogOpen && (
        <div className="customer-export-modal-backdrop fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !exporting) setExportDialogOpen(false); }}>
          <div className="customer-export-modal-panel relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">
            <div className="customer-export-modal-header flex items-start justify-between gap-4 px-5 pt-6 pb-5 sm:px-6">
              <div className="min-w-0">
                <div className="customer-export-modal-kicker"><FileDown size={14} /> EXPORT CSV</div>
                <h3 className="customer-export-modal-title mt-2 text-xl font-semibold">เลือกช่วงเวลาที่ต้องการ</h3>
                <p className="customer-export-modal-page mt-2"><span>เพจ</span>{pages.find((p) => p.id === pageFilter)?.name || pageFilter}</p>
              </div>
              <button type="button" onClick={() => !exporting && setExportDialogOpen(false)} className="customer-export-modal-close" aria-label="ปิด"><X size={20} /></button>
            </div>
            <div className="customer-export-modal-body px-5 py-5 sm:px-6 space-y-4">
              <label className="customer-export-modal-label" htmlFor="customer-export-date-range">ช่วงเวลาของข้อมูล</label>
              <select id="customer-export-date-range" value={exportDateFilter} onChange={(e) => setExportDateFilter(e.target.value)} className="customer-export-modal-select w-full rounded-xl px-4 py-3.5 text-sm">
                <option value="">— เลือกช่วงเวลา —</option>
                <option value="all">ทุกช่วงเวลา</option>
                <option value="today">วันนี้</option><option value="yesterday">เมื่อวาน</option><option value="last3">3 วันล่าสุด</option>
                <option value="this_week">สัปดาห์นี้</option><option value="last_week">สัปดาห์ที่แล้ว</option>
                <option value="this_month">เดือนนี้</option><option value="last_month">เดือนที่แล้ว</option>
                <option value="this_year">ปีนี้</option><option value="last_year">ปีที่แล้ว</option>
                <option value="7">7 วันล่าสุด</option><option value="30">30 วันล่าสุด</option><option value="90">90 วันล่าสุด</option>
                <option value="custom">กำหนดเอง…</option>
              </select>
              {exportDateFilter === "custom" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="customer-export-modal-label">ตั้งแต่วันที่<input type="date" value={exportDateFrom} onChange={(e) => setExportDateFrom(e.target.value)} className="customer-export-modal-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm" /></label>
                  <label className="customer-export-modal-label">ถึงวันที่<input type="date" value={exportDateTo} onChange={(e) => setExportDateTo(e.target.value)} className="customer-export-modal-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm" /></label>
                </div>
              )}
              {exportDateFilter === "custom" && exportDateFrom && exportDateTo && exportDateFrom > exportDateTo && <p className="text-sm text-rose-400">วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด</p>}
              {!exportDateFilter && <p className="customer-export-modal-hint">เลือกช่วงเวลาที่ต้องการก่อน จึงจะดาวน์โหลดรายงานได้</p>}
            </div>
            <div className="customer-export-modal-footer flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 sm:px-6">
              <button type="button" onClick={() => setExportDialogOpen(false)} disabled={exporting} className="customer-export-modal-cancel rounded-xl px-4 py-2.5 text-sm font-medium">ยกเลิก</button>
              <button type="button" onClick={exportCsv} disabled={exporting || !hasCompleteDateRange(exportDateFilter, exportDateFrom, exportDateTo) || (exportDateFilter === "custom" && exportDateFrom > exportDateTo)} className="customer-export-modal-download inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold">
                {exporting ? <Loader2 className="animate-spin" size={16} /> : <FileDown size={16} />} ดาวน์โหลด CSV
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {!reportPageId ? (
          <div className="text-sm text-slate-400 py-14 text-center">ยังไม่ได้ดึงรายงาน</div>
        ) : rows === null ? (
          <div className="p-6"><Spinner label="กำลังโหลดรายงาน..." /></div>
        ) : total === 0 ? (
          <div className="text-sm text-slate-400 py-10 text-center">ไม่พบข้อมูลตามเงื่อนไข</div>
        ) : (
          <>
            <div className="w-full overflow-hidden">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col className="w-[16%]" /><col className="w-[8%]" /><col className="w-[9%]" /><col className="w-[9%]" />
                  <col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[11%]" /><col className="w-[9%]" />
                  <col className="w-[6%]" /><col className="w-[7%]" /><col className="w-[4%]" />
                </colgroup>
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                    <SortHead k="customer_name">ลูกค้า</SortHead>
                    <SortHead k="page_name">เพจ</SortHead>
                    <SortHead k="trade_id" className="whitespace-nowrap">ไอดีเทรด</SortHead>
                    <SortHead k="phone" className="whitespace-nowrap">เบอร์โทร</SortHead>
                    <SortHead k="email" className="whitespace-nowrap">อีเมล</SortHead>
                    <SortHead k="username" className="whitespace-nowrap">TradingView</SortHead>
                    <SortHead k="psid" className="whitespace-nowrap">เฟสบุคไอดี</SortHead>
                    <SortHead k="source" className="whitespace-nowrap">แหล่งที่มา</SortHead>
                    <SortHead k="messages" className="text-center">ข้อความ</SortHead>
                    <SortHead k="first_customer_message_at" className="whitespace-nowrap">แชทแรกของวัน</SortHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 align-top">
                      <td className="px-2 py-2 min-w-0">
                        <button onClick={() => onOpenChat?.(r.id, r.last_message_at)} title={`เปิดแชทของ ${r.customer_name || "ลูกค้า"}`} className="block w-full truncate text-left text-slate-800 hover:text-indigo-600 font-medium underline-offset-2 hover:underline">
                          {r.customer_name || "(ไม่มีชื่อ)"}
                        </button>
                        {r.last_user_text && <div title={r.last_user_text} className="text-[10px] text-slate-400 truncate">{r.last_user_text}</div>}
                      </td>
                      <td title={r.page_name || r.page_id || ""} className="px-1.5 py-2 text-slate-600 truncate">{r.page_name || r.page_id || "-"}</td>
                      <td className="px-1 py-1.5 min-w-0"><EditableCell row={r} field="trade_id" numeric onSaved={patchRow} /></td>
                      <td className="px-1 py-1.5 min-w-0"><EditableCell row={r} field="phone" numeric onSaved={patchRow} /></td>
                      <td className="px-1 py-1.5 min-w-0"><EditableCell row={r} field="email" onSaved={patchRow} /></td>
                      <td className="px-1 py-1.5 min-w-0"><EditableCell row={r} field="username" onSaved={patchRow} /></td>
                      <td title={r.psid || ""} className="px-1.5 py-2 text-slate-500 truncate">{r.psid || <span className="text-slate-300">—</span>}</td>
                      <td className="px-1.5 py-2 min-w-0">
                        {srcOf(r) === "ad" ? (
                          <div className="min-w-0">
                            <div className="text-slate-600 truncate" title={`Ads ${adNameOf(r) || "โฆษณา"}`}>Ads {adNameOf(r) || "โฆษณา"}</div>
                            {adIdOf(r) && <div className="text-[10px] text-slate-400 truncate" title={adIdOf(r)}>ads id: {adIdOf(r)}</div>}
                          </div>
                        ) : (
                          <span className="text-slate-500 truncate block" title={SOURCE_LABELS[srcOf(r)]}>{SOURCE_LABELS[srcOf(r)]}</span>
                        )}
                      </td>
                      <td className="px-1 py-2 text-center text-slate-600">{r.user_message_count}/{r.message_count}</td>
                      <td title={fmtTime(r.first_customer_message_at)} className="px-1.5 py-2 text-slate-500 truncate">{fmtTime(r.first_customer_message_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-slate-200 text-sm">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={curPage <= 1} className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-40 hover:bg-slate-50">ก่อนหน้า</button>
                <span className="text-xs text-slate-500">หน้า {curPage} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages} className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-40 hover:bg-slate-50">ถัดไป</button>
              </div>
            )}
          </>
        )}
      </div>

      {importState && !importState.loading && (
        <CustomerImportModal
          state={importState}
          pageName={pages.find((item) => item.id === pageFilter)?.name || pageFilter}
          onClose={() => setImportState(null)}
          onApply={applyImport}
        />
      )}

    </div>
  );
}

function CustomerImportModal({ state, pageName, onClose, onApply }) {
  const summary = state.preview?.summary || {};
  const matched = summary.matched || 0;
  const matchedRecords = summary.matched_records || 0;
  const fieldLabels = { trade_id: "ไอดีเทรด", phone: "เบอร์โทร", email: "อีเมล", username: "TradingView", stage: "สถานะ" };
  const statusView = {
    matched: ["พร้อมนำเข้า", "bg-emerald-100 text-emerald-700"],
    not_found: ["ไม่พบในแอป", "bg-amber-100 text-amber-700"],
    invalid: ["ข้อมูลไม่ครบ", "bg-slate-100 text-slate-600"],
  };
  const result = state.result;
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !state.applying) onClose(); }}>
      <div className="bg-white w-full sm:max-w-4xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800">ตรวจสอบก่อน Import Excel</h3>
            <p className="text-xs text-slate-500 truncate">{state.fileName} · ชีต {state.sheetName} · เพจ {pageName}</p>
          </div>
          <button onClick={onClose} disabled={state.applying} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40" aria-label="ปิด"><X size={20} /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            จับคู่ด้วยชื่อ Facebook เท่านั้น โดยตัดช่องว่างส่วนเกินและไม่สนตัวพิมพ์เล็กใหญ่ · ชื่อเดียวกันหลายแถวใน Excel จะถูกรวมเป็นลูกค้าคนเดียวและรวมไอดีเทรดทุกบัญชี · หากในแอปมีชื่อเดียวกันหลายแถว ระบบจะอัปเดตทุกแถว · ช่องว่างในไฟล์จะไม่ลบข้อมูลเดิม
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {[["แถว Excel", summary.total || 0, "bg-slate-50 border-slate-200", "text-slate-700"], ["ชื่อไม่ซ้ำ", summary.names || 0, "bg-blue-50 border-blue-200", "text-blue-700"], ["ชื่อที่พร้อม", matched, "bg-emerald-50 border-emerald-200", "text-emerald-700"], ["แถวในแอปที่จะอัปเดต", matchedRecords, "bg-violet-50 border-violet-200", "text-violet-700"], ["ไม่พบ/ไม่สมบูรณ์", (summary.not_found || 0) + (summary.invalid || 0), "bg-amber-50 border-amber-200", "text-amber-700"]].map(([label, value, cardClass, valueClass]) => (
              <div key={label} className={`rounded-xl border p-2 ${cardClass}`}><div className={`text-xl font-bold ${valueClass}`}>{value}</div><div className="text-[11px] text-slate-500">{label}</div></div>
            ))}
          </div>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[45vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">แถว Excel</th><th className="px-3 py-2 text-left">ชื่อ Facebook</th><th className="px-3 py-2 text-left">บัญชีเทรด</th><th className="px-3 py-2 text-left">ช่องที่จะเขียนทับ</th><th className="px-3 py-2 text-left">แถวในแอป</th><th className="px-3 py-2 text-left">ผลจับคู่</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(state.preview?.results || []).map((row, index) => {
                    const view = statusView[row.status] || [row.status, "bg-slate-100 text-slate-600"];
                    return <tr key={`${row.row_number}-${index}`}><td className="px-3 py-2 text-slate-400 whitespace-nowrap">{(row.row_numbers || [row.row_number]).filter(Boolean).join(", ") || "-"}</td><td className="px-3 py-2 text-slate-800 font-medium">{row.customer_name || "(ไม่มีชื่อ)"}</td><td className="px-3 py-2 text-slate-600 max-w-[220px] break-words">{(row.trade_ids || []).join(", ") || "—"}</td><td className="px-3 py-2 text-slate-600">{(row.fields || []).map((field) => fieldLabels[field] || field).join(", ") || "—"}</td><td className="px-3 py-2 text-slate-600 text-center">{row.matched_count || "—"}</td><td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 whitespace-nowrap ${view[1]}`} title={row.reason}>{view[0]}</span></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {result && <div className={`rounded-xl px-3 py-2 text-sm ${result.updated > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{result.updated > 0 ? `นำเข้าสำเร็จ ${result.matched_names || matched} ชื่อ · อัปเดต ${result.updated} แถวในแอป · ข้าม ${result.skipped || 0} ชื่อ${result.errors?.length ? ` · ล้มเหลว ${result.errors.length} รายการ` : ""}` : `นำเข้าไม่สำเร็จ: ${result.error || result.errors?.[0]?.error || "ไม่มีรายการที่อัปเดต"}`}</div>}
        </div>
        <div className="border-t border-slate-200 p-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={state.applying} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-40">{result?.updated > 0 ? "ปิด" : "ยกเลิก"}</button>
          {!result?.updated && <button onClick={onApply} disabled={!matched || state.applying} className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40 flex items-center gap-2">{state.applying && <Loader2 size={15} className="animate-spin" />}ยืนยันอัปเดต {matchedRecords} แถว</button>}
        </div>
      </div>
    </div>
  );
}

// รายละเอียดลูกค้า 1 คน — ดูบทสนทนาที่ดึงมา + แก้สถานะ/ข้อมูลติดต่อได้
function CustomerDetailModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({
    stage: row.stage || "new",
    trade_id: row.trade_id || "",
    phone: row.phone || "",
    email: row.email || "",
    username: row.username || "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);   // ผลส่งสถานะไป Meta (ทดสอบ)
  const fmt = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }); } catch { return t || "-"; } };
  const transcript = Array.isArray(row.transcript) ? row.transcript : [];
  const srcLabel = (row.source === "ad" ? "โฆษณา" : row.source === "organic" ? "ออร์แกนิก" : "ไม่ทราบ") + (row.entry_ad_id ? ` #${row.entry_ad_id}` : "");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    const patch = {
      stage: form.stage, stage_manual: form.stage,
      trade_id: form.trade_id.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      username: form.username.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("chat_customers").update(patch).eq("id", row.id);
    setSaving(false);
    if (error) { alert("บันทึกไม่สำเร็จ: " + error.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    onSaved?.(row.id, patch);
  }

  // ทดสอบส่งสถานะปัจจุบันไปติดเป็น Custom Label บน Meta (ราย 1 คน)
  async function pushToMeta() {
    setPushing(true); setPushResult(null);
    const { data, error } = await supabase.functions.invoke("meta-push-labels", { body: { id: row.id } });
    setPushing(false);
    if (error) { setPushResult({ ok: false, msg: await readFunctionErrorMessage(error) }); return; }
    if (!data?.ok) { setPushResult({ ok: false, msg: data?.error || "ส่งไม่สำเร็จ" }); return; }
    const r0 = data.results?.[0];
    if (r0?.skipped) {
      setPushResult({ ok: true, msg: `ข้าม — ลูกค้ามีป้าย "สร้างคอนเวอร์ชั่นแล้ว" อยู่แล้ว ไม่ดาวน์เกรดเป็น "${r0.label}"` });
    } else if (r0?.assigned) {
      setPushResult({ ok: true, msg: `ติดป้าย "${r0.label}" ให้ลูกค้าบน Meta สำเร็จ${r0.removed_others ? ` (แทนที่ป้ายสถานะเดิม ${r0.removed_others})` : ""}` });
    } else {
      const detail = r0?.error || (data.label_errors?.length ? data.label_errors.join(" · ") : "") || "ติดป้ายไม่สำเร็จ — เช็คสิทธิ์ token (pages_messaging)";
      setPushResult({ ok: false, msg: detail });
    }
  }

  const fieldCls = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onMouseDown={(e) => {
        // ปิดเฉพาะเมื่อเริ่มกดบนฉากหลังจริง ๆ การลากเลือกข้อความใน input
        // อาจปล่อยเมาส์นอกช่องและเกิด click ที่ ancestor ได้ จึงห้ามใช้ onClick ปิด modal
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800 truncate">{row.customer_name || "(ไม่มีชื่อ)"}</h3>
            <p className="text-xs text-slate-500 truncate">{row.page_name || row.page_id} · เฟสบุคไอดี {row.psid || "-"}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0" aria-label="ปิด"><X size={20} /></button>
        </div>

        <div className="p-4 space-y-5">
          {/* สรุปข้อมูลที่มา */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[11px] text-slate-400">แหล่งที่มา: {srcLabel} · ข้อความลูกค้า/รวม: {row.user_message_count}/{row.message_count} · ล่าสุด: {fmt(row.last_message_at)}</div>
          </div>

          {/* ทดสอบส่งสถานะไป Meta (ติดเป็น Custom Label บนบทสนทนาของเพจ) */}
          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-medium text-slate-700">ส่งสถานะไป Meta (ทดสอบ)</div>
                <p className="text-[11px] text-slate-500">ติดป้าย "{CHAT_STAGES.find((s) => s.key === row.stage)?.label || row.stage}" ให้ลูกค้าคนนี้บนกล่องข้อความของเพจ · แทนที่เฉพาะป้ายสถานะระบบเดิม (ป้ายอื่นที่แอดมินติดเอง เช่น "ชำระเงินแล้ว" ไม่ถูกแตะ)</p>
              </div>
              <button onClick={pushToMeta} disabled={pushing || !row.psid} className="bg-slate-900 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-1.5 shrink-0">
                {pushing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} ทดสอบส่งป้าย
              </button>
            </div>
            {!row.psid && <div className="text-[11px] text-rose-500">ลูกค้าคนนี้ไม่มี PSID จึงส่งไม่ได้</div>}
            {pushResult && (
              <div className={`text-xs rounded-lg px-3 py-2 ${pushResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
                {pushResult.ok ? "✓ " : "✗ "}{pushResult.msg}
              </div>
            )}
          </div>

          {/* แก้ไขข้อมูล */}
          <div>
            <div className="text-sm font-medium text-slate-700 mb-2">แก้ไขข้อมูล</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">สถานะ</label>
                <select value={form.stage} onChange={(e) => set("stage", e.target.value)} className={fieldCls}>
                  {CHAT_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">ไอดีเทรด</label>
                <input value={form.trade_id} onChange={(e) => set("trade_id", e.target.value)} className={fieldCls} />
              </div>
              <div>
                <label className="text-xs text-slate-500">เบอร์โทร</label>
                <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className={fieldCls} />
              </div>
              <div>
                <label className="text-xs text-slate-500">อีเมล</label>
                <input value={form.email} onChange={(e) => set("email", e.target.value)} className={fieldCls} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Username (TradingView)</label>
                <input value={form.username} onChange={(e) => set("username", e.target.value)} className={fieldCls} />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button onClick={save} disabled={saving} className="bg-slate-900 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2">
                {saving ? <Loader2 className="animate-spin" size={15} /> : null} บันทึก
              </button>
              {saved && <span className="text-sm text-emerald-700">บันทึกแล้ว</span>}
            </div>
          </div>

          {/* บทสนทนาที่ดึงมา */}
          <div>
            <div className="text-sm font-medium text-slate-700 mb-1">บทสนทนาที่ดึงมา ({transcript.length} ข้อความ)</div>
            {transcript.length === 0 ? (
              <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-4 text-center">
                ยังไม่มีบทสนทนาเก็บไว้ — ต้อง deploy ฟังก์ชันซิงก์เวอร์ชันใหม่ + รัน migration แล้วซิงก์ใหม่ ระบบจึงจะเก็บบทสนทนาให้
              </div>
            ) : (
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {transcript.map((m, i) => (
                  <div key={i} className={`flex ${m.w === "u" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${m.w === "u" ? "bg-slate-100 text-slate-800" : "bg-indigo-500 text-white"}`}>
                      <div className="text-[10px] opacity-70 mb-0.5">{m.w === "u" ? "ลูกค้า" : "เพจ"}{m.at ? ` · ${fmt(m.at)}` : ""}</div>
                      <div className="whitespace-pre-wrap break-words">{m.t}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Dashboard shell
// ---------------------------------------------------------------
// ===================== GAME LAYER: ออฟฟิศจำลอง (Pixi) — read-only จาก chat_customers =====================
// แยกจาก Business Layer โดยสิ้นเชิง: ไม่แตะ backend/edge/DB structure ใช้ Realtime อ่านอย่างเดียว
// คลิกลูกค้า → เรียก onOpenChat(id) เพื่อเปิดแชทเดิม (ระบบแชทไม่ถูกเขียนใหม่)
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

function GameOfficeTab({ allowedPages = null, onOpenChat }) {
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
          <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">คิวรอ {count.waiting}{count.overQ ? ` (+${count.overQ})` : ""}</span>
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

// ---------------------------------------------------------------
// กระดานแต้ม (Leaderboard) — จัดอันดับแต้มพิเศษ "ตอบแชทนอกเวลาทำการ"
//   • เห็นได้ทุกคน (แอดมินคุมสิทธิ์ที่ settings.leaderboard) · เพจที่นับแอดมินล็อกไว้
//   • เลือกช่วงเวลาได้ (เลือกเพจไม่ได้) · อัปเดตเรียลไทม์เมื่อ reply_stats เปลี่ยน
// ---------------------------------------------------------------
function LeaderboardTab({ active = true }) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const thDay = (o = 0) => { const d = new Date(Date.now() + 7 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10); };
  const thMonth = (mo, which) => { const d = new Date(Date.now() + 7 * 3600 * 1000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + mo + (which === "end" ? 1 : 0)); if (which === "end") d.setUTCDate(0); return d.toISOString().slice(0, 10); };
  const PRESETS = [
    ["วันนี้", () => [thDay(0), thDay(0)]],
    ["เมื่อวาน", () => [thDay(-1), thDay(-1)]],
    ["3 วันล่าสุด", () => [thDay(-2), thDay(0)]],
    ["7 วันล่าสุด", () => [thDay(-6), thDay(0)]],
    ["14 วันล่าสุด", () => [thDay(-13), thDay(0)]],
    ["30 วันล่าสุด", () => [thDay(-29), thDay(0)]],
    ["เดือนนี้", () => [thMonth(0, "start"), thDay(0)]],
    ["เดือนที่แล้ว", () => [thMonth(-1, "start"), thMonth(-1, "end")]],
    ["3 เดือนล่าสุด", () => [thMonth(-2, "start"), thDay(0)]],
    ["6 เดือนล่าสุด", () => [thMonth(-5, "start"), thDay(0)]],
    ["ปีนี้", () => { const d = new Date(Date.now() + 7 * 3600 * 1000); return [`${d.getUTCFullYear()}-01-01`, thDay(0)]; }],
  ];
  const [since, setSince] = useState(() => thDay(-6));
  const [until, setUntil] = useState(() => thDay(0));
  const [presetIdx, setPresetIdx] = useState(3);   // 7 วันล่าสุด
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState(false);       // ไฮไลต์ตอนอัปเดตสด
  const reloadRef = useRef(null);
  const fmtDMY = (iso) => { const [y, m, d] = String(iso).split("-"); return `${Number(d)}/${Number(m)}/${y}`; };
  const nameOf = (e) => { const s = String(e || ""); if (s.startsWith("(")) return s; const at = s.indexOf("@"); return at > 0 ? s.slice(0, at) : s; };

  const load = useCallback(async (flashOnDone = false) => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.functions.invoke("leaderboard", { body: { since, until } });
    setBusy(false);
    if (error || !data?.ok) { setErr(error?.message || data?.error || "โหลดไม่สำเร็จ"); return; }
    setRes(data);
    if (flashOnDone) { setFlash(true); setTimeout(() => setFlash(false), 900); }
  }, [since, until]);
  reloadRef.current = load;

  useEffect(() => { if (active) load(); }, [since, until, active, load]);

  // อัปเดตเรียลไทม์ — reply_stats เปลี่ยน (ส่ง/ตอบ) → รีโหลดแบบหน่วง (debounce) กัน spam
  useEffect(() => {
    if (!active) return;
    let t = null;
    const ch = supabase.channel("lb-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "reply_stats" }, () => {
        clearTimeout(t); t = setTimeout(() => reloadRef.current && reloadRef.current(true), 2500);
      }).subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [active]);

  // พาเลตต์ luxury ที่รักษาบุคลิกทองไว้ทั้งโหมดมืดและสว่าง
  const C = isLight ? {
    bg: "#F7F9FC", ink: "#FFFFFF", border: "rgba(15,23,42,.12)", hair: "rgba(15,23,42,.09)",
    gold: "#B98500", silver: "#64748B", bronze: "#A96022",
    purple: "#6D4AFF", green: "#059669", red: "#DC2626",
    t1: "#0F172A", t2: "#0F172A", t3: "#0F172A",
  } : {
    bg: "#07090D", ink: "#0A0D12", border: "rgba(255,255,255,0.07)", hair: "rgba(255,255,255,0.06)",
    gold: "#F7C948", silver: "#C9D3E2", bronze: "#C8894B",
    purple: "#9D6BFF", green: "#1ED760", red: "#FF5C5C",
    t1: "#FFFFFF", t2: "rgba(255,255,255,.62)", t3: "rgba(255,255,255,.38)",
  };
  const FONT = "'Noto Sans Thai','IBM Plex Sans Thai',system-ui,-apple-system,sans-serif";
  const NUM = "'IBM Plex Sans Thai',system-ui,sans-serif";
  const board = res?.board || [];
  const top3 = board.slice(0, 3);
  const rest = board.slice(3);
  // จัดเรียงแท่น: [ที่2, ที่1, ที่3] เพื่อให้ที่1 อยู่กลาง+สูงสุด
  const podiumOrder = [top3[1], top3[0], top3[2]];
  // วัสดุโลหะ + สัดส่วนแบบ cinematic (ที่1 เด่นสุด, ข้าง ๆ ถอยลึก)
  const META = {
    1: { name: "gold", color: C.gold, hi: "#FFF3C4", mid: "#F3C233", lo: "#8A6410", edge: "#FFE9A0",
         ring: "rgba(247,201,72,.95)", glow: "rgba(247,201,72,.55)", medal: "🥇", h: 196, av: 108, depth: 1, z: 5, spot: "rgba(247,201,72,.55)" },
    2: { name: "silver", color: C.silver, hi: "#FBFDFF", mid: "#B7C2D3", lo: "#727E92", edge: "#EDF2FA",
         ring: "rgba(201,211,226,.9)", glow: "rgba(201,211,226,.30)", medal: "🥈", h: 134, av: 84, depth: .96, z: 3, spot: "rgba(220,230,245,.34)" },
    3: { name: "bronze", color: C.bronze, hi: "#F1C494", mid: "#C1834A", lo: "#6F4420", edge: "#EAB07A",
         ring: "rgba(200,137,75,.9)", glow: "rgba(200,137,75,.30)", medal: "🥉", h: 104, av: 84, depth: .96, z: 3, spot: "rgba(210,160,110,.30)" },
  };
  const order = [2, 1, 3];
  const PAD = "clamp(20px,4.5vw,60px)";

  return (
    <div style={{ fontFamily: FONT, background: C.bg, color: C.t1, borderRadius: 26, border: `1px solid ${C.border}`, boxShadow: isLight ? "0 24px 70px -42px rgba(15,23,42,.35)" : "0 40px 120px -50px rgba(0,0,0,.95)", overflow: "hidden" }}>
      <style>{`
        @keyframes lbPulse{0%,100%{opacity:.9;transform:scale(1)}50%{opacity:0;transform:scale(2.2)}}
        @keyframes lbFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @keyframes lbBreathe{0%,100%{opacity:.55}50%{opacity:.9}}
        @keyframes lbRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        .lb-row{transition:background .18s ease}
        .lb-row:hover{background:${isLight ? "rgba(15,23,42,.035)" : "rgba(255,255,255,.028)"}}
        .lb-tab{transition:color .2s ease}
        .lb-tab:hover{color:${isLight ? "rgba(15,23,42,.9)" : "rgba(255,255,255,.9)"}}
        .lb-ico{transition:all .2s ease}
        .lb-ico:hover{color:${C.t1};border-color:${isLight ? "rgba(15,23,42,.24)" : "rgba(255,255,255,.24)"}!important;background:${isLight ? "rgba(15,23,42,.05)" : "rgba(255,255,255,.05)"}!important}
        .lb-date{color-scheme:${isLight ? "light" : "dark"}}
        .lb-date::-webkit-calendar-picker-indicator{filter:${isLight ? "none" : "invert(.6)"};cursor:pointer}
        .lb-podium{animation:lbRise .6s cubic-bezier(.2,.8,.2,1) both}
        @media(max-width:640px){
          .lb-hide-sm{display:none!important}
          .lb-grid{grid-template-columns:38px 1fr 92px!important}
        }
      `}</style>

      {/* ═══ Editorial masthead ═══ */}
      <div style={{ padding: `36px ${PAD} 0` }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 28 }}>
          <div style={{ minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style={{ width: 22, height: 1, background: `linear-gradient(90deg,transparent,${C.gold})` }} />
              <span style={{ fontSize: 11, letterSpacing: ".42em", textTransform: "uppercase", color: C.gold, fontWeight: 600, fontFamily: NUM }}>Leaderboard</span>
            </div>
            <h2 style={{ fontSize: "clamp(30px,4.6vw,52px)", fontWeight: 800, lineHeight: .98, letterSpacing: "-.025em", margin: 0 }}>กระดานแต้ม</h2>
            <p style={{ fontSize: 14, color: C.t2, margin: "14px 0 0", lineHeight: 1.5, maxWidth: 420 }}>
              จัดอันดับแต้มพิเศษจากการตอบแชท<span style={{ color: C.t1 }}>นอกเวลาทำการ</span> — ยิ่งตอบดึก ยิ่งเป็นวันหยุด และยิ่งตอบไว ยิ่งได้แต้มมาก
            </p>
          </div>
          {/* Total score — editorial figure, not a boxed card */}
          <div style={{ textAlign: "right", position: "relative", paddingLeft: 30 }}>
            <div style={{ position: "absolute", right: -8, top: -18, width: 200, height: 120, background: `radial-gradient(60% 60% at 70% 40%, ${C.purple}44, transparent 72%)`, filter: "blur(14px)", pointerEvents: "none", animation: "lbBreathe 4s ease-in-out infinite" }} />
            <div style={{ position: "relative", fontSize: 11, letterSpacing: ".34em", textTransform: "uppercase", color: C.t3, fontWeight: 600, fontFamily: NUM }}>แต้มรวมทั้งหมด</div>
            <div style={{ position: "relative", fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontSize: "clamp(46px,7vw,84px)", fontWeight: 800, lineHeight: .92, letterSpacing: "-.03em", marginTop: 6, transition: "transform .35s cubic-bezier(.2,.8,.2,1)", transform: flash ? "scale(1.04)" : "scale(1)", color: isLight ? "#0F172A" : "transparent", background: isLight ? "none" : "linear-gradient(176deg,#FFFFFF 30%,#C9B6FF 100%)", WebkitBackgroundClip: isLight ? "border-box" : "text", WebkitTextFillColor: isLight ? "#0F172A" : "transparent", filter: isLight ? "none" : `drop-shadow(0 6px 30px ${C.purple}55)` }}>
              {res ? (res.total ?? 0).toLocaleString() : "—"}
            </div>
            <div style={{ position: "relative", marginTop: 8, fontSize: 13, color: C.t2 }}>
              <span style={{ color: C.gold, fontWeight: 600, fontFamily: NUM }}>{fmtDMY(since)}{since !== until ? `  –  ${fmtDMY(until)}` : ""}</span>
            </div>
          </div>
        </div>

        {/* Toolbar: editorial tabs + date + live — separated by hairlines */}
        <div style={{ marginTop: 30, borderTop: `1px solid ${C.hair}`, borderBottom: `1px solid ${C.hair}`, padding: "14px 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "clamp(10px,1.6vw,22px)" }}>
            {PRESETS.map(([label, fn], i) => {
              const on = presetIdx === i;
              return (
                <button key={label} className="lb-tab" onClick={() => { const [s, u] = fn(); setSince(s); setUntil(u); setPresetIdx(i); }}
                  style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontSize: 13.5, fontWeight: on ? 700 : 500, color: on ? C.t1 : C.t3, fontFamily: FONT }}>
                  {label}
                  {on && <span style={{ position: "absolute", left: 0, right: 0, bottom: -15, height: 2, borderRadius: 2, background: `linear-gradient(90deg,${C.gold},#E9B923)`, boxShadow: `0 0 12px ${C.gold}` }} />}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="date" className="lb-date" value={since} onChange={(e) => { setSince(e.target.value); setPresetIdx(-1); }}
              style={{ background: "transparent", color: C.t2, border: `1px solid ${C.border}`, borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontFamily: NUM }} />
            <span style={{ color: C.t3, fontSize: 12 }}>→</span>
            <input type="date" className="lb-date" value={until} onChange={(e) => { setUntil(e.target.value); setPresetIdx(-1); }}
              style={{ background: "transparent", color: C.t2, border: `1px solid ${C.border}`, borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontFamily: NUM }} />
            <button onClick={() => load()} disabled={busy} className="lb-ico" title="รีเฟรช"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: "50%", background: "transparent", color: C.t2, border: `1px solid ${C.border}`, cursor: "pointer", opacity: busy ? .5 : 1 }}>
              {busy ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            </button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: C.green, fontWeight: 600, letterSpacing: ".02em" }}>
              <span style={{ position: "relative", width: 7, height: 7 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: C.green, animation: "lbPulse 2s ease-out infinite" }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: C.green }} />
              </span>
              LIVE
            </span>
          </div>
        </div>
        {err && <div style={{ marginTop: 16, fontSize: 13, color: C.red, background: "rgba(255,92,92,.07)", border: `1px solid rgba(255,92,92,.22)`, borderRadius: 12, padding: "10px 14px" }}>{err}</div>}
      </div>

      {/* ═══ CINEMATIC PODIUM STAGE (hero) ═══ */}
      {board.length > 0 ? (
        <div style={{ position: "relative", overflow: "hidden", marginTop: 8, minHeight: 480,
          background: isLight ? "radial-gradient(130% 90% at 50% -10%, #FFFFFF 0%, #EEF3FA 48%, #E5EBF4 100%)" : "radial-gradient(130% 90% at 50% -10%, #1A2130 0%, #0C1017 42%, #06080C 100%)" }}>
          {/* atmospheric top haze */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 240, background: "radial-gradient(70% 100% at 50% 0%, rgba(255,255,255,.05), transparent 70%)", pointerEvents: "none" }} />
          {/* faint ticker line horizon */}
          <svg viewBox="0 0 1200 300" preserveAspectRatio="none" style={{ position: "absolute", left: 0, right: 0, bottom: 96, width: "100%", height: 150, opacity: .18, pointerEvents: "none" }}>
            <defs><linearGradient id="lbLine" x1="0" x2="1"><stop offset="0" stopColor="transparent" /><stop offset=".5" stopColor={C.gold} /><stop offset="1" stopColor="transparent" /></linearGradient></defs>
            <polyline fill="none" stroke="url(#lbLine)" strokeWidth="1.5"
              points={Array.from({ length: 60 }).map((_, i) => `${i * 20},${150 - ((Math.sin(i * .6) * 40) + ((i * 53) % 60))}`).join(" ")} />
          </svg>
          {/* reflective floor */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 88, height: 1, background: `linear-gradient(90deg,transparent, ${C.gold}88, rgba(255,255,255,.35), ${C.gold}88, transparent)`, opacity: .5 }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 96, background: isLight ? "linear-gradient(180deg, rgba(229,235,244,0), #E5EBF4 70%)" : "linear-gradient(180deg, rgba(6,8,12,0), #06080C 70%)", pointerEvents: "none" }} />

          <div className="lb-podium" style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(14px,4vw,64px)", padding: `70px ${PAD} 96px`, zIndex: 2 }}>
            {order.map((rank, i) => {
              const u = podiumOrder[i]; const m = META[rank];
              const colW = rank === 1 ? "clamp(160px,20vw,236px)" : "clamp(128px,15vw,190px)";
              if (!u) return <div key={rank} style={{ width: colW }} />;
              const faceGrad = `linear-gradient(180deg, ${m.hi} 0%, ${m.mid} 30%, ${m.color} 46%, ${m.lo} 100%)`;
              return (
                <div key={rank} style={{ width: colW, display: "flex", flexDirection: "column", alignItems: "center", zIndex: m.z, transform: `scale(${m.depth})`, opacity: m.depth, filter: rank === 1 ? "none" : "saturate(.95)" }}>
                  {/* volumetric spotlight cone */}
                  <div style={{ position: "absolute", top: -30, width: "150%", height: 430, clipPath: "polygon(40% 0,60% 0,100% 100%,0 100%)", background: `linear-gradient(180deg, ${m.spot} 0%, transparent 78%)`, filter: "blur(20px)", mixBlendMode: "screen", opacity: rank === 1 ? .95 : .6, pointerEvents: "none" }} />

                  {rank === 1 && <Crown size={30} fill={C.gold} style={{ color: C.gold, marginBottom: 6, filter: `drop-shadow(0 0 12px ${C.gold})`, animation: "lbFloat 3.2s ease-in-out infinite", zIndex: 3 }} />}

                  {/* avatar — floating, volumetric ring */}
                  <div style={{ position: "relative", zIndex: 3, width: m.av, height: m.av, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: NUM, fontWeight: 800, fontSize: m.av * 0.3, color: "#F8FAFC",
                    background: "radial-gradient(circle at 34% 28%, #313a4b, #10141d 78%)",
                    border: `2px solid ${m.ring}`,
                    boxShadow: `0 0 0 6px rgba(0,0,0,.4), 0 22px 44px -16px ${m.glow}, 0 0 46px -6px ${m.glow}, inset 0 2px 6px rgba(255,255,255,.12)` }}>
                    {nameOf(u.email).slice(0, 2).toUpperCase()}
                    <span style={{ position: "absolute", bottom: -8, right: -8, width: 30, height: 30, borderRadius: "50%", background: C.ink, border: `1px solid ${m.ring}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: `0 6px 14px rgba(0,0,0,.6)` }}>{m.medal}</span>
                  </div>

                  {/* name + score — editorial */}
                  <div style={{ textAlign: "center", marginTop: 16, width: "100%", zIndex: 3 }}>
                    <div title={u.email} style={{ fontSize: 13.5, fontWeight: 600, color: C.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{nameOf(u.email)}</div>
                    <div style={{ fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontSize: rank === 1 ? "clamp(34px,4.2vw,50px)" : "clamp(26px,3vw,34px)", fontWeight: 800, lineHeight: 1.02, letterSpacing: "-.02em", marginTop: 6, color: m.color, textShadow: `0 0 30px ${m.glow}` }}>{u.points.toLocaleString()}</div>
                    <div style={{ fontSize: 11.5, color: C.t3, marginTop: 3, fontFamily: NUM }}>{u.count} ครั้ง · ทัน {u.in_time}</div>
                  </div>

                  {/* pedestal — 3D metal with foreshortened top + specular */}
                  <div style={{ position: "relative", width: "100%", marginTop: 18, perspective: 900 }}>
                    {/* top surface */}
                    <div style={{ height: 34, borderRadius: 5, transform: "rotateX(56deg)", transformOrigin: "bottom", marginBottom: -3,
                      background: `linear-gradient(180deg, ${m.edge}, ${m.mid})`,
                      boxShadow: `inset 0 0 14px rgba(0,0,0,.25), 0 -2px 8px ${m.glow}` }} />
                    {/* front face */}
                    <div style={{ position: "relative", height: m.h, borderRadius: "3px 3px 7px 7px", overflow: "hidden",
                      background: faceGrad,
                      boxShadow: `inset 0 2px 0 rgba(255,255,255,.55), inset 0 -22px 34px rgba(0,0,0,.4), inset -14px 0 22px rgba(0,0,0,.28), inset 14px 0 22px rgba(255,255,255,.12), 0 26px 50px -20px ${m.glow}`,
                      display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {/* specular sweep */}
                      <div style={{ position: "absolute", top: 0, bottom: 0, left: "18%", width: 26, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent)", transform: "skewX(-12deg)", opacity: .5 }} />
                      <div style={{ position: "absolute", top: 0, bottom: 0, right: "26%", width: 12, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent)", transform: "skewX(-12deg)", opacity: .35 }} />
                      <span style={{ fontFamily: NUM, fontSize: rank === 1 ? "clamp(46px,6vw,72px)" : "clamp(34px,4vw,52px)", fontWeight: 900, color: "rgba(30,20,0,.30)", textShadow: "0 2px 1px rgba(255,255,255,.4), 0 -1px 1px rgba(0,0,0,.3)" }}>{rank}</span>
                    </div>
                    {/* floor reflection */}
                    <div style={{ height: Math.round(m.h * 0.5), borderRadius: "0 0 7px 7px", transform: "scaleY(-1)", background: faceGrad, opacity: .14, filter: "blur(1.5px)",
                      WebkitMaskImage: "linear-gradient(180deg, rgba(0,0,0,.75), transparent 82%)", maskImage: "linear-gradient(180deg, rgba(0,0,0,.75), transparent 82%)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (!busy && res) ? (
        <div style={{ margin: `20px ${PAD} 40px`, textAlign: "center", padding: "72px 20px", borderRadius: 22, border: `1px solid ${C.hair}`, background: isLight ? "radial-gradient(100% 100% at 50% 0%, #FFFFFF, #EEF2F7)" : "radial-gradient(100% 100% at 50% 0%, #10141d, #0A0D12)" }}>
          <Trophy size={44} style={{ color: C.t3, margin: "0 auto 14px" }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.t2 }}>ยังไม่มีแต้มในช่วงนี้</div>
          <div style={{ fontSize: 13.5, color: C.t3, marginTop: 6 }}>แต้มจะปรากฏเมื่อมีการตอบแชทนอกเวลาทำการ</div>
        </div>
      ) : null}

      {/* ═══ Editorial ranking list ═══ */}
      {rest.length > 0 && (
        <div style={{ padding: `8px ${PAD} 12px` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 4px" }}>
            <span style={{ fontSize: 11, letterSpacing: ".32em", textTransform: "uppercase", color: C.t3, fontWeight: 600, fontFamily: NUM }}>อันดับ 4 เป็นต้นไป</span>
            <span style={{ flex: 1, height: 1, background: C.hair }} />
          </div>
          {/* column labels */}
          <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 96px 96px 80px", alignItems: "center", padding: "10px 0", fontSize: 11, letterSpacing: ".04em", color: C.t3, fontFamily: NUM }}>
            <span>#</span><span>ผู้ตอบ</span>
            <span style={{ textAlign: "right" }}>แต้ม</span>
            <span style={{ textAlign: "right" }} className="lb-hide-sm">ทันเวลา</span>
            <span style={{ textAlign: "right" }} className="lb-hide-sm">ช้ากว่า</span>
          </div>
          {rest.map((u, i) => (
            <div key={u.email} className="lb-row" style={{ display: "grid", gridTemplateColumns: "44px 1fr 96px 96px 80px", alignItems: "center", padding: "16px 0", borderTop: `1px solid ${C.hair}`, borderRadius: 8 }}>
              <span style={{ fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontSize: 15, color: C.t3, fontWeight: 300 }}>{String(i + 4).padStart(2, "0")}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                <span style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, fontFamily: NUM, color: C.t2, background: "radial-gradient(circle at 34% 28%, #2a3242, #12161f)", border: `1px solid ${C.border}` }}>{nameOf(u.email).slice(0, 2).toUpperCase()}</span>
                <span title={u.email} style={{ color: C.t1, fontWeight: 500, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(u.email)}</span>
              </div>
              <span style={{ textAlign: "right", fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 19, color: C.purple, textShadow: `0 0 18px ${C.purple}44` }}>{u.points.toLocaleString()}</span>
              <span style={{ textAlign: "right", fontFamily: NUM, fontVariantNumeric: "tabular-nums", color: C.green, fontWeight: 600, fontSize: 15 }} className="lb-hide-sm">{u.in_time}</span>
              <span style={{ textAlign: "right", fontFamily: NUM, fontVariantNumeric: "tabular-nums", color: u.slow > 0 ? C.red : C.t3, fontWeight: u.slow > 0 ? 600 : 400, fontSize: 15 }} className="lb-hide-sm">{u.slow}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: `10px ${PAD} 32px` }}>
        <p style={{ fontSize: 12, color: C.t3, display: "flex", alignItems: "center", gap: 8, margin: 0, lineHeight: 1.6 }}>
          <span style={{ color: C.gold }}>◆</span> ยิ่งตอบดึก / วันหยุด / ตอบไว = ยิ่งได้แต้มมาก · ทันเวลา = แต้มเต็ม, ช้ากว่า = ครึ่งเดียว · นับเฉพาะการตอบนอกเวลาทำการ
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// จัดการสมาชิก TradingView — ให้สิทธิ์เข้า pine script + วันหมดอายุ (ต่อ edge function "tradingview")
// ---------------------------------------------------------------
function TvMembersTab({ active = true }) {
  const [scripts, setScripts] = useState([]);
  const [access, setAccess] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [released, setReleased] = useState(false);   // ฟีเจอร์ TV ใหม่ปล่อยให้ทุกคนเห็นแล้วหรือยัง
  const [updatedAt, setUpdatedAt] = useState(null);
  const [msg, setMsg] = useState("");
  // ฟอร์มเพิ่มสมาชิก
  const [uname, setUname] = useState("");
  const [dname, setDname] = useState("");
  const [demail, setDemail] = useState("");
  const [tradeId, setTradeId] = useState("");
  const [brands, setBrands] = useState([]);      // แบรนด์ทั้งหมด (ใช้จัดกลุ่ม + ฟอร์มเพิ่ม)
  const [brandSel, setBrandSel] = useState(null); // แบรนด์ที่เลือกในฟอร์มเพิ่มสมาชิก
  const [pineIds, setPineIds] = useState([]);   // เลือกสคริปต์ได้หลายอัน
  // วันหมดอายุแยกต่อสคริปต์ — { [pine_id]: { mode:"days"|"lifetime"|"date", days, expDate } }
  const [dur, setDur] = useState({});
  const getDur = (pid) => dur[pid] || { mode: "days", days: 30, expDate: "" };
  const setDurFor = (pid, patch) => setDur((d) => ({ ...d, [pid]: { ...getDur(pid), ...patch } }));
  const toggleScript = (pid, on) => {
    setPineIds((cur) => on ? cur.filter((p) => p !== pid) : [...cur, pid]);
    if (!on) setDur((d) => (d[pid] ? d : { ...d, [pid]: { mode: "days", days: 30, expDate: "" } }));
  };
  // วันนี้ (เวลาไทย) ใช้เป็นค่าต่ำสุดของปฏิทิน
  const todayTH = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  // แปลงวันที่ที่เลือก (สิ้นวัน 23:59 เวลาไทย) → จำนวนวันนับจากตอนนี้ (ปัดขึ้น) ส่งให้ backend
  const daysFromDate = (d) => {
    if (!d) return 0;
    const target = new Date(`${d}T23:59:59+07:00`).getTime();
    return Math.max(1, Math.ceil((target - Date.now()) / 86400000));
  };
  const [granting, setGranting] = useState(false);
  // ปรับวันหมดอายุ (เพิ่ม/ลด) ของสมาชิกที่มีอยู่
  const [adjRow, setAdjRow] = useState(null);   // แถว tv_access ที่กำลังตั้งวันหมดอายุ
  const [adjMode, setAdjMode] = useState("days");   // days | date | lifetime
  const [adjDays, setAdjDays] = useState(30);
  const [adjDate, setAdjDate] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [editRow, setEditRow] = useState(null);   // แถวที่กำลังแก้ไขข้อมูล
  const [editForm, setEditForm] = useState({ display_name: "", username: "", email: "", trade_id: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState({}); // กำลังตรวจสิทธิ์ TradingView ต่อแถว
  const [collapsed, setCollapsed] = useState({});   // พับตารางต่อสคริปต์ (pine_id -> true)
  const [pageBy, setPageBy] = useState({});         // หน้าปัจจุบันต่อสคริปต์ (pine_id -> page)
  const [pageSize, setPageSize] = useState(20);
  // ช่วงวันที่ดูข้อมูล (กรองตามวันที่เพิ่มสมาชิก) — ค่าเริ่มต้น: วันนี้
  const thToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const thDayStr = (off) => new Date(Date.now() + 7 * 3600 * 1000 + off * 86400000).toISOString().slice(0, 10);
  const [rangeKey, setRangeKey] = useState("today");
  const [customFrom, setCustomFrom] = useState(thToday);
  const [customTo, setCustomTo] = useState(thToday);
  // export: เลือก indicator ที่จะดาวน์โหลด
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSel, setExportSel] = useState([]);

  async function load() {
    setLoading(true);
    const [{ data: sc }, { data: ac }, { data: u }, { data: tf }, { data: br }] = await Promise.all([
      supabase.from("tv_scripts").select("*").order("created_at"),
      supabase.from("tv_access").select("*").order("created_at", { ascending: false }),
      supabase.auth.getUser(),
      supabase.from("settings").select("value").eq("key", "tv_features").maybeSingle(),
      supabase.from("tv_brands").select("id, name, show_in_manager, active").order("created_at"),
    ]);
    setScripts(sc || []);
    setAccess(ac || []);
    setBrands(br || []);
    setReleased(tf?.value?.released === true);
    const visBr = (br || []).filter((b) => b.show_in_manager !== false);
    if (visBr.length && !visBr.some((b) => b.id === brandSel)) setBrandSel(visBr[0].id);
    // role admin?
    const email = u?.user?.email;
    if (email) {
      const { data: p } = await supabase.from("user_permissions").select("role").eq("email", email).maybeSingle();
      setIsAdmin(p?.role === "admin");
    }
    setUpdatedAt(new Date());
    setLoading(false);
  }
  useEffect(() => { if (active) load(); /* eslint-disable-next-line */ }, [active]);
  // เปลี่ยนแบรนด์ในฟอร์มเพิ่ม → ล้างสคริปต์ที่เลือกไว้ (สคริปต์คนละแบรนด์ไม่ปน)
  useEffect(() => { setPineIds([]); setDur({}); /* eslint-disable-next-line */ }, [brandSel]);
  // realtime: มีการเปลี่ยนสิทธิ์ → รีเฟรชฟีด
  useEffect(() => {
    if (!active) return;
    const ch = supabase.channel("tv-access").on("postgres_changes", { event: "*", schema: "public", table: "tv_access" }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [active]);

  const now = Date.now();
  const stats = {
    total: new Set(access.map((a) => a.username)).size,
    activeCount: access.filter((a) => a.status === "active").length,
    soon: access.filter((a) => a.status === "active" && a.expiration && new Date(a.expiration).getTime() - now < 7 * 86400000 && new Date(a.expiration).getTime() > now).length,
    scripts: scripts.length,
  };
  const expLabel = (a) => a.expiration ? new Date(a.expiration).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "ตลอดชีพ";
  // สถานะใช้งาน: active (เขียว) / Expired (แดง) / ถอนสิทธิ์ (เทา) / error (เหลือง)
  const statusInfo = (a) => {
    if (a.status === "revoked") return { label: "ถอนสิทธิ์", cls: "text-slate-400" };
    if (a.status === "error") return { label: "error", cls: "text-amber-500" };
    const expired = a.status === "expired" || (a.expiration && new Date(a.expiration).getTime() <= now);
    return expired ? { label: "Expired", cls: "text-rose-500" } : { label: "active", cls: "text-emerald-600" };
  };
  const canSeeNewTv = isAdmin || released;   // ฟีเจอร์ใหม่ (คอลัมน์อีเมล): เห็นเฉพาะแอดมินจนกว่าจะกดปล่อย
  const filtered = (a) => !q.trim() || `${a.username} ${a.display_name || ""} ${a.trade_id || ""} ${a.email || ""}`.toLowerCase().includes(q.trim().toLowerCase());
  // เรียงลำดับตามหัวคอลัมน์ (คลิกสลับ ขึ้น/ลง)
  const [sortKey, setSortKey] = useState("create");
  const [sortDir, setSortDir] = useState("desc");
  const toggleSort = (k) => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("asc"); } };
  const sortVal = (a, k) => {
    switch (k) {
      case "name": return (a.display_name || "").toLowerCase();
      case "user": return (a.username || "").toLowerCase();
      case "email": return (a.email || "").toLowerCase();
      case "trade": return (a.trade_id || "").toLowerCase();
      case "exp": return a.expiration ? new Date(a.expiration).getTime() : Infinity;   // ตลอดชีพ = ท้ายสุด
      case "status": return statusInfo(a).label;
      case "tvGranted": return a.tv_granted_at ? new Date(a.tv_granted_at).getTime() : 0;
      case "by": return (a.granted_by || "").toLowerCase();
      case "editby": return a.edited_at ? new Date(a.edited_at).getTime() : 0;
      default: return new Date(a.created_at || a.granted_at || 0).getTime();            // create
    }
  };
  const sortRows = (arr) => [...arr].sort((x, y) => {
    const vx = sortVal(x, sortKey), vy = sortVal(y, sortKey);
    const c = (typeof vx === "number" && typeof vy === "number") ? (vx - vy) : String(vx).localeCompare(String(vy), "th");
    return sortDir === "asc" ? c : -c;
  });
  // หัวคอลัมน์คลิกได้ + ลูกศรบอกทิศ (เป็น 1 ช่องใน grid ที่กำหนดความกว้างเอง)
  const H = ({ k, children }) => (
    <button type="button" onClick={() => toggleSort(k)} className={`min-w-0 flex items-center gap-0.5 uppercase text-left truncate hover:text-slate-600 ${sortKey === k ? "text-slate-600 font-semibold" : ""}`}>
      <span className="truncate">{children}</span>{sortKey === k && <span className="shrink-0">{sortDir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
  // ความกว้างคอลัมน์ (เลื่อนแนวนอนได้เมื่อจอแคบ) — ต่างกันตามมี/ไม่มีคอลัมน์อีเมล
  const COLS = canSeeNewTv
    ? "minmax(120px,1.4fr) minmax(110px,1.2fr) minmax(150px,1.5fr) 78px 96px 86px 112px 82px 100px 132px 84px"
    : "minmax(140px,1.6fr) minmax(120px,1.3fr) 78px 96px 86px 112px 92px 108px 132px 84px";
  const tableMinW = canSeeNewTv ? 1230 : 1090;
  const createLabel = (a) => { const d = a.created_at || a.granted_at; return d ? new Date(d).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "—"; };
  const tvGrantedLabel = (a) => a.tv_granted_at
    ? new Date(a.tv_granted_at).toLocaleString("th-TH", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "ยังไม่มีข้อมูล";
  // ช่วงวันที่ที่เลือก → ขอบเขตเวลา (เทียบกับวันที่เพิ่มสมาชิก created_at/granted_at)
  const RANGE_PRESETS = [["today", "วันนี้"], ["yesterday", "เมื่อวาน"], ["3d", "3 วันที่ผ่านมา"], ["7d", "7 วันที่ผ่านมา"], ["30d", "30 วันที่ผ่านมา"], ["custom", "เลือกเอง"]];
  const rangeBounds = () => {
    let from, to;
    switch (rangeKey) {
      case "yesterday": from = thDayStr(-1); to = thDayStr(-1); break;
      case "3d": from = thDayStr(-2); to = thDayStr(0); break;
      case "7d": from = thDayStr(-6); to = thDayStr(0); break;
      case "30d": from = thDayStr(-29); to = thDayStr(0); break;
      case "custom": from = customFrom; to = customTo; break;
      default: from = thDayStr(0); to = thDayStr(0);
    }
    return { from, to, startMs: new Date(`${from}T00:00:00+07:00`).getTime(), endMs: new Date(`${to}T23:59:59.999+07:00`).getTime() };
  };
  const rb = rangeBounds();
  // กรองจากเวลาที่ให้สิทธิ์ล่าสุด ไม่ใช่ created_at เพียงอย่างเดียว
  // สมาชิกเดิมที่กดให้สิทธิ์ซ้ำจึงปรากฏในช่วง "วันนี้" ได้ถูกต้อง
  const memberGrantedAt = (a) => a.last_granted_at || a.granted_at || a.created_at;
  const inRange = (a) => { const cm = new Date(memberGrantedAt(a) || 0).getTime(); return cm >= rb.startMs && cm <= rb.endMs; };
  const fmtDMY2 = (s) => { const [y, m, d] = String(s).split("-"); return `${Number(d)}/${Number(m)}/${String(y).slice(2)}`; };
  const rangeLabel = rb.from === rb.to ? fmtDMY2(rb.from) : `${fmtDMY2(rb.from)} – ${fmtDMY2(rb.to)}`;
  // สรุปตัวเลขต่อสคริปต์ (ใช้ในการ์ดสรุปด้านบน) — กรองตามช่วงวันที่ที่เลือก
  const scriptStat = (s) => {
    const rows = access.filter((a) => a.pine_id === s.pine_id && inRange(a));
    const isActive = (a) => statusInfo(a).label === "active";
    const soon = rows.filter((a) => a.status !== "revoked" && a.expiration && new Date(a.expiration).getTime() > now && new Date(a.expiration).getTime() - now < 7 * 86400000).length;
    const expired = rows.filter((a) => statusInfo(a).label === "Expired").length;
    const latest = rows.slice().sort((x, y) => new Date(memberGrantedAt(y) || 0) - new Date(memberGrantedAt(x) || 0))[0];
    return { total: rows.length, active: rows.filter(isActive).length, soon, expired, latest };
  };

  // ป้ายสรุประยะเวลาต่อสคริปต์
  const durLabel = (d) => d.mode === "lifetime" ? "ตลอดชีพ"
    : d.mode === "date" ? `ถึง ${d.expDate ? new Date(`${d.expDate}T00:00:00+07:00`).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}`
    : `${Number(d.days) || 30} วัน`;
  async function grant() {
    if (!uname.trim()) { setMsg("ใส่ TradingView username ก่อน"); return; }
    if (!pineIds.length) { setMsg("เลือกสคริปต์อย่างน้อย 1 อัน"); return; }
    if (!tradeId.trim()) { setMsg("ใส่ไอดีเทรดก่อน (ระบบจะเช็คก่อนให้สิทธิ์)"); return; }
    // ตรวจวันหมดอายุของทุกสคริปต์ที่เลือก (โหมดปฏิทินต้องเลือกวันที่ถูกต้อง)
    for (const pid of pineIds) {
      const d = getDur(pid);
      if (d.mode === "date" && (!d.expDate || d.expDate < todayTH)) { setMsg(`เลือกวันหมดอายุของ "${scripts.find((s) => s.pine_id === pid)?.name || pid}" ให้ถูกต้องก่อน`); return; }
    }
    setGranting(true);
    // 1) เช็คไอดีเทรดก่อน — ต้องผ่านถึงจะเพิ่มสิทธิ์ TV
    setMsg("กำลังเช็คไอดีเทรด...");
    const { data: vt, error: ve } = await supabase.functions.invoke("verify-trade-id", { body: { trade_id: tradeId.trim() } });
    if (ve || !vt?.ok) { setGranting(false); setMsg("✗ เช็คไอดีเทรดไม่สำเร็จ: " + (vt?.error || (ve ? "ลองใหม่" : ""))); return; }
    if (!vt.pass) { setGranting(false); setMsg(`✗ ไอดีเทรด "${tradeId.trim()}" ไม่ผ่าน — ยังเพิ่มสิทธิ์ TradingView ไม่ได้`); return; }
    // 2) ผ่านแล้ว → ให้สิทธิ์ทีละสคริปต์ (แต่ละตัวใช้วันหมดอายุของตัวเอง)
    const summ = []; const fails = []; let realUser = uname.trim();
    for (const pid of pineIds) {
      const d = getDur(pid);
      // โหมดปฏิทิน = ส่งวันหมดอายุ (สิ้นวันที่เลือก เวลาไทย) ตรงๆ ไม่แปลงเป็นจำนวนวัน (normalize พ.ศ.→ค.ศ.)
      const expIso = d.mode === "date" && d.expDate ? new Date(`${beToCe(d.expDate)}T23:59:59+07:00`).toISOString() : null;
      const effDays = d.mode === "days" ? (Number(d.days) || 30) : 0;
      const name = scripts.find((s) => s.pine_id === pid)?.name || pid;
      setMsg(`✓ ไอดีเทรดผ่าน — กำลังเพิ่ม "${name}"...`);
      const { data, error } = await supabase.functions.invoke("tradingview", { body: {
        action: "grant", username: uname.trim(), display_name: dname.trim() || null, email: demail.trim() || null,
        pine_ids: [pid], lifetime: d.mode === "lifetime", days: effDays, expiration: expIso, trade_id: tradeId.trim(),
      } });
      if (error || !data?.ok) fails.push(`${name}: ${data?.error || data?.results?.[0]?.error || "ลองใหม่"}`);
      else { realUser = data.username || realUser; summ.push(`${name} (${durLabel(d)})`); }
    }
    setGranting(false);
    if (!summ.length) { setMsg("✗ เพิ่มสิทธิ์ไม่สำเร็จ: " + (fails.join(" · ") || "ลองใหม่")); return; }
    setMsg(`✓ ให้สิทธิ์ ${realUser} แล้ว: ${summ.join(", ")}${fails.length ? ` · ไม่สำเร็จ: ${fails.join(" · ")}` : ""}`);
    setUname(""); setDname(""); setDemail(""); setTradeId(""); setDur({});
    load();
  }
  async function revoke(a) {
    if (!confirm(`ถอนสิทธิ์ ${a.username} ออกจาก "${scripts.find((s) => s.pine_id === a.pine_id)?.name || a.pine_id}"?\n(ถอนสิทธิ์บน TradingView อย่างเดียว — ยังเก็บข้อมูลไว้ในตาราง สถานะจะเป็น "ถอนสิทธิ์")`)) return;
    setMsg(`กำลังถอนสิทธิ์ ${a.username}...`);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "revoke", username: a.username, pine_id: a.pine_id } });
    if (error || !data?.ok) { setMsg("✗ ถอนสิทธิ์ไม่สำเร็จ: " + (data?.error || "ลองใหม่")); return; }
    setMsg(`✓ ถอนสิทธิ์ ${a.username} บน TradingView แล้ว (สถานะ: ถอนสิทธิ์)`);
    load();
  }
  async function checkAccess(a) {
    setCheckingAccess((cur) => ({ ...cur, [a.id]: true }));
    setMsg(`กำลังตรวจสิทธิ์ ${a.username} บน TradingView...`);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "check_access", id: a.id } });
    setCheckingAccess((cur) => { const next = { ...cur }; delete next[a.id]; return next; });
    if (error || !data?.ok) {
      setMsg("✗ ตรวจสิทธิ์ไม่สำเร็จ: " + (data?.error || error?.message || "ลองใหม่"));
      load();
      return;
    }
    const grantedText = data.tv_granted_at
      ? ` · เพิ่มสิทธิ์บน TV: ${new Date(data.tv_granted_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`
      : " · TV ไม่ส่งวันที่เพิ่มสิทธิ์";
    setMsg(data.found
      ? `✓ ${a.username} ยังมีสิทธิ์บน TradingView${grantedText}`
      : `✓ ${a.username} ไม่พบสิทธิ์บน TradingView แล้ว${grantedText}`);
    load();
  }
  // ตั้งวันหมดอายุใหม่ (จำกัดวัน/ปฏิทิน/ตลอดชีพ) — ยิง grant ใหม่ (n8n จะอัปเดตบน TradingView ให้)
  function openExpiry(a) { setAdjRow(a); setAdjMode(a.expiration ? "date" : "lifetime"); setAdjDays(30); setAdjDate(a.expiration ? new Date(a.expiration).toISOString().slice(0, 10) : todayTH); }
  async function applyExpiry() {
    const a = adjRow; if (!a) return;
    if (adjMode === "date" && (!adjDate || beToCe(adjDate) < todayTH)) { setMsg("เลือกวันหมดอายุที่ถูกต้องก่อน"); return; }
    const expIso = adjMode === "date" && adjDate ? new Date(`${beToCe(adjDate)}T23:59:59+07:00`).toISOString() : null;
    const effDays = adjMode === "days" ? (Number(adjDays) || 30) : 0;
    setAdjusting(true);
    setMsg(`กำลังตั้งวันหมดอายุให้ ${a.username}...`);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: {
      action: "grant", username: a.username, pine_ids: [a.pine_id],
      display_name: a.display_name || null, email: a.email || null,
      lifetime: adjMode === "lifetime", days: effDays, expiration: expIso, trade_id: a.trade_id || null,
    } });
    setAdjusting(false);
    if (error || !data?.ok) { setMsg("✗ ตั้งวันหมดอายุไม่สำเร็จ: " + (data?.error || data?.results?.[0]?.error || "ลองใหม่")); return; }
    const label = adjMode === "lifetime" ? "ตลอดชีพ" : `หมดอายุ ${new Date(data.expiration || expIso || Date.now()).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" })}`;
    setMsg(`✓ ตั้งให้ ${a.username} แล้ว — ${label}`);
    setAdjRow(null); load();
  }
  // แก้ไขข้อมูลสมาชิก (ชื่อ/USER TV/อีเมล/Trade ID)
  function openEdit(a) { setEditRow(a); setEditForm({ display_name: a.display_name || "", username: a.username || "", email: a.email || "", trade_id: a.trade_id || "" }); }
  async function saveEdit() {
    const a = editRow; if (!a) return;
    const nextUsername = editForm.username.trim();
    if (!nextUsername) { setMsg("USER TV ห้ามว่าง"); return; }
    const usernameChanged = nextUsername.toLowerCase() !== String(a.username || "").trim().toLowerCase();
    if (usernameChanged && !confirm(`ย้ายสิทธิ์จาก USER TV \"${a.username}\" ไปเป็น \"${nextUsername}\"?\n\nระบบจะถอนสิทธิ์ชื่อเดิมบน TradingView แล้วให้สิทธิ์ชื่อใหม่ในสคริปต์นี้`)) return;
    setEditSaving(true);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "update_member", id: a.id, display_name: editForm.display_name, username: nextUsername, email: editForm.email, trade_id: editForm.trade_id } });
    setEditSaving(false);
    if (error || !data?.ok) { setMsg("✗ แก้ไขไม่สำเร็จ: " + (data?.error || "")); return; }
    setEditRow(null);
    setMsg(data?.username_changed
      ? `✓ เปลี่ยน USER TV แล้ว — ถอนสิทธิ์ ${data.old_username} และให้สิทธิ์ ${data.username} เรียบร้อย`
      : "✓ แก้ไขข้อมูลสมาชิกแล้ว");
    load();
  }
  async function deleteScript(s) {
    if (!confirm(`ลบสคริปต์ "${s.name}" ออกจากระบบ?\n(ลบเฉพาะในแอป ไม่ถอนสิทธิ์บน TradingView — สมาชิกในสคริปต์นี้จะหายจากลิสต์ด้วย)`)) return;
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "delete_script", pine_id: s.pine_id } });
    if (error || !data?.ok) { setMsg("✗ ลบสคริปต์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setPineIds((cur) => cur.filter((p) => p !== s.pine_id));
    load();
  }
  function exportCsv(selPineIds) {
    const sel = selPineIds && selPineIds.length ? selPineIds : scripts.map((s) => s.pine_id);
    const includeIndicator = sel.length > 1;
    const headers = [
      ...(includeIndicator ? ["Indicator"] : []),
      "ชื่อลูกค้า", "User TV", ...(canSeeNewTv ? ["อีเมล"] : []), "สถานะ", "Trade ID",
      "หมดอายุ", "เพิ่มสิทธิ์บน TV", "Create", "คนเพิ่ม", "แก้ไขโดย",
    ];
    const rows = [headers];
    const scriptNames = new Map(scripts.map((s) => [s.pine_id, s.name || s.pine_id]));
    for (const a of access) {
      if (!sel.includes(a.pine_id) || !inRange(a)) continue;   // เฉพาะ indicator ที่เลือก + อยู่ในช่วงวันที่กำลังดู
      const st = statusInfo(a);
      const editedBy = a.edited_at
        ? `${a.edited_by || "—"} · ${new Date(a.edited_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}`
        : "—";
      rows.push([
        ...(includeIndicator ? [scriptNames.get(a.pine_id) || a.pine_id] : []),
        a.display_name || "—", a.username || "", ...(canSeeNewTv ? [a.email || "—"] : []), st.label,
        a.trade_id || "—", expLabel(a), tvGrantedLabel(a), createLabel(a), a.granted_by || "—", editedBy,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `tv-members-${rb.from}${rb.from !== rb.to ? `_${rb.to}` : ""}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const St = ({ label, value, tone }) => (
    <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${tone || "text-slate-800"}`}>{value}</div>
    </div>
  );
  // การ์ดสรุปย่อย (ในการ์ดสรุปต่อสคริปต์)
  const SumCard = ({ label, value, unit, tone, icon, small }) => (
    <div className="bg-slate-50/60 rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] text-slate-400 leading-tight">{label}</div>
        <span className="shrink-0">{icon}</span>
      </div>
      <div className={`${small ? "text-lg" : "text-2xl"} font-bold mt-1 ${tone || "text-slate-800"} truncate`}>{value}</div>
      {unit && <div className="text-[11px] text-slate-400 truncate">{unit}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* modal เลือก Indicator ที่จะ export */}
      {exportOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => setExportOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Export CSV</h3>
              <button onClick={() => setExportOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div className="text-xs text-slate-500">ช่วงวันที่: <span className="text-slate-700 font-medium">{rangeLabel}</span> (ตามที่กำลังดูอยู่)</div>
            <div>
              <div className="text-xs text-slate-500 mb-1 flex items-center justify-between">
                <span>เลือก Indicator ที่จะ export</span>
                <button onClick={() => setExportSel(exportSel.length === scripts.length ? [] : scripts.map((s) => s.pine_id))} className="text-[11px] text-indigo-600 hover:underline">{exportSel.length === scripts.length ? "ล้าง" : "เลือกทั้งหมด"}</button>
              </div>
              <div className="rounded-lg border border-slate-300 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {scripts.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">ยังไม่มีสคริปต์</div>}
                {[...brands, { id: "__none", name: "ไม่มีแบรนด์" }].map((b) => {
                  const bScripts = scripts.filter((s) => (b.id === "__none" ? !s.brand_id : s.brand_id === b.id));
                  if (!bScripts.length) return null;
                  return (
                    <div key={"exb-" + b.id}>
                      <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-semibold text-slate-500">{b.name}</div>
                      {bScripts.map((s) => {
                        const on = exportSel.includes(s.pine_id);
                        const cnt = access.filter((a) => a.pine_id === s.pine_id && inRange(a)).length;
                        return (
                          <label key={s.pine_id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                            <input type="checkbox" checked={on} onChange={() => setExportSel((cur) => on ? cur.filter((p) => p !== s.pine_id) : [...cur, s.pine_id])} />
                            <span className="truncate flex-1">{s.name}</span>
                            <span className="text-[11px] text-slate-400">{cnt} คน</span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setExportOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">ยกเลิก</button>
              <button onClick={() => { exportCsv(exportSel); setExportOpen(false); }} disabled={!exportSel.length} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">ดาวน์โหลด</button>
            </div>
          </div>
        </div>
      )}
      {/* modal ตั้งวันหมดอายุ (จำกัดวัน / ปฏิทิน / ตลอดชีพ) */}
      {adjRow && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => !adjusting && setAdjRow(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Clock size={16} /> ตั้งวันหมดอายุ</h3>
              <button onClick={() => !adjusting && setAdjRow(null)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div className="text-sm text-slate-600">
              <div className="font-medium text-slate-800">{adjRow.username}{adjRow.display_name ? ` · ${adjRow.display_name}` : ""}</div>
              <div className="text-xs text-slate-500 mt-0.5">หมดอายุปัจจุบัน: {adjRow.expiration ? new Date(adjRow.expiration).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "ตลอดชีพ"}</div>
            </div>
            <div>
              <label className="text-xs text-slate-500">ระยะเวลา</label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1 text-sm">
                <label className="flex items-center gap-1.5"><input type="radio" checked={adjMode === "lifetime"} onChange={() => setAdjMode("lifetime")} /> ตลอดชีพ</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={adjMode === "days"} onChange={() => setAdjMode("days")} /> จำกัดวัน</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={adjMode === "date"} onChange={() => setAdjMode("date")} /> เลือกวันหมดอายุ</label>
              </div>
            </div>
            {adjMode === "days" && (
              <div>
                <label className="text-xs text-slate-500">จำนวนวัน (นับจากวันนี้)</label>
                <input type="number" min={1} value={adjDays} onChange={(e) => setAdjDays(e.target.value)} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            )}
            {adjMode === "date" && (
              <div>
                <label className="text-xs text-slate-500">วันหมดอายุ (เลือกจากปฏิทิน)</label>
                <input type="date" value={adjDate} min={todayTH} onChange={(e) => setAdjDate(beToCe(e.target.value))} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdjRow(null)} disabled={adjusting} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">ยกเลิก</button>
              <button onClick={applyExpiry} disabled={adjusting} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{adjusting ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}
      {/* modal แก้ไขข้อมูลสมาชิก */}
      {editRow && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => !editSaving && setEditRow(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Pencil size={15} /> แก้ไขข้อมูลสมาชิก</h3>
              <button onClick={() => !editSaving && setEditRow(null)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div><label className="text-xs text-slate-500">ชื่อลูกค้า</label><input value={editForm.display_name} onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-slate-500">USER TV</label><input value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-slate-500">อีเมล</label><input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-slate-500">Trade ID</label><input value={editForm.trade_id} onChange={(e) => setEditForm({ ...editForm, trade_id: e.target.value })} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            {editForm.username.trim().toLowerCase() !== String(editRow.username || "").trim().toLowerCase() && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ระบบจะถอนสิทธิ์ <b>{editRow.username}</b> บน TradingView แล้วให้สิทธิ์ <b>{editForm.username.trim() || "ชื่อใหม่"}</b> ในสคริปต์เดิม
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditRow(null)} disabled={editSaving} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">ยกเลิก</button>
              <button onClick={saveEdit} disabled={editSaving} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{editSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}
      {/* หัว */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-400">· Live Member Feed ·</div>
          <h2 className="text-2xl font-bold text-slate-800">Access Console</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> อัปเดต {updatedAt ? updatedAt.toLocaleTimeString("th-TH") : "—"}</span>
          <button onClick={load} disabled={loading} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">รีเฟรช</button>
        </div>
      </div>

      {msg && <div className="text-sm rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-slate-700">{msg}</div>}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ซ้าย: ฟอร์มเพิ่มสมาชิก */}
        <div className="lg:w-80 shrink-0 bg-white rounded-2xl border border-slate-200 p-5 space-y-3 h-fit">
          <h3 className="font-semibold text-slate-800">เพิ่มสมาชิกใหม่</h3>
          <div>
            <label className="text-xs text-slate-500">TradingView username</label>
            <input value={uname} onChange={(e) => setUname(e.target.value)} placeholder="username TV" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">ชื่อลูกค้า</label>
            <input value={dname} onChange={(e) => setDname(e.target.value)} placeholder="ชื่อลูกค้า" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          {canSeeNewTv && (
          <div>
            <label className="text-xs text-slate-500">อีเมลลูกค้า</label>
            <input value={demail} onChange={(e) => setDemail(e.target.value)} placeholder="อีเมลลูกค้า (ถ้ามี)" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          )}
          <div>
            <label className="text-xs text-slate-500">ไอดีเทรด (XM)</label>
            <input value={tradeId} onChange={(e) => setTradeId(e.target.value)} placeholder="เลขไอดีเทรด — ต้องผ่านก่อนถึงเพิ่มได้" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">แบรนด์</label>
            <select value={brandSel ?? ""} onChange={(e) => setBrandSel(Number(e.target.value) || null)} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
              {brands.filter((b) => b.show_in_manager !== false).length === 0 && <option value="">ยังไม่มีแบรนด์</option>}
              {brands.filter((b) => b.show_in_manager !== false).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">สคริปต์ (เลือกได้หลายอัน — กำหนดวันหมดอายุแยกแต่ละตัว)</label>
            <div className="mt-1 rounded-lg border border-slate-300 divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {scripts.filter((s) => s.brand_id === brandSel).length === 0 && <div className="px-3 py-2 text-sm text-slate-400">แบรนด์นี้ยังไม่มีสคริปต์</div>}
              {scripts.filter((s) => s.brand_id === brandSel).map((s) => {
                const on = pineIds.includes(s.pine_id);
                const d = getDur(s.pine_id);
                return (
                  <div key={s.pine_id} className={on ? "bg-indigo-50/40" : ""}>
                    <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={on} onChange={() => toggleScript(s.pine_id, on)} />
                      <span className="truncate flex-1">{s.name}</span>
                      {on && <span className="text-[11px] text-slate-400 shrink-0">{durLabel(d)}</span>}
                    </label>
                    {on && (
                      <div className="px-3 pb-2.5 pl-8 space-y-1.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "lifetime"} onChange={() => setDurFor(s.pine_id, { mode: "lifetime" })} /> ตลอดชีพ</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "days"} onChange={() => setDurFor(s.pine_id, { mode: "days" })} /> จำกัดวัน</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "date"} onChange={() => setDurFor(s.pine_id, { mode: "date" })} /> เลือกวัน</label>
                        </div>
                        {d.mode === "days" && <input type="number" min={1} value={d.days} onChange={(e) => setDurFor(s.pine_id, { days: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />}
                        {d.mode === "date" && <input type="date" value={d.expDate} min={todayTH} onChange={(e) => setDurFor(s.pine_id, { expDate: beToCe(e.target.value) })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {pineIds.length > 0 && <div className="text-[11px] text-slate-400 mt-1">เลือกแล้ว {pineIds.length} สคริปต์</div>}
          </div>
          <button onClick={grant} disabled={granting} className="w-full rounded-lg bg-indigo-600 text-white py-2.5 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {granting ? "กำลังเพิ่ม..." : "เพิ่มสิทธิ์"}
          </button>
        </div>

        {/* ขวา: ค้นหา + รายชื่อต่อสคริปต์ */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* ช่วงวันที่ดูข้อมูล (กรองตามวันที่เพิ่มสมาชิก) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 mr-1">ช่วงวันที่:</span>
            {RANGE_PRESETS.map(([key, label]) => (
              <button key={key} onClick={() => setRangeKey(key)} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${rangeKey === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>{label}</button>
            ))}
            {rangeKey === "custom" && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} max={thToday} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                <span className="text-slate-400 text-xs">ถึง</span>
                <input type="date" value={customTo} max={thToday} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
              </div>
            )}
            <span className="ml-auto text-xs text-slate-400">แสดง: {rangeLabel}</span>
          </div>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา username, ชื่อ, หรือเลข trade id" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          {/* จัดกลุ่มตามแบรนด์ (เฉพาะแบรนด์ที่โชว์ในหน้าจัดการ) — นับ/แสดง/export แยกกัน ไม่ปน */}
          {brands.filter((b) => b.show_in_manager !== false).map((b) => {
            const brScripts = scripts.filter((s) => s.brand_id === b.id);
            const brMembers = access.filter((a) => brScripts.some((s) => s.pine_id === a.pine_id) && inRange(a));
            const brCollapsed = collapsed["brand:" + b.id];
            return (
            <div key={"brand-" + b.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                <button onClick={() => setCollapsed((c) => ({ ...c, ["brand:" + b.id]: !brCollapsed }))} className="flex items-center gap-2 min-w-0">
                  {brCollapsed ? <ChevronDown size={18} className="text-slate-400 shrink-0" /> : <ChevronUp size={18} className="text-slate-400 shrink-0" />}
                  <h2 className="text-lg font-bold text-slate-800 truncate">{b.name}</h2>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-400">{new Set(brMembers.map((a) => a.username)).size} สมาชิก · {brScripts.length} สคริปต์</span>
                  <button onClick={() => { setExportSel(brScripts.map((s) => s.pine_id)); setExportOpen(true); }} className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-slate-600 hover:bg-slate-50">Export</button>
                </div>
              </div>
              {!brCollapsed && brScripts.length === 0 && <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center text-xs text-slate-400">แบรนด์นี้ยังไม่มีสคริปต์ — เพิ่มที่ ตั้งค่า → ตั้งค่า TV</div>}
              {!brCollapsed && brScripts.map((s) => {
                const ss = scriptStat(s);
                const open = !collapsed["sum:" + s.pine_id];
                return (
                  <div key={"sum-" + s.pine_id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-800 truncate">{s.name}</h3>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-slate-400">{ss.total} สมาชิก</span>
                        <button onClick={() => setCollapsed((c) => ({ ...c, ["sum:" + s.pine_id]: open }))} className="text-slate-400 hover:text-slate-600">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                      </div>
                    </div>
                    {open && (
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                        <SumCard label="ทั้งหมด" value={ss.total} unit="สมาชิก" icon={<Users size={16} className="text-indigo-400" />} />
                        <SumCard label="Active" value={ss.active} unit="สมาชิก" tone="text-emerald-600" icon={<span className="w-2 h-2 rounded-full bg-emerald-500 inline-block mt-1.5" />} />
                        <SumCard label="หมดอายุภายใน 7 วัน" value={ss.soon} unit="สมาชิก" tone="text-amber-500" icon={<Clock size={16} className="text-amber-400" />} />
                        <SumCard label="หมดอายุแล้ว" value={ss.expired} unit="สมาชิก" tone="text-rose-500" icon={<CalendarX2 size={16} className="text-rose-400" />} />
                        <SumCard label="เพิ่มล่าสุด" value={ss.latest ? createLabel(ss.latest) : "—"} unit={ss.latest?.username || "—"} small icon={<CalendarPlus size={16} className="text-violet-400" />} />
                      </div>
                    )}
                  </div>
                );
              })}
              {!brCollapsed && brScripts.map((s) => {
            const allRows = sortRows(access.filter((a) => a.pine_id === s.pine_id && filtered(a) && inRange(a)));
            const open = !collapsed[s.pine_id];
            const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
            const page = Math.min(pageBy[s.pine_id] || 1, totalPages);
            const pageRows = allRows.slice((page - 1) * pageSize, page * pageSize);
            return (
              <div key={s.pine_id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">{s.name}</div>
                    {s.script_key && <div className="text-[11px] text-slate-400 truncate">{s.script_key}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500">{allRows.length} สมาชิก</span>
                    {isAdmin && <button onClick={() => deleteScript(s)} className="flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 rounded-md px-2 py-1" title="ลบสคริปต์นี้"><Trash2 size={13} /> ลบสคริปต์</button>}
                    <button onClick={() => setCollapsed((c) => ({ ...c, [s.pine_id]: open }))} className="text-slate-400 hover:text-slate-600">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                  </div>
                </div>
                {open && <>
                <div className="overflow-x-auto">
                  <div className="divide-y divide-slate-100" style={{ minWidth: tableMinW }}>
                    <div className="grid gap-2 px-4 py-2 text-[11px] text-slate-400" style={{ gridTemplateColumns: COLS }}>
                      <H k="name">ชื่อลูกค้า</H><H k="user">User TV</H>{canSeeNewTv && <H k="email">อีเมล</H>}<H k="status">สถานะ</H><H k="trade">Trade ID</H><H k="exp">หมดอายุ</H><H k="tvGranted">เพิ่มสิทธิ์บน TV</H><H k="create">Create</H><H k="by">คนเพิ่ม</H><H k="editby">แก้ไขโดย</H><span></span>
                    </div>
                    {pageRows.length === 0 ? <div className="px-4 py-6 text-center text-xs text-slate-400">ยังไม่มีสมาชิกในสคริปต์นี้</div> : pageRows.map((a) => {
                      const st = statusInfo(a);
                      const nearExp = a.expiration && new Date(a.expiration).getTime() - now < 7 * 86400000 && new Date(a.expiration).getTime() > now;
                      return (
                      <div key={a.id} className="grid gap-2 px-4 py-2.5 text-sm items-center" style={{ gridTemplateColumns: COLS }}>
                        {a.display_name && (a.trade_id || a.username)
                          ? <a href={`${window.location.pathname}?tab=inbox&${a.trade_id ? `open_trade=${encodeURIComponent(a.trade_id)}` : `open_tv=${encodeURIComponent(a.username)}`}`} target="_blank" rel="noopener noreferrer" className="min-w-0 font-medium text-indigo-600 hover:text-indigo-700 hover:underline truncate" title={`เปิดแชทของ ${a.display_name}`}>{a.display_name}</a>
                          : <span className="min-w-0 font-medium text-slate-800 truncate" title={a.display_name || ""}>{a.display_name || "—"}</span>}
                        <span className="min-w-0 text-slate-600 truncate" title={a.username}>{a.username}</span>
                        {canSeeNewTv && <span className="min-w-0 text-slate-500 truncate text-xs" title={a.email || ""}>{a.email || "—"}</span>}
                        <span className="min-w-0 flex flex-col items-start gap-0.5 truncate">
                          <span className={`text-xs font-semibold truncate ${st.cls}`}>{st.label}</span>
                          {a.tv_verified_at && (
                            <span className={`text-[10px] font-medium truncate ${a.tv_access_verified === true ? "text-emerald-600" : a.tv_access_verified === false ? "text-rose-500" : "text-amber-500"}`} title={a.tv_verify_error || "ตรวจสิทธิ์ล่าสุด"}>
                              {a.tv_access_verified === true ? "TV: มีสิทธิ์" : a.tv_access_verified === false ? "TV: ไม่พบสิทธิ์" : "TV: ตรวจไม่ได้"}
                            </span>
                          )}
                        </span>
                        <span className="text-slate-500 truncate text-xs" title={a.trade_id || ""}>{a.trade_id || "—"}</span>
                        <span className={`text-xs truncate ${nearExp ? "text-amber-500" : "text-slate-500"}`}>{expLabel(a)}</span>
                        <span className={`text-xs truncate ${a.tv_granted_at ? "text-violet-600" : "text-slate-400"}`} title={a.tv_granted_at ? "วันที่ที่ TradingView ระบุว่าเพิ่มสิทธิ์" : "การตรวจจาก TradingView ยังไม่ส่งวันที่เพิ่มสิทธิ์"}>{tvGrantedLabel(a)}</span>
                        <span className="text-xs text-slate-500 truncate">{createLabel(a)}</span>
                        <span className="text-xs text-slate-500 truncate" title={a.granted_by || ""}>{a.granted_by || "—"}</span>
                        <span className="text-xs text-slate-500 truncate min-w-0" title={a.edited_by || ""}>{a.edited_at ? <>{a.edited_by || "—"} <span className="text-slate-400">· {new Date(a.edited_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}</span></> : "—"}</span>
                        <span className="flex items-center justify-end gap-1.5">
                          <button onClick={() => checkAccess(a)} disabled={!!checkingAccess[a.id]} className="text-slate-400 hover:text-emerald-600 disabled:opacity-50" title="ตรวจสิทธิ์บน TradingView">
                            {checkingAccess[a.id] ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                          </button>
                          <button onClick={() => openEdit(a)} className="text-slate-400 hover:text-slate-700" title="แก้ไขข้อมูล"><Pencil size={14} /></button>
                          <button onClick={() => openExpiry(a)} className="text-slate-400 hover:text-indigo-600" title="ตั้งวันหมดอายุ"><Clock size={15} /></button>
                          <button onClick={() => revoke(a)} className="text-slate-400 hover:text-rose-600" title="ถอนสิทธิ์ (ออกจาก TV อย่างเดียว)"><X size={16} /></button>
                        </span>
                      </div>
                      );
                    })}
                  </div>
                </div>
                {allRows.length > pageSize && (
                  <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 text-sm">
                    <div className="flex items-center gap-1.5">
                      <button disabled={page <= 1} onClick={() => setPageBy((p) => ({ ...p, [s.pine_id]: page - 1 }))} className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-40 hover:bg-slate-50">‹ ก่อนหน้า</button>
                      <span className="px-2 text-slate-500">หน้า {page}/{totalPages}</span>
                      <button disabled={page >= totalPages} onClick={() => setPageBy((p) => ({ ...p, [s.pine_id]: page + 1 }))} className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-40 hover:bg-slate-50">ถัดไป ›</button>
                    </div>
                    <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPageBy({}); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm bg-white">
                      <option value={20}>20 / หน้า</option><option value={50}>50 / หน้า</option><option value={100}>100 / หน้า</option>
                    </select>
                  </div>
                )}
                </>}
              </div>
            );
          })}
            </div>
            );
          })}
          {brands.filter((b) => b.show_in_manager !== false).length === 0 && <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-400">ยังไม่มีแบรนด์ที่โชว์ในหน้านี้ — เพิ่ม/ตั้งค่าแบรนด์ที่ <b>ตั้งค่า → ตั้งค่า TV</b></div>}
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { key: "overview", label: "ภาพรวม", icon: LayoutDashboard },
  { key: "generate", label: "สร้างคอนเทนต์", icon: Sparkles },
  { key: "review", label: "รออนุมัติ", icon: CheckCircle2 },
  { key: "campaigns", label: "แคมเปญ", icon: TrendingUp },
  { key: "analyze", label: "วิเคราะห์", icon: BarChart3 },
  { key: "inbox", label: "ตอบแชท", icon: Inbox },
  { key: "customerdb", label: "รีพอร์ตลูกค้าทักแชท", icon: Database },
  { key: "leaderboard", label: "กระดานแต้ม", icon: Trophy },
  { key: "tv_members", label: "จัดการสมาชิก TV", icon: Tv },
  { key: "settings", label: "ตั้งค่า", icon: SettingsIcon },
];

function Dashboard() {
  // สิทธิ์ผู้ใช้: null = กำลังโหลด, {role, allowed}
  const [perm, setPerm] = useState(null);
  useEffect(() => {
    (async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) { setPerm({ role: "denied", error: "ตรวจสอบผู้ใช้ไม่สำเร็จ" }); return; }
      const { data, error } = await supabase.from("user_permissions").select("role, allowed_ad_accounts, allowed_tabs, allowed_pages, allowed_settings, chat_alert, alert_minutes, alert_pages, alert_sound, alert_new").eq("email", user.email.toLowerCase()).maybeSingle();
      if (error || !data || !["admin", "analyze_only"].includes(data.role)) {
        setPerm({ role: "denied", email: user.email, error: error?.message || "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน" });
        return;
      }
      const role = data.role;
      const allowed = Array.isArray(data?.allowed_ad_accounts) ? data.allowed_ad_accounts.map((v) => String(v).replace(/^act_/, "")) : [];
      const allowedTabs = Array.isArray(data?.allowed_tabs) ? data.allowed_tabs.map(String) : [];
      const allowedPages = Array.isArray(data?.allowed_pages) ? data.allowed_pages.map(String) : [];
      const allowedSettings = Array.isArray(data?.allowed_settings) ? data.allowed_settings.map(String) : [];
      setPerm({
        role, allowed, allowedTabs, allowedPages, allowedSettings, email: user.email,
        chatAlert: data?.chat_alert !== false,
        // ตั้งค่าแจ้งเตือนรายคน (แอดมินกำหนด) — ผู้ใช้แก้เองไม่ได้
        alertMinutes: Number(data?.alert_minutes) > 0 ? Number(data.alert_minutes) : 3,
        alertPages: Array.isArray(data?.alert_pages) ? data.alert_pages.map(String) : [],
        alertSound: data?.alert_sound !== false,
        alertNew: data?.alert_new !== false,
      });
    })();
  }, []);
  const restricted = perm?.role === "analyze_only";
  // การมองเห็นเมนู "ออฟฟิศจำลอง" (Game) — คุมจากหน้าตั้งค่า (settings.game_office)
  //   { enabled, emails:[] } : ปิด = ไม่มีใครเห็น ; เปิด+ระบุอีเมล = เห็นเฉพาะอีเมลนั้น ; เปิด+ว่าง = ทุกคน
  const [officeCfg, setOfficeCfg] = useState(null);
  useEffect(() => { supabase.from("settings").select("value").eq("key", "game_office").maybeSingle().then(({ data }) => setOfficeCfg(data?.value || { enabled: true, emails: [] })); }, []);
  const officeVisible = (() => {
    if (!officeCfg) return false;                       // ยังโหลดไม่เสร็จ = ซ่อนไว้ก่อน กันกระพริบ
    if (officeCfg.enabled === false) return false;
    const emails = Array.isArray(officeCfg.emails) ? officeCfg.emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean) : [];
    if (emails.length) return emails.includes(String(perm?.email || "").toLowerCase());
    return true;                                        // เปิด + ไม่ระบุอีเมล = ทุกคน
  })();
  // การมองเห็นเมนู "กระดานแต้ม" (Leaderboard) — คุมจาก settings.leaderboard { enabled, emails[] }
  //   ค่าเริ่มต้น = เปิดให้ทุกคนเห็น (แอดมินปิด/จำกัดได้)
  const [lbCfg, setLbCfg] = useState(null);
  useEffect(() => { supabase.from("settings").select("value").eq("key", "leaderboard").maybeSingle().then(({ data }) => setLbCfg(data?.value || { enabled: true, emails: [] })); }, []);
  const leaderboardVisible = (() => {
    if (!lbCfg) return false;
    if (lbCfg.enabled === false) return false;
    const emails = Array.isArray(lbCfg.emails) ? lbCfg.emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean) : [];
    if (emails.length) return emails.includes(String(perm?.email || "").toLowerCase());
    return true;
  })();
  // เมนูที่เห็น: admin = ทุกเมนู ; จำกัดสิทธิ์ = ตาม allowed_tabs (ว่าง = ไม่มีสิทธิ์)
  const allowedTabKeys = perm?.allowedTabs || [];
  const visibleTabs = (!perm ? [] : restricted
      // จำกัดสิทธิ์: ตาม allowed_tabs (รวมเมนูลิงก์ภายนอก เช่น จัดการสมาชิก TV) — "กระดานแต้ม" คุมแยกที่ตั้งค่า
      ? TABS.filter((t) => allowedTabKeys.includes(t.key) || (t.key === "leaderboard" && leaderboardVisible))
      : TABS)
    .filter((t) => t.key !== "office" || officeVisible)          // ซ่อน office ตามการตั้งค่า
    .filter((t) => t.key !== "leaderboard" || leaderboardVisible); // ซ่อนกระดานแต้มตามการตั้งค่า
  const allowedPages = restricted ? (perm?.allowedPages || []) : null;  // [] = ไม่เห็นเพจ, null = admin ทุกเพจ
  const allowedSettings = restricted ? (perm?.allowedSettings || []) : null;  // [] = ไม่มีหัวข้อ, null = admin ทุกหัวข้อ
  const can = (k) => visibleTabs.some((t) => t.key === k);

  // จำแท็บล่าสุดไว้ เพื่อไม่ให้รีเฟรชแล้วเด้งกลับหน้าแรกทุกครั้ง
  // แท็บอ่านจาก URL ก่อน (?tab=inbox) — ทำให้เปิดแท็บใหม่/บุ๊กมาร์ก/แชร์ลิงก์ไปหน้าที่ต้องการได้
  const [tab, setTab] = useState(() => {
    try { const q = new URLSearchParams(window.location.search).get("tab"); if (q) return q; } catch { /* ไม่มี URL ก็ข้าม */ }
    return lsGet("ui.tab", "overview");
  });
  const [mountedTabs, setMountedTabs] = useState(() => new Set());
  useEffect(() => {
    if (!perm || perm.role === "denied" || !can(tab)) return;
    setMountedTabs((current) => current.has(tab) ? current : new Set([...current, tab]));
  }, [tab, perm, visibleTabs]);
  const shouldMount = (key) => can(key) && mountedTabs.has(key);
  // { id, at } หรือ { trade_id } / { username } — แชทที่สั่งให้เปิดจากหน้าอื่น หรือจากลิงก์ ?open_trade=/?open_tv= (หน้าจัดการสมาชิก TV)
  const [gotoChat, setGotoChat] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const t = p.get("open_trade"); if (t) return { trade_id: t };
      const u = p.get("open_tv"); if (u) return { username: u };
    } catch { /* ไม่มี URL ก็ข้าม */ }
    return null;
  });
  const [menuOpen, setMenuOpen] = useState(false); // เมนูแฮมเบอร์เกอร์ (มือถือ)
  useEffect(() => {
    lsSet("ui.tab", tab); logActivity("view_tab", { tab });
    // ให้ URL ตรงกับแท็บที่เปิดอยู่ — คลิกขวา "เปิดในแท็บใหม่" หรือก๊อป URL ไปเปิดที่อื่นแล้วมาถูกหน้า
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("tab") !== tab) { u.searchParams.set("tab", tab); window.history.replaceState({}, "", u); }
    } catch { /* ไม่รองรับก็ข้าม */ }
  }, [tab]);   // เก็บว่าเปิดหน้าไหนบ้าง (ดูในประวัติการใช้งาน)
  // ถ้าแท็บปัจจุบันไม่มีสิทธิ์เข้า → เด้งไปแท็บแรกที่เข้าได้ (ข้ามเมนูลิงก์ภายนอกที่ไม่มีหน้าในแอป)
  useEffect(() => {
    if (perm && visibleTabs.length && !visibleTabs.some((t) => t.key === tab)) {
      const first = visibleTabs.find((t) => !t.href) || visibleTabs[0];
      setTab(first.key);
    }
  }, [perm, tab, visibleTabs]);
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [adContent, setAdContent] = useState([]);
  const [settings, setSettings] = useState({});
  const [metricsToday, setMetricsToday] = useState([]);
  const [metricsByAdId, setMetricsByAdId] = useState({});
  const [metricsHistoryByAd, setMetricsHistoryByAd] = useState({});
  const [loading, setLoading] = useState(true);

  const [adCopies, setAdCopies] = useState([]);
  const [adImages, setAdImages] = useState([]);

  const loadAll = useCallback(async () => {
    // หน้าแชท/ฐานข้อมูล/กระดานแต้มมีตัวโหลดของตัวเอง ไม่ควรรอข้อมูลโฆษณาทั้งระบบ
    const needsAds = ["overview", "campaigns", "analyze"].includes(tab);
    const needsCopies = ["overview", "review"].includes(tab);
    const needsImages = ["overview", "review"].includes(tab);
    const needsSettings = ["generate", "review", "analyze", "settings"].includes(tab);
    const needsTodayMetrics = ["overview", "campaigns"].includes(tab);
    const needsHistory = tab === "analyze";
    if (!needsAds && !needsCopies && !needsImages && !needsSettings && !needsTodayMetrics && !needsHistory) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const skip = Promise.resolve({ data: null });
    const [{ data: ads }, { data: copies }, { data: images }, { data: settingsRows }, { data: metrics }, { data: history }] =
      await Promise.all([
        needsAds ? supabase.from("ad_content").select("*").order("created_at", { ascending: false }) : skip,
        needsCopies ? supabase.from("ad_copies").select("*").order("created_at", { ascending: false }) : skip,
        needsImages ? supabase.from("ad_images").select("*").order("created_at", { ascending: false }) : skip,
        needsSettings ? supabase.from("settings").select("key, value") : skip,
        needsTodayMetrics ? supabase.from("metrics_log").select("*").gte("checked_at", startOfToday).order("checked_at", { ascending: false }) : skip,
        needsHistory ? supabase
          .from("metrics_log")
          .select("*")
          .gte("checked_at", since14d)
          .order("checked_at", { ascending: false })
          .limit(2000) : skip,
      ]);

    if (ads) setAdContent(ads);
    if (copies) setAdCopies(copies);
    if (images) setAdImages(images);

    if (settingsRows) {
      const settingsObj = {};
      settingsRows.forEach((r) => (settingsObj[r.key] = r.value));
      setSettings(settingsObj);
    }

    if (metrics) {
      setMetricsToday(metrics);
      const latestByAd = {};
      metrics.forEach((m) => {
        if (!latestByAd[m.ad_content_id]) latestByAd[m.ad_content_id] = m;
      });
      setMetricsByAdId(latestByAd);
    }

    // ประวัติ metric 14 วันล่าสุด จัดกลุ่มตามแอด (เรียงใหม่->เก่า) ใช้ในหน้า "วิเคราะห์"
    if (history) {
      const histByAd = {};
      history.forEach((m) => {
        (histByAd[m.ad_content_id] = histByAd[m.ad_content_id] || []).push(m);
      });
      setMetricsHistoryByAd(histByAd);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    if (!perm || perm.role === "denied") return;
    loadAll();
    if (!["overview", "review", "campaigns", "analyze"].includes(tab)) return;
    // realtime: รีเฟรชอัตโนมัติเมื่อมีการเปลี่ยนแปลงในตาราง ad_content/ad_copies/ad_images
    // (เช่น monitor-ads auto-pause จากอีกฝั่ง หรือ generate-ad-content สร้างชิ้นใหม่)
    const channel = supabase
      .channel("ad_data_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_content" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_copies" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_images" }, () => loadAll())
      .subscribe();
    // สำรอง: รีเฟรชทุก 60 วิ เผื่อ realtime หลุด
    const interval = setInterval(loadAll, 60000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [loadAll, perm?.role, tab]);

  // heartbeat ทุก 5 นาที (เฉพาะตอนเปิดดูอยู่) — ให้หน้า "ประวัติการใช้งาน" นับได้ว่าออนไลน์กี่เครื่อง
  useEffect(() => {
    const beat = () => { if (document.visibilityState === "visible") logActivity("heartbeat"); };
    beat();
    const iv = setInterval(beat, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", beat);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", beat); };
  }, []);

  async function handleLogout() {
    await logActivity("logout");
    // cache รายงานมีข้อมูลลูกค้า: เก็บเฉพาะระหว่าง session และต้องล้างก่อนออกจากระบบ
    customerDatabaseReportCache.clear();
    customerDatabaseViewCache = null;
    // ถอน Web Push ของ "อุปกรณ์นี้" ก่อนล้าง session มิฉะนั้น server ยังส่งเตือนมาที่ endpoint เดิมหลัง logout
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      const subscription = await reg?.pushManager?.getSubscription?.();
      if (subscription?.endpoint) {
        await supabase.functions.invoke("send-push", { body: { action: "unsubscribe", endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      const notifications = await reg?.getNotifications?.();
      (notifications || []).forEach((notification) => notification.close());
      if ("clearAppBadge" in navigator) await navigator.clearAppBadge();
    } catch { /* logout ต้องทำต่อแม้ browser ถอน push ไม่สำเร็จ */ }
    await supabase.auth.signOut();
  }

  if (perm?.role === "denied") {
    return (
      <div className="permission-denied min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
        <div className="fixed top-4 right-4 z-50"><ThemeToggle /></div>
        <div className="max-w-md w-full rounded-2xl border border-rose-400/30 bg-white/5 p-6 text-center">
          <AlertTriangle className="mx-auto text-rose-400" size={34} />
          <h1 className="mt-3 text-lg font-semibold">บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน</h1>
          <p className="mt-2 text-sm text-slate-300">{perm.error || "ติดต่อผู้ดูแลเพื่อเพิ่มสิทธิ์ใน user_permissions"}</p>
          <button onClick={handleLogout} className="mt-5 rounded-lg bg-white text-slate-900 px-4 py-2 text-sm font-medium">ออกจากระบบ</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      {/* Sidebar ซ้าย — เดสก์ท็อป/แท็บเล็ต */}
      <aside className="hidden md:flex md:flex-col md:w-60 md:shrink-0 md:h-screen md:sticky md:top-0 bg-white border-r border-slate-200 z-30">
        <button onClick={() => setTab("overview")} className="flex items-center gap-2 font-semibold text-slate-800 hover:opacity-80 px-4 py-4 border-b border-slate-200 min-w-0 text-left" title="กลับหน้าแรก">
          <Sparkles size={20} className="shrink-0" />
          <span className="truncate">AI Ads Automation</span>
        </button>
        <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {perm && visibleTabs.map((t) => (
            t.href ? (
              <a key={t.key} href={t.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium no-underline border-l-2 border-transparent text-slate-500 hover:text-slate-700 hover:bg-black/5">
                <t.icon size={17} className="shrink-0" /> <span className="truncate">{t.label}</span> <ExternalLink size={12} className="opacity-60 ml-auto shrink-0" />
              </a>
            ) : (
              <a key={t.key} href={`?tab=${t.key}`}
                onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return; e.preventDefault(); setTab(t.key); }}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium no-underline border-l-2 ${tab === t.key ? "border-amber-500 bg-amber-500/10 text-white" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-black/5"}`}>
                <t.icon size={17} className="shrink-0" /> <span className="truncate">{t.label}</span>
              </a>
            )
          ))}
        </nav>
        <div className="p-2 border-t border-slate-200 flex items-center gap-1">
          <ThemeToggle />
          <button onClick={loadAll} className="text-slate-400 hover:text-slate-700 p-2" title="รีเฟรช"><RefreshCw size={18} /></button>
          <button onClick={handleLogout} className="text-slate-400 hover:text-slate-700 flex items-center gap-1.5 text-sm px-2 py-2 ml-auto" title="ออกจากระบบ"><LogOut size={16} /> ออกจากระบบ</button>
        </div>
      </aside>

      {/* คอลัมน์ขวา: header มือถือ + เนื้อหา */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
      <header className="md:hidden app-header bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* ปุ่มแฮมเบอร์เกอร์ — แสดงเฉพาะมือถือ */}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="md:hidden text-slate-600 hover:text-slate-900 p-1 -ml-1"
              aria-label="เมนู"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <button onClick={() => { setTab("overview"); setMenuOpen(false); }} className="flex items-center gap-2 font-semibold text-slate-800 hover:opacity-80 min-w-0" title="กลับหน้าแรก">
              <Sparkles size={20} className="shrink-0" />
              <span className="truncate">AI Ads Automation</span>
            </button>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle />
            <button onClick={loadAll} className="text-slate-400 hover:text-slate-700" title="รีเฟรช">
              <RefreshCw size={18} />
            </button>
            <button onClick={handleLogout} className="text-slate-400 hover:text-slate-700 flex items-center gap-1 text-sm" title="ออกจากระบบ">
              <LogOut size={16} />
              <span className="hidden sm:inline">ออกจากระบบ</span>
            </button>
          </div>
        </div>

        {/* เมนูแบบ dropdown — มือถือ (เปิดจากปุ่มแฮมเบอร์เกอร์) */}
        {menuOpen && (
          <div className="md:hidden border-t border-slate-200 px-2 py-2 flex flex-col gap-0.5">
            {perm && visibleTabs.map((t) => (
              t.href ? (
                <a
                  key={t.key}
                  href={t.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left no-underline text-slate-600 hover:bg-slate-100"
                >
                  <t.icon size={16} />
                  {t.label}
                  <ExternalLink size={12} className="opacity-60 ml-auto" />
                </a>
              ) : (
                <a
                  key={t.key}
                  href={`?tab=${t.key}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
                    e.preventDefault();
                    setTab(t.key); setMenuOpen(false);
                  }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left no-underline ${
                    tab === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <t.icon size={16} />
                  {t.label}
                </a>
              )
            ))}
          </div>
        )}
      </header>

      {/* หน้าตอบแชทบนมือถือ = ไม่มี padding รอบ (เต็มจอ) · หน้าอื่นและเดสก์ท็อปมี padding ปกติ */}
      <main className={`w-full sm:px-6 sm:py-6 ${tab === "inbox" ? "px-0 py-0 md:px-6 md:py-6" : "px-4 py-6"}`}>
        {loading || !perm ? (
          <Spinner />
        ) : (
          <>
            {/* ทุกแท็บ render ค้างไว้เสมอ แค่ซ่อนด้วย CSS (ไม่ conditional-unmount)
                เพราะเดิมใช้ `tab === X && <Component/>` ทำให้ React unmount คอมโพเนนต์ทุกครั้งที่สลับแท็บ
                ทำให้ state ในฟอร์ม (เช่นหน้าตั้งค่าที่พิมพ์ค้างไว้ยังไม่กดบันทึก) หายไปทันที
                analyze_only: render เฉพาะแท็บวิเคราะห์ (เมนูอื่นไม่แสดง/ไม่ mount) */}
            {shouldMount("overview") && (
              <div style={{ display: tab === "overview" ? "block" : "none" }}>
                <OverviewTab
                  adContent={adContent}
                  adCopies={adCopies}
                  adImages={adImages}
                  metricsToday={metricsToday}
                  onNavigate={(targetTab, filter) => { if (filter) setCampaignFilter(filter); setTab(targetTab); }}
                />
              </div>
            )}
            {shouldMount("generate") && (
              <div style={{ display: tab === "generate" ? "block" : "none" }}>
                <GenerateTab settings={settings} onGenerated={loadAll} />
              </div>
            )}
            {shouldMount("review") && (
              <div style={{ display: tab === "review" ? "block" : "none" }}>
                <ReviewTab adCopies={adCopies} adImages={adImages} brandConfig={normalizeBrandConfig(settings.brand_assets)} onChanged={loadAll} />
              </div>
            )}
            {shouldMount("campaigns") && (
              <div style={{ display: tab === "campaigns" ? "block" : "none" }}>
                <CampaignsTab adContent={adContent} metricsByAdId={metricsByAdId} onChanged={loadAll} filter={campaignFilter} onFilterChange={setCampaignFilter} />
              </div>
            )}
            {shouldMount("inbox") && (
              <div style={{ display: tab === "inbox" ? "block" : "none" }}>
                <ChatInboxTab
                  gotoChat={gotoChat}
                  onGotoDone={() => setGotoChat(null)}
                  allowedPages={allowedPages}
                  alertAllowed={perm?.chatAlert !== false}
                  alertMin={perm?.alertMinutes ?? 3}
                  alertPages={perm?.alertPages ?? []}
                  alertSound={perm?.alertSound !== false}
                  alertNew={perm?.alertNew !== false}
                  active={tab === "inbox"}
                />
              </div>
            )}
            {shouldMount("customerdb") && (
              <div style={{ display: tab === "customerdb" ? "block" : "none" }}>
                <CustomerDatabaseTab
                  onOpenChat={(id, at) => {
                    setGotoChat({ id, at });
                    setTab("inbox");
                  }}
                />
              </div>
            )}
            {shouldMount("analyze") && (
              <div style={{ display: tab === "analyze" ? "block" : "none" }}>
                <AnalyzeTab adContent={adContent} metricsHistoryByAd={metricsHistoryByAd} settings={settings} onChanged={loadAll} restricted={restricted} allowedAccounts={perm?.allowed || []} />
              </div>
            )}
            {shouldMount("leaderboard") && (
              <div style={{ display: tab === "leaderboard" ? "block" : "none" }}>
                <LeaderboardTab active={tab === "leaderboard"} />
              </div>
            )}
            {shouldMount("tv_members") && (
              <div style={{ display: tab === "tv_members" ? "block" : "none" }}>
                <TvMembersTab active={tab === "tv_members"} />
              </div>
            )}
            {shouldMount("settings") && (
              <div style={{ display: tab === "settings" ? "block" : "none" }}>
                <SettingsTab settings={settings} onSaved={loadAll} allowedSettings={allowedSettings} allowedPages={allowedPages}
                  onOpenChat={(id, at) => { setGotoChat({ id, at }); setTab("inbox"); }} />
              </div>
            )}
          </>
        )}
      </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Root
// ---------------------------------------------------------------
export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
      if (!data.session) clearLoggedOutPush();
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === "SIGNED_IN") logActivity("login"); // บันทึกการเข้าใช้งาน
      if (event === "SIGNED_OUT") clearLoggedOutPush();
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (loadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Spinner label="กำลังตรวจสอบการล็อกอิน..." />
      </div>
    );
  }

  return (
    <>
      <UpdateBanner />
      {!session && <div className="fixed top-4 right-4 z-[90]"><ThemeToggle /></div>}
      {session ? <Dashboard /> : <LoginScreen />}
    </>
  );
}
