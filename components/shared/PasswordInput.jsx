"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

// ช่องรหัสผ่านที่มีปุ่มดวงตา (กดสลับแสดง/ซ่อนรหัสที่พิมพ์) — ใช้ซ้ำได้ทุกที่
// forwardRef เพื่อให้กล่องที่เปิดขึ้นมาโฟกัสช่องแรกให้เองได้ (เช่นหน้าต่างเปลี่ยนรหัสผ่าน)
const PasswordInput = forwardRef(function PasswordInput({ className = "", wrapperClass = "", ...props }, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${wrapperClass}`}>
      <input ref={ref} {...props} type={show ? "text" : "password"} className={`${className} pr-10`} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-1 right-1 flex w-9 items-center justify-center rounded-control text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-brand-500"
        aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        aria-pressed={show}
        title={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
});

export default PasswordInput;
