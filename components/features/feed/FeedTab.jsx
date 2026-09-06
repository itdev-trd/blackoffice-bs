"use client";
// หน้า "ฟีด" — ไว้ตอบคอมเมนต์ใต้โพสต์/โฆษณาโดยเฉพาะ
// แยกออกจากกล่องตอบแชทเพราะงานคนละแบบ: แชทคือคุยยาวรายคน ส่วนคอมเมนต์คือกวาดตอบทีละหลายอัน
// คอมเมนต์เก็บอยู่ในตารางเดียวกับแชท (chat_customers) แต่ id ขึ้นต้น fbc_ (Facebook) / igc_ (Instagram)
// การตอบใช้ edge function เดิม (messenger-reply) โหมด comment_reply_mode = public = ตอบใต้คอมเมนต์นั้น
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, RefreshCw, Send, ExternalLink, Megaphone } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { logActivity } from "@/lib/utils/activity";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import Spinner from "@/components/shared/Spinner";
import { EmptyState, FilterPill } from "@/components/ui";

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

  async function sendReply(row) {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setNotice(null);
    const { data, error } = await supabase.functions.invoke("messenger-reply", {
      body: { action: "send", id: row.id, text_th: body, by: email, comment_reply_mode: "public" },
    });
    setSending(false);
    if (error) { setNotice({ id: row.id, ok: false, message: await readFunctionErrorMessage(error) }); return; }
    if (!data?.ok) { setNotice({ id: row.id, ok: false, message: data?.error || "ตอบคอมเมนต์ไม่สำเร็จ" }); return; }
    logActivity("reply_comment", { id: row.id, page_id: row.page_id, customer_name: row.customer_name });
    setNotice({ id: row.id, ok: true, message: "ตอบแล้ว" });
    setText(""); setOpenId(null);
    load();
  }

  const list = (rows || []).filter((r) => (onlyUnanswered ? r.awaiting_reply !== false : true));
  const waiting = (rows || []).filter((r) => r.awaiting_reply !== false).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <MessageSquare size={18} /> ฟีด — ตอบคอมเมนต์
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            คอมเมนต์ใต้โพสต์และโฆษณาของเพจ ตอบได้จากที่นี่เลย (ตอบแล้วจะไปโผล่ใต้คอมเมนต์นั้นจริง)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FilterPill active={onlyUnanswered} onClick={() => setOnlyUnanswered(true)}>ยังไม่ตอบ {waiting > 0 ? `(${waiting})` : ""}</FilterPill>
          <FilterPill active={!onlyUnanswered} onClick={() => setOnlyUnanswered(false)}>ทั้งหมด</FilterPill>
          <button type="button" onClick={load} title="รีเฟรช"
            className="rounded-lg border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-50">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

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
          <div className="space-y-2">
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

                      {row.last_reply_text && (
                        <div className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-[12px] text-slate-600">
                          <span className="text-slate-400">ตอบไปแล้ว: </span>{row.last_reply_text}
                          {row.last_reply_at && <span className="ml-1 text-[10.5px] text-slate-400">({fmtTime(row.last_reply_at)})</span>}
                        </div>
                      )}

                      {openId === row.id ? (
                        <div className="mt-2 space-y-1.5">
                          <textarea
                            value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus
                            placeholder="พิมพ์คำตอบเป็นไทย — ระบบแปลเป็นภาษาลูกค้าให้ก่อนส่ง"
                            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendReply(row); }}
                            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
                          />
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => sendReply(row)} disabled={sending || !text.trim()}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} ตอบใต้คอมเมนต์
                            </button>
                            <button type="button" onClick={() => { setOpenId(null); setText(""); }}
                              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">ยกเลิก</button>
                            <span className="text-[10.5px] text-slate-400">Ctrl/⌘ + Enter = ส่ง</span>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => { setOpenId(row.id); setText(""); setNotice(null); }}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-brand-400/60 px-2.5 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50">
                          <Send size={12} /> ตอบคอมเมนต์
                        </button>
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
