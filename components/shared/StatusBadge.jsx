export default function StatusBadge({ status }) {
  const map = {
    pending_approval: ["รออนุมัติ", "bg-amber-100 text-amber-700"],
    rejected: ["ปฏิเสธแล้ว", "bg-slate-200 text-slate-600"],
    active: ["กำลังใช้งาน", "bg-emerald-100 text-emerald-700"],
    paused_auto: ["หยุดอัตโนมัติ", "bg-rose-100 text-rose-700"],
    paused_manual: ["หยุดโดยแอดมิน", "bg-slate-200 text-slate-600"],
    deleted_on_meta: ["ถูกลบในตัวจัดการโฆษณา", "bg-slate-200 text-slate-500"],
  };
  const [label, cls] = map[status] || [status, "bg-slate-100 text-slate-600"];
  return <span className={`text-xs px-2 py-1 rounded-full font-medium ${cls}`}>{label}</span>;
}
