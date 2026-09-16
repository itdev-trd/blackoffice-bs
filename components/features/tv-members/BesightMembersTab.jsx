"use client";

// จัดการสมาชิก Indicator ของแบรนด์เดียว (ค่าเริ่มต้น: BeSight) — ต่างจาก TvMembersTab.jsx ตรงที่
// หน้านี้โฟกัสแบรนด์เดียว โชว์ข้อมูลติดต่อ (เบอร์/ประเทศ/Telegram) และยอด Lot ที่เทรดจริงเทียบโควตา/เดือน
//
// "Lots" ดึงจาก broker (XM) ผ่าน edge function action "refresh_lots" (ปุ่ม "ตรวจ Lot ทุกคน")
// แล้ว cache ไว้ในตาราง tv_lot_usage — ไม่ดึงสดทุกครั้งที่เปิดหน้า เพราะ API คืนยอดทุกบัญชีมาทีเดียว
// ไม่กรองตาม trade_id (ยืนยันจากการทดสอบจริง) หน้านี้จึงอ่านค่าที่แคชไว้แทน จนกว่าจะกดรีเฟรช

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { hasFullData } from "@/lib/constants/roles";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { logActivity } from "@/lib/utils/activity";
import { TradeIdChecker } from "@/components/features/customerdb/CustomerDatabaseTab";
import {
  SectionTitle, StatCard, Button, Card, Dialog, SearchInput, FilterPill, Field, Input, Select, EmptyState,
} from "@/components/ui";
import {
  Gauge, CheckCircle2, XCircle, Plus, Download, RefreshCw, Loader2, Pencil, Trash2, ChevronLeft, ChevronRight, ListTree,
} from "lucide-react";

const MEMBER_TYPES = [["free", "Free"], ["paid", "จ่ายเงิน"], ["promotion", "โปรโมชั่น"]];
const memberTypeLabel = (v) => MEMBER_TYPES.find(([key]) => key === v)?.[1] || "—";
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

// เดือนปัจจุบัน (เวลาไทย) เป็นช่วงเริ่มต้นของการเช็ค Lot — ตรงกับที่แอดมินคุ้นเคย ("ปิดยอดรายเดือน")
function currentMonthRange() {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

const PAGE_SIZE = 10;
const emptyForm = { username: "", display_name: "", email: "", trade_id: "", phone: "", country: "", telegram: "", contact_channel: "", member_type: "", broker: "XM", pine_id: "", days: 30, lifetime: false };

export default function BesightMembersTab({ active = true }) {
  const [brands, setBrands] = useState([]);
  const [brandId, setBrandId] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [rows, setRows] = useState([]);
  const [lotUsage, setLotUsage] = useState(new Map()); // trade_id -> { lots, campaign_name, fetched_at }
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
  const { start: periodStart, end: periodEnd } = useMemo(() => currentMonthRange(), []);

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
    const [{ data: sc }, { data: ac }, { data: lu }] = await Promise.all([
      supabase.from("tv_scripts").select("pine_id, name").eq("brand_id", brandId).order("name"),
      supabase.from("tv_access").select("*").eq("brand_id", brandId).order("granted_at", { ascending: false }),
      supabase.from("tv_lot_usage").select("trade_id, lots, campaign_name, fetched_at").eq("period_start", periodStart).eq("period_end", periodEnd),
    ]);
    setScripts(sc || []);
    setRows(ac || []);
    setLotUsage(new Map((lu || []).map((r) => [String(r.trade_id), r])));
  }
  useEffect(() => { loadMembers(); setPage(1); /* eslint-disable-next-line */ }, [brandId]);
  useEffect(() => {
    if (!brandId) return;
    const ch = supabase.channel(`besight-members-${brandId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tv_access", filter: `brand_id=eq.${brandId}` }, () => loadMembers())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [brandId]);

  useEffect(() => { setQuotaDraft(brand ? String(brand.lot_quota_per_month ?? 3) : ""); }, [brand?.id, brand?.lot_quota_per_month]);

  const quota = Number(brand?.lot_quota_per_month) || 0;
  const scriptName = (pineId) => scripts.find((s) => s.pine_id === pineId)?.name || pineId;
  const lotsOf = (tradeId) => (tradeId ? lotUsage.get(String(tradeId))?.lots ?? 0 : 0);

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
        key, primary, indicators,
        username: primary.username, display_name: primary.display_name, email: primary.email,
        phone: primary.phone, country: primary.country, telegram: primary.telegram,
        trade_id: primary.trade_id, member_type: primary.member_type, contact_channel: primary.contact_channel,
        broker: primary.broker || "XM",
        granted_at: earliestOf(indicators, "granted_at") || primary.granted_at,
        created_at: earliestOf(indicators, "created_at") || primary.created_at,
      };
    });
  }, [rows]);

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
  const passedCount = members.filter((m) => lotsOf(m.trade_id) >= quota && quota > 0).length;
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

  async function refreshLots() {
    setRefreshingLots(true);
    setLotMsg("");
    const { data, error } = await supabase.functions.invoke("tradingview", { body: {
      action: "refresh_lots", period_start: periodStart, period_end: periodEnd, brand_id: brandId,
    } });
    setRefreshingLots(false);
    if (error || !data?.ok) { setLotMsg(data?.error || (await readFunctionErrorMessage(error)) || "ตรวจ Lot ไม่สำเร็จ"); return; }
    setLotMsg(`ตรวจแล้ว ${data.checked} คน — พบยอด Lot ${data.matched} คน`);
    logActivity("refresh_tv_lots", { brand_id: brandId, checked: data.checked, matched: data.matched });
    loadMembers();
  }

  function openAdd() { setForm({ ...emptyForm, pine_id: scripts[0]?.pine_id || "" }); setFormErr(""); setAddOpen(true); }

  async function submitAdd() {
    if (!form.username.trim()) { setFormErr("ต้องมี USER TradingView"); return; }
    if (!form.pine_id) { setFormErr("ต้องเลือก Indicator"); return; }
    setSaving(true); setFormErr("");
    const { data, error } = await supabase.functions.invoke("tradingview", { body: {
      action: "grant", username: form.username.trim(), display_name: form.display_name.trim() || null,
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
    const head = ["สมาชิก", "อีเมล", "แหล่ง", "เบอร์โทร", "ประเทศ", "Broker", "Trade ID", "TradingView", "Telegram", "Indicator", "Lots ใช้ไป", "Lots โควตา", "สถานะสิทธิ์", "วันเริ่มต้น", "วันหมดอายุ", "วันที่เข้าร่วม", "ช่องทาง"];
    const lines = [head, ...filtered.map((m) => [
      m.display_name || "", m.email || "", memberTypeLabel(m.member_type), m.phone || "", m.country || "",
      m.broker, m.trade_id || "", m.username || "", m.telegram || "",
      m.indicators.map((r) => scriptName(r.pine_id)).join(" · "),
      lotsOf(m.trade_id), quota, statusInfo(m.primary).label,
      m.granted_at ? new Date(m.granted_at).toLocaleDateString("th-TH") : "",
      m.primary.expiration ? new Date(m.primary.expiration).toLocaleDateString("th-TH") : "ตลอดชีพ",
      m.created_at ? new Date(m.created_at).toLocaleDateString("th-TH") : "",
      channelLabel(m.contact_channel),
    ])];
    const csv = lines.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = `สมาชิก-${brand?.name || "indicator"}-${periodStart}.csv`; el.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        eyebrow="TRADINGVIEW"
        title={`จัดการสมาชิก Indicator ของ ${brand?.name || "..."}`}
        subtitle="ดูแลสิทธิ์ อินดิเคเตอร์ ข้อมูลติดต่อ และยอด Lot ที่เทรดจริงเทียบกับโควตา/เดือน"
        right={brands.length > 1 && (
          <Select value={brandId ?? ""} onChange={(e) => setBrandId(Number(e.target.value))} className="w-44">
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="ds-card p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] text-slate-500 font-medium">Lot ที่ต้องจ่าย / เดือน (ตั้งค่าได้)</div>
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
        <StatCard icon={CheckCircle2} tone="green" label="สมาชิกที่ผ่านเกณฑ์เดือนนี้" value={passedCount} sub={`${passedPct}%`} />
        <StatCard icon={XCircle} tone="red" label="สมาชิกที่ยังไม่ผ่านเกณฑ์" value={notPassedCount} />
      </div>

      <Card>
        <TradeIdChecker standalone />
      </Card>

      <Card
        title={`สมาชิก (${filtered.length})`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={refreshingLots} onClick={refreshLots}>ตรวจ Lot ทุกคน</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv}>ส่งออก</Button>
            <Button size="sm" variant="primary" icon={Plus} onClick={openAdd}>เพิ่มสมาชิก</Button>
          </div>
        }
        bodyClassName="p-4 sm:p-5 space-y-3"
      >
        {lotMsg && <div className="text-xs text-slate-500">{lotMsg}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput placeholder="ค้นหาชื่อ, อีเมล, Trade ID, TradingView, Telegram..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="flex-1 min-w-[220px]" />
          <FilterPill active={!memberTypeFilter} onClick={() => { setMemberTypeFilter(""); setPage(1); }}>แหล่งทั้งหมด</FilterPill>
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
                  {["สมาชิก", "แหล่ง", "เบอร์โทร", "ประเทศ", "Broker", "Trade ID", "TradingView", "Telegram", "Indicator", "Lots", "สถานะสิทธิ์", "วันเริ่มต้น", "วันหมดอายุ", "วันที่เข้าร่วม", "ช่องทาง", ""].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((m) => {
                  const st = statusInfo(m.primary);
                  const lots = lotsOf(m.trade_id);
                  const passed = quota > 0 && lots >= quota;
                  const extraCount = m.indicators.length - 1;
                  return (
                    <tr key={m.key} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-medium text-slate-800">{m.display_name || m.username}</div>
                        {m.email && <div className="text-2xs text-slate-400">{m.email}</div>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-2xs font-semibold px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600">{memberTypeLabel(m.member_type)}</span>
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
            <Field label="แหล่งที่มา">
              <Select value={form.member_type} onChange={(e) => setForm((f) => ({ ...f, member_type: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {MEMBER_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
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
              <Field label="แหล่งที่มา">
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

      {/* รายละเอียดสมาชิก — โผล่เฉพาะตอนกด "ดูรายละเอียด" ในตาราง เห็นครบทุกอินดิเคเตอร์ของคนคนเดียวกัน
          (ตารางหลักโชว์แค่ตัว "หลัก" ตัวเดียวต่อแถว กันไม่ให้คนเดียวโผล่ซ้ำหลายบรรทัด) */}
      <Dialog open={!!detailMember} title={detailMember ? `อินดิเคเตอร์ของ ${detailMember.display_name || detailMember.username}` : ""} onClose={() => setDetailMember(null)}
        footer={<Button variant="secondary" onClick={() => setDetailMember(null)}>ปิด</Button>}>
        {detailMember && (
          <div className="space-y-2">
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
