"use client";

import { Home } from "lucide-react";
import { useRouter } from "next/navigation";

export default function HomeButton({ className = "text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm shrink-0" }) {
  const router = useRouter();
  return (
    <button onClick={() => router.push("/overview")} className={className} title="กลับหน้าแรก">
      <Home size={18} /> หน้าแรก
    </button>
  );
}
