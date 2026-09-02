"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, MessageSquare, CheckCircle2, Clock, AlertTriangle, ArrowUpCircle } from "lucide-react";
import { StatCard as DsStatCard } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { bangkokDate } from "@/lib/utils/date";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { exportPageNavHtml } from "@/lib/utils/export";
import Spinner from "@/components/shared/Spinner";
import NumInput from "@/components/shared/NumInput";
import { AI_PROMPT_FEATURES } from "@/components/features/settings/SettingsPanelsA";

export function AiPromptsPanel() {
  const [prompts, setPrompts] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "ai_prompts").maybeSingle();
      setPrompts((data?.value && typeof data.value === "object") ? data.value : {});
    })();
  }, []);
  async function save() {
    setSaving(true); setSaved(false); setSaveError("");
    const { error } = await supabase.from("settings").upsert({ key: "ai_prompts", value: prompts, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) { setSaveError(error.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }
  if (!prompts) return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"><Spinner label="กำลังโหลด..." /></div>;
  const setOne = (k, v) => setPrompts({ ...prompts, [k]: v });
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">คำสั่ง AI (Prompt) ของแต่ละฟีเจอร์</h3>
        <p className="text-xs text-slate-500 mt-1">กำหนด system prompt เองได้ต่อฟีเจอร์ · <span className="text-slate-600">เว้นว่าง = ใช้ค่าเริ่มต้นของระบบ</span> · แก้แล้วกด "บันทึกทั้งหมด" ด้านล่าง (มีผลรอบถัดไปที่เรียกใช้ฟีเจอร์นั้น)</p>
        <p className="text-[11px] text-slate-400 mt-1">prompt ของ "เขียนคอนเทนต์โฆษณา" ปรับได้ในหน้าสร้างคอนเทนต์ (โหมด merge/override)</p>
      </div>
      <div className="space-y-3">
        {AI_PROMPT_FEATURES.map((f) => (
          <div key={f.key} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-medium text-slate-800">{f.label}</div>
                <p className="text-[11px] text-slate-500">{f.desc} · <span className="font-mono text-slate-400">{f.key}</span></p>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded ${prompts[f.key]?.trim() ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-slate-500"}`}>{prompts[f.key]?.trim() ? "ใช้ prompt ของคุณ" : "ค่าเริ่มต้น"}</span>
            </div>
            <textarea rows={4} value={prompts[f.key] || ""} onChange={(e) => setOne(f.key, e.target.value)} placeholder="(เว้นว่าง = ใช้ค่าเริ่มต้นของระบบ)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono leading-relaxed" />
            {prompts[f.key] ? <button type="button" onClick={() => setOne(f.key, "")} className="text-[11px] text-rose-600 hover:underline">ล้าง (กลับไปใช้ค่าเริ่มต้น)</button> : null}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60">{saving ? "กำลังบันทึก..." : "บันทึกทั้งหมด"}</button>
        {saved && <span className="text-sm text-emerald-600">บันทึกแล้ว ✓</span>}
        {saveError && <span className="text-sm text-rose-600">{saveError}</span>}
      </div>
    </div>
  );
}

// ตั้งค่าการเชื่อมต่อและซิงก์แชท (ไม่ใช้ AI หรือคีย์เวิร์ดจัดสถานะลูกค้า)
export function ChatSyncConfigPanel() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [labelTest, setLabelTest] = useState(null);   // ผลทดสอบดึงป้ายกำกับจาก Meta
  const [labelTesting, setLabelTesting] = useState(false);
  const [dsLoading, setDsLoading] = useState(false);   // กำลังดึง Dataset ของทุกเพจ
  const [dsResult, setDsResult] = useState(null);      // ผลการดึง Dataset รายเพจ
  const [webhookBusy, setWebhookBusy] = useState("");   // "" | "subscribe" | "status"
  const [webhookRes, setWebhookRes] = useState(null);
  async function runWebhook(action) {
    setWebhookBusy(action); setWebhookRes(null);
    const { data, error } = await supabase.functions.invoke("subscribe-webhook", { body: { action } });
    setWebhookBusy("");
    if (error) { setWebhookRes({ ok: false, error: await readFunctionErrorMessage(error) }); return; }
    setWebhookRes(data);
  }
  const [labelPages, setLabelPages] = useState([]);   // รายชื่อเพจสำหรับเลือกทดสอบ
  const [labelPageId, setLabelPageId] = useState("");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("page_lead_config").select("page_id, page_name").order("page_name");
      const ps = (data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id }));
      setLabelPages(ps);
      if (ps.length) setLabelPageId(ps[0].id);
    })();
  }, []);
  async function testLabels() {
    setLabelTesting(true); setLabelTest(null);
    const { data, error } = await supabase.functions.invoke("page-labels", { body: labelPageId ? { page_id: labelPageId } : {} });
    setLabelTesting(false);
    if (error) { setLabelTest({ ok: false, error: await readFunctionErrorMessage(error) }); return; }
    if (data && data.ok === false) { setLabelTest({ ok: false, error: data.error || "ดึงไม่สำเร็จ" }); return; }
    setLabelTest(data);
  }
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "chat_sync_config").maybeSingle();
      setCfg(data?.value || { per_page: 200, messages: 30 });
    })();
  }, []);
  async function save() {
    setSaving(true);
    // ล้างค่า legacy ที่เคยสั่ง AI/regex/คีย์เวิร์ดกรอกหรือจัดสถานะฐานข้อมูลลูกค้า
    const clean = { ...cfg };
    ["ai_enabled", "keywords", "keywords_qualified", "keywords_disqualified", "ai_model", "ai_model_verify", "ai_verify_enabled", "ai_mode", "ai_max_per_run", "ai_prompt", "ai_prompt_verify", "strict_trade_id", "lead_tags"].forEach((key) => delete clean[key]);
    await supabase.from("settings").upsert({ key: "chat_sync_config", value: clean, updated_at: new Date().toISOString() });
    setCfg(clean);
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500);
  }
  // ดึง Dataset ID ของทุกเพจจาก Meta (1 เพจ = 1 dataset) แล้วเก็บลง page_lead_config
  // นโยบายเก็บข้อมูลแชท
  const [retCfg, setRetCfg] = useState(null);
  const [retBusy, setRetBusy] = useState("");
  const [retStat, setRetStat] = useState(null);
  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "retention_config").maybeSingle()
      .then(({ data }) => setRetCfg(data?.value || { enabled: true, review_days: 7, purge_days: 23, mode: "transcript_only", return_on_reply: true }));
    supabase.functions.invoke("chat-retention", { body: { action: "status" } })
      .then(({ data }) => { if (data?.ok) setRetStat({ counts: data.counts }); });
  }, []);
  async function saveRet() {
    setRetBusy("save"); setRetStat(null);
    // clamp ฝั่งนี้ด้วย กันพิมพ์ 0 หรือค่าติดลบแล้วกลายเป็นล้างทันที (ฝั่งเซิร์ฟเวอร์ clamp อีกชั้น)
    const clean = {
      ...retCfg,
      review_days: Math.min(90, Math.max(1, Number(retCfg.review_days) || 7)),
      purge_days: Math.min(30, Math.max(1, Number(retCfg.purge_days) || 23)),
    };
    const { error } = await supabase.from("settings").upsert({ key: "retention_config", value: clean, updated_at: new Date().toISOString() });
    setRetBusy("");
    setRetCfg(clean);
    setRetStat(error ? { error: error.message } : { saved: true });
  }
  async function runRet(dry) {
    setRetBusy(dry ? "dry" : "run"); setRetStat(null);
    const { data, error } = await supabase.functions.invoke("chat-retention", { body: { action: "run", dry_run: dry } });
    setRetBusy("");
    if (error) { setRetStat({ error: await readFunctionErrorMessage(error) }); return; }
    if (data?.ok === false) { setRetStat({ error: data.error }); return; }
    setRetStat(data);
  }

  // เติมประเทศจาก targeting ของแอด — dry-run ได้ก่อนเขียนจริง
  const [originBusy, setOriginBusy] = useState("");
  const [originRes, setOriginRes] = useState(null);
  async function runOrigin(dry) {
    setOriginBusy(dry ? "dry" : "run"); setOriginRes(null);
    const { data, error } = await supabase.functions.invoke("detect-chat-origin", { body: { dry_run: dry } });
    setOriginBusy("");
    if (error) { setOriginRes({ error: await readFunctionErrorMessage(error) }); return; }
    if (data?.ok === false) { setOriginRes({ error: data.error }); return; }
    setOriginRes(data);
  }

  async function fetchDatasets() {
    setDsLoading(true); setDsResult(null);
    const { data, error } = await supabase.functions.invoke("page-datasets", { body: {} });
    setDsLoading(false);
    if (error) { setDsResult({ total: 0, success: 0, failed: 1, results: [], hint: await readFunctionErrorMessage(error) }); return; }
    if (data && data.ok === false) { setDsResult({ total: 0, success: 0, failed: 1, results: [], hint: data.error }); return; }
    setDsResult(data);
  }
  if (!cfg) return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"><Spinner label="กำลังโหลด..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">ตั้งค่าการซิงก์แชท</h3>
        <p className="text-xs text-slate-500 mt-0.5">ตั้งค่าการเชื่อมต่อและปริมาณการซิงก์แชท โดยไม่กรอกข้อมูลหรือเปลี่ยนสถานะลูกค้าอัตโนมัติ</p>
      </div>

      {/* Dataset ของ Conversion Leads — Meta กำหนดว่า 1 เพจ = 1 dataset จึงต้องดึงแยกรายเพจ */}
      <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-2">
        <div className="text-sm font-medium text-slate-800">Dataset สำหรับส่งสถานะไป Meta (Conversion Leads)</div>
        <p className="text-[11px] text-slate-500">
          Meta กำหนดให้ 1 เพจผูกกับ 1 ชุดข้อมูลเท่านั้น — กดปุ่มนี้ให้ระบบดึง Dataset ID ของแต่ละเพจมาเก็บอัตโนมัติ
          (ถ้าเพจไหนยังไม่มี Meta จะสร้างให้ · กดซ้ำได้ ไม่สร้างซ้ำ) · ต้องมีสิทธิ์ page_events บน token
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={fetchDatasets} disabled={dsLoading}
            className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1.5">
            {dsLoading ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} ดึง Dataset ของทุกเพจ
          </button>
          {dsResult && (
            <span className={`text-xs ${dsResult.failed ? "text-amber-700" : "text-emerald-700"}`}>
              สำเร็จ {dsResult.success}/{dsResult.total} เพจ{dsResult.failed ? ` · ไม่สำเร็จ ${dsResult.failed}` : ""}
            </span>
          )}
        </div>
        {dsResult?.hint && <div className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">{dsResult.hint}</div>}
        {dsResult?.results?.length > 0 && (
          <div className="max-h-40 overflow-y-auto space-y-0.5 text-[11px]">
            {dsResult.results.map((r) => (
              <div key={r.page_id} className="flex items-center gap-2">
                <span className={r.ok ? "text-emerald-600" : "text-rose-500"}>{r.ok ? "✓" : "✕"}</span>
                <span className="text-slate-600 truncate flex-1">{r.page}</span>
                <span className="text-slate-400 font-mono">{r.ok ? r.dataset_id : (r.error || "").slice(0, 60)}</span>
              </div>
            ))}
          </div>
        )}
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer">ตั้ง Dataset ID เองแบบเดิม (ใช้เป็นตัวสำรองเมื่อเพจไม่มีของตัวเอง)</summary>
          <input value={cfg.meta_dataset_id || ""} onChange={(e) => setCfg({ ...cfg, meta_dataset_id: e.target.value.trim() })} placeholder="เช่น 123456789012345" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </details>
      </div>

      {/* นโยบายเก็บข้อมูลแชท — แอดมินตั้งจำนวนวันเองได้ */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
        <div>
          <div className="text-sm font-medium text-slate-800">แชทที่ลูกค้าไม่สนใจแล้ว</div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            ติดแท็ก 🚫 ไม่สนใจ ในหน้าตอบแชท → ย้ายออกจากกล่องหลักไปเมนู "ไม่สนใจ" (ต่อจากบล็อกไว้)
            → ครบกำหนดให้แอดมินยืนยัน → ยืนยันแล้วจึงล้างข้อมูลตามวันที่ตั้ง
            · <span className="font-medium">ลูกค้าทักกลับมาเมื่อไหร่ ระบบดึงกลับเข้ากล่องหลักเอง</span>
          </p>
        </div>
        {retCfg && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-600">อยู่ในเมนู "ไม่สนใจ" กี่วันก่อนขอให้ยืนยัน</label>
                <input type="number" min={1} max={90} value={retCfg.review_days ?? 7}
                  onChange={(e) => setRetCfg({ ...retCfg, review_days: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <p className="mt-0.5 text-[10.5px] text-slate-400">1–90 วัน · ตั้ง 1 = พรุ่งนี้ขอยืนยันเลย</p>
              </div>
              <div>
                <label className="text-xs text-slate-600">ยืนยันแล้วอีกกี่วันจึงล้างข้อมูล</label>
                <input type="number" min={1} max={30} value={retCfg.purge_days ?? 23}
                  onChange={(e) => setRetCfg({ ...retCfg, purge_days: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <p className="mt-0.5 text-[10.5px] text-slate-400">1–30 วัน · ยกเลิกได้ก่อนถึงกำหนด</p>
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-600">ตอนครบกำหนด ให้ลบอะไร</label>
              <select value={retCfg.mode || "transcript_only"}
                onChange={(e) => setRetCfg({ ...retCfg, mode: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="transcript_only">ลบแค่บทสนทนา — เก็บชื่อ/เลขบัญชี/สถิติไว้ (แนะนำ)</option>
                <option value="full">ลบทั้งแถว — เสียประวัติเปิดบัญชี สถิติ และตัวกันซ้ำ</option>
              </select>
              {retCfg.mode === "full" && (
                <p className="mt-1 text-[11px] text-rose-600">
                  ⚠️ ลบทั้งแถวจะเสียประวัติลูกค้าที่เปิดบัญชีแล้ว สถิติการตอบ กระดานแต้ม และที่มาจากแอด
                  · ลูกค้าคนเดิมทักกลับมาจะนับเป็นลูกค้าใหม่
                </p>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={retCfg.enabled !== false}
                onChange={(e) => setRetCfg({ ...retCfg, enabled: e.target.checked })} className="h-4 w-4" />
              เปิดใช้งานการล้างข้อมูลอัตโนมัติ (งานรันทุกวัน 02:00 น.)
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={saveRet} disabled={retBusy === "save"}
                className="bg-amber-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-amber-800 disabled:opacity-60 flex items-center gap-1.5">
                {retBusy === "save" ? <Loader2 className="animate-spin" size={14} /> : null} บันทึกนโยบาย
              </button>
              <button onClick={() => runRet(true)} disabled={!!retBusy}
                className="border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5">
                {retBusy === "dry" ? <Loader2 className="animate-spin" size={14} /> : null} ดูก่อนว่าจะทำอะไร
              </button>
            </div>

            {retStat && (
              <div className="text-xs bg-white rounded-lg border border-slate-200 p-2.5 space-y-1">
                {retStat.error ? <div className="text-rose-600">{retStat.error}</div> : (
                  <>
                    {retStat.counts && (
                      <div className="flex flex-wrap gap-3 text-slate-700">
                        <span>อยู่ในเมนู <b>{retStat.counts.in_menu}</b></span>
                        <span>รอยืนยัน <b className="text-amber-600">{retStat.counts.awaiting_confirm}</b></span>
                        <span>รอล้าง <b>{retStat.counts.scheduled_purge}</b></span>
                        <span className="text-slate-400">ล้างแล้ว {retStat.counts.already_purged}</span>
                      </div>
                    )}
                    {retStat.dry_run !== undefined && (
                      <div className="text-slate-600">
                        ถ้ารันตอนนี้: ดึงกลับกล่องหลัก <b>{retStat.returned_to_inbox ?? 0}</b> ราย ·
                        ถึงกำหนดล้าง <b>{retStat.due_purge ?? 0}</b> ราย
                      </div>
                    )}
                    {retStat.saved && <div className="text-emerald-600">บันทึกนโยบายแล้ว ✓</div>}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* เติมประเทศจากแอดที่ลูกค้าทักมา — ช่วยเคสที่ลูกค้าส่งแต่สติกเกอร์/รูป/พิมพ์ผิด จนเดาภาษาจากข้อความไม่ได้ */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium text-slate-800">เติมประเทศลูกค้าจากแอดที่ทักเข้ามา</div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              ลูกค้าที่ส่งแต่สติกเกอร์/รูป หรือพิมพ์ผิด จะเดาภาษาจากข้อความไม่ได้ — ถ้าเขาทักมาจากแอด
              ระบบจะใช้ประเทศเป้าหมายของแอดนั้นแทน · แอดที่ยิงหลายประเทศจะถูกข้าม (สรุปไม่ได้)
              · ไม่ทับค่าที่แอดมินกรอกเอง
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => runOrigin(true)} disabled={!!originBusy}
              className="border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5">
              {originBusy === "dry" ? <Loader2 className="animate-spin" size={14} /> : null} ดูก่อนว่าจะเติมกี่คน
            </button>
            <button onClick={() => runOrigin(false)} disabled={!!originBusy}
              className="bg-sky-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-sky-800 disabled:opacity-60 flex items-center gap-1.5">
              {originBusy === "run" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} เติมเลย
            </button>
          </div>
        </div>
        {originRes && (
          <div className="text-xs bg-white rounded-lg border border-slate-200 p-2.5 space-y-1">
            {originRes.error ? (
              <div className="text-rose-600">{originRes.error}</div>
            ) : (
              <>
                <div className="text-slate-700">
                  {originRes.dry_run ? "จะเติมได้ " : "เติมแล้ว "}
                  <span className="font-semibold">{originRes.updated}</span> คน
                  <span className="text-slate-400"> · ตรวจแอด {originRes.ads_checked} ตัว · เข้าเกณฑ์ {originRes.candidates} คน</span>
                </div>
                {originRes.by_country && Object.keys(originRes.by_country).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(originRes.by_country).map(([c, n]) => (
                      <span key={c} className="rounded-full bg-sky-50 text-sky-700 px-2 py-0.5">{c} {n}</span>
                    ))}
                  </div>
                )}
                {originRes.note && <div className="text-slate-400">{originRes.note}</div>}
                {originRes.skipped_ads && Object.keys(originRes.skipped_ads).length > 0 && (
                  <div className="text-slate-400">
                    ข้าม {Object.keys(originRes.skipped_ads).length} แอด: {[...new Set(Object.values(originRes.skipped_ads))].join(" · ")}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ผูกเพจกับ webhook (real-time) — ต้องกดครั้งเดียวหลังตั้ง webhook ใน Meta */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium text-slate-800">Webhook (ข้อความเรียลไทม์ + ที่มาจากแอด)</div>
            <p className="text-[11px] text-slate-500 mt-0.5">กด "ผูกเพจ" 1 ครั้งเพื่อให้ Meta ส่งข้อความ/referral มาที่แอปทันที (subscribed_apps) · ต้อง deploy meta-webhook + ตั้งค่าใน Meta ให้ verify ผ่านก่อน</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => runWebhook("status")} disabled={!!webhookBusy} className="border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5">
              {webhookBusy === "status" ? <Loader2 className="animate-spin" size={14} /> : null} เช็คสถานะ
            </button>
            <button onClick={() => runWebhook("subscribe")} disabled={!!webhookBusy} className="bg-emerald-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-emerald-800 disabled:opacity-60 flex items-center gap-1.5">
              {webhookBusy === "subscribe" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} ผูกเพจกับ webhook
            </button>
          </div>
        </div>
        {webhookRes && (
          <div className="text-xs bg-white rounded-lg border border-slate-200 p-2.5 space-y-1 max-h-52 overflow-y-auto">
            {webhookRes.ok === false ? <div className="text-rose-600">ผิดพลาด: {webhookRes.error}</div>
              : (webhookRes.results || []).map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="text-slate-700 truncate">{r.page}</span>
                  {r.error ? <span className="text-rose-500 shrink-0">{r.error}</span>
                    : r.success ? <span className="text-emerald-600 shrink-0">✓ ผูกแล้ว</span>
                    : r.subscribed ? (
                        // เช็คเจาะจงว่ามี message_reads (สถานะ "อ่านแล้ว") ไหม — ไม่ใช่แค่นับจำนวน
                        (r.fields || []).includes("message_reads")
                          ? <span className="text-emerald-600 shrink-0" title={(r.fields || []).join(", ")}>✓ ครบ (มี message_reads)</span>
                          : <span className="text-amber-600 shrink-0" title={(r.fields || []).join(", ")}>⚠ ขาด message_reads — กด "ผูกเพจ" อีกครั้ง</span>
                      )
                    : <span className="text-amber-600 shrink-0">✗ ยังไม่ผูก</span>}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* โมเดลแปลหน้า "ตอบแชท" */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-1.5">
        <div className="text-sm font-medium text-slate-800">โมเดลแปลหน้า "ตอบแชท"</div>
        <p className="text-[11px] text-slate-500">ใช้แปลข้อความลูกค้า→ไทย และคำตอบ→ภาษาลูกค้า · ตัวใหญ่แปลเป็นธรรมชาติกว่า · เว้นว่าง = ใช้โมเดลตรวจซ้ำ (AI ตัวใหญ่)</p>
        <input list="ai-model-list" value={cfg.ai_model_reply || ""} onChange={(e) => setCfg({ ...cfg, ai_model_reply: e.target.value })} placeholder="gpt-4.1 (แนะนำ) / gpt-5.4 (คุณภาพสูงสุด)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" />
        <datalist id="ai-model-list">
          <option value="gpt-4.1-mini">gpt-4.1-mini — ถูก/เร็ว</option>
          <option value="gpt-4.1">gpt-4.1 — แม่นกว่า</option>
          <option value="gpt-5.4">gpt-5.4 — ฉลาดสุด (แพง)</option>
        </datalist>
      </div>

      {/* ทดสอบดึงป้ายกำกับจาก Meta — เช็คก่อนว่าดึงได้จริงไหม (เช่น "ชำระเงินแล้ว") + นับจำนวนได้ไหม */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-medium text-slate-800">ป้ายกำกับจาก Meta (ทดสอบดึง)</div>
          <div className="flex items-center gap-2">
            {labelPages.length > 0 && (
              <select value={labelPageId} onChange={(e) => setLabelPageId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white max-w-[180px]">
                {labelPages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <button onClick={testLabels} disabled={labelTesting} className="bg-brand-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-1.5">
              {labelTesting ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} ทดสอบดึงป้าย
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">เช็คว่า Meta token ของคุณดึง "ป้ายกำกับ" (custom labels) ของเพจได้ไหม เช่น "ชำระเงินแล้ว" และนับจำนวนคนต่อป้ายได้หรือเปล่า — ถ้าได้ ผมจะทำการ์ดสรุปให้ต่อ</p>
        {labelTest && (
          <div className="text-xs bg-white rounded-lg border border-slate-200 p-3 space-y-3 max-h-72 overflow-y-auto">
            {labelTest.ok === false ? (
              <div className="text-rose-600">ดึงไม่สำเร็จ: {labelTest.error}</div>
            ) : (
              <>
                <div>
                  <div className="font-medium text-slate-700 mb-1">ป้ายในเพจ {labelTest.page} ({(labelTest.label_names || []).length} ชื่อ)</div>
                  {(labelTest.label_names || []).length === 0 ? (
                    <div className="text-slate-400">— ไม่พบป้าย</div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {labelTest.label_names.map((l, i) => (
                        <span key={i} className={`px-1.5 py-0.5 rounded ${l.is_ad ? "bg-purple-50 text-purple-600" : "bg-slate-100 text-slate-700"}`} title={l.is_ad ? "ป้ายบอกที่มาจากแอด" : ""}>{l.name}{l.objects > 1 ? ` ×${l.objects}` : ""}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="font-medium text-slate-700 mb-1">ทดสอบดึงป้ายรายลูกค้า (นับได้ไหม): {labelTest.reverse_ok ? <span className="text-emerald-600">✓ ได้</span> : <span className="text-rose-600">✗ ไม่ได้</span>}</div>
                  <ul className="space-y-0.5">
                    {(labelTest.sample || []).map((s, i) => (
                      <li key={i} className="text-slate-600">
                        <span className="text-slate-800">{s.name}</span>: {s.error ? <span className="text-rose-500">{s.error}</span> : (s.labels?.length ? s.labels.join(", ") : <span className="text-slate-400">ไม่มีป้าย</span>)}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-slate-600">จำนวนแชทต่อเพจ (รอบซิงก์ปกติ)</label>
          <NumInput min={20} value={cfg.per_page ?? 200} onChange={(n) => setCfg({ ...cfg, per_page: n })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-sm text-slate-600">จำนวนข้อความที่อ่านต่อแชท</label>
          <NumInput min={5} max={100} value={cfg.messages ?? 30} onChange={(n) => setCfg({ ...cfg, messages: n })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-xs text-emerald-800">
        ระบบจะเก็บเฉพาะข้อมูลที่แอดมินป้อนเองหรือ Import จาก Excel เท่านั้น ไม่มีการอ่านแชทเพื่อกรอกข้อมูลลูกค้าอัตโนมัติ
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-brand-600 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={15} /> : null} บันทึก
        </button>
        {saved && <span className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">บันทึกแล้ว</span>}
      </div>
    </div>
  );
}

// เลือกเพจที่ให้ระบบซิงก์ — เก็บเฉพาะสวิตช์ที่ยังจำเป็น
export function PageLeadConfigPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);

  async function load() {
    const { data, error: e } = await supabase.from("page_lead_config").select("*").order("page_name");
    if (e) { setError(e.message); return; }
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  async function toggleSync(row) {
    const next = row.sync_enabled === false;
    setRows((prev) => prev.map((r) => (r.page_id === row.page_id ? { ...r, sync_enabled: next } : r)));
    setSavingId(row.page_id);
    await supabase.from("page_lead_config").update({ sync_enabled: next, updated_at: new Date().toISOString() }).eq("page_id", row.page_id);
    setSavingId(null); setSavedId(row.page_id); setTimeout(() => setSavedId(null), 1500);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">เพจที่ซิงก์แชท</h3>
        <p className="text-xs text-slate-500 mt-0.5">เปิดเฉพาะเพจที่ต้องการให้ระบบดึงแชทเข้ามา ฟังก์ชันกำหนดข้อมูลเพื่อเปลี่ยนสถานะอัตโนมัติถูกนำออกแล้ว</p>
      </div>
      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
      {rows === null ? (
        <Spinner label="กำลังโหลด..." />
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-400 py-4 text-center">ยังไม่มีเพจในระบบ</div>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.page_id} className="flex items-center justify-between gap-3 px-3 py-2.5 flex-wrap">
              <div className="text-sm text-slate-800 min-w-0">
                {r.page_name || r.page_id}
                {savingId === r.page_id && <span className="ml-2 text-[11px] text-slate-400">กำลังบันทึก...</span>}
                {savedId === r.page_id && <span className="ml-2 text-[11px] text-emerald-600">บันทึกแล้ว</span>}
              </div>
              <div className="flex gap-3 flex-wrap items-center">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={r.sync_enabled !== false} onChange={() => toggleSync(r)} /> ซิงก์เพจนี้
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// จัดการงานอัตโนมัติ (cron) ผ่านแอป — เปิด/ปิด + ตั้งความถี่ + ดูรันล่าสุด
const CRON_FREQ = [
  { v: "*/15 * * * *", l: "ทุก 15 นาที" },
  { v: "*/30 * * * *", l: "ทุก 30 นาที" },
  { v: "0 * * * *", l: "ทุก 1 ชั่วโมง" },
  { v: "0 */2 * * *", l: "ทุก 2 ชั่วโมง" },
  { v: "0 */6 * * *", l: "ทุก 6 ชั่วโมง" },
  { v: "0 1 * * *", l: "วันละครั้ง (08:00 น.)" },
];
export function ScheduledJobsPanel() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [savingKey, setSavingKey] = useState(null);
  async function load() {
    setErr("");
    const { data, error } = await supabase.functions.invoke("manage-cron", { body: { action: "list" } });
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "โหลดไม่สำเร็จ"); return; }
    setRows((data.rows || []).filter((job) => job.key !== "tv_sync"));
  }
  useEffect(() => { load(); }, []);
  async function save(job, patch) {
    const next = { ...job, ...patch };
    setRows((prev) => prev.map((r) => (r.key === job.key ? next : r)));
    setSavingKey(job.key); setErr("");
    const { data, error } = await supabase.functions.invoke("manage-cron", { body: { action: "save", key: job.key, cron_expr: next.cron_expr, enabled: next.enabled } });
    setSavingKey(null);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "บันทึกไม่สำเร็จ"); return; }
    load();
  }
  const fmtT = (t) => { try { return t ? new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-"; } catch { return "-"; } };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">งานอัตโนมัติ (ตั้งเวลา)</h3>
        <p className="text-xs text-slate-500 mt-0.5">เปิด/ปิด และตั้งความถี่ให้ระบบทำงานเองเป็นรอบ · เวลาแสดงตามโซนไทย</p>
      </div>
      {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
      {rows === null ? <Spinner label="กำลังโหลด..." /> : rows.length === 0 ? (
        <div className="text-sm text-slate-400 py-3 text-center">ยังไม่มีงาน — รัน migration scheduled-jobs ก่อน</div>
      ) : (
        <div className="space-y-3">
          {rows.map((job) => {
            const known = CRON_FREQ.some((f) => f.v === job.cron_expr);
            return (
              <div key={job.key} className="border border-slate-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 text-sm">{job.label}
                      {job.active === false && <span className="ml-2 text-[10px] text-slate-400">(ปิดอยู่)</span>}
                      {savingKey === job.key && <span className="ml-2 text-[11px] text-slate-400">กำลังบันทึก...</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 max-w-xl">{job.description}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">รันล่าสุด: {fmtT(job.last_run)}{job.last_status ? ` · ${job.last_status}` : ""}</div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer shrink-0">
                    <input type="checkbox" checked={job.enabled !== false} onChange={(e) => save(job, { enabled: e.target.checked })} /> เปิดใช้งาน
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-slate-500">ความถี่:</span>
                  <select value={job.cron_expr} onChange={(e) => save(job, { cron_expr: e.target.value })} disabled={job.enabled === false} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white disabled:opacity-50">
                    {!known && <option value={job.cron_expr}>กำหนดเอง ({job.cron_expr})</option>}
                    {CRON_FREQ.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ปฏิทินเลือกวันหยุด — เห็นวันที่ตั้งไว้ (ไฮไลต์ม่วง) คลิกวันเพื่อเพิ่ม/ลบ ได้ทันที
export function HolidayCalendar({ holidays = [], onToggle }) {
  const set = new Set(holidays);
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  const pad = (n) => String(n).padStart(2, "0");
  const startWd = new Date(ym.y, ym.m, 1).getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const dstr = (d) => `${ym.y}-${pad(ym.m + 1)}-${pad(d)}`;
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const cells = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const prev = () => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  const next = () => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));
  const monthCount = holidays.filter((h) => String(h).startsWith(`${ym.y}-${pad(ym.m + 1)}`)).length;
  return (
    <div className="rounded-xl border border-slate-200 p-3 w-full max-w-[300px] bg-white">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={prev} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={16} /></button>
        <div className="text-sm font-semibold text-slate-700">{TH_MONTHS[ym.m]} {ym.y + 543}</div>
        <button type="button" onClick={next} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WD.map((w, i) => <div key={`w${i}`} className="text-[10px] text-slate-400 font-medium py-0.5">{w}</div>)}
        {cells.map((d, i) => d === null ? <div key={`e${i}`} /> : (() => {
          const ds = dstr(d);
          const on = set.has(ds);
          const isToday = ds === todayStr;
          return (
            <button
              type="button"
              key={ds}
              onClick={() => onToggle(ds)}
              title={on ? "คลิกเพื่อลบวันหยุดนี้" : "คลิกเพื่อตั้งเป็นวันหยุด"}
              className={`aspect-square rounded-lg text-xs flex items-center justify-center transition ${on ? "text-white font-semibold shadow-sm" : isToday ? "text-brand-600 font-semibold ring-1 ring-slate-300" : "text-slate-600 hover:bg-slate-100"}`}
              style={on ? { backgroundImage: "linear-gradient(135deg,#9D6BFF,#7C4DFF)" } : undefined}
            >
              {d}
            </button>
          );
        })())}
      </div>
      <div className="text-[10px] text-slate-400 mt-2 text-center">
        {monthCount > 0 ? `เดือนนี้ตั้งไว้ ${monthCount} วัน · ` : ""}คลิกวันที่เพื่อเพิ่ม/ลบ (บันทึกทันที)
      </div>
    </div>
  );
}

// สถิติการตอบแชท (admin) — ความเร็วเฉลี่ย/ตอบช้าเกินเกณฑ์ ต่อ user × เพจ + ช่วงเวลาที่ช้าบ่อย
export function ReplyStatsPanel({ onOpenChat }) {
  const fmtD = bangkokDate;
  const [cfg, setCfg] = useState(null);          // office_hours
  const [since, setSince] = useState(() => fmtD(new Date(Date.now() - 30 * 86400000)));
  const [until, setUntil] = useState(() => fmtD(new Date()));
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState("");
  const [showEvidence, setShowEvidence] = useState(false);
  const [evFilter, setEvFilter] = useState("slow");   // slow | all | unanswered
  const [pageOpts, setPageOpts] = useState([]);       // รายชื่อเพจทั้งหมด
  const [selPages, setSelPages] = useState([]);       // เพจที่ติ๊กไว้ ([] = ทุกเพจ)
  const [pageMenu, setPageMenu] = useState(false);
  const [newHoliday, setNewHoliday] = useState("");   // วันหยุดพิเศษที่กำลังจะเพิ่ม
  const [holidayMsg, setHolidayMsg] = useState("");   // สถานะบันทึกวันหยุด (ทันที)
  const [excludeInput, setExcludeInput] = useState("");
  const [excludeMsg, setExcludeMsg] = useState("");
  const [customerNameOptions, setCustomerNameOptions] = useState([]);
  const [evSort, setEvSort] = useState("msg_at");   // คอลัมน์ที่เรียงในลิสต์หลักฐาน
  const [evDir, setEvDir] = useState("desc");
  const [evLimit, setEvLimit] = useState(300);     // แสดงกี่แถว (กดดูเพิ่มได้)
  const [hourView, setHourView] = useState("chart");  // กราฟ | ตาราง ของช่วงเวลาที่ตอบช้า
  const [hourSort, setHourSort] = useState("slow");
  const [hourDir, setHourDir] = useState("desc");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("page_lead_config").select("page_id, page_name").order("page_name");
      setPageOpts((data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })));
      const { data: customers } = await supabase.from("chat_customers").select("customer_name").not("customer_name", "is", null).order("updated_at", { ascending: false }).limit(5000);
      const names = [...new Set((customers || []).map((row) => String(row.customer_name || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "th", { sensitivity: "base" }));
      setCustomerNameOptions(names);
    })();
  }, []);
  const pagesArg = selPages.length ? { pages: selPages } : {};   // ไม่ติ๊ก = ทุกเพจ
  const [viewMode, setViewMode] = useState("summary");   // summary = รวมทั้งช่วง | daily = แยกรายวัน
  const [sortKey, setSortKey] = useState("avg");         // avg | alerts | slow | unanswered | name
  const [sortDir, setSortDir] = useState("asc");         // avg + asc = ตอบไวสุดขึ้นก่อน

  // ---- วันที่แบบ "เวลาไทย" (ให้ตรงกับที่ backend ใช้ +07:00) ----
  const thDay = (offsetDays = 0) => {
    const d = new Date(Date.now() + 7 * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };
  const thMonth = (monthOffset, which) => {
    const d = new Date(Date.now() + 7 * 3600 * 1000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + monthOffset + (which === "end" ? 1 : 0));
    if (which === "end") d.setUTCDate(0);   // วันสุดท้ายของเดือนนั้น
    return d.toISOString().slice(0, 10);
  };
  // ช่วงเวลาสำเร็จรูป — กดแล้วโหลดทันที
  const PRESETS = [
    ["วันนี้", () => [thDay(0), thDay(0)]],
    ["เมื่อวาน", () => [thDay(-1), thDay(-1)]],
    ["3 วันล่าสุด", () => [thDay(-2), thDay(0)]],
    ["7 วันล่าสุด", () => [thDay(-6), thDay(0)]],
    ["14 วันล่าสุด", () => [thDay(-13), thDay(0)]],
    ["30 วันล่าสุด", () => [thDay(-29), thDay(0)]],
    ["เดือนนี้", () => [thMonth(0, "start"), thDay(0)]],
    ["เดือนที่แล้ว", () => [thMonth(-1, "start"), thMonth(-1, "end")]],
    ["3 เดือนล่าสุด", () => [thMonth(-2, "start"), thDay(0)]],
    ["6 เดือนล่าสุด", () => [thMonth(-5, "start"), thDay(0)]],
    ["ปีนี้", () => { const d = new Date(Date.now() + 7 * 3600 * 1000); return [`${d.getUTCFullYear()}-01-01`, thDay(0)]; }],
  ];
  const fmtDMY = (iso) => { const [y, m, d] = String(iso).split("-"); return `${Number(d)}/${Number(m)}/${y}`; };
  // เวลาไทยแบบ วว/ดด ชช:นน — ใช้ในตารางหลักฐานเพื่อให้ตรวจสอบตัวเลขได้
  const fmtClock = (iso) => { try { return new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return "-"; } };
  const rangeLabel = since === until ? fmtDMY(since) : `${fmtDMY(since)} - ${fmtDMY(until)}`;

  // รวมทุกวันเป็น "สรุปรายเพจ" ของทั้งช่วง (ใช้ sum/answered ที่ backend ส่งมา จึงได้ค่าเฉลี่ยถ่วงน้ำหนักที่ถูกต้อง)
  const perPage = useMemo(() => {
    const m = {};
    for (const d of res?.daily || []) {
      const k = d.page_id || "?";
      const a = (m[k] = m[k] || { page_id: d.page_id, page_name: d.page_name, alerts: 0, answered: 0, slow: 0, unanswered: 0, closed: 0, sum: 0, days: 0, read_slow: 0, unread: 0, read_sum: 0, read_count: 0 });
      a.alerts += d.alerts || 0; a.answered += d.answered || 0; a.slow += d.slow || 0;
      a.unanswered += d.unanswered || 0; a.closed += d.closed || 0; a.sum += d.sum || 0; a.days++;
      a.read_slow += d.read_slow || 0; a.unread += d.unread || 0;
      a.read_sum += d.read_sum || 0; a.read_count += d.read_count || 0;
    }
    return Object.values(m).map((a) => ({
      ...a,
      avg_min: a.answered ? a.sum / a.answered : null,
      avg_read_min: a.read_count ? a.read_sum / a.read_count : null,
    }));
  }, [res]);

  const sortRows = (rows) => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      if (sortKey === "name") return dir * String(x.page_name || "").localeCompare(String(y.page_name || ""));
      if (sortKey === "avg") {
        // เพจที่ยังไม่มีใครตอบเลย (avg = null) ให้ไปท้ายเสมอ ไม่ว่าจะเรียงทางไหน
        if (x.avg_min == null && y.avg_min == null) return 0;
        if (x.avg_min == null) return 1;
        if (y.avg_min == null) return -1;
        return dir * (x.avg_min - y.avg_min);
      }
      return dir * ((x[sortKey] || 0) - (y[sortKey] || 0));
    });
  };
  // ---- Export ----
  const totals = () => perPage.reduce((a, p) => ({
    alerts: a.alerts + p.alerts, answered: a.answered + p.answered,
    slow: a.slow + p.slow, unanswered: a.unanswered + p.unanswered, closed: a.closed + (p.closed || 0), sum: a.sum + p.sum,
    read_slow: a.read_slow + (p.read_slow || 0), unread: a.unread + (p.unread || 0),
    read_sum: a.read_sum + (p.read_sum || 0), read_count: a.read_count + (p.read_count || 0),
  }), { alerts: 0, answered: 0, slow: 0, unanswered: 0, closed: 0, sum: 0, read_slow: 0, unread: 0, read_sum: 0, read_count: 0 });

  function exportSummaryCsv() {
    const rows = viewMode === "summary" ? sortRows(perPage) : res.daily;
    const head = viewMode === "summary"
      ? ["ช่วงเวลา", "เพจ", "ลูกค้าทัก(ครั้ง)", "ตอบแล้ว", "เฉลี่ย(นาที)", `ช้าเกิน${res.slow_min}นาที`, "ยังไม่ตอบ"]
      : ["วันที่", "เพจ", "ลูกค้าทัก(ครั้ง)", "ตอบแล้ว", "เฉลี่ย(นาที)", `ช้าเกิน${res.slow_min}นาที`, "ยังไม่ตอบ"];
    const body = rows.map((d) => [viewMode === "summary" ? rangeLabel : d.day, d.page_name, d.alerts, d.answered, d.answered ? d.avg_min.toFixed(1) : "", d.slow, d.unanswered]);
    if (viewMode === "summary") { const t = totals(); body.push(["รวมทุกเพจ", `${perPage.length} เพจ`, t.alerts, t.answered, t.answered ? (t.sum / t.answered).toFixed(1) : "", t.slow, t.unanswered]); }
    const csv = "﻿" + [head, ...body].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = `สถิติการตอบแชท_${since}_${until}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // PDF ผ่านหน้าพิมพ์ของเบราว์เซอร์ (เลือก "บันทึกเป็น PDF") — แนวเดียวกับ export ที่มีอยู่ในแอป
  function exportPdf() {
    const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const rows = viewMode === "summary" ? sortRows(perPage) : res.daily;
    const t = totals();
    const pageScope = selPages.length === 0 ? "ทุกเพจ" : selPages.map((id) => pageOpts.find((p) => p.id === id)?.name || id).join(", ");
    const off = res.office || {};
    const dayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
    const body = rows.map((d) => `<tr>
      <td>${esc(viewMode === "summary" ? rangeLabel : d.day)}</td>
      <td>${esc(d.page_name)}</td>
      <td class="n b">${d.alerts}</td>
      <td class="n">${d.answered}</td>
      <td class="n b">${d.answered ? esc(fmtMin(d.avg_min)) : "-"}</td>
      <td class="n ${d.slow > 0 ? "bad" : "good"}">${d.slow}</td>
      <td class="n ${d.unanswered > 0 ? "warn" : ""}">${d.unanswered}</td></tr>`).join("");
    const totalRow = viewMode === "summary" ? `<tr class="total">
      <td>รวมทุกเพจ</td><td>${perPage.length} เพจ</td>
      <td class="n">${t.alerts}</td><td class="n">${t.answered}</td>
      <td class="n">${t.answered ? esc(fmtMin(t.sum / t.answered)) : "-"}</td>
      <td class="n bad">${t.slow}</td><td class="n warn">${t.unanswered}</td></tr>` : "";
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>สถิติการตอบแชท ${esc(rangeLabel)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box} body{font-family:'Sarabun',sans-serif;margin:28px;color:#0f172a;font-size:12px}
  h1{font-size:19px;margin:0 0 4px} .sub{color:#64748b;font-size:11px;margin-bottom:2px}
  .cards{display:flex;gap:8px;margin:14px 0}
  .card{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px}
  .card .k{color:#64748b;font-size:10px} .card .v{font-size:17px;font-weight:700;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left}
  th{background:#f8fafc;font-size:11px;color:#475569}
  td.n,th.n{text-align:center} .b{font-weight:700}
  .bad{color:#e11d48;font-weight:700} .good{color:#059669} .warn{color:#d97706;font-weight:700}
  tr.total td{background:#f1f5f9;font-weight:700;border-top:2px solid #cbd5e1}
  .foot{margin-top:14px;color:#94a3b8;font-size:10px;border-top:1px solid #e2e8f0;padding-top:8px}
  @media print{body{margin:12mm} .noprint{display:none}}
</style></head><body>${exportPageNavHtml("settings")}
<h1>สถิติการตอบแชท</h1>
<div class="sub">ช่วงเวลา: <b>${esc(rangeLabel)}</b> · เพจ: ${esc(pageScope)}</div>
<div class="sub">เวลาทำการที่ใช้คำนวณ: ${esc((off.days || []).map((d) => dayNames[d]).join(" "))} ${esc(off.open || "")}-${esc(off.close || "")} (พัก ${esc(off.break_start || "-")}-${esc(off.break_end || "-")}) · เกณฑ์ช้า ${res.slow_min} นาที</div>
<div class="cards">
  <div class="card"><div class="k">ลูกค้าทักทั้งหมด</div><div class="v">${t.alerts}</div></div>
  <div class="card"><div class="k">ตอบแล้ว</div><div class="v">${t.answered}</div></div>
  <div class="card"><div class="k">เฉลี่ย</div><div class="v">${t.answered ? esc(fmtMin(t.sum / t.answered)) : "-"}</div></div>
  <div class="card"><div class="k">ช้าเกินเกณฑ์</div><div class="v" style="color:#e11d48">${t.slow}</div></div>
  <div class="card"><div class="k">ยังไม่ตอบ</div><div class="v" style="color:#d97706">${t.unanswered}</div></div>
</div>
<table><thead><tr>
  <th>${viewMode === "summary" ? "ช่วงเวลา" : "วันที่"}</th><th>เพจ</th>
  <th class="n">ลูกค้าทัก</th><th class="n">ตอบแล้ว</th><th class="n">เฉลี่ย</th>
  <th class="n">ช้าเกิน ${res.slow_min} น.</th><th class="n">ยังไม่ตอบ</th>
</tr></thead><tbody>${body}${totalRow}</tbody></table>
<div class="foot">ไม่นับรอบที่ลูกค้าทักนอกเวลาทำการ (${res.skipped} รอบ) · เวลาที่ใช้ตอบนับเฉพาะนาทีในเวลาทำการ · ออกรายงาน ${new Date().toLocaleString("th-TH")}</div>
<script>window.onload=()=>{setTimeout(()=>window.print(),400)}<\/script>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — อนุญาต popup สำหรับหน้านี้แล้วลองใหม่"); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ลิสต์หลักฐานหลังกรอง + เรียงตามคอลัมน์ที่คลิก
  const evRows = useMemo(() => {
    const list = (res?.evidence || []).filter((e) => evFilter === "all" || (evFilter === "unanswered" ? !e.answered : e.slow));
    const dir = evDir === "asc" ? 1 : -1;
    const num = (v) => (v == null ? null : Number(v));
    return [...list].sort((x, y) => {
      if (evSort === "minutes" || evSort === "read_minutes") {
        const a = num(x[evSort]), b = num(y[evSort]);
        // ค่าว่าง (ยังไม่ตอบ/ยังไม่อ่าน) ให้ไปท้ายเสมอ ไม่ว่าจะเรียงทางไหน
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return dir * (a - b);
      }
      if (evSort === "msg_at" || evSort === "replied_at" || evSort === "day") {
        const a = x[evSort] ? new Date(x[evSort]).getTime() : null;
        const b = y[evSort] ? new Date(y[evSort]).getTime() : null;
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return dir * (a - b);
      }
      return dir * String(x[evSort] ?? "").localeCompare(String(y[evSort] ?? ""), "th");
    });
  }, [res, evFilter, evSort, evDir]);

  const SortTh = ({ k, children, center }) => (
    <th className={`px-3 py-2 font-medium ${center ? "text-center" : ""}`}>
      <button
        onClick={() => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir(k === "avg" || k === "name" ? "asc" : "desc"); } }}
        className={`inline-flex items-center gap-0.5 hover:text-slate-800 ${sortKey === k ? "text-slate-800 font-semibold" : ""}`}
      >
        {children}
        {sortKey === k && <span className="text-[9px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      setCfg({ holidays: [], ...(data?.value || { days: [1, 2, 3, 4, 5], open: "09:00", close: "17:00", break_start: "12:00", break_end: "13:00", slow_min: 5 }) });
    })();
  }, []);
  async function saveCfg() {
    setSaving(true);
    await supabase.from("settings").upsert({ key: "office_hours", value: cfg, updated_at: new Date().toISOString() });
    setSaving(false);
    load();
  }
  // เพิ่ม/ลบวันหยุด แล้วเซฟลง DB ทันที (ถาวร) — แยกจากปุ่ม "บันทึก" ใหญ่ และไม่ดึงสถิติใหม่
  // ผสานกับค่าในฐานข้อมูลปัจจุบัน เพื่อไม่ทับฟิลด์เวลาทำการอื่นที่อาจแก้ค้างไว้
  async function persistHolidays(nextHolidays) {
    setCfg((c) => ({ ...c, holidays: nextHolidays }));
    setHolidayMsg("กำลังบันทึก...");
    try {
      const { data } = await supabase.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const base = data?.value || {};
      const { error } = await supabase.from("settings").upsert({ key: "office_hours", value: { ...base, holidays: nextHolidays }, updated_at: new Date().toISOString() });
      if (error) { setHolidayMsg("บันทึกไม่สำเร็จ: " + error.message); return; }
      setHolidayMsg(`✓ บันทึกลงฐานข้อมูลแล้ว (${nextHolidays.length} วัน)`);
    } catch (e) {
      setHolidayMsg("บันทึกไม่สำเร็จ: " + (e?.message || e));
    }
    setTimeout(() => setHolidayMsg(""), 4000);
  }
  async function persistExcludedNames(nextNames) {
    setCfg((current) => ({ ...current, exclude: nextNames }));
    setExcludeMsg("กำลังบันทึก...");
    try {
      const { data } = await supabase.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const base = data?.value || {};
      const { error } = await supabase.from("settings").upsert({ key: "office_hours", value: { ...base, exclude: nextNames }, updated_at: new Date().toISOString() });
      if (error) { setExcludeMsg("บันทึกไม่สำเร็จ: " + error.message); return false; }
      setExcludeMsg(`✓ บันทึกแล้ว (${nextNames.length} รายชื่อ)`);
      setTimeout(() => setExcludeMsg(""), 4000);
      load();
      return true;
    } catch (e) {
      setExcludeMsg("บันทึกไม่สำเร็จ: " + (e?.message || e));
      return false;
    }
  }
  async function addExcludedName() {
    const typed = excludeInput.trim().replace(/\s+/g, " ");
    if (!typed) return;
    const matchedName = customerNameOptions.find((name) => name.toLocaleLowerCase("th") === typed.toLocaleLowerCase("th"));
    if (!matchedName) {
      setExcludeMsg("ไม่พบชื่อนี้ในรายชื่อลูกค้า กรุณาเลือกชื่อจากรายการแนะนำเพื่อป้องกันการสะกดผิด");
      return;
    }
    const current = cfg.exclude || [];
    if (current.some((name) => String(name).toLocaleLowerCase("th") === matchedName.toLocaleLowerCase("th"))) {
      setExcludeMsg("รายชื่อนี้ถูกเพิ่มไว้แล้ว");
      return;
    }
    const saved = await persistExcludedNames([...current, matchedName]);
    if (saved) setExcludeInput("");
  }
  // สลับโหมดการนับ (24 ชม. ทุกวัน ↔ กรองวันหยุด/เวลาทำการ) — บันทึกทันทีแบบผสานกับค่าเดิม แล้วดึงสถิติใหม่
  async function persistMode(m) {
    setCfg((c) => ({ ...c, mode: m }));
    try {
      const { data } = await supabase.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const base = data?.value || {};
      await supabase.from("settings").upsert({ key: "office_hours", value: { ...base, mode: m }, updated_at: new Date().toISOString() });
      load();
    } catch { /* เงียบไว้ — สถิติจะรีเฟรชรอบถัดไป */ }
  }
  async function load(sinceArg, untilArg) {
    const s = sinceArg || since, u = untilArg || until;   // รับค่ามาตรงๆ ได้ (กดปุ่มช่วงเวลาแล้วโหลดทันที ไม่ต้องรอ state)
    setBusy(true); setErr("");
    const { data, error } = await supabase.functions.invoke("reply-stats", { body: { since: s, until: u, ...pagesArg } });
    setBusy(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "โหลดไม่สำเร็จ"); return; }
    setRes(data);
  }
  // ดึงสถิติจากบทสนทนาจริง — ครอบคลุมทั้งที่ตอบผ่านแอปและที่พนักงานตอบจากกล่องข้อความเพจโดยตรง
  async function rebuild() {
    setRebuilding(true); setErr(""); setRebuildMsg("กำลังอ่านบทสนทนาย้อนหลัง...");
    const days = Math.max(1, Math.ceil((new Date(until) - new Date(since)) / 86400000) + 1);
    const { data, error } = await supabase.functions.invoke("rebuild-reply-stats", { body: { since_days: Math.min(365, days), ...pagesArg } });
    setRebuilding(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); setRebuildMsg(""); return; }
    if (!data?.ok) {
      // กัน error ที่เป็นออบเจ็กต์ (หรือสตริง "[object Object]") ไม่ให้แสดงจนอ่านไม่รู้เรื่อง
      const raw = data?.error;
      const msg = typeof raw === "string" && raw !== "[object Object]" ? raw
        : raw && typeof raw === "object" ? (raw.message || raw.details || raw.hint || JSON.stringify(raw))
        : "ดึงไม่สำเร็จ (ไม่ได้รับรายละเอียด) — เช็คว่า deploy rebuild-reply-stats เวอร์ชันใหม่แล้วหรือยัง";
      setErr(msg); setRebuildMsg(""); return;
    }
    setRebuildMsg(`สแกน ${data.scanned} แชท เก็บ ${data.rounds} รอบเข้าฐานข้อมูล${data.done ? "" : " (ยังไม่ครบ กดซ้ำเพื่อทำต่อ)"} — ตารางด้านบนจะแสดงเฉพาะช่วงวันที่ที่เลือก`);
    load();
  }
  useEffect(() => { if (cfg) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cfg === null]);
  const DAYS = [["1", "จ"], ["2", "อ"], ["3", "พ"], ["4", "พฤ"], ["5", "ศ"], ["6", "ส"], ["0", "อา"]];
  const fmtMin = (m) => (m < 1 ? `${Math.round(m * 60)} วิ` : m < 60 ? `${m.toFixed(1)} นาที` : `${(m / 60).toFixed(1)} ชม.`);
  const maxSlow = res ? Math.max(1, ...res.slow_hours) : 1;
  const maxAll = res ? Math.max(1, ...res.all_hours) : 1;   // สเกลแท่งตาม "จำนวนที่ลูกค้าทัก" ทั้งหมด
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">สถิติการตอบแชท</h3>
        <p className="text-xs text-slate-500 mt-0.5">ความเร็วการตอบต่อ user แยกรายเพจ — {cfg?.mode === "24_7" ? "นับทุกแชท 24 ชม. ทุกวัน (เวลาตอบคิดจากเวลาจริง)" : "นับเฉพาะแชทที่ลูกค้าทักใน \"เวลาทำการ\" และหักเวลาพัก/นอกเวลาออกจากการคำนวณ"}</p>
      </div>
      {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}

      {cfg && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="text-xs font-medium text-slate-600">เวลาทำการ (ใช้คำนวณ)</div>

          {/* โหมดการนับ: นับทุกวัน 24 ชม. หรือ กรองวันหยุด/เวลาทำการ */}
          <div>
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
              <button type="button" onClick={() => persistMode("24_7")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${cfg.mode === "24_7" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                นับทุกวัน 24 ชม.
              </button>
              <button type="button" onClick={() => persistMode("office")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${cfg.mode !== "24_7" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                กรองวันหยุด / เวลาทำการ
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {cfg.mode === "24_7"
                ? "กำลังนับทุกแชท 24 ชม. ทุกวัน (ไม่กรองวันหยุด/เวลาทำการ) — เวลาตอบคิดจากเวลาจริง"
                : "นับเฉพาะแชทในวัน-เวลาทำการที่ตั้งด้านล่าง และหักเวลาพัก/นอกเวลา/วันหยุดออก"}
            </p>
          </div>

          {/* วันทำงาน — ปุ่มใหญ่พอให้กดบนมือถือ (ปิดใช้งานเมื่อเลือกโหมด 24 ชม.) */}
          <div className={cfg.mode === "24_7" ? "opacity-40 pointer-events-none" : ""}>
            <div className="text-[11px] text-slate-400 mb-1">วันทำงาน</div>
            <div className="grid grid-cols-7 gap-1">
              {DAYS.map(([d, l]) => (
                <label key={d} className={`py-2 rounded-lg border cursor-pointer text-xs text-center select-none ${cfg.days?.includes(Number(d)) ? "bg-brand-100 border-brand-300 text-brand-700 font-semibold" : "border-slate-200 text-slate-500"}`}>
                  <input type="checkbox" className="hidden" checked={cfg.days?.includes(Number(d)) || false}
                    onChange={(e) => setCfg({ ...cfg, days: e.target.checked ? [...(cfg.days || []), Number(d)] : (cfg.days || []).filter((x) => x !== Number(d)) })} />{l}
                </label>
              ))}
            </div>
          </div>

          {/* เวลา — จัดเป็นคู่ มีป้ายกำกับชัด ไม่ตัดบรรทัดมั่วบนมือถือ (ปิดใช้งานเมื่อเลือกโหมด 24 ชม.) */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs ${cfg.mode === "24_7" ? "opacity-40 pointer-events-none" : ""}`}>
            <div>
              <div className="text-[11px] text-slate-400 mb-1">เปิด</div>
              <input type="time" value={cfg.open || "09:00"} onChange={(e) => setCfg({ ...cfg, open: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
            <div>
              <div className="text-[11px] text-slate-400 mb-1">ปิด</div>
              <input type="time" value={cfg.close || "17:00"} onChange={(e) => setCfg({ ...cfg, close: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
            <div>
              <div className="text-[11px] text-slate-400 mb-1">พักตั้งแต่</div>
              <input type="time" value={cfg.break_start || "12:00"} onChange={(e) => setCfg({ ...cfg, break_start: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
            <div>
              <div className="text-[11px] text-slate-400 mb-1">ถึง</div>
              <input type="time" value={cfg.break_end || "13:00"} onChange={(e) => setCfg({ ...cfg, break_end: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
          </div>

          <div className="flex items-end gap-2 text-xs">
            <div className="flex-1 sm:flex-none">
              <div className="text-[11px] text-slate-400 mb-1">ถือว่าช้าเมื่อเกิน (นาที)</div>
              <NumInput min={1} value={cfg.slow_min ?? 5} onChange={(n) => setCfg({ ...cfg, slow_min: n })} className="w-full sm:w-24 rounded-lg border border-slate-300 px-2 py-1.5" />
            </div>
            <button onClick={saveCfg} disabled={saving} className="bg-brand-600 text-white rounded-lg px-4 py-1.5 font-medium disabled:opacity-60 shrink-0">{saving ? "..." : "บันทึก"}</button>
          </div>

          {/* วันหยุดพิเศษ — วันที่ในนี้จะถูกตัดออกจากการคำนวณทั้งหมด (เหมือนวันหยุดประจำสัปดาห์) · ไม่ใช้ในโหมด 24 ชม. */}
          <div className={`border-t border-slate-200 pt-2 mt-1 ${cfg.mode === "24_7" ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex items-center gap-2 flex-wrap text-xs mb-1.5">
              <span className="font-medium text-slate-600">วันหยุดพิเศษ ({(cfg.holidays || []).length} วัน)</span>
              <span className="text-slate-400">— เช่น สงกรานต์ ปีใหม่ วันหยุดชดเชย · ตัดออกจากการคำนวณเวลาตอบ</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <input
                type="date"
                value={newHoliday}
                onChange={(e) => setNewHoliday(e.target.value)}
                className="rounded-lg border border-slate-300 px-1.5 py-1"
              />
              <button
                onClick={() => {
                  if (!newHoliday) return;
                  const cur = cfg.holidays || [];
                  if (cur.includes(newHoliday)) { setNewHoliday(""); return; }
                  persistHolidays([...cur, newHoliday].sort());
                  setNewHoliday("");
                }}
                disabled={!newHoliday}
                className="rounded-lg bg-brand-600 text-white px-2.5 py-1 font-medium hover:bg-brand-700 disabled:opacity-40"
              >
                + เพิ่มวันหยุด
              </button>
              {(cfg.holidays || []).length > 0 && (
                <button onClick={() => persistHolidays([])} className="text-slate-400 hover:text-rose-600">ล้างทั้งหมด</button>
              )}
              {holidayMsg
                ? <span className={`text-[10px] ${holidayMsg.startsWith("✓") ? "text-emerald-600" : holidayMsg.startsWith("กำลัง") ? "text-slate-400" : "text-rose-600"}`}>{holidayMsg}</span>
                : <span className="text-[10px] text-slate-400">กดเพิ่ม/ลบ = บันทึกลงฐานข้อมูลทันที (ถาวร)</span>}
            </div>
            {/* ปฏิทิน — เห็นวันหยุดที่ตั้งไว้ (ไฮไลต์ม่วง) คลิกวันเพื่อเพิ่ม/ลบ */}
            <div className="mt-2">
              <HolidayCalendar
                holidays={cfg.holidays || []}
                onToggle={(ds) => {
                  const cur = cfg.holidays || [];
                  persistHolidays(cur.includes(ds) ? cur.filter((x) => x !== ds) : [...cur, ds].sort());
                }}
              />
            </div>
            {(cfg.holidays || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {(cfg.holidays || []).map((h) => (
                  <span key={h} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 rounded-full px-2 py-0.5 text-[11px]">
                    {fmtDMY(h)}
                    <button onClick={() => persistHolidays((cfg.holidays || []).filter((x) => x !== h))} className="text-slate-400 hover:text-rose-600" title="ลบวันหยุดนี้ (บันทึกทันที)">✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ตัดลูกค้าที่ไม่ต้องการนับสถิติ (เช่น เฟสส่วนตัวที่ใช้เทสระบบ) */}
          <div className="border-t border-slate-200 pt-2 mt-1">
            <div className="text-xs font-medium text-slate-600 mb-1">ไม่นับสถิติของลูกค้าเหล่านี้ (เช่น บัญชีเทส)</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                list="reply-stats-customer-names"
                value={excludeInput}
                onChange={(e) => { setExcludeInput(e.target.value); setExcludeMsg(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExcludedName(); } }}
                placeholder="พิมพ์แล้วเลือกชื่อลูกค้าจากรายการ เช่น Aphiwat Ch"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <datalist id="reply-stats-customer-names">{customerNameOptions.map((name) => <option key={name} value={name} />)}</datalist>
              <button type="button" onClick={addExcludedName} disabled={!excludeInput.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40">เพิ่มและบันทึก</button>
            </div>
            {(cfg.exclude || []).length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
              {(cfg.exclude || []).map((name) => <span key={name} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                {name}
                <button type="button" onClick={() => persistExcludedNames((cfg.exclude || []).filter((item) => item !== name))} className="text-slate-400 hover:text-rose-600" title="ลบและบันทึก">✕</button>
              </span>)}
            </div>}
            {excludeMsg && <p className={`mt-1 text-[10px] ${excludeMsg.startsWith("✓") ? "text-emerald-600" : excludeMsg.startsWith("กำลัง") ? "text-slate-400" : "text-rose-600"}`}>{excludeMsg}</p>}
            <p className="text-[10px] text-slate-400 mt-1">เลือกจากชื่อลูกค้าที่ระบบเคยดึงมา เพื่อลดการสะกดผิด · รองรับชื่อที่มีเว้นวรรค · เพิ่มหรือลบแล้วบันทึกทันที</p>
          </div>

          {/* คำที่ถือว่า "ลูกค้าปิดบทสนทนาเอง" — ไม่นับเป็นค้างตอบ */}
          <div className="border-t border-slate-200 pt-2 mt-1">
            <div className="text-xs mb-1.5">
              <span className="font-medium text-slate-600">คำที่ถือว่าลูกค้าปิดบทสนทนาเอง</span>
              <span className="text-slate-400"> — ถ้าข้อความสุดท้ายเป็นคำพวกนี้ (หรือกดไลก์/สติกเกอร์/อีโมจิล้วน) จะไม่นับว่าค้างตอบ</span>
            </div>
            <textarea
              value={(cfg.closing_words || []).join(", ")}
              onChange={(e) => setCfg({ ...cfg, closing_words: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
              rows={2}
              placeholder="ขอบคุณ, โอเค, รับทราบ, thanks, ok, salamat, terima kasih"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              คั่นด้วยเครื่องหมายจุลภาค · ระบบตัดคำลงท้ายสุภาพ (ครับ/ค่ะ/po/ya) ให้อัตโนมัติ
              และจะ<b>ไม่</b>ถือว่าปิดถ้าข้อความมีเครื่องหมายคำถามหรือยาวเกิน 40 ตัวอักษร
              {(cfg.closing_words || []).length === 0 && " · เว้นว่าง = ใช้ชุดคำเริ่มต้น (ไทย/อังกฤษ/ตากาล็อก/อินโดฯ)"}
            </p>
          </div>
        </div>
      )}

      {/* ช่วงเวลาสำเร็จรูป — กดแล้วโหลดทันที */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(([label, fn]) => {
          const [s, u] = fn();
          const active = s === since && u === until;
          return (
            <button
              key={label}
              onClick={() => { setSince(s); setUntil(u); load(s, u); }}
              className={`text-[11px] rounded-full px-2.5 py-1 font-medium border transition ${active ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs relative">
        <span className="text-slate-400">ช่วงวันที่</span>
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="rounded-lg border border-slate-300 px-1.5 py-1" />
        <span className="text-slate-400">ถึง</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-lg border border-slate-300 px-1.5 py-1" />

        {/* เลือกเพจ — ติ๊กได้หลายเพจ ไม่ติ๊ก = ทุกเพจ */}
        <button onClick={() => setPageMenu((o) => !o)} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 flex items-center gap-1">
          เพจ: {selPages.length === 0 ? "ทุกเพจ" : selPages.length === 1
            ? (pageOpts.find((p) => p.id === selPages[0])?.name || "1 เพจ")
            : `${selPages.length} เพจ`}
          <ChevronDown size={12} className={`transition-transform ${pageMenu ? "rotate-180" : ""}`} />
        </button>
        {pageMenu && (
          <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-2 w-72">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[10px] text-slate-400">ไม่ติ๊กเลย = ทุกเพจ</span>
              <div className="flex gap-2 text-[11px]">
                <button onClick={() => setSelPages(pageOpts.map((p) => p.id))} className="text-brand-600 hover:underline">เลือกทั้งหมด</button>
                <button onClick={() => setSelPages([])} className="text-slate-500 hover:underline">ล้าง</button>
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {pageOpts.length === 0 && <div className="text-[11px] text-slate-400 px-1 py-1">ยังไม่มีรายชื่อเพจ</div>}
              {pageOpts.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={selPages.includes(p.id)}
                    onChange={(e) => setSelPages(e.target.checked ? [...selPages, p.id] : selPages.filter((x) => x !== p.id))}
                    className="w-3.5 h-3.5"
                  />
                  <span className="truncate">{p.name}</span>
                </label>
              ))}
            </div>
            <button onClick={() => { setPageMenu(false); load(); }} className="w-full mt-2 bg-brand-600 text-white rounded-lg px-2 py-1.5 text-[11px] font-medium hover:bg-brand-700">
              ใช้ตัวกรองนี้
            </button>
          </div>
        )}
        <button onClick={load} disabled={busy} className="border border-slate-300 text-slate-700 rounded-lg px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1">
          {busy ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} ดูสถิติ
        </button>
        <button onClick={rebuild} disabled={rebuilding || busy} className="bg-brand-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-1">
          {rebuilding ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} ดึงจากแชทจริง
        </button>
        {res && <span className="text-slate-400">ตอบแล้ว {res.counted} · ยังไม่ตอบ {res.unanswered ?? 0} · ข้ามนอกเวลาทำการ {res.skipped}</span>}
      </div>
      {rebuildMsg && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{rebuildMsg}</div>}

      {/* ---- KPI สรุปรวม (การ์ดใหญ่แบบ enterprise) ---- */}
      {res && perPage.length > 0 && (() => {
        const t = totals();
        const avg = t.answered ? t.sum / t.answered : 0;
        const rate = t.alerts ? Math.round((t.answered / t.alerts) * 100) : 0;
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <DsStatCard icon={MessageSquare} label="ลูกค้าทักทั้งหมด" value={t.alerts.toLocaleString()} tone="purple" sub={`${perPage.length} เพจ · ${rangeLabel}`} />
            <DsStatCard icon={CheckCircle2} label="ตอบแล้ว" value={t.answered.toLocaleString()} tone="green" sub={`คิดเป็น ${rate}%`} />
            <DsStatCard icon={Clock} label="เวลาตอบเฉลี่ย" value={fmtMin(avg)} tone="blue" sub={`ช้าเกินเกณฑ์ ${t.slow} รอบ`} />
            <DsStatCard icon={AlertTriangle} label="ค้างตอบ" value={t.unanswered.toLocaleString()} tone={t.unanswered > 0 ? "red" : "green"} sub={`ลูกค้าปิดเอง ${t.closed}`} />
          </div>
        );
      })()}

      {/* ---- สรุปรายวัน × เพจ: จำนวนครั้งที่ต้องตอบ / ตอบแล้ว / ช้า / ยังไม่ตอบ ---- */}
      {res?.daily?.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-slate-600">
              {viewMode === "summary" ? `สรุปรายเพจ · ${rangeLabel}` : "แยกรายวัน · ตามเพจ"}
            </span>
            <div className="flex gap-1 ml-auto text-[11px]">
              {[["summary", "รวมทั้งช่วง"], ["daily", "แยกรายวัน"]].map(([k, l]) => (
                <button key={k} onClick={() => setViewMode(k)} className={`rounded-full px-2.5 py-1 font-medium ${viewMode === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
              ))}
              <button onClick={exportPdf} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50 flex items-center gap-1">📄 PDF</button>
              <button onClick={exportSummaryCsv} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">⤓ CSV</button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2 font-medium">{viewMode === "summary" ? "ช่วงเวลา" : "วันที่"}</th>
              <SortTh k="name">เพจ</SortTh>
              <SortTh k="alerts" center>ลูกค้าทัก (ครั้ง)</SortTh>
              <th className="px-3 py-2 font-medium text-center">ตอบแล้ว</th>
              <SortTh k="avg" center>เฉลี่ย</SortTh>
              <SortTh k="slow" center>ตอบช้าเกิน {res.slow_min} น.</SortTh>
              <SortTh k="unanswered" center>ยังไม่ตอบ</SortTh>
              <SortTh k="closed" center>ลูกค้าปิดเอง</SortTh>
              <SortTh k="read_slow" center>อ่านช้าเกิน {res.slow_min} น.</SortTh>
              <SortTh k="unread" center>ยังไม่อ่าน</SortTh>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(viewMode === "summary" ? sortRows(perPage) : res.daily).map((d, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{viewMode === "summary" ? rangeLabel : d.day}</td>
                  <td className="px-3 py-2 text-slate-700 truncate max-w-[220px]" title={d.page_name}>{d.page_name}</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-800">{d.alerts}</td>
                  <td className="px-3 py-2 text-center text-slate-600">{d.answered}</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-800">{d.answered ? fmtMin(d.avg_min) : "-"}</td>
                  <td className={`px-3 py-2 text-center font-semibold ${d.slow > 0 ? "text-rose-600" : "text-emerald-600"}`}>{d.slow}</td>
                  <td className={`px-3 py-2 text-center font-semibold ${d.unanswered > 0 ? "text-amber-600" : "text-slate-400"}`}>{d.unanswered}</td>
                  <td className="px-3 py-2 text-center text-slate-500" title="ลูกค้าพิมพ์ขอบคุณ/กดไลก์ปิดท้าย — ไม่ต้องตอบ ไม่นับเป็นค้าง">{d.closed ?? 0}</td>
                  <td className={`px-3 py-2 text-center ${d.read_slow > 0 ? "text-rose-500 font-semibold" : "text-slate-400"}`} title={d.avg_read_min != null ? `เฉลี่ยกว่าจะอ่าน ${fmtMin(d.avg_read_min)}` : ""}>{d.read_slow ?? 0}</td>
                  <td className={`px-3 py-2 text-center ${d.unread > 0 ? "text-amber-600 font-semibold" : "text-slate-400"}`}>{d.unread ?? 0}</td>
                </tr>
              ))}
              {/* แถวรวมทุกเพจ — ตอบคำถาม "ทั้งช่วงนี้มีกี่แชท" */}
              {viewMode === "summary" && perPage.length > 0 && (() => {
                const t = perPage.reduce((a, p) => ({
                  alerts: a.alerts + p.alerts, answered: a.answered + p.answered,
                  slow: a.slow + p.slow, unanswered: a.unanswered + p.unanswered, sum: a.sum + p.sum,
                }), { alerts: 0, answered: 0, slow: 0, unanswered: 0, sum: 0 });
                return (
                  <tr className="bg-slate-100 font-semibold">
                    <td className="px-3 py-2 text-slate-700">รวมทุกเพจ</td>
                    <td className="px-3 py-2 text-slate-500">{perPage.length} เพจ</td>
                    <td className="px-3 py-2 text-center text-slate-900">{t.alerts}</td>
                    <td className="px-3 py-2 text-center text-slate-700">{t.answered}</td>
                    <td className="px-3 py-2 text-center text-slate-900">{t.answered ? fmtMin(t.sum / t.answered) : "-"}</td>
                    <td className="px-3 py-2 text-center text-rose-600">{t.slow}</td>
                    <td className="px-3 py-2 text-center text-amber-600">{t.unanswered}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{t.closed}</td>
                    <td className="px-3 py-2 text-center text-rose-500">{t.read_slow}</td>
                    <td className="px-3 py-2 text-center text-amber-600">{t.unread}</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- ลิสต์หลักฐานรายแชท ---- */}
      {res?.evidence?.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <button onClick={() => setShowEvidence((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700">
            <span>รายการหลักฐาน — ดูรายแชทว่าใครตอบ/ช้ากี่นาที ({res.evidence_total} รายการ)</span>
            <ChevronDown size={14} className={`transition-transform ${showEvidence ? "rotate-180" : ""}`} />
          </button>
          {showEvidence && (<>
            <div className="flex gap-1 px-3 py-2 border-b border-slate-200 text-[11px]">
              {[["slow", `ช้าเกินเกณฑ์ + ยังไม่ตอบ`], ["unanswered", "เฉพาะยังไม่ตอบ"], ["all", "ทั้งหมด"]].map(([k, l]) => (
                <button key={k} onClick={() => { setEvFilter(k); setEvLimit(300); }} className={`rounded-full px-2.5 py-1 font-medium ${evFilter === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
              ))}
              <button
                onClick={() => {
                  const list = evRows;
                  const head = ["วันที่", "เพจ", "ลูกค้า", "ลูกค้าทักเมื่อ", "ตอบเมื่อ", "ใช้เวลา(นาที)", "ผู้ตอบ", "ช่องทาง", "conversation_id"];
                  const rows = list.map((e) => [e.day, e.page_name, e.customer_name || "", e.msg_at, e.replied_at || "ยังไม่ตอบ", e.minutes == null ? "" : e.minutes.toFixed(1), e.by || "", e.source, e.conversation_id]);
                  const csv = "﻿" + [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
                  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
                  const a = document.createElement("a"); a.href = url; a.download = `หลักฐานการตอบแชท_${since}_${until}.csv`; a.click(); URL.revokeObjectURL(url);
                }}
                className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
              >
                ⤓ Export CSV
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-50 z-10"><tr className="text-left text-slate-600 border-b border-slate-200">
                  {[["day", "วันที่", ""], ["page_name", "เพจ", ""], ["customer_name", "ลูกค้า", ""],
                    ["msg_at", "ลูกค้าทัก", "text-center"], ["replied_at", "ตอบเมื่อ", "text-center"],
                    ["minutes", "ใช้เวลา", "text-center"], ["read_minutes", "อ่านเมื่อ", "text-center"],
                    ["by", "ผู้ตอบ", ""]].map(([k, label, cls]) => (
                    <th key={k} className={`px-3 py-1.5 font-medium ${cls}`}>
                      <button
                        onClick={() => { if (evSort === k) setEvDir((d) => (d === "asc" ? "desc" : "asc")); else { setEvSort(k); setEvDir(k === "minutes" || k === "read_minutes" ? "desc" : "asc"); } }}
                        className={`inline-flex items-center gap-0.5 hover:text-slate-800 ${evSort === k ? "text-slate-800 font-semibold" : ""}`}
                      >
                        {label}{evSort === k && <span className="text-[8px]">{evDir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {evRows.slice(0, evLimit).map((e, i) => (
                    // ใช้ bg-*-50 ตัวเต็ม (ไม่ใส่ /40) เพราะธีมมืดมี override ให้เฉพาะตัวเต็ม
                    // ถ้าใส่ opacity จะได้สีอ่อนของโหมดสว่างมาทับพื้นเข้ม ทำให้ตัวหนังสือจมอ่านไม่ออก
                    // + ใช้แถบสีซ้ายเป็นตัวบอกสถานะแทนการพึ่งพื้นหลังอย่างเดียว
                    <tr key={i} className={`${!e.answered && !e.is_closing ? "bg-amber-50" : e.slow ? "bg-rose-50" : ""} hover:bg-slate-100 transition-colors`}>
                      <td className={`px-3 py-1.5 text-slate-600 whitespace-nowrap border-l-2 ${!e.answered && !e.is_closing ? "border-amber-500" : e.slow ? "border-rose-500" : "border-transparent"}`}>{e.day}</td>
                      <td className="px-3 py-1.5 text-slate-600 truncate max-w-[140px]" title={e.page_name}>{e.page_name}</td>
                      <td className="px-3 py-1.5 max-w-[180px]">
                        {onOpenChat ? (
                          <button
                            onClick={() => onOpenChat(e.conversation_id, e.msg_at)}
                            className="text-brand-600 hover:text-brand-500 hover:underline font-medium truncate max-w-full text-left flex items-center gap-1"
                            title="เปิดแชทนี้และเลื่อนไปยังข้อความที่ตอบช้า/ยังไม่ตอบ"
                          >
                            <span className="truncate">{e.customer_name || e.conversation_id}</span>
                            <ArrowUpCircle size={11} className="shrink-0 rotate-45 opacity-60" />
                          </button>
                        ) : (
                          <span className="text-slate-700 truncate block">{e.customer_name || e.conversation_id}</span>
                        )}
                      </td>
                      {/* เวลาจริง — ไว้ตรวจสอบว่าตัวเลข "ใช้เวลา" มาจากช่วงไหน (รอบเริ่มที่ข้อความแรกที่ยังไม่มีใครตอบ) */}
                      <td className="px-3 py-1.5 text-center text-slate-500 whitespace-nowrap" title={e.msg_at}>{fmtClock(e.msg_at)}</td>
                      <td className="px-3 py-1.5 text-center text-slate-500 whitespace-nowrap" title={e.replied_at || ""}>{e.replied_at ? fmtClock(e.replied_at) : "-"}</td>
                      <td className={`px-3 py-1.5 text-center font-semibold whitespace-nowrap ${!e.answered ? (e.is_closing ? "text-slate-500" : "text-amber-600") : e.slow ? "text-rose-600" : "text-emerald-600"}`}>
                        {e.answered ? fmtMin(e.minutes) : e.is_closing ? "ลูกค้าปิดเอง" : "ยังไม่ตอบ"}
                      </td>
                      <td className={`px-3 py-1.5 text-center whitespace-nowrap ${e.is_unread ? "text-amber-600 font-semibold" : "text-slate-500"}`} title={e.read_at || ""}>
                        {e.is_unread ? "ยังไม่อ่าน" : e.read_at ? `${fmtClock(e.read_at)}${e.read_minutes != null ? ` (${fmtMin(e.read_minutes)})` : ""}` : "-"}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500 truncate max-w-[160px]" title={e.by || ""}>{e.by || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 text-[11px] text-slate-500">
              <span>แสดง {Math.min(evLimit, evRows.length)} จาก {evRows.length} รายการ{evRows.length !== res.evidence_total ? ` (ทั้งหมด ${res.evidence_total})` : ""}</span>
              {evRows.length > evLimit && (
                <button onClick={() => setEvLimit((n) => n + 500)} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">
                  ดูเพิ่มอีก 500 รายการ
                </button>
              )}
              {evLimit > 300 && (
                <button onClick={() => setEvLimit(300)} className="text-slate-400 hover:text-slate-600">ย่อกลับ</button>
              )}
            </div>
          </>)}
        </div>
      )}

      {res && res.stats.length === 0 && (res.daily?.length ?? 0) === 0 && (
        <div className="text-sm text-slate-400 py-3 text-center">
          ยังไม่มีข้อมูลในช่วงนี้ — กด "ดึงจากแชทจริง" เพื่ออ่านย้อนหลังจากบทสนทนาที่ซิงก์ไว้
        </div>
      )}
      {/* สรุปต่อผู้ใช้ (รวมทุกเพจ) — จำนวนรอบที่ตอบ + ความเร็วเฉลี่ย */}
      {res && (res.users?.length ?? 0) > 0 && (
        <div>
          <div className="text-xs font-medium text-slate-600 mb-1">สรุปต่อผู้ใช้ (รวมทุกเพจ) — ในเวลาทำการ</div>
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 font-medium">ผู้ตอบ</th>
                <th className="px-3 py-2 font-medium text-center">ตอบ (รอบ)</th>
                <th className="px-3 py-2 font-medium text-center">เพจ</th>
                <th className="px-3 py-2 font-medium text-center">เฉลี่ย</th>
                <th className="px-3 py-2 font-medium text-center">เร็วสุด/ช้าสุด</th>
                <th className="px-3 py-2 font-medium text-center">ช้าเกิน {res.slow_min} นาที</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {res.users.map((u, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-slate-800 font-medium">{u.email}</td>
                    <td className="px-3 py-2 text-center">{u.count}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{u.pages}</td>
                    <td className="px-3 py-2 text-center font-semibold text-slate-800">{fmtMin(u.avg_min)}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{fmtMin(u.fastest_min)} / {fmtMin(u.slowest_min)}</td>
                    <td className={`px-3 py-2 text-center font-semibold ${u.slow > 0 ? "text-rose-600" : "text-emerald-600"}`}>{u.slow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ช่วงนอกเวลา/พัก/วันหยุด — ไม่นับในค่าเฉลี่ยหลัก แต่วิเคราะห์ด้วยเวลาจริง */}
      {res && res.off && res.off.total > 0 && (
        <div className="ds-card p-4">
          <div className="text-sm font-semibold text-amber-600 mb-1 flex items-center gap-1.5">🌙 ช่วงนอกเวลาทำการ / พักเบรก / วันหยุด <span className="text-[11px] font-normal text-slate-500">(ไม่นับในค่าเฉลี่ยหลัก)</span></div>
          <div className="text-[11px] text-slate-600 mb-2">
            ลูกค้าทักช่วงนี้ทั้งหมด <b>{res.off.total}</b> รอบ · ตอบแล้ว <b className="text-emerald-700">{res.off.answered}</b> · ยังไม่ตอบ <b className="text-rose-600">{res.off.unanswered}</b> · เฉลี่ยเวลาตอบจริง <b>{fmtMin(res.off.avg_min)}</b>
            <span className="text-slate-400"> (นับเวลาจริง ไม่หักเวลาทำการ)</span>
          </div>
          {(res.off.by_user?.length ?? 0) > 0 && (
            <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 font-medium">ผู้ตอบ</th>
                  <th className="px-3 py-2 font-medium text-center">ทัก (รอบ)</th>
                  <th className="px-3 py-2 font-medium text-center">ตอบ</th>
                  <th className="px-3 py-2 font-medium text-center">ยังไม่ตอบ</th>
                  <th className="px-3 py-2 font-medium text-center">เฉลี่ย (เวลาจริง)</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {res.off.by_user.map((o, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-slate-800">{o.email}</td>
                      <td className="px-3 py-2 text-center">{o.count}</td>
                      <td className="px-3 py-2 text-center text-emerald-700">{o.answered}</td>
                      <td className="px-3 py-2 text-center text-rose-600">{o.unanswered}</td>
                      <td className="px-3 py-2 text-center font-semibold text-slate-800">{o.answered ? fmtMin(o.avg_min) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* แต้มพิเศษ (ตอบนอกเวลาทำการ) — ต่อผู้ใช้ */}
      {res && res.points && (res.points.by_user?.length ?? 0) > 0 && (
        <div className="ds-card p-4">
          <div className="text-sm font-semibold mb-1 flex items-center gap-1.5" style={{ color: "#c4a9ff" }}>🏆 แต้มพิเศษ — ตอบแชทนอกเวลาทำการ <span className="text-[11px] font-normal text-slate-500">รวม {res.points.total} แต้ม</span></div>
          <div className="text-[11px] text-slate-500 mb-2">ยิ่งตอบดึก/วันหยุด/เร็ว = ยิ่งได้แต้มเยอะ (ทัน 3 นาที = แต้มเต็ม, ช้ากว่า = ครึ่ง)</div>
          <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 font-medium">ผู้ตอบ</th>
                <th className="px-3 py-2 font-medium text-center">แต้มรวม</th>
                <th className="px-3 py-2 font-medium text-center">ตอบนอกเวลา (ครั้ง)</th>
                <th className="px-3 py-2 font-medium text-center">ทัน 3 นาที</th>
                <th className="px-3 py-2 font-medium text-center">ช้ากว่า</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {res.points.by_user.map((p, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-slate-800 font-medium">{i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}{p.email}</td>
                    <td className="px-3 py-2 text-center"><span className="font-bold text-[13px] text-amber-600 tabular-nums">{p.points}</span></td>
                    <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{p.count}</td>
                    <td className="px-3 py-2 text-center text-emerald-600 font-medium tabular-nums">{p.in_time}</td>
                    <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{p.slow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {res && res.stats.length > 0 && (
        <div>
        <div className="text-xs font-medium text-slate-600 mb-1">แยกตามผู้ใช้ × เพจ — ในเวลาทำการ</div>
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
              <th className="px-3 py-2 font-medium">ผู้ตอบ</th><th className="px-3 py-2 font-medium">เพจ</th>
              <th className="px-3 py-2 font-medium text-center">ตอบ (ครั้ง)</th>
              <th className="px-3 py-2 font-medium text-center">เฉลี่ย</th>
              <th className="px-3 py-2 font-medium text-center">เร็วสุด/ช้าสุด</th>
              <th className="px-3 py-2 font-medium text-center">ช้าเกิน {res.slow_min} นาที</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {res.stats.map((s, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-slate-800">{s.email}</td>
                  <td className="px-3 py-2 text-slate-600">{s.page_name}</td>
                  <td className="px-3 py-2 text-center">{s.count}</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-800">{fmtMin(s.avg_min)}</td>
                  <td className="px-3 py-2 text-center text-slate-500">{fmtMin(s.fastest_min)} / {fmtMin(s.slowest_min)}</td>
                  <td className={`px-3 py-2 text-center font-semibold ${s.slow > 0 ? "text-rose-600" : "text-emerald-600"}`}>{s.slow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {res && res.slow_hours.some((n) => n > 0) && (
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs font-medium text-slate-600">ลูกค้าทักตามช่วงเวลา &amp; สัดส่วนที่ตอบช้า (เวลาไทย)</span>
            <div className="flex gap-1 ml-auto text-[11px]">
              {[["chart", "กราฟ"], ["table", "ตาราง"]].map(([k, l]) => (
                <button key={k} onClick={() => setHourView(k)} className={`rounded-full px-2.5 py-1 font-medium ${hourView === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
              ))}
            </div>
          </div>

          {hourView === "chart" ? (<>
            <div className="flex items-center gap-3 text-[10px] text-slate-500 mb-1">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300 inline-block" /> ลูกค้าทักทั้งหมด</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" /> ในนั้นตอบช้าเกิน {res.slow_min} นาที</span>
            </div>
            {/* คำนวณความสูงเป็น "พิกเซล" ตรงๆ — ใช้ % ไม่ได้เพราะกล่องแม่ในเลย์เอาต์ flex ไม่มีความสูงที่แน่นอน
                (เดิมแท่งเลยยุบเหลือ 3px กลายเป็นขีดบางๆ) */}
            {/* items-stretch + h-full ที่คอลัมน์ — ให้ทั้งแถบแนวตั้งรับเมาส์ได้ ไม่ใช่เฉพาะตัวแท่ง
                (เดิม tooltip ติดกับกล่องที่สูงเท่าเนื้อหา ชี้เหนือแท่งเตี้ยๆ แล้วไม่ขึ้นอะไร) */}
            <div className="flex items-stretch gap-1" style={{ height: 200 }}>
              {res.slow_hours.map((n, h) => {
                const all = res.all_hours[h] || 0;
                const pct = all ? Math.round((n / all) * 100) : 0;
                const BAR_MAX = 150;                                        // ความสูงสูงสุดของแท่ง (px)
                const barH = all ? Math.max(6, Math.round((all / maxAll) * BAR_MAX)) : 0;
                const slowH = all ? Math.round((n / all) * barH) : 0;
                return (
                  <div key={h} className="flex-1 h-full flex flex-col items-center justify-end min-w-0 rounded hover:bg-slate-100 cursor-default"
                    title={all > 0
                      ? `${String(h).padStart(2, "0")}:00-${String(h).padStart(2, "0")}:59 น.\nลูกค้าทัก ${all} ครั้ง\nตอบช้าเกิน ${res.slow_min} นาที ${n} ครั้ง (${pct}%)`
                      : `${String(h).padStart(2, "0")}:00-${String(h).padStart(2, "0")}:59 น. — ไม่มีลูกค้าทักในช่วงนี้`}>
                    {/* ตัวเลข: ช้า / ทั้งหมด */}
                    <span className="text-[10px] leading-tight text-center mb-1 whitespace-nowrap">
                      {all > 0 ? (<><span className="font-bold text-rose-600">{n}</span><span className="text-slate-400">/{all}</span></>) : ""}
                    </span>
                    {/* แท่งเทา = ลูกค้าทักทั้งหมด · ส่วนแดงที่ฐาน = ที่ตอบช้า */}
                    <div className="w-full rounded-t bg-slate-300 flex flex-col justify-end overflow-hidden"
                      style={{ height: barH }}>
                      <div className="w-full bg-rose-500" style={{ height: slowH }} />
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1">{h}</span>
                  </div>
                );
              })}
            </div>
          </>) : (
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-slate-600 border-b border-slate-200">
                  {[["hour", "ช่วงเวลา"], ["slow", "ช้า (ครั้ง)"], ["all", "ทั้งหมด (ครั้ง)"], ["pct", "% ที่ช้า"]].map(([k, l]) => (
                    <th key={k} className={`px-3 py-1.5 font-medium ${k === "hour" ? "" : "text-center"}`}>
                      <button
                        onClick={() => { if (hourSort === k) setHourDir((d) => (d === "asc" ? "desc" : "asc")); else { setHourSort(k); setHourDir(k === "hour" ? "asc" : "desc"); } }}
                        className={`inline-flex items-center gap-0.5 hover:text-slate-800 ${hourSort === k ? "text-slate-800 font-semibold" : ""}`}
                      >
                        {l}{hourSort === k && <span className="text-[8px]">{hourDir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {res.slow_hours
                    .map((n, h) => ({ hour: h, slow: n, all: res.all_hours[h] || 0, pct: res.all_hours[h] ? (n / res.all_hours[h]) * 100 : 0 }))
                    .filter((r) => r.all > 0)
                    .sort((a, b) => (hourDir === "asc" ? 1 : -1) * (a[hourSort] - b[hourSort]))
                    .map((r) => (
                      <tr key={r.hour} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 text-slate-700">{String(r.hour).padStart(2, "0")}:00 - {String(r.hour).padStart(2, "0")}:59</td>
                        <td className={`px-3 py-1.5 text-center font-semibold ${r.slow > 0 ? "text-rose-600" : "text-slate-400"}`}>{r.slow}</td>
                        <td className="px-3 py-1.5 text-center text-slate-600">{r.all}</td>
                        <td className={`px-3 py-1.5 text-center font-semibold ${r.pct >= 50 ? "text-rose-600" : r.pct > 0 ? "text-amber-600" : "text-emerald-600"}`}>{r.pct.toFixed(0)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
