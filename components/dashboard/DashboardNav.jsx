"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ExternalLink, LogOut, Menu, RefreshCw, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { logActivity } from "@/lib/utils/activity";
import { clearCustomerDatabaseCaches } from "@/lib/customerdb-cache";
import { useDashboard, ROUTE_PATH } from "@/components/dashboard/DashboardContext";

// แถบเมนูล่างมือถือ — เข้าถึง 5 หน้าที่ใช้บ่อยที่สุดได้ในแตะเดียว แบบแอปมือถือทั่วไป
// (label ย่อกว่าเมนูเต็มด้านข้าง เพราะพื้นที่จำกัด)
const MOBILE_PRIMARY_TABS = [
  { key: "overview", navLabel: "ภาพรวม" },
  { key: "inbox", navLabel: "แชท" },
  { key: "customerdb", navLabel: "ลูกค้า" },
  { key: "review", navLabel: "อนุมัติ" },
  { key: "campaigns", navLabel: "แคมเปญ" },
];

export default function DashboardNav({ children }) {
  const { perm, visibleTabs, loadAll, tab } = useDashboard();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const isInboxRoute = pathname.startsWith(ROUTE_PATH.inbox);
  const tabByKey = Object.fromEntries((visibleTabs || []).map((t) => [t.key, t]));
  const mobileNavItems = MOBILE_PRIMARY_TABS
    .map((m) => (tabByKey[m.key] ? { ...tabByKey[m.key], navLabel: m.navLabel } : null))
    .filter(Boolean);

  // สไตล์แท็บที่กำลังเลือก — ใช้จุดเดียวกันทั้ง sidebar เดสก์ท็อปและเมนูมือถือ ไม่ให้สีเพี้ยนจากกันในธีม light
  const navLinkClass = (key, { compact = false } = {}) => {
    const base = compact
      ? "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left no-underline"
      : "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium no-underline border-l-2";
    const active = compact ? "bg-night-accent/15 text-night-accent-light" : "border-night-accent bg-night-accent/15 text-night-accent-light";
    const inactive = compact
      ? "text-night-ink-2 hover:bg-night-surface2"
      : "border-transparent text-night-ink-2 hover:text-night-ink hover:bg-night-surface2";
    return `${base} ${tab === key ? active : inactive}`;
  };

  async function handleLogout() {
    await logActivity("logout");
    // cache รายงานมีข้อมูลลูกค้า: เก็บเฉพาะระหว่าง session และต้องล้างก่อนออกจากระบบ
    clearCustomerDatabaseCaches();
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
    } catch {
      /* logout ต้องทำต่อแม้ browser ถอน push ไม่สำเร็จ */
    }
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar ซ้าย — เดสก์ท็อป/แท็บเล็ต */}
      <aside className="hidden md:flex md:w-[88px] md:flex-col md:shrink-0 md:h-screen md:sticky md:top-0 bg-night-surface border-r border-night-border z-30 py-3 gap-1 items-center">
        <Link
          href={ROUTE_PATH.overview}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-night-accent text-white mb-3"
          title="AdFlow OS — กลับหน้าแรก"
        >
          <Sparkles size={17} />
        </Link>
        <nav className="flex-1 overflow-y-auto flex flex-col gap-1 w-full items-center px-2">
          {perm && visibleTabs.map((t) =>
            t.href ? (
              <a key={t.key} href={t.href} target="_blank" rel="noopener noreferrer"
                title={t.label}
                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-night-ink-2 hover:text-night-ink hover:bg-night-surface2">
                <t.icon size={18} />
              </a>
            ) : (
              <Link key={t.key} href={ROUTE_PATH[t.key]} title={t.label}
                className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-control ${
                  tab === t.key ? "bg-night-accent/15 text-night-accent-light" : "text-night-ink-2 hover:text-night-ink hover:bg-night-surface2"
                }`}>
                {tab === t.key && <span className="absolute left-[-8px] top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-night-accent" />}
                <t.icon size={18} />
              </Link>
            )
          )}
        </nav>
        {/* ท้าย sidebar: รีเฟรช/ออกจากระบบ/อีเมลผู้ใช้ — ไอคอนล้วน มี tooltip (title) บอกรายละเอียดตอน hover
            สำคัญเพราะพนักงานหลายคนใช้เครื่องร่วมกัน ต้องรู้ว่ากำลังใช้งานด้วยบัญชีไหน */}
        <div className="shrink-0 flex flex-col items-center gap-1 pt-2 mt-1 border-t border-night-border w-full px-2">
          <button onClick={loadAll} className="flex h-9 w-9 items-center justify-center rounded-control text-night-ink-3 hover:bg-night-surface2 hover:text-night-ink" title="รีเฟรชข้อมูล">
            <RefreshCw size={16} />
          </button>
          <button onClick={handleLogout} className="flex h-9 w-9 items-center justify-center rounded-control text-night-ink-3 hover:bg-night-surface2 hover:text-night-ink" title="ออกจากระบบ">
            <LogOut size={16} />
          </button>
          {perm?.email && (
            <span
              className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-night-accent/15 text-2xs font-bold uppercase text-night-accent-light"
              title={perm.email}
            >
              {String(perm.email).slice(0, 1)}
            </span>
          )}
        </div>
      </aside>

      {/* คอลัมน์ขวา: header มือถือ + เนื้อหา */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        <header className="md:hidden app-header bg-night-surface border-b border-night-border sticky top-0 z-30">
          <div className="w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
            <Link href={ROUTE_PATH.overview} className="flex items-center gap-2 font-semibold text-night-ink hover:opacity-80 min-w-0" title="กลับหน้าแรก">
              <Sparkles size={20} className="shrink-0" />
              <span className="truncate">AdFlow OS</span>
            </Link>
            {/* เว้นระยะห่างรีเฟรช/ออกจากระบบให้มากพอ กันกดผิด (เดิมชิดกันเกินไป) */}
            <div className="flex items-center gap-6 shrink-0">
              <button onClick={loadAll} className="text-night-ink-3 hover:text-night-ink p-1" title="รีเฟรช"><RefreshCw size={18} /></button>
              <button onClick={handleLogout} className="text-night-ink-3 hover:text-night-ink flex items-center gap-1 text-sm p-1" title="ออกจากระบบ">
                <LogOut size={16} />
                <span className="hidden sm:inline">ออกจากระบบ</span>
              </button>
            </div>
          </div>
        </header>

        {/* หน้าตอบแชทบนมือถือ = ไม่มี padding รอบ (เต็มจอ) · หน้าอื่นและเดสก์ท็อปมี padding ปกติ
            เผื่อพื้นที่ด้านล่างให้แถบเมนูมือถือ (pb-24) ยกเว้นหน้าแชทที่ไม่โชว์แถบนี้อยู่แล้ว */}
        <main className={`w-full ${isInboxRoute ? "px-0 py-0 md:px-0 md:py-0" : "dashboard-page-main flex justify-center items-start px-4 py-6 pb-24 sm:px-6 sm:py-6 md:pb-8 lg:px-10"}`}>
          {children}
        </main>
      </div>

      {/* แถบเมนูล่างมือถือ — โชว์ทุกหน้ารวมหน้าแชท ปุ่ม "เพิ่มเติม" อยู่ขวาสุด แทนที่ปุ่มสามขีดเดิมที่เคยอยู่บนซ้ายของ header
          ตอนเปิดคุยกับลูกค้าเต็มจอ (หน้าแชท) ตัวหน้าต่างแชทจะซ้อนทับแถบนี้เอง (z-index สูงกว่า) ไม่ต้องซ่อนด้วยโค้ดตรงนี้ */}
      {perm && mobileNavItems.length > 0 && (
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-night-surface border-t border-night-border flex items-stretch"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {mobileNavItems.map((t) => {
            const active = tab === t.key;
            return (
              <Link
                key={t.key}
                href={ROUTE_PATH[t.key]}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium no-underline ${active ? "text-brand-600" : "text-night-ink-3"}`}
              >
                <t.icon size={20} />
                {t.navLabel}
              </Link>
            );
          })}
          <button
            onClick={() => setMenuOpen(true)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${menuOpen ? "text-brand-600" : "text-night-ink-3"}`}
            aria-label="เพิ่มเติม"
          >
            <Menu size={20} />
            เพิ่มเติม
          </button>
        </nav>
      )}

      {/* แผงเมนูเพิ่มเติม — เลื่อนขึ้นจากล่าง แสดงแท็บที่เหลือ + อีเมล/รีเฟรช/ออกจากระบบ */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 flex items-end"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setMenuOpen(false); }}
        >
          <div className="w-full bg-night-surface rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="sticky top-0 bg-night-surface flex items-center justify-between px-4 py-3 border-b border-night-border">
              <span className="font-semibold text-night-ink">เพิ่มเติม</span>
              <button onClick={() => setMenuOpen(false)} className="text-night-ink-3 hover:text-night-ink p-1" aria-label="ปิด"><X size={20} /></button>
            </div>
            <div className="p-2 flex flex-col gap-0.5">
              {perm && visibleTabs.map((t) =>
                t.href ? (
                  <a key={t.key} href={t.href} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left no-underline text-night-ink-2 hover:bg-night-surface2">
                    <t.icon size={16} />
                    {t.label}
                    <ExternalLink size={12} className="opacity-60 ml-auto" />
                  </a>
                ) : (
                  <Link key={t.key} href={ROUTE_PATH[t.key]} onClick={() => setMenuOpen(false)}
                    className={navLinkClass(t.key, { compact: true })}>
                    <t.icon size={16} />
                    {t.label}
                  </Link>
                )
              )}
            </div>
            {perm?.email && (
              <div className="border-t border-night-border p-3 flex items-center gap-2 min-w-0" title={perm.email}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-night-accent/15 text-2xs font-bold uppercase text-night-accent-light">
                  {String(perm.email).slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1 truncate text-2xs text-night-ink-2">{perm.email}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
