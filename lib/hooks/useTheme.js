"use client";

import { useEffect, useState } from "react";

// ธีม — เก็บค่าระดับเครื่องและส่ง event ให้ทุกหน้าที่เปิดอยู่ใน React อัปเดตพร้อมกัน
const THEME_EVENT = "aiads:theme-change";

export function storedTheme() {
  try {
    return localStorage.getItem("ui.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(next = storedTheme()) {
  const theme = next === "light" ? "light" : "dark";
  const root = document.documentElement;
  root.classList.toggle("theme-dark", theme === "dark");
  root.classList.toggle("theme-light", theme === "light");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#F4F7FB" : "#090B10");
  try {
    localStorage.setItem("ui.theme", theme);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
  return theme;
}

export function useTheme() {
  const [theme, setTheme] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("theme-light") ? "light" : storedTheme()
  );
  useEffect(() => {
    const sync = (event) => setTheme(event?.detail === "light" || storedTheme() === "light" ? "light" : "dark");
    const storage = (event) => {
      if (event.key === "ui.theme") applyTheme(event.newValue);
    };
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", storage);
    setTheme(applyTheme(theme));
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener("storage", storage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { theme, toggle: () => applyTheme(theme === "dark" ? "light" : "dark") };
}
