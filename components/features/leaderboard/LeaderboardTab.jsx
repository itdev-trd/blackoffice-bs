"use client";

// กระดานแต้มโบนัส — อ่านจากสมุดแต้ม point_events ผ่านฟังก์ชัน `points` (ไม่คิดแต้มสดอีกแล้ว)
// แต้มทุกแต้มกดดูหลักฐานได้ · โต้แย้งได้ · owner ปิดยอดรายเดือนแล้วล็อก
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Crown, Trophy, Lock } from "lucide-react";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import { Tabs } from "@/components/ui";
import {
  callPoints, fmtPts, shortName, periodLabel, StaffEventsDialog, DisputesPanel, RulesPanel, OwnerTools, LedgerSeal,
} from "@/components/features/leaderboard/PointsPanels";
import HolidayCalendar from "@/components/features/leaderboard/HolidayCalendar";

export default function LeaderboardTab({ active = true }) {
  const { goToChat } = useDashboard();
  const [period, setPeriod] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState(false);
  const [view, setView] = useState("board");
  // ?view=holidays — ลิงก์ตรงมาที่ปฏิทินวันหยุด (อ่านหลัง mount กัน hydration ไม่ตรงกับหน้าที่ prerender ไว้)
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (["disputes", "rules", "holidays", "owner"].includes(v)) setView(v);
  }, []);
  const [staff, setStaff] = useState(null);           // คนที่กดดูรายการแต้ม
  const nameOf = (u) => shortName(u?.email, u?.name);

  const load = useCallback(async (flashOnDone = false) => {
    setBusy(true); setErr("");
    try {
      const data = await callPoints({ action: "overview", ...(period ? { period } : {}) });
      setRes(data);
      if (!period) setPeriod(data.period);
      if (flashOnDone) { setFlash(true); setTimeout(() => setFlash(false), 900); }
    } catch (e) {
      setErr(e.message || "โหลดกระดานแต้มไม่สำเร็จ");
    }
    setBusy(false);
  }, [period]);

  useEffect(() => { if (active) load(); }, [period, active, load]);
  // ไม่ใช้ realtime (ฐานข้อมูล micro) — รีเฟรชเองทุก 60 วิ ตอนหน้าเปิดอยู่ หรือกดปุ่มรีเฟรช
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 60000);
    return () => clearInterval(t);
  }, [active, load]);

  // พาเลตต์เฉพาะหน้ากระดานแต้ม — ทอง/เงิน/ทองแดงตรงกับเหรียญรางวัล
  // เป็นข้อยกเว้นที่มีเหตุผลจากพาเลตต์หลัก (accent น้ำเงิน) เพราะสีสื่ออันดับโดยตรง
  // ส่วนสีเน้นอื่นใช้ brand/สถานะชุดเดียวกับทั้งแอป
  // เดิมค่าพวกนี้เป็น hex ธีมมืดฝังตาย (#0D1117 / #F8FAFC) หน้านี้จึงเป็นกล่องดำ
  // กล่องเดียวในแอปที่เหลือสว่าง — ย้ายมาใช้ token กลางเพื่อให้เปลี่ยนตามธีมจริง
  // ทอง/เงิน/ทองแดงคงไว้ตายตัว เพราะสีสื่อ "อันดับ" ไม่ใช่สีตกแต่งของธีม
  const C = {
    bg: "var(--surface)", ink: "var(--surface)",
    border: "var(--line)", hair: "var(--line)",
    gold: "#B98500", silver: "#64748B", bronze: "#A96022",
    purple: "var(--brand)", green: "var(--ok)", red: "var(--bad)",
    t1: "var(--ink)", t2: "var(--ink-2)", t3: "var(--ink-3)",
  };
  const FONT = "'Roboto','Noto Sans Thai',system-ui,-apple-system,sans-serif";
  const NUM = "'IBM Plex Mono',ui-monospace,monospace";
  const board = res?.board || [];
  const top3 = board.slice(0, 3);
  const GRID = "44px 1fr 92px 92px 80px 84px 92px";
  // จัดเรียงแท่น: [ที่2, ที่1, ที่3] เพื่อให้ที่1 อยู่กลาง+สูงสุด
  const podiumOrder = [top3[1], top3[0], top3[2]];
  // วัสดุโลหะ + สัดส่วนแบบ cinematic (ที่1 เด่นสุด, ข้าง ๆ ถอยลึก)
  const META = {
    1: { name: "gold", color: C.gold, hi: "#FFF3C4", mid: "#F3C233", lo: "#8A6410", edge: "#FFE9A0",
         ring: "rgba(247,201,72,.95)", glow: "rgba(247,201,72,.55)", medal: "🥇", h: 196, av: 108, depth: 1, z: 5, spot: "rgba(247,201,72,.55)" },
    2: { name: "silver", color: C.silver, hi: "#FBFDFF", mid: "#B7C2D3", lo: "#727E92", edge: "#EDF2FA",
         ring: "rgba(201,211,226,.9)", glow: "rgba(201,211,226,.30)", medal: "🥈", h: 134, av: 84, depth: .96, z: 3, spot: "rgba(220,230,245,.34)" },
    3: { name: "bronze", color: C.bronze, hi: "#F1C494", mid: "#C1834A", lo: "#6F4420", edge: "#EAB07A",
         ring: "rgba(200,137,75,.9)", glow: "rgba(200,137,75,.30)", medal: "🥉", h: 104, av: 84, depth: .96, z: 3, spot: "rgba(210,160,110,.30)" },
  };
  const order = [2, 1, 3];
  const PAD = "clamp(20px,4.5vw,60px)";

  return (
    <div className="leaderboard-shell w-full max-w-[1400px] mx-auto" style={{ fontFamily: FONT, background: C.bg, color: C.t1, overflow: "hidden" }}>
      <style>{`
        @keyframes lbPulse{0%,100%{opacity:.9;transform:scale(1)}50%{opacity:0;transform:scale(2.2)}}
        @keyframes lbFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @keyframes lbBreathe{0%,100%{opacity:.55}50%{opacity:.9}}
        @keyframes lbRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        .lb-row{transition:background .18s ease}
        .lb-row:hover{background:rgb(var(--n-ink-3) / .07)}
        .lb-tab{transition:color .2s ease,background .2s ease,border-color .2s ease,box-shadow .2s ease}
        .lb-tab:hover{color:var(--ink)}
        .lb-ico{transition:all .2s ease}
        .lb-ico:hover{color:${C.t1};border-color:var(--line-strong)!important;background:rgb(var(--n-ink-3) / .09)!important}
        /* ปล่อยให้ปฏิทินในช่องวันที่ใช้โทนตามธีมของหน้า ไม่บังคับ dark */
        .lb-date::-webkit-calendar-picker-indicator{filter:none;cursor:pointer}
        .lb-podium{animation:lbRise .6s cubic-bezier(.2,.8,.2,1) both}
        @media(max-width:640px){
          .lb-hide-sm{display:none!important}
          .lb-grid{grid-template-columns:34px 1fr 84px!important}
          .lb-masthead{padding-top:24px!important}
          .lb-masthead-inner{gap:18px!important}
          .lb-masthead-title{min-width:0!important;flex:1 1 100%!important}
          .lb-total{width:100%;padding-left:0!important;text-align:left!important;display:flex;align-items:baseline;justify-content:space-between;gap:12px}
          .lb-total-glow{display:none!important}
          .lb-total-number{font-size:48px!important;margin-top:0!important}
          .lb-toolbar{align-items:stretch!important;flex-direction:column!important;gap:14px!important}
          .lb-presets{gap:12px!important}
          .lb-toolbar-controls{width:100%;justify-content:flex-start!important;flex-wrap:wrap!important;gap:8px!important}
          .lb-date{flex:1 1 132px;min-width:0}
          .lb-live{margin-left:auto}
          .lb-podium{gap:8px!important;padding:42px 12px 72px!important;min-height:390px!important}
          .lb-podium > div{min-width:0!important}
          .lb-podium > div:nth-child(1){width:clamp(82px,27vw,125px)!important}
          .lb-podium > div:nth-child(2){width:clamp(96px,31vw,145px)!important}
          .lb-podium > div:nth-child(3){width:clamp(82px,27vw,125px)!important}
          .lb-podium > div:nth-child(1) > div:nth-of-type(2), .lb-podium > div:nth-child(3) > div:nth-of-type(2){width:68px!important;height:68px!important}
          .lb-podium > div:nth-child(2) > div:nth-of-type(2){width:82px!important;height:82px!important}
          .lb-podium > div:nth-child(1) > div:last-child > div:last-child, .lb-podium > div:nth-child(3) > div:last-child > div:last-child{height:74px!important}
          .lb-podium > div:nth-child(2) > div:last-child > div:last-child{height:112px!important}
        }
      `}</style>

      {/* ═══ Editorial masthead ═══ */}
      <div className="lb-masthead" style={{ padding: `36px ${PAD} 0` }}>
        <div className="lb-masthead-inner" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 28 }}>
          <div className="lb-masthead-title" style={{ minWidth: 240 }}>
            {/* ถอดป้าย "LEADERBOARD" ออก — เป็นภาษาอังกฤษที่แปลตรงกับหัวข้อ "กระดานแต้ม" ที่อยู่ใต้มันพอดี
                (letterSpacing .42em ยังทำให้อ่านเป็นคำไม่ได้อีก) เมนูซ้ายบอกอยู่แล้วว่าอยู่หน้าไหน */}
            <h2 style={{ fontSize: "clamp(30px,4.6vw,52px)", fontWeight: 800, lineHeight: .98, letterSpacing: "-.025em", margin: 0 }}>กระดานแต้ม</h2>
            <p style={{ fontSize: 14, color: C.t2, margin: "14px 0 0", lineHeight: 1.5, maxWidth: 420 }}>
              แต้มโบนัสรายเดือนจากการตอบแชท (นอก/ในเวลา) และการให้สิทธิ์ TradingView — กดชื่อเพื่อดูหลักฐานทุกแต้ม
            </p>
          </div>
          {/* Total score — editorial figure, not a boxed card */}
          <div className="lb-total" style={{ textAlign: "right", position: "relative", paddingLeft: 30 }}>
            <div className="lb-total-glow" style={{ position: "absolute", right: -8, top: -18, width: 200, height: 120, background: `radial-gradient(60% 60% at 70% 40%, rgb(var(--n-accent) / .27), transparent 72%)`, filter: "blur(14px)", pointerEvents: "none", animation: "lbBreathe 4s ease-in-out infinite" }} />
            <div style={{ position: "relative", fontSize: 11, letterSpacing: ".34em", textTransform: "uppercase", color: C.t3, fontWeight: 600, fontFamily: NUM }}>แต้มรวมทั้งหมด</div>
            <div className="lb-total-number" style={{ position: "relative", fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontSize: "clamp(46px,7vw,84px)", fontWeight: 800, lineHeight: .92, letterSpacing: "-.03em", marginTop: 6, transition: "transform .35s cubic-bezier(.2,.8,.2,1)", transform: flash ? "scale(1.04)" : "scale(1)", color: C.t1, background: "none", WebkitBackgroundClip: "border-box", WebkitTextFillColor: C.t1, filter: "none" }}>
              {/* ตอนยังไม่มีข้อมูลเคยเรนเดอร์ "—" ที่ขนาด 84px ซึ่งอ่านเป็นแท่งดำ ไม่ใช่สถานะ
                  ใช้ 0 ที่สีจางแทน — สื่อว่า "ยังไม่มีแต้ม" โดยรูปแบบตัวเลขยังคงเดิม */}
              <span style={res ? undefined : { color: C.t3, fontWeight: 600 }}>
                {res ? (res.total ?? 0).toLocaleString() : "0"}
              </span>
            </div>
            <div style={{ position: "relative", marginTop: 8, fontSize: 13, color: C.t2 }}>
              <span style={{ color: C.gold, fontWeight: 600, fontFamily: NUM }}>{period ? periodLabel(period) : "—"}</span>
              {res?.status === "closed" && <span style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 4, color: C.t2 }}><Lock size={12} /> ปิดยอดแล้ว</span>}
            </div>
          </div>
        </div>

        {/* Toolbar: เลือกเดือน + มุมมอง */}
        <div className="lb-toolbar" style={{ marginTop: 30, borderTop: `1px solid ${C.hair}`, borderBottom: `1px solid ${C.hair}`, padding: "14px 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <Tabs value={view} onChange={setView} items={[
            { value: "board", label: "อันดับ" },
            { value: "disputes", label: "คำร้องโต้แย้ง", count: res?.open_disputes || undefined },
            { value: "rules", label: "เกณฑ์การนับแต้ม" },
            { value: "holidays", label: "ปฏิทินวันหยุด" },
            ...(res?.is_owner ? [{ value: "owner", label: "จัดการ (owner)" }] : []),
          ]} />
          <div className="lb-toolbar-controls" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <select aria-label="เลือกเดือน" value={period} onChange={(e) => setPeriod(e.target.value)}
              style={{ background: "transparent", color: C.t1, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontFamily: FONT, cursor: "pointer" }}>
              {(res?.periods || (period ? [period] : [])).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
            <button onClick={() => load()} disabled={busy} className="lb-ico" title="รีเฟรช"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: "50%", background: "transparent", color: C.t2, border: `1px solid ${C.border}`, cursor: "pointer", opacity: busy ? .5 : 1 }}>
              {busy ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            </button>
          </div>
        </div>
        {res && <div style={{ marginTop: 10 }}><LedgerSeal overview={res} /></div>}
        {err && <div style={{ marginTop: 16, fontSize: 13, color: C.red, background: "rgba(255,92,92,.07)", border: `1px solid rgba(255,92,92,.22)`, borderRadius: 12, padding: "10px 14px" }}>{err}</div>}
      </div>

      {/* ═══ CINEMATIC PODIUM STAGE (hero) ═══ */}
      {view !== "board" ? null : board.length > 0 ? (
        <div style={{ position: "relative", overflow: "hidden", marginTop: 8, minHeight: 480,
          background: "radial-gradient(130% 90% at 50% -10%, rgb(var(--n-accent) / .10) 0%, var(--surface) 55%)" }}>
          {/* atmospheric top haze */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 240, background: "radial-gradient(70% 100% at 50% 0%, rgb(var(--n-ink) / .04), transparent 70%)", pointerEvents: "none" }} />
          {/* faint ticker line horizon */}
          <svg viewBox="0 0 1200 300" preserveAspectRatio="none" style={{ position: "absolute", left: 0, right: 0, bottom: 96, width: "100%", height: 150, opacity: .18, pointerEvents: "none" }}>
            <defs><linearGradient id="lbLine" x1="0" x2="1"><stop offset="0" stopColor="transparent" /><stop offset=".5" stopColor={C.gold} /><stop offset="1" stopColor="transparent" /></linearGradient></defs>
            <polyline fill="none" stroke="url(#lbLine)" strokeWidth="1.5"
              points={Array.from({ length: 60 }).map((_, i) => `${i * 20},${150 - ((Math.sin(i * .6) * 40) + ((i * 53) % 60))}`).join(" ")} />
          </svg>
          {/* reflective floor */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 88, height: 1, background: `linear-gradient(90deg,transparent, ${C.gold}88, ${C.gold}55, ${C.gold}88, transparent)`, opacity: .45 }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 96, background: "linear-gradient(180deg, transparent, var(--surface) 70%)", pointerEvents: "none" }} />

          <div className="lb-podium" style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(14px,4vw,64px)", padding: `70px ${PAD} 96px`, zIndex: 2 }}>
            {order.map((rank, i) => {
              const u = podiumOrder[i]; const m = META[rank];
              const colW = rank === 1 ? "clamp(160px,20vw,236px)" : "clamp(128px,15vw,190px)";
              if (!u) return <div key={rank} style={{ width: colW }} />;
              const faceGrad = `linear-gradient(180deg, ${m.hi} 0%, ${m.mid} 30%, ${m.color} 46%, ${m.lo} 100%)`;
              return (
                <div key={rank} role="button" tabIndex={0} title="กดเพื่อดูหลักฐานทุกแต้ม" onClick={() => setStaff(u)} onKeyDown={(e) => { if (e.key === "Enter") setStaff(u); }}
                  style={{ width: colW, display: "flex", flexDirection: "column", alignItems: "center", zIndex: m.z, transform: `scale(${m.depth})`, opacity: m.depth, filter: rank === 1 ? "none" : "saturate(.95)", cursor: "pointer" }}>
                  {/* volumetric spotlight cone */}
                  <div style={{ position: "absolute", top: -30, width: "150%", height: 430, clipPath: "polygon(40% 0,60% 0,100% 100%,0 100%)", background: `linear-gradient(180deg, ${m.spot} 0%, transparent 78%)`, filter: "blur(20px)", mixBlendMode: "screen", opacity: rank === 1 ? .95 : .6, pointerEvents: "none" }} />

                  {rank === 1 && <Crown size={30} fill={C.gold} style={{ color: C.gold, marginBottom: 6, filter: `drop-shadow(0 0 12px ${C.gold})`, animation: "lbFloat 3.2s ease-in-out infinite", zIndex: 3 }} />}

                  {/* avatar — floating, volumetric ring */}
                  <div style={{ position: "relative", zIndex: 3, width: m.av, height: m.av, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: NUM, fontWeight: 800, fontSize: m.av * 0.3, color: "var(--ink)",
                    background: "radial-gradient(circle at 34% 28%, rgb(var(--n-ink-3) / .30), rgb(var(--n-ink-3) / .13) 78%)",
                    border: `2px solid ${m.ring}`,
                    boxShadow: `0 0 0 6px rgb(var(--n-ink) / .10), 0 22px 44px -16px ${m.glow}, 0 0 46px -6px ${m.glow}, inset 0 2px 6px rgba(255,255,255,.12)` }}>
                    {nameOf(u).slice(0, 2).toUpperCase()}
                    <span style={{ position: "absolute", bottom: -8, right: -8, width: 30, height: 30, borderRadius: "50%", background: C.ink, border: `1px solid ${m.ring}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: `0 6px 14px rgb(var(--n-ink) / .25)` }}>{m.medal}</span>
                  </div>

                  {/* name + score — editorial */}
                  <div style={{ textAlign: "center", marginTop: 16, width: "100%", zIndex: 3 }}>
                    <div title={u.email} style={{ fontSize: 13.5, fontWeight: 600, color: C.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{nameOf(u)}</div>
                    <div style={{ fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontSize: rank === 1 ? "clamp(34px,4.2vw,50px)" : "clamp(26px,3vw,34px)", fontWeight: 800, lineHeight: 1.02, letterSpacing: "-.02em", marginTop: 6, color: m.color, textShadow: `0 0 30px ${m.glow}` }}>{fmtPts(u.points)}</div>
                    <div style={{ fontSize: 11.5, color: C.t3, marginTop: 3, fontFamily: NUM }}>{u.count} รายการ · ดูหลักฐาน ›</div>
                  </div>

                  {/* pedestal — 3D metal with foreshortened top + specular */}
                  <div style={{ position: "relative", width: "100%", marginTop: 18, perspective: 900 }}>
                    {/* top surface */}
                    <div style={{ height: 34, borderRadius: 5, transform: "rotateX(56deg)", transformOrigin: "bottom", marginBottom: -3,
                      background: `linear-gradient(180deg, ${m.edge}, ${m.mid})`,
                      boxShadow: `inset 0 0 14px rgba(0,0,0,.25), 0 -2px 8px ${m.glow}` }} />
                    {/* front face */}
                    <div style={{ position: "relative", height: m.h, borderRadius: "3px 3px 7px 7px", overflow: "hidden",
                      background: faceGrad,
                      boxShadow: `inset 0 2px 0 rgba(255,255,255,.55), inset 0 -22px 34px rgba(0,0,0,.4), inset -14px 0 22px rgba(0,0,0,.28), inset 14px 0 22px rgba(255,255,255,.12), 0 26px 50px -20px ${m.glow}`,
                      display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {/* specular sweep */}
                      <div style={{ position: "absolute", top: 0, bottom: 0, left: "18%", width: 26, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent)", transform: "skewX(-12deg)", opacity: .5 }} />
                      <div style={{ position: "absolute", top: 0, bottom: 0, right: "26%", width: 12, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent)", transform: "skewX(-12deg)", opacity: .35 }} />
                      <span style={{ fontFamily: NUM, fontSize: rank === 1 ? "clamp(46px,6vw,72px)" : "clamp(34px,4vw,52px)", fontWeight: 900, color: "rgba(30,20,0,.30)", textShadow: "0 2px 1px rgba(255,255,255,.4), 0 -1px 1px rgba(0,0,0,.3)" }}>{rank}</span>
                    </div>
                    {/* floor reflection */}
                    <div style={{ height: Math.round(m.h * 0.5), borderRadius: "0 0 7px 7px", transform: "scaleY(-1)", background: faceGrad, opacity: .14, filter: "blur(1.5px)",
                      WebkitMaskImage: "linear-gradient(180deg, rgba(0,0,0,.75), transparent 82%)", maskImage: "linear-gradient(180deg, rgba(0,0,0,.75), transparent 82%)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (!busy && res) ? (
        <div style={{ margin: `20px ${PAD} 40px`, textAlign: "center", padding: "72px 20px", borderRadius: 22, border: `1px solid ${C.hair}`, background: "radial-gradient(100% 100% at 50% 0%, rgb(var(--n-accent) / .07), var(--surface) 70%)" }}>
          <Trophy size={44} style={{ color: C.t3, margin: "0 auto 14px" }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.t2 }}>ยังไม่มีแต้มในช่วงนี้</div>
          <div style={{ fontSize: 13.5, color: C.t3, marginTop: 6 }}>แต้มจะปรากฏเมื่อมีการตอบแชทหรือให้สิทธิ์ TradingView</div>
        </div>
      ) : null}

      {/* ═══ ตารางทุกคน แยกตามประเภท — กดแถวเพื่อดูหลักฐาน ═══ */}
      {view === "board" && board.length > 0 && (
        <div style={{ padding: `8px ${PAD} 12px` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 4px" }}>
            <span style={{ fontSize: 11, letterSpacing: ".32em", textTransform: "uppercase", color: C.t3, fontWeight: 600, fontFamily: NUM }}>แต้มทุกคน · กดชื่อเพื่อดูหลักฐาน</span>
            <span style={{ flex: 1, height: 1, background: C.hair }} />
          </div>
          <div className="lb-grid" style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "10px 0", fontSize: 11, letterSpacing: ".04em", color: C.t3, fontFamily: NUM }}>
            <span>#</span><span>ผู้ตอบ</span>
            <span style={{ textAlign: "right" }} className="lb-hide-sm">นอกเวลา</span>
            <span style={{ textAlign: "right" }} className="lb-hide-sm">ในเวลา</span>
            <span style={{ textAlign: "right" }} className="lb-hide-sm">TV</span>
            <span style={{ textAlign: "right" }} className="lb-hide-sm">ปรับ/หัก</span>
            <span style={{ textAlign: "right" }}>รวม</span>
          </div>
          {board.map((u, i) => {
            const k = u.by_kind || {};
            const adj = (k.adjustment || 0) + (k.reversal || 0);
            const cell = (v, color) => <span style={{ textAlign: "right", fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontSize: 14, color: v ? color : C.t3 }} className="lb-hide-sm">{v ? fmtPts(v) : "–"}</span>;
            return (
              <button key={u.email} type="button" className="lb-row lb-grid" onClick={() => setStaff(u)}
                style={{ width: "100%", textAlign: "left", display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "14px 0", borderTop: `1px solid ${C.hair}`, borderRadius: 8, background: "transparent", cursor: "pointer" }}>
                <span style={{ fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontSize: 15, color: C.t3, fontWeight: 300 }}>{String(i + 1).padStart(2, "0")}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                  <span style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, fontFamily: NUM, color: C.t2, background: "rgb(var(--n-ink-3) / .13)", border: `1px solid ${C.border}` }}>{nameOf(u).slice(0, 2).toUpperCase()}</span>
                  <span style={{ minWidth: 0 }}>
                    <span title={u.email} style={{ display: "block", color: C.t1, fontWeight: 500, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(u)}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: C.t3 }}>{u.count} รายการ{u.zero ? ` · ${u.zero} รายการ 0 แต้ม` : ""}</span>
                  </span>
                </div>
                {cell(k.reply_offhours, C.purple)}
                {cell(k.reply_office, C.t1)}
                {cell((k.tv_grant || 0) + (k.tv_renew || 0), C.green)}
                {cell(adj, adj < 0 ? C.red : C.gold)}
                <span style={{ textAlign: "right", fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 19, color: C.t1 }}>{fmtPts(u.points)}</span>
              </button>
            );
          })}
        </div>
      )}

      {view === "disputes" && period && <div style={{ padding: `20px ${PAD} 12px` }}><DisputesPanel period={period} isOwner={!!res?.is_owner} onChanged={() => load()} /></div>}
      {view === "rules" && res && <div style={{ padding: `20px ${PAD} 12px` }}><RulesPanel rules={res.rules} isOwner={!!res.is_owner} onChanged={() => load()} /></div>}
      {view === "holidays" && res && <div style={{ padding: `20px ${PAD} 12px` }}><HolidayCalendar isOwner={!!res.is_owner} onChanged={() => load()} /></div>}
      {view === "owner" && res?.is_owner && <div style={{ padding: `20px ${PAD} 12px` }}><OwnerTools overview={res} onChanged={() => load()} /></div>}

      <div style={{ padding: `10px ${PAD} 32px` }}>
        <p style={{ fontSize: 12, color: C.t3, display: "flex", alignItems: "center", gap: 8, margin: 0, lineHeight: 1.6 }}>
          <span style={{ color: C.gold }}>◆</span> แต้มทุกรายการบันทึกตอนทำงานจริง แก้/ลบไม่ได้ · คนตอบนับจากบัญชีที่ล็อกอิน · เห็นแต้มไม่ถูกต้องกด "โต้แย้ง" ได้ภายใน {res?.rules?.dispute_days ?? 3} วันหลังสิ้นเดือน
        </p>
      </div>

      <StaffEventsDialog open={!!staff} period={period} staff={staff} isOwner={!!res?.is_owner}
        onClose={() => setStaff(null)} onOpenChat={(id) => goToChat({ id })} onChanged={() => load()} />
    </div>
  );
}
