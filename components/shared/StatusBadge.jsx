import { Badge } from "@/components/ui";

export default function StatusBadge({ status }) {
  const map = {
    pending_approval: ["รออนุมัติ", "bg-amber-100 text-amber-700"],
    rejected: ["ปฏิเสธแล้ว", "bg-slate-200 text-slate-600"],
    active: ["กำลังใช้งาน", "bg-emerald-100 text-emerald-700"],
    paused_auto: ["หยุดอัตโนมัติ", "bg-rose-100 text-rose-700"],
    paused_manual: ["หยุดโดยแอดมิน", "bg-slate-200 text-slate-600"],
    deleted_on_meta: ["ถูกลบในตัวจัดการโฆษณา", "bg-slate-200 text-slate-500"],
  };
  const [label] = map[status] || [status, "bg-slate-100 text-slate-600"];
  const tone = status === "active" ? "green" : status === "pending_approval" ? "gold" : status === "rejected" || status?.startsWith("paused") ? "red" : "slate";
  return <Badge tone={tone} dot>{label}</Badge>;
}
