"use client";

// ใครเห็นแชทเพจไหน (owner เท่านั้น) — เก็บใน page_lead_config.chat_viewers / chat_read_only / sync_enabled
//   คนที่เห็น = "ทุกคน" (null) หรือ "เฉพาะคนที่เลือก" — ใช้กับทุกบทบาทรวม owner และบังคับจริงด้วย RLS
//   ดูอย่างเดียว = ดึงแชทมาไว้สรุปข้อมูล: ตอบ/ติดป้าย/ส่งสถานะกลับ Meta ไม่ได้ ไม่แจ้งเตือน ไม่นับสถิติ/แต้ม
// token ตอบแชทเห็นเพจของธุรกิจอื่นอีก 20+ เพจ — แสดงเฉพาะเพจที่เปิดดึงแชทหรือตั้งค่าไว้แล้ว ที่เหลือเพิ่มทีละเพจเอง

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { Button, Badge, Toggle, Select } from "@/components/ui";
import { Eye, Lock, Plus, Save } from "lucide-react";

async function call(body) {
  const { data, error } = await supabase.functions.invoke("manage-permissions", { body });
  if (error || !data?.ok) throw new Error(data?.error || (await readFunctionErrorMessage(error)) || "ทำรายการไม่สำเร็จ");
  return data;
}

function PageCard({ page, users, onSaved }) {
  const [sync, setSync] = useState(!!page.sync_enabled);
  const [readOnly, setReadOnly] = useState(!!page.chat_read_only);
  const [limited, setLimited] = useState(Array.isArray(page.chat_viewers));
  const [viewers, setViewers] = useState(new Set((page.chat_viewers || []).map((v) => v.toLowerCase())));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const dirty = sync !== !!page.sync_enabled || readOnly !== !!page.chat_read_only || limited !== Array.isArray(page.chat_viewers)
    || (limited && [...viewers].sort().join() !== (page.chat_viewers || []).map((v) => v.toLowerCase()).sort().join());

  const save = async () => {
    if (limited && viewers.size === 0 && !confirm("ไม่ได้เลือกใครเลย = ไม่มีใครเห็นแชทเพจนี้ ยืนยัน?")) return;
    setBusy(true); setMsg(null);
    try {
      const d = await call({ action: "set_page_access", page_id: page.page_id, sync_enabled: sync, read_only: readOnly, viewers: limited ? [...viewers] : null });
      onSaved(d.page);
      setMsg({ ok: true, text: "บันทึกแล้ว — คนที่เกี่ยวข้องต้องรีเฟรชหน้าแชทหนึ่งครั้ง" });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  };

  return (
    <div className="ds-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold" style={{ color: "var(--ink)" }}>{page.page_name || page.page_id}</div>
        <span className="text-2xs font-mono" style={{ color: "var(--ink-3)" }}>{page.page_id}</span>
        {limited && <Badge tone="gold"><Lock size={11} /> เห็นเฉพาะ {viewers.size} คน</Badge>}
        {readOnly && <Badge tone="slate"><Eye size={11} /> ดูอย่างเดียว</Badge>}
        {!sync && <Badge tone="slate">ไม่ได้ดึงแชท</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2.5 text-[12.5px]">
          <Toggle checked={sync} onChange={setSync} label="ดึงแชท" />
          <span className="text-2xs pt-0.5" style={{ color: "var(--ink-3)" }}>ดึงแชทเพจนี้เข้าระบบ (รวม webhook)</span>
        </label>
        <label className="flex items-start gap-2.5 text-[12.5px]">
          <Toggle checked={readOnly} onChange={setReadOnly} label="ดูอย่างเดียว" />
          <span className="text-2xs pt-0.5" style={{ color: "var(--ink-3)" }}>ไว้สรุปข้อมูล: ตอบ/ติดป้ายไม่ได้ ไม่แจ้งเตือน ไม่นับแต้ม</span>
        </label>
      </div>
      <div>
        <div className="mb-1.5 text-[12.5px] font-medium" style={{ color: "var(--ink-2)" }}>คนที่เห็นแชทเพจนี้</div>
        <div className="flex gap-1.5">
          {[[false, "ทุกคนที่มีสิทธิ์แชท"], [true, "เฉพาะคนที่เลือก"]].map(([v, l]) => (
            <button key={l} type="button" onClick={() => setLimited(v)}
              className="rounded-full border px-3 py-1.5 text-xs font-medium"
              style={limited === v ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" } : { borderColor: "var(--line)", color: "var(--ink-2)" }}>{l}</button>
          ))}
        </div>
        {limited && (
          <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {users.map((u) => {
              const on = viewers.has(u.email);
              return (
                <label key={u.email} className="flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-[12.5px] cursor-pointer"
                  style={{ borderColor: on ? "var(--brand)" : "var(--line)", background: on ? "var(--brand-soft)" : "transparent" }}>
                  <input type="checkbox" checked={on} onChange={() => setViewers((cur) => { const n = new Set(cur); if (on) n.delete(u.email); else n.add(u.email); return n; })} />
                  <span className="min-w-0 truncate" style={{ color: "var(--ink)" }}>{u.nickname || u.email.split("@")[0]}</span>
                  <span className="ml-auto text-2xs" style={{ color: "var(--ink-3)" }}>{u.role}</span>
                </label>
              );
            })}
          </div>
        )}
        {limited && <div className="mt-1.5 text-2xs" style={{ color: "var(--ink-3)" }}>ใช้กับทุกบทบาท รวม owner — คนที่ไม่ได้เลือกจะไม่เห็นแชท/รีพอร์ตของเพจนี้เลย</div>}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>บันทึก</Button>
        {msg && <span className="text-xs" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.text}</span>}
      </div>
    </div>
  );
}

export default function ChatPageAccessPanel() {
  const [pages, setPages] = useState(null);
  const [users, setUsers] = useState([]);
  const [shown, setShown] = useState(new Set());
  const [adding, setAdding] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    Promise.all([call({ action: "list_page_access" }), call({ action: "list" })])
      .then(([p, u]) => {
        setPages(p.pages || []);
        setUsers((u.rows || []).map((r) => ({ email: String(r.email).toLowerCase(), nickname: r.nickname, role: r.role })));
        setShown(new Set((p.pages || []).filter((x) => x.sync_enabled || Array.isArray(x.chat_viewers) || x.chat_read_only).map((x) => x.page_id)));
      })
      .catch((e) => setErr(e.message));
  }, []);
  const visible = useMemo(() => (pages || []).filter((p) => shown.has(p.page_id)), [pages, shown]);
  const others = useMemo(() => (pages || []).filter((p) => !shown.has(p.page_id)), [pages, shown]);
  const onSaved = (pg) => setPages((cur) => cur.map((p) => (p.page_id === pg.page_id ? pg : p)));

  return (
    <section className="space-y-3">
      <div>
        <div className="font-semibold" style={{ color: "var(--ink)" }}>ใครเห็นแชทเพจไหน</div>
        <div className="text-xs" style={{ color: "var(--ink-3)" }}>กำหนดว่าเพจไหนดึงแชท ใครเห็นได้บ้าง และเพจไหนใช้ดูอย่างเดียว (เช่นดึงมาสรุปข้อมูล ไม่ได้ตอบจากแอป)</div>
      </div>
      {err && <div className="text-xs" style={{ color: "var(--bad)" }}>{err}</div>}
      {!pages && !err && <div className="text-xs" style={{ color: "var(--ink-3)" }}>กำลังโหลด…</div>}
      {visible.map((p) => <PageCard key={p.page_id} page={p} users={users} onSaved={onSaved} />)}
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={adding} onChange={(e) => setAdding(e.target.value)} className="max-w-xs !py-1.5">
            <option value="">— ตั้งค่าเพจอื่น —</option>
            {others.map((p) => <option key={p.page_id} value={p.page_id}>{p.page_name || p.page_id}</option>)}
          </Select>
          <Button size="sm" icon={Plus} disabled={!adding} onClick={() => { setShown((s) => new Set([...s, adding])); setAdding(""); }}>เพิ่ม</Button>
          <span className="text-2xs" style={{ color: "var(--ink-3)" }}>เปิดดึงแชทเพจใหม่ ควรตั้ง "เฉพาะคนที่เลือก" ก่อน — token ตอบแชทเห็นเพจของธุรกิจอื่นด้วย</span>
        </div>
      )}
    </section>
  );
}
