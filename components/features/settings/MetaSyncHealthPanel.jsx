"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, GitCompare } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { pushLeadStageToMeta } from "@/lib/utils/lead-stage";

const KIND_TEXT = {
  missing_on_meta: ["ยังไม่มีบน Meta", "เว็บมีสถานะนี้แต่ Meta ไม่มีป้ายตรงกัน — กดส่งป้ายใหม่ได้"],
  meta_differs: ["ป้ายบน Meta ต่างจากเว็บ", "น่าจะมีคนแก้ป้ายใน Meta โดยตรง — กดส่งป้ายจากเว็บทับได้"],
  meta_higher: ["Meta สูงกว่าเว็บ", "Meta มีป้ายคอนเวอร์ชั่น/เปิดบัญชี ระบบตั้งใจไม่ถอดให้ (กันดาวน์เกรด) — ถอดใน Meta เอง หรือแก้สถานะในเว็บให้ตรง"],
};
const CHANNEL = { messenger: "Messenger", ad: "Messenger (แอด)" };

function Stat({ label, value, tone = "slate" }) {
  const color = { slate: "text-slate-800", rose: "text-rose-600", amber: "text-amber-600", emerald: "text-emerald-600" }[tone];
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <div className={`text-lg font-semibold ${color}`}>{value ?? "—"}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

export default function MetaSyncHealthPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");          // "capi" | "labels" | id ของแถวที่กำลังแก้
  const [progress, setProgress] = useState("");
  const [diff, setDiff] = useState(null);        // { rows, checked, matched, errors, total, done, firstError }
  const [diffRunning, setDiffRunning] = useState(false);
  const stopRef = useRef(false);

  async function call(body) {
    const { data: res, error: err } = await supabase.functions.invoke("meta-sync-health", { body });
    if (err) throw new Error(await readFunctionErrorMessage(err));
    if (!res?.ok) throw new Error(res?.error || "ไม่สำเร็จ");
    return res;
  }
  async function load() {
    setLoading(true); setError("");
    try { setData(await call({ action: "summary" })); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  // ส่งป้ายเว็บ → Meta ทีละห้อง (ฟังก์ชันเดิม meta-push-labels ที่หน้าจัดการลูกค้าใช้อยู่)
  async function pushLabel(id) {
    const { data: res, error: err } = await supabase.functions.invoke("meta-push-labels", { body: { id } });
    if (err) return { ok: false, note: await readFunctionErrorMessage(err) };
    const r = res?.results?.[0];
    if (!res?.ok || (r && r.error)) return { ok: false, note: r?.error || res?.error || "ไม่สำเร็จ" };
    return { ok: true, note: "" };
  }

  async function retryCapi() {
    const list = data?.capi_failed || [];
    if (!list.length) return;
    setBusy("capi"); setProgress("");
    let ok = 0, fail = 0;
    for (let i = 0; i < list.length; i++) {
      setProgress(`กำลังส่ง CAPI ใหม่ ${i + 1}/${list.length}`);
      const r = await pushLeadStageToMeta(list[i].id);
      if (r.state === "error") fail++; else ok++;
    }
    setProgress(`ส่ง CAPI ใหม่เสร็จ: สำเร็จ/ข้าม ${ok} · ยังพัง ${fail}`);
    setBusy(""); void load();
  }
  async function retryLabels(list, after) {
    if (!list.length) return;
    setBusy("labels"); setProgress("");
    let ok = 0, fail = 0;
    for (let i = 0; i < list.length; i++) {
      setProgress(`กำลังส่งป้ายใหม่ ${i + 1}/${list.length}`);
      const r = await pushLabel(list[i].id);
      if (r.ok) ok++; else fail++;
    }
    setProgress(`ส่งป้ายใหม่เสร็จ: สำเร็จ ${ok} · ยังพัง ${fail}`);
    setBusy(""); await load(); after?.();
  }
  async function fixOne(row) {
    setBusy(row.id);
    const r = await pushLabel(row.id);
    setBusy("");
    if (r.ok) setDiff((d) => d && ({ ...d, rows: d.rows.filter((x) => x.id !== row.id) }));
    else setProgress(`ส่งป้ายของ ${row.name} ไม่สำเร็จ: ${r.note}`);
    void load();
  }

  // อ่านป้ายจริงจาก Meta ทีละชุด 30 ห้อง วนจนครบหรือกดหยุด
  async function runDiff() {
    stopRef.current = false; setDiffRunning(true);
    let offset = 0;
    const acc = { rows: [], checked: 0, matched: 0, errors: 0, total: null, done: false, firstError: "" };
    setDiff({ ...acc });
    try {
      for (;;) {
        const res = await call({ action: "diff", offset });
        acc.rows = [...acc.rows, ...res.mismatches];
        acc.checked += res.checked; acc.matched += res.matched; acc.errors += res.errors;
        acc.total = res.total; acc.firstError = acc.firstError || res.first_error || "";
        const stuck = res.next_offset <= offset;
        offset = res.next_offset;
        acc.done = !res.has_more || stuck;
        setDiff({ ...acc });
        // ถ้า Meta ปฏิเสธทั้งชุดให้หยุด ไม่ไล่ยิงต่อ
        if (acc.done || stopRef.current || (res.errors > 0 && res.checked === 0)) break;
      }
    } catch (e) { setDiff({ ...acc, firstError: e.message }); }
    finally { setDiffRunning(false); }
  }

  const c = data?.counts;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-800">สุขภาพการส่งข้อมูลไป Meta</h3>
          <p className="text-xs text-slate-500 mt-0.5">ดูว่ามีรายไหนส่ง Conversions API / ป้ายไป Meta ไม่สำเร็จ แล้วกดส่งใหม่ได้ที่นี่ · เพจ BeSight</p>
        </div>
        <button onClick={load} disabled={loading} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-50">
          {loading ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} รีเฟรช
        </button>
      </div>

      {error && <div className="text-xs text-rose-600">{error}</div>}
      {c && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Stat label="CAPI ส่งสำเร็จ" value={c.capi_success} tone="emerald" />
          <Stat label="CAPI พัง" value={c.capi_failed} tone={c.capi_failed ? "rose" : "slate"} />
          <Stat label="CAPI ข้าม" value={c.capi_skipped} />
          <Stat label="ป้ายส่งพัง" value={c.label_error} tone={c.label_error ? "rose" : "slate"} />
          <Stat label="เว็บนำหน้า Meta" value={c.web_ahead} tone={c.web_ahead ? "amber" : "slate"} />
        </div>
      )}
      {progress && <div className="text-xs text-slate-600">{progress}</div>}

      {data?.capi_failed?.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><AlertTriangle size={14} className="text-rose-500" /> CAPI ส่งไม่สำเร็จ ({data.capi_failed.length})</div>
            <button onClick={retryCapi} disabled={!!busy} className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-brand-700 disabled:opacity-50">
              {busy === "capi" ? "กำลังส่ง..." : "ส่งใหม่ทั้งหมด"}
            </button>
          </div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 max-h-64 overflow-y-auto">
            {data.capi_failed.map((r) => (
              <li key={r.id} className="px-3 py-2 text-xs">
                <div className="font-medium text-slate-800">{r.name} <span className="text-slate-400 font-normal">· {CHANNEL[r.source] || r.source} · {r.stage}</span></div>
                <div className="text-rose-600 break-words">{r.error || "ไม่ทราบสาเหตุ"}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data?.label_errors?.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><AlertTriangle size={14} className="text-rose-500" /> ป้ายส่งไม่สำเร็จ ({data.label_errors.length})</div>
            <button onClick={() => retryLabels(data.label_errors)} disabled={!!busy} className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-brand-700 disabled:opacity-50">
              {busy === "labels" ? "กำลังส่ง..." : "ส่งป้ายใหม่ทั้งหมด"}
            </button>
          </div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 max-h-64 overflow-y-auto">
            {data.label_errors.map((r) => (
              <li key={r.id} className="px-3 py-2 text-xs">
                <div className="font-medium text-slate-800">{r.name} <span className="text-slate-400 font-normal">· {r.stage} · ลองแล้ว {r.attempts} ครั้ง{r.attempts >= 3 ? " (ระบบพักไว้)" : ""}</span></div>
                <div className="text-rose-600 break-words">{r.error}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data?.web_ahead?.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-medium text-slate-800">เว็บเปลี่ยนสถานะแล้ว แต่ป้ายบน Meta ยังเป็นสถานะเก่า ({data.web_ahead.length})</div>
            <button onClick={() => retryLabels(data.web_ahead)} disabled={!!busy} className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-brand-700 disabled:opacity-50">
              {busy === "labels" ? "กำลังส่ง..." : "ส่งป้ายตามเว็บ"}
            </button>
          </div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 max-h-48 overflow-y-auto">
            {data.web_ahead.map((r) => (
              <li key={r.id} className="px-3 py-2 text-xs text-slate-700">{r.name}: ส่งล่าสุดเป็น <b>{r.label_push_stage}</b> → ตอนนี้ในเว็บเป็น <b>{r.stage}</b></li>
            ))}
          </ul>
        </section>
      )}
      {c && !c.capi_failed && !c.label_error && !c.web_ahead && (
        <div className="text-xs text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} /> ไม่มีรายการค้างหรือส่งพัง</div>
      )}

      <section className="rounded-xl border border-slate-200 p-4 space-y-2">
        <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><GitCompare size={14} /> เทียบป้ายกับ Meta จริง</div>
        <p className="text-[11px] text-slate-500">
          อ่านป้ายสถานะของแต่ละห้องจาก Meta มาเทียบกับสถานะในเว็บ (ชุดละ 30 ห้อง) · อ่านอย่างเดียว ไม่แก้อะไรบน Meta จนกว่าคุณกดส่งป้ายเอง · ไม่รวม LINE / Instagram ที่ไม่มีป้าย
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={runDiff} disabled={diffRunning} className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1.5">
            {diffRunning ? <Loader2 className="animate-spin" size={13} /> : <GitCompare size={13} />} {diffRunning ? "กำลังตรวจ..." : "เริ่มเทียบ"}
          </button>
          {diffRunning && <button onClick={() => { stopRef.current = true; }} className="text-xs text-slate-500 hover:underline">หยุด</button>}
          {diff && <span className="text-xs text-slate-600">ตรวจแล้ว {diff.checked}{diff.total != null ? `/${diff.total}` : ""} · ตรงกัน {diff.matched} · ไม่ตรง {diff.rows.length}{diff.errors ? ` · อ่านไม่ได้ ${diff.errors}` : ""}{diff.done && !diffRunning ? " · ครบแล้ว" : ""}</span>}
        </div>
        {diff?.firstError && <div className="text-xs text-amber-700 break-words">Meta ตอบ: {diff.firstError}</div>}
        {diff?.rows.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 max-h-72 overflow-y-auto">
            {diff.rows.map((r) => (
              <li key={r.id} className="px-3 py-2 text-xs flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800">{r.name} <span className="text-amber-700 font-normal">· {KIND_TEXT[r.kind]?.[0]}</span></div>
                  <div className="text-slate-600">เว็บ: {r.stage} → ควรมี [{r.want.join(", ")}] · Meta มี [{r.meta.join(", ") || "ไม่มีป้ายสถานะ"}]</div>
                  <div className="text-[11px] text-slate-400">{KIND_TEXT[r.kind]?.[1]}</div>
                </div>
                {r.kind !== "meta_higher" && (
                  <button onClick={() => fixOne(r)} disabled={!!busy} className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-50">
                    {busy === r.id ? "กำลังส่ง..." : "ส่งป้ายตามเว็บ"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
