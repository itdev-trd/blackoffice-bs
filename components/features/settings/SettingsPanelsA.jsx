"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Wand2, ImageIcon, FileDown, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import PasswordInput from "@/components/shared/PasswordInput";
import NumInput from "@/components/shared/NumInput";
import Spinner from "@/components/shared/Spinner";
import { SETTINGS_SECTIONS, CHAT_STAGES } from "@/lib/constants/settings";
import { exportAnalysisPdf, AnalysisReport } from "@/components/features/analyze/AnalyzeTab";

export function LaunchConfigCard({ config, currentApplied, onApplied }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (!config) return null;

  const placements = config.placements || {};
  const isManual = placements.mode === "manual";
  const platforms = (placements.publisher_platforms || []).join(", ");
  const isCurrent = currentApplied && currentApplied.applied_at;

  async function handleApply() {
    setBusy(true);
    setError("");
    setDone(false);
    const { error: upErr } = await supabase.from("settings").upsert({
      key: "launch_config",
      value: { ...config, applied_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setDone(true);
    onApplied?.();
  }

  const CONV_LABEL = { instant_form: "เก็บลีดผ่านฟอร์ม", messaging: "ทักแชท", website: "เว็บ/แลนดิ้ง", calls: "โทร" };
  const FORMAT_LABEL = { image: "รูปภาพ", video: "วิดีโอ", mixed: "ผสมรูป+วิดีโอ" };
  const LANG_LABEL = { th: "ไทย", en: "อังกฤษ", th_en: "ไทย+อังกฤษ", other: "อื่นๆ" };

  const rows = [
    ["ประเภทแคมเปญ", config.objective ? `${config.objective}${config.conversion_location ? " · " + (CONV_LABEL[config.conversion_location] || config.conversion_location) : ""}` : null],
    ["รูปแบบครีเอทีฟ", FORMAT_LABEL[config.creative_format] || config.creative_format || null],
    ["ภาษา", LANG_LABEL[config.language] || config.language || null],
    ["Advantage+ Audience", config.advantage_audience === 1 ? "เปิด" : "ปิด"],
    ["ตำแหน่งจัดวาง", isManual ? `กำหนดเอง${platforms ? " · " + platforms : ""}` : "Advantage+ (อัตโนมัติ)"],
    ["กลยุทธ์บิด", config.bid_strategy || "-"],
    ["Advantage+ Creative", config.advantage_plus_creative ? "เปิด" : "ปิด"],
    ["ปุ่ม CTA เริ่มต้น", config.default_cta || "-"],
    [
      "หมวดโฆษณาพิเศษ",
      Array.isArray(config.special_ad_categories) && config.special_ad_categories.length
        ? config.special_ad_categories.join(", ")
        : "ไม่มี",
    ],
  ].filter(([, v]) => v !== null && v !== undefined);

  return (
    <div className="rounded-xl border border-slate-900/10 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-slate-800 text-sm">ค่าที่จะใช้ตอนลอนช์ (ตาม AI)</div>
        {isCurrent && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">กำลังใช้ค่านี้อยู่</span>
        )}
      </div>
      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-2 gap-2 px-3 py-1.5">
            <span className="text-xs text-slate-500">{label}</span>
            <span className="text-sm text-slate-700">{value}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleApply}
          disabled={busy}
          className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2"
        >
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
          เซ็ต ads ตาม AI
        </button>
        {done && <span className="text-sm text-emerald-700">เซ็ตแล้ว — จะถูกใช้ตอนลอนช์ครั้งต่อไป</span>}
      </div>
      <p className="text-[11px] text-slate-400">
        กดแล้วระบบจะนำค่าเหล่านี้ไปใช้อัตโนมัติทุกครั้งที่ลอนช์แคมเปญ (จนกว่าจะเซ็ตใหม่) — ไม่กระทบ Ad Account / Page / Pixel / Landing URL
      </p>
      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
    </div>
  );
}

const PREF_OPTIONS = {
  campaign_style: {
    label: "สะดวกยิงแคมเปญแบบไหน",
    options: [
      { value: "auto", label: "ให้ AI แนะนำ" },
      { value: "lead_form", label: "เก็บลีดผ่านฟอร์ม (Instant Form)" },
      { value: "chat", label: "ทักแชท (Messenger / IG DM)" },
      { value: "traffic", label: "ส่งเข้าเว็บ / แลนดิ้ง" },
      { value: "conversions", label: "ปิดการขายบนเว็บ (Conversions)" },
    ],
  },
  creative_format: {
    label: "ใช้วิดีโอหรือรูปภาพ",
    options: [
      { value: "auto", label: "ให้ AI แนะนำ" },
      { value: "image", label: "รูปภาพ" },
      { value: "video", label: "วิดีโอ" },
      { value: "mixed", label: "ผสมรูป + วิดีโอ" },
    ],
  },
  language: {
    label: "ต้องการยิงภาษาไหน",
    options: [
      { value: "auto", label: "ให้ AI แนะนำ" },
      { value: "th", label: "ไทย" },
      { value: "en", label: "อังกฤษ" },
      { value: "th_en", label: "ไทย + อังกฤษ" },
      { value: "other", label: "อื่นๆ" },
    ],
  },
};

export function AiAssistPanel({ onApplied, initialAnalysis, initialLaunchConfig, onConfigApplied, defaultModel }) {
  const [businessDesc, setBusinessDesc] = useState(initialAnalysis?.business_desc || "");
  const [textModel, setTextModel] = useState(defaultModel || "openai");
  const [prefs, setPrefs] = useState({
    campaign_style: initialAnalysis?.preferences?.campaign_style || "auto",
    creative_format: initialAnalysis?.preferences?.creative_format || "auto",
    language: initialAnalysis?.preferences?.language || "auto",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rationale, setRationale] = useState("");
  const [analysis, setAnalysis] = useState(initialAnalysis || null);

  async function handleAnalyze(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setRationale("");
    const { data, error: fnError } = await supabase.functions.invoke("ai-analyze-settings", {
      body: { business_desc: businessDesc, text_model: textModel, preferences: prefs },
    });
    setLoading(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    if (!data?.ok) {
      setError(data?.error || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ");
      return;
    }
    setRationale(data.rationale || "");
    setAnalysis(data.analysis || null);
    onApplied?.(data.applied);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">ให้ AI วิเคราะห์และตั้งค่าให้อัตโนมัติ</h3>
        <p className="text-xs text-slate-500 mt-1">
          อธิบายธุรกิจ/สินค้า/ข้อเสนอสั้นๆ แล้ว AI จะวิเคราะห์ละเอียด — แนะนำประเภทแคมเปญ 3 อันดับ พร้อมการตั้งค่าครบทั้งระดับแคมเปญ ชุดโฆษณา และโฆษณา (ตำแหน่งจัดวาง, Advantage+, targeting ฯลฯ)
          และบันทึกค่าตัวเลข (งบ/อายุ/CPA/โทนแบรนด์) ทับค่าปัจจุบันทันที (ไม่แตะ Ad Account ID / Page ID / Pixel ID / Audience ID / Landing URL)
        </p>
      </div>
      <form onSubmit={handleAnalyze} className="space-y-3">
        <textarea
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          placeholder="เช่น: โปรแกรม IB Rebate สำหรับนักเทรด forex/gold มือใหม่-กลาง เน้นความน่าเชื่อถือ ไม่การันตีกำไร งบไม่มาก เริ่มทดสอบตลาด"
          value={businessDesc}
          onChange={(e) => setBusinessDesc(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.entries(PREF_OPTIONS).map(([key, group]) => (
            <div key={key}>
              <label className="text-sm text-slate-600">{group.label}</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                value={prefs[key]}
                onChange={(e) => setPrefs({ ...prefs, [key]: e.target.value })}
              >
                {group.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 -mt-1">
          เลือก "ให้ AI แนะนำ" ได้ถ้าไม่แน่ใจ — AI จะเลือกแบบที่เหมาะที่สุดให้พร้อมเหตุผล
        </p>

        <div>
          <label className="text-sm text-slate-600">โมเดล AI ที่ใช้วิเคราะห์</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            value={textModel}
            onChange={(e) => setTextModel(e.target.value)}
          >
            <option value="claude">Claude (ต้องมี API key)</option>
            <option value="openai">OpenAI (GPT-5)</option>
          </select>
        </div>
        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
        {rationale && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{rationale}</div>}
        <button
          type="submit"
          disabled={loading}
          className="bg-brand-600 text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
          {loading ? "กำลังวิเคราะห์ละเอียด อาจใช้เวลาสักครู่..." : "ให้ AI วิเคราะห์และบันทึกทันที"}
        </button>
      </form>

      {analysis && (
        <div className="pt-2 border-t border-slate-200 space-y-4">
          {analysis.launch_config && (
            <LaunchConfigCard
              config={analysis.launch_config}
              currentApplied={initialLaunchConfig}
              onApplied={onConfigApplied}
            />
          )}
          <div>
            <div className="flex items-center justify-between mb-3 gap-2">
              <h4 className="font-semibold text-slate-800 text-sm">ผลวิเคราะห์แบบละเอียด (Playbook)</h4>
              <button
                type="button"
                onClick={() => exportAnalysisPdf(analysis)}
                className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shrink-0"
              >
                <FileDown size={14} />
                Export PDF
              </button>
            </div>
            <AnalysisReport analysis={analysis} />
          </div>
        </div>
      )}
    </div>
  );
}

const LOGO_POSITIONS = [
  { value: "top-left", label: "มุมบนซ้าย" },
  { value: "top-center", label: "กึ่งกลางบน" },
  { value: "top-right", label: "มุมบนขวา" },
  { value: "bottom-left", label: "มุมล่างซ้าย" },
  { value: "bottom-center", label: "กึ่งกลางล่าง" },
  { value: "bottom-right", label: "มุมล่างขวา" },
];

export function BrandAssetUploader({ label, urlKey, positionKey, scaleKey, assets, setAssets }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const fileExt = file.name.split(".").pop();
    const fileName = `${urlKey}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from("brand-assets").upload(fileName, file, { upsert: true });
    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from("brand-assets").getPublicUrl(fileName);
    setAssets({ ...assets, [urlKey]: publicUrlData.publicUrl });
    setUploading(false);
  }

  return (
    <div className="space-y-2">
      <label className="text-sm text-slate-600">{label}</label>
      <div className="flex items-center gap-3">
        {assets[urlKey] ? (
          <img src={assets[urlKey]} alt={label} className="w-14 h-14 object-contain rounded-lg border border-slate-200 bg-slate-50" />
        ) : (
          <div className="w-14 h-14 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-slate-300">
            <ImageIcon size={20} />
          </div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          disabled={uploading}
          className="text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-slate-200"
        />
        {uploading && <Loader2 className="animate-spin text-slate-400" size={16} />}
      </div>
      {error && <div className="text-xs text-rose-600">{error}</div>}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs text-slate-500">ตำแหน่งที่จะวาง</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
            value={assets[positionKey] ?? "bottom-right"}
            onChange={(e) => setAssets({ ...assets, [positionKey]: e.target.value })}
          >
            {LOGO_POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <label className="text-xs text-slate-500">ขนาด (% ของภาพ)</label>
          <NumInput min={5} max={60}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            value={assets[scaleKey] ?? 15}
            onChange={(n) => setAssets({ ...assets, [scaleKey]: n })}
          />
        </div>
      </div>
    </div>
  );
}

export function CiStyleUploader({ assets, setAssets }) {
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [textModel, setTextModel] = useState("openai");

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const fileExt = file.name.split(".").pop();
    const fileName = `ci-reference-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from("brand-assets").upload(fileName, file, { upsert: true });
    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from("brand-assets").getPublicUrl(fileName);
    setAssets({ ...assets, ci_reference_image_url: publicUrlData.publicUrl });
    setUploading(false);
  }

  async function handleAnalyze() {
    if (!assets.ci_reference_image_url) {
      setError("อัปโหลดภาพตัวอย่าง CI ก่อนถึงจะให้ AI ช่วยสกัดสไตล์ได้");
      return;
    }
    setAnalyzing(true);
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("analyze-brand-ci", {
      body: { image_url: assets.ci_reference_image_url, text_model: textModel },
    });
    setAnalyzing(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    if (!data?.ok) {
      setError(data?.error || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ");
      return;
    }
    setAssets({ ...assets, ci_style_description: data.style_description });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm text-slate-600">ภาพตัวอย่าง CI แบรนด์ (ไม่บังคับ)</label>
        <div className="flex flex-wrap items-center gap-3 mt-1">
          {assets.ci_reference_image_url ? (
            <img
              src={assets.ci_reference_image_url}
              alt="CI reference"
              className="w-14 h-14 object-cover rounded-lg border border-slate-200 bg-slate-50"
            />
          ) : (
            <div className="w-14 h-14 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-slate-300">
              <ImageIcon size={20} />
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            disabled={uploading}
            className="text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-slate-200"
          />
          {uploading && <Loader2 className="animate-spin text-slate-400" size={16} />}
          <select
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
            value={textModel}
            onChange={(e) => setTextModel(e.target.value)}
          >
            <option value="claude">Claude (ต้องมี API key)</option>
            <option value="openai">OpenAI (GPT-5)</option>
          </select>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing || !assets.ci_reference_image_url}
            className="flex items-center gap-1.5 text-xs bg-brand-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-brand-700 disabled:opacity-40"
          >
            {analyzing ? <Loader2 className="animate-spin" size={13} /> : <Wand2 size={13} />}
            ให้ AI สกัดสไตล์จากภาพ
          </button>
        </div>
      </div>
      {error && <div className="text-xs text-rose-600">{error}</div>}
      <div>
        <label className="text-sm text-slate-600">คำอธิบายสไตล์ CI (สี/ฟอนต์/โทนภาพ)</label>
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          placeholder="พิมพ์เองได้เลย หรือกด 'ให้ AI สกัดสไตล์จากภาพ' ด้านบนแล้วมาแก้ต่อ เช่น: โทนน้ำเงินเข้ม-ทอง พื้นหลังไล่เฉดมืด ฟอนต์หนาสไตล์ modern fintech"
          value={assets.ci_style_description ?? ""}
          onChange={(e) => setAssets({ ...assets, ci_style_description: e.target.value })}
        />
        <p className="text-xs text-slate-400 mt-1">คำอธิบายนี้จะถูกฝังเข้าไปในทุก prompt ตอนสร้างรูปใหม่ เพื่อให้ภาพออกมาตรงโทน CI ของแบรนด์</p>
      </div>
    </div>
  );
}

// แผงตั้ง/ต่ออายุ Meta access token จากหน้าเว็บ (เก็บแบบปลอดภัย ฝั่งเว็บอ่านค่าเดิมไม่ได้)
export function MetaTokenPanel() {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function loadStatus() {
    const { data, error } = await supabase.functions.invoke("set-meta-token", { body: { action: "status" } });
    if (error || !data?.ok) return;
    setStatus(data);
  }
  useEffect(() => {
    loadStatus();
  }, []);

  async function save() {
    if (!token.trim()) return;
    setBusy(true);
    setErr("");
    setMsg("");
    const { data, error } = await supabase.functions.invoke("set-meta-token", { body: { action: "save", token } });
    setBusy(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "บันทึกไม่สำเร็จ"); return; }
    setMsg(`บันทึกแล้ว${data.name ? " · เจ้าของ: " + data.name : ""}`);
    setToken("");
    loadStatus();
  }

  const exp = status?.expires_at ? new Date(status.expires_at * 1000).toLocaleDateString("th-TH") : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
      <div>
        <h3 className="font-semibold text-slate-800">Meta Access Token</h3>
        <p className="text-xs text-slate-500 mt-1">วาง token เพื่อตั้ง/ต่ออายุได้เลยที่นี่ ไม่ต้องเข้า Supabase — เก็บแบบปลอดภัย (ฝั่งเว็บอ่านค่าเดิมไม่ได้ ใช้เฉพาะระบบหลังบ้าน)</p>
      </div>

      {status && (
        <div className="text-xs">
          {status.has_token ? (
            status.valid ? (
              <span className="text-emerald-700">
                ● เชื่อมต่ออยู่{status.name ? " · " + status.name : ""}{exp ? " · หมดอายุ " + exp : ""}{status.source === "env" ? " · (จาก env)" : ""}
              </span>
            ) : (
              <span className="text-rose-600">● token มีปัญหา: {status.error || "ใช้ไม่ได้"}</span>
            )
          ) : (
            <span className="text-amber-600">● ยังไม่ได้ตั้ง token</span>
          )}
          {/* สิทธิ์ที่ token มี — ใช้เช็คว่าขาด page_events (จำเป็นสำหรับส่งสถานะไป Meta) ไหม */}
          {status.valid && status.missing_scopes?.length > 0 && (
            <div className="mt-1 text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
              token นี้ยังขาดสิทธิ์: <span className="font-mono">{status.missing_scopes.join(", ")}</span>
              {status.missing_scopes.includes("page_events") && " — page_events จำเป็นสำหรับ \"ส่งสถานะไป Meta\" (Conversion Leads)"}
            </div>
          )}
          {status.valid && status.scopes?.length > 0 && status.missing_scopes?.length === 0 && (
            <div className="mt-1 text-emerald-700">✓ สิทธิ์ครบทุกตัวที่ระบบต้องใช้</div>
          )}
        </div>
      )}

      <PasswordInput
        placeholder="วาง Meta access token ที่นี่..."
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        autoComplete="off"
      />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy || !token.trim()} className="bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2">
          {busy ? <Loader2 className="animate-spin" size={16} /> : null}
          บันทึก token
        </button>
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
      </div>
      {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
      <p className="text-[11px] text-slate-400">
        แนะนำใช้ long-lived user token (อายุ ~60 วัน) — พอใกล้หมดค่อยวางตัวใหม่ทับได้เลย ระบบตรวจสอบ token กับ Meta ก่อนบันทึกให้อัตโนมัติ
      </p>
    </div>
  );
}

export function LineOAPanel() {
  const [status, setStatus] = useState(null);
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  async function loadStatus() {
    const { data } = await supabase.functions.invoke("set-line-config", { body: { action: "status" } });
    if (data?.ok) setStatus(data);
  }
  useEffect(() => { loadStatus(); }, []);
  async function save() {
    setBusy(true); setErr(""); setMsg("");
    const { data, error } = await supabase.functions.invoke("set-line-config", { body: { action: "save", channel_secret: secret, access_token: token } });
    setBusy(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "บันทึกไม่สำเร็จ"); return; }
    setSecret(""); setToken(""); setStatus(data); setMsg("เชื่อมต่อ LINE OA แล้ว");
  }
  const webhookUrl = status?.webhook_url || `${process.env.NEXT_PUBLIC_SUPABASE_URL || ""}/functions/v1/line-webhook`;
  return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
    <div><h3 className="font-semibold text-slate-800">LINE Official Account</h3><p className="text-xs text-slate-500 mt-1">รับแชทแบบเรียลไทม์และตอบกลับจากหน้าตอบแชท โดยเก็บข้อมูลลับไว้เฉพาะระบบหลังบ้าน</p></div>
    {status && <div className={`text-xs ${status.configured && status.valid ? "text-emerald-700" : status.configured ? "text-rose-600" : "text-amber-600"}`}>{status.configured ? status.valid ? `● เชื่อมต่ออยู่${status.bot?.displayName ? " · " + status.bot.displayName : ""}` : `● token มีปัญหา: ${status.error || "ใช้ไม่ได้"}` : "● ยังไม่ได้เชื่อมต่อ"}</div>}
    <PasswordInput value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Channel secret" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" autoComplete="off" />
    <PasswordInput value={token} onChange={(e) => setToken(e.target.value)} placeholder="Channel access token (long-lived)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" autoComplete="off" />
    <button onClick={save} disabled={busy || !secret.trim() || !token.trim()} className="rounded-lg bg-[#06C755] text-[#06321A] px-4 py-2 text-sm font-semibold disabled:opacity-50 flex items-center gap-2">{busy && <Loader2 size={15} className="animate-spin" />}บันทึกและตรวจสอบ</button>
    {msg && <div className="text-sm text-emerald-700">{msg}</div>}{err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1"><div className="font-medium text-slate-700">Webhook URL</div><code className="block text-[11px] break-all text-slate-600 select-all">{webhookUrl}</code><p className="text-slate-500">นำ URL นี้ไปใส่ใน LINE Developers → Messaging API → Webhook settings จากนั้นกด Verify และเปิด Use webhook</p></div>
  </div>;
}

// คีย์ OpenAI ตัวเดียวที่ทุกฟีเจอร์ AI ในระบบใช้ร่วมกัน (แปลภาษา, สร้างคอนเทนต์, วิเคราะห์แคมเปญ ฯลฯ)
// เก็บใน app_secrets ผ่าน edge function set-openai-key ซึ่งเช็คสิทธิ์ admin เท่านั้น (ไม่เปิดผ่าน allowed_settings)
export function OpenAIKeyPanel() {
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  async function loadStatus() {
    const { data } = await supabase.functions.invoke("set-openai-key", { body: { action: "status" } });
    if (data?.ok) setStatus(data);
  }
  useEffect(() => { loadStatus(); }, []);
  async function save() {
    setBusy(true); setErr(""); setMsg("");
    const { data, error } = await supabase.functions.invoke("set-openai-key", { body: { api_key: apiKey } });
    setBusy(false);
    if (error) { setErr(await readFunctionErrorMessage(error)); return; }
    if (!data?.ok) { setErr(data?.error || "บันทึกไม่สำเร็จ"); return; }
    setApiKey(""); setStatus(data); setMsg("บันทึกคีย์แล้ว ✓");
  }
  return <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
    <div><h3 className="font-semibold text-slate-800">OpenAI API Key</h3><p className="text-xs text-slate-500 mt-1">คีย์นี้ใช้ร่วมกันทุกฟีเจอร์ AI ในระบบ (แปลภาษาในหน้าตอบแชท, สร้างคอนเทนต์, วิเคราะห์แคมเปญ ฯลฯ) เห็น/แก้ได้เฉพาะแอดมินสูงสุดเท่านั้น</p></div>
    {status && (
      <div className={`text-xs ${status.configured ? "text-emerald-700" : "text-amber-600"}`}>
        {status.configured ? `● ตั้งค่าแล้ว · ${status.masked}` : "● ยังไม่ได้ตั้งค่า"}
      </div>
    )}
    <PasswordInput value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" autoComplete="off" />
    <button onClick={save} disabled={busy || !apiKey.trim()} className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2">{busy && <Loader2 size={15} className="animate-spin" />}บันทึกและตรวจสอบ</button>
    {msg && <div className="text-sm text-emerald-700">{msg}</div>}{err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
  </div>;
}

// จัดการสิทธิ์ผู้ใช้ (เฉพาะ admin) — เพิ่ม/แก้/ลบ user, เลือก role และบัญชีที่อนุญาต
// เมนูที่มอบสิทธิ์ได้ (รวม "ตั้งค่า" — แต่เลือกหัวข้อย่อยในตั้งค่าได้อีกที)
const GRANTABLE_TABS = [
  { key: "overview", label: "ภาพรวม" }, { key: "generate", label: "สร้างคอนเทนต์" },
  { key: "review", label: "รออนุมัติ" }, { key: "campaigns", label: "แคมเปญ" },
  { key: "analyze", label: "วิเคราะห์" }, { key: "inbox", label: "ตอบแชท" },
  { key: "customerdb", label: "รีพอร์ตลูกค้าทักแชท" },
  { key: "tv_members", label: "จัดการสมาชิก TV" },
  { key: "settings", label: "ตั้งค่า" },
];
export function PermissionsPanel() {
  const [rows, setRows] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null); // { email, role, allowed:[], tabs:[], pages:[] }
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    const [permRes, acctRes, pgRes] = await Promise.all([
      supabase.functions.invoke("manage-permissions", { body: { action: "list" } }),
      supabase.functions.invoke("list-ad-accounts", { body: {} }),
      supabase.from("page_lead_config").select("page_id, page_name").order("page_name"),
    ]);
    setLoading(false);
    if (permRes.error) { setError(await readFunctionErrorMessage(permRes.error)); return; }
    if (!permRes.data?.ok) { setError(permRes.data?.error || "โหลดสิทธิ์ไม่สำเร็จ"); return; }
    setRows(permRes.data.rows || []);
    if (acctRes.data?.ok) setAccounts(acctRes.data.accounts || []);
    setPages((pgRes.data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })));
  }
  useEffect(() => { load(); }, []);
  const toggleTab = (k) => setEditing((e) => ({ ...e, tabs: e.tabs.includes(k) ? e.tabs.filter((x) => x !== k) : [...e.tabs, k] }));
  const togglePage = (id) => setEditing((e) => ({ ...e, pages: e.pages.includes(id) ? e.pages.filter((x) => x !== id) : [...e.pages, id] }));
  const toggleSetting = (k) => setEditing((e) => ({ ...e, settings: e.settings.includes(k) ? e.settings.filter((x) => x !== k) : [...e.settings, k] }));
  // หัวข้อย่อยในตั้งค่าที่มอบสิทธิ์ได้ — ตัด "สิทธิ์ผู้ใช้" ออก (กันการมอบสิทธิ์ให้คนอื่นตั้งสิทธิ์เองซึ่งเป็นช่องยกระดับสิทธิ์)
  const grantableSettings = SETTINGS_SECTIONS.filter((s) => s.key !== "permissions" && s.key !== "tv_settings");

  async function save() {
    if (!editing?.email) { setError("กรอกอีเมลก่อน"); return; }
    setSaving(true);
    setError("");
    setNotice("");
    const { data, error: fnErr } = await supabase.functions.invoke("manage-permissions", {
      body: { action: "upsert", email: editing.email.trim(), role: editing.role, nickname: editing.nickname || "", allowed_ad_accounts: editing.role === "analyze_only" ? editing.allowed : [], allowed_tabs: editing.role === "analyze_only" ? editing.tabs : [], allowed_pages: editing.role === "analyze_only" ? editing.pages : [], allowed_settings: editing.role === "analyze_only" && editing.tabs.includes("settings") ? editing.settings : [], chat_alert: editing.chatAlert !== false, alert_minutes: editing.alertMinutes ?? 3, alert_pages: editing.alertPages || [], alert_sound: editing.alertSound !== false, alert_new: editing.alertNew !== false },
    });
    setSaving(false);
    if (fnErr) { setError(await readFunctionErrorMessage(fnErr)); return; }
    if (!data?.ok) { setError(data?.error || "บันทึกไม่สำเร็จ"); return; }
    setNotice("บันทึกแล้ว");
    setEditing(null);
    load();
  }

  async function remove(email) {
    if (!confirm(`ลบสิทธิ์ของ ${email}?`)) return;
    const { data, error: fnErr } = await supabase.functions.invoke("manage-permissions", { body: { action: "delete", email } });
    if (fnErr) { setError(await readFunctionErrorMessage(fnErr)); return; }
    if (!data?.ok) { setError(data?.error || "ลบไม่สำเร็จ"); return; }
    load();
  }

  const toggleAcc = (id) => setEditing((e) => ({ ...e, allowed: e.allowed.includes(id) ? e.allowed.filter((x) => x !== id) : [...e.allowed, id] }));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800">จัดการสิทธิ์ผู้ใช้</h3>
          <p className="text-xs text-slate-500 mt-0.5">กำหนดว่าใครเห็นทุกเมนู (admin) หรือจำกัดสิทธิ์ — เลือกได้ว่าเข้าถึงเมนูไหน / เพจไหน (ตอบแชท) / บัญชีโฆษณาไหน</p>
        </div>
        <button onClick={() => setEditing({ email: "", nickname: "", role: "analyze_only", allowed: [], tabs: [], pages: [], settings: [], chatAlert: true, alertMinutes: 3, alertPages: [], alertSound: true, alertNew: true })} className="text-sm bg-brand-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-brand-700 shrink-0">+ เพิ่มผู้ใช้</button>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{notice}</div>}

      {loading ? (
        <Spinner label="กำลังโหลดสิทธิ์..." />
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {(rows || []).length === 0 && <div className="text-sm text-slate-400 py-4 text-center">ยังไม่มีข้อมูลสิทธิ์</div>}
          {(rows || []).map((r) => (
            <div key={r.email} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="text-slate-800 truncate">{r.nickname ? <><span className="font-medium">{r.nickname}</span> <span className="text-slate-400 font-normal">· {r.email}</span></> : r.email}</div>
                <div className="text-[11px] text-slate-400">
                  {r.role === "admin" ? "ผู้ดูแล (เห็นทุกอย่าง)" : `จำกัดสิทธิ์ · ${(r.allowed_tabs || []).length} เมนู${(r.allowed_tabs || []).includes("settings") ? ` (ตั้งค่า ${(r.allowed_settings || []).length || "ทุก"} หัวข้อ)` : ""} · ${(r.allowed_pages || []).length || "ทุก"} เพจ · ${(r.allowed_ad_accounts || []).length} บัญชีโฆษณา`}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${r.role === "admin" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{r.role === "admin" ? "admin" : "จำกัด"}</span>
                <button onClick={() => setEditing({ email: r.email, nickname: r.nickname || "", role: r.role, allowed: (r.allowed_ad_accounts || []).map(String), tabs: (r.allowed_tabs || []).map(String), pages: (r.allowed_pages || []).map(String), settings: (r.allowed_settings || []).map(String), chatAlert: r.chat_alert !== false, alertMinutes: r.alert_minutes ?? 3, alertPages: (r.alert_pages || []).map(String), alertSound: r.alert_sound !== false, alertNew: r.alert_new !== false })} className="text-slate-500 hover:text-slate-800 text-xs underline">แก้ไข</button>
                <button onClick={() => remove(r.email)} className="text-rose-500 hover:text-rose-700"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="border border-slate-300 rounded-xl p-4 space-y-3 bg-slate-50">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600">อีเมลผู้ใช้</label>
              <input value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="user@example.com" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs text-slate-600">ชื่อเล่น (จำง่าย)</label>
              <input value={editing.nickname} onChange={(e) => setEditing({ ...editing, nickname: e.target.value })} placeholder="เช่น พี่แอ๊ด, น้องมิ้น" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs text-slate-600">สิทธิ์</label>
              <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
                <option value="analyze_only">จำกัดสิทธิ์ (เลือกเมนู/เพจ/บัญชีเอง)</option>
                <option value="admin">ผู้ดูแล (admin — เห็นทุกอย่าง)</option>
              </select>
            </div>
          </div>

          {/* ---- แจ้งเตือนแชทค้างอ่าน (ตั้งรายคน — ผู้ใช้ปรับเองไม่ได้) ---- */}
          <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-3 space-y-2.5">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer font-medium">
              <input type="checkbox" checked={editing.chatAlert !== false} onChange={(e) => setEditing({ ...editing, chatAlert: e.target.checked })} className="w-4 h-4" />
              🔔 เปิดแจ้งเตือน "แชทค้างอ่าน" ให้ผู้ใช้คนนี้
            </label>
            <p className="text-[11px] text-slate-500 -mt-1">ผู้ใช้จะปิดเองหรือเปลี่ยนค่าไม่ได้ · แจ้งเตือนจะเด้งทับแอปอื่นเสมอ (ผู้ใช้กดอนุญาตครั้งแรกครั้งเดียว)</p>

            {editing.chatAlert !== false && (<>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-slate-600">เตือนเมื่อค้างอ่านเกิน</span>
                <select
                  value={editing.alertMinutes ?? 3}
                  onChange={(e) => setEditing({ ...editing, alertMinutes: Number(e.target.value) })}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs bg-white"
                >
                  {[1, 2, 3, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} นาที</option>)}
                </select>
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 ml-2">
                  <input type="checkbox" checked={editing.alertSound !== false} onChange={(e) => setEditing({ ...editing, alertSound: e.target.checked })} className="w-3.5 h-3.5" />
                  🔊 เสียงเตือน
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={editing.alertNew !== false} onChange={(e) => setEditing({ ...editing, alertNew: e.target.checked })} className="w-4 h-4" />
                💬 เด้งเตือน "ทุกข้อความใหม่" ทันที (เหมือน Messenger — ไม่ต้องรอค้าง)
              </label>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-600">
                    เพจที่ให้เตือน ({(editing.alertPages || []).length === 0 ? "ทุกเพจที่เข้าถึงได้" : `${editing.alertPages.length} เพจ`})
                  </span>
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={() => setEditing({ ...editing, alertPages: pages.map((p) => p.id) })} className="text-brand-600 hover:underline">เลือกทุกเพจ</button>
                    <button onClick={() => setEditing({ ...editing, alertPages: [] })} className="text-slate-500 hover:underline">ล้าง</button>
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 space-y-0.5">
                  {pages.length === 0 && <div className="text-[11px] text-slate-400 px-1 py-1">ยังไม่มีรายชื่อเพจ (กดซิงก์แชทก่อน)</div>}
                  {pages.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={(editing.alertPages || []).includes(p.id)}
                        onChange={(e) => {
                          const cur = editing.alertPages || [];
                          setEditing({ ...editing, alertPages: e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id) });
                        }}
                        className="w-3.5 h-3.5"
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">ไม่ติ๊กเลย = เตือนทุกเพจที่ผู้ใช้คนนี้เข้าถึงได้ · เพจที่ติ๊กแต่ผู้ใช้ไม่มีสิทธิ์เข้าถึง จะถูกข้ามอัตโนมัติ</p>
              </div>
            </>)}
          </div>

          {editing.role === "analyze_only" && (<>
            {/* เมนูที่เข้าถึงได้ */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-600">เมนูที่เข้าถึงได้ ({editing.tabs.length} เมนู)</label>
                <div className="flex gap-2 text-[11px]">
                  <button onClick={() => setEditing({ ...editing, tabs: GRANTABLE_TABS.map((t) => t.key) })} className="text-slate-500 hover:text-slate-800 underline">เลือกทั้งหมด</button>
                  <button onClick={() => setEditing({ ...editing, tabs: [] })} className="text-slate-500 hover:text-slate-800 underline">ล้าง</button>
                </div>
              </div>
              <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {GRANTABLE_TABS.map((t) => (
                  <label key={t.key} className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={editing.tabs.includes(t.key)} onChange={() => toggleTab(t.key)} /> {t.label}
                  </label>
                ))}
              </div>
            </div>
            {/* หัวข้อย่อยในตั้งค่า — โผล่เมื่อมอบสิทธิ์เมนู "ตั้งค่า" */}
            {editing.tabs.includes("settings") && (
              <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-600">หัวข้อในตั้งค่าที่เข้าถึงได้ ({editing.settings.length || "ทุก"} หัวข้อ)</label>
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={() => setEditing({ ...editing, settings: grantableSettings.map((s) => s.key) })} className="text-slate-500 hover:text-slate-800 underline">เลือกทั้งหมด</button>
                    <button onClick={() => setEditing({ ...editing, settings: [] })} className="text-slate-500 hover:text-slate-800 underline">ล้าง</button>
                  </div>
                </div>
                <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {grantableSettings.map((s) => (
                    <label key={s.key} className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={editing.settings.includes(s.key)} onChange={() => toggleSetting(s.key)} /> {s.label}
                    </label>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">ไม่เลือกเลย = เข้าถึงได้ทุกหัวข้อที่มอบได้ · "สิทธิ์ผู้ใช้" สงวนให้ admin เท่านั้น</div>
              </div>
            )}
            {/* เพจที่เข้าถึงได้ (ตอบแชท) */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-600">เพจที่เข้าถึงได้ ตอบแชท ({editing.pages.length || "ทุก"} เพจ)</label>
                <div className="flex gap-2 text-[11px]">
                  <button onClick={() => setEditing({ ...editing, pages: pages.map((p) => p.id) })} className="text-slate-500 hover:text-slate-800 underline">เลือกทั้งหมด</button>
                  <button onClick={() => setEditing({ ...editing, pages: [] })} className="text-slate-500 hover:text-slate-800 underline">ล้าง</button>
                </div>
              </div>
              <div className="mt-1 border border-slate-200 rounded-lg max-h-40 overflow-y-auto bg-white divide-y divide-slate-100">
                {pages.length === 0 && <div className="text-xs text-slate-400 py-3 text-center">ยังไม่มีเพจ (ซิงก์ก่อน)</div>}
                {pages.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={editing.pages.includes(p.id)} onChange={() => togglePage(p.id)} />
                    <span className="flex-1 min-w-0 truncate text-slate-700">{p.name}</span>
                  </label>
                ))}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">ไม่เลือกเลย = เข้าถึงได้ทุกเพจ</div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-600">บัญชีโฆษณาที่อนุญาต ({editing.allowed.length} เลือก)</label>
                <div className="flex gap-2 text-[11px]">
                  <button onClick={() => setEditing({ ...editing, allowed: accounts.map((a) => String(a.account_id)) })} className="text-slate-500 hover:text-slate-800 underline">เลือกทั้งหมด</button>
                  <button onClick={() => setEditing({ ...editing, allowed: [] })} className="text-slate-500 hover:text-slate-800 underline">ล้าง</button>
                </div>
              </div>
              <div className="mt-1 border border-slate-200 rounded-lg max-h-56 overflow-y-auto bg-white divide-y divide-slate-100">
                {accounts.length === 0 && <div className="text-xs text-slate-400 py-3 text-center">ไม่พบบัญชีโฆษณา (ลองตั้งค่า Meta token ก่อน)</div>}
                {accounts.map((a) => (
                  <label key={a.account_id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={editing.allowed.includes(String(a.account_id))} onChange={() => toggleAcc(String(a.account_id))} />
                    <span className="flex-1 min-w-0 truncate text-slate-700">{a.name} <span className="text-slate-400">({a.account_id})</span></span>
                    {a.business && <span className="text-[11px] text-slate-400 shrink-0">{a.business}</span>}
                  </label>
                ))}
              </div>
            </div>
          </>)}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="text-sm bg-brand-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="animate-spin" size={15} /> : null} บันทึก
            </button>
            <button onClick={() => setEditing(null)} className="text-sm border border-slate-300 text-slate-700 rounded-lg px-4 py-2 font-medium hover:bg-slate-50">ยกเลิก</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ประวัติการเข้าใช้งาน (เฉพาะ admin) — ใครออนไลน์อยู่ + log ล่าสุด
const ACTIVITY_LABEL = {
  login: "เข้าสู่ระบบ", logout: "ออกจากระบบ", pull_report: "ดึงรายงาน",
  open_dashboard: "เปิดแดชบอร์ด", ai_analyze: "ให้ AI วิเคราะห์", view_tab: "เปิดหน้า",
  // แชท
  send_reply: "ส่งข้อความตอบลูกค้า", send_file: "ส่งไฟล์/รูปให้ลูกค้า", push_label: "ส่งป้ายสถานะไป Meta",
  block_customer: "บล็อกลูกค้า (สแปม)", unblock_customer: "ปลดบล็อกลูกค้า",
  save_lead_fields: "บันทึกข้อมูลลูกค้า (ป้อนเอง)", set_stage: "เปลี่ยนป้ายสถานะลูกค้า",
  check_trade_id: "เช็คไอดีเทรด", confirm_account_opened: "ยืนยันเปิดบัญชีใหม่", mark_unread: "ทำเป็นยังไม่อ่าน", mark_read: "ทำเป็นอ่านแล้ว",
  open_chat: "เปิดแชทลูกค้า", save_knowledge: "บันทึกเข้าคลังคำตอบ",
  // โฆษณา
  export: "Export รายงาน", apply_change: "ปรับแอด", push_labels_all: "ติดป้ายสถานะทั้งหมดบน Meta",
  // ระบบ/ตั้งค่า
  sync_chats: "ซิงก์แชท", save_setting: "บันทึกการตั้งค่า", export_customers: "Export ฐานข้อมูลลูกค้า",
};
const TAB_LABEL = { overview: "ภาพรวม", generate: "สร้างคอนเทนต์", review: "รออนุมัติ", campaigns: "แคมเปญ", analyze: "วิเคราะห์", chat: "ตอบแชท", inbox: "ตอบแชท", customerdb: "รีพอร์ตลูกค้าทักแชท", leaderboard: "กระดานแต้ม", settings: "ตั้งค่า" };
const actLabel = (r) => {
  if (r.event === "view_tab" && r.detail?.tab) return `เปิดหน้า "${TAB_LABEL[r.detail.tab] || r.detail.tab}"`;
  const base = ACTIVITY_LABEL[r.event] || r.event;
  const d = r.detail || {};
  const stageLbl = d.stage ? (CHAT_STAGES.find((s) => s.key === d.stage)?.label || d.stage) : "";
  const extra = d.customer_name || d.name || stageLbl || d.label || d.format || d.action || d.section || (d.campaigns ? `${d.campaigns} แคมเปญ` : "") || "";
  return base + (extra ? ` (${extra})` : "");
};
export function ActivityPanel() {
  const [rows, setRows] = useState(null);
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [focusEmail, setFocusEmail] = useState(null);   // เจาะดูราย user (null = ทุกคน)
  async function load(email = focusEmail) {
    setLoading(true);
    setError("");
    const { data, error: fnErr } = await supabase.functions.invoke("list-activity", { body: { limit: email ? 500 : 200, email: email || undefined } });
    setLoading(false);
    if (fnErr) { setError(await readFunctionErrorMessage(fnErr)); return; }
    if (!data?.ok) { setError(data?.error || "โหลดประวัติไม่สำเร็จ"); return; }
    setRows(data.rows || []);
    if (!email) setActive(data.active || []);   // active มาจากคำขอ "ทุกคน" เท่านั้น
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [focusEmail]);

  const fmtTime = (t) => { try { return new Date(t).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); } catch { return t; } };
  // สรุป "ใช้หน้าไหน/ทำอะไรกี่ครั้ง" ของ user ที่เจาะดู
  const summary = useMemo(() => {
    if (!focusEmail || !rows) return null;
    const tabs = {}, events = {}; let first = null, last = null;
    for (const r of rows) {
      if (r.event === "view_tab" && r.detail?.tab) tabs[r.detail.tab] = (tabs[r.detail.tab] || 0) + 1;
      else events[r.event] = (events[r.event] || 0) + 1;
      const t = new Date(r.created_at).getTime();
      if (last === null || t > last) last = t;
      if (first === null || t < first) first = t;
    }
    return {
      tabs: Object.entries(tabs).sort((a, b) => b[1] - a[1]),
      events: Object.entries(events).sort((a, b) => b[1] - a[1]),
      first, last, total: rows.length,
    };
  }, [focusEmail, rows]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
            ประวัติการเข้าใช้งาน
            {focusEmail && <span className="text-xs font-normal bg-brand-100 text-brand-700 rounded-full px-2 py-0.5">เจาะดู: {focusEmail}</span>}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">{focusEmail ? "ประวัติ + สรุปการใช้งานของผู้ใช้คนนี้" : "ใครเข้าใช้ เมื่อไหร่ ทำอะไร จาก IP/ตำแหน่ง และอุปกรณ์ใด · คลิกที่ชื่อผู้ใช้เพื่อดูแยกราย user"}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {focusEmail && <button onClick={() => setFocusEmail(null)} className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 text-slate-600 hover:bg-slate-50">← ดูทุกคน</button>}
          <button onClick={() => load()} className="text-slate-400 hover:text-slate-700" title="รีเฟรช"><RefreshCw size={16} /></button>
        </div>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <Spinner label="กำลังโหลดประวัติ..." />
      ) : (
        <>
          {/* สรุปการใช้งานของ user ที่เจาะดู */}
          {focusEmail && summary && (
            <div className="rounded-xl border border-slate-200 p-3 space-y-3 bg-slate-50/50">
              <div className="text-xs text-slate-500">
                กิจกรรมทั้งหมด <span className="font-semibold text-slate-800">{summary.total}</span> รายการ
                {summary.last && <> · ล่าสุด {fmtTime(summary.last)}</>}
                {summary.first && <> · เก่าสุด {fmtTime(summary.first)}</>}
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">หน้าที่เปิดบ่อย</div>
                {summary.tabs.length === 0 ? <div className="text-[11px] text-slate-400">ไม่มีข้อมูล (เริ่มเก็บหลังอัปเดตนี้)</div> : (
                  <div className="flex flex-wrap gap-1.5">
                    {summary.tabs.map(([t, n]) => (
                      <span key={t} className="text-[11px] bg-brand-100 text-brand-700 rounded-full px-2 py-0.5 font-medium">{TAB_LABEL[t] || t} · {n}</span>
                    ))}
                  </div>
                )}
              </div>
              {summary.events.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium text-slate-500 mb-1">การกระทำอื่น</div>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.events.map(([e, n]) => (
                      <span key={e} className="text-[11px] bg-slate-200 text-slate-600 rounded-full px-2 py-0.5">{ACTIVITY_LABEL[e] || e} · {n}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!focusEmail && (
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1.5">
              กำลังใช้งานอยู่ ({active.length} คน · {active.reduce((s, a) => s + (a.device_count || 1), 0)} เครื่อง) · 15 นาทีล่าสุด
            </div>
            {active.length === 0 ? (
              <div className="text-xs text-slate-400">ไม่มีใครใช้งานอยู่ตอนนี้</div>
            ) : (
              <div className="space-y-1.5">
                {active.map((a) => (
                  <div key={a.email} className="flex flex-wrap items-center gap-1.5">
                    <button onClick={() => setFocusEmail(a.email)} className={`text-xs rounded-full px-2.5 py-1 flex items-center gap-1.5 font-medium hover:ring-2 hover:ring-brand-300 ${(a.device_count || 1) > 1 ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${(a.device_count || 1) > 1 ? "bg-amber-500" : "bg-emerald-500"}`} />
                      {a.email} · {a.device_count || 1} เครื่อง
                    </button>
                    {(a.devices || [{ device: a.device, location: a.location, ip: a.ip }]).map((d, i) => (
                      <span key={i} className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5" title={d.ip || ""}>
                        {d.device || "-"}{d.location ? ` · ${d.location}` : ""}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {(rows || []).length === 0 && <div className="text-sm text-slate-400 py-4 text-center">ยังไม่มีประวัติ</div>}
              {(rows || []).map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="text-slate-800 truncate">
                      {r.email
                        ? <button onClick={() => setFocusEmail(r.email)} className="font-medium hover:text-brand-600 hover:underline">{r.email}</button>
                        : <span className="font-medium">-</span>}
                      <span className="text-slate-400"> · {actLabel(r)}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">{r.device || "-"}{r.location ? ` · ${r.location}` : ""}{r.ip ? ` · ${r.ip}` : ""}</div>
                  </div>
                  <div className="text-[11px] text-slate-400 shrink-0 text-right">{fmtTime(r.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ฟีเจอร์ AI ที่ให้ผู้ใช้กำหนด prompt เองได้ (key ต้องตรงกับฝั่ง backend getPromptOverride)
export const AI_PROMPT_FEATURES = [
  { key: "analyze_ads", label: "วิเคราะห์โฆษณา (Ads)", desc: "สรุป/วิเคราะห์ประสิทธิภาพโฆษณา" },
  { key: "analyze_campaigns", label: "วิเคราะห์แคมเปญ", desc: "ภาพรวมแคมเปญ + คำแนะนำ" },
  { key: "analyze_dashboard", label: "วิเคราะห์แดชบอร์ด", desc: "สรุปตัวเลขหน้าแดชบอร์ด" },
  { key: "analyze_compare", label: "เปรียบเทียบโฆษณา", desc: "เทียบหลายชิ้นแล้วสรุป" },
  { key: "analyze_settings", label: "AI ช่วยตั้งค่า", desc: "แนะนำ targeting/งบ/เกณฑ์จาก brief" },
  { key: "suggest_pairing", label: "แนะนำการจับคู่คอนเทนต์", desc: "จับคู่ copy กับรูป/กลุ่มเป้าหมาย" },
  { key: "score_ad_assets", label: "ให้คะแนนชิ้นงานโฆษณา", desc: "รีวิว/ให้คะแนน draft assets" },
  { key: "resolve_audience_interests", label: "แปลงกลุ่มเป้าหมายเป็นคีย์เวิร์ด", desc: "ไทย → คำค้น interest อังกฤษ" },
  { key: "analyze_brand_ci", label: "วิเคราะห์แบรนด์/CI จากรูป", desc: "อ่านรูปอ้างอิงแล้วสรุปสไตล์" },
];

// หน้าตั้งค่า "คำสั่ง AI (Prompt)" รวม — override system prompt ของแต่ละฟีเจอร์ (เก็บใน settings key = ai_prompts)
