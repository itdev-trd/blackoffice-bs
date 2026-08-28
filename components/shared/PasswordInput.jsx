"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

// ช่องรหัสผ่านที่มีปุ่มดวงตา (กดสลับแสดง/ซ่อนรหัสที่พิมพ์) — ใช้ซ้ำได้ทุกที่
export default function PasswordInput({ className = "", wrapperClass = "", ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${wrapperClass}`}>
      <input {...props} type={show ? "text" : "password"} className={`${className} pr-10`} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
        aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        title={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
