// ตรวจเฉพาะคอมเมนต์ที่มีอยู่ใน Inbox และยังค้างตอบ ว่าเพจได้ตอบจาก Facebook โดยตรงแล้วหรือยัง
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getMetaBackgroundGuard, recordMetaUsage } from "../_shared/meta-rate.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const SYNC_STATE_KEY = "comment_reply_fallback_sync";
const SYNC_COOLDOWN_MS = 12 * 60 * 1000;
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { tab: "inbox" });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    const pageIds = [...new Set((Array.isArray(body?.page_ids) ? body.page_ids : []).map(String).filter(Boolean))];
    if (!pageIds.length) return json({ ok: true, checked: 0, reconciled: 0 });
    // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้าตอบแชทได้ ก็ตอบได้ทุกเพจและทุก LINE OA

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await getMetaBackgroundGuard(admin);
    if (guard.blocked) return json({ ok: true, checked: 0, reconciled: 0, skipped: "rate_guard" });
    const { data: stateRow } = await admin.from("settings").select("value").eq("key", SYNC_STATE_KEY).maybeSingle();
    const state = stateRow?.value || {};
    const lastByPage = state.last_by_page && typeof state.last_by_page === "object" ? state.last_by_page : {};
    const duePageIds = pageIds.filter((id) => Date.now() - new Date(lastByPage[id] || 0).getTime() >= SYNC_COOLDOWN_MS);
    if (!duePageIds.length) return json({ ok: true, checked: 0, reconciled: 0, skipped: "cooldown" });
    const checkedAt = new Date().toISOString();
    for (const id of duePageIds) lastByPage[id] = checkedAt;
    // Claim the cooldown before calling Meta so concurrent staff devices do not all run the same fallback scan.
    await admin.from("settings").upsert({ key: SYNC_STATE_KEY, value: { last_by_page: lastByPage }, updated_at: checkedAt });
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: rows, error } = await admin.from("chat_customers")
      .select("id,page_id,transcript")
      .eq("source", "comment").eq("awaiting_reply", true)
      .in("page_id", duePageIds).gte("last_message_at", cutoff)
      .order("last_message_at", { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    if (!rows?.length) return json({ ok: true, checked: 0, reconciled: 0 });

    const token = await getMetaToken();
    const pages = await getMetaPages(GRAPH_BASE, token);
    const pageTokens = new Map((pages?.data || []).map((p: any) => [String(p.id), String(p.access_token || "")]));
    let reconciled = 0;
    for (let offset = 0; offset < rows.length; offset += 10) {
      await Promise.all(rows.slice(offset, offset + 10).map(async (row: any) => {
        const pageToken = pageTokens.get(String(row.page_id));
        if (!pageToken) return;
        const commentId = String(row.id).replace(/^fbc_/, "");
        const url = `${GRAPH_BASE}/${commentId}/comments?fields=id,message,from,created_time&order=chronological&limit=50&access_token=${encodeURIComponent(pageToken)}`;
        const response = await fetch(url);
        await recordMetaUsage(admin, response, "comment_reply_fallback");
        const result = await response.json().catch(() => ({}));
        const replies = (result?.data || []).filter((x: any) => String(x?.from?.id || "") === String(row.page_id));
        if (!replies.length) return;
        const tr = Array.isArray(row.transcript) ? row.transcript : [];
        const seen = new Set(tr.map((m: any) => m?.mid).filter(Boolean));
        const additions = replies.filter((x: any) => !seen.has(String(x.id))).map((x: any) => ({
          w: "p", t: String(x.message || "[ตอบจากเพจ]").slice(0, 500), at: x.created_time || new Date().toISOString(),
          mid: String(x.id), via: "facebook_page", by_name: "ตอบจากเพจ",
        }));
        const latest = replies[replies.length - 1];
        await admin.from("chat_customers").update({
          transcript: [...tr, ...additions].slice(-80), awaiting_reply: false, unread: false,
          last_reply_text: String(latest.message || "[ตอบจากเพจ]").slice(0, 500), last_reply_by: "ตอบจากเพจ",
          last_reply_at: latest.created_time || new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        reconciled++;
      }));
    }
    return json({ ok: true, checked: rows.length, reconciled });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 200);
  }
});
