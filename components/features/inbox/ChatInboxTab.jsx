"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  Loader2,
  ArrowUpCircle,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  MessageSquare,
  Search,
  Menu,
  X,
  Paperclip,
  Eye,
  Send,
  Instagram,
} from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/client";
import { lsGet, lsSet } from "@/lib/utils/storage";
import { logActivity, getDeviceId } from "@/lib/utils/activity";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import Spinner from "@/components/shared/Spinner";
import { TradeIdChecker, CustomerDataForm } from "@/components/features/customerdb/CustomerDatabaseTab";
import { SearchInput, FilterPill } from "@/components/ui";
import { CHAT_STAGES } from "@/lib/constants/settings";

// ตัวเลือกอิโมจิชุดเต็มมีข้อมูลจำนวนมาก — โหลดเฉพาะตอนเปิดใช้ ไม่ถ่วงหน้าแชท/PWA ตอนเริ่มต้น
const EmojiPicker = React.lazy(() => import("emoji-picker-react").then((module) => ({ default: module.default })));

const INBOX_LINE_OA_ENABLED = true; // เปิดใช้งาน LINE OA ในหน้าตอบแชท
// Instagram DM: ฝั่งหลังบ้านรองรับครบอยู่แล้ว (meta-webhook รับ, messenger-reply ส่ง, sync-instagram-recent ดึงย้อนหลัง)
// แต่เดิมไม่มีแท็บของตัวเอง แชท IG จึงตกไปรวมอยู่ในแท็บ Messenger แยกไม่ออก
const INBOX_INSTAGRAM_ENABLED = true;
const INBOX_COMMENTS_ENABLED = false; // พักระบบ "ความคิดเห็น" (ซ่อนแท็บ + หยุดดึงความคิดเห็น) โดยไม่ลบข้อมูลเดิม
const MSG_REPLY_ENABLED = true;
const MSG_EMOJI_ENABLED = false;      // ซ่อนปุ่มอีโมจิในช่องตอบแชท ชั่วคราว (ไม่ลบโค้ด)

export default function ChatInboxTab({ allowedPages = null, alertAllowed = true, alertMin = 3, alertPages = [], alertSound = true, alertNew = true, gotoChat = null, onGotoDone, active = true }) {
  const isInstagramComment = (row) => String(row?.id || "").startsWith("igc_");
  const isCommentChat = (row) => row?.source === "comment" || String(row?.id || "").startsWith("fbc_") || isInstagramComment(row);
  const normalizeChatSource = (row) => isCommentChat(row) && row?.source !== "comment" ? { ...row, source: "comment" } : row;
  const [list, setList] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);   // สลับดูแชทที่บล็อกไว้ (สแปม)
  const [blocking, setBlocking] = useState(false);
  const [selected, setSelected] = useState(null);      // full row (มี transcript)
  const [translations, setTranslations] = useState({});
  const [translating, setTranslating] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendPreview, setSendPreview] = useState(null); // { text, lang, sourceText, replyTo }
  const [sendMsg, setSendMsg] = useState("");
  const [q, setQ] = useState("");
  const [adSources, setAdSources] = useState([]);   // แอดที่ลูกค้าทักมา (หลายตัวได้)
  const [adLoading, setAdLoading] = useState(false);
  const [savedReplies, setSavedReplies] = useState([]);   // ข้อความตอบกลับที่บันทึกไว้ในเพจ
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedErr, setSavedErr] = useState("");
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeResults, setKnowledgeResults] = useState([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeErr, setKnowledgeErr] = useState("");
  const [messageMenu, setMessageMenu] = useState(null); // { index, text, img, mid, at, quoteToken, side } เมนูเมื่อคลิกข้อความลูกค้าหรือแอดมิน
  const [lightbox, setLightbox] = useState(null);       // URL รูปที่กดดูแบบขยายเต็มจอ (คลิกรูปในแชท)
  const [knowledgeCapture, setKnowledgeCapture] = useState(null); // { step, question, answer, answerIndex }
  const [knowledgeCaptureSaving, setKnowledgeCaptureSaving] = useState(false);
  const [knowledgeCaptureMsg, setKnowledgeCaptureMsg] = useState("");
  const savedCacheRef = useRef({});
  const [listTab, setListTab] = useState("everything");    // everything | all(=Messenger) | line | comments
  const [unreadOnly, setUnreadOnly] = useState(false);   // กรองดูเฉพาะแชทที่ยังไม่อ่าน
  const [tagFilter, setTagFilter] = useState(null);      // กรองดูเฉพาะแชทที่ติดแท็กนี้ (null = ไม่กรอง)
  const [countryFilter, setCountryFilter] = useState(null); // กรองตามประเทศลูกค้า (null = ทุกประเทศ)
  const [adFilter, setAdFilter] = useState(null);           // กรองตามแอดที่ลูกค้าทักมาจาก (entry_ad_id)
  const [messengerUnreadCount, setMessengerUnreadCount] = useState(0);
  const [commentUnreadCount, setCommentUnreadCount] = useState(0);
  const [lineUnreadCount, setLineUnreadCount] = useState(0);
  const [instagramUnreadCount, setInstagramUnreadCount] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);   // ไฟล์ที่พักไว้รอกดส่ง [{file,name,type,preview}]
  const [replyTo, setReplyTo] = useState(null);           // { text, img, mid, at, side } ข้อความ/รูปที่กำลัง reply อ้างอิง
  const [forceLang, setForceLang] = useState("auto");     // ภาษาที่แอดมินเลือกเอง (auto = ให้ AI ตรวจ)
  const fileInputRef = useRef(null);
  const loadRef = useRef(() => {});
  const openRef = useRef(() => {});
  const bottomRef = useRef(null);
  const [highlightAt, setHighlightAt] = useState(null);   // เวลาของข้อความที่ต้องเลื่อนไปหา+ไฮไลต์
  const highlightAtRef = useRef(null);                    // ใช้กันไม่ให้ตัวเลื่อนลงล่างสุดมาแย่งจังหวะ
  const selRef = useRef(null);
  const [pageOptions, setPageOptions] = useState([]);      // เพจทั้งหมดที่เชื่อมได้
  const [pagePics, setPagePics] = useState({});            // รูปโปรไฟล์เพจ { page_id: url } — ดึงจาก cache กลาง (page-pictures) แทนโหลดตรงจาก graph ทีละรูป
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [pageSel, setPageSel] = useState({ mode: "multi", single: null, multi: [] });  // เลือกเพจเดียว/หลายเพจ
  const pageSelRef = useRef(pageSel);   // ให้ตัวเช็คแจ้งเตือน (ที่รันทุก 30 วิ) อ่านค่าล่าสุดได้โดยไม่ต้อง re-subscribe
  const commentSubscriptionCheckedRef = useRef(false); // กันทุกแท็บ/ทุกการ render สั่งสร้าง webhook + ไล่ดึง ads ซ้ำ
  const listSeqRef = useRef(0);   // เลขลำดับคำขอโหลดลิสต์ (กัน response เก่าทับใหม่)
  const listLoadRef = useRef(null); // รวมคำขอซ้ำที่ใช้ตัวกรองเดียวกัน ไม่ยิง Supabase ซ้อน
  const listRef = useRef(null);
  const latestListKeyRef = useRef("");
  const queuedListLoadRef = useRef(false);
  const listFilterRef = useRef(null); // Realtime ต้องอ่านตัวกรองล่าสุดโดยไม่ต้องสร้าง channel ใหม่
  const pageOptionsRef = useRef([]);
  const unreadRefreshTimerRef = useRef(null);
  const transcriptRefreshTimerRef = useRef(null);
  const focusRefreshAtRef = useRef(0);
  const syncGuardRef = useRef({ inFlight: new Map(), lastRun: new Map() });
  const openRequestRef = useRef({ seq: 0, controller: null });
  const adSourceCacheRef = useRef(new Map());
  const [labelMsg, setLabelMsg] = useState(null);   // ผลการส่งป้ายไป Meta {type: loading|ok|err, text}
  const [tagMsg, setTagMsg] = useState("");
  const [overdueAlert, setOverdueAlert] = useState(null);   // { count, pages: [ชื่อเพจ] } → โชว์ popup
  // แจ้งเตือนระดับระบบปฏิบัติการ (เด้งทับแอปอื่น) — บังคับเปิดเสมอ ผู้ใช้ปิดเองไม่ได้
  // เหลืออย่างเดียวที่ต้องให้ผู้ใช้กดคือ "อนุญาต" ตอนแรก เพราะเบราว์เซอร์บังคับว่าต้องมาจากการคลิกของผู้ใช้
  const [notifPerm, setNotifPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "unsupported"));
  // iOS เปิดใน Safari (ยังไม่ได้เพิ่มหน้าจอโฮม) — Web Push ใช้ไม่ได้จนกว่าจะเปิดเป็น PWA
  const iosSafariNotStandalone = /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true);
  const notifiedRef = useRef({ ids: "", at: 0 });   // กันเด้งรัวซ้ำเรื่องเดิม

  // เสียงเตือนสั้นๆ (สร้างด้วย WebAudio ไม่ต้องมีไฟล์เสียง) — ต้องเคยคลิกในหน้าเว็บมาก่อนเบราว์เซอร์ถึงยอมเล่น
  function playPing() {
    if (!alertSound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const beep = (startAt, freq) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
        gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + 0.28);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + startAt); osc.stop(ctx.currentTime + startAt + 0.3);
      };
      beep(0, 880); beep(0.32, 1170);   // ตี๊ด-ต๊าด
      setTimeout(() => ctx.close().catch(() => {}), 1500);
    } catch { /* เล่นเสียงไม่ได้ก็ข้าม */ }
  }

  // ขออนุญาตแจ้งเตือน — ต้องเรียกจากการคลิกของผู้ใช้เท่านั้น (เบราว์เซอร์บังคับ)
  async function askNotifPermission() {
    // iOS: Web Push ใช้ได้เฉพาะใน PWA (เพิ่มหน้าจอโฮม) — Safari ปกติไม่มี Notification API
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
    if (typeof Notification === "undefined") {
      if (isIOS && !isStandalone) {
        alert("บน iPhone/iPad ต้องเปิดแอปจากไอคอนหน้าจอโฮมก่อน แจ้งเตือนถึงจะใช้ได้\n\nวิธีเพิ่ม: กดปุ่มแชร์ ⬆️ ด้านล่าง → เลื่อนหา \"เพิ่มไปยังหน้าจอโฮม\" → เปิดแอปจากไอคอนนั้น");
      } else {
        alert("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน");
      }
      return;
    }
    if (Notification.permission === "denied") {
      alert("การแจ้งเตือนถูกบล็อกไว้\n\nเปิดใหม่ได้ที่: กดไอคอนแม่กุญแจ 🔒 ข้างช่อง URL → การแจ้งเตือน → อนุญาต\nแล้วรีเฟรชหน้านี้");
      return;
    }
    const p = await Notification.requestPermission();
    setNotifPerm(p);
    if (p === "granted") {
      playPing();
      new Notification("เปิดแจ้งเตือนแล้ว ✅", { body: "จะเด้งเตือนแม้สลับไปแอปอื่น", tag: "test" });
      subscribePush();   // สมัคร Web Push ด้วย — เตือนได้แม้ปิดแท็บ (PWA)
    }
  }

  // ทดสอบส่ง push หาตัวเอง — บอกชัดว่าติดชั้นไหน (VAPID / subscription / delivery)
  const [pushTesting, setPushTesting] = useState(false);
  const [pushTestMsg, setPushTestMsg] = useState("");
  async function testPush() {
    setPushTesting(true); setPushTestMsg("");
    try {
      await subscribePush(true);   // เผื่อยังไม่เคย subscribe บนเครื่องนี้ ให้สมัครก่อน (โยน error ให้เห็นสาเหตุ)
      const { data, error } = await supabase.functions.invoke("send-push", { body: { action: "test" } });
      if (error) { setPushTestMsg("✗ เรียกฟังก์ชันไม่ได้: " + (await readFunctionErrorMessage(error))); return; }
      if (!data?.ok) { setPushTestMsg("✗ " + (data?.error || (data?.errors?.[0]) || "ส่งไม่สำเร็จ")); return; }
      setPushTestMsg(`✓ ส่งแล้ว ${data.sent}/${data.total} เครื่อง — รอสักครู่ควรเห็นแจ้งเตือนเด้ง`);
    } catch (e) { setPushTestMsg("✗ " + (e?.message || e)); }
    finally { setPushTesting(false); setTimeout(() => setPushTestMsg(""), 15000); }
  }

  // ตรวจระบบแจ้งเตือน (admin) — ชี้ชั้นที่ติด
  const [pushDiag, setPushDiag] = useState(null);
  async function runPushDiag() {
    setPushDiag("loading");
    const { data, error } = await supabase.functions.invoke("send-push", { body: { action: "diag" } });
    if (error || !data?.ok) { setPushDiag(null); alert("ตรวจไม่สำเร็จ: " + (data?.error || (error ? await readFunctionErrorMessage(error) : ""))); return; }
    setPushDiag(data);
  }

  // ---- Web Push: สมัครรับแจ้งเตือนแม้ปิดแท็บแอป (ต้องมี service worker + VAPID) ----
  // throwErr = true → โยน error ออกไปให้ปุ่มทดสอบแสดงสาเหตุ (ปกติเรียกแบบเงียบตอนเปิดแอป)
  async function subscribePush(throwErr = false) {
    try {
      if (location.protocol !== "https:") throw new Error("ต้องเปิดผ่าน https (Web Push ใช้บน http/localhost ไม่ได้)");
      if (!("serviceWorker" in navigator)) throw new Error("เบราว์เซอร์นี้ไม่รองรับ Service Worker");
      if (!("PushManager" in window)) throw new Error("เบราว์เซอร์นี้ไม่รองรับ Push (iOS ต้องเพิ่มเป็นแอปหน้าจอโฮมก่อน)");
      const reg = await navigator.serviceWorker.ready;
      const { data: vk } = await supabase.functions.invoke("send-push", { body: { action: "vapid_public" } });
      if (!vk?.ok || !vk.key) throw new Error("backend ยังไม่มี VAPID public key (ตั้ง secret + deploy send-push แล้วหรือยัง)");
      // แปลง base64url → Uint8Array
      const b64 = vk.key.replace(/-/g, "+").replace(/_/g, "/").padEnd(vk.key.length + (4 - (vk.key.length % 4)) % 4, "=");
      const appKey = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      // ส่ง config ให้ SW เก็บไว้ต่ออายุ push เอง (pushsubscriptionchange) ตอนแอปปิด
      try { reg.active?.postMessage({ type: "push-config", url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, vapidKey: vk.key }); } catch { /* ไม่กระทบการ subscribe */ }
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      // ขอบเขต push = "เพจที่เลือกดู" (ตรงกับการแจ้งเตือนในแอป) — ไม่เลือกเจาะจงค่อย fallback เป็นเพจที่ตั้งให้เตือน, ไม่มีเลย = ทุกเพจที่มีสิทธิ์
      const viewing = pageSel.mode === "single" ? (pageSel.single ? [pageSel.single] : []) : (pageSel.multi || []);
      const pushScope = viewing.length ? viewing : (Array.isArray(alertPages) && alertPages.length ? alertPages : []);
      const { data: sr, error: se } = await supabase.functions.invoke("send-push", { body: { action: "subscribe", subscription: sub.toJSON(), pages: pushScope, notify_new: alertNew !== false, device_id: getDeviceId() } });
      if (se || !sr?.ok) throw new Error("บันทึก subscription ไม่สำเร็จ: " + (sr?.error || (se ? await readFunctionErrorMessage(se) : "")));
      return true;
    } catch (e) {
      console.warn("push subscribe failed", e);
      if (throwErr) throw e;
      return false;
    }
  }
  // สมัคร push อัตโนมัติถ้าเคยอนุญาตไว้แล้ว + re-subscribe เมื่อเปลี่ยนเพจที่เลือก
  // (สำคัญ: server ยิง push ตาม sub.pages ที่เก็บไว้ → ต้องอัปเดตทุกครั้งที่ user เปลี่ยนเพจในหน้าตอบแชท
  //  ไม่งั้น push จะมาจากเพจอื่นที่ไม่ได้เลือก)
  useEffect(() => { if (alertAllowed && notifPerm === "granted") subscribePush(); /* eslint-disable-next-line */ },
    [alertAllowed, notifPerm, alertNew, pageSel.mode, pageSel.single, pageSel.multi.join(",")]);

  // ---- แจ้งเตือน "ข้อความใหม่ทันที" เมื่อลูกค้าทักเข้ามา (ต่างจาก "ค้างอ่านเกิน X นาที") ----
  const instantSeenRef = useRef({});   // กันเตือนซ้ำข้อความเดิม (คีย์ = chat id → เวลาข้อความล่าสุด)
  const instantNotifyRef = useRef(null);
  instantNotifyRef.current = (row) => {
    if (!alertAllowed) return;
    if (isCommentChat(row)) return;                     // ความคิดเห็นมีแท็บ/จุดแดงของตัวเอง ไม่ปนแจ้งเตือน Messenger
    if (!row?.unread) return;                          // อ่านแล้ว/ไม่ใช่ข้อความใหม่ = ไม่เตือน
    if (selRef.current?.id === row.id && (document.visibilityState === "visible" && document.hasFocus())) return; // เปิดแชทนี้ดูอยู่แล้ว
    // เพจอยู่ในขอบเขตที่ควรเตือนไหม (สิทธิ์ + เพจที่เลือกดู)
    const ps = pageSelRef.current;
    const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
    if (allowedPages && !allowedPages.includes(row.page_id)) return;
    if (viewing.length && !viewing.includes(row.page_id)) return;
    if (!viewing.length && alertPages.length && !alertPages.includes(row.page_id)) return;
    // กันเตือนซ้ำ: ข้อความล่าสุดของแชทนี้เตือนไปแล้ว
    const key = String(row.id);
    const stamp = String(row.last_message_at || "");
    if (instantSeenRef.current[key] === stamp) return;
    instantSeenRef.current[key] = stamp;

    const away = document.visibilityState !== "visible" || !document.hasFocus();
    const name = row.customer_name || "ลูกค้า";
    const text = (row.last_user_text || "ส่งข้อความใหม่").slice(0, 80);
    if (away && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const n = new Notification(`💬 ${name}${row.page_name ? ` · ${row.page_name}` : ""}`, {
          body: text, tag: `newmsg-${row.id}`, renotify: true, icon: "/icon-192.png",
        });
        n.onclick = () => { window.focus(); openChat({ id: row.id, customer_name: row.customer_name, page_id: row.page_id }); n.close(); };
      } catch { /* บางเบราว์เซอร์บล็อก */ }
    }
    playPing();
  };

  // ยิงแจ้งเตือนระบบ (เด้งทับแอปอื่น) — เรียกจากตัวเช็คด้านล่าง
  function fireOsNotification(count, pageNames) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const n = new Notification(`🔴 มี ${count} แชทค้างอ่านเกิน ${alertMin} นาที`, {
        body: pageNames.length ? `เพจ: ${pageNames.join(", ")}\nคลิกเพื่อเปิดกล่องข้อความ` : "คลิกเพื่อเปิดกล่องข้อความ",
        tag: "overdue-chat",        // ใช้ tag เดิม = แทนที่อันเก่า ไม่กองซ้อนกันเต็มจอ
        renotify: true,
        requireInteraction: true,   // ค้างบนจอจนกว่าจะกด (ไม่หายเองใน 5 วิ) — ใกล้เคียง "กล่องทับแอปอื่น" ที่สุด
      });
      n.onclick = () => { window.focus(); setListTab("everything"); n.close(); };
    } catch { /* บางเบราว์เซอร์บล็อก constructor ตรงๆ */ }
  }
  // เช็คจาก DB ตรงทุก 30 วิ (ไม่ผูกกับฟิลเตอร์หน้าจอ): แชท "ยังไม่อ่าน" ค้างเกินเกณฑ์ ในเพจที่เลือกเตือน
  useEffect(() => {
    if (!alertAllowed) { setOverdueAlert(null); document.title = "Besight"; return; }
    let stop = false;
    async function check() {
      const cutoff = new Date(Date.now() - alertMin * 60 * 1000).toISOString();
      let q = supabase.from("chat_customers")
        .select("id, page_id, page_name")
        // Messenger รุ่นเก่าบางแถวมี source=NULL; รวมเงื่อนไขไว้ใน OR เดียว
        // เพราะการต่อ .neq("source", "line") จะแอบตัด NULL ทิ้งตามกฎ SQL
        .eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,and(source.neq.comment,source.neq.line)").lte("last_message_at", cutoff).limit(100);
      // ข้อ 5: เตือนเฉพาะเพจที่ "user เลือกดูอยู่ในหน้าตอบแชท" ตอนนี้
      //   - เลือกเพจเดียว/หลายเพจ = เตือนเฉพาะเพจนั้น
      //   - ดูทุกเพจ = เตือนตามที่แอดมินตั้งให้ (alertPages) ไม่งั้นทุกเพจที่เข้าถึงได้
      const ps = pageSelRef.current;
      const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
      let pageScope;
      if (viewing.length) pageScope = viewing.filter((p) => !allowedPages || allowedPages.includes(p));
      else pageScope = alertPages.length ? alertPages.filter((p) => !allowedPages || allowedPages.includes(p)) : allowedPages;
      if (pageScope && pageScope.length === 0) {
        if (!stop) { setOverdueAlert(null); document.title = "Besight"; }
        return;
      }
      if (pageScope) q = q.in("page_id", pageScope);
      const { data } = await q;
      if (stop) return;
      const rows = data || [];
      if (rows.length) {
        const pageNames = [...new Set(rows.map((r) => r.page_name || r.page_id))].slice(0, 4);
        // เก็บ page_id ไว้ด้วย — ใช้ตอนกด "ดูเลย" เพื่อสลับตัวกรองเพจไปยังเพจที่มีแชทค้าง
        // (เดิมกดแล้วไม่เห็นอะไร ถ้าแชทค้างอยู่คนละเพจกับที่กำลังเปิดดู)
        const pageIds = [...new Set(rows.map((r) => r.page_id).filter(Boolean))];
        // แชทค้างเหล่านี้อยู่นอกเพจที่กำลังกรองดูอยู่ไหม (ใช้ ref กันต้อง re-subscribe ทุกครั้งที่เปลี่ยนเพจ)
        const ps = pageSelRef.current;
        const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
        const outOfView = viewing.length > 0 && !pageIds.some((id) => viewing.includes(id));
        setOverdueAlert({ count: rows.length, pages: pageNames, pageIds, outOfView });
        document.title = `🔴 (${rows.length}) แชทค้างอ่านเกิน ${alertMin} นาที`;
        // ---- แจ้งเตือนระดับ OS: เด้งทับแอปอื่นเมื่อพนักงานไม่ได้อยู่ที่หน้านี้ ----
        // เงื่อนไขกันรำคาญ: เด้งเมื่อ (ก) มีแชทค้างรายใหม่ หรือ (ข) ยังค้างเหมือนเดิมแต่ผ่านไปแล้ว 5 นาที
        const idsKey = rows.map((r) => r.id).sort().join(",");
        const prev = notifiedRef.current;
        const isNew = idsKey !== prev.ids;
        const isStale = Date.now() - prev.at > 5 * 60 * 1000;
        const away = document.visibilityState !== "visible" || !document.hasFocus();
        if ((isNew || isStale) && away) {
          notifiedRef.current = { ids: idsKey, at: Date.now() };
          fireOsNotification(rows.length, pageNames);
          playPing();
        } else if (isNew) {
          // อยู่หน้านี้อยู่แล้ว เห็น popup ในแอป — เตือนแค่เสียง ไม่ต้องเด้งซ้อน
          notifiedRef.current = { ids: idsKey, at: Date.now() };
          playPing();
        }
      } else {
        setOverdueAlert(null);
        document.title = "Besight";
        notifiedRef.current = { ids: "", at: 0 };   // เคลียร์หมดแล้ว → รอบหน้าถือเป็นเรื่องใหม่
      }
    }
    check();
    const iv = setInterval(check, 30 * 1000);
    return () => { stop = true; clearInterval(iv); document.title = "Besight"; };
  }, [alertAllowed, alertMin, alertPages.join(","), allowedPages ? allowedPages.join(",") : "", pageSel.mode, pageSel.single, pageSel.multi.join(",")]);
  const [infoOpen, setInfoOpen] = useState(false);         // มือถือ: ขยายรายละเอียดแอด
  const [statusMenuOpen, setStatusMenuOpen] = useState(false); // มือถือ: เมนูแฮมเบอร์เกอร์ปรับสถานะ
  // โน้ต/แท็ก/สรุปบทสนทนา — เก็บ draft ของโน้ตแยกจาก selected เพราะพิมพ์แล้วค่อย save ตอน blur
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  useEffect(() => { setNotesDraft(selected?.notes || ""); setSummaryError(""); }, [selected?.id]);
  // รูปเพจ: ใช้ URL fbcdn ตรงเพจจาก cache กลางก่อน (เสถียร/ตรงเพจ) — ถ้ายังไม่มีค่อย fallback graph endpoint เดิม
  const pagePic = (id) => pagePics[id] || `https://graph.facebook.com/${id}/picture?type=square&width=96&height=96`;
  async function savePageSel(next) {
    setPageSel(next);
    // เก็บ "รายคน" (คีย์ผูกอีเมล) — ไม่ใช้คีย์กลางร่วมกัน กันพนักงานทับตัวเลือกของ admin และกลับกัน
    const { data: u } = await supabase.auth.getUser();
    const key = u?.user?.email ? `inbox_page_filter:${u.user.email}` : "inbox_page_filter";
    const { error } = await supabase.from("settings").upsert({ key, value: next, updated_at: new Date().toISOString() });
    if (error) { setSendMsg("บันทึกเพจที่เลือกไม่สำเร็จ: " + error.message); return; }
    // ซิงก์ scope ฝั่ง Meta + แผนที่ post→ad; webhook ยังตรวจ scope ซ้ำอีกชั้นก่อนบันทึก
    const { data: sync, error: syncErr } = await supabase.functions.invoke("subscribe-webhook", { body: { action: "sync_comments", force: true } });
    if (syncErr || !sync?.ok) setSendMsg("บันทึกเพจแล้ว แต่เปิดรับคอมเมนต์ไม่สำเร็จ: " + (sync?.error || syncErr?.message || ""));
    else setSendMsg(`เปิดรับคอมเมนต์ Ads แบบเรียลไทม์ ${sync.selected_comment_pages?.length || 0} เพจแล้ว ✓`);
  }
  const renderAd = (ad) => (
    <div key={ad.ad_id} className="rounded-lg border border-night-border overflow-hidden bg-night-surface2/50">
      {ad.media_url && (ad.media_type === "video"
        ? <video src={ad.media_url} poster={ad.thumb_url || undefined} controls className="w-full max-h-40 object-cover bg-black" />
        : <img src={ad.media_url} alt="" className="w-full max-h-40 object-cover" />)}
      <div className="p-2 space-y-0.5">
        {ad.error ? <div className="text-[11px] text-night-ink-3">โหลดรายละเอียดแอดไม่ได้ — แอดอาจถูกลบ หรือไม่มีสิทธิ์เข้าถึงบัญชีโฆษณานี้</div> : (<>
          <div className="text-[11px] text-night-ink-2">แคมเปญ: <span className="text-night-ink">{ad.campaign_name || "-"}</span></div>
          <div className="text-[11px] text-night-ink-2">ชุดโฆษณา: <span className="text-night-ink">{ad.adset_name || "-"}</span></div>
          <div className="text-[11px] text-night-ink-2">โฆษณา: <span className="text-night-ink">{ad.name || "-"}</span></div>
        </>)}
        <div className="text-[10px] text-night-ink-3 break-all">ad_id: {ad.ad_id}</div>
      </div>
    </div>
  );
  // ภาษาที่เลือกส่งได้เอง (กัน AI ตรวจภาษาลูกค้าผิด) — value = ชื่อภาษาอังกฤษที่ backend/AI เข้าใจ
  // ครอบคลุมภาษาหลักของโลกตามที่แพลตฟอร์มยอดนิยมรองรับ
  const LANG_OPTIONS = [
    ["auto", "อัตโนมัติ (ตามภาษาหัวแชท)"],
    // ภาษาหลักที่ทีมใช้บ่อย — เรียงตามลำดับงานจริงที่แอดมินกำหนด
    ["English", "อังกฤษ"], ["Thai", "ไทย"], ["Tagalog", "ฟิลิปปินส์ (Tagalog)"],
    ["Bahasa Malaysia", "มาเลเซีย"], ["Bahasa Indonesia", "อินโดนีเซีย"], ["Vietnamese", "เวียดนาม"],
    ["Korean", "เกาหลี"], ["Lao", "ลาว"], ["Chinese (Simplified)", "จีน"], ["Japanese", "ญี่ปุ่น"],
    ["Chinese (Traditional)", "ไต้หวัน (จีนตัวเต็ม)"], ["Hindi", "อินเดีย (ฮินดี)"],
    // ภาษาอื่นเรียงโดยประมาณตามจำนวนผู้ใช้และความถี่ในงานบริการลูกค้าทั่วโลก
    ["Spanish", "สเปน"], ["Arabic", "อาหรับ"], ["Portuguese", "โปรตุเกส"], ["French", "ฝรั่งเศส"],
    ["German", "เยอรมัน"], ["Russian", "รัสเซีย"], ["Bengali", "เบงกาลี"], ["Urdu", "อูรดู"],
    ["Turkish", "ตุรกี"], ["Italian", "อิตาลี"], ["Burmese", "พม่า"], ["Khmer", "เขมร (กัมพูชา)"],
    ["Tamil", "ทมิฬ"], ["Telugu", "เตลูกู"], ["Punjabi", "ปัญจาบ"], ["Persian (Farsi)", "เปอร์เซีย (ฟาร์ซี)"],
    ["Dutch", "ดัตช์"], ["Polish", "โปแลนด์"], ["Ukrainian", "ยูเครน"], ["Romanian", "โรมาเนีย"],
    ["Greek", "กรีก"], ["Czech", "เช็ก"], ["Swedish", "สวีเดน"], ["Danish", "เดนมาร์ก"],
    ["Norwegian", "นอร์เวย์"], ["Finnish", "ฟินแลนด์"], ["Hungarian", "ฮังการี"], ["Nepali", "เนปาล"],
    ["Sinhala", "สิงหล"], ["Hebrew", "ฮีบรู"], ["Swahili", "สวาฮีลี"],
  ];
  const initial = (n) => (String(n || "?").trim()[0] || "?").toUpperCase();
  const [myEmail, setMyEmail] = useState("");
  const fmtMsgTime = (t) => { try { return new Date(t).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

  function recordInboxLatency(stage, row, extra = {}) {
    if (!row?.id || typeof window === "undefined") return;
    const now = Date.now();
    const dbAt = Date.parse(row.updated_at || row.synced_at || "");
    const transcript = Array.isArray(row.transcript) ? row.transcript : [];
    const messageAt = Date.parse(transcript[transcript.length - 1]?.at || row.last_message_at || "");
    const sample = {
      stage,
      chat_id: row.id,
      page_id: row.page_id || null,
      measured_at: new Date(now).toISOString(),
      meta_to_db_ms: Number.isFinite(messageAt) && Number.isFinite(dbAt) ? Math.max(0, dbAt - messageAt) : null,
      db_to_ui_ms: Number.isFinite(dbAt) ? Math.max(0, now - dbAt) : null,
      ...extra,
    };
    const history = Array.isArray(window.__CHAT_LATENCY__) ? window.__CHAT_LATENCY__ : [];
    window.__CHAT_LATENCY__ = [...history.slice(-99), sample];
    if (process.env.NODE_ENV === "development") console.debug("[chat-latency]", sample);
  }

  function currentPageIds({ includeAll = false } = {}) {
    const ps = pageSelRef.current;
    const explicit = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
    const permitted = (ids) => ids.filter((id) => !allowedPages || allowedPages.includes(id));
    if (explicit.length || !includeAll) return permitted(explicit);
    if (allowedPages) return [...allowedPages];
    return permitted((pageOptionsRef.current || []).map((page) => page.id));
  }

  function rowMatchesCurrentList(row) {
    if (!row?.id) return false;
    const filters = listFilterRef.current;
    if (!filters) return false;
    const isBlocked = !!row.blocked_at;
    if (isBlocked !== filters.showBlocked) return false;
    if (allowedPages && !allowedPages.includes(String(row.page_id || ""))) return false;
    const selectedPages = currentPageIds();
    // แท็บ "ทั้งหมด" ต้องรวมทุกเพจที่ผู้ใช้มีสิทธิ์ ไม่ถูก page selector ของเพจแรกบังแชทช่องทางอื่น
    if (filters.listTab !== "everything" && selectedPages.length && !selectedPages.includes(String(row.page_id || ""))) return false;
    if (filters.listTab === "comments") return isCommentChat(row);
    if (filters.listTab === "line") return row.source === "line" && INBOX_LINE_OA_ENABLED;
    if (filters.listTab === "instagram") return row.source === "instagram" && INBOX_INSTAGRAM_ENABLED;
    if (filters.listTab === "everything") return true;
    // แท็บ Messenger = เฉพาะ Messenger จริงๆ ต้องกัน instagram ออกด้วย ไม่งั้น IG จะโผล่ผิดช่อง
    return !isCommentChat(row) && row.source !== "line" && row.source !== "instagram";
  }

  function scheduleUnreadRefresh(delay = 500) {
    clearTimeout(unreadRefreshTimerRef.current);
    unreadRefreshTimerRef.current = setTimeout(() => {
      void Promise.allSettled([
        updateAppBadge(),
        loadCommentUnreadCount(),
        loadMessengerUnreadCount(),
        ...(INBOX_LINE_OA_ENABLED ? [loadLineUnreadCount()] : []),
        ...(INBOX_INSTAGRAM_ENABLED ? [loadInstagramUnreadCount()] : []),
      ]);
    }, delay);
  }

  async function runGuardedSync(name, key, cooldownMs, task) {
    const guard = syncGuardRef.current;
    const jobKey = `${name}:${key || "all"}`;
    if (guard.inFlight.has(jobKey)) return guard.inFlight.get(jobKey);
    if (Date.now() - (guard.lastRun.get(jobKey) || 0) < cooldownMs) return null;
    guard.lastRun.set(jobKey, Date.now());
    const promise = Promise.resolve().then(task).finally(() => guard.inFlight.delete(jobKey));
    guard.inFlight.set(jobKey, promise);
    return promise;
  }

  async function loadSavedReplies(pageId, openSeq = openRequestRef.current.seq) {
    setSavedErr("");
    if (String(pageId || "").startsWith("line:")) { setSavedReplies([]); return; }
    const cacheKey = String(pageId || "__global__");
    const cached = savedCacheRef.current[cacheKey];
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
      if (openSeq === openRequestRef.current.seq) setSavedReplies(cached.items);
      return;
    }
    const orFilter = pageId ? `page_id.is.null,page_id.eq.${pageId}` : "page_id.is.null";
    const [{ data, error }, { data: pageBrands }] = await Promise.all([
      supabase.from("saved_replies").select("*").or(orFilter).order("sort").order("created_at"),
      pageId ? supabase.from("tv_brands").select("id, pages").eq("active", true) : Promise.resolve({ data: [] }),
    ]);
    if (openSeq !== openRequestRef.current.seq) return;
    if (error) { setSavedErr(error.message); setSavedReplies([]); return; }
    const brandIds = new Set((pageBrands || []).filter((b) => Array.isArray(b.pages) && b.pages.map(String).includes(String(pageId))).map((b) => String(b.id)));
    const items = (data || []).filter((r) => !r.brand_id || brandIds.has(String(r.brand_id))).map((r) => ({ id: r.id, title: r.title, message: r.message || "", image: r.image_url || null }));
    savedCacheRef.current[cacheKey] = { at: Date.now(), items };
    setSavedReplies(items);
  }

  async function searchKnowledge(term = knowledgeQuery) {
    const text = String(term || "").trim();
    if (!selected?.page_id || text.length < 2) { setKnowledgeResults([]); return; }
    setKnowledgeLoading(true); setKnowledgeErr("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "search", page_id: selected.page_id, q: text } });
    setKnowledgeLoading(false);
    if (error || !data?.ok) { setKnowledgeErr(data?.error || error?.message || "ค้นหาไม่สำเร็จ"); setKnowledgeResults([]); return; }
    setKnowledgeResults(data.items || []);
  }

  function openKnowledgeSearch() {
    const latest = [...(selected?.transcript || [])].reverse().find((m) => m?.w === "u" && String(m?.t || "").trim());
    const term = latest ? (thOf(latest) || latest.t) : "";
    setKnowledgeQuery(term); setKnowledgeOpen(true); setSavedOpen(false);
    if (String(term).trim().length >= 2) searchKnowledge(term);
  }

  async function loadList({ refreshAfterCurrent = false, lean = false } = {}) {
    const key = JSON.stringify({
      listTab,
      showBlocked,
      unreadOnly,
      pageMode: pageSel.mode,
      pageSingle: pageSel.single || null,
      pageMulti: pageSel.multi || [],
      allowedPages,
    });
    latestListKeyRef.current = key;

    // React effects, focus และ realtime อาจเรียกพร้อมกัน ให้ใช้ promise เดิมเมื่อเงื่อนไขเดียวกัน
    if (listLoadRef.current) {
      if (refreshAfterCurrent) queuedListLoadRef.current = true;
      if (listLoadRef.current.key === key) return listLoadRef.current.promise;
      queuedListLoadRef.current = true;
      return listLoadRef.current.promise;
    }

    const seq = ++listSeqRef.current;
    if (!lean) setLoadingList(true);   // lean poll (ทุก 10 วิ) = เงียบ ไม่โชว์สปินเนอร์/ไม่ยิง count
    setListError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const promise = (async () => {
      try {
        let query = supabase.from("chat_customers")
          .select("id, customer_name, last_user_text, last_reply_text, last_reply_by, last_reply_at, last_message_at, page_id, page_name, country, cust_lang, source, entry_ad_id, entry_ad_name, comment_ad_name, comment_ad_ids, comment_ad_names, comment_is_ad, comment_promoted_to_inbox, stage, stage_manual, psid, profile_pic, awaiting_reply, unread, cust_read_at, blocked_at, synced_at, updated_at, tags")
          .order("last_message_at", { ascending: false }).limit(200);
        query = showBlocked ? query.not("blocked_at", "is", null) : query.is("blocked_at", null);
        if (listTab === "comments") query = query.or("source.eq.comment,id.like.fbc_%");
        else if (listTab === "line") query = query.eq("source", "line");
        else if (listTab === "instagram") query = query.eq("source", "instagram");
        else if (listTab === "everything") { /* ทุกช่องทางจริง รวมความคิดเห็นด้วย */ }
        // แท็บ Messenger — เดิมกันออกแค่ comment กับ line ทำให้แชท Instagram หลุดมาปนอยู่ในนี้
        else query = query.not("id", "like", "fbc_%").or("source.is.null,and(source.neq.comment,source.neq.line,source.neq.instagram)");
        if (unreadOnly) query = query.eq("unread", true);

        if (listTab === "line") {
          if (allowedPages !== null) query = query.eq("page_id", "__line_permission_required__");
        } else if (listTab !== "everything") {
          if (pageSel.mode === "single" && pageSel.single) query = query.eq("page_id", pageSel.single);
          else if (pageSel.mode === "multi" && pageSel.multi.length) query = query.in("page_id", pageSel.multi);
          if (allowedPages) query = query.in("page_id", allowedPages);
        } else if (allowedPages) {
          // รวมทุกเพจ แต่ยังเคารพสิทธิ์เพจที่ผู้ใช้ได้รับ
          query = query.in("page_id", allowedPages);
        }

        const { data, error } = await query.abortSignal(controller.signal);
        if (error) throw error;
        if (seq !== listSeqRef.current || key !== latestListKeyRef.current) return;
        setList((data || []).map(normalizeChatSource));
        // นับ unread/badge (count query หลายตัว) — ข้ามในโหมด lean เพื่อให้ poll 10 วิ ยิงแค่ query ลิสต์ตัวเดียว
        if (!lean) {
          void Promise.allSettled([
            updateAppBadge(),
            loadCommentUnreadCount(),
            loadMessengerUnreadCount(),
            ...(INBOX_LINE_OA_ENABLED ? [loadLineUnreadCount()] : []),
        ...(INBOX_INSTAGRAM_ENABLED ? [loadInstagramUnreadCount()] : []),
          ]);
        }
      } catch (error) {
        if (seq === listSeqRef.current && key === latestListKeyRef.current) {
          setListError(error?.name === "AbortError" ? "ฐานข้อมูลตอบสนองเกิน 15 วินาที กรุณาลองใหม่" : (error?.message || "โหลดรายการแชทไม่สำเร็จ"));
        }
      } finally {
        clearTimeout(timeout);
        if (listLoadRef.current?.promise === promise) listLoadRef.current = null;
        if (seq === listSeqRef.current && !lean) setLoadingList(false);
        if (queuedListLoadRef.current || key !== latestListKeyRef.current) {
          queuedListLoadRef.current = false;
          queueMicrotask(() => loadRef.current());
        }
      }
    })();
    listLoadRef.current = { key, promise };
    return promise;
  }
  async function loadMessengerUnreadCount() {
    const ps = pageSelRef.current;
    let mq = supabase.from("chat_customers").select("id", { count: "exact", head: true })
      .eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,and(source.neq.comment,source.neq.line,source.neq.instagram)");
    if (ps.mode === "single" && ps.single) mq = mq.eq("page_id", ps.single);
    else if (ps.mode === "multi" && ps.multi.length) mq = mq.in("page_id", ps.multi);
    if (allowedPages) mq = mq.in("page_id", allowedPages);
    const { count } = await mq;
    setMessengerUnreadCount(count || 0);
  }
  async function loadLineUnreadCount() {
    let lq = supabase.from("chat_customers").select("id", { count: "exact", head: true }).eq("source", "line").eq("unread", true);
    if (allowedPages) lq = lq.in("page_id", allowedPages);
    const { count } = await lq; setLineUnreadCount(count || 0);
  }
  async function loadInstagramUnreadCount() {
    const ps = pageSelRef.current;
    let iq = supabase.from("chat_customers").select("id", { count: "exact", head: true }).eq("source", "instagram").eq("unread", true);
    // IG ผูกกับเพจ Facebook จึงเคารพตัวเลือกเพจเหมือน Messenger (ต่างจาก LINE ที่ไม่ได้ผูกกับเพจ)
    if (ps.mode === "single" && ps.single) iq = iq.eq("page_id", ps.single);
    else if (ps.mode === "multi" && ps.multi.length) iq = iq.in("page_id", ps.multi);
    if (allowedPages) iq = iq.in("page_id", allowedPages);
    const { count } = await iq; setInstagramUnreadCount(count || 0);
  }
  async function loadCommentUnreadCount() {
    const ps = pageSelRef.current;
    let cq = supabase.from("chat_customers").select("id", { count: "exact", head: true }).or("source.eq.comment,id.like.fbc_%").eq("unread", true);
    if (ps.mode === "single" && ps.single) cq = cq.eq("page_id", ps.single);
    else if (ps.mode === "multi" && ps.multi.length) cq = cq.in("page_id", ps.multi);
    if (allowedPages) cq = cq.in("page_id", allowedPages);
    const { count } = await cq;
    setCommentUnreadCount(count || 0);
  }
  // จุดแดงบนไอคอนแอป (Badging API) = จำนวนแชทค้างอ่าน "เฉพาะเพจที่เลือกดูในหน้าตอบแชท" (ไม่อิงแท็บ)
  async function updateAppBadge() {
    try {
      if (!("setAppBadge" in navigator)) return;
      const ps = pageSelRef.current;
      const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
      // เลือกเพจไว้ = นับเฉพาะเพจนั้น ; ไม่เลือก (ดูทุกเพจ) = นับทุกเพจที่มีสิทธิ์
      const scope = viewing.length ? viewing.filter((p) => !allowedPages || allowedPages.includes(p)) : allowedPages;
      let cq = supabase.from("chat_customers").select("id", { count: "exact", head: true }).eq("unread", true).not("id", "like", "fbc_%").or("source.is.null,and(source.neq.comment,source.neq.line,source.neq.instagram)");
      if (scope && scope.length === 0) { navigator.clearAppBadge(); return; }
      if (scope) cq = cq.in("page_id", scope);
      const { count } = await cq;
      if (count && count > 0) navigator.setAppBadge(count); else navigator.clearAppBadge();
    } catch { /* ไม่รองรับ/เกิดข้อผิดพลาด = ข้าม */ }
  }
  // ดึงข้อความใหม่ของ "แชทที่เปิดอยู่" (ให้เด้งเองโดยไม่ต้องกดที่ลิสต์)
  async function refreshOpenTranscript(id) {
    const { data } = await supabase.from("chat_customers").select("id, page_id, transcript, unread, awaiting_reply, last_message_at, synced_at, updated_at").eq("id", id).maybeSingle();
    if (!data) return;
    const cur = selRef.current;
    if (!cur || cur.id !== id) return;
    const newTr = Array.isArray(data.transcript) ? data.transcript : [];
    const oldLen = Array.isArray(cur.transcript) ? cur.transcript.length : 0;
    const grew = newTr.length > oldLen;
    if (!grew && cur.unread === data.unread && cur.awaiting_reply === data.awaiting_reply) return;
    recordInboxLatency("transcript_refresh", data);
    setSelected((s) => {
      if (!s || s.id !== id) return s;
      // ห้ามเขียนทับ transcript เดิมด้วยของที่สั้น/ว่างกว่า (กันข้อความกระพริบหาย)
      const keepTr = (Array.isArray(s.transcript) && s.transcript.length > newTr.length) ? s.transcript : newTr;
      return { ...s, transcript: keepTr, unread: data.unread, awaiting_reply: data.awaiting_reply };
    });
    if (grew) {
      if (cur.source !== "line") {
        const { data: tr } = await supabase.functions.invoke("messenger-reply", { body: { action: "translate", id } });
        if (tr?.ok) setTranslations(tr.translations || {});
      }
      // มีข้อความใหม่ในแชทที่เปิดอยู่ = ถือว่าอ่านแล้ว (เราเห็นอยู่)
      supabase.functions.invoke("messenger-reply", { body: { action: "mark_seen", id } });
    }
  }
  selRef.current = selected;
  listRef.current = list;
  listFilterRef.current = { listTab, showBlocked };
  pageOptionsRef.current = pageOptions;
  loadRef.current = loadList;
  openRef.current = () => { const s = selRef.current; if (s?.id) refreshOpenTranscript(s.id); };
  const syncCommentReplies = async () => {
    if (!INBOX_COMMENTS_ENABLED) return;   // พักระบบดึงความคิดเห็น (ข้อมูลเดิมยังอยู่)
    const pageIds = currentPageIds({ includeAll: true });
    if (!pageIds.length) return;
    return runGuardedSync("comments", [...pageIds].sort().join(","), 12 * 60 * 1000, async () => {
      const { data } = await supabase.functions.invoke("sync-comment-replies", { body: { page_ids: pageIds } });
      if (data?.reconciled > 0) { loadRef.current(); openRef.current(); scheduleUnreadRefresh(0); }
      return data;
    });
  };
  const syncInstagramRecent = async () => {
    const pageIds = currentPageIds({ includeAll: true });
    const key = pageIds.length ? [...pageIds].sort().join(",") : "all";
    return runGuardedSync("instagram", key, 10 * 60 * 1000, async () => {
      const { data } = await supabase.functions.invoke("sync-instagram-recent", { body: { page_ids: pageIds } });
      if (data?.upserted > 0) { loadRef.current(); openRef.current(); scheduleUnreadRefresh(0); }
      return data;
    });
  };

  // ดึงแอดทั้งหมดที่ลูกค้าคนนี้ทักเข้ามา + รายละเอียด (แคมเปญ/ชุด/โฆษณา/รูป-วิดีโอ)
  async function loadAdSources(row, openSeq = openRequestRef.current.seq) {
    if (row?.source === "line") return;
    if (!row?.psid || !row?.page_id) return;
    const { data: refs } = await supabase.from("chat_referrals").select("ad_id, received_at").eq("page_id", row.page_id).eq("psid", row.psid).order("received_at", { ascending: true });
    if (openSeq !== openRequestRef.current.seq || selRef.current?.id !== row.id) return;
    let adIds = [...new Set((refs || []).map((r) => r.ad_id).filter(Boolean))];
    if (!adIds.length && row.entry_ad_id) adIds = [row.entry_ad_id];
    if (!adIds.length) return;
    // แชท DM ที่เริ่มจากแอด/คอมเมนต์แอดบางครั้ง Meta ส่ง ad id มา แต่ source เดิมยังเป็น null
    // แก้ข้อมูลต้นทางให้ฐานข้อมูลและ Export เห็นว่าเป็น Ads ตรงกับหน้าแชท
    if (row.source !== "ad" && !isCommentChat(row) && row.source !== "instagram") {
      const sourcePatch = { source: "ad", entry_ad_id: row.entry_ad_id || adIds[adIds.length - 1], updated_at: new Date().toISOString() };
      const { data: saved } = await supabase.functions.invoke("save-lead-fields", { body: { action: "mark_ad_source", id: row.id } });
      if (saved?.ok) {
        if (openSeq !== openRequestRef.current.seq) return;
        setSelected((s) => (s?.id === row.id ? { ...s, ...sourcePatch, entry_ad_id: saved.entry_ad_id || sourcePatch.entry_ad_id } : s));
        setList((items) => (items || []).map((item) => item.id === row.id ? { ...item, ...sourcePatch, entry_ad_id: saved.entry_ad_id || sourcePatch.entry_ad_id } : item));
      }
    }
    const cacheKey = [...adIds].sort().join(",");
    const cached = adSourceCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      if (openSeq === openRequestRef.current.seq && selRef.current?.id === row.id) setAdSources(cached.ads);
      return;
    }
    setAdLoading(true);
    try {
      const { data: det } = await supabase.functions.invoke("ad-source-details", { body: { ad_ids: adIds } });
      if (openSeq !== openRequestRef.current.seq || selRef.current?.id !== row.id) return;
      if (det?.ok) {
        const ads = det.ads || [];
        adSourceCacheRef.current.set(cacheKey, { at: Date.now(), ads });
        if (adSourceCacheRef.current.size > 50) adSourceCacheRef.current.delete(adSourceCacheRef.current.keys().next().value);
        setAdSources(ads);
        // เก็บชื่อโฆษณาตัวหลักไว้ใน DB (โชว์ในหน้าฐานข้อมูล) — เลือกตัวที่ตรง entry_ad_id ไม่งั้นตัวล่าสุด
        const primary = ads.find((x) => x.ad_id === row.entry_ad_id && x.name) || [...ads].reverse().find((x) => x.name);
        const adName = primary?.name || "";
        if (adName && adName !== row.entry_ad_name) {
          supabase.functions.invoke("save-lead-fields", { body: { action: "save_ad_name", id: row.id, ad_name: adName, ad_id: primary?.ad_id } }).then(({ data }) => {
            if (!data?.ok) return;
            setSelected((s) => (s?.id === row.id ? { ...s, entry_ad_name: adName } : s));
            setList((items) => (items || []).map((it) => (it.id === row.id ? { ...it, entry_ad_name: adName } : it)));
          }).catch(() => {});
        }
      }
    } finally {
      if (openSeq === openRequestRef.current.seq && selRef.current?.id === row.id) setAdLoading(false);
    }
  }
  // โหลด + Realtime + poll — ทำงานเฉพาะตอน "เปิดแท็บตอบแชทอยู่" (active) เพื่อประหยัด egress
  // เมื่อสลับไปแท็บอื่น: หยุด subscription/poll ทั้งหมด (การแจ้งเตือนตอนปิดแอปยังทำงานผ่าน push/cron ฝั่ง server — ไม่กระทบ)
  useEffect(() => {
    if (!active) return;
    loadRef.current();
    let stopped = false;
    // Realtime: subscribe การเปลี่ยนแปลงของ chat_customers → เด้งทันที
    const channel = supabase.channel("inbox-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_customers" }, (payload) => {
        const row = payload.new;
        if (payload.eventType === "DELETE") {
          const deletedId = String(payload.old?.id || "");
          if (deletedId) {
            setList((items) => (items || []).filter((item) => item.id !== deletedId));
            if (selRef.current?.id === deletedId) setSelected(null);
          }
          scheduleUnreadRefresh();
          return;
        }
        // ใช้ payload อัปเดตลิสต์โดยตรง ไม่โหลด 200 ห้องใหม่ทุกครั้งที่ข้อความ/สถานะเปลี่ยน
        if (row?.id) {
          recordInboxLatency("realtime_received", row);
          const existingBefore = (listRef.current || []).find((item) => item.id === row.id);
          const countChanged = !existingBefore
            || existingBefore.unread !== row.unread
            || existingBefore.source !== row.source
            || existingBefore.page_id !== row.page_id
            || !!existingBefore.blocked_at !== !!row.blocked_at;
          setList((items) => {
            if (!items) return items;
            const visible = rowMatchesCurrentList(row);
            const exists = items.some((item) => item.id === row.id);
            if (!visible) return exists ? items.filter((item) => item.id !== row.id) : items;
            // transcript อาจใหญ่มาก เก็บไว้เฉพาะ selected pane ไม่ยัดลงลิสต์ซ้าย 200 ห้อง
            const { transcript: _transcript, ads_context: _adsContext, ...lightRow } = row;
            const nextRow = normalizeChatSource(lightRow);
            const next = exists
              ? items.map((item) => item.id === row.id ? normalizeChatSource({ ...item, ...nextRow }) : item)
              : [nextRow, ...items];
            return next
              .sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime())
              .slice(0, 200);
          });
          if (countChanged) scheduleUnreadRefresh();
        }
        // อัปเดตแชทที่เปิดอยู่ทันทีจากข้อมูลที่ส่งมา (ไม่ต้อง query)
        if (row && selRef.current?.id === row.id) {
          const cur = selRef.current;
          const newTr = Array.isArray(row.transcript) ? row.transcript : null;   // payload อาจไม่ส่ง transcript มา
          const oldLen = Array.isArray(cur.transcript) ? cur.transcript.length : 0;
          const grew = newTr && newTr.length > oldLen;
          setSelected((s) => {
            if (!s || s.id !== row.id) return s;
            // ห้ามเขียนทับ transcript เดิมด้วยของว่าง/สั้นกว่า (กันข้อความกระพริบหาย)
            const keepTr = (!newTr || (Array.isArray(s.transcript) && s.transcript.length > newTr.length)) ? s.transcript : newTr;
            // อัปเดต cust_read_at ด้วย → สถานะ "อ่านแล้ว" เด้งทันทีเมื่อลูกค้าเปิดอ่าน (realtime)
            return { ...s, transcript: keepTr, unread: row.unread ?? s.unread, awaiting_reply: row.awaiting_reply ?? s.awaiting_reply, cust_read_at: row.cust_read_at ?? s.cust_read_at };
          });
          // ถ้า payload ส่ง transcript มาไม่ครบ ให้ดึงของจริงจาก DB (กันกรณี payload ใหญ่เกินถูกตัด)
          if (!newTr) {
            clearTimeout(transcriptRefreshTimerRef.current);
            transcriptRefreshTimerRef.current = setTimeout(() => refreshOpenTranscript(row.id), 250);
          }
          if (grew) {
            if (row.source !== "line") {
              supabase.functions.invoke("messenger-reply", { body: { action: "translate", id: row.id } }).then(({ data: tr }) => { if (tr?.ok) setTranslations(tr.translations || {}); });
            }
            supabase.functions.invoke("messenger-reply", { body: { action: "mark_seen", id: row.id } });
          }
        }
        // ---- แจ้งเตือน "ข้อความใหม่ทันที" (ไม่ต้องรอค้างครบ X นาที) ----
        // ลูกค้าเพิ่งทักเข้ามา = row.unread true + awaiting_reply true + ข้อความล่าสุดเป็นของลูกค้า
        if (row && payload.eventType !== "DELETE") {
          instantNotifyRef.current?.(row);
        }
      })
      .subscribe((status) => {
        if (stopped) return;
        // โหลดใหม่เฉพาะเมื่อ socket มีปัญหา; ตอน SUBSCRIBED มี initial load อยู่แล้ว
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          loadRef.current({ refreshAfterCurrent: true }); scheduleUnreadRefresh(0);
        }
      });
    // fallback: เผื่อ realtime หลุด — poll ทุก 10 วิ (จุดแดงข้อความใหม่ช้าสุด ~10 วิ)
    //   lean = ยิงแค่ query ลิสต์ตัวเดียว (จุดแดงในลิสต์สด) · เต็ม (นับ unread/badge) ทุก ~30 วิ
    let ftick = 0;
    const fallback = setInterval(() => { ftick++; loadRef.current({ lean: ftick % 3 !== 0 }); openRef.current(); }, 10000);
    // Facebook ไม่มี webhook เมื่อแอดมินเพียง "เปิดอ่าน" ใน Page Inbox จึงใช้ fallback เบา ๆ
    // ฝั่ง server มี shared cooldown ต่อเพจ ป้องกันหลายเครื่องเรียก Meta ซ้ำกัน
    const readSync = () => {
      const ps = pageSelRef.current;
      const selectedPages = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
      const onePage = selectedPages.length === 1 ? selectedPages[0] : null;
      const key = onePage || "all";
      return runGuardedSync("read", key, Math.max(1, Math.min(15, Number(alertMin) || 3)) * 60 * 1000, () =>
        supabase.functions.invoke("sync-conversations", { body: { job: "read_status", ...(onePage ? { page_id: onePage } : {}) } }).catch(() => null));
    };
    readSync();
    const readEveryMs = Math.max(1, Math.min(15, Number(alertMin) || 3)) * 60 * 1000;
    const readTimer = setInterval(readSync, readEveryMs);
    // Webhook เป็นทางหลักและเด้งทันทีอยู่แล้ว; polling นี้เป็น safety net เมื่อ Meta พลาด event เท่านั้น
    const commentReplyTimer = setInterval(syncCommentReplies, 15 * 60 * 1000);
    const instagramFallbackTimer = setInterval(syncInstagramRecent, 10 * 60 * 1000);
    // เปิด/โฟกัสแอป → เคลียร์แจ้งเตือนค้าง + รีเฟรชจุดแดงบนไอคอน (iOS ผูก badge กับ notification ที่ค้างใน Notification Center)
    const clearNotifs = async () => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration?.();
        const ns = await reg?.getNotifications?.();
        (ns || []).forEach((n) => n.close());
      } catch { /* ข้าม */ }
    };
    const onFocus = () => {
      const now = Date.now();
      if (now - focusRefreshAtRef.current < 1500) return;
      focusRefreshAtRef.current = now;
      loadRef.current(); openRef.current(); readSync(); syncCommentReplies(); syncInstagramRecent(); clearNotifs();
    };
    clearNotifs();   // ตอนเปิดแอปครั้งแรก
    const onVis = () => { if (document.visibilityState === "visible") onFocus(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => { stopped = true; clearTimeout(unreadRefreshTimerRef.current); clearTimeout(transcriptRefreshTimerRef.current); clearInterval(fallback); clearInterval(readTimer); clearInterval(commentReplyTimer); clearInterval(instagramFallbackTimer); supabase.removeChannel(channel); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVis); };
  }, [active, alertMin]);
  useEffect(() => { setList(null); loadList(); }, [listTab, unreadOnly]);   // เปลี่ยนแท็บ/ตัวกรองยังไม่อ่าน = แสดงสถานะโหลด ไม่สรุปผิดว่าไม่มีแชท
  useEffect(() => { setSelected(null); setList(null); loadList(); }, [showBlocked]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("page_lead_config").select("page_id, page_name, picture_url").order("page_name");
      const opts = (data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })).filter((o) => !allowedPages || allowedPages.includes(o.id));
      setPageOptions(opts);
      // โลโก้เพจที่เก็บไว้ใน DB (Supabase Storage) — โชว์ได้ทันที ไม่ต้องยิง Meta
      const seed = {};
      for (const p of data || []) if (p.picture_url) seed[p.page_id] = p.picture_url;
      if (Object.keys(seed).length) setPagePics((prev) => ({ ...seed, ...prev }));
      // เรียกให้ระบบดึงรูปจาก Meta "ครั้งเดียว" มาเก็บลง Storage ให้ครบ (เพจที่ยังไม่มี/เก่า) แล้วอัปเดต map
      supabase.functions.invoke("page-pictures", { body: {} }).then(({ data: pp }) => {
        if (pp?.ok && pp.pictures) setPagePics((prev) => ({ ...prev, ...pp.pictures }));
      }).catch(() => { /* ไม่มีรูปก็ fallback ตัวย่อชื่อเพจ */ });
      const { data: u } = await supabase.auth.getUser();
      setMyEmail(u?.user?.email || "");
      // โหลดตัวเลือกเพจ "ของคนนี้" ก่อน (คีย์ผูกอีเมล) — ไม่มีค่อย fallback คีย์กลางเดิม
      const myKey = u?.user?.email ? `inbox_page_filter:${u.user.email}` : "inbox_page_filter";
      let { data: s } = await supabase.from("settings").select("value").eq("key", myKey).maybeSingle();
      if (!s?.value && myKey !== "inbox_page_filter") ({ data: s } = await supabase.from("settings").select("value").eq("key", "inbox_page_filter").maybeSingle());
      if (s?.value) {
        // กรองตัวเลือกที่จำไว้ให้เหลือเฉพาะเพจที่คนนี้มีสิทธิ์ (กันตัวเลข/ตัวกรองเกินสิทธิ์ เช่นค้าง 5 เพจทั้งที่เห็นได้ 3)
        const ok = (id) => !allowedPages || allowedPages.includes(id);
        const multi = (Array.isArray(s.value.multi) ? s.value.multi : []).filter(ok);
        const single = s.value.single && ok(s.value.single) ? s.value.single : null;
        setPageSel({ mode: s.value.mode === "single" ? "single" : "multi", single, multi });
      } else {
        // ค่าเริ่มต้นที่หน้า UI แสดงว่า "ทุกเพจ" ต้องบันทึกไว้ด้วย เพื่อให้ webhook รู้ว่าต้องรับคอมเมนต์ทุกเพจในสิทธิ์คนนี้
        const initialFilter = { mode: "multi", single: null, multi: [] };
        await supabase.from("settings").upsert({ key: myKey, value: initialFilter, updated_at: new Date().toISOString() });
      }
    })();
  }, []);
  // ตรวจ webhook เฉพาะเมื่อผู้ใช้เข้าหน้าตอบแชทจริง และไม่เกินหนึ่งครั้งต่อ app session
  // ฝั่ง server มี cache 6 ชั่วโมงอีกชั้น จึงไม่ยิง Meta ซ้ำเมื่อหลายเครื่องเปิดพร้อมกัน
  useEffect(() => {
    if (!active || commentSubscriptionCheckedRef.current) return;
    commentSubscriptionCheckedRef.current = true;
    supabase.functions.invoke("subscribe-webhook", { body: { action: "sync_comments" } }).then(({ data: sync }) => {
      if (sync && !sync.ok) setSendMsg("เปิดรับความคิดเห็นไม่สำเร็จ: " + (sync.error || ""));
    });
  }, [active]);
  useEffect(() => { pageSelRef.current = pageSel; }, [pageSel]);
  useEffect(() => {
    if (!active || !pageOptions.length) return;
    syncCommentReplies();
    syncInstagramRecent();
  }, [active, pageSel.mode, pageSel.single, pageSel.multi.join(","), pageOptions.map((page) => page.id).join(",")]);
  useEffect(() => { setList(null); loadList(); }, [pageSel.mode, pageSel.single, pageSel.multi.join(",")]);
  useEffect(() => () => {
    openRequestRef.current.controller?.abort();
    clearTimeout(unreadRefreshTimerRef.current);
    clearTimeout(transcriptRefreshTimerRef.current);
  }, []);
  // เปิดแชท/มีข้อความใหม่ = เลื่อนไปข้อความล่าสุด (ล่างสุด) อัตโนมัติ
  // ยกเว้นตอนที่ถูกสั่งให้ไปหาข้อความเจาะจง (จากลิสต์หลักฐาน) — ไม่งั้นจะแย่งกันเลื่อนแล้วเด้งลงล่างสุดแทน
  useEffect(() => {
    if (!selected?.transcript || highlightAtRef.current) return;
    // เลื่อนล่างสุดหลายจังหวะ กันรูป/สติกเกอร์โหลดช้าแล้วดันความสูง (เปิดแชทค้างกลางจอ)
    const toBottom = () => bottomRef.current?.scrollIntoView({ block: "end" });
    toBottom();
    const t1 = setTimeout(toBottom, 120);
    const t2 = setTimeout(toBottom, 400);
    const t3 = setTimeout(toBottom, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [selected?.id, Array.isArray(selected?.transcript) ? selected.transcript.length : 0]);

  // เปิดแชทที่ถูกสั่งมาจากหน้าอื่น (ลิสต์หลักฐานในสถิติการตอบแชท)
  // ต้องสลับตัวกรองเพจไปเพจของแชทนั้นด้วย ไม่งั้นเปิดได้แต่ลิสต์ซ้ายไม่มีรายการนั้น = งง
  useEffect(() => {
    if (!gotoChat || (!gotoChat.id && !gotoChat.trade_id && !gotoChat.username)) return;
    let cancelled = false;
    (async () => {
      // เปิดตาม id ตรงๆ หรือค้นจาก trade_id / username (ลิงก์มาจากหน้าจัดการสมาชิก TV)
      let data = null;
      if (gotoChat.id) {
        ({ data } = await supabase.from("chat_customers").select("id, page_id, customer_name").eq("id", gotoChat.id).maybeSingle());
      } else if (gotoChat.trade_id) {
        const r = await supabase.from("chat_customers").select("id, page_id, customer_name").eq("trade_id", String(gotoChat.trade_id)).order("last_message_at", { ascending: false }).limit(1);
        data = r.data?.[0] || null;
      } else if (gotoChat.username) {
        const r = await supabase.from("chat_customers").select("id, page_id, customer_name").eq("username", String(gotoChat.username)).order("last_message_at", { ascending: false }).limit(1);
        data = r.data?.[0] || null;
      }
      if (cancelled) return;
      if (!data) { onGotoDone?.(); return; }
      const ps = pageSelRef.current;
      const viewing = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (ps.multi || []);
      if (data.page_id && viewing.length > 0 && !viewing.includes(data.page_id)) {
        await savePageSel({ ...ps, mode: "single", single: data.page_id });
      }
      setListTab("everything");
      // จำเวลาข้อความเป้าหมายไว้ — พอ transcript โหลดเสร็จจะเลื่อนไปหาและไฮไลต์ให้
      highlightAtRef.current = gotoChat.at || null;
      setHighlightAt(gotoChat.at || null);
      openChat({ id: data.id, customer_name: data.customer_name, page_id: data.page_id });
      onGotoDone?.();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gotoChat?.id, gotoChat?.at, gotoChat?.trade_id, gotoChat?.username]);

  // เลื่อนไปยัง "ข้อความที่ตอบช้า/ยังไม่ตอบ" แล้วไฮไลต์ไว้สักครู่ — ไม่ต้องไล่หาเอง
  useEffect(() => {
    if (!highlightAt || !Array.isArray(selected?.transcript)) return;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-msg-at="${CSS.escape(String(highlightAt))}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      highlightAtRef.current = null;
      // ปล่อยไฮไลต์ทิ้งไว้ 6 วิ ให้ทันเห็นว่าเป็นข้อความไหน แล้วค่อยจางหาย
      const t2 = setTimeout(() => setHighlightAt(null), 6000);
      return () => clearTimeout(t2);
    }, 120);   // รอ DOM วาด transcript เสร็จก่อน
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightAt, selected?.id, Array.isArray(selected?.transcript) ? selected.transcript.length : 0]);

  async function openChat(item) {
    const openSeq = openRequestRef.current.seq + 1;
    openRequestRef.current.controller?.abort();
    const controller = new AbortController();
    openRequestRef.current = { seq: openSeq, controller };
    const startedAt = performance.now();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    setSelected({ ...item, transcript: null });
    logActivity("open_chat", { id: item.id, customer_name: item.customer_name, page_id: item.page_id });
    setTranslations({}); setReply(""); setSendPreview(null); setSendMsg(""); setAdSources([]); setAdLoading(false); setSavedReplies([]); setSavedOpen(false); setKnowledgeOpen(false); setKnowledgeResults([]); setReplyTo(null); setMessageMenu(null); setKnowledgeCapture(null); setKnowledgeCaptureMsg(""); setEmojiOpen(false); setInfoOpen(false); setStatusMenuOpen(false); setLabelMsg(null); setQuickFillState({});
    setForceLang(item.source === "line" ? "Thai" : lsGet(`ui.forceLang.${item.id}`, "auto"));   // LINE เป็นภาษาไทย ไม่ต้องแปล
    // LINE OA ใช้ภาษาไทย ไม่ต้องเรียกตัวแปลหรือสร้างคำแปลใต้ข้อความ
    const translationPromise = item.source === "line" ? null : supabase.functions.invoke("messenger-reply", { body: { action: "translate", id: item.id } });
    setTranslating(!!translationPromise);
    // ดึงเฉพาะคอลัมน์ที่หน้าแชทใช้จริง (เลี่ยง select * ที่ลากคอลัมน์หนักที่ไม่ได้ใช้ เช่น ads_context/hash → เปิดแชทไวขึ้นมากในแชทใหญ่)
    const CHAT_COLS = "id, page_id, page_name, psid, customer_name, source, stage, stage_manual, classified_by, needs_ai, needs_verify, manual_data, manual_data_by, manual_data_at, trade_id, username, phone, email, awaiting_reply, unread, cust_read_at, cust_lang, country, profile_pic, transcript, account_opened_at, entry_ad_id, entry_ad_name, last_user_text, last_reply_text, last_reply_by, last_reply_at, last_message_at, comment_ad_name, comment_ad_ids, comment_ad_names, comment_is_ad, comment_promoted_to_inbox, comment_permalink, blocked_at, synced_at, updated_at, notes, tags, ai_summary, ai_summary_at";
    if (translationPromise) try {
      const { data, error } = await supabase.from("chat_customers").select(CHAT_COLS).eq("id", item.id).maybeSingle().abortSignal(controller.signal);
      if (openSeq !== openRequestRef.current.seq) return;
      if (error) throw error;
      if (!data) throw new Error("ไม่พบข้อมูลแชทนี้");
      const normalized = normalizeChatSource(data);
      recordInboxLatency("chat_opened", normalized, { query_ms: Math.round(performance.now() - startedAt) });
      setSelected(normalized);
      void loadAdSources(normalized, openSeq);
      void loadSavedReplies(normalized.page_id, openSeq);
      // เปิดอ่านแล้ว → ปิดจุดแดง + แจ้ง Meta ว่าเพจอ่านแล้ว (mark_seen) ให้สถานะตรงกับกล่องข้อความเพจ
      if (data.unread) {
        setSelected((s) => (s && s.id === data.id ? { ...s, unread: false } : s));
        setList((l) => (l || []).map((x) => (x.id === data.id ? { ...x, unread: false } : x)));
        supabase.functions.invoke("messenger-reply", { body: { action: "mark_seen", id: data.id } }).then(() => {
          if (openSeq === openRequestRef.current.seq) scheduleUnreadRefresh(0);
        });
        if (isCommentChat(data)) setCommentUnreadCount((n) => Math.max(0, n - 1));
      }
      if (!data.profile_pic) {
        supabase.functions.invoke("messenger-reply", { body: { action: "profile", id: data.id } }).then(({ data: p }) => {
          if (openSeq === openRequestRef.current.seq && p?.ok && p.profile_pic) {
            setSelected((s) => (s && s.id === data.id ? { ...s, profile_pic: p.profile_pic } : s));
            setList((l) => (l || []).map((x) => (x.id === data.id ? { ...x, profile_pic: p.profile_pic } : x)));
          }
        });
      }
    } catch (error) {
      if (openSeq === openRequestRef.current.seq) {
        const aborted = error?.name === "AbortError";
        setSendMsg(aborted ? "โหลดแชทเกิน 12 วินาที กรุณากดลองใหม่" : `โหลดแชทไม่สำเร็จ: ${error?.message || error}`);
        setSelected((s) => (s?.id === item.id ? { ...s, transcript: [] } : s));
      }
    } finally {
      clearTimeout(timeout);
      if (openSeq === openRequestRef.current.seq) openRequestRef.current.controller = null;
    }
    try {
      const { data: tr } = await Promise.race([
        translationPromise,
        new Promise((resolve) => setTimeout(() => resolve({ data: { ok: false, timeout: true } }), 20_000)),
      ]);
      if (openSeq !== openRequestRef.current.seq) return;
      setTranslating(false);
      if (tr?.ok) {
        setTranslations(tr.translations || {});
        setSelected((s) => (s?.id === item.id ? { ...s, cust_lang: tr.lang || s.cust_lang, country: tr.country || s.country } : s));
      } else if (tr?.error) setSendMsg("แปลไม่สำเร็จ: " + tr.error);
    } catch (error) {
      if (openSeq === openRequestRef.current.seq) { setTranslating(false); setSendMsg("แปลไม่สำเร็จ: " + (error?.message || error)); }
    }
  }

  // เลือกไฟล์ = พักไว้ก่อน (ยังไม่ส่ง) รอกดปุ่มส่ง
  function onFile(e) {
    const files = Array.from(e.target.files || []); if (e.target) e.target.value = "";
    if (!files.length) return;
    const ok = files.filter((f) => f.size <= 20 * 1024 * 1024);
    if (ok.length < files.length) setSendMsg("บางไฟล์ใหญ่เกิน 20MB ถูกข้าม");
    const staged = ok.map((f) => ({
      file: f, name: f.name,
      type: f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : "file",
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
    }));
    setPendingFiles((p) => [...p, ...staged]);
  }
  function removePending(idx) {
    setPendingFiles((p) => { const c = [...p]; const [rm] = c.splice(idx, 1); if (rm?.preview && String(rm.preview).startsWith("blob:")) URL.revokeObjectURL(rm.preview); return c; });
  }
  async function uploadToStorage(file) {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${selected.page_id || "p"}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw error;
    return supabase.storage.from("chat-media").getPublicUrl(path).data.publicUrl;
  }

  async function prepareSendPreview() {
    if (!selected || sending) return;
    const hasText = reply.trim().length > 0;
    if (!hasText && pendingFiles.length === 0) return;
    if (isCommentChat(selected) && pendingFiles.length) {
      setSendMsg("การตอบใต้คอมเมนต์รองรับข้อความ/อิโมจิเท่านั้น กรุณาลบไฟล์แนบก่อนส่ง");
      return;
    }
    // ส่งรูป/ไฟล์ที่ไม่มีข้อความประกอบ → ส่งเลย ไม่ต้องเปิดกล่องตัวอย่าง (ไม่มีคำแปลให้รีวิว)
    if (!hasText && pendingFiles.length > 0) {
      await sendReply({ text: "", lang: "", sourceText: "", replyTo: replyTo ? { ...replyTo } : null });
      return;
    }
    setSending(true); setSendMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("messenger-reply", { body: {
        action: "preview", id: selected.id, text_th: reply.trim(),
        force_lang: selected.source !== "line" && forceLang !== "auto" ? forceLang : undefined,
      } });
      if (error) { setSendMsg("สร้างตัวอย่างไม่สำเร็จ: " + (await readFunctionErrorMessage(error))); return; }
      if (!data?.ok) { setSendMsg("สร้างตัวอย่างไม่สำเร็จ: " + (data?.error || "")); return; }
      setSendPreview({ text: data.preview_text || reply.trim(), lang: data.lang || "Thai", sourceText: reply.trim(), replyTo: replyTo ? { ...replyTo } : null });
    } finally { setSending(false); }
  }

  async function sendReply(approved = sendPreview) {
    if (!selected || sending) return;
    const hasText = reply.trim().length > 0;
    if (!hasText && pendingFiles.length === 0) return;
    if (isCommentChat(selected) && pendingFiles.length) {
      setSendMsg("การตอบใต้คอมเมนต์รองรับข้อความ/อิโมจิเท่านั้น กรุณาลบไฟล์แนบก่อนส่ง");
      return;
    }
    if (!approved) { await prepareSendPreview(); return; }
    setSending(true); setSendMsg("");
    // ปิดกล่องอนุมัติทันทีหลังผู้ใช้ยืนยัน เพื่อไม่ให้ดูเหมือนกล่องค้างระหว่างส่งไฟล์/ข้อความ
    setSendPreview(null);

    // Optimistic UI: ข้อความล้วน (ไม่มีไฟล์แนบ) → โชว์บับเบิลทันทีในสถานะ "กำลังส่ง" + เคลียร์ช่องพิมพ์
    // แล้วค่อยแทนที่ด้วยผลจริงเมื่อเซิร์ฟเวอร์ตอบ · ถ้าพลาด ถอนบับเบิลออกและคืนข้อความให้พิมพ์ใหม่
    // (มีไฟล์แนบ/ไม่มีข้อความ = ใช้ flow เดิมทั้งหมด ไม่แตะ)
    const optimistic = hasText && pendingFiles.length === 0;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optAt = new Date().toISOString();
    const sourceText = approved.sourceText || reply.trim();
    const makeReplyToFields = (src) => ({
      ...(src?.text ? { reply_to_text: src.text } : {}),
      ...(src?.mid ? { reply_to_mid: src.mid } : {}),
      ...(src?.img ? { reply_to_img: src.img } : {}),
      ...(src?.at ? { reply_to_at: src.at } : {}),
    });
    if (optimistic) {
      const optItem = { w: "p", t: approved.text || sourceText, at: optAt, by: myEmail, _tmp: tempId, pending: true, ...makeReplyToFields(approved.replyTo) };
      setSelected((s) => (s ? { ...s, transcript: [...(s.transcript || []), optItem], awaiting_reply: false } : s));
      setReply(""); setReplyTo(null);
    }
    const rollbackOptimistic = () => {
      if (!optimistic) return;
      setSelected((s) => (s ? { ...s, transcript: (s.transcript || []).filter((m) => m._tmp !== tempId) } : s));
      setReply(sourceText);
    };

    // Optimistic UI สำหรับไฟล์: โชว์บับเบิลรูป/ไฟล์ทันทีจากพรีวิวในเครื่อง (สถานะกำลังส่ง)
    // + เคลียร์ช่องแนบทันที แล้วค่อยสลับเป็น URL จริงเมื่อเซิร์ฟเวอร์ตอบ · ถ้าพลาด ถอนออก+คืนไฟล์
    const fileLabel = (pf) => pf.type === "image" ? "[รูปภาพ]" : pf.type === "video" ? "[วิดีโอ]" : "[ไฟล์แนบ]";
    const filesSnapshot = pendingFiles;
    const fileTemps = filesSnapshot.map((pf, i) => ({ pf, tmp: `tmpf_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}` }));
    if (fileTemps.length > 0) {
      const optFileItems = fileTemps.map(({ pf, tmp }) => {
        const it = { w: "p", t: fileLabel(pf), at: new Date().toISOString(), by: myEmail, _tmp: tmp, pending: true };
        if ((pf.type === "image" || pf.type === "video") && pf.preview) it.img = pf.preview;
        return it;
      });
      setSelected((s) => (s ? { ...s, transcript: [...(s.transcript || []), ...optFileItems], awaiting_reply: false } : s));
      setPendingFiles([]);   // เคลียร์ช่องแนบทันทีให้ดูส่งไปแล้ว
    }
    const removeFileTemps = () => setSelected((s) => (s ? { ...s, transcript: (s.transcript || []).filter((m) => !fileTemps.some((f) => f.tmp === m._tmp)) } : s));
    const restoreFiles = () => { removeFileTemps(); if (fileTemps.length) setPendingFiles(filesSnapshot); };

    try {
      // อัปโหลดขึ้น storage (ถ้ายังไม่มี URL) แล้วส่งทีละไฟล์
      let prepared;
      try {
        prepared = await Promise.all(fileTemps.map(async (f) => ({ ...f, url: f.pf.url || await uploadToStorage(f.pf.file) })));
      } catch (er) {
        restoreFiles(); rollbackOptimistic();
        setSendMsg("อัปโหลดไฟล์ไม่สำเร็จ: " + (er?.message || er));
        return;
      }
      for (const { pf, tmp, url } of prepared) {
        const { data, error } = await supabase.functions.invoke("messenger-reply", { body: { action: "send_attachment", id: selected.id, url, type: pf.type, filename: pf.name, by: myEmail } });
        if (error) { restoreFiles(); rollbackOptimistic(); setSendMsg("ส่งไฟล์ไม่สำเร็จ: " + (await readFunctionErrorMessage(error))); return; }
        if (!data?.ok) { restoreFiles(); rollbackOptimistic(); setSendMsg("ส่งไฟล์ไม่สำเร็จ: " + (data?.error || "")); return; }
        // reconcile: แทนบับเบิลชั่วคราวด้วยผลจริง (URL จาก storage + message_id)
        setSelected((s) => {
          if (!s) return s;
          const tr = s.transcript || [];
          const idx = tr.findIndex((m) => m._tmp === tmp);
          const real = { w: "p", t: fileLabel(pf), at: idx >= 0 ? tr[idx].at : new Date().toISOString(), by: myEmail, mid: data.message_id || null };
          if (data.img) real.img = data.img;
          if (idx >= 0) { const next = tr.slice(); next[idx] = real; return { ...s, transcript: next }; }
          return { ...s, transcript: [...tr, real] };
        });
      }
      filesSnapshot.forEach((pf) => pf.preview && String(pf.preview).startsWith("blob:") && URL.revokeObjectURL(pf.preview));
      // ส่งข้อความ (ถ้ามี)
      if (hasText) {
        const { data, error } = await supabase.functions.invoke("messenger-reply", { body: {
          action: "send", id: selected.id, text_th: sourceText,
          approved_text: approved.text, approved_lang: approved.lang, by: myEmail,
          reply_to_text: approved.replyTo?.text || null, reply_to_mid: approved.replyTo?.mid || null,
          reply_to_img: approved.replyTo?.img || null, reply_to_at: approved.replyTo?.at || null,
          reply_to_quote_token: approved.replyTo?.quoteToken || null,
          force_lang: selected.source !== "line" && forceLang !== "auto" ? forceLang : undefined,
          comment_reply_mode: isCommentChat(selected) ? "public" : undefined,
        } });
        if (error) { rollbackOptimistic(); setSendMsg("ส่งไม่สำเร็จ: " + (await readFunctionErrorMessage(error))); return; }
        if (!data?.ok) { rollbackOptimistic(); setSendMsg("ส่งไม่สำเร็จ: " + (data?.error || "")); return; }
        const realItem = { w: "p", t: data.sent_text, at: optAt, by: myEmail, mid: data.message_id || null, ...(data.quote_token ? { quote_token: data.quote_token } : {}), ...(data.reply_to_text ? { reply_to_text: data.reply_to_text } : {}), ...(data.reply_to_mid ? { reply_to_mid: data.reply_to_mid } : {}), ...(data.reply_to_img ? { reply_to_img: data.reply_to_img } : {}), ...(data.reply_to_at ? { reply_to_at: data.reply_to_at } : {}) };
        setSelected((s) => {
          if (!s) return s;
          const tr = s.transcript || [];
          const idx = optimistic ? tr.findIndex((m) => m._tmp === tempId) : -1;
          if (idx >= 0) { const next = tr.slice(); next[idx] = realItem; return { ...s, transcript: next, awaiting_reply: false }; }
          return { ...s, transcript: [...tr, realItem], awaiting_reply: false };
        });
        if (!optimistic) { setReply(""); setReplyTo(null); }
        setSendPreview(null);
        setSendMsg(`${data.delivery_mode === "human_agent" ? "ส่งติดตามด้วย Human Agent แล้ว" : data.via === "comment_public" ? "ตอบใต้คอมเมนต์แล้ว" : data.via === "private_reply" ? "ส่ง DM แล้ว" : "ส่งแล้ว"} (${data.lang}) ✓`);
        logActivity("send_reply", { id: selected.id, customer_name: selected.customer_name, page_id: selected.page_id, lang: data.lang, via: data.via });
      } else {
        setSelected((s) => (s ? { ...s, awaiting_reply: false } : s));
        setReply(""); setReplyTo(null); setSendPreview(null);
        setSendMsg("ส่งไฟล์แล้ว ✓");
        logActivity("send_file", { id: selected.id, customer_name: selected.customer_name, page_id: selected.page_id });
      }
      setEmojiOpen(false);
      loadList();
    } finally { setSending(false); }
  }

  async function blockCustomer(id, block) {
    if (!id || blocking) return;
    if (block && !window.confirm("บล็อกแชทนี้เป็นสแปม? แชทจะถูกซ่อนจากลิสต์ และข้อความใหม่ของลูกค้าคนนี้จะไม่เด้ง/ไม่แจ้งเตือน (ปลดบล็อกภายหลังได้จาก \"ดูที่บล็อกไว้\")")) return;
    setBlocking(true); setSendMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("block-customer", { body: { id, block } });
      if (error || !data?.ok) { setSendMsg((block ? "บล็อกไม่สำเร็จ: " : "ปลดบล็อกไม่สำเร็จ: ") + (data?.error || error?.message || "ลองใหม่อีกครั้ง — อาจยังไม่ได้ deploy block-customer")); return; }
      logActivity(block ? "block_customer" : "unblock_customer", { id, customer_name: selected?.customer_name });
      setList((l) => (l || []).filter((x) => x.id !== id));   // ออกจากลิสต์ปัจจุบันทันที
      setSelected((s) => (s && s.id === id ? null : s));
      setSendMsg(block ? "บล็อกแล้ว ✓ (ย้ายไป \"ดูที่บล็อกไว้\")" : "ปลดบล็อกแล้ว ✓");
    } finally { setBlocking(false); }
  }

  async function setStage(id, stage) {
    const nowIso = new Date().toISOString();
    const openedAt = stage === "account_opened" && selected?.id === id && !selected.account_opened_at ? nowIso : selected?.account_opened_at;
    const patch = { stage, stage_manual: stage, classified_by: "manual", needs_ai: false, needs_verify: false, ...(stage === "account_opened" && openedAt ? { account_opened_at: openedAt } : {}), updated_at: nowIso };
    setSelected((s) => (s && s.id === id ? { ...s, ...patch } : s));
    setList((l) => (l || []).map((x) => x.id === id ? { ...x, ...patch } : x));
    await supabase.from("chat_customers").update(patch).eq("id", id);
    logActivity("set_stage", { id, stage, customer_name: selected?.id === id ? selected?.customer_name : undefined });
  }
  async function confirmInstagramAccountOpened() {
    if (!selected || selected.source !== "instagram") return;
    setLabelMsg({ type: "loading", text: "กำลังบันทึกลูกค้าเปิดบัญชีใหม่..." });
    await setStage(selected.id, "account_opened");
    setLabelMsg({ type: "ok", text: "✓ บันทึกเปิดบัญชีใหม่แล้ว — รวมใน Analytics และ Export" });
  }
  // ทำเครื่องหมายอ่านแล้ว/ยังไม่อ่าน เอง (คุมจุดแดง)
  async function setUnread(val) {
    if (!selected) return;
    const id = selected.id;
    setSelected((s) => (s ? { ...s, unread: val } : s));
    setList((l) => (l || []).map((x) => (x.id === id ? { ...x, unread: val } : x)));
    if (val) {
      await supabase.from("chat_customers").update({ unread: true, updated_at: new Date().toISOString() }).eq("id", id);
    } else {
      // อ่านแล้ว → แจ้ง Meta (mark_seen) ด้วย กันซิงก์ดึงจุดแดงกลับ
      await supabase.functions.invoke("messenger-reply", { body: { action: "mark_seen", id } });
    }
    loadList();
    updateAppBadge();   // อัปเดตจุดแดงบนไอคอนทันที
  }
  async function pushLabel(id) {
    setLabelMsg({ type: "loading", text: "กำลังส่งป้ายไป Meta..." });
    const { data, error } = await supabase.functions.invoke("meta-push-labels", { body: { id } });
    if (error || !data?.ok) { setLabelMsg({ type: "err", text: data?.error || (error ? await readFunctionErrorMessage(error) : "ส่งป้ายไม่สำเร็จ — ลองใหม่ได้") }); return; }
    const r0 = data.results?.[0];
    logActivity("push_label", { id, label: r0?.label, assigned: !!r0?.assigned });
    if (r0?.assigned) setLabelMsg({ type: "ok", text: `✓ ติดป้าย "${r0.label}" บน Meta แล้ว` });
    else if (r0?.skipped) setLabelMsg({ type: "ok", text: "✓ มีป้ายสร้างคอนเวอร์ชั่นบน Meta อยู่แล้ว (ข้าม)" });
    else setLabelMsg({ type: "err", text: r0?.error || "ส่งป้ายไม่สำเร็จ — ลองใหม่ได้" });
  }
  // กล่องสถานะผลการส่งป้าย — สีเด่น อยู่ติดปุ่ม
  const LabelMsgBox = () => !labelMsg ? null : (
    <div className={`mt-2 text-sm font-medium rounded-lg px-3 py-2 flex items-center gap-2 ${
      labelMsg.type === "ok" ? "bg-emerald-600 text-white" : labelMsg.type === "err" ? "bg-rose-600 text-white" : "bg-blue-600 text-white"
    }`}>
      {labelMsg.type === "loading" && <Loader2 className="animate-spin shrink-0" size={15} />}
      <span className="min-w-0 break-words">{labelMsg.text}</span>
    </div>
  );

  // บันทึกโน้ตส่วนตัว — เรียกตอน blur ช่องพิมพ์ ไม่ save ทุกตัวอักษร
  async function saveNotes() {
    if (!selected) return;
    const id = selected.id;
    const value = notesDraft.trim();
    if (value === (selected.notes || "")) return;
    setNotesSaving(true);
    try {
      await supabase.from("chat_customers").update({ notes: value, updated_at: new Date().toISOString() }).eq("id", id);
      setSelected((s) => (s && s.id === id ? { ...s, notes: value } : s));
      setList((l) => (l || []).map((x) => (x.id === id ? { ...x, notes: value } : x)));
    } finally {
      setNotesSaving(false);
    }
  }
  async function persistTags(id, nextTags, previousTags) {
    const { error } = await supabase.from("chat_customers").update({ tags: nextTags, updated_at: new Date().toISOString() }).eq("id", id);
    if (!error) return true;
    setSelected((s) => (s && s.id === id ? { ...s, tags: previousTags } : s));
    setList((l) => (l || []).map((x) => (x.id === id ? { ...x, tags: previousTags } : x)));
    setTagMsg(`บันทึกแท็กไม่สำเร็จ: ${error.message || "ตรวจสอบฐานข้อมูลแล้วลองใหม่"}`);
    return false;
  }
  async function addTag(raw) {
    const value = raw.trim();
    if (!value || !selected) return;
    const id = selected.id;
    const previousTags = Array.isArray(selected.tags) ? selected.tags : [];
    const nextTags = Array.from(new Set([...previousTags, value]));
    setTagDraft("");
    setTagMsg("");
    setSelected((s) => (s && s.id === id ? { ...s, tags: nextTags } : s));
    setList((l) => (l || []).map((x) => (x.id === id ? { ...x, tags: nextTags } : x)));
    await persistTags(id, nextTags, previousTags);
  }
  async function removeTag(tag) {
    if (!selected) return;
    const id = selected.id;
    const previousTags = Array.isArray(selected.tags) ? selected.tags : [];
    const nextTags = previousTags.filter((t) => t !== tag);
    setTagMsg("");
    setSelected((s) => (s && s.id === id ? { ...s, tags: nextTags } : s));
    setList((l) => (l || []).map((x) => (x.id === id ? { ...x, tags: nextTags } : x)));
    await persistTags(id, nextTags, previousTags);
  }
  // แท็กลัดกดครั้งเดียว — ใช้บ่อยสุดคือเช็คว่าลูกค้าเปิดบัญชีกับเราหรือยัง กันพิมพ์เองทุกครั้ง
  // ติดแท็กหนึ่งจะดึงอีกแท็กที่ตรงข้ามออกให้อัตโนมัติ (กันติดค้างทั้งสองสถานะพร้อมกัน)
  const QUICK_TAGS = [
    { label: "✅ เปิดบัญชีแล้ว", opposite: "❌ ยังไม่เปิดบัญชี" },
    { label: "❌ ยังไม่เปิดบัญชี", opposite: "✅ เปิดบัญชีแล้ว" },
  ];
  async function toggleQuickTag(label, opposite) {
    if (!selected) return;
    const id = selected.id;
    const has = (selected.tags || []).includes(label);
    const base = (selected.tags || []).filter((t) => t !== opposite);
    const previousTags = Array.isArray(selected.tags) ? selected.tags : [];
    const nextTags = has ? base.filter((t) => t !== label) : Array.from(new Set([...base, label]));
    setTagMsg("");
    setSelected((s) => (s && s.id === id ? { ...s, tags: nextTags } : s));
    setList((l) => (l || []).map((x) => (x.id === id ? { ...x, tags: nextTags } : x)));
    await persistTags(id, nextTags, previousTags);
  }
  // สรุปบทสนทนา — กดเอง ไม่ auto (ต้นทุนเรียก AI ทุกครั้ง)
  async function summarizeConversation() {
    if (!selected || summarizing) return;
    const id = selected.id;
    setSummarizing(true); setSummaryError("");
    try {
      const { data, error } = await supabase.functions.invoke("messenger-reply", { body: { action: "summarize", id } });
      if (error || !data?.ok) { setSummaryError(data?.error || (error ? await readFunctionErrorMessage(error) : "สรุปไม่สำเร็จ ลองใหม่ได้")); return; }
      setSelected((s) => (s && s.id === id ? { ...s, ai_summary: data.summary, ai_summary_at: data.summarized_at } : s));
      logActivity("summarize_chat", { id });
    } finally {
      setSummarizing(false);
    }
  }
  // แผงโน้ต/แท็ก/สรุปบทสนทนา — ใช้ร่วมกันทั้งแผงมือถือและแผงข้อมูลเดสก์ท็อป
  const ConversationInsights = () => !selected ? null : (
    <div className="chat-insights space-y-2.5">
      <div>
        <div className="flex items-center justify-between text-xs text-night-ink-3 mb-1">
          <span>โน้ตส่วนตัว</span>
          {notesSaving && <Loader2 className="animate-spin" size={12} />}
        </div>
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={saveNotes}
          rows={3}
          placeholder="จดสิ่งที่ต้องจำเกี่ยวกับลูกค้าคนนี้..."
          className="w-full rounded-lg border border-night-border px-2.5 py-2 text-xs resize-y"
        />
      </div>
      <div>
        <div className="text-xs text-night-ink-3 mb-1">แท็ก</div>
        {/* แท็กลัด — เช็คสถานะเปิดบัญชีได้ในคลิกเดียว ไม่ต้องพิมพ์เอง */}
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {QUICK_TAGS.map(({ label, opposite }) => {
            const active = (selected.tags || []).includes(label);
            return (
              <button
                key={label}
                onClick={() => toggleQuickTag(label, opposite)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${
                  active
                    ? "bg-night-accent border-night-accent text-white"
                    : "bg-night-surface2 border-night-border text-night-ink-2 hover:text-night-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {(() => {
          const quickLabels = QUICK_TAGS.map((q) => q.label);
          const customTags = (selected.tags || []).filter((t) => !quickLabels.includes(t));
          return customTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {customTags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 text-[11px] font-medium pl-2 pr-1 py-1 rounded-full bg-blue-500/15 text-blue-400">
                  {t}
                  <button onClick={() => removeTag(t)} className="text-blue-400 hover:text-blue-400" aria-label={`ลบแท็ก ${t}`}><X size={11} /></button>
                </span>
              ))}
            </div>
          );
        })()}
        <input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagDraft); } }}
          placeholder="เพิ่มแท็ก แล้วกด Enter"
          className="w-full rounded-lg border border-night-border px-2.5 py-1.5 text-xs"
        />
        {tagMsg && <div role="alert" className="mt-1 text-[11px] text-rose-400 break-words">{tagMsg}</div>}
      </div>
      <div className="pt-2 border-t border-night-border-subtle space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-night-ink-3">สรุปบทสนทนา (AI)</span>
          <button onClick={summarizeConversation} disabled={summarizing} className="text-[11px] font-semibold text-blue-400 hover:text-blue-400 disabled:opacity-50 flex items-center gap-1">
            {summarizing && <Loader2 className="animate-spin" size={12} />} {selected.ai_summary ? "สรุปใหม่" : "สรุปเลย"}
          </button>
        </div>
        {summaryError && <div className="text-[11px] text-rose-400">{summaryError}</div>}
        {selected.ai_summary && (
          <div className="rounded-lg bg-blue-500/15 border border-blue-100 px-2.5 py-2 text-xs text-night-ink whitespace-pre-wrap">
            {selected.ai_summary}
            {selected.ai_summary_at && <div className="mt-1 text-[10px] text-night-ink-3">สรุปเมื่อ {new Date(selected.ai_summary_at).toLocaleString("th-TH")}</div>}
          </div>
        )}
      </div>
    </div>
  );

  function openMessageMenu(index, message, side) {
    const value = String(message?.t || "").trim() || (message?.img ? "[รูปภาพ]" : "");
    if (!value) return;
    setMessageMenu((current) => current?.index === index ? null : { index, text: value, img: message?.img || null, mid: message?.mid || null, at: message?.at || null, quoteToken: message?.quote_token || null, side });
  }
  function goToReplyTarget(message) {
    const mid = String(message?.reply_to_mid || "");
    const at = String(message?.reply_to_at || "");
    const selector = mid
      ? `[data-msg-mid="${CSS.escape(mid)}"]`
      : at ? `[data-msg-at="${CSS.escape(at)}"]` : "";
    const el = selector ? document.querySelector(selector) : null;
    if (!el) { setSendMsg("ไม่พบข้อความต้นทางในประวัติที่โหลดอยู่"); return; }
    if (at) { highlightAtRef.current = at; setHighlightAt(at); }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function beginKnowledgeCapture(text) {
    setMessageMenu(null);
    setKnowledgeCaptureMsg("");
    setKnowledgeCapture({ step: "question", question: String(text || "").trim(), answer: "", answerIndex: null });
  }
  async function saveKnowledgeCapture() {
    if (!selected?.page_id || !knowledgeCapture?.question?.trim() || !knowledgeCapture?.answer?.trim()) return;
    setKnowledgeCaptureSaving(true); setKnowledgeCaptureMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", {
      body: { action: "create", page_id: selected.page_id, question: knowledgeCapture.question.trim(), answer: knowledgeCapture.answer.trim() },
    });
    setKnowledgeCaptureSaving(false);
    if (error || !data?.ok) { setKnowledgeCaptureMsg(data?.error || error?.message || "บันทึกเข้าคลังไม่สำเร็จ"); return; }
    setKnowledgeCapture(null);
    setKnowledgeCaptureMsg(data.merged ? "คำตอบนี้มีอยู่แล้ว จึงเพิ่มคำถามเข้า Keywords เดิมให้แล้ว ✓" : "บันทึกคำถาม–คำตอบเข้าคลังของเพจนี้แล้ว ✓");
    setTimeout(() => setKnowledgeCaptureMsg(""), 3500);
  }

  const fmt = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); } catch { return t || ""; } };
  // แท็กทั้งหมดที่มีอยู่จริงในลิสต์ที่โหลดมา — ใช้ทำแถบกรอง ไม่ต้อง query แยก
  const allTags = Array.from(new Set((list || []).flatMap((x) => Array.isArray(x.tags) ? x.tags : []))).sort();

  // ประเทศ + แอดต้นทาง: สร้างจากลิสต์ที่โหลดอยู่ พร้อมนับจำนวนต่อกลุ่ม เพื่อให้เห็นสัดส่วนทันทีว่าลูกค้ามาจากไหนเยอะ
  const countByCountry = (list || []).reduce((acc, x) => {
    const c = String(x.country || "").trim();
    if (c) acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  const allCountries = Object.entries(countByCountry).sort((a, c) => c[1] - a[1]);

  // ชื่อแอดอาจว่าง (referral ส่งมาแค่ ad_id) — ใช้ id ย่อแทนเพื่อยังแยกกลุ่มได้
  const adMap = (list || []).reduce((acc, x) => {
    const id = String(x.entry_ad_id || "").trim();
    if (!id) return acc;
    if (!acc[id]) acc[id] = { id, name: String(x.entry_ad_name || "").trim(), n: 0 };
    if (!acc[id].name && x.entry_ad_name) acc[id].name = String(x.entry_ad_name).trim();
    acc[id].n++;
    return acc;
  }, {});
  const allAds = Object.values(adMap).sort((a, c) => c.n - a.n);

  const filtered = (list || []).filter((x) =>
    (!unreadOnly || x.unread) &&
    (!tagFilter || (Array.isArray(x.tags) && x.tags.includes(tagFilter))) &&
    (!countryFilter || String(x.country || "").trim() === countryFilter) &&
    (!adFilter || String(x.entry_ad_id || "").trim() === adFilter) &&
    (!q.trim() || `${x.customer_name || ""} ${x.last_user_text || ""} ${x.country || ""} ${x.entry_ad_name || ""}`.toLowerCase().includes(q.trim().toLowerCase()))
  );
  const tItemsRaw = Array.isArray(selected?.transcript) ? selected.transcript : [];
  // กันแสดงซ้ำ — ตาข่ายกันสุดท้าย ไม่ว่า transcript ใน DB จะเบิ้ลด้วยเหตุใด (race webhook / echo+sync คนละ id)
  // ยุบเฉพาะข้อความ "เหมือนกันเป๊ะ + อยู่ติดกัน" (ฝั่งเดียวกัน + รูป/ข้อความเดียวกัน) ภายใน ~90 วิ
  // — ยังปล่อยให้ส่งข้อความเดิมซ้ำโดยตั้งใจแบบเว้นช่วงได้
  const tItems = (() => {
    const out = [];
    for (const m of tItemsRaw) {
      const prev = out[out.length - 1];
      if (prev && prev.w === m.w) {
        const sameMid = m.mid && prev.mid && m.mid === prev.mid;
        const sameImg = m.img && prev.img && m.img === prev.img;
        const sameText = !m.img && !prev.img && m.t && prev.t && m.t === prev.t;
        const near = (!m.at || !prev.at) || Math.abs(new Date(m.at).getTime() - new Date(prev.at).getTime()) < 90 * 1000;
        if (sameMid) {
          // รายการเดียวกันจาก sync + webhook: สติกเกอร์เลือก URL sync (โปร่งใส), สื่อทั่วไปเลือก webhook
          const isSticker = !!m.sticker || !!prev.sticker || m.t === "[สติกเกอร์]" || prev.t === "[สติกเกอร์]";
          if (isSticker) {
            if (m.img_source === "sync" && prev.img_source !== "sync") out[out.length - 1] = { ...prev, ...m, sticker: true };
          } else if (m.img_source === "webhook" && prev.img_source !== "webhook") {
            out[out.length - 1] = { ...prev, ...m };
          }
          continue;
        }
        if ((sameImg || sameText) && near) continue;
      }
      out.push(m);
    }
    return out;
  })();
  // index ของข้อความฝั่งเพจ "อันสุดท้าย" — โชว์สถานะอ่านแค่อันเดียว
  const lastPageIdx = (() => { for (let k = tItems.length - 1; k >= 0; k--) if (tItems[k]?.w === "p") return k; return -1; })();
  const isLastPageMsg = (i) => i === lastPageIdx;
  // ลูกค้าอ่านข้อความนี้แล้วหรือยัง (เทียบ cust_read_at กับเวลาข้อความ)
  const custReadStatus = (m) => {
    if (!m?.at) return null;
    const rd = selected?.cust_read_at ? new Date(selected.cust_read_at).getTime() : 0;
    const mt = new Date(m.at).getTime();
    if (rd && rd >= mt - 1000) return { read: true, label: `อ่านแล้ว ${fmtMsgTime(selected.cust_read_at)}` };
    return { read: false, label: "ส่งแล้ว" };
  };
  // เครื่องมือเช็คไอดีเทรด (TradeIdChecker) แสดงเฉพาะเพจที่ผูกกับแบรนด์ TradingView เท่านั้น
  // (ตั้งที่ ตั้งค่า → ตั้งค่า TV) — ส่วนบันทึกข้อมูลลูกค้าพื้นฐาน (CustomerDataForm) ทำได้ทุกเพจแล้ว
  const [tvBrandPages, setTvBrandPages] = useState(null);   // Set<page_id> | null (ยังโหลดไม่เสร็จ)
  useEffect(() => {
    supabase.from("tv_brands").select("pages, active").then(({ data }) => {
      const s = new Set();
      for (const b of data || []) if (b.active !== false && Array.isArray(b.pages)) for (const p of b.pages) s.add(String(p));
      setTvBrandPages(s);
    });
  }, []);
  const isBeSightPage = (r) => !!tvBrandPages && tvBrandPages.has(String(r?.page_id || ""));

  // ---- บันทึกด่วนจากข้อความลูกค้า: ตรวจจับไอดีเทรด/username TradingView ที่ลูกค้าพิมพ์มาเอง ----
  // ตัวเลขล้วน 4-8 หลัก = ไอดีเทรด · คำที่มีขีดล่างอย่างน้อย 1 ตัว = username (กันจับคำอังกฤษทั่วไปผิด)
  const detectTradeIdCandidate = (text) => String(text || "").match(/\b\d{4,8}\b/)?.[0] || null;
  const detectTvUsernameCandidate = (text) => {
    const m = String(text || "").match(/\b[a-zA-Z][a-zA-Z0-9_]*_[a-zA-Z0-9_]*\b/);
    return m && m[0].length >= 4 ? m[0] : null;
  };
  const [quickFillState, setQuickFillState] = useState({});   // { [key]: "saving"|"saved"|"error" }
  async function quickSaveField(field, value, key) {
    if (!selected) return;
    setQuickFillState((s) => ({ ...s, [key]: "saving" }));
    const { data, error } = await supabase.functions.invoke("save-lead-fields", {
      body: {
        id: selected.id,
        trade_id: selected.trade_id || "", username: selected.username || "",
        phone: selected.phone || "", email: selected.email || "",
        [field]: value,
      },
    });
    if (error || !data?.ok) { setQuickFillState((s) => ({ ...s, [key]: "error" })); return; }
    const patch = { trade_id: data.trade_id, username: data.username, phone: data.phone, email: data.email, manual_data: true, manual_data_by: data.manual_data_by, manual_data_at: data.manual_data_at };
    setSelected((s) => (s ? { ...s, ...patch } : s));
    setList((l) => (l || []).map((x) => (x.id === selected.id ? { ...x, ...patch } : x)));
    setQuickFillState((s) => ({ ...s, [key]: "saved" }));
  }
  // ข้อความนี้คือข้อความที่ถูกอ้างถึงจากลิสต์หลักฐานไหม (เทียบที่ระดับวินาที กันคลาดจากรูปแบบ ISO ที่ต่างกัน)
  const isHl = (m) => {
    if (!highlightAt || !m?.at) return false;
    const a = new Date(m.at).getTime(), b = new Date(highlightAt).getTime();
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1000;
  };
  // ข้อความนี้เป็นไทยเป็นหลักไหม (เช็คฝั่งเบราว์เซอร์ ตรรกะเดียวกับฝั่งเซิร์ฟเวอร์)
  // ใช้ตัดสินว่าจะขึ้น "กำลังแปล..." ใต้ข้อความไหน — ข้อความไทยไม่ต้องแปลอยู่แล้ว ไม่ต้องขึ้นให้รก
  const isThaiText = (s) => {
    const str = String(s || "");
    const thai = (str.match(/[฀-๿]/g) || []).length;
    const letters = (str.match(/\p{L}/gu) || []).length;
    return letters > 0 && thai / letters > 0.5;
  };
  // hash ข้อความ (djb2) — ต้องตรงกับฝั่ง edge (messenger-reply) เพื่อ lookup คำแปลด้วยตัวข้อความ ไม่ใช่ index
  const hashText = (s) => { let h = 5381; const str = String(s || ""); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };
  const thOf = (m) => translations[hashText(String(m?.t || ""))];   // คำแปลของ "ข้อความนี้" (จับด้วย hash)
  // ควรโชว์บรรทัดคำแปลใต้ข้อความนี้ไหม
  const showTh = (m) => selected?.source !== "line" && (!!thOf(m) || (translating && !isThaiText(m.t)));
  const srcLabel = (r) => (r?.source === "line" ? "LINE OA" : r?.source === "instagram" ? "Instagram" : r?.entry_ad_id ? `#${r.entry_ad_id}` : r?.source === "ad" ? "โฆษณา (ไม่ทราบ id)" : r?.source === "organic" ? "ออร์แกนิก" : "ไม่ทราบ");

  const activeIds = pageSel.mode === "single" ? (pageSel.single ? [pageSel.single] : []) : pageSel.multi;
  // รูปหัวมุมซ้าย: โชว์เฉพาะเมื่อเจาะจงได้ว่าเป็น "เพจเดียว" จริง ๆ — ไม่งั้น (ทุกเพจ/หลายเพจ) โชว์ไอคอนกลาง
  // เดิม fallback ไป pageOptions[0] ทำให้ขึ้นรูปเพจแรกทั้งที่ชื่อบอกว่า "ทุกเพจ" = ดูเหมือนรูปผิดเพจ
  const headerPageId = activeIds.length === 1 ? activeIds[0] : null;
  const showPageBadge = new Set((list || []).map((x) => x.page_id)).size > 1;  // แสดงเพจต่อลูกค้าเมื่อดูหลายเพจ
  const headerName = pageSel.mode === "single"
    ? (pageOptions.find((p) => p.id === pageSel.single)?.name || "เลือกเพจ")
    : (activeIds.length === 0 ? "ทุกเพจ" : activeIds.length === 1 ? (pageOptions.find((p) => p.id === activeIds[0])?.name || "") : `${activeIds.length} เพจ`);

  return (
    // มือถือ: เต็มจอ (chat-shell ใช้ dvh ใน index.css) ไม่มีขอบมน — เดสก์ท็อป: การ์ด 82vh มีขอบมน
    <div className={`chat-shell ${selected ? "is-selected" : ""} bg-night-surface md:rounded-2xl border-0 md:border border-night-border md:shadow-sm overflow-hidden flex relative`}>
      {/* ดูรูปแบบขยายเต็มจอ (คลิกรูปในแชท) — กดพื้นดำ/ปุ่ม X เพื่อปิด · คลิกขวาที่รูปเพื่อ Save ได้ */}
      {lightbox && (
        <div className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)", right: "calc(env(safe-area-inset-right, 0px) + 16px)" }}
            className="fixed w-12 h-12 rounded-full bg-night-surface text-night-ink flex items-center justify-center shadow-lg hover:bg-night-surface2 z-20"
            aria-label="ปิด"
          >
            <X size={26} />
          </button>
          {/* คลิกที่รูปไม่ปิด (กันปิดตอนจะคลิกขวา Save) — คลิกพื้นดำรอบ ๆ ถึงจะปิด */}
          <img
            src={lightbox}
            alt="รูปขยาย"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
          <a
            href={lightbox}
            download
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
            className="fixed left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-night-surface text-night-ink text-sm font-medium shadow-lg hover:bg-night-surface2 z-20"
          >
            ⬇︎ บันทึกรูป
          </a>
        </div>
      )}
      {/* popup เตือนแชทค้างอ่าน — กะพริบจนกว่าจะเปิดอ่าน/กดปิด */}
      {overdueAlert && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 animate-pulse">
          <div className="bg-rose-600 text-white rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-3 border-2 border-rose-500/40">
            <span className="text-sm font-bold whitespace-nowrap">🔴 {overdueAlert.count} แชทค้างอ่านเกิน {alertMin} นาที</span>
            <span className="text-xs opacity-90 hidden sm:inline truncate max-w-[260px]">({overdueAlert.pages.join(", ")})</span>
            {/* บอกให้ชัดว่าแชทที่ค้างอยู่คนละเพจกับที่กำลังเปิดดู — กันงงว่า "ไม่เห็นมีแชทค้างสักหน่อย" */}
            {overdueAlert.outOfView && (
              <span className="text-[11px] bg-night-surface/20 rounded px-1.5 py-0.5 shrink-0">อยู่เพจอื่น</span>
            )}
            <button
              onClick={() => {
                // ถ้าแชทค้างอยู่นอกเพจที่กรองอยู่ ให้สลับตัวกรองไปเพจนั้นก่อน ไม่งั้นกดแล้วจอว่าง
                const ids = overdueAlert.pageIds || [];
                if (overdueAlert.outOfView && ids.length) {
                  savePageSel(ids.length === 1
                    ? { ...pageSel, mode: "single", single: ids[0] }
                    : { ...pageSel, mode: "multi", multi: ids });
                }
                setListTab("everything");
                setOverdueAlert(null);
              }}
              className="bg-night-surface text-rose-400 rounded-full px-2.5 py-1 text-xs font-semibold shrink-0 hover:bg-rose-500/15"
            >
              ดูเลย
            </button>
            <button onClick={() => setOverdueAlert(null)} className="text-white/80 hover:text-white shrink-0" title="ปิดชั่วคราว (จะเด้งอีกถ้ายังค้าง)"><X size={15} /></button>
          </div>
        </div>
      )}
      {/* ซ้าย: หัวเพจ + แท็บ + ลิสต์ (มือถือ: เต็มจอ, ซ่อนเมื่อเปิดแชท) */}
      <div className={`chat-inbox-list w-full md:w-[340px] xl:w-[423px] border-r border-night-border flex-col shrink-0 ${selected ? "hidden md:flex" : "flex"}`}>
        {/* หัว: โลโก้+ชื่อเพจ + dropdown เลือกเพจ */}
        <div className="chat-list-header p-2.5 border-b border-night-border relative">
          <button onClick={() => setPageMenuOpen((o) => !o)} className="flex items-center gap-2 w-full text-left hover:bg-night-surface2 rounded-lg p-1">
            <div className="chat-list-avatar w-9 h-9 rounded-full bg-night-surface2 overflow-hidden shrink-0 border border-night-border flex items-center justify-center relative">
              {headerPageId ? (
                <>
                  {/* ตัวย่อชื่อเพจเป็นพื้นหลังเสมอ — ถ้ารูปโหลดไม่ขึ้นก็ยังเห็นตัวอักษร ไม่ว่างเปล่า */}
                  <span className="text-[11px] font-bold text-night-ink-2">{(headerName || "?").slice(0, 2)}</span>
                  {/* key=URL → พอ pagePics โหลด URL ที่ดีมา img จะ remount แล้วลองใหม่ (แก้บั๊กซ่อนถาวรเมื่อ fallback graph พลาด) */}
                  <img key={pagePic(headerPageId)} src={pagePic(headerPageId)} alt="" referrerPolicy="no-referrer" decoding="async" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                </>
              ) : <MessageSquare size={16} className="text-night-ink-3" />}
            </div>
            <span className="chat-list-title font-bold text-night-ink truncate flex-1">{headerName}</span>
            <ChevronDown size={18} className={`text-night-ink-3 shrink-0 transition-transform ${pageMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {pageMenuOpen && (
            <div className="absolute top-full left-2.5 right-2.5 mt-1 bg-night-surface border border-night-border rounded-xl shadow-lg z-30 p-2">
              <div className="flex gap-1 bg-night-surface2 rounded-lg p-0.5 text-xs mb-2">
                {[["single", "เพจเดียว"], ["multi", "หลายเพจ"]].map(([k, l]) => (
                  <button key={k} onClick={() => savePageSel({ ...pageSel, mode: k })} className={`flex-1 rounded-md px-2 py-1 font-medium ${pageSel.mode === k ? "seg-on" : "text-night-ink-2"}`}>{l}</button>
                ))}
              </div>
              <div className="max-h-60 overflow-y-auto space-y-0.5">
                {pageOptions.length === 0 && <div className="text-xs text-night-ink-3 px-2 py-2">ยังไม่มีเพจ (ซิงก์ก่อน)</div>}
                {pageOptions.map((p) => pageSel.mode === "single" ? (
                  <button key={p.id} onClick={() => { savePageSel({ ...pageSel, single: p.id }); setPageMenuOpen(false); }} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-night-surface2 ${pageSel.single === p.id ? "bg-night-accent/15" : ""}`}>
                    <img src={pagePic(p.id)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="w-7 h-7 rounded-full object-cover bg-night-surface2 shrink-0" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    <span className="text-sm text-night-ink truncate">{p.name}</span>
                  </button>
                ) : (
                  <label key={p.id} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-night-surface2 cursor-pointer">
                    <input type="checkbox" checked={pageSel.multi.includes(p.id)} onChange={(e) => { const m = e.target.checked ? [...pageSel.multi, p.id] : pageSel.multi.filter((x) => x !== p.id); savePageSel({ ...pageSel, multi: m }); }} className="w-4 h-4" />
                    <img src={pagePic(p.id)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="w-7 h-7 rounded-full object-cover bg-night-surface2 shrink-0" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    <span className="text-sm text-night-ink truncate">{p.name}</span>
                  </label>
                ))}
              </div>
              {pageSel.mode === "multi" && <div className="text-[10px] text-night-ink-3 mt-1 px-1">ติ๊กเพจที่ต้องการดูรวมกัน (ไม่ติ๊ก = ทุกเพจ)</div>}
            </div>
          )}
        </div>
        {/* แท็บ + ค้นหา */}
        <div className="chat-list-filters p-2.5 border-b border-night-border space-y-2">
          {/* แท็บเลือกช่องทาง — "ทั้งหมด" รวมทุกช่องทาง (ยกเว้นความคิดเห็น), ที่เหลือกรองเฉพาะช่องทางนั้น
              สไตล์ underline + จุดสีต่อช่องทาง ตามดีไซน์ mockup (ไม่ใช้ segmented pill แบบเดิม) */}
          <div className="flex gap-3 -mx-2.5 px-2.5 border-b border-night-border-subtle">
            {[["everything", "ทั้งหมด", "#58A6FF"], ["all", "Messenger", "#0084FF"], ...(INBOX_INSTAGRAM_ENABLED ? [["instagram", "Instagram", "#E1306C"]] : []), ...(INBOX_LINE_OA_ENABLED ? [["line", "LINE OA", "#06C755"]] : []), ...(INBOX_COMMENTS_ENABLED ? [["comments", "ความคิดเห็น", "#8B949E"]] : [])].map(([k, label, dot]) => (
              <button key={k} onClick={() => { setListTab(k); if (k === "everything") { setShowBlocked(false); setUnreadOnly(false); } }} className={`relative flex items-center gap-1.5 pb-2 pt-0.5 text-[11px] font-medium whitespace-nowrap border-b-2 -mb-px ${listTab === k ? "border-night-accent text-night-accent-light" : "border-transparent text-night-ink-2 hover:text-night-ink"}`}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
                {label}
                {k === "comments" && commentUnreadCount > 0 && <span className="absolute -top-0.5 -right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-night-surface" title={`มีความคิดเห็นใหม่ ${commentUnreadCount} รายการ`} />}
                {k === "line" && lineUnreadCount > 0 && <span className="absolute -top-0.5 -right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-night-surface" title={`มีแชท LINE ใหม่ ${lineUnreadCount} รายการ`} />}
                {k === "all" && messengerUnreadCount > 0 && <span className="absolute -top-0.5 -right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-night-surface" title={`มีแชท Messenger ใหม่ ${messengerUnreadCount} รายการ`} />}
                {k === "instagram" && instagramUnreadCount > 0 && <span className="absolute -top-0.5 -right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-night-surface" title={`มีแชท Instagram ใหม่ ${instagramUnreadCount} รายการ`} />}
                {k === "everything" && (messengerUnreadCount + lineUnreadCount + instagramUnreadCount) > 0 && <span className="absolute -top-0.5 -right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-night-surface" title="มีแชทใหม่ที่ยังไม่อ่าน" />}
              </button>
            ))}
          </div>
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ/ข้อความ/ประเทศ"
            inputClassName="!bg-night-surface2 !border-night-border !text-night-ink !placeholder-night-ink-3" />
          <div className="flex gap-1.5 overflow-x-auto -mx-0.5 px-0.5 pb-0.5">
            <FilterPill active={!showBlocked && !unreadOnly} onClick={() => { setShowBlocked(false); setUnreadOnly(false); }} className={!showBlocked && !unreadOnly ? "" : "!bg-night-surface2 !border-night-border !text-night-ink-2"}>แชทปกติ</FilterPill>
            <FilterPill active={unreadOnly} onClick={() => { setShowBlocked(false); setUnreadOnly((v) => !v); }} className={unreadOnly ? "" : "!bg-night-surface2 !border-night-border !text-night-ink-2"}>ยังไม่อ่าน</FilterPill>
            <FilterPill active={showBlocked} onClick={() => { setShowBlocked(true); setUnreadOnly(false); }} className={showBlocked ? "" : "!bg-night-surface2 !border-night-border !text-night-ink-2"}>
              <span className="inline-flex items-center gap-1"><AlertTriangle size={12} /> บล็อกไว้ (สแปม)</span>
            </FilterPill>
          </div>
          {/* แยกลูกค้าตามประเทศ / ตามแอดที่ทักมา — สร้างจากลิสต์ที่โหลดอยู่ ไม่ต้อง query แยก
              ใช้ select เพราะจำนวนกลุ่มอาจเยอะ (หลายประเทศ/หลายแอด) ถ้าทำเป็นชิปจะล้นจอ */}
          {(allCountries.length > 1 || allAds.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {allCountries.length > 1 && (
                <select
                  value={countryFilter || ""}
                  onChange={(e) => setCountryFilter(e.target.value || null)}
                  className={`min-w-0 flex-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    countryFilter ? "bg-night-accent border-night-accent text-white" : "bg-night-surface2 border-night-border text-night-ink-2"
                  }`}
                  title="แยกลูกค้าตามประเทศ"
                >
                  <option value="">🌏 ทุกประเทศ ({list?.length || 0})</option>
                  {allCountries.map(([c, n]) => (
                    <option key={c} value={c}>{c} ({n})</option>
                  ))}
                </select>
              )}
              {allAds.length > 0 && (
                <select
                  value={adFilter || ""}
                  onChange={(e) => setAdFilter(e.target.value || null)}
                  className={`min-w-0 flex-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    adFilter ? "bg-night-accent border-night-accent text-white" : "bg-night-surface2 border-night-border text-night-ink-2"
                  }`}
                  title="แยกลูกค้าตามแอดที่ทักเข้ามา"
                >
                  <option value="">📣 ทุกแอด</option>
                  {allAds.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || `แอด #${a.id.slice(-6)}`} ({a.n})</option>
                  ))}
                </select>
              )}
              {(countryFilter || adFilter) && (
                <button
                  onClick={() => { setCountryFilter(null); setAdFilter(null); }}
                  className="shrink-0 rounded-full border border-night-border bg-night-surface2 px-2.5 py-1 text-[11px] font-medium text-night-ink-2 hover:text-night-ink"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>
          )}
          {/* กรองตามแท็ก — แสดงเฉพาะแท็กที่มีจริงในลิสต์ที่โหลดอยู่ตอนนี้ กดซ้ำเพื่อยกเลิกกรอง */}
          {allTags.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto -mx-0.5 px-0.5 pb-0.5">
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTagFilter((cur) => (cur === t ? null : t))}
                  className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border whitespace-nowrap ${
                    tagFilter === t
                      ? "bg-night-accent border-night-accent text-white"
                      : "bg-night-surface2 border-night-border text-night-ink-2 hover:text-night-ink"
                  }`}
                >
                  🏷 {t}
                </button>
              ))}
            </div>
          )}
          {/* แจ้งเตือนแชทค้างอ่าน — แอดมินคุมทั้งหมด ผู้ใช้ไม่มีปุ่มปรับ
              เหลือแค่แถบ "ขออนุญาตแจ้งเตือน" ที่ต้องให้ผู้ใช้กดเอง เพราะเบราว์เซอร์บังคับว่า
              ต้องมาจากการคลิกของผู้ใช้เท่านั้น สั่งเปิดจากโค้ดล่วงหน้าไม่ได้ */}
          {/* iOS + เปิดใน Safari (ไม่ใช่ PWA) = แจ้งเตือนใช้ไม่ได้ → บอกให้ไปเพิ่มหน้าจอโฮมแทน */}
          {alertAllowed && notifPerm !== "granted" && iosSafariNotStandalone && (
            <div className="w-full rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-300 px-2 py-1.5 text-[11px]">
              📲 บน iPhone: กดปุ่มแชร์ ⬆️ ด้านล่าง → <b>"เพิ่มไปยังหน้าจอโฮม"</b> แล้วเปิดแอปจากไอคอนนั้น แจ้งเตือนถึงจะใช้ได้
            </div>
          )}
          {alertAllowed && notifPerm !== "granted" && !iosSafariNotStandalone && (
            /* เดิมเป็นบล็อกสีส้มทึบ ตัวอักษรขาว 11px — ดังกว่าเนื้อหาที่สำคัญกว่าในหน้า
               และอ่านยาก เปลี่ยนเป็นการ์ดโทนอ่อนตัวอักษรเข้ม แบบเดียวกับกล่องแนะนำ iOS ด้านบน */
            <button
              onClick={askNotifPermission}
              className={`w-full rounded-control border px-2.5 py-2 text-[11px] font-medium text-left leading-relaxed ${
                notifPerm === "denied"
                  ? "border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
              }`}
              title="ต้องอนุญาตครั้งเดียวต่อเครื่อง เพื่อให้แจ้งเตือนเด้งทับแอปอื่นได้"
            >
              {notifPerm === "denied"
                ? "การแจ้งเตือนถูกบล็อกไว้ — แตะเพื่อดูวิธีเปิด (จำเป็นสำหรับเตือนแชทค้าง)"
                : "แตะเพื่อเปิดการแจ้งเตือนแชทค้างอ่าน (ทำครั้งเดียวต่อเครื่อง)"}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-night-border-subtle">
          {listError && list === null ? (
            <div className="p-6 text-center space-y-3">
              <div className="text-sm font-semibold text-rose-400">โหลดแชทไม่สำเร็จ</div>
              <div className="text-xs text-night-ink-2 break-words">{listError}</div>
              <button type="button" onClick={() => loadList()} disabled={loadingList} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50">
                {loadingList ? "กำลังลองใหม่..." : "ลองโหลดใหม่"}
              </button>
            </div>
          ) : list === null ? <div className="p-4"><Spinner label="กำลังโหลด..." /></div>
            : filtered.length === 0 ? (
              // แยกสาเหตุให้ชัด: ค้นหาไม่เจอ / ดูที่บล็อกไว้ / ยังไม่มีแชทเข้ามาเลย
              // เดิมขึ้นแค่ "ไม่มีแชท" ซึ่งอ่านแล้วไม่รู้ว่าต้องทำอะไรต่อ
              <div className="p-6 text-center space-y-1.5">
                <div className="text-[13px] font-medium text-night-ink-2">
                  {q.trim() ? "ไม่พบแชทที่ตรงกับคำค้น" : showBlocked ? "ไม่มีแชทที่บล็อกไว้" : "ยังไม่มีแชทเข้ามา"}
                </div>
                <div className="text-2xs text-night-ink-3 leading-relaxed">
                  {q.trim()
                    ? "ลองพิมพ์ชื่อ เบอร์ หรือประเทศแบบสั้นลง"
                    : showBlocked
                      ? "แชทที่กดบล็อกว่าเป็นสแปมจะมาอยู่ที่นี่"
                      : "แชทจะเด้งเข้ามาเองเมื่อลูกค้าทักเพจที่เชื่อมไว้"}
                </div>
              </div>
            )
              : filtered.map((x) => (
                <button key={x.id} onClick={() => openChat(x)} className={`w-full text-left p-3 hover:bg-night-surface2 flex gap-2.5 ${selected?.id === x.id ? "bg-night-accent/15 chat-item-active" : ""}`}>
                  <div className="relative shrink-0">
                    <div className="w-9 h-9 rounded-full bg-night-surface2 text-night-ink-2 flex items-center justify-center text-sm font-semibold relative overflow-hidden">
                      <span>{initial(x.customer_name)}</span>
                      {x.profile_pic && <img src={x.profile_pic} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                    </div>
                    {x.unread && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 border-2 border-night-surface shadow" />}
                    {showPageBadge && x.page_id && <img src={pagePic(x.page_id)} alt="" title={x.page_name || ""} referrerPolicy="no-referrer" loading="lazy" decoding="async" className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-night-surface bg-night-surface object-cover shadow" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {x.unread && <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />}
                        <span className={`text-sm truncate ${x.unread ? "font-bold text-night-ink" : "font-medium text-night-ink"}`}>{x.customer_name || "(ไม่มีชื่อ)"}</span>
                      </span>
                      <span className="text-[10px] text-night-ink-3 shrink-0">{fmt(x.last_message_at)}</span>
                    </div>
                    {/* ข้อ 3: ถ้าแอดมินตอบทีหลังลูกค้า ให้โชว์ข้อความแอดมินพร้อมชื่อคนตอบ ไม่งั้นโชว์ข้อความลูกค้า */}
                    {(() => {
                      const replyNewer = x.last_reply_at && (!x.last_message_at || new Date(x.last_reply_at).getTime() >= new Date(x.last_message_at).getTime() - 1000) && x.last_reply_text;
                      if (replyNewer) return (
                        <div className="text-xs text-night-ink-2 truncate">
                          <span className="text-emerald-400 font-medium">{x.last_reply_by ? `${x.last_reply_by}: ` : "เพจ: "}</span>
                          {x.last_reply_text}
                        </div>
                      );
                      return <div className="text-xs text-night-ink-2 truncate">{x.last_user_text || "-"}</div>;
                    })()}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {!isCommentChat(x) && x.source !== "line" && (() => {
                        const st = CHAT_STAGES.find((s) => s.key === (x.stage_manual || x.stage || "new")) || CHAT_STAGES[0];
                        return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>;
                      })()}
                      {(showPageBadge || isCommentChat(x)) && x.page_name && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-md bg-night-accent/25 text-night-accent-light max-w-[160px]">
                          <img src={pagePic(x.page_id)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="w-4 h-4 rounded-full object-cover shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          <span className="truncate">{x.page_name}</span>
                        </span>
                      )}
                      {x.country && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">{x.country}</span>}
                      {isCommentChat(x)
                        ? <>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${isInstagramComment(x) ? "bg-fuchsia-500/25 text-fuchsia-400" : "bg-sky-500/25 text-sky-400"}`}>
                              {isInstagramComment(x) ? "◎ IG" : "f Facebook"} · {x.comment_is_ad ? "คอมเมนต์จาก Ads" : "คอมเมนต์จากโพสต์"}
                            </span>
                            {x.comment_is_ad && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 max-w-[180px] truncate" title={x.comment_ad_name || x.entry_ad_id || ""}>
                              {x.comment_ad_name || `Ad ID ${x.entry_ad_id || "-"}`}
                            </span>}
                          </>
                        : x.source === "line"
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#06C755]/15 text-[#009b43] font-semibold">LINE OA</span>
                        : x.source === "instagram"
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/25 text-fuchsia-400 font-semibold">◎ Instagram</span>
                          : (x.entry_ad_id || x.source === "ad") && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">{x.entry_ad_id ? `แอด` : "โฆษณา"}</span>}
                      {Array.isArray(x.tags) && x.tags.map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-night-accent/15 text-night-accent-light">🏷 {t}</span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
        </div>
      </div>

      {/* กลาง: หน้าต่างแชท — มือถือ: fixed เต็มจอแบบ Messenger (header ติดบน / ข้อความเลื่อนกลาง / ช่องพิมพ์ติดล่าง)
          เดสก์ท็อป: inline ในการ์ดปกติ */}
      <div className={`chat-conversation-panel min-w-0 flex-col ${selected
        ? "flex fixed inset-0 z-40 bg-night-surface h-[100dvh] md:static md:z-auto md:h-auto md:inset-auto md:flex-1"
        : "hidden md:flex md:flex-1"}`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-night-ink-3">เลือกลูกค้าเพื่อเริ่มตอบ</div>
        ) : (
            <>
              {/* หัวแชท: back(มือถือ) + รูปลูกค้า + ชื่อ + มาจากแอด(กดขยาย) + แฮมเบอร์เกอร์
                  บนมือถือ (fixed เต็มจอ) เว้น safe-area บน กัน header ทับแถบสถานะ/นาฬิกา */}
              <div className="px-3 py-2.5 border-b border-night-border flex items-center gap-2 shrink-0 bg-night-surface" style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}>
                <button className="chat-mobile-back md:hidden p-1 -ml-1 text-night-ink-2" onClick={() => { setSelected(null); setInfoOpen(false); setStatusMenuOpen(false); }}><ArrowLeft size={20} /></button>
                <div className="w-10 h-10 rounded-full bg-night-accent/25 text-brand-600 flex items-center justify-center text-sm font-semibold shrink-0 relative overflow-hidden">
                  <span>{initial(selected.customer_name)}</span>
                  {selected.profile_pic && <img src={selected.profile_pic} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-night-ink truncate">{selected.customer_name || "(ไม่มีชื่อ)"}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selected.page_name && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-md bg-night-accent/25 text-night-accent-light max-w-[45vw] sm:max-w-[240px]">
                        <img src={pagePic(selected.page_id)} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        <span className="truncate">{selected.page_name}</span>
                      </span>
                    )}
                    <button onClick={() => setInfoOpen((o) => !o)} className="text-[11px] text-night-ink-2 flex items-center gap-1 hover:text-brand-600 shrink-0">
                      มาจาก {adSources.length ? `แอด ${adSources.length} ตัว` : srcLabel(selected)} <ChevronDown size={12} className={infoOpen ? "rotate-180" : ""} />
                    </button>
                  </div>
                </div>
                <button onClick={() => setStatusMenuOpen((o) => !o)} className="chat-mobile-status p-1.5 text-night-ink-2 hover:bg-night-surface2 rounded md:hidden"><Menu size={20} /></button>
              </div>

              {/* แผงรายละเอียดแอด (กดขยายจากหัวแชท) */}
              {infoOpen && (
                <div className="border-b border-night-border p-3 max-h-72 overflow-y-auto bg-night-surface2/60 space-y-2">
                  <div className="text-[11px] text-night-ink-2">ประเทศ: {selected.country || "ไม่ทราบ"} · ภาษา: {selected.cust_lang || "-"} · {selected.source === "line" ? "LINE User ID" : "FB"} {selected.psid || "-"}</div>
                  <div className="text-xs text-night-ink-3">มาจากแอด{adSources.length ? ` (${adSources.length})` : ""}</div>
                  {adLoading && <div className="text-[11px] text-night-ink-3">กำลังโหลดข้อมูลแอด...</div>}
                  {!adLoading && adSources.length === 0 && <div className="text-[11px] text-night-ink-2">{srcLabel(selected)}</div>}
                  {adSources.map(renderAd)}
                </div>
              )}
              {/* แผงปรับสถานะ (แฮมเบอร์เกอร์ — มือถือ) */}
              {/* แผงปรับสถานะ/ใส่ข้อมูลลูกค้า (มือถือ) — เดิมเป็นแผงที่ดันข้อความแชทลง ต้องเลื่อนไปเลื่อนมา
                  เปลี่ยนเป็น bottom sheet ลอยทับแชท ปิดแล้วกลับมาที่ตำแหน่งเดิมทันที ไม่เสียตำแหน่งสกอลล์ */}
              {statusMenuOpen && (
                <div
                  className="md:hidden fixed inset-0 z-50 bg-black/40 flex items-end"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) setStatusMenuOpen(false); }}
                >
                  <div className="w-full bg-night-surface rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
                    <div className="sticky top-0 bg-night-surface flex items-center justify-between px-4 py-3 border-b border-night-border">
                      <span className="font-semibold text-night-ink">ข้อมูล & สถานะลูกค้า</span>
                      <button onClick={() => setStatusMenuOpen(false)} className="text-night-ink-3 hover:text-night-ink p-1" aria-label="ปิด"><X size={20} /></button>
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex gap-2">
                        {selected.unread
                          ? <button onClick={() => setUnread(false)} className="flex-1 text-xs border border-emerald-500/40 text-emerald-400 rounded-lg px-2 py-1.5">ทำเป็นอ่านแล้ว</button>
                          : <button onClick={() => setUnread(true)} className="flex-1 text-xs border border-night-border text-night-ink-2 rounded-lg px-2 py-1.5">ทำเป็นยังไม่อ่าน</button>}
                      </div>
                      {/* บันทึกข้อมูลลูกค้าพื้นฐาน (ไอดีเทรด/username/เบอร์/อีเมล) — ทำได้ทุกเพจ
                          ส่วนเช็คไอดีเทรด + ให้สิทธิ์ TradingView อัตโนมัติ (อยู่ใน CustomerDataForm เอง) ยังทำได้เฉพาะเพจ BeSight
                          TradeIdChecker (เครื่องมือเช็คไอดีแยกต่างหาก) ก็ผูกกับ BeSight เหมือนเดิม */}
                      <CustomerDataForm darkMode row={selected} onSaved={(v) => { setSelected((s) => (s ? { ...s, ...v } : s)); setList((l) => (l || []).map((x) => (x.id === selected.id ? { ...x, ...v } : x))); }} />
                      {isBeSightPage(selected) && <TradeIdChecker darkMode />}
                      <ConversationInsights />
                      <button onClick={() => blockCustomer(selected.id, !selected.blocked_at)} disabled={blocking}
                        className={`w-full text-xs rounded-lg px-2 py-1.5 font-medium flex items-center justify-center gap-1 disabled:opacity-50 ${selected.blocked_at ? "border border-emerald-500/40 text-emerald-400" : "border border-rose-500/40 text-rose-400"}`}>
                        {blocking ? <Loader2 className="animate-spin" size={13} /> : <AlertTriangle size={13} />} {selected.blocked_at ? "ปลดบล็อก" : "บล็อก (สแปม)"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* แบนเนอร์บอกแพลตฟอร์มและว่าเป็นคอมเมนต์จากโพสต์/แอดไหน */}
              {isCommentChat(selected) && (
                <div className={`px-3 py-2 border-b text-[11px] shrink-0 ${isInstagramComment(selected) ? "border-fuchsia-500/40 bg-fuchsia-500/15" : "border-sky-500/40 bg-sky-500/15"}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-white font-semibold ${isInstagramComment(selected) ? "bg-gradient-to-r from-fuchsia-600 to-orange-500" : "bg-sky-600"}`}>
                        {isInstagramComment(selected) ? "◎ IG" : "f Facebook"} · {selected.comment_is_ad ? "คอมเมนต์จาก Ads" : "คอมเมนต์จากโพสต์ปกติ"}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-night-surface border border-sky-500/40 text-sky-300 max-w-full truncate">เพจ: {selected.page_name || selected.page_id}</span>
                      {selected.comment_is_ad && <span className="px-2 py-0.5 rounded-full bg-night-surface border border-purple-500/40 text-purple-300 max-w-full truncate">
                        Ads: {(selected.comment_ad_names?.length ? selected.comment_ad_names.join(", ") : selected.comment_ad_name) || "-"}
                      </span>}
                      {selected.comment_is_ad && <span className="px-2 py-0.5 rounded-full bg-night-surface border border-night-border text-night-ink-2 max-w-full break-all">
                        Ad ID: {(selected.comment_ad_ids?.length ? selected.comment_ad_ids.join(", ") : selected.entry_ad_id) || "-"}
                      </span>}
                    </div>
                  {selected.comment_permalink && (
                    <a href={selected.comment_permalink} target="_blank" rel="noopener noreferrer" className="shrink-0 text-brand-600 hover:text-brand-600 hover:underline inline-flex items-center gap-1 font-medium">
                      {isInstagramComment(selected) ? "Instagram" : "Facebook"} <ArrowUpCircle size={11} className="rotate-45" />
                    </a>
                  )}
                  </div>
                  <div className="mt-2 inline-flex rounded-lg border border-sky-500/40 bg-night-surface px-2.5 py-1 font-semibold text-sky-400">ตอบใต้คอมเมนต์</div>
                </div>
              )}
              {selected.source === "instagram" && (
                <div className="px-3 py-2 border-b border-fuchsia-500/40 bg-fuchsia-500/15 text-[11px] shrink-0 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-fuchsia-600 to-orange-500 text-white font-semibold">◎ Instagram DM</span>
                  <span className="text-fuchsia-300 truncate">บัญชี: {selected.page_name || selected.page_id}</span>
                </div>
              )}
              {selected.source === "line" && (
                <div className="px-3 py-2 border-b border-emerald-500/40 bg-emerald-500/15 text-[11px] shrink-0 flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-[#06C755] text-white font-semibold">LINE OA</span>
                  <span className="text-emerald-300 truncate">บัญชี: {selected.page_name || "LINE Official Account"}</span>
                  <span className="text-amber-400 md:ml-auto">คำตอบจาก LINE OA Manager ไม่ถูกส่งออกทาง API · ตอบจากแอปนี้เพื่อให้ประวัติครบ</span>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-night-surface2/40">
                {selected.transcript === null ? <Spinner label="กำลังโหลดบทสนทนา..." /> : <>{tItems.map((m, i) => (
                  m.w === "p" ? (
                    <div key={i} data-msg-at={m.at || undefined} data-msg-mid={m.mid || undefined} className={`flex flex-col items-end group ${isHl(m) ? "scroll-mt-20" : ""} ${m.pending ? "opacity-60" : ""}`}>
                      <div className="relative max-w-[80%] flex flex-col items-end">
                        {m.reply_to_text && (
                          <button type="button" onClick={() => goToReplyTarget(m)} className="mb-1 w-full max-h-32 overflow-y-auto rounded-xl border border-night-border bg-night-surface px-3 py-2 text-left text-[11px] leading-relaxed text-night-ink-2 hover:border-night-accent/40 focus:outline-none focus:ring-2 focus:ring-brand-500">
                            <span className="mb-1 block font-semibold text-night-accent-light">↩︎ ตอบกลับ · คลิกเพื่อไปยังข้อความต้นทาง</span>
                            <span className="flex items-start gap-2">
                              {m.reply_to_img && <img src={m.reply_to_img} alt="รูปที่ตอบกลับ" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
                              <span className="min-w-0 whitespace-pre-wrap break-words">{m.reply_to_text}</span>
                            </span>
                          </button>
                        )}
                        {m.img
                          ? <button type="button" onClick={() => setLightbox(m.img)} className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-300 cursor-zoom-in" aria-label="ดูรูปขยาย">
                              {(m.sticker || m.t === "[สติกเกอร์]")
                                ? <img src={m.img} alt="สติกเกอร์" className="w-40 max-w-full object-contain" />
                                : <img src={m.img} alt="รูปที่ส่ง" className="max-w-full max-h-60 rounded-2xl object-contain" />}
                            </button>
                          : <>
                            <button type="button" onClick={() => openMessageMenu(i, m, "admin")} className="chat-bubble-me block w-full text-left text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-300">{m.t}</button>
                            {showTh(m) && (
                              <div className="text-[11px] text-night-accent-light mt-0.5 px-1 whitespace-pre-wrap break-words text-right">🇹🇭 {thOf(m) || "กำลังแปล..."}</div>
                            )}
                          </>}
                        {MSG_REPLY_ENABLED && messageMenu?.index === i && messageMenu?.side === "admin" && (
                          <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-night-border bg-night-surface shadow-xl">
                            <button onClick={() => { setReplyTo({ text: messageMenu.text, img: messageMenu.img, mid: messageMenu.mid, at: messageMenu.at, quoteToken: messageMenu.quoteToken, side: "admin" }); setMessageMenu(null); }} className="block w-full px-3 py-2.5 text-left text-xs font-medium text-night-ink hover:bg-night-surface2">↩︎ ตอบกลับข้อความนี้</button>
                          </div>
                        )}
                      </div>
                      {/* ผู้ตอบ: ส่งจากแอปเรารู้อีเมล (m.by) · ตอบจากกล่องข้อความเพจ Meta ไม่ส่งชื่อมา = "ตอบจากเพจ" */}
                      <div className="text-[10px] text-night-ink-3 mt-0.5 pr-1 flex items-center gap-1">
                        <span className="text-emerald-400 font-medium">{m.by || "ตอบจากเพจ"}</span>
                        <span>{fmtMsgTime(m.at)}</span>
                        {m.pending
                          ? <span className="text-amber-500">· กำลังส่ง…</span>
                          : isLastPageMsg(i) && custReadStatus(m) && (
                            <span className={custReadStatus(m).read ? "text-sky-500" : "text-night-ink-3"}>· {custReadStatus(m).label}</span>
                          )}
                      </div>
                    </div>
                  ) : (
                    <div key={i} data-msg-at={m.at || undefined} data-msg-mid={m.mid || undefined} className="flex flex-col items-start group scroll-mt-20">
                      {/* ไฮไลต์ข้อความที่ถูกอ้างถึงจากลิสต์หลักฐาน (ตอบช้า/ยังไม่ตอบ) */}
                      {isHl(m) && (
                        <div className="text-[10px] font-semibold text-amber-400 bg-amber-500/15 rounded-full px-2 py-0.5 mb-1">
                          ⬇ ข้อความนี้คือรอบที่{selected?.awaiting_reply && i === tItems.length - 1 ? "ยังไม่ได้ตอบ" : "ตอบช้า"}
                        </div>
                      )}
                      {/* ที่มาจากสตอรี่ IG — บอกให้แอดมินรู้ว่าลูกค้าทักเพราะเห็นสตอรี่ (ตอบสตอรี่ / แท็กเราในสตอรี่) */}
                      {m.via === "instagram_story" && (
                        <div className="mb-1 flex items-center gap-1.5 rounded-full border border-pink-500/30 bg-pink-500/10 px-2.5 py-1 text-[10.5px] font-semibold text-pink-300">
                          <Instagram size={11} className="shrink-0" />
                          {m.story_kind === "mention" ? "แท็กเราในสตอรี่" : "ตอบจากสตอรี่"}
                          {m.story_url && (
                            <a href={m.story_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-pink-200">ดูสตอรี่</a>
                          )}
                        </div>
                      )}
                      <div className={`relative max-w-[80%] ${isHl(m) ? "ring-2 ring-amber-400 rounded-2xl" : ""}`}>
                        {m.img
                          ? <button type="button" onClick={() => setLightbox(m.img)} className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-zoom-in" aria-label="ดูรูปขยาย">
                              {(m.sticker || m.t === "[สติกเกอร์]")
                                ? <img src={m.img} alt="สติกเกอร์" className="w-40 max-w-full object-contain" />
                                : <img src={m.img} alt="รูปลูกค้า" className="max-w-full max-h-60 rounded-2xl object-contain" />}
                            </button>
                          : <>
                              <button type="button" onClick={() => openMessageMenu(i, m, "customer")} className="block w-full text-left bg-night-surface border border-night-border rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words text-night-ink hover:border-night-accent/40 focus:outline-none focus:ring-2 focus:ring-brand-500">{m.t}</button>
                              {showTh(m) && (
                                <div className="text-[11px] text-emerald-400 mt-0.5 px-1 whitespace-pre-wrap break-words">🇹🇭 {thOf(m) || "กำลังแปล..."}</div>
                              )}
                            </>}
                        {messageMenu?.index === i && messageMenu?.side === "customer" && (
                          <div className="absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-night-border bg-night-surface shadow-xl">
                            {MSG_REPLY_ENABLED && <button onClick={() => { setReplyTo({ text: messageMenu.text, img: messageMenu.img, mid: messageMenu.mid, at: messageMenu.at, quoteToken: messageMenu.quoteToken, side: "customer" }); setMessageMenu(null); }} className="block w-full px-3 py-2.5 text-left text-xs font-medium text-night-ink hover:bg-night-surface2">↩︎ ตอบกลับข้อความนี้</button>}
                            {!m.img && <button onClick={() => beginKnowledgeCapture(m.t)} className="block w-full border-t border-night-border-subtle px-3 py-2.5 text-left text-xs font-medium text-night-accent-light hover:bg-night-accent/15">บันทึกเข้าคลังคำถาม</button>}
                          </div>
                        )}
                      </div>
                      {/* ชิปบันทึกด่วน — โผล่เมื่อข้อความลูกค้าดูเหมือนไอดีเทรด/username TradingView และยังไม่เคยบันทึกค่านี้ */}
                      {!m.img && (() => {
                        const tid = detectTradeIdCandidate(m.t);
                        const tv = detectTvUsernameCandidate(m.t);
                        const chips = [];
                        if (tid && String(selected?.trade_id || "") !== tid) chips.push({ key: `${i}-tid`, field: "trade_id", value: tid, label: `บันทึกเป็นไอดีเทรด: ${tid}` });
                        if (tv && String(selected?.username || "") !== tv) chips.push({ key: `${i}-tv`, field: "username", value: tv, label: `บันทึกเป็น username TV: ${tv}` });
                        if (!chips.length) return null;
                        return (
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {chips.map((c) => {
                              const st = quickFillState[c.key];
                              return (
                                <button
                                  key={c.key}
                                  disabled={st === "saving"}
                                  onClick={() => quickSaveField(c.field, c.value, c.key)}
                                  className={`text-[11px] font-medium rounded-full px-2.5 py-1 border disabled:opacity-60 ${
                                    st === "saved" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                                    : st === "error" ? "border-rose-500/40 bg-rose-500/15 text-rose-400"
                                    : "border-night-accent/40 bg-night-accent/15 text-night-accent-light hover:bg-night-accent/25"
                                  }`}
                                >
                                  {st === "saving" ? "กำลังบันทึก..." : st === "saved" ? `✓ บันทึกแล้ว: ${c.value}` : st === "error" ? "บันทึกไม่สำเร็จ ลองใหม่" : `+ ${c.label}`}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                      <div className="text-[10px] text-night-ink-3 mt-0.5 pl-1">{fmtMsgTime(m.at)}</div>
                    </div>
                  )
                ))}<div ref={bottomRef} /></>}
              </div>
              {sendMsg && <div className="px-4 py-1.5 text-[11px] text-night-ink-2 border-t border-night-border-subtle whitespace-pre-wrap break-words">{sendMsg}</div>}
              {knowledgeCaptureMsg && !knowledgeCapture && <div className="px-4 py-1.5 text-[11px] font-medium text-emerald-400 border-t border-emerald-100 bg-emerald-500/15">{knowledgeCaptureMsg}</div>}
              <div className="p-3 border-t border-night-border relative shrink-0" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
                {selected.source !== "line" && (
                  <div className="chat-compose-guide flex items-center gap-2 mb-2 flex-wrap rounded-xl px-3 py-2">
                    <div className="text-[11px] font-medium">✦ พิมพ์ไทย — ระบบแปลแล้วส่ง <span className="opacity-60">(Ctrl/⌘+Enter = ส่ง)</span></div>
                    <label className="chat-language-control text-[11px] flex items-center gap-1.5 ml-auto rounded-lg px-2 py-1">
                      <span className="font-semibold">🌐 แปลเป็น</span>
                      <select value={forceLang} onChange={(e) => { setForceLang(e.target.value); if (selected) lsSet(`ui.forceLang.${selected.id}`, e.target.value); }}
                        className="rounded-md border-0 px-2 py-1 text-[11px] font-semibold bg-night-surface">
                        {LANG_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                    {forceLang === "auto" && selected.cust_lang && <span className="chat-language-hint rounded-full px-2 py-1 text-[10px] font-medium">อ้างอิงภาษาหัวแชท: {selected.cust_lang}</span>}
                  </div>
                )}
                {savedOpen && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 bg-night-surface border border-night-border rounded-lg shadow-lg max-h-64 overflow-y-auto z-10 divide-y divide-night-border-subtle">
                    {savedReplies.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-night-ink-2">{savedErr ? `ดึงไม่ได้: ${savedErr}` : "เพจนี้ยังไม่มีข้อความตอบกลับที่บันทึกไว้ (หรือ token ยังไม่มีสิทธิ์ pages_messaging)"}</div>
                    ) : savedReplies.map((s) => (
                      <button key={s.id} onClick={() => { if (s.message) setReply((r) => (r ? r + "\n" + s.message : s.message)); if (s.image) setPendingFiles((p) => [...p, { url: s.image, name: "saved-image", type: "image", preview: s.image }]); setSavedOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-night-surface2 flex gap-2">
                        {s.image && <img src={s.image} alt="" className="w-9 h-9 rounded object-cover border border-night-border shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-night-ink truncate">{s.title || "(ไม่มีชื่อ)"}</div>
                          <div className="text-[11px] text-night-ink-2 line-clamp-2 whitespace-pre-wrap break-words">{s.message}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {knowledgeOpen && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 bg-night-surface border border-night-border rounded-xl shadow-xl max-h-80 overflow-hidden z-20 flex flex-col">
                    <div className="p-2 border-b border-night-border-subtle flex gap-2">
                      <input value={knowledgeQuery} onChange={(e) => setKnowledgeQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchKnowledge(); }} placeholder="ค้นหาคำถามหรือคำตอบเก่า..." className="flex-1 rounded-lg border border-night-border px-3 py-2 text-xs" />
                      <button onClick={() => searchKnowledge()} disabled={knowledgeLoading} className="rounded-lg bg-brand-600 text-white px-3 text-xs disabled:opacity-50">{knowledgeLoading ? "ค้นหา..." : "ค้นหา"}</button>
                      <button onClick={() => setKnowledgeOpen(false)} className="text-night-ink-3 px-1"><X size={16} /></button>
                    </div>
                    <div className="overflow-y-auto divide-y divide-night-border-subtle">
                      {knowledgeErr && <div className="p-3 text-xs text-rose-400">{knowledgeErr}</div>}
                      {!knowledgeLoading && !knowledgeErr && knowledgeResults.length === 0 && <div className="p-4 text-xs text-night-ink-3 text-center">ยังไม่พบคำตอบที่อนุมัติแล้ว</div>}
                      {knowledgeResults.map((item) => (
                        <button key={item.id} onClick={() => {
                          setReply((r) => r ? `${r}\n${item.answer}` : item.answer);
                          setKnowledgeOpen(false);
                          supabase.functions.invoke("knowledge-base", { body: { action: "used", page_id: selected.page_id, id: item.id } });
                        }} className="w-full text-left p-3 hover:bg-night-surface2">
                          <div className="text-xs font-medium text-night-ink whitespace-pre-wrap">KW: {item.question}</div>
                          <div className="text-xs text-emerald-400 mt-1 whitespace-pre-wrap">A: {item.answer}</div>
                          <div className="text-[10px] text-night-ink-3 mt-1">เคยใช้ {item.use_count || 0} ครั้ง</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {replyTo && (
                  <div className="flex items-start justify-between gap-2 bg-night-surface2 rounded-lg px-3 py-2 mb-1 text-xs">
                    <div className="min-w-0 flex items-start gap-2">
                      {replyTo.img && <img src={replyTo.img} alt="รูปที่อ้างอิง" className="h-10 w-10 shrink-0 rounded-md object-cover" />}
                      <span className="text-night-ink-2 whitespace-pre-wrap break-words line-clamp-3">↩︎ ตอบกลับ: {String(replyTo.text)}</span>
                    </div>
                    <button onClick={() => setReplyTo(null)} className="text-night-ink-3 hover:text-night-ink shrink-0"><X size={14} /></button>
                  </div>
                )}
                {/* รูป/ไฟล์ที่พักไว้รอส่ง — ลบได้ */}
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pendingFiles.map((pf, idx) => (
                      <div key={idx} className="relative group">
                        {pf.preview
                          ? <img src={pf.preview} alt="" className="w-16 h-16 rounded-lg object-cover border border-night-border" />
                          : <div className="w-16 h-16 rounded-lg border border-night-border bg-night-surface2 flex items-center justify-center text-[9px] text-night-ink-2 text-center p-1 break-all">{pf.name}</div>}
                        <button onClick={() => removePending(idx)} className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center shadow" title="ลบ"><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <div className="flex items-end gap-2 rounded-lg border border-night-border bg-night-surface2 overflow-hidden pr-1.5 py-1.5">
                    <textarea value={reply} onChange={(e) => { setReply(e.target.value); setSendPreview(null); }} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) prepareSendPreview(); }} rows={2} placeholder="พิมพ์คำตอบเป็นไทย..." className="flex-1 bg-transparent border-0 px-3 py-1 text-sm resize-none focus:outline-none" />
                    <button onClick={prepareSendPreview} disabled={sending || (!reply.trim() && pendingFiles.length === 0)} className="bg-night-accent text-white rounded-md px-3.5 py-2 text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5 shrink-0 self-end">
                      {sending ? <Loader2 className="animate-spin" size={15} /> : (!reply.trim() && pendingFiles.length > 0) ? <ArrowUpCircle size={15} /> : <Send size={15} />} {(!reply.trim() && pendingFiles.length > 0) ? "ส่งรูป" : "ส่ง"}
                    </button>
                  </div>
                  {MSG_EMOJI_ENABLED && emojiOpen && (
                    <div className="absolute bottom-full left-0 z-40 mb-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-night-border bg-night-surface shadow-2xl">
                      <React.Suspense fallback={<Spinner label="กำลังโหลดอิโมจิ..." />}>
                        <EmojiPicker theme="dark" emojiStyle="facebook" width="100%" height={390} lazyLoadEmojis searchPlaceHolder="ค้นหาอิโมจิ..." previewConfig={{ showPreview: false }} onEmojiClick={(emojiData) => { setReply((current) => current + emojiData.emoji); setSendPreview(null); }} />
                      </React.Suspense>
                    </div>
                  )}
                </div>
                <div className="chat-tool-row flex flex-wrap items-center gap-1.5 mt-2 relative overflow-visible">
                  {MSG_EMOJI_ENABLED && <button onClick={() => setEmojiOpen((o) => !o)} className={`chat-tool-button chat-tool-emoji ${emojiOpen ? "is-active" : ""}`} title="อิโมจิ (แทรกในข้อความ)"><span className="text-base leading-none">😊</span><span>อีโมจิ</span></button>}
                  <button onClick={() => fileInputRef.current?.click()} disabled={isCommentChat(selected)} className="chat-tool-button chat-tool-attach disabled:opacity-30" title={isCommentChat(selected) ? "การตอบใต้คอมเมนต์ไม่รองรับไฟล์แนบ" : "แนบไฟล์/รูป"}><Paperclip size={16} /><span>แนบไฟล์</span></button>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFile} accept="image/*,video/*,application/pdf" />
                  <button onClick={() => setSavedOpen((o) => !o)} className={`chat-tool-button chat-tool-saved ${savedOpen ? "is-active" : ""}`} title="ข้อความตอบกลับที่บันทึกไว้"><MessageSquare size={16} /><span>ข้อความบันทึก</span><b>{savedReplies.length}</b></button>
                  <button onClick={openKnowledgeSearch} className={`chat-tool-button chat-tool-knowledge ${knowledgeOpen ? "is-active" : ""}`} title="ค้นหาคำตอบเก่าที่อนุมัติแล้ว"><Search size={16} /><span>คลังคำตอบ</span></button>
                  <span className="ml-auto text-[10px] text-night-ink-3 font-mono hidden sm:inline">Ctrl+↵ ส่ง</span>
                </div>
              </div>
              {knowledgeCapture && (
                <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !knowledgeCaptureSaving) setKnowledgeCapture(null); }}>
                  <div className="w-full max-w-xl max-h-[85dvh] overflow-hidden rounded-2xl border border-night-border bg-night-surface shadow-2xl flex flex-col">
                    <div className="flex items-start justify-between gap-3 border-b border-night-border-subtle p-4">
                      <div>
                        <div className="font-semibold text-night-ink">บันทึกเข้าคลังคำถาม</div>
                        <div className="text-xs text-night-ink-2 mt-0.5">เพจ: {selected.page_name || selected.page_id} · ขั้นตอน {knowledgeCapture.step === "question" ? "1/2 กำหนดคำค้น" : "2/2 เลือกคำตอบของแอดมิน"}</div>
                      </div>
                      <button onClick={() => setKnowledgeCapture(null)} disabled={knowledgeCaptureSaving} className="p-1 text-night-ink-3 hover:text-night-ink disabled:opacity-50"><X size={18} /></button>
                    </div>
                    {knowledgeCapture.step === "question" ? (
                      <div className="p-4 space-y-3">
                        <label className="block text-xs text-night-ink-2">คำค้น / Keywords
                          <textarea autoFocus rows={5} value={knowledgeCapture.question} onChange={(e) => setKnowledgeCapture((current) => ({ ...current, question: e.target.value }))} className="mt-1 w-full rounded-xl border border-night-border px-3 py-2 text-sm text-night-ink resize-y" />
                          <span className="mt-1 block text-[10px] text-night-ink-3">ปรับให้เหลือคำหรือวลีสำคัญ เช่น เปิดบัญชีเพิ่ม, เพิ่มบัญชี XM</span>
                        </label>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setKnowledgeCapture(null)} className="rounded-lg border border-night-border px-4 py-2 text-sm text-night-ink-2">ยกเลิก</button>
                          <button onClick={() => setKnowledgeCapture((current) => ({ ...current, step: "answer" }))} disabled={!knowledgeCapture.question.trim()} className="rounded-lg bg-night-accent/15 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">ตกลง เลือกคำตอบ</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="overflow-y-auto p-4 space-y-2">
                          <div className="rounded-lg border border-brand-100 bg-night-accent/15 px-3 py-2 text-xs text-brand-800 whitespace-pre-wrap"><span className="font-semibold">คำค้น:</span> {knowledgeCapture.question}</div>
                          <div className="text-xs font-medium text-night-ink-2 pt-1">เลือกข้อความที่แอดมินตอบเพื่อใช้เป็นคำตอบ</div>
                          {tItems.filter((message) => message.w === "p" && !message.img && String(message.t || "").trim()).length === 0 && <div className="rounded-lg border border-night-border p-4 text-center text-xs text-night-ink-3">ยังไม่มีข้อความคำตอบจากแอดมินในแชทนี้</div>}
                          {tItems
                            .map((message, index) => ({ message, index }))
                            .filter(({ message }) => message.w === "p" && !message.img && String(message.t || "").trim())
                            .reverse()
                            .map(({ message: answerMessage, index: answerIndex }, displayIndex) => (
                              <button key={answerIndex} onClick={() => setKnowledgeCapture((current) => ({ ...current, answer: answerMessage.t, answerIndex }))} className={`w-full rounded-xl border p-3 text-left transition-colors ${knowledgeCapture.answerIndex === answerIndex ? "border-emerald-500 bg-emerald-500/15 ring-1 ring-emerald-400" : "border-night-border hover:border-night-accent/40 hover:bg-night-surface2"}`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="text-sm text-night-ink whitespace-pre-wrap break-words">{answerMessage.t}</div>
                                  {displayIndex === 0 && <span className="shrink-0 rounded-full bg-amber-500/25 px-2 py-0.5 text-[10px] font-semibold text-amber-400">ล่าสุด</span>}
                                </div>
                                <div className="mt-1 text-[10px] text-night-ink-3">{answerMessage.by || "ตอบจากเพจ"} · {fmtMsgTime(answerMessage.at)}</div>
                              </button>
                            ))}
                          {knowledgeCaptureMsg && <div className="text-xs text-rose-400">{knowledgeCaptureMsg}</div>}
                        </div>
                        <div className="flex justify-between gap-2 border-t border-night-border-subtle p-4">
                          <button onClick={() => setKnowledgeCapture((current) => ({ ...current, step: "question" }))} disabled={knowledgeCaptureSaving} className="rounded-lg border border-night-border px-4 py-2 text-sm text-night-ink-2 disabled:opacity-50">ย้อนกลับ</button>
                          <button onClick={saveKnowledgeCapture} disabled={knowledgeCaptureSaving || !knowledgeCapture.answer?.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 flex items-center gap-1.5">
                            {knowledgeCaptureSaving && <Loader2 className="animate-spin" size={15} />} บันทึกเข้าคลัง
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              {sendPreview && (
                <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setSendPreview(null); }}>
                  <div className="w-full max-w-xl rounded-2xl border border-night-border bg-night-surface p-4 shadow-2xl space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-night-ink">ตรวจข้อความก่อนส่ง</div>
                        <div className="text-xs text-night-ink-2">ภาษาที่จะส่ง: {sendPreview.lang || selected.cust_lang || "-"} · แก้ไขข้อความปลายทางได้</div>
                      </div>
                      <button onClick={() => setSendPreview(null)} className="p-1 text-night-ink-3 hover:text-night-ink"><X size={18} /></button>
                    </div>
                    {sendPreview.sourceText && sendPreview.sourceText !== sendPreview.text && (
                      <div className="rounded-lg bg-night-surface2 border border-night-border px-3 py-2 text-xs text-night-ink-2 whitespace-pre-wrap"><span className="font-semibold">ต้นฉบับไทย:</span> {sendPreview.sourceText}</div>
                    )}
                    {sendPreview.replyTo && (
                      <div className="rounded-xl border border-night-accent/40 bg-night-accent/15/80 px-3 py-2.5">
                        <div className="mb-1 text-xs font-semibold text-night-accent-light">↩︎ ข้อความที่ตอบกลับ</div>
                        <div className="flex items-start gap-2">
                          {sendPreview.replyTo.img && <img src={sendPreview.replyTo.img} alt="รูปที่ตอบกลับ" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
                          <div className="max-h-48 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-night-ink">{sendPreview.replyTo.text}</div>
                        </div>
                      </div>
                    )}
                    <textarea value={sendPreview.text} onChange={(e) => setSendPreview((p) => ({ ...p, text: e.target.value }))} rows={6} className="w-full rounded-xl border border-night-border px-3 py-2 text-sm resize-y" autoFocus />
                    {pendingFiles.length > 0 && <div className="text-xs text-night-ink-2">ไฟล์แนบที่รอส่ง: {pendingFiles.length} รายการ</div>}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setSendPreview(null)} className="rounded-lg border border-night-border px-4 py-2 text-sm text-night-ink-2">กลับไปแก้ไข</button>
                      <button onClick={() => sendReply(sendPreview)} disabled={sending || (!sendPreview.text.trim() && pendingFiles.length === 0)} className="ds-btn-primary rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-1.5">
                        {sending ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} อนุมัติและส่ง
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ขวา: ข้อมูล + สถานะ (เดสก์ท็อปเท่านั้น — มือถือใช้แผงขยาย/แฮมเบอร์เกอร์) */}
        {selected && (
          <div className="chat-customer-panel hidden md:block md:w-[280px] xl:w-[320px] border-l border-night-border p-3 space-y-3 shrink-0 overflow-y-auto">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-night-accent/25 text-brand-600 flex items-center justify-center text-lg font-semibold shrink-0 relative overflow-hidden">
                <span>{initial(selected.customer_name)}</span>
                {selected.profile_pic && <img src={selected.profile_pic} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-night-ink-3">ลูกค้า</div>
                <div className="font-medium text-night-ink truncate">{selected.customer_name || "-"}</div>
                <div className="text-[10px] text-night-ink-3 break-all">{selected.source === "line" ? "LINE" : "FB"} {selected.psid || "-"}</div>
              </div>
            </div>
            <div className="text-xs space-y-1.5">
              <div><span className="text-night-ink-3">ประเทศ:</span> <span className="text-night-ink">{selected.country || "ไม่ทราบ"}</span></div>
              <div><span className="text-night-ink-3">ภาษา:</span> <span className="text-night-ink">{selected.cust_lang || "-"}</span></div>
            </div>
            {/* มาจากแอด — โชว์ทุกแอดที่ลูกค้าทักเข้ามา พร้อมรายละเอียด + รูป/วิดีโอ */}
            <div className="space-y-2">
              <div className="text-xs text-night-ink-3">มาจากแอด{adSources.length ? ` (${adSources.length})` : ""}</div>
              {adLoading && <div className="text-[11px] text-night-ink-3">กำลังโหลดข้อมูลแอด...</div>}
              {!adLoading && adSources.length === 0 && <div className="text-[11px] text-night-ink-2">{srcLabel(selected)}</div>}
              {adSources.map((ad) => (
                <div key={ad.ad_id} className="rounded-lg border border-night-border overflow-hidden bg-night-surface2/50">
                  {ad.media_url && (ad.media_type === "video"
                    ? <video src={ad.media_url} poster={ad.thumb_url || undefined} controls className="w-full max-h-40 object-cover bg-black" />
                    : <img src={ad.media_url} alt="" className="w-full max-h-40 object-cover" />)}
                  <div className="p-2 space-y-0.5">
                    {ad.error ? <div className="text-[11px] text-night-ink-3">โหลดรายละเอียดแอดไม่ได้ — แอดอาจถูกลบ หรือไม่มีสิทธิ์เข้าถึงบัญชีโฆษณานี้</div> : (
                      <>
                        <div className="text-[11px] text-night-ink-2">แคมเปญ: <span className="text-night-ink">{ad.campaign_name || "-"}</span></div>
                        <div className="text-[11px] text-night-ink-2">ชุดโฆษณา: <span className="text-night-ink">{ad.adset_name || "-"}</span></div>
                        <div className="text-[11px] text-night-ink-2">โฆษณา: <span className="text-night-ink">{ad.name || "-"}</span></div>
                      </>
                    )}
                    <div className="text-[10px] text-night-ink-3 break-all">ad_id: {ad.ad_id}</div>
                  </div>
                </div>
              ))}
            </div>
            <CustomerDataForm darkMode row={selected} onSaved={(v) => { setSelected((s) => (s ? { ...s, ...v } : s)); setList((l) => (l || []).map((x) => (x.id === selected.id ? { ...x, ...v } : x))); }} />
            {isBeSightPage(selected) && <TradeIdChecker darkMode />}
            <ConversationInsights />
            <button onClick={() => blockCustomer(selected.id, !selected.blocked_at)} disabled={blocking}
              className={`w-full rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 ${selected.blocked_at ? "border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/15" : "border border-rose-500/40 text-rose-400 hover:bg-rose-500/15"}`}>
              {blocking ? <Loader2 className="animate-spin" size={14} /> : <AlertTriangle size={14} />} {selected.blocked_at ? "ปลดบล็อก" : "บล็อก (สแปม)"}
            </button>
          </div>
        )}
      </div>
  );
}
