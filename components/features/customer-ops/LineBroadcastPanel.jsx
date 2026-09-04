"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Megaphone, RefreshCw, Send, Users } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button, Card } from "@/components/ui";

const MAX_TEXT_LENGTH = 5000;

function getErrorMessage(error, data) {
  return data?.error || error?.message || "ดำเนินการไม่สำเร็จ กรุณาลองใหม่";
}

export default function LineBroadcastPanel() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState(false);
  const [validatedText, setValidatedText] = useState("");
  const [notice, setNotice] = useState(null);

  const remaining = MAX_TEXT_LENGTH - text.length;
  const isValidLength = text.trim().length > 0 && text.length <= MAX_TEXT_LENGTH;
  const canSend = useMemo(() => isValidLength && validatedText === text, [isValidLength, text, validatedText]);

  async function loadStatus() {
    setLoadingStatus(true);
    const { data, error } = await supabase.functions.invoke("line-broadcast", { body: { action: "status" } });
    setStatus(error ? { configured: false, error: getErrorMessage(error, data) } : data);
    setLoadingStatus(false);
  }

  useEffect(() => { loadStatus(); }, []);

  function showNotice(type, message) {
    setNotice({ type, message });
  }

  async function validate() {
    if (!text.trim()) return showNotice("error", "กรุณาพิมพ์ข้อความก่อนตรวจสอบ");
    if (text.length > MAX_TEXT_LENGTH) return showNotice("error", `ข้อความยาวเกิน ${MAX_TEXT_LENGTH.toLocaleString()} ตัวอักษร`);
    setBusy(true); setNotice(null);
    const { data, error } = await supabase.functions.invoke("line-broadcast", { body: { action: "validate", text } });
    setBusy(false);
    if (error || !data?.ok) return showNotice("error", getErrorMessage(error, data));
    setValidatedText(text);
    showNotice("success", "ตรวจสอบข้อความผ่านแล้ว พร้อมส่ง Broadcast");
  }

  async function sendBroadcast() {
    if (!canSend) return validate();
    if (!window.confirm("ยืนยันส่งข้อความนี้ไปยังเพื่อน LINE OA ทั้งหมดหรือไม่?\n\nการส่ง Broadcast อาจใช้โควตาข้อความของ LINE และไม่สามารถยกเลิกได้")) return;
    setBusy(true); setNotice(null);
    const { data, error } = await supabase.functions.invoke("line-broadcast", { body: { action: "send", text } });
    setBusy(false);
    if (error || !data?.ok) return showNotice("error", getErrorMessage(error, data));
    setValidatedText(text);
    showNotice("success", "ส่ง Broadcast สำเร็จแล้ว");
  }

  return (
    <div className="space-y-4">
      <Card
        title="Broadcast LINE"
        subtitle="ส่งข้อความเดียวกันไปยังเพื่อน LINE OA ทั้งหมดจากหน้าเว็บ"
        right={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={loadStatus} disabled={loadingStatus}>รีเฟรช</Button>}
      >
        <div className="space-y-4 p-4 sm:p-5">
          <div className={`flex items-start gap-3 rounded-control border p-3 text-sm ${status?.configured ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {status?.configured ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <div className="font-semibold">{loadingStatus ? "กำลังตรวจสอบการเชื่อมต่อ LINE..." : status?.configured ? `เชื่อมต่อแล้ว${status.bot?.displayName ? ` · ${status.bot.displayName}` : ""}` : "ยังไม่ได้ตั้งค่า LINE OA"}</div>
              {!loadingStatus && !status?.configured && <div className="mt-1 text-xs">กรุณาตั้งค่า Channel access token ที่เมนู ตั้งค่า → LINE OA ก่อนใช้งาน</div>}
              {status?.error && <div className="mt-1 break-words text-xs">{status.error}</div>}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
            <div className="space-y-2">
              <label htmlFor="line-broadcast-text" className="flex items-center justify-between text-sm font-semibold text-slate-700">
                <span>ข้อความที่จะส่ง</span>
                <span className={remaining < 0 ? "text-rose-600" : "text-slate-400"}>{text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}</span>
              </label>
              <textarea
                id="line-broadcast-text"
                value={text}
                onChange={(event) => { setText(event.target.value); setValidatedText(""); setNotice(null); }}
                rows={8}
                maxLength={MAX_TEXT_LENGTH + 1}
                placeholder="พิมพ์ข้อความประกาศถึงลูกค้า LINE OA..."
                className="min-h-40 w-full resize-y rounded-control border border-slate-200 bg-white px-3 py-3 text-sm leading-relaxed text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <p className="text-xs text-slate-400">รองรับข้อความตัวอักษรภาษาไทยและภาษาอังกฤษ ความยาวไม่เกิน 5,000 ตัวอักษร</p>
            </div>

            <div className="rounded-card border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Users size={16} /> ผู้รับข้อความ</div>
              <div className="mt-4 flex items-center gap-3">
                <div className="rounded-control bg-brand-50 p-2 text-brand-700"><Megaphone size={20} /></div>
                <div><div className="font-semibold text-slate-800">เพื่อน LINE OA ทั้งหมด</div><div className="text-xs text-slate-500">ระบบจะส่งให้ทุกคนที่เป็นเพื่อนบัญชี</div></div>
              </div>
              <div className="mt-4 rounded-control border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">โปรดตรวจสอบข้อความให้เรียบร้อยก่อนส่ง การ Broadcast ส่งแล้วไม่สามารถยกเลิกได้</div>
            </div>
          </div>

          {text && <div className="rounded-card border border-slate-200 bg-white p-4"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">ตัวอย่างข้อความ</div><div className="max-w-xl whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-emerald-100 px-4 py-3 text-sm leading-relaxed text-slate-800">{text}</div></div>}

          {notice && <div className={`rounded-control border p-3 text-sm ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{notice.message}</div>}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={validate} loading={busy} disabled={!isValidLength} icon={CheckCircle2}>ตรวจสอบข้อความ</Button>
            <Button variant="primary" onClick={sendBroadcast} loading={busy} disabled={!status?.configured || !isValidLength} icon={Send}>{canSend ? "ส่ง Broadcast" : "ตรวจสอบก่อนส่ง"}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
