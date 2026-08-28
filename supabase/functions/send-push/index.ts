// supabase/functions/send-push/index.ts
// Web Push — 3 โหมด:
//   { action: "vapid_public" }        → คืน public key ให้หน้าเว็บใช้ subscribe
//   { action: "subscribe", subscription, pages? } → บันทึก subscription ของเครื่องนี้
//   { action: "unsubscribe", endpoint } → ลบ subscription
//   body {} (จาก cron / service role) → เช็คแชทค้างแล้วส่ง push
//
// ต้องตั้ง secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com)
// สร้างคีย์: npx web-push generate-vapid-keys
// deploy: supabase functions deploy send-push

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { authorizeRequest, canAccessPage } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); } catch (_e) { /* คีย์ผิดรูป */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isService = !!bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    const action = body?.action ? String(body.action) : (isService ? "cron" : "");

    // ---- คืน public key (ไม่ต้องล็อกอินก็ได้ เป็นค่าสาธารณะ) ----
    if (action === "vapid_public") return json({ ok: true, key: VAPID_PUBLIC || null, has_private: !!VAPID_PRIVATE });

    // ---- วินิจฉัย (admin): ชี้ว่าติดชั้นไหน — webhook/unread? cron? subscription? ----
    if (action === "diag") {
      const auth = await authorizeRequest(req, { admin: true, setting: "chat" });
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
      const { data: ohRow } = await admin.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const alertMin = Math.max(1, Number((ohRow?.value as any)?.alert_min ?? (ohRow?.value as any)?.slow_min ?? 3));
      const cutoff = new Date(Date.now() - alertMin * 60000).toISOString();
      const cnt = async (b: (q: any) => any) => (await b(admin.from("chat_customers").select("id", { count: "exact", head: true })))?.count ?? 0;
      const unreadTotal = await cnt((q: any) => q.eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,source.neq.comment").neq("source", "line"));
      const overdue = await cnt((q: any) => q.eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,source.neq.comment").neq("source", "line").lte("last_message_at", cutoff));
      // ข้อความล่าสุดที่ไหลเข้ามา (ดูว่า webhook/ซิงก์ยังอัปเดต DB อยู่ไหม)
      const { data: latest } = await admin.from("chat_customers").select("customer_name, page_name, last_message_at, unread, updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const { count: subCount } = await admin.from("push_subscriptions").select("endpoint", { count: "exact", head: true });
      const { count: mySubCount } = await admin.from("push_subscriptions").select("endpoint", { count: "exact", head: true }).eq("email", auth.permission!.email);
      // cron ถูกตั้งจริงใน pg_cron ไหม
      let cronRows: any[] = [];
      try { const { data } = await admin.rpc("app_list_cron"); cronRows = (data ?? []).filter((r: any) => r.jobname?.includes("push")); } catch { /* pg_cron ปิด */ }
      return json({
        ok: true, alertMin,
        vapid_ok: !!(VAPID_PUBLIC && VAPID_PRIVATE),
        unread_total: unreadTotal, overdue_now: overdue,
        latest_chat: latest || null,
        subscriptions_all: subCount ?? 0, subscriptions_mine: mySubCount ?? 0,
        push_cron: cronRows,
      });
    }

    // ---- ทดสอบส่ง push หา "ตัวเอง" (เครื่องที่กดปุ่มทดสอบ) — วินิจฉัยว่า push ส่งถึงจริงไหม ----
    if (action === "test") {
      const auth = await authorizeRequest(req, { tab: "inbox" });
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
      if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ ok: false, error: "ยังไม่ได้ตั้ง VAPID keys (secrets) ที่ Supabase" });
      const { data: mySubs, error: selErr } = await admin.from("push_subscriptions").select("*").eq("email", auth.permission!.email);
      if (selErr) return json({ ok: false, error: `อ่านตาราง push_subscriptions ไม่ได้ (${selErr.code || "?"}): ${selErr.message} — รัน migration สร้างตารางแล้วหรือยัง?` });
      if (!mySubs?.length) return json({ ok: false, error: "ยังไม่มี subscription ของบัญชีนี้ — กด 'เปิดแจ้งเตือน' ในแอปก่อน (ต้องเป็น https)" });
      let ok = 0; const errs: string[] = [];
      for (const s of mySubs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: "🔔 ทดสอบแจ้งเตือน", body: "ถ้าเห็นข้อความนี้ = push ใช้งานได้แล้ว", tag: "push-test", url: "/?tab=inbox" }));
          ok++;
        } catch (e: any) { errs.push(`(${e?.statusCode || "?"}) ${String(e?.body || e?.message || e).slice(0, 150)}`); }
      }
      return json({ ok: ok > 0, sent: ok, total: mySubs.length, errors: errs });
    }

    // ---- subscribe / unsubscribe : ต้องเป็นผู้ใช้ล็อกอิน ----
    if (action === "subscribe" || action === "unsubscribe") {
      const auth = await authorizeRequest(req, { tab: "inbox" });
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
      const email = auth.permission!.email;

      if (action === "unsubscribe") {
        if (body?.endpoint) await admin.from("push_subscriptions").delete().eq("endpoint", String(body.endpoint)).eq("email", email);
        return json({ ok: true });
      }
      const sub = body?.subscription;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({ ok: false, error: "subscription ไม่ครบ" });
      const requestedPages = Array.isArray(body?.pages) ? body.pages.map(String) : [];
      if (auth.permission!.role !== "admin" && requestedPages.some((pageId: string) => !canAccessPage(auth.permission!, pageId))) {
        return json({ ok: false, error: "มีเพจที่อยู่นอกสิทธิ์ของผู้ใช้" }, 403);
      }
      const deviceId = body?.device_id ? String(body.device_id).slice(0, 80) : null;
      const { error: upErr } = await admin.from("push_subscriptions").upsert({
        email, endpoint: String(sub.endpoint),
        p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth),
        pages: requestedPages,
        notify_new: body?.notify_new !== false,   // เตือนทุกข้อความใหม่ (ค่าเริ่มต้น: เปิด)
        device_id: deviceId,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (upErr) return json({ ok: false, error: `บันทึก subscription ไม่ได้ (${upErr.code || "?"}): ${upErr.message} — รัน migration push_subscriptions แล้วหรือยัง?` });
      // กันแถวงอกซ้ำ: 1 เครื่อง = 1 แถว — ลบ endpoint เก่าของ "เครื่องเดียวกัน" (device_id) ที่ไม่ใช่ตัวล่าสุดทิ้ง
      if (deviceId) await admin.from("push_subscriptions").delete().eq("email", email).eq("device_id", deviceId).neq("endpoint", String(sub.endpoint));
      return json({ ok: true });
    }

    // ---- resubscribe: SW ต่ออายุ subscription เอง (pushsubscriptionchange) ตอนแอปปิด ----
    // ไม่ต้องล็อกอิน (SW ไม่มี JWT ผู้ใช้) — อ้างอิงจาก old_endpoint ซึ่งเป็นความลับของเครื่องนั้น
    // คงเจ้าของ/เพจ/การตั้งค่าเดิมไว้ แล้วสลับไป endpoint ใหม่ ; ถ้าหา old_endpoint ไม่เจอ = ไม่ทำอะไร (ไปต่อรอบเปิดแอป)
    if (action === "resubscribe") {
      const sub = body?.subscription;
      const oldEndpoint = body?.old_endpoint ? String(body.old_endpoint) : "";
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({ ok: false, error: "subscription ไม่ครบ" });
      if (!oldEndpoint) return json({ ok: true, updated: false });
      const { data: prev } = await admin.from("push_subscriptions").select("*").eq("endpoint", oldEndpoint).maybeSingle();
      if (!prev) return json({ ok: true, updated: false });   // ไม่รู้เจ้าของ = ไม่สร้างแถวลอย
      await admin.from("push_subscriptions").delete().eq("endpoint", oldEndpoint);
      const { error: reErr } = await admin.from("push_subscriptions").upsert({
        email: prev.email, endpoint: String(sub.endpoint),
        p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth),
        pages: prev.pages ?? [], notify_new: prev.notify_new !== false,
        device_id: prev.device_id ?? null,
        user_agent: prev.user_agent ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (reErr) return json({ ok: false, error: reErr.message });
      return json({ ok: true, updated: true });
    }

    // ---- notify_new: ยิง push "ข้อความใหม่ทันที" (เรียกจาก meta-webhook, service role) ----
    // ส่งให้ทุกเครื่องที่ (1) เปิดรับข้อความใหม่ (2) มีสิทธิ์เพจนี้ (3) เลือกเพจนี้ไว้ (ถ้าเลือก)
    if (action === "notify_new") {
      if (!isService) return json({ ok: false, error: "unauthorized" }, 401);
      if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ ok: false, error: "no vapid" });
      const pageId = String(body?.page_id || "");
      if (!pageId) return json({ ok: false, error: "no page_id" });
      const pageName = body?.page_name ? String(body.page_name) : "";
      const custName = body?.customer_name ? String(body.customer_name) : "ลูกค้า";
      const text = body?.text ? String(body.text).slice(0, 120) : "ส่งข้อความใหม่";
      const convId = body?.conversation_id ? String(body.conversation_id) : "";

      const { data: subs } = await admin.from("push_subscriptions").select("*").neq("notify_new", false);
      const { data: perms } = await admin.from("user_permissions").select("email, role, allowed_pages, chat_alert");
      const permByEmail: Record<string, any> = {};
      for (const p of perms ?? []) permByEmail[p.email] = p;
      // ดึงแชท "ยังไม่อ่าน" ทั้งหมดครั้งเดียว → ใช้คำนวณจุดแดงบนไอคอน (badge) ตามขอบเขตของแต่ละเครื่อง
      const { data: unreadRows } = await admin.from("chat_customers").select("page_id").eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,source.neq.comment").neq("source", "line").limit(1000);
      const badgeFor = (allowed: string[] | null, want: string[]) => (unreadRows ?? []).filter((u: any) => {
        if (allowed && !allowed.includes(u.page_id)) return false;
        if (want.length && !want.includes(u.page_id)) return false;
        return true;
      }).length;

      // ยิงทุกเครื่อง "พร้อมกัน" (เดิม await ทีละตัว = ช้าเมื่อมี subscription เยอะ/ตาย → แจ้งเตือนถึงเครื่องจริงช้า)
      let sent = 0, pruned = 0;
      await Promise.allSettled((subs ?? []).map(async (sub: any) => {
        const perm = permByEmail[sub.email];
        if (perm && perm.chat_alert === false) return;
        const allowedPages: string[] | null = perm && perm.role === "analyze_only" && Array.isArray(perm.allowed_pages) ? perm.allowed_pages.map(String) : null;
        if (allowedPages && !allowedPages.includes(pageId)) return;      // ไม่มีสิทธิ์เพจนี้
        const wantPages: string[] = Array.isArray(sub.pages) && sub.pages.length ? sub.pages.map(String) : [];
        if (wantPages.length && !wantPages.includes(pageId)) return;      // ไม่ได้เลือกเพจนี้
        const payload = JSON.stringify({
          title: `💬 ${custName}${pageName ? ` · ${pageName}` : ""}`,
          body: text,
          tag: `newmsg-${convId || pageId}`,   // ข้อความใหม่ของแชทเดิม = แทนที่อันเก่า ไม่กองซ้อน
          renotify: true,
          url: "/?tab=inbox",
          badge: badgeFor(allowedPages, wantPages),   // จุดแดงบนไอคอน = จำนวนแชทค้างอ่านของเครื่องนี้
        });
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          sent++;
        } catch (e: any) {
          const code = e?.statusCode || e?.status;
          if (code === 404 || code === 410) { await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); pruned++; }
        }
      }));
      return json({ ok: true, sent, pruned });
    }

    // อ่าน/ตอบจากอุปกรณ์หนึ่งแล้ว → ล้าง notification ของแชทนั้นและคำนวณ badge ใหม่ให้ทุกอุปกรณ์
    if (action === "sync_state") {
      if (!isService) return json({ ok: false, error: "unauthorized" }, 401);
      if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ ok: false, error: "no vapid" });
      const conversationId = String(body?.conversation_id || "");
      const { data: subs } = await admin.from("push_subscriptions").select("*");
      const { data: perms } = await admin.from("user_permissions").select("email, role, allowed_pages, chat_alert");
      const { data: unreadRows } = await admin.from("chat_customers").select("page_id").eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,source.neq.comment").neq("source", "line").limit(1000);
      const permByEmail: Record<string, any> = {};
      for (const p of perms ?? []) permByEmail[p.email] = p;
      let sent = 0, pruned = 0;
      await Promise.allSettled((subs ?? []).map(async (sub: any) => {
        // iOS (web.push.apple.com) ห้าม push แบบเงียบ (ไม่โชว์ notification) เด็ดขาด — sync_state เป็น push เงียบ
        // ถ้าส่งไป iOS จะถือเป็นการละเมิดแล้วลงโทษด้วยการหยุดส่ง push ของแอปนั้น → เลยข้าม Apple ทั้งหมด
        // (badge/จุดแดงบน iOS ให้แอปเคลียร์เองตอนเปิด/โฟกัส ซึ่งทำอยู่แล้ว)
        if (String(sub.endpoint || "").includes("web.push.apple.com")) return;
        const perm = permByEmail[sub.email];
        const allowed: string[] | null = perm && perm.role === "analyze_only" && Array.isArray(perm.allowed_pages) ? perm.allowed_pages.map(String) : null;
        const want: string[] = Array.isArray(sub.pages) ? sub.pages.map(String) : [];
        const badge = (unreadRows ?? []).filter((r: any) => (!allowed || allowed.includes(String(r.page_id))) && (!want.length || want.includes(String(r.page_id)))).length;
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ action: "sync_state", conversation_id: conversationId, badge }),
          );
          sent++;
        } catch (e: any) {
          const code = e?.statusCode || e?.status;
          if (code === 404 || code === 410) { await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); pruned++; }
        }
      }));
      if (conversationId) await admin.from("push_sent_log").delete().eq("conversation_id", conversationId);
      return json({ ok: true, sent, pruned });
    }

    // ---- cron: เช็คแชทค้างแล้วส่ง push (เฉพาะ service role) ----
    if (action === "cron") {
      if (!isService) return json({ ok: false, error: "unauthorized" }, 401);
      if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
        console.log("[push] ❌ ยังไม่ได้ตั้ง VAPID keys — public:", !!VAPID_PUBLIC, "private:", !!VAPID_PRIVATE);
        return json({ ok: false, error: "ยังไม่ได้ตั้ง VAPID keys (secrets)" });
      }

      // เกณฑ์เวลาแจ้งเตือนจาก office_hours (ใช้ slow_min เป็น default), ขั้นต่ำ 1 นาที
      const { data: ohRow } = await admin.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const alertMin = Math.max(1, Number((ohRow?.value as any)?.alert_min ?? (ohRow?.value as any)?.slow_min ?? 3));
      const cutoff = new Date(Date.now() - alertMin * 60000).toISOString();

      // แชทที่ยังไม่อ่าน + ค้างเกินเกณฑ์
      const { data: overdue } = await admin.from("chat_customers")
        .select("id, page_id, page_name, customer_name")
        .eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,source.neq.comment").neq("source", "line").lte("last_message_at", cutoff).limit(500);
      const rows = overdue ?? [];

      // subscriptions + สิทธิ์เพจของแต่ละคน
      const { data: subs } = await admin.from("push_subscriptions").select("*");
      const { data: perms } = await admin.from("user_permissions").select("email, role, allowed_pages, chat_alert");
      const permByEmail: Record<string, any> = {};
      for (const p of perms ?? []) permByEmail[p.email] = p;

      // กันส่งซ้ำ: เคยส่งรายนี้ไป endpoint นี้ใน 10 นาทีล่าสุดแล้วข้าม
      const { data: sentLog } = await admin.from("push_sent_log").select("conversation_id, endpoint, sent_at").gte("sent_at", new Date(Date.now() - 10 * 60000).toISOString());
      const sentSet = new Set((sentLog ?? []).map((s) => `${s.conversation_id}|${s.endpoint}`));

      let sent = 0, pruned = 0;
      const newlySent: { conversation_id: string; endpoint: string }[] = [];

      for (const sub of subs ?? []) {
        const perm = permByEmail[sub.email];
        // แอดมิน = เห็นทุกเพจ ; จำกัดสิทธิ์ = ตาม allowed_pages ; ปิดแจ้งเตือน = ข้าม
        if (perm && perm.chat_alert === false) continue;
        const allowedPages: string[] | null = perm && perm.role === "analyze_only" && Array.isArray(perm.allowed_pages) ? perm.allowed_pages.map(String) : null;
        const wantPages: string[] = Array.isArray(sub.pages) && sub.pages.length ? sub.pages.map(String) : [];

        // แชทที่เครื่องนี้ควรได้รับ
        const mine = rows.filter((r) => {
          if (allowedPages && !allowedPages.includes(r.page_id)) return false;   // ไม่มีสิทธิ์เพจนี้
          if (wantPages.length && !wantPages.includes(r.page_id)) return false;   // ไม่ได้เลือกเพจนี้
          return !sentSet.has(`${r.id}|${sub.endpoint}`);
        });
        if (!mine.length) continue;

        const pageNames = [...new Set(mine.map((r) => r.page_name || r.page_id))].slice(0, 3);
        const payload = JSON.stringify({
          title: `🔴 ${mine.length} แชทค้างอ่านเกิน ${alertMin} นาที`,
          body: pageNames.length ? `เพจ: ${pageNames.join(", ")}` : "มีลูกค้ารอตอบ",
          tag: "overdue-chat",
          url: "/?tab=inbox",
          badge: mine.length,   // จุดแดงบนไอคอน
        });
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          sent++;
          for (const r of mine) newlySent.push({ conversation_id: r.id, endpoint: sub.endpoint });
          await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", sub.endpoint);
        } catch (e: any) {
          // 404/410 = subscription ตายแล้ว (ผู้ใช้ถอนสิทธิ์/ล้างเบราว์เซอร์) → ลบทิ้ง
          const code = e?.statusCode || e?.status;
          if (code === 404 || code === 410) { await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); pruned++; }
          else console.log(`[push] ส่งพลาด (${code || "?"}):`, String(e?.body || e?.message || e).slice(0, 200));   // เห็น error จริง ไม่กลืนเงียบ
        }
      }

      if (newlySent.length) await admin.from("push_sent_log").upsert(newlySent.map((x) => ({ ...x, sent_at: new Date().toISOString() })), { onConflict: "conversation_id,endpoint" });
      // เก็บกวาด log เก่า (>1 วัน)
      await admin.from("push_sent_log").delete().lt("sent_at", new Date(Date.now() - 86400000).toISOString());

      // สรุปทุกรอบ — อ่านใน Logs ได้ว่าติดชั้นไหน (แชทค้าง 0? subscription 0? ส่งแล้วกี่ราย?)
      console.log(`[push] alertMin=${alertMin} · แชทค้าง=${rows.length} · subscription=${(subs ?? []).length} · ส่งสำเร็จ=${sent} · ลบตาย=${pruned}`);
      return json({ ok: true, overdue: rows.length, subscriptions: (subs ?? []).length, sent, pruned });
    }

    return json({ ok: false, error: `ไม่รู้จัก action "${action}"` });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
