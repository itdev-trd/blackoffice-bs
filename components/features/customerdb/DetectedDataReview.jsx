"use client";

// หน้ารวม "ข้อมูลที่ระบบตรวจจับได้" ให้แอดมินตรวจแล้วกดบันทึกเป็นชุด
// แก้ปัญหาเดิม: ต้องเปิดอ่านทีละแชทเพื่อดูว่าใครส่งเลขบัญชีมาแล้ว — 1,199 แชททำมือไม่ไหว
//
// ลำดับที่ออกแบบไว้ให้ปลอดภัย: สแกน (ไม่เขียน) → เช็คกับ XM (ไม่เขียน) → ติ๊กเลือก → บันทึก
// ไม่มีขั้นไหนเขียนข้อมูลลูกค้าโดยที่แอดมินไม่ได้กด และฝั่งเซิร์ฟเวอร์เช็คซ้ำก่อนเขียนทุกครั้ง

import { useState, useMemo } from "react";
import { Search, CheckCircle2, XCircle, Save, ExternalLink, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { Button, SectionTitle } from "@/components/ui";

const SRC_LABEL = { line: "LINE OA", instagram: "Instagram", comment: "คอมเมนต์", messenger: "Messenger" };

export default function DetectedDataReview({ onOpenChat }) {
  const [rows, setRows] = useState(null);      // ผลสแกน
  const [checked, setChecked] = useState({});  // id -> { pass, via }
  const [sel, setSel] = useState({});          // id -> true
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function call(body) {
    const { data, error: fnErr } = await supabase.functions.invoke("scan-trade-ids", { body });
    if (fnErr) return { ok: false, error: await readFunctionErrorMessage(fnErr) };
    return data || { ok: false, error: "ไม่มีข้อมูลตอบกลับ" };
  }

  async function scan() {
    setBusy("scan"); setError(""); setMsg(""); setChecked({}); setSel({});
    const r = await call({ action: "scan", limit: 300 });
    setBusy("");
    if (!r.ok) { setError(r.error || "สแกนไม่สำเร็จ"); return; }
    setRows(r.candidates || []);
    setMsg(`สแกน ${r.scanned} แชท · พบข้อมูล ${r.found} ราย (เลขบัญชี ${r.with_trade_id} · username TV ${r.with_tv})`);
  }

  async function verify() {
    setBusy("verify"); setError("");
    const r = await call({ action: "verify", apply: false, limit: 300 });
    setBusy("");
    if (!r.ok) { setError(r.error || "เช็คไม่สำเร็จ"); return; }
    const map = {};
    const nextSel = {};
    for (const x of r.results || []) {
      map[x.id] = { pass: x.pass, via: x.via };
      if (x.pass) nextSel[x.id] = true;   // ผ่านแล้วติ๊กให้เลย แอดมินยังเอาออกได้
    }
    setChecked(map);
    setSel((cur) => ({ ...cur, ...nextSel }));
    setMsg(`เช็คกับ XM แล้ว ${r.checked} ราย · ผ่าน ${r.passed} · ไม่ผ่าน ${r.failed}`);
  }

  async function saveSelected() {
    const items = (rows || []).filter((r) => sel[r.id]).map((r) => ({ id: r.id, trade_id: r.trade_id, username: r.username }));
    if (items.length === 0) return;
    if (!confirm(`บันทึกข้อมูลลูกค้า ${items.length} ราย?\nระบบจะเช็คเลขบัญชีกับ XM ซ้ำก่อนบันทึกทุกราย`)) return;
    setBusy("save"); setError("");
    const r = await call({ action: "apply", items });
    setBusy("");
    if (!r.ok) { setError(r.error || "บันทึกไม่สำเร็จ"); return; }
    setMsg(`บันทึกแล้ว ${r.saved} ราย${r.rejected ? ` · เช็คไม่ผ่าน ${r.rejected} ราย (ไม่บันทึก)` : ""}`);
    // เอารายที่บันทึกสำเร็จออกจากลิสต์ เพื่อไม่ให้กดซ้ำ
    const savedIds = new Set((r.detail || []).filter((d) => d.saved).map((d) => d.id));
    setRows((cur) => (cur || []).filter((x) => !savedIds.has(x.id)));
    setSel({});
  }

  const stats = useMemo(() => {
    const list = rows || [];
    return {
      total: list.length,
      withTid: list.filter((r) => r.trade_id).length,
      selected: list.filter((r) => sel[r.id]).length,
      passed: list.filter((r) => checked[r.id]?.pass).length,
    };
  }, [rows, sel, checked]);

  const allSelectable = (rows || []).filter((r) => r.trade_id || r.username);
  const toggleAll = () => {
    const on = stats.selected < allSelectable.length;
    setSel(on ? Object.fromEntries(allSelectable.map((r) => [r.id, true])) : {});
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="ตรวจข้อมูลที่ระบบพบในแชท"
        subtitle="สแกนหาเลขบัญชีเทรด / username TradingView ที่ลูกค้าพิมพ์มาเอง แล้วเช็คกับ XM ก่อนบันทึก — ไม่ต้องเปิดอ่านทีละแชท"
      />

      <div className="ds-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={Search} loading={busy === "scan"} onClick={scan} disabled={!!busy}>
            1 · สแกนหาข้อมูล
          </Button>
          <Button variant="secondary" icon={CheckCircle2} loading={busy === "verify"} onClick={verify} disabled={!!busy || !rows?.length}>
            2 · เช็คกับ XM
          </Button>
          <Button variant="primary" icon={Save} loading={busy === "save"} onClick={saveSelected} disabled={!!busy || stats.selected === 0}>
            3 · บันทึกที่เลือก ({stats.selected})
          </Button>
        </div>

        <p className="text-[11px] text-slate-400">
          สแกนกับเช็ค <span className="font-medium">ไม่เขียนข้อมูลอะไรเลย</span> · บันทึกได้เฉพาะรายที่ติ๊กเอง
          และเซิร์ฟเวอร์เช็คเลขบัญชีกับ XM ซ้ำก่อนเขียนทุกราย
        </p>

        {msg && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div>}
      </div>

      {rows === null ? (
        <div className="ds-card p-8 text-center text-sm text-slate-400">กด "สแกนหาข้อมูล" เพื่อเริ่ม</div>
      ) : rows.length === 0 ? (
        <div className="ds-card p-8 text-center text-sm text-slate-400">
          ไม่พบข้อมูลที่ตรวจจับได้เพิ่ม — อาจบันทึกไปครบแล้ว
        </div>
      ) : (
        <div className="ds-card overflow-hidden">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[12px] text-slate-500">
                  <th className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={stats.selected > 0 && stats.selected === allSelectable.length}
                      onChange={toggleAll}
                      className="h-4 w-4 cursor-pointer"
                      title="เลือก/ยกเลิกทั้งหมด"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">ลูกค้า</th>
                  <th className="px-3 py-2.5 font-medium">ช่องทาง</th>
                  <th className="px-3 py-2.5 font-medium">เลขบัญชีที่พบ</th>
                  <th className="px-3 py-2.5 font-medium">username TV</th>
                  <th className="px-3 py-2.5 font-medium">ผลเช็ค XM</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = checked[r.id];
                  return (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={!!sel[r.id]}
                          onChange={() => setSel((c) => ({ ...c, [r.id]: !c[r.id] }))}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2.5 font-medium text-slate-800">{r.customer_name || "(ไม่มีชื่อ)"}</td>
                      <td className="px-3 py-2.5 text-slate-500">{SRC_LABEL[r.source] || r.source}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-slate-800">{r.trade_id || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-slate-600">{r.username || "—"}</td>
                      <td className="px-3 py-2.5">
                        {!r.trade_id ? (
                          <span className="text-[11px] text-slate-400">ไม่มีเลขให้เช็ค</span>
                        ) : !v ? (
                          <span className="text-[11px] text-slate-400">ยังไม่เช็ค</span>
                        ) : v.pass ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                            <CheckCircle2 size={13} /> ผ่าน{v.via ? ` (${v.via})` : ""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600">
                            <XCircle size={13} /> ไม่ผ่าน
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => onOpenChat?.(r.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                        >
                          เปิดแชท <ExternalLink size={11} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* มือถือ: การ์ด */}
          <div className="divide-y divide-slate-100 md:hidden">
            {rows.map((r) => {
              const v = checked[r.id];
              return (
                <div key={r.id} className="flex gap-3 p-3.5">
                  <input
                    type="checkbox"
                    checked={!!sel[r.id]}
                    onChange={() => setSel((c) => ({ ...c, [r.id]: !c[r.id] }))}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="truncate font-medium text-slate-800">{r.customer_name || "(ไม่มีชื่อ)"}</div>
                    <div className="text-[12px] text-slate-500">
                      {SRC_LABEL[r.source] || r.source}
                      {r.trade_id && <> · <span className="font-mono text-slate-700">{r.trade_id}</span></>}
                      {r.username && <> · <span className="font-mono text-slate-600">{r.username}</span></>}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.trade_id && v && (
                        <span className={`text-[11px] font-medium ${v.pass ? "text-emerald-600" : "text-rose-600"}`}>
                          {v.pass ? "ผ่าน" : "ไม่ผ่าน"}
                        </span>
                      )}
                      <button onClick={() => onOpenChat?.(r.id)} className="text-[11px] font-medium text-brand-600">
                        เปิดแชท
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
            <AlertTriangle size={12} className="shrink-0" />
            รายที่ไม่มีเลขบัญชี บันทึกได้แค่ username TV — ไม่ถือว่าเปิดบัญชีแล้ว
            · ลูกค้าที่ส่งเลขมาเป็นภาพแคปหน้าจอ ระบบยังอ่านไม่ได้
          </div>
        </div>
      )}
    </div>
  );
}
