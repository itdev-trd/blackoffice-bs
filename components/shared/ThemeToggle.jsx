"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/hooks/useTheme";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const light = theme === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      className="theme-toggle"
      aria-label={light ? "เปลี่ยนเป็นธีมมืด" : "เปลี่ยนเป็นธีมสว่าง"}
      title={light ? "ธีมมืด" : "ธีมสว่าง"}
    >
      {light ? <Moon size={17} /> : <Sun size={17} />}
      <span className="theme-toggle-label">{light ? "มืด" : "สว่าง"}</span>
    </button>
  );
}
