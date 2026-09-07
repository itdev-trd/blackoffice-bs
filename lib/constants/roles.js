// สิทธิ์ตามบทบาท (role) — ที่เดียวที่กำหนดว่าแต่ละบทบาทเห็นเมนูอะไรและตั้งค่าอะไรได้
//
// ทำไมต้องรวมไว้ไฟล์เดียว: เดิมมีแค่ "admin (เห็นทุกอย่าง)" กับ "analyze_only (เลือกเมนูเอง)"
// เงื่อนไขจึงกระจายอยู่ทั้งใน DashboardContext, SettingsTab, edge function และ RLS
// พอเพิ่มบทบาทใหม่ ถ้าไม่รวมไว้ที่เดียวจะหลุดสักที่แน่นอน แล้วสิทธิ์จะไม่ตรงกันระหว่างหน้าเว็บกับ server
//
// ฝั่งฐานข้อมูลมีสำเนาของกติกาเดียวกันอยู่ใน public.app_role_tabs() / app_has_setting()
// (ดู migration 20260907_role_owner_admin_ads) — แก้ที่นี่แล้วต้องแก้ที่นั้นด้วย
export const ROLE_OWNER = "owner";
export const ROLE_ADS = "ads";
export const ROLE_ADMIN = "admin";
export const ROLE_LIMITED = "analyze_only";

export const ROLES = [
  { key: ROLE_OWNER, label: "เจ้าของระบบ", hint: "ทำได้ทุกอย่าง เห็นทุกเมนูและทุกหัวข้อตั้งค่า" },
  { key: ROLE_ADS, label: "ยิงแอด", hint: "เห็นทุกเมนู · ตั้งค่าเห็นแค่ข้อความบันทึกไว้" },
  { key: ROLE_ADMIN, label: "แอดมินตอบแชท", hint: "เมนูงานลูกค้า · ตั้งค่าเห็นแค่ข้อความบันทึกไว้ · ตอบแชท/แก้ข้อมูล/ให้สิทธิ์ TradingView ได้เต็มที่" },
  { key: ROLE_LIMITED, label: "จำกัดสิทธิ์ (เลือกเมนู/เพจ/บัญชีเอง)", hint: "กำหนดเมนู เพจ บัญชีโฆษณา และหัวข้อตั้งค่าเองทีละอัน" },
];

// เมนูที่บทบาท "แอดมินตอบแชท" เห็น — งานลูกค้าทั้งหมด แต่ไม่เห็นงานยิงโฆษณา
// (settings อยู่ในลิสต์เพราะยังต้องเข้าไปแก้ข้อความบันทึกไว้ได้ แต่เห็นหัวข้อเดียว)
export const ADMIN_TABS = [
  "overview", "inbox", "ad_chats", "feed", "customerdb", "customer_list", "leaderboard", "settings",
];

// หัวข้อตั้งค่าที่ทั้ง "แอดมินตอบแชท" และ "ยิงแอด" เข้าได้ — มีแค่ข้อความบันทึกไว้
export const OPERATOR_SETTINGS = ["savedreplies"];

// บทบาทที่มีอำนาจกับข้อมูลลูกค้าเต็มที่ (ตอบแชททุกเพจ แก้ข้อมูล ให้สิทธิ์ TradingView)
// ต่างจาก "เห็นเมนูอะไร" — บทบาทเห็นเมนูน้อยลงได้ แต่ยังทำงานกับลูกค้าได้เต็มที่
export const FULL_DATA_ROLES = [ROLE_OWNER, ROLE_ADMIN, ROLE_ADS];

export const isKnownRole = (role) => ROLES.some((r) => r.key === role);
export const hasFullData = (role) => FULL_DATA_ROLES.includes(role);

// เมนูที่บทบาทนั้นเห็น — null = เห็นทุกเมนู (ไม่ต้องกรอง)
export function roleTabs(role, allowedTabs = []) {
  if (role === ROLE_OWNER || role === ROLE_ADS) return null;
  if (role === ROLE_ADMIN) return ADMIN_TABS;
  return Array.isArray(allowedTabs) ? allowedTabs.map(String) : [];
}

// หัวข้อตั้งค่าที่บทบาทนั้นเข้าได้ — null = ทุกหัวข้อ
export function roleSettings(role, allowedSettings = []) {
  if (role === ROLE_OWNER) return null;
  if (role === ROLE_ADMIN || role === ROLE_ADS) return OPERATOR_SETTINGS;
  return Array.isArray(allowedSettings) ? allowedSettings.map(String) : [];
}
