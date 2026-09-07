// ตัวสร้างไฟล์ PDF/HTML ของหน้า "วิเคราะห์" — เปิดหน้าต่างใหม่แล้วสั่งพิมพ์
//
// แยกออกมาจาก AnalyzeTab.jsx เพราะเป็นการปั้นสตริง HTML ล้วน ๆ ไม่เกี่ยวกับ React
// และเป็นส่วนที่ยาวที่สุดของไฟล์เดิม (~350 บรรทัด) ทำให้หาโค้ดหน้าจอจริงยาก
import {
  AGE_LABEL, BD_KEYS, BD_METRIC_LABEL, COMPARE_METRICS, DEVICE_LABEL, GENDER_LABEL,
  OBJECTIVE_LABEL, REGION_LABEL, beDateTH, escHtml, fmtMoney, fmtNum, headlineResult, rangeLabel,
} from "./analyzeLabels";
export function buildCompareHtml(rows, preset) {
  const esc = escHtml;
  const head = rows.map((r) => `<th>${esc(r.item.headline)}</th>`).join("");
  const body = COMPARE_METRICS.map((m) => {
    const cells = rows.map((r) => {
      const v = r.overall?.[m.key];
      return `<td style="text-align:right">${v == null ? "—" : esc(m.fmt(v))}</td>`;
    }).join("");
    return `<tr><th>${esc(m.label)}</th>${cells}</tr>`;
  }).join("");
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>เปรียบเทียบโฆษณา</title>
<style>body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:24px}
h1{font-size:18px} table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
th,td{border:1px solid #e2e8f0;padding:6px 8px} th{background:#f8fafc;text-align:left}
@page{margin:12mm;size:landscape}</style></head><body>${exportPageNavHtml("analyze")}
<h1>เปรียบเทียบโฆษณา (${rows.length} รายการ)</h1>
<div style="color:#64748b;font-size:12px">อัปเดต ${esc(new Date().toLocaleString("th-TH"))}</div>
<table><tr><th>ตัวชี้วัด</th>${head}</tr>${body}</table>
<script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
}

export function exportComparePdf(rows, preset) {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่"); return; }
  w.document.open();
  w.document.write(buildCompareHtml(rows, preset));
  w.document.close();
}

export function exportCampaignAnalysisPdf(result) {
  const esc = escHtml;
  const cards = (result.campaigns || [])
    .map((c) => {
      const m = c.metrics || {};
      const changes = (c.recommended_changes || []).map((ch) => `<li>${esc(ch.label_th || ch.action)}${ch.reason_th ? " — " + esc(ch.reason_th) : ""}</li>`).join("");
      return `<div class="c"><h2>${esc(c.name)}</h2>
        <div class="meta">${esc(c.objective || "")} · ${esc(c.effective_status || "")}</div>
        <table><tr><th>Spend</th><td>${esc(Math.round(m.spend || 0).toLocaleString())}฿</td><th>Leads</th><td>${esc(Math.round(m.leads || 0).toLocaleString())}</td></tr>
        <tr><th>CPL</th><td>${m.cpl ? Math.round(m.cpl).toLocaleString() + "฿" : "—"}</td><th>CTR</th><td>${esc((m.ctr || 0).toFixed(2))}%</td></tr></table>
        ${c.result_th ? `<p><b>ผล:</b> ${esc(c.result_th)}</p>` : ""}
        ${c.recommendation_th ? `<p><b>แนะนำ:</b> ${esc(c.recommendation_th)}</p>` : ""}
        ${changes ? `<p><b>สิ่งที่ควรปรับ:</b></p><ul>${changes}</ul>` : ""}</div>`;
    })
    .join("");
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>วิเคราะห์แคมเปญ</title>
<style>body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:24px;line-height:1.5}
h1{font-size:18px}h2{font-size:14px;margin:4px 0}.meta{color:#64748b;font-size:12px}
.c{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:10px 0;break-inside:avoid}
table{border-collapse:collapse;font-size:12px;margin:6px 0}th,td{border:1px solid #e2e8f0;padding:4px 8px;text-align:left}
ul{margin:4px 0 0 18px;font-size:12.5px}p{font-size:12.5px;margin:4px 0}@page{margin:14mm}</style></head><body>${exportPageNavHtml("campaigns")}
<h1>ผลวิเคราะห์แคมเปญ (${(result.campaigns || []).length} รายการ)</h1>
<div class="meta">อัปเดต ${esc(new Date(result.generated_at || Date.now()).toLocaleString("th-TH"))}</div>
${cards}
<script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่"); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function buildAnalysisHtml(analysis) {
  const a = analysis || {};
  const cl = a.campaign_level || {};
  const as = a.adset_level || {};
  const ad = a.ad_level || {};
  const dt = as.detailed_targeting || {};
  const lc = a.launch_config || null;
  const pref = a.preferences || null;

  const CONV = { instant_form: "เก็บลีดผ่านฟอร์ม", messaging: "ทักแชท", website: "เว็บ/แลนดิ้ง", calls: "โทร" };
  const FMT = { image: "รูปภาพ", video: "วิดีโอ", mixed: "ผสมรูป+วิดีโอ", auto: "ให้ AI แนะนำ" };
  const LANG = { th: "ไทย", en: "อังกฤษ", th_en: "ไทย+อังกฤษ", other: "อื่นๆ", auto: "ให้ AI แนะนำ" };
  const STYLE = {
    auto: "ให้ AI แนะนำ",
    lead_form: "เก็บลีดผ่านฟอร์ม",
    chat: "ทักแชท",
    traffic: "ส่งเข้าเว็บ",
    conversions: "ปิดการขายบนเว็บ",
  };

  const rows = (pairs) =>
    pairs
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([l, v]) => `<tr><th>${escHtml(l)}</th><td>${escHtml(v)}</td></tr>`)
      .join("");

  const chips = (arr) =>
    (arr || []).filter(Boolean).map((x) => `<span class="chip">${escHtml(x)}</span>`).join(" ");

  const recsHtml = (a.campaign_recommendations || [])
    .map(
      (r, i) => `
      <div class="rec">
        <div class="rec-h"><span class="rank">${escHtml(r.rank ?? i + 1)}</span> ${escHtml(r.objective_th || r.meta_objective || "")} ${
        r.meta_objective ? `<code>${escHtml(r.meta_objective)}</code>` : ""
      }</div>
        <table>${rows([
          ["จุดเก็บ Conversion", r.conversion_location_th],
          ["ทำไมแนะนำ", r.why],
          ["เหมาะกับ", r.best_for],
          ["ข้อควรระวัง", r.watchouts],
        ])}</table>
      </div>`
    )
    .join("");

  const section = (title, inner) => (inner ? `<h2>${escHtml(title)}</h2>${inner}` : "");

  const prefHtml = pref
    ? `<table>${rows([
        ["สะดวกยิงแบบ", STYLE[pref.campaign_style] || pref.campaign_style],
        ["รูปแบบครีเอทีฟ", FMT[pref.creative_format] || pref.creative_format],
        ["ภาษา", LANG[pref.language] || pref.language],
      ])}</table>`
    : "";

  const lcHtml = lc
    ? `<table>${rows([
        ["ประเภทแคมเปญ", lc.objective ? `${lc.objective}${lc.conversion_location ? " · " + (CONV[lc.conversion_location] || lc.conversion_location) : ""}` : null],
        ["รูปแบบครีเอทีฟ", FMT[lc.creative_format] || lc.creative_format],
        ["ภาษา", LANG[lc.language] || lc.language],
        ["Advantage+ Audience", lc.advantage_audience === 1 ? "เปิด" : "ปิด"],
        ["ตำแหน่งจัดวาง", lc.placements?.mode === "manual" ? `กำหนดเอง${(lc.placements.publisher_platforms || []).length ? " · " + lc.placements.publisher_platforms.join(", ") : ""}` : "Advantage+ (อัตโนมัติ)"],
        ["กลยุทธ์บิด", lc.bid_strategy],
        ["Advantage+ Creative", lc.advantage_plus_creative ? "เปิด" : "ปิด"],
        ["ปุ่ม CTA เริ่มต้น", lc.default_cta],
        ["หมวดโฆษณาพิเศษ", Array.isArray(lc.special_ad_categories) && lc.special_ad_categories.length ? lc.special_ad_categories.join(", ") : "ไม่มี"],
      ])}</table>`
    : "";

  const generatedAt = a.generated_at ? new Date(a.generated_at).toLocaleString("th-TH") : new Date().toLocaleString("th-TH");

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>คำแนะนำ AI Ads</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun','Noto Sans Thai','Prompt',system-ui,-apple-system,'Segoe UI',sans-serif; color:#1e293b; margin:32px; line-height:1.55; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:15px; margin:22px 0 8px; padding-bottom:4px; border-bottom:2px solid #0f172a; }
  .meta { color:#64748b; font-size:12px; margin-bottom:4px; }
  .summary { background:#f1f5f9; border-radius:8px; padding:12px; font-size:13px; margin-top:10px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; margin:6px 0 4px; }
  th { text-align:left; width:34%; color:#64748b; font-weight:600; vertical-align:top; padding:5px 8px; border-bottom:1px solid #e2e8f0; }
  td { padding:5px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; white-space:pre-line; }
  .rec { border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin:8px 0; break-inside:avoid; }
  .rec-h { font-weight:600; margin-bottom:2px; }
  .rank { display:inline-block; width:20px; height:20px; line-height:20px; text-align:center; background:#0f172a; color:#fff; border-radius:50%; font-size:12px; margin-right:4px; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:11px; color:#475569; }
  .chip { display:inline-block; background:#e2e8f0; color:#334155; border-radius:999px; padding:2px 8px; font-size:11px; margin:1px 0; }
  h2, .rec, table { break-inside:avoid; }
  @page { margin:16mm; }
</style></head><body>${exportPageNavHtml("analyze")}
  <h1>คำแนะนำการยิงโฆษณา (AI Playbook)</h1>
  <div class="meta">สร้างเมื่อ ${escHtml(generatedAt)}</div>
  ${a.business_desc ? `<div class="meta">โจทย์: ${escHtml(a.business_desc)}</div>` : ""}
  ${a.summary ? `<div class="summary">${escHtml(a.summary)}</div>` : ""}
  ${section("ตัวเลือกที่เลือกไว้", prefHtml)}
  ${section("แนะนำประเภทแคมเปญ (เรียงตามลำดับ)", recsHtml)}
  ${section(
    "ตั้งค่าระดับแคมเปญ",
    rows([
      ["วัตถุประสงค์", cl.recommended_objective_th],
      ["ประเภทการซื้อ", cl.buying_type_th],
      ["หมวดโฆษณาพิเศษ", cl.special_ad_category_th],
      ["การตั้งงบ", cl.budget_type_th],
      ["งบ/วัน (บาท)", cl.recommended_daily_budget_thb],
      ["กลยุทธ์บิด", cl.bid_strategy_th],
      ["A/B Test", cl.ab_test_th],
      ["หมายเหตุ", cl.notes],
    ])
      ? `<table>${rows([
          ["วัตถุประสงค์", cl.recommended_objective_th],
          ["ประเภทการซื้อ", cl.buying_type_th],
          ["หมวดโฆษณาพิเศษ", cl.special_ad_category_th],
          ["การตั้งงบ", cl.budget_type_th],
          ["งบ/วัน (บาท)", cl.recommended_daily_budget_thb],
          ["กลยุทธ์บิด", cl.bid_strategy_th],
          ["A/B Test", cl.ab_test_th],
          ["หมายเหตุ", cl.notes],
        ])}</table>`
      : ""
  )}
  ${section(
    "ตั้งค่าระดับชุดโฆษณา (Ad set)",
    `<table>${rows([
      ["ปรับให้เหมาะกับ", as.optimization_event_th],
      ["ที่ตั้ง Conversion", as.conversion_location_th],
      ["Advantage+ Audience", as.advantage_audience_th],
      ["ขยายกลุ่มอัตโนมัติ", as.advantage_detailed_targeting_expansion_th],
      ["อายุ", as.age_th],
      ["เพศ", as.gender_th],
      ["พื้นที่", as.locations_th],
      ["ภาษา", as.languages_th],
      ["ตำแหน่งจัดวาง", as.placements_recommendation_th],
      ["การตั้งเวลา", as.schedule_th],
      ["Attribution", as.attribution_setting_th],
      ["หมายเหตุ", as.notes],
    ])}</table>
    ${dt.interests?.length ? `<div><b>ความสนใจ:</b> ${chips(dt.interests)}</div>` : ""}
    ${dt.behaviors?.length ? `<div><b>พฤติกรรม:</b> ${chips(dt.behaviors)}</div>` : ""}
    ${dt.notes ? `<div style="font-size:12.5px;margin-top:4px;">${escHtml(dt.notes)}</div>` : ""}
    ${as.recommended_placements?.length ? `<div style="margin-top:4px;"><b>ตำแหน่งที่แนะนำ:</b> ${chips(as.recommended_placements)}</div>` : ""}
    ${as.placements_to_avoid?.length ? `<div><b>ตำแหน่งที่ควรเลี่ยง:</b> ${chips(as.placements_to_avoid)}</div>` : ""}`
  )}
  ${section(
    "ตั้งค่าระดับโฆษณา (Ad)",
    `<table>${rows([
      ["รูปแบบโฆษณา", ad.format_th],
      ["Advantage+ Creative", ad.advantage_plus_creative_th],
      ["ข้อความหลัก", ad.primary_text_tips_th],
      ["พาดหัว", ad.headline_tips_th],
      ["คำอธิบาย", ad.description_tips_th],
      ["ปุ่ม CTA", ad.cta_button_th],
      ["ปลายทาง", ad.destination_th],
      ["เคล็ดลับครีเอทีฟ", ad.creative_tips_th],
      ["นโยบายโฆษณา", ad.compliance_th],
      ["หมายเหตุ", ad.notes],
    ])}</table>`
  )}
  ${section(
    "แผนทดสอบ & KPI",
    rows([["แผนทดสอบ/สเกล", a.testing_plan_th], ["KPI", a.kpis_th]])
      ? `<table>${rows([["แผนทดสอบ/สเกล", a.testing_plan_th], ["KPI", a.kpis_th]])}</table>`
      : ""
  )}
  ${section("ค่าที่จะใช้ตอนลอนช์ (Launch config)", lcHtml)}
  <script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
}

export function exportAnalysisPdf(analysis) {
  const html = buildAnalysisHtml(analysis);
  const w = window.open("", "_blank");
  if (!w) {
    alert("เบราว์เซอร์บล็อกป็อปอัป — กรุณาอนุญาต popup สำหรับหน้านี้แล้วลองใหม่");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ตารางสรุปรายวัน — ใช้ทั้ง export ปกติ (fallback) และ export แบบภาพเต็มหน้า
//   จำนวนทัก = ดึงจาก Meta (leads) · จำนวนคนที่ทัก/แอด = นับจากแชทเพจจริง (page_chats_by_date) · ราคาต่อผลลัพธ์ = ค่าใช้จ่าย ÷ จำนวนทัก

export function dailyTableHtml(ad, data) {
  const esc = escHtml;
  const list = (data?.daily || []).filter(Boolean);
  if (!list.length) return "";
  const opensByDate = data?.accountOpensByDate || {};
  const pageChatsByDate = data?.page_chats_by_date || {};
  const num = (v, d = 0) => (v == null || isNaN(v)) ? "-" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const beDate = (ds) => { if (!ds) return "-"; const p = String(ds).split("-").map(Number); if (p.length !== 3) return String(ds); return `${p[2]}/${p[1]}/${String((p[0] + 543) % 100).padStart(2, "0")}`; };
  let tLeads = 0, tPage = 0, tOpens = 0, tImpr = 0, tSpend = 0;
  const body = list.map((d) => {
    const day = String(d.date).slice(0, 10);
    // จำนวนทัก = การเริ่มการสนทนา (conversations) ให้ตรงกับ "แชทเริ่ม" · ราคาต่อผลลัพธ์ = ค่าใช้จ่าย ÷ จำนวนทัก
    const taks = Number(d.conversations != null ? d.conversations : d.leads) || 0;
    const cpa = (taks > 0) ? d.spend / taks : null;
    const opens = opensByDate[day] || 0;
    const pc = pageChatsByDate[day];
    const pageChat = pc != null ? pc : d.replies;
    tLeads += taks; tPage += Number(pageChat) || 0; tOpens += opens; tImpr += Number(d.impressions) || 0; tSpend += Number(d.spend) || 0;
    return `<tr><td>${esc(beDate(d.date))}</td><td class="lft">${esc(ad.headline || "-")}</td><td>${esc(num(taks))}</td><td>${esc(num(pageChat))}</td><td>${opens > 0 ? esc(num(opens)) : "-"}</td><td>${cpa == null ? "-" : esc(num(cpa, 2))}</td><td>${esc(num(d.impressions))}</td><td>${esc(num(d.spend, 2))}</td></tr>`;
  }).join("");
  const cprTotal = tLeads > 0 ? tSpend / tLeads : null;   // ราคาต่อผลลัพธ์รวม = ค่าใช้จ่ายรวม ÷ จำนวนทักรวม
  const totalRow = `<tr class="total"><td colspan="2" class="lft">รวมทั้งหมด</td><td>${esc(num(tLeads))}</td><td>${esc(num(tPage))}</td><td>${tOpens > 0 ? esc(num(tOpens)) : "-"}</td><td>${cprTotal == null ? "-" : esc(num(cprTotal, 2))}</td><td>${esc(num(tImpr))}</td><td>${esc(num(tSpend, 2))}</td></tr>`;
  const sub = (t) => `<br><span style="font-weight:400;font-size:9.5px;opacity:.8">${t}</span>`;
  return `<h2>สรุปรายวัน</h2><table class="daily"><thead><tr><th>Date</th><th>Link</th><th>จำนวนทัก${sub("(ดึงจาก Meta)")}</th><th>จำนวนคนที่ทัก / แอด${sub("(นับจากแชทเพจ · ทักครั้งแรก)")}</th><th>ลูกค้าที่เปิดบัญชี</th><th>ราคาต่อผลลัพธ์</th><th>ผลลัพธ์การมอง</th><th>ค่าใช้จ่ายปัจจุบัน</th></tr></thead><tbody>${body}${totalRow}</tbody></table>`;
}

// สร้าง PDF สรุปแดชบอร์ดรายแอด (KPI + งบ + breakdown + ตารางสรุปรายวัน) ผ่านหน้าพิมพ์ — รูปแบบ HTML อ่านง่าย

export function buildDashboardHtml(ad, data, budget) {
  const o = data?.overall || {};
  const esc = escHtml;
  const kpiRow = (label, val) => `<tr><th>${esc(label)}</th><td>${esc(val)}</td></tr>`;
  const breakdownTable = (title, items, labelFn) => {
    const list = (items || []).filter((i) => (i.impressions || 0) > 0).slice(0, 12);
    if (!list.length) return "";
    const max = Math.max(1, ...list.map((i) => i.impressions));
    const rows = list
      .map((i) => {
        const pct = Math.round((i.impressions / max) * 100);
        return `<tr><td style="width:34%">${esc(labelFn ? labelFn(i.key) : i.key)}</td><td><div style="background:#e2e8f0;border-radius:6px;overflow:hidden"><div style="width:${pct}%;background:#4f46e5;height:12px"></div></div></td><td style="width:18%;text-align:right">${esc(Math.round(i.impressions).toLocaleString())}</td></tr>`;
      })
      .join("");
    return `<h2>${esc(title)}</h2><table>${rows}</table>`;
  };
  const devLabel = (k) => ({ mobile_app: "แอปมือถือ", mobile_web: "เว็บมือถือ", desktop: "เดสก์ท็อป", mobile_tablet: "แท็บเล็ต" }[k] || k);
  const genLabel = (k) => ({ male: "ชาย", female: "หญิง", unknown: "ไม่ระบุ" }[k] || k);


  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>Dashboard ${esc(ad.headline || "")}</title>
<style>
  body{font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#1e293b;margin:28px;line-height:1.5}
  h1{font-size:19px;margin:0 0 2px} h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #0f172a;padding-bottom:3px}
  .meta{color:#64748b;font-size:12px} table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0}
  th{text-align:left;color:#64748b;font-weight:600;padding:4px 8px;border-bottom:1px solid #e2e8f0;width:40%;vertical-align:top}
  td{padding:4px 8px;border-bottom:1px solid #e2e8f0;vertical-align:middle}
  .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
  .kpi{border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;min-width:120px}
  .kpi .l{font-size:11px;color:#64748b}.kpi .v{font-size:16px;font-weight:700}
  table.daily{border-collapse:collapse;width:100%;font-size:11.5px;margin:6px 0}
  table.daily th{background:#3f6f5e;color:#fff;border:1px solid #2c4f43;padding:6px 6px;text-align:center;font-weight:600;vertical-align:middle;width:auto}
  table.daily td{border:1px solid #94a3b8;padding:5px 7px;text-align:center;color:#1e293b;vertical-align:middle}
  table.daily td.lft{text-align:left;white-space:nowrap}
  table.daily tbody tr:nth-child(even) td{background:#eef1f4}
  table.daily tr.total td{background:#dfe8e3;font-weight:700;border-top:2px solid #3f6f5e}
  @page{margin:14mm}
</style></head><body>${exportPageNavHtml("analyze")}
  <h1>แดชบอร์ดโฆษณา — ${esc(ad.headline || "")}</h1>
  <div class="meta">Ad ID: ${esc(ad.ad_id || "-")} · ช่วง ${esc(data?.date_preset || "")} · ${esc(new Date(data?.generated_at || Date.now()).toLocaleString("th-TH"))}</div>
  <div class="kpis">
    <div class="kpi"><div class="l">ค่าใช้จ่าย</div><div class="v">${esc(Math.round(o.spend || 0).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">การมองเห็น</div><div class="v">${esc(Math.round(o.impressions || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">เข้าถึง</div><div class="v">${esc(Math.round(o.reach || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">ลีด</div><div class="v">${esc(Math.round(o.leads || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">CPL</div><div class="v">${o.cpl ? Math.round(o.cpl).toLocaleString() + "฿" : "—"}</div></div>
    <div class="kpi"><div class="l">CTR</div><div class="v">${esc((o.ctr || 0).toFixed(2))}%</div></div>
    <div class="kpi"><div class="l">CPC</div><div class="v">${esc(Math.round(o.cpc || 0).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">CPM</div><div class="v">${esc(Math.round(o.cpm || 0).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">คลิก</div><div class="v">${esc(Math.round(o.clicks || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">ความถี่</div><div class="v">${esc((o.frequency || 0).toFixed(2))}</div></div>
    <div class="kpi"><div class="l">Conv. rate</div><div class="v">${o.cvr != null ? esc(o.cvr.toFixed(1)) + "%" : "—"}</div></div>
  </div>
  ${o.conversations > 0 ? `<h2>แชท</h2><div class="kpis">
    <div class="kpi"><div class="l">แชทเริ่ม</div><div class="v">${esc(Math.round(o.conversations).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">ตอบกลับจริง</div><div class="v">${esc(Math.round(o.replies || 0).toLocaleString())}</div></div>
    <div class="kpi"><div class="l">อัตราตอบ</div><div class="v">${o.reply_rate != null ? Math.min(100, Math.round(o.reply_rate * 100)) + "%" : "—"}</div></div>
  </div>` : ""}
  ${budget && budget.totalWithVat > 0 ? `<h2>งบยิงโฆษณา</h2><div class="kpis">
    <div class="kpi"><div class="l">งบรวม VAT 7% แล้ว</div><div class="v">${esc(Math.round(budget.totalWithVat).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">งบยิง Ads (ก่อน VAT 7%)</div><div class="v">${esc(budget.beforeVat.toLocaleString("th-TH", { maximumFractionDigits: 2 }))}฿</div></div>
    <div class="kpi"><div class="l">ใช้จริงก่อน VAT</div><div class="v">${esc(Math.round(budget.spentBeforeVat).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">ใช้จริงรวม VAT</div><div class="v">${esc(Math.round(budget.spentWithVat).toLocaleString())}฿</div></div>
    <div class="kpi"><div class="l">งบคงเหลือก่อน VAT 7%</div><div class="v" style="color:${budget.remainBeforeVat >= 0 ? "#059669" : "#dc2626"}">${esc(budget.remainBeforeVat.toLocaleString("th-TH", { maximumFractionDigits: 2 }))}฿</div></div>
    <div class="kpi"><div class="l">งบคงเหลือ (รวม VAT)</div><div class="v" style="color:${budget.remainWithVat >= 0 ? "#059669" : "#dc2626"}">${esc(Math.round(budget.remainWithVat).toLocaleString())}฿</div></div>
  </div>` : ""}
  ${dailyTableHtml(ad, data)}
  ${breakdownTable("ช่วงอายุ", data.age)}
  ${breakdownTable("เพศ", data.gender, genLabel)}
  ${breakdownTable("พื้นที่", data.region)}
  ${breakdownTable("ตำแหน่งจัดวาง", data.placement)}
  ${breakdownTable("อุปกรณ์", data.device, devLabel)}
  <script>setTimeout(function(){try{window.focus();window.print();}catch(e){}},450);</script>
</body></html>`;
}

export function exportAdDashboardPdf(ad, data, budget) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("เบราว์เซอร์บล็อกป็อปอัป — กรุณาอนุญาต popup แล้วลองใหม่");
    return;
  }
  w.document.open();
  w.document.write(buildDashboardHtml(ad, data, budget));
  w.document.close();
}

// ---- Export แดชบอร์ดเป็น Excel (.xls) / CSV (ไม่ต้องใช้ไลบรารีเพิ่ม) ----

export function dashDailyRows(ad, data) {
  const list = (data?.daily || []).filter(Boolean);
  const opensByDate = data?.accountOpensByDate || {};
  const pcByDate = data?.page_chats_by_date || {};
  return list.map((d) => {
    const day = String(d.date).slice(0, 10);
    const taks = Number(d.conversations != null ? d.conversations : d.leads) || 0;   // จำนวนทัก = การเริ่มการสนทนา (แชทเริ่ม)
    const pc = pcByDate[day];
    const pageChat = pc != null ? pc : (Number(d.replies) || 0);
    const cpr = taks > 0 ? d.spend / taks : null;
    return { date: beDateTH(d.date), link: ad.headline || "-", taks, pageChat, opens: opensByDate[day] || 0, cpr, impr: Number(d.impressions) || 0, spend: Number(d.spend) || 0 };
  });
}

export function dashTotals(rows) {
  const t = rows.reduce((a, r) => ({ taks: a.taks + r.taks, pageChat: a.pageChat + r.pageChat, opens: a.opens + (r.opens || 0), impr: a.impr + r.impr, spend: a.spend + r.spend }), { taks: 0, pageChat: 0, opens: 0, impr: 0, spend: 0 });
  t.cpr = t.taks > 0 ? t.spend / t.taks : null;
  return t;
}
