"use client";

// ตารางแบบ Ads Manager — ไล่ดู แคมเปญ → ชุดโฆษณา → โฆษณา พร้อมตัวเลขจริงจาก Meta
// ปิด/เปิดได้ในตาราง (ผ่าน apply-ad-change ซึ่งเป็นประตูเดียวที่แตะบัญชีจริง)
// ทั้ง 3 ระดับใช้ renderer เดียวกัน เพราะ list-campaigns กับ list-children คืน shape metrics ตรงกัน
//
// ตั้งใจให้ "ดูข้อมูล + ปิด/เปิด" เท่านั้น — แก้กลุ่มเป้าหมาย/ครีเอทีฟ/งบ ยังต้องไป Ads Manager
// (Ads Manager มีระบบยืนยันหลายชั้นที่เลียนแบบไม่ได้ครบ ทำครึ่งๆ อันตรายกว่าไม่ทำ)

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, ChevronRight, Play, Pause, AlertTriangle, ChevronLeft, ExternalLink,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";

const RANGES = [
  ["today", "วันนี้"],
  ["yesterday", "เมื่อวาน"],
  ["last_7d", "7 วัน"],
  ["last_30d", "30 วัน"],
  ["last_90d", "90 วัน"],
  ["maximum", "ทั้งหมด"],
];

// สถานะที่ Meta ส่งกลับมีหลายสิบค่า จัดกลุ่มให้อ่านรู้เรื่อง
const STATUS_LABEL = {
  ACTIVE: ["กำลังแสดง", "text-emerald-700 bg-emerald-50 border-emerald-200"],
  PAUSED: ["หยุดชั่วคราว", "text-slate-600 bg-slate-100 border-slate-200"],
  CAMPAIGN_PAUSED: ["แคมเปญหยุดอยู่", "text-slate-600 bg-slate-100 border-slate-200"],
  ADSET_PAUSED: ["ชุดโฆษณาหยุดอยู่", "text-slate-600 bg-slate-100 border-slate-200"],
  IN_PROCESS: ["กำลังตรวจ", "text-amber-700 bg-amber-50 border-amber-200"],
  PENDING_REVIEW: ["รอ Meta ตรวจ", "text-amber-700 bg-amber-50 border-amber-200"],
  DISAPPROVED: ["ถูกปฏิเสธ", "text-rose-700 bg-rose-50 border-rose-200"],
  WITH_ISSUES: ["มีปัญหา", "text-rose-700 bg-rose-50 border-rose-200"],
  DELETED: ["ลบแล้ว", "text-slate-400 bg-slate-50 border-slate-200"],
  ARCHIVED: ["เก็บถาวร", "text-slate-400 bg-slate-50 border-slate-200"],
};
function statusChip(effective) {
  const [label, cls] = STATUS_LABEL[effective] || [effective || "-", "text-slate-600 bg-slate-100 border-slate-200"];
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}

const baht = (n) => (n || n === 0 ? `฿${Math.round(n).toLocaleString()}` : "—");
const int = (n) => (n || n === 0 ? Math.round(n).toLocaleString() : "—");
const pct = (n) => (n || n === 0 ? `${n.toFixed(2)}%` : "—");
const money2 = (n) => (n || n === 0 ? `฿${n.toFixed(2)}` : "—");

// แคมเปญยิงให้คนทักแชทวัดผลด้วย "จำนวนบทสนทนา" แคมเปญเก็บลีดวัดด้วย "ลีด"
// เลือกคอลัมน์ผลลัพธ์ให้ตรงกับสิ่งที่แคมเปญนั้นซื้อ ไม่งั้นเห็น "—" แล้วเข้าใจผิดว่าไม่มีผล
function resultOf(m) {
  if (!m) return { label: "—", value: null, cost: null };
  if (m.leads > 0) return { label: "ลีด", value: m.leads, cost: m.cpl };
  if (m.conversations > 0) {
    return { label: "บทสนทนา", value: m.conversations, cost: m.conversations > 0 ? m.spend / m.conversations : null };
  }
  if (m.link_clicks > 0) return { label: "คลิกลิงก์", value: m.link_clicks, cost: m.link_clicks > 0 ? m.spend / m.link_clicks : null };
  return { label: "—", value: null, cost: null };
}

const LEVELS = {
  campaign: { title: "แคมเปญ", child: "adsets", childTitle: "ชุดโฆษณา" },
  adsets: { title: "ชุดโฆษณา", child: "ads", childTitle: "โฆษณา" },
  ads: { title: "โฆษณา", child: null, childTitle: null },
};

export default function AdsTable() {
  // อ่าน ad account จาก settings เอง — ไม่ต้องส่ง prop ผ่าน page → tab หลายชั้น
  const [adAccountId, setAdAccountId] = useState(undefined); // undefined = ยังไม่รู้, "" = ยังไม่ตั้ง
  useEffect(() => {
    supabase
      .from("settings")
      .select("value")
      .eq("key", "campaign_defaults")
      .maybeSingle()
      .then(({ data }) => setAdAccountId(String(data?.value?.ad_account_id || "").trim()));
  }, []);
  const [range, setRange] = useState("last_30d");
  // เส้นทางที่เจาะลงมา: [] = ระดับแคมเปญ, [{id,name}] = อยู่ในแคมเปญนั้น (ดูชุดโฆษณา), 2 ชั้น = ดูโฆษณา
  const [path, setPath] = useState([]);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [fetchedAt, setFetchedAt] = useState(null);

  const level = path.length === 0 ? "campaign" : path.length === 1 ? "adsets" : "ads";

  const load = useCallback(
    async (opts = {}) => {
      if (!adAccountId) return;
      setLoading(true);
      setError("");
      const body = { date_preset: range, ...(opts.refresh ? { refresh: true } : {}) };
      const { data, error: fnErr } =
        path.length === 0
          ? await supabase.functions.invoke("list-campaigns", { body: { ad_account_id: adAccountId, ...body } })
          : await supabase.functions.invoke("list-children", {
              body: { level: path.length === 1 ? "adsets" : "ads", parent_id: path[path.length - 1].id, ...body },
            });
      setLoading(false);
      if (fnErr || data?.ok === false) {
        setError(fnErr ? await readFunctionErrorMessage(fnErr) : data?.error || "ดึงข้อมูลไม่สำเร็จ");
        setRows([]);
        return;
      }
      setRows(data?.campaigns || data?.nodes || []);
      setFetchedAt(data?.fetched_at || null);
    },
    [adAccountId, range, path]
  );

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(row) {
    const turningOn = row.status !== "ACTIVE";
    const levelName = LEVELS[level].title;
    if (!confirm(`ยืนยัน${turningOn ? "เปิด" : "หยุด"}${levelName} "${row.name}" บน Meta จริง?`)) return;
    setBusyId(row.id);
    setError("");
    const { data, error: fnErr } = await supabase.functions.invoke("apply-ad-change", {
      // apply-ad-change ใช้ target_id/target_type (ไม่ใช่ node_id/level) และบังคับสิทธิ์ admin ฝั่ง server
      body: {
        action: turningOn ? "resume" : "pause",
        target_id: row.id,
        target_type: level === "campaign" ? "campaign" : level === "adsets" ? "adset" : "ad",
      },
    });
    setBusyId("");
    if (fnErr || data?.ok === false) {
      setError(fnErr ? await readFunctionErrorMessage(fnErr) : data?.error || "เปลี่ยนสถานะไม่สำเร็จ");
      return;
    }
    // อ่านค่าจริงกลับจาก Meta ไม่เดาสถานะเอง — กันกรณี Meta ปรับเป็นอย่างอื่น (เช่น ติดรีวิว)
    load({ refresh: true });
  }

  if (adAccountId === undefined) {
    return (
      <div className="ds-card flex items-center justify-center gap-2 p-10 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" /> กำลังโหลดการตั้งค่า…
      </div>
    );
  }

  if (!adAccountId) {
    return (
      <div className="ds-card p-5">
        <div className="flex items-start gap-2.5 text-sm text-amber-700">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div>
            ยังไม่ได้ตั้ง <span className="font-medium">Ad Account ID</span> — ไปกรอกที่ ตั้งค่า → ค่าเริ่มต้นแคมเปญ ก่อน
          </div>
        </div>
      </div>
    );
  }

  const canDrill = !!LEVELS[level].child;
  const totals = (rows || []).reduce(
    (a, r) => ({
      spend: a.spend + (r.metrics?.spend || 0),
      impressions: a.impressions + (r.metrics?.impressions || 0),
    }),
    { spend: 0, impressions: 0 }
  );

  return (
    <div className="ds-card overflow-hidden">
      {/* แถบเครื่องมือ: เส้นทางที่เจาะลงมา + ช่วงวัน + รีเฟรช */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <button
            onClick={() => setPath([])}
            className={`shrink-0 font-semibold ${path.length === 0 ? "text-slate-800" : "text-brand-600 hover:underline"}`}
          >
            แคมเปญ
          </button>
          {path.map((p, i) => (
            <span key={p.id} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight size={14} className="shrink-0 text-slate-400" />
              <button
                onClick={() => setPath(path.slice(0, i + 1))}
                title={p.name}
                className={`max-w-[180px] truncate ${i === path.length - 1 ? "font-semibold text-slate-800" : "text-brand-600 hover:underline"}`}
              >
                {p.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-control border border-slate-200 bg-slate-100 p-1">
            {RANGES.map(([v, l]) => (
              <button
                key={v}
                onClick={() => setRange(v)}
                className={`rounded-control px-2.5 py-1 text-[12.5px] font-medium transition ${
                  range === v ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={() => load({ refresh: true })}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} รีเฟรช
          </button>
        </div>
      </div>

      {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</div>}

      {/* มือถือ: การ์ด / คอม: ตาราง */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[12px] text-slate-500">
              <th className="px-4 py-2.5 font-medium">เปิด/ปิด</th>
              <th className="px-3 py-2.5 font-medium">ชื่อ</th>
              <th className="px-3 py-2.5 font-medium">สถานะ</th>
              <th className="px-3 py-2.5 text-right font-medium">งบ/วัน</th>
              <th className="px-3 py-2.5 text-right font-medium">ผลลัพธ์</th>
              <th className="px-3 py-2.5 text-right font-medium">ต้นทุน/ผลลัพธ์</th>
              <th className="px-3 py-2.5 text-right font-medium">ใช้จ่ายไป</th>
              <th className="px-3 py-2.5 text-right font-medium">อิมเพรสชัน</th>
              <th className="px-3 py-2.5 text-right font-medium">CTR</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => {
              const res = resultOf(r.metrics);
              const on = r.status === "ACTIVE";
              return (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggle(r)}
                      disabled={busyId === r.id}
                      title={on ? "หยุดชั่วคราว" : "เปิดแสดง"}
                      className={`flex h-7 w-12 items-center rounded-full p-0.5 transition disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-slate-300"}`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}
                      >
                        {busyId === r.id ? (
                          <Loader2 size={12} className="animate-spin text-slate-500" />
                        ) : on ? (
                          <Play size={11} className="text-emerald-600" />
                        ) : (
                          <Pause size={11} className="text-slate-500" />
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="max-w-[260px] px-3 py-3">
                    <div className="flex items-center gap-2">
                      {r.thumbnail && <img src={r.thumbnail} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-800" title={r.name}>
                          {r.name}
                        </div>
                        {r.objective && <div className="text-[11px] text-slate-400">{r.objective}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">{statusChip(r.effective_status)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{baht(r.daily_budget_thb)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <div className="font-semibold text-slate-800">{int(res.value)}</div>
                    {res.value !== null && <div className="text-[11px] text-slate-400">{res.label}</div>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{money2(res.cost)}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-800">{baht(r.metrics?.spend)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{int(r.metrics?.impressions)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{pct(r.metrics?.ctr)}</td>
                  <td className="px-3 py-3 text-right">
                    {canDrill && (
                      <button
                        onClick={() => setPath([...path, { id: r.id, name: r.name }])}
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                      >
                        {LEVELS[level].childTitle} <ChevronRight size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows && rows.length > 0 && (
              <tr className="bg-slate-50 text-[12.5px] font-semibold text-slate-700">
                <td className="px-4 py-2.5" colSpan={6}>
                  รวม {rows.length} รายการ
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{baht(totals.spend)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{int(totals.impressions)}</td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* มือถือ */}
      <div className="divide-y divide-slate-100 md:hidden">
        {(rows || []).map((r) => {
          const res = resultOf(r.metrics);
          const on = r.status === "ACTIVE";
          return (
            <div key={r.id} className="p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">{r.name}</div>
                  <div className="mt-1">{statusChip(r.effective_status)}</div>
                </div>
                <button
                  onClick={() => toggle(r)}
                  disabled={busyId === r.id}
                  className={`flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-slate-300"}`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}>
                    {busyId === r.id ? <Loader2 size={12} className="animate-spin text-slate-500" /> : on ? <Play size={11} className="text-emerald-600" /> : <Pause size={11} className="text-slate-500" />}
                  </span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                <div><span className="text-slate-400">ใช้จ่ายไป</span> <span className="font-medium text-slate-800">{baht(r.metrics?.spend)}</span></div>
                <div><span className="text-slate-400">งบ/วัน</span> <span className="text-slate-700">{baht(r.daily_budget_thb)}</span></div>
                <div><span className="text-slate-400">{res.label}</span> <span className="font-medium text-slate-800">{int(res.value)}</span></div>
                <div><span className="text-slate-400">ต้นทุน/ผล</span> <span className="text-slate-700">{money2(res.cost)}</span></div>
                <div><span className="text-slate-400">อิมเพรสชัน</span> <span className="text-slate-700">{int(r.metrics?.impressions)}</span></div>
                <div><span className="text-slate-400">CTR</span> <span className="text-slate-700">{pct(r.metrics?.ctr)}</span></div>
              </div>
              {canDrill && (
                <button
                  onClick={() => setPath([...path, { id: r.id, name: r.name }])}
                  className="flex w-full items-center justify-center gap-1 rounded-lg border border-slate-300 py-2 text-xs font-medium text-brand-600"
                >
                  ดู{LEVELS[level].childTitle} <ChevronRight size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {loading && !rows && (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> กำลังดึงข้อมูลจาก Meta…
        </div>
      )}
      {rows && rows.length === 0 && !loading && (
        <div className="p-10 text-center text-sm text-slate-400">
          {path.length > 0 && (
            <button onClick={() => setPath(path.slice(0, -1))} className="mb-2 inline-flex items-center gap-1 text-brand-600 hover:underline">
              <ChevronLeft size={14} /> ย้อนกลับ
            </button>
          )}
          <div>ไม่มี{LEVELS[level].title}ในช่วงวันที่เลือก</div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
        <span>
          {fetchedAt ? `ข้อมูลเมื่อ ${new Date(fetchedAt).toLocaleString("th-TH")}` : ""}
          {" · แก้กลุ่มเป้าหมาย/ครีเอทีฟ/งบ ต้องทำใน Ads Manager"}
        </span>
        <a
          href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${String(adAccountId).replace(/^act_/, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-brand-600 hover:underline"
        >
          เปิดใน Ads Manager <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
