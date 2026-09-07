"use client";

// ชิ้นส่วนแสดงผลของหน้า "วิเคราะห์" — การ์ดตัวเลข กราฟแท่ง โดนัท เส้นรายวัน กรวย และตัวเลือกช่วงวัน
//
// แยกออกมาจาก AnalyzeTab.jsx เพราะทุกตัวรับค่าผ่าน props เท่านั้น ไม่มี state ร่วมกับหน้ารายงาน
// และถูกใช้ซ้ำทั้งในการ์ดสรุป แผ่นรายละเอียดแอด และหน้าเปรียบเทียบ
import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { DATE_PRESETS, VERDICT_META, fmtMoney, fmtNum, headlineResult, rangeLabel } from "./analyzeLabels";

export function VerdictBadge({ verdict }) {
  const m = VERDICT_META[verdict];
  if (!m) return null;
  const { label, cls, Icon } = m;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${cls}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

export function KpiTile({ label, value, sub, tone = "slate", secondaryLabel, secondaryValue }) {
  const tones = { slate: "text-slate-800", green: "text-emerald-600", rose: "text-rose-600", blue: "text-blue-600", amber: "text-amber-600" };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 min-w-0">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums break-words ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
      {secondaryLabel && secondaryValue != null && (
        <div className="mt-2 pt-2 border-t border-slate-200/80 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span className="text-[11px] text-slate-500">{secondaryLabel}</span>
          <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${tones[tone]}`}>{secondaryValue}</span>
        </div>
      )}
    </div>
  );
}

// ---- ชิ้นส่วนแดชบอร์ดแบบอ่านง่าย ----
// เดิมแดชบอร์ดวางตัวเลข 8 ช่องน้ำหนักเท่ากันหมด แล้วใช้ศัพท์เทคนิคล้วน (CPM/CTR/CPC/Conv. rate)
// คนที่ไม่ได้ยิงแอดเป็นอ่านแล้วไม่รู้ว่าควรดูตัวไหนก่อน จึงจัดลำดับใหม่:
//   1) ผลลัพธ์ที่ซื้อจริง + ต้นทุนต่อครั้ง = ตัวใหญ่สุด
//   2) ที่เหลือจัดเป็นกลุ่มมีหัวข้อ พร้อมชื่อภาษาคน ศัพท์เทคนิคย้ายไปเป็นตัวเล็ก

// เลือกว่า "ผลลัพธ์" ของแอดชิ้นนี้คืออะไร — หลักเดียวกับตารางแคมเปญ

export function HeroResult({ o, rangeText }) {
  const res = headlineResult(o);
  const perUnit = res.value > 0 ? o.spend / res.value : null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="text-xs font-medium text-slate-500">{rangeText} · โฆษณาชิ้นนี้ได้อะไรมา</div>
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <div className="text-4xl sm:text-5xl font-bold tabular-nums text-slate-900">{fmtNum(res.value)}</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{res.label}</div>
          <div className="text-[11px] text-slate-500">{res.hint}</div>
        </div>
        <div className="h-12 w-px bg-slate-200 hidden sm:block" />
        <div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">{fmtMoney(o.spend)}฿</div>
          <div className="mt-1 text-sm font-medium text-slate-600">จ่ายไปทั้งหมด</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">{perUnit != null ? `${fmtMoney(perUnit)}฿` : "—"}</div>
          <div className="mt-1 text-sm font-medium text-slate-600">เฉลี่ยครั้งละ</div>
        </div>
      </div>
      {/* สรุปเป็นประโยคเดียว — คนที่ไม่เคยยิงแอดอ่านบรรทัดนี้บรรทัดเดียวก็เข้าใจ
          ไม่ตัดสินว่าดีหรือแย่ เพราะยังไม่มีเป้าหมายให้เทียบ ปล่อยให้ส่วน AI เป็นคนสรุป */}
      <p className="mt-4 text-sm leading-relaxed text-slate-600">
        {res.value > 0
          ? <>จ่ายไป <b className="text-slate-900">{fmtMoney(o.spend)}฿</b> ได้ <b className="text-slate-900">{res.label} {fmtNum(res.value)}</b> ราย เฉลี่ยรายละ <b className="text-slate-900">{fmtMoney(perUnit)}฿</b> · มีคนเห็นโฆษณา {fmtNum(o.reach)} คน</>
          : <>ช่วงนี้ยังไม่มีผลลัพธ์เข้ามา {o.spend > 0 ? `แม้จะใช้เงินไปแล้ว ${fmtMoney(o.spend)}฿` : "และยังไม่มีการใช้เงิน"}</>}
      </p>
    </div>
  );
}

export function MetricGroup({ title, hint, children }) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-2">{children}</div>
    </section>
  );
}

// ชื่อภาษาคนเป็นตัวหลัก ศัพท์เทคนิคเป็นตัวเล็กใต้ค่า — คนที่รู้ศัพท์อยู่แล้วยังหาเจอ

export function PlainTile({ name, value, jargon, note, tone = "slate" }) {
  const tones = { slate: "text-slate-900", green: "text-emerald-700", rose: "text-rose-700", blue: "text-blue-700" };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 min-w-0">
      <div className="text-[11px] font-medium text-slate-600">{name}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums break-words ${tones[tone]}`}>{value}</div>
      {jargon && <div className="text-[10px] uppercase tracking-wide text-slate-400">{jargon}</div>}
      {note && <div className="mt-1 text-[11px] text-slate-500">{note}</div>}
    </div>
  );
}

export function EmptyRange({ rangeText, onWiden }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="text-base font-semibold text-slate-800">{rangeText}นี้ยังไม่มีข้อมูล</div>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        โฆษณาชิ้นนี้ยังไม่มีการใช้เงินหรือยอดการมองเห็นในช่วงที่เลือก — ลองขยายช่วงเวลาให้กว้างขึ้น
      </p>
      {onWiden && (
        <button onClick={onWiden} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          ดูย้อนหลัง 30 วัน
        </button>
      )}
    </div>
  );
}

export function GaugeMeter({ value, max = 100, label, display, tone = "#9D6BFF" }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = 52, cx = 70, cy = 66;
  const pt = (frac) => {
    const t = Math.PI * (1 - frac); // left(π)->right(0)
    return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  };
  const [lx, ly] = pt(0);
  const [ex, ey] = pt(pct);
  const [rx, ry] = pt(1);
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 84" className="w-full max-w-[150px]">
        <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${rx} ${ry}`} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="12" strokeLinecap="round" />
        <path d={`M ${lx} ${ly} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke={tone} strokeWidth="12" strokeLinecap="round" />
        <text x="70" y="60" textAnchor="middle" className="fill-slate-800" style={{ fontSize: 18, fontWeight: 700 }}>{display}</text>
      </svg>
      <div className="text-xs text-slate-500 -mt-1">{label}</div>
    </div>
  );
}

export function BarList({ items, valueKey = "impressions", labelMap, format, tone = "#9D6BFF", empty = "ไม่มีข้อมูล" }) {
  const list = (items || []).filter((i) => (i[valueKey] || 0) > 0).sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
  if (list.length === 0) return <div className="text-xs text-slate-400 py-3 text-center">{empty}</div>;
  const maxVal = Math.max(1, ...list.map((i) => i[valueKey] || 0));
  return (
    <div className="space-y-1.5">
      {list.map((it) => {
        const v = it[valueKey] || 0;
        const label = labelMap ? labelMap(it.key) : it.key;
        return (
          <div key={it.key} className="flex items-center gap-2 text-xs">
            <div className="w-24 shrink-0 truncate text-slate-600" title={label}>{label}</div>
            <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
              <div className="h-3 rounded-full" style={{ width: `${(v / maxVal) * 100}%`, background: tone }} />
            </div>
            <div className="w-16 shrink-0 text-right text-slate-700">{format ? format(v, it) : fmtNum(v)}</div>
          </div>
        );
      })}
    </div>
  );
}

// รายการแท่งแบบหลายมิติพร้อมกัน — แต่ละมิติเป็นสีของตัวเอง (แต่ละมิติสเกลตามค่าสูงสุดของตัวเอง)

export function BarListMulti({ items, metrics, labelMap, empty = "ไม่มีข้อมูล" }) {
  const list = (items || []).filter((i) => metrics.some((m) => (i[m.key] || 0) > 0));
  if (list.length === 0) return <div className="text-xs text-slate-400 py-3 text-center">{empty}</div>;
  const sortVal = (i) => metrics.reduce((s, m) => s + (i[m.key] || 0), 0);
  const sorted = [...list].sort((a, b) => sortVal(b) - sortVal(a));
  const single = metrics.length === 1;
  // มิติเดียว: หลอดสเกลตามค่าสูงสุด (ดูการกระจายในมิติเดียว)
  // หลายมิติ: หลอด = สัดส่วน % ภายในมิตินั้น เพื่อเทียบข้ามมิติได้ (ค่าคนละสเกลกัน)
  const maxByKey = {}, totalByKey = {};
  metrics.forEach((m) => {
    maxByKey[m.key] = Math.max(1, ...sorted.map((i) => i[m.key] || 0));
    totalByKey[m.key] = Math.max(1, sorted.reduce((s, i) => s + (i[m.key] || 0), 0));
  });
  return (
    <div className="space-y-2.5">
      {sorted.map((it) => {
        const label = labelMap ? labelMap(it.key) : it.key;
        return (
          <div key={it.key} className="text-xs">
            <div className="text-slate-600 mb-1 truncate" title={label}>{label}</div>
            <div className="space-y-1">
              {metrics.map((m) => {
                const v = it[m.key] || 0;
                const pct = (v / totalByKey[m.key]) * 100;
                const width = single ? (v / maxByKey[m.key]) * 100 : pct;
                return (
                  <div key={m.key} className="flex items-center gap-2">
                    {!single && <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: m.color }} title={m.label} />}
                    <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div className="h-2.5 rounded-full" style={{ width: `${width}%`, background: m.color }} />
                    </div>
                    <div className="w-20 shrink-0 text-right text-slate-700">
                      {fmtNum(v)}{!single && <span className="text-slate-400"> · {Math.round(pct)}%</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GenderDonut({ gender, valueKey = "impressions" }) {
  const items = (gender || []).filter((g) => (g[valueKey] || 0) > 0);
  const total = items.reduce((s, g) => s + (g[valueKey] || 0), 0);
  if (total === 0) return <div className="text-xs text-slate-400 py-3 text-center">ไม่มีข้อมูล</div>;
  const colors = { male: "#3b82f6", female: "#ec4899", unknown: "#94a3b8" };
  const labels = { male: "ชาย", female: "หญิง", unknown: "ไม่ระบุ" };
  const C = 2 * Math.PI * 42;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0">
        <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="16" />
        {items.map((g) => {
          const frac = (g[valueKey] || 0) / total;
          const seg = (
            <circle
              key={g.key}
              cx="60" cy="60" r="42" fill="none"
              stroke={colors[g.key] || "#94a3b8"} strokeWidth="16"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += frac * C;
          return seg;
        })}
      </svg>
      <div className="space-y-1 text-xs">
        {items.map((g) => (
          <div key={g.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[g.key] || "#94a3b8" }} />
            <span className="text-slate-600">{labels[g.key] || g.key}</span>
            <span className="text-slate-400">{Math.round(((g[valueKey] || 0) / total) * 100)}%</span>
            <span className="text-slate-500">· {fmtNum(g[valueKey] || 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// กราฟเทรนด์รายวัน — มีแกน X (วันที่) / แกน Y (ค่า) + เส้นกริด, รองรับหลายเส้นพร้อมกัน

export function DailyMultiChart({ points, series }) {
  const data = points || [];
  if (data.length === 0) return <div className="text-xs text-slate-500 py-6 text-center">ไม่มีข้อมูลรายวัน</div>;
  const list = (series || []).length ? series : [{ key: "spend", label: "ค่าใช้จ่าย", color: "#9D6BFF" }];
  const single = list.length === 1;
  const W = 640, H = 220, mL = 46, mR = 14, mT = 12, mB = 28;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const n = data.length;
  const x = (i) => mL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const maxByKey = {};
  list.forEach((s) => { maxByKey[s.key] = Math.max(1, ...data.map((d) => d[s.key] || 0)); });
  // แกน Y: มิติเดียว = ค่าจริง, หลายมิติ = 0-100% (แต่ละเส้นเทียบจุดสูงสุดของตัวเอง)
  const yTop = single ? maxByKey[list[0].key] : 1;
  const yOf = (v, key) => mT + plotH - (single ? v / yTop : v / maxByKey[key]) * plotH;
  const yTicks = [0, 0.5, 1].map((f) => ({ yy: mT + plotH - f * plotH, label: single ? fmtNum(yTop * f) : `${Math.round(f * 100)}%` }));
  const fmtDate = (ds) => { if (!ds) return ""; const p = String(ds).split("-"); return p.length === 3 ? `${+p[2]}/${+p[1]}` : ds; };
  const step = Math.max(1, Math.ceil(n / 5));
  const xTicks = [];
  for (let i = 0; i < n; i += step) xTicks.push(i);
  if (n > 1 && xTicks[xTicks.length - 1] !== n - 1) xTicks.push(n - 1);
  return (
    <div>
      {!single && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
          {list.map((s) => (
            <div key={s.key} className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label} <span className="text-slate-400">· สูงสุด {fmtNum(maxByKey[s.key])}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-slate-500" style={{ height: "auto" }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={mL} y1={t.yy} x2={W - mR} y2={t.yy} stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
            <text x={mL - 6} y={t.yy + 3} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.7">{t.label}</text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 9} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.7">{fmtDate(data[i]?.date)}</text>
        ))}
        {list.map((s) => {
          const pts = data.map((d, i) => `${x(i)},${yOf(d[s.key] || 0, s.key)}`).join(" ");
          const area = `${x(0)},${mT + plotH} ${pts} ${x(n - 1)},${mT + plotH}`;
          return (
            <g key={s.key}>
              {single && <polygon points={area} fill={s.color} opacity="0.12" />}
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
      <div className="text-[10px] text-slate-400 text-center mt-1">
        แกนนอน = วันที่ · แกนตั้ง = {single ? list[0].label : "สัดส่วน % เทียบจุดสูงสุดของแต่ละเส้น (ค่าจริงดูที่คำอธิบายด้านบน)"}
      </div>
    </div>
  );
}

// ขั้นสุดท้ายต้องเป็น "ผลลัพธ์ที่แคมเปญนั้นซื้อจริง" ไม่ใช่ลีดเสมอไป
// เดิมตรึงเป็น "ลีด" ทำให้แคมเปญที่ซื้อบทสนทนาเห็น 222 ลีด ขณะที่หัวแดชบอร์ดเห็น 386 คนทักแชท
// ตัวเลขสองอันในหน้าเดียวกันไม่ตรงกัน อ่านแล้วไม่รู้จะเชื่ออันไหน

export function Funnel({ impressions, clicks, result }) {
  const stages = [
    { label: "คนเห็นโฆษณา", jargon: "Impressions", value: impressions, color: "#6366f1" },
    { label: "กดโฆษณา", jargon: "Clicks", value: clicks, color: "#0ea5e9" },
    { label: result?.label || "ผลลัพธ์", jargon: result?.hint || "", value: result?.value ?? 0, color: "#10b981" },
  ];
  const top = Math.max(1, impressions);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev && prev > 0 ? Math.round((s.value / prev) * 100 * 10) / 10 : null;
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs text-slate-600">
              <span className="min-w-0">
                {s.label}
                {s.jargon && <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">{s.jargon}</span>}
              </span>
              <span className="font-medium text-slate-800">
                {fmtNum(s.value)}
                {conv != null && <span className="text-slate-400 font-normal"> · {conv}%</span>}
              </span>
            </div>
            <div className="bg-slate-100 rounded-md h-5 mt-0.5 overflow-hidden">
              <div className="h-5 rounded-md" style={{ width: `${Math.max(2, (s.value / top) * 100)}%`, background: s.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RangePicker({ value, onChange, disabled }) {
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <select
        value={value.preset}
        onChange={(e) => onChange({ ...value, preset: e.target.value })}
        disabled={disabled}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      {value.preset === "custom" && (
        <div className="flex items-center gap-1">
          <input type="date" value={value.since || ""} max={value.until || undefined} onChange={(e) => onChange({ ...value, since: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          <span className="text-xs text-slate-400">-</span>
          <input type="date" value={value.until || ""} min={value.since || undefined} onChange={(e) => onChange({ ...value, until: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
        </div>
      )}
    </div>
  );
}

// การ์ดลูก (ชุดโฆษณา/โฆษณา) สำหรับ drill-down — มีปุ่มแดชบอร์ด และกางดูลูกต่อได้
