"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import NumInput from "@/components/shared/NumInput";
import { CAMPAIGNS_KEY, campaignRunning } from "@/lib/tv/campaigns";

// กิจกรรมแจกสิทธิ์ Indicator ให้คนทั่วไป (ไม่ต้องมีไอดีเทรด) — แอดมินกดปุ่ม "กิจกรรม" ในข้อมูลลูกค้าของแชท
// ตัวกิจกรรมเก็บใน settings.tv_campaigns · ใครได้ไปแล้วจดใน tv_campaign_grants (คนเดิมได้ครั้งเดียวต่อกิจกรรม)
const blank = () => ({ id: `c_${Date.now().toString(36)}`, name: "", pine_ids: [], days: 7, active: true, start_date: "", end_date: "", points: true, note: "" });

export default function TvCampaignsPanel() {
  const [list, setList] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [counts, setCounts] = useState({});
  const [openId, setOpenId] = useState(null);
  const [grants, setGrants] = useState([]);

  async function load() {
    const [{ data: s }, { data: sc }, { data: g }] = await Promise.all([
      supabase.from("settings").select("value").eq("key", CAMPAIGNS_KEY).maybeSingle(),
      supabase.from("tv_scripts").select("pine_id, name, brand_id").order("created_at"),
      supabase.from("tv_campaign_grants").select("campaign_id").limit(5000),
    ]);
    setList(Array.isArray(s?.value) ? s.value : []);
    setScripts(sc || []);
    const c = {};
    for (const r of g || []) c[r.campaign_id] = (c[r.campaign_id] || 0) + 1;
    setCounts(c);
  }
  useEffect(() => { load(); }, []);

  async function write(next) {
    setSaving(true); setMsg(null);
    const { error } = await supabase.from("settings").upsert({ key: CAMPAIGNS_KEY, value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setSaving(false);
    if (error) { setMsg({ ok: false, text: "บันทึกไม่สำเร็จ: " + error.message }); return false; }
    setList(next); setMsg({ ok: true, text: "บันทึกแล้ว ✓" });
    return true;
  }
  async function saveEdit() {
    if (!edit.name.trim()) { setMsg({ ok: false, text: "ตั้งชื่อกิจกรรมก่อน" }); return; }
    if (!edit.pine_ids.length) { setMsg({ ok: false, text: "เลือก Indicator อย่างน้อย 1 อัน" }); return; }
    if (!(Number(edit.days) >= 1)) { setMsg({ ok: false, text: "จำนวนวันต้องอย่างน้อย 1 วัน" }); return; }
    const item = { ...edit, name: edit.name.trim(), days: Math.round(Number(edit.days)) };
    const next = list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list];
    if (await write(next)) setEdit(null);
  }
  async function remove(c) {
    if (counts[c.id]) { setMsg({ ok: false, text: `กิจกรรม "${c.name}" มีคนได้สิทธิ์ไปแล้ว ${counts[c.id]} คน — ปิดกิจกรรมแทนการลบ จะได้เก็บประวัติไว้` }); return; }
    await write(list.filter((x) => x.id !== c.id));
  }
  async function toggleOpen(c) {
    if (openId === c.id) { setOpenId(null); return; }
    setOpenId(c.id); setGrants([]);
    const { data } = await supabase.from("tv_campaign_grants").select("id, username, customer_name, granted_by, granted_at, expiration")
      .eq("campaign_id", c.id).order("granted_at", { ascending: false }).limit(200);
    setGrants(data || []);
  }

  const scriptName = (pid) => scripts.find((s) => s.pine_id === pid)?.name || pid;
  const fmtDate = (v) => (v ? new Date(v).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-");
  const field = "mt-0.5 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm";

  return (
    <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[var(--ink)]">กิจกรรมแจก Indicator</h3>
          <p className="text-xs text-[var(--ink-3)] mt-0.5">
            ให้สิทธิ์ Indicator แบบไม่ต้องเช็คหรือใส่ไอดีเทรด แอดมินกดปุ่ม 🎁 กิจกรรม ในข้อมูลลูกค้าของแชท แล้วใส่แค่ User TradingView ·
            หนึ่ง user ได้สิทธิ์ครั้งเดียวต่อกิจกรรม · ถ้าลูกค้ามีสิทธิ์สคริปต์นั้นยาวกว่าอยู่แล้ว ระบบจะไม่ไปตัดวันให้สั้นลง
          </p>
        </div>
        {!edit && <button onClick={() => { setEdit(blank()); setMsg(null); }} className="shrink-0 rounded-lg bg-brand-600 text-white px-3 py-2 text-sm font-medium flex items-center gap-1.5"><Plus size={14} /> เพิ่มกิจกรรม</button>}
      </div>

      {msg && <div className={`text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</div>}

      {edit && (
        <div className="rounded-xl border border-[var(--line-strong)] p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-[var(--ink-2)]">ชื่อกิจกรรม</label>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="เช่น แจก Indicator 7 วัน (พ.ย.)" className={field} />
            </div>
            <div>
              <label className="text-xs text-[var(--ink-2)]">ให้สิทธิ์กี่วัน</label>
              <NumInput value={edit.days} onChange={(v) => setEdit({ ...edit, days: v })} className={field} />
            </div>
            <div>
              <label className="text-xs text-[var(--ink-2)]">เริ่มกิจกรรม (ว่าง = เริ่มเลย)</label>
              <input type="date" value={edit.start_date} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} className={field} />
            </div>
            <div>
              <label className="text-xs text-[var(--ink-2)]">จบกิจกรรม (ว่าง = ไม่มีกำหนด)</label>
              <input type="date" value={edit.end_date} onChange={(e) => setEdit({ ...edit, end_date: e.target.value })} className={field} />
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--ink-2)]">Indicator ที่แจก</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {scripts.map((s) => {
                const on = edit.pine_ids.includes(s.pine_id);
                return (
                  <button key={s.pine_id} onClick={() => setEdit({ ...edit, pine_ids: on ? edit.pine_ids.filter((p) => p !== s.pine_id) : [...edit.pine_ids, s.pine_id] })}
                    className={`rounded-full border px-3 py-1 text-xs ${on ? "bg-brand-600 border-brand-600 text-white" : "border-[var(--line-strong)] text-[var(--ink-2)]"}`}>
                    {on ? "✓ " : ""}{s.name || s.pine_id}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--ink-2)]">หมายเหตุ / เงื่อนไขกิจกรรม (โชว์ให้แอดมินเห็นตอนกด)</label>
            <textarea value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} rows={2} className={field} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-[var(--ink-2)]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> เปิดกิจกรรม</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={edit.points} onChange={(e) => setEdit({ ...edit, points: e.target.checked })} /> แอดมินได้แต้มให้สิทธิ์ (ได้แต้มเหมือนให้สิทธิ์ปกติ)</label>
          </div>
          <div className="flex gap-2">
            <button onClick={saveEdit} disabled={saving} className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">{saving ? "กำลังบันทึก..." : "บันทึกกิจกรรม"}</button>
            <button onClick={() => setEdit(null)} className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm text-[var(--ink-2)]">ยกเลิก</button>
          </div>
        </div>
      )}

      {list === null ? <div className="text-sm text-[var(--ink-3)] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> กำลังโหลด...</div>
        : list.length === 0 ? <div className="text-sm text-[var(--ink-3)]">ยังไม่มีกิจกรรม</div>
        : (
          <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
            {list.map((c) => {
              const running = campaignRunning(c);
              return (
                <div key={c.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-[var(--ink)]">{c.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${running ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{running ? "เปิดอยู่" : c.active ? "นอกช่วงเวลา" : "ปิด"}</span>
                      </div>
                      <div className="text-xs text-[var(--ink-3)] mt-0.5">
                        {c.days} วัน · {c.pine_ids.map(scriptName).join(", ")}
                        {(c.start_date || c.end_date) && ` · ${c.start_date || "…"} ถึง ${c.end_date || "…"}`}
                        {c.points && " · ได้แต้ม"}
                      </div>
                      <button onClick={() => toggleOpen(c)} className="text-xs text-brand-600 mt-1">ได้สิทธิ์ไปแล้ว {counts[c.id] || 0} คน {openId === c.id ? "▲" : "▼"}</button>
                    </div>
                    <button onClick={() => { setEdit({ ...blank(), ...c }); setMsg(null); }} className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs text-[var(--ink-2)]">แก้ไข</button>
                    <button onClick={() => remove(c)} className="rounded-lg border border-[var(--line-strong)] px-2 py-1.5 text-[var(--ink-3)] hover:text-rose-600" title="ลบกิจกรรม"><Trash2 size={14} /></button>
                  </div>
                  {openId === c.id && (
                    <div className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-[var(--surface-2,transparent)] text-xs">
                      {grants.length === 0 ? <div className="p-2 text-[var(--ink-3)]">ยังไม่มีคนได้สิทธิ์</div> : (
                        <table className="w-full">
                          <thead><tr className="text-left text-[var(--ink-3)]"><th className="p-1.5">User TV</th><th className="p-1.5">ลูกค้า</th><th className="p-1.5">ให้โดย</th><th className="p-1.5">เมื่อ</th><th className="p-1.5">หมดอายุ</th></tr></thead>
                          <tbody>
                            {grants.map((g) => (
                              <tr key={g.id} className="border-t border-[var(--line)]">
                                <td className="p-1.5 font-medium">{g.username}</td><td className="p-1.5">{g.customer_name || "-"}</td>
                                <td className="p-1.5">{String(g.granted_by || "").split("@")[0]}</td><td className="p-1.5">{fmtDate(g.granted_at)}</td><td className="p-1.5">{fmtDate(g.expiration)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
