"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  Inbox,
  UsersRound,
  ClipboardList,
  Trophy,
  Tv,
  Settings as SettingsIcon,
  LibraryBig,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { lsSet } from "@/lib/utils/storage";
import { logActivity } from "@/lib/utils/activity";

// TABS: key ต้องตรงกับค่าที่เก็บใน user_permissions.allowed_tabs (ฐานข้อมูลเดิม) —
// เปลี่ยนแค่ path (URL) เป็น kebab-case ให้เข้ากับ Next.js route ได้ ผ่าน ROUTE_PATH ด้านล่าง
export const TABS = [
  { key: "overview", label: "ภาพรวม", icon: LayoutDashboard },
  { key: "generate", label: "สร้างคอนเทนต์", icon: Sparkles },
  { key: "review", label: "รออนุมัติ", icon: CheckCircle2 },
  { key: "campaigns", label: "แคมเปญ", icon: TrendingUp },
  { key: "analyze", label: "วิเคราะห์", icon: BarChart3 },
  { key: "ad_library", label: "คลังโฆษณาคู่แข่ง", icon: LibraryBig },
  { key: "inbox", label: "ตอบแชท", icon: Inbox },
  { key: "customerdb", label: "จัดการลูกค้า", icon: UsersRound },
  // หน้าดูอย่างเดียว — คอลัมน์ตรงกับชีตสรุปรายชื่อลูกค้าที่ทีมใช้อยู่
  // แยกจาก "จัดการลูกค้า" เพราะหน้านั้นไว้แก้ไข/นำเข้า/เช็คไอดี ส่วนหน้านี้ไว้เปิดดูและส่งต่อ
  { key: "customer_list", label: "รายชื่อลูกค้า", icon: ClipboardList },
  { key: "leaderboard", label: "กระดานแต้ม", icon: Trophy },
  // tv_members ไม่อยู่ในเมนูแล้ว — เนื้อหาเดียวกันเป๊ะกับแท็บ TradingView ในหน้า "ลูกค้า + TradingView"
  // แต่ "คีย์สิทธิ์" tv_members ยังต้องคงไว้ เพราะ edge function tradingview และ RLS ของ tv_external_snapshot
  // เช็คสิทธิ์ด้วยคีย์นี้ (ดู supabase/functions/tradingview/index.ts) — ลบคีย์เมื่อไหร่พนักงานที่ไม่ใช่แอดมินใช้ TV ไม่ได้ทันที
  { key: "settings", label: "ตั้งค่า", icon: SettingsIcon },
];

export const ROUTE_PATH = {
  overview: "/overview",
  generate: "/generate",
  review: "/review",
  campaigns: "/campaigns",
  analyze: "/analyze",
  ad_library: "/ad-library",
  inbox: "/inbox",
  customerdb: "/customerdb",
  customer_list: "/customer-list",
  leaderboard: "/leaderboard",
  tv_members: "/tv-members",
  settings: "/settings",
};

function keyFromPathname(pathname) {
  const first = "/" + (pathname.split("/").filter(Boolean)[0] || "");
  const found = Object.entries(ROUTE_PATH).find(([, path]) => first === path || first.startsWith(path + "/"));
  return found?.[0] || null;
}

const DashboardCtx = createContext(null);

// สำเนาสิทธิ์ในเครื่อง ใช้วาดเมนูทันทีระหว่างรอของจริง (ของจริงบังคับด้วย RLS ฝั่งฐานข้อมูล)
const PERM_CACHE_KEY = "ui.perm";
const PERM_CACHE_MS = 12 * 60 * 60 * 1000;

export function DashboardProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const tab = keyFromPathname(pathname);

  // สิทธิ์ผู้ใช้: null = กำลังโหลด, {role, allowed}
  // เริ่มจากสำเนาที่เก็บไว้ครั้งก่อน เพื่อให้หน้าเว็บวาดได้ทันทีไม่ต้องรอ network
  // (ไม่ใช่การตรวจสิทธิ์จริง — ตัวจริงคือ RLS ฝั่งฐานข้อมูล อันนี้แค่ทำให้เมนูขึ้นเร็ว)
  const [perm, setPerm] = useState(null);
  // อ่านสำเนาหลัง mount เท่านั้น — ถ้าอ่านใน useState initializer ฝั่งเซิร์ฟเวอร์จะได้ null
  // แต่ฝั่งเบราว์เซอร์ได้ค่าจริง ทำให้ HTML ไม่ตรงกันและเกิด hydration error
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PERM_CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (c?.perm && Date.now() - c._at < PERM_CACHE_MS) setPerm((cur) => cur ?? c.perm);
    } catch {}
  }, []);
  useEffect(() => {
    (async () => {
      // getSession() อ่าน JWT จากเครื่อง (ไม่ยิง network) — ต่างจาก getUser() ที่ต้องรอ
      // เซิร์ฟเวอร์ตอบก่อน ทำให้ทุกหน้ามี round trip ส่วนเกิน 1 ชั้นก่อนวาดอะไรเลย
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user?.email) {
        try { localStorage.removeItem(PERM_CACHE_KEY); } catch {}
        setPerm({ role: "denied", error: "ตรวจสอบผู้ใช้ไม่สำเร็จ" });
        return;
      }
      const { data, error } = await supabase
        .from("user_permissions")
        .select("role, allowed_ad_accounts, allowed_tabs, allowed_pages, allowed_settings, chat_alert, alert_minutes, alert_pages, alert_sound, alert_new")
        .eq("email", user.email.toLowerCase())
        .maybeSingle();
      if (error || !data || !["admin", "analyze_only"].includes(data.role)) {
        try { localStorage.removeItem(PERM_CACHE_KEY); } catch {}
        setPerm({ role: "denied", email: user.email, error: error?.message || "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน" });
        return;
      }
      const role = data.role;
      const allowed = Array.isArray(data?.allowed_ad_accounts) ? data.allowed_ad_accounts.map((v) => String(v).replace(/^act_/, "")) : [];
      const allowedTabs = Array.isArray(data?.allowed_tabs) ? data.allowed_tabs.map(String) : [];
      const allowedPages = Array.isArray(data?.allowed_pages) ? data.allowed_pages.map(String) : [];
      const allowedSettings = Array.isArray(data?.allowed_settings) ? data.allowed_settings.map(String) : [];
      const next = {
        role, allowed, allowedTabs, allowedPages, allowedSettings, email: user.email,
        chatAlert: data?.chat_alert !== false,
        alertMinutes: Number(data?.alert_minutes) > 0 ? Number(data.alert_minutes) : 3,
        alertPages: Array.isArray(data?.alert_pages) ? data.alert_pages.map(String) : [],
        alertSound: data?.alert_sound !== false,
        alertNew: data?.alert_new !== false,
      };
      setPerm(next);
      try { localStorage.setItem(PERM_CACHE_KEY, JSON.stringify({ _at: Date.now(), perm: next })); } catch {}
    })();
  }, []);
  const restricted = perm?.role === "analyze_only";

  // การมองเห็นเมนู "ออฟฟิศจำลอง" (Game) และ "กระดานแต้ม" (Leaderboard)
  // ดึงสองคีย์ในคำขอเดียว — เดิมแยกเป็นสอง maybeSingle() ทำให้ทุกหน้ามี network ส่วนเกิน 1 ครั้ง
  const [officeCfg, setOfficeCfg] = useState(null);
  const [lbCfg, setLbCfg] = useState(null);
  useEffect(() => {
    supabase.from("settings").select("key, value").in("key", ["game_office", "leaderboard"]).then(({ data }) => {
      const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
      setOfficeCfg(by.game_office || { enabled: true, emails: [] });
      setLbCfg(by.leaderboard || { enabled: true, emails: [] });
    });
  }, []);
  const officeVisible = (() => {
    if (!officeCfg) return false;
    if (officeCfg.enabled === false) return false;
    const emails = Array.isArray(officeCfg.emails) ? officeCfg.emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean) : [];
    if (emails.length) return emails.includes(String(perm?.email || "").toLowerCase());
    return true;
  })();

  // กระดานแต้ม (Leaderboard) — คุมจาก settings.leaderboard { enabled, emails[] } ดึงมาพร้อมกันด้านบน
  const leaderboardVisible = (() => {
    if (!lbCfg) return false;
    if (lbCfg.enabled === false) return false;
    const emails = Array.isArray(lbCfg.emails) ? lbCfg.emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean) : [];
    if (emails.length) return emails.includes(String(perm?.email || "").toLowerCase());
    return true;
  })();

  const allowedTabKeys = perm?.allowedTabs || [];
  const visibleTabs = (!perm ? [] : restricted ? TABS.filter((t) => allowedTabKeys.includes(t.key) || (t.key === "ad_library" && allowedTabKeys.includes("analyze")) || (t.key === "leaderboard" && leaderboardVisible) || (t.key === "customer_list" && allowedTabKeys.includes("customerdb"))) : TABS)
    .filter((t) => t.key !== "office" || officeVisible)
    .filter((t) => t.key !== "leaderboard" || leaderboardVisible);
  const allowedPages = restricted ? (perm?.allowedPages || []) : null;
  const allowedSettings = restricted ? (perm?.allowedSettings || []) : null;
  const can = useCallback((k) => visibleTabs.some((t) => t.key === k), [visibleTabs]);

  // ถ้าเส้นทางปัจจุบันไม่มีสิทธิ์เข้า → เด้งไปแท็บแรกที่เข้าได้
  // ต้องรอ officeCfg/lbCfg โหลดเสร็จก่อนตัดสิน — สองเมนูนี้ถูกซ่อนไว้ระหว่างที่ค่ายังเป็น null
  // ตั้งแต่แคชสิทธิ์ไว้ในเครื่อง perm มาถึงทันทีตั้งแต่เฟรมแรก ถ้าไม่รอค่าพวกนี้
  // คนที่เปิด /leaderboard ตรงๆ จะโดนเด้งออกไปหน้าแรกก่อนที่ค่าจะโหลดเสร็จ
  const visibilityReady = officeCfg !== null && lbCfg !== null;
  useEffect(() => {
    if (!visibilityReady) return;
    if (perm && perm.role !== "denied" && visibleTabs.length && tab && !visibleTabs.some((t) => t.key === tab)) {
      router.replace(ROUTE_PATH[visibleTabs[0].key]);
    }
  }, [perm, tab, visibleTabs, router, visibilityReady]);

  useEffect(() => {
    if (tab) {
      lsSet("ui.tab", tab);
      logActivity("view_tab", { tab });
    }
  }, [tab]);

  const [campaignFilter, setCampaignFilter] = useState("all");
  const [gotoChat, setGotoChat] = useState(null);
  const goToChat = useCallback((payload) => {
    setGotoChat(payload);
    router.push(ROUTE_PATH.inbox);
  }, [router]);

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
    const [{ data: ads }, { data: copies }, { data: images }, { data: settingsRows }, { data: metrics }, { data: history }] = await Promise.all([
      needsAds ? supabase.from("ad_content").select("*").order("created_at", { ascending: false }) : skip,
      needsCopies ? supabase.from("ad_copies").select("*").order("created_at", { ascending: false }) : skip,
      needsImages ? supabase.from("ad_images").select("*").order("created_at", { ascending: false }) : skip,
      needsSettings ? supabase.from("settings").select("key, value") : skip,
      needsTodayMetrics ? supabase.from("metrics_log").select("*").gte("checked_at", startOfToday).order("checked_at", { ascending: false }) : skip,
      needsHistory ? supabase.from("metrics_log").select("*").gte("checked_at", since14d).order("checked_at", { ascending: false }).limit(2000) : skip,
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
    // ไม่รอ perm ก่อนดึงข้อมูล — ยิงขนานไปกับการเช็คสิทธิ์ได้เลย เพราะ RLS คุมอยู่แล้ว
    // เดิมรอ perm ทำให้เป็น network เรียงกัน 3 ชั้น (session → สิทธิ์ → ข้อมูล) ก่อนวาดหน้า
    if (perm?.role === "denied") return;
    loadAll();
    if (!["overview", "review", "campaigns", "analyze"].includes(tab)) return;
    // realtime: รีเฟรชอัตโนมัติเมื่อมีการเปลี่ยนแปลงในตาราง ad_content/ad_copies/ad_images
    const channel = supabase
      .channel("ad_data_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_content" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_copies" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_images" }, () => loadAll())
      .subscribe();
    // realtime ด้านบนรีเฟรชให้แล้วเมื่อข้อมูลเปลี่ยน ตัวจับเวลานี้เป็นแค่ตัวสำรอง
    // จึงยืดเป็น 3 นาที และไม่ดึงตอนที่ผู้ใช้ไม่ได้เปิดดูแท็บนี้ (เดิมดึงทุก 60 วิ ตลอดเวลา)
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") loadAll();
    }, 3 * 60 * 1000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [loadAll, perm?.role, tab]);

  // heartbeat ทุก 5 นาที (เฉพาะตอนเปิดดูอยู่)
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") logActivity("heartbeat");
    };
    beat();
    const iv = setInterval(beat, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  const value = useMemo(
    () => ({
      perm, restricted, visibleTabs, allowedPages, allowedSettings, can, tab,
      campaignFilter, setCampaignFilter,
      gotoChat, setGotoChat, goToChat,
      adContent, adCopies, adImages, settings, metricsToday, metricsByAdId, metricsHistoryByAd, loading, loadAll,
    }),
    [perm, restricted, visibleTabs, allowedPages, allowedSettings, can, tab, campaignFilter, gotoChat, goToChat, adContent, adCopies, adImages, settings, metricsToday, metricsByAdId, metricsHistoryByAd, loading, loadAll]
  );

  return <DashboardCtx.Provider value={value}>{children}</DashboardCtx.Provider>;
}

export function useDashboard() {
  const ctx = useContext(DashboardCtx);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
