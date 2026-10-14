"use client";

// ตรวจ Lot + ต่อ Indicator อัตโนมัติ — ย้ายจาก besight-dashboard-main (หน้า CRM › แคมเปญ)
// แต่ใช้ข้อมูลของระบบนี้: สมาชิก = tv_access (username TradingView) · เกณฑ์ = โควตาเฉพาะราย > โควตาแบรนด์
// ยอด lot มาจาก webhook ai.besight.net ตัวเดียวกับปุ่ม "ตรวจ Lot ทุกคน" ในหน้าสมาชิก Indicator
// งานหนักอยู่ที่ edge function tradingview (action lot_check / lot_overview) · ประวัติอ่านตรงจาก tv_lot_checks (RLS แท็บ tv_members)

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { Button, Field, Input, Badge, Tabs, Toggle, EmptyState } from "@/components/ui";
import { Search, BarChart3, History, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react";

const PERIODS = [
  { value: "cycle", label: "รอบเดือนของสมาชิก", hint: "นับตามวันเริ่มสิทธิ์ เช่น เริ่ม 10 ก.พ. → 10 ก.พ.–10 มี.ค. · ต่ออัตโนมัติได้เฉพาะช่วงนี้" },
  { value: "entitlement", label: "ทั้งช่วงสิทธิ์", hint: "ตั้งแต่วันเริ่มสิทธิ์ถึงวันหมดอายุ — ดูอย่างเดียว" },
  { value: "month", label: "เดือนนี้", hint: "วันที่ 1 ถึงสิ้นเดือนปัจจุบัน — ดูอย่างเดียว" },
  { value: "custom", label: "กำหนดเอง", hint: "เลือกช่วงวันที่เอง — ดูอย่างเดียว" },
];
const PERIOD_LABEL = Object.fromEntries(PERIODS.map((p) => [p.value, p.label]));

async function callTv(body) {
  const { data, error } = await supabase.functions.invoke("tradingview", { body });
  if (error || !data?.ok) throw new Error(data?.error || (await readFunctionErrorMessage(error)) || "ทำรายการไม่สำเร็จ");
  return data;
}

const fmtLots = (n, d = 2) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDay = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "—");
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const isoDay = (d) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000));

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-control px-3.5 py-3" style={{ background: "var(--ground)" }}>
      <div className="text-xs" style={{ color: "var(--ink-3)" }}>{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums" style={{ color: tone || "var(--ink)" }}>{value}</div>
    </div>
  );
}

// ---------------- ตรวจ Lot ----------------
function CheckPanel({ onChecked }) {
  const [tradeId, setTradeId] = useState("");
  const [period, setPeriod] = useState("cycle");
  const [range, setRange] = useState({ from: daysAgo(30), to: isoDay(new Date()) });
  const [autoRenew, setAutoRenew] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const grantable = period === "cycle";

  const run = async () => {
    if (!tradeId) { setErr("ใส่ Trade ID ก่อน"); return; }
    setBusy(true); setErr("");
    try {
      const d = await callTv({
        action: "lot_check", trade_id: tradeId, period, dry_run: dryRun || !grantable, auto_renew: autoRenew && grantable,
        ...(period === "custom" ? { date_from: range.from, date_to: range.to } : {}),
      });
      setRes(d);
      if (!d.dry_run) onChecked?.();
    } catch (e) { setErr(e.message); setRes(null); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="ds-card p-4 space-y-3.5">
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium" style={{ color: "var(--ink-2)" }}>ช่วงที่ตรวจ</div>
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map((p) => (
              <button key={p.value} type="button" onClick={() => setPeriod(p.value)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium transition"
                style={period === p.value
                  ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }
                  : { borderColor: "var(--line)", color: "var(--ink-2)" }}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-xs" style={{ color: "var(--ink-3)" }}>{PERIODS.find((p) => p.value === period)?.hint}</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] items-end">
          <Field label="Trade ID">
            <Input value={tradeId} inputMode="numeric" placeholder="เช่น 17416988"
              onChange={(e) => setTradeId(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") run(); }} />
          </Field>
          {period === "custom" ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="ตั้งแต่"><Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></Field>
              <Field label="ถึง"><Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></Field>
            </div>
          ) : (
            <Field label="ช่วงวันที่ (ระบบคิดจากสิทธิ์ของสมาชิก)">
              <div className="rounded-control border px-3 py-2.5 text-sm tabular-nums" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
                {res && res.period === period ? `${fmtDay(res.date_from)} – ${fmtDay(res.date_to)}` : "กดตรวจเพื่อดูช่วงของสมาชิก"}
              </div>
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2.5 text-[12.5px]" title={grantable ? "" : "ต่ออัตโนมัติได้เฉพาะรอบเดือนของสมาชิก"}>
            <Toggle checked={autoRenew && grantable} disabled={!grantable} onChange={setAutoRenew} label="ต่อ Indicator อัตโนมัติ" />
            <span className="text-2xs" style={{ color: "var(--ink-3)" }}>{grantable ? "เมื่อ Lot ถึงเกณฑ์ · +1 เดือน" : "เฉพาะรอบเดือนของสมาชิก"}</span>
          </label>
          <label className="flex items-center gap-2.5 text-[12.5px]">
            <Toggle checked={dryRun} onChange={setDryRun} label="Dry-run" />
            <span className="text-2xs" style={{ color: "var(--ink-3)" }}>ดูผลก่อน ไม่บันทึก ไม่ต่ออายุ</span>
          </label>
          <Button variant="primary" icon={Search} loading={busy} onClick={run} className="ml-auto">ตรวจ Lot</Button>
        </div>
        {err && <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--bad)" }}><AlertTriangle size={13} /> {err}</div>}
      </div>

      {res && (
        <div className="space-y-3">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <Stat label="Lot รวมสมาชิก (ทุกบัญชี)" value={fmtLots(res.total_lots, 4)} />
            <Stat label={`เกณฑ์ที่ต้องผ่าน${res.quota_source === "override" ? " (เฉพาะราย)" : res.quota_source === "brand" ? " (ของแบรนด์)" : ""}`} value={res.quota != null ? fmtLots(res.quota) : "—"} />
            <Stat label={`ผลตรวจ${res.dry_run ? " (ดูอย่างเดียว)" : ""}`}
              value={res.qualified == null ? (res.member ? "ไม่มีเกณฑ์" : "ไม่พบสมาชิก") : res.qualified ? "ผ่าน" : "ยังไม่ผ่าน"}
              tone={res.qualified ? "var(--ok)" : res.qualified === false ? "var(--warn)" : undefined} />
          </div>

          <div className="ds-card p-3.5 flex items-start gap-2.5 text-[13px]" style={{ color: "var(--ink-2)" }}>
            {res.renewed > 0 ? <CheckCircle2 size={18} style={{ color: "var(--ok)" }} className="shrink-0" /> : <AlertTriangle size={18} style={{ color: "var(--ink-3)" }} className="shrink-0" />}
            <div className="min-w-0 space-y-1">
              <div style={{ color: "var(--ink)" }}>
                <b>{res.member ? (res.member.display_name || res.member.usernames.join(", ")) : "ไม่พบ Trade ID นี้ในสมาชิก Indicator"}</b>
                {res.member && <span style={{ color: "var(--ink-3)" }}> · TV: {res.member.usernames.join(", ")}</span>}
                <span style={{ color: "var(--ink-3)" }}> · {fmtDay(res.date_from)} – {fmtDay(res.date_to)}</span>
              </div>
              <div>{res.renewed > 0 ? `ต่ออายุ ${res.renewed} Indicator แล้ว (+1 เดือน)` : res.skipped || "บันทึกผลตรวจแล้ว"}</div>
              {res.excluded_lots > 0 && <div className="text-xs" style={{ color: "var(--ink-3)" }}>+{fmtLots(res.excluded_lots)} lot ไม่นับ (สัญลักษณ์นอกเงื่อนไข rebate)</div>}
            </div>
          </div>

          {res.renewals?.length > 0 && (
            <div className="ds-card p-3.5">
              <div className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>ผลการต่ออายุ</div>
              {res.renewals.map((r) => (
                <div key={r.pine_id} className="flex items-center gap-2 py-1.5 text-[12.5px]" style={{ borderTop: "1px solid var(--line)" }}>
                  {r.ok ? <CheckCircle2 size={14} style={{ color: "var(--ok)" }} /> : <XCircle size={14} style={{ color: r.already ? "var(--ink-3)" : "var(--bad)" }} />}
                  <span className="font-medium" style={{ color: "var(--ink)" }}>{r.name}</span>
                  <span className="ml-auto text-xs" style={{ color: "var(--ink-3)" }}>
                    {r.ok ? `${fmtDT(r.old_expiration)} → ${fmtDT(r.new_expiration)}` : r.error}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="ds-card p-3.5">
              <div className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>ยอดแยกตามบัญชี</div>
              <table className="w-full text-[12.5px] tabular-nums">
                <thead><tr className="text-xs" style={{ color: "var(--ink-3)" }}><th className="py-1 text-left font-medium">Trade ID</th><th className="text-left font-medium">Campaign</th><th className="text-right font-medium">Lots</th><th className="text-right font-medium">ไม่นับ</th></tr></thead>
                <tbody>
                  {res.by_account.map((a) => (
                    <tr key={a.trade_id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td className="py-1.5 font-mono">{a.trade_id}</td>
                      <td className="truncate max-w-[140px]" style={{ color: "var(--ink-3)" }}>{a.campaign_name || "—"}</td>
                      <td className="text-right font-semibold" style={{ color: "var(--ink)" }}>{fmtLots(a.lots, 4)}</td>
                      <td className="text-right" style={{ color: "var(--ink-3)" }}>{a.excluded_lots ? fmtLots(a.excluded_lots) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ds-card p-3.5">
              <div className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Indicator ของสมาชิก</div>
              {!res.indicators?.length && <div className="text-xs" style={{ color: "var(--ink-3)" }}>—</div>}
              {res.indicators?.map((i) => (
                <div key={i.pine_id} className="flex items-center gap-2 py-1.5 text-[12.5px]" style={{ borderTop: "1px solid var(--line)" }}>
                  <span className="font-medium truncate" style={{ color: "var(--ink)" }}>{i.name}</span>
                  <Badge tone={i.status === "active" ? "green" : i.status === "revoked" ? "slate" : "gold"}>{i.status}</Badge>
                  <span className="ml-auto text-xs" style={{ color: "var(--ink-3)" }}>{i.expiration ? `หมดอายุ ${fmtDT(i.expiration)}` : "ตลอดชีพ"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- ภาพรวม Lot ทั้งระบบ ----------------
function OverviewPanel() {
  const [range, setRange] = useState({ from: daysAgo(60), to: isoDay(new Date()) });
  const [tab, setTab] = useState("campaigns");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const load = async () => {
    setBusy(true); setErr("");
    try { setData(await callTv({ action: "lot_overview", date_from: range.from, date_to: range.to })); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const rows = data?.[tab] || [];
  const total = rows.reduce((s, r) => s + r.lots, 0);
  return (
    <div className="space-y-3">
      <div className="ds-card p-4 flex flex-wrap items-end gap-3">
        <Field label="ตั้งแต่"><Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></Field>
        <Field label="ถึง"><Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></Field>
        <div className="text-xs pb-2.5" style={{ color: "var(--ink-3)" }}>รวมทุกบัญชีใต้ IB — ไม่ใช่ของ Trade ID ใดโดยเฉพาะ</div>
        <Button variant="primary" icon={BarChart3} loading={busy} onClick={load} className="ml-auto">ดึงภาพรวม</Button>
        {err && <div className="w-full text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
      </div>
      {data && (
        <div className="ds-card p-3.5 space-y-3">
          <Tabs value={tab} onChange={setTab} items={[
            { value: "campaigns", label: "Campaign", count: data.campaigns.length },
            { value: "countries", label: "Country", count: data.countries.length },
            { value: "symbols", label: "Symbol นอก List", count: data.symbols.length },
          ]} />
          {rows.length === 0 ? <EmptyState title="ไม่พบข้อมูลในช่วงวันที่นี้" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] tabular-nums">
                <thead><tr className="text-xs" style={{ color: "var(--ink-3)" }}>
                  {tab !== "countries" && <th className="py-1 text-left font-medium">Campaign</th>}
                  {tab === "symbols" && <th className="text-left font-medium">Login ID</th>}
                  {tab === "countries" && <th className="py-1 text-left font-medium">Country</th>}
                  {tab === "symbols" && <th className="text-left font-medium">Instrument</th>}
                  <th className="text-right font-medium">Lots</th><th className="w-[30%] pl-3 text-left font-medium">สัดส่วน</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                      {tab !== "countries" && <td className="py-1.5">{r.campaign_name || "—"}</td>}
                      {tab === "symbols" && <td className="font-mono">{r.login_id || "—"}</td>}
                      {tab === "countries" && <td className="py-1.5">{r.country || "—"}</td>}
                      {tab === "symbols" && <td className="font-mono">{r.instrument || "—"}</td>}
                      <td className="text-right font-semibold" style={{ color: "var(--ink)" }}>{fmtLots(r.lots)}</td>
                      <td className="pl-3"><span className="block h-1.5 rounded-full" style={{ width: `${total ? Math.max(2, (r.lots / total) * 100) : 0}%`, background: "var(--brand)" }} /></td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "1px solid var(--line)" }}>
                    <td colSpan={tab === "symbols" ? 3 : 1} className="py-1.5 text-xs font-semibold" style={{ color: "var(--ink-3)" }}>รวม</td>
                    <td className="text-right font-bold" style={{ color: "var(--ink)" }}>{fmtLots(total)}</td><td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- ประวัติการตรวจ ----------------
function HistoryPanel({ refreshKey }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => {
    setErr("");
    let query = supabase.from("tv_lot_checks").select("id, trade_id, username, period, date_from, date_to, total_lots, quota, qualified, renewed, skipped, checked_by, created_at").order("created_at", { ascending: false }).limit(100);
    const term = q.trim();
    if (/^\d+$/.test(term)) query = query.eq("trade_id", term);
    else if (term) query = query.ilike("username", `%${term}%`);
    const { data, error } = await query;
    if (error) { setErr(error.message); setRows([]); return; }
    setRows(data || []);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [refreshKey]);
  return (
    <div className="space-y-3">
      <div className="ds-card p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 max-w-sm">
          <Field label="ค้นหา (Trade ID / user TradingView)">
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(); }} placeholder="เช่น 17416988" />
          </Field>
        </div>
        <Button icon={RefreshCw} onClick={load} className="ml-auto">ดึงประวัติ</Button>
        {err && <div className="w-full text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
      </div>
      {rows && rows.length === 0 && <EmptyState title="ยังไม่มีประวัติการตรวจ" hint="ตรวจ Lot (ที่ไม่ใช่ dry-run) จะถูกบันทึกไว้ที่นี่" />}
      {rows && rows.length > 0 && (
        <div className="ds-card overflow-x-auto">
          <table className="w-full min-w-[820px] text-[12.5px] tabular-nums">
            <thead><tr className="text-xs" style={{ color: "var(--ink-3)", background: "var(--ground)" }}>
              <th className="px-3 py-2 text-left font-medium">ตรวจเมื่อ</th><th className="text-left font-medium">สมาชิก</th><th className="text-left font-medium">Trade ID</th>
              <th className="text-left font-medium">ช่วงที่ตรวจ</th><th className="text-right font-medium">Lots / เกณฑ์</th><th className="px-3 text-left font-medium">ผล</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="px-3 py-2">{fmtDT(r.created_at)}<div className="text-2xs" style={{ color: "var(--ink-3)" }}>{String(r.checked_by || "").split("@")[0]}</div></td>
                  <td>{r.username || "—"}</td>
                  <td className="font-mono">{r.trade_id}</td>
                  <td>{fmtDay(r.date_from)} – {fmtDay(r.date_to)}<div className="text-2xs" style={{ color: "var(--ink-3)" }}>{PERIOD_LABEL[r.period] || r.period}</div></td>
                  <td className="text-right"><b style={{ color: "var(--ink)" }}>{fmtLots(r.total_lots)}</b> <span style={{ color: "var(--ink-3)" }}>/ {r.quota != null ? fmtLots(r.quota) : "—"}</span></td>
                  <td className="px-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={r.qualified ? "green" : r.qualified === false ? "gold" : "slate"}>{r.qualified ? "ผ่าน" : r.qualified === false ? "ยังไม่ผ่าน" : "—"}</Badge>
                      {r.renewed > 0 && <Badge tone="brand">ต่อแล้ว {r.renewed}</Badge>}
                    </div>
                    {!r.renewed && r.skipped && <div className="mt-0.5 max-w-[260px] truncate text-2xs" title={r.skipped} style={{ color: "var(--ink-3)" }}>{r.skipped}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function LotCheckTab() {
  const [tab, setTab] = useState("check");
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab} items={[
        { value: "check", label: "ตรวจ Lot", icon: Search },
        { value: "overview", label: "ภาพรวม Lot ทั้งระบบ", icon: BarChart3 },
        { value: "history", label: "ประวัติการตรวจ", icon: History },
      ]} />
      {tab === "check" && <CheckPanel onChecked={() => setRefreshKey((k) => k + 1)} />}
      {tab === "overview" && <OverviewPanel />}
      {tab === "history" && <HistoryPanel refreshKey={refreshKey} />}
    </div>
  );
}
