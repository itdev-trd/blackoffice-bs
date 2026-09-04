"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Loader2, RefreshCw, Crown, Trophy } from "lucide-react";

export default function LeaderboardTab({ active = true }) {
  const thDay = (o = 0) => { const d = new Date(Date.now() + 7 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10); };
  const thMonth = (mo, which) => { const d = new Date(Date.now() + 7 * 3600 * 1000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + mo + (which === "end" ? 1 : 0)); if (which === "end") d.setUTCDate(0); return d.toISOString().slice(0, 10); };
  const PRESETS = [
    ["วันนี้", () => [thDay(0), thDay(0)]],
    ["เมื่อวาน", () => [thDay(-1), thDay(-1)]],
    ["3 วันล่าสุด", () => [thDay(-2), thDay(0)]],
    ["7 วันล่าสุด", () => [thDay(-6), thDay(0)]],
    ["14 วันล่าสุด", () => [thDay(-13), thDay(0)]],
    ["30 วันล่าสุด", () => [thDay(-29), thDay(0)]],
    ["เดือนนี้", () => [thMonth(0, "start"), thDay(0)]],
    ["เดือนที่แล้ว", () => [thMonth(-1, "start"), thMonth(-1, "end")]],
    ["3 เดือนล่าสุด", () => [thMonth(-2, "start"), thDay(0)]],
    ["6 เดือนล่าสุด", () => [thMonth(-5, "start"), thDay(0)]],
    ["ปีนี้", () => { const d = new Date(Date.now() + 7 * 3600 * 1000); return [`${d.getUTCFullYear()}-01-01`, thDay(0)]; }],
  ];
  // ช่วงที่ใช้บ่อยอยู่เป็นปุ่มลัด ที่เหลืออยู่ในดรอปดาวน์ — กันแถบเครื่องมือรกด้วยชิป 11 อัน
  const QUICK_PRESETS = [0, 1, 3, 5, 6];
  const OTHER_PRESETS = PRESETS.map((_, i) => i).filter((i) => !QUICK_PRESETS.includes(i));
  const [since, setSince] = useState(() => thDay(-6));
  const [until, setUntil] = useState(() => thDay(0));
  const [presetIdx, setPresetIdx] = useState(3);   // 7 วันล่าสุด
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState(false);       // ไฮไลต์ตอนอัปเดตสด
  const reloadRef = useRef(null);
  const fmtDMY = (iso) => { const [y, m, d] = String(iso).split("-"); return `${Number(d)}/${Number(m)}/${y}`; };
  const nameOf = (e) => { const s = String(e || ""); if (s.startsWith("(")) return s; const at = s.indexOf("@"); return at > 0 ? s.slice(0, at) : s; };

  const load = useCallback(async (flashOnDone = false) => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.functions.invoke("leaderboard", { body: { since, until } });
    setBusy(false);
    if (error || !data?.ok) {
      // error ที่ Supabase ส่งกลับเป็นภาษาอังกฤษเชิงเทคนิค ("Edge Function returned a non-2xx status code")
      // ผู้ใช้อ่านแล้วไม่รู้ว่าต้องทำอะไร — แปลงเป็นข้อความที่บอกสาเหตุที่เป็นไปได้จริง
      const raw = data?.error || error?.message || "";
      const technical = /non-2xx|Failed to fetch|FunctionsHttpError|NetworkError/i.test(raw);
      setErr(technical || !raw ? "โหลดกระดานแต้มไม่สำเร็จ — ตรวจว่าตั้งค่า API key ของ AI ในหน้าตั้งค่าแล้ว และมีข้อมูลการตอบแชทในช่วงเวลาที่เลือก" : raw);
      return;
    }
    setRes(data);
    if (flashOnDone) { setFlash(true); setTimeout(() => setFlash(false), 900); }
  }, [since, until]);
  reloadRef.current = load;

  useEffect(() => { if (active) load(); }, [since, until, active, load]);

  // อัปเดตเรียลไทม์ — reply_stats เปลี่ยน (ส่ง/ตอบ) → รีโหลดแบบหน่วง (debounce) กัน spam
  useEffect(() => {
    if (!active) return;
    let t = null;
    const ch = supabase.channel("lb-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "reply_stats" }, () => {
        clearTimeout(t); t = setTimeout(() => reloadRef.current && reloadRef.current(true), 2500);
      }).subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [active]);

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
  const rest = board.slice(3);
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
    <div className="leaderboard-shell w-full max-w-[1400px] mx-auto" style={{ fontFamily: FONT, background: C.bg, color: C.t1, borderRadius: 26, border: `1px solid ${C.border}`, boxShadow: "0 24px 70px -42px rgb(var(--n-ink) / .28)", overflow: "hidden" }}>
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
          .lb-grid{grid-template-columns:38px 1fr 92px!important}
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
              จัดอันดับแต้มพิเศษจากการตอบแชท<span style={{ color: C.t1 }}>นอกเวลาทำการ</span> — ยิ่งตอบดึก ยิ่งเป็นวันหยุด และยิ่งตอบไว ยิ่งได้แต้มมาก
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
              <span style={{ color: C.gold, fontWeight: 600, fontFamily: NUM }}>{fmtDMY(since)}{since !== until ? `  –  ${fmtDMY(until)}` : ""}</span>
            </div>
          </div>
        </div>

        {/* Toolbar: editorial tabs + date + live — separated by hairlines */}
        <div className="lb-toolbar" style={{ marginTop: 30, borderTop: `1px solid ${C.hair}`, borderBottom: `1px solid ${C.hair}`, padding: "14px 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          {/* เดิมวางช่วงเวลาทั้ง 11 แบบเป็นชิปเรียงแถวเดียว ทำให้แถบเครื่องมือรกและหาปุ่มที่ต้องการยาก
              เหลือเฉพาะช่วงที่ใช้บ่อยเป็นปุ่มลัด ที่เหลือย้ายไปดรอปดาวน์ "ช่วงอื่น" */}
          <div className="lb-presets" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "clamp(8px,1.2vw,14px)" }}>
            {QUICK_PRESETS.map((i) => {
              const [label, fn] = PRESETS[i];
              const on = presetIdx === i;
              return (
                <button key={label} className="lb-tab" onClick={() => { const [s, u] = fn(); setSince(s); setUntil(u); setPresetIdx(i); }}
                  style={{ position: "relative", background: on ? "rgba(185,133,0,.14)" : "transparent", border: on ? `1px solid ${C.gold}` : "1px solid transparent", borderRadius: 8, cursor: "pointer", padding: "8px 13px", fontSize: 13.5, fontWeight: on ? 700 : 500, color: on ? C.t1 : C.t3, fontFamily: FONT, boxShadow: on ? `0 0 0 2px rgba(185,133,0,.08)` : "none" }}>
                  {label}
                </button>
              );
            })}
            <select
              aria-label="ช่วงเวลาอื่น"
              value={QUICK_PRESETS.includes(presetIdx) ? "" : String(presetIdx)}
              onChange={(e) => {
                const i = Number(e.target.value);
                if (!Number.isInteger(i) || !PRESETS[i]) return;
                const [s, u] = PRESETS[i][1]();
                setSince(s); setUntil(u); setPresetIdx(i);
              }}
              style={{ background: "transparent", color: OTHER_PRESETS.includes(presetIdx) ? C.t1 : C.t3, border: `1px solid ${OTHER_PRESETS.includes(presetIdx) ? C.gold : C.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontFamily: FONT, cursor: "pointer" }}
            >
              <option value="">ช่วงอื่น…</option>
              {OTHER_PRESETS.map((i) => <option key={PRESETS[i][0]} value={i}>{PRESETS[i][0]}</option>)}
            </select>
          </div>
          <div className="lb-toolbar-controls" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="date" className="lb-date" value={since} onChange={(e) => { setSince(e.target.value); setPresetIdx(-1); }}
              style={{ background: "transparent", color: C.t2, border: `1px solid ${C.border}`, borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontFamily: NUM }} />
            <span style={{ color: C.t3, fontSize: 12 }}>→</span>
            <input type="date" className="lb-date" value={until} onChange={(e) => { setUntil(e.target.value); setPresetIdx(-1); }}
              style={{ background: "transparent", color: C.t2, border: `1px solid ${C.border}`, borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontFamily: NUM }} />
            <button onClick={() => load()} disabled={busy} className="lb-ico" title="รีเฟรช"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: "50%", background: "transparent", color: C.t2, border: `1px solid ${C.border}`, cursor: "pointer", opacity: busy ? .5 : 1 }}>
              {busy ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            </button>
            <span className="lb-live" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: C.green, fontWeight: 600, letterSpacing: ".02em" }}>
              <span style={{ position: "relative", width: 7, height: 7 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: C.green, animation: "lbPulse 2s ease-out infinite" }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: C.green }} />
              </span>
              LIVE
            </span>
          </div>
        </div>
        {err && <div style={{ marginTop: 16, fontSize: 13, color: C.red, background: "rgba(255,92,92,.07)", border: `1px solid rgba(255,92,92,.22)`, borderRadius: 12, padding: "10px 14px" }}>{err}</div>}
      </div>

      {/* ═══ CINEMATIC PODIUM STAGE (hero) ═══ */}
      {board.length > 0 ? (
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
                <div key={rank} style={{ width: colW, display: "flex", flexDirection: "column", alignItems: "center", zIndex: m.z, transform: `scale(${m.depth})`, opacity: m.depth, filter: rank === 1 ? "none" : "saturate(.95)" }}>
                  {/* volumetric spotlight cone */}
                  <div style={{ position: "absolute", top: -30, width: "150%", height: 430, clipPath: "polygon(40% 0,60% 0,100% 100%,0 100%)", background: `linear-gradient(180deg, ${m.spot} 0%, transparent 78%)`, filter: "blur(20px)", mixBlendMode: "screen", opacity: rank === 1 ? .95 : .6, pointerEvents: "none" }} />

                  {rank === 1 && <Crown size={30} fill={C.gold} style={{ color: C.gold, marginBottom: 6, filter: `drop-shadow(0 0 12px ${C.gold})`, animation: "lbFloat 3.2s ease-in-out infinite", zIndex: 3 }} />}

                  {/* avatar — floating, volumetric ring */}
                  <div style={{ position: "relative", zIndex: 3, width: m.av, height: m.av, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: NUM, fontWeight: 800, fontSize: m.av * 0.3, color: "var(--ink)",
                    background: "radial-gradient(circle at 34% 28%, rgb(var(--n-ink-3) / .30), rgb(var(--n-ink-3) / .13) 78%)",
                    border: `2px solid ${m.ring}`,
                    boxShadow: `0 0 0 6px rgb(var(--n-ink) / .10), 0 22px 44px -16px ${m.glow}, 0 0 46px -6px ${m.glow}, inset 0 2px 6px rgba(255,255,255,.12)` }}>
                    {nameOf(u.email).slice(0, 2).toUpperCase()}
                    <span style={{ position: "absolute", bottom: -8, right: -8, width: 30, height: 30, borderRadius: "50%", background: C.ink, border: `1px solid ${m.ring}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: `0 6px 14px rgb(var(--n-ink) / .25)` }}>{m.medal}</span>
                  </div>

                  {/* name + score — editorial */}
                  <div style={{ textAlign: "center", marginTop: 16, width: "100%", zIndex: 3 }}>
                    <div title={u.email} style={{ fontSize: 13.5, fontWeight: 600, color: C.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{nameOf(u.email)}</div>
                    <div style={{ fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontSize: rank === 1 ? "clamp(34px,4.2vw,50px)" : "clamp(26px,3vw,34px)", fontWeight: 800, lineHeight: 1.02, letterSpacing: "-.02em", marginTop: 6, color: m.color, textShadow: `0 0 30px ${m.glow}` }}>{u.points.toLocaleString()}</div>
                    <div style={{ fontSize: 11.5, color: C.t3, marginTop: 3, fontFamily: NUM }}>{u.count} ครั้ง · ทัน {u.in_time}</div>
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
          <div style={{ fontSize: 13.5, color: C.t3, marginTop: 6 }}>แต้มจะปรากฏเมื่อมีการตอบแชทนอกเวลาทำการ</div>
        </div>
      ) : null}

      {/* ═══ Editorial ranking list ═══ */}
      {rest.length > 0 && (
        <div style={{ padding: `8px ${PAD} 12px` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 4px" }}>
            <span style={{ fontSize: 11, letterSpacing: ".32em", textTransform: "uppercase", color: C.t3, fontWeight: 600, fontFamily: NUM }}>อันดับ 4 เป็นต้นไป</span>
            <span style={{ flex: 1, height: 1, background: C.hair }} />
          </div>
          {/* column labels */}
          <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 96px 96px 80px", alignItems: "center", padding: "10px 0", fontSize: 11, letterSpacing: ".04em", color: C.t3, fontFamily: NUM }}>
            <span>#</span><span>ผู้ตอบ</span>
            <span style={{ textAlign: "right" }}>แต้ม</span>
            <span style={{ textAlign: "right" }} className="lb-hide-sm">ทันเวลา</span>
            <span style={{ textAlign: "right" }} className="lb-hide-sm">ช้ากว่า</span>
          </div>
          {rest.map((u, i) => (
            <div key={u.email} className="lb-row" style={{ display: "grid", gridTemplateColumns: "44px 1fr 96px 96px 80px", alignItems: "center", padding: "16px 0", borderTop: `1px solid ${C.hair}`, borderRadius: 8 }}>
              <span style={{ fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontSize: 15, color: C.t3, fontWeight: 300 }}>{String(i + 4).padStart(2, "0")}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                <span style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, fontFamily: NUM, color: C.t2, background: "rgb(var(--n-ink-3) / .13)", border: `1px solid ${C.border}` }}>{nameOf(u.email).slice(0, 2).toUpperCase()}</span>
                <span title={u.email} style={{ color: C.t1, fontWeight: 500, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(u.email)}</span>
              </div>
              <span style={{ textAlign: "right", fontFamily: NUM, fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 19, color: C.purple, textShadow: `0 0 18px rgb(var(--n-accent) / .27)` }}>{u.points.toLocaleString()}</span>
              <span style={{ textAlign: "right", fontFamily: NUM, fontVariantNumeric: "tabular-nums", color: C.green, fontWeight: 600, fontSize: 15 }} className="lb-hide-sm">{u.in_time}</span>
              <span style={{ textAlign: "right", fontFamily: NUM, fontVariantNumeric: "tabular-nums", color: u.slow > 0 ? C.red : C.t3, fontWeight: u.slow > 0 ? 600 : 400, fontSize: 15 }} className="lb-hide-sm">{u.slow}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: `10px ${PAD} 32px` }}>
        <p style={{ fontSize: 12, color: C.t3, display: "flex", alignItems: "center", gap: 8, margin: 0, lineHeight: 1.6 }}>
          <span style={{ color: C.gold }}>◆</span> ยิ่งตอบดึก / วันหยุด / ตอบไว = ยิ่งได้แต้มมาก · ทันเวลา = แต้มเต็ม, ช้ากว่า = ครึ่งเดียว · นับเฉพาะการตอบนอกเวลาทำการ
        </p>
      </div>
    </div>
  );
}
