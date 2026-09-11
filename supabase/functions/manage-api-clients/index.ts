// supabase/functions/manage-api-clients/index.ts
// จัดการคีย์ของ API ภายนอก (crm-customers) จากหน้าเว็บ — เฉพาะ owner
// เดิมต้องออกคีย์ผ่าน SQL Editor เอง (สุ่มคีย์ + sha256 + insert ด้วยมือ) ย้ายมาไว้ที่นี่
// เพื่อไม่ต้องแตะ Supabase โดยตรง — logic เดียวกันทุกอย่าง แค่ทำให้กดจากเว็บได้
//
//   action "list"    -> รายชื่อคีย์ทั้งหมด (ไม่มีคีย์ตัวจริง มีแต่ scopes/สถานะ)
//   action "create"  -> สุ่มคีย์ใหม่ เก็บแค่ sha256 ไว้ใน DB คืนคีย์ตัวจริงกลับไปครั้งเดียว
//   action "revoke"  -> เพิกถอนคีย์ (revoked_at) มีผลทันทีในคำขอถัดไปของ crm-customers
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { errorResponse, readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

// ต้องตรงกับ scope ที่ crm-customers เช็คจริง (ดู supabase/functions/crm-customers/index.ts)
// เพิ่ม scope ใหม่ในอนาคตต้องแก้ทั้งสองที่ — คีย์ที่ตั้งชื่อ scope ผิดจะเงียบและไม่มีผลอะไร
const VALID_SCOPES = ["tradingview:read", "customers:read", "customers:transcript"];
const MAX_NAME_LEN = 80;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // เฉพาะ owner — คีย์นี้เปิดทางให้ระบบภายนอกดึงข้อมูลลูกค้าออกไปได้ ไม่ใช่งานที่ admin ทั่วไปควรกดเอง
    const auth = await authorizeRequest(req, { owner: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await readJsonBody(req, 8 * 1024);
    const action = String(body?.action || "list");

    if (action === "list") {
      const { data, error } = await admin
        .from("api_clients")
        .select("id, name, scopes, created_at, last_used_at, revoked_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ ok: true, rows: data ?? [] });
    }

    if (action === "create") {
      const name = String(body?.name || "").trim().slice(0, MAX_NAME_LEN);
      if (!name) return json({ ok: false, error: "ต้องตั้งชื่อผู้เรียก (เช่น besight-crm)" }, 400);
      const scopes = Array.isArray(body?.scopes) ? [...new Set(body.scopes.map(String))] : [];
      if (!scopes.length) return json({ ok: false, error: "ต้องเลือกสิทธิ์ (scope) อย่างน้อย 1 อย่าง" }, 400);
      const bad = scopes.filter((s: string) => !VALID_SCOPES.includes(s));
      if (bad.length) return json({ ok: false, error: `ไม่รู้จักสิทธิ์: ${bad.join(", ")}` }, 400);
      if (scopes.includes("customers:transcript") && !scopes.includes("customers:read")) {
        return json({ ok: false, error: "สิทธิ์ดูบทสนทนาเต็มต้องใช้คู่กับสิทธิ์ดูข้อมูลลูกค้า" }, 400);
      }

      // สุ่มคีย์ 256 บิต แล้วเก็บแค่ hash — ตัวจริงคืนให้ครั้งนี้ครั้งเดียว ดูย้อนไม่ได้อีกแล้ว
      const keyBytes = crypto.getRandomValues(new Uint8Array(32));
      const key = "crm_" + btoa(String.fromCharCode(...keyBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const keyHash = await sha256Hex(key);

      const { data, error } = await admin
        .from("api_clients")
        .insert({ name, scopes, key_hash: keyHash })
        .select("id, name, scopes, created_at")
        .single();
      if (error) throw error;

      return json({ ok: true, key, client: data });
    }

    if (action === "revoke") {
      const id = String(body?.id || "");
      if (!id) return json({ ok: false, error: "ต้องระบุ id" }, 400);
      const { data, error } = await admin
        .from("api_clients")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .is("revoked_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return json({ ok: true, revoked: !!data });
    }

    return json({ ok: false, error: "action ไม่ถูกต้อง" }, 400);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
