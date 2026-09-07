// supabase/functions/manage-permissions/index.ts
// จัดการสิทธิ์ผู้ใช้ (เฉพาะ owner) — list / upsert / delete แถวใน user_permissions
// เช็คว่าผู้เรียกเป็นเจ้าของระบบจริงก่อน แล้วใช้ service role เขียน (ข้าม RLS)
//
// ทำไมต้องเป็น owner: บทบาท admin/ads เห็นหัวข้อตั้งค่าแค่ "ข้อความบันทึกไว้"
// ถ้ายังปล่อยให้เรียกฟังก์ชันนี้ได้ ก็ยกสิทธิ์ตัวเองเป็น owner ผ่าน API ตรง ๆ ได้ทันที

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest, normAcc } from "../_shared/permissions.ts";
import { errorResponse, readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { owner: true });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const myEmail = auth.user?.email?.toLowerCase();
    const { action, email, role, nickname, allowed_ad_accounts, allowed_tabs, allowed_pages, allowed_settings, chat_alert, alert_minutes, alert_pages, alert_sound, alert_new } = await readJsonBody(req, 64 * 1024);
    const targetEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (action === "list") {
      const { data, error } = await admin.from("user_permissions").select("email, role, nickname, allowed_ad_accounts, allowed_tabs, allowed_pages, allowed_settings, chat_alert, alert_minutes, alert_pages, alert_sound, alert_new, updated_at").order("role").order("email");
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, rows: data ?? [] }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    if (action === "upsert") {
      if (!targetEmail) throw new Error("ต้องระบุอีเมล");
      const ROLES = ["owner", "ads", "admin", "analyze_only"];
      const r = ROLES.includes(String(role)) ? String(role) : "admin";
      // กันเจ้าของระบบลดสิทธิ์ตัวเองจนเข้าหน้าสิทธิ์ผู้ใช้ไม่ได้อีก (ล็อกตัวเองออก)
      if (targetEmail === myEmail && r !== "owner") throw new Error("เปลี่ยนบทบาทตัวเองออกจาก owner ไม่ได้ — ให้ตั้ง owner คนอื่นก่อน");
      const acc = Array.isArray(allowed_ad_accounts) ? allowed_ad_accounts.map(normAcc) : [];
      const tabs = Array.isArray(allowed_tabs) ? allowed_tabs.map(String) : [];
      const pages = Array.isArray(allowed_pages) ? allowed_pages.map(String) : [];
      const setts = Array.isArray(allowed_settings) ? allowed_settings.map(String) : [];
      const { error } = await admin.from("user_permissions").upsert({
        email: targetEmail, role: r,
        nickname: typeof nickname === "string" ? nickname.trim() || null : null,
        // ลิสต์ที่มอบทีละอันใช้กับ analyze_only เท่านั้น — บทบาทอื่นสิทธิ์มาจากตัวบทบาทเอง
        allowed_ad_accounts: r === "analyze_only" ? acc : [],
        allowed_tabs: r === "analyze_only" ? tabs : [],
        allowed_pages: r === "analyze_only" ? pages : [],
        allowed_settings: r === "analyze_only" ? setts : [],
        chat_alert: chat_alert !== false, // สิทธิ์รับแจ้งเตือนแชทค้างอ่าน (ใช้ได้ทุกบทบาท)
        // ตั้งค่าแจ้งเตือนรายคน — ผู้ใช้ปรับเองไม่ได้ (แต่ละคนดูแลคนละเพจ จึงตั้งแยกอิสระ)
        alert_minutes: Math.min(120, Math.max(1, Number(alert_minutes) || 3)),
        alert_pages: Array.isArray(alert_pages) ? alert_pages.map(String) : [],
        alert_sound: alert_sound !== false,
        alert_new: alert_new !== false,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    if (action === "delete") {
      if (!targetEmail) throw new Error("ต้องระบุอีเมล");
      if (targetEmail === myEmail) throw new Error("ลบสิทธิ์ตัวเองไม่ได้");
      const { error } = await admin.from("user_permissions").delete().eq("email", targetEmail);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    throw new Error("action ไม่ถูกต้อง");
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
