// เพจที่ระบบแชทใช้งาน — BeSight เท่านั้น (เพจ Facebook + LINE OA ของ BeSight)
// token ตอบแชทเห็นเพจของธุรกิจอื่นอีก 20+ เพจ และ page_lead_config มีแถวของเพจพวกนั้นด้วย
// ตัวเลือกเพจในหน้าแชท/รีพอร์ตแชทต้องกรองด้วยรายการนี้เสมอ (ดู CLAUDE.md · getChatPages ฝั่ง edge function)
export const BESIGHT_PAGE_ID = "438134449376109";
export const BESIGHT_LINE_OA_ID = "line:U548349abdb0b1b38b650bbbf3f64a78d";
export const CHAT_PAGE_IDS = [BESIGHT_PAGE_ID, BESIGHT_LINE_OA_ID];
export const isChatPage = (id) => CHAT_PAGE_IDS.includes(String(id || ""));
