// supabase/functions/meta-stage-write/index.ts
// เขียนช่อง "ระยะข้อมูลลูกค้า" (Lead stage) ใน Meta Business Suite ผ่าน API ภายในของหน้าเว็บ
//
//   { action: "save_curl", curl, sample_thread_id, sample_stage } -> ถอดค่าจากคำสั่ง cURL แล้วเก็บใน Vault
//   { action: "status" }                                          -> ตั้งค่าครบไหม จับเมื่อไหร่ (ไม่คืนค่าลับ)
//   { action: "clear" }                                           -> ลบค่าที่เก็บไว้
//   { action: "set_stage", id, stage }                            -> เปลี่ยนระยะของห้องแชทนั้น
//
// ทำไมต้องใช้วิธีนี้: Meta ไม่เปิด API ให้เขียนช่องนี้เลย ตรวจปิดประตูครบแล้ว
//   /{page}/lead_stages · /crm_lead_stages · /leads · /messaging_leads · /lead_records
//   /{business}/leads_center · /crm_integration → Unknown path ทั้งหมด
//   อ่าน dataset object → "Owner business must be on whitelist" · introspection ปิดใน v22
//
// ═══ การจำกัดความเสียหายของคุกกี้ ═══
// คุกกี้ Facebook เป็นสิทธิ์ "ทั้งบัญชี" โดยธรรมชาติ — Meta ไม่มีคุกกี้แบบจำกัดสิทธิ์ให้
// สิ่งที่ทำได้คือล็อกไม่ให้ใครอ่านมันออกไป และล็อกไม่ให้มันถูกใช้ทำอย่างอื่น:
//
//   1. เก็บใน Supabase Vault (เข้ารหัส) ผ่าน app_set_bizsuite_config()
//      อ่านได้เฉพาะ service_role — authenticated/anon เรียกฟังก์ชันอ่านไม่ได้เลย
//      แม้เป็น owner ที่ล็อกอินอยู่ก็อ่านไม่ได้ · ดัมป์ตารางออกไปก็ได้แต่ ciphertext
//   2. ไม่มี action ไหนคืนคุกกี้/body กลับหน้าเว็บ (status คืนแค่ความยาวกับวันที่)
//   3. URL ต้องเป็นโดเมนของ Meta เท่านั้น (ALLOWED_HOSTS) — กันคุกกี้ถูกส่งไปที่อื่น
//      ถ้าเผลอวาง cURL ของเว็บอื่น ระบบปฏิเสธตั้งแต่ตอนบันทึก
//   4. ค่าที่แทนลง body ได้มีแค่สองอย่าง: รหัสห้องที่มีจริงในฐานข้อมูล
//      และชื่อระยะที่อยู่ใน ALLOWED_STAGES เท่านั้น — ยัดค่าอื่นเข้าไปไม่ได้
//   5. body ที่ส่งออกใช้ template ที่จับมาเสมอ ผู้เรียกส่ง body เองไม่ได้
//      จึงทำได้แค่ "เปลี่ยนระยะ" ไม่สามารถใช้ช่องทางนี้ยิงคำขออื่นของ Facebook
//   6. บันทึก activity_log ทุกครั้งว่าใครเปลี่ยนห้องไหนเป็นระยะอะไร ผลเป็นอย่างไร
//   7. ข้อความ error ที่คืนกลับถูกกรองคำที่อาจเป็นค่าลับออกก่อน (scrub)
//
// ข้อจำกัดที่เหลืออยู่จริง: doc_id ของ Meta เปลี่ยนเมื่อเขาปล่อยเวอร์ชันใหม่ → พังเป็นระยะ
// ออกแบบให้จับ cURL ใหม่มาวางเองได้ ไม่ต้องแก้โค้ด · และเป็นทางเสริม ไม่ใช่ทางหลัก
// (ป้ายกำกับกับ CAPI ยังทำงานแยก ตัวนี้พังไม่ลากอย่างอื่นพัง)
//
// deploy: supabase functions deploy meta-stage-write

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// คุกกี้ถูกส่งไปได้เฉพาะโดเมนเหล่านี้
const ALLOWED_HOSTS = new Set(["business.facebook.com", "www.facebook.com", "web.facebook.com", "facebook.com"]);

// ชื่อระยะที่ยอมให้แทนลง body — ต้องตรงกับ CHAT_STAGES และกับชื่อใน Leads Center
const ALLOWED_STAGES = new Set(["มาใหม่", "มีคุณสมบัติ", "สร้างคอนเวอร์ชั่นแล้ว", "ลูกค้าเปิดบัญชีใหม่", "ไม่มีคุณสมบัติ"]);
const STAGE_BY_KEY: Record<string, string> = {
  new: "มาใหม่",
  qualified: "มีคุณสมบัติ",
  converted: "สร้างคอนเวอร์ชั่นแล้ว",
  account_opened: "ลูกค้าเปิดบัญชีใหม่",
  disqualified: "ไม่มีคุณสมบัติ",
};

type StageConfig = {
  url: string;
  cookie: string;
  headers: Record<string, string>;
  body_template: string;
  sample_thread_id: string;
  sample_stage: string;
  captured_at: string;
};

/** ถอดค่าจากคำสั่ง cURL ที่ก๊อบจาก DevTools ("Copy as cURL") — รับทั้งแบบ bash และ cmd */
function parseCurl(curl: string): { url: string; cookie: string; headers: Record<string, string>; body: string } {
  const text = String(curl || "").replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ");
  const urlMatch = text.match(/curl\s+(?:'([^']+)'|"([^"]+)"|(\S+))/);
  let url = (urlMatch?.[1] || urlMatch?.[2] || urlMatch?.[3] || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    const anyUrl = text.match(/'(https?:\/\/[^']+)'|"(https?:\/\/[^"]+)"/);
    url = (anyUrl?.[1] || anyUrl?.[2] || "").trim();
  }

  const headers: Record<string, string> = {};
  const headerRe = /-H\s+(?:'([^']+)'|"([^"]+)")/g;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text))) {
    const raw = m[1] || m[2] || "";
    const idx = raw.indexOf(":");
    if (idx <= 0) continue;
    const name = raw.slice(0, idx).trim().toLowerCase();
    const value = raw.slice(idx + 1).trim();
    if (name) headers[name] = value;
  }

  let cookie = headers["cookie"] || "";
  const bMatch = text.match(/(?:^|\s)(?:-b|--cookie)\s+(?:'([^']+)'|"([^"]+)")/);
  if (!cookie && bMatch) cookie = (bMatch[1] || bMatch[2] || "").trim();
  delete headers["cookie"];

  const bodyRe = /(?:--data-raw|--data-binary|--data|-d)\s+(?:\$?'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/;
  const bodyMatch = text.match(bodyRe);
  const body = (bodyMatch?.[1] || bodyMatch?.[2] || "").replace(/\\'/g, "'").replace(/\\"/g, '"');

  return { url, cookie, headers, body };
}

// header ที่ไม่ส่งต่อ (เบราว์เซอร์ใส่เอง / ขัดกับ fetch)
const DROP_HEADERS = new Set([
  "host", "content-length", "accept-encoding", "connection", "cookie",
  "sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest", "priority",
]);
const cleanHeaders = (h: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (!DROP_HEADERS.has(k)) out[k] = v;
  return out;
};

// กันค่าลับหลุดออกไปกับข้อความ error — Meta บางทีสะท้อนคำขอกลับมาในคำตอบ
const scrub = (s: string) =>
  String(s || "")
    .replace(/c_user=\d+/g, "c_user=***")
    .replace(/xs=[^;&"\s]+/g, "xs=***")
    .replace(/fb_dtsg[^&"\s]*/g, "fb_dtsg=***")
    .replace(/datr=[^;&"\s]+/g, "datr=***")
    .slice(0, 400);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const body = await readJsonBody(req, 512 * 1024);   // cURL ของ Meta ยาวมาก
    const action = String(body?.action || "status");
    // ตั้งค่า/ลบ = เฉพาะเจ้าของระบบ (ค่านี้คือสิทธิ์บัญชี Facebook ทั้งบัญชี)
    // เปลี่ยนระยะ = คนที่เข้าหน้าตอบแชทได้ ใช้ได้ตามงานประจำ
    const auth = action === "set_stage"
      ? await authorizeRequest(req, { tab: ["inbox", "chat"], allowService: true })
      : await authorizeRequest(req, { owner: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const readConfig = async (): Promise<StageConfig | null> => {
      const { data, error } = await admin.rpc("app_get_bizsuite_config");
      if (error || !data) return null;
      try { return JSON.parse(String(data)) as StageConfig; } catch { return null; }
    };

    if (action === "clear") {
      const { error } = await admin.rpc("app_clear_bizsuite_config");
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, cleared: true });
    }

    if (action === "status") {
      const cfg = await readConfig();
      if (!cfg) return json({ ok: true, configured: false });
      // ไม่คืนคุกกี้/body จริง — แค่พอให้รู้ว่าตั้งไว้แล้วและจับมาเมื่อไหร่
      return json({
        ok: true,
        configured: true,
        host: (() => { try { return new URL(cfg.url).host; } catch { return null; } })(),
        captured_at: cfg.captured_at,
        sample_stage: cfg.sample_stage || null,
        cookie_len: String(cfg.cookie || "").length,
        body_len: String(cfg.body_template || "").length,
        allowed_stages: [...ALLOWED_STAGES],
      });
    }

    if (action === "save_curl") {
      const parsed = parseCurl(String(body?.curl || ""));
      if (!parsed.url) return json({ ok: false, error: "หา URL ในคำสั่ง cURL ไม่เจอ — ก๊อบด้วย “Copy as cURL” จาก DevTools" }, 400);

      // กันคุกกี้ถูกส่งไปโดเมนอื่น: ปฏิเสธตั้งแต่ตอนบันทึก ไม่ใช่ตอนใช้
      let host = "";
      try { host = new URL(parsed.url).host.toLowerCase(); } catch { /* ปล่อยให้ตกเงื่อนไขล่าง */ }
      if (!ALLOWED_HOSTS.has(host)) {
        return json({ ok: false, error: `ปฏิเสธ: URL ต้องเป็นโดเมนของ Meta เท่านั้น (ได้รับ "${host || "อ่านไม่ออก"}")` }, 400);
      }
      if (!parsed.cookie) return json({ ok: false, error: "ไม่มีคุกกี้ในคำสั่ง cURL — ต้องก๊อบจากคำขอที่ล็อกอินอยู่" }, 400);
      if (!parsed.body) return json({ ok: false, error: "ไม่มี body ในคำสั่ง cURL — ต้องเป็นคำขอตอนกดเปลี่ยนระยะ (POST)" }, 400);

      const sampleThreadId = String(body?.sample_thread_id || "").trim();
      const sampleStage = String(body?.sample_stage || "").trim();
      if (!sampleThreadId) return json({ ok: false, error: "ต้องบอกว่าจับ cURL จากห้องแชทไหน (ใช้หาตำแหน่งรหัสห้องใน body)" }, 400);
      if (!parsed.body.includes(sampleThreadId)) {
        return json({
          ok: false,
          error: `ไม่พบรหัสห้อง "${sampleThreadId}" ใน body — อาจจับผิดคำขอ (graphql ยิงหลายตัวพร้อมกัน) หาอันที่มีรหัสห้องนี้อยู่ข้างใน`,
        }, 400);
      }
      if (!sampleStage || !ALLOWED_STAGES.has(sampleStage)) {
        return json({ ok: false, error: `ต้องบอกว่าตอนจับเลือกระยะอะไร และต้องเป็นหนึ่งใน: ${[...ALLOWED_STAGES].join(" / ")}` }, 400);
      }

      const cfg: StageConfig = {
        url: parsed.url,
        cookie: parsed.cookie,
        headers: cleanHeaders(parsed.headers),
        body_template: parsed.body,
        sample_thread_id: sampleThreadId,
        sample_stage: sampleStage,
        captured_at: new Date().toISOString(),
      };
      const { error } = await admin.rpc("app_set_bizsuite_config", { p_json: JSON.stringify(cfg) });
      if (error) return json({ ok: false, error: `เก็บค่าไม่สำเร็จ: ${error.message}` }, 500);

      await admin.from("activity_log").insert({
        email: auth.permission?.email ?? null,
        event: "bizsuite_stage_config_saved",
        detail: { host, captured_at: cfg.captured_at, sample_stage: sampleStage, body_len: cfg.body_template.length },
      });
      return json({ ok: true, saved: true, host, cookie_len: cfg.cookie.length, body_len: cfg.body_template.length, headers_kept: Object.keys(cfg.headers) });
    }

    if (action === "set_stage") {
      const cfg = await readConfig();
      if (!cfg) return json({ ok: false, error: "ยังไม่ได้ตั้งค่าการเขียนระยะใน Meta (owner ต้องวางคำสั่ง cURL ในหน้าตั้งค่าก่อน)" }, 400);

      const rowId = String(body?.id || "").trim();
      const stageKey = String(body?.stage || "").trim();
      const stageLabel = STAGE_BY_KEY[stageKey] || stageKey;
      if (!rowId) return json({ ok: false, error: "ต้องส่ง id" }, 400);
      // ล็อกค่าที่แทนลง body ได้: ชื่อระยะต้องอยู่ในลิสต์เท่านั้น
      if (!ALLOWED_STAGES.has(stageLabel)) {
        return json({ ok: false, error: `ระยะ "${stageKey}" ไม่อยู่ในรายการที่อนุญาต` }, 400);
      }

      const { data: row } = await admin.from("chat_customers").select("id, psid, source").eq("id", rowId).maybeSingle();
      if (!row) return json({ ok: false, error: "ไม่พบบทสนทนานี้" }, 404);
      if (row.source === "line") return json({ ok: true, skipped: "line", note: "LINE ไม่มีระยะข้อมูลลูกค้าของ Meta" });

      // รหัสห้องที่หน้าเว็บ Business Suite ใช้ = เลขท้ายของ id ในระบบเรา (t_<id>)
      const threadId = String(row.id).replace(/^t_/, "");
      if (!/^\d+$/.test(threadId)) {
        return json({ ok: true, skipped: "no_thread_id", note: "ห้องนี้ไม่มีรหัสห้องแบบตัวเลข (คอมเมนต์/IG) จึงเปลี่ยนระยะไม่ได้" });
      }

      // แทนที่ได้แค่สองค่านี้เท่านั้น: รหัสห้อง และชื่อระยะ — ผู้เรียกส่ง body เองไม่ได้
      let payload = cfg.body_template.split(cfg.sample_thread_id).join(threadId);
      if (stageLabel !== cfg.sample_stage) {
        payload = payload.split(encodeURIComponent(cfg.sample_stage)).join(encodeURIComponent(stageLabel));
        payload = payload.split(cfg.sample_stage).join(stageLabel);
      }

      const started = Date.now();
      let httpStatus = 0;
      let outcome: { ok: boolean; error?: string; sample?: string } = { ok: false };
      try {
        const res = await fetch(cfg.url, {
          method: "POST",
          headers: { ...cfg.headers, cookie: cfg.cookie, "content-type": cfg.headers["content-type"] || "application/x-www-form-urlencoded" },
          body: payload,
          signal: AbortSignal.timeout(20_000),
        });
        httpStatus = res.status;
        const text = await res.text();
        // Meta ตอบ 200 แม้ mutation ล้มเหลว จึงต้องอ่านเนื้อหา ไม่ใช่ดูแค่ status
        const loggedOut = /<!DOCTYPE html/i.test(text);
        const hasError = /"errors"\s*:/.test(text) || /"error"\s*:\s*\{/.test(text);
        const docIdBad = hasError && /doc.?id/i.test(text);
        if (!res.ok || loggedOut) {
          outcome = { ok: false, sample: scrub(text),
            error: loggedOut ? "คุกกี้หมดอายุ (Meta ตอบหน้าล็อกอิน) — owner ต้องจับคำสั่ง cURL ใหม่" : `Meta ตอบ HTTP ${res.status}` };
        } else if (hasError) {
          outcome = { ok: false, sample: scrub(text),
            error: docIdBad ? "Meta เปลี่ยนเวอร์ชันหน้าเว็บแล้ว (doc id ใช้ไม่ได้) — owner ต้องจับคำสั่ง cURL ใหม่" : "Meta ปฏิเสธคำขอ" };
        } else {
          outcome = { ok: true };
        }
      } catch (e) {
        outcome = { ok: false, error: scrub(e instanceof Error ? e.message : String(e)) };
      }

      // บันทึกทุกครั้งว่าใครเปลี่ยนห้องไหนเป็นระยะอะไร ผลเป็นอย่างไร — ตรวจย้อนได้
      await admin.from("activity_log").insert({
        email: auth.permission?.email ?? null,
        event: "bizsuite_stage_write",
        detail: {
          conversation_id: rowId, thread_id: threadId, stage: stageLabel,
          ok: outcome.ok, http: httpStatus, duration_ms: Date.now() - started,
          ...(outcome.error ? { error: outcome.error } : {}),
        },
      });

      if (!outcome.ok) return json({ ok: false, http: httpStatus, error: outcome.error, sample: outcome.sample }, 400);
      return json({ ok: true, http: httpStatus, duration_ms: Date.now() - started, thread_id: threadId, stage: stageLabel });
    }

    return json({ ok: false, error: `ไม่รู้จัก action "${action}"` }, 400);
  } catch (e) {
    return json({ ok: false, error: scrub(e instanceof Error ? e.message : String(e)) }, 500);
  }
});
