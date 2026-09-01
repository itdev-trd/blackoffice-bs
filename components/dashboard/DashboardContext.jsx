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
  Trophy,
  Tv,
  Settings as SettingsIcon,
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
  { key: "inbox", label: "ตอบแชท", icon: Inbox },
  { key: "customerdb", label: "จัดการลูกค้า", icon: UsersRound },
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
  inbox: "/inbox",
  customerdb: "/customerdb",
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

export function DashboardProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const tab = keyFromPathname(pathname);

  // สิทธิ์ผู้ใช้: null = กำลังโหลด, {role, allowed}
  const [perm, setPerm] = useState(null);
  useEffect(() => {
    (async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        setPerm({ role: "denied", error: "ตรวจสอบผู้ใช้ไม่สำเร็จ" });
        return;
      }
      const { data, error } = await supabase
        .from("user_permissions")
        .select("role, allowed_ad_accounts, allowed_tabs, allowed_pages, allowed_settings, chat_alert, alert_minutes, alert_pages, alert_sound, alert_new")
        .eq("email", user.email.toLowerCase())
        .maybeSingle();
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
        alertMinutes: Number(data?.alert_minutes) > 0 ? Number(data.alert_minutes) : 3,
        alertPages: Array.isArray(data?.alert_pages) ? data.alert_pages.map(String) : [],
        alertSound: data?.alert_sound !== false,
        alertNew: data?.alert_new !== false,
      });
    })();
  }, []);
  const restricted = perm?.role === "analyze_only";

  // การมองเห็นเมนู "ออฟฟิศจำลอง" (Game) — คุมจากหน้าตั้งค่า (settings.game_office)
  const [officeCfg, setOfficeCfg] = useState(null);
  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "game_office").maybeSingle().then(({ data }) => setOfficeCfg(data?.value || { enabled: true, emails: [] }));
  }, []);
  const officeVisible = (() => {
    if (!officeCfg) return false;
    if (officeCfg.enabled === false) return false;
    const emails = Array.isArray(officeCfg.emails) ? officeCfg.emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean) : [];
    if (emails.length) return emails.includes(String(perm?.email || "").toLowerCase());
    return true;
  })();

  // การมองเห็นเมนู "กระดานแต้ม" (Leaderboard) — คุมจาก settings.leaderboard { enabled, emails[] }
  const [lbCfg, setLbCfg] = useState(null);
  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "leaderboard").maybeSingle().then(({ data }) => setLbCfg(data?.value || { enabled: true, emails: [] }));
  }, []);
  const leaderboardVisible = (() => {
    if (!lbCfg) return false;
    if (lbCfg.enabled === false) return false;
    const emails = Array.isArray(lbCfg.emails) ? lbCfg.emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean) : [];
    if (emails.length) return emails.includes(String(perm?.email || "").toLowerCase());
    return true;
  })();

  const allowedTabKeys = perm?.allowedTabs || [];
  const visibleTabs = (!perm ? [] : restricted ? TABS.filter((t) => allowedTabKeys.includes(t.key) || (t.key === "leaderboard" && leaderboardVisible)) : TABS)
    .filter((t) => t.key !== "office" || officeVisible)
    .filter((t) => t.key !== "leaderboard" || leaderboardVisible);
  const allowedPages = restricted ? (perm?.allowedPages || []) : null;
  const allowedSettings = restricted ? (perm?.allowedSettings || []) : null;
  const can = useCallback((k) => visibleTabs.some((t) => t.key === k), [visibleTabs]);

  // ถ้าเส้นทางปัจจุบันไม่มีสิทธิ์เข้า → เด้งไปแท็บแรกที่เข้าได้
  useEffect(() => {
    if (perm && perm.role !== "denied" && visibleTabs.length && tab && !visibleTabs.some((t) => t.key === tab)) {
      router.replace(ROUTE_PATH[visibleTabs[0].key]);
    }
  }, [perm, tab, visibleTabs, router]);

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
    if (!perm || perm.role === "denied") return;
    loadAll();
    if (!["overview", "review", "campaigns", "analyze"].includes(tab)) return;
    // realtime: รีเฟรชอัตโนมัติเมื่อมีการเปลี่ยนแปลงในตาราง ad_content/ad_copies/ad_images
    const channel = supabase
      .channel("ad_data_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_content" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_copies" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_images" }, () => loadAll())
      .subscribe();
    const interval = setInterval(loadAll, 60000);
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
