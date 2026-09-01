"use client";

import { useState } from "react";
import { MessageSquare, Users, Tv } from "lucide-react";
import CustomerDatabaseTab, { TradeIdChecker } from "@/components/features/customerdb/CustomerDatabaseTab";
import TvMembersTab from "@/components/features/tv-members/TvMembersTab";
import { SavedRepliesPanel } from "@/components/features/settings/SettingsTab";
import { SectionTitle } from "@/components/ui";
import { useDashboard } from "@/components/dashboard/DashboardContext";

const MODES = [
  ["customers", "ลูกค้า", Users],
  ["tv", "TradingView", Tv],
  ["replies", "ตอบกลับอัตโนมัติ", MessageSquare],
];

export default function CustomerOperationsTab({ allowedPages = null, onOpenChat }) {
  const [mode, setMode] = useState("customers");
  // แท็บ TradingView เรียก edge function ที่บังคับสิทธิ์ tab "tv_members" อยู่แล้ว
  // เดิมโชว์แท็บนี้ให้ทุกคนโดยไม่เช็ค พนักงานที่ไม่มีสิทธิ์จึงกดเข้าไปแล้วเจอ 403 เปล่าๆ
  //
  // ต้องอ่านจาก perm.allowedTabs ตรงๆ ห้ามใช้ can() เพราะ can() ดูจาก visibleTabs ซึ่งสร้างจาก TABS
  // และ tv_members ถูกถอดออกจาก TABS ไปแล้ว (ไม่มีเมนูซ้ายของตัวเอง) — ใช้ can() จะได้ false เสมอทุกคน
  const { perm, restricted } = useDashboard();
  const canTv = !!perm && (!restricted || (perm.allowedTabs || []).includes("tv_members"));
  const modes = MODES.filter(([key]) => key !== "tv" || canTv);
  const activeMode = mode === "tv" && !canTv ? "customers" : mode;
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      {/* เดิมเป็นพาเนลดำ (bg-slate-950) พร้อมป้ายสีทอง — เป็นก้อนมืดก้อนเดียวในแอปที่เหลือสว่างทั้งหมด
          เปลี่ยนเป็นหัวข้อปกติ แล้วให้เครื่องมือเช็ค Trade ID อยู่ในการ์ดของตัวเองข้างๆ */}
      <SectionTitle
        title="ศูนย์จัดการลูกค้า"
        subtitle="ค้นหาลูกค้า เช็ค Trade ID ให้สิทธิ์ TradingView และจัดการข้อความตอบกลับ จากที่เดียว"
        right={
          <div className="ds-card w-full sm:w-80 p-3.5">
            <TradeIdChecker standalone />
          </div>
        }
      />
      {/* ตัวควบคุมแบบแบ่งช่อง — ช่องที่เลือกใช้สี brand ทึบ
          (เดิมช่องที่เลือกเป็นพื้นขาว ซึ่งในธีมมืดกลายเป็นสีเข้มกว่าพื้นราง อ่านกลับด้านว่าช่องนั้น "ยุบลง" แทนที่จะถูกเลือก) */}
      <div className="inline-flex flex-wrap gap-1 rounded-card border border-slate-200 bg-slate-100 p-1">
        {modes.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex items-center gap-2 rounded-control px-4 py-2 text-[13.5px] font-semibold transition ${
              activeMode === key ? "bg-brand-600 text-white shadow-card" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {activeMode === "customers" && <CustomerDatabaseTab onOpenChat={onOpenChat} />}
      {activeMode === "tv" && <TvMembersTab active embedded />}
      {activeMode === "replies" && <SavedRepliesPanel allowedPages={allowedPages} />}
    </div>
  );
}
