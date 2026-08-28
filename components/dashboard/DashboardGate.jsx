"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import Spinner from "@/components/shared/Spinner";
import ThemeToggle from "@/components/shared/ThemeToggle";
import DashboardNav from "@/components/dashboard/DashboardNav";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import { supabase } from "@/lib/supabase/client";

export default function DashboardGate({ children }) {
  const { perm, loading } = useDashboard();
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
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

  return <DashboardNav>{loading || !perm ? <Spinner /> : children}</DashboardNav>;
}
