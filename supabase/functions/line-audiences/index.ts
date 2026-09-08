// supabase/functions/line-audiences/index.ts
// ซิงก์ "แท็ก" ของแชท LINE ในระบบนี้ → "กลุ่มผู้ชม" (Audience) ของ LINE OA
//   { action: "sync" }                 -> ปรับทุกแท็กให้ตรงกัน (ใช้กับ cron)
//   { action: "sync", tags: ["..."] }  -> ปรับเฉพาะแท็กที่ระบุ (เรียกตอนแอดมินติด/ถอดแท็ก)
//   { action: "status" }               -> รายการกลุ่มที่ซิงก์ไว้ + จำนวนสมาชิก (ให้หน้าเว็บโชว์)
//
// ทำไมต้องใช้ "กลุ่มผู้ชม" แทน "แท็กแชท":
//   LINE Messaging API ไม่มี endpoint แท็กแชทเลย ตรวจด้วย token จริงแล้วทุกทาง
//     /v2/bot/chat/tags, /v2/bot/tag/list, /v2/bot/chat/{userId}/tag, /v2/bot/user/{userId}/tags
//     ตอบ 404 ทุกตัว ขณะที่ /v2/bot/profile/{userId} ตอบ 200 (= ไม่ใช่เรื่องสิทธิ์ แต่ไม่มี API)
//   แท็กใน LINE OA Manager จึงส่งเข้าจากภายนอกไม่ได้
//   สิ่งที่ทำได้คือกลุ่มผู้ชม ซึ่งโผล่ในหน้า LINE OA Manager และใช้ยิงบรอดแคสต์เจาะกลุ่มได้
//
// ข้อจำกัดของ LINE ที่โค้ดนี้ต้องรับมือ:
//   1. ไม่มี API อ่านรายชื่อสมาชิกของกลุ่ม → จดเองที่ line_audience_groups.member_psids
//   2. ไม่มี API ลบสมาชิกทีละคน → ถ้ามีคนถูกถอดแท็ก ต้องลบทั้งกลุ่มแล้วสร้างใหม่
//      (audienceGroupId เปลี่ยน จึงทำเฉพาะเมื่อจำเป็นจริง ไม่ใช่ทุกครั้งที่แท็กขยับ)
//   3. กลุ่มมีอายุ 180 วัน → สร้างใหม่ก่อนหมดอายุ (cron รายวันเรียก action sync)
//
// deploy: supabase functions deploy line-audiences

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getLineConfig, lineApi } from "../_shared/line.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// LINE รับ audiences ไม่เกิน 10,000 รายต่อคำขอ — เผื่อไว้ที่ 5,000 ให้ payload ไม่ใหญ่เกิน
const UPLOAD_CHUNK = 5_000;
// สร้างกลุ่มใหม่ล่วงหน้าก่อนหมดอายุ กันกลุ่มหายกลางทาง
const RENEW_BEFORE_DAYS = 14;
// LINE จำกัดชื่อกลุ่มไว้ 120 ตัวอักษร
const DESC_MAX = 120;

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export type SyncResult = {
  tag: string;
  action: "created" | "added" | "rebuilt" | "deleted" | "unchanged" | "failed";
  audience_group_id?: number;
  members: number;
  added?: number;
  removed?: number;
  error?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const body = await readJsonBody(req, 64 * 1024);
    const action = String(body?.action || "sync");
    // ติด/ถอดแท็กเป็นงานประจำของแอดมินตอบแชท ไม่ใช่การตั้งค่าระบบ · cron เรียกด้วย service key
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"], allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { accessToken } = await getLineConfig();
    if (!accessToken) return json({ ok: false, error: "ยังไม่ได้ตั้งค่า LINE channel access token" }, 400);

    if (action === "status") {
      const { data } = await admin
        .from("line_audience_groups")
        .select("tag, audience_group_id, member_psids, expire_at, last_synced_at, last_error")
        .order("tag");
      return json({
        ok: true,
        groups: (data ?? []).map((g: any) => ({
          tag: g.tag,
          audience_group_id: g.audience_group_id,
          members: Array.isArray(g.member_psids) ? g.member_psids.length : 0,
          expire_at: g.expire_at,
          last_synced_at: g.last_synced_at,
          last_error: g.last_error,
        })),
      });
    }

    if (action !== "sync") return json({ ok: false, error: `ไม่รู้จัก action "${action}"` }, 400);

    // ---- รวบรวม "แท็ก → รายชื่อ LINE userId ที่ควรอยู่ในกลุ่ม" จากฐานข้อมูล ----
    // เอาเฉพาะห้อง LINE ที่ยังไม่ถูกบล็อก และมี userId จริง
    const { data: rooms, error: roomErr } = await admin
      .from("chat_customers")
      .select("psid, tags")
      .eq("source", "line")
      .is("blocked_at", null)
      .not("psid", "is", null)
      .neq("psid", "");
    if (roomErr) throw roomErr;

    const wantByTag = new Map<string, Set<string>>();
    for (const r of rooms ?? []) {
      const psid = String(r.psid || "").trim();
      if (!psid.startsWith("U")) continue;   // LINE userId ขึ้นต้นด้วย U เสมอ
      for (const raw of Array.isArray(r.tags) ? r.tags : []) {
        const tag = String(raw || "").trim().slice(0, DESC_MAX);
        if (!tag) continue;
        if (!wantByTag.has(tag)) wantByTag.set(tag, new Set());
        wantByTag.get(tag)!.add(psid);
      }
    }

    const { data: recordRows } = await admin
      .from("line_audience_groups")
      .select("tag, audience_group_id, member_psids, expire_at");
    const recordByTag = new Map((recordRows ?? []).map((r: any) => [String(r.tag), r]));

    // แท็กที่ต้องทำรอบนี้: ที่ระบุมา หรือ (ทุกแท็กที่มีอยู่ + ทุกกลุ่มที่จดไว้ เพื่อเก็บกลุ่มที่ไม่มีคนแล้ว)
    const requested: string[] | null = Array.isArray(body?.tags) && body.tags.length
      ? body.tags.map((t: any) => String(t).trim().slice(0, DESC_MAX)).filter(Boolean)
      : null;
    const tags = requested ?? [...new Set([...wantByTag.keys(), ...recordByTag.keys()])];

    const nowIso = new Date().toISOString();
    const results: SyncResult[] = [];

    const createGroup = async (tag: string, members: string[]) => {
      const [first, ...rest] = chunk(members, UPLOAD_CHUNK);
      const created = await lineApi("/v2/bot/audienceGroup/upload", accessToken, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: tag,
          isIfaAudience: false,
          audiences: first.map((id) => ({ id })),
        }),
      });
      const groupId = Number(created?.audienceGroupId);
      if (!groupId) throw new Error("LINE ไม่คืน audienceGroupId กลับมา");
      // คนที่เหลือทยอยเติมเข้ากลุ่มเดิม
      for (const part of rest) {
        await lineApi("/v2/bot/audienceGroup/upload", accessToken, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audienceGroupId: groupId, audiences: part.map((id) => ({ id })) }),
        });
      }
      return { groupId, expireTimestamp: Number(created?.expireTimestamp) || null };
    };

    const deleteGroup = async (groupId: number) => {
      try {
        await lineApi(`/v2/bot/audienceGroup/${groupId}`, accessToken, { method: "DELETE" });
      } catch (e) {
        // กลุ่มหายไปแล้ว (หมดอายุ/ถูกลบใน LINE) ถือว่าสำเร็จ ไม่ต้องค้างไว้ในตารางเรา
        if (!/404|not found/i.test(String(e instanceof Error ? e.message : e))) throw e;
      }
    };

    for (const tag of tags) {
      const want = [...(wantByTag.get(tag) ?? new Set<string>())].sort();
      const record: any = recordByTag.get(tag);
      const have: string[] = Array.isArray(record?.member_psids) ? [...record.member_psids].sort() : [];

      try {
        // ไม่มีใครถือแท็กนี้แล้ว → เก็บกลุ่มทิ้ง ไม่ปล่อยกลุ่มเปล่าค้างใน LINE
        if (want.length === 0) {
          if (record) {
            await deleteGroup(Number(record.audience_group_id));
            await admin.from("line_audience_groups").delete().eq("tag", tag);
            results.push({ tag, action: "deleted", members: 0 });
          } else {
            results.push({ tag, action: "unchanged", members: 0 });
          }
          continue;
        }

        const expiringSoon = record?.expire_at
          ? new Date(record.expire_at).getTime() - Date.now() < RENEW_BEFORE_DAYS * 86_400_000
          : false;
        const removed = have.filter((p) => !want.includes(p));
        const added = want.filter((p) => !have.includes(p));

        // ยังไม่มีกลุ่ม / มีคนถูกถอดแท็ก / ใกล้หมดอายุ → สร้างกลุ่มใหม่ทั้งชุด
        // (LINE ลบสมาชิกทีละคนไม่ได้ จึงเป็นทางเดียวที่ทำให้กลุ่มตรงกับความจริง)
        if (!record || removed.length > 0 || expiringSoon) {
          if (record) await deleteGroup(Number(record.audience_group_id));
          const { groupId, expireTimestamp } = await createGroup(tag, want);
          await admin.from("line_audience_groups").upsert({
            tag,
            audience_group_id: groupId,
            member_psids: want,
            expire_at: expireTimestamp ? new Date(expireTimestamp * 1000).toISOString() : null,
            last_synced_at: nowIso,
            last_error: null,
            updated_at: nowIso,
          });
          results.push({
            tag,
            action: record ? "rebuilt" : "created",
            audience_group_id: groupId,
            members: want.length,
            added: added.length,
            removed: removed.length,
          });
          continue;
        }

        // มีแต่คนเพิ่ม → เติมเข้ากลุ่มเดิม id ไม่เปลี่ยน บรอดแคสต์ที่ตั้งไว้ใน LINE ไม่พัง
        if (added.length > 0) {
          for (const part of chunk(added, UPLOAD_CHUNK)) {
            await lineApi("/v2/bot/audienceGroup/upload", accessToken, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                audienceGroupId: Number(record.audience_group_id),
                audiences: part.map((id) => ({ id })),
              }),
            });
          }
          await admin.from("line_audience_groups").update({
            member_psids: want, last_synced_at: nowIso, last_error: null, updated_at: nowIso,
          }).eq("tag", tag);
          results.push({
            tag, action: "added", audience_group_id: Number(record.audience_group_id),
            members: want.length, added: added.length, removed: 0,
          });
          continue;
        }

        results.push({ tag, action: "unchanged", audience_group_id: Number(record.audience_group_id), members: want.length });
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e).slice(0, 300);
        if (record) {
          await admin.from("line_audience_groups")
            .update({ last_error: message, last_synced_at: nowIso, updated_at: nowIso })
            .eq("tag", tag);
        }
        results.push({ tag, action: "failed", members: want.length, error: message });
      }
    }

    const failed = results.filter((r) => r.action === "failed");
    return json({
      ok: true,
      synced: results.length,
      changed: results.filter((r) => r.action !== "unchanged").length,
      failed: failed.length,
      results,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
