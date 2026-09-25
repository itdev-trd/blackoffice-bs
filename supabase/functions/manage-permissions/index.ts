// supabase/functions/manage-permissions/index.ts
// จัดการสิทธิ์ผู้ใช้ (เฉพาะ owner) — list / upsert / delete แถวใน user_permissions
// + reset_password: owner ตั้งรหัสผ่านใหม่ให้ผู้ใช้คนอื่น (ไม่ส่งอีเมล — owner เอารหัสไปบอกเอง)
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

// ตัดตัวที่อ่านสับสนออก (0/O, 1/l/I) เพราะ owner ต้องอ่านไปบอกต่อ
function randomPassword(len = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { owner: true });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const myEmail = auth.user?.email?.toLowerCase();
    const { action, email, password, role, nickname, allowed_ad_accounts, allowed_tabs, allowed_pages, allowed_settings, chat_alert, alert_minutes, alert_pages, alert_sound, alert_new } = await readJsonBody(req, 64 * 1024);
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

    if (action === "reset_password") {
      if (!targetEmail) throw new Error("ต้องระบุอีเมล");
      // รหัสตัวเองเปลี่ยนผ่านหน้าบัญชีตามปกติ — กันกดผิดแล้วล็อกตัวเองออกกลางคัน
      if (targetEmail === myEmail) throw new Error("รีเซ็ตรหัสของตัวเองจากหน้านี้ไม่ได้");
      // รีเซ็ตได้เฉพาะคนที่อยู่ในรายชื่อสิทธิ์ของระบบนี้ ไม่ใช่ทุกบัญชีในโปรเจกต์
      const { data: perm } = await admin.from("user_permissions").select("email").eq("email", targetEmail).maybeSingle();
      if (!perm) throw new Error("ไม่พบผู้ใช้นี้ในรายชื่อสิทธิ์");
      const given = typeof password === "string" ? password : "";
      if (given && (given.length < 8 || given.length > 72)) throw new Error("รหัสผ่านต้องยาว 8–72 ตัวอักษร");
      const newPassword = given || randomPassword();

      // หา user id จากอีเมล — listUsers ไม่มีตัวกรองอีเมล ต้องไล่ทีละหน้า
      let userId: string | null = null;
      for (let page = 1; page <= 20 && !userId; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const hit = data.users.find((u) => String(u.email || "").toLowerCase() === targetEmail);
        if (hit) userId = hit.id;
        if (data.users.length < 1000) break;
      }
      let created = false;
      if (userId) {
        const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
        if (error) throw error;
      } else {
        // มีสิทธิ์ในระบบแต่ยังไม่เคยมีบัญชีล็อกอิน = สร้างให้เลยด้วยรหัสนี้
        const { error } = await admin.auth.admin.createUser({ email: targetEmail, password: newPassword, email_confirm: true });
        if (error) throw error;
        created = true;
      }
      // เตะออกจากทุกเครื่องที่ล็อกอินค้างไว้ — รีเซ็ตมักเกิดเพราะลืมรหัสหรือรหัสรั่ว (ดู migration admin_revoke_user_sessions)
      let sessionsRevoked = 0;
      if (userId) {
        const { data: n, error: revErr } = await admin.rpc("admin_revoke_user_sessions", { target: userId });
        if (revErr) console.error("revoke sessions:", revErr.message);
        else sessionsRevoked = Number(n) || 0;
      }
      try {
        await admin.from("activity_log").insert({ email: myEmail, event: "reset_password", detail: { target: targetEmail, created, sessions_revoked: sessionsRevoked } });
      } catch { /* log พังไม่ควรทำให้การรีเซ็ตพัง */ }
      // คืนรหัสให้ owner ครั้งเดียวตอนนี้ — ระบบไม่เก็บรหัสไว้ที่ไหน
      return new Response(JSON.stringify({ ok: true, password: newPassword, created, sessions_revoked: sessionsRevoked }), { headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" } });
    }

    throw new Error("action ไม่ถูกต้อง");
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
