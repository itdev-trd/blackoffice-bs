// อ่านและบังคับสิทธิ์ของผู้ใช้ปัจจุบันจากตาราง user_permissions
// หลักสำคัญ: ไม่มีแถว / อ่านสิทธิ์ไม่ได้ = ปฏิเสธ (fail closed) ห้ามเดาเป็น admin
import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, requestClientKey } from "./security.ts";

export type Role = "owner" | "ads" | "admin" | "analyze_only";

export interface UserPermission {
  email: string;
  role: Role;
  allowed: string[];
  allowedTabs: string[];
  allowedPages: string[];
  allowedSettings: string[];
}

// สำเนากติกาบทบาทฝั่ง server — ต้องตรงกับ lib/constants/roles.js และ public.app_role_tabs()
// (มีสามที่เพราะบังคับสิทธิ์กันสามชั้น: หน้าเว็บซ่อนเมนู · edge function ปฏิเสธคำขอ · RLS กันที่ข้อมูล)
const ROLES: Role[] = ["owner", "ads", "admin", "analyze_only"];
const ADMIN_TABS = ["overview", "inbox", "ad_chats", "feed", "customerdb", "customer_list", "leaderboard", "settings"];
const OPERATOR_SETTINGS = ["savedreplies"];

// เมนูที่บทบาทนั้นเข้าได้ — null = ทุกเมนู
const tabsOf = (permission: UserPermission): string[] | null => {
  if (permission.role === "owner" || permission.role === "ads") return null;
  if (permission.role === "admin") return ADMIN_TABS;
  return permission.allowedTabs;
};

// หัวข้อตั้งค่าที่บทบาทนั้นแก้ได้ — null = ทุกหัวข้อ
const settingsOf = (permission: UserPermission): string[] | null => {
  if (permission.role === "owner") return null;
  if (permission.role === "admin" || permission.role === "ads") return OPERATOR_SETTINGS;
  return permission.allowedSettings;
};

// "มีอำนาจกับข้อมูลเต็มที่" — ตอบแชททุกเพจ แก้ข้อมูลลูกค้า ให้สิทธิ์ TradingView
// แยกจาก "เห็นเมนูอะไร" เพราะแอดมินตอบแชทเห็นเมนูน้อยกว่า owner แต่ทำงานลูกค้าได้เต็มที่
export const hasFullData = (permission: UserPermission) => permission.role !== "analyze_only";
export const isOwner = (permission: UserPermission) => permission.role === "owner";

// ทำให้ account id เป็นตัวเลขล้วน (ตัด act_ ออก) เพื่อเทียบกัน
export const normAcc = (v: unknown) => String(v ?? "").replace(/^act_/, "");

export async function getPermission(supabaseAsUser: SupabaseClient): Promise<UserPermission | null> {
  const { data: userData, error: userError } = await supabaseAsUser.auth.getUser();
  const user = userData?.user;
  if (userError || !user?.email) return null;
  const { data, error } = await supabaseAsUser
    .from("user_permissions")
    .select("role, allowed_ad_accounts, allowed_tabs, allowed_pages, allowed_settings")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();
  if (error || !data || !ROLES.includes(data.role as Role)) return null;
  const role = data.role as Role;
  return {
    email: user.email.toLowerCase(),
    role,
    allowed: Array.isArray(data.allowed_ad_accounts) ? data.allowed_ad_accounts.map(normAcc) : [],
    allowedTabs: Array.isArray(data.allowed_tabs) ? data.allowed_tabs.map(String) : [],
    allowedPages: Array.isArray(data.allowed_pages) ? data.allowed_pages.map(String) : [],
    allowedSettings: Array.isArray(data.allowed_settings) ? data.allowed_settings.map(String) : [],
  };
}

export interface PermissionRequirement {
  admin?: boolean;
  owner?: boolean;
  tab?: string | string[];
  setting?: string | string[];
  pageId?: string | null;
  accountId?: string | null;
  allowService?: boolean;
}

export type AuthorizationResult =
  | { ok: true; isService: boolean; user: User | null; client: SupabaseClient | null; permission: UserPermission | null }
  | { ok: false; status: 401 | 403 | 413 | 429; error: string; retryAfter?: number };

const includesAny = (actual: string[], wanted?: string | string[]) => {
  if (!wanted) return true;
  const list = Array.isArray(wanted) ? wanted : [wanted];
  return list.some((item) => actual.includes(item));
};

export const canAccessPage = (permission: UserPermission, pageId?: string | null) =>
  hasFullData(permission) || (!!pageId && permission.allowedPages.includes(String(pageId)));

export const canAccessAccount = (permission: UserPermission, accountId?: string | null) =>
  hasFullData(permission) || (!!accountId && permission.allowed.includes(normAcc(accountId)));

export async function authorizeRequest(
  req: Request,
  requirement: PermissionRequirement = {},
): Promise<AuthorizationResult> {
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const declaredBytes = Number(req.headers.get("content-length") || 0);
  const maxDeclaredBytes = Math.min(16 * 1024 * 1024, Math.max(64 * 1024, Number(Deno.env.get("APP_MAX_REQUEST_BYTES")) || 10 * 1024 * 1024));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxDeclaredBytes) {
    return { ok: false, status: 413, error: "ข้อมูลคำขอมีขนาดใหญ่เกินไป" };
  }

  if (requirement.allowService && bearer && serviceKey && bearer === serviceKey) {
    const serviceLimit = checkRateLimit(requestClientKey(req, "service"), {
      limit: Number(Deno.env.get("APP_SERVICE_RATE_LIMIT_PER_MINUTE")) || 600,
    });
    if (!serviceLimit.ok) {
      return { ok: false, status: 429, error: "คำขอมากเกินไป กรุณาลองใหม่ภายหลัง", retryAfter: serviceLimit.retryAfter };
    }
    return { ok: true, isService: true, user: null, client: null, permission: null };
  }

  // Limit unauthenticated/invalid-token traffic before calling Supabase Auth.
  // Otherwise a flood of bad JWTs can spend server/Auth capacity even though
  // every request will eventually be rejected.
  const preAuthLimit = checkRateLimit(requestClientKey(req, "preauth"), {
    limit: Number(Deno.env.get("APP_UNAUTH_RATE_LIMIT_PER_MINUTE")) || 60,
  });
  if (!preAuthLimit.ok) {
    return { ok: false, status: 429, error: "คำขอมากเกินไป กรุณาลองใหม่ภายหลัง", retryAfter: preAuthLimit.retryAfter };
  }
  if (!bearer) return { ok: false, status: 401, error: "unauthorized" };

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) return { ok: false, status: 401, error: "unauthorized" };

  const limit = checkRateLimit(requestClientKey(req, userData.user.email?.toLowerCase() || userData.user.id));
  if (!limit.ok) {
    return { ok: false, status: 429, error: "คำขอมากเกินไป กรุณาลองใหม่ภายหลัง", retryAfter: limit.retryAfter };
  }

  const permission = await getPermission(client);
  if (!permission) return { ok: false, status: 403, error: "ยังไม่ได้รับสิทธิ์ใช้งาน" };
  // requirement.admin = "งานระดับผู้ดูแล" — ผ่านได้ทุกบทบาทที่มีอำนาจกับข้อมูลเต็มที่
  // ตัวที่คุมจริงว่าใครแตะการตั้งค่าไหนได้คือ requirement.setting ด้านล่าง
  if (requirement.admin && !hasFullData(permission)) {
    return { ok: false, status: 403, error: "เฉพาะผู้ดูแลระบบเท่านั้น" };
  }
  if (requirement.owner && !isOwner(permission)) {
    return { ok: false, status: 403, error: "เฉพาะเจ้าของระบบ (owner) เท่านั้น" };
  }
  const tabs = tabsOf(permission);
  if (tabs !== null && !includesAny(tabs, requirement.tab)) {
    return { ok: false, status: 403, error: "ไม่มีสิทธิ์ใช้งานเมนูนี้" };
  }
  const settings = settingsOf(permission);
  if (settings !== null && !includesAny(settings, requirement.setting)) {
    return { ok: false, status: 403, error: "ไม่มีสิทธิ์แก้การตั้งค่านี้" };
  }
  if (requirement.pageId && !canAccessPage(permission, requirement.pageId)) {
    return { ok: false, status: 403, error: "ไม่มีสิทธิ์เข้าถึงเพจนี้" };
  }
  if (requirement.accountId && !canAccessAccount(permission, requirement.accountId)) {
    return { ok: false, status: 403, error: "ไม่มีสิทธิ์เข้าถึงบัญชีโฆษณานี้" };
  }

  return { ok: true, isService: false, user: userData.user, client, permission };
}
