// หาว่าแชทมาจากแอดไหน จาก "ข้อความทักทายของแอด" — ใช้กับเพจที่ไม่มีข้อมูล referral (เช่น Jr 1Shot)
//
// ทำไมต้องเดา: Meta ส่ง "มาจากแอดไหน" ทาง webhook (referral) เฉพาะตอนลูกค้ากดแอดเท่านั้น ดึงย้อนหลังไม่ได้
// และไม่ให้อ่านป้าย ad_id.X รายลูกค้า แต่แชทจากแอด Click-to-Messenger ขึ้นต้นด้วย
//   [เพจ] "<ชื่อลูกค้า> ตอบกลับโฆษณา"  →  [เพจ] ข้อความทักทายที่ตั้งไว้ในแอดตัวนั้น
// จึงดึงรายการแอดของเพจจากชื่อป้าย ad_id.X (อ่านรายชื่อป้ายของเพจได้) → อ่านข้อความทักทายของแต่ละแอด
// จาก creative → จับคู่กับข้อความทักทายในแชท · แอดหลายตัวใช้ข้อความเดียวกัน = เลือกตัวที่สร้างล่าสุดก่อนแชทเริ่ม
//
// อ่าน Meta อย่างเดียว ไม่เขียนอะไรกลับ · เขียนเฉพาะ entry_ad_id / entry_ad_name / source ของห้องที่ยังไม่รู้แหล่ง
// body { page_id, apply?: boolean }  — apply ไม่ใส่ = ดูผลก่อน (ไม่บันทึก)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getMetaToken, getAllMetaTokens, getMetaMessagingToken, getAdLibraryContext } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { loadChatPageRules, canSeeChatPage } from "../_shared/chat-pages.ts";

const GRAPH = "https://graph.facebook.com/v22.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const AD_REPLY_MARK = "ตอบกลับโฆษณา";

// เทียบข้อความแบบไม่สนช่องว่าง/อีโมจิ/เครื่องหมาย — Meta ตัดบรรทัดหรือเว้นวรรคต่างจากที่ตั้งในแอดได้
const norm = (s: string) => String(s || "").normalize("NFC").replace(/[\s​]+/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

// ดึงทุกข้อความใน page_welcome_message (JSON string ซ้อนหลายชั้น) — ตัวที่ยาวสุดคือข้อความทักทาย
// เก็บเฉพาะข้อความ "ภายใน" page_welcome_message — ห้ามเก็บ message/text อื่นของ creative
// (นั่นคือข้อความโพสต์ของแอดบนฟีด ถ้าขึ้นต้นคล้ายกันจะจับคู่ผิด)
function welcomeTexts(creative: any): string[] {
  const out: string[] = [];
  const collect = (v: any, key = "") => {
    if (v == null) return;
    if (typeof v === "string") { if (key === "text") out.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) collect(x, key); return; }
    if (typeof v === "object") for (const [k, x] of Object.entries(v)) collect(x, k);
  };
  const walk = (v: any, key = "") => {
    if (v == null) return;
    if (typeof v === "string") {
      if (key === "page_welcome_message") { try { collect(JSON.parse(v)); } catch { out.push(v); } }
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
    if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(creative?.object_story_spec);
  walk(creative?.asset_feed_spec);
  return [...new Set(out.map((s) => s.trim()).filter((s) => s.length >= 8))];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const pageId = String(body?.page_id || "").trim();
    if (!pageId) return json({ ok: false, error: "ต้องระบุ page_id" }, 400);
    const apply = body?.apply === true;
    const auth = await authorizeRequest(req, { admin: true, allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!canSeeChatPage(await loadChatPageRules(admin), pageId, auth.permission?.email ?? null)) return json({ ok: false, error: "ไม่มีสิทธิ์ดูแชทเพจนี้" }, 403);

    // ---- ดีบัก: จำนวนแชทที่เริ่มจากแอดแต่ละตัวรายวัน (ใช้เทียบกับกลุ่มข้อความทักทาย) ----
    if (Array.isArray(body?.insights_ads)) {
      const toks: string[] = [];
      for (const t of await getAllMetaTokens()) toks.push(t.token);
      toks.push(await getMetaMessagingToken().catch(() => ""));
      const since = String(body?.since || "2026-09-01"), until = String(body?.until || new Date().toISOString().slice(0, 10));
      const out: Record<string, unknown> = {};
      await Promise.all(body.insights_ads.map(async (raw: unknown) => {
        const id = String(raw).replace(/\D/g, "");
        for (const tk of toks) {
          if (!tk) continue;
          const r = await fetch(`${GRAPH}/${id}/insights?fields=actions&time_increment=1&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&limit=100&access_token=${tk}`).then((x) => x.json());
          if (r?.error) continue;
          const days: Record<string, number> = {};
          for (const d of r?.data ?? []) {
            const a = (d.actions || []).find((x: any) => x.action_type === "onsite_conversion.messaging_conversation_started_7d");
            if (a && Number(a.value) > 0) days[d.date_start] = Number(a.value);
          }
          out[id] = days; return;
        }
        out[id] = "อ่านไม่ได้";
      }));
      return json({ ok: true, insights: out });
    }

    // ---- ดีบัก: ดูข้อมูลดิบของแอดตัวเดียว (หาว่าข้อความทักทายเก็บอยู่ช่องไหน) ----
    if (body?.debug_ad) {
      const adId = String(body.debug_ad).replace(/\D/g, "");
      const tried: Record<string, unknown> = {};
      const toks: { label: string; token: string }[] = [];
      for (const t of await getAllMetaTokens()) toks.push({ label: t.label, token: t.token });
      toks.push({ label: "token ตอบแชท", token: await getMetaMessagingToken().catch(() => "") });
      for (const t of toks) {
        if (!t.token) continue;
        const r = await fetch(`${GRAPH}/${adId}?fields=name,created_time,updated_time,adset{name,destination_type,promoted_object},creative{id,name,object_type,object_story_spec,asset_feed_spec,effective_object_story_id,body,title,object_story_id}&access_token=${t.token}`).then((x) => x.json());
        if (!r?.error) {
          // ชิ้นงานโดยตรง + ปุ่มของโพสต์ (แอดโปรโมตโพสต์เดิมไม่มี object_story_spec)
          const cr = r.creative?.id ? await fetch(`${GRAPH}/${r.creative.id}?fields=object_story_spec,asset_feed_spec,call_to_action_type,template_url_spec,platform_customizations,degrees_of_freedom_spec&access_token=${t.token}`).then((x) => x.json()) : null;
          const postId = r.creative?.effective_object_story_id;
          const mainT = await getMetaToken();
          const ppd = await getMetaPages(GRAPH, mainT, { mustIncludePageId: pageId });
          const pTok = (ppd?.data ?? []).find((p: any) => String(p.id) === pageId)?.access_token;
          const post = postId && pTok ? await fetch(`${GRAPH}/${postId}?fields=call_to_action,message&access_token=${pTok}`).then((x) => x.json()) : null;
          return json({ ok: true, via: t.label, ad: r, creative_node: cr, post });
        }
        tried[t.label] = r.error?.message;
      }
      return json({ ok: false, tried });
    }

    // ---- 1) รายการแอดของเพจ จากชื่อป้าย ad_id.X ----
    const mainTok = await getMetaToken();
    const pd = await getMetaPages(GRAPH, mainTok, { mustIncludePageId: pageId });
    const pageTok = (pd?.data ?? []).find((p: any) => String(p.id) === pageId)?.access_token;
    if (!pageTok) return json({ ok: false, error: "ไม่พบ page token ของเพจนี้" });
    const adIds = new Set<string>();
    let url = `${GRAPH}/${pageId}/custom_labels?fields=page_label_name&limit=500&access_token=${pageTok}`;
    for (let i = 0; url && i < 10; i++) {
      const r = await fetch(url).then((x) => x.json());
      if (r?.error) return json({ ok: false, error: `อ่านป้ายของเพจไม่ได้: ${r.error.message}` });
      for (const l of r?.data ?? []) { const m = String(l.page_label_name || "").match(/^ad_id\.(\d+)$/); if (m) adIds.add(m[1]); }
      url = r?.paging?.next || "";
    }

    // ---- 2) ข้อความทักทายของแต่ละแอด ----
    // ลองทุก token ที่มีในระบบ (หลัก + token บัญชีโฆษณาเพิ่มเติม + token ตอบแชท + token Ad Library)
    // แอดอยู่คนละบัญชีโฆษณา/คนละธุรกิจ — ตัวไหนอ่านได้ใช้ตัวนั้น · อ่านไม่ได้ทุกตัว = เก็บเหตุผลของแต่ละ token ไว้ดู
    const tokens: { label: string; token: string }[] = [];
    const addTok = (label: string, token: string) => { if (token && !tokens.some((t) => t.token === token)) tokens.push({ label, token }); };
    for (const t of await getAllMetaTokens()) addTok(t.label, t.token);
    addTok("token ตอบแชท", await getMetaMessagingToken().catch(() => ""));
    addTok("token Ad Library", (await getAdLibraryContext().catch(() => ({ token: "" }))).token);
    const ads: Array<{ id: string; name: string; campaign: string | null; created: string; texts: string[]; error?: string; via?: string; tried?: Record<string, string>; tok?: string }> = [];
    await Promise.all([...adIds].map(async (id) => {
      const tried: Record<string, string> = {};
      for (const t of tokens) {
        try {
          const r = await fetch(`${GRAPH}/${id}?fields=name,created_time,campaign{name},creative{object_story_spec,asset_feed_spec}&access_token=${t.token}`).then((x) => x.json());
          if (r?.error) { tried[t.label] = `${r.error.code ?? ""}/${r.error.error_subcode ?? ""} ${String(r.error.message || "").slice(0, 90)}`; continue; }
          ads.push({ id, name: r.name || id, campaign: r.campaign?.name ?? null, created: r.created_time || "", texts: welcomeTexts(r.creative), via: t.label, tok: t.token });
          return;
        } catch (e) { tried[t.label] = String(e).slice(0, 90); }
      }
      ads.push({ id, name: "", campaign: null, created: "", texts: [], error: "ไม่มี token ไหนอ่านแอดนี้ได้", tried });
    }));

    // ---- 3) จับคู่กับแชทที่ขึ้นต้นด้วย "ตอบกลับโฆษณา" และยังไม่รู้แหล่งแอด ----
    const { data: rows, error } = await admin.from("chat_customers").select("id, customer_name, transcript, entry_ad_id").eq("page_id", pageId).is("entry_ad_id", null).limit(5000);
    if (error) throw error;
    const results: any[] = [];
    let adReply = 0, matched = 0, ambiguous = 0;
    for (const row of rows ?? []) {
      const tr = Array.isArray(row.transcript) ? row.transcript : [];
      const i = tr.findIndex((m: any) => m?.w === "p" && String(m?.t || "").trim().endsWith(AD_REPLY_MARK));
      if (i < 0 || i > 3) continue;
      adReply++;
      const greet = tr.slice(i + 1, i + 3).find((m: any) => m?.w === "p" && String(m?.t || "").trim());
      const g = norm(greet?.t || "");
      if (!g) { results.push({ id: row.id, name: row.customer_name, ad: null, reason: "ไม่มีข้อความทักทายต่อจากบรรทัดตอบกลับโฆษณา" }); continue; }
      const startedAt = String(tr[i]?.at || "");
      // ตรงกันทั้งข้อความ หรือขึ้นต้นตรงกันอย่างน้อย 30 ตัวอักษร (Meta อาจตัดท้าย/ต่อปุ่มตอบด่วน)
      const same = (n: string) => n === g || (Math.min(n.length, g.length) >= 30 && (n.startsWith(g) || g.startsWith(n)));
      let cands = ads.filter((a) => a.texts.some((t) => { const n = norm(t); return !!n && same(n); }));
      if (cands.length > 1) {
        ambiguous++;
        const before = cands.filter((a) => !a.created || !startedAt || a.created <= startedAt.replace("+0000", "Z"));
        if (before.length) cands = before;
        cands.sort((a, b) => b.created.localeCompare(a.created));
      }
      const ad = cands[0] || null;
      if (ad) matched++;
      // จับคู่แอดไม่ได้ (แอดโปรโมตโพสต์เดิม — Meta ไม่ส่งข้อความทักทายมา) → ระบุเป็น "กลุ่มข้อความโฆษณา" แทน
      // รู้ว่ามาจากแอดแน่ ๆ และมาจากโปรไหน แต่ไม่ระบุตัวแอด (กันข้อมูลผิด) · เจอแอดตรงตัวทีหลังจะเขียนทับเอง
      const firstLine = String(greet?.t || "").split("\n").map((x: string) => x.trim()).find(Boolean) || "";
      // แอดที่ไม่ได้ตั้งข้อความทักทาย Meta ใส่ข้อความมาตรฐานที่มีชื่อลูกค้า — รวมเป็นกลุ่มเดียว ไม่งั้นแตกกลุ่มละคน
      const isDefault = /^สวัสดี .+ มีอะไรให้เราช่วยไหม/.test(firstLine) || /^Hi,? .+!? Please let us know how we can help you/i.test(firstLine);
      const group = !ad && firstLine ? `กลุ่มข้อความโฆษณา: ${isDefault ? "ข้อความทักทายมาตรฐานของ Meta (แอดไม่ได้ตั้งข้อความ)" : firstLine.slice(0, 80)}` : null;
      const startIso = startedAt ? new Date(startedAt.replace(/\+0000$/, "Z")).toISOString() : "";
      const dayTh = startIso ? new Date(new Date(startIso).getTime() + 7 * 3600e3).toISOString().slice(0, 10) : "";
      results.push({ id: row.id, name: row.customer_name, ad: ad ? { id: ad.id, name: ad.name } : null, group, startIso, dayTh, candidates: cands.length, greet: String(greet?.t || "").slice(0, 60) });
    }

    // ---- 4) กลุ่มที่ไม่มีข้อความทักทายให้เทียบ → จับคู่กับแอดด้วยสถิติ "แชทที่เริ่มต่อวัน" ของแต่ละแอด ----
    // แอดโปรโมตโพสต์เดิม Meta ไม่ส่งข้อความทักทายมา แต่บอกจำนวนแชทที่เริ่มจากแอดนั้นรายวัน (insights)
    // จับคู่แบบโลภทีละคู่ (กลุ่ม, แอด) ที่อธิบายจำนวนห้องรายวันได้มากสุด แล้วหักยอดที่อธิบายแล้วออกจากทั้งสองฝั่ง
    //   → แอดที่วิ่งช่วงเดียวกันแยกกันได้ (เช่น แอด Exness กับแอดโปร 60% วิ่งพร้อมกัน 12–19 ต.ค.)
    // แอดหนึ่งตัวผูกได้กลุ่มเดียว · คู่ที่อธิบายได้น้อย (< 3 ห้อง หรือ < 60% ของกลุ่ม) = ไม่ผูก คงชื่อกลุ่มไว้
    const unmatched = results.filter((x) => !x.ad && x.group && x.dayTh);
    const noGreetAds = ads.filter((a) => !a.error && !a.texts.length && a.tok);
    let estimated = 0;
    const pairs: Array<{ group: string; ad: string; explained: number }> = [];
    if (unmatched.length && noGreetAds.length) {
      const since = unmatched.map((x) => x.dayTh).sort()[0];
      const until = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      const adDays = new Map<string, Record<string, number>>();
      await Promise.all(noGreetAds.map(async (a) => {
        const r = await fetch(`${GRAPH}/${a.id}/insights?fields=actions&time_increment=1&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&limit=200&access_token=${a.tok}`).then((x) => x.json()).catch(() => null);
        const days: Record<string, number> = {};
        for (const d of r?.data ?? []) {
          const v = Number((d.actions || []).find((x: any) => x.action_type === "onsite_conversion.messaging_conversation_started_7d")?.value || 0);
          if (v > 0) days[d.date_start] = v;
        }
        if (Object.keys(days).length) adDays.set(a.id, days);
      }));
      const groupDays = new Map<string, Record<string, number>>();
      for (const x of unmatched) { const g = groupDays.get(x.group) ?? {}; g[x.dayTh] = (g[x.dayTh] || 0) + 1; groupDays.set(x.group, g); }
      const resG = new Map([...groupDays].map(([k, v]) => [k, { ...v }]));
      const resA = new Map([...adDays].map(([k, v]) => [k, { ...v }]));
      const adGroup = new Map<string, string>();
      for (;;) {
        let best: { g: string; a: string; v: number } | null = null;
        for (const [g, gd] of resG) for (const [a, ad] of resA) {
          if (adGroup.has(a)) continue;
          let v = 0; for (const d of Object.keys(gd)) v += Math.min(gd[d], ad[d] || 0);
          if (!best || v > best.v) best = { g, a, v };
        }
        if (!best || best.v < 3) break;
        const total = Object.values(groupDays.get(best.g)!).reduce((s0, n) => s0 + n, 0);
        adGroup.set(best.a, best.g);
        pairs.push({ group: best.g, ad: best.a, explained: best.v });
        const gd = resG.get(best.g)!, ad = resA.get(best.a)!;
        for (const d of Object.keys(gd)) { const m = Math.min(gd[d], ad[d] || 0); gd[d] -= m; ad[d] = (ad[d] || 0) - m; }
        void total;
      }
      // กลุ่มที่แอดที่ผูกไว้รวมกันอธิบายได้ไม่ถึง 60% = ไม่ผูกเลย (ไม่ชัดพอ)
      for (const [g, gd] of groupDays) {
        const total = Object.values(gd).reduce((s0, n) => s0 + n, 0);
        const explained = pairs.filter((p) => p.group === g).reduce((s0, p) => s0 + p.explained, 0);
        if (explained < Math.max(3, total * 0.6)) for (const [a, gg] of [...adGroup]) if (gg === g) adGroup.delete(a);
      }
      const adById = new Map(ads.map((a) => [a.id, a]));
      for (const x of unmatched) {
        // แอดของกลุ่มนี้ที่มีแชทเริ่มในวันนั้น และสร้างก่อนเวลาที่แชทเริ่ม → เลือกตัวที่มีแชทวันนั้นมากสุด
        const opts = [...adGroup].filter(([a, g]) => g === x.group && (adDays.get(a)?.[x.dayTh] || 0) > 0)
          .map(([a]) => adById.get(a)!).filter((a) => !a.created || !x.startIso || new Date(a.created).getTime() <= new Date(x.startIso).getTime())
          .sort((p, q) => (adDays.get(q.id)?.[x.dayTh] || 0) - (adDays.get(p.id)?.[x.dayTh] || 0));
        if (opts[0]) { x.ad = { id: opts[0].id, name: opts[0].name }; x.estimated = true; estimated++; }
      }
    }

    let saved = 0, grouped = 0;
    if (apply) {
      const now = new Date().toISOString();
      for (const r of results.filter((x) => x.ad)) {
        const { error: ue } = await admin.from("chat_customers")
          .update({ entry_ad_id: r.ad.id, entry_ad_name: r.ad.name, source: "ad", updated_at: now })
          .eq("id", r.id).is("entry_ad_id", null);
        if (!ue) saved++;
      }
      for (const r of results.filter((x) => !x.ad && x.group)) {
        const { error: ue } = await admin.from("chat_customers")
          .update({ entry_ad_name: r.group, source: "ad", updated_at: now })
          .eq("id", r.id).is("entry_ad_id", null);
        if (!ue) grouped++;
      }
      await admin.from("customer_report_cache").delete().eq("page_id", pageId);
    }

    return json({
      ok: true, apply, page_id: pageId, ads_total: ads.length, ads_readable: ads.filter((a) => !a.error).length,
      ads_with_greeting: ads.filter((a) => a.texts.length).length,
      tokens_tried: tokens.map((t) => t.label),
      ads: ads.map((a) => ({ id: a.id, name: a.name, campaign: a.campaign, via: a.via, error: a.error, tried: a.tried, greeting: a.texts[0]?.slice(0, 60) })),
      rooms_unknown: rows?.length ?? 0, rooms_ad_reply: adReply, matched, ambiguous, estimated, saved, grouped,
      pairs: pairs.map((p) => ({ ...p, ad_name: ads.find((a) => a.id === p.ad)?.name })),
      groups: Object.entries(results.filter((x) => x.group).reduce((m: Record<string, number>, x) => { m[x.group] = (m[x.group] || 0) + 1; return m; }, {})),
      sample: results.slice(0, 30),
    });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 200);
  }
});
