"use client";

// หน้าต่างแชทเล็กมุมขวา — แบบเดียวกับกล่องแชทของ Messenger
//
// ใช้กับหน้า "รายชื่อลูกค้า" ที่เป็นหน้าดูอย่างเดียว: กดชื่อลูกค้าแล้วอ่านบทสนทนาได้ทันที
// โดยไม่ต้องออกจากตารางที่กำลังไล่ดูอยู่ (เดิมต้องเด้งไปกล่องแชทแล้วเลื่อนหาตำแหน่งเดิมใหม่)
//
// จงใจไม่ใส่ช่องพิมพ์ตอบ: การส่งข้อความจริงมีเรื่องต้องจัดการอีกชุด (แปลภาษา แนบรูป
// คลังคำตอบ กรอบ 24 ชม. ของ Meta) ซึ่งทำไว้ครบแล้วในกล่องแชท — ถ้าทำซ้ำที่นี่จะเพี้ยนคนละทาง
// จึงมีปุ่ม "ตอบในกล่องแชท" พาไปห้องนั้นแทน

import { useEffect, useRef, useState } from "react";
import { Loader2, X, Minus, MessageSquare, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

const timeLabel = (v) => {
  if (!v) return "";
  try {
    return new Date(v).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
};

export default function MiniChatWindow({ row, onClose, onOpenInInbox }) {
  const [msgs, setMsgs] = useState(null);
  // เวลาข้อความล่าสุด — เอาจากคำขอนี้เอง เพราะตารางรายชื่อไม่ได้ดึงคอลัมน์นี้มา
  const [lastAt, setLastAt] = useState(null);
  const [error, setError] = useState("");
  const [minimized, setMinimized] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!row?.id) return;
    let stop = false;
    setMsgs(null); setError(""); setMinimized(false); setLastAt(null);
    (async () => {
      const { data, error: e } = await supabase
        .from("chat_customers")
        .select("id, customer_name, page_name, transcript, last_message_at")
        .eq("id", row.id)
        .maybeSingle();
      if (stop) return;
      if (e) { setError(e.message || "อ่านบทสนทนาไม่สำเร็จ"); setMsgs([]); return; }
      setLastAt(data?.last_message_at || null);
      const tr = Array.isArray(data?.transcript) ? data.transcript : [];
      // เก็บแค่ช่วงท้าย — ห้องที่คุยกันยาวมีหลายร้อยข้อความ เรนเดอร์หมดกล่องเล็กก็เลื่อนหาไม่เจอ
      setMsgs(tr.filter((m) => m?.t).slice(-60));
    })();
    return () => { stop = true; };
  }, [row?.id]);

  // เปิดมาให้เห็นข้อความล่าสุดก่อน เหมือนเปิดแชทจริง ไม่ใช่เริ่มจากข้อความแรกสุด
  useEffect(() => {
    if (!minimized && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, minimized]);

  if (!row) return null;

  return (
    <div className="fixed bottom-3 right-3 z-[90] w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <MessageSquare size={14} className="shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-slate-800">{row.customer_name || "(ไม่ทราบชื่อ)"}</div>
          <div className="truncate text-[10.5px] text-slate-500">{row.page_name || row.page_id || ""}</div>
        </div>
        <button type="button" onClick={() => setMinimized((v) => !v)} title={minimized ? "ขยาย" : "ย่อ"}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
          <Minus size={14} />
        </button>
        <button type="button" onClick={onClose} title="ปิด"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
          <X size={14} />
        </button>
      </div>

      {!minimized && (
        <>
          <div ref={bodyRef} className="max-h-[46vh] min-h-[160px] space-y-1.5 overflow-y-auto bg-white px-3 py-2.5">
            {msgs === null ? (
              <div className="flex items-center gap-2 py-6 text-[11.5px] text-slate-500">
                <Loader2 size={13} className="animate-spin" /> กำลังโหลดบทสนทนา…
              </div>
            ) : error ? (
              <div className="py-6 text-[11.5px] text-rose-600">{error}</div>
            ) : msgs.length === 0 ? (
              <div className="py-6 text-center text-[11.5px] text-slate-500">ห้องนี้ยังไม่มีข้อความ</div>
            ) : (
              msgs.map((m, i) => {
                const mine = m.w !== "u";           // "u" = ลูกค้า อย่างอื่นคือฝั่งเพจ
                return (
                  <div key={m.mid || `${i}-${m.at || ""}`} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[82%] rounded-2xl px-2.5 py-1.5 text-[12px] leading-snug ${
                      mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                      <div className="whitespace-pre-wrap break-words">{String(m.t)}</div>
                      <div className={`mt-0.5 text-[9.5px] ${mine ? "text-white/70" : "text-slate-400"}`}>{timeLabel(m.at)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
            <span className="text-[10.5px] text-slate-400">อ่านอย่างเดียว · ล่าสุด {timeLabel(lastAt) || "—"}</span>
            {onOpenInInbox && (
              <button type="button" onClick={() => onOpenInInbox(row.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
                <ExternalLink size={11} /> ตอบในกล่องแชท
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
