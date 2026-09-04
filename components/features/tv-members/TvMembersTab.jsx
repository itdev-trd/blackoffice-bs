"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { beToCe } from "@/lib/utils/date";
import { X, Clock, Pencil, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Trash2, Loader2, Eye, Users, CheckCircle2, AlertTriangle, Tv } from "lucide-react";
import { Button, SectionTitle, StatCard } from "@/components/ui";

export default function TvMembersTab({ active = true, embedded = false }) {
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
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [datePickerField, setDatePickerField] = useState("from");
  const [draftFrom, setDraftFrom] = useState(thToday);
  const [draftTo, setDraftTo] = useState(thToday);
  const [pickerMonth, setPickerMonth] = useState(() => new Date(`${thToday}T12:00:00+07:00`));
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
    // นับ "คน" ไม่ใช่ "แถว" ทั้งสองช่อง — คนเดียวที่มีสองสคริปต์ต้องนับหนึ่ง
    // เดิม total นับคนแต่ activeCount นับแถว ทำให้ "กำลังใช้งาน" มากกว่า "สมาชิกทั้งหมด"
    total: new Set(access.map((a) => a.username)).size,
    activeCount: new Set(access.filter((a) => a.status === "active").map((a) => a.username)).size,
    soon: new Set(access.filter((a) => a.status === "active" && a.expiration && new Date(a.expiration).getTime() - now < 7 * 86400000 && new Date(a.expiration).getTime() > now).map((a) => a.username)).size,
    scripts: scripts.length,
  };
  const expLabel = (a) => a.expiration ? new Date(a.expiration).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "ตลอดชีพ";
  // สถานะใช้งาน — ป้ายเดียวจบ ไม่ซ้อนสองบรรทัดเหมือนเดิม
  // เดิมโชว์ "active" แล้วต่อด้วย "TV: มีสิทธิ์" ใต้บรรทัด ซึ่งเป็นข้อมูลเดียวกัน
  // (สถานะถูกคำนวณจาก TradingView อยู่แล้ว) กินที่และทำให้แถวสูงเกินจำเป็น
  // เทียบแบบไม่สนตัวพิมพ์ เพราะข้อมูลที่นำเข้าจากระบบเก่าเขียน "Expired" ตัวใหญ่
  const STATUS_TONE = {
    active:  { bg: "rgb(var(--n-ok) / .13)",    fg: "var(--ok)" },
    expired: { bg: "rgb(var(--n-bad) / .13)",   fg: "var(--bad)" },
    warn:    { bg: "rgb(var(--n-warn) / .15)",  fg: "var(--warn)" },
    muted:   { bg: "rgb(var(--n-ink-3) / .13)", fg: "var(--ink-3)" },
  };
  // key = ค่าคงที่สำหรับนับ/กรอง · label = ข้อความที่คนอ่าน (เปลี่ยนได้ไม่กระทบตัวนับ)
  const statusInfo = (a) => {
    const s = String(a.status || "").toLowerCase();
    if (s === "revoked" || a.status === "ถอนสิทธิ์")
      return { key: "revoked", label: "ถอนสิทธิ์", tone: "muted", hint: "ถอนสิทธิ์ออกจาก TradingView แล้ว" };
    // error = ในฐานมีข้อมูลลูกค้า แต่ตรวจแล้วไม่พบสิทธิ์บน TradingView (ลูกค้าใช้อินดี้ไม่ได้)
    if (s === "error")
      return { key: "no_tv", label: "ไม่มีสิทธิ์บน TV", tone: "warn", hint: a.tv_verify_error || "ตรวจแล้วไม่พบชื่อนี้ในสคริปต์บน TradingView" };
    const expired = s === "expired" || (a.expiration && new Date(a.expiration).getTime() <= now);
    if (expired) return { key: "expired", label: "หมดอายุ", tone: "expired", hint: "สิทธิ์หมดอายุแล้ว" };
    return { key: "active", label: "ใช้งานอยู่", tone: "active", hint: a.tv_verified_at ? "ตรวจกับ TradingView แล้วว่ามีสิทธิ์" : "มีสิทธิ์ตามข้อมูลในระบบ" };
  };
  const canSeeNewTv = isAdmin || released;   // ฟีเจอร์ใหม่ (คอลัมน์อีเมล): เห็นเฉพาะแอดมินจนกว่าจะกดปล่อย
  const filtered = (a) => !q.trim() || `${a.username} ${a.display_name || ""} ${a.trade_id || ""} ${a.email || ""}`.toLowerCase().includes(q.trim().toLowerCase());
  // คอลัมน์ตรวจสอบย้อนหลัง (เพิ่มสิทธิ์บน TV / สร้างเมื่อ / คนเพิ่ม / แก้ไขโดย)
  // ปิดไว้เป็นค่าเริ่มต้น — ใช้ตอนสอบย้อนหลังเท่านั้น ไม่ใช่ตอนทำงานปกติ
  const [showAudit, setShowAudit] = useState(false);
  // มือถือ: ตารางกว้างกว่าจอเสมอ ต้องเลื่อนซ้าย-ขวาทีละคอลัมน์กว่าจะเห็นข้อมูลคนเดียวครบ
  // จึงเปลี่ยนเป็นการ์ดสรุป กดแล้วเปิดแผ่นรายละเอียดขึ้นมาแทน (ดูครบในหน้าจอเดียว)
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    // 1023px = แท็บเล็ตใช้หน้าตาชุดเดียวกับมือถือ (เมนูล่าง + การ์ด) ตรงกับ breakpoint lg: ของ nav
    const mq = window.matchMedia?.("(max-width: 1023px)");
    if (!mq) return;
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  const [sheetRow, setSheetRow] = useState(null);   // แถวที่กดดูรายละเอียดบนมือถือ
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
  // สีมาจาก token ธีม (--ink-3/--ink) ไม่ใช่ slate ตายตัว จะได้อ่านออกทั้งธีมสว่างและมืด
  const H = ({ k, children }) => (
    <button type="button" onClick={() => toggleSort(k)}
      className="min-w-0 flex items-center gap-0.5 uppercase text-left truncate transition-colors"
      style={{ color: sortKey === k ? "var(--ink)" : "var(--ink-3)", fontWeight: sortKey === k ? 600 : 400 }}>
      <span className="truncate">{children}</span>{sortKey === k && <span className="shrink-0">{sortDir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
  // ความกว้างคอลัมน์ — เดิมยัด 11 คอลัมน์เสมอ กว้าง 1,230px ต้องเลื่อนแนวนอนตลอด
  // และช่องละ 80–90px ทำให้ตัดคำทุกช่อง อ่านยากมาก
  // ตอนนี้แยกเป็น "คอลัมน์ที่ใช้ทุกวัน" กับ "คอลัมน์ตรวจสอบย้อนหลัง" (กดสวิตช์ดูได้)
  const COLS = [
    "minmax(150px,1.7fr)",                    // ชื่อลูกค้า
    "minmax(120px,1.2fr)",                    // User TV
    ...(canSeeNewTv ? ["minmax(160px,1.4fr)"] : []),   // อีเมล
    "116px",                                  // สถานะ
    "104px",                                  // Trade ID
    "100px",                                  // หมดอายุ
    ...(showAudit ? ["132px", "92px", "104px", "132px"] : []),
    "96px",                                   // ปุ่มจัดการ
  ].join(" ");
  const tableMinW = (canSeeNewTv ? 750 : 590) + (showAudit ? 460 : 0);
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
  const openDatePicker = () => {
    setDraftFrom(customFrom);
    setDraftTo(customTo);
    setDatePickerField("from");
    setPickerMonth(new Date(`${customFrom}T12:00:00+07:00`));
    setDatePickerOpen(true);
  };
  const pickerDate = (year, month, day) => {
    const value = new Date(year, month, day);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  };
  const calendarDays = (() => {
    const year = pickerMonth.getFullYear();
    const month = pickerMonth.getMonth();
    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const totalDays = new Date(year, month + 1, 0).getDate();
    const previousTotal = new Date(year, month, 0).getDate();
    const days = [];
    for (let i = firstDay - 1; i >= 0; i--) days.push({ day: previousTotal - i, date: pickerDate(year, month - 1, previousTotal - i), current: false });
    for (let day = 1; day <= totalDays; day++) days.push({ day, date: pickerDate(year, month, day), current: true });
    let nextDay = 1;
    while (days.length < 42) days.push({ day: nextDay, date: pickerDate(year, month + 1, nextDay++), current: false });
    return days;
  })();
  const selectPickerDate = (date) => {
    if (date > thToday) return;
    if (datePickerField === "from") {
      setDraftFrom(date);
      if (draftTo && date > draftTo) setDraftTo("");
      setDatePickerField("to");
    } else {
      if (draftFrom && date < draftFrom) setDraftFrom(date);
      setDraftTo(date);
    }
  };
  const applyDateRange = () => {
    if (!draftFrom || !draftTo || draftFrom > draftTo) return;
    setCustomFrom(draftFrom);
    setCustomTo(draftTo);
    setRangeKey("custom");
    setDatePickerOpen(false);
  };
  const scriptStat = (s) => {
    const rows = access.filter((a) => a.pine_id === s.pine_id && inRange(a));
    const soon = rows.filter((a) => a.status !== "revoked" && a.expiration && new Date(a.expiration).getTime() > now && new Date(a.expiration).getTime() - now < 7 * 86400000).length;
    const expired = rows.filter((a) => statusInfo(a).key === "expired").length;
    return { total: rows.length, active: rows.filter((a) => statusInfo(a).key === "active").length, soon, expired };
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
        // CSV ใช้คำเดิม (active / expired / revoked) ไม่ใช่ป้ายไทยที่โชว์บนหน้าจอ
        // เพราะไฟล์นี้ถูกวางต่อเข้าชีตของทีม เปลี่ยนคำแล้วสูตรฝั่งนั้นพัง
        a.display_name || "—", a.username || "", ...(canSeeNewTv ? [a.email || "—"] : []), st.key,
        a.trade_id || "—", expLabel(a), tvGrantedLabel(a), createLabel(a), a.granted_by || "—", editedBy,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `tv-members-${rb.from}${rb.from !== rb.to ? `_${rb.to}` : ""}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="tv-members-shell space-y-4">
      <style>{`
        /* เหลือเฉพาะกฎ "โครงสร้าง" ที่ Tailwind เขียนไม่ได้ (details marker, พับ/คลี่, sticky)
           ส่วนสีทั้งหมดถูกลบออกแล้ว — เดิมบล็อกนี้บังคับ background #151C25 !important
           กับ text-slate-* ทุกระดับ เพื่อให้หน้านี้เป็นโทนมืดเหมือนหน้าแชท
           ผลคือเมื่อแอปมีธีมสว่าง หน้านี้ยังมืดอยู่ที่เดียว และ !important ทับ token
           จนแก้ที่ไหนก็ไม่ขึ้น · ตอนนี้สีมาจาก --ink/--surface/--line ตามธีมจริง */
        .tv-members-shell .tv-members-search input { min-height: 42px; border-radius: 12px; }
        .tv-members-shell .tv-brand-heading {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 10px 12px;
        }
        .tv-members-shell .tv-members-summary > summary::-webkit-details-marker,
        .tv-members-shell .tv-add-member-panel > summary::-webkit-details-marker { display: none; }
        .tv-members-shell .tv-add-member-panel { transition: width .18s ease, border-color .18s ease; }
        .tv-members-shell .tv-add-member-panel:not([open]) { width: 250px !important; }
        .tv-members-shell .tv-add-member-panel[open] > summary .tv-add-member-chevron { transform: rotate(45deg); }
        .tv-members-shell .tv-add-member-chevron { transition: transform .18s ease; }
        .tv-members-shell .tv-form-section { border-top: 1px solid var(--line); padding-top: 14px; margin-top: 14px; }
        .tv-members-shell .tv-form-section-title { color: var(--ink); font-size: 12px; font-weight: 700; letter-spacing: .02em; }
        .tv-members-shell .tv-form-section-title span { color: var(--brand); margin-right: 6px; }
        @media (max-width: 1023px) {
          .tv-members-shell > .flex.flex-col.lg\\:flex-row > .lg\\:w-80 { width: 100% !important; }
          .tv-members-shell .tv-add-member-panel:not([open]) { width: 100% !important; }
          .tv-members-shell .tv-members-form { position: static; }
        }
        @media (min-width: 1024px) { .tv-members-shell .tv-members-form { position: sticky; top: 20px; } }
      `}</style>
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
      {/* embedded = ถูกฝังอยู่ในหน้าที่มีหัวเพจของตัวเองแล้ว (ศูนย์จัดการลูกค้า)
          จึงไม่แสดงหัวซ้ำ เหลือแค่แถบรีเฟรช/เวลาอัปเดตแบบกะทัดรัด */}
      {embedded ? (
        <div className="flex items-center justify-end gap-3">
          <span className="hidden sm:flex items-center gap-1.5 text-2xs text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            อัปเดต {updatedAt ? updatedAt.toLocaleTimeString("th-TH") : "—"}
          </span>
          <Button size="sm" onClick={load} loading={loading}>รีเฟรช</Button>
        </div>
      ) : (
        <SectionTitle
          title="สมาชิก TradingView"
          subtitle="ให้สิทธิ์ ต่ออายุ และถอนสิทธิ์อินดิเคเตอร์ของลูกค้า"
          right={
            <div className="flex items-center gap-3">
              <span className="hidden sm:flex items-center gap-1.5 text-2xs text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                อัปเดต {updatedAt ? updatedAt.toLocaleTimeString("th-TH") : "—"}
              </span>
              <Button onClick={load} loading={loading}>รีเฟรช</Button>
            </div>
          }
        />
      )}

      {msg && <div className="text-sm rounded-control bg-slate-100 border border-slate-200 px-3 py-2 text-slate-700">{msg}</div>}

      {/* ตัวเลขสรุป — เดิมเป็นข้อความเรียงต่อกันในแถบเดียว อ่านยากและไม่เข้าชุดกับหน้าอื่น
          เปลี่ยนเป็นการ์ดตัวเลขชุดเดียวกับหน้าภาพรวม กวาดตาเห็นตัวเลขได้ทันที */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="สมาชิกทั้งหมด" value={stats.total.toLocaleString()} tone="brand" />
        <StatCard icon={CheckCircle2} label="กำลังใช้งาน" value={stats.activeCount.toLocaleString()} tone="green" />
        <StatCard icon={AlertTriangle} label="ใกล้หมดอายุ" value={stats.soon.toLocaleString()} tone="gold" />
        <StatCard icon={Tv} label="อินดิเคเตอร์" value={stats.scripts.toLocaleString()} tone="purple" />
      </div>

      {/* แผงนี้เคยใช้สีธีมมืดฝังตาย (text-slate-200 / border-slate-700) วางบนการ์ดสีขาว
          ในธีมสว่างจึงเป็นตัวหนังสือขาวบนพื้นขาว อ่านไม่ออกเลย — เปลี่ยนมาใช้ token ทั้งหมด */}
      <details className="tv-members-summary ds-card">
        <summary className="px-4 py-3 cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 text-sm font-semibold" style={{ color: "var(--ink)" }}>
          <span>สรุปตามอินดิเคเตอร์</span>
          <span className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>ช่วง {rangeLabel} · กดเพื่อดูรายละเอียด</span>
        </summary>
        <div className="overflow-x-auto" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="min-w-[560px] grid grid-cols-[1.8fr_repeat(4,1fr)] gap-3 px-4 py-2 text-[11px] uppercase" style={{ color: "var(--ink-3)" }}>
            <span>อินดิเคเตอร์</span><span>ทั้งหมด</span><span>ใช้งานอยู่</span><span>ใกล้หมดอายุ</span><span>หมดอายุแล้ว</span>
          </div>
          {scripts.length === 0 ? <div className="px-4 py-4 text-xs" style={{ color: "var(--ink-3)" }}>ยังไม่มีอินดิเคเตอร์</div> : scripts.map((s) => {
            const ss = scriptStat(s);
            return <div key={"stat-" + s.pine_id} className="min-w-[560px] grid grid-cols-[1.8fr_repeat(4,1fr)] gap-3 px-4 py-2.5 text-sm tabular-nums" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="truncate font-medium" style={{ color: "var(--ink)" }}>{s.name}</span>
              <span style={{ color: "var(--ink-2)" }}>{ss.total}</span>
              <span className="font-semibold" style={{ color: "var(--ok)" }}>{ss.active}</span>
              <span className="font-semibold" style={{ color: ss.soon ? "var(--warn)" : "var(--ink-3)" }}>{ss.soon}</span>
              <span className="font-semibold" style={{ color: ss.expired ? "var(--bad)" : "var(--ink-3)" }}>{ss.expired}</span>
            </div>;
          })}
        </div>
      </details>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ซ้าย: ฟอร์มเพิ่มสมาชิก */}
        {/* เดิมเป็น bg-white คู่กับ text-slate-100 = ตัวหนังสือขาวบนพื้นขาวในธีมสว่าง */}
        <details className="tv-members-form tv-add-member-panel ds-card lg:w-80 shrink-0 p-5 h-fit">
          <summary className="flex items-center justify-between gap-3 cursor-pointer list-none">
            <span>
              <strong className="block font-semibold" style={{ color: "var(--ink)" }}>เพิ่มสมาชิกใหม่</strong>
              <span className="block text-[11px] mt-1" style={{ color: "var(--ink-3)" }}>กรอกข้อมูล ตรวจสอบ แล้วจึงให้สิทธิ์</span>
            </span>
            <span className="tv-add-member-chevron text-lg leading-none" style={{ color: "var(--ink-3)" }}>+</span>
          </summary>
          <div className="tv-add-member-fields space-y-3 mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="tv-form-section-title"><span>1</span>ข้อมูลลูกค้า</div>
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
          <div className="tv-form-section-title tv-form-section"><span>2</span>เลือกแบรนด์และอินดิเคเตอร์</div>
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
          <div className="tv-form-section-title tv-form-section"><span>3</span>ตรวจสอบข้อมูลและยืนยัน</div>
          <button onClick={grant} disabled={granting} className="w-full rounded-lg bg-brand-600 text-white py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
            {granting ? "กำลังเพิ่ม..." : "เพิ่มสิทธิ์"}
          </button>
          </div>
        </details>

        {/* ขวา: ค้นหา + รายชื่อต่อสคริปต์ */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-end justify-between gap-3 px-1">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">รายการสิทธิ์ TradingView</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">ค้นหาและจัดการสมาชิกแยกตามแบรนด์</p>
            </div>
            <span className="text-[11px] text-slate-500 shrink-0">{access.length.toLocaleString()} รายการ</span>
          </div>
          {/* ช่วงวันที่ดูข้อมูล (กรองตามวันที่เพิ่มสมาชิก) */}
          <div className="tv-members-toolbar relative bg-white rounded-2xl border border-slate-200 p-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 mr-1">ช่วงวันที่:</span>
            {RANGE_PRESETS.map(([key, label]) => (
              <button key={key} onClick={() => key === "custom" ? openDatePicker() : setRangeKey(key)} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${rangeKey === key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>{label}</button>
            ))}
            {rangeKey === "custom" && <button onClick={openDatePicker} className="tv-date-trigger rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-200">{fmtDMY2(customFrom)} ถึง {fmtDMY2(customTo)}</button>}
            <span className="ml-auto text-xs text-slate-400">แสดง: {rangeLabel}</span>
            {datePickerOpen && (
              <div className="tv-date-picker absolute z-30 top-full left-0 mt-2 w-[min(340px,calc(100vw-32px))] rounded-2xl border p-4 shadow-2xl">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <button onClick={() => setPickerMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700"><ChevronLeft size={18} /></button>
                  <div className="flex items-center gap-1.5">
                    <select value={pickerMonth.getMonth()} onChange={(e) => setPickerMonth(new Date(pickerMonth.getFullYear(), Number(e.target.value), 1))} className="tv-date-select rounded-lg px-2 py-1 text-sm font-semibold">
                      {Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{new Date(2020, month, 1).toLocaleDateString("th-TH", { month: "long" })}</option>)}
                    </select>
                    <select value={pickerMonth.getFullYear()} onChange={(e) => setPickerMonth(new Date(Number(e.target.value), pickerMonth.getMonth(), 1))} className="tv-date-select rounded-lg px-2 py-1 text-sm font-semibold">
                      {Array.from({ length: 8 }, (_, i) => pickerMonth.getFullYear() - 5 + i).map((year) => <option key={year} value={year}>{year + 543}</option>)}
                    </select>
                  </div>
                  <button onClick={() => setPickerMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700"><ChevronRight size={18} /></button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-500 mb-1">{["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((day) => <span key={day}>{day}</span>)}</div>
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((item) => {
                    const disabled = item.date > thToday;
                    const selected = item.date === draftFrom || item.date === draftTo;
                    const between = draftFrom && draftTo && item.date > draftFrom && item.date < draftTo;
                    return <button key={item.date} disabled={disabled} onClick={() => selectPickerDate(item.date)} className={`h-8 rounded-lg text-xs ${selected ? "bg-brand-600 text-white font-semibold" : between ? "bg-brand-600/20 text-brand-200" : item.current ? "text-slate-200 hover:bg-slate-700" : "text-slate-600"} ${disabled ? "opacity-30 cursor-not-allowed" : ""}`}>{item.day}</button>;
                  })}
                </div>
                <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-700/60">
                  <span className="text-[11px] text-slate-500">{draftFrom ? fmtDMY2(draftFrom) : "เริ่มต้น"} → {draftTo ? fmtDMY2(draftTo) : "วันสิ้นสุด"}</span>
                  <button onClick={applyDateRange} disabled={!draftFrom || !draftTo || draftFrom > draftTo} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">ใช้ช่วงวันที่</button>
                </div>
              </div>
            )}
          </div>
          <div className="tv-members-search flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา username, ชื่อ, หรือเลข trade id"
              className="min-w-[200px] flex-1 rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)" }} />
            <button type="button" onClick={() => setShowAudit((v) => !v)}
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
              style={{ background: showAudit ? "var(--brand-soft)" : "var(--surface)",
                       border: `1px solid ${showAudit ? "var(--brand)" : "var(--line)"}`,
                       color: showAudit ? "var(--brand)" : "var(--ink-2)" }}
              title="แสดง/ซ่อนคอลัมน์ เพิ่มสิทธิ์บน TV · สร้างเมื่อ · คนเพิ่ม · แก้ไขโดย">
              {showAudit ? "ซ่อนคอลัมน์ตรวจสอบ" : "ดูคอลัมน์ตรวจสอบ"}
            </button>
          </div>
          {/* จัดกลุ่มตามแบรนด์ (เฉพาะแบรนด์ที่โชว์ในหน้าจัดการ) — นับ/แสดง/export แยกกัน ไม่ปน */}
          {brands.filter((b) => b.show_in_manager !== false).map((b) => {
            const brScripts = scripts.filter((s) => s.brand_id === b.id);
            const brMembers = access.filter((a) => brScripts.some((s) => s.pine_id === a.pine_id) && inRange(a));
            const brCollapsed = collapsed["brand:" + b.id];
            return (
            <div key={"brand-" + b.id} className="space-y-3">
              <div className="tv-brand-heading flex items-center justify-between gap-2">
                <button onClick={() => setCollapsed((c) => ({ ...c, ["brand:" + b.id]: !brCollapsed }))} className="flex items-center gap-2 min-w-0">
                  {brCollapsed ? <ChevronDown size={18} className="shrink-0" style={{ color: "var(--ink-3)" }} /> : <ChevronUp size={18} className="shrink-0" style={{ color: "var(--ink-3)" }} />}
                  <h2 className="text-lg font-bold truncate" style={{ color: "var(--ink)" }}>{b.name}</h2>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  {/* เดิมเป็น text-slate-400 บนพื้นเทาอ่อน ตัวเลขสมาชิกจึงแทบมองไม่เห็น */}
                  <span className="text-xs tabular-nums" style={{ color: "var(--ink-2)" }}>{new Set(brMembers.map((a) => a.username)).size} สมาชิก · {brScripts.length} สคริปต์</span>
                  <button onClick={() => { setExportSel(brScripts.map((s) => s.pine_id)); setExportOpen(true); }}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium"
                    style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink-2)" }}>Export</button>
                </div>
              </div>
              {!brCollapsed && brScripts.length === 0 && <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center text-xs text-slate-400">แบรนด์นี้ยังไม่มีสคริปต์ — เพิ่มที่ ตั้งค่า → ตั้งค่า TV</div>}
              {!brCollapsed && brScripts.map((s) => {
            const allRows = sortRows(access.filter((a) => a.pine_id === s.pine_id && filtered(a) && inRange(a)));
            const open = !collapsed[s.pine_id];
            const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
            const page = Math.min(pageBy[s.pine_id] || 1, totalPages);
            const pageRows = allRows.slice((page - 1) * pageSize, page * pageSize);
            return (
              <div key={s.pine_id} className="tv-member-table ds-card overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderBottom: "1px solid var(--line)", background: "var(--surface-2, var(--ground))" }}>
                  <div className="min-w-0">
                    <div className="font-semibold truncate" style={{ color: "var(--ink)" }}>{s.name}</div>
                    {s.script_key && <div className="text-[11px] truncate" style={{ color: "var(--ink-3)" }}>{s.script_key}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs tabular-nums" style={{ color: "var(--ink-2)" }}>{allRows.length} สมาชิก</span>
                    {isAdmin && <button onClick={() => deleteScript(s)} className="flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 rounded-md px-2 py-1" title="ลบสคริปต์นี้"><Trash2 size={13} /> ลบสคริปต์</button>}
                    <button onClick={() => setCollapsed((c) => ({ ...c, [s.pine_id]: open }))} className="text-slate-400 hover:text-slate-600">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                  </div>
                </div>
                {open && <>
                {isNarrow ? (
                  /* มือถือ: การ์ดสรุป 3 อย่างที่ต้องรู้ทันที (ใคร · สถานะ · หมดอายุเมื่อไร)
                     ที่เหลือกดเข้าไปดูในแผ่นรายละเอียด ไม่ต้องเลื่อนตารางแนวนอน */
                  <div className="tv-rows">
                    {pageRows.length === 0 ? <div className="px-4 py-6 text-center text-xs" style={{ color: "var(--ink-3)" }}>ยังไม่มีสมาชิกในสคริปต์นี้</div> : pageRows.map((a) => {
                      const st = statusInfo(a);
                      const nearExp = a.expiration && new Date(a.expiration).getTime() - now < 7 * 86400000 && new Date(a.expiration).getTime() > now;
                      return (
                        <button key={a.id} type="button" onClick={() => setSheetRow(a)}
                          className="tv-row flex w-full items-center gap-3 px-4 py-3 text-left">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium" style={{ color: "var(--ink)" }}>{a.display_name || a.username}</span>
                            <span className="mt-0.5 block truncate text-[11px]" style={{ color: "var(--ink-3)" }}>
                              {a.username}{a.trade_id ? ` · ${a.trade_id}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
                              style={{ background: STATUS_TONE[st.tone].bg, color: STATUS_TONE[st.tone].fg }}>{st.label}</span>
                            <span className="mt-1 block text-[11px] tabular-nums"
                              style={{ color: st.key === "expired" ? "var(--bad)" : nearExp ? "var(--warn)" : "var(--ink-3)",
                                       fontWeight: (nearExp || st.key === "expired") ? 600 : 400 }}>{expLabel(a)}</span>
                          </span>
                          <ChevronRight size={16} className="shrink-0" style={{ color: "var(--ink-3)" }} />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                <div className="overflow-x-auto">
                  <div className="tv-rows" style={{ minWidth: tableMinW }}>
                    <div className="grid gap-3 px-4 py-2 text-[11px]" style={{ gridTemplateColumns: COLS, borderBottom: "1px solid var(--line)" }}>
                      <H k="name">ชื่อลูกค้า</H><H k="user">User TV</H>{canSeeNewTv && <H k="email">อีเมล</H>}<H k="status">สถานะ</H><H k="trade">Trade ID</H><H k="exp">หมดอายุ</H>
                      {showAudit && <><H k="tvGranted">เพิ่มสิทธิ์บน TV</H><H k="create">สร้างเมื่อ</H><H k="by">คนเพิ่ม</H><H k="editby">แก้ไขโดย</H></>}
                      <span></span>
                    </div>
                    {pageRows.length === 0 ? <div className="px-4 py-6 text-center text-xs" style={{ color: "var(--ink-3)" }}>ยังไม่มีสมาชิกในสคริปต์นี้</div> : pageRows.map((a) => {
                      const st = statusInfo(a);
                      const nearExp = a.expiration && new Date(a.expiration).getTime() - now < 7 * 86400000 && new Date(a.expiration).getTime() > now;
                      return (
                      <div key={a.id} className="tv-row grid gap-3 px-4 py-2.5 text-sm items-center" style={{ gridTemplateColumns: COLS }}>
                        {a.display_name && (a.trade_id || a.username)
                          ? <a href={`${window.location.pathname}?tab=inbox&${a.trade_id ? `open_trade=${encodeURIComponent(a.trade_id)}` : `open_tv=${encodeURIComponent(a.username)}`}`} target="_blank" rel="noopener noreferrer" className="min-w-0 font-medium hover:underline truncate" style={{ color: "var(--brand)" }} title={`เปิดแชทของ ${a.display_name}`}>{a.display_name}</a>
                          : <span className="min-w-0 font-medium truncate" style={{ color: "var(--ink)" }} title={a.display_name || ""}>{a.display_name || "—"}</span>}
                        <span className="min-w-0 truncate" style={{ color: "var(--ink-2)" }} title={a.username}>{a.username}</span>
                        {canSeeNewTv && <span className="min-w-0 truncate text-xs" style={{ color: "var(--ink-3)" }} title={a.email || ""}>{a.email || "—"}</span>}
                        <span className="min-w-0">
                          <span className="inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ background: STATUS_TONE[st.tone].bg, color: STATUS_TONE[st.tone].fg }}
                            title={st.hint || ""}>{st.label}</span>
                        </span>
                        <span className="truncate text-xs tabular-nums" style={{ color: "var(--ink-2)" }} title={a.trade_id || ""}>{a.trade_id || "—"}</span>
                        {/* สีวันหมดอายุมีความหมายเดียว: เหลือง = ใกล้หมดใน 7 วัน · แดง = หมดแล้ว
                            เดิมใช้ทั้งเหลือง/ม่วง/ส้ม/เทาปนกันในแถวเดียว จนสีไม่สื่ออะไร */}
                        <span className="truncate text-xs tabular-nums"
                          style={{ color: st.key === "expired" ? "var(--bad)" : nearExp ? "var(--warn)" : "var(--ink-2)",
                                   fontWeight: (nearExp || st.key === "expired") ? 600 : 400 }}>{expLabel(a)}</span>
                        {showAudit && <>
                          <span className="truncate text-xs" style={{ color: "var(--ink-3)" }} title={a.tv_granted_at ? "วันที่ที่ TradingView ระบุว่าเพิ่มสิทธิ์" : "การตรวจจาก TradingView ยังไม่ส่งวันที่เพิ่มสิทธิ์"}>{tvGrantedLabel(a)}</span>
                          <span className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{createLabel(a)}</span>
                          <span className="truncate text-xs" style={{ color: "var(--ink-3)" }} title={a.granted_by || ""}>{a.granted_by || "—"}</span>
                          <span className="truncate text-xs min-w-0" style={{ color: "var(--ink-3)" }} title={a.edited_by || ""}>{a.edited_at ? <>{a.edited_by || "—"} · {new Date(a.edited_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}</> : "—"}</span>
                        </>}
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
                )}
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

      {/* แผ่นรายละเอียดบนมือถือ — เด้งขึ้นจากด้านล่าง เห็นข้อมูลลูกค้าครบในหน้าจอเดียว
          พร้อมปุ่มจัดการขนาดนิ้วกดได้ (ในตารางเป็นไอคอน 14px ซึ่งเล็กเกินไปสำหรับมือถือ) */}
      {sheetRow && (() => {
        const a = sheetRow;
        const st = statusInfo(a);
        const Row = ({ k, v, tone }) => (
          <div className="flex items-start justify-between gap-3 py-2" style={{ borderTop: "1px solid var(--line)" }}>
            <span className="shrink-0 text-xs" style={{ color: "var(--ink-3)" }}>{k}</span>
            <span className="min-w-0 break-words text-right text-[13px]" style={{ color: tone || "var(--ink)" }}>{v || "—"}</span>
          </div>
        );
        const act = "flex flex-1 items-center justify-center gap-1.5 rounded-control py-2.5 text-xs font-semibold";
        return (
          <div className="fixed inset-0 z-[200] flex items-end bg-black/50" onClick={() => setSheetRow(null)}>
            {/* เผื่อที่ท้ายแผ่นให้พ้นแถบเมนูล่างของมือถือ ไม่งั้นปุ่ม "ถอนสิทธิ์" ถูกทับ */}
            <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
              style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: "var(--line-strong)" }} />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold" style={{ color: "var(--ink)" }}>{a.display_name || a.username}</div>
                  <div className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: STATUS_TONE[st.tone].bg, color: STATUS_TONE[st.tone].fg }}>{st.label}</div>
                </div>
                <button onClick={() => setSheetRow(null)} className="shrink-0 p-1" style={{ color: "var(--ink-3)" }}><X size={20} /></button>
              </div>
              {st.hint && <div className="mt-2 rounded-control px-2.5 py-2 text-[11px]" style={{ background: STATUS_TONE[st.tone].bg, color: STATUS_TONE[st.tone].fg }}>{st.hint}</div>}

              <div className="mt-3">
                <Row k="User TV" v={a.username} />
                {canSeeNewTv && <Row k="อีเมล" v={a.email} />}
                <Row k="Trade ID" v={a.trade_id} />
                <Row k="หมดอายุ" v={expLabel(a)} tone={st.key === "expired" ? "var(--bad)" : undefined} />
                <Row k="เพิ่มสิทธิ์บน TV" v={tvGrantedLabel(a)} />
                <Row k="สร้างเมื่อ" v={createLabel(a)} />
                <Row k="คนเพิ่ม" v={a.granted_by} />
                <Row k="แก้ไขโดย" v={a.edited_at ? `${a.edited_by || "—"} · ${new Date(a.edited_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}` : null} />
              </div>

              {a.display_name && (a.trade_id || a.username) && (
                <a href={`${window.location.pathname}?tab=inbox&${a.trade_id ? `open_trade=${encodeURIComponent(a.trade_id)}` : `open_tv=${encodeURIComponent(a.username)}`}`}
                  target="_blank" rel="noopener noreferrer"
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-control py-2.5 text-xs font-semibold"
                  style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>เปิดแชทของลูกค้า</a>
              )}

              <div className="mt-2 flex gap-2">
                <button onClick={() => checkAccess(a)} disabled={!!checkingAccess[a.id]} className={act}
                  style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                  {checkingAccess[a.id] ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} ตรวจสิทธิ์
                </button>
                <button onClick={() => { setSheetRow(null); openEdit(a); }} className={act}
                  style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink-2)" }}><Pencil size={14} /> แก้ไข</button>
                <button onClick={() => { setSheetRow(null); openExpiry(a); }} className={act}
                  style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink-2)" }}><Clock size={15} /> วันหมดอายุ</button>
              </div>
              <button onClick={() => { setSheetRow(null); revoke(a); }}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-control py-2.5 text-xs font-semibold"
                style={{ background: "rgb(var(--n-bad) / .12)", color: "var(--bad)" }}><X size={15} /> ถอนสิทธิ์บน TradingView</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
