// supabase/functions/chat-labels/index.ts
// จัดการ "ป้ายกำกับ" (Custom Labels) ของเพจจากในเว็บ แล้วผลไปขึ้นใน Meta Business Suite ทันที
//   { action: "list",   page_id }              -> ป้ายทั้งหมดของเพจ
//   { action: "of",     id }                   -> ป้ายที่ติดอยู่กับลูกค้ารายนี้
//   { action: "create", page_id, name }        -> สร้างป้ายใหม่
//   { action: "attach", id, label_id }         -> ติดป้ายให้ลูกค้า
//   { action: "detach", id, label_id }         -> ถอดป้ายออก
//
// ข้อจำกัดที่ทดสอบกับ Graph v22.0 แล้วว่าปิดจริง (error subcode 33 "does not support this operation")
// — อย่าเสียเวลาลองซ้ำ:
//   GET /{psid}/custom_labels   -> ปิด (เดิมเป็นวิธีอ่านป้ายของลูกค้า)
//   GET /{label_id}             -> ปิด (อ่าน object ป้ายไม่ได้)
//   GET /{label_id}/label       -> ไม่มี edge นี้
//   conversation fields labels / user_labels / custom_labels / page_labels -> ไม่มี field
// สรุป: อ่าน "ใครติดป้ายอะไรไว้" จาก Meta ไม่ได้เลย เขียนได้ทางเดียว
// จึงต้องจดของเราเองที่คอลัมน์ chat_customers.meta_labels
//
// ต่างจาก meta-push-labels ที่ล็อกไว้แค่ 4 "สถานะ" — ตัวนี้ให้แอดมินสร้าง/ติดป้ายอะไรก็ได้
//
// ข้อจำกัดของ Meta ที่เลี่ยงไม่ได้:
//   Custom Labels ผูกกับ PSID ของ Facebook Page เท่านั้น
//   Instagram (IGSID) และ LINE ใช้ไม่ได้ — ต้องบอกผู้ใช้ตรงๆ ไม่ใช่ปล่อยให้กดแล้วเงียบ

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaMessagingContext } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: init?.signal || AbortSignal.timeout(15_000) });
  return await r.json().catch(() => ({}));
}

const labelName = (l: any) => l?.page_label_name || l?.name || "";

// เพจที่ยิงแอดมานานจะมีป้ายเป็นร้อย ๆ อัน ซึ่งส่วนใหญ่ Meta สร้างเองจาก messenger_ads
// (ad_id.120xxxxx, messenger_ads, เลขไอดีล้วน) — ไม่ใช่ป้ายที่คนตั้งใจใช้จัดกลุ่มลูกค้า
// ถ้าโชว์ทั้งหมด ตัวเลือกจะยาวเป็นพันบรรทัดจนใช้งานไม่ได้ จึงแยก "ป้ายของคน" ออกมา
const isSystemLabel = (name: string) =>
  /^ad_id\./i.test(name) || /^messenger_ads$/i.test(name) || /^\d+$/.test(name);

// Meta ยอมให้ชื่อป้ายซ้ำกันได้ (เจอ "ชำระเงินแล้ว" หลายสิบ id) — ยุบตามชื่อ เก็บ id แรกไว้ใช้ติดป้าย
function dedupeByName(list: any[]) {
  const seen = new Map<string, { id: string; name: string; dupes: number }>();
  for (const l of list) {
    const name = labelName(l);
    if (!name) continue;
    const hit = seen.get(name.toLowerCase());
    if (hit) { hit.dupes++; continue; }
    seen.set(name.toLowerCase(), { id: String(l.id), name, dupes: 0 });
  }
  return [...seen.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const body = await readJsonBody(req, 64 * 1024);
    const action = String(body?.action || "list");
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"] });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // ป้ายกำกับเป็นฟีเจอร์ใต้ pages_messaging เหมือนการส่งข้อความ จึงต้องใช้ token ตัวเดียวกับที่ตอบแชท
    // (token หลักของบริษัทยังเป็น Standard Access — ติดป้ายให้ลูกค้าจริงไม่ได้)
    const meta = await getMetaMessagingContext();
    const token = meta.token;
    if (!token) return json({ ok: false, error: "ยังไม่ได้ตั้งค่า Meta access token" }, 400);

    // ---- หาเพจ + psid ที่จะทำงานด้วย ----
    let pageId = body?.page_id ? String(body.page_id) : "";
    let psid = "";
    let localLabels: any[] = [];   // ป้ายที่แอปนี้จดไว้ว่าเคยติดให้ลูกค้ารายนี้
    let webTags: string[] = [];
    if (["of", "attach", "detach", "mirror"].includes(action)) {
      const rowId = String(body?.id || "");
      if (!rowId) return json({ ok: false, error: "ต้องส่ง id ของบทสนทนา" }, 400);
      const { data: row } = await admin
        .from("chat_customers")
        .select("id, page_id, psid, source, meta_labels, tags")
        .eq("id", rowId)
        .maybeSingle();
      if (!row) return json({ ok: false, error: "ไม่พบบทสนทนานี้" }, 404);
      // ช่องทางที่ Meta ไม่รองรับ — ตอบให้ชัดว่าทำไม ไม่ใช่ error ดิบ
      if (row.source === "line") return json({ ok: true, unsupported: "line", labels: [], note: "LINE ไม่มีระบบป้ายกำกับของ Meta" });
      if (row.source === "instagram") return json({ ok: true, unsupported: "instagram", labels: [], note: "Instagram ใช้ป้ายกำกับของเพจ Facebook ไม่ได้" });
      if (!row.psid) return json({ ok: true, unsupported: "no_psid", labels: [], note: "บทสนทนานี้ยังไม่มี PSID (เช่นคอมเมนต์ที่ยังไม่ได้ตอบ DM)" });
      pageId = String(row.page_id || "");
      psid = String(row.psid);
      localLabels = Array.isArray(row.meta_labels) ? row.meta_labels : [];
      webTags = Array.isArray(row.tags) ? row.tags.map((t: any) => String(t).trim()).filter(Boolean) : [];
    }
    if (!pageId) return json({ ok: false, error: "ต้องส่ง page_id" }, 400);
    // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้าตอบแชทได้ ก็ตอบได้ทุกเพจและทุก LINE OA

    const pd = await getMetaPages(GRAPH_BASE, token, { mustIncludePageId: pageId, cacheKey: meta.cacheKey });
    const pageTok = (pd?.data ?? []).find((p: any) => String(p.id) === pageId)?.access_token;
    if (!pageTok) return json({ ok: false, error: "ไม่พบ access token ของเพจนี้ (เช็คสิทธิ์ pages_messaging)" }, 400);

    // ---- ป้ายทั้งหมดของเพจ ----
    if (action === "list") {
      const r = await fetchJson(`${GRAPH_BASE}/${pageId}/custom_labels?fields=name,page_label_name&limit=500&access_token=${pageTok}`);
      if (r?.error) return json({ ok: false, error: r.error.error_user_msg || r.error.message || "อ่านป้ายไม่สำเร็จ" }, 400);
      const all = dedupeByName(r?.data ?? []);
      const labels = all.filter((l) => !isSystemLabel(l.name)).sort((a, c) => a.name.localeCompare(c.name, "th"));
      return json({
        ok: true,
        labels,
        total_raw: (r?.data ?? []).length,
        hidden_system: all.length - labels.length,   // แจ้งให้รู้ว่าซ่อนอะไรไป ไม่ตัดเงียบ
      });
    }

    // ---- ป้ายที่ติดอยู่กับลูกค้ารายนี้ ----
    if (action === "of") {
      // Meta เลิกรองรับ reverse lookup นี้แล้ว (ตอบ "Unsupported get request")
      // ยังลองก่อนเผื่อเพจไหนใช้ได้ ถ้าไม่ได้ก็ตกไปใช้รายการที่แอปจดไว้ — ไม่โชว์ error ให้ผู้ใช้ตกใจเปล่าๆ
      const r = await fetchJson(`${GRAPH_BASE}/${psid}/custom_labels?fields=name,page_label_name&limit=100&access_token=${pageTok}`);
      if (!r?.error && Array.isArray(r?.data)) {
        const labels = dedupeByName(r.data).map((l) => ({ ...l, system: isSystemLabel(l.name) }));
        return json({ ok: true, labels, source: "meta" });
      }
      return json({
        ok: true,
        source: "local",
        lookup_unsupported: true,   // UI ใช้บอกผู้ใช้ว่าเห็นเฉพาะป้ายที่ติดผ่านแอปนี้
        labels: dedupeByName(localLabels).map((l) => ({ ...l, system: isSystemLabel(l.name) })),
      });
    }

    // ---- สร้างป้ายใหม่ ----
    if (action === "create") {
      const name = String(body?.name || "").trim().slice(0, 100);
      if (!name) return json({ ok: false, error: "ต้องใส่ชื่อป้าย" }, 400);
      // มีชื่อนี้อยู่แล้วก็คืนตัวเดิม ไม่สร้างซ้ำ (Meta ยอมให้ชื่อซ้ำได้ ซึ่งทำให้สับสนภายหลัง)
      const cur = await fetchJson(`${GRAPH_BASE}/${pageId}/custom_labels?fields=name,page_label_name&limit=500&access_token=${pageTok}`);
      const dup = (cur?.data ?? []).find((l: any) => labelName(l).toLowerCase() === name.toLowerCase());
      if (dup) return json({ ok: true, label: { id: String(dup.id), name: labelName(dup) }, existed: true });

      // Graph เวอร์ชันใหม่ใช้ page_label_name — เวอร์ชันเก่าใช้ name จึงลองทั้งสองแบบ
      let created: any = null;
      for (const field of ["page_label_name", "name"]) {
        const r = await fetchJson(`${GRAPH_BASE}/${pageId}/custom_labels?access_token=${pageTok}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [field]: name }),
        });
        if (r?.id) { created = r; break; }
        if (!r?.error) break;
      }
      if (!created?.id) return json({ ok: false, error: "สร้างป้ายไม่สำเร็จ — เช็คสิทธิ์ pages_messaging" }, 400);
      return json({ ok: true, label: { id: String(created.id), name } });
    }

    // ---- ติด / ถอด ----
    if (action === "attach" || action === "detach") {
      const labelId = String(body?.label_id || "");
      if (!labelId) return json({ ok: false, error: "ต้องส่ง label_id" }, 400);
      const method = action === "attach" ? "POST" : "DELETE";
      // ส่ง user ทาง query ก่อน ถ้า Meta ไม่รับให้ลองทาง body (พฤติกรรมต่างกันตามเวอร์ชัน)
      let r = await fetchJson(`${GRAPH_BASE}/${labelId}/label?user=${encodeURIComponent(psid)}&access_token=${pageTok}`, { method });
      if (r?.success !== true && action === "attach") {
        r = await fetchJson(`${GRAPH_BASE}/${labelId}/label?access_token=${pageTok}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: psid }),
        });
      }
      if (r?.success !== true) {
        return json({ ok: false, error: r?.error?.error_user_msg || r?.error?.message || `${action === "attach" ? "ติด" : "ถอด"}ป้ายไม่สำเร็จ` }, 400);
      }
      // จดไว้เองว่าตอนนี้ติดอะไรอยู่ เพราะอ่านย้อนกลับจาก Meta ไม่ได้
      const name = String(body?.label_name || "").trim();
      const next = action === "attach"
        ? [...localLabels.filter((l: any) => String(l?.id) !== labelId), { id: labelId, name: name || labelId }]
        : localLabels.filter((l: any) => String(l?.id) !== labelId);
      await admin.from("chat_customers")
        .update({ meta_labels: next, updated_at: new Date().toISOString() })
        .eq("id", String(body?.id || ""));

      return json({ ok: true, applied: action, label_id: labelId, labels: next });
    }

    // ---- ซิงก์ป้ายในเว็บ (chat_customers.tags) ขึ้นไปเป็น Custom Labels ของ Meta ----
    //
    // เรียกทุกครั้งที่แอดมินติด/ถอดป้ายในเว็บ — ทำงานแบบ "ปรับให้ตรงกัน" ไม่ใช่สั่งทีละใบ
    // จึงเรียกซ้ำได้ปลอดภัย และถ้าเคยพลาดไปรอบก่อน รอบถัดไปจะตามเก็บให้เอง
    //
    // ทิศทางกลับ (คนไปติดป้ายใน Meta แล้วให้เข้าเว็บ) ทำไม่ได้ — ทดสอบกับ Graph v22.0
    // ด้วย token ที่มีสิทธิ์ครบแล้วทุกทาง ปิดหมด: GET /{psid}/custom_labels (subcode 33),
    // GET /{label_id} (subcode 33), /{label_id}/label และ /{label_id}/users (ไม่มี field),
    // conversations?fields=labels (Meta ตัด field ทิ้งเงียบ ๆ) และไม่มี webhook แจ้งการติดป้าย
    // เราจึงอ่านได้แค่ "รายชื่อป้ายของเพจ" เพื่อให้ตัวเลือกในเว็บตรงกับใน Meta
    if (action === "mirror") {
      const cur = await fetchJson(`${GRAPH_BASE}/${pageId}/custom_labels?fields=name,page_label_name&limit=500&access_token=${pageTok}`);
      if (cur?.error) return json({ ok: false, error: cur.error.error_user_msg || cur.error.message || "อ่านป้ายของเพจไม่สำเร็จ" }, 400);
      const idByName = new Map<string, string>();
      for (const l of cur?.data ?? []) {
        const name = labelName(l);
        if (name && !idByName.has(name.toLowerCase())) idByName.set(name.toLowerCase(), String(l.id));
      }

      const want = [...new Set(webTags.map((t) => t.trim()).filter(Boolean))];
      const wantKeys = new Set(want.map((t) => t.toLowerCase()));
      const haveKeys = new Set(localLabels.map((l: any) => String(l?.name || "").toLowerCase()).filter(Boolean));

      const toAttach = want.filter((t) => !haveKeys.has(t.toLowerCase()));
      const toDetach = localLabels.filter((l: any) => !wantKeys.has(String(l?.name || "").toLowerCase()));

      // กันลูปพัง: ครั้งละไม่เกิน 25 รายการ ที่เหลือรอบถัดไปตามเก็บ (mirror เรียกซ้ำได้)
      const CAP = 25;
      const attached: string[] = [];
      const detached: string[] = [];
      const failed: { name: string; error: string }[] = [];
      let next = [...localLabels];

      for (const name of toAttach.slice(0, CAP)) {
        let labelId = idByName.get(name.toLowerCase()) || "";
        if (!labelId) {
          // ยังไม่มีป้ายชื่อนี้ในเพจ → สร้างให้ (field ต่างกันตามเวอร์ชัน Graph จึงลองทั้งสองแบบ)
          for (const field of ["page_label_name", "name"]) {
            const r = await fetchJson(`${GRAPH_BASE}/${pageId}/custom_labels?access_token=${pageTok}`, {
              method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [field]: name.slice(0, 100) }),
            });
            if (r?.id) { labelId = String(r.id); idByName.set(name.toLowerCase(), labelId); break; }
            if (!r?.error) break;
          }
        }
        if (!labelId) { failed.push({ name, error: "สร้างป้ายในเพจไม่สำเร็จ" }); continue; }
        let r = await fetchJson(`${GRAPH_BASE}/${labelId}/label?user=${encodeURIComponent(psid)}&access_token=${pageTok}`, { method: "POST" });
        if (r?.success !== true) {
          r = await fetchJson(`${GRAPH_BASE}/${labelId}/label?access_token=${pageTok}`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: psid }),
          });
        }
        if (r?.success === true) {
          next = [...next.filter((l: any) => String(l?.id) !== labelId), { id: labelId, name }];
          attached.push(name);
        } else {
          failed.push({ name, error: r?.error?.error_user_msg || r?.error?.message || "ติดป้ายไม่สำเร็จ" });
        }
      }

      for (const l of toDetach.slice(0, CAP)) {
        const labelId = String(l?.id || "");
        const name = String(l?.name || labelId);
        if (!labelId) { next = next.filter((x: any) => x !== l); continue; }
        const r = await fetchJson(`${GRAPH_BASE}/${labelId}/label?user=${encodeURIComponent(psid)}&access_token=${pageTok}`, { method: "DELETE" });
        // ถอดป้ายที่ Meta ไม่มีแล้ว (คนไปลบใน Meta เอง) ให้ถือว่าสำเร็จ ไม่ค้างอยู่ในรายการเราตลอดไป
        const gone = Number(r?.error?.error_subcode) === 33 || /does not exist/i.test(String(r?.error?.message || ""));
        if (r?.success === true || gone) {
          next = next.filter((x: any) => String(x?.id) !== labelId);
          detached.push(name);
        } else {
          failed.push({ name, error: r?.error?.error_user_msg || r?.error?.message || "ถอดป้ายไม่สำเร็จ" });
        }
      }

      if (attached.length || detached.length) {
        await admin.from("chat_customers")
          .update({ meta_labels: next, updated_at: new Date().toISOString() })
          .eq("id", String(body?.id || ""));
      }
      return json({
        ok: true,
        attached, detached, failed,
        labels: next,
        remaining: Math.max(0, (toAttach.length - Math.min(toAttach.length, CAP)) + (toDetach.length - Math.min(toDetach.length, CAP))),
      });
    }

    return json({ ok: false, error: `ไม่รู้จัก action "${action}"` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
