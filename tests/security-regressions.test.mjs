import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("permission lookup fails closed", async () => {
  const source = await read("supabase/functions/_shared/permissions.ts");
  assert.match(source, /if \(error \|\| !data/);
  assert.doesNotMatch(source, /data\?\.role === "analyze_only" \? "analyze_only" : "admin"/);
});

test("destructive chat clear requires admin and explicit confirmation", async () => {
  const source = await read("supabase/functions/clear-chat-customers/index.ts");
  assert.match(source, /authorizeRequest\(req, \{ admin: true/);
  assert.match(source, /DELETE_CHAT_CUSTOMERS/);
});

test("Meta webhook fails closed without signature secret", async () => {
  const source = await read("supabase/functions/meta-webhook/index.ts");
  assert.match(source, /if \(!secret\)/);
  assert.match(source, /return new Response\("webhook not configured", \{ status: 503 \}\)/);
  assert.match(source, /if \(!ok\) return new Response\("bad signature"/);
});

test("LINE OA webhook verifies signatures, stores a separate source, and replies through LINE push API", async () => {
  const webhook = await read("supabase/functions/line-webhook/index.ts");
  const reply = await read("supabase/functions/messenger-reply/index.ts");
  const frontend = await read("ai-ads-app.jsx");
  assert.match(webhook, /verifySignature/);
  assert.match(webhook, /x-line-signature/);
  assert.match(webhook, /source: "line"/);
  assert.match(webhook, /stickershop\.line-scdn\.net/);
  assert.match(webhook, /mark_as_read_token/);
  assert.match(webhook, /payload\.events\.length === 0\) return new Response\("ok", \{ status: 200 \}\)/);
  assert.match(webhook, /webhook processing failed/);
  assert.match(reply, /\/v2\/bot\/message\/push/);
  assert.match(reply, /_delivery_mode: "line_push"/);
  assert.match(reply, /\/v2\/bot\/chat\/markAsRead/);
  assert.match(frontend, /INBOX_LINE_OA_ENABLED = false/);
  assert.match(frontend, /query = query\.eq\("source", "line"\)/);
  assert.match(frontend, /คำตอบจาก LINE OA Manager ไม่ถูกส่งออกทาง API/);
});

test("inbox channel tabs expose shared realtime unread dots without read-state tabs", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /messengerUnreadCount/);
  assert.match(frontend, /lineUnreadCount/);
  assert.match(frontend, /commentUnreadCount/);
  assert.match(frontend, /INBOX_LINE_OA_ENABLED \? \[\["line", "LINE OA"\]\] : \[\]/);
  assert.doesNotMatch(frontend, /\["unread", "ยังไม่อ่าน"\]/);
  assert.doesNotMatch(frontend, /\["read", "อ่านแล้ว"\]/);
  assert.match(frontend, /postgres_changes/);
  assert.match(frontend, /rowMatchesCurrentList/);
  assert.match(frontend, /scheduleUnreadRefresh/);
  assert.match(frontend, /if \(listTab === "line"\)/);
  assert.match(frontend, /allowedPages !== null/);
});

test("legacy Messenger rows with null source remain visible in the inbox", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /or\("source\.is\.null,and\(source\.neq\.comment,source\.neq\.line\)"\)/);
  assert.doesNotMatch(frontend, /\.or\("source\.is\.null,source\.neq\.comment"\)\.neq\("source", "line"\)/);
});

test("post comments are real-time only and scoped to selected pages", async () => {
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  const helper = await read("supabase/functions/_shared/comment-realtime.ts");
  const backfill = await read("supabase/functions/fetch-ad-comments/index.ts");
  assert.match(webhook, /selectedPageIds\.includes\(pageId\)/);
  assert.match(webhook, /comment_is_ad: ads\.length > 0/);
  assert.doesNotMatch(webhook, /if \(!ads\.length\) continue/);
  assert.match(helper, /inbox_page_filter:%/);
  assert.match(helper, /effective_object_story_id/);
  assert.match(backfill, /Historical comment backfill is intentionally disabled/);
  assert.doesNotMatch(backfill, /\/comments\?fields=/);
});

test("page comments stay in the comments tab and the UI only offers public replies", async () => {
  const backend = await read("supabase/functions/messenger-reply/index.ts");
  const frontend = await read("ai-ads-app.jsx");
  assert.match(backend, /commentReplyMode === "public"/);
  assert.match(backend, /\/comments\?access_token=/);
  assert.match(backend, /recipient: \{ comment_id: commentId \}/);
  assert.match(backend, /\/messages\?access_token=/);
  assert.doesNotMatch(backend, /\/private_replies\?access_token=/);
  assert.match(backend, /comment_promoted_to_inbox = true/);
  assert.match(backend, /merged_into_existing/);
  assert.match(backend, /\.eq\("page_id", row\.page_id\)\.eq\("psid", gotPsid\)/);
  assert.match(frontend, /ตอบใต้คอมเมนต์/);
  assert.doesNotMatch(frontend, />ส่ง DM ส่วนตัว</);
  assert.match(frontend, /คอมเมนต์จาก Ads/);
  assert.match(frontend, /คอมเมนต์จากโพสต์ปกติ/);
  assert.match(frontend, /\["all", "Messenger"\]/);
  assert.match(frontend, /\["comments", "ความคิดเห็น"\]/);
  assert.match(frontend, /query = query\.not\("id", "like", "fbc_%"\)\.or\("source\.is\.null,and\(source\.neq\.comment,source\.neq\.line\)"\)/);
  assert.doesNotMatch(frontend, /query = query\.or\("source\.is\.null,source\.neq\.comment,comment_promoted_to_inbox\.eq\.true"\)/);
});

test("Messenger webhooks can never reuse or mutate a Facebook comment row", async () => {
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  const reply = await read("supabase/functions/messenger-reply/index.ts");
  const frontend = await read("ai-ads-app.jsx");
  const protectedMessengerQueries = webhook.match(/\.not\("id", "like", "fbc_%"\)\.or\("source\.is\.null,source\.neq\.comment"\)/g) || [];
  assert.ok(protectedMessengerQueries.length >= 5, "all Messenger lookup/update paths must exclude comment IDs");
  assert.match(webhook, /\.like\("id", "fbc_%"\)\.neq\("source", "comment"\)/);
  assert.match(webhook, /source: "comment", comment_promoted_to_inbox: false/);
  assert.match(reply, /id\.startsWith\("fbc_"\) \|\| isInstagramComment \|\| row\.source === "comment"/);
  assert.match(frontend, /row\?\.source === "comment" \|\| String\(row\?\.id \|\| ""\)\.startsWith\("fbc_"\) \|\| isInstagramComment\(row\)/);
  assert.match(frontend, /query = query\.or\("source\.eq\.comment,id\.like\.fbc_%"\)/);
});

test("replies clear unread state across devices and sync push badges", async () => {
  const reply = await read("supabase/functions/messenger-reply/index.ts");
  const push = await read("supabase/functions/send-push/index.ts");
  const sw = await read("public/sw.js");
  assert.match(reply, /unread: false, read_at: nowIso/);
  assert.match(reply, /clearRelatedUnread/);
  assert.match(reply, /\.eq\("page_id", row\.page_id\)\.eq\("psid", row\.psid\)/);
  assert.match(reply, /syncPushState\(conversationId\)/);
  assert.match(reply, /EdgeRuntime/);
  assert.match(reply, /waitUntil\(task\)/);
  assert.match(push, /action === "sync_state"/);
  assert.match(sw, /data\.action === "sync_state"/);
});

test("Facebook Page read fallback matches conversations by page and PSID with a shared per-page cooldown", async () => {
  const sync = await read("supabase/functions/sync-conversations/index.ts");
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  assert.match(sync, /participants\.limit\(10\)\{id\}/);
  assert.match(sync, /last_by_page/);
  assert.match(sync, /\.eq\("page_id", page\.id\)\.in\("psid", readPsids\)/);
  assert.match(sync, /if \(changedConversationId\) await syncPushState/);
  assert.match(webhook, /clearRelatedUnread\(admin, pageId, custPsid/);
});

test("chat messages require editable preview approval before sending", async () => {
  const reply = await read("supabase/functions/messenger-reply/index.ts");
  const frontend = await read("ai-ads-app.jsx");
  assert.match(reply, /action === "preview" \|\| action === "send"/);
  assert.match(reply, /approved_text/);
  assert.match(frontend, /ตรวจข้อความก่อนส่ง/);
  assert.match(frontend, /อนุมัติและส่ง/);
});

test("logout unsubscribes web push on the current device", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /action: "unsubscribe"/);
  assert.match(frontend, /subscription\.unsubscribe\(\)/);
  assert.match(frontend, /navigator\.clearAppBadge\(\)/);
  assert.match(frontend, /if \(!data\.session\) clearLoggedOutPush\(\)/);
  assert.match(frontend, /event === "SIGNED_OUT"/);
});

test("Facebook label push allows inbox users for their permitted page", async () => {
  const labels = await read("supabase/functions/meta-push-labels/index.ts");
  assert.match(labels, /onlyId[\s\S]*\{ tab: "inbox", allowService: true \}/);
  assert.match(labels, /canAccessPage\(auth\.permission, data\.page_id\)/);
  assert.match(labels, /label\?user=/);
});

test("Messenger retries rejected 24-hour responses with HUMAN_AGENT", async () => {
  const backend = await read("supabase/functions/messenger-reply/index.ts");
  assert.match(backend, /if \(res\?\.error\) \{/);
  assert.match(backend, /tag: "HUMAN_AGENT"/);
  assert.match(backend, /_delivery_mode: "human_agent"/);
  assert.match(backend, /outsideResponseWindow/);
  assert.match(backend, /preferHumanAgent/);
  assert.match(backend, /AbortSignal\.timeout\(12_000\)/);
  assert.doesNotMatch(backend, /res\.error\.code\) === 10/);
});

test("Lao chat translation is detected from the latest message even on cache hits", async () => {
  const backend = await read("supabase/functions/messenger-reply/index.ts");
  assert.match(backend, /function isMostlyLao/);
  assert.match(backend, /\\u0E80-\\u0EFF/);
  assert.match(backend, /latestIsLao \? "Lao"/);
  assert.match(backend, /latestIsLao \? "ลาว"/);
  assert.match(backend, /รวมข้อความภาษาลาว/);
  assert.match(backend, /batch\.length >= 10/);
  assert.match(backend, /chars \+ size > 3500/);
  assert.match(backend, /for \(const part of batches\)/);
});

test("admin Thai originals survive Messenger sync and invalid translation cache is repaired", async () => {
  const reply = await read("supabase/functions/messenger-reply/index.ts");
  const sync = await read("supabase/functions/sync-conversations/index.ts");
  assert.match(reply, /translated && isMostlyThai\(translated\)/);
  assert.match(sync, /typeof old\.th === "string"/);
  assert.match(sync, /it\.th = old\.th/);
  assert.match(sync, /if \(old\.by\) it\.by = old\.by/);
});

test("knowledge base stores redacted review candidates and searches only the authorized page", async () => {
  const reply = await read("supabase/functions/messenger-reply/index.ts");
  const knowledge = await read("supabase/functions/knowledge-base/index.ts");
  const migration = await read("supabase/migrations/20260807200000_knowledge_base.sql");
  const frontend = await read("ai-ads-app.jsx");
  assert.match(reply, /function redactKnowledgeText/);
  assert.match(reply, /status: "pending"/);
  assert.match(reply, /recentQuestions\.length < 3/);
  assert.match(knowledge, /action === "search" && !pageId/);
  assert.match(knowledge, /\.eq\("status", "approved"\)\.eq\("page_id", pageId\)/);
  assert.match(knowledge, /authorizeRequest/);
  assert.match(knowledge, /\["list", "review", "delete"\]/);
  assert.match(knowledge, /source_key: `manual:\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(knowledge, /status: "approved"/);
  assert.match(knowledge, /\.eq\("answer", answer\)/);
  assert.match(knowledge, /sameAnswer\?\.id/);
  assert.match(knowledge, /merged: true/);
  assert.match(knowledge, /seen\.has\(key\)/);
  assert.match(knowledge, /allowedPageSizes = \[5, 10, 20, 50, 100\]/);
  assert.match(knowledge, /query\.order\("question", \{ ascending: true \}\)\.range/);
  assert.match(knowledge, /action === "delete"/);
  assert.match(knowledge, /function knowledgeKeywordScore/);
  assert.match(knowledge, /query\.includes\(keyword\)/);
  assert.match(knowledge, /String\(row\.question \|\| ""\)\.split/);
  assert.match(migration, /revoke all on public\.knowledge_qa from anon, authenticated/);
  assert.doesNotMatch(migration, /chat_messages/);
  assert.match(frontend, /ค้นหาคำตอบเก่าที่อนุมัติแล้ว/);
  assert.match(frontend, /เพิ่มและอนุมัติใช้งาน/);
  assert.match(frontend, /KnowledgeBasePanel allowedPages=\{allowedPages\}/);
  assert.match(frontend, /ตอบกลับข้อความนี้/);
  assert.match(frontend, /บันทึกเข้าคลังคำถาม/);
  assert.match(frontend, /openMessageMenu\(i, m, "admin"\)/);
  assert.match(frontend, /messageMenu\?\.side === "admin"/);
  assert.match(frontend, /page_id: selected\.page_id/);
  assert.match(frontend, /1\/2 กำหนดคำค้น/);
  assert.match(frontend, /2\/2 เลือกคำตอบของแอดมิน/);
  assert.match(frontend, /คำค้น \/ Keywords/);
  assert.match(frontend, /\.filter\(\(\{ message \}\).*\.reverse\(\)/s);
  assert.match(frontend, />ล่าสุด<\/span>/);
  assert.match(frontend, /รายการคำถาม–คำตอบที่ใช้งานอยู่/);
  assert.match(frontend, /ค้นหาคำถามหรือคำตอบ/);
  assert.match(frontend, /บันทึกการแก้ไข/);
  assert.match(frontend, /ลบทิ้ง/);
  assert.match(frontend, /เพิ่มคำถามเข้า Keywords เดิม/);
  assert.match(frontend, /expandedApproved/);
  assert.match(frontend, /\[5, 10, 20, 50, 100\]/);
  assert.match(frontend, /หน้าก่อนหน้า/);
  assert.match(frontend, /หน้าถัดไป/);
});

test("PWA export pages provide back and home navigation without printing it", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /function exportPageNavHtml/);
  assert.match(frontend, /← ย้อนกลับ/);
  assert.match(frontend, /กลับหน้าหลัก/);
  assert.match(frontend, /safe-area-inset-top/);
  assert.match(frontend, /@media print\{\.export-nav\{display:none!important\}\}/);
});

test("direct Facebook Page comment replies clear pending alerts", async () => {
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  const sync = await read("supabase/functions/sync-comment-replies/index.ts");
  const frontend = await read("ai-ads-app.jsx");
  assert.match(webhook, /fromId && fromId === pageId/);
  assert.match(webhook, /awaiting_reply: false, unread: false/);
  assert.match(sync, /\.eq\("source", "comment"\)\.eq\("awaiting_reply", true\)/);
  assert.match(sync, /via: "facebook_page"/);
  assert.match(frontend, /sync-comment-replies/);
});

test("Meta background sync is cached and shared instead of polling per device", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const comments = await read("supabase/functions/_shared/comment-realtime.ts");
  const subscribe = await read("supabase/functions/subscribe-webhook/index.ts");
  const replyFallback = await read("supabase/functions/sync-comment-replies/index.ts");
  const conversationSync = await read("supabase/functions/sync-conversations/index.ts");
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  const messenger = await read("supabase/functions/messenger-reply/index.ts");
  assert.match(frontend, /commentSubscriptionCheckedRef/);
  assert.match(frontend, /if \(!active \|\| commentSubscriptionCheckedRef\.current\) return/);
  assert.match(frontend, /15 \* 60 \* 1000/);
  assert.match(comments, /MAP_MAX_AGE_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(comments, /getOrRefreshCommentAdMap/);
  assert.match(subscribe, /comment_webhook_sync_status/);
  assert.match(subscribe, /age < 6 \* 60 \* 60 \* 1000/);
  assert.match(replyFallback, /SYNC_COOLDOWN_MS = 12 \* 60 \* 1000/);
  assert.match(replyFallback, /\.limit\(20\)/);
  assert.match(conversationSync, /DEFAULT_READ_STATUS_COOLDOWN_MS = 5 \* 60 \* 1000/);
  assert.match(conversationSync, /select\("alert_minutes, chat_alert"\)/);
  assert.match(conversationSync, /readStatusCooldownMs/);
  assert.match(conversationSync, /last_by_page/);
  assert.match(frontend, /const readEveryMs = Math\.max\(1, Math\.min\(15, Number\(alertMin\) \|\| 3\)\)/);
  assert.doesNotMatch(webhook, /forceRefresh: true/);
  assert.doesNotMatch(messenger, /forceRefresh: row\.source === "instagram"/);
});

test("empty page scopes do not broaden notification queries", async () => {
  const source = await read("ai-ads-app.jsx");
  assert.match(source, /pageScope && pageScope\.length === 0/);
  assert.match(source, /scope && scope\.length === 0/);
});

test("customer database waits for an explicit page report request", async () => {
  const source = await read("ai-ads-app.jsx");
  assert.match(source, /const \[pageFilter, setPageFilter\] = useState\(\(\) => initialView\?\.pageFilter \?\? ""\)/);
  assert.match(source, /const \[reportPageId, setReportPageId\] = useState\(\(\) => initialView\?\.reportPageId \?\? ""\)/);
  assert.match(source, /if \(!reportPageId \|\| reportPageId !== pageFilter\) return;/);
  assert.match(source, /function pullReport\(\)/);
  assert.match(source, /setReportPageId\(pageFilter\)/);
  assert.match(source, /reportRequestRef\.current \+= 1/);
  assert.match(source, /initialView\?\.dateFilter \?\? ""/);
  assert.match(source, /กรุณาเลือกช่วงเวลาก่อนดึงรายงาน/);
  assert.match(source, /disabled=\{!pageFilter \|\| !hasCompleteDateRange\(dateFilter, dateFrom, dateTo\) \|\| loading\}/);
  assert.match(source, /ยังไม่ได้ดึงรายงาน/);
});

test("customer database export always asks for a date range", async () => {
  const source = await read("ai-ads-app.jsx");
  const css = await read("index.css");
  const start = source.indexOf("function CustomerDatabaseTab");
  const end = source.indexOf("// ---------------------------------------------------------------\n// Dashboard shell", start);
  const panel = source.slice(start, end);
  assert.match(panel, /function openExportDialog\(\)/);
  assert.match(panel, /setExportDateFilter\(""\)/);
  assert.match(panel, /เลือกช่วงเวลาที่ต้องการ/);
  assert.match(panel, /applyFilters\(query, \{ pageId: pageFilter, dateFilter: exportDateFilter, dateFrom: exportDateFrom, dateTo: exportDateTo \}\)/);
  assert.match(panel, /disabled=\{exporting \|\| !hasCompleteDateRange\(exportDateFilter, exportDateFrom, exportDateTo\)/);
  assert.match(panel, /customer-export-modal-panel/);
  assert.match(panel, /customer-export-modal-download/);
  assert.doesNotMatch(panel, /max-w-lg rounded-2xl border border-slate-700 bg-slate-900/);
  assert.match(css, /\.customer-export-modal-panel \{/);
  assert.match(css, /\.customer-export-modal-download:disabled \{/);
});

test("customer database has no AI controls, filters, results, or invocation", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const start = frontend.indexOf("function CustomerDatabaseTab");
  const end = frontend.indexOf("// ---------------------------------------------------------------\n// Dashboard shell", start);
  assert.ok(start >= 0 && end > start);
  const customerDatabase = frontend.slice(start, end);
  const databasePanel = frontend.slice(start, frontend.indexOf("function CustomerImportModal", start));
  assert.doesNotMatch(customerDatabase, /chat-ai|runAiJob|loadAiStats|aiRunning|aiStats|aiFilter|ai_reason|classified_by/);
  assert.doesNotMatch(customerDatabase, />AI(?:\s|<)|สถานะ AI|รอ AI|AI อ่าน/);
  assert.doesNotMatch(databasePanel, /ติดป้ายสถานะบน Meta|pushToMeta|meta-push-labels/);
  assert.match(customerDatabase, /บทสนทนาที่ดึงมา/);
});

test("customer database customer names open the matching inbox conversation", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const start = frontend.indexOf("function CustomerDatabaseTab");
  const end = frontend.indexOf("function CustomerImportModal", start);
  const customerDatabase = frontend.slice(start, end);
  assert.match(customerDatabase, /function CustomerDatabaseTab\(\{ onOpenChat \}\)/);
  assert.match(customerDatabase, /onClick=\{\(\) => onOpenChat\?\.\(r\.id, r\.last_message_at\)\}/);
  assert.doesNotMatch(customerDatabase, /openCustomerDetail|detailLoadingId|<CustomerDetailModal/);
  assert.match(frontend, /<CustomerDatabaseTab[\s\S]*?setGotoChat\(\{ id, at \}\);[\s\S]*?setTab\("inbox"\)/);
});

test("chat sync never extracts customer database fields automatically", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  const sync = await read("supabase/functions/sync-conversations/index.ts");
  const chatAi = await read("supabase/functions/chat-ai/index.ts");

  const panelStart = frontend.indexOf("function ChatSyncConfigPanel");
  const panelEnd = frontend.indexOf("function PageLeadConfigPanel", panelStart);
  const panel = frontend.slice(panelStart, panelEnd);
  assert.match(panel, /ไม่มีการอ่านแชทเพื่อกรอกข้อมูลลูกค้าอัตโนมัติ/);
  assert.doesNotMatch(panel, /จับ "ไอดีเทรด" แบบเข้ม/);
  assert.doesNotMatch(panel, /รูปแบบแท็กจากแอดมิน/);
  assert.doesNotMatch(panel, /ให้ AI ช่วยจัดสถานะลูกค้า/);
  assert.doesNotMatch(panel, /คำ → "สร้างคอนเวอร์ชั่นแล้ว"/);

  assert.doesNotMatch(webhook, /extractLead|lead-extract|useRegex/);
  assert.match(webhook, /needs_ai: false/);
  assert.doesNotMatch(webhook, /cfg\.ai_enabled !== true/);
  assert.doesNotMatch(sync, /findPhone|findTradeId|findTvUsername|findEmail|parseAdminTags/);
  assert.match(sync, /phone: null, trade_id: null, username: null, email: null/);
  assert.match(sync, /needs_ai: false, needs_verify: false/);
  assert.doesNotMatch(sync, /function computeStage/);
  assert.doesNotMatch(sync, /keywords_qualified/);
  assert.match(chatAi, /AI customer database classification is disabled/);
  assert.doesNotMatch(chatAi, /classifySafe|verifySafe/);
});

test("customer database keeps the latest report in session and only refreshes on demand", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /const customerDatabaseReportCache = new Map\(\)/);
  assert.match(frontend, /let customerDatabaseViewCache = null/);
  assert.match(frontend, /if \(!force\) \{[\s\S]*?customerDatabaseReportCache\.get\(cacheKey\)/);
  assert.match(frontend, /supabase\.functions\.invoke\("customer-report"/);
  assert.match(frontend, /force,/);
  assert.match(frontend, /ข้อมูลชุดนี้ดึงล่าสุด:/);
  assert.match(frontend, /รีเฟรชข้อมูลล่าสุด/);
  assert.match(frontend, /previousPageFilterRef\.current === pageFilter/);
  assert.match(frontend, /customerDatabaseReportCache\.clear\(\); load\(true\)/);
  assert.match(frontend, /if \(reportPageId === pageFilter\) \{\s*if \(page === 1\) load\(false\)/);
  assert.match(frontend, /customerDatabaseReportCache\.clear\(\);\s*customerDatabaseViewCache = null;\s*\/\/ ถอน Web Push/);
  assert.doesNotMatch(frontend, /localStorage\.setItem\([^\n]*customerDatabase/);
});

test("customer Excel import groups duplicate Facebook names and updates every name match", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const importer = await read("supabase/functions/import-chat-customers/index.ts");
  assert.match(frontend, /ตรวจสอบก่อน Import Excel/);
  assert.match(frontend, /mode: "preview"/);
  assert.match(frontend, /ยืนยันอัปเดต/);
  assert.match(importer, /authorizeRequest\(req, \{ tab: "customerdb", pageId \}\)/);
  assert.match(importer, /function groupByFacebookName/);
  assert.match(importer, /group\.trade_ids\.join\(", "\)/);
  assert.match(importer, /match\.customer_ids\.map/);
  assert.doesNotMatch(importer, /status = "ambiguous"/);
  assert.doesNotMatch(importer, /status = "duplicate_file"/);
  assert.match(importer, /manual_data: true/);
  assert.match(importer, /classified_by: "manual", needs_ai: false, needs_verify: false/);
  assert.doesNotMatch(importer, /patch\[field\] = null/);
});

test("manual inbox data persists and ad-origin DMs stay classified as ads", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const saveLead = await read("supabase/functions/save-lead-fields/index.ts");
  const sync = await read("supabase/functions/sync-conversations/index.ts");
  assert.match(frontend, /CHAT_COLS = "[^"]*manual_data[^"]*trade_id/);
  assert.match(frontend, /row\?\.trade_id/);
  assert.match(frontend, /classified_by: "manual", needs_ai: false, needs_verify: false/);
  assert.match(frontend, /update\(\{ stage, stage_manual: stage, updated_at:/);
  assert.match(frontend, /r\.source === "ad" \|\| r\.entry_ad_id/);
  assert.match(frontend, /action: "mark_ad_source"/);
  assert.match(saveLead, /body\?\.action === "mark_ad_source"/);
  assert.match(saveLead, /source: "ad", entry_ad_id: entryAdId/);
  assert.match(saveLead, /classified_by: "manual", needs_ai: false, needs_verify: false/);
  assert.match(sync, /refRow \|\| prev\?\.entry_ad_id \? "ad"/);
});

test("customer database table fits the content area without horizontal scrolling", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /<div className="w-full overflow-hidden">\s*<table className="w-full table-fixed text-xs">/);
  assert.match(frontend, /<colgroup>/);
  assert.match(frontend, /w-full min-w-0 rounded px-1\.5/);
});

test("customer database CSV exports the requested visible columns in order", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /const EXPORT_DB_COLS = \["customer_name", "page_name", "trade_id", "phone", "email", "username", "psid", "source", "entry_ad_id", "first_customer_message_at"\]/);
  assert.match(frontend, /\["ชื่อเฟสบุค", \(row\) => row\.customer_name \|\| ""\]/);
  assert.match(frontend, /\["แหล่งที่มา", \(row\) => sourceText\(row\)\]/);
  assert.match(frontend, /\["วันที่", \(row\) => fmtTime\(row\.first_customer_message_at\)\]/);
  assert.doesNotMatch(frontend, /const EXPORT_COLS = \[[^\]]*last_user_text/);
});

test("customer database time uses only the first customer message on the latest Bangkok chat day", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const report = await read("supabase/functions/customer-report/index.ts");
  const migration = await read("supabase/migrations/20260813190000_first_customer_message_of_latest_day.sql");
  assert.match(frontend, /<SortHead k="first_customer_message_at"[^>]*>แชทแรกของวัน<\/SortHead>/);
  assert.match(frontend, /fmtTime\(r\.first_customer_message_at\)/);
  assert.match(report, /query\.gte\("first_customer_message_at"/);
  assert.match(report, /query\.order\("first_customer_message_at"/);
  assert.match(migration, /item->>'w' <> 'u'/);
  assert.match(migration, /at time zone 'Asia\/Bangkok'/);
  assert.match(migration, /message_day = latest_day/);
  assert.match(migration, /least\(old\.first_customer_message_at, candidate\)/);
});

test("reply statistics test accounts use verified customer names and save explicitly", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /reply-stats-customer-names/);
  assert.match(frontend, /customerNameOptions\.find/);
  assert.match(frontend, /เพิ่มและบันทึก/);
  assert.match(frontend, /persistExcludedNames/);
  assert.match(frontend, /รองรับชื่อที่มีเว้นวรรค/);
});

test("Instagram DMs are mapped to the linked Page and reply through the IG account", async () => {
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  const reply = await read("supabase/functions/messenger-reply/index.ts");
  const pages = await read("supabase/functions/_shared/meta-pages.ts");
  const subscribe = await read("supabase/functions/subscribe-webhook/index.ts");
  const fallback = await read("supabase/functions/sync-instagram-recent/index.ts");
  const frontend = await read("ai-ads-app.jsx");
  assert.match(webhook, /payload\.object !== "page" && payload\.object !== "instagram"/);
  assert.match(webhook, /instagram_business_account\?\.id/);
  assert.match(webhook, /source: "instagram"/);
  assert.match(reply, /sendInstagramMessage/);
  assert.match(reply, /sendInstagramMessage\(row\.page_id, pageTok, row\.psid/);
  assert.match(reply, /instagram_business_account\?\.id/);
  assert.match(pages, /instagram_business_account\{id,username,profile_picture_url\}/);
  assert.match(subscribe, /subscribeObject\("instagram", INSTAGRAM_FIELDS\)/);
  assert.match(subscribe, /value\?\.app_webhook\?\.instagram/);
  assert.match(fallback, /platform=instagram/);
  assert.match(fallback, /source: "instagram"/);
  assert.match(fallback, /getMetaBackgroundGuard/);
  assert.match(frontend, /sync-instagram-recent/);
  assert.match(frontend, /Instagram DM/);
});

test("Instagram post and ad comments stay in the comments tab and reply publicly", async () => {
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  const reply = await read("supabase/functions/messenger-reply/index.ts");
  const frontend = await read("ai-ads-app.jsx");
  assert.match(webhook, /entry\.field === "comments" \|\| entry\.field === "live_comments"/);
  assert.match(webhook, /selectedCommentPageIds\.includes\(pageId\)/);
  assert.match(webhook, /const rowId = `igc_\$\{commentId\}`/);
  assert.match(webhook, /comment_is_ad: isAd/);
  assert.match(reply, /\/replies\?access_token=/);
  assert.match(reply, /instagram_comment_public/);
  assert.match(frontend, /startsWith\("igc_"\)/);
  assert.match(frontend, /"◎ IG"/);
});

test("Instagram conversations never call Facebook PSID custom-label endpoints", async () => {
  const backend = await read("supabase/functions/meta-push-labels/index.ts");
  const frontend = await read("ai-ads-app.jsx");
  assert.match(backend, /data\.source === "instagram"/);
  assert.match(backend, /source\.is\.null,source\.neq\.instagram/);
  assert.match(backend, /unsupported: "instagram_labels"/);
  assert.match(frontend, /Meta ยังไม่เปิด API สำหรับป้าย IG/);
});

test("automatic replies use the language persisted on the chat header", async () => {
  const backend = await read("supabase/functions/messenger-reply/index.ts");
  const frontend = await read("ai-ads-app.jsx");
  assert.match(backend, /const detectedLang = row\.cust_lang/);
  assert.match(backend, /const targetLang = forceLang \|\| detectedLang/);
  assert.match(backend, /customer_last_message: targetLang \? "" : lastUserText/);
  assert.match(backend, /lang = targetLang \|\|/);
  assert.match(frontend, /อัตโนมัติ \(ตามภาษาหัวแชท\)/);
  assert.match(frontend, /อ้างอิงภาษาหัวแชท:/);
});

test("chat language selector prioritizes the admin-requested markets", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const values = [
    '["auto", "อัตโนมัติ (ตามภาษาหัวแชท)"]', '["English", "อังกฤษ"]', '["Thai", "ไทย"]',
    '["Tagalog", "ฟิลิปปินส์ (Tagalog)"]', '["Bahasa Malaysia", "มาเลเซีย"]',
    '["Bahasa Indonesia", "อินโดนีเซีย"]', '["Vietnamese", "เวียดนาม"]', '["Korean", "เกาหลี"]',
    '["Lao", "ลาว"]', '["Chinese (Simplified)", "จีน"]', '["Japanese", "ญี่ปุ่น"]',
    '["Chinese (Traditional)", "ไต้หวัน (จีนตัวเต็ม)"]', '["Hindi", "อินเดีย (ฮินดี)"]',
  ];
  const positions = values.map((value) => frontend.indexOf(value));
  positions.forEach((position) => assert.ok(position >= 0));
  for (let i = 1; i < positions.length; i++) assert.ok(positions[i - 1] < positions[i]);
});

test("chat composer tools use distinct accessible visual treatments", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const css = await read("index.css");
  assert.match(frontend, /chat-compose-guide/);
  assert.match(frontend, /chat-tool-emoji/);
  assert.match(frontend, /chat-tool-attach/);
  assert.match(frontend, /chat-tool-saved/);
  assert.match(frontend, /chat-tool-knowledge/);
  assert.match(frontend, /chat-tool-row flex flex-wrap/);
  assert.doesNotMatch(frontend, /chat-tool-row[^"\n]*overflow-x-auto/);
  assert.match(css, /\.chat-tool-button\.is-active/);
  assert.match(css, /\.chat-tool-row \{ overflow: visible; \}/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(frontend, /React\.lazy\(\(\) => import\("emoji-picker-react"\)/);
  assert.match(frontend, /emojiStyle="facebook"/);
  assert.match(frontend, /searchPlaceHolder="ค้นหาอิโมจิ/);
  assert.doesNotMatch(frontend, /chat-tool-sticker/);
});

test("chat attachment sending clears its preview and supports replying to images", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /setReply\(""\); setReplyTo\(null\); setSendPreview\(null\);\s*setSendMsg\("ส่งไฟล์แล้ว/);
  assert.match(frontend, /Promise\.all\(fileTemps\.map/);
  assert.match(frontend, /aria-label="เปิดเมนูตอบกลับรูปภาพ"/);
  assert.match(frontend, /setReplyTo\(\{ text: messageMenu\.text, img: messageMenu\.img, mid: messageMenu\.mid/);
  assert.doesNotMatch(frontend, /String\(replyTo\.text\)\.slice\(0, 70\)/);
});

test("quoted chat replies keep the full reference separate from the answer sent to Meta", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const backend = await read("supabase/functions/messenger-reply/index.ts");
  assert.doesNotMatch(backend, /function composeReplyText/);
  assert.match(backend, /function composeCustomerReplyText/);
  assert.match(backend, /Math\.min\(320, 2000 - answer\.length/);
  assert.match(backend, /const outText = composeCustomerReplyText\(replyText, replyToText, replyToImg\)/);
  assert.match(backend, /w: "p", t: replyText/);
  assert.match(backend, /reply_to_text: replyToText\.slice\(0, 10_000\)/);
  assert.match(backend, /function stripLegacyMediaReplyPrefix/);
  assert.match(backend, /replyText = stripLegacyMediaReplyPrefix\(approvedText\)/);
  assert.match(frontend, /reply_to_text: approved\.replyTo\?\.text/);
  assert.match(frontend, /reply_to_img: approved\.replyTo\?\.img/);
  assert.match(frontend, /function goToReplyTarget/);
  assert.match(frontend, /data-msg-mid=\{m\.mid/);
  assert.match(frontend, /m\.reply_to_img && <img/);
  assert.match(frontend, /max-h-48 min-w-0 flex-1 overflow-y-auto/);
});

test("incoming Meta chat transcripts keep long customer messages", async () => {
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  const sync = await read("supabase/functions/sync-conversations/index.ts");
  const instagramSync = await read("supabase/functions/sync-instagram-recent/index.ts");
  for (const source of [webhook, sync, instagramSync]) {
    assert.match(source, /MAX_TRANSCRIPT_TEXT = 10_000/);
    assert.match(source, /transcriptText/);
  }
  assert.doesNotMatch(webhook, /t: String\(msg\.text\)\.slice\(0, 500\)/);
  assert.doesNotMatch(sync, /t: String\(m\.message \|\| ""\)\.slice\(0, 500\)/);
  assert.doesNotMatch(instagramSync, /t: String\(m\.message \|\| ""\)\.slice\(0, 500\)/);
});

test("customer detail modal does not close after selecting text in an input", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const modalStart = frontend.indexOf("function CustomerDetailModal");
  const modalEnd = frontend.indexOf("// ---------------------------------------------------------------\n// Dashboard shell", modalStart);
  assert.ok(modalStart >= 0 && modalEnd > modalStart);
  const modal = frontend.slice(modalStart, modalEnd);
  assert.match(modal, /onMouseDown=\{\(e\) => \{[\s\S]*?e\.target === e\.currentTarget[\s\S]*?onClose\(\)/);
  assert.doesNotMatch(modal, /bg-black\/40 sm:p-4" onClick=\{onClose\}/);
});

test("campaign budget Excel export is a real formula-driven XLSX report", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.dependencies.exceljs, "^4.4.0");
  assert.match(frontend, /await import\("exceljs"\)/);
  assert.match(frontend, /addWorksheet\("รายงานงบ Ads"/);
  assert.match(frontend, /addWorksheet\("ข้อมูลดิบ"/);
  assert.match(frontend, /F\$\{rowNo\}-G\$\{rowNo\}/);
  assert.match(frontend, /formula: "=A5\+D5"/);
  assert.match(frontend, /imageDataForWorkbook/);
  assert.match(frontend, /functions\.invoke\("export-ad-image"/);
  assert.match(frontend, /wb\.addImage/);
  assert.match(frontend, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(frontend, /trackerFileName\(campaignName, "xlsx"\)/);
});

test("Meta token reads and attachment reply statistics avoid repeated send-path waits", async () => {
  const meta = await read("supabase/functions/_shared/meta.ts");
  const backend = await read("supabase/functions/messenger-reply/index.ts");
  assert.match(meta, /TOKEN_CACHE_MS = 5 \* 60 \* 1000/);
  assert.match(meta, /if \(cachedToken && now - cachedTokenAt < TOKEN_CACHE_MS\)/);
  assert.match(backend, /statRuntime\?\.waitUntil\) statRuntime\.waitUntil\(statTask\)/);
});

test("Instagram account-open confirmations feed analytics", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const webhook = await read("supabase/functions/meta-webhook/index.ts");
  const insights = await read("supabase/functions/ad-insights/index.ts");
  assert.match(frontend, /function confirmInstagramAccountOpened/);
  assert.match(frontend, /account_opened_at: openedAt/);
  assert.match(frontend, /ยืนยันเปิดบัญชีใหม่ \(IG\)/);
  assert.match(webhook, /const referralAdId = referral\?\.ad_id/);
  assert.match(webhook, /entry_ad_id: referralAdId/);
  assert.match(insights, /\.select\("account_opened_at"\)/);
});

test("inbox coalesces duplicate list loads and surfaces Supabase failures", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /const listLoadRef = useRef\(null\)/);
  assert.match(frontend, /if \(listLoadRef\.current\.key === key\) return listLoadRef\.current\.promise/);
  assert.match(frontend, /const \{ data, error \} = await query/);
  assert.match(frontend, /if \(error\) throw error/);
  assert.match(frontend, /โหลดแชทไม่สำเร็จ/);
  assert.match(frontend, /ลองโหลดใหม่/);
  assert.match(frontend, /loadRef\.current\(\{ refreshAfterCurrent: true \}\)/);
  assert.match(frontend, /\{ \.\.\.item, \.\.\.nextRow \}/);
  assert.match(frontend, /ใช้ payload อัปเดตลิสต์โดยตรง/);
  assert.match(frontend, /sort\(\(a, b\) => new Date\(b\.last_message_at/);
  assert.match(frontend, /query\.abortSignal\(controller\.signal\)/);
  assert.match(frontend, /ฐานข้อมูลตอบสนองเกิน 15 วินาที/);
});

test("chat RLS caches permission reads without widening authorization", async () => {
  const migration = await read("supabase/migrations/20260813204500_cache_chat_rls_permissions.sql");
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /for select to authenticated/);
  assert.match(migration, /for update to authenticated/);
  assert.match(migration, /\(select public\.app_is_admin\(\)\)/);
  assert.match(migration, /\(select public\.app_has_any_tab/);
  assert.match(migration, /\(select public\.app_allowed_pages\(\)\) \? page_id/);
  assert.doesNotMatch(migration, /for all/i);
});

test("opening inbox does not wait for ad and metrics dashboard queries", async () => {
  const frontend = await read("ai-ads-app.jsx");
  assert.match(frontend, /const needsAds = \["overview", "campaigns", "analyze"\]\.includes\(tab\)/);
  assert.match(frontend, /const needsHistory = tab === "analyze"/);
  assert.match(frontend, /if \(!needsAds && !needsCopies && !needsImages && !needsSettings && !needsTodayMetrics && !needsHistory\)/);
  assert.match(frontend, /if \(!\["overview", "review", "campaigns", "analyze"\]\.includes\(tab\)\) return/);
});

test("all Edge Functions have explicit authorization or signed webhook verification", async () => {
  const { readdir } = await import("node:fs/promises");
  const functionsDir = new URL("supabase/functions/", root);
  const entries = await readdir(functionsDir, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory() && item.name !== "_shared")) {
    const source = await read(`supabase/functions/${entry.name}/index.ts`);
    assert.match(
      source,
      /authorizeRequest|getPermission|isService|verifySig/,
      `${entry.name} lacks an explicit authorization check`,
    );
  }
});
