// =====================================================================
// AI Ads Automation — Component Library (Design System)
// "Dark Luxury Fintech" — ชุด component กลางที่ทุกหน้าใช้ร่วมกัน
// โทเคนสี/รัศมี/เงา อยู่ใน index.css (:root + .ds-*)
// นำเข้าใช้: import { Button, Card, StatCard, ... } from "./ui.jsx";
// =====================================================================
import React from "react";
import { Loader2 } from "lucide-react";

// พาเลตต์ accent (ตรงกับ --token ใน index.css) สำหรับ tile/แถบสีที่ต้องเป๊ะ
export const TONE = {
  purple: "#9D6BFF",
  gold:   "#F7C948",
  green:  "#1ED760",
  blue:   "#4E8CFF",
  red:    "#FF5C5C",
  silver: "#C9D3E2",
  bronze: "#C8894B",
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
        "disabled:opacity-45 disabled:cursor-not-allowed active:scale-[.98]",
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
// Card — พื้นผิวหลัก (glass ได้ / ยกเมื่อ hover ได้)
// ---------------------------------------------------------------
export function Card({ glass = false, hover = false, className = "", children, ...props }) {
  return (
    <div
      className={cx(glass ? "ds-card-glass" : "ds-card", hover && "ds-hover-lift", className)}
      {...props}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------
// SectionTitle — หัวข้อ section + คำอธิบาย + ช่องขวา (action)
// ---------------------------------------------------------------
export function SectionTitle({ eyebrow, title, subtitle, right, className = "" }) {
  return (
    <div className={cx("flex items-end justify-between gap-3 mb-5", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="ds-eyebrow mb-2.5">{eyebrow}</div>}
        <h2 className="ds-title text-[22px] sm:text-[27px] truncate">{title}</h2>
        {subtitle && <p className="text-[13px] text-slate-500 mt-2 max-w-xl leading-relaxed">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------
// StatCard — การ์ดสถิติพรีเมียม (icon tile + ตัวเลขใหญ่ + เดลตา)
// ---------------------------------------------------------------
export function StatCard({ icon: Icon, label, value, sub, tone = "purple", delta, onClick }) {
  const color = TONE[tone] || TONE.purple;
  const clickable = typeof onClick === "function";
  const deltaUp = typeof delta === "number" ? delta >= 0 : null;
  return (
    <div
      onClick={onClick}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={cx(
        "ds-card p-5 flex flex-col gap-3 relative overflow-hidden",
        clickable && "ds-hover-lift cursor-pointer focus:outline-none"
      )}
      style={clickable ? { outlineColor: color } : undefined}
    >
      {/* แสงเรืองมุมบนขวา */}
      <div className="pointer-events-none absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-20" style={{ background: color }} />
      <div className="flex items-center justify-between">
        <div className="rounded-xl p-2.5 flex items-center justify-center" style={{ background: `${color}1f`, color }}>
          <Icon size={20} />
        </div>
        {typeof delta === "number" && (
          <span className="text-[11px] font-semibold px-2 py-1 rounded-full"
            style={{ background: `${deltaUp ? TONE.green : TONE.red}1f`, color: deltaUp ? TONE.green : TONE.red }}>
            {deltaUp ? "▲" : "▼"} {Math.abs(delta)}%
          </span>
        )}
      </div>
      <div>
        <div className="text-[10.5px] uppercase tracking-[.18em] text-slate-500 font-semibold">{label}</div>
        <div className="text-[28px] leading-none font-bold text-white mt-1.5 tabular-nums tracking-tight">{value}</div>
        {sub && <div className="text-[12px] text-slate-500 mt-1.5">{sub}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Badge / Pill
// ---------------------------------------------------------------
export function Badge({ tone = "purple", children, className = "" }) {
  const color = TONE[tone] || TONE.purple;
  return (
    <span
      className={cx("inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full", className)}
      style={{ background: `${color}1f`, color }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------
// Input / Textarea — มี label ลอย
// ---------------------------------------------------------------
export function Field({ label, hint, children }) {
  return (
    <label className="block">
      {label && <span className="text-[13px] text-slate-400 font-medium">{label}</span>}
      <div className={label ? "mt-1.5" : ""}>{children}</div>
      {hint && <span className="text-[11px] text-slate-500 mt-1 block">{hint}</span>}
    </label>
  );
}
export function Input({ className = "", ...props }) {
  return <input className={cx("w-full rounded-xl px-3.5 py-2.5 text-sm border", className)} {...props} />;
}
export function Textarea({ className = "", ...props }) {
  return <textarea className={cx("w-full rounded-xl px-3.5 py-2.5 text-sm border", className)} {...props} />;
}

// ---------------------------------------------------------------
// Toggle — สวิตช์
// ---------------------------------------------------------------
export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      onClick={() => onChange?.(!checked)}
      className="inline-flex items-center gap-2.5 group"
    >
      <span
        className="relative w-10 h-6 rounded-full transition-colors"
        style={{ background: checked ? TONE.purple : "rgba(255,255,255,.12)" }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "none" }}
        />
      </span>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------
// Skeleton — โหลดแบบ shimmer
// ---------------------------------------------------------------
export function Skeleton({ className = "", w, h }) {
  return <div className={cx("ds-skeleton", className)} style={{ width: w, height: h }} />;
}

// ---------------------------------------------------------------
// EmptyState — สถานะว่างแบบพรีเมียม
// ---------------------------------------------------------------
export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {Icon && (
        <div className="rounded-2xl p-4 mb-4" style={{ background: "rgba(157,107,255,.10)", color: TONE.purple }}>
          <Icon size={28} />
        </div>
      )}
      <div className="text-white font-semibold text-[15px]">{title}</div>
      {hint && <div className="text-slate-500 text-[13px] mt-1 max-w-sm">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
