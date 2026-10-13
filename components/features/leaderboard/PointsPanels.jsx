"use client";

// ส่วนประกอบของกระดานแต้มโบนัส — รายการแต้มพร้อมหลักฐาน, คำร้องโต้แย้ง, กติกา, เครื่องมือ owner
// ข้อมูลทั้งหมดมาจาก edge function `points` (สมุด point_events ที่แก้/ลบไม่ได้)

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { Button, Dialog, Field, Input, Textarea, Select, Badge, EmptyState } from "@/components/ui";
import { MessageSquare, Flag, Undo2, Loader2, CheckCircle2, XCircle, ShieldCheck, History, Database, Lock } from "lucide-react";

export const KIND_LABEL = {
  reply_offhours: "ตอบนอกเวลา",
  reply_office: "ตอบในเวลา",
  tv_grant: "ให้สิทธิ์ TV",
  tv_renew: "ต่ออายุ TV",
  adjustment: "ปรับแต้ม",
  reversal: "หักคืน",
};
const KIND_TONE = { reply_offhours: "brand", reply_office: "slate", tv_grant: "green", tv_renew: "green", adjustment: "gold", reversal: "red" };

export async function callPoints(body) {
  const { data, error } = await supabase.functions.invoke("points", { body });
  if (error || !data?.ok) throw new Error(data?.error || (await readFunctionErrorMessage(error)) || "ทำรายการไม่สำเร็จ");
  return data;
}

export const fmtPts = (n) => {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return (v > 0 ? "" : "") + v.toLocaleString("th-TH", { maximumFractionDigits: 2 });
};
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtT = (iso) => (iso ? new Date(iso).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }) : "—");
export const shortName = (email, name) => name || String(email || "").split("@")[0] || "—";
export const periodLabel = (p) => {
  const [y, m] = String(p).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
};

// คำอธิบายหลักฐานของแต้มหนึ่งรายการ — ต้องอ่านแล้วตรวจกับแชทจริงได้ทันที
function EvidenceText({ ev }) {
  const e = ev.evidence || {};
  if (ev.kind === "reply_offhours" || ev.kind === "reply_office") {
    return (
      <>
        <div>
          ลูกค้าทัก <b>{fmtT(e.msg_at)}</b> → ตอบ <b>{fmtT(e.reply_at)}</b> ({e.wait_min ?? "?"} นาที ·{" "}
          <span style={{ color: e.in_time ? "var(--ok)" : "var(--warn)" }}>{e.in_time ? "ทันเวลา" : `ช้ากว่า ${e.slow_min ?? 5} นาที`}</span>)
        </div>
        <div style={{ color: "var(--ink-3)" }}>
          {e.used === "msg" ? `คิดตามช่วงที่ลูกค้าทัก: ${e.slot_msg}` : `คิดตามช่วงที่ตอบ: ${e.slot_reply}`}
          {e.customer_name ? ` · ${e.customer_name}` : ""}{e.page_name ? ` · ${e.page_name}` : ""}
        </div>
        {e.capped && (ev.refunded_by
          ? <div style={{ color: "var(--ok)" }}>เคยถูกตัดด้วยเพดานต่อห้อง (กติกาเดิม) — คืนแต้ม {fmtPts(e.full_points)} แล้วในรายการ #{ev.refunded_by}</div>
          : <div style={{ color: "var(--warn)" }}>เกินเพดานแต้มของห้องนี้ในวันนั้นแล้ว — บันทึกไว้เป็น 0 (ปกติได้ {fmtPts(e.full_points)})</div>)}
      </>
    );
  }
  if (ev.kind === "tv_grant" || ev.kind === "tv_renew") {
    return (
      <div>
        {e.username} · {String(e.pine_id || "").replace(/^PUB;/, "").slice(0, 10)}…
        {ev.kind === "tv_renew" && <> · หมดอายุ {e.expiration_before ? fmtDT(e.expiration_before) : "—"} → {e.expiration_after ? fmtDT(e.expiration_after) : "ตลอดชีพ"}</>}
        {ev.kind === "tv_grant" && e.expiration_after !== undefined && <> · หมดอายุ {e.expiration_after ? fmtDT(e.expiration_after) : "ตลอดชีพ"}</>}
      </div>
    );
  }
  return <div>{ev.note || e.reason || "—"}{e.adjusts_period ? ` (ของเดือน ${periodLabel(e.adjusts_period)})` : ""}</div>;
}

export function EventRow({ ev, isOwner, onDispute, onReverse, onOpenChat }) {
  const e = ev.evidence || {};
  const reversed = !!ev.reversed_by;
  // รายการที่เคยโดนตัดเพดานแล้วได้คืน — แสดงแต้มที่ได้จริงรวมกับแต้มที่คืนแล้ว
  const effective = Number(ev.points) + (ev.refunded_by ? Number(e.full_points || 0) : 0);
  return (
    <div className="flex gap-3 py-3" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs tabular-nums" style={{ color: "var(--ink-3)" }}>{fmtDT(ev.occurred_at)}</span>
          <Badge tone={KIND_TONE[ev.kind] || "slate"}>{KIND_LABEL[ev.kind] || ev.kind}</Badge>
          {e.backfill && <Badge tone="slate">ย้อนจากระบบเดิม</Badge>}
          {e.late_for && <Badge tone="gold">มาช้า (ของเดือน {periodLabel(e.late_for)})</Badge>}
          {reversed && <Badge tone="red">ถูกหักคืนแล้ว</Badge>}
          {ev.refunded_by && <Badge tone="green">คืนแต้มแล้ว</Badge>}
          {ev.dispute && <Badge tone={ev.dispute.status === "open" ? "gold" : ev.dispute.status === "approved" ? "green" : "slate"}>คำร้อง: {ev.dispute.status === "open" ? "รอพิจารณา" : ev.dispute.status === "approved" ? "อนุมัติ" : "ไม่อนุมัติ"}</Badge>}
          <span className="text-2xs" style={{ color: "var(--ink-3)" }}>#{ev.id}{ev.rule_version ? ` · กติกา v${ev.rule_version}` : ""}</span>
        </div>
        <EvidenceText ev={ev} />
        <div className="mt-1 flex flex-wrap gap-1">
          {ev.conversation_id && onOpenChat && <Button size="sm" variant="ghost" icon={MessageSquare} onClick={() => onOpenChat(ev.conversation_id)}>เปิดแชท</Button>}
          {ev.kind !== "reversal" && onDispute && <Button size="sm" variant="ghost" icon={Flag} onClick={() => onDispute(ev)}>โต้แย้ง</Button>}
          {isOwner && !reversed && ev.kind !== "reversal" && Number(ev.points) !== 0 && onReverse && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => onReverse(ev)}>หักแต้ม</Button>}
        </div>
      </div>
      <span className="shrink-0 text-[17px] font-bold tabular-nums" style={{ color: effective < 0 ? "var(--bad)" : effective === 0 ? "var(--ink-3)" : "var(--ink)", textDecoration: reversed ? "line-through" : "none" }}>
        {effective > 0 ? "+" : ""}{fmtPts(effective)}
      </span>
    </div>
  );
}

// รายการแต้มของพนักงานคนหนึ่งในเดือนที่เลือก
export function StaffEventsDialog({ open, period, staff, isOwner, onClose, onOpenChat, onChanged }) {
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState("");
  const [kind, setKind] = useState("");
  const [dispute, setDispute] = useState(null);
  const [reverse, setReverse] = useState(null);

  const load = async () => {
    setEvents(null); setErr("");
    try { setEvents((await callPoints({ action: "events", period, staff: staff?.email })).events); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { if (open && staff) { setKind(""); load(); } /* eslint-disable-next-line */ }, [open, staff?.email, period]);

  // รายการ "คืนแต้ม" ไม่แยกแถว — รวมเข้าไปในรายการเดิมที่มันคืนให้ (ดู EventRow)
  const shown = useMemo(() => (events || []).filter((e) => !e.evidence?.refund_of && (!kind || e.kind === kind)), [events, kind]);
  const sum = shown.reduce((s, e) => s + Number(e.points || 0) + (e.refunded_by ? Number(e.evidence?.full_points || 0) : 0), 0);

  return (
    <>
      <Dialog open={open} onClose={onClose} className="points-dialog"
        title={`แต้มของ ${shortName(staff?.email, staff?.name)} — ${periodLabel(period)}`}
        description={staff?.email}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-44">
              <option value="">ทุกประเภท</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <span className="text-xs" style={{ color: "var(--ink-3)" }}>{shown.length} รายการ · รวม <b style={{ color: "var(--ink)" }}>{fmtPts(sum)}</b> แต้ม</span>
          </div>
          {err && <div className="text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
          {!events && !err && <div className="py-8 flex justify-center"><Loader2 className="animate-spin" style={{ color: "var(--ink-3)" }} /></div>}
          {events && shown.length === 0 && <EmptyState title="ไม่มีรายการ" hint="ยังไม่มีแต้มประเภทนี้ในเดือนนี้" />}
          <div>
            {shown.map((ev) => (
              <EventRow key={ev.id} ev={ev} isOwner={isOwner}
                onOpenChat={onOpenChat ? (id) => { onClose(); onOpenChat(id); } : null}
                onDispute={setDispute} onReverse={setReverse} />
            ))}
          </div>
        </div>
      </Dialog>
      <DisputeDialog ev={dispute} period={period} onClose={() => setDispute(null)} onDone={() => { setDispute(null); load(); onChanged?.(); }} />
      <ReverseDialog ev={reverse} onClose={() => setReverse(null)} onDone={() => { setReverse(null); load(); onChanged?.(); }} />
    </>
  );
}

// ยื่นโต้แย้ง — ผูกกับรายการแต้ม (ev) หรือยื่นแบบทั่วไป ("แต้มที่ควรได้แต่ไม่เห็นในระบบ")
export function DisputeDialog({ ev, general = false, period, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [pts, setPts] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const open = !!ev || general;
  useEffect(() => { if (open) { setReason(""); setPts(""); setErr(""); } }, [open, ev?.id]);
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await callPoints({ action: "file_dispute", event_id: ev?.id || null, period, reason, requested_points: pts === "" ? null : Number(pts) });
      onDone?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Dialog open={open} onClose={onClose} title={ev ? `โต้แย้งรายการ #${ev.id}` : "ยื่นคำร้องเรื่องแต้ม"}
      description={ev ? `${KIND_LABEL[ev.kind]} · ${fmtPts(ev.points)} แต้ม · ${fmtDT(ev.occurred_at)}` : "เช่น ตอบแชทแล้วแต่ไม่ได้แต้ม — ระบุห้องแชท/เวลาให้ชัดเจน"}
      footer={<><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button variant="primary" loading={busy} onClick={submit}>ส่งคำร้อง</Button></>}>
      <div className="space-y-3">
        <Field label="เหตุผล / หลักฐาน" hint="owner จะเห็นข้อความนี้ และตอบกลับพร้อมเหตุผลทุกครั้ง">
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ห้องคุณสมชาย ทัก 22:10 ฉันเป็นคนตอบ 22:12 แต่แต้มไปอยู่ที่คนอื่น" />
        </Field>
        <Field label="จำนวนแต้มที่ขอปรับ (ไม่บังคับ)" hint="บวก = ขอเพิ่ม · ลบ = ขอหัก (เช่นแจ้งว่าตัวเองได้แต้มเกิน)">
          <Input type="number" step="0.25" value={pts} onChange={(e) => setPts(e.target.value)} />
        </Field>
        {err && <div className="text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
      </div>
    </Dialog>
  );
}

function ReverseDialog({ ev, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (ev) { setReason(""); setErr(""); } }, [ev?.id]);
  const submit = async () => {
    setBusy(true); setErr("");
    try { await callPoints({ action: "reverse", event_id: ev.id, reason }); onDone?.(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Dialog open={!!ev} onClose={onClose} title={`หักแต้มรายการ #${ev?.id || ""}`}
      description="ระบบจะเพิ่มรายการ 'หักคืน' ติดลบ ไม่ลบรายการเดิม — ทุกคนเห็นเหตุผลนี้"
      footer={<><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button variant="danger" loading={busy} onClick={submit}>หักแต้ม {ev ? fmtPts(ev.points) : ""}</Button></>}>
      <Field label="เหตุผล"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น เป็นบัญชีทดสอบ / ตอบซ้ำกับคนอื่น" /></Field>
      {err && <div className="mt-2 text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
    </Dialog>
  );
}

// คำร้องโต้แย้ง — คนทั่วไปเห็นของตัวเอง owner เห็นทั้งหมดและพิจารณาได้
export function DisputesPanel({ period, isOwner, onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("open");
  const [resolving, setResolving] = useState(null);
  const [general, setGeneral] = useState(false);
  const load = async () => {
    setRows(null); setErr("");
    try { setRows((await callPoints({ action: "list_disputes", period, status: status || undefined })).disputes); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period, status]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="open">รอพิจารณา</option><option value="approved">อนุมัติแล้ว</option><option value="rejected">ไม่อนุมัติ</option><option value="">ทั้งหมด</option>
        </Select>
        <span className="text-xs" style={{ color: "var(--ink-3)" }}>{isOwner ? "คำร้องของทุกคน" : "คำร้องของฉัน"} · {periodLabel(period)}</span>
        <Button size="sm" variant="secondary" icon={Flag} className="ml-auto" onClick={() => setGeneral(true)}>ยื่นคำร้องใหม่</Button>
      </div>
      {err && <div className="text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
      {!rows && !err && <div className="py-6 flex justify-center"><Loader2 className="animate-spin" style={{ color: "var(--ink-3)" }} /></div>}
      {rows && rows.length === 0 && <EmptyState title="ไม่มีคำร้อง" hint="ถ้าเห็นแต้มไม่ถูกต้อง กด 'โต้แย้ง' ที่รายการนั้น หรือ 'ยื่นคำร้องใหม่'" />}
      {(rows || []).map((d) => (
        <div key={d.id} className="ds-card p-3 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <b style={{ color: "var(--ink)" }}>#{d.id}</b>
            <Badge tone={d.status === "open" ? "gold" : d.status === "approved" ? "green" : "slate"}>{d.status === "open" ? "รอพิจารณา" : d.status === "approved" ? "อนุมัติ" : "ไม่อนุมัติ"}</Badge>
            <span>{shortName(d.staff_email)}</span>
            <span style={{ color: "var(--ink-3)" }}>· ยื่น {fmtDT(d.created_at)}</span>
            {d.requested_points !== null && <span style={{ color: "var(--ink-3)" }}>· ขอ {d.requested_points > 0 ? "+" : ""}{fmtPts(d.requested_points)} แต้ม</span>}
          </div>
          {d.event && <div className="mt-1" style={{ color: "var(--ink-3)" }}>รายการ #{d.event.id} · {KIND_LABEL[d.event.kind]} · {fmtPts(d.event.points)} แต้ม ของ {shortName(d.event.staff_email)} · {fmtDT(d.event.occurred_at)}</div>}
          <div className="mt-1.5 whitespace-pre-wrap">{d.reason}</div>
          {d.status !== "open" && (
            <div className="mt-2 rounded-control p-2" style={{ background: "var(--ground)" }}>
              <b>{d.status === "approved" ? "อนุมัติ" : "ไม่อนุมัติ"}</b> โดย {shortName(d.resolved_by)} · {fmtDT(d.resolved_at)}
              {d.adjustment_event_id && <> · ปรับแต้มรายการ #{d.adjustment_event_id}</>}
              <div className="whitespace-pre-wrap">{d.resolution_note}</div>
            </div>
          )}
          {isOwner && d.status === "open" && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => setResolving({ d, approve: true })}>อนุมัติ</Button>
              <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setResolving({ d, approve: false })}>ไม่อนุมัติ</Button>
            </div>
          )}
        </div>
      ))}
      <ResolveDialog state={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); load(); onChanged?.(); }} />
      <DisputeDialog general={general} period={period} onClose={() => setGeneral(false)} onDone={() => { setGeneral(false); load(); }} />
    </div>
  );
}

function ResolveDialog({ state, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [pts, setPts] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!state) return;
    setNote(""); setErr("");
    setPts(state.d.requested_points !== null ? String(state.d.requested_points) : "");
  }, [state]);
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await callPoints({ action: "resolve_dispute", id: state.d.id, approve: state.approve, note, points: state.approve ? (pts === "" ? 0 : Number(pts)) : undefined });
      onDone?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Dialog open={!!state} onClose={onClose} title={state?.approve ? `อนุมัติคำร้อง #${state?.d.id}` : `ไม่อนุมัติคำร้อง #${state?.d.id}`}
      footer={<><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button variant={state?.approve ? "primary" : "secondary"} loading={busy} onClick={submit}>ยืนยัน</Button></>}>
      <div className="space-y-3">
        {state?.approve && (
          <Field label={`ปรับแต้มให้ ${shortName(state.d.staff_email)}`} hint="บวก = เพิ่ม · ลบ = หัก · 0 = อนุมัติโดยไม่ปรับแต้ม (เช่นแก้ด้วยการหักแต้มรายการเดิมแล้ว)">
            <Input type="number" step="0.25" value={pts} onChange={(e) => setPts(e.target.value)} />
          </Field>
        )}
        <Field label="เหตุผล (คนยื่นจะเห็น)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <div className="text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
      </div>
    </Dialog>
  );
}

// กติกาปัจจุบัน + ประวัติเวอร์ชัน — ทุกคนเห็น owner แก้ได้ (สร้างเวอร์ชันใหม่ ไม่ทับของเดิม)
export function RulesPanel({ rules, isOwner, onChanged }) {
  const [history, setHistory] = useState(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { callPoints({ action: "rules_history" }).then((d) => setHistory(d.versions)).catch(() => setHistory([])); }, [rules?.version]);
  if (!rules) return null;
  const row = (r) => `${String(r[0]).padStart(2, "0")}:00–${String(r[1]).padStart(2, "0")}:00`;
  const oh = rules.office_hours || {};
  const dayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  return (
    <div className="space-y-4 text-[13px]" style={{ color: "var(--ink-2)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">กติกาเวอร์ชัน {rules.version}</Badge>
        <span className="text-xs" style={{ color: "var(--ink-3)" }}>เวลาทำการ {oh.days?.map((d) => dayNames[d]).join(" ")} {oh.open}–{oh.close} (พัก {oh.break_start || "-"}–{oh.break_end || "-"}) · ทันเวลา = ตอบภายใน {rules.slow_min} นาที</span>
        {isOwner && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setEditing(true)}>แก้กติกา</Button>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[["workday", "นอกเวลา · วันทำงาน"], ["holiday", "วันหยุด / เสาร์-อาทิตย์ / วันหยุดพิเศษ"]].map(([k, title]) => (
          <div key={k} className="ds-card p-3">
            <div className="mb-2 font-semibold" style={{ color: "var(--ink)" }}>{title}</div>
            <table className="w-full text-xs tabular-nums">
              <thead><tr style={{ color: "var(--ink-3)" }}><th className="text-left font-medium py-1">ช่วงเวลา</th><th className="text-right font-medium">ทันเวลา</th><th className="text-right font-medium">ช้า</th></tr></thead>
              <tbody>{rules.off_table[k].map((r) => <tr key={r.join()} style={{ borderTop: "1px solid var(--line)" }}><td className="py-1.5">{row(r)}</td><td className="text-right font-semibold" style={{ color: "var(--ink)" }}>{r[2]}</td><td className="text-right">{r[3]}</td></tr>)}</tbody>
            </table>
          </div>
        ))}
        <div className="ds-card p-3">
          <div className="mb-2 font-semibold" style={{ color: "var(--ink)" }}>ในเวลาทำการ</div>
          ทันเวลา <b style={{ color: "var(--ink)" }}>{rules.office[0]}</b> · ช้า <b style={{ color: "var(--ink)" }}>{rules.office[1]}</b> แต้ม
          <div className="mt-2 text-xs" style={{ color: "var(--ink-3)" }}>
            เพดานต่อห้องแชทต่อวัน: ในเวลา {rules.caps.office_per_conv_day || "ไม่จำกัด"} · นอกเวลา {rules.caps.off_per_conv_day || "ไม่จำกัด"}
          </div>
        </div>
        <div className="ds-card p-3">
          <div className="mb-2 font-semibold" style={{ color: "var(--ink)" }}>TradingView</div>
          ให้สิทธิ์ใหม่ <b style={{ color: "var(--ink)" }}>{rules.tv.grant}</b> · ต่ออายุ <b style={{ color: "var(--ink)" }}>{rules.tv.renew}</b> แต้ม ต่อสคริปต์
          <div className="mt-2 text-xs" style={{ color: "var(--ink-3)" }}>ถอนสิทธิ์ภายใน {rules.tv.revoke_void_days} วัน = หักแต้มคืน · ยื่นโต้แย้งได้ {rules.dispute_days} วันหลังสิ้นเดือน</div>
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-1.5 font-semibold" style={{ color: "var(--ink)" }}><History size={14} /> ประวัติการเปลี่ยนกติกา</div>
        {(history || []).map((v) => (
          <div key={v.version} className="py-1.5 text-xs" style={{ borderTop: "1px solid var(--line)" }}>
            <b>v{v.version}</b> · {fmtDT(v.created_at)} · {v.created_by} — {v.note}
          </div>
        ))}
      </div>
      <RulesEditor open={editing} rules={rules} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChanged?.(); }} />
    </div>
  );
}

function RulesEditor({ open, rules, onClose, onDone }) {
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!open) return;
    setDraft(JSON.parse(JSON.stringify({ off_table: rules.off_table, office: rules.office, tv: rules.tv, caps: rules.caps, dispute_days: rules.dispute_days })));
    setNote(""); setErr("");
  }, [open, rules]);
  if (!draft) return null;
  const set = (fn) => setDraft((d) => { const c = JSON.parse(JSON.stringify(d)); fn(c); return c; });
  const numIn = (value, onChange, step = "0.25") => <Input type="number" step={step} min="0" value={value} onChange={(e) => onChange(Number(e.target.value))} className="!py-1.5" />;
  const submit = async () => {
    setBusy(true); setErr("");
    try { await callPoints({ action: "rules_set", rules: draft, note }); onDone?.(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Dialog open={open} onClose={onClose} className="points-dialog" title="แก้กติกาแต้ม (สร้างเวอร์ชันใหม่)"
      description="มีผลกับแต้มที่เกิดหลังจากบันทึกเท่านั้น แต้มที่ได้ไปแล้วไม่เปลี่ยน — ทุกคนเห็นประวัติการแก้"
      footer={<><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button variant="primary" loading={busy} onClick={submit}>บันทึกเป็นเวอร์ชันใหม่</Button></>}>
      <div className="space-y-4 text-[12.5px]">
        {["workday", "holiday"].map((k) => (
          <div key={k}>
            <div className="mb-1 font-semibold">{k === "workday" ? "นอกเวลา · วันทำงาน" : "วันหยุด"} <span className="font-normal" style={{ color: "var(--ink-3)" }}>[ชม.เริ่ม, ชม.จบ, แต้มทัน, แต้มช้า]</span></div>
            {draft.off_table[k].map((r, i) => (
              <div key={i} className="mb-1 grid grid-cols-4 gap-1.5">
                {r.map((v, j) => <div key={j}>{numIn(v, (n) => set((c) => { c.off_table[k][i][j] = n; }), j < 2 ? "1" : "0.25")}</div>)}
              </div>
            ))}
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <Field label="ในเวลา · ทันเวลา">{numIn(draft.office[0], (n) => set((c) => { c.office[0] = n; }))}</Field>
          <Field label="ในเวลา · ช้า">{numIn(draft.office[1], (n) => set((c) => { c.office[1] = n; }))}</Field>
          <Field label="TV ให้สิทธิ์ใหม่">{numIn(draft.tv.grant, (n) => set((c) => { c.tv.grant = n; }))}</Field>
          <Field label="TV ต่ออายุ">{numIn(draft.tv.renew, (n) => set((c) => { c.tv.renew = n; }))}</Field>
          <Field label="ถอนสิทธิ์ภายในกี่วัน = หักแต้มคืน">{numIn(draft.tv.revoke_void_days, (n) => set((c) => { c.tv.revoke_void_days = n; }), "1")}</Field>
          <Field label="ยื่นโต้แย้งได้กี่วันหลังสิ้นเดือน">{numIn(draft.dispute_days, (n) => set((c) => { c.dispute_days = n; }), "1")}</Field>
          <Field label="เพดานในเวลา (ครั้ง/ห้อง/วัน · 0 = ไม่จำกัด)">{numIn(draft.caps.office_per_conv_day, (n) => set((c) => { c.caps.office_per_conv_day = n; }), "1")}</Field>
          <Field label="เพดานนอกเวลา (ครั้ง/ห้อง/วัน · 0 = ไม่จำกัด)">{numIn(draft.caps.off_per_conv_day, (n) => set((c) => { c.caps.off_per_conv_day = n; }), "1")}</Field>
        </div>
        <Field label="เหตุผลที่เปลี่ยน (ทุกคนเห็น)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เพิ่มแต้มในเวลาเป็น 1 ตั้งแต่ 1 พ.ย." /></Field>
        {err && <div className="text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
      </div>
    </Dialog>
  );
}

// เครื่องมือ owner: ปรับแต้มมือ · ย้อนบันทึกแต้มจากระบบเดิม · ปิดยอดเดือน
export function OwnerTools({ overview, onChanged }) {
  const period = overview.period;
  const [adj, setAdj] = useState({ staff: "", points: "", reason: "", adjusts: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [backfill, setBackfill] = useState(null);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const closed = overview.status === "closed";
  const isPast = period < overview.current_period;
  const closeReady = isPast && Date.now() >= new Date(overview.close_allowed_at).getTime();
  const run = async (key, fn) => {
    setBusy(key); setErr(""); setMsg("");
    try { await fn(); } catch (e) { setErr(e.message); }
    setBusy("");
  };
  return (
    <div className="space-y-5 text-[13px]" style={{ color: "var(--ink-2)" }}>
      {err && <div className="rounded-control p-2 text-xs" style={{ color: "var(--bad)", background: "var(--ground)" }}>{err}</div>}
      {msg && <div className="rounded-control p-2 text-xs" style={{ color: "var(--ok)", background: "var(--ground)" }}>{msg}</div>}

      <section className="ds-card p-4 space-y-3">
        <div className="font-semibold" style={{ color: "var(--ink)" }}>ปรับแต้มด้วยมือ</div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="พนักงาน">
            <Input list="points-staff" value={adj.staff} onChange={(e) => setAdj({ ...adj, staff: e.target.value })} placeholder="อีเมล" />
            <datalist id="points-staff">{overview.board.map((b) => <option key={b.email} value={b.email}>{shortName(b.email, b.name)}</option>)}</datalist>
          </Field>
          <Field label="แต้ม (+/−)"><Input type="number" step="0.25" value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} /></Field>
          <Field label="ปรับของเดือน (ไม่บังคับ)"><Input type="month" value={adj.adjusts} onChange={(e) => setAdj({ ...adj, adjusts: e.target.value })} /></Field>
          <Field label="เหตุผล (ทุกคนเห็น)"><Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></Field>
        </div>
        <Button size="sm" variant="primary" loading={busy === "adj"} disabled={closed && period !== overview.current_period}
          onClick={() => run("adj", async () => {
            await callPoints({ action: "adjust", staff_email: adj.staff, points: Number(adj.points), reason: adj.reason, adjusts_period: adj.adjusts || null });
            setAdj({ staff: "", points: "", reason: "", adjusts: "" }); setMsg("บันทึกการปรับแต้มแล้ว (ลงในเดือนปัจจุบัน)"); onChanged?.();
          })}>บันทึกการปรับแต้ม</Button>
        <div className="text-xs" style={{ color: "var(--ink-3)" }}>การปรับทุกครั้งลงในเดือนปัจจุบันเสมอ ถ้าเป็นการแก้ของเดือนที่ปิดไปแล้ว ให้ระบุ "ปรับของเดือน"</div>
      </section>

      <section className="ds-card p-4 space-y-3">
        <div className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--ink)" }}><Database size={14} /> ย้อนบันทึกแต้มจากระบบเดิม — {periodLabel(period)}</div>
        <div className="text-xs" style={{ color: "var(--ink-3)" }}>ดึงประวัติการตอบแชทและการให้สิทธิ์ TV ของเดือนนี้มาคิดด้วยกติกาปัจจุบัน · กดซ้ำได้ ไม่นับซ้ำ · รายการที่ไม่รู้ว่าใครตอบจะไม่ได้แต้ม (แสดงให้ดูด้านล่าง)</div>
        <Button size="sm" variant="secondary" loading={busy === "bf"} disabled={closed}
          onClick={() => run("bf", async () => { const d = await callPoints({ action: "backfill", period }); setBackfill(d); onChanged?.(); })}>ย้อนบันทึกเดือนนี้</Button>
        {backfill && (
          <div className="text-xs space-y-1">
            <div>รอบตอบแชท {backfill.unique_replies} รอบ (จาก {backfill.reply_rows} แถว) · เพิ่มใหม่ <b>{backfill.inserted}</b> · มีอยู่แล้ว {backfill.already_recorded} · ข้ามเพจนอกกระดาน {backfill.skipped_pages} · บัญชีเทส {backfill.skipped_excluded} · 0 แต้ม {backfill.zero_points}</div>
            {backfill.unattributed_count > 0 && (
              <details><summary className="cursor-pointer" style={{ color: "var(--warn)" }}>ไม่รู้ว่าใครตอบ {backfill.unattributed_count} รอบ (ตอบจากกล่องข้อความของเพจโดยตรง)</summary>
                <div className="mt-1 max-h-48 overflow-auto">{backfill.unattributed.map((u, i) => <div key={i}>{fmtDT(u.replied_at)} · {u.customer_name || u.conversation_id} · {fmtPts(u.points)} แต้ม</div>)}</div>
              </details>
            )}
            {backfill.tv_unattributed_count > 0 && (
              <details><summary className="cursor-pointer" style={{ color: "var(--warn)" }}>TV ที่ระบุคนให้สิทธิ์ไม่ได้ {backfill.tv_unattributed_count} รายการ</summary>
                <div className="mt-1 max-h-48 overflow-auto">{backfill.tv_unattributed.map((u, i) => <div key={i}>{fmtDT(u.at)} · {KIND_LABEL[u.kind]} · {u.username} · โดย "{u.by || "-"}"</div>)}</div>
              </details>
            )}
          </div>
        )}
      </section>

      <section className="ds-card p-4 space-y-3">
        <div className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--ink)" }}><Lock size={14} /> ปิดยอด {periodLabel(period)}</div>
        {closed ? (
          <div className="text-xs">ปิดยอดแล้วเมื่อ {fmtDT(overview.closed_at)} โดย {overview.closed_by}{overview.close_note ? ` · ${overview.close_note}` : ""}</div>
        ) : !isPast ? (
          <div className="text-xs" style={{ color: "var(--ink-3)" }}>ปิดได้หลังจบเดือน และพ้นช่วงยื่นโต้แย้ง {overview.rules.dispute_days} วัน (ตั้งแต่ {fmtDT(overview.close_allowed_at)})</div>
        ) : (
          <>
            <div className="text-xs" style={{ color: "var(--ink-3)" }}>
              ปิดแล้วแต้มของเดือนนี้จะล็อก แก้ไม่ได้อีก ระบบเก็บลายนิ้วมือ (hash) ของรายการทั้งหมดไว้ตรวจย้อนหลัง
              {overview.open_disputes > 0 && <span style={{ color: "var(--warn)" }}> · ยังมีคำร้องค้าง {overview.open_disputes} รายการ</span>}
              {!closeReady && <span style={{ color: "var(--warn)" }}> · ยังอยู่ในช่วงยื่นโต้แย้งถึง {fmtDT(overview.close_allowed_at)}</span>}
            </div>
            <Button size="sm" variant="danger" icon={Lock} onClick={() => { setCloseNote(""); setCloseConfirm(true); }}>ปิดยอดเดือนนี้</Button>
          </>
        )}
      </section>

      <Dialog open={closeConfirm} onClose={() => setCloseConfirm(false)} title={`ยืนยันปิดยอด ${periodLabel(period)}`}
        description={`รวม ${fmtPts(overview.total)} แต้ม จาก ${overview.events} รายการ · ${overview.board.length} คน — ปิดแล้วเปิดกลับไม่ได้`}
        footer={<><Button variant="ghost" onClick={() => setCloseConfirm(false)}>ยกเลิก</Button>
          <Button variant="danger" loading={busy === "close"} onClick={() => run("close", async () => {
            const force = !closeReady || overview.open_disputes > 0;
            await callPoints({ action: "close_period", period, force, note: closeNote });
            setCloseConfirm(false); setMsg(`ปิดยอด ${periodLabel(period)} แล้ว`); onChanged?.();
          })}>ปิดยอด</Button></>}>
        <div className="space-y-2 text-xs">
          <div className="max-h-56 overflow-auto">
            {overview.board.map((b, i) => <div key={b.email} className="flex justify-between py-1" style={{ borderTop: "1px solid var(--line)" }}><span>{i + 1}. {shortName(b.email, b.name)}</span><b className="tabular-nums">{fmtPts(b.points)}</b></div>)}
          </div>
          {(!closeReady || overview.open_disputes > 0) && (
            <Field label="ปิดก่อนกำหนด/มีคำร้องค้าง — ต้องใส่เหตุผล"><Input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} /></Field>
          )}
          {err && <div style={{ color: "var(--bad)" }}>{err}</div>}
        </div>
      </Dialog>
    </div>
  );
}

export function LedgerSeal({ overview }) {
  if (overview.status !== "closed") return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: overview.hash_ok === false ? "var(--bad)" : "var(--ok)" }}>
      <ShieldCheck size={14} />
      {overview.hash_ok === false ? "รายการแต้มไม่ตรงกับตอนปิดยอด — แจ้ง owner ทันที" : "ปิดยอดแล้ว · ตรวจลายนิ้วมือรายการตรงกับตอนปิดยอด"}
      <code className="text-2xs" style={{ color: "var(--ink-3)" }}>{String(overview.snapshot_hash || "").slice(0, 16)}…</code>
    </div>
  );
}
