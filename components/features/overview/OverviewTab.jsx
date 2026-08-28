"use client";

import { Sparkles, CheckCircle2, TrendingUp, Wand2, BarChart3, PauseCircle } from "lucide-react";
import { Card as DsCard, StatCard as DsStatCard, SectionTitle, Badge, Button as DsButton } from "@/components/ui";

function OverviewTab({ adContent, adCopies = [], adImages = [], metricsToday, onNavigate }) {
  // นับจากแหล่งเดียวกับหน้า "รออนุมัติ" (copies + images ที่ยัง pending) ไม่ใช่แถวเก่าค้างใน ad_content
  const pending =
    adCopies.filter((c) => c.status === "pending_approval").length +
    adImages.filter((im) => im.status === "pending_approval").length;
  const active = adContent.filter((a) => a.status === "active").length;
  const pausedAuto = adContent.filter((a) => a.status === "paused_auto").length;
  const scaleSuggestions = adContent.filter((a) => a.scale_suggested).length;
  const spendToday = metricsToday.reduce((sum, m) => sum + (m.spend || 0), 0);

  const needsAttention = pending + pausedAuto + scaleSuggestions;

  return (
    <div className="space-y-7 max-w-6xl">
      <SectionTitle
        eyebrow="Overview"
        title="ภาพรวม"
        subtitle="สรุปสถานะระบบยิงโฆษณาอัตโนมัติแบบเรียลไทม์"
        right={
          needsAttention > 0 ? (
            <Badge tone="gold">{needsAttention} รายการรอดำเนินการ</Badge>
          ) : (
            <Badge tone="green">ทุกอย่างเรียบร้อย</Badge>
          )
        }
      />

      {/* Hero — ยอดใช้จ่ายวันนี้ */}
      <DsCard
        glass
        className="p-6 sm:p-7 relative overflow-hidden cursor-pointer ds-hover-lift"
        onClick={() => onNavigate?.("campaigns", "active")}
      >
        <div className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full blur-3xl opacity-20" style={{ background: "#F7C948" }} />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] text-slate-400 font-medium flex items-center gap-2">
              <TrendingUp size={15} style={{ color: "#F7C948" }} />
              ยอดใช้จ่ายรวมวันนี้
            </div>
            <div className="mt-2 flex items-end gap-2">
              <span className="ds-figure text-[48px] sm:text-[58px]">
                {spendToday.toLocaleString()}
              </span>
              <span className="text-slate-400 text-lg mb-1.5">บาท</span>
            </div>
            <div className="text-[12px] text-slate-500 mt-2">รวมจากโฆษณาที่กำลังใช้งาน {active} ชิ้น</div>
          </div>
          <div className="rounded-2xl p-3.5 shrink-0" style={{ background: "rgba(157,107,255,.12)", color: "#9D6BFF" }}>
            <BarChart3 size={26} />
          </div>
        </div>
      </DsCard>

      {/* การ์ดสถิติ */}
      <div>
        <div className="text-[12px] uppercase tracking-wider text-slate-500 font-semibold mb-3">สถานะโฆษณา</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <DsStatCard icon={Wand2} label="รออนุมัติ" value={pending} tone="gold" onClick={() => onNavigate?.("review")} />
          <DsStatCard icon={CheckCircle2} label="กำลังใช้งาน" value={active} tone="green" onClick={() => onNavigate?.("campaigns", "active")} />
          <DsStatCard icon={PauseCircle} label="หยุดอัตโนมัติ" value={pausedAuto} tone="red" onClick={() => onNavigate?.("campaigns", "paused_auto")} />
          <DsStatCard icon={TrendingUp} label="รออนุมัติเพิ่มงบ" value={scaleSuggestions} tone="blue" onClick={() => onNavigate?.("campaigns", "scale")} />
        </div>
      </div>

      {/* การกระทำด่วน */}
      <div>
        <div className="text-[12px] uppercase tracking-wider text-slate-500 font-semibold mb-3">การกระทำด่วน</div>
        <div className="flex flex-wrap gap-3">
          <DsButton variant="primary" icon={Sparkles} onClick={() => onNavigate?.("generate")}>สร้างคอนเทนต์ใหม่</DsButton>
          <DsButton variant="secondary" icon={CheckCircle2} onClick={() => onNavigate?.("review")}>ตรวจรออนุมัติ{pending > 0 ? ` (${pending})` : ""}</DsButton>
          <DsButton variant="secondary" icon={BarChart3} onClick={() => onNavigate?.("analyze")}>วิเคราะห์ผล</DsButton>
        </div>
      </div>
    </div>
  );
}

export default OverviewTab;
