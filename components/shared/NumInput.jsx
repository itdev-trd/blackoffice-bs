"use client";

import { useEffect, useRef, useState } from "react";

// ช่องกรอกตัวเลขที่ "ลบให้ว่างได้จริง"
// ปัญหาเดิม: onChange แปลงเป็นตัวเลขทันที (Number(v) || ค่าเริ่มต้น) พอลบตัวสุดท้ายค่าจะเด้งกลับทันที
// จึงลบไม่หมดและพิมพ์ใหม่ทั้งหมดไม่ได้ — ตรงนี้เก็บเป็นข้อความระหว่างพิมพ์ ให้ว่างได้
// ออกจากช่องแล้วยังว่างอยู่ = ใส่ 0 ให้ (ตามที่ต้องการ) ; ถ้าพิมพ์เกินขอบเขต min/max จะดึงกลับให้อยู่ในกรอบ
export default function NumInput({ value, onChange, min, max, className = "", disabled, step, placeholder, title }) {
  const [txt, setTxt] = useState(value == null ? "" : String(value));
  const typing = useRef(false);
  // ค่าจากภายนอกเปลี่ยน (เช่นโหลดค่าตั้งใหม่) → sync เฉพาะตอนที่ผู้ใช้ไม่ได้พิมพ์อยู่ กันตัวเลขกระตุก
  useEffect(() => {
    if (!typing.current) setTxt(value == null ? "" : String(value));
  }, [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      title={title}
      className={className}
      value={txt}
      onFocus={() => {
        typing.current = true;
      }}
      onChange={(e) => {
        const v = e.target.value;
        setTxt(v); // ปล่อยให้ว่างได้ระหว่างพิมพ์
        if (v === "" || v === "-") return; // ยังไม่ส่งค่าออกจนกว่าจะเป็นตัวเลขจริง
        const n = Number(v);
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => {
        typing.current = false;
        if (txt === "" || !Number.isFinite(Number(txt))) {
          setTxt("0");
          onChange(0);
          return;
        }
        let n = Number(txt);
        if (min != null && n < min) n = min;
        if (max != null && n > max) n = max;
        setTxt(String(n));
        onChange(n);
      }}
    />
  );
}
