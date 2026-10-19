// กติกาการมองเห็นแชทรายเพจ (page_lead_config.chat_viewers / chat_read_only) — ฝั่ง edge function
// คู่กับ RLS public.app_hidden_chat_pages() ใน migration 20261019 (ฟังก์ชันที่ใช้ service role ข้าม RLS ต้องเช็คเอง)
//   chat_viewers = อีเมลที่เห็นแชทเพจนั้น · null = ทุกคนที่มีสิทธิ์แชท (ใช้กับทุกบทบาทรวม owner)
//   chat_read_only = ไม่ตอบแชทจากแอป: ตอบไม่ได้ ไม่ติดยังไม่อ่าน/แจ้งเตือน ไม่นับสถิติ/แต้ม
//     (ป้าย/สถานะยังส่งไป Meta ได้ตามปกติ — Danai ยืนยันเปิดให้ Jr 1Shot 19 ต.ค. 69)
export type ChatPageRules = { viewers: Map<string, string[]>; readOnly: Set<string> };

export async function loadChatPageRules(admin: any): Promise<ChatPageRules> {
  const { data } = await admin.from("page_lead_config").select("page_id, chat_viewers, chat_read_only");
  const viewers = new Map<string, string[]>();
  const readOnly = new Set<string>();
  for (const r of data ?? []) {
    const id = String(r.page_id);
    if (Array.isArray(r.chat_viewers)) viewers.set(id, r.chat_viewers.map((v: unknown) => String(v).toLowerCase()));
    if (r.chat_read_only === true) readOnly.add(id);
  }
  return { viewers, readOnly };
}

// email = null คือ service role/cron — เห็นทุกเพจ
export function canSeeChatPage(rules: ChatPageRules, pageId: unknown, email: string | null | undefined): boolean {
  if (email == null) return true;
  const list = rules.viewers.get(String(pageId ?? ""));
  return !list || list.includes(String(email).toLowerCase());
}

export const isReadOnlyChatPage = (rules: ChatPageRules, pageId: unknown) => rules.readOnly.has(String(pageId ?? ""));

// เพจที่อีเมลนี้มองไม่เห็น — ใช้กรอง query ของ service role
export const hiddenChatPages = (rules: ChatPageRules, email: string | null | undefined) =>
  email == null ? [] : [...rules.viewers.keys()].filter((id) => !canSeeChatPage(rules, id, email));

export const READ_ONLY_ERROR = "เพจนี้ตั้งเป็น \"ดูอย่างเดียว\" — ดึงแชทมาไว้สรุปข้อมูล ตอบแชทจากแอปไม่ได้";
