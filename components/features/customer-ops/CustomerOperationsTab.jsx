"use client";

import { useState } from "react";
import { MessageSquare, Users, Tv } from "lucide-react";
import CustomerDatabaseTab, { TradeIdChecker } from "@/components/features/customerdb/CustomerDatabaseTab";
import TvMembersTab from "@/components/features/tv-members/TvMembersTab";
import { SavedRepliesPanel } from "@/components/features/settings/SettingsTab";
import { SectionTitle } from "@/components/ui";

const MODES = [
  ["customers", "ลูกค้า", Users],
  ["tv", "TradingView", Tv],
  ["replies", "ตอบกลับอัตโนมัติ", MessageSquare],
];

export default function CustomerOperationsTab({ allowedPages = null, onOpenChat }) {
  const [mode, setMode] = useState("customers");
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      {/* เดิมเป็นพาเนลดำ (bg-slate-950) พร้อมป้ายสีทอง — เป็นก้อนมืดก้อนเดียวในแอปที่เหลือสว่างทั้งหมด
          เปลี่ยนเป็นหัวข้อปกติ แล้วให้เครื่องมือเช็ค Trade ID อยู่ในการ์ดของตัวเองข้างๆ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionTitle
          title="ศูนย์จัดการลูกค้า"
          subtitle="ค้นหาลูกค้า เช็ค Trade ID ให้สิทธิ์ TradingView และจัดการข้อความตอบกลับ จากที่เดียว"
        />
        <div className="ds-card w-full max-w-sm p-3">
          <TradeIdChecker />
        </div>
      </div>
      {/* ตัวควบคุมแบบแบ่งช่อง — พื้นเทาอ่อนช่วยให้เห็นว่าเป็นชุดเดียวกัน ช่องที่เลือกเป็นการ์ดขาวลอยขึ้นมา */}
      <div className="inline-flex flex-wrap gap-1 rounded-card border border-slate-200 bg-slate-100 p-1">
        {MODES.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex items-center gap-2 rounded-control px-4 py-2 text-[13.5px] font-semibold transition ${
              mode === key ? "bg-white text-brand-700 shadow-card" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {mode === "customers" && <CustomerDatabaseTab onOpenChat={onOpenChat} />}
      {mode === "tv" && <TvMembersTab active />}
      {mode === "replies" && <SavedRepliesPanel allowedPages={allowedPages} />}
    </div>
  );
}
