"use client";

import { useEffect, useState } from "react";
import { BarChart3, CheckCircle2, Inbox, PauseCircle, Sparkles, Tv, TrendingUp, Wand2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, SectionTitle, StatCard } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";

// ---- ตัวเลขจริงจากงานที่ใช้อยู่ทุกวัน ----
// การ์ดชุดเดิมด้านล่างอ่านจาก ad_content / metrics_log ซึ่งเป็นตารางของ "ระบบยิงแอดในตัวแอป"
// ที่ยังไม่เคยถูกใช้ (0 แถว) หน้าภาพรวมจึงว่างเปล่าทั้งที่ระบบมีข้อมูลจริงเยอะมาก
// ส่วนนี้จึงดึงจากแหล่งที่มีของจริง: แชทลูกค้า · สิทธิ์ TradingView · ยอดโฆษณาจากแคช Meta
const thb = (n) => `฿${Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (n) => Number(n || 0).toLocaleString("th-TH");

function LiveSummary({ onNavigate }) {
  const [d, setD] = useState(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const [counts, cache] = await Promise.all([
        // ตัวนับทั้ง 6 ตัวมาในคำขอเดียว (ดู function overview_counts ในฐานข้อมูล)
        // เดิมแยกเป็น 6 คำขอ ตัวนับ tv_external_members ตัวเดียวใช้เวลาถึง 1.1 วินาที
        supabase.rpc("overview_counts"),
        // ตาราง ad_insights_cache ปิดไม่ให้ client อ่าน (RLS ไม่มี policy) ซึ่งถูกต้องแล้ว
        // จึงเรียกผ่าน edge function ที่ตรวจสิทธิ์อยู่แล้ว — ฟังก์ชันจะคืนจากแคชเอง ไม่ยิง Meta ซ้ำ
        // ใช้บัญชีเดียวกับที่เลือกค้างไว้ในหน้าแคมเปญ ถ้ายังไม่เคยเลือกก็ข้ามไป
        (() => {
          // ค่าใน localStorage บางครั้งถูกเก็บเป็น JSON บางครั้งเป็นสตริงดิบ — รับได้ทั้งสองแบบ
          const stored = localStorage.getItem("ui.campaigns.adAccount") || "";
          let acct = stored;
          try { const j = JSON.parse(stored); if (j) acct = String(j); } catch { /* สตริงดิบ ใช้ได้เลย */ }
          acct = String(acct || "").replace(/^"|"$/g, "").trim();
          if (!acct) return Promise.resolve({ data: null });
          return supabase.functions.invoke("list-campaigns", { body: { ad_account_id: acct, date_preset: "last_30d" } });
        })(),
      ]);

      let spend = 0, results = 0, hasAds = false;
      for (const c of cache?.data?.campaigns || []) {
        const m = c?.metrics || {};
        spend += Number(m.spend || 0);
        results += Number(m.result_value || 0);
        hasAds = true;
      }
      const c = counts?.data || {};
      if (!dead) setD({
        customers: c.customers ?? 0, unanswered: c.unanswered ?? 0, fresh7: c.fresh7 ?? 0,
        tvAll: c.tvAll ?? 0, tvSoon: c.tvSoon ?? 0, tvSoon3: c.tvSoon3 ?? 0, tvExpired: c.tvExpired ?? 0,
        spend, results, hasAds,
      });
    })().catch(() => { if (!dead) setD({ error: true }); });
    return () => { dead = true; };
  }, []);

  if (!d) return <Card className="p-5 text-sm text-slate-500">กำลังโหลดตัวเลขล่าสุด…</Card>;
  if (d.error) return <Card className="p-5 text-sm text-rose-600">โหลดตัวเลขไม่สำเร็จ</Card>;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 2xl:grid-cols-5">
      <StatCard icon={Inbox} label="ลูกค้าทั้งหมด" value={int(d.customers)}
        sub={`ทักใหม่ 7 วัน ${int(d.fresh7)} คน`} tone="brand" onClick={() => onNavigate?.("customer_list")} />
      <StatCard icon={Inbox} label="ยังไม่ได้ตอบ" value={int(d.unanswered)}
        sub={d.unanswered > 0 ? "รอแอดมินตอบอยู่" : "ตอบครบแล้ว"}
        tone={d.unanswered > 0 ? "gold" : "brand"} onClick={() => onNavigate?.("inbox")} />
      {/* สองใบนี้ไม่ซ้ำคนกัน: <= 3 วัน = ต้องรีบติดต่อวันนี้ · 4-7 วัน = ไว้วางแผนล่วงหน้า
          บวกกันได้ตรง ๆ = จำนวนคนที่สิทธิ์จะหมดภายใน 7 วัน */}
      <StatCard icon={Tv} label="สิทธิ์ใกล้หมดใน 3 วัน" value={int(d.tvSoon3)}
        sub={d.tvSoon3 > 0 ? "ต้องรีบติดต่อ" : "ยังไม่มีใครใกล้หมด"}
        tone={d.tvSoon3 > 0 ? "red" : "brand"} onClick={() => onNavigate?.("customerdb")} />
      <StatCard icon={Tv} label="สิทธิ์หมดใน 4–7 วัน" value={int(d.tvSoon)}
        sub={`ทั้งหมด ${int(d.tvAll)} · หมดแล้ว ${int(d.tvExpired)}`}
        tone={d.tvSoon > 0 ? "gold" : "brand"} onClick={() => onNavigate?.("customerdb")} />
      <StatCard icon={BarChart3} label="ค่าโฆษณา 30 วัน" value={d.hasAds ? thb(d.spend) : "—"}
        sub={d.hasAds ? `ได้ผลลัพธ์ ${int(d.results)} ครั้ง` : "เปิดหน้าแคมเปญเพื่อดึงข้อมูล"}
        tone="brand" onClick={() => onNavigate?.("campaigns")} />
    </div>
  );
}

// หน้าแรกของระบบ — ต้องตอบคำถามเดียวให้ได้ในสายตาแรก: "ตอนนี้มีอะไรต้องทำ"
// เรียงเป็น ตัวเลขสรุป → เงินไปลงที่แอดตัวไหน → คิวงานที่ต้องมีคนกด
export default function OverviewTab({ adContent = [], adCopies = [], adImages = [], metricsToday = [], onNavigate }) {
  // รออนุมัติ นับจากแหล่งเดียวกับหน้า "รออนุมัติ" (copies + images ที่ยัง pending)
  // ไม่ใช่แถวเก่าค้างใน ad_content
  const pending =
    adCopies.filter((c) => c.status === "pending_approval").length +
    adImages.filter((im) => im.status === "pending_approval").length;
  const active = adContent.filter((a) => a.status === "active").length;
  const pausedAuto = adContent.filter((a) => a.status === "paused_auto").length;
  const scaleSuggested = adContent.filter((a) => a.scale_suggested).length;
  const spendToday = metricsToday.reduce((sum, m) => sum + (m.spend || 0), 0);

  // แอดที่มีการใช้จ่ายวันนี้ เรียงจากมากไปน้อย — ข้อมูลจริงจาก metrics_log + ad_content
  const spendByAd = {};
  metricsToday.forEach((m) => {
    if (!m.ad_content_id) return;
    spendByAd[m.ad_content_id] = (spendByAd[m.ad_content_id] || 0) + (m.spend || 0);
  });
  const topAds = Object.entries(spendByAd)
    .map(([adId, spend]) => ({ ad: adContent.find((a) => a.id === adId), spend }))
    .filter((row) => row.ad && row.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8);

  // คิวงานที่ต้องมีคนกด — เรียงตามความเร่ง (เงินไหลอยู่มาก่อน)
  const queue = [
    {
      key: "paused_auto", count: pausedAuto, tone: "red", label: "หยุดอัตโนมัติ รอตรวจ",
      hint: "ระบบหยุดให้แล้วเพราะผลไม่ผ่านเกณฑ์", go: () => onNavigate?.("campaigns", "paused_auto"),
    },
    {
      key: "scale", count: scaleSuggested, tone: "blue", label: "รออนุมัติเพิ่มงบ",
      hint: "แอดที่ผลดีพอจะขยายงบได้", go: () => onNavigate?.("campaigns", "scale"),
    },
    {
      key: "review", count: pending, tone: "gold", label: "คอนเทนต์รออนุมัติ",
      hint: "ข้อความและรูปที่ยังไม่ได้ตรวจ", go: () => onNavigate?.("review"),
    },
  ].filter((item) => item.count > 0);

  const needsAttention = queue.reduce((sum, item) => sum + item.count, 0);
  const fmtNum = (n) => Math.round(n).toLocaleString("th-TH");
  // ฿ ไม่มีใน IBM Plex Mono จึง fallback ไปฟอนต์อื่นที่ความกว้างไม่ตรงกับ tabular-nums
  // แล้วไปทับตัวเลข — แยกสัญลักษณ์ออกมาเป็นฟอนต์ sans ต่างหาก ตัวเลขคงเป็น mono ไว้เทียบกันได้
  const baht = (n) => (
    <>
      <span className="font-sans text-[0.68em] font-medium text-slate-400 align-baseline">฿</span>
      <span className="ml-1">{fmtNum(n)}</span>
    </>
  );

  return (
    <div className="w-full max-w-[1400px] space-y-5">
      {/* ไม่ใส่ eyebrow — เมนูซ้ายบอกอยู่แล้วว่าอยู่หน้าภาพรวม ป้ายซ้ำหัวข้อคือสัญญาณรบกวน */}
      <SectionTitle
        title="ภาพรวม"
        subtitle="สรุปสถานะระบบยิงโฆษณาอัตโนมัติแบบเรียลไทม์"
        right={
          <Button variant="primary" icon={Sparkles} onClick={() => onNavigate?.("generate")}>
            สร้างคอนเทนต์ใหม่
          </Button>
        }
      />

      <LiveSummary onNavigate={onNavigate} />

      {/* ตัวเลขสรุป — ค่าโฆษณามาก่อน เพราะเป็นตัวเดียวที่เป็นเงินไหลออกจริง */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={BarChart3}
          label="ค่าโฆษณาวันนี้"
          value={baht(spendToday)}
          sub={`จากโฆษณาที่ใช้งาน ${active} ชิ้น`}
          tone="brand"
          onClick={() => onNavigate?.("analyze")}
        />
        <StatCard
          icon={CheckCircle2}
          label="กำลังใช้งาน"
          value={active}
          tone="green"
          onClick={() => onNavigate?.("campaigns", "active")}
        />
        <StatCard
          icon={Wand2}
          label="รออนุมัติ"
          value={pending}
          tone="gold"
          onClick={() => onNavigate?.("review")}
        />
        <StatCard
          icon={TrendingUp}
          label="รออนุมัติเพิ่มงบ"
          value={scaleSuggested}
          tone="blue"
          onClick={() => onNavigate?.("campaigns", "scale")}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        {/* เงินไปลงที่แอดตัวไหน */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <h3 className="ds-title text-[15px]">โฆษณาที่ใช้จ่ายวันนี้</h3>
              <p className="mt-0.5 text-2xs text-slate-400">เรียงจากค่าโฆษณาสูงสุด</p>
            </div>
            <button
              onClick={() => onNavigate?.("analyze")}
              className="shrink-0 text-2xs font-semibold text-brand-700 hover:text-brand-800"
            >
              ดูรายงานเต็ม
            </button>
          </div>
          {topAds.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="ยังไม่มีการใช้จ่ายวันนี้"
              hint="ตัวเลขจะขึ้นเมื่อระบบดึงผลจาก Meta รอบถัดไป"
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {topAds.map(({ ad, spend }) => (
                <li key={ad.id} className="flex items-center gap-3 px-5 py-3">
                  <span
                    title={ad.status}
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      ad.status === "active"
                        ? "bg-emerald-500"
                        : ad.status === "paused_auto"
                          ? "bg-rose-500"
                          : "bg-slate-300"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-slate-700">
                      {ad.headline || ad.product || "(ไม่มีชื่อ)"}
                    </span>
                    {ad.product && ad.headline && (
                      <span className="block truncate text-2xs text-slate-400">{ad.product}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[13.5px] tabular-nums text-slate-900">{baht(spend)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* คิวงาน — ว่างแล้วต้องบอกว่าว่างจริง ไม่ปล่อยพื้นที่โหวง */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <h3 className="ds-title text-[15px]">รอดำเนินการ</h3>
            {needsAttention > 0 ? (
              <Badge tone="gold" dot>{needsAttention} รายการ</Badge>
            ) : (
              <Badge tone="green" dot>ไม่มีค้าง</Badge>
            )}
          </div>
          {queue.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="เคลียร์หมดแล้ว"
              hint="ไม่มีคอนเทนต์รออนุมัติ ไม่มีแอดที่ระบบหยุดไว้ และไม่มีคำขอเพิ่มงบค้าง"
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {queue.map(({ key, count, tone, label, hint, go }) => (
                <li key={key}>
                  <button
                    onClick={go}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium text-slate-700">{label}</span>
                      <span className="block truncate text-2xs text-slate-400">{hint}</span>
                    </span>
                    <Badge tone={tone}>{count}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
