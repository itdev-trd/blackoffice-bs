"use client";

// ปุ่มสลับธีม สว่าง/มืด
// globals.css มี token 2 ชุดอยู่แล้ว: :root = สว่าง · html.dark = มืด
// เดิม layout.jsx ใส่ class "dark" ตายตัว ทำให้ธีมสว่างที่เขียนไว้ไม่เคยถูกใช้เลย
//
// จำค่าไว้ใน localStorage และมี ThemeScript ใน layout ทาคลาสให้ก่อนหน้าจอวาด
// ไม่งั้นจะเห็นจอขาวแวบก่อนกลายเป็นมืด (flash of wrong theme)

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export const THEME_KEY = "ui.theme";

function apply(theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // บอกเบราว์เซอร์ด้วย เพื่อให้ scrollbar/ช่องกรอกของระบบใช้สีให้ตรงธีม
  root.style.colorScheme = theme === "dark" ? "dark" : "light";
}

// ตอนนี้มีปุ่มนี้สองที่ (sidebar เดสก์ท็อป + เมนู "เพิ่มเติม" ของมือถือ/แท็บเล็ต)
// ถ้าต่างคนต่างเก็บ state ป้ายของอีกตัวจะค้างค่าเก่า พอย่อ/ขยายจอแล้วกดจะสลับผิดทาง
// จึงกระจายข่าวผ่าน event ให้ทุกตัวอัปเดตพร้อมกัน
const THEME_EVENT = "besight:theme";

export default function ThemeToggle({ collapsed = false, icon = false }) {
  const [theme, setTheme] = useState(null);   // null = ยังไม่รู้ (กัน hydration ไม่ตรง)

  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* โหมดส่วนตัวอ่านไม่ได้ */ }
    setTheme(saved === "light" ? "light" : "dark");   // ค่าเริ่มต้นคงเป็นมืดเหมือนเดิม
    const sync = (e) => setTheme(e.detail === "light" ? "light" : "dark");
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!theme) return;
    apply(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* จำไม่ได้ก็ไม่เป็นไร */ }
  }, [theme]);

  const choose = (next) => {
    setTheme(next);
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
  };

  if (!theme) return null;
  const dark = theme === "dark";

  // icon = ไอคอนล้วนขนาดเท่าปุ่มอื่นในหัวมือถือ (h-9) — หัวมือถือมีรีเฟรช/ออกอยู่แล้ว
  // ถ้าใส่ปุ่มมีข้อความเพิ่มอีกอันจะแน่นจนชื่อแอปโดนบีบ
  const size = icon
    ? "h-9 w-9 justify-center"
    : collapsed
      ? "h-11 w-16 flex-col justify-center gap-0.5"
      : "h-10 w-full gap-2.5 px-3";

  return (
    <button
      onClick={() => choose(dark ? "light" : "dark")}
      title={dark ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด"}
      aria-label={dark ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด"}
      className={`flex items-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 transition-colors hover:border-amber-500/70 hover:bg-amber-500/15 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:border-amber-300/60 dark:hover:bg-amber-400/20 ${size}`}
    >
      {dark ? <Sun size={17} className="shrink-0" /> : <Moon size={17} className="shrink-0" />}
      {!icon && (
        <span className={collapsed ? "text-[10px] font-semibold leading-none" : "text-[13px] font-semibold"}>
          {dark ? "สว่าง" : "มืด"}
        </span>
      )}
    </button>
  );
}
