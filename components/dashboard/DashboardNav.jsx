"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ExternalLink, KeyRound, LogOut, Menu, RefreshCw, Search, X } from "lucide-react";
import ThemeToggle from "@/components/shared/ThemeToggle";
import { supabase } from "@/lib/supabase/client";
import { logActivity } from "@/lib/utils/activity";
import { clearCustomerDatabaseCaches } from "@/lib/customerdb-cache";
import { useDashboard, ROUTE_PATH } from "@/components/dashboard/DashboardContext";
import BrandMark from "@/components/shared/BrandMark";
import ChangePasswordDialog from "@/components/shared/ChangePasswordDialog";

const GROUPS = [
  { label: "ภาพรวม", keys: ["overview"] },
  { label: "โฆษณา", keys: ["generate", "review", "campaigns", "analyze", "ad_library"] },
  { label: "ลูกค้า", keys: ["inbox", "ad_chats", "customerdb", "customer_list"] },
  { label: "ระบบ", keys: ["leaderboard", "settings"] },
];
const MOBILE_KEYS = ["overview", "campaigns", "inbox", "customerdb"];

export default function DashboardNav({ children }) {
  const { perm, visibleTabs = [], loadAll, tab } = useDashboard();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const menuRef = useRef(null);
  const isInboxRoute = pathname.startsWith(ROUTE_PATH.inbox);
  const currentTab = visibleTabs.find((item) => item.key === tab);
  const groups = GROUPS.map((group) => ({ ...group, tabs: visibleTabs.filter((item) => group.keys.includes(item.key) && item.label.toLowerCase().includes(query.trim().toLowerCase())) })).filter((group) => group.tabs.length);

  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const opener = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => menuRef.current?.querySelector("input")?.focus());
    const onKeyDown = (event) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKeyDown); opener?.focus?.(); };
  }, [menuOpen]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try { await loadAll(); } finally { setRefreshing(false); }
  }

  async function handleLogout() {
    await logActivity("logout");
    clearCustomerDatabaseCaches();
    try {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      const subscription = await registration?.pushManager?.getSubscription?.();
      if (subscription?.endpoint) {
        await supabase.functions.invoke("send-push", { body: { action: "unsubscribe", endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      (await registration?.getNotifications?.() || []).forEach((notification) => notification.close());
      if ("clearAppBadge" in navigator) await navigator.clearAppBadge();
    } catch { /* Log out even if browser notification cleanup is unavailable. */ }
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function navLink(item, compact = false) {
    const content = <><item.icon size={compact ? 19 : 16} /><span>{item.label}</span>{item.href && <ExternalLink size={12} />}</>;
    const props = { className: `nova-nav-link ${compact ? "is-compact" : ""} ${tab === item.key ? "is-active" : ""}`, title: item.label, "aria-label": item.label, "aria-current": tab === item.key ? "page" : undefined };
    return item.href
      ? <a key={item.key} {...props} href={item.href} target="_blank" rel="noopener noreferrer">{content}</a>
      : <Link key={item.key} {...props} href={ROUTE_PATH[item.key]} onClick={() => setMenuOpen(false)}>{content}</Link>;
  }

  return (
    <div className={`nova-shell ${isInboxRoute ? "nova-inbox" : ""}`}>
      <a href="#workspace-main" className="nova-skip">ข้ามไปเนื้อหา</a>
      <header className="nova-topbar app-header">
        <Link href={ROUTE_PATH.overview} className="nova-brand"><BrandMark className="h-8 w-8" /><span>Besight</span></Link>
        <div className="nova-page-label"><span>WORKSPACE</span><strong>{currentTab?.label || "ภาพรวม"}</strong></div>
        <div className="nova-actions">
          <button className="nova-icon-button" title="ค้นหาหน้าและเมนู" aria-label="ค้นหาหน้าและเมนู" onClick={() => { setQuery(""); setMenuOpen(true); }}><Search size={18} /></button>
          <button className="nova-icon-button" title="รีเฟรชข้อมูล" aria-label="รีเฟรชข้อมูล" disabled={refreshing} onClick={refresh}><RefreshCw size={18} className={refreshing ? "animate-spin" : ""} /></button>
          <ThemeToggle icon />
          <button className="nova-user" title={perm?.email || "บัญชีผู้ใช้"} aria-label="เมนูบัญชีผู้ใช้" onClick={() => { setQuery(""); setMenuOpen(true); }}>{perm?.email?.slice(0, 1).toUpperCase() || "B"}</button>
        </div>
      </header>
      <nav className="nova-workspace-nav" aria-label="เมนูหลัก">
        {GROUPS.map((group) => {
          const items = visibleTabs.filter((item) => group.keys.includes(item.key));
          if (!items.length) return null;
          return <div className="nova-nav-group" key={group.label}><span>{group.label}</span><div>{items.map((item) => navLink(item))}</div></div>;
        })}
      </nav>
      <main id="workspace-main" tabIndex={-1} data-page={tab} className={isInboxRoute ? "nova-main nova-chat-main" : "nova-main"}>
        {!isInboxRoute && <div className="nova-page-meta"><span>{currentTab?.label || "ภาพรวม"}</span><span>{String(Math.max(0, visibleTabs.findIndex((item) => item.key === tab)) + 1).padStart(2, "0")} / {String(visibleTabs.length).padStart(2, "0")}</span></div>}
        {children}
      </main>
      <nav className="nova-mobile-dock" aria-label="เมนูบนมือถือ">{MOBILE_KEYS.map((key) => visibleTabs.find((item) => item.key === key)).filter(Boolean).map((item) => navLink(item, true))}<button className="nova-nav-link is-compact" onClick={() => { setQuery(""); setMenuOpen(true); }} aria-label="เมนูทั้งหมด"><Menu size={20} /><span>เพิ่มเติม</span></button></nav>
      {menuOpen && <div className="nova-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
        <section ref={menuRef} className="nova-palette" role="dialog" aria-modal="true" aria-label="เมนูและคำสั่ง">
          <div className="nova-palette-search"><Search size={20} /><input aria-label="ค้นหาเมนู" placeholder="ไปที่หน้า..." value={query} onChange={(event) => setQuery(event.target.value)} /><button className="nova-icon-button" aria-label="ปิดเมนู" onClick={() => setMenuOpen(false)}><X size={19} /></button></div>
          <div className="nova-palette-results">{groups.map((group) => <div key={group.label}><span>{group.label}</span>{group.tabs.map((item) => navLink(item))}</div>)}{groups.length === 0 && <p>ไม่พบเมนู</p>}</div>
          <footer className="nova-palette-footer"><span>{perm?.email}</span><button onClick={() => { setMenuOpen(false); setPwOpen(true); }}><KeyRound size={16} /> เปลี่ยนรหัสผ่าน</button><button onClick={handleLogout}><LogOut size={16} /> ออกจากระบบ</button></footer>
        </section>
      </div>}
      <ChangePasswordDialog open={pwOpen} email={perm?.email} onClose={() => setPwOpen(false)} />
    </div>
  );
}
