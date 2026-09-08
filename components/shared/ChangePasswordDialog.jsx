"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, X } from "lucide-react";
import PasswordInput from "@/components/shared/PasswordInput";
import { supabase } from "@/lib/supabase/client";
import { logActivity } from "@/lib/utils/activity";

const MIN_LENGTH = 8;

/**
 * เปลี่ยนรหัสผ่านของบัญชีตัวเอง — ใช้ได้ทุกบทบาท ไม่ผูกกับสิทธิ์หน้าตั้งค่า
 * (แอดมินตอบแชทเห็นการตั้งค่าแค่ "บันทึกข้อความอัตโนมัติ" ถ้าเอาไปไว้ในนั้นจะเปลี่ยนรหัสไม่ได้)
 *
 * ยืนยันรหัสเดิมก่อนเสมอด้วย signInWithPassword: Supabase ยอมให้เปลี่ยนรหัสจาก session
 * ที่ล็อกอินค้างไว้ได้เลย ถ้าไม่ถามรหัสเดิม ใครหยิบเครื่องที่เปิดค้างไปก็ยึดบัญชีได้
 * — พนักงานหลายคนใช้เครื่องร่วมกัน จึงต้องกันจุดนี้
 */
export default function ChangePasswordDialog({ open, email, onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const firstFieldRef = useRef(null);

  // เปิดใหม่ทุกครั้ง = เริ่มจากฟอร์มเปล่า ไม่ค้างรหัสของรอบก่อนไว้ในหน้าจอ
  useEffect(() => {
    if (!open) return;
    setCurrent(""); setNext(""); setConfirm(""); setErr(""); setDone(false); setBusy(false);
    const t = setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function submit(e) {
    e?.preventDefault();
    setErr("");
    if (!current) return setErr("กรุณากรอกรหัสผ่านเดิม");
    if (next.length < MIN_LENGTH) return setErr(`รหัสผ่านใหม่ต้องยาวอย่างน้อย ${MIN_LENGTH} ตัวอักษร`);
    if (next !== confirm) return setErr("รหัสผ่านใหม่กับช่องยืนยันไม่ตรงกัน");
    if (next === current) return setErr("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม");
    if (!email) return setErr("ไม่ทราบอีเมลของบัญชีนี้ ลองออกจากระบบแล้วเข้าใหม่");

    setBusy(true);
    // ยืนยันตัวตนด้วยรหัสเดิมก่อน — ผิดคือหยุดตรงนี้ ยังไม่แตะรหัสจริง
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: current });
    if (signInError) {
      setBusy(false);
      return setErr("รหัสผ่านเดิมไม่ถูกต้อง");
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (updateError) return setErr(updateError.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ");

    setDone(true);
    setCurrent(""); setNext(""); setConfirm("");
    logActivity("change_password");   // เก็บแค่ว่าเปลี่ยนเมื่อไหร่ ไม่เก็บตัวรหัส
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-password-title"
    >
      <div
        className="w-full max-w-sm rounded-t-2xl bg-night-surface shadow-2xl sm:rounded-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between border-b border-night-border px-4 py-3">
          <span id="change-password-title" className="flex items-center gap-2 font-semibold text-night-ink">
            <KeyRound size={17} className="text-night-accent" />
            เปลี่ยนรหัสผ่าน
          </span>
          <button
            onClick={() => !busy && onClose?.()}
            className="p-1 text-night-ink-3 hover:text-night-ink disabled:opacity-50"
            disabled={busy}
            aria-label="ปิด"
          >
            <X size={20} />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              เปลี่ยนรหัสผ่านเรียบร้อยแล้ว ครั้งหน้าเข้าระบบด้วยรหัสใหม่
            </p>
            <p className="text-xs text-night-ink-3">
              เครื่องอื่นที่ล็อกอินค้างไว้ยังใช้งานต่อได้จนกว่าจะออกจากระบบ
              ถ้าสงสัยว่ามีคนอื่นรู้รหัสเดิม ให้กดออกจากระบบในเครื่องนั้นด้วย
            </p>
            <button
              onClick={() => onClose?.()}
              className="h-10 rounded-lg bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700"
            >
              เสร็จสิ้น
            </button>
          </div>
        ) : (
          <form className="flex flex-col gap-3 p-4" onSubmit={submit}>
            {email && (
              <p className="text-xs text-night-ink-3">
                บัญชี <span className="font-medium text-night-ink-2">{email}</span>
              </p>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-night-ink-2">รหัสผ่านเดิม</span>
              <PasswordInput
                ref={firstFieldRef}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-lg border border-night-border bg-night-surface2 px-3 py-2 text-sm text-night-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-night-ink-2">รหัสผ่านใหม่</span>
              <PasswordInput
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-night-border bg-night-surface2 px-3 py-2 text-sm text-night-ink"
              />
              <span className="text-[11px] text-night-ink-3">อย่างน้อย {MIN_LENGTH} ตัวอักษร</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-night-ink-2">ยืนยันรหัสผ่านใหม่</span>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-night-border bg-night-surface2 px-3 py-2 text-sm text-night-ink"
              />
            </label>

            {err && (
              <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">{err}</div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              บันทึกรหัสผ่านใหม่
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
