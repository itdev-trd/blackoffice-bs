"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ExternalLink, LogOut, Menu, RefreshCw, Sparkles, X } from "lucide-react";
import ThemeToggle from "@/components/shared/ThemeToggle";
import { supabase } from "@/lib/supabase/client";
import { logActivity } from "@/lib/utils/activity";
import { clearCustomerDatabaseCaches } from "@/lib/customerdb-cache";
import { useDashboard, ROUTE_PATH } from "@/components/dashboard/DashboardContext";

export default function DashboardNav({ children }) {
  const { perm, visibleTabs, loadAll, tab } = useDashboard();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

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
    <div className="min-h-screen bg-slate-50 md:flex">
      {/* Sidebar ซ้าย — เดสก์ท็อป/แท็บเล็ต */}
      <aside className="hidden md:flex md:flex-col md:w-60 md:shrink-0 md:h-screen md:sticky md:top-0 bg-white border-r border-slate-200 z-30">
        <Link href={ROUTE_PATH.overview} className="flex items-center gap-2 font-semibold text-slate-800 hover:opacity-80 px-4 py-4 border-b border-slate-200 min-w-0 text-left" title="กลับหน้าแรก">
          <Sparkles size={20} className="shrink-0" />
          <span className="truncate">AI Ads Automation</span>
        </Link>
        <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {perm && visibleTabs.map((t) =>
            t.href ? (
              <a key={t.key} href={t.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium no-underline border-l-2 border-transparent text-slate-500 hover:text-slate-700 hover:bg-black/5">
                <t.icon size={17} className="shrink-0" /> <span className="truncate">{t.label}</span> <ExternalLink size={12} className="opacity-60 ml-auto shrink-0" />
              </a>
            ) : (
              <Link key={t.key} href={ROUTE_PATH[t.key]}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium no-underline border-l-2 ${tab === t.key ? "border-amber-500 bg-amber-500/10 text-white" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-black/5"}`}>
                <t.icon size={17} className="shrink-0" /> <span className="truncate">{t.label}</span>
              </Link>
            )
          )}
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
              <button onClick={() => setMenuOpen((o) => !o)} className="md:hidden text-slate-600 hover:text-slate-900 p-1 -ml-1" aria-label="เมนู" aria-expanded={menuOpen}>
                {menuOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
              <Link href={ROUTE_PATH.overview} onClick={() => setMenuOpen(false)} className="flex items-center gap-2 font-semibold text-slate-800 hover:opacity-80 min-w-0" title="กลับหน้าแรก">
                <Sparkles size={20} className="shrink-0" />
                <span className="truncate">AI Ads Automation</span>
              </Link>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <ThemeToggle />
              <button onClick={loadAll} className="text-slate-400 hover:text-slate-700" title="รีเฟรช"><RefreshCw size={18} /></button>
              <button onClick={handleLogout} className="text-slate-400 hover:text-slate-700 flex items-center gap-1 text-sm" title="ออกจากระบบ">
                <LogOut size={16} />
                <span className="hidden sm:inline">ออกจากระบบ</span>
              </button>
            </div>
          </div>

          {menuOpen && (
            <div className="md:hidden border-t border-slate-200 px-2 py-2 flex flex-col gap-0.5">
              {perm && visibleTabs.map((t) =>
                t.href ? (
                  <a key={t.key} href={t.href} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left no-underline text-slate-600 hover:bg-slate-100">
                    <t.icon size={16} />
                    {t.label}
                    <ExternalLink size={12} className="opacity-60 ml-auto" />
                  </a>
                ) : (
                  <Link key={t.key} href={ROUTE_PATH[t.key]} onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left no-underline ${tab === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                    <t.icon size={16} />
                    {t.label}
                  </Link>
                )
              )}
            </div>
          )}
        </header>

        {/* หน้าตอบแชทบนมือถือ = ไม่มี padding รอบ (เต็มจอ) · หน้าอื่นและเดสก์ท็อปมี padding ปกติ */}
        <main className={`w-full sm:px-6 sm:py-6 ${pathname.startsWith(ROUTE_PATH.inbox) ? "px-0 py-0 md:px-6 md:py-6" : "px-4 py-6"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
