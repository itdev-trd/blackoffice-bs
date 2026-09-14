"use client";

import { useState } from "react";
import { MessageSquare, Users, Tv, Gauge, ScanSearch, Megaphone } from "lucide-react";
import CustomerDatabaseTab, { TradeIdChecker } from "@/components/features/customerdb/CustomerDatabaseTab";
import TvMembersTab from "@/components/features/tv-members/TvMembersTab";
import BesightMembersTab from "@/components/features/tv-members/BesightMembersTab";
import DetectedDataReview from "@/components/features/customerdb/DetectedDataReview";
import { SavedRepliesPanel } from "@/components/features/settings/SettingsTab";
import LineBroadcastPanel from "@/components/features/customer-ops/LineBroadcastPanel";
import { SectionTitle } from "@/components/ui";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import { hasFullData } from "@/lib/constants/roles";

const MODES = [
  ["customers", "ลูกค้า", Users],
  ["tv", "TradingView", Tv],
  ["indicator", "สมาชิก Indicator", Gauge],
  ["detected", "ตรวจข้อมูลที่พบ", ScanSearch],
  ["replies", "ตอบกลับอัตโนมัติ", MessageSquare],
  ["broadcast", "Broadcast LINE", Megaphone],
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
  // Broadcast LINE = ส่งออกหาลูกค้าจำนวนมาก ให้เฉพาะบทบาทที่มีอำนาจกับข้อมูลเต็มที่
  // (เดิมเช็ค role === "admin" ตรง ๆ ซึ่งพอเพิ่มบทบาท owner แล้วเจ้าของระบบจะมองไม่เห็นเมนูนี้)
  const canBroadcast = hasFullData(perm?.role);
  const modes = MODES.filter(([key]) => (key !== "tv" && key !== "indicator" || canTv) && (key !== "broadcast" || canBroadcast));
  const activeMode = (mode === "tv" || mode === "indicator") && !canTv ? "customers" : mode;
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      {/* เดิมเป็นพาเนลดำ (bg-slate-950) พร้อมป้ายสีทอง — เป็นก้อนมืดก้อนเดียวในแอปที่เหลือสว่างทั้งหมด
          เปลี่ยนเป็นหัวข้อปกติ แล้วให้เครื่องมือเช็ค Trade ID อยู่ในการ์ดของตัวเองข้างๆ */}
      <SectionTitle
        eyebrow="CUSTOMER DESK"
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
      {/* บนมือถือเดิมเป็น flex-wrap ทำให้ปุ่มตกบรรทัดแบบไม่เท่ากัน กว้างบ้างแคบบ้าง กดยาก
          เปลี่ยนเป็นตาราง 2 ช่องเต็มความกว้าง เห็นครบทุกหมวดโดยไม่ต้องเลื่อน และปุ่มใหญ่พอนิ้วกด
          จอ sm ขึ้นไปกลับไปเป็นแถวเดียวแบบ segmented control เหมือนเดิม */}
      <div className="studio-mode-tabs" role="tablist" aria-label="งานลูกค้า">
        {modes.map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeMode === key}
            onClick={() => setMode(key)}
          >
            <Icon size={15} className="shrink-0" /> <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
      {activeMode === "customers" && <CustomerDatabaseTab onOpenChat={onOpenChat} />}
      {activeMode === "tv" && <TvMembersTab active embedded onOpenChat={onOpenChat} />}
      {activeMode === "indicator" && <BesightMembersTab active={activeMode === "indicator"} />}
      {activeMode === "detected" && <DetectedDataReview onOpenChat={onOpenChat} />}
      {activeMode === "replies" && <SavedRepliesPanel allowedPages={allowedPages} />}
      {activeMode === "broadcast" && <LineBroadcastPanel />}
    </div>
  );
}
