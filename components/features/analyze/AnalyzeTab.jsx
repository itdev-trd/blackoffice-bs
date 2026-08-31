"use client";

import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  BarChart3,
  AlertTriangle,
  FileDown,
  ArrowLeft,
  GitCompare,
  ChevronRight,
  ChevronDown,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Minus,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { lsGet, lsSet } from "@/lib/utils/storage";
import { bangkokDate } from "@/lib/utils/date";
import { logActivity } from "@/lib/utils/activity";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { calculateVatInclusiveBudget } from "@/lib/budget-vat";
import { exportPageNavHtml } from "@/lib/utils/export";
import HomeButton from "@/components/shared/HomeButton";
import Spinner from "@/components/shared/Spinner";
import StatusBadge from "@/components/shared/StatusBadge";
import { GhostAlert, useArchive, ArchiveBar } from "@/components/features/campaigns/CampaignsTab";
import { SectionTitle } from "@/components/ui";

const VERDICT_META = {
  underperform: { label: "ต่ำกว่าเป้า", cls: "bg-rose-100 text-rose-700", Icon: ArrowDownCircle },
  outperform: { label: "ดีเกินเป้า", cls: "bg-emerald-100 text-emerald-700", Icon: ArrowUpCircle },
  on_target: { label: "ตามเป้า", cls: "bg-blue-100 text-blue-700", Icon: CheckCircle2 },
  insufficient_data: { label: "ข้อมูลยังน้อย", cls: "bg-slate-100 text-slate-600", Icon: Minus },
};

function VerdictBadge({ verdict }) {
  const m = VERDICT_META[verdict];
  if (!m) return null;
  const { label, cls, Icon } = m;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${cls}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("th-TH", { maximumFractionDigits: digits });
}

// ---------------------------------------------------------------
// แดชบอร์ดเจาะลึกรายแอด (charts / gauges แบบ SVG ไม่พึ่งไลบรารีนอก)
// ---------------------------------------------------------------
function KpiTile({ label, value, sub, tone = "slate", secondaryLabel, secondaryValue }) {
  const tones = { slate: "text-slate-800", green: "text-emerald-600", rose: "text-rose-600", blue: "text-blue-600", amber: "text-amber-600" };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 min-w-0">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums break-words ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
      {secondaryLabel && secondaryValue != null && (
        <div className="mt-2 pt-2 border-t border-slate-200/80 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span className="text-[11px] text-slate-500">{secondaryLabel}</span>
          <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${tones[tone]}`}>{secondaryValue}</span>
        </div>
      )}
    </div>
  );
}

function GaugeMeter({ value, max = 100, label, display, tone = "#9D6BFF" }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = 52, cx = 70, cy = 66;
  const pt = (frac) => {
    const t = Math.PI * (1 - frac); // left(π)->right(0)
    return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  };
  const [lx, ly] = pt(0);
  const [ex, ey] = pt(pct);
  const [rx, ry] = pt(1);
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 84" className="w-full max-w-[150px]">
        <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${rx} ${ry}`} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="12" strokeLinecap="round" />
        <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke={tone} strokeWidth="12" strokeLinecap="round" />
        <text x="70" y="60" textAnchor="middle" className="fill-slate-800" style={{ fontSize: 18, fontWeight: 700 }}>{display}</text>
      </svg>
      <div className="text-xs text-slate-500 -mt-1">{label}</div>
    </div>
  );
}

function BarList({ items, valueKey = "impressions", labelMap, format, tone = "#9D6BFF", empty = "ไม่มีข้อมูล" }) {
  const list = (items || []).filter((i) => (i[valueKey] || 0) > 0).sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
  if (list.length === 0) return <div className="text-xs text-slate-400 py-3 text-center">{empty}</div>;
  const maxVal = Math.max(1, ...list.map((i) => i[valueKey] || 0));
  return (
    <div className="space-y-1.5">
      {list.map((it) => {
        const v = it[valueKey] || 0;
        const label = labelMap ? labelMap(it.key) : it.key;
        return (
          <div key={it.key} className="flex items-center gap-2 text-xs">
            <div className="w-24 shrink-0 truncate text-slate-600" title={label}>{label}</div>
            <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
              <div className="h-3 rounded-full" style={{ width: `${(v / maxVal) * 100}%`, background: tone }} />
            </div>
            <div className="w-16 shrink-0 text-right text-slate-700">{format ? format(v, it) : fmtNum(v)}</div>
          </div>
        );
      })}
    </div>
  );
}

// รายการแท่งแบบหลายมิติพร้อมกัน — แต่ละมิติเป็นสีของตัวเอง (แต่ละมิติสเกลตามค่าสูงสุดของตัวเอง)
function BarListMulti({ items, metrics, labelMap, empty = "ไม่มีข้อมูล" }) {
  const list = (items || []).filter((i) => metrics.some((m) => (i[m.key] || 0) > 0));
  if (list.length === 0) return <div className="text-xs text-slate-400 py-3 text-center">{empty}</div>;
  const sortVal = (i) => metrics.reduce((s, m) => s + (i[m.key] || 0), 0);
  const sorted = [...list].sort((a, b) => sortVal(b) - sortVal(a));
  const single = metrics.length === 1;
  // มิติเดียว: หลอดสเกลตามค่าสูงสุด (ดูการกระจายในมิติเดียว)
  // หลายมิติ: หลอด = สัดส่วน % ภายในมิตินั้น เพื่อเทียบข้ามมิติได้ (ค่าคนละสเกลกัน)
  const maxByKey = {}, totalByKey = {};
  metrics.forEach((m) => {
    maxByKey[m.key] = Math.max(1, ...sorted.map((i) => i[m.key] || 0));
    totalByKey[m.key] = Math.max(1, sorted.reduce((s, i) => s + (i[m.key] || 0), 0));
  });
  return (
    <div className="space-y-2.5">
      {sorted.map((it) => {
        const label = labelMap ? labelMap(it.key) : it.key;
        return (
          <div key={it.key} className="text-xs">
            <div className="text-slate-600 mb-1 truncate" title={label}>{label}</div>
            <div className="space-y-1">
              {metrics.map((m) => {
                const v = it[m.key] || 0;
                const pct = (v / totalByKey[m.key]) * 100;
                const width = single ? (v / maxByKey[m.key]) * 100 : pct;
                return (
                  <div key={m.key} className="flex items-center gap-2">
                    {!single && <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: m.color }} title={m.label} />}
                    <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div className="h-2.5 rounded-full" style={{ width: `${width}%`, background: m.color }} />
                    </div>
                    <div className="w-20 shrink-0 text-right text-slate-700">
                      {fmtNum(v)}{!single && <span className="text-slate-400"> · {Math.round(pct)}%</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GenderDonut({ gender, valueKey = "impressions" }) {
  const items = (gender || []).filter((g) => (g[valueKey] || 0) > 0);
  const total = items.reduce((s, g) => s + (g[valueKey] || 0), 0);
  if (total === 0) return <div className="text-xs text-slate-400 py-3 text-center">ไม่มีข้อมูล</div>;
  const colors = { male: "#3b82f6", female: "#ec4899", unknown: "#94a3b8" };
  const labels = { male: "ชาย", female: "หญิง", unknown: "ไม่ระบุ" };
  const C = 2 * Math.PI * 42;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0">
        <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="16" />
        {items.map((g) => {
          const frac = (g[valueKey] || 0) / total;
          const seg = (
            <circle
              key={g.key}
              cx="60" cy="60" r="42" fill="none"
              stroke={colors[g.key] || "#94a3b8"} strokeWidth="16"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += frac * C;
          return seg;
        })}
      </svg>
      <div className="space-y-1 text-xs">
        {items.map((g) => (
          <div key={g.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[g.key] || "#94a3b8" }} />
            <span className="text-slate-600">{labels[g.key] || g.key}</span>
            <span className="text-slate-400">{Math.round(((g[valueKey] || 0) / total) * 100)}%</span>
            <span className="text-slate-500">· {fmtNum(g[valueKey] || 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// กราฟเทรนด์รายวัน — มีแกน X (วันที่) / แกน Y (ค่า) + เส้นกริด, รองรับหลายเส้นพร้อมกัน
function DailyMultiChart({ points, series }) {
  const data = points || [];
  if (data.length === 0) return <div className="text-xs text-slate-500 py-6 text-center">ไม่มีข้อมูลรายวัน</div>;
  const list = (series || []).length ? series : [{ key: "spend", label: "ค่าใช้จ่าย", color: "#9D6BFF" }];
  const single = list.length === 1;
  const W = 640, H = 220, mL = 46, mR = 14, mT = 12, mB = 28;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const n = data.length;
  const x = (i) => mL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const maxByKey = {};
  list.forEach((s) => { maxByKey[s.key] = Math.max(1, ...data.map((d) => d[s.key] || 0)); });
  // แกน Y: มิติเดียว = ค่าจริง, หลายมิติ = 0-100% (แต่ละเส้นเทียบจุดสูงสุดของตัวเอง)
  const yTop = single ? maxByKey[list[0].key] : 1;
  const yOf = (v, key) => mT + plotH - (single ? v / yTop : v / maxByKey[key]) * plotH;
  const yTicks = [0, 0.5, 1].map((f) => ({ yy: mT + plotH - f * plotH, label: single ? fmtNum(yTop * f) : `${Math.round(f * 100)}%` }));
  const fmtDate = (ds) => { if (!ds) return ""; const p = String(ds).split("-"); return p.length === 3 ? `${+p[2]}/${+p[1]}` : ds; };
  const step = Math.max(1, Math.ceil(n / 5));
  const xTicks = [];
  for (let i = 0; i < n; i += step) xTicks.push(i);
  if (n > 1 && xTicks[xTicks.length - 1] !== n - 1) xTicks.push(n - 1);
  return (
    <div>
      {!single && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
          {list.map((s) => (
            <div key={s.key} className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label} <span className="text-slate-400">· สูงสุด {fmtNum(maxByKey[s.key])}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-slate-500" style={{ height: "auto" }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={mL} y1={t.yy} x2={W - mR} y2={t.yy} stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
            <text x={mL - 6} y={t.yy + 3} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.7">{t.label}</text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 9} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.7">{fmtDate(data[i]?.date)}</text>
        ))}
        {list.map((s) => {
          const pts = data.map((d, i) => `${x(i)},${yOf(d[s.key] || 0, s.key)}`).join(" ");
          const area = `${x(0)},${mT + plotH} ${pts} ${x(n - 1)},${mT + plotH}`;
          return (
            <g key={s.key}>
              {single && <polygon points={area} fill={s.color} opacity="0.12" />}
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
      <div className="text-[10px] text-slate-400 text-center mt-1">
        แกนนอน = วันที่ · แกนตั้ง = {single ? list[0].label : "สัดส่วน % เทียบจุดสูงสุดของแต่ละเส้น (ค่าจริงดูที่คำอธิบายด้านบน)"}
      </div>
    </div>
  );
}

function Funnel({ impressions, clicks, leads }) {
  const stages = [
    { label: "การมองเห็น (Impressions)", value: impressions, color: "#6366f1" },
    { label: "คลิก (Clicks)", value: clicks, color: "#0ea5e9" },
    { label: "ลีด (Leads)", value: leads, color: "#10b981" },
  ];
  const top = Math.max(1, impressions);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev && prev > 0 ? Math.round((s.value / prev) * 100 * 10) / 10 : null;
        return (
          <div key={s.label}>
            <div className="flex justify-between text-xs text-slate-600">
              <span>{s.label}</span>
              <span className="font-medium text-slate-800">
                {fmtNum(s.value)}
                {conv != null && <span className="text-slate-400 font-normal"> · {conv}%</span>}
              </span>
            </div>
            <div className="bg-slate-100 rounded-md h-5 mt-0.5 overflow-hidden">
              <div className="h-5 rounded-md" style={{ width: `${Math.max(2, (s.value / top) * 100)}%`, background: s.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const AGE_LABEL = (k) => k;
const REGION_LABEL = (k) => k;
const BD_METRIC_LABEL = { impressions: "การมองเห็น", leads: "ลีด", replies: "ตอบกลับจริง" };
const BD_METRIC_META = {
  impressions: { label: "การมองเห็น", color: "#0ea5e9" },
  leads: { label: "ลีด", color: "#10b981" },
  replies: { label: "ตอบกลับจริง", color: "#8b5cf6" },
};
const BD_KEYS = ["impressions", "leads", "replies"];
const GENDER_LABEL = (k) => ({ male: "ชาย", female: "หญิง", unknown: "ไม่ระบุ" }[k] || k);
// วัตถุประสงค์แคมเปญ (objective จาก Meta) -> ป้ายภาษาไทย
const OBJECTIVE_LABEL = (k) => {
  if (!k) return "";
  const m = {
    OUTCOME_LEADS: "หาลีด",
    OUTCOME_SALES: "ยอดขาย",
    OUTCOME_ENGAGEMENT: "การมีส่วนร่วม/ข้อความ",
    OUTCOME_TRAFFIC: "ทราฟฟิก",
    OUTCOME_AWARENESS: "การรับรู้",
    OUTCOME_APP_PROMOTION: "โปรโมทแอป",
    LEAD_GENERATION: "หาลีด",
    MESSAGES: "ข้อความ",
    CONVERSIONS: "คอนเวอร์ชัน",
    LINK_CLICKS: "คลิกลิงก์",
    POST_ENGAGEMENT: "มีส่วนร่วมโพสต์",
    PAGE_LIKES: "ไลก์เพจ",
    REACH: "การเข้าถึง",
    BRAND_AWARENESS: "การรับรู้แบรนด์",
    VIDEO_VIEWS: "ดูวิดีโอ",
    PRODUCT_CATALOG_SALES: "ขายสินค้าแคตตาล็อก",
    STORE_VISITS: "เข้าร้าน",
  };
  return m[k] || k;
};
const DEVICE_LABEL = (k) => {
  const m = { mobile_app: "แอปมือถือ", mobile_web: "เว็บมือถือ", desktop: "เดสก์ท็อป", mobile_tablet: "แท็บเล็ต" };
  return m[k] || k;
};

const DATE_PRESETS = [
  { value: "maximum", label: "มากที่สุด" },
  { value: "today", label: "วันนี้" },
  { value: "yesterday", label: "เมื่อวานนี้" },
  { value: "last_3d", label: "3 วันที่ผ่านมา" },
  { value: "last_7d", label: "7 วันที่ผ่านมา" },
  { value: "last_14d", label: "14 วันที่ผ่านมา" },
  { value: "last_28d", label: "28 วันที่ผ่านมา" },
  { value: "last_30d", label: "30 วันที่ผ่านมา" },
  { value: "last_90d", label: "90 วันที่ผ่านมา" },
  { value: "this_week_mon_today", label: "สัปดาห์นี้" },
  { value: "last_week_mon_sun", label: "สัปดาห์ที่แล้ว" },
  { value: "this_month", label: "เดือนนี้" },
  { value: "last_month", label: "เดือนที่แล้ว" },
  { value: "custom", label: "กำหนดเอง" },
];

// แปลงค่าช่วงวันเป็น body ที่ส่งให้ฟังก์ชัน (preset หรือ time_range)
function rangeToBody(r) {
  if (r?.preset === "custom" && r.since && r.until) return { time_range: { since: r.since, until: r.until } };
  return { date_preset: r?.preset || "last_30d" };
}
function rangeLabel(r) {
  if (r?.preset === "custom") return r.since && r.until ? `${r.since} - ${r.until}` : "กำหนดเอง";
  return DATE_PRESETS.find((p) => p.value === r?.preset)?.label || "";
}

// ตัวเลือกช่วงวันแบบ Meta (preset + กำหนดเองด้วยปฏิทิน)
function RangePicker({ value, onChange, disabled }) {
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <select
        value={value.preset}
        onChange={(e) => onChange({ ...value, preset: e.target.value })}
        disabled={disabled}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      {value.preset === "custom" && (
        <div className="flex items-center gap-1">
          <input type="date" value={value.since || ""} max={value.until || undefined} onChange={(e) => onChange({ ...value, since: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          <span className="text-xs text-slate-400">-</span>
          <input type="date" value={value.until || ""} min={value.since || undefined} onChange={(e) => onChange({ ...value, until: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
        </div>
      )}
    </div>
  );
}

// การ์ดลูก (ชุดโฆษณา/โฆษณา) สำหรับ drill-down — มีปุ่มแดชบอร์ด และกางดูลูกต่อได้
function DrillCard({ node, level, range, onDash }) {
  const [expanded, setExpanded] = useState(false);
  const isAdset = level === "adsets";
  const m = node.metrics || {};
  return (
    <div className={`rounded-lg border ${isAdset ? "border-brand-100 bg-brand-50/40" : "border-slate-200 bg-white"} p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          {isAdset ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-slate-600 hover:text-slate-900 mt-0.5 shrink-0"
              title={expanded ? "ซ่อนโฆษณา" : "ดูโฆษณาในชุดนี้"}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium text-slate-800 text-sm truncate">{node.name}</div>
            <div className="text-[11px] text-slate-400">
              {isAdset ? "ชุดโฆษณา" : "โฆษณา"} · {node.effective_status}
              {node.daily_budget_thb ? ` · งบ/วัน ${fmtNum(node.daily_budget_thb)}฿` : ""}
            </div>
          </div>
        </div>
        <button
          onClick={() => onDash({ ad_id: node.id, headline: node.name, level })}
          className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 text-slate-600 hover:bg-slate-50 flex items-center gap-1 shrink-0"
        >
          <BarChart3 size={13} /> แดชบอร์ด
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>Spend: <b>{fmtNum(m.spend)}฿</b></span>
        <span>Leads: <b>{fmtNum(m.leads)}</b></span>
        <span>CPL: <b>{m.cpl ? fmtNum(m.cpl) + "฿" : "—"}</b></span>
        <span>CTR: {fmtNum(m.ctr, 2)}%</span>
        <span>CPM: {fmtNum(m.cpm)}฿</span>
        <span>คลิก: {fmtNum(m.clicks)}</span>
        {m.reply_rate != null && <span className={m.reply_rate < 0.4 ? "text-rose-600" : ""}>อัตราตอบ: {Math.min(100, Math.round(m.reply_rate * 100))}%</span>}
      </div>
      {isAdset && expanded && (
        <div className="pl-3 border-l-2 border-brand-200 mt-2">
          <ChildrenList parentId={node.id} level="ads" range={range} onDash={onDash} />
        </div>
      )}
    </div>
  );
}

// โหลดและแสดงรายการลูกของ node หนึ่ง (adsets ในแคมเปญ หรือ ads ในชุดโฆษณา)
function ChildrenList({ parentId, level, range, onDash }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nodes, setNodes] = useState([]);
  const rangeKey = JSON.stringify(rangeToBody(range));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const { data, error: fnError } = await supabase.functions.invoke("list-children", {
        body: { parent_id: parentId, level, ...rangeToBody(range) },
      });
      if (cancelled) return;
      setLoading(false);
      if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
      if (!data?.ok) { setError(data?.error || "โหลดไม่สำเร็จ"); return; }
      setNodes(data.nodes || []);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, level, rangeKey]);

  if (loading) return <div className="py-2"><Spinner label={level === "adsets" ? "กำลังโหลดชุดโฆษณา..." : "กำลังโหลดโฆษณา..."} /></div>;
  if (error) return <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5">{error}</div>;
  if (nodes.length === 0) return <div className="text-xs text-slate-400 py-2">{level === "adsets" ? "ไม่พบชุดโฆษณาในแคมเปญนี้" : "ไม่พบโฆษณาในชุดนี้"}</div>;

  return (
    <div className="space-y-2">
      {nodes.map((n) => (
        <DrillCard key={n.id} node={n} level={level} range={range} onDash={onDash} />
      ))}
    </div>
  );
}

// แปลง preset/ช่วงเป็นวันที่จริง (YYYY-MM-DD) เพื่อใช้แบ่ง segment
function presetToDates(range) {
  const fmt = bangkokDate;
  if (range.preset === "custom") return range.since && range.until ? { since: range.since, until: range.until } : null;
  const today = new Date();
  const back = (n) => { const x = new Date(today); x.setDate(x.getDate() - n); return x; };
  const nd = { last_3d: 3, last_7d: 7, last_14d: 14, last_30d: 30, last_90d: 90 };
  if (range.preset === "today") return { since: fmt(today), until: fmt(today) };
  if (range.preset === "yesterday") return { since: fmt(back(1)), until: fmt(back(1)) };
  if (nd[range.preset]) return { since: fmt(back(nd[range.preset] - 1)), until: fmt(today) };
  return null; // maximum/this_month/last_month → ไม่แบ่ง (โชว์แค่ log)
}
const dayMinus1 = (d) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

// แผงประวัติการเปลี่ยนแปลง + เทียบผลก่อน/หลังแก้
function ChangeComparePanel({ adId, range }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [segs, setSegs] = useState(null);
  const [err, setErr] = useState("");
  const dates = presetToDates(range);
  const key = JSON.stringify([adId, dates]);
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setErr(""); setSegs(null); setEvents([]);
      if (!adId) { setLoading(false); return; }
      const body = { node_id: adId };
      if (dates) { body.since = dates.since; body.until = dates.until; }
      const { data, error } = await supabase.functions.invoke("ad-activities", { body });
      if (cancel) return;
      if (error) { setErr(await readFunctionErrorMessage(error)); setLoading(false); return; }
      if (!data?.ok) { setErr(data?.error || ""); setLoading(false); return; }
      const evs = data.events || [];
      setEvents(evs);
      if (dates && evs.length) {
        const byDate = {};
        evs.forEach((e) => { const d = String(e.time).slice(0, 10); (byDate[d] = byDate[d] || []).push(e.label); });
        const chDates = Object.keys(byDate).filter((d) => d > dates.since && d <= dates.until).sort();
        if (chDates.length) {
          const segRanges = []; let start = dates.since;
          chDates.forEach((cd) => { const end = dayMinus1(cd); if (end >= start) segRanges.push({ since: start, until: end, label: segRanges.length === 0 ? `ก่อนแก้ (ถึง ${end})` : start }); start = cd; });
          segRanges.push({ since: start, until: dates.until, label: `หลังแก้ ${chDates[chDates.length - 1]} (${(byDate[chDates[chDates.length - 1]] || []).join(", ")})` });
          const { data: ins } = await supabase.functions.invoke("ad-insights", { body: { ad_id: adId, time_range: { since: dates.since, until: dates.until }, segments: segRanges } });
          if (cancel) return;
          if (ins?.ok && ins.segments) setSegs(ins.segments.map((s, i) => ({ ...s, label: segRanges[i]?.label || `${s.since}–${s.until}` })));
        }
      }
      setLoading(false);
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-4"><Spinner label="กำลังดึงประวัติการเปลี่ยนแปลง..." /></div>;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="font-medium text-slate-800 text-sm">การเปลี่ยนแปลง & เทียบผลก่อน/หลังแก้</div>
      {err && <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5">{err}</div>}
      {events.length === 0 && !err && <div className="text-xs text-slate-400">ไม่พบการเปลี่ยนแปลงในช่วงนี้</div>}

      {segs && segs.length >= 2 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 pr-2 font-medium">ช่วง</th><th className="py-1.5 px-2 font-medium">Spend</th><th className="py-1.5 px-2 font-medium">ลีด</th><th className="py-1.5 px-2 font-medium">ตอบกลับ</th><th className="py-1.5 px-2 font-medium">CPL</th><th className="py-1.5 px-2 font-medium">CTR</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {segs.map((s, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2 text-slate-700">{s.label}<div className="text-[10px] text-slate-400">{s.since} – {s.until}</div></td>
                  <td className="py-1.5 px-2">{fmtNum(s.overall.spend)}฿</td>
                  <td className="py-1.5 px-2">{fmtNum(s.overall.leads)}</td>
                  <td className="py-1.5 px-2">{fmtNum(s.overall.replies)}</td>
                  <td className="py-1.5 px-2">{s.overall.cpl ? fmtNum(s.overall.cpl) + "฿" : "—"}</td>
                  <td className="py-1.5 px-2">{fmtNum(s.overall.ctr, 2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-slate-400 mt-1.5">* 2-3 วันแรกหลังแก้ Meta อาจรีเซ็ตการเรียนรู้ (ตัวเลขแกว่ง) และลีดบางส่วนอาจ attribute คาบเกี่ยวช่วง</div>
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-slate-400">บันทึกการเปลี่ยนแปลง</div>
          {events.slice(0, 15).map((e, i) => (
            <div key={i} className="text-xs text-slate-600 flex gap-2">
              <span className="text-slate-400 shrink-0">{String(e.time).slice(0, 10)}</span>
              <span>{e.label}{e.actor ? ` · ${e.actor}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ประวัติการตั้งค่า (snapshot ที่เราเก็บเอง)
function ConfigHistoryPanel({ adId, refresh }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("ad_config_snapshots").select("*").eq("node_id", adId).order("captured_at", { ascending: false }).limit(20);
      setRows(data || []);
    })();
  }, [adId, refresh]);
  const fmtT = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); } catch { return t; } };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
      <div className="font-medium text-slate-800 text-sm">ประวัติการตั้งค่า (เก็บเองจากที่เปิดดู)</div>
      {rows === null ? <Spinner label="กำลังโหลด..." /> : rows.length === 0 ? (
        <div className="text-xs text-slate-400">ยังไม่มีประวัติ — ระบบเริ่มเก็บ snapshot ตั้งแต่ครั้งนี้เป็นต้นไป ทุกครั้งที่ค่าตั้งเปลี่ยน</div>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {rows.map((r, i) => (
            <div key={r.id} className="px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700">{r.summary || "(การตั้งค่า)"}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{i === 0 ? "ปัจจุบัน · " : ""}{fmtT(r.captured_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// รายละเอียดการตั้งค่าทั้งหมด (แคมเปญ/ชุดโฆษณา/โฆษณา) แบบเต็มไม่ตัด
function FullConfigPanel({ adId, level, onNavigate }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  // ไม่ดึงอัตโนมัติแล้ว (ลดการยิง Meta) — เปลี่ยน node = ล้างของเดิม รอกดปุ่มดึงเอง
  useEffect(() => { setData(null); setErr(""); setLoading(false); }, [adId, level]);
  async function load() {
    setLoading(true); setErr("");
    const { data: res, error } = await supabase.functions.invoke("ad-config-full", { body: { node_id: adId, level: level || "ad" } });
    setLoading(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!res?.ok) { setErr(res?.error || ""); return; }
    setData(res);
  }

  const Row = ({ label, value }) => {
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
    return <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">{label}</span><span className="text-slate-700 min-w-0 break-words whitespace-pre-wrap">{value}</span></div>;
  };
  const Chips = ({ items }) => !items?.length ? null : (
    <span className="flex flex-wrap gap-1">{items.map((x, i) => <span key={i} className="bg-slate-100 rounded px-1.5 py-0.5 text-[11px] text-slate-600">{x}</span>)}</span>
  );
  const budget = (a) => a.daily_budget_thb ? `${fmtNum(a.daily_budget_thb)}฿/วัน` : a.lifetime_budget_thb ? `${fmtNum(a.lifetime_budget_thb)}฿ ตลอด` : "—";
  const placeText = (p) => p === "advantage_plus_auto" ? "Advantage+ (อัตโนมัติ)" : null;

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-4"><Spinner label="กำลังดึงรายละเอียดการตั้งค่า..." /></div>;
  // ยังไม่ได้ดึง → โชว์ปุ่มให้กดดึงเอง (ไม่ยิง Meta อัตโนมัติ)
  if (!data) return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="font-medium text-slate-800 text-sm mb-2">รายละเอียดการตั้งค่าทั้งหมด</div>
      {err && <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5 mb-2">{err}</div>}
      <button onClick={load} className="text-xs bg-brand-600 text-white rounded-lg px-3 py-2 font-medium flex items-center gap-1.5 hover:bg-brand-700">
        <RefreshCw size={13} /> ดึงรายละเอียดการตั้งค่า
      </button>
      <div className="text-[11px] text-slate-400 mt-1.5">กดเพื่อดึงจาก Meta (ไม่ดึงอัตโนมัติ เพื่อลดการยิง API)</div>
    </div>
  );
  const c = data.campaign;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-slate-800 text-sm">รายละเอียดการตั้งค่าทั้งหมด</div>
        <button onClick={load} className="text-[11px] text-slate-400 hover:text-slate-700 flex items-center gap-1"><RefreshCw size={12} /> ดึงใหม่</button>
      </div>

      {c && (
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs font-semibold text-slate-700 mb-1">แคมเปญ</div>
          <Row label="ชื่อ" value={c.name} />
          <Row label="วัตถุประสงค์" value={c.objective} />
          <Row label="สถานะ" value={c.status} />
          <Row label="ประเภทการซื้อ" value={c.buying_type} />
          <Row label="Bid strategy" value={c.bid_strategy} />
          <Row label="งบแคมเปญ" value={c.daily_budget_thb ? `${fmtNum(c.daily_budget_thb)}฿/วัน` : c.lifetime_budget_thb ? `${fmtNum(c.lifetime_budget_thb)}฿ ตลอด` : null} />
          <Row label="หมวดพิเศษ" value={(c.special_ad_categories || []).join(", ")} />
        </div>
      )}

      {(data.adsets || []).map((a, idx) => (
        <div key={a.id || idx} className="rounded-lg border border-brand-100 bg-brand-50/30 p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-xs font-semibold text-slate-700">ชุดโฆษณา{data.adsets.length > 1 ? ` #${idx + 1}` : ""}</div>
            {onNavigate && a.id && (
              <button onClick={() => onNavigate({ ad_id: a.id, headline: a.name, level: "adsets" })} className="text-[11px] border border-slate-300 rounded-lg px-2 py-0.5 text-slate-600 hover:bg-white flex items-center gap-1">
                <BarChart3 size={12} /> แดชบอร์ดชุดนี้
              </button>
            )}
          </div>
          <Row label="ชื่อ" value={a.name} />
          <Row label="สถานะ" value={a.status} />
          <Row label="เป้าหมายการยิง" value={a.optimization_goal} />
          <Row label="การเก็บเงิน" value={a.billing_event} />
          <Row label="งบ" value={budget(a)} />
          <Row label="Bid" value={a.bid_thb ? `${fmtNum(a.bid_thb)}฿` : null} />
          <Row label="เริ่ม–สิ้นสุด" value={a.start_time ? `${String(a.start_time).slice(0, 10)}${a.end_time ? " – " + String(a.end_time).slice(0, 10) : ""}` : null} />
          <Row label="อายุ" value={a.age?.[0] ? `${a.age[0]}–${a.age[1] || "65+"}` : null} />
          <Row label="เพศ" value={Array.isArray(a.genders) ? a.genders.join(", ") : a.genders} />
          <Row label="ภาษา" value={(a.locales || []).join(", ")} />
          <Row label="ประเทศ" value={(a.countries || []).join(", ")} />
          {a.regions?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">ภูมิภาค/จังหวัด</span><Chips items={a.regions} /></div> : null}
          {a.cities?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">เมือง</span><Chips items={a.cities} /></div> : null}
          {a.interests?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">ความสนใจ ({a.interests.length})</span><Chips items={a.interests} /></div> : null}
          {a.behaviors?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">พฤติกรรม ({a.behaviors.length})</span><Chips items={a.behaviors} /></div> : null}
          {a.demographics?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">ข้อมูลประชากร</span><Chips items={a.demographics} /></div> : null}
          {a.custom_audiences?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">Custom Audience</span><Chips items={a.custom_audiences} /></div> : null}
          {a.excluded_custom_audiences?.length ? <div className="flex gap-2 text-xs py-0.5"><span className="text-slate-400 w-32 shrink-0">ยกเว้น Audience</span><Chips items={a.excluded_custom_audiences} /></div> : null}
          {placeText(a.placements) ? <Row label="การจัดวาง" value={placeText(a.placements)} /> : a.placements ? (
            <>
              <Row label="แพลตฟอร์ม" value={(a.placements.platforms || []).join(", ")} />
              <Row label="ตำแหน่ง FB" value={(a.placements.facebook_positions || []).join(", ")} />
              <Row label="ตำแหน่ง IG" value={(a.placements.instagram_positions || []).join(", ")} />
              <Row label="ตำแหน่ง Messenger" value={(a.placements.messenger_positions || []).join(", ")} />
              <Row label="ตำแหน่ง Audience Network" value={(a.placements.audience_network_positions || []).join(", ")} />
              <Row label="อุปกรณ์" value={(a.placements.device_platforms || []).join(", ")} />
            </>
          ) : null}
          <Row label="Advantage+ Audience" value={a.advantage_audience != null ? String(a.advantage_audience) : null} />

          {(a.ads || []).map((ad2, j) => (
            <div key={ad2?.id || j} className="rounded-lg border border-slate-200 bg-white p-3 mt-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-xs font-semibold text-slate-700">โฆษณา{a.ads.length > 1 ? ` #${j + 1}` : ""}</div>
                {onNavigate && ad2?.id && (
                  <button onClick={() => onNavigate({ ad_id: ad2.id, headline: ad2.name, level: "ads" })} className="text-[11px] border border-slate-300 rounded-lg px-2 py-0.5 text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                    <BarChart3 size={12} /> แดชบอร์ดโฆษณานี้
                  </button>
                )}
              </div>
              <div className="flex gap-3 flex-col sm:flex-row">
                {ad2?.video_url ? (
                  <video src={ad2.video_url} poster={ad2.image_url || undefined} controls className="w-48 rounded border border-slate-200 shrink-0" />
                ) : ad2?.image_url ? (
                  <img src={ad2.image_url} alt="" className="w-48 rounded object-contain border border-slate-200 shrink-0" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <Row label="ชื่อโฆษณา" value={ad2?.name} />
                  <Row label="สถานะ" value={ad2?.status} />
                  <Row label="ประเภทสื่อ" value={ad2?.media_type === "video" ? "วิดีโอ" : "รูปภาพ"} />
                  <Row label="หัวข้อ" value={ad2?.headline} />
                  <Row label="ข้อความ (แคปชั่น)" value={ad2?.body} />
                  <Row label="คำอธิบาย" value={ad2?.description} />
                  <Row label="ปุ่ม CTA" value={ad2?.cta} />
                  <Row label="ลิงก์" value={ad2?.link} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AdDashboardModal({ ad, ai, onClose, onNavigate }) {
  const [range, setRange] = useState({ preset: "today", since: "", until: "" }); // เริ่มที่ "วันนี้" ให้ตรงกับการ์ด
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [dailyKeys, setDailyKeys] = useState(["spend"]); // เลือกได้หลายเส้นพร้อมกัน
  const [bdMetrics, setBdMetrics] = useState(["impressions"]); // เลือกได้หลายมิติพร้อมกัน
  const [aiResult, setAiResult] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const rangeKey = JSON.stringify(rangeToBody(range));

  // ---- งบยิงโฆษณา (ป้อนเอง + บันทึกจำไว้) — เก็บบนระบบใน settings.ad_budgets แยกตามระดับ+id ----
  const budgetKey = `${ad.level || "ad"}:${ad.ad_id || ""}`;
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetSaved, setBudgetSaved] = useState(null);   // ค่าที่บันทึกไว้ล่าสุด (number|null)
  const [budgetMsg, setBudgetMsg] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);   // เมนูเลือกฟอร์แมต export
  const [trackerBusy, setTrackerBusy] = useState(false); // กำลังดึงทั้งแคมเปญเพื่อทำฟอร์แมตงบยิง Ads
  const [reloadTick, setReloadTick] = useState(0);       // สั่งดึงใหม่ (force) — ข้าม cache
  const forceRef = useRef(false);
  const refreshInsights = () => { forceRef.current = true; setReloadTick((t) => t + 1); };
  const dashRef = useRef(null);
  async function runTracker(fmt) {
    setTrackerBusy(true);
    logActivity("export", { format: `งบยิง Ads (${fmt})`, name: ad.headline, ad_id: ad.ad_id });
    try {
      const { campaignName, rows } = await fetchCampaignTree(ad, data, range);
      if (!rows.length) { alert("ไม่พบโฆษณาในแคมเปญนี้ (หรือดึงข้อมูลไม่สำเร็จ)"); return; }
      if (fmt === "pdf") exportTrackerPdf(campaignName, rows);
      else if (fmt === "excel") await exportTrackerExcel(campaignName, rows);
      else exportTrackerCsv(campaignName, rows);
    } catch (error) {
      alert(`สร้างไฟล์ไม่สำเร็จ: ${error?.message || error}`);
    } finally { setTrackerBusy(false); }
  }
  useEffect(() => {
    if (!ad?.ad_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "ad_budgets").maybeSingle();
      if (cancelled) return;
      const v = data?.value?.[budgetKey];
      if (v != null) { setBudgetInput(String(v)); setBudgetSaved(Number(v)); }
      else { setBudgetInput(""); setBudgetSaved(null); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetKey]);
  async function saveBudget() {
    const n = Math.max(0, Number(budgetInput) || 0);
    setBudgetSaving(true); setBudgetMsg("");
    const { data } = await supabase.from("settings").select("value").eq("key", "ad_budgets").maybeSingle();
    const cur = (data?.value && typeof data.value === "object") ? { ...data.value } : {};
    cur[budgetKey] = n;
    const { error } = await supabase.from("settings").upsert({ key: "ad_budgets", value: cur, updated_at: new Date().toISOString() });
    setBudgetSaving(false);
    if (error) { setBudgetMsg("บันทึกไม่สำเร็จ"); }
    else { setBudgetSaved(n); setBudgetMsg("บันทึกแล้ว ✓"); setTimeout(() => setBudgetMsg(""), 2500); }
  }

  const [snapRefresh, setSnapRefresh] = useState(0);
  // บันทึกว่ามีการเปิดแดชบอร์ดรายชิ้น + เก็บ snapshot การตั้งค่าปัจจุบัน (ครั้งเดียวตอน mount)
  useEffect(() => {
    if (!ad?.ad_id) return;
    logActivity("open_dashboard", { ad_id: ad.ad_id, name: ad.headline });
    (async () => {
      try {
        await supabase.functions.invoke("snapshot-config", { body: { node_id: ad.ad_id, level: ad.level || "ad" } });
        setSnapRefresh((x) => x + 1);
      } catch { /* เงียบไว้ */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.ad_id]);

  async function runDashboardAI() {
    if (!data) return;
    logActivity("ai_analyze", { ad_id: ad.ad_id, name: ad.headline });
    setAiBusy(true);
    setAiError("");
    const { data: res, error: fnErr } = await supabase.functions.invoke("analyze-dashboard", {
      body: {
        headline: ad.headline,
        objective: data.objective,
        overall: data.overall,
        age: data.age, gender: data.gender, region: data.region, placement: data.placement, device: data.device,
        text_model: "openai",
      },
    });
    setAiBusy(false);
    if (fnErr) { setAiError(await readFunctionErrorMessage(fnErr)); return; }
    if (!res?.ok) { setAiError(res?.error || "วิเคราะห์ไม่สำเร็จ"); return; }
    setAiResult(res);
  }
  // เปลี่ยนช่วงเวลา = ล้างผล AI เดิม (เพราะข้อมูลเปลี่ยน)
  useEffect(() => { setAiResult(null); setAiError(""); }, [rangeKey]);
  // toggle แบบเลือกหลายอัน (ต้องเหลืออย่างน้อย 1)
  const makeToggle = (setArr) => (k) => setArr((prev) => (prev.includes(k) ? (prev.length > 1 ? prev.filter((x) => x !== k) : prev) : [...prev, k]));
  const toggleDaily = makeToggle(setDailyKeys);
  const toggleBd = makeToggle(setBdMetrics);
  const customIncomplete = range.preset === "custom" && (!range.since || !range.until);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const useForce = forceRef.current; forceRef.current = false;
      const { data: res, error: fnError } = await supabase.functions.invoke("ad-insights", {
        body: { ad_id: ad.ad_id, level: ad.level || "ad", ...rangeToBody(range), ...(useForce ? { force: true } : {}) },
      });
      if (cancelled) return;
      setLoading(false);
      if (fnError) {
        setError(await readFunctionErrorMessage(fnError));
        return;
      }
      if (!res?.ok) {
        setError(res?.error || "ดึงข้อมูลไม่สำเร็จ");
        return;
      }
      // "ลูกค้าเปิดบัญชีใหม่" ต่อวัน — คำนวณฝั่ง server แล้ว (roll-up ตามระดับ โฆษณา/ชุด/แคมเปญ)
      if (cancelled) return;
      setData({ ...res, accountOpensByDate: res.account_opens_by_date || {} });
    }
    if (!ad.ad_id) {
      setLoading(false);
      setError("แอดนี้ไม่มี Ad ID");
    } else if (customIncomplete) {
      setLoading(false); // รอเลือกวันเริ่ม-สิ้นสุดให้ครบก่อน
    } else load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.ad_id, rangeKey, reloadTick]);

  const o = data?.overall;
  // คะแนนสุขภาพแอด (heuristic รวม CTR / ความถี่ / อัตราตอบแชท)
  let health = null;
  if (o) {
    const parts = [];
    parts.push(Math.min(1, (o.ctr || 0) / 2)); // CTR 2% = เต็ม
    parts.push(o.frequency ? Math.max(0, Math.min(1, (4 - o.frequency) / 3)) : 0.6); // freq<=1 ดี, >=4 แย่
    if (o.reply_rate != null) parts.push(o.reply_rate);
    health = Math.round((parts.reduce((s, p) => s + p, 0) / parts.length) * 100);
  }
  const metricColors = { spend: "#6366f1", impressions: "#0ea5e9", clicks: "#f59e0b", leads: "#10b981", replies: "#8b5cf6" };
  const metricLabels = { spend: "ค่าใช้จ่าย", impressions: "การมองเห็น", clicks: "คลิก", leads: "ลีด", replies: "ตอบกลับจริง" };
  // ช่องกรอกเป็นวงเงินรวม VAT แล้ว ส่วนงบที่นำไปตั้งใน Meta ต้องย้อนกลับเป็นยอดก่อน VAT
  const budgetInfo = calculateVatInclusiveBudget(budgetInput, o?.spend || 0);
  const {
    totalWithVat: budgetTotalWithVat,
    beforeVat: budgetBeforeVat,
    vatAmount: budgetVatAmount,
    spentWithVat,
    remainBeforeVat: budgetRemainBeforeVat,
    remainWithVat: budgetRemainWithVat,
  } = budgetInfo;

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="safe-top sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="w-full px-4 sm:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm shrink-0">
              <ArrowLeft size={18} /> กลับ
            </button>
            <HomeButton />
            <div className="min-w-0">
              <div className="font-semibold text-slate-800 truncate">
                {ad.headline || "แดชบอร์ดแอด"}
                {data?.objective ? <span className="text-slate-500 font-normal"> ({OBJECTIVE_LABEL(data.objective)})</span> : ""}
              </div>
              <div className="text-[11px] text-slate-400">Ad ID: {ad.ad_id || "-"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:shrink-0 sm:justify-end">
            <button
              onClick={runDashboardAI}
              disabled={!data || aiBusy}
              className="text-xs bg-brand-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {aiBusy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} AI วิเคราะห์
            </button>
            <div className="relative">
              <button
                onClick={() => setExportMenu((v) => !v)}
                disabled={!data}
                className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
              >
                <FileDown size={14} /> Export <ChevronDown size={13} />
              </button>
              {trackerBusy && (
                <div className="absolute right-0 mt-1 z-30 bg-white border border-slate-200 rounded-lg shadow px-3 py-2 text-xs text-slate-600 flex items-center gap-1.5 whitespace-nowrap">
                  <Loader2 className="animate-spin" size={13} /> กำลังดึงข้อมูลทั้งแคมเปญ...
                </div>
              )}
              {exportMenu && data && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportMenu(false)} />
                  <div className="absolute right-0 mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[210px] overflow-hidden">
                    <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-slate-400">แดชบอร์ดรายวัน</div>
                    {[
                      ["PDF (พิมพ์/บันทึก)", () => exportAdDashboardPdf(ad, data, budgetInfo)],
                      ["Excel (.xls)", () => exportAdDashboardExcel(ad, data, budgetInfo)],
                      ["CSV (ตารางรายวัน)", () => exportAdDashboardCsv(ad, data)],
                    ].map(([label, fn]) => (
                      <button key={label} onClick={() => { logActivity("export", { format: label, name: ad.headline, ad_id: ad.ad_id }); fn(); setExportMenu(false); }}
                        className="w-full text-left text-xs px-3 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                        <FileDown size={13} className="text-slate-400" /> {label}
                      </button>
                    ))}
                    <div className="my-1 border-t border-slate-100" />
                    <div className="px-3 pt-0.5 pb-0.5 text-[10px] font-semibold text-slate-400">ฟอร์แมตงบยิง Ads (ทั้งแคมเปญ)</div>
                    {[
                      ["งบยิง Ads (PDF)", () => runTracker("pdf")],
                      ["งบยิง Ads (Excel)", () => runTracker("excel")],
                      ["งบยิง Ads (CSV)", () => runTracker("csv")],
                    ].map(([label, fn]) => (
                      <button key={label} onClick={() => { fn(); setExportMenu(false); }}
                        className="w-full text-left text-xs px-3 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                        <FileDown size={13} className="text-emerald-500" /> {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <RangePicker value={range} onChange={setRange} />
          </div>
        </div>
      </div>

      {data && (
        <div className="w-full px-4 sm:px-6 pt-3">
          <div className={`flex items-center justify-between gap-2 flex-wrap rounded-lg border px-3 py-2 text-xs ${data.cached ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
            <span className="inline-flex items-center gap-1.5">
              {data.cached ? "🗂️ ข้อมูลจากแคช" : "🟢 ข้อมูลสด"} · ดึงเมื่อ {data.fetched_at ? new Date(data.fetched_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-"}
              {data.cached ? " · กด \"ดึงใหม่\" เพื่ออัปเดตจาก Meta" : ""}
            </span>
            <button onClick={refreshInsights} disabled={loading} className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-300 text-slate-700 px-2.5 py-1 font-medium hover:bg-slate-50 disabled:opacity-50 shrink-0"><RefreshCw size={12} className={loading ? "animate-spin" : ""} /> ดึงใหม่ (สด)</button>
          </div>
        </div>
      )}

      <div ref={dashRef} className="w-full p-4 sm:p-6 space-y-4">
          {customIncomplete ? (
            <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-4 text-center">เลือกวันเริ่มต้นและวันสิ้นสุดเพื่อดูข้อมูล</div>
          ) : loading ? (
            <div className="py-16"><Spinner label="กำลังดึงข้อมูลจาก Meta..." /></div>
          ) : error ? (
            <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-3">
              {error}
              <div className="text-xs text-slate-500 mt-1">ต้องตั้งค่า META_ACCESS_TOKEN และแอดต้องมีข้อมูลในช่วงเวลาที่เลือก</div>
            </div>
          ) : data ? (
            <>
              {aiError && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{aiError}</div>}
              {(() => { const a = aiResult || ai; return (a?.result_th || a?.recommendation_th) ? (
                <div className="space-y-1.5">
                  {a.result_th && <div className="text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2">{a.result_th}</div>}
                  {a.recommendation_th && <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">แนะนำ: {a.recommendation_th}</div>}
                </div>
              ) : null; })()}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <KpiTile label="ค่าใช้จ่าย" value={`${fmtNum(o.spend)}฿`} />
                <KpiTile label="การมองเห็น" value={fmtNum(o.impressions)} sub={`เข้าถึง ${fmtNum(o.reach)} คน`} />
                <KpiTile label="ลีด" value={fmtNum(o.leads)} tone="green" sub={o.cpl ? `CPL ${fmtNum(o.cpl)}฿` : "—"} />
                <KpiTile label="CTR" value={`${fmtNum(o.ctr, 2)}%`} tone="blue" sub={`CPC ${fmtNum(o.cpc)}฿`} />
                <KpiTile label="CPM" value={`${fmtNum(o.cpm)}฿`} />
                <KpiTile label="คลิก" value={fmtNum(o.clicks)} sub={`ลิงก์ ${fmtNum(o.link_clicks)}`} />
                <KpiTile label="ความถี่" value={fmtNum(o.frequency, 2)} tone={o.frequency > 3 ? "rose" : "slate"} sub="ครั้ง/คน" />
                <KpiTile label="Conv. rate" value={o.cvr != null ? `${fmtNum(o.cvr, 1)}%` : "—"} sub="ลีด/คลิกลิงก์" />
              </div>

              {/* งบยิงโฆษณา (ป้อนเอง + บันทึกจำไว้) */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="font-medium text-slate-800 text-sm mb-3">งบยิงโฆษณา (ป้อนเอง)</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-500 mb-1">งบรวม VAT 7% แล้ว</div>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" inputMode="decimal" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="0"
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-lg font-semibold text-slate-800" />
                      <span className="text-slate-500 text-sm">฿</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <button onClick={saveBudget} disabled={budgetSaving} className="text-xs bg-brand-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-brand-700 disabled:opacity-50">{budgetSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
                      {budgetMsg
                        ? <span className={`text-[11px] ${budgetMsg.includes("✓") ? "text-emerald-600" : "text-rose-600"}`}>{budgetMsg}</span>
                        : (budgetSaved != null && <span className="text-[11px] text-slate-400">บันทึกงบรวมไว้ {fmtNum(budgetSaved, 2)}฿</span>)}
                    </div>
                  </div>
                  <KpiTile
                    label="งบยิง Ads (ก่อน VAT 7%)"
                    value={`${fmtNum(budgetBeforeVat, 2)}฿`}
                    tone="blue"
                    sub={`งบรวม ${fmtNum(budgetTotalWithVat, 2)}฿ − VAT ${fmtNum(budgetVatAmount, 2)}฿`}
                  />
                  <KpiTile
                    label="งบคงเหลือ (รวม VAT)"
                    value={`${fmtNum(budgetRemainWithVat, 2)}฿`}
                    tone={budgetRemainWithVat >= 0 ? "green" : "rose"}
                    sub={`หักค่าใช้จ่ายรวม VAT ${fmtNum(spentWithVat, 2)}฿`}
                    secondaryLabel="คงเหลือก่อน VAT 7%"
                    secondaryValue={`${fmtNum(budgetRemainBeforeVat, 2)}฿`}
                  />
                </div>
                <div className="text-[11px] text-slate-400 mt-2">งบที่กรอกคือยอดรวม VAT 7% แล้ว · ตัวเลขในการ์ดสีน้ำเงินคือยอดก่อน VAT ที่นำไปตั้งงบยิง Ads ได้ · งบคงเหลือหักค่าใช้จ่ายจาก Meta หลังบวก VAT 7% แล้ว · ระบบบันทึกตัวเลขไว้ให้อัตโนมัติ</div>
              </div>

              {o.conversations > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <KpiTile label="แชทเริ่ม" value={fmtNum(o.conversations)} />
                  <KpiTile label="ตอบกลับจริง" value={fmtNum(o.replies)} sub="ลูกค้าส่ง ≥2 ข้อความ (กันกดปุ่มแล้วเงียบ)" />
                  <KpiTile label="อัตราตอบ" value={o.reply_rate != null ? `${Math.min(100, Math.round(o.reply_rate * 100))}%` : "—"} tone={o.reply_rate != null && o.reply_rate < 0.4 ? "rose" : "green"} sub="คุยต่อจริง/แชทเริ่ม (สูงสุด 100%)" />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col items-center justify-center">
                  <GaugeMeter value={health ?? 0} max={100} display={`${health ?? "-"}`} label="คะแนนสุขภาพแอด" tone={health >= 66 ? "#10b981" : health >= 40 ? "#f59e0b" : "#ef4444"} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col items-center justify-center">
                  <GaugeMeter value={o.ctr || 0} max={3} display={`${fmtNum(o.ctr, 2)}%`} label="CTR (เทียบ 3%)" tone="#0ea5e9" />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col items-center justify-center">
                  <GaugeMeter value={o.reply_rate != null ? Math.min(100, o.reply_rate * 100) : 0} max={100} display={o.reply_rate != null ? `${Math.min(100, Math.round(o.reply_rate * 100))}%` : "—"} label="อัตราตอบแชท" tone="#8b5cf6" />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="font-medium text-slate-800 text-sm mb-2">ช่องทางการเปลี่ยนผู้ชมเป็นลีด (Funnel)</div>
                <Funnel impressions={o.impressions} clicks={o.link_clicks || o.clicks} leads={o.leads} />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="font-medium text-slate-800 text-sm">เทรนด์รายวัน</div>
                  <div className="flex gap-1 flex-wrap">
                    {Object.keys(metricLabels).map((m) => (
                      <button key={m} onClick={() => toggleDaily(m)} className={`text-[11px] px-2 py-1 rounded-full ${dailyKeys.includes(m) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                        {metricLabels[m]}
                      </button>
                    ))}
                    <button
                      onClick={() => setDailyKeys(dailyKeys.length === Object.keys(metricLabels).length ? ["spend"] : Object.keys(metricLabels))}
                      className={`text-[11px] px-2 py-1 rounded-full ${dailyKeys.length === Object.keys(metricLabels).length ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                    >
                      ทั้งหมด
                    </button>
                  </div>
                </div>
                <DailyMultiChart points={data.daily} series={dailyKeys.map((k) => ({ key: k, label: metricLabels[k], color: metricColors[k] }))} />
              </div>

              {(() => { const bdSeries = bdMetrics.map((k) => ({ key: k, ...BD_METRIC_META[k] })); const emptyMsg = `ไม่มี${bdMetrics.map((k) => BD_METRIC_LABEL[k]).join("/")}ในช่วงนี้`; return (
              <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium text-slate-800">การกระจายตัว (Breakdown)</div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[11px] text-slate-400 mr-1">ดูตาม:</span>
                  {BD_KEYS.map((k) => (
                    <button
                      key={k}
                      onClick={() => toggleBd(k)}
                      className={`text-[11px] px-2 py-1 rounded-full flex items-center gap-1 ${bdMetrics.includes(k) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                    >
                      <span className="w-2 h-2 rounded-sm" style={{ background: BD_METRIC_META[k].color }} />
                      {BD_METRIC_META[k].label}
                    </button>
                  ))}
                  <button
                    onClick={() => setBdMetrics(bdMetrics.length === BD_KEYS.length ? ["impressions"] : [...BD_KEYS])}
                    className={`text-[11px] px-2 py-1 rounded-full ${bdMetrics.length === BD_KEYS.length ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    ทั้งหมด
                  </button>
                </div>
              </div>
              {bdMetrics.includes("replies") && (
                <div className="text-[11px] text-slate-500 bg-brand-50 rounded-lg px-2.5 py-1.5">
                  "ตอบกลับจริง" = บทสนทนาที่ลูกค้าส่งข้อความ ≥2 ครั้ง (ตัดคนกดปุ่มแล้วเงียบ) — ใช้ดูว่าลีดจริงมาจากกลุ่ม/พื้นที่/ตำแหน่งไหน
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="font-medium text-slate-800 text-sm mb-3">ช่วงอายุ</div>
                  <BarListMulti items={data.age} metrics={bdSeries} labelMap={AGE_LABEL} empty={emptyMsg} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="font-medium text-slate-800 text-sm mb-3">เพศ</div>
                  {bdMetrics.length === 1 ? <GenderDonut gender={data.gender} valueKey={bdMetrics[0]} /> : <BarListMulti items={data.gender} metrics={bdSeries} labelMap={GENDER_LABEL} empty={emptyMsg} />}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="font-medium text-slate-800 text-sm mb-3">พื้นที่ (Top จังหวัด/ภูมิภาค)</div>
                  <BarListMulti items={data.region} metrics={bdSeries} labelMap={REGION_LABEL} empty={emptyMsg} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="font-medium text-slate-800 text-sm mb-3">ตำแหน่งจัดวาง (Placement)</div>
                  <BarListMulti items={data.placement} metrics={bdSeries} empty={emptyMsg} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 sm:col-span-2">
                  <div className="font-medium text-slate-800 text-sm mb-3">อุปกรณ์</div>
                  <BarListMulti items={data.device} metrics={bdSeries} labelMap={DEVICE_LABEL} empty={emptyMsg} />
                </div>
              </div>
              </>
              ); })()}

              <FullConfigPanel adId={ad.ad_id} level={ad.level} onNavigate={onNavigate} />
              <ChangeComparePanel adId={ad.ad_id} range={range} />
              <ConfigHistoryPanel adId={ad.ad_id} refresh={snapRefresh} />

              <div className="text-[11px] text-slate-400 text-center">ข้อมูลจาก Meta · ช่วง {rangeLabel(range)} · อัปเดต {new Date(data.generated_at).toLocaleString("th-TH")}</div>
            </>
          ) : null}
      </div>
    </div>
  );
}

// ตารางเปรียบเทียบหลายแอด/แคมเปญ (เต็มหน้าจอ, เลือกได้มากกว่า 2)
const COMPARE_METRICS = [
  { key: "spend", label: "ค่าใช้จ่าย (฿)", fmt: (v) => fmtNum(v) },
  { key: "impressions", label: "การมองเห็น", fmt: (v) => fmtNum(v) },
  { key: "reach", label: "เข้าถึง", fmt: (v) => fmtNum(v) },
  { key: "leads", label: "ลีด", fmt: (v) => fmtNum(v), better: "high" },
  { key: "cpl", label: "CPL (฿)", fmt: (v) => (v != null ? fmtNum(v) : "—"), better: "low" },
  { key: "ctr", label: "CTR (%)", fmt: (v) => fmtNum(v, 2), better: "high" },
  { key: "cpm", label: "CPM (฿)", fmt: (v) => fmtNum(v), better: "low" },
  { key: "cpc", label: "CPC (฿)", fmt: (v) => fmtNum(v), better: "low" },
  { key: "clicks", label: "คลิก", fmt: (v) => fmtNum(v), better: "high" },
  { key: "frequency", label: "ความถี่", fmt: (v) => fmtNum(v, 2), better: "low" },
  { key: "reply_rate", label: "อัตราตอบแชท (%)", fmt: (v) => (v != null ? Math.round(v * 100) : "—"), better: "high" },
];

function CompareView({ items, onClose, aiModel }) {
  const [range, setRange] = useState({ preset: "today", since: "", until: "" });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  const rangeKey = JSON.stringify(rangeToBody(range));
  const customIncomplete = range.preset === "custom" && (!range.since || !range.until);

  useEffect(() => {
    if (customIncomplete) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setAiResult(null);
      const res = await Promise.all(
        items.map(async (it) => {
          const { data, error } = await supabase.functions.invoke("ad-insights", { body: { ad_id: it.ad_id, ...rangeToBody(range) } });
          return { item: it, overall: !error && data?.ok ? data.overall : null };
        })
      );
      if (!cancelled) {
        setRows(res);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, items]);

  async function analyzeAI() {
    setAiBusy(true);
    setAiError("");
    setAiResult(null);
    const payloadItems = rows.filter((r) => r.overall).map((r) => ({ headline: r.item.headline, overall: r.overall }));
    const { data, error } = await supabase.functions.invoke("analyze-compare", { body: { items: payloadItems, text_model: aiModel || "openai" } });
    setAiBusy(false);
    if (error) { setAiError(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setAiError(data?.error || "วิเคราะห์ไม่สำเร็จ"); return; }
    setAiResult(data);
  }

  // หา index ที่ดีที่สุดของแต่ละ metric
  function bestIndex(metric) {
    if (!metric.better) return -1;
    let best = -1, bestVal = null;
    rows.forEach((r, i) => {
      const v = r.overall?.[metric.key];
      if (v == null) return;
      if (bestVal == null || (metric.better === "high" ? v > bestVal : v < bestVal)) {
        bestVal = v;
        best = i;
      }
    });
    return best;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto">
      <div className="safe-top sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="w-full px-4 sm:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm shrink-0">
              <ArrowLeft size={18} /> กลับ
            </button>
            <HomeButton />
            <div className="font-semibold text-slate-800 truncate">เปรียบเทียบ {items.length} รายการ</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:justify-end">
            <button onClick={analyzeAI} disabled={loading || aiBusy} className="text-xs bg-brand-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1.5">
              {aiBusy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} AI วิเคราะห์
            </button>
            <button onClick={() => exportComparePdf(rows, range)} disabled={loading} className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5">
              <FileDown size={14} /> Export PDF
            </button>
            <RangePicker value={range} onChange={setRange} />
          </div>
        </div>
      </div>
      <div className="w-full p-4 sm:p-6 space-y-3">
        {(aiResult || aiError) && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5">
            {aiError ? (
              <div className="text-sm text-rose-600">{aiError}</div>
            ) : (
              <>
                {aiResult.summary_th && <div className="text-sm text-slate-700">{aiResult.summary_th}</div>}
                {aiResult.winner_th && <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">🏆 {aiResult.winner_th}</div>}
                {aiResult.recommendation_th && <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">แนะนำ: {aiResult.recommendation_th}</div>}
              </>
            )}
          </div>
        )}
        {customIncomplete ? (
          <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-4 text-center">เลือกวันเริ่มต้นและวันสิ้นสุดเพื่อดูข้อมูล</div>
        ) : loading ? (
          <div className="py-16"><Spinner label="กำลังดึงข้อมูลเปรียบเทียบ..." /></div>
        ) : (
          <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left p-3 text-slate-500 font-medium sticky left-0 bg-white">ตัวชี้วัด</th>
                  {rows.map((r, i) => (
                    <th key={i} className="text-right p-3 text-slate-700 font-medium min-w-[140px] max-w-[200px] truncate" title={r.item.headline}>{r.item.headline}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_METRICS.map((m) => {
                  const best = bestIndex(m);
                  return (
                    <tr key={m.key} className="border-b border-slate-100">
                      <td className="p-3 text-slate-600 sticky left-0 bg-white">{m.label}</td>
                      {rows.map((r, i) => {
                        const v = r.overall?.[m.key];
                        return (
                          <td key={i} className={`p-3 text-right ${i === best ? "text-emerald-700 font-semibold bg-emerald-50" : "text-slate-700"}`}>
                            {v == null ? "—" : m.fmt(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">ช่องสีเขียว = ดีที่สุดในแถวนั้น · ข้อมูลจาก Meta</p>
      </div>
    </div>
  );
}


function buildCompareHtml(rows, preset) {
  const esc = escHtml;
  const head = rows.map((r) => `<th>${esc(r.item.headline)}</th>`).join("");
  const body = COMPARE_METRICS.map((m) => {
    const cells = rows.map((r) => {
      const v = r.overall?.[m.key];
      return `<td style="text-align:right">${v == null ? "—" : esc(m.fmt(v))}</td>`;
    }).join("");
    return `<tr><th>${esc(m.label)}</th>${cells}</tr>`;
  }).join("");
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>เปรียบเทียบโฆษณา</title>
<style>body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:24px}
h1{font-size:18px} table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
th,td{border:1px solid #e2e8f0;padding:6px 8px} th{background:#f8fafc;text-align:left}
@page{margin:12mm;size:landscape}</style></head><body>${exportPageNavHtml("analyze")}
<h1>เปรียบเทียบโฆษณา (${rows.length} รายการ)</h1>
<div style="color:#64748b;font-size:12px">อัปเดต ${esc(new Date().toLocaleString("th-TH"))}</div>
<table><tr><th>ตัวชี้วัด</th>${head}</tr>${body}</table>
<script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
}
function exportComparePdf(rows, preset) {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่"); return; }
  w.document.open();
  w.document.write(buildCompareHtml(rows, preset));
  w.document.close();
}

function AdAnalysisCard({ ad, latestMetric, history, ai, onChanged, compareChecked, onToggleCompare }) {
  const [openDash, setOpenDash] = useState(false);
  const verdict = latestMetric?.verdict;
  const spend = latestMetric?.spend;
  const leads = latestMetric?.leads;
  const cpa = latestMetric?.cpa;
  const hasChat = ad.conversations != null && ad.conversations > 0;
  const stop = (e) => e.stopPropagation();

  return (
    <div
      onClick={() => ad.ad_id && setOpenDash(true)}
      className={`rounded-xl border border-slate-200 p-3 space-y-2 transition ${ad.ad_id ? "cursor-pointer hover:border-slate-400 hover:shadow-sm" : ""}`}
    >
      {openDash && <AdDashboardModal ad={ad} ai={ai} onClose={() => setOpenDash(false)} />}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-slate-800 text-sm flex items-center gap-1.5">
            {ad.headline || "(ไม่มีชื่อ)"}
            {ad.ad_id && <BarChart3 size={13} className="text-slate-400" />}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Ad ID: {ad.ad_id || "-"}{ad.adset_id ? ` · Ad set: ${ad.adset_id}` : ""} · งบ/วัน {fmtNum(ad.daily_budget_thb)} บาท
          </div>
        </div>
        <div className="flex items-start gap-2 shrink-0">
          {ad.ad_id && onToggleCompare && (
            <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer" onClick={stop}>
              <input type="checkbox" checked={!!compareChecked} onChange={() => onToggleCompare(ad)} className="w-3.5 h-3.5" />
              เทียบ
            </label>
          )}
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={ad.status} />
            <VerdictBadge verdict={verdict} />
          </div>
        </div>
      </div>

      {latestMetric ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">วันนี้</span>
          <span>Spend: <b className="text-slate-800">{fmtNum(spend)}</b></span>
          <span>Leads: <b className="text-slate-800">{fmtNum(leads)}</b></span>
          <span>CPA: <b className="text-slate-800">{cpa ? fmtNum(cpa) : "-"}</b></span>
          {latestMetric.ctr != null && <span>CTR: {fmtNum(latestMetric.ctr, 2)}%</span>}
          {latestMetric.cpm != null && <span>CPM: {fmtNum(latestMetric.cpm)}</span>}
        </div>
      ) : (
        <div className="text-xs text-slate-400">ยังไม่มีข้อมูลผล — รอรอบวิเคราะห์อัตโนมัติ หรือกด "วิเคราะห์ตอนนี้"</div>
      )}

      {hasChat && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>แชทเริ่ม: <b className="text-slate-800">{fmtNum(ad.conversations)}</b></span>
          <span>ตอบกลับจริง: <b className="text-slate-800">{fmtNum(ad.replies)}</b></span>
          <span className={ad.reply_rate != null && ad.reply_rate < 0.4 ? "text-rose-600" : ""}>
            อัตราตอบ: <b>{ad.reply_rate != null ? Math.min(100, Math.round(ad.reply_rate * 100)) + "%" : "-"}</b>
          </span>
        </div>
      )}

      <div onClick={stop}>
        <GhostAlert item={ad} onChanged={onChanged} />
      </div>

      {ad.scale_suggested && (
        <div className="text-xs text-blue-700 bg-blue-50 rounded-lg px-2.5 py-1.5">
          ระบบเสนอเพิ่มงบเป็น {fmtNum(ad.suggested_budget_thb)} บาท/วัน (รออนุมัติในหน้าแคมเปญ)
        </div>
      )}

      {(ai?.result_th || ai?.recommendation_th) && (
        <div className="space-y-1.5 pt-1">
          {ai.result_th && (
            <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-slate-400">ผลเป็นยังไง · </span>
              {ai.result_th}
            </div>
          )}
          {ai.recommendation_th && (
            <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-emerald-600">ควรทำต่อ · </span>
              {ai.recommendation_th}
            </div>
          )}
        </div>
      )}

      {history && history.length > 0 && (
        <details className="text-xs" onClick={stop}>
          <summary className="cursor-pointer text-slate-400 hover:text-slate-600">ดูประวัติผล ({history.length})</summary>
          <div className="mt-1.5 space-y-0.5">
            {history.slice(0, 8).map((h) => (
              <div key={h.id} className="flex justify-between text-slate-500 border-b border-slate-100 py-0.5">
                <span>{new Date(h.checked_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span>Spend {fmtNum(h.spend)} · Leads {fmtNum(h.leads)} · CPA {h.cpa ? fmtNum(h.cpa) : "-"}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ปุ่มอนุมัติการเปลี่ยนแปลงทีละรายการ (แตะบัญชีจริงเมื่อกดเท่านั้น)
function ApplyChangeButton({ change, onDone, label, tone = "slate" }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const tones = {
    slate: "bg-brand-600 text-white hover:bg-brand-700",
    rose: "bg-rose-600 text-white hover:bg-rose-700",
    emerald: "bg-emerald-600 text-white hover:bg-emerald-700",
    blue: "bg-blue-600 text-white hover:bg-blue-700",
  };
  async function apply() {
    setBusy(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("apply-ad-change", { body: change });
    setBusy(false);
    if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
    if (!data?.ok) { setError(data?.error || "ไม่สำเร็จ"); return; }
    setDone(true);
    logActivity("apply_change", { action: change?.action, target_type: change?.target_type, target_id: change?.target_id, name: label });
    onDone?.();
  }
  if (done) return <span className="text-xs text-emerald-700">✓ ทำแล้ว</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={apply} disabled={busy} className={`text-xs rounded-lg px-3 py-1.5 font-medium disabled:opacity-60 flex items-center gap-1.5 ${tones[tone]}`}>
        {busy ? <Loader2 className="animate-spin" size={13} /> : null}
        {label || "อนุมัติ"}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </span>
  );
}

const CHANGE_LABEL = { pause: "หยุด", resume: "เปิด", set_budget: "ตั้งงบ", exclude_audience_network: "ตัด Audience Network" };

function MetaBrowsePanel({ settings, restricted = false, allowedAccounts = [] }) {
  // จำสถานะไว้ใน localStorage เพื่อไม่ให้รีเฟรชแล้วต้องเลือกบัญชี/แคมเปญ/เปิดแดชบอร์ดใหม่ทุกครั้ง
  const [open, setOpen] = useState(() => lsGet("meta.open", false));
  const [accounts, setAccounts] = useState(null);
  const [acctDebug, setAcctDebug] = useState(null);
  const [loadingAcc, setLoadingAcc] = useState(false);
  const [account, setAccount] = useState(() => lsGet("meta.account", ""));
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCamp, setLoadingCamp] = useState(false);
  const [campMeta, setCampMeta] = useState(null);   // { cached, fetched_at } ของรายการแคมเปญ
  const [selected, setSelected] = useState(() => lsGet("meta.selected", [])); // campaign ids
  const [textModel, setTextModel] = useState(settings.ai_models?.analyze_ads || "openai");
  const [range, setRange] = useState({ preset: "today", since: "", until: "" });   // ล็อกเป็น "วันนี้" — ซ่อน picker
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(() => lsGet("meta.result", null));
  const [error, setError] = useState("");
  const [dashItem, setDashItem] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [showOverview, setShowOverview] = useState(() => lsGet("meta.showOverview", false));
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const close = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [accountMenuOpen]);

  async function loadAccounts(refresh = false) {
    setOpen(true);
    if (accounts && !refresh) return;
    setLoadingAcc(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("list-ad-accounts", { body: { refresh: refresh === true } });
    setLoadingAcc(false);
    if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
    if (!data?.ok) { setError(data?.error || "โหลดบัญชีไม่สำเร็จ"); return; }
    // analyze_only: กรองซ้ำฝั่งเว็บอีกชั้น (เผื่อ cache) ให้เห็นเฉพาะบัญชีที่อนุญาต
    const accs = data.accounts || [];
    const allow = (allowedAccounts || []).map((v) => String(v).replace(/^act_/, ""));
    setAccounts(restricted ? accs.filter((a) => allow.includes(String(a.account_id))) : accs);
    setAcctDebug(data.debug || null);
  }

  async function fetchCampaigns(id, force = false) {
    if (!id) return;
    setLoadingCamp(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("list-campaigns", { body: { ad_account_id: id, ...(force ? { refresh: true } : {}) } });
    setLoadingCamp(false);
    if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
    if (!data?.ok) { setError(data?.error || "โหลดแคมเปญไม่สำเร็จ"); return; }
    // เรียงแคมเปญที่ ACTIVE ขึ้นก่อน (คงลำดับเดิมภายในกลุ่ม)
    const camps = (data.campaigns || []).slice().sort((a, b) => (b.effective_status === "ACTIVE" ? 1 : 0) - (a.effective_status === "ACTIVE" ? 1 : 0));
    setCampaigns(camps);
    setCampMeta({ cached: !!data.cached, fetched_at: data.fetched_at || null });
  }

  async function pickAccount(id) {
    setAccount(id);
    setCampaigns([]);
    setSelected([]); // เปลี่ยนบัญชีเอง = ล้างการเลือกเดิม
    setResult(null);
    await fetchCampaigns(id);
  }

  // จำสถานะไว้ให้รีเฟรชแล้วยังอยู่ที่เดิม
  useEffect(() => { lsSet("meta.open", open); }, [open]);
  useEffect(() => { lsSet("meta.account", account); }, [account]);
  useEffect(() => { lsSet("meta.selected", selected); }, [selected]);
  useEffect(() => { lsSet("meta.range", range); }, [range]);
  useEffect(() => { lsSet("meta.result", result); }, [result]);
  useEffect(() => { lsSet("meta.showOverview", showOverview); }, [showOverview]);

  // ตอนโหลดหน้าใหม่: ถ้าเคยเปิดแผงและเลือกบัญชีไว้ ให้ดึงบัญชี+แคมเปญกลับมาเอง (ไม่ล้างการเลือกที่จำไว้)
  useEffect(() => {
    if (open) {
      loadAccounts();
      if (account) fetchCampaigns(account);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // ดึงรายงาน (ตัวเลขล้วน ยังไม่เรียก AI) แล้วเด้งเข้าหน้า overview เต็มจอ
  async function pullReport() {
    if (selected.length === 0) return;
    logActivity("pull_report", { campaigns: selected.length, account });
    setAnalyzing(true);
    setError("");
    setResult(null);
    const { data, error: fnError } = await supabase.functions.invoke("analyze-campaigns", {
      body: { campaign_ids: selected, ...rangeToBody(range), use_ai: false },
    });
    setAnalyzing(false);
    if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
    if (!data?.ok) { setError(data?.error || "ดึงรายงานไม่สำเร็จ"); return; }
    // รายงานชุดใหม่ = ล้างสถานะ drill-down/แดชบอร์ดเก่าที่จำไว้
    lsSet("ov.dashItem", null);
    lsSet("ov.expandedCamps", {});
    setResult(data);
    setShowOverview(true);
  }

  const selectedCampaignObjs = campaigns.filter((c) => selected.includes(c.id));
  const compareItems = selectedCampaignObjs.map((c) => ({ ad_id: c.id, headline: c.name }));
  const sortedAccountGroups = (() => {
    const byName = (a, b) => String(a.business || "อื่นๆ").localeCompare(String(b.business || "อื่นๆ"), "th")
      || String(a.name || "").localeCompare(String(b.name || ""), "th");
    const visible = accounts || [];
    return [
      { key: "active", label: "บัญชีที่ใช้งานอยู่", tone: "#16a34a", rows: visible.filter((a) => Number(a.status) === 1).sort(byName) },
      { key: "inactive", label: "บัญชีที่ปิด/ยังไม่พร้อมใช้งาน", tone: "#dc2626", rows: visible.filter((a) => Number(a.status) !== 1).sort(byName) },
    ];
  })();
  const selectedAccount = (accounts || []).find((a) => String(a.account_id) === String(account));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      {dashItem && <AdDashboardModal ad={dashItem} ai={null} onClose={() => setDashItem(null)} onNavigate={setDashItem} />}
      {showCompare && <CompareView items={compareItems} onClose={() => setShowCompare(false)} aiModel={textModel} />}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-800">ดึงจากบัญชี Meta ทั้งหมด</h3>
          <p className="text-xs text-slate-500 mt-0.5">เลือกบัญชีโฆษณาที่เข้าถึงได้ แล้วเลือกแคมเปญเพื่อวิเคราะห์/เปรียบเทียบ/ดูแดชบอร์ด</p>
        </div>
        {!open && (
          <button onClick={() => loadAccounts()} className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brand-700 shrink-0">
            เปิด
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-600">บัญชีโฆษณา {accounts ? `(${accounts.length})` : ""}</label>
              <div ref={accountMenuRef} className="relative mt-1">
                <button
                  type="button"
                  disabled={loadingAcc}
                  onClick={() => setAccountMenuOpen((v) => !v)}
                  className="w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm flex items-center justify-between gap-2 disabled:opacity-60"
                  aria-haspopup="listbox"
                  aria-expanded={accountMenuOpen}
                >
                  <span className="min-w-0 truncate text-slate-700">
                    {loadingAcc ? "กำลังโหลด..." : selectedAccount ? (
                      <>{selectedAccount.business || "อื่นๆ"} — {selectedAccount.name} ({selectedAccount.account_id}) · <span className={Number(selectedAccount.status) === 1 ? "meta-status-active" : "meta-status-inactive"}>{selectedAccount.status_label}</span></>
                    ) : "— เลือกบัญชี —"}
                  </span>
                  <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${accountMenuOpen ? "rotate-180" : ""}`} />
                </button>
                {accountMenuOpen && !loadingAcc && (
                  <div role="listbox" className="meta-account-menu absolute z-50 mt-1 max-h-[min(70vh,32rem)] w-full min-w-[20rem] overflow-y-auto rounded-xl border p-1.5 shadow-2xl sm:min-w-[34rem]">
                    {sortedAccountGroups.filter((group) => group.rows.length > 0).map((group) => (
                      <div key={group.key} className="mb-1 last:mb-0">
                        <div className="meta-account-heading sticky top-0 z-10 rounded-md px-2.5 py-1.5 text-xs font-semibold">
                          {group.label} ({group.rows.length})
                        </div>
                        {group.rows.map((a) => {
                          const active = Number(a.status) === 1;
                          const chosen = String(a.account_id) === String(account);
                          return (
                            <button
                              type="button"
                              role="option"
                              aria-selected={chosen}
                              key={a.account_id}
                              onClick={() => { setAccountMenuOpen(false); pickAccount(a.account_id); }}
                              className={`meta-account-option flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${chosen ? "is-selected" : ""}`}
                            >
                              <span className="w-4 shrink-0">{chosen ? "✓" : ""}</span>
                              <span className="break-words">{a.business || "อื่นๆ"} — {a.name} ({a.account_id}) · <span className={active ? "meta-status-active" : "meta-status-inactive"}>{a.status_label}</span></span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {acctDebug && (
                <div className="mt-1.5 text-[11px] text-slate-400 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span>เจอ {accounts?.length || 0} บัญชี{acctDebug.enumerated ? " · ไล่รายธุรกิจแล้ว" : ""}</span>
                    <button onClick={() => loadAccounts(true)} className="text-slate-500 hover:text-slate-700 underline">รีเฟรช</button>
                  </div>
                  {acctDebug.rate_limited && (
                    <div className="text-amber-600">⚠ Meta จำกัดจำนวนคำขอชั่วคราว (rate limit) — รอสัก 1-2 นาทีแล้วกดรีเฟรช อาจเห็นบัญชียังไม่ครบ</div>
                  )}
                  {acctDebug.direct_error && <div className="text-rose-500">{acctDebug.direct_error}</div>}
                </div>
              )}
            </div>
          </div>

          {campMeta && campaigns.length > 0 && (
            <div className={`flex items-center justify-between gap-2 flex-wrap rounded-lg border px-3 py-2 text-xs ${campMeta.cached ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
              <span>{campMeta.cached ? "🗂️ รายชื่อแคมเปญจากแคช" : "🟢 รายชื่อแคมเปญสด"} · ดึงเมื่อ {campMeta.fetched_at ? new Date(campMeta.fetched_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-"}{campMeta.cached ? " · กดรีเฟรชเพื่อดึงสด" : ""}</span>
              <button onClick={() => fetchCampaigns(account, true)} disabled={loadingCamp} className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-300 text-slate-700 px-2.5 py-1 font-medium hover:bg-slate-50 disabled:opacity-50 shrink-0"><RefreshCw size={12} className={loadingCamp ? "animate-spin" : ""} /> รีเฟรชแคมเปญ</button>
            </div>
          )}
          {loadingCamp ? (
            <Spinner label="กำลังโหลดแคมเปญ..." />
          ) : campaigns.length > 0 ? (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 text-xs text-slate-500">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.length === campaigns.length && campaigns.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? campaigns.map((c) => c.id) : [])}
                  />
                  เลือกทั้งหมด ({campaigns.length})
                </label>
                <span>เลือกแล้ว {selected.length}</span>
              </div>
              {campaigns.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="flex-1 min-w-0 truncate text-slate-700">{c.name}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${c.effective_status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.effective_status}</span>
                </label>
              ))}
            </div>
          ) : account ? (
            <div className="text-sm text-slate-400 py-4 text-center">บัญชีนี้ยังไม่มีแคมเปญ</div>
          ) : null}

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button onClick={pullReport} disabled={analyzing} className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2">
                {analyzing ? <Loader2 className="animate-spin" size={16} /> : <BarChart3 size={16} />}
                ดึงรายงาน ({selected.length})
              </button>
              {!restricted && selected.length >= 2 && (
                <button onClick={() => setShowCompare(true)} className="border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
                  <GitCompare size={16} /> เปรียบเทียบ
                </button>
              )}
              {result && (
                <button onClick={() => setShowOverview(true)} className="border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
                  <BarChart3 size={16} /> ดูรายงานล่าสุด
                </button>
              )}
            </div>
          )}

          {showOverview && result && (
            <CampaignOverviewView
              initialResult={result}
              campaignIds={selected}
              range={range}
              textModel={textModel}
              restricted={restricted}
              onClose={() => { setShowOverview(false); lsSet("ov.dashItem", null); lsSet("ov.expandedCamps", {}); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// หน้า overview เต็มจอของแคมเปญที่เลือก — ตัวเลขล้วนก่อน แล้วมีปุ่ม "AI วิเคราะห์" ในหน้านี้
function CampaignOverviewView({ initialResult, campaignIds, range, textModel, onClose, restricted = false }) {
  const [result, setResult] = useState(initialResult);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [dashItem, setDashItem] = useState(() => lsGet("ov.dashItem", null));
  const [expandedCamps, setExpandedCamps] = useState(() => lsGet("ov.expandedCamps", {}));
  const toggleCamp = (id) => setExpandedCamps((prev) => ({ ...prev, [id]: !prev[id] }));
  useEffect(() => { lsSet("ov.dashItem", dashItem); }, [dashItem]);
  useEffect(() => { lsSet("ov.expandedCamps", expandedCamps); }, [expandedCamps]);

  async function runAI() {
    setAiBusy(true);
    setAiError("");
    const { data, error } = await supabase.functions.invoke("analyze-campaigns", {
      body: { campaign_ids: campaignIds, ...rangeToBody(range), text_model: textModel, use_ai: true },
    });
    setAiBusy(false);
    if (error) { setAiError(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setAiError(data?.error || "วิเคราะห์ไม่สำเร็จ"); return; }
    setResult(data);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto">
      {dashItem && <AdDashboardModal ad={dashItem} ai={null} onClose={() => setDashItem(null)} onNavigate={setDashItem} />}
      <div className="safe-top sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="w-full px-4 sm:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm shrink-0">
              <ArrowLeft size={18} /> กลับ
            </button>
            <HomeButton />
            <div className="font-semibold text-slate-800 truncate">รายงานแคมเปญ ({result.campaigns.length}) · {rangeLabel(range)}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:justify-end">
            <button onClick={runAI} disabled={aiBusy} className="text-xs bg-brand-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-1.5">
              {aiBusy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} AI วิเคราะห์
            </button>
            <button onClick={() => exportCampaignAnalysisPdf(result)} className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
              <FileDown size={14} /> Export PDF
            </button>
          </div>
        </div>
      </div>

      <div className="w-full p-4 sm:p-6 space-y-3">
        {aiError && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{aiError}</div>}
        {result.ai === "failed" && <div className="text-xs text-amber-600">คำวิเคราะห์ AI ไม่สำเร็จ (แสดงเฉพาะตัวเลข)</div>}
        {result.campaigns.map((c) => (
          <div key={c.campaign_id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => toggleCamp(c.campaign_id)} className="min-w-0 flex items-start gap-2 text-left group">
                <span className="text-slate-600 group-hover:text-slate-900 mt-0.5 shrink-0">
                  {expandedCamps[c.campaign_id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-slate-800 text-sm truncate group-hover:underline">{c.name}</span>
                  <span className="block text-[11px] text-slate-400">{c.objective} · {c.effective_status} · แตะเพื่อดูชุดโฆษณา</span>
                </span>
              </button>
              <button onClick={() => setDashItem({ ad_id: c.campaign_id, headline: c.name, level: "campaign" })} className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 text-slate-600 hover:bg-slate-50 flex items-center gap-1 shrink-0">
                <BarChart3 size={13} /> แดชบอร์ด
              </button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>Spend: <b>{fmtNum(c.metrics.spend)}฿</b></span>
              <span>Leads: <b>{fmtNum(c.metrics.leads)}</b></span>
              <span>CPL: <b>{c.metrics.cpl ? fmtNum(c.metrics.cpl) + "฿" : "—"}</b></span>
              <span>CTR: {fmtNum(c.metrics.ctr, 2)}%</span>
              <span>CPM: {fmtNum(c.metrics.cpm)}฿</span>
              <span>คลิก: {fmtNum(c.metrics.clicks)}</span>
              {c.metrics.reply_rate != null && <span className={c.metrics.reply_rate < 0.4 ? "text-rose-600" : ""}>อัตราตอบ: {Math.min(100, Math.round(c.metrics.reply_rate * 100))}%</span>}
            </div>
            {c.result_th && <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-2.5 py-1.5">{c.result_th}</div>}
            {c.recommendation_th && <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-2.5 py-1.5">แนะนำ: {c.recommendation_th}</div>}

            {!restricted && (c.recommended_changes || []).length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-medium text-slate-400">สิ่งที่ AI แนะนำให้ปรับ (กดอนุมัติทีละรายการ)</div>
                {c.recommended_changes.map((ch, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-2.5 py-1.5">
                    <div className="text-xs text-slate-600 min-w-0">
                      <span className="font-medium text-slate-800">{ch.label_th || CHANGE_LABEL[ch.action] || ch.action}</span>
                      {ch.reason_th ? ` — ${ch.reason_th}` : ""}
                    </div>
                    <ApplyChangeButton
                      change={{ action: ch.action, target_type: ch.target_type, target_id: ch.target_id, value: ch.value }}
                      tone={ch.action === "pause" ? "rose" : ch.action === "resume" ? "emerald" : "slate"}
                      label="อนุมัติ"
                    />
                  </div>
                ))}
              </div>
            )}

            {!restricted && (
              <div className="flex gap-2 pt-1">
                {c.effective_status === "ACTIVE" ? (
                  <ApplyChangeButton change={{ action: "pause", target_type: "campaign", target_id: c.campaign_id }} tone="rose" label="หยุดแคมเปญนี้" />
                ) : (
                  <ApplyChangeButton change={{ action: "resume", target_type: "campaign", target_id: c.campaign_id }} tone="emerald" label="เปิดแคมเปญนี้" />
                )}
              </div>
            )}

            {expandedCamps[c.campaign_id] && (
              <div className="pt-2 mt-1 border-t border-slate-100">
                <div className="text-[11px] font-medium text-slate-400 mb-2">ชุดโฆษณาในแคมเปญนี้ (แตะชุดเพื่อดูโฆษณา · ปุ่มแดชบอร์ดดูผลรายชิ้น)</div>
                <ChildrenList parentId={c.campaign_id} level="adsets" range={range} onDash={setDashItem} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function exportCampaignAnalysisPdf(result) {
  const esc = escHtml;
  const cards = (result.campaigns || [])
    .map((c) => {
      const m = c.metrics || {};
      const changes = (c.recommended_changes || []).map((ch) => `<li>${esc(ch.label_th || ch.action)}${ch.reason_th ? " — " + esc(ch.reason_th) : ""}</li>`).join("");
      return `<div class="c"><h2>${esc(c.name)}</h2>
        <div class="meta">${esc(c.objective || "")} · ${esc(c.effective_status || "")}</div>
        <table><tr><th>Spend</th><td>${esc(Math.round(m.spend || 0).toLocaleString())}฿</td><th>Leads</th><td>${esc(Math.round(m.leads || 0).toLocaleString())}</td></tr>
        <tr><th>CPL</th><td>${m.cpl ? Math.round(m.cpl).toLocaleString() + "฿" : "—"}</td><th>CTR</th><td>${esc((m.ctr || 0).toFixed(2))}%</td></tr></table>
        ${c.result_th ? `<p><b>ผล:</b> ${esc(c.result_th)}</p>` : ""}
        ${c.recommendation_th ? `<p><b>แนะนำ:</b> ${esc(c.recommendation_th)}</p>` : ""}
        ${changes ? `<p><b>สิ่งที่ควรปรับ:</b></p><ul>${changes}</ul>` : ""}</div>`;
    })
    .join("");
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>วิเคราะห์แคมเปญ</title>
<style>body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:24px;line-height:1.5}
h1{font-size:18px}h2{font-size:14px;margin:4px 0}.meta{color:#64748b;font-size:12px}
.c{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:10px 0;break-inside:avoid}
table{border-collapse:collapse;font-size:12px;margin:6px 0}th,td{border:1px solid #e2e8f0;padding:4px 8px;text-align:left}
ul{margin:4px 0 0 18px;font-size:12.5px}p{font-size:12.5px;margin:4px 0}@page{margin:14mm}</style></head><body>${exportPageNavHtml("campaigns")}
<h1>ผลวิเคราะห์แคมเปญ (${(result.campaigns || []).length} รายการ)</h1>
<div class="meta">อัปเดต ${esc(new Date(result.generated_at || Date.now()).toLocaleString("th-TH"))}</div>
${cards}
<script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่"); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function AnalyzeTab({ adContent, metricsHistoryByAd, settings, onChanged, restricted = false, allowedAccounts = [] }) {
  const [textModel, setTextModel] = useState(settings.ai_models?.analyze_ads || "openai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [compareSet, setCompareSet] = useState([]); // [{ad_id, headline}]
  const [showCompare, setShowCompare] = useState(false);

  function toggleCompare(ad) {
    setCompareSet((prev) =>
      prev.some((x) => x.ad_id === ad.ad_id)
        ? prev.filter((x) => x.ad_id !== ad.ad_id)
        : [...prev, { ad_id: ad.ad_id, headline: ad.headline || ad.ad_id }]
    );
  }

  const arch = useArchive(onChanged);
  // แยกรายการที่ถูกซ่อน — ใช้ธงเดียวกับหน้าแคมเปญ (ซ่อนที่หนึ่ง = ซ่อนทั้งสองหน้า)
  const archivedAll = adContent.filter((a) => a.archived_at);
  const pool = adContent.filter((a) => (arch.showArchived ? a.archived_at : !a.archived_at));

  const launched = pool.filter((a) => a.status === "active" || a.status === "paused_auto");
  const saved = settings.ads_analysis || null;
  const intervalMin = settings.optimization_thresholds?.monitor_interval_minutes;

  // ผล AI ที่บันทึกไว้ล่าสุด — จับคู่ตาม id แอด / campaign_id
  const aiByAd = {};
  const aiByCampaign = {};
  (saved?.campaigns || []).forEach((c) => {
    aiByCampaign[c.campaign_id] = c;
    (c.ads || []).forEach((a) => (aiByAd[a.id] = a));
  });

  // จัดกลุ่มแอดที่ลอนช์แล้วตามแคมเปญ
  const groups = {};
  launched.forEach((ad) => {
    const key = ad.campaign_id || "ungrouped";
    (groups[key] = groups[key] || { campaign_id: key, launch_mode: ad.launch_mode, ads: [] }).ads.push(ad);
  });
  const campaignGroups = Object.values(groups);

  async function handleAnalyzeNow() {
    setBusy(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("analyze-ads", {
      body: { text_model: textModel },
    });
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      setBusy(false);
      return;
    }
    if (!data?.ok) {
      setError(data?.error || "วิเคราะห์ไม่สำเร็จ");
      setBusy(false);
      return;
    }
    await onChanged?.(); // โหลดผล + metric ล่าสุดกลับมาแสดง
    setBusy(false);
  }

  return (
    <div className="w-full max-w-[1600px] space-y-5">
      <SectionTitle
        title="วิเคราะห์"
        subtitle="ดูผลโฆษณาจริงจาก Meta เทียบแคมเปญ และให้ AI สรุปว่าอะไรควรหยุดหรือขยายงบ"
      />
      <MetaBrowsePanel settings={settings} restricted={restricted} allowedAccounts={allowedAccounts} />

      {false && !restricted && (<>   {/* ซ่อนส่วน "วิเคราะห์ผลโฆษณา" ออกจากหน้านี้ทั้งหมด */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-800">วิเคราะห์ผลโฆษณา</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              ระบบวิเคราะห์อัตโนมัติ{intervalMin ? `ทุก ~${intervalMin} นาที` : "ตามรอบที่ตั้งไว้"} (auto-pause แอดที่ผลต่ำกว่าเป้า และเสนอเพิ่มงบแอดที่ผลดี)
              — หรือกด "วิเคราะห์ตอนนี้" เพื่อดึงผลสดจาก Meta พร้อมคำวิเคราะห์จาก AI ทันที
            </p>
            {saved?.generated_at && (
              <p className="text-[11px] text-slate-400 mt-1">
                วิเคราะห์ล่าสุด {new Date(saved.generated_at).toLocaleString("th-TH")}
                {saved.source === "db" ? " · ใช้ข้อมูลที่บันทึกไว้ (ดึงสดจาก Meta ไม่ได้)" : saved.source === "meta" ? " · ดึงสดจาก Meta" : ""}
                {saved.ai === "failed" ? " · คำวิเคราะห์ AI ไม่สำเร็จรอบล่าสุด" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white"
              value={textModel}
              onChange={(e) => setTextModel(e.target.value)}
              disabled={busy}
            >
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
            <button
              onClick={handleAnalyzeNow}
              disabled={busy || launched.length === 0}
              className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <BarChart3 size={16} />}
              {busy ? "กำลังวิเคราะห์..." : "วิเคราะห์ตอนนี้"}
            </button>
          </div>
        </div>
        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-3">{error}</div>}
      </div>

      {/* ติ๊กเลือกแอดแล้วกดล้าง = ซ่อนออกจากรายการ (ข้อมูล/ประวัติผลยังอยู่ กู้คืนได้) */}
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-2.5 shadow-sm">
        <ArchiveBar a={arch} visibleIds={launched.map((a) => a.id)} archivedCount={archivedAll.length} />
      </div>

      {launched.length === 0 ? (
        <div className="text-sm text-slate-500 py-10 text-center">
          {arch.showArchived ? "ไม่มีรายการที่ซ่อนไว้" : "ยังไม่มีแอดที่ลอนช์แล้วให้วิเคราะห์"}
        </div>
      ) : (
        campaignGroups.map((g) => {
          const totals = g.ads.reduce(
            (acc, ad) => {
              const m = metricsHistoryByAd[ad.id]?.[0];
              acc.spend += m?.spend || 0;
              acc.leads += m?.leads || 0;
              return acc;
            },
            { spend: 0, leads: 0 }
          );
          const blendedCpa = totals.leads > 0 ? totals.spend / totals.leads : null;
          const campAi = aiByCampaign[g.campaign_id];
          const isMulti = g.launch_mode === "single_campaign_multi_ad" || g.ads.length > 1;

          return (
            <div key={g.campaign_id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-800 flex items-center gap-2">
                    {isMulti ? "แคมเปญ (หลายโฆษณา)" : "แคมเปญ"}
                    <span className="text-xs font-normal text-slate-400">{g.ads.length} โฆษณา</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Campaign ID: {g.campaign_id === "ungrouped" ? "ไม่ได้ระบุ" : g.campaign_id}
                  </div>
                </div>
                <div className="text-xs text-slate-600 text-right">
                  <div>รวม Spend <b className="text-slate-800">{fmtNum(totals.spend)}</b> · Leads <b className="text-slate-800">{fmtNum(totals.leads)}</b></div>
                  <div>CPA เฉลี่ย <b className="text-slate-800">{blendedCpa ? fmtNum(blendedCpa) : "-"}</b> บาท</div>
                </div>
              </div>

              {(campAi?.summary_th || campAi?.recommendation_th) && (
                <div className="space-y-1.5">
                  {campAi.summary_th && (
                    <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{campAi.summary_th}</div>
                  )}
                  {campAi.recommendation_th && (
                    <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2 flex gap-1.5">
                      <AlertTriangle size={15} className="shrink-0 mt-0.5 text-emerald-600" />
                      <span>{campAi.recommendation_th}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {g.ads.map((ad) => (
                  <div key={ad.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={arch.isSel(ad.id)}
                      onChange={() => arch.toggle(ad.id)}
                      className="w-4 h-4 mt-4 shrink-0 cursor-pointer"
                      title={arch.showArchived ? "เลือกเพื่อกู้คืน" : "เลือกเพื่อซ่อนออกจากรายการ"}
                    />
                    <div className="flex-1 min-w-0">
                      <AdAnalysisCard
                        ad={ad}
                        latestMetric={metricsHistoryByAd[ad.id]?.[0]}
                        history={metricsHistoryByAd[ad.id]}
                        ai={aiByAd[ad.id]}
                        onChanged={onChanged}
                        compareChecked={compareSet.some((x) => x.ad_id === ad.ad_id)}
                        onToggleCompare={toggleCompare}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* แถบเปรียบเทียบลอยด้านล่างเมื่อเลือก >= 2 */}
      {compareSet.length >= 2 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-brand-600 text-white rounded-full shadow-lg px-4 py-2.5 flex items-center gap-3">
          <span className="text-sm">เลือกเปรียบเทียบ {compareSet.length} รายการ</span>
          <button onClick={() => setShowCompare(true)} className="bg-white text-slate-900 rounded-full px-3 py-1 text-xs font-medium flex items-center gap-1.5">
            <GitCompare size={14} /> เปรียบเทียบ
          </button>
          <button onClick={() => setCompareSet([])} className="text-slate-500 hover:text-slate-800 text-xs">ล้าง</button>
        </div>
      )}
      {showCompare && <CompareView items={compareSet} onClose={() => setShowCompare(false)} aiModel={textModel} />}
      </>)}
    </div>
  );
}

// ---------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------
// แสดงค่าเป็นแถว label/value — ข้ามอัตโนมัติถ้าไม่มีค่า
function ReportRow({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <div className="col-span-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="col-span-2 text-sm text-slate-700 whitespace-pre-line">{value}</div>
    </div>
  );
}

function ReportChips({ label, items, tone = "slate" }) {
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return null;
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    rose: "bg-rose-100 text-rose-700",
  };
  return (
    <div className="py-1.5 border-b border-slate-100 last:border-0">
      <div className="text-xs font-medium text-slate-500 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {list.map((it, i) => (
          <span key={i} className={`text-xs px-2 py-1 rounded-full ${tones[tone]}`}>{it}</span>
        ))}
      </div>
    </div>
  );
}

function ReportSection({ title, children }) {
  return (
    <details open className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer select-none px-4 py-2.5 font-semibold text-slate-800 text-sm">{title}</summary>
      <div className="px-4 pb-3 pt-1">{children}</div>
    </details>
  );
}

// รายงานวิเคราะห์แบบละเอียด (playbook) จาก AI
function AnalysisReport({ analysis }) {
  if (!analysis) return null;
  const recs = analysis.campaign_recommendations || [];
  const cl = analysis.campaign_level || {};
  const as = analysis.adset_level || {};
  const ad = analysis.ad_level || {};
  const dt = as.detailed_targeting || {};

  return (
    <div className="space-y-3">
      {analysis.summary && (
        <div className="text-sm text-slate-700 bg-slate-50 rounded-xl px-4 py-3 whitespace-pre-line">
          {analysis.summary}
        </div>
      )}

      {recs.length > 0 && (
        <ReportSection title="แนะนำประเภทแคมเปญ (เรียงตามลำดับแนะนำ)">
          <div className="space-y-2.5">
            {recs.map((r, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-semibold">
                    {r.rank ?? i + 1}
                  </span>
                  <span className="font-medium text-slate-800 text-sm">{r.objective_th || r.meta_objective}</span>
                  {r.meta_objective && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">{r.meta_objective}</span>
                  )}
                </div>
                <div className="space-y-1">
                  <ReportRow label="จุดเก็บ Conversion" value={r.conversion_location_th} />
                  <ReportRow label="ทำไมแนะนำ" value={r.why} />
                  <ReportRow label="เหมาะกับ" value={r.best_for} />
                  <ReportRow label="ข้อควรระวัง" value={r.watchouts} />
                </div>
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {Object.keys(cl).length > 0 && (
        <ReportSection title="ตั้งค่าระดับแคมเปญ (Campaign)">
          <ReportRow label="วัตถุประสงค์" value={cl.recommended_objective_th} />
          <ReportRow label="ประเภทการซื้อ" value={cl.buying_type_th} />
          <ReportRow label="หมวดโฆษณาพิเศษ" value={cl.special_ad_category_th} />
          <ReportRow label="การตั้งงบ" value={cl.budget_type_th} />
          <ReportRow label="งบ/วัน (บาท)" value={cl.recommended_daily_budget_thb} />
          <ReportRow label="กลยุทธ์บิด" value={cl.bid_strategy_th} />
          <ReportRow label="A/B Test" value={cl.ab_test_th} />
          <ReportRow label="หมายเหตุ" value={cl.notes} />
        </ReportSection>
      )}

      {Object.keys(as).length > 0 && (
        <ReportSection title="ตั้งค่าระดับชุดโฆษณา (Ad set)">
          <ReportRow label="ปรับให้เหมาะกับ" value={as.optimization_event_th} />
          <ReportRow label="ที่ตั้ง Conversion" value={as.conversion_location_th} />
          <ReportRow label="Advantage+ Audience" value={as.advantage_audience_th} />
          <ReportRow label="ขยายกลุ่มอัตโนมัติ" value={as.advantage_detailed_targeting_expansion_th} />
          <ReportChips label="ความสนใจ (Interests)" items={dt.interests} tone="green" />
          <ReportChips label="พฤติกรรม (Behaviors)" items={dt.behaviors} tone="green" />
          <ReportRow label="วิธีจัดกลุ่มเป้าหมาย" value={dt.notes} />
          <ReportRow label="อายุ" value={as.age_th} />
          <ReportRow label="เพศ" value={as.gender_th} />
          <ReportRow label="พื้นที่" value={as.locations_th} />
          <ReportRow label="ภาษา" value={as.languages_th} />
          <ReportRow label="ตำแหน่งจัดวาง (Placements)" value={as.placements_recommendation_th} />
          <ReportChips label="ตำแหน่งที่แนะนำ" items={as.recommended_placements} tone="green" />
          <ReportChips label="ตำแหน่งที่ควรเลี่ยง" items={as.placements_to_avoid} tone="rose" />
          <ReportRow label="การตั้งเวลา" value={as.schedule_th} />
          <ReportRow label="Attribution" value={as.attribution_setting_th} />
          <ReportRow label="หมายเหตุ" value={as.notes} />
        </ReportSection>
      )}

      {Object.keys(ad).length > 0 && (
        <ReportSection title="ตั้งค่าระดับโฆษณา (Ad)">
          <ReportRow label="รูปแบบโฆษณา" value={ad.format_th} />
          <ReportRow label="Advantage+ Creative" value={ad.advantage_plus_creative_th} />
          <ReportRow label="ข้อความหลัก" value={ad.primary_text_tips_th} />
          <ReportRow label="พาดหัว" value={ad.headline_tips_th} />
          <ReportRow label="คำอธิบาย" value={ad.description_tips_th} />
          <ReportRow label="ปุ่ม CTA" value={ad.cta_button_th} />
          <ReportRow label="ปลายทาง" value={ad.destination_th} />
          <ReportRow label="เคล็ดลับครีเอทีฟ" value={ad.creative_tips_th} />
          <ReportRow label="นโยบายโฆษณา" value={ad.compliance_th} />
          <ReportRow label="หมายเหตุ" value={ad.notes} />
        </ReportSection>
      )}

      {(analysis.testing_plan_th || analysis.kpis_th) && (
        <ReportSection title="แผนทดสอบ & ตัวชี้วัด (KPI)">
          <ReportRow label="แผนทดสอบ/สเกล" value={analysis.testing_plan_th} />
          <ReportRow label="KPI ที่ต้องจับตา" value={analysis.kpis_th} />
        </ReportSection>
      )}

      {analysis.generated_at && (
        <div className="text-[11px] text-slate-400">
          วิเคราะห์เมื่อ {new Date(analysis.generated_at).toLocaleString("th-TH")}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Export คำแนะนำ AI เป็น PDF (ผ่านหน้าพิมพ์ของเบราว์เซอร์ -> Save as PDF)
// ใช้วิธีนี้เพราะรองรับภาษาไทยได้สมบูรณ์และไม่ต้องเพิ่มไลบรารีภายนอก
// ---------------------------------------------------------------
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function buildAnalysisHtml(analysis) {
  const a = analysis || {};
  const cl = a.campaign_level || {};
  const as = a.adset_level || {};
  const ad = a.ad_level || {};
  const dt = as.detailed_targeting || {};
  const lc = a.launch_config || null;
  const pref = a.preferences || null;

  const CONV = { instant_form: "เก็บลีดผ่านฟอร์ม", messaging: "ทักแชท", website: "เว็บ/แลนดิ้ง", calls: "โทร" };
  const FMT = { image: "รูปภาพ", video: "วิดีโอ", mixed: "ผสมรูป+วิดีโอ", auto: "ให้ AI แนะนำ" };
  const LANG = { th: "ไทย", en: "อังกฤษ", th_en: "ไทย+อังกฤษ", other: "อื่นๆ", auto: "ให้ AI แนะนำ" };
  const STYLE = {
    auto: "ให้ AI แนะนำ",
    lead_form: "เก็บลีดผ่านฟอร์ม",
    chat: "ทักแชท",
    traffic: "ส่งเข้าเว็บ",
    conversions: "ปิดการขายบนเว็บ",
  };

  const rows = (pairs) =>
    pairs
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([l, v]) => `<tr><th>${escHtml(l)}</th><td>${escHtml(v)}</td></tr>`)
      .join("");

  const chips = (arr) =>
    (arr || []).filter(Boolean).map((x) => `<span class="chip">${escHtml(x)}</span>`).join(" ");

  const recsHtml = (a.campaign_recommendations || [])
    .map(
      (r, i) => `
      <div class="rec">
        <div class="rec-h"><span class="rank">${escHtml(r.rank ?? i + 1)}</span> ${escHtml(r.objective_th || r.meta_objective || "")} ${
        r.meta_objective ? `<code>${escHtml(r.meta_objective)}</code>` : ""
      }</div>
        <table>${rows([
          ["จุดเก็บ Conversion", r.conversion_location_th],
          ["ทำไมแนะนำ", r.why],
          ["เหมาะกับ", r.best_for],
          ["ข้อควรระวัง", r.watchouts],
        ])}</table>
      </div>`
    )
    .join("");

  const section = (title, inner) => (inner ? `<h2>${escHtml(title)}</h2>${inner}` : "");

  const prefHtml = pref
    ? `<table>${rows([
        ["สะดวกยิงแบบ", STYLE[pref.campaign_style] || pref.campaign_style],
        ["รูปแบบครีเอทีฟ", FMT[pref.creative_format] || pref.creative_format],
        ["ภาษา", LANG[pref.language] || pref.language],
      ])}</table>`
    : "";

  const lcHtml = lc
    ? `<table>${rows([
        ["ประเภทแคมเปญ", lc.objective ? `${lc.objective}${lc.conversion_location ? " · " + (CONV[lc.conversion_location] || lc.conversion_location) : ""}` : null],
        ["รูปแบบครีเอทีฟ", FMT[lc.creative_format] || lc.creative_format],
        ["ภาษา", LANG[lc.language] || lc.language],
        ["Advantage+ Audience", lc.advantage_audience === 1 ? "เปิด" : "ปิด"],
        ["ตำแหน่งจัดวาง", lc.placements?.mode === "manual" ? `กำหนดเอง${(lc.placements.publisher_platforms || []).length ? " · " + lc.placements.publisher_platforms.join(", ") : ""}` : "Advantage+ (อัตโนมัติ)"],
        ["กลยุทธ์บิด", lc.bid_strategy],
        ["Advantage+ Creative", lc.advantage_plus_creative ? "เปิด" : "ปิด"],
        ["ปุ่ม CTA เริ่มต้น", lc.default_cta],
        ["หมวดโฆษณาพิเศษ", Array.isArray(lc.special_ad_categories) && lc.special_ad_categories.length ? lc.special_ad_categories.join(", ") : "ไม่มี"],
      ])}</table>`
    : "";

  const generatedAt = a.generated_at ? new Date(a.generated_at).toLocaleString("th-TH") : new Date().toLocaleString("th-TH");

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>คำแนะนำ AI Ads</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun','Noto Sans Thai','Prompt',system-ui,-apple-system,'Segoe UI',sans-serif; color:#1e293b; margin:32px; line-height:1.55; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:15px; margin:22px 0 8px; padding-bottom:4px; border-bottom:2px solid #0f172a; }
  .meta { color:#64748b; font-size:12px; margin-bottom:4px; }
  .summary { background:#f1f5f9; border-radius:8px; padding:12px; font-size:13px; margin-top:10px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; margin:6px 0 4px; }
  th { text-align:left; width:34%; color:#64748b; font-weight:600; vertical-align:top; padding:5px 8px; border-bottom:1px solid #e2e8f0; }
  td { padding:5px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; white-space:pre-line; }
  .rec { border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin:8px 0; break-inside:avoid; }
  .rec-h { font-weight:600; margin-bottom:2px; }
  .rank { display:inline-block; width:20px; height:20px; line-height:20px; text-align:center; background:#0f172a; color:#fff; border-radius:50%; font-size:12px; margin-right:4px; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:11px; color:#475569; }
  .chip { display:inline-block; background:#e2e8f0; color:#334155; border-radius:999px; padding:2px 8px; font-size:11px; margin:1px 0; }
  h2, .rec, table { break-inside:avoid; }
  @page { margin:16mm; }
</style></head><body>${exportPageNavHtml("analyze")}
  <h1>คำแนะนำการยิงโฆษณา (AI Playbook)</h1>
  <div class="meta">สร้างเมื่อ ${escHtml(generatedAt)}</div>
  ${a.business_desc ? `<div class="meta">โจทย์: ${escHtml(a.business_desc)}</div>` : ""}
  ${a.summary ? `<div class="summary">${escHtml(a.summary)}</div>` : ""}
  ${section("ตัวเลือกที่เลือกไว้", prefHtml)}
  ${section("แนะนำประเภทแคมเปญ (เรียงตามลำดับ)", recsHtml)}
  ${section(
    "ตั้งค่าระดับแคมเปญ",
    rows([
      ["วัตถุประสงค์", cl.recommended_objective_th],
      ["ประเภทการซื้อ", cl.buying_type_th],
      ["หมวดโฆษณาพิเศษ", cl.special_ad_category_th],
      ["การตั้งงบ", cl.budget_type_th],
      ["งบ/วัน (บาท)", cl.recommended_daily_budget_thb],
      ["กลยุทธ์บิด", cl.bid_strategy_th],
      ["A/B Test", cl.ab_test_th],
      ["หมายเหตุ", cl.notes],
    ])
      ? `<table>${rows([
          ["วัตถุประสงค์", cl.recommended_objective_th],
          ["ประเภทการซื้อ", cl.buying_type_th],
          ["หมวดโฆษณาพิเศษ", cl.special_ad_category_th],
          ["การตั้งงบ", cl.budget_type_th],
          ["งบ/วัน (บาท)", cl.recommended_daily_budget_thb],
          ["กลยุทธ์บิด", cl.bid_strategy_th],
          ["A/B Test", cl.ab_test_th],
          ["หมายเหตุ", cl.notes],
        ])}</table>`
      : ""
  )}
  ${section(
    "ตั้งค่าระดับชุดโฆษณา (Ad set)",
    `<table>${rows([
      ["ปรับให้เหมาะกับ", as.optimization_event_th],
      ["ที่ตั้ง Conversion", as.conversion_location_th],
      ["Advantage+ Audience", as.advantage_audience_th],
      ["ขยายกลุ่มอัตโนมัติ", as.advantage_detailed_targeting_expansion_th],
      ["อายุ", as.age_th],
      ["เพศ", as.gender_th],
      ["พื้นที่", as.locations_th],
      ["ภาษา", as.languages_th],
      ["ตำแหน่งจัดวาง", as.placements_recommendation_th],
      ["การตั้งเวลา", as.schedule_th],
      ["Attribution", as.attribution_setting_th],
      ["หมายเหตุ", as.notes],
    ])}</table>
    ${dt.interests?.length ? `<div><b>ความสนใจ:</b> ${chips(dt.interests)}</div>` : ""}
    ${dt.behaviors?.length ? `<div><b>พฤติกรรม:</b> ${chips(dt.behaviors)}</div>` : ""}
    ${dt.notes ? `<div style="font-size:12.5px;margin-top:4px;">${escHtml(dt.notes)}</div>` : ""}
    ${as.recommended_placements?.length ? `<div style="margin-top:4px;"><b>ตำแหน่งที่แนะนำ:</b> ${chips(as.recommended_placements)}</div>` : ""}
    ${as.placements_to_avoid?.length ? `<div><b>ตำแหน่งที่ควรเลี่ยง:</b> ${chips(as.placements_to_avoid)}</div>` : ""}`
  )}
  ${section(
    "ตั้งค่าระดับโฆษณา (Ad)",
    `<table>${rows([
      ["รูปแบบโฆษณา", ad.format_th],
      ["Advantage+ Creative", ad.advantage_plus_creative_th],
      ["ข้อความหลัก", ad.primary_text_tips_th],
      ["พาดหัว", ad.headline_tips_th],
      ["คำอธิบาย", ad.description_tips_th],
      ["ปุ่ม CTA", ad.cta_button_th],
      ["ปลายทาง", ad.destination_th],
      ["เคล็ดลับครีเอทีฟ", ad.creative_tips_th],
      ["นโยบายโฆษณา", ad.compliance_th],
      ["หมายเหตุ", ad.notes],
    ])}</table>`
  )}
  ${section(
    "แผนทดสอบ & KPI",
    rows([["แผนทดสอบ/สเกล", a.testing_plan_th], ["KPI", a.kpis_th]])
      ? `<table>${rows([["แผนทดสอบ/สเกล", a.testing_plan_th], ["KPI", a.kpis_th]])}</table>`
      : ""
  )}
  ${section("ค่าที่จะใช้ตอนลอนช์ (Launch config)", lcHtml)}
  <script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
}

function exportAnalysisPdf(analysis) {
  const html = buildAnalysisHtml(analysis);
  const w = window.open("", "_blank");
  if (!w) {
    alert("เบราว์เซอร์บล็อกป็อปอัป — กรุณาอนุญาต popup สำหรับหน้านี้แล้วลองใหม่");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ตารางสรุปรายวัน — ใช้ทั้ง export ปกติ (fallback) และ export แบบภาพเต็มหน้า
//   จำนวนทัก = ดึงจาก Meta (leads) · จำนวนคนที่ทัก/แอด = นับจากแชทเพจจริง (page_chats_by_date) · ราคาต่อผลลัพธ์ = ค่าใช้จ่าย ÷ จำนวนทัก
function dailyTableHtml(ad, data) {
  const esc = escHtml;
  const list = (data?.daily || []).filter(Boolean);
  if (!list.length) return "";
  const opensByDate = data?.accountOpensByDate || {};
  const pageChatsByDate = data?.page_chats_by_date || {};
  const num = (v, d = 0) => (v == null || isNaN(v)) ? "-" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const beDate = (ds) => { if (!ds) return "-"; const p = String(ds).split("-").map(Number); if (p.length !== 3) return String(ds); return `${p[2]}/${p[1]}/${String((p[0] + 543) % 100).padStart(2, "0")}`; };
  let tLeads = 0, tPage = 0, tOpens = 0, tImpr = 0, tSpend = 0;
  const body = list.map((d) => {
    const day = String(d.date).slice(0, 10);
    // จำนวนทัก = การเริ่มการสนทนา (conversations) ให้ตรงกับ "แชทเริ่ม" · ราคาต่อผลลัพธ์ = ค่าใช้จ่าย ÷ จำนวนทัก
    const taks = Number(d.conversations != null ? d.conversations : d.leads) || 0;
    const cpa = (taks > 0) ? d.spend / taks : null;
    const opens = opensByDate[day] || 0;
    const pc = pageChatsByDate[day];
    const pageChat = pc != null ? pc : d.replies;
    tLeads += taks; tPage += Number(pageChat) || 0; tOpens += opens; tImpr += Number(d.impressions) || 0; tSpend += Number(d.spend) || 0;
    return `<tr><td>${esc(beDate(d.date))}</td><td class="lft">${esc(ad.headline || "-")}</td><td>${esc(num(taks))}</td><td>${esc(num(pageChat))}</td><td>${opens > 0 ? esc(num(opens)) : "-"}</td><td>${cpa == null ? "-" : esc(num(cpa, 2))}</td><td>${esc(num(d.impressions))}</td><td>${esc(num(d.spend, 2))}</td></tr>`;
  }).join("");
  const cprTotal = tLeads > 0 ? tSpend / tLeads : null;   // ราคาต่อผลลัพธ์รวม = ค่าใช้จ่ายรวม ÷ จำนวนทักรวม
  const totalRow = `<tr class="total"><td colspan="2" class="lft">รวมทั้งหมด</td><td>${esc(num(tLeads))}</td><td>${esc(num(tPage))}</td><td>${tOpens > 0 ? esc(num(tOpens)) : "-"}</td><td>${cprTotal == null ? "-" : esc(num(cprTotal, 2))}</td><td>${esc(num(tImpr))}</td><td>${esc(num(tSpend, 2))}</td></tr>`;
  const sub = (t) => `<br><span style="font-weight:400;font-size:9.5px;opacity:.8">${t}</span>`;
  return `<h2>สรุปรายวัน</h2><table class="daily"><thead><tr><th>Date</th><th>Link</th><th>จำนวนทัก${sub("(ดึงจาก Meta)")}</th><th>จำนวนคนที่ทัก / แอด${sub("(นับจากแชทเพจ · ทักครั้งแรก)")}</th><th>ลูกค้าที่เปิดบัญชี</th><th>ราคาต่อผลลัพธ์</th><th>ผลลัพธ์การมอง</th><th>ค่าใช้จ่ายปัจจุบัน</th></tr></thead><tbody>${body}${totalRow}</tbody></table>`;
}

// สร้าง PDF สรุปแดชบอร์ดรายแอด (KPI + งบ + breakdown + ตารางสรุปรายวัน) ผ่านหน้าพิมพ์ — รูปแบบ HTML อ่านง่าย
function buildDashboardHtml(ad, data, budget) {
  const o = data?.overall || {};
  const esc = escHtml;
  const kpiRow = (label, val) => `<tr><th>${esc(label)}</th><td>${esc(val)}</td></tr>`;
  const breakdownTable = (title, items, labelFn) => {
    const list = (items || []).filter((i) => (i.impressions || 0) > 0).slice(0, 12);
    if (!list.length) return "";
    const max = Math.max(1, ...list.map((i) => i.impressions));
    const rows = list
      .map((i) => {
        const pct = Math.round((i.impressions / max) * 100);
        return `<tr><td style="width:34%">${esc(labelFn ? labelFn(i.key) : i.key)}</td><td><div style="background:#e2e8f0;border-radius:6px;overflow:hidden"><div style="width:${pct}%;background:#4f46e5;height:12px"></div></div></td><td style="width:18%;text-align:right">${esc(Math.round(i.impressions).toLocaleString())}</td></tr>`;
      })
      .join("");
    return `<h2>${esc(title)}</h2><table>${rows}</table>`;
  };
  const devLabel = (k) => ({ mobile_app: "แอปมือถือ", mobile_web: "เว็บมือถือ", desktop: "เดสก์ท็อป", mobile_tablet: "แท็บเล็ต" }[k] || k);
  const genLabel = (k) => ({ male: "ชาย", female: "หญิง", unknown: "ไม่ระบุ" }[k] || k);


  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>Dashboard ${esc(ad.headline || "")}</title>
<style>
  body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:28px;line-height:1.5}
  h1{font-size:19px;margin:0 0 2px} h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #0f172a;padding-bottom:3px}
  .meta{color:#64748b;font-size:12px} table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0}
  th{text-align:left;color:#64748b;font-weight:600;padding:4px 8px;border-bottom:1px solid #e2e8f0;width:40%;vertical-align:top}
  td{padding:4px 8px;border-bottom:1px solid #e2e8f0;vertical-align:middle}
  .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
  .kpi{border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;min-width:120px}
  .kpi .l{font-size:11px;color:#64748b}.kpi .v{font-size:16px;font-weight:700}
  table.daily{border-collapse:collapse;width:100%;font-size:11.5px;margin:6px 0}
  table.daily th{background:#3f6f5e;color:#fff;border:1px solid #2c4f43;padding:6px 6px;text-align:center;font-weight:600;vertical-align:middle;width:auto}
  table.daily td{border:1px solid #94a3b8;padding:5px 7px;text-align:center;color:#1e293b;vertical-align:middle}
  table.daily td.lft{text-align:left;white-space:nowrap}
  table.daily tbody tr:nth-child(even) td{background:#eef1f4}
  table.daily tr.total td{background:#dfe8e3;font-weight:700;border-top:2px solid #3f6f5e}
  @page{margin:14mm}
</style></head><body>${exportPageNavHtml("analyze")}
  <h1>แดชบอร์ดโฆษณา — ${esc(ad.headline || "")}</h1>
  <div class="meta">Ad ID: ${esc(ad.ad_id || "-")} · ช่วง ${esc(data?.date_preset || "")} · ${esc(new Date(data?.generated_at || Date.now()).toLocaleString("th-TH"))}</div>
  <div class="kpis">
    <div class="kpi"><div class="l">ค่าใช้จ่าย</div><div class="v">${esc(Math.round(o.spend || 0).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">การมองเห็น</div><div class="v">${esc(Math.round(o.impressions || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">เข้าถึง</div><div class="v">${esc(Math.round(o.reach || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">ลีด</div><div class="v">${esc(Math.round(o.leads || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">CPL</div><div class="v">${o.cpl ? Math.round(o.cpl).toLocaleString() + "฿" : "—"}</div></div>
    <div class="kpi"><div class="l">CTR</div><div class="v">${esc((o.ctr || 0).toFixed(2))}%</div></div>
    <div class="kpi"><div class="l">CPC</div><div class="v">${esc(Math.round(o.cpc || 0).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">CPM</div><div class="v">${esc(Math.round(o.cpm || 0).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">คลิก</div><div class="v">${esc(Math.round(o.clicks || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">ความถี่</div><div class="v">${esc((o.frequency || 0).toFixed(2))}</div></div>
    <div class="kpi"><div class="l">Conv. rate</div><div class="v">${o.cvr != null ? esc(o.cvr.toFixed(1)) + "%" : "—"}</div></div>
  </div>
  ${o.conversations > 0 ? `<h2>แชท</h2><div class="kpis">
    <div class="kpi"><div class="l">แชทเริ่ม</div><div class="v">${esc(Math.round(o.conversations).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">ตอบกลับจริง</div><div class="v">${esc(Math.round(o.replies || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">อัตราตอบ</div><div class="v">${o.reply_rate != null ? Math.min(100, Math.round(o.reply_rate * 100)) + "%" : "—"}</div></div>
  </div>` : ""}
  ${budget && budget.totalWithVat > 0 ? `<h2>งบยิงโฆษณา</h2><div class="kpis">
    <div class="kpi"><div class="l">งบรวม VAT 7% แล้ว</div><div class="v">${esc(Math.round(budget.totalWithVat).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">งบยิง Ads (ก่อน VAT 7%)</div><div class="v">${esc(budget.beforeVat.toLocaleString("th-TH", { maximumFractionDigits: 2 }))}฿</div></div>
    <div class="kpi"><div class="l">ใช้จริงก่อน VAT</div><div class="v">${esc(Math.round(budget.spentBeforeVat).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">ใช้จริงรวม VAT</div><div class="v">${esc(Math.round(budget.spentWithVat).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">งบคงเหลือก่อน VAT 7%</div><div class="v" style="color:${budget.remainBeforeVat >= 0 ? "#059669" : "#dc2626"}">${esc(budget.remainBeforeVat.toLocaleString("th-TH", { maximumFractionDigits: 2 }))}฿</div></div>
    <div class="kpi"><div class="l">งบคงเหลือ (รวม VAT)</div><div class="v" style="color:${budget.remainWithVat >= 0 ? "#059669" : "#dc2626"}">${esc(Math.round(budget.remainWithVat).toLocaleString())}฿</div></div>
  </div>` : ""}
  ${dailyTableHtml(ad, data)}
  ${breakdownTable("ช่วงอายุ", data.age)}
  ${breakdownTable("เพศ", data.gender, genLabel)}
  ${breakdownTable("พื้นที่", data.region)}
  ${breakdownTable("ตำแหน่งจัดวาง", data.placement)}
  ${breakdownTable("อุปกรณ์", data.device, devLabel)}
  <script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
}

function exportAdDashboardPdf(ad, data, budget) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("เบราว์เซอร์บล็อกป็อปอัป — กรุณาอนุญาต popup แล้วลองใหม่");
    return;
  }
  w.document.open();
  w.document.write(buildDashboardHtml(ad, data, budget));
  w.document.close();
}

// ---- Export แดชบอร์ดเป็น Excel (.xls) / CSV (ไม่ต้องใช้ไลบรารีเพิ่ม) ----
const beDateTH = (ds) => { if (!ds) return "-"; const p = String(ds).split("-").map(Number); if (p.length !== 3) return String(ds); return `${p[2]}/${p[1]}/${String((p[0] + 543) % 100).padStart(2, "0")}`; };
function dashDailyRows(ad, data) {
  const list = (data?.daily || []).filter(Boolean);
  const opensByDate = data?.accountOpensByDate || {};
  const pcByDate = data?.page_chats_by_date || {};
  return list.map((d) => {
    const day = String(d.date).slice(0, 10);
    const taks = Number(d.conversations != null ? d.conversations : d.leads) || 0;   // จำนวนทัก = การเริ่มการสนทนา (แชทเริ่ม)
    const pc = pcByDate[day];
    const pageChat = pc != null ? pc : (Number(d.replies) || 0);
    const cpr = taks > 0 ? d.spend / taks : null;
    return { date: beDateTH(d.date), link: ad.headline || "-", taks, pageChat, opens: opensByDate[day] || 0, cpr, impr: Number(d.impressions) || 0, spend: Number(d.spend) || 0 };
  });
}
function dashTotals(rows) {
  const t = rows.reduce((a, r) => ({ taks: a.taks + r.taks, pageChat: a.pageChat + r.pageChat, opens: a.opens + (r.opens || 0), impr: a.impr + r.impr, spend: a.spend + r.spend }), { taks: 0, pageChat: 0, opens: 0, impr: 0, spend: 0 });
  t.cpr = t.taks > 0 ? t.spend / t.taks : null;
  return t;
}
function safeFileName(ad, ext) { return `dashboard-${String(ad.headline || "ad").replace(/[^\w ก-๙-]+/g, "_").slice(0, 40)}.${ext}`; }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
const DAILY_HEADERS = ["Date", "Link", "จำนวนทัก (Meta)", "จำนวนคนที่ทัก/แอด (เพจ, ทักครั้งแรก)", "ลูกค้าเปิดบัญชี", "ราคาต่อผลลัพธ์", "ผลลัพธ์การมอง", "ค่าใช้จ่าย"];
function exportAdDashboardCsv(ad, data) {
  const rows = dashDailyRows(ad, data);
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [DAILY_HEADERS.join(",")];
  for (const r of rows) lines.push([r.date, r.link, r.taks, r.pageChat, r.opens || 0, r.cpr == null ? "" : r.cpr.toFixed(2), r.impr, r.spend.toFixed(2)].map(esc).join(","));
  const t = dashTotals(rows);
  lines.push(["รวมทั้งหมด", "", t.taks, t.pageChat, t.opens, t.cpr == null ? "" : t.cpr.toFixed(2), t.impr, t.spend.toFixed(2)].map(esc).join(","));
  downloadBlob(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), safeFileName(ad, "csv"));
}
function exportAdDashboardExcel(ad, data, budget) {
  const esc = escHtml;
  const o = data?.overall || {};
  const rows = dashDailyRows(ad, data);
  const kpi = [["ค่าใช้จ่าย", Math.round(o.spend || 0)], ["การมองเห็น", Math.round(o.impressions || 0)], ["เข้าถึง", Math.round(o.reach || 0)], ["ลีด", Math.round(o.leads || 0)], ["CPL", o.cpl ? Math.round(o.cpl) : ""], ["CTR (%)", (o.ctr || 0).toFixed(2)], ["CPC", Math.round(o.cpc || 0)], ["CPM", Math.round(o.cpm || 0)], ["คลิก", Math.round(o.clicks || 0)], ["ความถี่", (o.frequency || 0).toFixed(2)], ["Conv. rate (%)", o.cvr != null ? o.cvr.toFixed(1) : ""]];
  if (o.conversations > 0) kpi.push(["แชทเริ่ม", Math.round(o.conversations)], ["ตอบกลับจริง", Math.round(o.replies || 0)], ["อัตราตอบ (%)", o.reply_rate != null ? Math.min(100, Math.round(o.reply_rate * 100)) : ""]);
  const budgetRows = (budget && budget.totalWithVat > 0) ? [
    ["งบรวม VAT 7% แล้ว", Math.round(budget.totalWithVat)],
    ["งบยิง Ads (ก่อน VAT 7%)", Number(budget.beforeVat.toFixed(2))],
    ["VAT 7%", Number(budget.vatAmount.toFixed(2))],
    ["ใช้จริงก่อน VAT", Math.round(budget.spentBeforeVat)],
    ["ใช้จริงรวม VAT", Math.round(budget.spentWithVat)],
    ["งบคงเหลือก่อน VAT 7%", Number(budget.remainBeforeVat.toFixed(2))],
    ["งบคงเหลือ (รวม VAT)", Math.round(budget.remainWithVat)],
  ] : [];
  const th = (t) => `<th style="background:#3f6f5e;color:#fff">${esc(t)}</th>`;
  const kv = (arr, title) => `<table border="1"><tr>${th(title)}${th("")}</tr>${arr.map(([l, v]) => `<tr><td>${esc(l)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
  const t = dashTotals(rows);
  const totalRow = `<tr style="font-weight:bold;background:#dfe8e3"><td>รวมทั้งหมด</td><td></td><td>${t.taks}</td><td>${t.pageChat}</td><td>${t.opens}</td><td>${t.cpr == null ? "" : t.cpr.toFixed(2)}</td><td>${t.impr}</td><td>${t.spend.toFixed(2)}</td></tr>`;
  const dailyTable = `<table border="1"><tr>${DAILY_HEADERS.map(th).join("")}</tr>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.link)}</td><td>${r.taks}</td><td>${r.pageChat}</td><td>${r.opens || 0}</td><td>${r.cpr == null ? "" : r.cpr.toFixed(2)}</td><td>${r.impr}</td><td>${r.spend.toFixed(2)}</td></tr>`).join("")}${totalRow}</table>`;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><h3>แดชบอร์ดโฆษณา — ${esc(ad.headline || "")}</h3><div>Ad ID: ${esc(ad.ad_id || "-")} · ช่วง ${esc(data?.date_preset || "")}</div><br/>${kv(kpi, "สรุป KPI")}${budgetRows.length ? "<br/>" + kv(budgetRows, "งบยิงโฆษณา") : ""}<br/><h4>สรุปรายวัน</h4>${dailyTable}</body></html>`;
  downloadBlob(new Blob(["﻿" + html], { type: "application/vnd.ms-excel" }), safeFileName(ad, "xls"));
}

// ---- Export "ฟอร์แมตงบยิง Ads" (ตารางติดตามงบ แบบชีต) — ดึงทั้งแคมเปญ: ชุดโฆษณา→โฆษณา ทุกตัว ----
//   เติมจาก Meta: ชื่อแคมเปญ/ชุด/โฆษณา, รูป, ID, ค่าใช้จ่าย (ใช้ไปทั้งหมด), วันเปิด (created), วันปิด (updated ถ้าไม่ ACTIVE = สีแดง)
//   คอลัมน์กรอกมือ (BG ของแคมเปญ/คงเหลือ/ยอดซื้อ/เหตุผลปิด) เว้นว่างเป็นเทมเพลต
const TRACKER_HEADERS = ["Campaign", "ชุดโฆษณา", "โฆษณา", "ภาพ ADS", "ID โฆษณา", "BG ของแคมเปญ (งบรวม VAT)", "ค่าใช้จ่ายปัจจุบัน (ใช้ไปทั้งหมด)", "คงเหลือ", "วันที่เปิด ADS", "วันที่ปิด ADS", "ยอดซื้อรวม", "เหตุผลที่ปิด ADS"];
const gregDate = (iso) => { if (!iso) return ""; const p = String(iso).slice(0, 10).split("-"); return p.length === 3 ? `${Number(p[2])}/${Number(p[1])}/${p[0]}` : String(iso).slice(0, 10); };
const money2 = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function trackerFileName(campaignName, ext) { return `งบยิงแอด-${String(campaignName || "campaign").replace(/[^\w ก-๙-]+/g, "_").slice(0, 40)}.${ext}`; }

// ดึงทั้งทรีของแคมเปญ (ชุดโฆษณา→โฆษณา) ผ่าน list-children · ค่าใช้จ่าย = ตามช่วงเวลาที่เลือกในแดชบอร์ด
async function fetchCampaignTree(ad, data, range) {
  const preset = range ? rangeToBody(range) : { date_preset: "maximum" };
  const campaignName = ad.level === "campaign" ? (ad.headline || ad.name || "") : (ad.campaign_name || ad.headline || ad.name || "");
  const rows = [];
  const mkRow = (adsetName, n) => {
    const st = n.effective_status || "";
    const stopped = !!st && st !== "ACTIVE";
    const spend = n.metrics?.spend != null ? Number(n.metrics.spend) : (n.spend != null ? Number(n.spend) : null);
    return {
      adset: adsetName || "", ad: n.name || "", thumb: n.thumbnail || "", ad_id: n.id || "", status: st,
      spend, start: gregDate(n.created_time), stopDate: stopped ? gregDate(n.updated_time) : "", stopped,
    };
  };
  try {
    if (ad.level === "campaign") {
      const { data: aset } = await supabase.functions.invoke("list-children", { body: { parent_id: ad.ad_id, level: "adsets", ...preset } });
      for (const adset of (aset?.nodes || [])) {
        const { data: adsRes } = await supabase.functions.invoke("list-children", { body: { parent_id: adset.id, level: "ads", ...preset } });
        for (const a of (adsRes?.nodes || [])) rows.push(mkRow(adset.name, a));
      }
    } else if (ad.level === "adset" || ad.level === "adsets") {
      const { data: adsRes } = await supabase.functions.invoke("list-children", { body: { parent_id: ad.ad_id, level: "ads", ...preset } });
      for (const a of (adsRes?.nodes || [])) rows.push(mkRow(ad.adset_name || ad.headline || "", a));
    } else {
      rows.push(mkRow(ad.adset_name || "", { id: ad.ad_id, name: ad.name || ad.headline, metrics: { spend: data?.overall?.spend } }));
    }
  } catch (_e) { /* ใช้ rows เท่าที่ดึงได้ */ }
  return { campaignName, rows };
}

function exportTrackerCsv(campaignName, rows) {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [
    [`สรุปงบยิงโฆษณา — ${campaignName}`].map(esc).join(","),
    ["BG คงเหลือเดือนที่แล้ว", "", "BG เดือนนี้", "", "ยอดรวม", ""].map(esc).join(","),
    TRACKER_HEADERS.map(esc).join(","),
  ];
  let total = 0, campShown = false, lastAdset = null;
  for (const r of rows) {
    if (r.spend != null) total += r.spend;
    const camp = campShown ? "" : campaignName; campShown = true;
    const adset = r.adset === lastAdset ? "" : r.adset; lastAdset = r.adset;
    lines.push([camp, adset, r.ad, r.thumb || "", r.ad_id, "", r.spend != null ? money2(r.spend) : "", "", r.start, r.stopDate, "", ""].map(esc).join(","));
  }
  lines.push(["ผลรวม", "", "", "", "", "", money2(total), "", "", "", "", ""].map(esc).join(","));
  downloadBlob(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), trackerFileName(campaignName, "csv"));
}
function trackerBodyHtml(campaignName, rows, { withImg }) {
  const esc = escHtml;
  let total = 0, campShown = false, lastAdset = null;
  const body = rows.map((r) => {
    if (r.spend != null) total += r.spend;
    const camp = campShown ? "" : esc(campaignName); campShown = true;
    const adset = r.adset === lastAdset ? "" : esc(r.adset); lastAdset = r.adset;
    const img = withImg && r.thumb ? `<img src="${esc(r.thumb)}" width="46" height="46" style="object-fit:cover;border-radius:4px">` : "";
    const stop = r.stopDate ? `<span style="color:#dc2626;font-weight:700">${esc(r.stopDate)}</span>` : "";
    const spend = r.spend != null ? esc(money2(r.spend)) : "";
    return `<tr><td class="l">${camp}</td><td class="l">${adset}</td><td class="l">${esc(r.ad)}</td><td>${img}</td><td>${esc(r.ad_id)}</td><td></td><td>${spend}</td><td></td><td>${esc(r.start)}</td><td>${stop}</td><td></td><td></td></tr>`;
  }).join("");
  const totalRow = `<tr class="total"><td class="l" colspan="6">ผลรวม</td><td>${esc(money2(total))}</td><td></td><td></td><td></td><td></td><td></td></tr>`;
  const head = `<tr>${TRACKER_HEADERS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  return { head, body, totalRow };
}
async function imageDataForWorkbook(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`โหลดรูปไม่สำเร็จ (${res.status})`);
    const blob = await res.blob();
    const mime = String(blob.type || "image/jpeg").toLowerCase();
    if (!mime.startsWith("image/")) throw new Error("ไฟล์ที่ได้ไม่ใช่รูปภาพ");
    const extension = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpeg";
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return base64 ? { base64, extension } : null;
  } catch {
    // CDN ของ Meta บาง URL ไม่อนุญาต CORS ในเบราว์เซอร์ ใช้ proxy ที่ตรวจสิทธิ์และจำกัด host เป็น fallback
    try {
      const { data, error } = await supabase.functions.invoke("export-ad-image", { body: { url } });
      if (error || !data?.ok || !data?.base64) return null;
      const mime = String(data.content_type || "image/jpeg").toLowerCase();
      return { base64: data.base64, extension: mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpeg" };
    } catch { return null; }
  }
}

async function exportTrackerExcel(campaignName, rows) {
  // โหลด ExcelJS เฉพาะตอนกด Export เพื่อไม่เพิ่มภาระให้หน้า Analyze ตอนเปิดใช้งานปกติ
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "AdFlow OS";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const report = wb.addWorksheet("รายงานงบ Ads", {
    views: [{ state: "frozen", ySplit: 8, showGridLines: false }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  const raw = wb.addWorksheet("ข้อมูลดิบ", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  const navy = "172033", green = "256D5A", paleGold = "FFF2B8", paleGreen = "E6F4EE", white = "FFFFFF", slate = "475569", border = "CBD5E1";
  const thinBorder = { top: { style: "thin", color: { argb: border } }, left: { style: "thin", color: { argb: border } }, bottom: { style: "thin", color: { argb: border } }, right: { style: "thin", color: { argb: border } } };

  report.columns = [18, 24, 30, 13, 20, 20, 18, 18, 15, 15, 15, 28].map((width) => ({ width }));
  report.mergeCells("A1:L2");
  report.getCell("A1").value = `สรุปงบยิงโฆษณา — ${campaignName}`;
  report.getCell("A1").font = { name: "Sarabun", size: 18, bold: true, color: { argb: white } };
  report.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
  report.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  report.getRow(1).height = 28; report.getRow(2).height = 18;
  report.mergeCells("A3:L3");
  report.getCell("A3").value = "กรอกเฉพาะช่องสีเหลือง · ช่องสีเขียวคำนวณอัตโนมัติ · ข้อมูลจาก Meta อยู่ในชีตข้อมูลดิบ";
  report.getCell("A3").font = { name: "Sarabun", size: 10, italic: true, color: { argb: slate } };

  const spendFormula = rows.length ? `=SUM(G9:G${8 + rows.length})` : "=0";
  const cards = [["A4:B4", "A5:B6", "BG คงเหลือเดือนที่แล้ว", 0], ["D4:E4", "D5:E6", "BG เดือนนี้", 0], ["G4:H4", "G5:H6", "ยอดรวม", { formula: "=A5+D5", result: 0 }], ["J4:K4", "J5:K6", "ใช้จริงรวม", { formula: spendFormula, result: rows.reduce((s, r) => s + (Number(r.spend) || 0), 0) }]];
  for (const [labelRange, valueRange, label, value] of cards) {
    report.mergeCells(labelRange); report.mergeCells(valueRange);
    const lc = report.getCell(labelRange.split(":")[0]), vc = report.getCell(valueRange.split(":")[0]);
    lc.value = label; lc.font = { name: "Sarabun", size: 10, bold: true, color: { argb: white } }; lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } }; lc.alignment = { horizontal: "center" };
    vc.value = value; vc.font = { name: "Sarabun", size: 16, bold: true, color: { argb: navy } }; vc.alignment = { horizontal: "center", vertical: "middle" }; vc.numFmt = '#,##0.00" ฿"'; vc.border = thinBorder;
    vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: typeof value === "number" ? paleGold : paleGreen } };
  }
  report.getCell("A5").note = "กรอกงบคงเหลือที่ยกมาจากเดือนก่อน";
  report.getCell("D5").note = "กรอกงบรวม VAT ของเดือนนี้";
  for (const cell of ["A5", "D5"]) report.getCell(cell).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: "กรอกตัวเลขเท่านั้น", error: "กรุณากรอกจำนวนตั้งแต่ 0 ขึ้นไป" };

  const headerRow = 8, firstDataRow = 9, lastDataRow = 8 + rows.length, totalRow = Math.max(firstDataRow, lastDataRow + 1);
  report.getRow(headerRow).values = TRACKER_HEADERS;
  report.getRow(headerRow).height = 42;
  report.getRow(headerRow).eachCell((cell) => { cell.font = { name: "Sarabun", size: 9, bold: true, color: { argb: white } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.border = thinBorder; });
  report.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, lastDataRow), column: 12 } };

  rows.forEach((r, idx) => {
    const rowNo = firstDataRow + idx;
    const row = report.getRow(rowNo);
    row.values = [campaignName, r.adset, r.ad, "", String(r.ad_id || ""), "", r.spend == null ? "" : Number(r.spend), "", r.start, r.stopDate, "", ""];
    row.height = 58;
    row.eachCell({ includeEmpty: true }, (cell, col) => { cell.font = { name: "Sarabun", size: 9, color: { argb: navy } }; cell.alignment = { vertical: "middle", horizontal: [1, 2, 3, 12].includes(col) ? "left" : "center", wrapText: true }; cell.border = thinBorder; });
    for (const col of [6, 11, 12]) row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: paleGold } };
    row.getCell(8).value = { formula: `=IF(F${rowNo}="","",F${rowNo}-G${rowNo})`, result: null };
    row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: paleGreen } };
    for (const col of [6, 7, 8, 11]) row.getCell(col).numFmt = '#,##0.00" ฿"';
    for (const col of [6, 11]) row.getCell(col).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: "กรอกตัวเลขเท่านั้น", error: "กรุณากรอกจำนวนตั้งแต่ 0 ขึ้นไป" };
    if (r.stopDate) row.getCell(10).font = { name: "Sarabun", size: 9, bold: true, color: { argb: "DC2626" } };
  });

  report.mergeCells(`A${totalRow}:F${totalRow}`);
  report.getCell(`A${totalRow}`).value = "ผลรวม";
  report.getCell(`G${totalRow}`).value = { formula: rows.length ? `=SUM(G${firstDataRow}:G${lastDataRow})` : "=0", result: rows.reduce((s, r) => s + (Number(r.spend) || 0), 0) };
  report.getCell(`H${totalRow}`).value = { formula: rows.length ? `=SUM(H${firstDataRow}:H${lastDataRow})` : "=0", result: 0 };
  report.getCell(`K${totalRow}`).value = { formula: rows.length ? `=SUM(K${firstDataRow}:K${lastDataRow})` : "=0", result: 0 };
  report.getRow(totalRow).eachCell({ includeEmpty: true }, (cell) => { cell.font = { name: "Sarabun", size: 10, bold: true, color: { argb: navy } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: paleGreen } }; cell.border = thinBorder; cell.alignment = { vertical: "middle", horizontal: "center" }; });
  for (const col of [7, 8, 11]) report.getRow(totalRow).getCell(col).numFmt = '#,##0.00" ฿"';
  if (rows.length) report.addConditionalFormatting({ ref: `H${firstDataRow}:H${lastDataRow}`, rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], style: { font: { color: { argb: "DC2626" }, bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FEE2E2" }, fgColor: { argb: "FEE2E2" } } } }] });

  raw.columns = [22, 26, 34, 58, 20, 16, 16, 16, 16].map((width) => ({ width }));
  raw.addRow(["Campaign", "ชุดโฆษณา", "โฆษณา", "URL รูป", "ID โฆษณา", "สถานะ", "ค่าใช้จ่าย", "วันที่เปิด", "วันที่ปิด"]);
  rows.forEach((r) => raw.addRow([campaignName, r.adset, r.ad, r.thumb || "", String(r.ad_id || ""), r.status || "", r.spend == null ? "" : Number(r.spend), r.start, r.stopDate]));
  raw.getRow(1).eachCell((cell) => { cell.font = { name: "Sarabun", size: 10, bold: true, color: { argb: white } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } }; cell.alignment = { horizontal: "center", vertical: "middle" }; cell.border = thinBorder; });
  raw.autoFilter = `A1:I${Math.max(1, rows.length + 1)}`;
  raw.getColumn(7).numFmt = '#,##0.00" ฿"';
  raw.eachRow((row, rowNumber) => { if (rowNumber > 1) row.eachCell({ includeEmpty: true }, (cell) => { cell.font = { name: "Sarabun", size: 9 }; cell.border = thinBorder; cell.alignment = { vertical: "middle", wrapText: false }; }); });

  // ฝังรูปทีละภาพแบบจำกัด concurrency เพื่อลดโอกาสเบราว์เซอร์ค้างเมื่อแคมเปญมีโฆษณาจำนวนมาก
  for (let idx = 0; idx < rows.length; idx += 4) {
    const batch = rows.slice(idx, idx + 4);
    const images = await Promise.all(batch.map((r) => imageDataForWorkbook(r.thumb)));
    images.forEach((img, off) => {
      if (!img) return;
      const rowNo = firstDataRow + idx + off;
      const imageId = wb.addImage(img);
      report.addImage(imageId, { tl: { col: 3.12, row: rowNo - 0.9 }, ext: { width: 70, height: 70 }, editAs: "oneCell" });
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), trackerFileName(campaignName, "xlsx"));
}
function exportTrackerPdf(campaignName, rows) {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — กรุณาอนุญาต popup แล้วลองใหม่"); return; }
  const esc = escHtml;
  const { head, body, totalRow } = trackerBodyHtml(campaignName, rows, { withImg: true });
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>งบยิง Ads</title>
<style>
 body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:16px;font-size:10.5px}
 h1{font-size:16px;margin:0 0 8px}
 table{border-collapse:collapse;width:100%;margin:6px 0}
 table.sum td{border:1px solid #cbd5e1;padding:4px 8px;font-size:11px}
 table.trk th{background:#3f6f5e;color:#fff;border:1px solid #2c4f43;padding:6px;text-align:center;font-size:9px;vertical-align:middle}
 table.trk td{border:1px solid #94a3b8;padding:5px;text-align:center;vertical-align:middle}
 table.trk td.l{text-align:left}
 table.trk tr.total td{background:#dfe8e3;font-weight:700;border-top:2px solid #3f6f5e}
 @page{size:A4 landscape;margin:8mm}
</style></head><body>${exportPageNavHtml("analyze")}
 <h1>สรุปงบยิงโฆษณา — ${esc(campaignName)}</h1>
 <table class="sum"><tr><td>BG คงเหลือเดือนที่แล้ว</td><td>&nbsp;</td><td>BG เดือนนี้</td><td>&nbsp;</td><td>ยอดรวม</td><td>&nbsp;</td></tr></table>
 <table class="trk">${head}${body}${totalRow}</table>
 <script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},600);</script>
</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}

export { exportAnalysisPdf, AnalysisReport };
export default AnalyzeTab;
