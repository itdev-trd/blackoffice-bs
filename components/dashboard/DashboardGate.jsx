"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import Spinner from "@/components/shared/Spinner";
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
    // เดิมเป็นจอดำเต็มหน้า (ซากธีม dark) ซึ่งเป็นหน้าจอเดียวในแอปที่มืด
    // ทำให้ดูเหมือนระบบพัง มากกว่าจะสื่อว่า "บัญชียังไม่ได้รับสิทธิ์"
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="ds-card w-full max-w-md p-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-card bg-rose-50 text-rose-600">
            <AlertTriangle size={24} />
          </div>
          <h1 className="ds-title text-[17px]">บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-slate-500">
            {perm.error || "ติดต่อผู้ดูแลระบบเพื่อขอเปิดสิทธิ์ให้อีเมลของคุณ"}
          </p>
          <button
            onClick={handleLogout}
            className="ds-btn ds-btn-secondary mt-6 px-4 py-2.5 text-sm"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    );
  }

  return <DashboardNav>{loading || !perm ? <Spinner /> : children}</DashboardNav>;
}
