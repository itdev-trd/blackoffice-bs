// supabase/functions/import-table/index.ts
// นำเข้าข้อมูลจากไฟล์ Excel/CSV ที่ export มาจากระบบเก่า
//
// ทำไมต้องมี: ระบบเก่าอยู่คนละ Supabase org ที่เข้าถึงข้ามกันไม่ได้ แต่ export Excel ได้
// จึงย้ายข้อมูลผ่านไฟล์แทน · import-chat-customers ที่มีอยู่เดิมจับคู่ด้วย "ชื่อลูกค้า"
// ซึ่งใช้ย้ายข้อมูลไม่ได้ (ชื่อซ้ำกันเยอะ ไม่ใช่คีย์) และรองรับแค่ตารางเดียว 6 คอลัมน์
//
// หลักการที่ยึด:
//   1. ตารางและคอลัมน์ต้องอยู่ใน allowlist ฝั่งนี้เท่านั้น — ห้ามเชื่อชื่อตารางที่ client ส่งมา
//      ไม่งั้นใครยิงฟังก์ชันนี้ได้ก็เขียนตารางอะไรก็ได้ รวมถึง app_secrets
//   2. จับคู่ด้วย "คีย์จริง" ของแต่ละตาราง ไม่ใช่ชื่อคน
//   3. merge ไม่ทับ — แถวที่มีอยู่แล้วจะเติมเฉพาะช่องที่ยังว่าง (null/'')
//      เพราะฐานใหม่มีข้อมูลที่สดกว่าฐานเก่าอยู่แล้ว เช่นบทสนทนาและสถานะการอ่าน
//   4. mode "preview" ต้องไม่เขียนอะไรเลย ให้ดูตัวเลขก่อนตัดสินใจ

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * ตารางที่อนุญาตให้นำเข้า
 *  key  = คอลัมน์ที่ใช้ระบุว่าเป็นแถวเดียวกัน (คีย์จริงของตาราง)
 *  cols = คอลัมน์ที่ยอมให้เขียน (ไม่รวม key) — อะไรที่ไม่อยู่ในนี้จะถูกทิ้งเงียบๆ
 * ไม่ใส่ app_secrets และตารางแคชโดยเจตนา
 */
const TABLES: Record<string, { key: string[]; cols: string[]; label: string }> = {
  chat_customers: {
    label: "ลูกค้า",
    key: ["id"],
    cols: [
      "page_id", "page_name", "psid", "source", "customer_name",
      "message_count", "user_message_count",
      "trade_id", "username", "email", "phone", "province",
      "stage", "stage_auto", "stage_manual", "classified_by",
      "country", "cust_lang", "profile_pic",
      "manual_data", "manual_data_by", "manual_data_at",
      "entry_ad_id", "entry_ad_name", "account_opened_at",
      "comment_post_id", "comment_permalink", "comment_ad_name",
      "comment_ad_ids", "comment_ad_names", "comment_is_ad", "comment_promoted_to_inbox",
      "last_user_text", "last_reply_text", "last_reply_by", "last_reply_at",
      "first_customer_message_at", "last_message_at", "cust_read_at", "read_at",
      "awaiting_reply", "unread", "blocked_at", "blocked_by", "blocked_reason",
      "created_at", "updated_at", "synced_at",
    ],
  },
  tv_access: {
    label: "สิทธิ์ TradingView",
    key: ["username", "pine_id"],
    cols: [
      "display_name", "expiration", "lot", "trade_id", "status", "email", "brand_id",
      "granted_by", "granted_at", "edited_by", "edited_at", "last_granted_at",
      "last_synced_at", "last_error", "tv_granted_at",
      "tv_access_verified", "tv_verified_at", "tv_verify_error",
      "membership_type", "channel", "previous_expiration", "new_expiration",
      "created_at", "updated_at",
    ],
  },
  chat_referrals: {
    label: "ที่มาจากโฆษณา",
    key: ["page_id", "psid", "ad_id"],
    cols: ["ref", "source", "ads_context", "received_at"],
  },
  saved_replies: {
    label: "คลังข้อความ",
    key: ["id"],
    cols: ["page_id", "brand_id", "title", "message", "image_url", "sort", "created_at", "updated_at"],
  },
  trade_id_cache: {
    label: "ผลเช็คไอดีเทรด",
    key: ["trade_id"],
    cols: ["pass", "via", "platform", "insertdate", "checked_at"],
  },
  page_lead_config: {
    label: "ตั้งค่าเพจ",
    key: ["page_id"],
    cols: ["page_name", "required_fields", "sync_enabled", "use_ai", "dataset_id", "picture_url", "picture_updated_at", "updated_at"],
  },
  user_permissions: {
    label: "สิทธิ์ผู้ใช้",
    key: ["email"],
    cols: [
      "role", "nickname", "allowed_ad_accounts", "allowed_tabs", "allowed_pages", "allowed_settings",
      "chat_alert", "alert_minutes", "alert_pages", "alert_sound", "alert_new", "created_at", "updated_at",
    ],
  },
};

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

/** แปลงค่าจากช่อง Excel ให้เข้ากับชนิดคอลัมน์ — Excel ส่งมาเป็นข้อความเกือบทั้งหมด */
function coerce(value: unknown, type: string): unknown {
  if (isEmpty(value)) return null;
  const s = String(value).trim();
  if (!s || s.toLowerCase() === "null") return null;

  if (type === "boolean") {
    const low = s.toLowerCase();
    if (["true", "t", "1", "yes", "y", "ใช่"].includes(low)) return true;
    if (["false", "f", "0", "no", "n", "ไม่"].includes(low)) return false;
    return null;
  }
  if (type.startsWith("timestamp") || type === "date") {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (["integer", "bigint", "smallint"].includes(type)) {
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (["numeric", "real", "double precision"].includes(type)) {
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (type === "jsonb" || type === "json") {
    try { return JSON.parse(s); } catch { return null; }   // ข้อความที่ไม่ใช่ JSON ทิ้งดีกว่าใส่ผิดชนิด
  }
  if (type === "ARRAY") {
    try { const j = JSON.parse(s); return Array.isArray(j) ? j : [s]; } catch { return s.split(",").map((x) => x.trim()).filter(Boolean); }
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    // นำเข้าข้อมูลทับฐานได้ → แอดมินเท่านั้น
    const auth = await authorizeRequest(req, { admin: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await readJsonBody(req, 8 * 1024 * 1024);   // ~8MB ต่อรอบ ฝั่งหน้าเว็บแบ่งก้อนมาแล้ว
    const table = String(body?.table || "");
    const spec = TABLES[table];
    if (!spec) return json({ ok: false, error: `ไม่รองรับตาราง "${table}"`, tables: Object.keys(TABLES) }, 400);

    const rows: Record<string, unknown>[] = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) return json({ ok: false, error: "ไม่มีข้อมูลในไฟล์" }, 400);
    if (rows.length > 2000) return json({ ok: false, error: "ส่งได้ไม่เกิน 2,000 แถวต่อรอบ" }, 400);

    const mode = body?.mode === "apply" ? "apply" : "preview";
    // onConflict: "fill" = เติมเฉพาะช่องที่ว่าง (ค่าเริ่มต้น ปลอดภัยกว่า)
    //             "replace" = ทับด้วยค่าจากไฟล์ทุกช่องที่ไฟล์มีค่า
    // ต้องเลือกได้ เพราะบางครั้งไฟล์คือแหล่งข้อมูลที่ถูกต้องกว่า (เช่น export จากระบบเก่าที่ยังใช้งานอยู่)
    const onConflict = body?.on_conflict === "replace" ? "replace" : "fill";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // อ่านชนิดคอลัมน์จริงจากฐาน — ไม่เดา เพราะ Excel ส่งค่ามาเป็นข้อความหมด
    // ใช้ rpc เพราะ PostgREST อ่าน information_schema ตรงๆ ไม่ได้
    const types = new Map<string, string>();
    const { data: cols, error: colErr } = await admin.rpc("app_column_types", { p_table: table });
    if (colErr) return json({ ok: false, error: `อ่าน schema ของตารางไม่ได้: ${colErr.message}` }, 500);
    for (const c of (cols as { column_name: string; data_type: string }[] | null) || []) {
      types.set(c.column_name, c.data_type);
    }
    if (types.size === 0) return json({ ok: false, error: `ไม่พบตาราง "${table}" ในฐานข้อมูล` }, 400);

    const allowed = new Set([...spec.key, ...spec.cols]);
    const prepared: Record<string, unknown>[] = [];
    const badRows: { row: number; reason: string }[] = [];

    rows.forEach((raw, i) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (!allowed.has(k)) continue;                       // คอลัมน์นอก allowlist ทิ้งเงียบๆ
        out[k] = coerce(v, types.get(k) || "text");
      }
      // ขาดคีย์ = ระบุไม่ได้ว่าเป็นแถวไหน ข้ามและรายงาน
      const missing = spec.key.filter((k) => isEmpty(out[k]));
      if (missing.length) { badRows.push({ row: i + 1, reason: `ไม่มีค่าในคอลัมน์คีย์: ${missing.join(", ")}` }); return; }
      prepared.push(out);
    });

    // ตัดแถวที่คีย์ซ้ำกัน "ภายในไฟล์เดียวกัน" ก่อนเขียน
    // Postgres ปฏิเสธ ON CONFLICT DO UPDATE ถ้าแถวเดียวถูกแตะสองครั้งใน statement เดียว
    // ("cannot affect row a second time") — เจอจริงกับไฟล์ที่มี username ซ้ำในสคริปต์เดียวกัน
    // เก็บ "แถวแรก" ไว้ เพราะ export เรียงจากใหม่ไปเก่า แถวแรกคือข้อมูลล่าสุด
    const seenKeys = new Set<string>();
    const dupInFile: string[] = [];
    const deduped: Record<string, unknown>[] = [];
    for (const row of prepared) {
      const k = spec.key.map((c) => String(row[c] ?? "")).join(" ");
      if (seenKeys.has(k)) { dupInFile.push(k); continue; }
      seenKeys.add(k);
      deduped.push(row);
    }
    prepared.length = 0;
    prepared.push(...deduped);

    if (!prepared.length) {
      return json({ ok: false, error: "ไม่มีแถวที่ใช้ได้ — ตรวจว่าไฟล์มีคอลัมน์คีย์ครบ", key: spec.key, skipped: badRows.slice(0, 20) }, 400);
    }

    // ดึงแถวที่มีอยู่แล้วมาเทียบ เพื่อบอกว่าจะ "เพิ่มใหม่" หรือ "เติมช่องว่าง"
    // ตารางที่คีย์เดียวใช้ .in() ได้ตรงๆ · คีย์หลายคอลัมน์ต้องดึงมาเทียบใน JS
    const existing = new Map<string, Record<string, unknown>>();
    const keyOf = (r: Record<string, unknown>) => spec.key.map((k) => String(r[k] ?? "")).join(" ");
    {
      let q = admin.from(table).select([...spec.key, ...spec.cols].join(","));
      if (spec.key.length === 1) {
        const k = spec.key[0];
        q = q.in(k, prepared.map((r) => r[k]) as never[]);
      }
      const { data: cur } = await q.limit(20000) as unknown as { data: Record<string, unknown>[] | null };
      for (const r of cur || []) existing.set(keyOf(r), r);
    }

    let willInsert = 0, willFill = 0, noChange = 0;
    // แยกสองกอง ห้ามปนกันเด็ดขาด
    // PostgREST รวมทุกแถวใน batch เป็น INSERT ก้อนเดียวด้วย "union ของคอลัมน์"
    // แถวที่ไม่มีคอลัมน์นั้นจะถูกเติม NULL ให้ → คอลัมน์ NOT NULL พังทันที
    // เจอจริงสองรอบ: status (แถวอัปเดตไม่มี) แล้ว created_at (แถวเพิ่มใหม่ไม่มี)
    // ในกองเดียวกันทุกแถวมีชุดคอลัมน์เท่ากันเสมอ — กองเพิ่มใหม่มาจากไฟล์เดียวกัน
    // กองอัปเดตมาจาก {...cur, ...patch} ซึ่งครบทุกคอลัมน์ที่อ่านมา
    const inserts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];

    for (const row of prepared) {
      const cur = existing.get(keyOf(row));
      if (!cur) { willInsert++; inserts.push(row); continue; }
      const patch: Record<string, unknown> = {};
      for (const c of spec.cols) {
        if (isEmpty(row[c])) continue;                       // ไฟล์ไม่มีค่า = ไม่แตะช่องนั้น
        if (onConflict === "replace") {
          if (row[c] !== cur[c]) patch[c] = row[c];          // ทับเมื่อค่าต่างจริง
        } else if (isEmpty(cur[c])) {
          patch[c] = row[c];                                 // เติมเฉพาะช่องที่ว่าง
        }
      }
      if (Object.keys(patch).length === 0) { noChange++; continue; }
      willFill++;
      // ต้องส่ง "ค่าเดิมครบทุกคอลัมน์" แล้วทับด้วย patch — ห้ามส่งแค่คีย์+patch
      //
      // เหตุผล: PostgREST รวมทุกแถวใน batch เป็น INSERT ก้อนเดียวโดยใช้ union ของคอลัมน์
      // แถวที่ไม่มีคอลัมน์นั้นจะถูกเติม NULL ให้ → คอลัมน์ NOT NULL อย่าง status พังทันที
      // (เจอจริง: null value in column "status" violates not-null constraint)
      // เริ่มจาก cur ที่อ่านมาจากฐาน จึงไม่มีข้อมูลไหนหาย และ NOT NULL ครบเสมอ
      updates.push({ ...cur, ...patch });
    }

    const summary = {
      ok: true, mode, on_conflict: onConflict, table, label: spec.label, key: spec.key,
      total_in_file: rows.length,
      usable: prepared.length,
      duplicate_in_file: dupInFile.length,
      duplicate_examples: dupInFile.slice(0, 5),
      skipped: badRows.length,
      skipped_examples: badRows.slice(0, 10),
      will_insert: willInsert,
      will_fill_blanks: willFill,
      already_complete: noChange,
    };

    if (mode === "preview") return json({ ...summary, applied: 0 });

    // เขียนจริง — สองกองแยกกัน แต่ละกองแบ่งก้อนละ 500 กัน payload ใหญ่เกิน
    let applied = 0;
    for (const [kind, list] of [["เพิ่มใหม่", inserts], [onConflict === "replace" ? "แทนที่" : "เติมช่องว่าง", updates]] as [string, Record<string, unknown>[]][]) {
      for (let i = 0; i < list.length; i += 500) {
        const chunk = list.slice(i, i + 500);
        const { error } = await admin.from(table).upsert(chunk, { onConflict: spec.key.join(",") });
        if (error) {
          return json({ ...summary, ok: false, applied,
            error: `กอง "${kind}" ก้อนที่ ${Math.floor(i / 500) + 1} ไม่สำเร็จ: ${error.message}` }, 500);
        }
        applied += chunk.length;
      }
    }
    return json({ ...summary, applied });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
