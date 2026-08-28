"use client";

import { useState } from "react";
import { CheckCircle2, MessageSquare, Users, Tv } from "lucide-react";
import CustomerDatabaseTab, { TradeIdChecker } from "@/components/features/customerdb/CustomerDatabaseTab";
import TvMembersTab from "@/components/features/tv-members/TvMembersTab";
import { SavedRepliesPanel } from "@/components/features/settings/SettingsTab";

const MODES = [
  ["customers", "ลูกค้า", Users],
  ["tv", "TradingView", Tv],
  ["replies", "ตอบกลับอัตโนมัติ", MessageSquare],
];

export default function CustomerOperationsTab({ allowedPages = null, onOpenChat }) {
  const [mode, setMode] = useState("customers");
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div className="rounded-2xl bg-slate-950 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-300"><CheckCircle2 size={15} /> Customer Operations</div>
            <h1 className="text-2xl font-bold tracking-tight">ศูนย์จัดการลูกค้าและ TradingView</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">ค้นหาลูกค้า เช็ค Trade ID ให้สิทธิ์ TradingView และจัดการข้อความตอบกลับ แยกตามแบรนด์/เพจจากพื้นที่เดียว</p>
          </div>
          <div className="w-full max-w-sm rounded-xl bg-white/10 p-3 backdrop-blur">
            <TradeIdChecker />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {MODES.map(([key, label, Icon]) => (
          <button key={key} onClick={() => setMode(key)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${mode === key ? "bg-slate-900 text-white shadow" : "text-slate-500 hover:bg-slate-100"}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      {mode === "customers" && <CustomerDatabaseTab onOpenChat={onOpenChat} />}
      {mode === "tv" && <TvMembersTab active />}
      {mode === "replies" && <SavedRepliesPanel allowedPages={allowedPages} />}
    </div>
  );
}
