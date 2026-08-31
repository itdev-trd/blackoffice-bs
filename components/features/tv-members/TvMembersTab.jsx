"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { beToCe } from "@/lib/utils/date";
import { X, Clock, Pencil, Users, CalendarX2, CalendarPlus, ChevronDown, ChevronUp, Trash2, Loader2, Eye } from "lucide-react";

export default function TvMembersTab({ active = true }) {
  const [scripts, setScripts] = useState([]);
  const [access, setAccess] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [released, setReleased] = useState(false);   // ฟีเจอร์ TV ใหม่ปล่อยให้ทุกคนเห็นแล้วหรือยัง
  const [updatedAt, setUpdatedAt] = useState(null);
  const [msg, setMsg] = useState("");
  // ฟอร์มเพิ่มสมาชิก
  const [uname, setUname] = useState("");
  const [dname, setDname] = useState("");
  const [demail, setDemail] = useState("");
  const [tradeId, setTradeId] = useState("");
  const [brands, setBrands] = useState([]);      // แบรนด์ทั้งหมด (ใช้จัดกลุ่ม + ฟอร์มเพิ่ม)
  const [brandSel, setBrandSel] = useState(null); // แบรนด์ที่เลือกในฟอร์มเพิ่มสมาชิก
  const [pineIds, setPineIds] = useState([]);   // เลือกสคริปต์ได้หลายอัน
  // วันหมดอายุแยกต่อสคริปต์ — { [pine_id]: { mode:"days"|"lifetime"|"date", days, expDate } }
  const [dur, setDur] = useState({});
  const getDur = (pid) => dur[pid] || { mode: "days", days: 30, expDate: "" };
  const setDurFor = (pid, patch) => setDur((d) => ({ ...d, [pid]: { ...getDur(pid), ...patch } }));
  const toggleScript = (pid, on) => {
    setPineIds((cur) => on ? cur.filter((p) => p !== pid) : [...cur, pid]);
    if (!on) setDur((d) => (d[pid] ? d : { ...d, [pid]: { mode: "days", days: 30, expDate: "" } }));
  };
  // วันนี้ (เวลาไทย) ใช้เป็นค่าต่ำสุดของปฏิทิน
  const todayTH = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  // แปลงวันที่ที่เลือก (สิ้นวัน 23:59 เวลาไทย) → จำนวนวันนับจากตอนนี้ (ปัดขึ้น) ส่งให้ backend
  const daysFromDate = (d) => {
    if (!d) return 0;
    const target = new Date(`${d}T23:59:59+07:00`).getTime();
    return Math.max(1, Math.ceil((target - Date.now()) / 86400000));
  };
  const [granting, setGranting] = useState(false);
  // ปรับวันหมดอายุ (เพิ่ม/ลด) ของสมาชิกที่มีอยู่
  const [adjRow, setAdjRow] = useState(null);   // แถว tv_access ที่กำลังตั้งวันหมดอายุ
  const [adjMode, setAdjMode] = useState("days");   // days | date | lifetime
  const [adjDays, setAdjDays] = useState(30);
  const [adjDate, setAdjDate] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [editRow, setEditRow] = useState(null);   // แถวที่กำลังแก้ไขข้อมูล
  const [editForm, setEditForm] = useState({ display_name: "", username: "", email: "", trade_id: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState({}); // กำลังตรวจสิทธิ์ TradingView ต่อแถว
  const [collapsed, setCollapsed] = useState({});   // พับตารางต่อสคริปต์ (pine_id -> true)
  const [pageBy, setPageBy] = useState({});         // หน้าปัจจุบันต่อสคริปต์ (pine_id -> page)
  const [pageSize, setPageSize] = useState(20);
  // ช่วงวันที่ดูข้อมูล (กรองตามวันที่เพิ่มสมาชิก) — ค่าเริ่มต้น: วันนี้
  const thToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const thDayStr = (off) => new Date(Date.now() + 7 * 3600 * 1000 + off * 86400000).toISOString().slice(0, 10);
  const [rangeKey, setRangeKey] = useState("today");
  const [customFrom, setCustomFrom] = useState(thToday);
  const [customTo, setCustomTo] = useState(thToday);
  // export: เลือก indicator ที่จะดาวน์โหลด
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSel, setExportSel] = useState([]);

  async function load() {
    setLoading(true);
    const [{ data: sc }, { data: ac }, { data: u }, { data: tf }, { data: br }] = await Promise.all([
      supabase.from("tv_scripts").select("*").order("created_at"),
      supabase.from("tv_access").select("*").order("created_at", { ascending: false }),
      supabase.auth.getUser(),
      supabase.from("settings").select("value").eq("key", "tv_features").maybeSingle(),
      supabase.from("tv_brands").select("id, name, show_in_manager, active").order("created_at"),
    ]);
    setScripts(sc || []);
    setAccess(ac || []);
    setBrands(br || []);
    setReleased(tf?.value?.released === true);
    const visBr = (br || []).filter((b) => b.show_in_manager !== false);
    if (visBr.length && !visBr.some((b) => b.id === brandSel)) setBrandSel(visBr[0].id);
    // role admin?
    const email = u?.user?.email;
    if (email) {
      const { data: p } = await supabase.from("user_permissions").select("role").eq("email", email).maybeSingle();
      setIsAdmin(p?.role === "admin");
    }
    setUpdatedAt(new Date());
    setLoading(false);
  }
  useEffect(() => { if (active) load(); /* eslint-disable-next-line */ }, [active]);
  // เปลี่ยนแบรนด์ในฟอร์มเพิ่ม → ล้างสคริปต์ที่เลือกไว้ (สคริปต์คนละแบรนด์ไม่ปน)
  useEffect(() => { setPineIds([]); setDur({}); /* eslint-disable-next-line */ }, [brandSel]);
  // realtime: มีการเปลี่ยนสิทธิ์ → รีเฟรชฟีด
  useEffect(() => {
    if (!active) return;
    const ch = supabase.channel("tv-access").on("postgres_changes", { event: "*", schema: "public", table: "tv_access" }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [active]);

  const now = Date.now();
  const stats = {
    total: new Set(access.map((a) => a.username)).size,
    activeCount: access.filter((a) => a.status === "active").length,
    soon: access.filter((a) => a.status === "active" && a.expiration && new Date(a.expiration).getTime() - now < 7 * 86400000 && new Date(a.expiration).getTime() > now).length,
    scripts: scripts.length,
  };
  const expLabel = (a) => a.expiration ? new Date(a.expiration).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "ตลอดชีพ";
  // สถานะใช้งาน: active (เขียว) / Expired (แดง) / ถอนสิทธิ์ (เทา) / error (เหลือง)
  const statusInfo = (a) => {
    if (a.status === "revoked") return { label: "ถอนสิทธิ์", cls: "text-slate-400" };
    if (a.status === "error") return { label: "error", cls: "text-amber-500" };
    const expired = a.status === "expired" || (a.expiration && new Date(a.expiration).getTime() <= now);
    return expired ? { label: "Expired", cls: "text-rose-500" } : { label: "active", cls: "text-emerald-600" };
  };
  const canSeeNewTv = isAdmin || released;   // ฟีเจอร์ใหม่ (คอลัมน์อีเมล): เห็นเฉพาะแอดมินจนกว่าจะกดปล่อย
  const filtered = (a) => !q.trim() || `${a.username} ${a.display_name || ""} ${a.trade_id || ""} ${a.email || ""}`.toLowerCase().includes(q.trim().toLowerCase());
  // เรียงลำดับตามหัวคอลัมน์ (คลิกสลับ ขึ้น/ลง)
  const [sortKey, setSortKey] = useState("create");
  const [sortDir, setSortDir] = useState("desc");
  const toggleSort = (k) => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("asc"); } };
  const sortVal = (a, k) => {
    switch (k) {
      case "name": return (a.display_name || "").toLowerCase();
      case "user": return (a.username || "").toLowerCase();
      case "email": return (a.email || "").toLowerCase();
      case "trade": return (a.trade_id || "").toLowerCase();
      case "exp": return a.expiration ? new Date(a.expiration).getTime() : Infinity;   // ตลอดชีพ = ท้ายสุด
      case "status": return statusInfo(a).label;
      case "tvGranted": return a.tv_granted_at ? new Date(a.tv_granted_at).getTime() : 0;
      case "by": return (a.granted_by || "").toLowerCase();
      case "editby": return a.edited_at ? new Date(a.edited_at).getTime() : 0;
      default: return new Date(a.created_at || a.granted_at || 0).getTime();            // create
    }
  };
  const sortRows = (arr) => [...arr].sort((x, y) => {
    const vx = sortVal(x, sortKey), vy = sortVal(y, sortKey);
    const c = (typeof vx === "number" && typeof vy === "number") ? (vx - vy) : String(vx).localeCompare(String(vy), "th");
    return sortDir === "asc" ? c : -c;
  });
  // หัวคอลัมน์คลิกได้ + ลูกศรบอกทิศ (เป็น 1 ช่องใน grid ที่กำหนดความกว้างเอง)
  const H = ({ k, children }) => (
    <button type="button" onClick={() => toggleSort(k)} className={`min-w-0 flex items-center gap-0.5 uppercase text-left truncate hover:text-slate-600 ${sortKey === k ? "text-slate-600 font-semibold" : ""}`}>
      <span className="truncate">{children}</span>{sortKey === k && <span className="shrink-0">{sortDir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
  // ความกว้างคอลัมน์ (เลื่อนแนวนอนได้เมื่อจอแคบ) — ต่างกันตามมี/ไม่มีคอลัมน์อีเมล
  const COLS = canSeeNewTv
    ? "minmax(120px,1.4fr) minmax(110px,1.2fr) minmax(150px,1.5fr) 78px 96px 86px 112px 82px 100px 132px 84px"
    : "minmax(140px,1.6fr) minmax(120px,1.3fr) 78px 96px 86px 112px 92px 108px 132px 84px";
  const tableMinW = canSeeNewTv ? 1230 : 1090;
  const createLabel = (a) => { const d = a.created_at || a.granted_at; return d ? new Date(d).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "—"; };
  const tvGrantedLabel = (a) => a.tv_granted_at
    ? new Date(a.tv_granted_at).toLocaleString("th-TH", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "ยังไม่มีข้อมูล";
  // ช่วงวันที่ที่เลือก → ขอบเขตเวลา (เทียบกับวันที่เพิ่มสมาชิก created_at/granted_at)
  const RANGE_PRESETS = [["today", "วันนี้"], ["yesterday", "เมื่อวาน"], ["3d", "3 วันที่ผ่านมา"], ["7d", "7 วันที่ผ่านมา"], ["30d", "30 วันที่ผ่านมา"], ["custom", "เลือกเอง"]];
  const rangeBounds = () => {
    let from, to;
    switch (rangeKey) {
      case "yesterday": from = thDayStr(-1); to = thDayStr(-1); break;
      case "3d": from = thDayStr(-2); to = thDayStr(0); break;
      case "7d": from = thDayStr(-6); to = thDayStr(0); break;
      case "30d": from = thDayStr(-29); to = thDayStr(0); break;
      case "custom": from = customFrom; to = customTo; break;
      default: from = thDayStr(0); to = thDayStr(0);
    }
    return { from, to, startMs: new Date(`${from}T00:00:00+07:00`).getTime(), endMs: new Date(`${to}T23:59:59.999+07:00`).getTime() };
  };
  const rb = rangeBounds();
  // กรองจากเวลาที่ให้สิทธิ์ล่าสุด ไม่ใช่ created_at เพียงอย่างเดียว
  // สมาชิกเดิมที่กดให้สิทธิ์ซ้ำจึงปรากฏในช่วง "วันนี้" ได้ถูกต้อง
  const memberGrantedAt = (a) => a.last_granted_at || a.granted_at || a.created_at;
  const inRange = (a) => { const cm = new Date(memberGrantedAt(a) || 0).getTime(); return cm >= rb.startMs && cm <= rb.endMs; };
  const fmtDMY2 = (s) => { const [y, m, d] = String(s).split("-"); return `${Number(d)}/${Number(m)}/${String(y).slice(2)}`; };
  const rangeLabel = rb.from === rb.to ? fmtDMY2(rb.from) : `${fmtDMY2(rb.from)} – ${fmtDMY2(rb.to)}`;
  // สรุปตัวเลขต่อสคริปต์ (ใช้ในการ์ดสรุปด้านบน) — กรองตามช่วงวันที่ที่เลือก
  const scriptStat = (s) => {
    const rows = access.filter((a) => a.pine_id === s.pine_id && inRange(a));
    const isActive = (a) => statusInfo(a).label === "active";
    const soon = rows.filter((a) => a.status !== "revoked" && a.expiration && new Date(a.expiration).getTime() > now && new Date(a.expiration).getTime() - now < 7 * 86400000).length;
    const expired = rows.filter((a) => statusInfo(a).label === "Expired").length;
    const latest = rows.slice().sort((x, y) => new Date(memberGrantedAt(y) || 0) - new Date(memberGrantedAt(x) || 0))[0];
    return { total: rows.length, active: rows.filter(isActive).length, soon, expired, latest };
  };

  // ป้ายสรุประยะเวลาต่อสคริปต์
  const durLabel = (d) => d.mode === "lifetime" ? "ตลอดชีพ"
    : d.mode === "date" ? `ถึง ${d.expDate ? new Date(`${d.expDate}T00:00:00+07:00`).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}`
    : `${Number(d.days) || 30} วัน`;
  async function grant() {
    if (!uname.trim()) { setMsg("ใส่ TradingView username ก่อน"); return; }
    if (!pineIds.length) { setMsg("เลือกสคริปต์อย่างน้อย 1 อัน"); return; }
    if (!tradeId.trim()) { setMsg("ใส่ไอดีเทรดก่อน (ระบบจะเช็คก่อนให้สิทธิ์)"); return; }
    // ตรวจวันหมดอายุของทุกสคริปต์ที่เลือก (โหมดปฏิทินต้องเลือกวันที่ถูกต้อง)
    for (const pid of pineIds) {
      const d = getDur(pid);
      if (d.mode === "date" && (!d.expDate || d.expDate < todayTH)) { setMsg(`เลือกวันหมดอายุของ "${scripts.find((s) => s.pine_id === pid)?.name || pid}" ให้ถูกต้องก่อน`); return; }
    }
    setGranting(true);
    // 1) เช็คไอดีเทรดก่อน — ต้องผ่านถึงจะเพิ่มสิทธิ์ TV
    setMsg("กำลังเช็คไอดีเทรด...");
    const { data: vt, error: ve } = await supabase.functions.invoke("verify-trade-id", { body: { trade_id: tradeId.trim() } });
    if (ve || !vt?.ok) { setGranting(false); setMsg("✗ เช็คไอดีเทรดไม่สำเร็จ: " + (vt?.error || (ve ? "ลองใหม่" : ""))); return; }
    if (!vt.pass) { setGranting(false); setMsg(`✗ ไอดีเทรด "${tradeId.trim()}" ไม่ผ่าน — ยังเพิ่มสิทธิ์ TradingView ไม่ได้`); return; }
    // 2) ผ่านแล้ว → ให้สิทธิ์ทีละสคริปต์ (แต่ละตัวใช้วันหมดอายุของตัวเอง)
    const summ = []; const fails = []; let realUser = uname.trim();
    for (const pid of pineIds) {
      const d = getDur(pid);
      // โหมดปฏิทิน = ส่งวันหมดอายุ (สิ้นวันที่เลือก เวลาไทย) ตรงๆ ไม่แปลงเป็นจำนวนวัน (normalize พ.ศ.→ค.ศ.)
      const expIso = d.mode === "date" && d.expDate ? new Date(`${beToCe(d.expDate)}T23:59:59+07:00`).toISOString() : null;
      const effDays = d.mode === "days" ? (Number(d.days) || 30) : 0;
      const name = scripts.find((s) => s.pine_id === pid)?.name || pid;
      setMsg(`✓ ไอดีเทรดผ่าน — กำลังเพิ่ม "${name}"...`);
      const { data, error } = await supabase.functions.invoke("tradingview", { body: {
        action: "grant", username: uname.trim(), display_name: dname.trim() || null, email: demail.trim() || null,
        pine_ids: [pid], lifetime: d.mode === "lifetime", days: effDays, expiration: expIso, trade_id: tradeId.trim(),
      } });
      if (error || !data?.ok) fails.push(`${name}: ${data?.error || data?.results?.[0]?.error || "ลองใหม่"}`);
      else { realUser = data.username || realUser; summ.push(`${name} (${durLabel(d)})`); }
    }
    setGranting(false);
    if (!summ.length) { setMsg("✗ เพิ่มสิทธิ์ไม่สำเร็จ: " + (fails.join(" · ") || "ลองใหม่")); return; }
    setMsg(`✓ ให้สิทธิ์ ${realUser} แล้ว: ${summ.join(", ")}${fails.length ? ` · ไม่สำเร็จ: ${fails.join(" · ")}` : ""}`);
    setUname(""); setDname(""); setDemail(""); setTradeId(""); setDur({});
    load();
  }
  async function revoke(a) {
    if (!confirm(`ถอนสิทธิ์ ${a.username} ออกจาก "${scripts.find((s) => s.pine_id === a.pine_id)?.name || a.pine_id}"?\n(ถอนสิทธิ์บน TradingView อย่างเดียว — ยังเก็บข้อมูลไว้ในตาราง สถานะจะเป็น "ถอนสิทธิ์")`)) return;
    setMsg(`กำลังถอนสิทธิ์ ${a.username}...`);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "revoke", username: a.username, pine_id: a.pine_id } });
    if (error || !data?.ok) { setMsg("✗ ถอนสิทธิ์ไม่สำเร็จ: " + (data?.error || "ลองใหม่")); return; }
    setMsg(`✓ ถอนสิทธิ์ ${a.username} บน TradingView แล้ว (สถานะ: ถอนสิทธิ์)`);
    load();
  }
  async function checkAccess(a) {
    setCheckingAccess((cur) => ({ ...cur, [a.id]: true }));
    setMsg(`กำลังตรวจสิทธิ์ ${a.username} บน TradingView...`);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "check_access", id: a.id } });
    setCheckingAccess((cur) => { const next = { ...cur }; delete next[a.id]; return next; });
    if (error || !data?.ok) {
      setMsg("✗ ตรวจสิทธิ์ไม่สำเร็จ: " + (data?.error || error?.message || "ลองใหม่"));
      load();
      return;
    }
    const grantedText = data.tv_granted_at
      ? ` · เพิ่มสิทธิ์บน TV: ${new Date(data.tv_granted_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`
      : " · TV ไม่ส่งวันที่เพิ่มสิทธิ์";
    setMsg(data.found
      ? `✓ ${a.username} ยังมีสิทธิ์บน TradingView${grantedText}`
      : `✓ ${a.username} ไม่พบสิทธิ์บน TradingView แล้ว${grantedText}`);
    load();
  }
  // ตั้งวันหมดอายุใหม่ (จำกัดวัน/ปฏิทิน/ตลอดชีพ) — ยิง grant ใหม่ (n8n จะอัปเดตบน TradingView ให้)
  function openExpiry(a) { setAdjRow(a); setAdjMode(a.expiration ? "date" : "lifetime"); setAdjDays(30); setAdjDate(a.expiration ? new Date(a.expiration).toISOString().slice(0, 10) : todayTH); }
  async function applyExpiry() {
    const a = adjRow; if (!a) return;
    if (adjMode === "date" && (!adjDate || beToCe(adjDate) < todayTH)) { setMsg("เลือกวันหมดอายุที่ถูกต้องก่อน"); return; }
    const expIso = adjMode === "date" && adjDate ? new Date(`${beToCe(adjDate)}T23:59:59+07:00`).toISOString() : null;
    const effDays = adjMode === "days" ? (Number(adjDays) || 30) : 0;
    setAdjusting(true);
    setMsg(`กำลังตั้งวันหมดอายุให้ ${a.username}...`);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: {
      action: "grant", username: a.username, pine_ids: [a.pine_id],
      display_name: a.display_name || null, email: a.email || null,
      lifetime: adjMode === "lifetime", days: effDays, expiration: expIso, trade_id: a.trade_id || null,
    } });
    setAdjusting(false);
    if (error || !data?.ok) { setMsg("✗ ตั้งวันหมดอายุไม่สำเร็จ: " + (data?.error || data?.results?.[0]?.error || "ลองใหม่")); return; }
    const label = adjMode === "lifetime" ? "ตลอดชีพ" : `หมดอายุ ${new Date(data.expiration || expIso || Date.now()).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" })}`;
    setMsg(`✓ ตั้งให้ ${a.username} แล้ว — ${label}`);
    setAdjRow(null); load();
  }
  // แก้ไขข้อมูลสมาชิก (ชื่อ/USER TV/อีเมล/Trade ID)
  function openEdit(a) { setEditRow(a); setEditForm({ display_name: a.display_name || "", username: a.username || "", email: a.email || "", trade_id: a.trade_id || "" }); }
  async function saveEdit() {
    const a = editRow; if (!a) return;
    const nextUsername = editForm.username.trim();
    if (!nextUsername) { setMsg("USER TV ห้ามว่าง"); return; }
    const usernameChanged = nextUsername.toLowerCase() !== String(a.username || "").trim().toLowerCase();
    if (usernameChanged && !confirm(`ย้ายสิทธิ์จาก USER TV \"${a.username}\" ไปเป็น \"${nextUsername}\"?\n\nระบบจะถอนสิทธิ์ชื่อเดิมบน TradingView แล้วให้สิทธิ์ชื่อใหม่ในสคริปต์นี้`)) return;
    setEditSaving(true);
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "update_member", id: a.id, display_name: editForm.display_name, username: nextUsername, email: editForm.email, trade_id: editForm.trade_id } });
    setEditSaving(false);
    if (error || !data?.ok) { setMsg("✗ แก้ไขไม่สำเร็จ: " + (data?.error || "")); return; }
    setEditRow(null);
    setMsg(data?.username_changed
      ? `✓ เปลี่ยน USER TV แล้ว — ถอนสิทธิ์ ${data.old_username} และให้สิทธิ์ ${data.username} เรียบร้อย`
      : "✓ แก้ไขข้อมูลสมาชิกแล้ว");
    load();
  }
  async function deleteScript(s) {
    if (!confirm(`ลบสคริปต์ "${s.name}" ออกจากระบบ?\n(ลบเฉพาะในแอป ไม่ถอนสิทธิ์บน TradingView — สมาชิกในสคริปต์นี้จะหายจากลิสต์ด้วย)`)) return;
    const { data, error } = await supabase.functions.invoke("tradingview", { body: { action: "delete_script", pine_id: s.pine_id } });
    if (error || !data?.ok) { setMsg("✗ ลบสคริปต์ไม่สำเร็จ: " + (data?.error || "")); return; }
    setPineIds((cur) => cur.filter((p) => p !== s.pine_id));
    load();
  }
  function exportCsv(selPineIds) {
    const sel = selPineIds && selPineIds.length ? selPineIds : scripts.map((s) => s.pine_id);
    const includeIndicator = sel.length > 1;
    const headers = [
      ...(includeIndicator ? ["Indicator"] : []),
      "ชื่อลูกค้า", "User TV", ...(canSeeNewTv ? ["อีเมล"] : []), "สถานะ", "Trade ID",
      "หมดอายุ", "เพิ่มสิทธิ์บน TV", "Create", "คนเพิ่ม", "แก้ไขโดย",
    ];
    const rows = [headers];
    const scriptNames = new Map(scripts.map((s) => [s.pine_id, s.name || s.pine_id]));
    for (const a of access) {
      if (!sel.includes(a.pine_id) || !inRange(a)) continue;   // เฉพาะ indicator ที่เลือก + อยู่ในช่วงวันที่กำลังดู
      const st = statusInfo(a);
      const editedBy = a.edited_at
        ? `${a.edited_by || "—"} · ${new Date(a.edited_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}`
        : "—";
      rows.push([
        ...(includeIndicator ? [scriptNames.get(a.pine_id) || a.pine_id] : []),
        a.display_name || "—", a.username || "", ...(canSeeNewTv ? [a.email || "—"] : []), st.label,
        a.trade_id || "—", expLabel(a), tvGrantedLabel(a), createLabel(a), a.granted_by || "—", editedBy,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `tv-members-${rb.from}${rb.from !== rb.to ? `_${rb.to}` : ""}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const St = ({ label, value, tone }) => (
    <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${tone || "text-slate-800"}`}>{value}</div>
    </div>
  );
  // การ์ดสรุปย่อย (ในการ์ดสรุปต่อสคริปต์)
  const SumCard = ({ label, value, unit, tone, icon, small }) => (
    <div className="bg-slate-50/60 rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] text-slate-400 leading-tight">{label}</div>
        <span className="shrink-0">{icon}</span>
      </div>
      <div className={`${small ? "text-lg" : "text-2xl"} font-bold mt-1 ${tone || "text-slate-800"} truncate`}>{value}</div>
      {unit && <div className="text-[11px] text-slate-400 truncate">{unit}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* modal เลือก Indicator ที่จะ export */}
      {exportOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => setExportOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Export CSV</h3>
              <button onClick={() => setExportOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div className="text-xs text-slate-500">ช่วงวันที่: <span className="text-slate-700 font-medium">{rangeLabel}</span> (ตามที่กำลังดูอยู่)</div>
            <div>
              <div className="text-xs text-slate-500 mb-1 flex items-center justify-between">
                <span>เลือก Indicator ที่จะ export</span>
                <button onClick={() => setExportSel(exportSel.length === scripts.length ? [] : scripts.map((s) => s.pine_id))} className="text-[11px] text-brand-600 hover:underline">{exportSel.length === scripts.length ? "ล้าง" : "เลือกทั้งหมด"}</button>
              </div>
              <div className="rounded-lg border border-slate-300 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {scripts.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">ยังไม่มีสคริปต์</div>}
                {[...brands, { id: "__none", name: "ไม่มีแบรนด์" }].map((b) => {
                  const bScripts = scripts.filter((s) => (b.id === "__none" ? !s.brand_id : s.brand_id === b.id));
                  if (!bScripts.length) return null;
                  return (
                    <div key={"exb-" + b.id}>
                      <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-semibold text-slate-500">{b.name}</div>
                      {bScripts.map((s) => {
                        const on = exportSel.includes(s.pine_id);
                        const cnt = access.filter((a) => a.pine_id === s.pine_id && inRange(a)).length;
                        return (
                          <label key={s.pine_id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                            <input type="checkbox" checked={on} onChange={() => setExportSel((cur) => on ? cur.filter((p) => p !== s.pine_id) : [...cur, s.pine_id])} />
                            <span className="truncate flex-1">{s.name}</span>
                            <span className="text-[11px] text-slate-400">{cnt} คน</span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setExportOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">ยกเลิก</button>
              <button onClick={() => { exportCsv(exportSel); setExportOpen(false); }} disabled={!exportSel.length} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">ดาวน์โหลด</button>
            </div>
          </div>
        </div>
      )}
      {/* modal ตั้งวันหมดอายุ (จำกัดวัน / ปฏิทิน / ตลอดชีพ) */}
      {adjRow && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => !adjusting && setAdjRow(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Clock size={16} /> ตั้งวันหมดอายุ</h3>
              <button onClick={() => !adjusting && setAdjRow(null)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div className="text-sm text-slate-600">
              <div className="font-medium text-slate-800">{adjRow.username}{adjRow.display_name ? ` · ${adjRow.display_name}` : ""}</div>
              <div className="text-xs text-slate-500 mt-0.5">หมดอายุปัจจุบัน: {adjRow.expiration ? new Date(adjRow.expiration).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "ตลอดชีพ"}</div>
            </div>
            <div>
              <label className="text-xs text-slate-500">ระยะเวลา</label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1 text-sm">
                <label className="flex items-center gap-1.5"><input type="radio" checked={adjMode === "lifetime"} onChange={() => setAdjMode("lifetime")} /> ตลอดชีพ</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={adjMode === "days"} onChange={() => setAdjMode("days")} /> จำกัดวัน</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={adjMode === "date"} onChange={() => setAdjMode("date")} /> เลือกวันหมดอายุ</label>
              </div>
            </div>
            {adjMode === "days" && (
              <div>
                <label className="text-xs text-slate-500">จำนวนวัน (นับจากวันนี้)</label>
                <input type="number" min={1} value={adjDays} onChange={(e) => setAdjDays(e.target.value)} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            )}
            {adjMode === "date" && (
              <div>
                <label className="text-xs text-slate-500">วันหมดอายุ (เลือกจากปฏิทิน)</label>
                <input type="date" value={adjDate} min={todayTH} onChange={(e) => setAdjDate(beToCe(e.target.value))} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdjRow(null)} disabled={adjusting} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">ยกเลิก</button>
              <button onClick={applyExpiry} disabled={adjusting} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">{adjusting ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}
      {/* modal แก้ไขข้อมูลสมาชิก */}
      {editRow && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => !editSaving && setEditRow(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Pencil size={15} /> แก้ไขข้อมูลสมาชิก</h3>
              <button onClick={() => !editSaving && setEditRow(null)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div><label className="text-xs text-slate-500">ชื่อลูกค้า</label><input value={editForm.display_name} onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-slate-500">USER TV</label><input value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-slate-500">อีเมล</label><input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-slate-500">Trade ID</label><input value={editForm.trade_id} onChange={(e) => setEditForm({ ...editForm, trade_id: e.target.value })} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            {editForm.username.trim().toLowerCase() !== String(editRow.username || "").trim().toLowerCase() && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ระบบจะถอนสิทธิ์ <b>{editRow.username}</b> บน TradingView แล้วให้สิทธิ์ <b>{editForm.username.trim() || "ชื่อใหม่"}</b> ในสคริปต์เดิม
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditRow(null)} disabled={editSaving} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">ยกเลิก</button>
              <button onClick={saveEdit} disabled={editSaving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">{editSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}
      {/* หัว — เดิมเป็น "Access Console" + ป้าย "· Live Member Feed ·" ภาษาอังกฤษ
          ซึ่งไม่เข้าชุดกับทุกหน้าที่เป็นไทย และไม่ได้บอกว่าหน้านี้ทำอะไร */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="ds-title text-[22px] sm:text-[26px]">สมาชิก TradingView</h2>
          <p className="mt-1.5 text-[13.5px] text-slate-500">ให้สิทธิ์ ต่ออายุ และถอนสิทธิ์อินดิเคเตอร์ของลูกค้า</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> อัปเดต {updatedAt ? updatedAt.toLocaleTimeString("th-TH") : "—"}</span>
          <button onClick={load} disabled={loading} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">รีเฟรช</button>
        </div>
      </div>

      {msg && <div className="text-sm rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-slate-700">{msg}</div>}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ซ้าย: ฟอร์มเพิ่มสมาชิก */}
        <div className="lg:w-80 shrink-0 bg-white rounded-2xl border border-slate-200 p-5 space-y-3 h-fit">
          <h3 className="font-semibold text-slate-800">เพิ่มสมาชิกใหม่</h3>
          <div>
            <label className="text-xs text-slate-500">TradingView username</label>
            <input value={uname} onChange={(e) => setUname(e.target.value)} placeholder="username TV" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">ชื่อลูกค้า</label>
            <input value={dname} onChange={(e) => setDname(e.target.value)} placeholder="ชื่อลูกค้า" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          {canSeeNewTv && (
          <div>
            <label className="text-xs text-slate-500">อีเมลลูกค้า</label>
            <input value={demail} onChange={(e) => setDemail(e.target.value)} placeholder="อีเมลลูกค้า (ถ้ามี)" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          )}
          <div>
            <label className="text-xs text-slate-500">ไอดีเทรด (XM)</label>
            <input value={tradeId} onChange={(e) => setTradeId(e.target.value)} placeholder="เลขไอดีเทรด — ต้องผ่านก่อนถึงเพิ่มได้" className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">แบรนด์</label>
            <select value={brandSel ?? ""} onChange={(e) => setBrandSel(Number(e.target.value) || null)} className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
              {brands.filter((b) => b.show_in_manager !== false).length === 0 && <option value="">ยังไม่มีแบรนด์</option>}
              {brands.filter((b) => b.show_in_manager !== false).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">สคริปต์ (เลือกได้หลายอัน — กำหนดวันหมดอายุแยกแต่ละตัว)</label>
            <div className="mt-1 rounded-lg border border-slate-300 divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {scripts.filter((s) => s.brand_id === brandSel).length === 0 && <div className="px-3 py-2 text-sm text-slate-400">แบรนด์นี้ยังไม่มีสคริปต์</div>}
              {scripts.filter((s) => s.brand_id === brandSel).map((s) => {
                const on = pineIds.includes(s.pine_id);
                const d = getDur(s.pine_id);
                return (
                  <div key={s.pine_id} className={on ? "bg-brand-50/40" : ""}>
                    <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={on} onChange={() => toggleScript(s.pine_id, on)} />
                      <span className="truncate flex-1">{s.name}</span>
                      {on && <span className="text-[11px] text-slate-400 shrink-0">{durLabel(d)}</span>}
                    </label>
                    {on && (
                      <div className="px-3 pb-2.5 pl-8 space-y-1.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "lifetime"} onChange={() => setDurFor(s.pine_id, { mode: "lifetime" })} /> ตลอดชีพ</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "days"} onChange={() => setDurFor(s.pine_id, { mode: "days" })} /> จำกัดวัน</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={d.mode === "date"} onChange={() => setDurFor(s.pine_id, { mode: "date" })} /> เลือกวัน</label>
                        </div>
                        {d.mode === "days" && <input type="number" min={1} value={d.days} onChange={(e) => setDurFor(s.pine_id, { days: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />}
                        {d.mode === "date" && <input type="date" value={d.expDate} min={todayTH} onChange={(e) => setDurFor(s.pine_id, { expDate: beToCe(e.target.value) })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {pineIds.length > 0 && <div className="text-[11px] text-slate-400 mt-1">เลือกแล้ว {pineIds.length} สคริปต์</div>}
          </div>
          <button onClick={grant} disabled={granting} className="w-full rounded-lg bg-brand-600 text-white py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
            {granting ? "กำลังเพิ่ม..." : "เพิ่มสิทธิ์"}
          </button>
        </div>

        {/* ขวา: ค้นหา + รายชื่อต่อสคริปต์ */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* ช่วงวันที่ดูข้อมูล (กรองตามวันที่เพิ่มสมาชิก) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 mr-1">ช่วงวันที่:</span>
            {RANGE_PRESETS.map(([key, label]) => (
              <button key={key} onClick={() => setRangeKey(key)} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${rangeKey === key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>{label}</button>
            ))}
            {rangeKey === "custom" && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} max={thToday} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                <span className="text-slate-400 text-xs">ถึง</span>
                <input type="date" value={customTo} max={thToday} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
              </div>
            )}
            <span className="ml-auto text-xs text-slate-400">แสดง: {rangeLabel}</span>
          </div>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา username, ชื่อ, หรือเลข trade id" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          {/* จัดกลุ่มตามแบรนด์ (เฉพาะแบรนด์ที่โชว์ในหน้าจัดการ) — นับ/แสดง/export แยกกัน ไม่ปน */}
          {brands.filter((b) => b.show_in_manager !== false).map((b) => {
            const brScripts = scripts.filter((s) => s.brand_id === b.id);
            const brMembers = access.filter((a) => brScripts.some((s) => s.pine_id === a.pine_id) && inRange(a));
            const brCollapsed = collapsed["brand:" + b.id];
            return (
            <div key={"brand-" + b.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                <button onClick={() => setCollapsed((c) => ({ ...c, ["brand:" + b.id]: !brCollapsed }))} className="flex items-center gap-2 min-w-0">
                  {brCollapsed ? <ChevronDown size={18} className="text-slate-400 shrink-0" /> : <ChevronUp size={18} className="text-slate-400 shrink-0" />}
                  <h2 className="text-lg font-bold text-slate-800 truncate">{b.name}</h2>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-400">{new Set(brMembers.map((a) => a.username)).size} สมาชิก · {brScripts.length} สคริปต์</span>
                  <button onClick={() => { setExportSel(brScripts.map((s) => s.pine_id)); setExportOpen(true); }} className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-slate-600 hover:bg-slate-50">Export</button>
                </div>
              </div>
              {!brCollapsed && brScripts.length === 0 && <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center text-xs text-slate-400">แบรนด์นี้ยังไม่มีสคริปต์ — เพิ่มที่ ตั้งค่า → ตั้งค่า TV</div>}
              {!brCollapsed && brScripts.map((s) => {
                const ss = scriptStat(s);
                const open = !collapsed["sum:" + s.pine_id];
                return (
                  <div key={"sum-" + s.pine_id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-800 truncate">{s.name}</h3>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-slate-400">{ss.total} สมาชิก</span>
                        <button onClick={() => setCollapsed((c) => ({ ...c, ["sum:" + s.pine_id]: open }))} className="text-slate-400 hover:text-slate-600">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                      </div>
                    </div>
                    {open && (
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                        <SumCard label="ทั้งหมด" value={ss.total} unit="สมาชิก" icon={<Users size={16} className="text-brand-600" />} />
                        <SumCard label="Active" value={ss.active} unit="สมาชิก" tone="text-emerald-600" icon={<span className="w-2 h-2 rounded-full bg-emerald-500 inline-block mt-1.5" />} />
                        <SumCard label="หมดอายุภายใน 7 วัน" value={ss.soon} unit="สมาชิก" tone="text-amber-500" icon={<Clock size={16} className="text-amber-400" />} />
                        <SumCard label="หมดอายุแล้ว" value={ss.expired} unit="สมาชิก" tone="text-rose-500" icon={<CalendarX2 size={16} className="text-rose-400" />} />
                        <SumCard label="เพิ่มล่าสุด" value={ss.latest ? createLabel(ss.latest) : "—"} unit={ss.latest?.username || "—"} small icon={<CalendarPlus size={16} className="text-violet-400" />} />
                      </div>
                    )}
                  </div>
                );
              })}
              {!brCollapsed && brScripts.map((s) => {
            const allRows = sortRows(access.filter((a) => a.pine_id === s.pine_id && filtered(a) && inRange(a)));
            const open = !collapsed[s.pine_id];
            const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
            const page = Math.min(pageBy[s.pine_id] || 1, totalPages);
            const pageRows = allRows.slice((page - 1) * pageSize, page * pageSize);
            return (
              <div key={s.pine_id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">{s.name}</div>
                    {s.script_key && <div className="text-[11px] text-slate-400 truncate">{s.script_key}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500">{allRows.length} สมาชิก</span>
                    {isAdmin && <button onClick={() => deleteScript(s)} className="flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 rounded-md px-2 py-1" title="ลบสคริปต์นี้"><Trash2 size={13} /> ลบสคริปต์</button>}
                    <button onClick={() => setCollapsed((c) => ({ ...c, [s.pine_id]: open }))} className="text-slate-400 hover:text-slate-600">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                  </div>
                </div>
                {open && <>
                <div className="overflow-x-auto">
                  <div className="divide-y divide-slate-100" style={{ minWidth: tableMinW }}>
                    <div className="grid gap-2 px-4 py-2 text-[11px] text-slate-400" style={{ gridTemplateColumns: COLS }}>
                      <H k="name">ชื่อลูกค้า</H><H k="user">User TV</H>{canSeeNewTv && <H k="email">อีเมล</H>}<H k="status">สถานะ</H><H k="trade">Trade ID</H><H k="exp">หมดอายุ</H><H k="tvGranted">เพิ่มสิทธิ์บน TV</H><H k="create">Create</H><H k="by">คนเพิ่ม</H><H k="editby">แก้ไขโดย</H><span></span>
                    </div>
                    {pageRows.length === 0 ? <div className="px-4 py-6 text-center text-xs text-slate-500">ยังไม่มีสมาชิกในสคริปต์นี้</div> : pageRows.map((a) => {
                      const st = statusInfo(a);
                      const nearExp = a.expiration && new Date(a.expiration).getTime() - now < 7 * 86400000 && new Date(a.expiration).getTime() > now;
                      return (
                      <div key={a.id} className="grid gap-2 px-4 py-2.5 text-sm items-center" style={{ gridTemplateColumns: COLS }}>
                        {a.display_name && (a.trade_id || a.username)
                          ? <a href={`${window.location.pathname}?tab=inbox&${a.trade_id ? `open_trade=${encodeURIComponent(a.trade_id)}` : `open_tv=${encodeURIComponent(a.username)}`}`} target="_blank" rel="noopener noreferrer" className="min-w-0 font-medium text-brand-600 hover:text-brand-700 hover:underline truncate" title={`เปิดแชทของ ${a.display_name}`}>{a.display_name}</a>
                          : <span className="min-w-0 font-medium text-slate-800 truncate" title={a.display_name || ""}>{a.display_name || "—"}</span>}
                        <span className="min-w-0 text-slate-600 truncate" title={a.username}>{a.username}</span>
                        {canSeeNewTv && <span className="min-w-0 text-slate-500 truncate text-xs" title={a.email || ""}>{a.email || "—"}</span>}
                        <span className="min-w-0 flex flex-col items-start gap-0.5 truncate">
                          <span className={`text-xs font-semibold truncate ${st.cls}`}>{st.label}</span>
                          {a.tv_verified_at && (
                            <span className={`text-[10px] font-medium truncate ${a.tv_access_verified === true ? "text-emerald-600" : a.tv_access_verified === false ? "text-rose-500" : "text-amber-500"}`} title={a.tv_verify_error || "ตรวจสิทธิ์ล่าสุด"}>
                              {a.tv_access_verified === true ? "TV: มีสิทธิ์" : a.tv_access_verified === false ? "TV: ไม่พบสิทธิ์" : "TV: ตรวจไม่ได้"}
                            </span>
                          )}
                        </span>
                        <span className="text-slate-500 truncate text-xs" title={a.trade_id || ""}>{a.trade_id || "—"}</span>
                        <span className={`text-xs truncate ${nearExp ? "text-amber-500" : "text-slate-500"}`}>{expLabel(a)}</span>
                        <span className={`text-xs truncate ${a.tv_granted_at ? "text-violet-600" : "text-slate-400"}`} title={a.tv_granted_at ? "วันที่ที่ TradingView ระบุว่าเพิ่มสิทธิ์" : "การตรวจจาก TradingView ยังไม่ส่งวันที่เพิ่มสิทธิ์"}>{tvGrantedLabel(a)}</span>
                        <span className="text-xs text-slate-500 truncate">{createLabel(a)}</span>
                        <span className="text-xs text-slate-500 truncate" title={a.granted_by || ""}>{a.granted_by || "—"}</span>
                        <span className="text-xs text-slate-500 truncate min-w-0" title={a.edited_by || ""}>{a.edited_at ? <>{a.edited_by || "—"} <span className="text-slate-400">· {new Date(a.edited_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}</span></> : "—"}</span>
                        <span className="flex items-center justify-end gap-1.5">
                          <button onClick={() => checkAccess(a)} disabled={!!checkingAccess[a.id]} className="text-slate-400 hover:text-emerald-600 disabled:opacity-50" title="ตรวจสิทธิ์บน TradingView">
                            {checkingAccess[a.id] ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                          </button>
                          <button onClick={() => openEdit(a)} className="text-slate-400 hover:text-slate-700" title="แก้ไขข้อมูล"><Pencil size={14} /></button>
                          <button onClick={() => openExpiry(a)} className="text-slate-400 hover:text-brand-600" title="ตั้งวันหมดอายุ"><Clock size={15} /></button>
                          <button onClick={() => revoke(a)} className="text-slate-400 hover:text-rose-600" title="ถอนสิทธิ์ (ออกจาก TV อย่างเดียว)"><X size={16} /></button>
                        </span>
                      </div>
                      );
                    })}
                  </div>
                </div>
                {allRows.length > pageSize && (
                  <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 text-sm">
                    <div className="flex items-center gap-1.5">
                      <button disabled={page <= 1} onClick={() => setPageBy((p) => ({ ...p, [s.pine_id]: page - 1 }))} className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-40 hover:bg-slate-50">‹ ก่อนหน้า</button>
                      <span className="px-2 text-slate-500">หน้า {page}/{totalPages}</span>
                      <button disabled={page >= totalPages} onClick={() => setPageBy((p) => ({ ...p, [s.pine_id]: page + 1 }))} className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-40 hover:bg-slate-50">ถัดไป ›</button>
                    </div>
                    <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPageBy({}); }} className="rounded-lg border border-slate-300 px-2 py-1 text-sm bg-white">
                      <option value={20}>20 / หน้า</option><option value={50}>50 / หน้า</option><option value={100}>100 / หน้า</option>
                    </select>
                  </div>
                )}
                </>}
              </div>
            );
          })}
            </div>
            );
          })}
          {brands.filter((b) => b.show_in_manager !== false).length === 0 && <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-400">ยังไม่มีแบรนด์ที่โชว์ในหน้านี้ — เพิ่ม/ตั้งค่าแบรนด์ที่ <b>ตั้งค่า → ตั้งค่า TV</b></div>}
        </div>
      </div>
    </div>
  );
}
