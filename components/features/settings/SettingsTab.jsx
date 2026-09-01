"use client";

import { useState, useEffect } from "react";
import {
  Sparkles,
  CheckCircle2,
  TrendingUp,
  Settings as SettingsIcon,
  Loader2,
  RefreshCw,
  ImageIcon,
  Wand2,
  Trash2,
  BarChart3,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  MessageSquare,
  Bell,
  Database,
  Search,
  Gamepad2,
  Trophy,
  Tv,
  X,
  Plus,
} from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/utils/activity";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import Spinner from "@/components/shared/Spinner";
import NumInput from "@/components/shared/NumInput";
import { normalizeBrandConfig } from "@/components/features/generate/GenerateTab";
import { SETTINGS_SECTIONS } from "@/lib/constants/settings";
import AdTargetingCard from "@/components/features/settings/AdTargetingCard";
import ChatMenuPanel from "@/components/features/settings/ChatMenuPanel";
import { EmptyState, SectionTitle } from "@/components/ui";
import {
  AiAssistPanel,
  BrandAssetUploader,
  CiStyleUploader,
  MetaTokenPanel,
  LineOAPanel,
  OpenAIKeyPanel,
  PermissionsPanel,
  ActivityPanel,
} from "@/components/features/settings/SettingsPanelsA";
import {
  AiPromptsPanel,
  ChatSyncConfigPanel,
  PageLeadConfigPanel,
  ScheduledJobsPanel,
  ReplyStatsPanel,
} from "@/components/features/settings/SettingsPanelsB";

function GameOfficeSettingsPanel() {
  const [cfg, setCfg] = useState(null);
  const [emailsText, setEmailsText] = useState("");
  const [bg, setBg] = useState("");
  const [sp, setSp] = useState({ url: "", fw: 32, fh: 32, frames: 4, rowDown: 0, rowLeft: 1, rowRight: 2, rowUp: 3, ms: 150, scale: 1.4 });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "game_office").maybeSingle().then(({ data }) => {
      const v = data?.value || { enabled: true, emails: [] };
      setCfg({ enabled: v.enabled !== false });
      setEmailsText((Array.isArray(v.emails) ? v.emails : []).join(", "));
      setBg(v.bg || "");
      if (v.sprite && typeof v.sprite === "object") setSp((s) => ({ ...s, ...v.sprite }));
    });
  }, []);
  const spNum = (k, v) => setSp((s) => ({ ...s, [k]: Number(v) || 0 }));
  async function save() {
    setSaving(true); setMsg("");
    const emails = emailsText.split(/[,\n]/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const { error } = await supabase.from("settings").upsert({ key: "game_office", value: { enabled: cfg.enabled, emails, bg: bg.trim(), sprite: { ...sp, url: sp.url.trim() } }, updated_at: new Date().toISOString() });
    setSaving(false);
    setMsg(error ? "บันทึกไม่สำเร็จ: " + error.message : "บันทึกแล้ว ✓ (ผู้ใช้ต้องรีเฟรชหน้าเพื่อเห็นผล)");
  }
  if (!cfg) return <div className="bg-white rounded-2xl border border-slate-200 p-5"><Spinner label="กำลังโหลด..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Gamepad2 size={16} /> เมนูออฟฟิศจำลอง (Game)</h3>
        <p className="text-xs text-slate-500 mt-0.5">คุมว่าใครจะเห็นแท็บ "ออฟฟิศจำลอง" บ้าง — เป็นฟีเจอร์ทดลอง (beta) แยกจากระบบแชทเดิม ปิดได้โดยไม่กระทบอะไร</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="w-4 h-4" />
        เปิดใช้งานเมนูนี้
      </label>
      <div className={cfg.enabled ? "" : "opacity-40 pointer-events-none"}>
        <label className="text-xs text-slate-600">จำกัดเฉพาะอีเมล (คั่นด้วย , — เว้นว่าง = ทุกคนเห็น)</label>
        <textarea value={emailsText} onChange={(e) => setEmailsText(e.target.value)} rows={2} placeholder="เช่น you@example.com, boss@example.com" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <p className="text-[11px] text-slate-400 mt-1">ใส่เฉพาะอีเมลตัวเอง = ซ่อนจากพนักงานคนอื่น เห็นแค่คุณคนเดียว</p>
      </div>
      <div className={cfg.enabled ? "" : "opacity-40 pointer-events-none"}>
        <label className="text-xs text-slate-600">ลิงก์ภาพฉากหลัง (ไม่บังคับ)</label>
        <input value={bg} onChange={(e) => setBg(e.target.value)} placeholder="https://.../office-pixel.png (เว้นว่าง = ใช้ฉากที่วาดด้วยโค้ด)" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <p className="text-[11px] text-slate-400 mt-1">เจนภาพออฟฟิศ pixel-art แนว AGENT HQ (ขนาดแนวนอน ~940×370) แล้ววางลิงก์ที่นี่ → ตัวละคร sprite จะเดินทับบนภาพ · เว้นว่างไว้จะใช้ฉากที่วาดด้วยโค้ด</p>
      </div>
      {/* ตัวละคร sprite sheet (แบบ Pixel Agents / Metro City) */}
      <div className={"border-t border-slate-200 pt-3 " + (cfg.enabled ? "" : "opacity-40 pointer-events-none")}>
        <div className="text-sm font-medium text-slate-700 mb-1">ตัวละคร (Sprite Sheet)</div>
        <p className="text-[11px] text-slate-400 mb-2">โหลดชุดตัวละคร top-down ฟรี เช่น Metro City (jik-a-4.itch.io/metrocity-free-topdown-character-pack) แล้ววางลิงก์รูป sheet + ปรับค่าเฟรมให้ตรง · เว้นลิงก์ว่าง = ใช้คนวาดด้วยโค้ด</p>
        <label className="text-xs text-slate-600">ลิงก์รูป sprite sheet (.png)</label>
        <input value={sp.url} onChange={(e) => setSp({ ...sp, url: e.target.value })} placeholder="https://.../character.png" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
          <label className="flex flex-col gap-1">กว้าง/เฟรม (px)<input type="number" value={sp.fw} onChange={(e) => spNum("fw", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">สูง/เฟรม (px)<input type="number" value={sp.fh} onChange={(e) => spNum("fh", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">จำนวนเฟรมเดิน<input type="number" value={sp.frames} onChange={(e) => spNum("frames", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">แถวหันลง<input type="number" value={sp.rowDown} onChange={(e) => spNum("rowDown", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">แถวหันซ้าย<input type="number" value={sp.rowLeft} onChange={(e) => spNum("rowLeft", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">แถวหันขวา<input type="number" value={sp.rowRight} onChange={(e) => spNum("rowRight", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">แถวหันขึ้น<input type="number" value={sp.rowUp} onChange={(e) => spNum("rowUp", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">ความเร็ว (ms/เฟรม)<input type="number" value={sp.ms} onChange={(e) => spNum("ms", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="flex flex-col gap-1">ขยาย (scale)<input type="number" step="0.1" value={sp.scale} onChange={(e) => spNum("scale", e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">ค่าเริ่มต้นเดา sheet 4 แถว (ลง/ซ้าย/ขวา/ขึ้น) เฟรมละ 32×32 · ถ้าตัวละครเพี้ยน ปรับตัวเลขให้ตรง sheet ที่โหลดมา แล้วบันทึก+รีเฟรช</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60">{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
        {msg && <span className={`text-xs ${msg.startsWith("บันทึกแล้ว") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ตั้งค่ากระดานแต้ม (แอดมินเท่านั้น) — ใครเห็นบ้าง + เพจไหนที่นับแต้ม
function LeaderboardSettingsPanel() {
  const [cfg, setCfg] = useState(null);
  const [emailsText, setEmailsText] = useState("");
  const [pages, setPages] = useState([]);        // page_id ที่นับ ([] = ทุกเพจ)
  const [pageOpts, setPageOpts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "leaderboard").maybeSingle().then(({ data }) => {
      const v = data?.value || { enabled: true, emails: [], pages: [] };
      setCfg({ enabled: v.enabled !== false });
      setEmailsText((Array.isArray(v.emails) ? v.emails : []).join(", "));
      setPages(Array.isArray(v.pages) ? v.pages.map(String) : []);
    });
    supabase.from("page_lead_config").select("page_id, page_name").order("page_name").then(({ data }) => {
      setPageOpts((data || []).map((p) => ({ id: String(p.page_id), name: p.page_name || p.page_id })));
    });
  }, []);
  const toggle = (id) => setPages((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  async function save() {
    setSaving(true); setMsg("");
    const emails = emailsText.split(/[,\n]/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const { error } = await supabase.from("settings").upsert({ key: "leaderboard", value: { enabled: cfg.enabled, emails, pages }, updated_at: new Date().toISOString() });
    setSaving(false);
    setMsg(error ? "บันทึกไม่สำเร็จ: " + error.message : "บันทึกแล้ว ✓ (ผู้ใช้รีเฟรชหน้าเพื่อเห็นผล)");
  }
  if (!cfg) return <div className="bg-white rounded-2xl border border-slate-200 p-5"><Spinner label="กำลังโหลด..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Trophy size={16} /> กระดานแต้ม (Leaderboard)</h3>
        <p className="text-xs text-slate-500 mt-0.5">คุมว่าใครเห็นเมนู "กระดานแต้ม" และเพจไหนบ้างที่นับแต้ม — ผู้ใช้เลือกเพจเองไม่ได้ ใช้ตามที่ตั้งที่นี่</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="w-4 h-4" />
        เปิดเมนูกระดานแต้ม
      </label>
      <div className={cfg.enabled ? "" : "opacity-40 pointer-events-none"}>
        <label className="text-xs text-slate-600">จำกัดเฉพาะอีเมล (คั่นด้วย , — เว้นว่าง = ทุกคนเห็น)</label>
        <textarea value={emailsText} onChange={(e) => setEmailsText(e.target.value)} rows={2} placeholder="เว้นว่าง = พนักงานทุกคนเห็นได้" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div className={cfg.enabled ? "" : "opacity-40 pointer-events-none"}>
        <label className="text-xs text-slate-600">เพจที่นับแต้ม (ไม่ติ๊ก = ทุกเพจ)</label>
        <div className="mt-1 max-h-52 overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
          {pageOpts.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">ยังไม่มีเพจ</div>}
          {pageOpts.map((p) => (
            <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
              <input type="checkbox" checked={pages.includes(p.id)} onChange={() => toggle(p.id)} className="w-4 h-4" />
              <span className="text-slate-700">{p.name}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">เลือกเฉพาะเพจที่ต้องการให้เข้าแข่ง · เว้นทั้งหมด = นับทุกเพจ</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60">{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
        {msg && <span className={`text-xs ${msg.startsWith("บันทึกแล้ว") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ตั้งค่า "ดึงรีพอร์ตออโต้" — เลือกบัญชี→แคมเปญ→ชุดโฆษณา→โฆษณา + ช่วงเวลา แล้ว cron ดึงมา cache ล่วงหน้า
// เลือกลึกแค่ไหน = ดึงระดับนั้น (ติ๊กแคมเปญ = ระดับแคมเปญ, ติ๊กชุดแต่ไม่ติ๊กโฆษณา = ระดับชุด, ติ๊กโฆษณา = ระดับโฆษณา)
const PREFETCH_RANGES = [["yesterday", "เมื่อวาน"], ["last_3d", "3 วันล่าสุด"], ["last_7d", "7 วันล่าสุด"], ["last_14d", "14 วันล่าสุด"], ["last_30d", "30 วันล่าสุด"], ["maximum", "ทั้งหมด"]];
function InsightsPrefetchPanel() {
  const [cfg, setCfg] = useState({ enabled: false, ranges: [], targets: [] });   // targets: [{account_id,account_name,id,level,name}]
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [accounts, setAccounts] = useState(null);
  const [acct, setAcct] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCamp, setLoadingCamp] = useState(false);
  const [kids, setKids] = useState({});      // parentId -> { loading, nodes: [] }
  const [expanded, setExpanded] = useState({});
  const [custom, setCustom] = useState({ since: "", until: "" });

  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "insights_prefetch").maybeSingle().then(({ data }) => {
      const v = data?.value && typeof data.value === "object" ? data.value : {};
      setCfg({ enabled: v.enabled === true, ranges: Array.isArray(v.ranges) ? v.ranges : [], targets: Array.isArray(v.targets) ? v.targets : [] });
      setLoaded(true);
    });
    supabase.functions.invoke("list-ad-accounts", { body: {} }).then(({ data }) => setAccounts(data?.accounts || []));
  }, []);

  async function loadCampaigns(id) {
    setAcct(id); setCampaigns([]); setExpanded({}); setKids({});
    if (!id) return;
    setLoadingCamp(true);
    const { data } = await supabase.functions.invoke("list-campaigns", { body: { ad_account_id: id } });
    setLoadingCamp(false);
    setCampaigns((data?.campaigns || []).slice().sort((a, b) => (b.effective_status === "ACTIVE" ? 1 : 0) - (a.effective_status === "ACTIVE" ? 1 : 0)));
  }
  async function loadKids(parentId, level) {
    if (kids[parentId]) { setExpanded((e) => ({ ...e, [parentId]: !e[parentId] })); return; }
    setKids((k) => ({ ...k, [parentId]: { loading: true, nodes: [] } }));
    setExpanded((e) => ({ ...e, [parentId]: true }));
    const { data } = await supabase.functions.invoke("list-children", { body: { parent_id: parentId, level } });
    setKids((k) => ({ ...k, [parentId]: { loading: false, nodes: data?.nodes || [] } }));
  }

  const acctName = (accounts || []).find((a) => String(a.account_id) === String(acct))?.name || acct;
  const isPicked = (id) => cfg.targets.some((t) => String(t.id) === String(id));
  // ติ๊ก/ปลด node — ลูก/แม่ในสายเดียวกันเป็น exclusive (ติ๊กลูก = เอาแม่ออก, ติ๊กแม่ = เอาลูกออก)
  function togglePick(node, ancestorIds, descendantIds) {
    setCfg((c) => {
      if (c.targets.some((t) => String(t.id) === String(node.id))) return { ...c, targets: c.targets.filter((t) => String(t.id) !== String(node.id)) };
      const drop = new Set([...(ancestorIds || []), ...(descendantIds || [])].map(String));
      const kept = c.targets.filter((t) => !drop.has(String(t.id)));
      return { ...c, targets: [...kept, { account_id: acct, account_name: acctName, id: String(node.id), level: node.level, name: node.name }] };
    });
  }
  function pickAll(nodes, level, parentAncestors) {
    setCfg((c) => {
      const ids = new Set(nodes.map((n) => String(n.id)));
      const dropAnc = new Set((parentAncestors || []).map(String));
      const kept = c.targets.filter((t) => !ids.has(String(t.id)) && !dropAnc.has(String(t.id)));
      const add = nodes.map((n) => ({ account_id: acct, account_name: acctName, id: String(n.id), level, name: n.name }));
      return { ...c, targets: [...kept, ...add] };
    });
  }
  const toggleRange = (r) => setCfg((c) => ({ ...c, ranges: c.ranges.some((x) => JSON.stringify(x) === JSON.stringify(r)) ? c.ranges.filter((x) => JSON.stringify(x) !== JSON.stringify(r)) : [...c.ranges, r] }));
  const rangeLabel = (r) => typeof r === "string" ? (PREFETCH_RANGES.find(([k]) => k === r)?.[1] || r) : `${r.since}–${r.until}`;

  async function save() {
    setSaving(true); setMsg("");
    const { error } = await supabase.from("settings").upsert({ key: "insights_prefetch", value: cfg, updated_at: new Date().toISOString() });
    setSaving(false);
    setMsg(error ? "บันทึกไม่สำเร็จ: " + error.message : "บันทึกแล้ว ✓ — cron จะดึงตามที่เลือก (ตี 1 + ทยอยเช็ค rate)");
  }

  if (!loaded) return <div className="bg-white rounded-2xl border border-slate-200 p-5"><Spinner label="กำลังโหลด..." /></div>;
  const statusBadge = (st) => <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{st}</span>;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 max-w-3xl">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><BarChart3 size={16} /> ดึงรีพอร์ตออโต้ (cache)</h3>
        <p className="text-xs text-slate-500 mt-0.5">เลือกบัญชี/แคมเปญ/ชุด/โฆษณา + ช่วงเวลา แล้วระบบจะดึงมา cache ล่วงหน้า (ตี 1 ทุกวัน · ทยอยดึง + เช็ค rate limit) เปิดดูจะเร็วและไม่ยิง Meta ซ้ำ</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} className="w-4 h-4" />
        เปิดดึงรีพอร์ตออโต้
      </label>

      {cfg.enabled && (
        <div className="space-y-4">
          {/* ช่วงเวลา */}
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">ช่วงเวลาที่จะดึง (เลือกได้หลายอัน)</div>
            <div className="flex flex-wrap gap-1.5">
              {PREFETCH_RANGES.map(([k, l]) => (
                <button key={k} onClick={() => toggleRange(k)} className={`text-xs rounded-full px-2.5 py-1 border ${cfg.ranges.includes(k) ? "bg-brand-600 text-white border-brand-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{l}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-xs flex-wrap">
              <span className="text-slate-400">กำหนดเอง:</span>
              <input type="date" value={custom.since} onChange={(e) => setCustom((s) => ({ ...s, since: e.target.value }))} className="rounded-lg border border-slate-300 px-1.5 py-1" />
              <span>–</span>
              <input type="date" value={custom.until} onChange={(e) => setCustom((s) => ({ ...s, until: e.target.value }))} className="rounded-lg border border-slate-300 px-1.5 py-1" />
              <button disabled={!custom.since || !custom.until} onClick={() => { toggleRange({ since: custom.since, until: custom.until }); setCustom({ since: "", until: "" }); }} className="rounded-lg bg-brand-600 text-white px-2.5 py-1 disabled:opacity-40">+ เพิ่มช่วง</button>
            </div>
            {cfg.ranges.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {cfg.ranges.map((r, i) => <span key={i} className="inline-flex items-center gap-1 bg-slate-100 rounded-full px-2 py-0.5 text-[11px] text-slate-700">{rangeLabel(r)}<button onClick={() => toggleRange(r)} className="text-slate-400 hover:text-rose-600">✕</button></span>)}
              </div>
            )}
          </div>

          {/* บัญชี → แคมเปญ → ชุด → โฆษณา */}
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">เลือกบัญชีโฆษณา</div>
            <select value={acct} onChange={(e) => loadCampaigns(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">— เลือกบัญชี —</option>
              {(accounts || []).map((a) => <option key={a.account_id} value={a.account_id}>{a.name} ({a.account_id})</option>)}
            </select>
          </div>

          {loadingCamp && <Spinner label="กำลังโหลดแคมเปญ..." />}
          {!loadingCamp && acct && campaigns.length > 0 && (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-96 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 text-[11px] text-slate-500">
                <span>แคมเปญ · ติ๊ก = ดึงระดับแคมเปญ · กดลูกศรเพื่อเลือกลึกลงไป</span>
                <button onClick={() => pickAll(campaigns.map((c) => ({ id: c.id, name: c.name })), "campaign")} className="text-brand-600 hover:underline">เลือกทุกแคมเปญ</button>
              </div>
              {campaigns.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center gap-2 px-3 py-2 text-sm">
                    <input type="checkbox" checked={isPicked(c.id)} onChange={() => togglePick({ id: c.id, name: c.name, level: "campaign" }, [], (kids[c.id]?.nodes || []).map((s) => s.id))} className="w-4 h-4" />
                    <button onClick={() => loadKids(c.id, "adsets")} className="text-slate-400 hover:text-slate-700">{expanded[c.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                    <span className="flex-1 min-w-0 truncate text-slate-700">{c.name}</span>
                    {statusBadge(c.effective_status)}
                  </div>
                  {expanded[c.id] && (
                    <div className="pl-8 pr-2 pb-1">
                      {kids[c.id]?.loading ? <div className="text-[11px] text-slate-400 py-1">กำลังโหลดชุดโฆษณา...</div> : (kids[c.id]?.nodes || []).length === 0 ? <div className="text-[11px] text-slate-400 py-1">ไม่มีชุดโฆษณา</div> : (
                        <>
                          <button onClick={() => pickAll((kids[c.id].nodes).map((s) => ({ id: s.id, name: s.name })), "adset", [c.id])} className="text-[11px] text-brand-600 hover:underline">เลือกทุกชุดในแคมเปญนี้</button>
                          {(kids[c.id].nodes).map((s) => (
                            <div key={s.id}>
                              <div className="flex items-center gap-2 py-1 text-sm">
                                <input type="checkbox" checked={isPicked(s.id)} onChange={() => togglePick({ id: s.id, name: s.name, level: "adset" }, [c.id], (kids[s.id]?.nodes || []).map((a) => a.id))} className="w-4 h-4" />
                                <button onClick={() => loadKids(s.id, "ads")} className="text-slate-400 hover:text-slate-700">{expanded[s.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
                                <span className="flex-1 min-w-0 truncate text-slate-600">{s.name}</span>
                                {statusBadge(s.effective_status)}
                              </div>
                              {expanded[s.id] && (
                                <div className="pl-7 pb-1">
                                  {kids[s.id]?.loading ? <div className="text-[11px] text-slate-400 py-1">กำลังโหลดโฆษณา...</div> : (kids[s.id]?.nodes || []).length === 0 ? <div className="text-[11px] text-slate-400 py-1">ไม่มีโฆษณา</div> : (
                                    <>
                                      <button onClick={() => pickAll((kids[s.id].nodes).map((a) => ({ id: a.id, name: a.name })), "ad", [c.id, s.id])} className="text-[11px] text-brand-600 hover:underline">เลือกทุกโฆษณาในชุดนี้</button>
                                      {(kids[s.id].nodes).map((a) => (
                                        <div key={a.id} className="flex items-center gap-2 py-0.5 text-sm">
                                          <input type="checkbox" checked={isPicked(a.id)} onChange={() => togglePick({ id: a.id, name: a.name, level: "ad" }, [c.id, s.id], [])} className="w-4 h-4" />
                                          <span className="flex-1 min-w-0 truncate text-slate-500">{a.name}</span>
                                          {statusBadge(a.effective_status)}
                                        </div>
                                      ))}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* รายการที่เลือกไว้ (ทุกบัญชี) */}
          {cfg.targets.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">ที่เลือกไว้ ({cfg.targets.length})</div>
              <div className="flex flex-wrap gap-1">
                {cfg.targets.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 bg-slate-100 rounded-full px-2 py-0.5 text-[11px] text-slate-700">
                    <span className="text-slate-400">{t.level === "campaign" ? "แคมเปญ" : t.level === "adset" ? "ชุด" : "โฆษณา"}:</span> {t.name || t.id}
                    <button onClick={() => setCfg((c) => ({ ...c, targets: c.targets.filter((x) => x.id !== t.id) }))} className="text-slate-400 hover:text-rose-600">✕</button>
                  </span>
                ))}
                <button onClick={() => setCfg((c) => ({ ...c, targets: [] }))} className="text-[11px] text-slate-400 hover:text-rose-600 px-1">ล้างทั้งหมด</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <button onClick={save} disabled={saving} className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60">{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
        {cfg.enabled && cfg.targets.length > 0 && (
          <button onClick={async () => { setMsg("กำลังเริ่มดึง..."); await save(); const { data } = await supabase.functions.invoke("prefetch-insights", { body: { seed: true } }); setMsg(data?.ok ? `เริ่มดึงแล้ว ✓ (คิว ${data.remaining ?? "-"} งาน · ทยอยดึงทุก 15 นาที)` : "เริ่มดึงไม่สำเร็จ — อาจยังไม่ได้ deploy prefetch-insights"); }} className="border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-50">เริ่มดึงตอนนี้</button>
        )}
        {msg && <span className={`text-xs ${msg.startsWith("บันทึกแล้ว") || msg.startsWith("เริ่มดึงแล้ว") ? "text-emerald-600" : "text-slate-500"}`}>{msg}</span>}
      </div>
    </div>
  );
}

// พาเนลตั้งค่า "แจ้งเตือน (Push)" — เปิด/ต่ออายุ, ทดสอบส่ง, ตรวจระบบ (ครบในตัว ไม่ผูกกับหน้าแชท)
function PushNotificationPanel() {
  const [perm, setPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "unsupported"));
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [diag, setDiag] = useState(null);
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = (typeof navigator !== "undefined" && navigator.standalone === true) || (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)")?.matches);
  const iosNeedsInstall = isIos && !standalone;

  // subscribe เครื่องนี้ — ขอบเขต push ตาม "เพจที่เลือกดูในหน้าตอบแชท" (settings.inbox_page_filter) ให้ตรงกัน
  // + ส่ง config ให้ SW ต่ออายุเองตอนปิดแอป
  async function subscribeDevice() {
    if (location.protocol !== "https:") throw new Error("ต้องเปิดผ่าน https");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("เบราว์เซอร์นี้ไม่รองรับ Push (iPhone ต้องเพิ่มเป็นแอปหน้าจอโฮมก่อน)");
    const reg = await navigator.serviceWorker.ready;
    const { data: vk } = await supabase.functions.invoke("send-push", { body: { action: "vapid_public" } });
    if (!vk?.ok || !vk.key) throw new Error("backend ยังไม่มี VAPID key (ตั้ง secret + deploy send-push แล้วหรือยัง)");
    const b64 = vk.key.replace(/-/g, "+").replace(/_/g, "/").padEnd(vk.key.length + (4 - (vk.key.length % 4)) % 4, "=");
    const appKey = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    try { reg.active?.postMessage({ type: "push-config", url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, vapidKey: vk.key }); } catch { /* ไม่กระทบ */ }
    // อ่านเพจที่เลือกไว้ (คีย์ผูกอีเมล) เพื่อให้ push เด้งเฉพาะเพจที่เลือก ไม่ใช่ทุกเพจ
    const { data: u } = await supabase.auth.getUser();
    const email = u?.user?.email;
    let scope = [];
    let ps = null;
    if (email) {
      let { data: s } = await supabase.from("settings").select("value").eq("key", `inbox_page_filter:${email}`).maybeSingle();
      if (!s?.value) ({ data: s } = await supabase.from("settings").select("value").eq("key", "inbox_page_filter").maybeSingle());
      ps = s?.value || null;
    }
    if (ps) scope = ps.mode === "single" ? (ps.single ? [ps.single] : []) : (Array.isArray(ps.multi) ? ps.multi : []);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    const { data: sr, error: se } = await supabase.functions.invoke("send-push", { body: { action: "subscribe", subscription: sub.toJSON(), pages: scope, notify_new: true, device_id: getDeviceId() } });
    if (se || !sr?.ok) throw new Error("บันทึก subscription ไม่สำเร็จ: " + (sr?.error || (se ? await readFunctionErrorMessage(se) : "")));
  }

  async function enable() {
    setBusy("enable"); setMsg("");
    try {
      if (typeof Notification === "undefined") throw new Error("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน");
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") { setMsg(p === "denied" ? "🚫 ถูกบล็อกไว้ — เปิดสิทธิ์แจ้งเตือนของเว็บนี้ในตั้งค่าเครื่อง/เบราว์เซอร์ก่อน" : "ยังไม่ได้อนุญาต"); return; }
      await subscribeDevice();
      setMsg("✓ เปิด/ต่ออายุแล้ว — จะเด้งตามเพจที่เลือกในหน้าตอบแชท แม้ปิดแอป");
    } catch (e) { setMsg("✗ " + (e?.message || e)); }
    finally { setBusy(""); }
  }

  async function test() {
    setBusy("test"); setMsg("");
    try {
      await subscribeDevice();
      const { data, error } = await supabase.functions.invoke("send-push", { body: { action: "test" } });
      if (error) { setMsg("✗ เรียกฟังก์ชันไม่ได้: " + (await readFunctionErrorMessage(error))); return; }
      if (!data?.ok) { setMsg("✗ " + (data?.error || (data?.errors?.[0]) || "ส่งไม่สำเร็จ")); return; }
      setMsg(`✓ ส่งทดสอบแล้ว ${data.sent}/${data.total ?? data.sent} เครื่อง — ลองล็อกจอ/ปิดแอป ควรเห็นเด้ง`);
    } catch (e) { setMsg("✗ " + (e?.message || e)); }
    finally { setBusy(""); }
  }

  async function runDiag() {
    setBusy("diag"); setDiag("loading"); setMsg("");
    const { data, error } = await supabase.functions.invoke("send-push", { body: { action: "diag" } });
    setBusy("");
    if (error || !data?.ok) { setDiag(null); setMsg("✗ ตรวจไม่สำเร็จ: " + (data?.error || (error ? await readFunctionErrorMessage(error) : "ต้องเป็นแอดมิน"))); return; }
    setDiag(data);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 max-w-xl">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Bell size={18} /> แจ้งเตือนข้อความใหม่ (Push)</h3>
        <p className="text-xs text-slate-500 mt-1">เด้งเตือนแม้ปิดแอป · ตามเพจที่เลือกในหน้าตอบแชท · ต้องเปิด/ต่ออายุ 1 ครั้งต่อเครื่อง</p>
      </div>

      {iosNeedsInstall && (
        <div className="rounded-lg bg-sky-50 border border-sky-200 text-sky-800 px-3 py-2 text-xs">
          📲 บน iPhone: กดปุ่มแชร์ ⬆️ → <b>"เพิ่มไปยังหน้าจอโฮม"</b> แล้วเปิดแอปจากไอคอนนั้น การแจ้งเตือนตอนปิดแอปถึงจะทำงาน
        </div>
      )}

      <div className="text-xs text-slate-600">
        สถานะสิทธิ์แจ้งเตือนบนเครื่องนี้: <b className={perm === "granted" ? "text-emerald-600" : perm === "denied" ? "text-rose-600" : "text-amber-600"}>
          {perm === "granted" ? "อนุญาตแล้ว" : perm === "denied" ? "ถูกบล็อก" : "ยังไม่อนุญาต"}</b>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={enable} disabled={!!busy}
          className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
          {busy === "enable" ? "กำลังทำ..." : perm === "granted" ? "🔔 ต่ออายุการแจ้งเตือน" : "🔔 เปิดการแจ้งเตือน"}
        </button>
        <button onClick={test} disabled={!!busy || perm !== "granted"}
          className="rounded-lg bg-slate-100 text-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">
          {busy === "test" ? "กำลังส่ง..." : "ทดสอบส่ง"}
        </button>
        <button onClick={runDiag} disabled={!!busy}
          className="rounded-lg bg-slate-100 text-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">
          {busy === "diag" ? "กำลังตรวจ..." : "ตรวจระบบ"}
        </button>
      </div>

      {msg && <div className="text-xs text-slate-600 whitespace-pre-wrap">{msg}</div>}

      {diag && diag !== "loading" && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1">
          <div className="font-semibold text-slate-700">ผลตรวจระบบ</div>
          <div>VAPID (คีย์ฝั่ง server): {diag.vapid_ok ? "✓ ตั้งค่าแล้ว" : "✗ ยังไม่ตั้ง — ตั้ง secret VAPID + deploy send-push"}</div>
          <div>subscription ของเมลคุณ: <b>{diag.subscriptions_mine}</b> เครื่อง · ทั้งระบบ: {diag.subscriptions_all} เครื่อง</div>
          <div>แชทค้างอ่านตอนนี้: {diag.unread_total} (เกินเวลา {diag.alertMin} นาที: {diag.overdue_now})</div>
          {diag.latest_chat && <div>ข้อความล่าสุดเข้าระบบ: {new Date(diag.latest_chat.updated_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>}
          {diag.subscriptions_mine === 0 && <div className="text-rose-600">⚠️ ยังไม่มี subscription ของเครื่องนี้ — กด "เปิด/ต่ออายุการแจ้งเตือน" ด้านบน</div>}
        </div>
      )}
    </div>
  );
}

// ตั้งค่า TV (เฉพาะแอดมิน) — จัดการแบรนด์ (คุกกี้/เพจ/โชว์), สคริปต์ต่อแบรนด์, n8n, ปล่อยอัปเดต
function TvAdminSettingsPanel() {
  const [msg, setMsg] = useState("");
  const [scripts, setScripts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [pages, setPages] = useState([]);           // เพจแชททั้งหมด (page_lead_config)
  const [checkingId, setCheckingId] = useState(null);
  const [whOpen, setWhOpen] = useState(false);
  const [whUrl, setWhUrl] = useState("");
  const [whSecret, setWhSecret] = useState("");
  const [whSaving, setWhSaving] = useState(false);
  const [released, setReleased] = useState(null);
  const [relSaving, setRelSaving] = useState(false);
  const [be, setBe] = useState(null);               // แบรนด์ที่กำลังแก้ { id?, name, sessionid, sign, tv_base, pages, show_in_manager }
  const [beSaving, setBeSaving] = useState(false);

  async function loadScripts() { const { data } = await supabase.from("tv_scripts").select("*").order("created_at"); setScripts(data || []); }
  async function loadBrands() { const { data } = await supabase.functions.invoke("tradingview", { body: { action: "list_brands" } }); setBrands(data?.brands || []); }
  async function loadPages() { const { data } = await supabase.from("page_lead_config").select("page_id, page_name").order("page_name"); setPages((data || []).map((p) => ({ id: String(p.page_id), name: p.page_name || p.page_id }))); }
  async function loadReleased() { const { data } = await supabase.from("settings").select("value").eq("key", "tv_features").maybeSingle(); setReleased(data?.value?.released === true); }
  useEffect(() => { loadScripts(); loadBrands(); loadPages(); loadReleased(); }, []);

  async function toggleReleased() {
    const next = !released;
    if (!confirm(next ? "ปล่อยฟีเจอร์ TV ใหม่ให้ผู้ใช้ทุกคนเห็น?" : "ซ่อนฟีเจอร์ TV ใหม่กลับไปให้เห็นเฉพาะแอดมิน?")) return;
    setRelSaving(true);
    const { error } = await supabase.from("settings").upsert({ key: "tv_features", value: { released: next }, updated_at: new Date().toISOString() });
    setRelSaving(false);
    if (error) { setMsg("✗ บันทึกไม่สำเร็จ: " + error.message); return; }
    setReleased(next);
    setMsg(next ? "✓ ปล่อยอัปเดตให้ผู้ใช้ทุกคนแล้ว" : "✓ ซ่อนไว้ให้เห็นเฉพาะแอดมินแล้ว");
  }
  async function openWebhook() {
    setWhOpen(true); setWhSecret("");
    const { data } = await supabase.functions.invoke("tradingview", { body: { action: "get_webhook" } });
    if (data?.ok) setWhUrl(data.url || "");
  }
  async function saveWebhook() {
    const url = whUrl.trim();
    if (!url) { setMsg("ใส่ n8n Webhook URL ก่อน"); return; }
    setWhSaving(true);
    const bodyReq = { action: "set_webhook", url };
    if (whSecret.trim()) bodyReq.secret = whSecret.trim();
    const { data, error } = await supabase.functions.invoke("tradingview", { body: bodyReq });
    setWhSaving(false);
    if (error || !data?.ok) { setMsg("✗ บันทึกไม่สำเร็จ: " + (data?.error || "")); return; }
    setWhOpen(false); setMsg("✓ บันทึก n8n Webhook แล้ว");
  }
  async function checkBrand(b) {
    setCheckingId(b.id);
    setMsg(`กำลังตรวจคุกกี้ของ "${b.name}"...`);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "webhook_status", brand_id: b.id } });
    setCheckingId(null);
    if (error || !data?.ok) { setMsg("✗ ตรวจไม่สำเร็จ: " + (data?.error || "")); return; }
    if (!data.reachable) { setMsg(`✗ [${b.name}] ต่อ n8n ไม่ได้: ` + (data.error || "เช็ค URL/workflow active")); return; }
    setMsg(data.authed
      ? `✓ [${b.name}] TradingView ล็อกอินอยู่ — พร้อมให้สิทธิ์`
      : `⚠️ [${b.name}] ต่อ n8n ได้ แต่ TradingView ยังไม่ล็อกอิน (คุกกี้หมดอายุ?)\nHTTP ${data.status_code ?? "?"} · sid ${data.sid_len ?? "?"} · sign ${data.sign_len ?? "?"}\nTV: ${(data.sample || "").slice(0, 140)}`);
  }
  function newBrand() { setBe({ name: "", sessionid: "", sign: "", tv_base: "", pages: [], show_in_manager: true }); }
  function editBrand(b) { setBe({ id: b.id, name: b.name, sessionid: "", sign: "", tv_base: b.tv_base || "", pages: (b.pages || []).map(String), show_in_manager: b.show_in_manager !== false, has_cookie: b.has_cookie, ingest_token: b.ingest_token || "" }); }
  const ingestUrl = (SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/tradingview";
  async function saveBrand() {
    if (!be?.name.trim()) { setMsg("ใส่ชื่อแบรนด์ก่อน"); return; }
    setBeSaving(true);
    const bodyReq = { action: "save_brand", id: be.id, name: be.name.trim(), tv_base: be.tv_base.trim(), pages: be.pages, show_in_manager: be.show_in_manager };
    if (be.sessionid.trim()) { bodyReq.sessionid = be.sessionid.trim(); bodyReq.sign = be.sign.trim(); }
    const { data, error } = await supabase.functions.invoke("tradingview", { body: bodyReq });
    setBeSaving(false);
    if (error || !data?.ok) { setMsg("✗ บันทึกแบรนด์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setBe(null); setMsg("✓ บันทึกแบรนด์แล้ว"); loadBrands();
  }
  async function deleteBrand(b) {
    if (!confirm(`ลบแบรนด์ "${b.name}"?\n(ต้องไม่มีสคริปต์เหลือในแบรนด์นี้)`)) return;
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "delete_brand", id: b.id } });
    if (error || !data?.ok) { setMsg("✗ ลบแบรนด์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setMsg("✓ ลบแบรนด์แล้ว"); loadBrands();
  }
  async function addScript(brandId) {
    const pine_id = prompt("Pine ID (เช่น PUB;xxxxxxxxxxxx)"); if (!pine_id) return;
    const name = prompt("ชื่อสคริปต์ที่จะแสดง"); if (!name) return;
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "add_script", pine_id: pine_id.trim(), name: name.trim(), brand_id: brandId } });
    if (error || !data?.ok) { setMsg("✗ เพิ่มสคริปต์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setMsg("✓ เพิ่มสคริปต์แล้ว"); loadScripts();
  }
  async function deleteScript(s) {
    if (!confirm(`ลบสคริปต์ "${s.name}"?\n(ลบเฉพาะในแอป ไม่ถอนสิทธิ์บน TradingView — สมาชิกในสคริปต์นี้จะหายจากลิสต์ด้วย)`)) return;
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "delete_script", pine_id: s.pine_id } });
    if (error || !data?.ok) { setMsg("✗ ลบสคริปต์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setMsg("✓ ลบสคริปต์แล้ว"); loadScripts();
  }
  const pageName = (id) => pages.find((p) => p.id === String(id))?.name || id;

  return (
    <div className="space-y-4">
      {/* modal ตั้งค่า n8n webhook (global) */}
      {whOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => setWhOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">ตั้งค่า n8n Webhook (ใช้ร่วมทุกแบรนด์)</h3>
              <button onClick={() => setWhOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <p className="text-xs text-slate-500">n8n เป็นตัวยิง TradingView (ส่ง cookie ได้) — ใช้ workflow เดียวทุกแบรนด์ เพราะแอปส่งคุกกี้ของแต่ละแบรนด์ไปให้เอง</p>
            <div>
              <label className="text-xs text-slate-500">n8n Webhook URL</label>
              <input value={whUrl} onChange={(e) => setWhUrl(e.target.value)} placeholder="https://your-n8n/webhook/tv-access" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Secret (เว้นว่าง = ไม่เปลี่ยนของเดิม)</label>
              <input value={whSecret} onChange={(e) => setWhSecret(e.target.value)} placeholder="ต้องตรงกับ secret ใน node Config ของ n8n" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setWhOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">ยกเลิก</button>
              <button onClick={saveWebhook} disabled={whSaving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">{whSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}

      {/* modal เพิ่ม/แก้แบรนด์ */}
      {be && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => setBe(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">{be.id ? "แก้ไขแบรนด์" : "เพิ่มแบรนด์ TradingView"}</h3>
              <button onClick={() => setBe(null)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div>
              <label className="text-xs text-slate-500">ชื่อแบรนด์</label>
              <input value={be.name} onChange={(e) => setBe({ ...be, name: e.target.value })} placeholder="เช่น BeSight / Brand B" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500">TradingView sessionid {be.has_cookie && <span className="text-emerald-600">· มีคุกกี้แล้ว (เว้นว่าง = ไม่เปลี่ยน)</span>}</label>
              <input value={be.sessionid} onChange={(e) => setBe({ ...be, sessionid: e.target.value })} placeholder="คุกกี้ sessionid" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-500">sessionid_sign</label>
              <input value={be.sign} onChange={(e) => setBe({ ...be, sign: e.target.value })} placeholder="คุกกี้ sessionid_sign" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-500">TradingView base URL (เว้นว่าง = ค่าเริ่มต้น)</label>
              <input value={be.tv_base} onChange={(e) => setBe({ ...be, tv_base: e.target.value })} placeholder="https://www.tradingview.com" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-500">เพจแชทที่ให้โชว์ฟอร์มเพิ่ม TV ของแบรนด์นี้</label>
              <div className="mt-1 rounded-lg border border-slate-300 divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {pages.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">ยังไม่มีเพจ</div>}
                {pages.map((p) => {
                  const on = be.pages.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={on} onChange={() => setBe({ ...be, pages: on ? be.pages.filter((x) => x !== p.id) : [...be.pages, p.id] })} />
                      <span className="truncate">{p.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={be.show_in_manager} onChange={(e) => setBe({ ...be, show_in_manager: e.target.checked })} /> โชว์ในหน้าจัดการสมาชิก TV
            </label>
            {be.id && be.ingest_token && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-600">รับคุกกี้อัตโนมัติจาก Chrome extension</div>
                <div className="text-[11px] text-slate-400">ตั้งค่า extension ให้ยิง POST มาที่ URL นี้ พร้อม token ของแบรนด์ (body: {`{action:"ingest_cookie", token, sessionid, sessionid_sign}`})</div>
                <div><span className="text-[10px] text-slate-400">Endpoint URL</span><div className="flex gap-1"><input readOnly value={ingestUrl} onFocus={(e) => e.target.select()} className="flex-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-mono bg-white" /><button onClick={() => navigator.clipboard?.writeText(ingestUrl)} className="px-2 rounded border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-100">คัดลอก</button></div></div>
                <div><span className="text-[10px] text-slate-400">Token (แบรนด์นี้)</span><div className="flex gap-1"><input readOnly value={be.ingest_token} onFocus={(e) => e.target.select()} className="flex-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-mono bg-white" /><button onClick={() => navigator.clipboard?.writeText(be.ingest_token)} className="px-2 rounded border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-100">คัดลอก</button></div></div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setBe(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">ยกเลิก</button>
              <button onClick={saveBrand} disabled={beSaving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">{beSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-800">ตั้งค่า TradingView (แอดมิน)</h3>
            <p className="text-xs text-slate-500 mt-1">จัดการหลายแบรนด์ — แต่ละแบรนด์คุกกี้/สคริปต์แยกกัน · เลือกเพจแชทที่ให้โชว์ + จะโชว์ในหน้าจัดการ TV ไหม</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={openWebhook} className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">ตั้งค่า n8n</button>
            <button onClick={newBrand} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700">+ เพิ่มแบรนด์</button>
          </div>
        </div>
        {msg && <div className="text-sm rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-slate-700 whitespace-pre-line">{msg}</div>}
      </div>

      {/* ปล่อยฟีเจอร์ TV ใหม่ */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Tv size={16} /> ปล่อยอัปเดต TV ให้ผู้ใช้ทุกคน</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md">ปิดอยู่ = เห็นเฉพาะแอดมิน, เปิด = ผู้ใช้ทุกคนเห็น (คอลัมน์อีเมล + ตัวเลือก TV ในหน้าตอบแชท)</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-xs font-medium ${released ? "text-emerald-600" : "text-slate-400"}`}>{released == null ? "..." : released ? "ปล่อยแล้ว" : "เฉพาะแอดมิน"}</span>
            <button onClick={toggleReleased} disabled={relSaving || released == null} className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${released ? "bg-emerald-500" : "bg-slate-300"}`}>
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${released ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* รายการแบรนด์ + สคริปต์ต่อแบรนด์ */}
      {brands.length === 0 && <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-400">ยังไม่มีแบรนด์ — กด "+ เพิ่มแบรนด์"</div>}
      {brands.map((b) => {
        const bs = scripts.filter((s) => s.brand_id === b.id);
        return (
          <div key={b.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 truncate flex items-center gap-2">{b.name}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.has_cookie ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>{b.has_cookie ? "มีคุกกี้" : "ยังไม่มีคุกกี้"}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.show_in_manager ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{b.show_in_manager ? "โชว์ในหน้าจัดการ" : "ซ่อนหน้าจัดการ"}</span>
                </div>
                <div className="text-[11px] text-slate-400 truncate mt-0.5">เพจ: {(b.pages || []).length ? (b.pages || []).map(pageName).join(", ") : "— (ไม่ผูกเพจ)"}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => checkBrand(b)} disabled={checkingId === b.id} className="px-2 py-1 rounded-md border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50">{checkingId === b.id ? "ตรวจ..." : "ตรวจระบบ"}</button>
                <button onClick={() => addScript(b.id)} className="px-2 py-1 rounded-md bg-brand-600 text-white text-[11px] font-medium hover:bg-brand-700">+ สคริปต์</button>
                <button onClick={() => editBrand(b)} className="px-2 py-1 rounded-md border border-slate-300 text-[11px] text-slate-600 hover:bg-slate-50">แก้ไข</button>
                <button onClick={() => deleteBrand(b)} className="px-2 py-1 rounded-md text-[11px] text-rose-600 hover:bg-rose-50"><Trash2 size={12} /></button>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {bs.length === 0 ? <div className="px-4 py-4 text-center text-xs text-slate-400">ยังไม่มีสคริปต์ — กด "+ สคริปต์"</div> : bs.map((s) => (
                <div key={s.pine_id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate text-sm">{s.name}</div>
                    <div className="text-[11px] text-slate-400 truncate font-mono">{s.pine_id}</div>
                  </div>
                  <button onClick={() => deleteScript(s)} className="flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 rounded-md px-2 py-1 shrink-0" title="ลบสคริปต์นี้"><Trash2 size={13} /> ลบ</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {/* สคริปต์ที่ยังไม่มีแบรนด์ (ถ้ามี) */}
      {scripts.some((s) => !s.brand_id) && (
        <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 font-medium text-amber-700 text-sm">สคริปต์ที่ยังไม่มีแบรนด์ — แนะนำให้ลบแล้วเพิ่มใหม่ในแบรนด์ที่ต้องการ</div>
          <div className="divide-y divide-slate-100">
            {scripts.filter((s) => !s.brand_id).map((s) => (
              <div key={s.pine_id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0"><div className="font-medium text-slate-800 truncate text-sm">{s.name}</div><div className="text-[11px] text-slate-400 truncate font-mono">{s.pine_id}</div></div>
                <button onClick={() => deleteScript(s)} className="text-[11px] font-medium text-rose-600 hover:bg-rose-50 rounded-md px-2 py-1 shrink-0"><Trash2 size={13} /> ลบ</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ settings, onSaved, allowedSettings = null, allowedPages = null, onOpenChat }) {
  // allowedSettings = null → เห็นทุกหัวข้อ (admin) ; array → เห็นเฉพาะหัวข้อที่ได้รับสิทธิ์
  // permissions/tv_settings/openai_key สงวนให้แอดมินสูงสุดเสมอ ต่อให้ติ๊กสิทธิ์ให้ก็ยังมองไม่เห็น
  // (openai_key เป็นคีย์เดียวที่ทั้งระบบใช้ร่วมกัน ไม่ควรให้ผู้ใช้อื่นแก้ได้)
  const visibleSections = allowedSettings
    ? SETTINGS_SECTIONS.filter((s) => s.key !== "permissions" && s.key !== "tv_settings" && s.key !== "openai_key" && allowedSettings.includes(s.key))
    : SETTINGS_SECTIONS;
  const [section, setSection] = useState(() => visibleSections[0]?.key || "general");
  const [sectionQuery, setSectionQuery] = useState("");
  const [openSettingsGroups, setOpenSettingsGroups] = useState({});
  const [secMenuOpen, setSecMenuOpen] = useState(false);   // (เดิม) มือถือ: กางรายการหัวข้อตั้งค่า
  const [mobileDetail, setMobileDetail] = useState(false);  // มือถือ: false = โชว์ลิสต์เมนู (แบบหน้าโฮม), true = เข้าไปดูเนื้อหาหัวข้อ
  // ถ้าหัวข้อปัจจุบันไม่มีสิทธิ์เข้า → เด้งไปหัวข้อแรกที่เข้าได้
  useEffect(() => { if (visibleSections.length && !visibleSections.some((s) => s.key === section)) setSection(visibleSections[0].key); }, [allowedSettings]);
  const [campaignDefaults, setCampaignDefaults] = useState(settings.campaign_defaults || {});
  const [launchCfg, setLaunchCfg] = useState(settings.launch_config || {});
  // launch_config ถูกเขียนจากสองที่: การ์ดนี้ กับ LaunchConfigCard ในหัวข้อ "ทั่วไป" (ที่ upsert ตรงเข้า DB เอง)
  // ถ้าไม่ sync กลับ แอดมินที่กด "ใช้ค่าที่ AI แนะนำ" แล้วมาเซฟหัวข้อแคมเปญ จะเขียนทับค่าเก่าที่ค้างใน state
  useEffect(() => { setLaunchCfg(settings.launch_config || {}); }, [settings.launch_config]);
  const [thresholds, setThresholds] = useState(settings.optimization_thresholds || {});
  const [brandVoice, setBrandVoice] = useState(settings.brand_voice || {});
  const [brandConfig, setBrandConfig] = useState(() => normalizeBrandConfig(settings.brand_assets));
  const [ghost, setGhost] = useState(
    settings.ghost_protection || { enabled: true, exclude_audience_network: true, min_conversations: 10, min_reply_rate: 0.4, action: "alert" }
  );
  const [aiModels, setAiModels] = useState(
    settings.ai_models || { content_text: "openai", image: "gpt-image-1", analyze_ads: "openai", analyze_settings: "openai" }
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError("");
    const now = new Date().toISOString();
    const rowsBySection = {
      campaign: [
        { key: "campaign_defaults", value: campaignDefaults, updated_at: now },
        { key: "launch_config", value: launchCfg, updated_at: now },
      ],
      decision: [{ key: "optimization_thresholds", value: thresholds, updated_at: now }],
      brand: [
        { key: "brand_voice", value: brandVoice, updated_at: now },
        { key: "brand_assets", value: brandConfig, updated_at: now },
      ],
      ai_models: [{ key: "ai_models", value: aiModels, updated_at: now }],
      ghost: [{ key: "ghost_protection", value: ghost, updated_at: now }],
    };
    const rows = rowsBySection[cur?.key] || [];
    const results = await Promise.all(rows.map((row) => supabase.from("settings").upsert(row)));
    setSaving(false);
    const error = results.find((result) => result.error)?.error;
    if (error) { setSaveError(error.message); return; }
    setSaved(true);
    onSaved?.();
  }

  function handleAiApplied(applied) {
    // Edge Function เซฟลง DB ให้เรียบร้อยแล้ว — ตรงนี้แค่ sync state ฝั่งหน้าเว็บให้ตรงกับสิ่งที่บันทึกไปจริง
    // เพื่อให้แอดมินเห็นค่าที่ AI ตั้งให้ทันที และแก้ต่อแบบ custom ได้ถ้าต้องการ
    if (applied?.campaign_defaults) setCampaignDefaults(applied.campaign_defaults);
    if (applied?.launch_config) setLaunchCfg(applied.launch_config);
    if (applied?.optimization_thresholds) setThresholds(applied.optimization_thresholds);
    if (applied?.brand_voice) setBrandVoice(applied.brand_voice);
    onSaved?.();
  }

  const selectedBrandId = brandConfig.active_brand_id || brandConfig.brands[0]?.id || "default";
  const selectedBrand = brandConfig.brands.find((brand) => brand.id === selectedBrandId) || brandConfig.brands[0];
  const brandAssets = selectedBrand?.assets || {};

  function setBrandAssets(nextAssets) {
    if (!selectedBrand) return;
    setBrandConfig((current) => ({
      ...current,
      active_brand_id: selectedBrand.id,
      brands: current.brands.map((brand) => brand.id === selectedBrand.id ? { ...brand, assets: nextAssets } : brand),
    }));
  }

  function selectBrand(brandId) {
    setBrandConfig((current) => ({ ...current, active_brand_id: brandId }));
  }

  function addBrand() {
    const id = `brand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setBrandConfig((current) => ({
      ...current,
      active_brand_id: id,
      brands: [...current.brands, { id, name: `แบรนด์ ${current.brands.length + 1}`, assets: {} }],
    }));
  }

  function renameSelectedBrand(name) {
    setBrandConfig((current) => ({
      ...current,
      brands: current.brands.map((brand) => brand.id === selectedBrandId ? { ...brand, name } : brand),
    }));
  }

  function removeSelectedBrand() {
    if (!selectedBrand || brandConfig.brands.length <= 1) return;
    if (!window.confirm(`ลบการตั้งค่า CI ของ “${selectedBrand.name}” ใช่หรือไม่`)) return;
    setBrandConfig((current) => {
      const brands = current.brands.filter((brand) => brand.id !== selectedBrand.id);
      return { ...current, active_brand_id: brands[0].id, brands };
    });
  }

  function field(obj, setObj, key, label, type = "text") {
    return (
      <div>
        <label className="text-sm text-slate-600">{label}</label>
        <input
          type={type}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={obj[key] ?? ""}
          onChange={(e) => setObj({ ...obj, [key]: type === "number" ? parseFloat(e.target.value) : e.target.value })}
        />
      </div>
    );
  }

  const cur = visibleSections.find((s) => s.key === section) || visibleSections[0];
  const filteredSections = visibleSections.filter((s) => s.label.toLowerCase().includes(sectionQuery.trim().toLowerCase()));
  const settingsGroups = [
    { label: "การเชื่อมต่อและ API", keys: ["meta", "openai_key", "line"] },
    { label: "แชทและการตอบกลับ", keys: ["leadfields", "synccfg", "ghost", "savedreplies", "chatmenu", "knowledge"] },
    { label: "AI และคอนเทนต์", keys: ["general", "ai_models", "ai_prompts", "brand"] },
    { label: "แคมเปญและการวิเคราะห์", keys: ["campaign", "decision", "prefetch", "replystats"] },
    { label: "งานอัตโนมัติและแจ้งเตือน", keys: ["jobs", "notifications"] },
    { label: "ทีมและความปลอดภัย", keys: ["permissions", "activity"] },
    { label: "TradingView และแต้มทีม", keys: ["tv_settings", "leaderboard"] },
  ];
  const groupedSections = settingsGroups.map((group) => ({
    ...group,
    items: group.keys.map((key) => filteredSections.find((s) => s.key === key)).filter(Boolean),
  })).filter((group) => group.items.length > 0);
  if (!cur) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">ยังไม่ได้รับสิทธิ์เข้าถึงหัวข้อย่อยในหน้าตั้งค่า</div>;
  }

  return (
    <div className="w-full max-w-[1400px] space-y-5 settings-page">
      <SectionTitle title="ตั้งค่า" subtitle="ปรับการทำงานของระบบ คีย์ API สิทธิ์ผู้ใช้ และงานอัตโนมัติ" />
      <div className="settings-page-overview ds-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Settings center</div>
          <div className="mt-1 text-sm text-slate-500">เลือกหัวข้อที่ต้องการแก้ไข หรือค้นหาจากชื่อเมนูได้ทันที</div>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={sectionQuery}
            onChange={(e) => setSectionQuery(e.target.value)}
            placeholder="ค้นหาหัวข้อตั้งค่า..."
            className="w-full rounded-control border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm"
          />
        </div>
      </div>
      <div className="settings-page-layout flex flex-col md:flex-row gap-4">
      {/* แถบเมนูตั้งค่า — มือถือ: โชว์เป็นลิสต์เหมือนหน้าโฮม (ซ่อนเมื่อเข้าไปดูหัวข้อ) */}
      <div className={`settings-page-nav md:w-56 shrink-0 ${mobileDetail ? "hidden md:block" : "block"}`}>
        {/* มือถือ: ลิสต์หัวข้อแนวตั้งแบบเมนูหน้าโฮม แตะเพื่อเข้าไปดูเนื้อหา */}
        <nav className="md:hidden flex flex-col gap-2 bg-white rounded-2xl border border-slate-200 p-2">
          {groupedSections.map((group) => (
            <div key={group.label} className="settings-nav-group rounded-xl border border-slate-100 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenSettingsGroups((open) => ({ ...open, [group.label]: !(open[group.label] ?? group.items.some((s) => s.key === section)) }))}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
              >
                <span className="text-sm font-bold text-slate-300">{group.label}</span>
                <ChevronDown size={15} className={`text-slate-400 transition-transform ${(openSettingsGroups[group.label] ?? group.items.some((s) => s.key === section)) ? "" : "-rotate-90"}`} />
              </button>
              {(openSettingsGroups[group.label] ?? group.items.some((s) => s.key === section)) && group.items.map((s) => (
                <button
                  key={s.key}
                  onClick={() => { setSection(s.key); setOpenSettingsGroups((open) => ({ ...open, [group.label]: true })); setMobileDetail(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-left ${section === s.key ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  <s.icon size={15} className="shrink-0 text-slate-500" />
                  <span className="truncate flex-1">{s.label}</span>
                  <ChevronDown size={15} className="-rotate-90 text-slate-300 shrink-0" />
                </button>
              ))}
            </div>
          ))}
          {filteredSections.length === 0 && <div className="p-3 text-center text-xs text-slate-400">ไม่พบหัวข้อนี้</div>}
        </nav>

        {/* เดสก์ท็อป: รายการแนวตั้งติดขอบจอ */}
        <div className="settings-page-nav-desktop hidden md:flex md:flex-col gap-1 bg-white rounded-2xl border border-slate-200 p-2 md:sticky md:top-24">
          {groupedSections.map((group) => (
            <div key={group.label} className="settings-nav-group">
              <button
                type="button"
                onClick={() => setOpenSettingsGroups((open) => ({ ...open, [group.label]: !(open[group.label] ?? group.items.some((s) => s.key === section)) }))}
                className="flex w-full items-center justify-between gap-2 px-3 pb-1 pt-2 text-left hover:text-slate-600"
              >
                <span className="text-xs font-bold text-slate-300">{group.label}</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${(openSettingsGroups[group.label] ?? group.items.some((s) => s.key === section)) ? "" : "-rotate-90"}`} />
              </button>
              {(openSettingsGroups[group.label] ?? group.items.some((s) => s.key === section)) && group.items.map((s) => (
                <button
                  key={s.key}
                  onClick={() => { setSection(s.key); setOpenSettingsGroups((open) => ({ ...open, [group.label]: true })); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 rounded-control text-xs font-medium whitespace-nowrap text-left shrink-0 border-l-[3px] ${
                    section === s.key
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-transparent text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <s.icon size={16} /> <span className="truncate">{s.label}</span>
                </button>
              ))}
            </div>
          ))}
          {filteredSections.length === 0 && <div className="p-3 text-center text-xs text-slate-400">ไม่พบหัวข้อนี้</div>}
        </div>
      </div>

      {/* เนื้อหาของหมวดที่เลือก — มือถือโชว์เฉพาะตอนเข้าไปในหัวข้อ (มีปุ่มย้อนกลับ) */}
      <div className={`settings-page-content flex-1 min-w-0 space-y-6 ${mobileDetail ? "block" : "hidden md:block"}`}>
        {/* มือถือ: ปุ่มย้อนกลับไปลิสต์เมนู + ชื่อหัวข้อปัจจุบัน */}
        <button
          onClick={() => { setMobileDetail(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="md:hidden flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 -mb-2"
        >
          <ChevronDown size={18} className="rotate-90 shrink-0" />
          <span>ตั้งค่า</span>
          {cur && <span className="text-slate-400">/ {cur.label}</span>}
        </button>
      {section === "general" && (
        <AiAssistPanel
          onApplied={handleAiApplied}
          initialAnalysis={settings.ai_analysis}
          initialLaunchConfig={settings.launch_config}
          onConfigApplied={onSaved}
          defaultModel={settings.ai_models?.analyze_settings || "openai"}
        />
      )}

      {section === "leadfields" && <PageLeadConfigPanel />}
      {section === "synccfg" && <ChatSyncConfigPanel />}
      {section === "notifications" && <PushNotificationPanel />}
      {section === "jobs" && <ScheduledJobsPanel />}
      {section === "prefetch" && <InsightsPrefetchPanel />}
      {section === "savedreplies" && <SavedRepliesPanel allowedPages={allowedPages} />}
      {section === "chatmenu" && <ChatMenuPanel allowedPages={allowedPages} />}
      {section === "knowledge" && <KnowledgeBasePanel allowedPages={allowedPages} />}
      {section === "ai_prompts" && <AiPromptsPanel />}
      {section === "meta" && <MetaTokenPanel />}
      {section === "openai_key" && <OpenAIKeyPanel />}
      {section === "line" && <LineOAPanel />}
      {section === "permissions" && <PermissionsPanel />}
      {section === "tv_settings" && <TvAdminSettingsPanel />}
      {section === "replystats" && <ReplyStatsPanel onOpenChat={onOpenChat} />}
      {section === "leaderboard" && <LeaderboardSettingsPanel />}
      {section === "activity" && <ActivityPanel />}

      {section === "campaign" && (<>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-800">ค่าเริ่มต้นแคมเปญ (Meta)</h3>
        {field(campaignDefaults, setCampaignDefaults, "ad_account_id", "Ad Account ID (ไม่ต้องมี act_ นำหน้า)")}
        {field(campaignDefaults, setCampaignDefaults, "page_id", "Facebook Page ID")}
        {field(campaignDefaults, setCampaignDefaults, "pixel_id", "Pixel ID")}
        {field(campaignDefaults, setCampaignDefaults, "audience_id", "Custom/Lookalike Audience ID (เว้นว่างได้ถ้ายังไม่มี — จะยิงแบบกว้างแทน)")}
        {field(campaignDefaults, setCampaignDefaults, "age_min", "อายุขั้นต่ำ (ใช้เมื่อยังไม่มี Audience ID)", "number")}
        {field(campaignDefaults, setCampaignDefaults, "age_max", "อายุสูงสุด (ใช้เมื่อยังไม่มี Audience ID)", "number")}
        <div>
          <label className="text-sm text-slate-600">ความสนใจ/พฤติกรรม (Interests targeting)</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(campaignDefaults.interests || []).length === 0 ? (
              <span className="text-xs text-slate-400">
                ยังไม่มี — ระบบจะหาให้อัตโนมัติจากช่อง "กลุ่มเป้าหมาย" ทุกครั้งที่กดสร้างคอนเทนต์ในแท็บ "สร้างคอนเทนต์"
              </span>
            ) : (
              campaignDefaults.interests.map((i) => (
                <span key={i.id} className="text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-1">
                  {i.name}
                </span>
              ))
            )}
          </div>
        </div>
        {field(campaignDefaults, setCampaignDefaults, "landing_url", "Landing Page URL")}
        {field(campaignDefaults, setCampaignDefaults, "daily_budget_thb", "งบเริ่มต้น/วัน (บาท)", "number")}
      </div>
      <AdTargetingCard value={launchCfg} onChange={setLaunchCfg} />
      </>
      )}

      {section === "decision" && (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-800">เกณฑ์การตัดสินใจอัตโนมัติ</h3>
        {field(thresholds, setThresholds, "target_cpa_thb", "เป้า CPA (บาท)", "number")}
        {field(thresholds, setThresholds, "min_spend_before_judging_thb", "Spend ขั้นต่ำก่อนตัดสิน (บาท)", "number")}
        {field(thresholds, setThresholds, "underperform_multiplier", "ตัวคูณ underperform (เช่น 1.5)", "number")}
        {field(thresholds, setThresholds, "outperform_multiplier", "ตัวคูณ outperform (เช่น 0.7)", "number")}
        {field(thresholds, setThresholds, "scale_up_pct", "% เพิ่มงบเมื่อผลดี", "number")}
      </div>
      )}

      {section === "brand" && (<>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">จัดการแบรนด์ CI</h3>
          <p className="text-xs text-slate-500 mt-1">แยกโลโก้ ริบบิ้น และสไตล์ภาพของแต่ละแบรนด์ แล้วเลือกใช้แบรนด์ที่ต้องการได้ในหน้าสร้างคอนเทนต์</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={selectedBrandId}
            onChange={(e) => selectBrand(e.target.value)}
          >
            {brandConfig.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
          <button type="button" onClick={addBrand} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Plus size={15} /> เพิ่มแบรนด์
          </button>
          <button type="button" onClick={removeSelectedBrand} disabled={brandConfig.brands.length <= 1} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40">
            ลบแบรนด์
          </button>
        </div>
        <div>
          <label className="text-sm text-slate-600">ชื่อแบรนด์</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={selectedBrand?.name || ""}
            onChange={(e) => renameSelectedBrand(e.target.value)}
            placeholder="เช่น BeSight, AlphardVIP"
          />
        </div>
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">กำลังแก้ไข: {selectedBrand?.name || "-"} · กด “บันทึก” ด้านล่างเพื่อเก็บการตั้งค่า</div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-800">โทนแบรนด์ (ใช้เป็นค่าเริ่มต้นตอนสร้างคอนเทนต์)</h3>
        {field(brandVoice, setBrandVoice, "brand_voice", "โทนแบรนด์")}
        {field(brandVoice, setBrandVoice, "target_audience_desc", "กลุ่มเป้าหมาย")}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5">
        <div>
          <h3 className="font-semibold text-slate-800">โลโก้ / ป้ายริบบิ้นแบรนด์</h3>
          <p className="text-xs text-slate-500 mt-1">
            อัปโหลดไว้ครั้งเดียว ระบบจะซ้อนภาพนี้ลงบนรูปโฆษณาทุกรูปที่สร้างใหม่ตามตำแหน่งที่กำหนด
            (แนะนำไฟล์ PNG พื้นหลังโปร่งใส เพื่อความคมชัดตอนซ้อนภาพ)
          </p>
        </div>
        <BrandAssetUploader
          label="โลโก้แบรนด์"
          urlKey="logo_url"
          positionKey="logo_position"
          scaleKey="logo_scale_pct"
          assets={brandAssets}
          setAssets={setBrandAssets}
        />
        <BrandAssetUploader
          label="ป้ายริบบิ้น / Badge"
          urlKey="ribbon_url"
          positionKey="ribbon_position"
          scaleKey="ribbon_scale_pct"
          assets={brandAssets}
          setAssets={setBrandAssets}
        />
        <div>
          <label className="text-sm text-slate-600">หมายเหตุตำแหน่งเพิ่มเติม (ไม่บังคับ)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            placeholder="เช่น อยากให้โลโก้อยู่มุมขวาล่างเสมอ ห่างขอบนิดหน่อย ไม่บังข้อความในภาพ"
            value={brandAssets.placement_notes ?? ""}
            onChange={(e) => setBrandAssets({ ...brandAssets, placement_notes: e.target.value })}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">CI แบรนด์ (โทนสี / สไตล์ภาพ)</h3>
          <p className="text-xs text-slate-500 mt-1">
            อัปโหลดภาพตัวอย่างงานดีไซน์ของแบรนด์ (โปสเตอร์ โบรชัวร์ หรือรูปโฆษณาเก่า) แล้วให้ AI ช่วยสกัดเป็นคำอธิบายสี/สไตล์
            หรือพิมพ์อธิบายเองก็ได้ — ใช้เป็นแนวทางตอนสร้างรูปโฆษณาใหม่ให้เข้ากับ CI
          </p>
        </div>
        <CiStyleUploader assets={brandAssets} setAssets={setBrandAssets} />
      </div>
      </>)}

      {section === "ai_models" && (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">โมเดล AI เริ่มต้นของแต่ละงาน</h3>
          <p className="text-xs text-slate-500 mt-1">เลือกว่าจะใช้ AI ตัวไหนเป็นค่าเริ่มต้นในแต่ละงาน (ปรับเฉพาะครั้งได้ในหน้านั้นๆ)</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-600">เขียนคอนเทนต์</label>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={aiModels.content_text} onChange={(e) => setAiModels({ ...aiModels, content_text: e.target.value })}>
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">สร้างรูป</label>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={aiModels.image} onChange={(e) => setAiModels({ ...aiModels, image: e.target.value })}>
              <option value="gpt-image-1">GPT Image 1</option>
              <option value="gpt-image-2">GPT Image 2 (ล่าสุด)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">วิเคราะห์ ads</label>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={aiModels.analyze_ads} onChange={(e) => setAiModels({ ...aiModels, analyze_ads: e.target.value })}>
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">วิเคราะห์+ตั้งค่าแคมเปญ</label>
            <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={aiModels.analyze_settings} onChange={(e) => setAiModels({ ...aiModels, analyze_settings: e.target.value })}>
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
          </div>
        </div>
      </div>

      )}

      {section === "ghost" && (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">ป้องกันแชทผี (Ghost chats)</h3>
          <p className="text-xs text-slate-500 mt-1">
            กันแชทผี/ลีดขยะ (บอท, มิสคลิก, ทักแล้วเงียบ) — ตัด Audience Network ตอนลอนช์ และเฝ้าดูอัตราการตอบกลับ ถ้าต่ำผิดปกติจะแจ้งเตือนให้อนุมัติหยุด
          </p>
        </div>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-700">เปิดฟีเจอร์ป้องกันแชทผี</span>
          <input type="checkbox" checked={!!ghost.enabled} onChange={(e) => setGhost({ ...ghost, enabled: e.target.checked })} className="w-4 h-4" />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-700">ตัด Audience Network ตอนลอนช์ (แนะนำ)</span>
          <input type="checkbox" checked={!!ghost.exclude_audience_network} onChange={(e) => setGhost({ ...ghost, exclude_audience_network: e.target.checked })} className="w-4 h-4" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-sm text-slate-600">แชทขั้นต่ำก่อนตัดสิน</label>
            <NumInput min={0}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={ghost.min_conversations ?? 10}
              onChange={(n) => setGhost({ ...ghost, min_conversations: n })}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">อัตราตอบขั้นต่ำ (%)</label>
            <NumInput min={0} max={100}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={Math.round((ghost.min_reply_rate ?? 0.4) * 100)}
              onChange={(n) => setGhost({ ...ghost, min_reply_rate: n / 100 })}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">เมื่อพบแชทผี</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={ghost.action || "alert"}
              onChange={(e) => setGhost({ ...ghost, action: e.target.value })}
            >
              <option value="alert">แจ้งเตือนรออนุมัติ</option>
              <option value="auto_pause">หยุดอัตโนมัติ</option>
            </select>
          </div>
        </div>
      </div>
      )}

      {cur?.form && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-brand-600 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : null}
            บันทึกตั้งค่า
          </button>
          {saved && <span className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">บันทึกแล้ว</span>}
          {saveError && <span className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{saveError}</span>}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

// ช่องแก้ไขในตารางแบบ inline — ดูเหมือนข้อความ พอคลิก/โฟกัสถึงเป็นช่องกรอก บันทึกอัตโนมัติเมื่อออกจากช่อง
function EditableCell({ row, field, onSaved, numeric }) {
  const [val, setVal] = useState(row[field] || "");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setVal(row[field] || ""); }, [row.id, row[field]]);
  async function save() {
    const nv = val.trim() || null;
    if (nv === (row[field] || null)) return;
    const { error } = await supabase.from("chat_customers").update({ [field]: nv, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) { setVal(row[field] || ""); return; }
    onSaved?.(row.id, { [field]: nv });
    setSaved(true); setTimeout(() => setSaved(false), 1000);
  }
  return (
    <input
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setVal(row[field] || ""); e.currentTarget.blur(); } }}
      inputMode={numeric ? "numeric" : undefined}
      placeholder="—"
      title="คลิกเพื่อแก้ไข"
      className={`w-full min-w-0 rounded px-1.5 py-0.5 text-[11px] bg-transparent border ${saved ? "border-emerald-400 bg-emerald-50" : "border-transparent hover:border-slate-300 focus:border-slate-400 focus:bg-white"}`}
    />
  );
}
// ค่าเริ่มต้นของ "แท็กสรุปจากแอดมิน" — prefix ที่ระบบใช้ parse (แก้ได้ในหน้าตั้งค่า)

// จัดการ "ข้อความบันทึกไว้" (canned replies) — เพิ่ม/แก้/ลบ + แนบรูป
export function SavedRepliesPanel({ allowedPages = null }) {
  const [items, setItems] = useState(null);
  const [pages, setPages] = useState([]);
  const [brands, setBrands] = useState([]);
  const [saving, setSaving] = useState("");
  const pageOk = (id) => !allowedPages || allowedPages.includes(String(id));
  async function load() {
    const { data } = await supabase.from("saved_replies").select("*").order("sort").order("created_at");
    // จำกัดสิทธิ์: เห็นเฉพาะข้อความกลาง (ทุกเพจ) + ข้อความของเพจที่ตัวเองมีสิทธิ์
    setItems((data || []).filter((r) => !r.page_id || pageOk(r.page_id)));
  }
  useEffect(() => {
    load();
    supabase.from("page_lead_config").select("page_id, page_name").order("page_name").then(({ data }) =>
      setPages((data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })).filter((p) => pageOk(p.id))));
    supabase.from("tv_brands").select("id, name, active").eq("active", true).order("name").then(({ data }) =>
      setBrands(data || []));
  }, []);
  const addNew = () => setItems((it) => [{ _new: true, tmp: Date.now(), title: "", message: "", image_url: null, page_id: null, brand_id: null }, ...(it || [])]);
  const setField = (idx, k, v) => setItems((it) => it.map((x, i) => (i === idx ? { ...x, [k]: v } : x)));
  async function uploadImg(idx, file) {
    if (!file) return;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `saved/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
    if (error) { alert("อัปโหลดรูปไม่สำเร็จ: " + error.message); return; }
    setField(idx, "image_url", supabase.storage.from("chat-media").getPublicUrl(path).data.publicUrl);
  }
  async function save(idx) {
    const it = items[idx];
    if (!it.message?.trim() && !it.image_url) { alert("ต้องมีข้อความหรือรูปอย่างน้อยอย่างหนึ่ง"); return; }
    setSaving(it.id || it.tmp);
    const payload = { page_id: it.page_id || null, brand_id: it.brand_id || null, title: it.title || null, message: it.message || "", image_url: it.image_url || null, updated_at: new Date().toISOString() };
    if (it.id) await supabase.from("saved_replies").update(payload).eq("id", it.id);
    else await supabase.from("saved_replies").insert(payload);
    setSaving(""); load();
  }
  async function del(idx) {
    const it = items[idx];
    if (it.id) { if (!window.confirm("ลบข้อความนี้?")) return; await supabase.from("saved_replies").delete().eq("id", it.id); }
    setItems((list) => list.filter((_, i) => i !== idx));
  }
  if (!items) return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"><Spinner label="กำลังโหลด..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-800">ข้อความบันทึกไว้</h3>
          <p className="text-xs text-slate-500 mt-0.5">ข้อความสำเร็จรูปสำหรับกดใช้ในหน้า "ตอบแชท" (แนบรูปได้) · เลือกได้ว่าใช้ทุกเพจหรือเฉพาะเพจ</p>
        </div>
        <button onClick={addNew} className="bg-brand-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-brand-700">+ เพิ่มใหม่</button>
      </div>
      {items.length === 0 && (
        <EmptyState
          icon={MessageSquare}
          title="ยังไม่มีข้อความบันทึกไว้"
          hint='กด "เพิ่มใหม่" เพื่อสร้างข้อความที่ใช้ตอบซ้ำบ่อย แล้วเรียกใช้ได้จากหน้าตอบแชท'
        />
      )}
      <div className="space-y-3">
        {items.map((it, idx) => (
          <div key={it.id || it.tmp} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={it.title || ""} onChange={(e) => setField(idx, "title", e.target.value)} placeholder="หัวข้อ (เช่น ทักทาย, ราคา, วิธีสมัคร)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <select value={it.brand_id || ""} onChange={(e) => setField(idx, "brand_id", e.target.value ? Number(e.target.value) : null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
                <option value="">ทุกแบรนด์</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select value={it.page_id || ""} onChange={(e) => setField(idx, "page_id", e.target.value || null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
                <option value="">ทุกเพจ</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <textarea rows={3} value={it.message || ""} onChange={(e) => setField(idx, "message", e.target.value)} placeholder="ข้อความตอบกลับอัตโนมัติ/ข้อความสำเร็จรูป..." className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="flex items-center gap-3 flex-wrap">
              {it.image_url && <img src={it.image_url} alt="" className="w-14 h-14 rounded object-cover border border-slate-200" />}
              <label className="text-xs text-brand-600 hover:underline cursor-pointer">{it.image_url ? "เปลี่ยนรูป" : "แนบรูป"}<input type="file" accept="image/*" className="hidden" onChange={(e) => uploadImg(idx, e.target.files?.[0])} /></label>
              {it.image_url && <button onClick={() => setField(idx, "image_url", null)} className="text-xs text-rose-500 hover:underline">ลบรูป</button>}
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => del(idx)} className="text-xs text-rose-600 hover:underline">ลบ</button>
                <button onClick={() => save(idx)} disabled={saving === (it.id || it.tmp)} className="bg-brand-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-brand-700 disabled:opacity-60">{saving === (it.id || it.tmp) ? "กำลังบันทึก..." : "บันทึก"}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeBasePanel({ allowedPages = null }) {
  const [items, setItems] = useState(null);
  const [approvedItems, setApprovedItems] = useState(null);
  const [approvedSearch, setApprovedSearch] = useState("");
  const [approvedPage, setApprovedPage] = useState("");
  const [approvedPageNumber, setApprovedPageNumber] = useState(1);
  const [approvedPageSize, setApprovedPageSize] = useState(10);
  const [approvedTotal, setApprovedTotal] = useState(0);
  const [expandedApproved, setExpandedApproved] = useState(null);
  const [pages, setPages] = useState([]);
  const [draft, setDraft] = useState({ page_id: "", question: "", answer: "" });
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState("");
  async function load() {
    setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "list", status: "pending" } });
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "โหลดไม่สำเร็จ"); setItems([]); return; }
    setItems(data.items || []);
  }
  async function loadApproved(search = approvedSearch, pageId = approvedPage, page = approvedPageNumber, pageSize = approvedPageSize) {
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "list", status: "approved", q: search, page_id: pageId || null, page, page_size: pageSize } });
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "โหลดรายการที่ใช้งานอยู่ไม่สำเร็จ"); setApprovedItems([]); return; }
    setApprovedItems(data.items || []);
    setApprovedTotal(data.total || 0);
  }
  useEffect(() => {
    load();
    supabase.from("page_lead_config").select("page_id, page_name").order("page_name").then(({ data, error }) => {
      if (error) { setMsg(error.message || "โหลดรายชื่อเพจไม่สำเร็จ"); return; }
      const allowed = allowedPages ? new Set(allowedPages.map(String)) : null;
      const options = (data || [])
        .map((p) => ({ id: String(p.page_id), name: p.page_name || p.page_id }))
        .filter((p) => !allowed || allowed.has(p.id));
      setPages(options);
      setDraft((current) => current.page_id || !options[0] ? current : { ...current, page_id: options[0].id });
    });
  }, [allowedPages]);
  useEffect(() => {
    const timer = setTimeout(() => loadApproved(approvedSearch, approvedPage, approvedPageNumber, approvedPageSize), 250);
    return () => clearTimeout(timer);
  }, [approvedSearch, approvedPage, approvedPageNumber, approvedPageSize]);
  const edit = (id, key, value) => setItems((rows) => rows.map((r) => r.id === id ? { ...r, [key]: value } : r));
  const editApproved = (id, key, value) => setApprovedItems((rows) => rows.map((r) => r.id === id ? { ...r, [key]: value } : r));
  async function createManual() {
    if (!draft.page_id || !draft.question.trim() || !draft.answer.trim()) { setMsg("กรุณาเลือกเพจและกรอกคำค้นกับคำตอบให้ครบ"); return; }
    setSaving("manual"); setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "create", ...draft } });
    setSaving("");
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "เพิ่มคำตอบไม่สำเร็จ"); return; }
    setDraft((current) => ({ ...current, question: "", answer: "" }));
    setMsg(data.merged ? "พบคำตอบเดิม จึงเพิ่มคำค้นเข้า Keywords ของรายการเดิมแล้ว ✓" : "เพิ่มเข้าคลังและอนุมัติพร้อมใช้งานแล้ว ✓");
    setApprovedPageNumber(1);
    loadApproved(approvedSearch, approvedPage, 1, approvedPageSize);
  }
  async function review(item, status) {
    setSaving(item.id); setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "review", id: item.id, status, question: item.question, answer: item.answer } });
    setSaving("");
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "บันทึกไม่สำเร็จ"); return; }
    setItems((rows) => rows.filter((r) => r.id !== item.id));
    if (status === "approved") {
      setApprovedPageNumber(1);
      loadApproved(approvedSearch, approvedPage, 1, approvedPageSize);
    }
  }
  async function saveApproved(item) {
    if (!item.question.trim() || !item.answer.trim()) { setMsg("คำค้นและคำตอบต้องไม่ว่าง"); return; }
    setSaving(item.id); setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "review", id: item.id, status: "approved", question: item.question, answer: item.answer } });
    setSaving("");
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "บันทึกการแก้ไขไม่สำเร็จ"); return; }
    setMsg("บันทึกการแก้ไขแล้ว ✓");
    loadApproved(approvedSearch, approvedPage, approvedPageNumber, approvedPageSize);
  }
  async function deleteApproved(item) {
    if (!window.confirm(`ลบคำค้นนี้ออกจากคลัง?\n\n${item.question}`)) return;
    setSaving(item.id); setMsg("");
    const { data, error } = await supabase.functions.invoke("knowledge-base", { body: { action: "delete", id: item.id } });
    setSaving("");
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "ลบไม่สำเร็จ"); return; }
    setExpandedApproved((id) => id === item.id ? null : id);
    if ((approvedItems || []).length === 1 && approvedPageNumber > 1) setApprovedPageNumber((page) => page - 1);
    else loadApproved(approvedSearch, approvedPage, approvedPageNumber, approvedPageSize);
    setMsg("ลบรายการแล้ว ✓");
  }
  const pageNameById = new Map(pages.map((page) => [page.id, page.name]));
  const approvedPageCount = Math.max(1, Math.ceil(approvedTotal / approvedPageSize));
  const approvedPageButtons = (() => {
    if (approvedPageCount <= 7) return Array.from({ length: approvedPageCount }, (_, index) => index + 1);
    const buttons = [1];
    if (approvedPageNumber > 3) buttons.push("left-gap");
    for (let page = Math.max(2, approvedPageNumber - 1); page <= Math.min(approvedPageCount - 1, approvedPageNumber + 1); page += 1) buttons.push(page);
    if (approvedPageNumber < approvedPageCount - 2) buttons.push("right-gap");
    buttons.push(approvedPageCount);
    return buttons;
  })();
  if (items === null) return <div className="bg-white rounded-2xl border border-slate-200 p-5"><Spinner label="กำลังโหลดคลังคำตอบ..." /></div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">คลังคำถาม–คำตอบ</h3>
        <p className="text-xs text-slate-500 mt-1">กำหนดคำค้นหรือวลีสำคัญหลายแบบให้คำตอบเดียว · คั่นแต่ละคำด้วยจุลภาคหรือขึ้นบรรทัดใหม่ · การค้นหาจะแยกตามเพจ</p>
      </div>
      <div className="knowledge-manual-card rounded-xl p-4 space-y-3">
        <div className="knowledge-manual-title font-medium text-sm">เพิ่มคำถาม–คำตอบเอง</div>
        <label className="knowledge-manual-label block text-xs">เพจ
          <select value={draft.page_id} onChange={(e) => setDraft({ ...draft, page_id: e.target.value })} className="knowledge-manual-field mt-1 w-full rounded-lg px-3 py-2 text-sm">
            <option value="">— เลือกเพจ —</option>
            {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
          </select>
        </label>
        <label className="knowledge-manual-label block text-xs">คำค้น / Keywords
          <textarea rows={2} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} placeholder="เช่น เปิดบัญชีเพิ่ม, เพิ่มบัญชี XM, มีบัญชีแล้วสมัครเพิ่ม" className="knowledge-manual-field mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          <span className="mt-1 block text-[10px] text-slate-400">ใส่ได้หลายคำหรือหลายวลี โดยคั่นด้วยจุลภาค (,) หรือขึ้นบรรทัดใหม่</span>
        </label>
        <label className="knowledge-manual-label block text-xs">คำตอบ
          <textarea rows={3} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} placeholder="กรอกคำตอบที่พนักงานสามารถนำไปใช้ได้" className="knowledge-manual-field mt-1 w-full rounded-lg px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end">
          <button onClick={createManual} disabled={saving === "manual" || !draft.page_id || !draft.question.trim() || !draft.answer.trim()} className="ds-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40">{saving === "manual" ? "กำลังเพิ่ม..." : "เพิ่มและอนุมัติใช้งาน"}</button>
        </div>
      </div>
      {msg && <div className={`text-xs ${msg.includes("✓") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</div>}
      <div className="flex items-center justify-between gap-3 pt-2">
        <h4 className="text-sm font-semibold text-slate-700">รายการรอตรวจสอบ</h4>
        <span className="text-xs text-slate-400">{items.length} รายการ</span>
      </div>
      {items.length === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="ไม่มีรายการรอตรวจสอบ"
          hint="คู่คำถาม-คำตอบใหม่จากหน้าตอบแชทจะมารอที่นี่ให้อนุมัติก่อนเข้าคลังความรู้"
        />
      )}
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="text-[11px] text-slate-400">เพจ {item.page_id} · {item.source || "Messenger"} · ผู้ตอบ {item.created_by || "ไม่ระบุ"}</div>
            <label className="block text-xs text-slate-500">คำค้น / Keywords<textarea rows={2} value={item.question} onChange={(e) => edit(item.id, "question", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" /></label>
            <label className="block text-xs text-slate-500">คำตอบ<textarea rows={3} value={item.answer} onChange={(e) => edit(item.id, "answer", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" /></label>
            <div className="flex justify-end gap-2">
              <button onClick={() => review(item, "rejected")} disabled={saving === item.id} className="rounded-lg border border-rose-200 text-rose-600 px-3 py-1.5 text-xs disabled:opacity-50">ไม่ใช้</button>
              <button onClick={() => review(item, "approved")} disabled={saving === item.id || !item.question.trim() || !item.answer.trim()} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs disabled:opacity-50">อนุมัติ</button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 pt-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-semibold text-slate-800">รายการคำถาม–คำตอบที่ใช้งานอยู่</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">เรียงตามตัวอักษร ก–ฮ และ A–Z · แก้ไขหรือลบได้</p>
          </div>
          <span className="text-xs text-slate-400">ทั้งหมด {approvedTotal.toLocaleString()} รายการ</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_auto] gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={approvedSearch} onChange={(e) => { setApprovedSearch(e.target.value); setApprovedPageNumber(1); }} placeholder="ค้นหาคำถามหรือคำตอบ..." className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm" />
          </div>
          <select value={approvedPage} onChange={(e) => { setApprovedPage(e.target.value); setApprovedPageNumber(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">ทุกเพจ</option>
            {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-500 whitespace-nowrap">แสดง
            <select value={approvedPageSize} onChange={(e) => { setApprovedPageSize(Number(e.target.value)); setApprovedPageNumber(1); }} className="bg-transparent text-sm font-medium text-slate-700 outline-none">
              {[5, 10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            รายการ
          </label>
        </div>
        {approvedItems === null ? <Spinner label="กำลังโหลดรายการที่ใช้งานอยู่..." /> : approvedItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">ไม่พบรายการที่ตรงกับการค้นหา</div>
        ) : (
          <div className="space-y-2">
            {approvedItems.map((item) => {
              const expanded = expandedApproved === item.id;
              return <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button type="button" onClick={() => setExpandedApproved(expanded ? null : item.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50">
                  <ChevronDown size={17} className={`shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{item.question}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-400">เพจ {pageNameById.get(String(item.page_id)) || item.page_id} · ใช้แล้ว {item.use_count || 0} ครั้ง</span>
                  </span>
                </button>
                {expanded && <div className="space-y-3 border-t border-slate-200 bg-slate-50/60 p-3">
                  <label className="block text-xs text-slate-500">คำค้น / Keywords
                    <textarea rows={2} value={item.question} onChange={(e) => editApproved(item.id, "question", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
                  </label>
                  <label className="block text-xs text-slate-500">คำตอบ
                    <textarea rows={4} value={item.answer} onChange={(e) => editApproved(item.id, "answer", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => deleteApproved(item)} disabled={saving === item.id} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">ลบทิ้ง</button>
                    <button onClick={() => saveApproved(item)} disabled={saving === item.id || !item.question.trim() || !item.answer.trim()} className="ds-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{saving === item.id ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}</button>
                  </div>
                </div>}
              </div>
            })}
          </div>
        )}
        {approvedTotal > 0 && <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-center text-xs text-slate-400 sm:text-left">แสดง {(approvedPageNumber - 1) * approvedPageSize + 1}–{Math.min(approvedPageNumber * approvedPageSize, approvedTotal)} จาก {approvedTotal.toLocaleString()}</span>
          <div className="flex flex-wrap items-center justify-center gap-1">
            <button type="button" aria-label="หน้าก่อนหน้า" onClick={() => setApprovedPageNumber((page) => Math.max(1, page - 1))} disabled={approvedPageNumber <= 1} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft size={15} /></button>
            {approvedPageButtons.map((page) => typeof page === "number" ? <button type="button" key={page} onClick={() => setApprovedPageNumber(page)} className={`min-w-8 rounded-lg border px-2 py-1.5 text-xs font-medium ${approvedPageNumber === page ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{page}</button> : <span key={page} className="px-1 text-xs text-slate-400">…</span>)}
            <button type="button" aria-label="หน้าถัดไป" onClick={() => setApprovedPageNumber((page) => Math.min(approvedPageCount, page + 1))} disabled={approvedPageNumber >= approvedPageCount} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight size={15} /></button>
          </div>
        </div>}
      </div>
    </div>
  );
}

export { EditableCell };
export default SettingsTab;
