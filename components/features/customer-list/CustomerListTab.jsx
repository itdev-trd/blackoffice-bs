"use client";

// รายชื่อลูกค้า — หน้าดูอย่างเดียว คอลัมน์ตรงกับชีตสรุปที่ทีมใช้อยู่
//
// ทำไมแยกจาก "จัดการลูกค้า": หน้านั้นเป็นเครื่องมือทำงาน (แก้ข้อมูล นำเข้า Excel เช็คไอดีเทรด
// ให้สิทธิ์ TradingView) ซึ่งมีปุ่มเยอะและกดผิดแล้วข้อมูลเปลี่ยน
// หน้านี้ตั้งใจให้เปิดดู/ส่งต่อ จึงไม่มีปุ่มที่เขียนข้อมูลเลย — เปิดผิดหน้าก็ไม่พัง
//
// สถานะอินดี้/วันเริ่ม/วันหมดอายุ อยู่คนละตาราง (tv_access) join ด้วย username ของ TradingView

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, FileDown, RefreshCw, ClipboardList } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { EmptyState } from "@/components/ui";
import Spinner from "@/components/shared/Spinner";

// คำที่ทีมใช้ในชีต ไม่ใช่ค่า stage ดิบในฐานข้อมูล
const SHEET_STATUS = {
  account_opened: "เปิดบัญชีแล้ว",
  converted: "เปิดบัญชีแล้ว",
  qualified: "สนใจ",
  new: "สนใจ",
  disqualified: "ไม่สนใจ",
};
const STATUS_STYLE = {
  "เปิดบัญชีแล้ว": "bg-emerald-100 text-emerald-700",
  "สนใจ": "bg-sky-100 text-sky-700",
  "ไม่สนใจ": "bg-slate-100 text-slate-600",
};

// วันที่ในรูปแบบ YYYY-MM-DD ตามเวลาไทย — ใช้เติมช่องวันที่จากปุ่มลัด
const thaiToday = (offsetDays = 0) => {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
};

const sheetDate = (t) => {
  if (!t) return "";
  try { const d = new Date(t); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; } catch { return ""; }
};

// ช่องนี้หมายถึง "ติดต่อกันทางไหน" — ไม่ใช่ ad/organic
const contactChannel = (r) => {
  const src = String(r.source || "");
  if (src === "line") return "LINE";
  if (src === "instagram") return "Instagram";
  if (src === "comment" || r.comment_is_ad) return "คอมเมนต์";
  if (src === "ad" || r.entry_ad_id) return `โฆษณา${r.entry_ad_name ? ` (${r.entry_ad_name})` : ""}`;
  return "Messenger";
};

const COLS = ["ลำดับ", "ชื่อ", "สถานะ", "เลขบัญชีเทรด", "อีเมล", "User TradingView", "สถานะอินดี้", "วันที่เริ่มใช้", "วันหมดอายุ", "ช่องทางการติดต่อ", "วันที่ติดต่อ"];

const DB_COLS = "id, customer_name, page_id, page_name, source, stage, stage_manual, trade_id, email, username, entry_ad_id, entry_ad_name, comment_is_ad, first_customer_message_at";

export default function CustomerListTab() {
  const [pages, setPages] = useState([]);
  const [pageFilter, setPageFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [tvByUser, setTvByUser] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // เพจใหญ่สุดมีลูกค้า 1,197 คน — เรนเดอร์พร้อมกันหมดทำให้หน้าหนักและเลื่อนหาอะไรไม่เจอ
  // แบ่งแสดงทีละ 50 · ตัวนับสรุปกับปุ่ม CSV ยังคิดจากผลลัพธ์ทั้งหมด ไม่ใช่แค่หน้าที่เห็น
  const PER_PAGE = 50;
  const [page, setPage] = useState(1);
  // ช่วงวันแบ่งเป็นสองชั้นตามที่ใช้งานจริง:
  //   loadFrom/loadTo = ดึงจากฐานข้อมูลแค่ช่วงนี้ (ยิงใหม่ทุกครั้งที่เปลี่ยน)
  //   viewFrom/viewTo = ย่อดูเฉพาะบางช่วงจากที่โหลดมาแล้ว ไม่ต้องรอโหลดใหม่
  // ทั้งคู่อิง first_customer_message_at = "วันที่ทักเข้ามาครั้งแรก" ไม่ใช่แชทล่าสุด
  // เพราะโจทย์คือแยกลูกค้าเก่า/ใหม่ ถ้าใช้แชทล่าสุด ลูกค้าเก่าที่เพิ่งทักกลับจะกลายเป็นลูกค้าใหม่
  const [loadFrom, setLoadFrom] = useState("");
  const [loadTo, setLoadTo] = useState("");
  const [viewFrom, setViewFrom] = useState("");
  const [viewTo, setViewTo] = useState("");

  // page_lead_config เก็บแต่เพจ Facebook — บัญชี LINE OA ต้องดึงจากแชทจริง ไม่งั้นเลือกไม่ได้
  useEffect(() => {
    (async () => {
      const [fb, line] = await Promise.all([
        supabase.from("page_lead_config").select("page_id, page_name").order("page_name"),
        supabase.from("chat_customers").select("page_id, page_name").eq("source", "line").limit(500),
      ]);
      const seen = new Map();
      for (const p of fb.data || []) seen.set(String(p.page_id), p.page_name || p.page_id);
      for (const p of line.data || []) {
        const id = String(p.page_id || "");
        if (id && !seen.has(id)) seen.set(id, `${p.page_name || id} (LINE OA)`);
      }
      setPages([...seen].map(([id, name]) => ({ id, name })));
    })();
  }, []);

  const load = useCallback(async () => {
    if (!pageFilter) return;
    setLoading(true); setError("");
    try {
      // ดึงเป็นก้อนละ 1000 จนหมด — ตารางลูกค้าต่อเพจไม่ได้ใหญ่ถึงขั้นต้องแบ่งหน้าในจอ
      let all = [], from = 0;
      for (let guard = 0; guard < 50; guard++) {
        let query = supabase
          .from("chat_customers").select(DB_COLS)
          .eq("page_id", pageFilter).is("blocked_at", null);
        // ระบุโซนเวลาไทยให้ชัด ไม่งั้นเบราว์เซอร์คนละโซนจะได้ขอบเขตวันไม่ตรงกัน
        if (loadFrom) query = query.gte("first_customer_message_at", `${loadFrom}T00:00:00+07:00`);
        if (loadTo) query = query.lte("first_customer_message_at", `${loadTo}T23:59:59+07:00`);
        const { data, error: e } = await query
          .order("first_customer_message_at", { ascending: false, nullsFirst: false })
          .range(from, from + 999);
        if (e) throw e;
        all = all.concat(data || []);
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      const { data: tv } = await supabase.from("tv_access").select("username, status, tv_granted_at, expiration");
      const map = new Map();
      for (const t of tv || []) { const k = String(t.username || "").toLowerCase(); if (k) map.set(k, t); }
      setTvByUser(map);
      setRows(all);
    } catch (e) {
      setError(e?.message || String(e));
      setRows([]);
    } finally { setLoading(false); }
  }, [pageFilter, loadFrom, loadTo]);

  useEffect(() => { if (pageFilter) load(); }, [pageFilter, load]);
  // เปลี่ยนตัวกรอง/คำค้นแล้วต้องกลับหน้า 1 ไม่งั้นค้างอยู่หน้า 12 ที่ไม่มีข้อมูลแล้ว
  useEffect(() => { setPage(1); }, [pageFilter, statusFilter, q, viewFrom, viewTo]);

  const view = useMemo(() => {
    const term = q.trim().toLowerCase();
    const vFrom = viewFrom ? new Date(`${viewFrom}T00:00:00+07:00`).getTime() : null;
    const vTo = viewTo ? new Date(`${viewTo}T23:59:59+07:00`).getTime() : null;
    return (rows || []).filter((r) => {
      const status = SHEET_STATUS[r.stage_manual || r.stage] || "สนใจ";
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (vFrom || vTo) {
        const t = r.first_customer_message_at ? new Date(r.first_customer_message_at).getTime() : null;
        if (t === null) return false;              // ไม่รู้วันทักครั้งแรก = ตอบไม่ได้ว่าอยู่ในช่วงไหม
        if (vFrom && t < vFrom) return false;
        if (vTo && t > vTo) return false;
      }
      if (!term) return true;
      return [r.customer_name, r.trade_id, r.email, r.username].some((v) => String(v || "").toLowerCase().includes(term));
    });
  }, [rows, q, statusFilter, viewFrom, viewTo]);

  const counts = useMemo(() => {
    const c = { total: (rows || []).length, opened: 0, withTrade: 0 };
    for (const r of rows || []) {
      if ((SHEET_STATUS[r.stage_manual || r.stage] || "") === "เปิดบัญชีแล้ว") c.opened++;
      if (r.trade_id) c.withTrade++;
    }
    return c;
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(view.length / PER_PAGE));
  const pageSafe = Math.min(page, totalPages);
  const start = (pageSafe - 1) * PER_PAGE;
  const pageRows = view.slice(start, start + PER_PAGE);

  const cellsOf = (r, i) => {
    const tv = tvByUser.get(String(r.username || "").toLowerCase());
    return [
      String(i + 1),
      r.customer_name || "",
      SHEET_STATUS[r.stage_manual || r.stage] || "สนใจ",
      r.trade_id || "",
      r.email || "",
      r.username || "",
      tv ? "เพิ่มแล้ว" : "",
      sheetDate(tv?.tv_granted_at),
      sheetDate(tv?.expiration),
      contactChannel(r),
      sheetDate(r.first_customer_message_at),
    ];
  };

  function exportCsv() {
    const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [COLS.map(esc).join(","), ...view.map((r, i) => cellsOf(r, i).map(esc).join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `รายชื่อลูกค้า_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">รายชื่อลูกค้า</h2>
        <p className="mt-1 text-sm text-slate-500">
          ดูรายชื่อลูกค้าในรูปแบบเดียวกับชีตสรุปที่ทีมใช้ · หน้านี้ดูอย่างเดียว ไม่มีการแก้ไขข้อมูล
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        {/* ทั้งสองชั้นอิง "วันที่ทักเข้ามาครั้งแรก" — เขียนกำกับไว้ให้ชัด
            เพราะถ้าเข้าใจว่าเป็นแชทล่าสุด จะแปลผลลูกค้าเก่า/ใหม่ผิดทั้งหมด */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pageFilter}
            onChange={(e) => setPageFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm min-w-[220px]"
          >
            <option value="">— เลือกเพจ / บัญชี —</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">สถานะ: ทั้งหมด</option>
            <option value="สนใจ">สนใจ</option>
            <option value="เปิดบัญชีแล้ว">เปิดบัญชีแล้ว</option>
            <option value="ไม่สนใจ">ไม่สนใจ</option>
          </select>
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหา ชื่อ / เลขบัญชี / อีเมล / TradingView"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <button
            onClick={load}
            disabled={!pageFilter || loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} รีเฟรช
          </button>
          <button
            onClick={exportCsv}
            disabled={!view.length}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <FileDown size={15} /> ดาวน์โหลด CSV
          </button>
        </div>

        <div className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-medium text-slate-600">1 · ช่วงที่ดึงจากฐานข้อมูล</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <input type="date" value={loadFrom} onChange={(e) => setLoadFrom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]" />
              <span className="text-slate-400">–</span>
              <input type="date" value={loadTo} onChange={(e) => setLoadTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]" />
              {(loadFrom || loadTo) && (
                <button onClick={() => { setLoadFrom(""); setLoadTo(""); }} className="text-[12px] text-slate-500 underline">ล้าง</button>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[["7 วัน", 7], ["30 วัน", 30], ["90 วัน", 90]].map(([lbl, d]) => (
                <button key={lbl} onClick={() => { setLoadFrom(thaiToday(-d)); setLoadTo(thaiToday(0)); }}
                  className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] hover:border-slate-400">{lbl}</button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">เปลี่ยนแล้วโหลดใหม่จากฐานข้อมูล</p>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-600">2 · ย่อดูเฉพาะช่วง (ไม่โหลดใหม่)</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <input type="date" value={viewFrom} onChange={(e) => setViewFrom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]" />
              <span className="text-slate-400">–</span>
              <input type="date" value={viewTo} onChange={(e) => setViewTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]" />
              {(viewFrom || viewTo) && (
                <button onClick={() => { setViewFrom(""); setViewTo(""); }} className="text-[12px] text-slate-500 underline">ล้าง</button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">กรองจากข้อมูลที่โหลดมาแล้ว เห็นผลทันที</p>
          </div>
          <p className="text-[11px] text-slate-500 sm:col-span-2">
            ทั้งสองช่องนับจาก <b className="text-slate-700">วันที่ลูกค้าทักเข้ามาครั้งแรก</b> ไม่ใช่วันที่คุยล่าสุด — ใช้แยกลูกค้าเก่ากับลูกค้าใหม่
          </p>
        </div>

        {rows && rows.length > 0 && (
          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
            <span>ทั้งหมด <b className="text-slate-900">{counts.total}</b> คน</span>
            <span>เปิดบัญชีแล้ว <b className="text-emerald-700">{counts.opened}</b> คน</span>
            <span>มีเลขบัญชีเทรด <b className="text-slate-900">{counts.withTrade}</b> คน</span>
            {/* ต้องนับตัวกรองวันด้วย ไม่งั้นย่อดูช่วงวันแล้วบรรทัดนี้ยังบอกยอดเต็ม ทำให้เข้าใจผิด */}
            {q || statusFilter !== "all" || viewFrom || viewTo ? <span>· แสดง <b className="text-slate-900">{view.length}</b> คนตามตัวกรอง</span> : null}
          </div>
        )}
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">โหลดไม่สำเร็จ: {error}</div>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {!pageFilter ? (
          <EmptyState icon={ClipboardList} title="เลือกเพจหรือบัญชีก่อน" hint="เลือกจากช่องด้านบน แล้วระบบจะโหลดรายชื่อลูกค้าให้" />
        ) : rows === null || loading ? (
          <div className="p-6"><Spinner label="กำลังโหลดรายชื่อ..." /></div>
        ) : view.length === 0 ? (
          <EmptyState icon={Search} title="ไม่พบรายชื่อ" hint="ลองล้างคำค้นหรือเปลี่ยนตัวกรองสถานะ" />
        ) : (
          <>
          {/* จอเล็ก: ตาราง 11 คอลัมน์เลื่อนซ้ายขวาอ่านยากมาก เปลี่ยนเป็นการ์ดต่อคนแทน
              จอ lg ขึ้นไปค่อยใช้ตาราง เพราะเทียบข้ามคนได้ง่ายกว่า */}
          <ul className="divide-y divide-slate-100 lg:hidden">
            {pageRows.map((r, i) => {
              const c = cellsOf(r, start + i);
              const detail = [
                ["เลขบัญชีเทรด", c[3]], ["อีเมล", c[4]], ["User TradingView", c[5]],
                ["สถานะอินดี้", c[6]], ["วันที่เริ่มใช้", c[7]], ["วันหมดอายุ", c[8]],
              ].filter(([, v]) => v);
              return (
                <li key={r.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] tabular-nums text-slate-400">{c[0]}</span>
                        <span className="font-medium text-slate-900 break-words">{c[1] || "—"}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{c[9]} · ติดต่อ {c[10] || "—"}</div>
                    </div>
                    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[c[2]] || "bg-slate-100 text-slate-600"}`}>{c[2]}</span>
                  </div>
                  {detail.length > 0 && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      {detail.map(([k, v]) => (
                        <div key={k} className="min-w-0">
                          <dt className="text-[10px] text-slate-500">{k}</dt>
                          <dd className="truncate text-[12px] text-slate-800" title={v}>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1050px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[12px] text-slate-600">
                  {COLS.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2.5 font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => {
                  const cells = cellsOf(r, start + i);
                  return (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                      {cells.map((v, ci) => (
                        <td key={ci} className={`px-3 py-2.5 ${ci === 0 ? "tabular-nums text-slate-500" : "text-slate-700"} ${ci === 1 ? "font-medium text-slate-900" : ""}`}>
                          {ci === 2 ? (
                            <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[v] || "bg-slate-100 text-slate-600"}`}>{v}</span>
                          ) : v || <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3.5 py-3">
              <span className="text-[12px] text-slate-600">
                แสดง {start + 1}–{Math.min(start + PER_PAGE, view.length)} จาก {view.length} คน
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((n) => Math.max(1, n - 1))}
                  disabled={pageSafe <= 1}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
                >
                  ก่อนหน้า
                </button>
                <span className="px-1 text-[12px] tabular-nums text-slate-600">หน้า {pageSafe} / {totalPages}</span>
                <button
                  onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                  disabled={pageSafe >= totalPages}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {rows && rows.length > 0 && tvByUser.size === 0 && (
        <p className="text-[12px] text-slate-500">
          หมายเหตุ: ช่อง “สถานะอินดี้ / วันที่เริ่มใช้ / วันหมดอายุ” ยังว่าง เพราะยังไม่มีข้อมูลสิทธิ์ TradingView ในระบบ — ซิงก์จากหน้า จัดการลูกค้า › TradingView ก่อน ค่าถึงจะขึ้น
        </p>
      )}
    </div>
  );
}
