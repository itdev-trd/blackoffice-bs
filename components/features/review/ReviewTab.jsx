"use client";

import { useState } from "react";
import Link from "next/link";
import { ImageIcon, Loader2, Sparkles, Wand2, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import { Badge, Button, Card, EmptyState, SectionTitle } from "@/components/ui";

// ---------------------------------------------------------------
// Review (approval) tab
// ---------------------------------------------------------------

function ScoreBadge({ score }) {
  if (score === null || score === undefined) return null;
  const tone = score >= 75 ? "bg-emerald-100 text-emerald-700" : score >= 50 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${tone}`}>{Math.round(score)}</span>;
}

function CopyCard({ item, selected, onToggle }) {
  return (
    <div
      onClick={() => onToggle(item.id)}
      className={`rounded-xl border p-3 cursor-pointer transition ${
        selected ? "border-brand-600 bg-slate-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-slate-800 text-sm">{item.headline}</div>
        <ScoreBadge score={item.ai_score} />
      </div>
      <div className="text-xs text-slate-600 mt-1 whitespace-pre-line">{item.primary_text}</div>
      <div className="text-xs text-slate-400 mt-1">CTA: {item.cta}</div>
      {item.ai_rationale && <div className="text-xs text-blue-600 mt-1.5">{item.ai_rationale}</div>}
    </div>
  );
}

function ImageCard({ item, selected, onToggle }) {
  return (
    <div
      onClick={() => onToggle(item.id)}
      className={`rounded-xl border overflow-hidden cursor-pointer transition ${
        selected ? "border-brand-600 ring-1 ring-brand-600" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div className="aspect-square bg-slate-100 flex items-center justify-center relative">
        {item.image_url ? (
          <img src={item.image_url} alt={item.image_prompt} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="text-slate-300" size={32} />
        )}
        <div className="absolute top-1.5 right-1.5">
          <ScoreBadge score={item.ai_score} />
        </div>
      </div>
      {item.ai_rationale && <div className="text-xs text-blue-600 p-1.5">{item.ai_rationale}</div>}
    </div>
  );
}

function ReviewTab({ adCopies, adImages, onChanged, brandConfig }) {
  const brandOptions = Array.isArray(brandConfig?.brands) ? brandConfig.brands : [];
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const brandNameFor = (brandId) => {
    if (!brandId) return "ไม่ระบุแบรนด์";
    return brandOptions.find((brand) => brand.id === brandId)?.name || `แบรนด์ ${brandId}`;
  };
  const matchesBrand = (item) => {
    if (!selectedBrandId) return true;
    if (selectedBrandId === "__unassigned") return !item.brand_id;
    return item.brand_id === selectedBrandId;
  };
  const pendingCopies = adCopies
    .filter((c) => c.status === "pending_approval" && matchesBrand(c))
    .sort((a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1));
  const pendingImages = adImages
    .filter((im) => im.status === "pending_approval" && matchesBrand(im))
    .sort((a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1));

  const totalPending = adCopies.filter((c) => c.status === "pending_approval").length + adImages.filter((im) => im.status === "pending_approval").length;

  const [selectedCopyIds, setSelectedCopyIds] = useState([]);
  const [selectedImageIds, setSelectedImageIds] = useState([]);
  const [scoring, setScoring] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [textModel, setTextModel] = useState("openai");
  const [suggestion, setSuggestion] = useState(null); // { pairs, suggested_mode, mode_rationale }
  const [mode, setMode] = useState("separate_campaigns");
  const [manualPairs, setManualPairs] = useState([]); // [{copy_id, image_id}] ใช้เมื่อไม่ได้ตาม suggestion

  function toggleCopy(id) {
    setSelectedCopyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSuggestion(null);
  }
  function toggleImage(id) {
    setSelectedImageIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSuggestion(null);
  }

  async function handleScore() {
    setScoring(true);
    setError("");
    const { error: fnError } = await supabase.functions.invoke("score-ad-assets", {
      body: { text_model: textModel },
    });
    setScoring(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    onChanged?.();
  }

  async function handleSuggestPairing() {
    if (!selectedCopyIds.length || !selectedImageIds.length) {
      setError("ต้องเลือกอย่างน้อย 1 copy และ 1 รูป ก่อนขอคำแนะนำ");
      return;
    }
    setSuggesting(true);
    setError("");
    setSuggestion(null);
    const { data, error: fnError } = await supabase.functions.invoke("ai-suggest-pairing", {
      body: { copy_ids: selectedCopyIds, image_ids: selectedImageIds, text_model: textModel },
    });
    setSuggesting(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    if (!data?.ok) {
      setError(data?.error || "เกิดข้อผิดพลาดไม่ทราบสาเหตุ");
      return;
    }
    setSuggestion(data);
    setMode(data.suggested_mode || "separate_campaigns");
  }

  // จับคู่แบบง่าย (ไม่ผ่าน AI) เผื่อแอดมินอยากลอนช์เองตรงๆ โดยจับคู่ตามลำดับที่เลือกไว้
  function buildManualPairs() {
    const n = Math.min(selectedCopyIds.length, selectedImageIds.length);
    const pairs = [];
    for (let i = 0; i < n; i++) {
      pairs.push({ copy_id: selectedCopyIds[i], image_id: selectedImageIds[i] });
    }
    return pairs;
  }

  async function handleLaunch() {
    const pairs = suggestion?.pairs?.length
      ? suggestion.pairs.map((p) => ({ copy_id: p.copy_id, image_id: p.image_id }))
      : buildManualPairs();
    if (!pairs.length) {
      setError("ยังไม่มีคู่ที่จะลอนช์ — เลือก copy และรูปให้ครบ หรือขอคำแนะนำจาก AI ก่อน");
      return;
    }
    setLaunching(true);
    setError("");
    setNotice("");
    const { data, error: fnError } = await supabase.functions.invoke("launch-campaign", {
      body: { action: "launch", pairs, mode },
    });
    setLaunching(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    setNotice(`ลอนช์สำเร็จ ${data.launched} แคมเปญ/โฆษณา (โหมด: ${mode === "separate_campaigns" ? "แยกแคมเปญ" : "รวมแคมเปญเดียว"})`);
    setSelectedCopyIds([]);
    setSelectedImageIds([]);
    setSuggestion(null);
    onChanged?.();
  }

  async function handleReject(kind, id) {
    return handleRejectMany(kind, [id]);
  }

  // ลบได้ทีละหลายรายการพร้อมกัน — เรียก launch-campaign action "reject" วนทีละ id
  // (ฝั่ง Edge Function เดิมรองรับแค่ id เดียวต่อคำขอ ยังไม่คุ้มค่าที่จะแก้ backend สำหรับแค่การลบ)
  const [rejectingCopies, setRejectingCopies] = useState(false);
  const [rejectingImages, setRejectingImages] = useState(false);

  async function handleRejectMany(kind, ids) {
    if (!ids.length) return;
    setError("");
    if (kind === "copy") setRejectingCopies(true);
    else setRejectingImages(true);

    const failed = [];
    for (const id of ids) {
      const { error: fnError } = await supabase.functions.invoke("launch-campaign", {
        body: { action: "reject", [kind === "copy" ? "copy_id" : "image_id"]: id },
      });
      if (fnError) failed.push(id);
    }

    // เอาเฉพาะ id ที่ "ลบสำเร็จแล้ว" ออกจากรายการที่เลือกไว้ — id ที่ลบไม่สำเร็จ (อยู่ใน failed) ให้ยังคงเลือกอยู่เหมือนเดิม
    const succeededIds = ids.filter((id) => !failed.includes(id));
    if (kind === "copy") {
      setRejectingCopies(false);
      setSelectedCopyIds((prev) => prev.filter((x) => !succeededIds.includes(x)));
    } else {
      setRejectingImages(false);
      setSelectedImageIds((prev) => prev.filter((x) => !succeededIds.includes(x)));
    }

    if (failed.length) {
      setError(`ลบไม่สำเร็จ ${failed.length} รายการ`);
    }
    onChanged?.();
  }

  function handleDeleteSelected(kind) {
    const ids = kind === "copy" ? selectedCopyIds : selectedImageIds;
    if (!ids.length) return;
    if (!confirm(`ยืนยันลบ${kind === "copy" ? " copy" : "รูป"}ที่เลือกไว้ ${ids.length} รายการ?`)) return;
    handleRejectMany(kind, ids);
  }

  function handleDeleteAll(kind) {
    const ids = (kind === "copy" ? pendingCopies : pendingImages).map((x) => x.id);
    if (!ids.length) return;
    if (!confirm(`ยืนยันลบ${kind === "copy" ? " copy" : "รูป"}รออนุมัติทั้งหมด ${ids.length} รายการ? ทำแล้วกู้คืนไม่ได้`)) return;
    handleRejectMany(kind, ids);
  }

  // หัวข้อหน้าต้องอยู่ทั้งตอนมีของและตอนว่าง — ไม่งั้นหน้าว่างจะเหลือแค่ประโยคลอยกลางจอ
  // ดูเหมือนหน้าพังมากกว่าจะสื่อว่า "เคลียร์หมดแล้ว"
  const header = (
    <SectionTitle
      title="รออนุมัติ"
      subtitle="ตรวจข้อความและรูปที่ AI สร้างไว้ ก่อนอนุมัติขึ้นโฆษณาจริง"
      right={
        totalPending > 0 ? (
          <Badge tone="gold" dot>{totalPending} รายการ</Badge>
        ) : (
          <Badge tone="green" dot>ไม่มีค้าง</Badge>
        )
      }
    />
  );

  if (totalPending === 0) {
    return (
      <div className="w-full max-w-[1400px] space-y-5">
        {header}
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="ไม่มีคอนเทนต์รออนุมัติ"
            hint="เมื่อสร้างข้อความหรือรูปใหม่ รายการจะมารอตรวจที่หน้านี้"
            action={
              <Link href="/generate">
                <Button variant="primary" icon={Sparkles}>สร้างคอนเทนต์</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1400px] space-y-5">
      {header}
      <div className="flex flex-wrap items-center gap-3 ds-card p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          แบรนด์ CI
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white min-w-44"
            value={selectedBrandId}
            onChange={(e) => {
              setSelectedBrandId(e.target.value);
              setSelectedCopyIds([]);
              setSelectedImageIds([]);
              setSuggestion(null);
            }}
          >
            <option value="">ทุกแบรนด์ ({totalPending})</option>
            {brandOptions.map((brand) => {
              const count = adCopies.filter((item) => item.status === "pending_approval" && item.brand_id === brand.id).length
                + adImages.filter((item) => item.status === "pending_approval" && item.brand_id === brand.id).length;
              return <option key={brand.id} value={brand.id}>{brand.name} ({count})</option>;
            })}
            <option value="__unassigned">ไม่ระบุแบรนด์ ({adCopies.filter((item) => item.status === "pending_approval" && !item.brand_id).length + adImages.filter((item) => item.status === "pending_approval" && !item.brand_id).length})</option>
          </select>
        </label>
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          value={textModel}
          onChange={(e) => setTextModel(e.target.value)}
        >
          <option value="claude">Claude (ต้องมี API key)</option>
          <option value="openai">OpenAI (GPT-5)</option>
        </select>
        <button
          onClick={handleScore}
          disabled={scoring}
          className="flex items-center gap-1.5 text-sm bg-brand-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-brand-700 disabled:opacity-60"
        >
          {scoring ? <Loader2 className="animate-spin" size={15} /> : <Wand2 size={15} />}
          ให้ AI ให้คะแนนทั้งหมด
        </button>
        <button
          onClick={handleSuggestPairing}
          disabled={suggesting || !selectedCopyIds.length || !selectedImageIds.length}
          className="flex items-center gap-1.5 text-sm bg-blue-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          {suggesting ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
          ให้ AI แนะนำการจับคู่ ({selectedCopyIds.length} copy × {selectedImageIds.length} รูป)
        </button>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{notice}</div>}

      {suggestion && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-2">
          <div className="text-sm font-semibold text-blue-800">คำแนะนำจาก AI</div>
          <div className="text-sm text-blue-700">{suggestion.mode_rationale}</div>
          <ul className="text-xs text-blue-700 space-y-1 pl-4 list-disc">
            {(suggestion.pairs || []).map((p, i) => (
              <li key={i}>
                {adCopies.find((c) => c.id === p.copy_id)?.headline || p.copy_id} × รูป #{i + 1} — {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="text-sm font-semibold text-slate-800">โหมดการลอนช์</div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="radio" checked={mode === "separate_campaigns"} onChange={() => setMode("separate_campaigns")} />
            แยกเป็นหลายแคมเปญ (งบแยกอิสระ เทียบผลตรงๆ)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="radio" checked={mode === "single_campaign_multi_ad"} onChange={() => setMode("single_campaign_multi_ad")} />
            รวมแคมเปญเดียว หลายโฆษณา (งบก้อนเดียว ให้ Meta หมุนเอง)
          </label>
        </div>
        <button
          onClick={handleLaunch}
          disabled={launching || (!selectedCopyIds.length && !suggestion)}
          className="flex items-center gap-1.5 text-sm bg-emerald-600 text-white rounded-lg px-5 py-2.5 font-medium hover:bg-emerald-700 disabled:opacity-60"
        >
          {launching ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
          ยืนยันลอนช์
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-slate-700">Copy รออนุมัติ ({pendingCopies.length})</h3>
            <div className="flex items-center gap-2">
              {selectedCopyIds.length > 0 && (
                <button
                  onClick={() => handleDeleteSelected("copy")}
                  disabled={rejectingCopies}
                  className="flex items-center gap-1 text-xs bg-rose-50 text-rose-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-rose-100 disabled:opacity-60"
                >
                  <Trash2 size={13} />
                  ลบที่เลือก ({selectedCopyIds.length})
                </button>
              )}
              {pendingCopies.length > 0 && (
                <button
                  onClick={() => handleDeleteAll("copy")}
                  disabled={rejectingCopies}
                  className="flex items-center gap-1 text-xs bg-slate-100 text-slate-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-slate-200 disabled:opacity-60"
                >
                  {rejectingCopies ? <Loader2 className="animate-spin" size={13} /> : <Trash2 size={13} />}
                  ลบทั้งหมด
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {pendingCopies.map((item) => (
              <div key={item.id} className="relative group">
                <div className="mb-1 px-1 text-[11px] font-medium text-brand-600">แบรนด์: {brandNameFor(item.brand_id)}</div>
                <CopyCard item={item} selected={selectedCopyIds.includes(item.id)} onToggle={toggleCopy} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReject("copy", item.id);
                  }}
                  className="absolute top-2 right-2 text-slate-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition"
                  title="ปฏิเสธ copy นี้"
                >
                  <XCircle size={16} />
                </button>
              </div>
            ))}
            {pendingCopies.length === 0 && <div className="text-xs text-slate-400 py-4 text-center">ไม่มี copy รออนุมัติ</div>}
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-slate-700">รูปรออนุมัติ ({pendingImages.length})</h3>
            <div className="flex items-center gap-2">
              {selectedImageIds.length > 0 && (
                <button
                  onClick={() => handleDeleteSelected("image")}
                  disabled={rejectingImages}
                  className="flex items-center gap-1 text-xs bg-rose-50 text-rose-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-rose-100 disabled:opacity-60"
                >
                  <Trash2 size={13} />
                  ลบที่เลือก ({selectedImageIds.length})
                </button>
              )}
              {pendingImages.length > 0 && (
                <button
                  onClick={() => handleDeleteAll("image")}
                  disabled={rejectingImages}
                  className="flex items-center gap-1 text-xs bg-slate-100 text-slate-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-slate-200 disabled:opacity-60"
                >
                  {rejectingImages ? <Loader2 className="animate-spin" size={13} /> : <Trash2 size={13} />}
                  ลบทั้งหมด
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">
            AI สร้างข้อความภาษาไทยในรูปได้ไม่แม่นยำ 100% — ซูมเช็คตัวสะกดในรูปก่อนเลือกใช้เสมอ
          </div>
          <div className="grid grid-cols-2 gap-2">
            {pendingImages.map((item) => (
              <div key={item.id} className="relative group">
                <div className="mb-1 px-1 text-[11px] font-medium text-brand-600">แบรนด์: {brandNameFor(item.brand_id)}</div>
                <ImageCard item={item} selected={selectedImageIds.includes(item.id)} onToggle={toggleImage} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReject("image", item.id);
                  }}
                  className="absolute top-1.5 left-1.5 bg-white/90 rounded-full p-0.5 text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"
                  title="ปฏิเสธรูปนี้"
                >
                  <XCircle size={16} />
                </button>
              </div>
            ))}
            {pendingImages.length === 0 && <div className="text-xs text-slate-400 py-4 text-center col-span-2">ไม่มีรูปรออนุมัติ</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReviewTab;
