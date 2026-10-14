"use client";

// ส่วนประกอบของกระดานแต้มโบนัส — รายการแต้มพร้อมหลักฐาน, คำร้องโต้แย้ง, กติกา, เครื่องมือ owner
// ข้อมูลทั้งหมดมาจาก edge function `points` (สมุด point_events ที่แก้/ลบไม่ได้)

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { Button, Dialog, Field, Input, Textarea, Select, Badge, EmptyState } from "@/components/ui";
import { MessageSquare, Flag, Undo2, Loader2, CheckCircle2, XCircle, ShieldCheck, History, Database, Lock, Clock, Zap, Pencil, Moon, CalendarDays, Briefcase, LineChart } from "lucide-react";

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
  // แต้มที่ได้จริง = แต้มตอนบันทึก + ที่ปรับเข้ารายการนี้ภายหลัง (คืนแต้มเพดาน / คิดใหม่เพราะเปลี่ยนวันหยุด)
  const effective = Number(ev.points) + Number(ev.extra_points || 0);
  const regrades = (ev.adjustments || []).filter((a) => !ev.refunded_by || a.id !== ev.refunded_by);
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
        {regrades.map((a) => (
          <div key={a.id} style={{ color: a.points > 0 ? "var(--ok)" : "var(--bad)" }}>
            {a.reason} ({a.points > 0 ? "+" : ""}{fmtPts(a.points)} · รายการ #{a.id})
          </div>
        ))}
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
  const shown = useMemo(() => (events || []).filter((e) => !e.evidence?.refund_of && !e.evidence?.regrade_of && (!kind || e.kind === kind)), [events, kind]);
  // รายการปรับที่ผูกกับรายการเดิมแต่อยู่ในเดือนนี้ ถูกรวมไว้ใน extra_points ของรายการเดิมแล้ว
  const sum = shown.reduce((s, e) => s + Number(e.points || 0) + Number(e.extra_points || 0), 0);

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
const RULE_DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function RuleCard({ icon: Icon, title, sub, children }) {
  return (
    <div className="ds-card p-4 flex flex-col">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-control" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}><Icon size={16} /></span>
        <div className="min-w-0">
          <div className="font-semibold leading-tight" style={{ color: "var(--ink)" }}>{title}</div>
          {sub && <div className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ตารางแต้มนอกเวลา — เรียงตามเวลาในวัน แถบสีบอกว่าช่วงไหนแต้มสูง
function OffTableView({ rows, breakSlot, max }) {
  const sorted = [...rows].sort((a, b) => a[0] - b[0]);
  return (
    <div className="text-[12.5px] tabular-nums">
      <div className="grid grid-cols-[1fr_64px_56px] gap-2 px-2 pb-1.5 text-2xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
        <span>ช่วงเวลา</span><span className="text-right">ตอบทัน</span><span className="text-right">ตอบช้า</span>
      </div>
      {sorted.map((r) => (
        <div key={r.join()} className="grid grid-cols-[1fr_64px_56px] items-center gap-2 rounded-control px-2 py-2" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="flex min-w-0 items-center gap-2">
            <span style={{ color: "var(--ink)" }}>{slotLabel(r)}</span>
            {breakSlot && r[0] === breakSlot[0] && r[1] === breakSlot[1] && <Badge tone="slate">พักเที่ยง</Badge>}
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="hidden h-1.5 w-8 overflow-hidden rounded-full sm:block" style={{ background: "var(--line)" }}>
              <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (r[2] / max) * 100)}%`, background: "var(--brand)" }} />
            </span>
            <b className="text-[14px]" style={{ color: "var(--ink)" }}>{r[2]}</b>
          </div>
          <span className="text-right" style={{ color: "var(--ink-3)" }}>{r[3]}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ value, label, unit = "แต้ม" }) {
  return (
    <div className="rounded-control px-3 py-2.5" style={{ background: "var(--ground)" }}>
      <div className="text-xs" style={{ color: "var(--ink-3)" }}>{label}</div>
      <div className="mt-0.5 tabular-nums"><b className="text-xl" style={{ color: "var(--ink)" }}>{value}</b> <span className="text-xs" style={{ color: "var(--ink-3)" }}>{unit}</span></div>
    </div>
  );
}

export function RulesPanel({ rules, isOwner, onChanged }) {
  const [history, setHistory] = useState(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { callPoints({ action: "rules_history" }).then((d) => setHistory(d.versions)).catch(() => setHistory([])); }, [rules?.version]);
  if (!rules) return null;
  const oh = rules.office_hours || {};
  const toH = (t) => (t ? Number(String(t).split(":")[0]) : null);
  const breakSlot = oh.break_start && oh.break_end ? [toH(oh.break_start), toH(oh.break_end)] : null;
  const max = Math.max(1, ...rules.off_table.workday.map((r) => r[2]), ...rules.off_table.holiday.map((r) => r[2]));
  const cap = (n) => (n ? `${n} ครั้ง` : "ไม่จำกัด");
  return (
    <div className="space-y-4 text-[13px]" style={{ color: "var(--ink-2)" }}>
      <div className="ds-card flex flex-wrap items-center gap-x-5 gap-y-2 p-4">
        <Badge tone="brand">กติกาเวอร์ชัน {rules.version}</Badge>
        <span className="flex items-center gap-1.5"><Clock size={14} style={{ color: "var(--ink-3)" }} />
          เวลาทำการ <b style={{ color: "var(--ink)" }}>{oh.days?.map((d) => RULE_DAYS[d]).join(" ")} {oh.open}–{oh.close}</b>
          {breakSlot && <span style={{ color: "var(--ink-3)" }}>(พัก {oh.break_start}–{oh.break_end})</span>}
        </span>
        <span className="flex items-center gap-1.5"><Zap size={14} style={{ color: "var(--ink-3)" }} />
          ตอบทัน = ตอบภายใน <b style={{ color: "var(--ink)" }}>{rules.slow_min} นาที</b>
        </span>
        {isOwner && <Button size="sm" variant="secondary" icon={Pencil} className="ml-auto" onClick={() => setEditing(true)}>แก้กติกา</Button>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RuleCard icon={Moon} title="นอกเวลาทำการ · วันทำงาน" sub="แต้มต่อการตอบ 1 รอบ">
          <OffTableView rows={rules.off_table.workday} breakSlot={breakSlot} max={max} />
        </RuleCard>
        <RuleCard icon={CalendarDays} title="วันหยุด" sub="เสาร์-อาทิตย์ และวันหยุดในปฏิทิน">
          <OffTableView rows={rules.off_table.holiday} max={max} />
        </RuleCard>
        <RuleCard icon={Briefcase} title="ในเวลาทำการ" sub="ช่วงที่ไม่อยู่ในตารางนอกเวลา">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="ตอบทัน" value={rules.office[0]} />
            <Stat label="ตอบช้า" value={rules.office[1]} />
          </div>
          <div className="mt-3 text-xs" style={{ color: "var(--ink-3)" }}>
            เพดานต่อห้องแชทต่อวัน · ในเวลา <b style={{ color: "var(--ink-2)" }}>{cap(rules.caps.office_per_conv_day)}</b> · นอกเวลา <b style={{ color: "var(--ink-2)" }}>{cap(rules.caps.off_per_conv_day)}</b>
          </div>
        </RuleCard>
        <RuleCard icon={LineChart} title="TradingView" sub="แต้มต่อ 1 สคริปต์">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="ให้สิทธิ์ใหม่" value={rules.tv.grant} />
            <Stat label="ต่ออายุ" value={rules.tv.renew} />
          </div>
          <div className="mt-3 text-xs" style={{ color: "var(--ink-3)" }}>
            ถอนสิทธิ์ภายใน <b style={{ color: "var(--ink-2)" }}>{rules.tv.revoke_void_days} วัน</b> = หักแต้มคืน · ยื่นโต้แย้งได้ <b style={{ color: "var(--ink-2)" }}>{rules.dispute_days} วัน</b>หลังสิ้นเดือน
          </div>
        </RuleCard>
      </div>

      <div className="ds-card p-4">
        <div className="mb-3 flex items-center gap-1.5 font-semibold" style={{ color: "var(--ink)" }}><History size={15} /> ประวัติการเปลี่ยนกติกา</div>
        {!history && <Loader2 size={16} className="animate-spin" style={{ color: "var(--ink-3)" }} />}
        <ol className="space-y-0">
          {(history || []).map((v, i) => (
            <li key={v.version} className="relative flex gap-3 pb-3 last:pb-0">
              {i < history.length - 1 && <span className="absolute left-[15px] top-7 bottom-0 w-px" style={{ background: "var(--line)" }} />}
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-2xs font-semibold"
                style={i === 0 ? { background: "var(--brand-soft)", color: "var(--brand)" } : { background: "var(--ground)", color: "var(--ink-3)", border: "1px solid var(--line)" }}>v{v.version}</span>
              <div className="min-w-0 pt-1">
                <div className="text-xs" style={{ color: "var(--ink-3)" }}>{fmtDT(v.created_at)} · {v.created_by}{i === 0 && <span style={{ color: "var(--brand)" }}> · ใช้อยู่</span>}</div>
                <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-2)" }}>{v.note}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <RulesEditor open={editing} rules={rules} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChanged?.(); }} />
    </div>
  );
}

// ฟอร์มแก้กติกา — เขียนให้คนที่ไม่ได้ตั้งกติกาเองอ่านแล้วแก้ถูก: ทุกช่องมีหน่วย มีค่าเดิมให้เทียบ และสรุปสิ่งที่จะเปลี่ยนก่อนบันทึก
const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hh = (h) => `${String(h).padStart(2, "0")}:00`;
const slotLabel = (r) => `${hh(r[0])}–${hh(r[1])}`;

function RuleSection({ n, title, hint, children }) {
  return (
    <section className="ds-card p-3.5 space-y-2.5">
      <div>
        <div className="font-semibold" style={{ color: "var(--ink)" }}><span style={{ color: "var(--ink-3)" }}>{n}.</span> {title}</div>
        {hint && <div className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>{hint}</div>}
      </div>
      {children}
    </section>
  );
}

// ช่องตัวเลขพร้อมหน่วย + ค่าเดิม (โชว์เมื่อถูกแก้)
function NumField({ label, value, before, onChange, unit, step = "0.25", help }) {
  const changed = before !== undefined && Number(value) !== Number(before);
  return (
    <label className="block">
      {label && <span className="text-[12.5px] font-medium" style={{ color: "var(--ink-2)" }}>{label}</span>}
      <div className={`${label ? "mt-1" : ""} flex items-center gap-1.5`}>
        <Input type="number" step={step} min="0" value={value} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="!py-1.5 tabular-nums" style={changed ? { borderColor: "var(--warn)", background: "var(--ground)" } : undefined} />
        {unit && <span className="shrink-0 text-xs" style={{ color: "var(--ink-3)" }}>{unit}</span>}
      </div>
      {changed ? <span className="mt-0.5 block text-2xs" style={{ color: "var(--warn)" }}>เดิม {before}{unit ? ` ${unit}` : ""}</span>
        : help && <span className="mt-0.5 block text-2xs" style={{ color: "var(--ink-3)" }}>{help}</span>}
    </label>
  );
}

function HourSelect({ value, onChange, min = 0 }) {
  return (
    <Select value={value} onChange={(e) => onChange(Number(e.target.value))} className="!py-1.5 tabular-nums">
      {HOURS.filter((h) => h >= min).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
    </Select>
  );
}

function OffTableEditor({ rows, before, slowMin, onChange }) {
  const setCell = (i, j, v) => onChange(rows.map((r, k) => (k === i ? r.map((x, m) => (m === j ? v : x)) : r)));
  const remove = (i) => onChange(rows.filter((_, k) => k !== i));
  const add = () => onChange([...rows, [0, 1, 0, 0]]);
  return (
    <div className="space-y-1.5">
      <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_1fr_28px] gap-2 px-0.5 text-2xs font-medium" style={{ color: "var(--ink-3)" }}>
        <span>ตั้งแต่</span><span>ถึง</span><span>ตอบทัน (≤ {slowMin} นาที)</span><span>ตอบช้า</span><span />
      </div>
      {rows.map((r, i) => {
        const old = before?.find((b) => b[0] === r[0] && b[1] === r[1]);
        const bad = !(r[0] < r[1]);
        return (
          <div key={i}>
            <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_28px] gap-2 items-start">
              <HourSelect value={r[0]} onChange={(v) => setCell(i, 0, v)} />
              <HourSelect value={r[1]} onChange={(v) => setCell(i, 1, v)} min={1} />
              <NumField value={r[2]} before={old ? old[2] : undefined} onChange={(v) => setCell(i, 2, v)} unit="แต้ม" />
              <NumField value={r[3]} before={old ? old[3] : undefined} onChange={(v) => setCell(i, 3, v)} unit="แต้ม" />
              <button type="button" onClick={() => remove(i)} title="ลบช่วงนี้" className="mt-1.5 h-7 w-7 rounded-control text-sm hover:bg-black/5" style={{ color: "var(--ink-3)" }}>×</button>
            </div>
            {bad && <div className="mt-0.5 text-2xs" style={{ color: "var(--bad)" }}>เวลา "ถึง" ต้องหลัง "ตั้งแต่" (ช่วงข้ามเที่ยงคืนให้แยกเป็น 2 แถว เช่น 20:00–24:00 และ 00:00–05:00)</div>}
          </div>
        );
      })}
      <button type="button" onClick={add} className="text-xs font-medium" style={{ color: "var(--brand)" }}>+ เพิ่มช่วงเวลา</button>
    </div>
  );
}

// รายการสิ่งที่เปลี่ยน (อ่านเป็นภาษาคน) — ใช้ทั้งสรุปก่อนบันทึก และกันกดบันทึกทั้งที่ไม่ได้แก้อะไร
function diffRules(a, b) {
  const out = [];
  const num = (label, x, y, unit = "แต้ม") => { if (Number(x) !== Number(y)) out.push(`${label}: ${x} → ${y} ${unit}`); };
  for (const [k, name] of [["workday", "นอกเวลา วันทำงาน"], ["holiday", "วันหยุด"]]) {
    const A = a.off_table[k], B = b.off_table[k];
    for (const r of B) {
      const o = A.find((x) => x[0] === r[0] && x[1] === r[1]);
      if (!o) out.push(`${name}: เพิ่มช่วง ${slotLabel(r)} (ทัน ${r[2]} / ช้า ${r[3]} แต้ม)`);
      else { num(`${name} ${slotLabel(r)} ตอบทัน`, o[2], r[2]); num(`${name} ${slotLabel(r)} ตอบช้า`, o[3], r[3]); }
    }
    for (const o of A) if (!B.find((x) => x[0] === o[0] && x[1] === o[1])) out.push(`${name}: เอาช่วง ${slotLabel(o)} ออก`);
  }
  num("ในเวลาทำการ ตอบทัน", a.office[0], b.office[0]);
  num("ในเวลาทำการ ตอบช้า", a.office[1], b.office[1]);
  num("เพดานในเวลา", a.caps.office_per_conv_day, b.caps.office_per_conv_day, "ครั้ง/ห้อง/วัน");
  num("เพดานนอกเวลา", a.caps.off_per_conv_day, b.caps.off_per_conv_day, "ครั้ง/ห้อง/วัน");
  num("TV ให้สิทธิ์ใหม่", a.tv.grant, b.tv.grant);
  num("TV ต่ออายุ", a.tv.renew, b.tv.renew);
  num("ถอนสิทธิ์ TV ภายใน", a.tv.revoke_void_days, b.tv.revoke_void_days, "วัน");
  num("ยื่นโต้แย้งได้", a.dispute_days, b.dispute_days, "วันหลังสิ้นเดือน");
  return out;
}

function RulesEditor({ open, rules, onClose, onDone }) {
  const [orig, setOrig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // โหลดค่าตั้งต้นแค่ตอนเปิดกล่อง — หน้ากระดานรีเฟรชทุก 60 วิ ได้ object rules ใหม่ทุกครั้ง
  // ถ้าผูกกับ rules ด้วย ฟอร์มจะถูกรีเซ็ตทับสิ่งที่กำลังแก้
  useEffect(() => {
    if (!open) return;
    const base = JSON.parse(JSON.stringify({ off_table: rules.off_table, office: rules.office, tv: rules.tv, caps: rules.caps, dispute_days: rules.dispute_days }));
    setOrig(base); setDraft(JSON.parse(JSON.stringify(base)));
    setNote(""); setErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const changes = useMemo(() => (orig && draft ? diffRules(orig, draft) : []), [orig, draft]);
  if (!draft) return null;
  const set = (fn) => setDraft((d) => { const c = JSON.parse(JSON.stringify(d)); fn(c); return c; });
  const slowMin = rules.slow_min ?? rules.office_hours?.slow_min ?? 5;
  const oh = rules.office_hours || {};
  const dayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  const hasEmpty = JSON.stringify(draft).includes('""');
  const hasBadRow = ["workday", "holiday"].some((k) => draft.off_table[k].some((r) => !(r[0] < r[1])));
  const submit = async () => {
    setBusy(true); setErr("");
    try { await callPoints({ action: "rules_set", rules: draft, note }); onDone?.(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const blocked = changes.length === 0 ? "ยังไม่ได้แก้อะไร" : hasEmpty ? "มีช่องที่ยังว่าง" : hasBadRow ? "มีช่วงเวลาที่ไม่ถูกต้อง" : note.trim().length < 3 ? "กรอกเหตุผลที่เปลี่ยนก่อน" : "";
  return (
    <Dialog open={open} onClose={onClose} className="points-dialog" title="แก้กติกาแต้ม"
      description="บันทึกแล้วจะเป็นกติกาเวอร์ชันใหม่ มีผลกับแต้มที่เกิดหลังจากนี้เท่านั้น แต้มที่ได้ไปแล้วไม่เปลี่ยน — ทุกคนเห็นประวัติการแก้"
      footer={<>
        <span className="text-xs" style={{ color: "var(--ink-3)" }}>{blocked}</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={busy} disabled={!!blocked} onClick={submit}>บันทึกเป็นเวอร์ชันใหม่</Button>
        </div>
      </>}>
      <div className="space-y-3 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
        <div className="rounded-control p-3 text-xs leading-relaxed" style={{ background: "var(--ground)" }}>
          <b style={{ color: "var(--ink)" }}>แต้มตอบแชทคิดยังไง</b> — ลูกค้าทักมา 1 รอบ คนที่ตอบได้แต้มตามช่วงเวลา ·
          <b> ตอบทัน</b> = ตอบภายใน {slowMin} นาที, เกินนั้น = <b>ตอบช้า</b> ·
          เวลาทำการคือ {oh.days?.map((d) => dayNames[d]).join(" ") || "-"} {oh.open || "-"}–{oh.close || "-"} นอกนั้นนับเป็น "นอกเวลา" ·
          ถ้าลูกค้าทักกับตอนตอบอยู่คนละช่วง ระบบใช้ช่วงที่ได้แต้มน้อยกว่า ·
          ช่องที่แก้แล้วจะขึ้นกรอบสีส้มพร้อมค่าเดิม
        </div>

        <RuleSection n={1} title="ตอบแชทนอกเวลาทำการ — วันทำงาน" hint={`ช่วงเวลาของวันทำงานที่อยู่นอก ${oh.open || "เวลาเปิด"}–${oh.close || "เวลาปิด"} รวมช่วงพักเที่ยง · ช่วงที่ไม่ได้ใส่ไว้จะนับเป็น "ในเวลาทำการ"`}>
          <OffTableEditor rows={draft.off_table.workday} before={orig.off_table.workday} slowMin={slowMin} onChange={(rows) => set((c) => { c.off_table.workday = rows; })} />
        </RuleSection>

        <RuleSection n={2} title="ตอบแชทวันหยุด — เสาร์-อาทิตย์ / วันหยุดในปฏิทิน" hint="ทั้งวันนับเป็นนอกเวลา ควรใส่ให้ครบ 00:00–24:00">
          <OffTableEditor rows={draft.off_table.holiday} before={orig.off_table.holiday} slowMin={slowMin} onChange={(rows) => set((c) => { c.off_table.holiday = rows; })} />
        </RuleSection>

        <RuleSection n={3} title="ตอบแชทในเวลาทำการ" hint="ใช้กับทุกช่วงของวันทำงานที่ไม่อยู่ในตารางข้อ 1">
          <div className="grid gap-2 sm:grid-cols-2">
            <NumField label={`ตอบทัน (≤ ${slowMin} นาที)`} value={draft.office[0]} before={orig.office[0]} onChange={(n) => set((c) => { c.office[0] = n; })} unit="แต้ม" />
            <NumField label="ตอบช้า" value={draft.office[1]} before={orig.office[1]} onChange={(n) => set((c) => { c.office[1] = n; })} unit="แต้ม" />
          </div>
        </RuleSection>

        <RuleSection n={4} title="เพดานแต้มต่อห้องแชท" hint="ห้องแชทเดียวกันในวันเดียวกัน ได้แต้มสูงสุดกี่ครั้ง — กันการตอบทีละคำเพื่อปั่นแต้ม · ใส่ 0 = ไม่จำกัด">
          <div className="grid gap-2 sm:grid-cols-2">
            <NumField label="ในเวลาทำการ" value={draft.caps.office_per_conv_day} before={orig.caps.office_per_conv_day} onChange={(n) => set((c) => { c.caps.office_per_conv_day = n; })} unit="ครั้ง/ห้อง/วัน" step="1" help="0 = ไม่จำกัด" />
            <NumField label="นอกเวลา / วันหยุด" value={draft.caps.off_per_conv_day} before={orig.caps.off_per_conv_day} onChange={(n) => set((c) => { c.caps.off_per_conv_day = n; })} unit="ครั้ง/ห้อง/วัน" step="1" help="0 = ไม่จำกัด" />
          </div>
        </RuleSection>

        <RuleSection n={5} title="TradingView" hint="แต้มต่อ 1 สคริปต์ที่ให้สิทธิ์ลูกค้า">
          <div className="grid gap-2 sm:grid-cols-3">
            <NumField label="ให้สิทธิ์ครั้งแรก" value={draft.tv.grant} before={orig.tv.grant} onChange={(n) => set((c) => { c.tv.grant = n; })} unit="แต้ม" />
            <NumField label="ต่ออายุ" value={draft.tv.renew} before={orig.tv.renew} onChange={(n) => set((c) => { c.tv.renew = n; })} unit="แต้ม" />
            <NumField label="ถ้าถอนสิทธิ์ภายใน" value={draft.tv.revoke_void_days} before={orig.tv.revoke_void_days} onChange={(n) => set((c) => { c.tv.revoke_void_days = n; })} unit="วัน" step="1" help="จะหักแต้มที่ให้ไปคืน" />
          </div>
        </RuleSection>

        <RuleSection n={6} title="การโต้แย้งแต้ม">
          <div className="sm:w-1/2">
            <NumField label="ยื่นโต้แย้งได้ถึง" value={draft.dispute_days} before={orig.dispute_days} onChange={(n) => set((c) => { c.dispute_days = n; })} unit="วันหลังสิ้นเดือน" step="1" />
          </div>
        </RuleSection>

        <section className="ds-card p-3.5 space-y-2.5">
          <div className="font-semibold" style={{ color: "var(--ink)" }}>สรุปสิ่งที่จะเปลี่ยน</div>
          {changes.length === 0
            ? <div className="text-xs" style={{ color: "var(--ink-3)" }}>ยังไม่ได้แก้อะไร</div>
            : <ul className="list-disc pl-5 text-xs space-y-0.5">{changes.map((c) => <li key={c}>{c}</li>)}</ul>}
          <Field label="เหตุผลที่เปลี่ยน (ทุกคนเห็น · จำเป็น)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เพิ่มแต้มในเวลาเป็น 1 ตั้งแต่ 1 พ.ย." /></Field>
        </section>
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
