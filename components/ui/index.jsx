"use client";

// =====================================================================
// AdFlow OS — ชุด component กลาง
// ทุกหน้าควรประกอบจากตัวเหล่านี้ ไม่เขียน Tailwind ซ้ำเอง
// นำเข้าใช้: import { Button, Card, StatCard, ... } from "@/components/ui";
//
// โทเคนสี/รัศมี/ฟอนต์ อยู่ใน tailwind.config.js
// คลาสประกอบ (.ds-*) อยู่ใน app/globals.css
// =====================================================================
import { Loader2, Search } from "lucide-react";

// สีสถานะ — ธีมสว่างต้องใช้เป็นคู่ (ตัวอักษรเข้ม / พื้นอ่อน / เส้นขอบ)
// การใช้สีเดียวทั้งพื้นและตัวอักษรทำให้คอนทราสต์ไม่ผ่าน ซึ่งเป็นปัญหาของชุดเดิม
const TONES = {
  brand:  { fg: "text-brand-700",   bg: "bg-brand-50",   border: "border-brand-200",  dot: "bg-brand-600" },
  blue:   { fg: "text-brand-700",   bg: "bg-brand-50",   border: "border-brand-200",  dot: "bg-brand-600" },
  green:  { fg: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-600" },
  gold:   { fg: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200",  dot: "bg-amber-500" },
  red:    { fg: "text-rose-700",    bg: "bg-rose-50",    border: "border-rose-200",   dot: "bg-rose-600" },
  purple: { fg: "text-violet-700",  bg: "bg-violet-50",  border: "border-violet-200", dot: "bg-violet-600" },
  slate:  { fg: "text-slate-700",   bg: "bg-slate-100",  border: "border-slate-200",  dot: "bg-slate-500" },
  silver: { fg: "text-slate-700",   bg: "bg-slate-100",  border: "border-slate-200",  dot: "bg-slate-500" },
  bronze: { fg: "text-amber-800",   bg: "bg-amber-50",   border: "border-amber-200",  dot: "bg-amber-600" },
};
const toneOf = (t) => TONES[t] || TONES.brand;

// คงชื่อ TONE ไว้เพื่อไม่ให้โค้ดเดิมพัง — ค่าเป็นสีที่คอนทราสต์ผ่านบนพื้นขาว
export const TONE = {
  purple: "#6D28D9",
  gold: "#B7791F",
  green: "#0E9F5F",
  blue: "#3452E0",
  red: "#D0362A",
  silver: "#475467",
  bronze: "#92400E",
};

const cx = (...a) => a.filter(Boolean).join(" ");

// ---------------------------------------------------------------
// Button — primary | secondary | danger | ghost | icon
// ---------------------------------------------------------------
export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  className = "",
  children,
  ...props
}) {
  const sizes = {
    sm: "text-xs px-3 py-1.5 gap-1.5",
    md: "text-sm px-4 py-2.5 gap-2",
    lg: "text-[15px] px-5 py-3 gap-2",
    icon: "p-2.5",
  };
  const variants = {
    primary: "ds-btn ds-btn-primary",
    secondary: "ds-btn ds-btn-secondary",
    danger: "ds-btn ds-btn-danger",
    ghost: "ds-btn ds-btn-ghost",
    icon: "ds-btn ds-btn-ghost",
  };
  const isIcon = variant === "icon";
  const iconPx = size === "lg" ? 18 : size === "sm" ? 14 : 16;
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center whitespace-nowrap select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant] || variants.secondary,
        isIcon ? sizes.icon : sizes[size],
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 size={iconPx} className="animate-spin" /> : Icon ? <Icon size={iconPx} /> : null}
      {!isIcon && children}
      {!isIcon && IconRight && <IconRight size={iconPx} />}
    </button>
  );
}

// ---------------------------------------------------------------
// Card — พื้นผิวหลัก
// quiet = พาเนลรองสำหรับแยกกลุ่มข้อมูลย่อยภายในการ์ดใบใหญ่
// ---------------------------------------------------------------
export function Card({ quiet = false, glass = false, hover = false, className = "", children, ...props }) {
  return (
    <div className={cx(quiet || glass ? "ds-card-glass" : "ds-card", hover && "ds-hover-lift", className)} {...props}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------
// SectionTitle — หัวข้อหน้า + คำอธิบาย + ช่องขวาสำหรับปุ่ม
// ---------------------------------------------------------------
export function SectionTitle({ eyebrow, title, subtitle, right, className = "" }) {
  return (
    <div className={cx("ds-section-title flex items-start justify-between gap-4 flex-wrap", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="ds-eyebrow mb-1.5">{eyebrow}</div>}
        <h2 className="ds-title text-[22px] sm:text-[26px]">{title}</h2>
        {subtitle && <p className="text-[13.5px] text-slate-500 mt-1.5 max-w-2xl leading-relaxed">{subtitle}</p>}
      </div>
      {right && <div className="ds-section-actions shrink-0">{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------
// StatCard — ตัวเลขสรุป
// ตัวเลขคือพระเอก: ใหญ่ อ่านชัด เป็น mono ให้เทียบกันเป็นคอลัมน์ได้
// ---------------------------------------------------------------
export function StatCard({ icon: Icon, label, value, sub, tone = "brand", delta, onClick }) {
  const t = toneOf(tone);
  const clickable = typeof onClick === "function";
  const deltaUp = typeof delta === "number" ? delta >= 0 : null;
  return (
    <div
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={cx("ds-card p-4 sm:p-5 flex flex-col gap-3", clickable && "ds-hover-lift cursor-pointer")}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px] text-slate-500 font-medium min-w-0 truncate">{label}</div>
        {Icon && (
          <span className={cx("rounded-control p-1.5 shrink-0", t.bg, t.fg)}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <div>
        <div className="ds-figure text-[26px] sm:text-[28px]">{value}</div>
        <div className="flex items-center gap-2 mt-1.5 min-h-[16px]">
          {typeof delta === "number" && (
            <span className={cx("text-2xs font-semibold", deltaUp ? "text-emerald-700" : "text-rose-700")}>
              {deltaUp ? "▲" : "▼"} {Math.abs(delta)}%
            </span>
          )}
          {sub && <span className="text-2xs text-slate-400 truncate">{sub}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Badge — ป้ายสถานะ
// ---------------------------------------------------------------
export function Badge({ tone = "brand", dot = false, children, className = "" }) {
  const t = toneOf(tone);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-2xs font-semibold px-2 py-0.5 rounded-full border",
        t.bg, t.fg, t.border,
        className
      )}
    >
      {dot && <span className={cx("w-1.5 h-1.5 rounded-full shrink-0", t.dot)} />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------
// SearchInput — ช่องค้นหาแบบแคปซูล (ใช้ร่วมกันทุกหน้าที่มีลิสต์ให้ค้น)
// ---------------------------------------------------------------
export function SearchInput({ className = "", inputClassName = "", ...props }) {
  return (
    <div className={cx("relative", className)}>
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        {...props}
        className={cx(
          "w-full rounded-full border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-50",
          inputClassName
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------
// FilterPill — ตัวกรองแบบแคปซูล เรียงแนวนอน (เลื่อนซ้ายขวาได้บนมือถือ)
// ---------------------------------------------------------------
export function FilterPill({ active = false, className = "", children, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium border whitespace-nowrap transition-colors",
        active ? "bg-brand-600 border-brand-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------
// ฟอร์ม
// ---------------------------------------------------------------
export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      {label && <span className="text-[12.5px] text-slate-600 font-medium">{label}</span>}
      <div className={label ? "mt-1.5" : ""}>{children}</div>
      {error ? (
        <span className="text-2xs text-rose-700 mt-1 block">{error}</span>
      ) : (
        hint && <span className="text-2xs text-slate-400 mt-1 block">{hint}</span>
      )}
    </label>
  );
}

// ช่องกรอกเดิมเขียนแค่ "border" ไม่ระบุสี จึงได้เส้นดำหนาตาม default ของเบราว์เซอร์
const fieldBase =
  "w-full rounded-control border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-50 " +
  "disabled:bg-slate-50 disabled:text-slate-400";

export function Input({ className = "", ...props }) {
  return <input className={cx(fieldBase, className)} {...props} />;
}
export function Textarea({ className = "", ...props }) {
  return <textarea className={cx(fieldBase, "resize-y", className)} {...props} />;
}
export function Select({ className = "", children, ...props }) {
  return (
    <select className={cx(fieldBase, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

// ---------------------------------------------------------------
// Toggle — สวิตช์
// สถานะปิดเดิมใช้พื้น rgba(255,255,255,.12) ซึ่งมองไม่เห็นเลยบนพื้นขาว
// ---------------------------------------------------------------
export function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="inline-flex items-center gap-2.5 group disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span
        className={cx(
          "relative w-10 h-6 rounded-full transition-colors shrink-0",
          checked ? "bg-brand-600" : "bg-slate-300"
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-4"
          )}
        />
      </span>
      {label && <span className="text-sm text-slate-700">{label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------
// Skeleton — สถานะโหลด
// ---------------------------------------------------------------
export function Skeleton({ className = "", w, h }) {
  return <div className={cx("ds-skeleton", className)} style={{ width: w, height: h }} />;
}

// ---------------------------------------------------------------
// EmptyState — ยังไม่มีข้อมูล
// ---------------------------------------------------------------
export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {Icon && (
        <div className="rounded-card p-3.5 mb-3.5 bg-slate-100 text-slate-400">
          <Icon size={26} />
        </div>
      )}
      <div className="ds-title text-[15px]">{title}</div>
      {hint && <div className="text-slate-500 text-[13px] mt-1.5 max-w-sm leading-relaxed">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
