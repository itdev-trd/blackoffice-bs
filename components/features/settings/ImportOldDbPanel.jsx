"use client";

// นำเข้าข้อมูลจากระบบเก่าด้วยไฟล์ Excel/CSV
//
// ที่มา: ระบบเก่าอยู่คนละ Supabase org ที่เข้าถึงข้ามกันไม่ได้ (ลองแล้วได้ permission denied)
// แต่ export Excel/CSV ได้ จึงย้ายผ่านไฟล์
//
// จุดสำคัญของหน้านี้: ต้องกด "ตรวจก่อน" เห็นตัวเลขแล้วจึงกด "นำเข้าจริง" ได้
// เพราะการเขียนทับข้อมูลลูกค้าพันกว่าคนย้อนกลับยาก — ให้เห็นก่อนว่าจะเพิ่มกี่แถว เติมกี่แถว

import { useRef, useState } from "react";
import { Loader2, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { IMPORT_TABLES, parseTableFile, convertTvLegacyRows } from "@/tooling/table-import.js";

const CHUNK = 1000;   // edge function รับไม่เกิน 2,000 แถว/รอบ เผื่อไว้ครึ่ง

export default function ImportOldDbPanel() {
  const fileRef = useRef(null);
  const [parsed, setParsed] = useState(null);   // { table, rows, headers, fileName }
  const [forced, setForced] = useState("");     // เลือกตารางเองเมื่อเดาไม่ออก
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  // "fill" = เติมเฉพาะช่องว่าง (ปลอดภัย) · "replace" = ทับด้วยค่าจากไฟล์
  const [onConflict, setOnConflict] = useState("fill");
  const [scripts, setScripts] = useState([]);      // tv_scripts สำหรับไฟล์ที่ไม่มี Indicator
  const [pickedScript, setPickedScript] = useState("");
  const [pendingLegacy, setPendingLegacy] = useState(null);

  function reset() { setParsed(null); setPreview(null); setErr(""); setDone(null); setPendingLegacy(null); }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    setBusy("parse");
    try {
      const res = await parseTableFile(file, forced || null);

      // ไฟล์ export จากหน้าเว็บระบบเก่า: คอลัมน์ Indicator เป็นชื่อสคริปต์ ไม่ใช่ pine_id
      // ต้องอ่าน tv_scripts จากฐานใหม่มาแปลงก่อน — ถ้าชื่อไม่ตรงจะบอกตรงๆ ไม่เดา
      if (res.legacy === "tv_access") {
        const { data: sc } = await supabase.from("tv_scripts").select("pine_id, name");
        setScripts(sc || []);
        // ไฟล์ที่ export จากมุมมองสคริปต์เดียวจะไม่มีคอลัมน์ Indicator
        // เดาเองไม่ได้ ถ้าเดาผิดคนทั้งไฟล์จะไปผูกกับสคริปต์ผิด — ให้เลือกก่อน
        if (res.needsScript && !pickedScript) {
          setPendingLegacy({ ...res, fileName: file.name });
          setErr("");
          return;
        }
        const conv = convertTvLegacyRows(res.rawRows, res.headers, sc || [], pickedScript || null);
        if (conv.unmatchedScripts.length) {
          setErr(
            `ชื่อ Indicator ในไฟล์ไม่ตรงกับสคริปต์ในระบบ: ${conv.unmatchedScripts.join(", ")} — ` +
            `แก้ชื่อสคริปต์ในหน้าตั้งค่า TV ให้ตรงก่อน (ระบบมี: ${(scripts || []).map((x) => x.name).join(", ") || "ยังไม่มีสคริปต์"})`
          );
          return;
        }
        if (!conv.rows.length) { setErr("แปลงข้อมูลไม่ได้เลย — ตรวจว่าคอลัมน์ User TV มีค่า"); return; }
        setPendingLegacy(null);
        setParsed({ table: "tv_access", rows: conv.rows, headers: res.headers, fileName: file.name, legacy: true });
        return;
      }

      setParsed({ ...res, fileName: file.name });
    } catch (e2) {
      setErr(e2?.message || String(e2));
    } finally { setBusy(""); }
  }

  async function call(mode) {
    if (!parsed) return;
    setBusy(mode); setErr(""); if (mode === "preview") setDone(null);
    try {
      // รวมผลทุกก้อน — ไฟล์ลูกค้า 7,358 แถวจะถูกแบ่งเป็น 8 รอบ
      const total = { will_insert: 0, will_fill_blanks: 0, already_complete: 0, skipped: 0, usable: 0, applied: 0, duplicate_in_file: 0 };
      let label = "", key = [], examples = [];
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const chunk = parsed.rows.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("import-table", {
          body: { table: parsed.table, rows: chunk, mode, on_conflict: onConflict },
        });
        if (error) throw new Error(await readFunctionErrorMessage(error));
        if (!data?.ok) throw new Error(data?.error || "นำเข้าไม่สำเร็จ");
        for (const k of Object.keys(total)) total[k] += Number(data[k] || 0);
        label = data.label; key = data.key || [];
        if (examples.length < 10) examples = examples.concat(data.skipped_examples || []).slice(0, 10);
      }
      if (mode === "preview") setPreview({ ...total, label, key, examples });
      else { setDone(total); setPreview(null); }
    } catch (e2) {
      setErr(e2?.message || String(e2));
    } finally { setBusy(""); }
  }

  const num = (n) => Number(n || 0).toLocaleString("th-TH");

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="font-semibold text-slate-800">นำเข้าข้อมูลจากระบบเก่า</h3>
        <p className="mt-1 text-xs text-slate-500">
          อัปโหลดไฟล์ Excel (.xlsx) หรือ CSV ที่ export มาจากฐานข้อมูลเก่า · ระบบจะเดาเองว่าเป็นข้อมูลตารางไหนจากหัวคอลัมน์
        </p>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            <b>เติมเฉพาะช่องที่ว่าง ไม่ทับของเดิม</b> — แถวที่มีอยู่แล้วในระบบใหม่จะถูกเติมเฉพาะช่องที่ยังไม่มีค่า
            เพราะข้อมูลในระบบใหม่ (เช่นบทสนทนาและสถานะการอ่าน) สดกว่าของเก่า
            <div className="mt-1">ต้องกด <b>ตรวจก่อน</b> ดูตัวเลขก่อนจึงจะนำเข้าจริงได้</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy === "parse" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} เลือกไฟล์
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={pickFile} />

        <select
          value={forced}
          onChange={(e) => { setForced(e.target.value); reset(); }}
          className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
        >
          <option value="">ให้ระบบเดาตารางเอง</option>
          {Object.entries(IMPORT_TABLES).map(([t, s]) => (
            <option key={t} value={t}>{s.label} ({t})</option>
          ))}
        </select>
        {parsed && <button type="button" onClick={reset} className="text-[12px] text-slate-500 underline">ล้าง</button>}
      </div>

      <div className="rounded-xl border border-slate-200 p-3">
        <div className="text-[11px] font-medium text-slate-600">ถ้าเจอแถวที่มีอยู่แล้ว</div>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {[
            ["fill", "เติมเฉพาะช่องที่ว่าง", "ไม่ทับของเดิม — ปลอดภัยกว่า"],
            ["replace", "แทนที่ด้วยค่าจากไฟล์", "ใช้เมื่อไฟล์เป็นข้อมูลที่ถูกต้องกว่า"],
          ].map(([val, title, hint]) => (
            <label key={val} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${onConflict === val ? "border-brand-600 bg-brand-50" : "border-slate-200"}`}>
              <input type="radio" name="oc" checked={onConflict === val} onChange={() => { setOnConflict(val); setPreview(null); }} className="mt-0.5" />
              <span>
                <span className="block text-[13px] font-medium text-slate-800">{title}</span>
                <span className="block text-[11px] text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ไฟล์ export จากมุมมองสคริปต์เดียวไม่มีคอลัมน์ Indicator — เดาเองไม่ได้
          ถ้าเดาผิด คนทั้งไฟล์จะไปผูกกับสคริปต์ผิด จึงบังคับให้เลือกก่อน */}
      {pendingLegacy && (
        <div className="rounded-xl border border-amber-400 bg-amber-50 p-3">
          <div className="text-[13px] font-semibold text-amber-900">ไฟล์นี้ไม่มีคอลัมน์ Indicator</div>
          <div className="mt-0.5 text-[11px] text-amber-900">
            {pendingLegacy.fileName} · {pendingLegacy.rawRows.length} แถว — เป็น export ของสคริปต์เดียว ต้องเลือกว่าสคริปต์ไหน
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={pickedScript}
              onChange={(e) => setPickedScript(e.target.value)}
              className="rounded-lg border border-amber-400 bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="">— เลือกสคริปต์ —</option>
              {scripts.map((sc) => <option key={sc.pine_id} value={sc.pine_id}>{sc.name}</option>)}
            </select>
            <button
              type="button"
              disabled={!pickedScript}
              onClick={() => {
                const conv = convertTvLegacyRows(pendingLegacy.rawRows, pendingLegacy.headers, scripts, pickedScript);
                if (!conv.rows.length) { setErr("แปลงข้อมูลไม่ได้ — ตรวจว่าคอลัมน์ User TV มีค่า"); return; }
                setPendingLegacy(null);
                setParsed({ table: "tv_access", rows: conv.rows, headers: pendingLegacy.headers, fileName: pendingLegacy.fileName, legacy: true });
              }}
              className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              ใช้สคริปต์นี้
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="rounded-lg bg-rose-50 px-3 py-2.5 text-[12px] leading-relaxed text-rose-700">{err}</div>
      )}

      {parsed && (
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-sm text-slate-700">
            ไฟล์ <b>{parsed.fileName}</b> · {num(parsed.rows.length)} แถว
          </div>
          <div className="mt-0.5 text-[12px] text-slate-500">
            {parsed.legacy && <span className="mr-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">ไฟล์จากหน้าเว็บระบบเก่า · แปลงวันที่ พ.ศ. และชื่อสคริปต์แล้ว</span>}
            ตรวจแล้วเป็นข้อมูลของ <b className="text-slate-800">{IMPORT_TABLES[parsed.table]?.label || parsed.table}</b>
            {" "}(<span className="font-mono">{parsed.table}</span>) · จับคู่แถวด้วย{" "}
            <span className="font-mono">{(IMPORT_TABLES[parsed.table]?.key || []).join(" + ")}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => call("preview")}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy === "preview" ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} ตรวจก่อน (ไม่เขียนอะไร)
            </button>
            <button
              type="button"
              onClick={() => call("apply")}
              disabled={!!busy || !preview}
              title={!preview ? "กดตรวจก่อนแล้วดูตัวเลขก่อนนำเข้า" : ""}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
            >
              {busy === "apply" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} นำเข้าจริง
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="rounded-xl border border-brand-400/50 bg-brand-50/40 p-3.5">
          <div className="text-sm font-semibold text-slate-800">ผลตรวจ (ยังไม่เขียนอะไรลงฐาน)</div>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["เพิ่มใหม่", preview.will_insert, "text-emerald-700"],
              [onConflict === "replace" ? "แทนที่ของเดิม" : "เติมช่องว่าง", preview.will_fill_blanks, "text-blue-700"],
              [onConflict === "replace" ? "เหมือนกันอยู่แล้ว" : "ครบอยู่แล้ว", preview.already_complete, "text-slate-600"],
              ["ข้าม (ไม่มีคีย์)", preview.skipped, preview.skipped > 0 ? "text-amber-700" : "text-slate-600"],
            ].map(([label, val, tone]) => (
              <div key={label}>
                <div className={`text-xl font-bold tabular-nums ${tone}`}>{num(val)}</div>
                <div className="text-[11px] text-slate-600">{label}</div>
              </div>
            ))}
          </div>
          {preview.duplicate_in_file > 0 && (
            <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] text-slate-700">
              ไฟล์มีแถวคีย์ซ้ำกันเอง <b>{num(preview.duplicate_in_file)}</b> แถว — ใช้แถวแรกที่พบ (ข้อมูลล่าสุด) ตัดที่เหลือ
            </div>
          )}
          {preview.examples?.length > 0 && (
            <div className="mt-3 border-t border-brand-400/30 pt-2 text-[11px] text-slate-600">
              <div className="font-medium">ตัวอย่างแถวที่ข้าม</div>
              {preview.examples.slice(0, 5).map((s, i) => (
                <div key={i}>แถว {s.row}: {s.reason}</div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-600">ถ้าตัวเลขตรงกับที่คาด กด “นำเข้าจริง” ได้เลย</p>
        </div>
      )}

      {done && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-sm text-emerald-900">
          <div className="font-semibold">นำเข้าเรียบร้อย</div>
          <div className="mt-1 text-[12px]">
            เขียนไปทั้งหมด <b>{num(done.applied)}</b> แถว · เพิ่มใหม่ {num(done.will_insert)} ·{" "}
            {onConflict === "replace" ? "แทนที่" : "เติมช่องว่าง"} {num(done.will_fill_blanks)}
            {done.duplicate_in_file > 0 && <> · ซ้ำในไฟล์ {num(done.duplicate_in_file)}</>}
            {done.skipped > 0 && <> · ข้าม {num(done.skipped)}</>}
          </div>
        </div>
      )}
    </div>
  );
}
