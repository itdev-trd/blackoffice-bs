"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Tv,
  RefreshCw,
  Upload,
  FileDown,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  X,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { beToCe, bangkokDate } from "@/lib/utils/date";
import { logActivity } from "@/lib/utils/activity";
import { lsGet, lsSet } from "@/lib/utils/storage";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { getCustomerDateRange } from "@/lib/customer-date-filter";
import Spinner from "@/components/shared/Spinner";
import { EmptyState, SearchInput, FilterPill } from "@/components/ui";
import { EditableCell } from "@/components/features/settings/SettingsTab";
import { CHAT_STAGES } from "@/lib/constants/settings";
import {
  customerDatabaseReportCache,
  getCustomerDatabaseViewCache,
  setCustomerDatabaseViewCache,
} from "@/lib/customerdb-cache";

// คีย์จำ "เพจ + ช่วงเวลา" ที่ดึงรายงานล่าสุด เพื่อโหลดให้อัตโนมัติในรอบถัดไป
const LAST_REPORT_KEY = "ui.customerdb.lastReport";

// standalone = อยู่ในการ์ดของตัวเอง จึงไม่ต้องมีเส้นคั่นด้านบน
// (เส้นนั้นมีไว้ตอนถูกวางต่อท้ายพาเนลข้อมูลลูกค้าในหน้าตอบแชท ถ้าติดมาด้วยจะกลายเป็นเส้นลอยไร้ที่มา)
export function TradeIdChecker({ darkMode = false, standalone = false }) {
  const [tid, setTid] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  async function check() {
    const id = tid.trim();
    if (!id || busy) return;
    setBusy(true); setRes(null);
    const { data, error } = await supabase.functions.invoke("verify-trade-id", { body: { trade_id: id } });
    setBusy(false);
    if (error || !data?.ok) { setRes({ error: data?.error || error?.message || "เช็คไม่สำเร็จ — อาจยังไม่ได้ deploy ฟังก์ชัน verify-trade-id" }); return; }
    setRes(data);
    logActivity("check_trade_id", { trade_id: id, pass: !!data.pass, via: data.via });
  }
  return (
    <div className={`${darkMode ? "chat-trade-checker" : ""} ${standalone ? "" : "border-t border-slate-200 pt-3 mt-1"} space-y-1.5`}>
      <label className="text-xs text-slate-400 flex items-center gap-1"><CheckCircle2 size={13} /> เช็คไอดีเทรด (XM)</label>
      <div className="flex gap-1.5">
        <input
          value={tid}
          onChange={(e) => { setTid(e.target.value); if (res) setRes(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") check(); }}
          inputMode="numeric" placeholder="วางเลขไอดีเทรด"
          className="flex-1 min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        <button onClick={check} disabled={busy || !tid.trim()}
          className="shrink-0 bg-brand-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
          {busy ? <Loader2 className="animate-spin" size={14} /> : null} เช็ค
        </button>
      </div>
      {res && (res.error
        ? <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{res.error}</div>
        : res.pass
          ? <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <div className="font-semibold flex items-center gap-1"><CheckCircle2 size={14} /> ไอดีผ่าน (เช็คจาก{res.via === "email" ? "อีเมล" : " API"})</div>
              {res.via === "email" && (res.platform || res.insertdate) && (
                <div className="text-[11px] text-emerald-600 mt-0.5">{[res.platform, res.insertdate].filter(Boolean).join(" · ")}</div>
              )}
            </div>
          : <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 font-medium flex items-center gap-1">
              <AlertTriangle size={14} /> เช็คทั้งสองช่องทางแล้วไม่ผ่าน
            </div>
      )}
    </div>
  );
}

// แอดมินป้อนข้อมูลลูกค้าเอง (ไอดีเทรด/TradingView/เบอร์/อีเมล) จากหน้าตอบแชท
// บันทึกผ่าน save-lead-fields → มาร์ค manual_data + ผู้ป้อน · AI/sync/webhook จะไม่แก้ทับ
// compact = เวอร์ชันย่อสำหรับกล่องตอบแชท ซึ่งพื้นที่จำกัดและมีแท็บบอกอยู่แล้วว่านี่คือ "ข้อมูลลูกค้า"
// จึงตัดหัวข้อซ้ำ ย่อคำอธิบาย และลดระยะห่าง — ที่อื่น (แผงขวา/หน้าจัดการลูกค้า) ยังเหมือนเดิม
export function CustomerDataForm({ row, onSaved, darkMode = false, compact = false }) {
  const [f, setF] = useState({ trade_id: "", username: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // {ok, text}
  // ให้ AI อ่านบทสนทนาแล้วเสนอว่าเลข/ข้อความไหนคืออะไร — เสนอเท่านั้น ไม่เติมลงช่องเองจนแอดมินกดรับ
  // regex แยกไม่ออกว่าเลขไหนคือเลขบัญชี เบอร์โทร หรือยอดเงิน แต่ AI อ่านบริบทได้
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState(null);     // { suggestion, evidence, confidence, note } | { error }
  // ฟีเจอร์ TV ในหน้าแชท — เห็นเฉพาะแอดมินจนกว่าจะกดปล่อย (settings.tv_features.released)
  const [tvOn, setTvOn] = useState(false);
  const [scripts, setScripts] = useState([]);
  const [pineIds, setPineIds] = useState([]);   // เลือก Indicator ได้หลายอัน
  // วันหมดอายุแยกต่อสคริปต์ — { [pine_id]: { mode, days, expDate } }
  const [dur, setDur] = useState({});
  const getDur = (pid) => dur[pid] || { mode: "days", days: 30, expDate: "" };
  const setDurFor = (pid, patch) => setDur((d) => ({ ...d, [pid]: { ...getDur(pid), ...patch } }));
  const toggleScript = (pid, on) => {
    setPineIds((cur) => on ? cur.filter((p) => p !== pid) : [...cur, pid]);
    if (!on) setDur((d) => (d[pid] ? d : { ...d, [pid]: { mode: "days", days: 30, expDate: "" } }));
  };
  const durLabel = (d) => d.mode === "lifetime" ? "ตลอดชีพ" : d.mode === "date" ? `ถึง ${d.expDate ? new Date(`${d.expDate}T00:00:00+07:00`).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}` : `${Number(d.days) || 30} วัน`;
  const todayTH = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const daysFromDate = (d) => { if (!d) return 0; const t = new Date(`${d}T23:59:59+07:00`).getTime(); return Math.max(1, Math.ceil((t - Date.now()) / 86400000)); };

  useEffect(() => {
    setF({ trade_id: row?.trade_id || "", username: row?.username || "", phone: row?.phone || "", email: row?.email || "" });
    setMsg(null);
    setAi(null);
  }, [row?.id, row?.trade_id, row?.username, row?.phone, row?.email]);

  // โหลด role + flag ปล่อยอัปเดต + สคริปต์ ครั้งเดียว
  // โหลด role + สถานะปล่อยอัปเดต (ครั้งเดียว)
  useEffect(() => {
    let stop = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      let admin = false;
      const email = u?.user?.email;
      if (email) { const { data: p } = await supabase.from("user_permissions").select("role").eq("email", email).maybeSingle(); admin = p?.role === "admin"; }
      const { data: tf } = await supabase.from("settings").select("value").eq("key", "tv_features").maybeSingle();
      if (stop) return;
      setTvOn(admin || tf?.value?.released === true);
    })();
    return () => { stop = true; };
  }, []);
  // โหลดสคริปต์ที่โชว์ได้ในเพจนี้ (ตามแบรนด์ที่ผูกเพจของแชท) — รีเฟรชเมื่อเปลี่ยนแชท/เพจ
  useEffect(() => {
    if (!tvOn) { setScripts([]); return; }
    let stop = false;
    (async () => {
      const [{ data: sc }, { data: br }] = await Promise.all([
        supabase.from("tv_scripts").select("*").order("created_at"),
        supabase.from("tv_brands").select("id, pages").eq("active", true),
      ]);
      if (stop) return;
      const pageId = String(row?.page_id || "");
      const allowed = new Set((br || []).filter((b) => Array.isArray(b.pages) && b.pages.map(String).includes(pageId)).map((b) => b.id));
      const list = (sc || []).filter((s) => allowed.has(s.brand_id));
      setScripts(list);
      setPineIds((cur) => cur.filter((p) => list.some((s) => s.pine_id === p)));
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvOn, row?.page_id]);

  // บันทึกลงฐานข้อมูลลูกค้า (save-lead-fields) — ใช้ซ้ำหลายเส้นทาง
  async function saveLeadFields(extraMsg) {
    const { data, error } = await supabase.functions.invoke("save-lead-fields", { body: { id: row.id, ...f } });
    if (error || !data?.ok) return { ok: false, error: data?.error || error?.message || "อาจยังไม่ได้ deploy save-lead-fields" };
    logActivity("save_lead_fields", { id: row.id, customer_name: row?.customer_name });
    onSaved?.({ trade_id: data.trade_id, username: data.username, phone: data.phone, email: data.email, manual_data: true, classified_by: "manual", needs_ai: false, needs_verify: false, manual_data_by: data.manual_data_by, manual_data_at: data.manual_data_at });
    return { ok: true };
  }

  async function save() {
    if (busy) return;
    const tradeId = f.trade_id.trim();
    const userTv = f.username.trim();
    setBusy(true); setMsg(null);

    // เส้นทางฟีเจอร์ TV (แอดมิน/ปล่อยแล้ว) และมีการป้อนไอดีเทรด/user TV
    if (tvOn && (tradeId || userTv)) {
      if (userTv && !tradeId) { setBusy(false); setMsg({ ok: false, text: "ต้องใส่ไอดีเทรดด้วยเมื่อจะเพิ่ม user TV" }); return; }
      if (userTv && !pineIds.length) { setBusy(false); setMsg({ ok: false, text: "เลือก Indicator (สคริปต์) อย่างน้อย 1 อัน" }); return; }
      if (userTv) { for (const pid of pineIds) { const d = getDur(pid); if (d.mode === "date" && (!d.expDate || d.expDate < todayTH)) { setBusy(false); setMsg({ ok: false, text: `เลือกวันหมดอายุของ "${scripts.find((s) => s.pine_id === pid)?.name || pid}" ให้ถูกต้องก่อน` }); return; } } }

      // 1) เช็คไอดีเทรด — ไม่ผ่าน = ไม่บันทึกอะไรเลย
      setMsg({ ok: true, text: "กำลังเช็คไอดีเทรด..." });
      const { data: vt, error: ve } = await supabase.functions.invoke("verify-trade-id", { body: { trade_id: tradeId } });
      if (ve || !vt?.ok) { setBusy(false); setMsg({ ok: false, text: "เช็คไอดีเทรดไม่สำเร็จ: " + (vt?.error || "ลองใหม่") }); return; }
      if (!vt.pass) { setBusy(false); setMsg({ ok: false, text: `ไอดีเทรด "${tradeId}" ไม่ผ่าน — ยังไม่บันทึก` }); return; }

      // 2) ไอดีเทรดผ่านแล้ว → บันทึกข้อมูลลูกค้าทันที ก่อนแตะ TradingView
      //
      // เดิมบันทึกเป็นขั้นสุดท้าย และถ้าให้สิทธิ์ TV ไม่สำเร็จจะ return ทิ้งไปเลย
      // ผลคือข้อมูลที่แอดมินอุตส่าห์กรอก/ให้ AI สแกนมา หายทั้งชุด ทั้งที่ไอดีเทรดผ่านแล้ว
      // (เจอจริง: ลูกค้า Patcharachot ไอดี 450137298 กรอกครบแต่ฐานข้อมูลยังว่าง เพราะ n8n ยังไม่ได้ตั้ง)
      // ข้อมูลลูกค้ากับสิทธิ์อินดิเคเตอร์เป็นคนละเรื่องกัน อันหลังล้มไม่ควรลากอันแรกไปด้วย
      setMsg({ ok: true, text: "ไอดีเทรดผ่าน — กำลังบันทึกข้อมูลลูกค้า..." });
      const saved = await saveLeadFields();
      if (!saved.ok) { setBusy(false); setMsg({ ok: false, text: "บันทึกข้อมูลลูกค้าไม่สำเร็จ: " + saved.error }); return; }

      // ไม่ได้ใส่ user TV = จบแค่บันทึก ไม่ต้องยุ่งกับสิทธิ์อินดิเคเตอร์
      if (!userTv) {
        setBusy(false);
        setMsg({ ok: true, text: "✓ ไอดีเทรดผ่าน + บันทึกลงฐานข้อมูลแล้ว (ไม่ได้เพิ่ม TV — ไม่ได้ใส่ user TV)" });
        return;
      }

      // 3) มี user TV → เช็ค user TV ก่อนให้สิทธิ์
      //    ตั้งแต่จุดนี้ไป ข้อมูลลูกค้าบันทึกแล้ว ล้มตรงไหนก็ไม่หาย
      setMsg({ ok: true, text: "บันทึกข้อมูลแล้ว — กำลังเช็ค user TV..." });
      const vBrandId = scripts.find((s) => s.pine_id === pineIds[0])?.brand_id || null;
      const { data: vu, error: vue } = await supabase.functions.invoke("tradingview", { body: { action: "validate_user", username: userTv, brand_id: vBrandId } });
      if (vue || !vu?.ok) { setBusy(false); setMsg({ ok: false, text: "✓ บันทึกข้อมูลลูกค้าแล้ว · แต่เช็ค user TV ไม่สำเร็จ: " + (vu?.error || "ลองใหม่") }); return; }
      if (!vu.exists) { setBusy(false); setMsg({ ok: false, text: `✓ บันทึกข้อมูลลูกค้าแล้ว · แต่ไม่พบ user TV "${userTv}" จึงยังไม่ได้ให้สิทธิ์` }); return; }

      // 4) ให้สิทธิ์ทีละสคริปต์ (แต่ละตัวใช้วันหมดอายุของตัวเอง)
      const summ = []; const fails = [];
      for (const pid of pineIds) {
        const d = getDur(pid);
        const expIso = d.mode === "date" && d.expDate ? new Date(`${beToCe(d.expDate)}T23:59:59+07:00`).toISOString() : null;
        const effDays = d.mode === "days" ? (Number(d.days) || 30) : 0;
        const name = scripts.find((s) => s.pine_id === pid)?.name || pid;
        setMsg({ ok: true, text: `กำลังเพิ่มสิทธิ์ "${name}"...` });
        const { data: g, error: ge } = await supabase.functions.invoke("tradingview", { body: {
          action: "grant", username: userTv, display_name: row?.customer_name || null, email: f.email.trim() || null,
          pine_ids: [pid], lifetime: d.mode === "lifetime", days: effDays, expiration: expIso, trade_id: tradeId,
        } });
        if (ge || !g?.ok) fails.push(`${name}: ${g?.error || g?.results?.[0]?.error || "ลองใหม่"}`);
        else summ.push(`${name} (${durLabel(d)})`);
      }
      if (summ.length) logActivity("tv_grant_from_chat", { id: row.id, username: userTv });
      setBusy(false);
      // ข้อมูลลูกค้าบันทึกไปแล้วแน่นอน จึงขึ้นต้นด้วย ✓ เสมอ แล้วค่อยบอกผลฝั่งสิทธิ์
      setMsg(
        summ.length && !fails.length
          ? { ok: true, text: `✓ บันทึกข้อมูลลูกค้า + เพิ่มสิทธิ์: ${summ.join(", ")}` }
          : summ.length
            ? { ok: true, text: `✓ บันทึกข้อมูลลูกค้า + เพิ่มสิทธิ์: ${summ.join(", ")} · ไม่สำเร็จ: ${fails.join(" · ")}` }
            : { ok: false, text: `✓ บันทึกข้อมูลลูกค้าแล้ว · แต่เพิ่มสิทธิ์ TV ไม่สำเร็จ: ${fails.join(" · ") || "ลองใหม่"}` }
      );      return;
    }

    // เส้นทางเดิม — บันทึกฐานข้อมูลตรงๆ
    const r = await saveLeadFields();
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "บันทึกแล้ว ✓ (ป้อนโดยแอดมิน — AI จะไม่แก้)" } : { ok: false, text: "บันทึกไม่สำเร็จ: " + r.error });
  }

  const inp = (k, label, ph) => (
    <div className="min-w-0">
      <label className="text-[11px] text-slate-400">{label}</label>
      <input value={f[k]} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} placeholder={ph}
        className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
    </div>
  );
  async function askAi() {
    if (!row?.id || aiBusy) return;
    setAiBusy(true); setAi(null); setMsg(null);
    const { data, error } = await supabase.functions.invoke("extract-customer-data", { body: { id: row.id } });
    setAiBusy(false);
    if (error || !data?.ok) { setAi({ error: data?.error || error?.message || "ให้ AI อ่านไม่สำเร็จ" }); return; }
    setAi(data);
  }

  // รับข้อเสนอทีละช่อง — ไม่เขียนลงฐานข้อมูล แค่เติมลงฟอร์มให้แอดมินตรวจแล้วกดบันทึกเอง
  const acceptOne = (field, value) => setF((cur) => ({ ...cur, [field]: value }));
  const acceptAll = () => {
    const sg = ai?.suggestion || {};
    setF((cur) => ({
      trade_id: sg.trade_id || cur.trade_id,
      username: sg.tv_username || cur.username,
      phone: sg.phone || cur.phone,
      email: sg.email || cur.email,
    }));
  };

  return (
    <div className={`${darkMode ? "chat-customer-form" : ""} ${compact ? "space-y-2" : "border-t border-slate-200 pt-3 mt-1 space-y-2"}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {compact ? (
          <span className="text-[11px] text-slate-500">
            {row?.manual_data && row?.manual_data_by ? `บันทึกโดย ${String(row.manual_data_by).split("@")[0]}` : "ยังไม่เคยบันทึก"}
          </span>
        ) : (
          <label className="text-xs font-medium text-slate-500 flex items-center gap-1"><CheckCircle2 size={13} /> ข้อมูลลูกค้า (แอดมินป้อนเอง)</label>
        )}
        <div className="flex items-center gap-2">
          {!compact && row?.manual_data && row?.manual_data_by && (
            <span className="text-[10px] text-emerald-600 font-medium">✓ ป้อนโดย {String(row.manual_data_by).split("@")[0]}</span>
          )}
          <button type="button" onClick={askAi} disabled={aiBusy || !row?.id}
            title="ให้ AI อ่านบทสนทนาแล้วเสนอว่าเลขไหนคือเลขบัญชี อีเมล หรือ username TradingView"
            className="inline-flex items-center gap-1 rounded-full border border-brand-400/50 px-2 py-0.5 text-[10.5px] font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50">
            {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} สแกนด้วย AI
          </button>
        </div>
      </div>

      {/* ข้อเสนอจาก AI — ต้องกดรับก่อนถึงจะลงช่อง และยังต้องกด "บันทึกข้อมูล" อีกที
          ไม่เขียนอะไรเองเลย เพราะระบบสกัดอัตโนมัติเคยทำข้อมูลลูกค้าเพี้ยนมาก่อน */}
      {/* AI ใช้เวลาอ่านราว 8-10 วินาที เดิมระหว่างนั้นไม่มีอะไรขึ้นเลยนอกจากสปินเนอร์ 11px ในปุ่ม
          คนกดแล้วเห็นหน้าจอนิ่งจึงสรุปว่าปุ่มเสีย แล้วกดซ้ำ — ต้องมีที่ว่างบอกสถานะให้ชัด */}
      {aiBusy && (
        <div className="flex items-center gap-2 rounded-lg border border-brand-400/40 bg-brand-50/40 p-2.5 text-[11px] text-slate-600">
          <Loader2 size={13} className="animate-spin text-brand-600" />
          กำลังให้ AI อ่านบทสนทนา… ใช้เวลาประมาณ 10 วินาที
        </div>
      )}

      {ai && !aiBusy && (
        <div className="rounded-lg border border-brand-400/40 bg-brand-50/40 p-2.5 space-y-1.5">
          {ai.error ? (
            <div className="text-[11px] text-rose-600">{ai.error}</div>
          ) : !ai.suggestion || !Object.values(ai.suggestion).some(Boolean) ? (
            /* อ่านสำเร็จแต่ไม่เจออะไร — เดิมจะขึ้นกล่องเปล่าที่มีแค่หัวข้อ ดูเหมือนค้าง */
            <div className="text-[11px] text-slate-600">
              AI อ่านแล้วแต่ไม่พบไอดีเทรด อีเมล หรือ User TradingView ในบทสนทนานี้
              {ai.note && <div className="mt-1 text-[10.5px] text-slate-500">{ai.note}</div>}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-600">AI เสนอ (ยังไม่บันทึก)</span>
                <button type="button" onClick={acceptAll} className="text-[10.5px] font-semibold text-brand-600 hover:underline">
                  รับทั้งหมด
                </button>
              </div>
              {[["trade_id", "ไอดีเทรด", "trade_id"], ["email", "อีเมล", "email"], ["tv_username", "User TV", "username"], ["phone", "เบอร์โทร", "phone"]]
                .filter(([k]) => ai.suggestion?.[k])
                .map(([k, label, formKey]) => (
                  <div key={k} className="flex items-start justify-between gap-2 text-[11px]">
                    <div className="min-w-0">
                      <span className="text-slate-400">{label}: </span>
                      <span className="font-mono font-semibold text-slate-700">{ai.suggestion[k]}</span>
                      {ai.confidence?.[k] != null && (
                        <span className={`ml-1 ${Number(ai.confidence[k]) >= 0.8 ? "text-emerald-600" : "text-amber-600"}`}>
                          ({Math.round(Number(ai.confidence[k]) * 100)}%)
                        </span>
                      )}
                      {ai.evidence?.[k] && (
                        <div className="truncate text-[10px] text-slate-400" title={ai.evidence[k]}>จาก: “{ai.evidence[k]}”</div>
                      )}
                    </div>
                    <button type="button" onClick={() => acceptOne(formKey, ai.suggestion[k])}
                      className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-white">
                      ใส่
                    </button>
                  </div>
                ))}
              {!Object.values(ai.suggestion || {}).some(Boolean) && (
                <div className="text-[11px] text-slate-400">AI ไม่พบข้อมูลที่มั่นใจในบทสนทนานี้</div>
              )}
              {ai.note && <div className="text-[10px] text-slate-400">หมายเหตุ: {ai.note}</div>}
            </>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {inp("trade_id", "ไอดีเทรด", "เลขบัญชีเทรด")}
        {inp("username", "User TradingView", "username TV")}
        {inp("phone", "เบอร์โทร", "เบอร์โทร")}
        {inp("email", "อีเมล", "อีเมล")}
      </div>

      {/* ตัวเลือก TV (เหมือนหน้าจัดการสมาชิก TV) — เห็นเฉพาะแอดมินจนกว่าจะปล่อย */}
      {tvOn && (
        <div className="rounded-lg border border-slate-300 p-2.5 space-y-2">
          <div className="text-[11px] font-semibold text-slate-600 flex items-center gap-1"><Tv size={12} /> เพิ่มสิทธิ์ TradingView</div>
          <div>
            <label className="text-[11px] text-slate-400">เลือกสคริปต์ที่จะให้สิทธิ์</label>
            <div className="mt-0.5 rounded-lg border border-slate-300 divide-y divide-slate-100 max-h-60 overflow-y-auto bg-white">
              {scripts.length === 0 && <div className="px-2 py-1.5 text-sm text-slate-400">ยังไม่มีสคริปต์</div>}
              {scripts.map((s) => {
                const on = pineIds.includes(s.pine_id);
                const d = getDur(s.pine_id);
                return (
                  <div key={s.pine_id} className={on ? "bg-brand-50/40" : ""}>
                    <label className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={on} onChange={() => toggleScript(s.pine_id, on)} />
                      <span className="truncate flex-1">{s.name}</span>
                      {on && <span className="text-[10px] text-slate-400 shrink-0">{durLabel(d)}</span>}
                    </label>
                    {on && (
                      <div className="px-2 pb-2 pl-7 space-y-1">
                        <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[12px]">
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "lifetime"} onChange={() => setDurFor(s.pine_id, { mode: "lifetime" })} /> ตลอดชีพ</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "days"} onChange={() => setDurFor(s.pine_id, { mode: "days" })} /> จำกัดวัน</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "date"} onChange={() => setDurFor(s.pine_id, { mode: "date" })} /> เลือกวัน</label>
                        </div>
                        {d.mode === "days" && <input type="number" min={1} value={d.days} onChange={(e) => setDurFor(s.pine_id, { days: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm" />}
                        {d.mode === "date" && <input type="date" value={d.expDate} min={todayTH} onChange={(e) => setDurFor(s.pine_id, { expDate: beToCe(e.target.value) })} className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {pineIds.length > 0 && <div className="text-[11px] text-slate-400 mt-0.5">เลือกแล้ว {pineIds.length} สคริปต์</div>}
          </div>
        </div>
      )}

      <button onClick={save} disabled={busy} className="w-full rounded-lg bg-emerald-700 text-white px-3 py-2 text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50 flex items-center justify-center gap-1.5">
        {busy ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />} บันทึกข้อมูล
      </button>
      {msg && <div className={`text-[11px] whitespace-pre-line ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</div>}
    </div>
  );
}


// ---------------------------------------------------------------
// ฐานข้อมูลลูกค้า — ตารางข้อมูลที่ซิงก์มา (ค้นหา + filter + เรียงลำดับ + export)
// ---------------------------------------------------------------
const SOURCE_LABELS = { ad: "โฆษณา", organic: "ออร์แกนิก", unknown: "ไม่ทราบ" };

export default function CustomerDatabaseTab({ onOpenChat }) {
  const initialViewRef = useRef(getCustomerDatabaseViewCache());
  const initialView = initialViewRef.current;
  const [rows, setRows] = useState(() => initialView?.rows ?? null);   // เฉพาะแถวของหน้าปัจจุบัน (server-side)
  const [total, setTotal] = useState(() => initialView?.total ?? 0);    // จำนวนทั้งหมดที่ตรงเงื่อนไข (นับจาก DB จริง)
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [q, setQ] = useState(() => initialView?.q ?? "");
  const [qDeb, setQDeb] = useState(() => initialView?.qDeb ?? "");     // ค่าค้นหาแบบหน่วงเวลา (กันยิง query ทุกคีย์)
  const [pageFilter, setPageFilter] = useState(() => initialView?.pageFilter ?? "");      // ต้องเลือกเพจก่อน จึงจะอนุญาตให้ดึงรายงาน
  const [reportPageId, setReportPageId] = useState(() => initialView?.reportPageId ?? "");  // เพจที่ผู้ใช้กด "ดึงรายงาน" แล้ว
  const [stageFilter, setStageFilter] = useState(() => initialView?.stageFilter ?? "all");
  const [detailRow, setDetailRow] = useState(null);   // แถวที่กำลังเปิดโปรไฟล์ (การ์ดมือถือ)
  const [dataFilter, setDataFilter] = useState(() => initialView?.dataFilter ?? "all");   // all | has | none
  const [sourceFilter, setSourceFilter] = useState(() => initialView?.sourceFilter ?? "all"); // all | ad | organic | unknown
  const [dateFilter, setDateFilter] = useState(() => initialView?.dateFilter ?? "");      // ต้องเลือกก่อนดึงรายงาน
  const [dateFrom, setDateFrom] = useState(() => initialView?.dateFrom ?? "");          // กำหนดเอง (YYYY-MM-DD)
  const [dateTo, setDateTo] = useState(() => initialView?.dateTo ?? "");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  // รูปแบบไฟล์: "raw" = คอลัมน์เดิมของระบบ · "sheet" = ตรงกับชีต "รายชื่อลูกค้า" ที่ทีมใช้สรุปอยู่
  const [exportFormat, setExportFormat] = useState("sheet");
  const [exportDateFilter, setExportDateFilter] = useState("");
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [reportRefreshedAt, setReportRefreshedAt] = useState(() => initialView?.reportRefreshedAt ?? null);
  const [reportRefreshedBy, setReportRefreshedBy] = useState(() => initialView?.reportRefreshedBy ?? null);
  const [sortKey, setSortKey] = useState(() => initialView?.sortKey === "last_message_at" ? "first_customer_message_at" : (initialView?.sortKey ?? "first_customer_message_at"));
  const [sortDir, setSortDir] = useState(() => initialView?.sortDir ?? "desc");
  const [page, setPage] = useState(() => initialView?.page ?? 1);
  const [pageOpts, setPageOpts] = useState([]);         // รายชื่อเพจสำหรับ dropdown
  const [importState, setImportState] = useState(null); // { fileName, sheetName, columns, records, preview, applying, result }
  const importInputRef = useRef(null);
  const reportRequestRef = useRef(0);                   // กันรายงานเพจเดิมที่กำลังโหลดกลับมาทับหลังเปลี่ยนเพจ
  const previousPageFilterRef = useRef(pageFilter);     // กัน effect รอบแรกไปล้าง cache ที่เพิ่ง restore
  const previousDateSelectionRef = useRef(`${dateFilter}|${dateFrom}|${dateTo}`);
  const PAGE_SIZE = 50;

  const reportCacheKey = (selectedPageId = reportPageId) => JSON.stringify({
    version: 2, pageId: selectedPageId, page, q: qDeb, stageFilter, dataFilter, sourceFilter,
    dateFilter, dateFrom, dateTo, sortKey, sortDir,
  });

  // map ปุ่มเรียง → คอลัมน์จริงใน DB
  const SORT_COL = { customer_name: "customer_name", page_name: "page_name", trade_id: "trade_id", phone: "phone", email: "email", username: "username", psid: "psid", source: "source", messages: "user_message_count", stage: "stage", first_customer_message_at: "first_customer_message_at", last_message_at: "first_customer_message_at", synced_at: "first_customer_message_at" };
  const EXPORT_DB_COLS = ["customer_name", "page_name", "trade_id", "phone", "email", "username", "psid", "source", "entry_ad_id", "first_customer_message_at", "stage", "stage_manual", "comment_ad_name", "comment_is_ad", "entry_ad_name"];
  // สถานะในชีตใช้คำของทีม ไม่ใช่ค่า stage ดิบ — แมปให้ตรงกับที่กรอกมือกันอยู่
  const SHEET_STATUS = {
    account_opened: "เปิดบัญชีแล้ว",
    converted: "เปิดบัญชีแล้ว",
    qualified: "สนใจ",
    new: "สนใจ",
    disqualified: "ไม่สนใจ",
  };
  // sourceText() ตอบแค่ "โฆษณา/ออร์แกนิก/ไม่ทราบ" — แชท LINE จึงตกเป็น "ไม่ทราบ" ทั้งหมด
  // ช่องนี้ในชีตหมายถึง "ติดต่อกันทางไหน" จึงต้องตอบเป็นช่องทางแชทจริง
  const contactChannel = (row) => {
    const src = String(row.source || "");
    if (src === "line") return "LINE";
    if (src === "instagram") return "Instagram";
    if (src === "comment" || row.comment_is_ad) return "คอมเมนต์";
    if (src === "ad" || row.entry_ad_id) return `โฆษณา${row.entry_ad_name ? ` (${row.entry_ad_name})` : ""}`;
    return "Messenger";
  };
  const sheetDate = (t) => { if (!t) return ""; try { const d = new Date(t); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; } catch { return ""; } };
  // ชีตที่ทีมใช้สรุป — คอลัมน์เรียงตามของจริง เพื่อวางทับได้เลยไม่ต้องสลับคอลัมน์
  // tvByUser มาจากตาราง tv_access (สิทธิ์อินดิเคเตอร์) join ด้วย username ของ TradingView
  const SHEET_COLUMNS = (tvByUser) => [
    ["ลำดับ", (row, i) => String(i + 1)],
    ["ชื่อ", (row) => row.customer_name || ""],
    ["สถานะ", (row) => SHEET_STATUS[row.stage_manual || row.stage] || "สนใจ"],
    ["เลขบัญชีเทรด", (row) => row.trade_id || ""],
    ["อีเมล", (row) => row.email || ""],
    ["User TradingView", (row) => row.username || ""],
    ["สถานะอินดี้", (row) => (tvByUser.get(String(row.username || "").toLowerCase()) ? "เพิ่มแล้ว" : "")],
    ["วันที่เริ่มใช้", (row) => sheetDate(tvByUser.get(String(row.username || "").toLowerCase())?.tv_granted_at)],
    ["วันหมดอายุ", (row) => sheetDate(tvByUser.get(String(row.username || "").toLowerCase())?.expiration)],
    ["ช่องทางการติดต่อ", (row) => contactChannel(row)],
    ["วันที่ติดต่อ", (row) => sheetDate(row.first_customer_message_at)],
  ];

  const EXPORT_COLUMNS = [
    ["ชื่อเฟสบุค", (row) => row.customer_name || ""],
    ["เพจ", (row) => row.page_name || ""],
    ["ไอดีเทรด", (row) => row.trade_id || ""],
    ["เบอร์โทร", (row) => row.phone || ""],
    ["อีเมล", (row) => row.email || ""],
    ["user tradingview", (row) => row.username || ""],
    ["เฟสบุคไอดี", (row) => row.psid || ""],
    ["แหล่งที่มา", (row) => sourceText(row)],
    ["วันที่", (row) => fmtTime(row.first_customer_message_at)],
  ];

  // รายชื่อเพจจาก page_lead_config (คงอยู่แม้ตารางลูกค้าจะแบ่งหน้า)
  // page_lead_config เก็บแต่เพจ Facebook — บัญชี LINE OA ไม่เคยถูกบันทึกไว้ที่นั่น
  // ทำให้เลือกเพจไม่ได้ จึงกด "ดึงรายงาน"/Export สำหรับลูกค้า LINE ไม่ได้เลย
  // ทั้งที่ชีตสรุปที่ทีมใช้อยู่เป็นลูกค้า LINE — จึงต้องเอาบัญชี LINE ที่มีแชทจริงมารวมด้วย
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
      setPageOpts([...seen].map(([id, name]) => ({ id, name })));
    })();
  }, []);

  // จำเพจ/ช่วงเวลาที่เลือกล่าสุด แล้วรอบหน้าเปิดหน้ามาโหลดให้เลย ไม่ต้องกด "ดึงรายงาน" ซ้ำทุกครั้ง
  // (ใช้ได้แม้มีหลายเพจ ต่างจากการเช็คว่ามีเพจเดียว)
  // ทำครั้งเดียวต่อการเปิดหน้า และข้ามถ้าผู้ใช้เลือกเองแล้ว/กู้ค่าจาก cache มาแล้ว
  const autoPulledRef = useRef(false);
  useEffect(() => {
    if (autoPulledRef.current) return;
    if (!pageOpts.length) return;
    if (pageFilter || reportPageId) return;
    const last = lsGet(LAST_REPORT_KEY, null);
    if (!last?.pageId) return;
    if (!pageOpts.some((p) => p.id === last.pageId)) return;   // เพจถูกลบ/เปลี่ยนสิทธิ์ไปแล้ว
    autoPulledRef.current = true;
    setPageFilter(last.pageId);
    setDateFilter(last.dateFilter || "30");
    if (last.dateFilter === "custom") { setDateFrom(last.dateFrom || ""); setDateTo(last.dateTo || ""); }
    setReportPageId(last.pageId);              // ตัวนี้เป็นตัวจุดชนวนให้ effect โหลดข้อมูลทำงาน
  }, [pageOpts, pageFilter, reportPageId]);

  // บันทึกตัวเลือกล่าสุดทุกครั้งที่ดึงรายงานสำเร็จ
  useEffect(() => {
    if (!reportPageId || reportPageId !== pageFilter || !dateFilter) return;
    lsSet(LAST_REPORT_KEY, { pageId: pageFilter, dateFilter, dateFrom, dateTo });
  }, [reportPageId, pageFilter, dateFilter, dateFrom, dateTo]);

  // หน่วงช่องค้นหา
  useEffect(() => { const t = setTimeout(() => setQDeb(q), 350); return () => clearTimeout(t); }, [q]);

  // ใส่เงื่อนไขฟิลเตอร์ทั้งหมดลงใน query (ใช้ร่วมทั้งโหลดหน้า + export)
  function hasCompleteDateRange(preset, from = "", to = "") {
    if (!preset) return false;
    if (preset !== "custom") return true;
    return !!from && !!to && from <= to;
  }

  function applyFilters(query, options = {}) {
    const selectedPageId = options.pageId ?? reportPageId;
    const selectedDateFilter = options.dateFilter ?? dateFilter;
    const selectedDateFrom = options.dateFrom ?? dateFrom;
    const selectedDateTo = options.dateTo ?? dateTo;
    query = query.eq("page_id", selectedPageId);
    if (stageFilter !== "all") query = query.eq("stage", stageFilter);
    if (dataFilter === "has") query = query.or("phone.not.is.null,trade_id.not.is.null,username.not.is.null");
    if (dataFilter === "none") query = query.is("phone", null).is("trade_id", null).is("username", null);
    if (sourceFilter === "ad") query = query.or("source.eq.ad,entry_ad_id.not.is.null");
    else if (sourceFilter === "organic") query = query.eq("source", "organic");
    else if (sourceFilter === "unknown") query = query.is("entry_ad_id", null).or("source.is.null,source.not.in.(ad,organic)");
    if (selectedDateFilter === "custom") {
      if (selectedDateFrom) query = query.gte("first_customer_message_at", new Date(selectedDateFrom + "T00:00:00+07:00").toISOString());
      if (selectedDateTo) {
        const endExclusive = new Date(new Date(selectedDateTo + "T00:00:00+07:00").getTime() + 864e5).toISOString();
        query = query.lt("first_customer_message_at", endExclusive);
      }
    } else if (selectedDateFilter !== "all") {
      const range = getCustomerDateRange(selectedDateFilter);
      if (range?.from) query = query.gte("first_customer_message_at", range.from);
      if (range?.toExclusive) query = query.lt("first_customer_message_at", range.toExclusive);
    }
    const s = qDeb.trim().replace(/[%,()]/g, " ").trim();
    if (s) {
      const like = `%${s}%`;
      query = query.or(["customer_name", "phone", "trade_id", "username", "email", "psid", "last_user_text", "page_name", "entry_ad_id"].map((c) => `${c}.ilike.${like}`).join(","));
    }
    return query;
  }

  async function load(force = true) {
    if (!reportPageId || reportPageId !== pageFilter) return;
    const selectedPageId = reportPageId;
    const cacheKey = reportCacheKey(selectedPageId);
    if (!force) {
      const cached = customerDatabaseReportCache.get(cacheKey);
      if (cached) {
        setRows(cached.rows);
        setTotal(cached.total);
        setReportRefreshedAt(cached.refreshedAt || null);
        setReportRefreshedBy(cached.refreshedBy || null);
        setError("");
        setLoading(false);
        return;
      }
    }
    const requestId = ++reportRequestRef.current;
    setLoading(true); setError("");
    const { data, error: e } = await supabase.functions.invoke("customer-report", { body: {
      page_id: selectedPageId, date_filter: dateFilter, date_from: dateFrom, date_to: dateTo,
      page, q: qDeb, stage_filter: stageFilter, data_filter: dataFilter, source_filter: sourceFilter,
      sort_key: sortKey, sort_dir: sortDir, force,
    } });
    if (requestId !== reportRequestRef.current || selectedPageId !== pageFilter) return;
    if (e || !data?.ok) { setError(data?.error || (e ? await readFunctionErrorMessage(e) : "ดึงรายงานไม่สำเร็จ")); if (rows === null) setRows([]); }
    else {
      const nextRows = data.rows || [];
      const nextTotal = data.total || 0;
      const refreshedAt = data.refreshed_at || null;
      const refreshedBy = data.refreshed_by || null;
      setRows(nextRows); setTotal(nextTotal);
      setReportRefreshedAt(refreshedAt); setReportRefreshedBy(refreshedBy);
      customerDatabaseReportCache.set(cacheKey, { rows: nextRows, total: nextTotal, refreshedAt, refreshedBy });
    }
    setLoading(false);
  }
  async function invalidateSharedReportCache() {
    if (!reportPageId) return;
    await supabase.functions.invoke("customer-report", { body: {
      action: "invalidate", page_id: reportPageId, date_filter: dateFilter, date_from: dateFrom, date_to: dateTo,
    } });
  }
  // reset ไปหน้า 1 เมื่อเปลี่ยนฟิลเตอร์/การเรียง
  useEffect(() => { setPage(1); }, [qDeb, stageFilter, dataFilter, sourceFilter, dateFilter, dateFrom, dateTo, sortKey, sortDir]);
  // เปลี่ยนเพจ = ล้างรายงานเดิมทันที และรอให้กดดึงรายงานใหม่ ห้าม query ข้อมูลลูกค้าอัตโนมัติ
  useEffect(() => {
    if (previousPageFilterRef.current === pageFilter) return;
    previousPageFilterRef.current = pageFilter;
    setReportPageId("");
    setRows(null);
    setTotal(0);
    setReportRefreshedAt(null);
    setReportRefreshedBy(null);
    setError("");
    setPage(1);
    reportRequestRef.current += 1;
    setLoading(false);
  }, [pageFilter]);
  // เปลี่ยนช่วงเวลา = ต้องกดดึงรายงานใหม่ ห้ามโหลด snapshot คนละช่วงให้อัตโนมัติ
  useEffect(() => {
    const next = `${dateFilter}|${dateFrom}|${dateTo}`;
    if (previousDateSelectionRef.current === next) return;
    previousDateSelectionRef.current = next;
    setReportPageId(""); setRows(null); setTotal(0);
    setReportRefreshedAt(null); setReportRefreshedBy(null);
    setPage(1); setError(""); reportRequestRef.current += 1; setLoading(false);
  }, [dateFilter, dateFrom, dateTo]);
  // โหลดจาก cache ก่อนเมื่อกลับเข้าเมนู/ย้อนมาฟิลเตอร์เดิม เพื่อลด API
  useEffect(() => { if (reportPageId && reportPageId === pageFilter) load(false); }, [reportPageId, page, qDeb, stageFilter, dataFilter, sourceFilter, dateFilter, dateFrom, dateTo, sortKey, sortDir]);

  // จำหน้ารายงานล่าสุดในหน่วยความจำของแอป เผื่อคอมโพเนนต์ถูก remount ระหว่างสลับเมนู
  useEffect(() => {
    if (!reportPageId || reportPageId !== pageFilter || rows === null) return;
    const snapshot = {
      rows, total, q, qDeb, pageFilter, reportPageId, stageFilter, dataFilter,
      sourceFilter, dateFilter, dateFrom, dateTo, sortKey, sortDir, page, reportRefreshedAt, reportRefreshedBy,
    };
    setCustomerDatabaseViewCache(snapshot);
    customerDatabaseReportCache.set(reportCacheKey(), { rows, total, refreshedAt: reportRefreshedAt, refreshedBy: reportRefreshedBy });
  }, [rows, total, q, qDeb, pageFilter, reportPageId, stageFilter, dataFilter, sourceFilter, dateFilter, dateFrom, dateTo, sortKey, sortDir, page, reportRefreshedAt, reportRefreshedBy]);

  function pullReport() {
    if (!pageFilter) { setError("กรุณาเลือกเพจก่อนดึงรายงาน"); return; }
    if (!dateFilter) { setError("กรุณาเลือกช่วงเวลาก่อนดึงรายงาน"); return; }
    if (dateFilter === "custom" && (!dateFrom || !dateTo)) { setError("กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุดให้ครบ"); return; }
    if (dateFilter === "custom" && dateFrom > dateTo) { setError("วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด"); return; }
    setError("");
    setRows(null);
    setTotal(0);
    customerDatabaseReportCache.clear();
    // ถ้ากดซ้ำบนเพจเดิม reportPageId จะไม่เปลี่ยนและ effect จะไม่ทำงาน
    // จึงสั่งโหลดเองเมื่ออยู่หน้า 1; ถ้าอยู่หน้าอื่น การเปลี่ยน page เป็น 1 จะเป็นตัวเริ่มโหลด
    if (reportPageId === pageFilter) {
      if (page === 1) load(false);
      else setPage(1);
      return;
    }
    setPage(1);
    setReportPageId(pageFilter);
  }

  async function setStage(id, stage) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, stage, stage_manual: stage } : r)));
    await supabase.from("chat_customers").update({ stage, stage_manual: stage, updated_at: new Date().toISOString() }).eq("id", id);
    await invalidateSharedReportCache();
  }

  const pages = pageOpts;
  const srcOf = (r) => (r.source === "ad" || r.entry_ad_id ? "ad" : r.source === "organic" ? "organic" : "unknown");
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageRows = rows || [];   // แถวของหน้าปัจจุบัน (กรอง/เรียง/แบ่งหน้าที่ DB แล้ว)

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "customer_name" || key === "page_name" ? "asc" : "desc"); }
  }

  // Export = ดึงทุกแถวที่ตรงเงื่อนไข (ทีละ 1,000 วนจนครบ) ไม่ใช่แค่หน้าปัจจุบัน
  function openExportDialog() {
    if (!pageFilter) { setError("กรุณาเลือกเพจก่อน Export CSV"); return; }
    setError("");
    setExportDateFilter("");
    setExportDateFrom("");
    setExportDateTo("");
    setExportDialogOpen(true);
  }

  async function exportCsv() {
    if (!pageFilter || !hasCompleteDateRange(exportDateFilter, exportDateFrom, exportDateTo)) return;
    if (exportDateFilter === "custom" && exportDateFrom > exportDateTo) return;
    setExporting(true);
    try {
      const B = 1000;
      let all = [], from = 0;
      for (let guard = 0; guard < 200; guard++) {
        let query = supabase.from("chat_customers").select(EXPORT_DB_COLS.join(","));
        query = applyFilters(query, { pageId: pageFilter, dateFilter: exportDateFilter, dateFrom: exportDateFrom, dateTo: exportDateTo })
          .order(SORT_COL[sortKey] || "first_customer_message_at", { ascending: sortDir === "asc", nullsFirst: false }).range(from, from + B - 1);
        const { data, error: e } = await query;
        if (e) { setError("Export ล้มเหลว: " + e.message); return; }
        all = all.concat(data || []);
        if (!data || data.length < B) break;
        from += B;
      }
      // รูปแบบชีตต้องมีสถานะอินดิเคเตอร์ด้วย — อยู่คนละตาราง (tv_access) join ด้วย username ของ TradingView
      // ดึงทีเดียวทั้งก้อนแล้วทำ Map ไว้ เร็วกว่ายิงต่อแถว และตาราง tv_access เล็กมาก
      const tvByUser = new Map();
      if (exportFormat === "sheet") {
        const { data: tv } = await supabase.from("tv_access").select("username, status, tv_granted_at, expiration");
        for (const t of tv || []) {
          const key = String(t.username || "").toLowerCase();
          if (key) tvByUser.set(key, t);
        }
      }
      const columns = exportFormat === "sheet" ? SHEET_COLUMNS(tvByUser) : EXPORT_COLUMNS;
      const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = [columns.map(([header]) => esc(header)).join(","), ...all.map((row, i) => columns.map(([, getValue]) => esc(getValue(row, i))).join(","))].join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = exportFormat === "sheet" ? `รายชื่อลูกค้า_${bangkokDate()}.csv` : `customers_${bangkokDate()}.csv`;
      a.click(); URL.revokeObjectURL(url);
      setExportDialogOpen(false);
    } finally {
      setExporting(false);
    }
  }

  async function chooseImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!pageFilter) { setError("กรุณาเลือกเพจก่อน Import Excel"); return; }
    setError("");
    setImportState({ fileName: file.name, loading: true });
    try {
      const { parseCustomerImportExcel } = await import("@/tooling/customer-import.js");
      const parsed = await parseCustomerImportExcel(file);
      const { data, error: invokeError } = await supabase.functions.invoke("import-chat-customers", {
        body: { mode: "preview", page_id: pageFilter, records: parsed.records },
      });
      if (invokeError) throw new Error(await readFunctionErrorMessage(invokeError));
      if (!data?.ok) throw new Error(data?.error || "ตรวจสอบไฟล์ไม่สำเร็จ");
      setImportState({ fileName: file.name, ...parsed, preview: data, loading: false, applying: false, result: null });
    } catch (err) {
      setImportState(null);
      setError(`Import Excel ไม่สำเร็จ: ${err?.message || err}`);
    }
  }

  async function applyImport() {
    if (!importState?.records?.length || importState.applying) return;
    setImportState((state) => ({ ...state, applying: true, result: null }));
    const { data, error: invokeError } = await supabase.functions.invoke("import-chat-customers", {
      body: { mode: "apply", page_id: pageFilter, records: importState.records },
    });
    if (invokeError || !data) {
      const message = invokeError ? await readFunctionErrorMessage(invokeError) : "ระบบไม่ตอบกลับ";
      setImportState((state) => ({ ...state, applying: false, result: { ok: false, error: message } }));
      return;
    }
    setImportState((state) => ({ ...state, applying: false, result: data }));
    if (data.updated > 0) {
      customerDatabaseReportCache.clear();
      setCustomerDatabaseViewCache(null);
      if (reportPageId === pageFilter) load(true);
    }
  }

  const fmtTime = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); } catch { return t || "-"; } };
  // ชื่อ ADS + ad id (สำหรับคอลัมน์แหล่งที่มา 2 บรรทัด)
  const adNameOf = (r) => r.entry_ad_name || (r.comment_ad_names?.length ? r.comment_ad_names.filter(Boolean).join(", ") : r.comment_ad_name) || "";
  const adIdOf = (r) => r.entry_ad_id || (r.comment_ad_ids?.length ? r.comment_ad_ids.filter(Boolean).join(", ") : "");
  const sourceText = (r) => srcOf(r) === "ad"
    ? `Ads ${adNameOf(r) || "โฆษณา"}${adIdOf(r) ? ` (ads id: ${adIdOf(r)})` : ""}`
    : SOURCE_LABELS[srcOf(r)];
  const patchRow = (id, patch) => { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); invalidateSharedReportCache(); };
  const selCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white";

  const SortHead = ({ k, children, className = "" }) => (
    <th className={`px-3 py-2 font-medium ${className}`}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-slate-800">
        {children}
        {sortKey === k ? (sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={13} className="text-slate-300" />}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-800">รีพอร์ตลูกค้าทักแชท</h3>
            <p className="text-xs text-slate-500 mt-0.5">ข้อมูลลูกค้าทั้งหมดที่ซิงก์มาจาก Supabase — ค้นหา กรอง เรียงลำดับ และดาวน์โหลดได้</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={importInputRef} type="file" accept=".xlsx,.xlsm" onChange={chooseImportFile} className="hidden" />
            <button onClick={() => pageFilter ? importInputRef.current?.click() : setError("กรุณาเลือกเพจก่อน Import Excel")} disabled={!!importState?.loading} title="จับคู่ด้วยชื่อลูกค้าในเพจที่เลือก และเขียนทับเฉพาะช่องที่มีข้อมูลในไฟล์" className="border border-emerald-300 text-emerald-700 rounded-lg px-3 py-2 text-sm font-medium hover:bg-emerald-50 disabled:opacity-50 flex items-center gap-1.5">
              {importState?.loading ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />} Import Excel
            </button>
            <button onClick={() => { customerDatabaseReportCache.clear(); load(true); }} disabled={loading || !reportPageId} title="คลิกเพื่อดึงข้อมูลปัจจุบันจากฐานข้อมูลและอัปเดตให้ทุก user" className="bg-white text-slate-700 border border-slate-300 rounded-control hover:bg-slate-50 px-4 py-2 text-sm font-semibold   disabled:opacity-50 flex items-center gap-1.5">
              {loading ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} รีเฟรชข้อมูลล่าสุด
            </button>
            <button onClick={openExportDialog} disabled={!pageFilter || exporting} className="bg-white text-slate-700 border border-slate-300 rounded-control px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5">
              {exporting ? <Loader2 className="animate-spin" size={15} /> : <FileDown size={15} />} Export CSV
            </button>
          </div>
        </div>

        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา ชื่อ / เบอร์ / ไอดีเทรด / username / ข้อความ" />

        {/* ตัวกรองสถานะแบบแคปซูล — เลื่อนซ้ายขวาได้บนมือถือ ใช้ stageFilter เดิมที่มีอยู่แล้วแต่ยังไม่เคยมี UI ให้กด */}
        <div className="flex gap-1.5 overflow-x-auto -mx-0.5 px-0.5 pb-0.5">
          <FilterPill active={stageFilter === "all"} onClick={() => setStageFilter("all")}>ทั้งหมด</FilterPill>
          {CHAT_STAGES.map((s) => (
            <FilterPill key={s.key} active={stageFilter === s.key} onClick={() => setStageFilter(s.key)}>{s.label}</FilterPill>
          ))}
        </div>

        {/* แยกเป็นสองกลุ่มให้ชัด — เดิมปุ่มที่ "ดึงข้อมูลใหม่" กับตัวกรองที่ "กรองผลที่ดึงมาแล้ว"
            วางปนกันในแถวเดียว ผู้ใช้ใหม่แยกไม่ออกว่ากดอะไรแล้วระบบจะไปโหลดข้อมูลใหม่ */}
        <div className="rounded-card border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="text-2xs font-semibold uppercase tracking-wide text-slate-400">1 · เลือกข้อมูลที่จะดึง</div>
          <div className="flex flex-wrap gap-2">
          <select value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} className={selCls} title="เพจ">
            <option value="">— เลือกเพจ —</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={selCls} title="ช่วงวันที่">
            <option value="">— เลือกช่วงเวลา —</option>
            <option value="all">ทุกช่วงเวลา</option>
            <option value="today">วันนี้</option>
            <option value="yesterday">เมื่อวาน</option>
            <option value="last3">3 วันล่าสุด</option>
            <option value="this_week">สัปดาห์นี้</option>
            <option value="last_week">สัปดาห์ที่แล้ว</option>
            <option value="this_month">เดือนนี้</option>
            <option value="last_month">เดือนที่แล้ว</option>
            <option value="this_year">ปีนี้</option>
            <option value="last_year">ปีที่แล้ว</option>
            <option value="7">7 วันล่าสุด</option>
            <option value="30">30 วันล่าสุด</option>
            <option value="90">90 วันล่าสุด</option>
            <option value="custom">กำหนดเอง…</option>
          </select>
          {dateFilter === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={selCls} title="ตั้งแต่วันที่" />
              <span className="text-slate-400 text-sm">–</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={selCls} title="ถึงวันที่" />
            </div>
          )}
          {/* เดิมมี hover:bg-brand-700 กับ hover:bg-amber-300 อยู่ในคลาสเดียวกัน ตัวหลังชนะ
              ปุ่มหลักสีน้ำเงินจึงเปลี่ยนเป็นสีเหลืองตอนชี้เมาส์ ผิดจากปุ่มหลักที่อื่นทั้งระบบ */}
          <button onClick={pullReport} disabled={!pageFilter || !hasCompleteDateRange(dateFilter, dateFrom, dateTo) || loading} className="ds-btn ds-btn-primary px-4 py-2 text-sm disabled:opacity-50 flex items-center gap-1.5">
            {loading ? <Loader2 className="animate-spin" size={15} /> : <FileDown size={15} />} ดึงรายงาน
          </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wide text-slate-400">2 · กรองผลลัพธ์</span>
          <select value={dataFilter} onChange={(e) => setDataFilter(e.target.value)} className={selCls} title="ข้อมูลติดต่อ">
            <option value="all">ข้อมูลติดต่อ: ทั้งหมด</option>
            <option value="has">มีข้อมูลติดต่อ</option>
            <option value="none">ยังไม่มีข้อมูล</option>
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={selCls} title="ที่มา">
            <option value="all">ที่มา: ทั้งหมด</option>
            <option value="ad">โฆษณา</option>
            <option value="organic">ออร์แกนิก</option>
            <option value="unknown">ไม่ทราบ</option>
          </select>
        </div>

        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
        {!reportPageId && !error && <div className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-3">เลือกเพจและช่วงเวลา แล้วกด “ดึงรายงาน” ระบบจึงจะเริ่มโหลดข้อมูลลูกค้า</div>}
        {reportPageId && reportRefreshedAt && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5">
            <div className="text-sm font-medium text-brand-900">ข้อมูลชุดนี้ดึงล่าสุด: {new Date(reportRefreshedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "medium" })}{reportRefreshedBy ? <span className="ml-1 text-xs font-normal text-brand-700">โดย {reportRefreshedBy}</span> : null}</div>
            <div className="text-xs text-brand-700">หากต้องการข้อมูลปัจจุบัน ให้คลิกปุ่ม “รีเฟรชข้อมูลล่าสุด” ด้านบน</div>
          </div>
        )}
        {reportPageId && <div className="text-xs text-slate-500">พบ {total.toLocaleString()} รายการ{total > PAGE_SIZE ? ` — แสดงหน้า ${curPage}/${totalPages}` : ""}</div>}
      </div>

      {exportDialogOpen && (
        <div className="customer-export-modal-backdrop fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !exporting) setExportDialogOpen(false); }}>
          <div className="customer-export-modal-panel relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">
            <div className="customer-export-modal-header flex items-start justify-between gap-4 px-5 pt-6 pb-5 sm:px-6">
              <div className="min-w-0">
                <div className="customer-export-modal-kicker"><FileDown size={14} /> EXPORT CSV</div>
                <h3 className="customer-export-modal-title mt-2 text-xl font-semibold">เลือกช่วงเวลาที่ต้องการ</h3>
                <p className="customer-export-modal-page mt-2"><span>เพจ</span>{pages.find((p) => p.id === pageFilter)?.name || pageFilter}</p>
              </div>
              <button type="button" onClick={() => !exporting && setExportDialogOpen(false)} className="customer-export-modal-close" aria-label="ปิด"><X size={20} /></button>
            </div>
            <div className="customer-export-modal-body px-5 py-5 sm:px-6 space-y-4">
              {/* เลือกรูปแบบไฟล์ — ค่าเริ่มต้นเป็นรูปแบบชีตที่ทีมใช้สรุปอยู่ เพราะเป็นงานประจำ */}
              <div>
                <span className="customer-export-modal-label">รูปแบบไฟล์</span>
                <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    ["sheet", "ชีตสรุปรายชื่อลูกค้า", "ลำดับ · ชื่อ · สถานะ · เลขบัญชีเทรด · อีเมล · TradingView · สถานะอินดี้ · วันเริ่ม/หมดอายุ"],
                    ["raw", "คอลัมน์ดิบของระบบ", "ชื่อ · เพจ · ไอดีเทรด · เบอร์ · อีเมล · TradingView · PSID · แหล่งที่มา"],
                  ].map(([val, title, hint]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setExportFormat(val)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition ${
                        exportFormat === val
                          ? "border-brand-600 bg-brand-600/10"
                          : "border-slate-300 hover:border-slate-400 dark:border-night-border"
                      }`}
                    >
                      <div className="text-sm font-medium">{title}</div>
                      <div className="mt-0.5 text-[11px] leading-snug opacity-70">{hint}</div>
                    </button>
                  ))}
                </div>
              </div>
              <label className="customer-export-modal-label" htmlFor="customer-export-date-range">ช่วงเวลาของข้อมูล</label>
              <select id="customer-export-date-range" value={exportDateFilter} onChange={(e) => setExportDateFilter(e.target.value)} className="customer-export-modal-select w-full rounded-xl px-4 py-3.5 text-sm">
                <option value="">— เลือกช่วงเวลา —</option>
                <option value="all">ทุกช่วงเวลา</option>
                <option value="today">วันนี้</option><option value="yesterday">เมื่อวาน</option><option value="last3">3 วันล่าสุด</option>
                <option value="this_week">สัปดาห์นี้</option><option value="last_week">สัปดาห์ที่แล้ว</option>
                <option value="this_month">เดือนนี้</option><option value="last_month">เดือนที่แล้ว</option>
                <option value="this_year">ปีนี้</option><option value="last_year">ปีที่แล้ว</option>
                <option value="7">7 วันล่าสุด</option><option value="30">30 วันล่าสุด</option><option value="90">90 วันล่าสุด</option>
                <option value="custom">กำหนดเอง…</option>
              </select>
              {exportDateFilter === "custom" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="customer-export-modal-label">ตั้งแต่วันที่<input type="date" value={exportDateFrom} onChange={(e) => setExportDateFrom(e.target.value)} className="customer-export-modal-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm" /></label>
                  <label className="customer-export-modal-label">ถึงวันที่<input type="date" value={exportDateTo} onChange={(e) => setExportDateTo(e.target.value)} className="customer-export-modal-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm" /></label>
                </div>
              )}
              {exportDateFilter === "custom" && exportDateFrom && exportDateTo && exportDateFrom > exportDateTo && <p className="text-sm text-rose-400">วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด</p>}
              {!exportDateFilter && <p className="customer-export-modal-hint">เลือกช่วงเวลาที่ต้องการก่อน จึงจะดาวน์โหลดรายงานได้</p>}
            </div>
            <div className="customer-export-modal-footer flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 sm:px-6">
              <button type="button" onClick={() => setExportDialogOpen(false)} disabled={exporting} className="customer-export-modal-cancel rounded-xl px-4 py-2.5 text-sm font-medium">ยกเลิก</button>
              <button type="button" onClick={exportCsv} disabled={exporting || !hasCompleteDateRange(exportDateFilter, exportDateFrom, exportDateTo) || (exportDateFilter === "custom" && exportDateFrom > exportDateTo)} className="customer-export-modal-download inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold">
                {exporting ? <Loader2 className="animate-spin" size={16} /> : <FileDown size={16} />} ดาวน์โหลด CSV
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {!reportPageId ? (
          <EmptyState
            icon={FileDown}
            title="ยังไม่ได้ดึงรายงาน"
            hint="เลือกเพจและช่วงเวลาด้านบน แล้วกด “ดึงรายงาน” เพื่อโหลดข้อมูลลูกค้า"
          />
        ) : rows === null ? (
          <div className="p-6"><Spinner label="กำลังโหลดรายงาน..." /></div>
        ) : total === 0 ? (
          <EmptyState
            icon={Search}
            title="ไม่พบข้อมูลตามเงื่อนไข"
            hint="ลองล้างคำค้น หรือขยายช่วงวันที่/ตัวกรองข้อมูลติดต่อให้กว้างขึ้น"
          />
        ) : (
          <>
            {/* มือถือ/แท็บเล็ต: การ์ดลิสต์ (แตะแถวเพื่อเปิดโปรไฟล์) — เดสก์ท็อปใช้ตารางด้านล่างแทน */}
            <div className="md:hidden divide-y divide-slate-100">
              {pageRows.map((r) => {
                const st = CHAT_STAGES.find((s) => s.key === (r.stage_manual || r.stage || "new")) || CHAT_STAGES[0];
                const initial = (r.customer_name || "?").trim().slice(0, 1).toUpperCase();
                return (
                  <button key={r.id} onClick={() => setDetailRow(r)} className="w-full text-left p-3.5 hover:bg-slate-50 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-semibold shrink-0">{initial}</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 text-[15px] truncate">{r.customer_name || "(ไม่มีชื่อ)"}</div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        <span className="text-xs text-slate-400 truncate">{SOURCE_LABELS[srcOf(r)] || r.page_name || "-"} · {r.trade_id || "ไม่มีไอดีเทรด"}</span>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-slate-300 shrink-0" />
                  </button>
                );
              })}
            </div>

            <div className="hidden md:block w-full overflow-hidden">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col className="w-[16%]" /><col className="w-[8%]" /><col className="w-[9%]" /><col className="w-[9%]" />
                  <col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[11%]" /><col className="w-[9%]" />
                  <col className="w-[6%]" /><col className="w-[7%]" /><col className="w-[4%]" />
                </colgroup>
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                    <SortHead k="customer_name">ลูกค้า</SortHead>
                    <SortHead k="page_name">เพจ</SortHead>
                    <SortHead k="trade_id" className="whitespace-nowrap">ไอดีเทรด</SortHead>
                    <SortHead k="phone" className="whitespace-nowrap">เบอร์โทร</SortHead>
                    <SortHead k="email" className="whitespace-nowrap">อีเมล</SortHead>
                    <SortHead k="username" className="whitespace-nowrap">TradingView</SortHead>
                    <SortHead k="psid" className="whitespace-nowrap">เฟสบุคไอดี</SortHead>
                    <SortHead k="source" className="whitespace-nowrap">แหล่งที่มา</SortHead>
                    <SortHead k="messages" className="text-center">ข้อความ</SortHead>
                    <SortHead k="first_customer_message_at" className="whitespace-nowrap">แชทแรกของวัน</SortHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 align-top">
                      <td className="px-2 py-2 min-w-0">
                        <button onClick={() => onOpenChat?.(r.id, r.last_message_at)} title={`เปิดแชทของ ${r.customer_name || "ลูกค้า"}`} className="block w-full truncate text-left text-slate-800 hover:text-brand-600 font-medium underline-offset-2 hover:underline">
                          {r.customer_name || "(ไม่มีชื่อ)"}
                        </button>
                        {r.last_user_text && <div title={r.last_user_text} className="text-[10px] text-slate-400 truncate">{r.last_user_text}</div>}
                      </td>
                      <td title={r.page_name || r.page_id || ""} className="px-1.5 py-2 text-slate-600 truncate">{r.page_name || r.page_id || "-"}</td>
                      <td className="px-1 py-1.5 min-w-0"><EditableCell row={r} field="trade_id" numeric onSaved={patchRow} /></td>
                      <td className="px-1 py-1.5 min-w-0"><EditableCell row={r} field="phone" numeric onSaved={patchRow} /></td>
                      <td className="px-1 py-1.5 min-w-0"><EditableCell row={r} field="email" onSaved={patchRow} /></td>
                      <td className="px-1 py-1.5 min-w-0"><EditableCell row={r} field="username" onSaved={patchRow} /></td>
                      <td title={r.psid || ""} className="px-1.5 py-2 text-slate-500 truncate">{r.psid || <span className="text-slate-400">—</span>}</td>
                      <td className="px-1.5 py-2 min-w-0">
                        {srcOf(r) === "ad" ? (
                          <div className="min-w-0">
                            <div className="text-slate-600 truncate" title={`Ads ${adNameOf(r) || "โฆษณา"}`}>Ads {adNameOf(r) || "โฆษณา"}</div>
                            {adIdOf(r) && <div className="text-[10px] text-slate-400 truncate" title={adIdOf(r)}>ads id: {adIdOf(r)}</div>}
                          </div>
                        ) : (
                          <span className="text-slate-500 truncate block" title={SOURCE_LABELS[srcOf(r)]}>{SOURCE_LABELS[srcOf(r)]}</span>
                        )}
                      </td>
                      <td className="px-1 py-2 text-center text-slate-600">{r.user_message_count}/{r.message_count}</td>
                      <td title={fmtTime(r.first_customer_message_at)} className="px-1.5 py-2 text-slate-500 truncate">{fmtTime(r.first_customer_message_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-slate-200 text-sm">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={curPage <= 1} className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-40 hover:bg-slate-50">ก่อนหน้า</button>
                <span className="text-xs text-slate-500">หน้า {curPage} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages} className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-40 hover:bg-slate-50">ถัดไป</button>
              </div>
            )}
          </>
        )}
      </div>

      {importState && !importState.loading && (
        <CustomerImportModal
          state={importState}
          pageName={pages.find((item) => item.id === pageFilter)?.name || pageFilter}
          onClose={() => setImportState(null)}
          onApply={applyImport}
        />
      )}

      {detailRow && (
        <CustomerDetailModal
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onSaved={(id, patch) => { patchRow(id, patch); setDetailRow((r) => (r?.id === id ? { ...r, ...patch } : r)); }}
        />
      )}

    </div>
  );
}

function CustomerImportModal({ state, pageName, onClose, onApply }) {
  const summary = state.preview?.summary || {};
  const matched = summary.matched || 0;
  const matchedRecords = summary.matched_records || 0;
  const fieldLabels = { trade_id: "ไอดีเทรด", phone: "เบอร์โทร", email: "อีเมล", username: "TradingView", stage: "สถานะ" };
  const statusView = {
    matched: ["พร้อมนำเข้า", "bg-emerald-100 text-emerald-700"],
    not_found: ["ไม่พบในแอป", "bg-amber-100 text-amber-700"],
    invalid: ["ข้อมูลไม่ครบ", "bg-slate-100 text-slate-600"],
  };
  const result = state.result;
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !state.applying) onClose(); }}>
      <div className="bg-white w-full sm:max-w-4xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800">ตรวจสอบก่อน Import Excel</h3>
            <p className="text-xs text-slate-500 truncate">{state.fileName} · ชีต {state.sheetName} · เพจ {pageName}</p>
          </div>
          <button onClick={onClose} disabled={state.applying} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40" aria-label="ปิด"><X size={20} /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            จับคู่ด้วยชื่อ Facebook เท่านั้น โดยตัดช่องว่างส่วนเกินและไม่สนตัวพิมพ์เล็กใหญ่ · ชื่อเดียวกันหลายแถวใน Excel จะถูกรวมเป็นลูกค้าคนเดียวและรวมไอดีเทรดทุกบัญชี · หากในแอปมีชื่อเดียวกันหลายแถว ระบบจะอัปเดตทุกแถว · ช่องว่างในไฟล์จะไม่ลบข้อมูลเดิม
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {[["แถว Excel", summary.total || 0, "bg-slate-50 border-slate-200", "text-slate-700"], ["ชื่อไม่ซ้ำ", summary.names || 0, "bg-blue-50 border-blue-200", "text-blue-700"], ["ชื่อที่พร้อม", matched, "bg-emerald-50 border-emerald-200", "text-emerald-700"], ["แถวในแอปที่จะอัปเดต", matchedRecords, "bg-violet-50 border-violet-200", "text-violet-700"], ["ไม่พบ/ไม่สมบูรณ์", (summary.not_found || 0) + (summary.invalid || 0), "bg-amber-50 border-amber-200", "text-amber-700"]].map(([label, value, cardClass, valueClass]) => (
              <div key={label} className={`rounded-xl border p-2 ${cardClass}`}><div className={`text-xl font-bold ${valueClass}`}>{value}</div><div className="text-[11px] text-slate-500">{label}</div></div>
            ))}
          </div>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[45vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">แถว Excel</th><th className="px-3 py-2 text-left">ชื่อ Facebook</th><th className="px-3 py-2 text-left">บัญชีเทรด</th><th className="px-3 py-2 text-left">ช่องที่จะเขียนทับ</th><th className="px-3 py-2 text-left">แถวในแอป</th><th className="px-3 py-2 text-left">ผลจับคู่</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(state.preview?.results || []).map((row, index) => {
                    const view = statusView[row.status] || [row.status, "bg-slate-100 text-slate-600"];
                    return <tr key={`${row.row_number}-${index}`}><td className="px-3 py-2 text-slate-400 whitespace-nowrap">{(row.row_numbers || [row.row_number]).filter(Boolean).join(", ") || "-"}</td><td className="px-3 py-2 text-slate-800 font-medium">{row.customer_name || "(ไม่มีชื่อ)"}</td><td className="px-3 py-2 text-slate-600 max-w-[220px] break-words">{(row.trade_ids || []).join(", ") || "—"}</td><td className="px-3 py-2 text-slate-600">{(row.fields || []).map((field) => fieldLabels[field] || field).join(", ") || "—"}</td><td className="px-3 py-2 text-slate-600 text-center">{row.matched_count || "—"}</td><td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 whitespace-nowrap ${view[1]}`} title={row.reason}>{view[0]}</span></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {result && <div className={`rounded-xl px-3 py-2 text-sm ${result.updated > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{result.updated > 0 ? `นำเข้าสำเร็จ ${result.matched_names || matched} ชื่อ · อัปเดต ${result.updated} แถวในแอป · ข้าม ${result.skipped || 0} ชื่อ${result.errors?.length ? ` · ล้มเหลว ${result.errors.length} รายการ` : ""}` : `นำเข้าไม่สำเร็จ: ${result.error || result.errors?.[0]?.error || "ไม่มีรายการที่อัปเดต"}`}</div>}
        </div>
        <div className="border-t border-slate-200 p-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={state.applying} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-40">{result?.updated > 0 ? "ปิด" : "ยกเลิก"}</button>
          {!result?.updated && <button onClick={onApply} disabled={!matched || state.applying} className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40 flex items-center gap-2">{state.applying && <Loader2 size={15} className="animate-spin" />}ยืนยันอัปเดต {matchedRecords} แถว</button>}
        </div>
      </div>
    </div>
  );
}

// รายละเอียดลูกค้า 1 คน — ดูบทสนทนาที่ดึงมา + แก้สถานะ/ข้อมูลติดต่อได้
function CustomerDetailModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({
    stage: row.stage || "new",
    trade_id: row.trade_id || "",
    phone: row.phone || "",
    email: row.email || "",
    username: row.username || "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);   // ผลส่งสถานะไป Meta (ทดสอบ)
  const fmt = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }); } catch { return t || "-"; } };
  const transcript = Array.isArray(row.transcript) ? row.transcript : [];
  const srcLabel = (row.source === "ad" ? "โฆษณา" : row.source === "organic" ? "ออร์แกนิก" : "ไม่ทราบ") + (row.entry_ad_id ? ` #${row.entry_ad_id}` : "");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    const patch = {
      stage: form.stage, stage_manual: form.stage,
      trade_id: form.trade_id.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      username: form.username.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("chat_customers").update(patch).eq("id", row.id);
    setSaving(false);
    if (error) { alert("บันทึกไม่สำเร็จ: " + error.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    onSaved?.(row.id, patch);
  }

  // ทดสอบส่งสถานะปัจจุบันไปติดเป็น Custom Label บน Meta (ราย 1 คน)
  async function pushToMeta() {
    setPushing(true); setPushResult(null);
    const { data, error } = await supabase.functions.invoke("meta-push-labels", { body: { id: row.id } });
    setPushing(false);
    if (error) { setPushResult({ ok: false, msg: await readFunctionErrorMessage(error) }); return; }
    if (!data?.ok) { setPushResult({ ok: false, msg: data?.error || "ส่งไม่สำเร็จ" }); return; }
    const r0 = data.results?.[0];
    if (r0?.skipped) {
      setPushResult({ ok: true, msg: `ข้าม — ลูกค้ามีป้าย "สร้างคอนเวอร์ชั่นแล้ว" อยู่แล้ว ไม่ดาวน์เกรดเป็น "${r0.label}"` });
    } else if (r0?.assigned) {
      setPushResult({ ok: true, msg: `ติดป้าย "${r0.label}" ให้ลูกค้าบน Meta สำเร็จ${r0.removed_others ? ` (แทนที่ป้ายสถานะเดิม ${r0.removed_others})` : ""}` });
    } else {
      const detail = r0?.error || (data.label_errors?.length ? data.label_errors.join(" · ") : "") || "ติดป้ายไม่สำเร็จ — เช็คสิทธิ์ token (pages_messaging)";
      setPushResult({ ok: false, msg: detail });
    }
  }

  const fieldCls = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onMouseDown={(e) => {
        // ปิดเฉพาะเมื่อเริ่มกดบนฉากหลังจริง ๆ การลากเลือกข้อความใน input
        // อาจปล่อยเมาส์นอกช่องและเกิด click ที่ ancestor ได้ จึงห้ามใช้ onClick ปิด modal
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800 truncate">{row.customer_name || "(ไม่มีชื่อ)"}</h3>
            <p className="text-xs text-slate-500 truncate">{row.page_name || row.page_id} · เฟสบุคไอดี {row.psid || "-"}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0" aria-label="ปิด"><X size={20} /></button>
        </div>

        <div className="p-4 space-y-5">
          {/* สรุปข้อมูลที่มา */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[11px] text-slate-400">แหล่งที่มา: {srcLabel} · ข้อความลูกค้า/รวม: {row.user_message_count}/{row.message_count} · ล่าสุด: {fmt(row.last_message_at)}</div>
          </div>

          {/* ทดสอบส่งสถานะไป Meta (ติดเป็น Custom Label บนบทสนทนาของเพจ) */}
          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-medium text-slate-700">ส่งสถานะไป Meta (ทดสอบ)</div>
                <p className="text-[11px] text-slate-500">ติดป้าย "{CHAT_STAGES.find((s) => s.key === row.stage)?.label || row.stage}" ให้ลูกค้าคนนี้บนกล่องข้อความของเพจ · แทนที่เฉพาะป้ายสถานะระบบเดิม (ป้ายอื่นที่แอดมินติดเอง เช่น "ชำระเงินแล้ว" ไม่ถูกแตะ)</p>
              </div>
              <button onClick={pushToMeta} disabled={pushing || !row.psid} className="bg-brand-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-1.5 shrink-0">
                {pushing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} ทดสอบส่งป้าย
              </button>
            </div>
            {!row.psid && <div className="text-[11px] text-rose-500">ลูกค้าคนนี้ไม่มี PSID จึงส่งไม่ได้</div>}
            {pushResult && (
              <div className={`text-xs rounded-lg px-3 py-2 ${pushResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
                {pushResult.ok ? "✓ " : "✗ "}{pushResult.msg}
              </div>
            )}
          </div>

          {/* แก้ไขข้อมูล */}
          <div>
            <div className="text-sm font-medium text-slate-700 mb-2">แก้ไขข้อมูล</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">สถานะ</label>
                <select value={form.stage} onChange={(e) => set("stage", e.target.value)} className={fieldCls}>
                  {CHAT_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">ไอดีเทรด</label>
                <input value={form.trade_id} onChange={(e) => set("trade_id", e.target.value)} className={fieldCls} />
              </div>
              <div>
                <label className="text-xs text-slate-500">เบอร์โทร</label>
                <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className={fieldCls} />
              </div>
              <div>
                <label className="text-xs text-slate-500">อีเมล</label>
                <input value={form.email} onChange={(e) => set("email", e.target.value)} className={fieldCls} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Username (TradingView)</label>
                <input value={form.username} onChange={(e) => set("username", e.target.value)} className={fieldCls} />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button onClick={save} disabled={saving} className="bg-brand-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2">
                {saving ? <Loader2 className="animate-spin" size={15} /> : null} บันทึก
              </button>
              {saved && <span className="text-sm text-emerald-700">บันทึกแล้ว</span>}
            </div>
          </div>

          {/* บทสนทนาที่ดึงมา */}
          <div>
            <div className="text-sm font-medium text-slate-700 mb-1">บทสนทนาที่ดึงมา ({transcript.length} ข้อความ)</div>
            {transcript.length === 0 ? (
              <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-4 text-center">
                ยังไม่มีบทสนทนาเก็บไว้ — ต้อง deploy ฟังก์ชันซิงก์เวอร์ชันใหม่ + รัน migration แล้วซิงก์ใหม่ ระบบจึงจะเก็บบทสนทนาให้
              </div>
            ) : (
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {transcript.map((m, i) => (
                  <div key={i} className={`flex ${m.w === "u" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${m.w === "u" ? "bg-slate-100 text-slate-800" : "bg-brand-500 text-white"}`}>
                      <div className="text-[10px] opacity-70 mb-0.5">{m.w === "u" ? "ลูกค้า" : "เพจ"}{m.at ? ` · ${fmt(m.at)}` : ""}</div>
                      <div className="whitespace-pre-wrap break-words">{m.t}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
