// supabase/functions/scan-trade-ids/index.ts
// สแกนบทสนทนาหา "เลขบัญชีเทรด / username TradingView" ที่ลูกค้าพิมพ์มาเอง
// แล้วเช็คกับ XM จริงผ่าน verify-trade-id → ถ้าผ่านก็มาร์กว่าเปิดบัญชีแล้ว
//
// ทำไมต้องมี: Meta ปิดการอ่านป้ายกำกับย้อนหลังทุกทาง (subcode 33) ดึงป้ายเก่ามาไม่ได้
// แต่ "ใครเปิดบัญชีแล้ว" หาได้จากเลขบัญชีที่ลูกค้าพิมพ์มาในแชท + เช็คกับโบรกเกอร์
// ซึ่งน่าเชื่อถือกว่าป้ายที่คนติดมือ และใช้ได้ทั้ง Messenger / LINE / Instagram
//
// โหมด:
//   { action: "scan", limit? }              -> หาผู้สมัคร คืนรายการให้แอดมินตรวจ (ไม่เขียนอะไร)
//   { action: "verify", limit?, apply? }    -> เช็คกับ XM · apply=true คือบันทึกผลลงฐานข้อมูล
//   { action: "apply", items: [{id, trade_id, username}] } -> บันทึกเฉพาะรายที่แอดมินเลือก (เช็คซ้ำก่อนเขียนทุกครั้ง)
//
// ไม่เขียนทับข้อมูลที่แอดมินกรอกเอง และเขียนเฉพาะรายที่ "ผ่าน" การเช็คจริงเท่านั้น

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// เลขที่อยู่ "ติดคำบอกใบ้" = ผู้สมัครที่เชื่อได้ (ทดสอบกับข้อมูลจริงแล้วตรง 34/34)
// ตัวจับแบบกว้าง (เลข 7-10 หลักลอยๆ) ให้ผลเพี้ยนได้ เช่นเบอร์โทร/ยอดเงิน จึงไม่ใช้เป็นหลัก
const NEAR_KEYWORD = /(?:เลขบัญชี(?:เทรด)?|บัญชีเทรด|trade\s*id|ไอดีเทรด|XM)[^0-9]{0,20}(\d{6,10})/i;
// username TradingView
// บทเรียนจากรอบแรก: จับ "คำที่มีขีดล่าง" เฉยๆ ได้ขยะเต็มไปหมด — utm_source, story_fbid, fbclid
// เพราะลูกค้าวางลิงก์มาแล้ว query parameter มีขีดล่างทั้งนั้น
// จึงต้อง (1) ตัด URL ออกก่อน (2) มีบัญชีดำพารามิเตอร์ที่รู้จัก (3) ให้น้ำหนักกับคำที่อยู่ติดคำบอกใบ้
const TV_NEAR_KEYWORD = /(?:tradingview|trading\s*view|user\s*tv|ยูส(?:เซอร์)?|username)[^a-zA-Z0-9]{0,12}([a-zA-Z][a-zA-Z0-9_]{3,29})/i;
const TV_STANDALONE = /\b([a-zA-Z][a-zA-Z0-9]*_[a-zA-Z0-9_]{2,})\b/;

// พารามิเตอร์/คำที่ไม่ใช่ username แน่ๆ — เจอมาจากข้อมูลจริงทั้งหมด
const NOT_USERNAME = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id",
  "story_fbid", "fbclid", "mibextid", "ref_src", "ref_url", "igsh", "igshid",
  "gclid", "msclkid", "app_id", "share_url", "post_id", "page_id", "ad_id",
  "trade_id", "user_id", "client_id", "session_id", "order_id",
]);

// ตัด URL ทั้งหมดออก แล้วค่อยหา username — กันจับ query parameter มาเป็นชื่อผู้ใช้
const stripUrls = (t: string) => t.replace(/https?:\/\/\S+/gi, " ").replace(/www\.\S+/gi, " ");

// คำทั่วไปที่หลุดมาเพราะอยู่ติดคำบอกใบ้ (เจอจริง: "username", "Premium", "Paano", "free")
const COMMON_WORDS = new Set([
  "username", "user", "name", "premium", "free", "paano", "please", "thanks", "admin",
  "account", "email", "password", "login", "signup", "trading", "tradingview", "view",
]);

// username TradingView ที่เชื่อได้ต้อง "มีขีดล่างหรือมีตัวเลข" — ชื่อจริงมักเป็น abc_123 / name_01
// เกณฑ์นี้ตัดคำภาษาอังกฤษทั่วไปออกได้หมด แลกกับพลาดบางชื่อที่เป็นตัวอักษรล้วน
// ยอมพลาดดีกว่าเขียนข้อมูลผิดลงฐานลูกค้า (เหตุผลเดิมที่ระบบสกัดอัตโนมัติถูกปิดไป)
const looksLikeUsername = (v: string) => {
  const low = v.toLowerCase();
  if (NOT_USERNAME.has(low) || COMMON_WORDS.has(low)) return false;
  if (v.length < 4 || v.length > 30) return false;
  return /[_\d]/.test(v);
};

function findTvUsername(text: string): string | null {
  const clean = stripUrls(text);
  const near = clean.match(TV_NEAR_KEYWORD)?.[1];
  if (near && looksLikeUsername(near)) return near;
  const solo = clean.match(TV_STANDALONE)?.[1];
  if (solo && looksLikeUsername(solo)) return solo;
  return null;
}

function customerText(transcript: unknown) {
  if (!Array.isArray(transcript)) return "";
  // เอาเฉพาะข้อความฝั่งลูกค้า — ข้อความของแอดมินมีเลขบัญชีตัวอย่าง/ยอดเงินปนอยู่
  return transcript
    .filter((m: any) => m?.w === "u" && m?.t)
    .map((m: any) => String(m.t))
    .join(" \n ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const body = await readJsonBody(req, 32 * 1024);
    const action = String(body?.action || "scan");
    const limit = Math.min(500, Math.max(1, Number(body?.limit) || 200));
    const apply = body?.apply === true;
    // เขียนข้อมูลลูกค้า = ต้องเป็น admin (เดียวกับหน้าตั้งค่าการซิงก์)
    const writes = apply || action === "apply";   // ทุกทางที่เขียนข้อมูลลูกค้าต้องเป็น admin
    const auth = await authorizeRequest(req, writes ? { admin: true, setting: "synccfg" } : { tab: ["inbox", "chat"] });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // เฉพาะรายที่ยังไม่มีเลขบัญชีในระบบ — ไม่ไปแตะของที่แอดมินกรอกไว้แล้ว
    const { data: rows, error: qErr } = await admin
      .from("chat_customers")
      .select("id, customer_name, page_id, source, trade_id, username, transcript, tags, account_opened_at")
      .or("trade_id.is.null,trade_id.eq.")
      .order("last_message_at", { ascending: false })
      .limit(1500);
    if (qErr) return json({ ok: false, error: qErr.message }, 500);

    const candidates: any[] = [];
    for (const r of rows ?? []) {
      const txt = customerText(r.transcript);
      if (!txt) continue;
      const tid = stripUrls(txt).match(NEAR_KEYWORD)?.[1] || null;
      // คอลัมน์ TradingView username ในตารางนี้ชื่อ "username" (ไม่ใช่ tv_username)
      const tv = (!r.username ? findTvUsername(txt) : null) || null;
      if (!tid && !tv) continue;
      candidates.push({
        id: r.id,
        customer_name: r.customer_name,
        source: r.source || "messenger",
        trade_id: tid,
        username: tv,
      });
      if (candidates.length >= limit) break;
    }

    // ---- แค่ดูว่าเจออะไร ยังไม่เช็ค ยังไม่เขียน ----
    if (action === "scan") {
      return json({
        ok: true,
        scanned: (rows ?? []).length,
        found: candidates.length,
        with_trade_id: candidates.filter((c) => c.trade_id).length,
        with_tv: candidates.filter((c) => c.username).length,
        candidates,
      });
    }

    // ---- บันทึกเฉพาะรายที่แอดมินติ๊กเลือกจากหน้าตรวจ ----
    // เช็คกับ XM ซ้ำก่อนเขียนทุกครั้ง แม้หน้าเว็บจะบอกว่าผ่านมาแล้ว
    // เพราะหน้าเว็บเป็นฝั่งที่แก้ค่าได้ ห้ามเชื่อเป็นหลักฐานการเปิดบัญชี
    if (action === "apply") {
      const items = Array.isArray(body?.items) ? body.items.slice(0, 200) : [];
      if (items.length === 0) return json({ ok: false, error: "ไม่มีรายการที่เลือก" }, 400);

      const sb = Deno.env.get("SUPABASE_URL")!;
      const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      let saved = 0, rejected = 0;
      const detail: any[] = [];

      for (const it of items) {
        const id = String(it?.id || "");
        const tid = String(it?.trade_id || "").trim();
        const uname = String(it?.username || "").trim();
        if (!id) continue;

        // ไม่มีเลขบัญชี = บันทึกได้แค่ username (ไม่ถือว่าเปิดบัญชีแล้ว)
        if (!tid) {
          if (!uname) { detail.push({ id, skipped: "ไม่มีข้อมูลให้บันทึก" }); continue; }
          const { error } = await admin.from("chat_customers")
            .update({ username: uname, updated_at: new Date().toISOString() }).eq("id", id);
          if (!error) { saved++; detail.push({ id, saved: "username" }); }
          continue;
        }

        const resp = await fetch(`${sb}/functions/v1/verify-trade-id`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${sk}` },
          body: JSON.stringify({ trade_id: tid }),
        });
        const v = await resp.json().catch(() => ({}));
        if (v?.pass !== true) { rejected++; detail.push({ id, trade_id: tid, rejected: "เช็คกับ XM ไม่ผ่าน" }); continue; }

        const { data: cur } = await admin.from("chat_customers").select("tags").eq("id", id).maybeSingle();
        const tags = Array.isArray(cur?.tags) ? cur.tags : [];
        const nextTags = tags.includes("✅ เปิดบัญชีแล้ว") ? tags : [...tags, "✅ เปิดบัญชีแล้ว"];
        const { error } = await admin.from("chat_customers").update({
          trade_id: tid,
          ...(uname ? { username: uname } : {}),
          account_opened_at: new Date().toISOString(),
          stage: "account_opened",
          stage_manual: "account_opened",
          tags: nextTags,
          updated_at: new Date().toISOString(),
        }).eq("id", id);
        if (!error) { saved++; detail.push({ id, trade_id: tid, saved: "trade_id+opened", via: v?.via ?? null }); }
      }

      return json({ ok: true, requested: items.length, saved, rejected, detail });
    }

    // ---- เช็คกับ XM จริง ----
    if (action === "verify") {
      const sb = Deno.env.get("SUPABASE_URL")!;
      const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const results: any[] = [];
      let passed = 0, failed = 0, saved = 0;

      // เช็คทีละเลขที่ไม่ซ้ำ — ลูกค้าหลายคนอาจพิมพ์เลขเดียวกัน (พิมพ์ผิด/ก๊อปกันมา)
      const cache = new Map<string, any>();

      for (const c of candidates) {
        if (!c.trade_id) continue;
        let v = cache.get(c.trade_id);
        if (!v) {
          const resp = await fetch(`${sb}/functions/v1/verify-trade-id`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${sk}` },
            body: JSON.stringify({ trade_id: c.trade_id }),
          });
          v = await resp.json().catch(() => ({}));
          cache.set(c.trade_id, v);
        }
        const pass = v?.pass === true;
        pass ? passed++ : failed++;
        results.push({ ...c, pass, via: v?.via ?? null, error: v?.error ?? null });

        // เขียนเฉพาะรายที่ "ผ่าน" — ไม่ผ่านอาจเป็นเลขที่ลูกค้าพิมพ์ผิดหรือเป็นของโบรกอื่น
        if (pass && apply) {
          const tags = Array.isArray(rows?.find((r) => r.id === c.id)?.tags) ? rows!.find((r) => r.id === c.id)!.tags : [];
          const nextTags = tags.includes("✅ เปิดบัญชีแล้ว") ? tags : [...tags, "✅ เปิดบัญชีแล้ว"];
          const { error: uErr } = await admin
            .from("chat_customers")
            .update({
              trade_id: c.trade_id,
              ...(c.username ? { username: c.username } : {}),
              account_opened_at: new Date().toISOString(),
              stage: "account_opened",
              stage_manual: "account_opened",   // ให้ meta-push-labels ยอมส่งป้ายขึ้น Meta
              tags: nextTags,
              updated_at: new Date().toISOString(),
            })
            .eq("id", c.id);
          if (!uErr) saved++;
        }
      }

      return json({
        ok: true,
        applied: apply,
        checked: results.length,
        passed,
        failed,
        saved,
        results: results.slice(0, 200),
        next_step: apply && saved > 0
          ? "กด \"ส่งป้ายขึ้น Meta\" เพื่อให้ Business Suite ตรงกัน"
          : null,
      });
    }

    return json({ ok: false, error: `ไม่รู้จัก action "${action}"` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
