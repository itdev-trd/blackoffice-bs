"use client";
// หน้า "ฟีด" — ไว้ตอบคอมเมนต์ใต้โพสต์/โฆษณาโดยเฉพาะ
// แยกออกจากกล่องตอบแชทเพราะงานคนละแบบ: แชทคือคุยยาวรายคน ส่วนคอมเมนต์คือกวาดตอบทีละหลายอัน
// คอมเมนต์เก็บอยู่ในตารางเดียวกับแชท (chat_customers) แต่ id ขึ้นต้น fbc_ (Facebook) / igc_ (Instagram)
// การตอบใช้ edge function เดิม (messenger-reply) โหมด comment_reply_mode = public = ตอบใต้คอมเมนต์นั้น
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, RefreshCw, Send, ExternalLink, Megaphone, Check } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { logActivity } from "@/lib/utils/activity";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import Spinner from "@/components/shared/Spinner";
import { EmptyState, FilterPill, SectionTitle } from "@/components/ui";

const COLS = "id, page_id, page_name, customer_name, profile_pic, source, last_user_text, last_reply_text, last_reply_at, last_message_at, unread, awaiting_reply, comment_ad_name, comment_ad_names, comment_permalink, comment_is_ad, transcript";
const REFRESH_MS = 15000;

const isIg = (row) => String(row?.id || "").startsWith("igc_");
const initial = (name) => String(name || "?").trim().charAt(0).toUpperCase() || "?";

function fmtTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// คำตอบทั้งหมดของฝั่งเพจในเธรดนี้ (เรียงเก่า→ใหม่) — ทั้งที่ตอบจากแอปและที่ตอบจาก Facebook เอง
function replies(row) {
  const tr = Array.isArray(row?.transcript) ? row.transcript : [];
  return tr.filter((m) => m?.w === "p" && m?.t);
}

// ข้อความคอมเมนต์ล่าสุดของลูกค้า — ใช้ transcript ก่อนเพราะเก็บครบกว่า last_user_text ที่ถูกตัดที่ 300 ตัว
function commentText(row) {
  const tr = Array.isArray(row?.transcript) ? row.transcript : [];
  const lastUser = [...tr].reverse().find((m) => m?.w === "u");
  return lastUser?.t || row?.last_user_text || "";
}

export default function FeedTab({ active = true }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [onlyUnanswered, setOnlyUnanswered] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);   // { id, ok, message }
  const [email, setEmail] = useState("");
  const [translate, setTranslate] = useState(false);   // ค่าเริ่มต้น = ส่งตามที่พิมพ์ (เหมือนตอบผ่าน Facebook)
  const loadingRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data?.user?.email || ""));
  }, []);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      let q = supabase.from("chat_customers").select(COLS)
        .is("blocked_at", null)
        .or("source.eq.comment,id.like.fbc_%,id.like.igc_%")
        .order("last_message_at", { ascending: false })
        .limit(150);
      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
      setErr("");
    } catch (e) {
      setErr(e?.message || "โหลดคอมเมนต์ไม่สำเร็จ");
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [active, load]);

  // mode: "public" = ตอบใต้คอมเมนต์ (ทุกคนเห็น) · "private" = ส่งข้อความส่วนตัวถึงคนคอมเมนต์ (Meta อนุญาต 1 ครั้ง/คอมเมนต์)
  // แยกเป็นสองปุ่มกดตรง ๆ แทนการติ๊กเช็คบ็อกซ์ก่อนกดปุ่มเดียว กันกดพลาดว่าจะส่งแบบไหน
  async function sendReply(row, mode) {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setNotice(null);
    // approved_text = ข้อความที่ผ่านการอนุมัติแล้ว ฝั่ง server จะส่งตามนี้ตรง ๆ ไม่แปลอีก
    // ค่าเริ่มต้นของหน้าฟีดคือ "ส่งตามที่พิมพ์" ให้เหมือนตอบคอมเมนต์ผ่าน Facebook เอง
    // ติ๊ก "แปลก่อนส่ง" เมื่อไหร่ค่อยปล่อยให้ server แปลเป็นภาษาลูกค้า (ส่งแค่ text_th)
    const { data, error } = await supabase.functions.invoke("messenger-reply", {
      body: {
        action: "send", id: row.id, text_th: body, by: email,
        ...(translate ? {} : { approved_text: body }),
        comment_reply_mode: mode,
      },
    });
    setSending(false);
    if (error) { setNotice({ id: row.id, ok: false, message: await readFunctionErrorMessage(error) }); return; }
    if (!data?.ok) { setNotice({ id: row.id, ok: false, message: data?.error || "ตอบคอมเมนต์ไม่สำเร็จ" }); return; }
    logActivity("reply_comment", { id: row.id, page_id: row.page_id, customer_name: row.customer_name, mode });
    setNotice({ id: row.id, ok: true, message: mode === "private" ? "ส่งข้อความส่วนตัวแล้ว" : "ตอบใต้คอมเมนต์แล้ว" });
    setText(""); setOpenId(null);
    load();
  }

  // ปิดงานเองได้ (คอมเมนต์ที่ไม่ต้องตอบ เช่น อีโมจิ/สแปม) — ไม่ต้องตอบทิ้งไว้ให้ค้างในลิสต์
  async function markHandled(row) {
    const { error } = await supabase.from("chat_customers")
      .update({ awaiting_reply: false, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) { setNotice({ id: row.id, ok: false, message: error.message }); return; }
    setRows((cur) => (cur || []).map((r) => (r.id === row.id ? { ...r, awaiting_reply: false } : r)));
  }

  const list = (rows || []).filter((r) => (onlyUnanswered ? r.awaiting_reply !== false : true));
  const waiting = (rows || []).filter((r) => r.awaiting_reply !== false).length;

  return (
    <div className="space-y-3">
      <SectionTitle eyebrow="CONVERSATIONS" title="ฟีดคอมเมนต์" subtitle="คอมเมนต์ใต้โพสต์และโฆษณาของเพจ" right={
        <div className="flex items-center gap-2">
          <FilterPill active={onlyUnanswered} onClick={() => setOnlyUnanswered(true)}>ยังไม่ตอบ {waiting > 0 ? `(${waiting})` : ""}</FilterPill>
          <FilterPill active={!onlyUnanswered} onClick={() => setOnlyUnanswered(false)}>ทั้งหมด</FilterPill>
          <button type="button" onClick={load} title="รีเฟรช"
            className="rounded-lg border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-50">
            <RefreshCw size={14} />
          </button>
        </div>
      } />

      {err && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{err}</div>}

      {rows === null ? <Spinner label="กำลังโหลดคอมเมนต์..." />
        : list.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={onlyUnanswered ? "ตอบครบแล้ว" : "ยังไม่มีคอมเมนต์"}
            hint={onlyUnanswered
              ? "ไม่มีคอมเมนต์ที่รอตอบอยู่ตอนนี้ · กด “ทั้งหมด” เพื่อดูที่ตอบไปแล้ว"
              : "คอมเมนต์ใต้โพสต์/โฆษณาจะเด้งเข้ามาที่นี่เอง"}
          />
        ) : (
          <div className="studio-feed-list">
            {list.map((row) => {
              const ig = isIg(row);
              const note = notice?.id === row.id ? notice : null;
              const adName = row.comment_ad_name || (Array.isArray(row.comment_ad_names) ? row.comment_ad_names[0] : null);
              return (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start gap-2.5">
                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-sm font-semibold overflow-hidden">
                        <span>{initial(row.customer_name)}</span>
                        {row.profile_pic && <img src={row.profile_pic} alt="" className="absolute inset-0 w-full h-full object-cover rounded-full"
                          onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-slate-800 truncate">{row.customer_name || "(ไม่มีชื่อ)"}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ig ? "bg-pink-50 text-pink-600" : "bg-blue-50 text-blue-600"}`}>
                          {ig ? "Instagram" : "Facebook"}
                        </span>
                        {row.awaiting_reply !== false && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">ยังไม่ตอบ</span>}
                        <span className="text-[11px] text-slate-400">{fmtTime(row.last_message_at)}</span>
                      </div>

                      <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap break-words">{commentText(row) || "(ไม่มีข้อความ)"}</div>

                      {(adName || row.comment_permalink) && (
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-slate-500">
                          {adName && <span className="inline-flex items-center gap-1"><Megaphone size={11} /> {adName}</span>}
                          {row.comment_permalink && (
                            <a href={row.comment_permalink} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                              <ExternalLink size={11} /> เปิดคอมเมนต์ต้นทาง
                            </a>
                          )}
                        </div>
                      )}

                      {/* เธรดใต้คอมเมนต์ — โชว์คำตอบทุกอันเรียงตามเวลาเหมือนที่เห็นบน Facebook
                          รวมคำตอบที่แอดมินตอบจาก Facebook เองด้วย (webhook echo เขียนเข้า transcript ให้) */}
                      {replies(row).length > 0 && (
                        <div className="mt-1.5 space-y-1 border-l-2 border-slate-200 pl-2.5">
                          {replies(row).map((m, i) => (
                            <div key={m.mid || i} className="text-[12px] text-slate-600">
                              <span className="text-slate-400">↳ {m.by_name || m.by || "เพจ"}: </span>
                              <span className="whitespace-pre-wrap break-words">{m.t}</span>
                              {m.at && <span className="ml-1 text-[10.5px] text-slate-400">({fmtTime(m.at)})</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {openId === row.id ? (
                        <div className="mt-2 space-y-1.5">
                          <textarea
                            value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus
                            placeholder={translate ? "พิมพ์ไทย — ระบบจะแปลเป็นภาษาลูกค้าก่อนส่ง" : "พิมพ์คำตอบ — ส่งตามที่พิมพ์เลย (เหมือนตอบใน Facebook)"}
                            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendReply(row, "public"); }}
                            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
                          />

                          <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-600">
                            <input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} />
                            แปลเป็นภาษาลูกค้าก่อนส่ง
                          </label>

                          <div className="flex items-center gap-2 flex-wrap">
                            <button type="button" onClick={() => sendReply(row, "public")} disabled={sending || !text.trim()}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                              ตอบใต้คอมเมนต์
                            </button>
                            <button type="button" onClick={() => sendReply(row, "private")} disabled={sending || !text.trim()}
                              title="Meta อนุญาตให้ส่งข้อความส่วนตัวถึงคนคอมเมนต์ได้ 1 ครั้งต่อคอมเมนต์"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-400/60 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50">
                              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                              ส่งข้อความส่วนตัว (DM)
                            </button>
                            <button type="button" onClick={() => { setOpenId(null); setText(""); }}
                              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">ยกเลิก</button>
                            <span className="text-[10.5px] text-slate-400">Ctrl/⌘ + Enter = ตอบใต้คอมเมนต์</span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <button type="button" onClick={() => { setOpenId(row.id); setText(""); setNotice(null); }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-400/60 px-2.5 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50">
                            <Send size={12} /> ตอบคอมเมนต์
                          </button>
                          {row.awaiting_reply !== false && (
                            <button type="button" onClick={() => markHandled(row)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                              <Check size={12} /> จัดการแล้ว
                            </button>
                          )}
                        </div>
                      )}

                      {note && (
                        <div className={`mt-1.5 text-[11px] ${note.ok ? "text-emerald-600" : "text-rose-600"}`}>{note.message}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
