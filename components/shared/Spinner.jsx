"use client";

import { Loader2 } from "lucide-react";

export default function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
      <Loader2 className="animate-spin" size={20} />
      <span>{label || "กำลังโหลด..."}</span>
    </div>
  );
}
