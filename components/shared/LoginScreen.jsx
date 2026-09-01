"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import PasswordInput from "@/components/shared/PasswordInput";
import BrandMark from "@/components/shared/BrandMark";

// ข้อความ error จาก Supabase Auth เป็นภาษาอังกฤษเชิงเทคนิค
// ผู้ใช้เป็นพนักงานไทย จึงแปลงเป็นข้อความที่บอกว่าต้องทำอะไรต่อ
function thaiAuthError(message) {
  const m = String(message || "");
  if (/Invalid login credentials/i.test(m)) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (/Email not confirmed/i.test(m)) return "อีเมลนี้ยังไม่ได้ยืนยัน — ตรวจกล่องจดหมายหรือติดต่อผู้ดูแลระบบ";
  if (/Too many requests|rate limit/i.test(m)) return "ลองเข้าสู่ระบบถี่เกินไป รอสักครู่แล้วลองอีกครั้ง";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่";
  if (/User not found/i.test(m)) return "ไม่พบบัญชีนี้ในระบบ — ติดต่อผู้ดูแลเพื่อเปิดสิทธิ์";
  return m || "เข้าสู่ระบบไม่สำเร็จ ลองอีกครั้ง";
}

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(thaiAuthError(error.message));
    else router.replace("/overview");
    setLoading(false);
  }

  const fieldCls =
    "w-full rounded-control border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 " +
    "focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-50";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <form onSubmit={handleSubmit} className="ds-card w-full max-w-sm p-7 space-y-4 shadow-card">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-card bg-brand-600 text-white mb-3">
            <BrandMark className="h-11 w-11" />
          </div>
          <h1 className="ds-title text-[17px]">Besight</h1>
          <p className="mt-1 text-[13.5px] text-slate-500">เข้าสู่ระบบเพื่อจัดการโฆษณาและตอบแชท</p>
        </div>

        <label className="block">
          <span className="text-[12.5px] font-medium text-slate-600">อีเมล</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`mt-1.5 ${fieldCls}`}
          />
        </label>

        <label className="block">
          <span className="text-[12.5px] font-medium text-slate-600">รหัสผ่าน</span>
          <PasswordInput
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            wrapperClass="mt-1.5"
            className={fieldCls}
          />
        </label>

        {error && (
          <div role="alert" className="rounded-control border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="ds-btn ds-btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : null}
          เข้าสู่ระบบ
        </button>
      </form>
    </div>
  );
}
