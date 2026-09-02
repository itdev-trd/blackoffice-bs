"use client";

// ป้ายกำกับ (Custom Labels) ของเพจ — อ่าน/สร้าง/ติด/ถอด แล้วผลไปขึ้นใน Meta Business Suite ทันที
// วางไว้บริเวณหัวแชท เพราะเป็นข้อมูลที่ต้องเห็นก่อนเริ่มตอบ (ลูกค้าเก่า/จ่ายแล้ว/สแปม)
//
// ข้อจำกัดของ Meta: ป้ายผูกกับ PSID ของ Facebook Page เท่านั้น
// LINE / Instagram ใช้ไม่ได้ — คอมโพเนนต์นี้จะไม่เรนเดอร์อะไรเลยในสองช่องทางนั้น

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Tag, Plus, X, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";

export default function MetaLabels({ row }) {
  const [mine, setMine] = useState(null);      // ป้ายที่ติดอยู่กับลูกค้ารายนี้
  const [all, setAll] = useState([]);          // ป้ายทั้งหมดของเพจ (โหลดตอนกางเมนู)
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");        // label_id ที่กำลังติด/ถอด
  const [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState("");
  const [localOnly, setLocalOnly] = useState(false); // Meta อ่านป้ายย้อนกลับไม่ได้ -> เห็นเฉพาะที่ติดผ่านแอปนี้
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const boxRef = useRef(null);

  const rowId = row?.id || "";
  const pageId = row?.page_id || "";
  // Meta ผูกป้ายกับ PSID ของเพจ Facebook เท่านั้น — LINE/Instagram/คอมเมนต์ที่ยังไม่มี PSID ใช้ไม่ได้
  // เช็คฝั่งนี้เลย ไม่ยิงฟังก์ชัน เพราะฝั่งเซิร์ฟเวอร์ต้องผ่าน auth + ดึง Meta token + ยิง Graph
  // ก่อนจะรู้ว่าไม่รองรับ ซึ่งกินเวลา ~650ms ต่อครั้งโดยไม่ได้อะไร (ทำให้เปิดแชท LINE ช้าลง)
  const supported = !!rowId && !!row?.psid && row?.source !== "line" && row?.source !== "instagram";

  const call = useCallback(async (body) => {
    const { data, error: fnErr } = await supabase.functions.invoke("chat-labels", { body });
    if (fnErr) return { ok: false, error: await readFunctionErrorMessage(fnErr) };
    return data || { ok: false, error: "ไม่มีข้อมูลตอบกลับ" };
  }, []);

  // โหลดป้ายของลูกค้าเมื่อเปลี่ยนแชท
  useEffect(() => {
    if (!rowId || !supported) { setMine(null); return; }
    let dead = false;
    setMine(null); setError(""); setUnsupported(""); setOpen(false);
    (async () => {
      const r = await call({ action: "of", id: rowId });
      if (dead) return;
      if (r.unsupported) { setUnsupported(r.unsupported); setMine([]); return; }
      if (!r.ok) { setError(r.error || "อ่านป้ายไม่สำเร็จ"); setMine([]); return; }
      setLocalOnly(r.lookup_unsupported === true);
      setMine(r.labels || []);
    })();
    return () => { dead = true; };
  }, [rowId, supported, call]);

  // ปิดเมนูเมื่อคลิกที่อื่น
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function openMenu() {
    setOpen((v) => !v);
    if (all.length > 0 || !pageId) return;
    setLoading(true);
    const r = await call({ action: "list", page_id: pageId });
    setLoading(false);
    if (!r.ok) { setError(r.error || "อ่านรายการป้ายไม่สำเร็จ"); return; }
    setAll(r.labels || []);
  }

  async function toggle(label) {
    const attached = (mine || []).some((l) => l.id === label.id);
    setBusy(label.id); setError("");
    const r = await call({ action: attached ? "detach" : "attach", id: rowId, label_id: label.id, label_name: label.name });
    setBusy("");
    if (!r.ok) { setError(r.error || "เปลี่ยนป้ายไม่สำเร็จ"); return; }
    // ใช้รายการที่ฟังก์ชันคืนมา (มาจากสิ่งที่บันทึกจริง) ไม่เดาสถานะเองฝั่งหน้าจอ
    if (Array.isArray(r.labels)) setMine(r.labels);
    else { const fresh = await call({ action: "of", id: rowId }); if (fresh.ok) setMine(fresh.labels || []); }
  }

  async function createLabel() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true); setError("");
    const r = await call({ action: "create", page_id: pageId, name });
    setCreating(false);
    if (!r.ok) { setError(r.error || "สร้างป้ายไม่สำเร็จ"); return; }
    setNewName("");
    setAll((cur) => (cur.some((l) => l.id === r.label.id) ? cur : [...cur, r.label].sort((a, b) => a.name.localeCompare(b.name, "th"))));
    // สร้างแล้วติดให้เลย — แอดมินสร้างป้ายก็เพราะจะใช้กับคนนี้
    await toggle(r.label);
  }

  // ช่องทางที่ Meta ไม่รองรับ: ไม่ต้องโชว์อะไรเลย ดีกว่าโชว์ปุ่มที่กดแล้วไม่เกิดอะไร
  if (!supported) return null;
  if (unsupported === "line" || unsupported === "instagram") return null;

  const attachedSet = new Set((mine || []).map((l) => l.id));

  return (
    <div ref={boxRef} className="relative flex flex-wrap items-center gap-1.5">
      <Tag size={13} className="shrink-0 text-night-ink-3" />

      {mine === null ? (
        <span className="flex items-center gap-1 text-[11px] text-night-ink-3">
          <Loader2 size={11} className="animate-spin" /> โหลดป้าย…
        </span>
      ) : mine.length === 0 ? (
        <span className="text-[11px] text-night-ink-3">ยังไม่มีป้าย</span>
      ) : (
        mine.map((l) => (
          <span
            key={l.id}
            title={l.system ? "ป้ายที่ Meta สร้างอัตโนมัติจากโฆษณา" : "ป้ายกำกับใน Meta"}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              l.system
                ? "border-night-border bg-night-surface2 text-night-ink-3"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {l.name}
            {!l.system && (
              <button
                type="button"
                onClick={() => toggle(l)}
                disabled={busy === l.id}
                aria-label={`ถอดป้าย ${l.name}`}
                className="hover:text-white disabled:opacity-50"
              >
                {busy === l.id ? <Loader2 size={10} className="animate-spin" /> : <X size={11} />}
              </button>
            )}
          </span>
        ))
      )}

      <button
        type="button"
        onClick={openMenu}
        className="inline-flex items-center gap-0.5 rounded-full border border-night-border bg-night-surface2 px-2 py-0.5 text-[11px] font-medium text-night-ink-2 hover:text-night-ink"
      >
        <Plus size={11} /> ป้าย <ChevronDown size={10} />
      </button>

      {error && <span className="text-[11px] text-rose-400">{error}</span>}

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-night-border bg-night-surface shadow-xl">
          <div className="max-h-56 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-night-ink-3">
                <Loader2 size={12} className="animate-spin" /> โหลดรายการป้าย…
              </div>
            ) : all.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-night-ink-3">ยังไม่มีป้ายในเพจนี้ — สร้างใหม่ด้านล่างได้</div>
            ) : (
              all.map((l) => {
                const on = attachedSet.has(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggle(l)}
                    disabled={busy === l.id}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-night-ink hover:bg-night-surface2 disabled:opacity-50"
                  >
                    <span className="min-w-0 truncate">{l.name}</span>
                    {busy === l.id ? (
                      <Loader2 size={12} className="shrink-0 animate-spin" />
                    ) : (
                      <span className={`shrink-0 text-[10px] ${on ? "text-emerald-400" : "text-night-ink-3"}`}>
                        {on ? "ติดแล้ว ✓" : "ติด"}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="flex gap-1.5 border-t border-night-border p-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createLabel(); }}
              maxLength={100}
              placeholder="สร้างป้ายใหม่…"
              className="min-w-0 flex-1 rounded-lg border border-night-border bg-night-surface2 px-2 py-1.5 text-xs text-night-ink placeholder:text-night-ink-3"
            />
            <button
              type="button"
              onClick={createLabel}
              disabled={!newName.trim() || creating}
              className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : "สร้าง"}
            </button>
          </div>
          <div className="border-t border-night-border px-2 py-1.5 text-[10px] text-night-ink-3">
            ป้ายที่ติด/ถอดที่นี่ จะขึ้นใน Meta Business Suite ทันที
            {localOnly && " · Meta ไม่มี API อ่านป้ายย้อนกลับ จึงเห็นเฉพาะป้ายที่ติดผ่านแอปนี้"}
          </div>
        </div>
      )}
    </div>
  );
}
