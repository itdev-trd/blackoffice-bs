import {
  Sparkles,
  TrendingUp,
  BarChart3,
  ImageIcon,
  Wand2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Bell,
  MessageSquare,
  Database,
  Settings as SettingsIcon,
  Tv,
  Trophy,
  KeyRound,
} from "lucide-react";

// รายการหัวข้อในหน้าตั้งค่า — ใช้ร่วมกันระหว่าง SettingsTab (เมนู) และ panel อื่นๆ ที่อ้างอิงหัวข้อนี้
export const SETTINGS_SECTIONS = [
  { key: "general", label: "AI ช่วยตั้งค่า", icon: Sparkles, form: false },
  { key: "campaign", label: "ค่าเริ่มต้นแคมเปญ", icon: TrendingUp, form: true },
  { key: "decision", label: "เกณฑ์ตัดสินใจอัตโนมัติ", icon: BarChart3, form: true },
  { key: "brand", label: "แบรนด์ / โลโก้ / CI", icon: ImageIcon, form: true },
  { key: "ai_models", label: "โมเดล AI", icon: Wand2, form: true },
  { key: "ai_prompts", label: "คำสั่ง AI (Prompt)", icon: Sparkles, form: false },
  { key: "ghost", label: "ป้องกันแชทผี", icon: AlertTriangle, form: true },
  { key: "leadfields", label: "เพจที่ซิงก์แชท", icon: CheckCircle2, form: false },
  { key: "synccfg", label: "ตั้งค่าการซิงก์แชท", icon: RefreshCw, form: false },
  { key: "notifications", label: "แจ้งเตือน (Push)", icon: Bell, form: false },
  { key: "jobs", label: "งานอัตโนมัติ (ตั้งเวลา)", icon: RefreshCw, form: false },
  { key: "prefetch", label: "ดึงรีพอร์ตออโต้ (cache)", icon: BarChart3, form: false },
  { key: "savedreplies", label: "ข้อความบันทึกไว้", icon: MessageSquare, form: false },
  { key: "knowledge", label: "คลังคำถาม–คำตอบ", icon: Database, form: false },
  { key: "meta", label: "Meta Token", icon: SettingsIcon, form: false },
  { key: "openai_key", label: "OpenAI API Key", icon: KeyRound, form: false },
  { key: "line", label: "LINE OA", icon: MessageSquare, form: false },
  { key: "permissions", label: "สิทธิ์ผู้ใช้", icon: CheckCircle2, form: false },
  { key: "tv_settings", label: "ตั้งค่า TV", icon: Tv, form: false },
  { key: "replystats", label: "สถิติการตอบแชท", icon: BarChart3, form: false },
  { key: "leaderboard", label: "กระดานแต้ม", icon: Trophy, form: false },
  { key: "activity", label: "ประวัติการใช้งาน", icon: RefreshCw, form: false },
];

// ระยะสถานะลูกค้า — ใช้ร่วมกันระหว่าง settings (EditableCell/ActivityPanel) และ customerdb (CustomerDetailModal)
export const CHAT_STAGES = [
  { key: "new", label: "มาใหม่", cls: "bg-sky-100 text-sky-700" },
  { key: "qualified", label: "มีคุณสมบัติ", cls: "bg-amber-100 text-amber-700" },
  { key: "converted", label: "สร้างคอนเวอร์ชั่นแล้ว", cls: "bg-emerald-100 text-emerald-700" },
  { key: "account_opened", label: "ลูกค้าเปิดบัญชีใหม่", cls: "bg-indigo-100 text-indigo-700" },
  { key: "disqualified", label: "ไม่มีคุณสมบัติ", cls: "bg-rose-100 text-rose-700" },
];
