export default function BrandMark({ className = "h-8 w-8", boxed = true }) {
  return (
    <span className={`brand-mark-surface inline-flex shrink-0 items-center justify-center overflow-hidden ${boxed ? "rounded-xl p-1.5 shadow-sm" : ""} ${className}`}>
      <img src="/besight-logo.svg" alt="Besight" className="h-full w-full object-contain" />
    </span>
  );
}
