"use client";

// ปฏิทินวันหยุด — ทุกคนดูได้ owner คลิกวันเพื่อเพิ่ม/แก้ชื่อ/ยกเลิกวันหยุด
// วันหยุดมีผลกับแต้ม (ตอบวันหยุดได้แต้มตารางวันหยุด) — ตั้ง/ยกเลิกย้อนหลัง ระบบคิดแต้มของวันนั้นใหม่ให้เอง
// เก็บใน settings.office_hours.holidays (+ holiday_names) ผ่าน edge function points

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, CalendarPlus, Loader2 } from "lucide-react";
import { Button, Dialog, Field, Input, Badge } from "@/components/ui";
import { callPoints, fmtPts } from "@/components/features/leaderboard/PointsPanels";

const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const pad = (n) => String(n).padStart(2, "0");

// วันหยุดราชการที่ "วันที่ตายตัว" ทุกปี — วันพระ (มาฆะ/วิสาขะ/อาสาฬหะ/เข้าพรรษา) และวันหยุดชดเชย
// เปลี่ยนทุกปีตามประกาศ จึงไม่เดาให้ ต้องลงเองในปฏิทิน
const FIXED_TH = [
  ["01-01", "วันขึ้นปีใหม่"], ["04-06", "วันจักรี"], ["04-13", "วันสงกรานต์"], ["04-14", "วันสงกรานต์"], ["04-15", "วันสงกรานต์"],
  ["05-01", "วันแรงงานแห่งชาติ"], ["05-04", "วันฉัตรมงคล"], ["06-03", "วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี"],
  ["07-28", "วันเฉลิมพระชนมพรรษา ร.10"], ["08-12", "วันแม่แห่งชาติ"], ["10-13", "วันนวมินทรมหาราช"],
  ["10-23", "วันปิยมหาราช"], ["12-05", "วันพ่อแห่งชาติ"], ["12-10", "วันรัฐธรรมนูญ"], ["12-31", "วันสิ้นปี"],
];

function regradeText(r) {
  if (!r || !r.events) return "";
  const parts = [`ตรวจคำตอบในวันนั้น ${r.events} รอบ`];
  parts.push(r.adjusted ? `ปรับแต้ม ${r.adjusted} รายการ รวม ${r.points > 0 ? "+" : ""}${fmtPts(r.points)} แต้ม` : "แต้มไม่เปลี่ยน");
  if (r.skipped_closed) parts.push(`${r.skipped_closed} รอบอยู่ในเดือนที่ปิดยอดแล้ว ไม่เปลี่ยน`);
  return parts.join(" · ");
}

export default function HolidayCalendar({ isOwner, onChanged }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [ym, setYm] = useState(null);           // { y, m } เดือนที่กำลังดู (m เริ่ม 0)
  const [edit, setEdit] = useState(null);       // { date, name, isHoliday }
  const [busy, setBusy] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);

  const load = async () => {
    setErr("");
    try {
      const d = await callPoints({ action: "holidays_get" });
      setInfo(d);
      setYm((cur) => cur || { y: Number(d.today.slice(0, 4)), m: Number(d.today.slice(5, 7)) - 1 });
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const byDate = useMemo(() => new Map((info?.holidays || []).map((h) => [h.date, h.name])), [info]);
  const closed = useMemo(() => new Set(info?.closed_periods || []), [info]);

  const save = async (changes, label) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const d = await callPoints({ action: "holidays_update", changes });
      setInfo((cur) => ({ ...cur, holidays: d.holidays }));
      const rg = regradeText(d.regrade);
      setMsg(`${label}${rg ? ` — ${rg}` : ""}`);
      if (d.regrade?.adjusted) onChanged?.();
      setEdit(null); setFillOpen(false);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (!info || !ym) return err
    ? <div className="text-xs" style={{ color: "var(--bad)" }}>{err}</div>
    : <div className="py-8 flex justify-center"><Loader2 className="animate-spin" style={{ color: "var(--ink-3)" }} /></div>;

  const startWd = new Date(Date.UTC(ym.y, ym.m, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells = [...Array(startWd).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const ymKey = `${ym.y}-${pad(ym.m + 1)}`;
  const monthClosed = closed.has(ymKey);
  const shift = (k) => setYm(({ y, m }) => { const t = m + k; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; });
  const yearList = (info.holidays || []).filter((h) => h.date.startsWith(`${ym.y}-`));
  const monthCount = (info.holidays || []).filter((h) => h.date.startsWith(ymKey)).length;
  const fixedForYear = FIXED_TH.map(([md, name]) => ({ date: `${ym.y}-${md}`, name })).filter((h) => !byDate.has(h.date));

  return (
    <div className="space-y-4 text-[13px]" style={{ color: "var(--ink-2)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs" style={{ color: "var(--ink-3)" }}>
          หยุดประจำสัปดาห์: {WD.filter((_, i) => !info.days.includes(i)).join(" ") || "—"} · เวลาทำการ {info.open}–{info.close}
          {isOwner ? " · คลิกวันที่เพื่อตั้ง/แก้/ยกเลิกวันหยุด" : " · owner เป็นคนตั้งวันหยุด"}
        </div>
        {isOwner && (
          <Button size="sm" variant="secondary" icon={CalendarPlus} className="ml-auto" disabled={!fixedForYear.length} onClick={() => setFillOpen(true)}>
            เติมวันหยุดราชการ {ym.y + 543}
          </Button>
        )}
      </div>
      {err && <div className="text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
      {msg && <div className="rounded-control p-2 text-xs" style={{ color: "var(--ok)", background: "var(--ground)" }}>{msg}</div>}

      <div className="ds-card p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => shift(-1)}>ก่อนหน้า</Button>
          <div className="text-center">
            <div className="text-base font-bold" style={{ color: "var(--ink)" }}>{TH_MONTHS[ym.m]} {ym.y + 543}</div>
            <div className="text-2xs" style={{ color: "var(--ink-3)" }}>
              วันหยุดพิเศษ {monthCount} วัน{monthClosed && <> · <Lock size={10} className="inline" /> ปิดยอดแล้ว</>}
            </div>
          </div>
          <Button size="sm" variant="ghost" iconRight={ChevronRight} onClick={() => shift(1)}>ถัดไป</Button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {WD.map((w, i) => (
            <div key={w} className="py-1 text-center text-2xs font-semibold" style={{ color: info.days.includes(i) ? "var(--ink-3)" : "var(--bad)" }}>{w}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} />;
            const date = `${ymKey}-${pad(d)}`;
            const wd = (startWd + d - 1) % 7;
            const weekly = !info.days.includes(wd);
            const name = byDate.get(date);
            const isHoliday = byDate.has(date);
            const isToday = date === info.today;
            const bg = isHoliday ? "rgb(var(--n-bad) / .13)" : weekly ? "var(--ground)" : "transparent";
            return (
              <button key={date} type="button" disabled={!isOwner}
                onClick={() => setEdit({ date, name: name || "", isHoliday })}
                title={isHoliday ? (name || "วันหยุดพิเศษ") : weekly ? "หยุดประจำสัปดาห์" : ""}
                className="flex min-h-[54px] flex-col items-start rounded-control p-1.5 text-left sm:min-h-[78px] disabled:cursor-default"
                style={{ background: bg, border: `1px solid ${isToday ? "var(--brand)" : isHoliday ? "rgb(var(--n-bad) / .35)" : "var(--line)"}`, cursor: isOwner ? "pointer" : "default" }}>
                <span className="text-xs font-semibold tabular-nums" style={{ color: isHoliday || weekly ? "var(--bad)" : "var(--ink)" }}>{d}</span>
                {isHoliday && <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight sm:text-[11px]" style={{ color: "var(--bad)" }}>{name || "วันหยุด"}</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-2xs" style={{ color: "var(--ink-3)" }}>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "rgb(var(--n-bad) / .13)", border: "1px solid rgb(var(--n-bad) / .35)" }} /> วันหยุดพิเศษ (ได้แต้มตารางวันหยุด)</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--ground)", border: "1px solid var(--line)" }} /> หยุดประจำสัปดาห์</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ border: "1px solid var(--brand)" }} /> วันนี้</span>
        </div>
      </div>

      <div>
        <div className="mb-1 font-semibold" style={{ color: "var(--ink)" }}>วันหยุดพิเศษปี {ym.y + 543} ({yearList.length} วัน)</div>
        {yearList.length === 0 && <div className="text-xs" style={{ color: "var(--ink-3)" }}>ยังไม่ได้ตั้งวันหยุดของปีนี้</div>}
        {yearList.map((h) => (
          <button key={h.date} type="button" disabled={!isOwner} onClick={() => setEdit({ date: h.date, name: h.name, isHoliday: true })}
            className="flex w-full items-center gap-3 py-1.5 text-left text-xs" style={{ borderTop: "1px solid var(--line)", cursor: isOwner ? "pointer" : "default" }}>
            <span className="w-32 shrink-0 tabular-nums" style={{ color: "var(--ink)" }}>
              {new Date(`${h.date}T00:00:00+07:00`).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", weekday: "short", day: "numeric", month: "short" })}
            </span>
            <span>{h.name || "วันหยุด (ไม่ได้ตั้งชื่อ)"}</span>
            {closed.has(h.date.slice(0, 7)) && <Badge tone="slate">ปิดยอดแล้ว</Badge>}
          </button>
        ))}
      </div>

      <HolidayDialog edit={edit} busy={busy} today={info.today} closed={closed}
        onClose={() => setEdit(null)}
        onSave={(name) => save([{ date: edit.date, name, on: true }], edit.isHoliday ? "บันทึกชื่อวันหยุดแล้ว" : `ตั้ง ${edit.date} เป็นวันหยุดแล้ว`)}
        onRemove={() => save([{ date: edit.date, on: false }], `ยกเลิกวันหยุด ${edit.date} แล้ว`)} />

      <Dialog open={fillOpen} onClose={() => setFillOpen(false)} title={`เติมวันหยุดราชการปี ${ym.y + 543}`}
        description="เฉพาะวันหยุดที่วันที่ตายตัวทุกปี — วันพระ (มาฆบูชา วิสาขบูชา อาสาฬหบูชา เข้าพรรษา) และวันหยุดชดเชยต้องคลิกลงเองในปฏิทิน"
        footer={<><Button variant="ghost" onClick={() => setFillOpen(false)}>ยกเลิก</Button>
          <Button variant="primary" loading={busy} onClick={() => save(fixedForYear.map((h) => ({ ...h, on: true })), `เพิ่มวันหยุดราชการ ${fixedForYear.length} วันแล้ว`)}>เพิ่ม {fixedForYear.length} วัน</Button></>}>
        <div className="max-h-72 overflow-auto text-xs">
          {fixedForYear.map((h) => <div key={h.date} className="flex gap-3 py-1" style={{ borderTop: "1px solid var(--line)" }}><span className="w-24 tabular-nums">{h.date}</span><span>{h.name}</span></div>)}
          <div className="mt-2" style={{ color: "var(--ink-3)" }}>ลบวันที่บริษัทไม่ได้หยุดออกทีหลังได้ (คลิกวันนั้นในปฏิทิน)</div>
        </div>
      </Dialog>
    </div>
  );
}

function HolidayDialog({ edit, busy, today, closed, onClose, onSave, onRemove }) {
  const [name, setName] = useState("");
  useEffect(() => { setName(edit?.name || ""); }, [edit]);
  if (!edit) return null;
  const past = edit.date <= today;
  const isClosed = closed.has(edit.date.slice(0, 7));
  const label = new Date(`${edit.date}T00:00:00+07:00`).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <Dialog open onClose={onClose} title={edit.isHoliday ? "แก้ไขวันหยุด" : "ตั้งเป็นวันหยุด"} description={label}
      footer={<>
        {edit.isHoliday && <Button variant="danger" loading={busy} onClick={onRemove} className="mr-auto">ยกเลิกวันหยุดนี้</Button>}
        <Button variant="ghost" onClick={onClose}>ปิด</Button>
        <Button variant="primary" loading={busy} onClick={() => onSave(name)}>{edit.isHoliday ? "บันทึกชื่อ" : "ตั้งเป็นวันหยุด"}</Button>
      </>}>
      <div className="space-y-3 text-xs">
        <Field label="ชื่อวันหยุด" hint="เช่น วันมาฆบูชา · หยุดชดเชยวันแม่ · บริษัทพาเที่ยว">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อวันหยุด" autoFocus />
        </Field>
        {past && !isClosed && (
          <div className="rounded-control p-2" style={{ background: "var(--ground)", color: "var(--ink-2)" }}>
            วันนี้ผ่านมาแล้ว — ระบบจะ{edit.isHoliday ? "คิดแต้มของวันนี้ใหม่ถ้ายกเลิกวันหยุด" : "คิดแต้มของวันนี้ใหม่ด้วยตารางวันหยุด"} และบันทึกเป็นรายการปรับแต้มที่ทุกคนตรวจได้
          </div>
        )}
        {isClosed && (
          <div className="rounded-control p-2" style={{ background: "var(--ground)", color: "var(--warn)" }}>
            เดือนนี้ปิดยอดแล้ว — เปลี่ยนวันหยุดได้ แต่แต้มของเดือนนี้จะไม่เปลี่ยน
          </div>
        )}
      </div>
    </Dialog>
  );
}
