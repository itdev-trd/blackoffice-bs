"use client";

// จัดการสมาชิก Indicator ของแบรนด์เดียว (ค่าเริ่มต้น: BeSight) — ต่างจาก TvMembersTab.jsx ตรงที่
// หน้านี้โฟกัสแบรนด์เดียว โชว์ข้อมูลติดต่อ (เบอร์/ประเทศ/Telegram) และยอด Lot ที่เทรดจริงเทียบโควตาต่อรอบสิทธิ์
//
// "Lots" ดึงจาก broker (XM) ผ่าน edge function action "refresh_lots" (ปุ่ม "ตรวจ Lot ทุกคน")
// แล้ว cache ไว้ในตาราง tv_lot_usage เพราะ API คืนยอดทุกบัญชีมาทีเดียว ไม่ต้องยิงรายคน
// ช่วงที่นับคือรอบสิทธิ์ของแต่ละคน (วันเริ่มต้น → วันหมดอายุ) ไม่ใช่เดือนปฏิทิน
// แต่ยอดของรอบที่ยังไม่หมดอายุเดินทุกวัน แคชค้างข้ามวันก็ไม่ตรงกับที่ลูกค้าเห็นในแอป BeSight แล้ว
// (เคสจริง: แคช 0.60 ตอนดึกวันที่ 17 ก.ย. ขณะที่ broker เดินไปถึง 0.74) หน้านี้จึงตรวจสดให้เอง
// เมื่อค่าที่แคชเก่าเกิน LOT_STALE_MS และโชว์เวลาที่ตรวจล่าสุดไว้ข้างปุ่มเสมอ

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { hasFullData } from "@/lib/constants/roles";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { logActivity } from "@/lib/utils/activity";
import { beToCe } from "@/lib/utils/date";
import { TradeIdChecker } from "@/components/features/customerdb/CustomerDatabaseTab";
import {
  SectionTitle, StatCard, Button, Card, Dialog, SearchInput, FilterPill, Field, Input, Select, EmptyState,
} from "@/components/ui";
import {
  Gauge, CheckCircle2, XCircle, Plus, Download, RefreshCw, Loader2, Pencil, Trash2, ChevronLeft, ChevronRight, ListTree, PartyPopper,
} from "lucide-react";

// Plan ของสมาชิก — เลื่อนขั้นตามยอด Lot ที่เทรดได้ในแต่ละรอบอายุ
//   new     ทดลองใช้ 1 เดือน · ครบโควตา = ต่ออายุ + ขึ้นเป็น free
//   free    ผ่านทดลองแล้ว · ครบโควตาติดกัน 3 รอบ = ขึ้นเป็น premium
//   premium ตกโควตาเมื่อไหร่ = ไม่ต่ออายุ และลดกลับเป็น free
const MEMBER_TYPES = [["new", "ลูกค้าใหม่"], ["renew", "ต่ออายุ"], ["free", "Free"], ["premium", "Premium"]];
const memberTypeLabel = (v) => MEMBER_TYPES.find(([key]) => key === v)?.[1] || "—";
const PLAN_TONE = {
  new: "border-sky-200 bg-sky-50 text-sky-700",
  renew: "border-emerald-200 bg-emerald-50 text-emerald-700",
  free: "border-slate-200 bg-slate-50 text-slate-600",
  premium: "border-amber-200 bg-amber-50 text-amber-700",
};
const CONTACT_CHANNELS = [["facebook", "Facebook"], ["line", "LINE"], ["instagram", "Instagram"], ["telegram", "Telegram"], ["tiktok", "TikTok"], ["youtube", "YouTube"]];
const channelLabel = (v) => CONTACT_CHANNELS.find(([key]) => key === v)?.[1] || "—";
// broker ของบัญชีเทรด — XM คือค่าหลัก (ข้อมูลเก่าทั้งหมดเป็น XM) · Exness เป็นตัวเลือกรอง
const BROKERS = ["XM", "Exness"];

// สถานะสิทธิ์ที่แอดมินต้องเห็น — ต่างจาก TvMembersTab ตรงชื่อป้ายให้ตรงกับหน้านี้ ("ไม่มีสิทธิ์" แทน "หมดอายุ/error" รวมกัน)
function statusInfo(a) {
  if (a.status === "active") return { label: "มีสิทธิ์", tone: "text-emerald-700 bg-emerald-50 border-emerald-200" };
  if (a.status === "revoked") return { label: "ถอนสิทธิ์แล้ว", tone: "text-slate-500 bg-slate-100 border-slate-200" };
  if (a.status === "expired") return { label: "หมดอายุ", tone: "text-amber-700 bg-amber-50 border-amber-200" };
  return { label: "ไม่มีสิทธิ์", tone: "text-rose-700 bg-rose-50 border-rose-200" };
}

// สมาชิกคนหนึ่งอาจมีหลายแถวใน tv_access (หนึ่งแถวต่ออินดิเคเตอร์หนึ่งตัว) — ตารางเดิม
// โชว์ทีละแถวทำให้คนเดียวโผล่ซ้ำหลายบรรทัด (ชื่อ/เบอร์/อีเมลซ้ำกันทุกแถว) ดูเหมือน UI ค้าง/ซ้อนกัน
// จัดกลุ่มตาม username ให้เหลือ "หนึ่งคนหนึ่งแถว" แล้วเลือกแถว "หลัก" มาโชว์ในตาราง
// ถ้ามีมากกว่า 1 อินดิเคเตอร์ กดเข้าไปดูรายละเอียดเพิ่มเติมได้ (ดู detailMember ด้านล่าง)
function pickPrimaryIndicator(indicatorRows) {
  const active = indicatorRows.filter((r) => r.status === "active");
  const pool = active.length ? active : indicatorRows;
  return [...pool].sort((a, b) => {
    const ea = a.expiration ? new Date(a.expiration).getTime() : Infinity; // ตลอดชีพ (ไม่มีวันหมดอายุ) ถือว่าไกลสุด
    const eb = b.expiration ? new Date(b.expiration).getTime() : Infinity;
    return eb - ea;
  })[0];
}
function earliestOf(indicatorRows, field) {
  let min = Infinity;
  for (const r of indicatorRows) {
    if (!r[field]) continue;
    const t = new Date(r[field]).getTime();
    if (t < min) min = t;
  }
  return Number.isFinite(min) ? new Date(min).toISOString() : null;
}

// วันที่ตามเวลาไทย — broker คิดยอดเป็นวันปฏิทิน ไม่ใช่ UTC
const thDay = (ts) => {
  if (!ts) return "";
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10) : "";
};
const thNow = () => new Date(Date.now() + 7 * 3600 * 1000);
const thMonthStart = () => { const n = thNow(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString().slice(0, 10); };
const thMonthEnd = () => { const n = thNow(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };
const dayLabel = (d) => (d ? new Date(`${d}T00:00:00+07:00`).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");

// บวก/ลบเดือนแบบหนีบวันสิ้นเดือน (31 ม.ค. +1 เดือน = 28 ก.พ.)
const addMonthsDay = (ymd, k) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, lastDay))).toISOString().slice(0, 10);
};

// รอบที่ใช้นับ Lot = "รอบเดือน" ของสมาชิกคนนั้น ไม่ใช่เดือนปฏิทิน
// ได้สิทธิ์ 10 ก.พ. → นับ 10 ก.พ.–10 มี.ค. · ต่ออายุถึง 10 เม.ย. → นับ 10 มี.ค.–10 เม.ย.
// (ต้องตรงกับ lotCycleOf ใน edge function เป๊ะ ๆ ไม่งั้นอ่านแคชไม่เจอ)
function lotCycleOf(grantDay, expiryDay, today) {
  let start, end;
  if (!expiryDay) {                                  // ตลอดชีพ — ยึดวันที่ได้สิทธิ์เป็นหมุด
    start = grantDay;
    for (let i = 0; i < 240 && addMonthsDay(start, 1) <= today; i++) start = addMonthsDay(start, 1);
    end = addMonthsDay(start, 1);
  } else if (expiryDay <= today) {                   // หมดอายุแล้ว — รอบสุดท้ายก่อนหมดอายุ
    start = addMonthsDay(expiryDay, -1);
    end = expiryDay;
  } else {                                           // ถอยจากวันหมดอายุจนได้รอบที่ครอบวันนี้
    let i = 1;
    start = addMonthsDay(expiryDay, -1);
    while (start > today && i < 240) { i++; start = addMonthsDay(expiryDay, -i); }
    end = addMonthsDay(expiryDay, -(i - 1));
  }
  if (start < grantDay) start = grantDay;
  if (end <= start) end = addMonthsDay(start, 1);
  return { start, end };
}

// ช่วงที่แอดมินเลือกให้นับ — ค่าเริ่มต้นคือรอบเดือนของแต่ละคน แต่เลือกช่วงเดียวกันทั้งตารางได้
const LOT_MODES = [["cycle", "รอบเดือนของแต่ละคน"], ["this_month", "เดือนนี้"], ["last_month", "เดือนก่อน"], ["custom", "เลือกวันเอง"]];
function fixedLotRange(mode, custom) {
  const n = thNow();
  const y = n.getUTCFullYear(), m = n.getUTCMonth();
  const monthRange = (k) => ({
    start: new Date(Date.UTC(y, m + k, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(y, m + k + 1, 0)).toISOString().slice(0, 10),
  });
  if (mode === "this_month") return monthRange(0);
  if (mode === "last_month") return monthRange(-1);
  if (mode === "custom" && custom?.start && custom?.end && custom.end >= custom.start) return { start: custom.start, end: custom.end };
  return null;
}
function lotPeriodOf(indicatorRows, mode = "cycle", custom = null) {
  const fixed = fixedLotRange(mode, custom);
  if (fixed) return fixed;
  let grant = "", expiry = null, lifetime = false;
  for (const r of indicatorRows) {
    const g = thDay(r.granted_at) || thDay(r.created_at);
    if (g && (!grant || g < grant)) grant = g;
    const e = thDay(r.expiration);
    if (!e) lifetime = true;                          // มีใบตลอดชีพ = ถือว่าตลอดชีพ
    else if (!expiry || e > expiry) expiry = e;
  }
  if (!grant) grant = thMonthStart();
  return lotCycleOf(grant, lifetime ? null : expiry, thDay(new Date()));
}
const lotKeyOf = (m) => `${String(m.trade_id || "").trim()}|${m.lot_period.start}|${m.lot_period.end}`;

const PAGE_SIZE = 10;
// ยอด Lot ที่แคชไว้เกินเท่านี้ถือว่าเก่า — ตรวจสดให้ใหม่ตอนเปิดหน้า
const LOT_STALE_MS = 30 * 60 * 1000;
const emptyForm = { username: "", display_name: "", email: "", trade_id: "", phone: "", country: "", telegram: "", contact_channel: "", member_type: "new", broker: "XM", pine_id: "", days: 30, lifetime: false };

export default function BesightMembersTab({ active = true }) {
  const [brands, setBrands] = useState([]);
  const [brandId, setBrandId] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [rows, setRows] = useState([]);
  const [lotUsage, setLotUsage] = useState(new Map()); // trade_id -> { lots, excluded_lots, campaign_name, fetched_at }
  const [lotCacheReady, setLotCacheReady] = useState(false);
  const [lotMode, setLotMode] = useState("cycle");          // ช่วงที่แอดมินเลือกให้นับ Lot
  const [lotCustom, setLotCustom] = useState({ start: "", end: "" });
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [q, setQ] = useState("");
  const [memberTypeFilter, setMemberTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [quotaDraft, setQuotaDraft] = useState("");
  const [savingQuota, setSavingQuota] = useState(false);
  const [refreshingLots, setRefreshingLots] = useState(false);
  const [lotMsg, setLotMsg] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [editMember, setEditMember] = useState(null);   // สมาชิก (ไม่ใช่แถวเดียว) ที่กำลังแก้ข้อมูลร่วม
  const [editForm, setEditForm] = useState(emptyForm);
  const [editSaving, setEditSaving] = useState(false);
  const [busyRow, setBusyRow] = useState(null);
  const [detailMember, setDetailMember] = useState(null);   // สมาชิกที่กำลังดูรายละเอียด (ครบทุกอินดิเคเตอร์)
  const [lotHistory, setLotHistory] = useState(null);       // { loading } | { months: [...] } | { error }
  const [grantSuccess, setGrantSuccess] = useState(null);   // { username, script } — popup ยืนยันตอนเพิ่มสมาชิกสำเร็จ

  const brand = brands.find((b) => b.id === brandId) || null;

  async function load() {
    setLoading(true);
    const [{ data: br }, { data: u }] = await Promise.all([
      supabase.from("tv_brands").select("id, name, show_in_manager, active, lot_quota_per_month").order("created_at"),
      supabase.auth.getUser(),
    ]);
    const visible = (br || []).filter((b) => b.show_in_manager !== false);
    setBrands(visible);
    setBrandId((cur) => (cur && visible.some((b) => b.id === cur)) ? cur : (visible[0]?.id ?? null));
    const email = u?.user?.email;
    if (email) {
      const { data: p } = await supabase.from("user_permissions").select("role").eq("email", email).maybeSingle();
      setIsAdmin(hasFullData(p?.role));
    }
    setLoading(false);
  }
  useEffect(() => { if (active) load(); /* eslint-disable-next-line */ }, [active]);

  async function loadMembers() {
    if (!brandId) { setRows([]); setScripts([]); return; }
    // tv_access ต้องแบ่งหน้าเอง — ทะลุ 1000 แถวแล้วสมาชิกท้าย ๆ จะหายเงียบ ๆ (ตอนนี้ 884 แถว)
    const [{ data: sc }, ac] = await Promise.all([
      supabase.from("tv_scripts").select("pine_id, name").eq("brand_id", brandId).order("name"),
      (async () => {
        const all = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from("tv_access").select("*").eq("brand_id", brandId)
            .order("granted_at", { ascending: false }).order("id").range(from, from + 999);
          if (error || !data?.length) break;
          all.push(...data);
          if (data.length < 1000) break;
        }
        return all;
      })(),
    ]);
    setScripts(sc || []);
    setRows(ac || []);
    // แคช Lot คนละช่วงกันแล้ว (รอบสิทธิ์ของใครของมัน) จึงดึงแถวของรอบที่ยังเกี่ยวข้องมาจับคู่เอง
    // ไม่กรองด้วย .in(trade_id) เพราะสมาชิกหลายร้อยคนจะทำให้ URL ยาวเกิน — กรองด้วยวันสิ้นสุดรอบพอ
    // และต้องแบ่งหน้าเอง เพราะ PostgREST คืนสูงสุด 1000 แถวต่อครั้ง (สมาชิก × รอบย้อนหลังเกินได้ง่าย)
    let earliest = fixedLotRange(lotMode, lotCustom)?.start || thMonthStart();
    for (const r of ac || []) {
      const s0 = thDay(r.granted_at) || thDay(r.created_at);
      if (s0 && s0 < earliest) earliest = s0;
    }
    const lu = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("tv_lot_usage")
        .select("trade_id, period_start, period_end, lots, excluded_lots, campaign_name, fetched_at")
        .gte("period_end", earliest).order("id").range(from, from + 999);
      if (error || !data?.length) break;
      lu.push(...data);
      if (data.length < 1000) break;
    }
    setLotUsage(new Map(lu.map((r) => [`${r.trade_id}|${r.period_start}|${r.period_end}`, r])));
    setLotCacheReady(true);
  }
  useEffect(() => { setLotCacheReady(false); loadMembers(); setPage(1); /* eslint-disable-next-line */ }, [brandId]);
  // เปลี่ยนช่วงที่เลือกให้นับ = อ่านแคชของช่วงใหม่ (ถ้าไม่มีก็จะตรวจสดให้เองด้านล่าง)
  useEffect(() => {
    if (!brandId) return;
    setLotCacheReady(false);
    loadMembers();
    // eslint-disable-next-line
  }, [lotMode, lotCustom.start, lotCustom.end]);
  useEffect(() => {
    if (!brandId) return;
    const ch = supabase.channel(`besight-members-${brandId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tv_access", filter: `brand_id=eq.${brandId}` }, () => loadMembers())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [brandId]);

  useEffect(() => { setQuotaDraft(brand ? String(brand.lot_quota_per_month ?? 3) : ""); }, [brand?.id, brand?.lot_quota_per_month]);

  // ประวัติ Lot ย้อนหลัง 5 เดือนของสมาชิกที่เปิดดูอยู่ — ดึงสดจาก broker ทีละเดือน (แล้ว backend cache ให้เอง)
  // ไม่โหลดล่วงหน้าทั้งตาราง เพราะต้องยิง broker แยกรายคน ถ้าโหลดทุกคนพร้อมกันจะช้าและโดน rate limit
  useEffect(() => {
    const tradeId = detailMember?.trade_id;
    if (!detailMember) { setLotHistory(null); return; }
    if (!tradeId) { setLotHistory({ months: [] }); return; }
    let stop = false;
    setLotHistory({ loading: true });
    (async () => {
      const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "lot_history", trade_id: tradeId, months: 5 } });
      if (stop) return;
      if (error || !data?.ok) { setLotHistory({ error: data?.error || (await readFunctionErrorMessage(error)) || "ดึงประวัติ Lot ไม่สำเร็จ" }); return; }
      setLotHistory({ months: data.months || [] });
    })();
    return () => { stop = true; };
  }, [detailMember?.key, detailMember?.trade_id]);

  const quota = Number(brand?.lot_quota_per_month) || 0;
  const scriptName = (pineId) => scripts.find((s) => s.pine_id === pineId)?.name || pineId;
  const lotInfoOf = (m) => (m?.trade_id ? lotUsage.get(lotKeyOf(m)) || null : null);
  const lotsOf = (m) => Number(lotInfoOf(m)?.lots ?? 0) || 0;
  const excludedLotsOf = (m) => Number(lotInfoOf(m)?.excluded_lots ?? 0) || 0;

  // จัดกลุ่ม tv_access ทีละแถว (หนึ่งแถวต่ออินดิเคเตอร์) ให้เหลือหนึ่งแถวต่อสมาชิกจริง
  const members = useMemo(() => {
    const byUsername = new Map();
    for (const r of rows) {
      const key = String(r.username || "").toLowerCase();
      if (!byUsername.has(key)) byUsername.set(key, []);
      byUsername.get(key).push(r);
    }
    return [...byUsername.entries()].map(([key, indicators]) => {
      const primary = pickPrimaryIndicator(indicators);
      return {
        key, primary, indicators, lot_period: lotPeriodOf(indicators, lotMode, lotCustom),
        username: primary.username, display_name: primary.display_name, email: primary.email,
        phone: primary.phone, country: primary.country, telegram: primary.telegram,
        trade_id: primary.trade_id, member_type: primary.member_type, contact_channel: primary.contact_channel,
        broker: primary.broker || "XM",
        granted_at: earliestOf(indicators, "granted_at") || primary.granted_at,
        created_at: earliestOf(indicators, "created_at") || primary.created_at,
      };
    });
  }, [rows, lotMode, lotCustom]);

  const filtered = members.filter((m) => {
    if (memberTypeFilter && m.member_type !== memberTypeFilter) return false;
    if (statusFilter && !m.indicators.some((r) => r.status === statusFilter)) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const hay = [m.display_name, m.username, m.email, m.trade_id, m.phone, m.telegram].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const { lotFetchedAt, lotStale } = useMemo(() => {
    let latest = 0, missing = 0, withTradeId = 0;
    for (const m of members) {
      if (!m.trade_id) continue;
      withTradeId++;
      const info = lotUsage.get(lotKeyOf(m));
      if (!info) { missing++; continue; }
      const t = info.fetched_at ? new Date(info.fetched_at).getTime() : 0;
      if (t > latest) latest = t;
    }
    const stale = withTradeId > 0 && (missing > 0 || !latest || Date.now() - latest > LOT_STALE_MS);
    return { lotFetchedAt: latest || null, lotStale: stale };
    // eslint-disable-next-line
  }, [members, lotUsage]);

  const passedCount = members.filter((m) => quota > 0 && lotsOf(m) >= quota).length;
  const notPassedCount = members.length - passedCount;
  const passedPct = members.length ? Math.round((passedCount / members.length) * 100) : 0;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function saveQuota() {
    if (!brand) return;
    setSavingQuota(true);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: {
      action: "save_brand", id: brand.id, name: brand.name, tv_base: brand.tv_base || "",
      pages: brand.pages || [], show_in_manager: brand.show_in_manager !== false, active: brand.active !== false,
      lot_quota_per_month: Number(quotaDraft) || 0,
    } });
    setSavingQuota(false);
    if (error || !data?.ok) { alert(data?.error || (await readFunctionErrorMessage(error)) || "บันทึกโควตาไม่สำเร็จ"); return; }
    load();
  }

  async function refreshLots({ auto = false } = {}) {
    setRefreshingLots(true);
    setLotMsg("");
    const fixed = fixedLotRange(lotMode, lotCustom);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: {
      action: "refresh_lots", brand_id: brandId,
      ...(fixed ? { period_start: fixed.start, period_end: fixed.end } : {}),
    } });
    setRefreshingLots(false);
    if (error || !data?.ok) {
      const msg = data?.error || (await readFunctionErrorMessage(error)) || "ตรวจ Lot ไม่สำเร็จ";
      setLotMsg(auto ? `ตรวจ Lot อัตโนมัติไม่สำเร็จ: ${msg}` : msg);
      return;
    }
    setLotMsg(
      `ตรวจแล้ว ${data.checked} คน (${data.periods} รอบสิทธิ์) — พบยอด Lot ${data.matched} คน` +
      (data.settled ? ` · ข้ามรอบที่ปิดแล้ว ${data.settled} คน` : "") +
      (data.failed_periods ? ` · ยิงไม่ผ่าน ${data.failed_periods} รอบ` : "")
    );
    if (!auto) logActivity("refresh_tv_lots", { brand_id: brandId, checked: data.checked, matched: data.matched });
    loadMembers();
  }

  // ตรวจสดให้เองถ้าค่าที่แคชเก่า/ยังไม่เคยตรวจรอบนี้ — กันเคสแอดมินเปิดหน้าแล้วเห็นยอดของเมื่อวาน
  // ยิงครั้งเดียวต่อแบรนด์/วัน (ถ้าล้มก็ไม่วนยิงซ้ำ ให้กดปุ่มเอง)
  const autoLotKeyRef = useRef("");
  useEffect(() => {
    if (!active || !brandId || !isAdmin || !lotCacheReady || refreshingLots || !lotStale) return;
    if (lotMode === "custom" && !fixedLotRange(lotMode, lotCustom)) return;   // ยังกรอกวันไม่ครบ
    const key = `${brandId}:${lotMode}:${lotCustom.start}:${lotCustom.end}:${thDay(new Date())}`;
    if (autoLotKeyRef.current === key) return;
    autoLotKeyRef.current = key;
    refreshLots({ auto: true });
    // eslint-disable-next-line
  }, [active, brandId, isAdmin, lotCacheReady, lotStale, lotMode, lotCustom.start, lotCustom.end]);

  function openAdd() { setForm({ ...emptyForm, pine_id: scripts[0]?.pine_id || "" }); setFormErr(""); setAddOpen(true); }

  async function submitAdd() {
    if (!form.username.trim()) { setFormErr("ต้องมี USER TradingView"); return; }
    if (!form.pine_id) { setFormErr("ต้องเลือก Indicator"); return; }
    setSaving(true); setFormErr("");
    // เช็คว่ามี username นี้อยู่จริงบน TradingView ก่อนยิงให้สิทธิ์ — เดิมข้ามขั้นนี้ไปเลย จึงเจอ
    // TradingView ตอบ 422 "User not found" ห้วน ๆ ตอน grant ทั้งที่รู้ได้ตั้งแต่ก่อนยิงจริง
    const { data: vu, error: vue } = await supabase.functions.invoke("tradingview", { body: { action: "validate_user", username: form.username.trim(), brand_id: brandId } });
    if (vue || !vu?.ok) { setSaving(false); setFormErr("เช็ค username ไม่สำเร็จ: " + (vu?.error || (vue ? "ลองใหม่" : ""))); return; }
    if (!vu.exists) {
      setSaving(false);
      setFormErr(`ไม่พบ user "${form.username.trim()}" บน TradingView — ตรวจตัวสะกด/ตัวพิมพ์เล็กใหญ่อีกครั้ง`);
      return;
    }
    const grantUname = vu.username || form.username.trim();
    const { data, error } = await supabase.functions.invoke("tradingview", { body: {
      action: "grant", username: grantUname, display_name: form.display_name.trim() || null,
      email: form.email.trim() || null, trade_id: form.trade_id.trim() || null,
      phone: form.phone.trim() || null, country: form.country.trim() || null, telegram: form.telegram.trim() || null,
      contact_channel: form.contact_channel || null, member_type: form.member_type || null, broker: form.broker || "XM",
      pine_ids: [form.pine_id], lifetime: form.lifetime, days: Number(form.days) || 30,
    } });
    setSaving(false);
    if (error || !data?.ok) {
      const failMsg = data?.results?.find((r) => !r.ok)?.error;
      setFormErr(failMsg || data?.error || (await readFunctionErrorMessage(error)) || "เพิ่มสมาชิกไม่สำเร็จ");
      return;
    }
    setAddOpen(false);
    setGrantSuccess({ username: data.username || grantUname, script: scriptName(form.pine_id) });
    loadMembers();
  }

  function openEdit(m) {
    setEditMember(m);
    setEditForm({
      username: m.username || "", display_name: m.display_name || "", email: m.email || "",
      trade_id: m.trade_id || "", phone: m.phone || "", country: m.country || "", telegram: m.telegram || "",
      contact_channel: m.contact_channel || "", member_type: m.member_type || "", broker: m.broker || "XM",
    });
  }

  // สมาชิกอาจมีหลายอินดิเคเตอร์ (หลายแถวใน tv_access) — ข้อมูลติดต่อ/แหล่งที่มา/ช่องทาง
  // เป็นของคนคนเดียวกัน จึงต้องอัปเดตทุกแถวพร้อมกัน ไม่ใช่แค่แถวเดียว ไม่งั้นข้อมูลจะไม่ตรงกันเอง
  async function submitEdit() {
    if (!editMember) return;
    setEditSaving(true);
    const payload = {
      action: "update_member", username: editForm.username.trim(), display_name: editForm.display_name.trim(),
      email: editForm.email.trim(), trade_id: editForm.trade_id.trim(), phone: editForm.phone.trim(),
      country: editForm.country.trim(), telegram: editForm.telegram.trim(),
      contact_channel: editForm.contact_channel, member_type: editForm.member_type, broker: editForm.broker || "XM",
    };
    let firstError = "";
    for (const row of editMember.indicators) {
      const { data, error } = await supabase.functions.invoke("tradingview", { body: { ...payload, id: row.id } });
      if (!firstError && (error || !data?.ok)) firstError = data?.error || (await readFunctionErrorMessage(error)) || "แก้ไขไม่สำเร็จ";
    }
    setEditSaving(false);
    if (firstError) { alert(firstError); return; }
    setEditMember(null);
    loadMembers();
  }

  async function revoke(a) {
    if (!confirm(`ถอนสิทธิ์ "${a.display_name || a.username}" ออกจาก ${scriptName(a.pine_id)}?`)) return;
    setBusyRow(a.id);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "revoke", username: a.username, pine_id: a.pine_id } });
    setBusyRow(null);
    if (error || !data?.ok) { alert(data?.error || (await readFunctionErrorMessage(error)) || "ถอนสิทธิ์ไม่สำเร็จ"); return; }
    loadMembers();
    setDetailMember((cur) => (cur ? { ...cur, indicators: cur.indicators.filter((r) => r.id !== a.id) } : cur));
  }

  function exportCsv() {
    const head = ["สมาชิก", "อีเมล", "Plan", "เบอร์โทร", "ประเทศ", "Broker", "Trade ID", "TradingView", "Telegram", "Indicator", "ช่วงที่นับ Lot", "Lots ใช้ไป", "Lots ที่ไม่นับ", "Lots โควตา", "สถานะสิทธิ์", "วันเริ่มต้น", "วันหมดอายุ", "วันที่เข้าร่วม", "ช่องทาง"];
    const lines = [head, ...filtered.map((m) => [
      m.display_name || "", m.email || "", memberTypeLabel(m.member_type), m.phone || "", m.country || "",
      m.broker, m.trade_id || "", m.username || "", m.telegram || "",
      m.indicators.map((r) => scriptName(r.pine_id)).join(" · "),
      `${m.lot_period.start} ถึง ${m.lot_period.end}`,
      lotsOf(m), excludedLotsOf(m), quota, statusInfo(m.primary).label,
      m.granted_at ? new Date(m.granted_at).toLocaleDateString("th-TH") : "",
      m.primary.expiration ? new Date(m.primary.expiration).toLocaleDateString("th-TH") : "ตลอดชีพ",
      m.created_at ? new Date(m.created_at).toLocaleDateString("th-TH") : "",
      channelLabel(m.contact_channel),
    ])];
    const csv = lines.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = `สมาชิก-${brand?.name || "indicator"}-${thDay(new Date())}.csv`; el.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        eyebrow="TRADINGVIEW"
        title={`จัดการสมาชิก Indicator ของ ${brand?.name || "..."}`}
        subtitle="ดูแลสิทธิ์ อินดิเคเตอร์ ข้อมูลติดต่อ และยอด Lot ที่เทรดจริงในรอบสิทธิ์ (วันเริ่มต้น → วันหมดอายุ) เทียบกับโควตา"
        right={brands.length > 1 && (
          <Select value={brandId ?? ""} onChange={(e) => setBrandId(Number(e.target.value))} className="w-44">
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="ds-card p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] text-slate-500 font-medium">Lot ที่ต้องจ่าย / รอบสิทธิ์ (ตั้งค่าได้)</div>
            <span className="rounded-control p-1.5 shrink-0 bg-brand-50 text-brand-600"><Gauge size={16} /></span>
          </div>
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <Input type="number" min={0} step="0.01" value={quotaDraft} onChange={(e) => setQuotaDraft(e.target.value)} className="w-28" />
              <Button size="sm" variant="secondary" loading={savingQuota} onClick={saveQuota}>บันทึก</Button>
            </div>
          ) : (
            <div className="ds-figure text-[26px] sm:text-[28px]">{quota.toFixed(2)}</div>
          )}
        </div>
        <StatCard icon={CheckCircle2} tone="green" label="สมาชิกที่ผ่านเกณฑ์ในรอบสิทธิ์" value={passedCount} sub={`${passedPct}%`} />
        <StatCard icon={XCircle} tone="red" label="สมาชิกที่ยังไม่ผ่านเกณฑ์" value={notPassedCount} />
      </div>

      <Card>
        <TradeIdChecker standalone />
      </Card>

      <Card
        title={`สมาชิก (${filtered.length})`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={refreshingLots} onClick={() => refreshLots()}>ตรวจ Lot ทุกคน</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv}>ส่งออก</Button>
            <Button size="sm" variant="primary" icon={Plus} onClick={openAdd}>เพิ่มสมาชิก</Button>
          </div>
        }
        bodyClassName="p-4 sm:p-5 space-y-3"
      >
        {/* เลือกช่วงที่จะนับ Lot — ค่าเริ่มต้นคือรอบเดือนของแต่ละคน (วันที่ได้สิทธิ์ → ครบเดือน)
            เลือกเป็นเดือนปฏิทินหรือกำหนดวันเองได้ เวลาแอดมินอยากเทียบยอดช่วงอื่น */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">ช่วงที่นับ Lot</span>
          <Select value={lotMode} onChange={(e) => setLotMode(e.target.value)} className="w-48">
            {LOT_MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
          {lotMode === "custom" && (
            <>
              <Input type="date" value={lotCustom.start} onChange={(e) => setLotCustom((c) => ({ ...c, start: beToCe(e.target.value) }))} className="w-40" />
              <span className="text-slate-400">ถึง</span>
              <Input type="date" value={lotCustom.end} onChange={(e) => setLotCustom((c) => ({ ...c, end: beToCe(e.target.value) }))} className="w-40" />
            </>
          )}
          {lotMode !== "cycle" && fixedLotRange(lotMode, lotCustom) && (
            <span className="text-slate-400">
              {dayLabel(fixedLotRange(lotMode, lotCustom).start)}–{dayLabel(fixedLotRange(lotMode, lotCustom).end)} (ทุกคนใช้ช่วงเดียวกัน)
            </span>
          )}
        </div>
        <div className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={lotStale && !refreshingLots ? "text-amber-600" : "text-slate-500"}>
            {refreshingLots
              ? "กำลังตรวจยอด Lot สดจาก broker…"
              : lotMode === "custom" && !fixedLotRange(lotMode, lotCustom)
                ? "เลือกวันเริ่มและวันสิ้นสุดให้ครบก่อน"
                : lotFetchedAt
                  ? `ยอด Lot ณ ${new Date(lotFetchedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}${lotStale ? " (เก่าแล้ว — กด “ตรวจ Lot ทุกคน”)" : ""}`
                  : "ยังไม่เคยตรวจยอด Lot ของช่วงนี้"}
          </span>
          {lotMsg && <span className="text-slate-500">{lotMsg}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput placeholder="ค้นหาชื่อ, อีเมล, Trade ID, TradingView, Telegram..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="flex-1 min-w-[220px]" />
          <FilterPill active={!memberTypeFilter} onClick={() => { setMemberTypeFilter(""); setPage(1); }}>ทุก Plan</FilterPill>
          {MEMBER_TYPES.map(([key, label]) => (
            <FilterPill key={key} active={memberTypeFilter === key} onClick={() => { setMemberTypeFilter(key); setPage(1); }}>{label}</FilterPill>
          ))}
          <FilterPill active={!statusFilter} onClick={() => { setStatusFilter(""); setPage(1); }}>สถานะทั้งหมด</FilterPill>
          {["active", "expired", "revoked"].map((key) => (
            <FilterPill key={key} active={statusFilter === key} onClick={() => { setStatusFilter(key); setPage(1); }}>{statusInfo({ status: key }).label}</FilterPill>
          ))}
        </div>

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : pageRows.length === 0 ? (
          <EmptyState title="ไม่มีสมาชิก" hint="ยังไม่มีสมาชิกตรงเงื่อนไขนี้" />
        ) : (
          <div className="overflow-x-auto -mx-4 sm:-mx-5">
            <table className="w-full text-sm min-w-[1400px]">
              <thead>
                <tr className="text-left text-2xs text-slate-400 border-b border-slate-100">
                  {["สมาชิก", "Plan", "เบอร์โทร", "ประเทศ", "Broker", "Trade ID", "TradingView", "Telegram", "Indicator", "Lots", "สถานะสิทธิ์", "วันเริ่มต้น", "วันหมดอายุ", "วันที่เข้าร่วม", "ช่องทาง", ""].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((m) => {
                  const st = statusInfo(m.primary);
                  const lots = lotsOf(m);
                  const excluded = excludedLotsOf(m);
                  const passed = quota > 0 && lots >= quota;
                  const extraCount = m.indicators.length - 1;
                  return (
                    <tr key={m.key} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-medium text-slate-800">{m.display_name || m.username}</div>
                        {m.email && <div className="text-2xs text-slate-400">{m.email}</div>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`text-2xs font-semibold px-2 py-0.5 rounded-full border ${PLAN_TONE[m.member_type] || PLAN_TONE.free}`}>{memberTypeLabel(m.member_type)}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{m.phone || "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{m.country || "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{m.broker}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{m.trade_id || "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{m.username}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{m.telegram || "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {extraCount > 0 ? (
                          <button onClick={() => setDetailMember(m)} className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                            {scriptName(m.primary.pine_id)} <span className="text-2xs text-slate-400">+{extraCount} ตัว</span>
                          </button>
                        ) : (
                          <span className="text-slate-600">{scriptName(m.primary.pine_id)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={passed ? "text-emerald-700 font-semibold" : "text-rose-600 font-semibold"}>{lots.toFixed(2)}</span>
                        <span className="text-slate-400"> / {quota.toFixed(2)}</span>
                        <div className="text-2xs text-slate-400" title={`นับ Lot ${m.lot_period.start} ถึง ${m.lot_period.end}${lotMode === "cycle" ? " (รอบเดือนของสมาชิกคนนี้ นับจากวันที่ได้สิทธิ์/ต่ออายุ)" : " (ช่วงที่แอดมินเลือก)"}`}>
                          {dayLabel(m.lot_period.start)}–{dayLabel(m.lot_period.end)}
                          {excluded > 0 && (
                            <span title="lot ที่ broker ไม่นับเพราะเทรดสัญลักษณ์ที่ไม่เข้าเงื่อนไข rebate — ยอดในแอป BeSight/MT5 ของลูกค้าจะมากกว่าช่องนี้อยู่เท่านี้">
                              {" · "}+{excluded.toFixed(2)} ไม่นับ
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`text-2xs font-semibold px-2 py-0.5 rounded-full border ${st.tone}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{m.granted_at ? new Date(m.granted_at).toLocaleDateString("th-TH") : "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{m.primary.expiration ? new Date(m.primary.expiration).toLocaleDateString("th-TH") : "ตลอดชีพ"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{m.created_at ? new Date(m.created_at).toLocaleDateString("th-TH") : "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{channelLabel(m.contact_channel)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => setDetailMember(m)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50" title="ดูรายละเอียด/อินดิเคเตอร์ทั้งหมด"><ListTree size={14} /></button>
                          <button onClick={() => openEdit(m)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50" title="แก้ไข"><Pencil size={14} /></button>
                          {m.indicators.length === 1 && (
                            <button onClick={() => revoke(m.primary)} disabled={busyRow === m.primary.id} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50" title="ถอนสิทธิ์">
                              {busyRow === m.primary.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
            <span>สมาชิก {filtered.length} คน</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"><ChevronLeft size={14} /></button>
              <span className="px-2">{page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={addOpen} title="เพิ่มสมาชิก" onClose={() => setAddOpen(false)}
        footer={<>
          <Button variant="secondary" onClick={() => setAddOpen(false)}>ยกเลิก</Button>
          <Button variant="primary" loading={saving} onClick={submitAdd}>บันทึก</Button>
        </>}>
        <div className="space-y-3">
          {formErr && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{formErr}</div>}
          <Field label="USER TradingView *"><Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} /></Field>
          <Field label="Indicator *">
            <Select value={form.pine_id} onChange={(e) => setForm((f) => ({ ...f, pine_id: e.target.value }))}>
              {scripts.map((s) => <option key={s.pine_id} value={s.pine_id}>{s.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ชื่อลูกค้า"><Input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} /></Field>
            <Field label="อีเมล"><Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
            <Field label="Broker">
              <Select value={form.broker} onChange={(e) => setForm((f) => ({ ...f, broker: e.target.value }))}>
                {BROKERS.map((b) => <option key={b} value={b}>{b}</option>)}
              </Select>
            </Field>
            <Field label="Trade ID"><Input value={form.trade_id} onChange={(e) => setForm((f) => ({ ...f, trade_id: e.target.value }))} /></Field>
            <Field label="เบอร์โทร"><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
            <Field label="ประเทศ"><Input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} /></Field>
            <Field label="Telegram"><Input value={form.telegram} onChange={(e) => setForm((f) => ({ ...f, telegram: e.target.value }))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan">
              <Select value={form.member_type} onChange={(e) => setForm((f) => ({ ...f, member_type: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {MEMBER_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                {/* ค่าจริงที่บันทึกคือ free เหมือน "Free" เป๊ะ — แค่ให้เลือกลัดตอนเพิ่มสมาชิกใหม่
                    ไม่ต้องนึกแปลว่า "ลูกค้าเก่า" ในระบบคือ Free (ไม่ใส่ในฟอร์มแก้ไข เพราะซ้ำกับ Free) */}
                <option value="free">ลูกค้าเก่า</option>
              </Select>
            </Field>
            <Field label="ช่องทาง">
              <Select value={form.contact_channel} onChange={(e) => setForm((f) => ({ ...f, contact_channel: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {CONTACT_CHANNELS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex items-end gap-3">
            <Field label="ระยะเวลา">
              <div className="flex items-center gap-2">
                <Input type="number" min={1} value={form.days} disabled={form.lifetime} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} className="w-24" />
                <span className="text-sm text-slate-500">วัน</span>
              </div>
            </Field>
            <label className="flex items-center gap-1.5 text-sm text-slate-600 pb-2.5">
              <input type="checkbox" checked={form.lifetime} onChange={(e) => setForm((f) => ({ ...f, lifetime: e.target.checked }))} /> ตลอดชีพ
            </label>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!editMember} title="แก้ไขข้อมูลสมาชิก" onClose={() => setEditMember(null)}
        description={editMember?.indicators.length > 1 ? `ใช้กับทั้ง ${editMember.indicators.length} อินดิเคเตอร์ของสมาชิกนี้` : undefined}
        footer={<>
          <Button variant="secondary" onClick={() => setEditMember(null)}>ยกเลิก</Button>
          <Button variant="primary" loading={editSaving} onClick={submitEdit}>บันทึก</Button>
        </>}>
        {editMember && (
          <div className="space-y-3">
            <Field label="USER TradingView"><Input value={editForm.username} onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ชื่อลูกค้า"><Input value={editForm.display_name} onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))} /></Field>
              <Field label="อีเมล"><Input value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} /></Field>
              <Field label="Broker">
                <Select value={editForm.broker} onChange={(e) => setEditForm((f) => ({ ...f, broker: e.target.value }))}>
                  {BROKERS.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              </Field>
              <Field label="Trade ID"><Input value={editForm.trade_id} onChange={(e) => setEditForm((f) => ({ ...f, trade_id: e.target.value }))} /></Field>
              <Field label="เบอร์โทร"><Input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
              <Field label="ประเทศ"><Input value={editForm.country} onChange={(e) => setEditForm((f) => ({ ...f, country: e.target.value }))} /></Field>
              <Field label="Telegram"><Input value={editForm.telegram} onChange={(e) => setEditForm((f) => ({ ...f, telegram: e.target.value }))} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plan">
                <Select value={editForm.member_type} onChange={(e) => setEditForm((f) => ({ ...f, member_type: e.target.value }))}>
                  <option value="">— ไม่ระบุ —</option>
                  {MEMBER_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </Field>
              <Field label="ช่องทาง">
                <Select value={editForm.contact_channel} onChange={(e) => setEditForm((f) => ({ ...f, contact_channel: e.target.value }))}>
                  <option value="">— ไม่ระบุ —</option>
                  {CONTACT_CHANNELS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </Field>
            </div>
          </div>
        )}
      </Dialog>

      {/* popup ยืนยันตอนเพิ่มสมาชิกสำเร็จ — เดิมปิดฟอร์มเงียบ ๆ ไม่บอกอะไรเลย */}
      <Dialog open={!!grantSuccess} title="เพิ่มสมาชิกสำเร็จ" onClose={() => setGrantSuccess(null)}
        footer={<Button variant="primary" onClick={() => setGrantSuccess(null)}>ตกลง</Button>}>
        {grantSuccess && (
          <div className="flex items-center gap-2 text-emerald-700">
            <PartyPopper size={20} />
            <span className="font-semibold">ให้สิทธิ์ {grantSuccess.username} ({grantSuccess.script}) แล้ว</span>
          </div>
        )}
      </Dialog>

      {/* รายละเอียดสมาชิก — โผล่เฉพาะตอนกด "ดูรายละเอียด" ในตาราง เห็นครบทุกอินดิเคเตอร์ของคนคนเดียวกัน
          (ตารางหลักโชว์แค่ตัว "หลัก" ตัวเดียวต่อแถว กันไม่ให้คนเดียวโผล่ซ้ำหลายบรรทัด) */}
      <Dialog open={!!detailMember} title={detailMember ? `อินดิเคเตอร์ของ ${detailMember.display_name || detailMember.username}` : ""} onClose={() => setDetailMember(null)}
        footer={<Button variant="secondary" onClick={() => setDetailMember(null)}>ปิด</Button>}>
        {detailMember && (
          <div className="space-y-3">
            {/* ประวัติ Lot ย้อนหลัง 5 เดือน — ดูได้ว่าเดือนไหนผ่านโควตาบ้าง (ใช้ตัดสินต่ออายุ/เลื่อนขั้น) */}
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-[13px] font-semibold text-slate-700">
                  ประวัติ Lot ย้อนหลัง 5 เดือน
                  <span className="ml-1 text-2xs font-normal text-slate-400">(แยกตามเดือนปฏิทิน ไม่ใช่รอบสิทธิ์)</span>
                </div>
                <span className="text-2xs text-slate-400">โควตา {quota.toFixed(2)} / รอบ</span>
              </div>
              {!detailMember.trade_id ? (
                <div className="text-xs text-slate-400">ยังไม่มี Trade ID — ดูยอด Lot ไม่ได้</div>
              ) : lotHistory?.loading ? (
                <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> กำลังดึงจาก broker…</div>
              ) : lotHistory?.error ? (
                <div className="text-xs text-rose-600">{lotHistory.error}</div>
              ) : (
                <div className="grid grid-cols-5 gap-1.5">
                  {(lotHistory?.months || []).map((mo) => {
                    const failed = mo.ok === false;
                    const passed = !failed && quota > 0 && mo.lots >= quota;
                    const excluded = Number(mo.excluded_lots) || 0;
                    return (
                      <div key={mo.start} className={`rounded-lg border px-2 py-1.5 text-center ${passed ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                        <div className="text-2xs text-slate-500">{new Date(`${mo.start}T00:00:00+07:00`).toLocaleDateString("th-TH", { month: "short", year: "2-digit" })}</div>
                        {failed ? (
                          <div className="text-sm font-semibold text-slate-400" title={mo.error || "ดึงจาก broker ไม่สำเร็จ"}>—</div>
                        ) : (
                          <div className={`text-sm font-semibold ${passed ? "text-emerald-700" : "text-slate-600"}`}>{Number(mo.lots).toFixed(2)}</div>
                        )}
                        {!failed && excluded > 0 && (
                          <div className="text-[10px] text-slate-400" title="lot ที่ไม่เข้าเงื่อนไข rebate">+{excluded.toFixed(2)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {detailMember.indicators.map((r) => {
              const st = statusInfo(r);
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800">{scriptName(r.pine_id)}</div>
                    <div className="text-2xs text-slate-500 mt-0.5">
                      หมดอายุ: {r.expiration ? new Date(r.expiration).toLocaleDateString("th-TH") : "ตลอดชีพ"}
                      {" · "}เริ่ม: {r.granted_at ? new Date(r.granted_at).toLocaleDateString("th-TH") : "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-2xs font-semibold px-2 py-0.5 rounded-full border ${st.tone}`}>{st.label}</span>
                    <button onClick={() => revoke(r)} disabled={busyRow === r.id} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50" title="ถอนสิทธิ์อินดิเคเตอร์นี้">
                      {busyRow === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              );
            })}
            {detailMember.indicators.length === 0 && <div className="text-sm text-slate-400 text-center py-4">ถอนสิทธิ์ครบทุกอินดิเคเตอร์แล้ว</div>}
          </div>
        )}
      </Dialog>
    </div>
  );
}
