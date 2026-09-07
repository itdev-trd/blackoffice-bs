// ป้ายชื่อ ตัวจัดรูปแบบตัวเลข และตัวช่วยเรื่องช่วงวัน ของหน้า "วิเคราะห์"
//
// แยกออกมาจาก AnalyzeTab.jsx (เดิม 3,054 บรรทัดในไฟล์เดียว) เพราะทั้งหมดในไฟล์นี้
// เป็นค่าคงที่กับฟังก์ชันบริสุทธิ์ ไม่มี state ไม่มี JSX — ใช้ร่วมกันหลายส่วนของหน้ารายงาน
// (การ์ดสรุป · แผ่นรายละเอียดแอด · หน้าเปรียบเทียบ · ตัวสร้าง PDF)
//
// ยกเว้น VERDICT_META ที่ถือคอมโพเนนต์ไอคอนไว้ด้วย จึงต้อง import ไอคอนมาที่ไฟล์นี้
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Minus } from "lucide-react";
import { bangkokDate } from "@/lib/utils/date";

export const VERDICT_META = {
  underperform: { label: "ต่ำกว่าเป้า", cls: "bg-rose-100 text-rose-700", Icon: ArrowDownCircle },
  outperform: { label: "ดีเกินเป้า", cls: "bg-emerald-100 text-emerald-700", Icon: ArrowUpCircle },
  on_target: { label: "ตามเป้า", cls: "bg-blue-100 text-blue-700", Icon: CheckCircle2 },
  insufficient_data: { label: "ข้อมูลยังน้อย", cls: "bg-slate-100 text-slate-600", Icon: Minus },
};

export function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("th-TH", { maximumFractionDigits: digits });
}
// จำนวนเงินต้องคงทศนิยม 2 ตำแหน่งเสมอ (บังคับให้มีเลขศูนย์ท้ายด้วย) เพราะตัวเลขพวกนี้
// ถูกเอาไปกระทบยอดกับฝ่ายบัญชี — fmtNum ปัดทิ้งทำให้ ฿9,331.87 กลายเป็น 9,332 ไม่ตรงกับ Ads Manager

export function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------
// แดชบอร์ดเจาะลึกรายแอด (charts / gauges แบบ SVG ไม่พึ่งไลบรารีนอก)
// ---------------------------------------------------------------

export function headlineResult(o) {
  if (!o) return null;
  if (o.conversations > 0) return { label: "คนทักแชท", hint: "บทสนทนาที่เริ่มจากโฆษณา", value: o.conversations };
  if (o.leads > 0) return { label: "ลีด", hint: "คนที่กรอกข้อมูลติดต่อ", value: o.leads };
  if (o.link_clicks > 0) return { label: "คนกดลิงก์", hint: "คลิกไปยังปลายทาง", value: o.link_clicks };
  return { label: "ผลลัพธ์", hint: "ยังไม่มีผลลัพธ์ในช่วงนี้", value: 0 };
}

export const AGE_LABEL = (k) => k;

export const REGION_LABEL = (k) => k;

export const BD_METRIC_LABEL = { impressions: "การมองเห็น", leads: "ลีด", replies: "ตอบกลับจริง" };

export const BD_METRIC_META = {
  impressions: { label: "การมองเห็น", color: "#0ea5e9" },
  leads: { label: "ลีด", color: "#10b981" },
  replies: { label: "ตอบกลับจริง", color: "#8b5cf6" },
};

export const BD_KEYS = ["impressions", "leads", "replies"];

export const GENDER_LABEL = (k) => ({ male: "ชาย", female: "หญิง", unknown: "ไม่ระบุ" }[k] || k);
// วัตถุประสงค์แคมเปญ (objective จาก Meta) -> ป้ายภาษาไทย

export const OBJECTIVE_LABEL = (k) => {
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

export const DEVICE_LABEL = (k) => {
  const m = { mobile_app: "แอปมือถือ", mobile_web: "เว็บมือถือ", desktop: "เดสก์ท็อป", mobile_tablet: "แท็บเล็ต" };
  return m[k] || k;
};

export const DATE_PRESETS = [
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

export function rangeToBody(r) {
  if (r?.preset === "custom" && r.since && r.until) return { time_range: { since: r.since, until: r.until } };
  return { date_preset: r?.preset || "last_30d" };
}

export function rangeLabel(r) {
  if (r?.preset === "custom") return r.since && r.until ? `${r.since} - ${r.until}` : "กำหนดเอง";
  return DATE_PRESETS.find((p) => p.value === r?.preset)?.label || "";
}

// ตัวเลือกช่วงวันแบบ Meta (preset + กำหนดเองด้วยปฏิทิน)

export function presetToDates(range) {
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

export const dayMinus1 = (d) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

// แผงประวัติการเปลี่ยนแปลง + เทียบผลก่อน/หลังแก้

export const COMPARE_METRICS = [
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

export const CHANGE_LABEL = { pause: "หยุด", resume: "เปิด", set_budget: "ตั้งงบ", exclude_audience_network: "ตัด Audience Network" };

export function escHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export const beDateTH = (ds) => { if (!ds) return "-"; const p = String(ds).split("-").map(Number); if (p.length !== 3) return String(ds); return `${p[2]}/${p[1]}/${String((p[0] + 543) % 100).padStart(2, "0")}`; };
