// เพจที่ระบบแชทใช้งาน
//   หลัก = BeSight (เพจ Facebook + LINE OA ของ BeSight) — ทุกคนที่มีสิทธิ์แชทเห็น
//   เพิ่มเติม = เพจที่ owner ตั้ง "คนที่เห็นแชท" ไว้ (page_lead_config.chat_viewers) เช่น Jr 1Shot
//     เห็นเฉพาะคนในรายชื่อ — ข้อมูลกันจริงด้วย RLS (app_hidden_chat_pages) ตรงนี้แค่ให้หน้าเว็บรู้ว่าต้องโชว์เพจไหน
//   token ตอบแชทเห็นเพจของธุรกิจอื่นอีก 20+ เพจ — เพจที่ไม่อยู่ในสองกลุ่มนี้ห้ามโผล่ในหน้าแชท/รีพอร์ต
import { supabase } from "@/lib/supabase/client";

export const BESIGHT_PAGE_ID = "438134449376109";
export const BESIGHT_LINE_OA_ID = "line:U548349abdb0b1b38b650bbbf3f64a78d";
export const CHAT_PAGE_IDS = [BESIGHT_PAGE_ID, BESIGHT_LINE_OA_ID];

// เพจเพิ่มเติมที่ผู้ใช้คนนี้เห็น + เพจดูอย่างเดียว (โหลดครั้งเดียวต่อการเปิดแอป)
let extraIds = [];
let readOnlyIds = new Set();
let loading = null;

export function loadChatPageAccess() {
  if (loading) return loading;
  loading = (async () => {
    const [{ data: u }, { data: rows }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("page_lead_config").select("page_id, page_name, chat_viewers, chat_read_only").not("chat_viewers", "is", null),
    ]);
    const me = String(u?.user?.email || "").toLowerCase();
    const mine = (rows || []).filter((r) => (r.chat_viewers || []).map((v) => String(v).toLowerCase()).includes(me));
    extraIds = mine.map((r) => String(r.page_id));
    readOnlyIds = new Set((rows || []).filter((r) => r.chat_read_only).map((r) => String(r.page_id)));
    return { extra: mine.map((r) => ({ id: String(r.page_id), name: r.page_name || String(r.page_id), readOnly: !!r.chat_read_only })) };
  })().catch(() => { loading = null; return { extra: [] }; });
  return loading;
}

export const chatPageIds = () => [...CHAT_PAGE_IDS, ...extraIds];
export const isChatPage = (id) => chatPageIds().includes(String(id || ""));
// เพจดูอย่างเดียว: ดึงมาสรุปข้อมูล ตอบ/ติดป้าย/ส่งสถานะกลับ Meta ไม่ได้ (ฝั่ง server บังคับซ้ำ)
export const isReadOnlyChatPage = (id) => readOnlyIds.has(String(id || ""));
