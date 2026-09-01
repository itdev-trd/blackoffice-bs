"use client";

import { useState } from "react";
import { Sparkles, Wand2, Upload, X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import NumInput from "@/components/shared/NumInput";
import { SectionTitle } from "@/components/ui";

// ---------------------------------------------------------------
// Generate tab
// ---------------------------------------------------------------
// ตัวเลือกขนาด/อัตราส่วนรูป (map เป็น size ที่ OpenAI image API รองรับ)
const IMAGE_SIZE_OPTIONS = [
  { value: "1024x1024", label: "จัตุรัส 1:1 · 1024×1024 (ฟีด)" },
  { value: "1024x1536", label: "แนวตั้ง 2:3 · 1024×1536 (ฟีด/สตอรี่/รีลส์)" },
  { value: "1536x1024", label: "แนวนอน 3:2 · 1536×1024" },
];
const COPY_LENGTH_OPTIONS = [
  { value: "auto", label: "ให้ AI แนะนำ" },
  { value: "short", label: "สั้น (~15-25 คำ)" },
  { value: "medium", label: "กลาง (~30-50 คำ)" },
  { value: "long", label: "ยาว (~60-90 คำ)" },
];
// แปลงอัตราส่วนที่ AI แนะนำ (จาก launch_config) เป็น size ที่รองรับ
function aspectRatioToSize(ratio) {
  const portrait = ["4:5", "2:3", "9:16"];
  const landscape = ["1.91:1", "3:2", "16:9"];
  if (portrait.includes(ratio)) return "1024x1536";
  if (landscape.includes(ratio)) return "1536x1024";
  return "1024x1024";
}

// รองรับทั้งโครงสร้าง CI แบบเดิม (object เดียว) และแบบใหม่ที่แยกหลายแบรนด์
export function normalizeBrandConfig(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  if (Array.isArray(value.brands) && value.brands.length) {
    const brands = value.brands.map((brand, index) => ({
      id: String(brand?.id || `brand-${index + 1}`),
      name: String(brand?.name || `แบรนด์ ${index + 1}`),
      assets: brand?.assets && typeof brand.assets === "object" ? brand.assets : {},
    }));
    const activeBrandId = brands.some((brand) => brand.id === value.active_brand_id) ? value.active_brand_id : brands[0].id;
    return { active_brand_id: activeBrandId, brands };
  }
  const legacyAssets = { ...value };
  delete legacyAssets.brands;
  delete legacyAssets.active_brand_id;
  return {
    active_brand_id: "default",
    brands: [{ id: "default", name: "แบรนด์หลัก", assets: legacyAssets }],
  };
}

// ย่อภาพสินค้าในเบราว์เซอร์ก่อนส่งเข้า Image Edit API เพื่อลด payload/เวลารอ
// ภาพนี้ใช้เป็น reference เฉพาะคำขอสร้างรูป และไม่ถูกเก็บลงฐานข้อมูล
async function prepareProductReferenceImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, WEBP)");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("รูปสินค้าแต่ละไฟล์ต้องมีขนาดไม่เกิน 12 MB");
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("อ่านรูปสินค้าไม่สำเร็จ"));
      img.src = sourceUrl;
    });
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    // WEBP รองรับ alpha และมีขนาดเล็กกว่าไฟล์ต้นฉบับมากใน browser รุ่นปัจจุบัน
    const compressed = canvas.toDataURL("image/webp", 0.86);
    return compressed.startsWith("data:image/") ? compressed : canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function GenerateTab({ settings, onGenerated }) {
  const brandVoice = settings.brand_voice || {};
  const brandConfig = normalizeBrandConfig(settings.brand_assets);
  const brandOptions = brandConfig.brands;
  const [form, setForm] = useState({
    brand_id: brandConfig.active_brand_id || brandOptions[0]?.id || "default",
    product_name: "",
    offer: "",
    target_audience_desc: brandVoice.target_audience_desc || "",
    brand_voice: brandVoice.brand_voice || "",
    num_copies: 4,
    num_images: 4,
    image_model: settings.ai_models?.image || "gpt-image-1",
    image_size: aspectRatioToSize(settings.launch_config?.image_aspect_ratio), // ค่าเริ่มต้นตามที่ AI แนะนำ
    copy_length: settings.launch_config?.copy_length || "auto", // ค่าเริ่มต้นตามที่ AI แนะนำ
    text_model: settings.ai_models?.content_text || "openai",
    custom_prompt: "",
    custom_prompt_mode: "merge", // "merge" = ผสมกับ prompt เดิม, "override" = สั่งเองทั้งหมด ไม่ใช้ prompt เดิม
    image_custom_prompt: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [audienceInfo, setAudienceInfo] = useState(null); // { interests, reasoning } จาก resolve-audience-interests ล่าสุด
  const [productReferences, setProductReferences] = useState([]);
  const [productReferenceError, setProductReferenceError] = useState("");

  async function handleProductReferenceFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setProductReferenceError("");
    const remaining = Math.max(0, 4 - productReferences.length);
    if (files.length > remaining) {
      setProductReferenceError("แนบรูปสินค้าได้สูงสุด 4 รูปต่อการสร้างคอนเทนต์");
    }
    const accepted = files.slice(0, remaining);
    try {
      const prepared = await Promise.all(accepted.map(prepareProductReferenceImage));
      setProductReferences((current) => [...current, ...prepared].slice(0, 4));
    } catch (err) {
      setProductReferenceError(err.message || "เตรียมรูปสินค้าไม่สำเร็จ");
    }
  }

  function handleAiFillFromSettings() {
    // ดึงค่าที่เคยเซฟไว้ในหน้า "ตั้งค่า" (settings.brand_voice) มาเติมฟอร์มทันที
    // ไม่ต้องเรียก API เพิ่ม เพราะข้อมูลนี้มีอยู่แล้วใน prop settings ที่โหลดมาตั้งแต่ต้น
    const current = settings.brand_voice || {};
    setForm({
      ...form,
      product_name: current.product_name || form.product_name,
      offer: current.offer || form.offer,
      target_audience_desc: current.target_audience_desc || form.target_audience_desc,
      brand_voice: current.brand_voice || form.brand_voice,
    });
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    setProgress("");

    try {
      // ขั้นที่ 0: หา interests/behaviors targeting บน Meta จากกลุ่มเป้าหมายที่กรอกไว้ (ถ้ามี)
      // ระบบเดิมตั้ง targeting แค่อายุ+ประเทศเท่านั้น ทำให้กลุ่มเป้าหมายกว้างเกินไป
      // ขั้นนี้ให้ AI แปลเป็นคำค้นแล้วยิงหา interest ID จริงบน Meta มาเก็บไว้ใช้ตอนลอนช์
      // ถ้าขั้นนี้พัง ไม่ควรทำให้การสร้างคอนเทนต์ทั้งหมดล้ม — แค่ fallback เป็น targeting แบบเดิม (อายุ+ประเทศ)
      if (form.target_audience_desc.trim()) {
        setProgress("กำลังวิเคราะห์กลุ่มเป้าหมายสำหรับ Meta targeting...");
        try {
          const { data: audData, error: audError } = await supabase.functions.invoke("resolve-audience-interests", {
            body: { target_audience_desc: form.target_audience_desc, text_model: form.text_model },
          });
          if (audError) {
            console.error("resolve-audience-interests ไม่สำเร็จ:", await readFunctionErrorMessage(audError));
            setAudienceInfo(null);
          } else {
            setAudienceInfo({ interests: audData?.interests || [], reasoning: audData?.reasoning || "", warning: audData?.warning || "" });
          }
        } catch (audErr) {
          console.error("resolve-audience-interests ไม่สำเร็จ:", audErr);
          setAudienceInfo(null);
        }
      } else {
        setAudienceInfo(null);
      }

      // ขั้นที่ 1: สร้าง copy ทั้งหมด + ขอ image_prompts กลับมา (คำขอเดียว เร็ว ไม่เสี่ยง timeout)
      setProgress("กำลังสร้างข้อความโฆษณา...");
      const { data: copyData, error: copyError } = await supabase.functions.invoke("generate-ad-content", {
        body: { ...form, mode: "copies_only" },
      });
      if (copyError) throw new Error(await readFunctionErrorMessage(copyError));

      const imagePrompts = copyData?.image_prompts || [];
      const images = [];

      // ขั้นที่ 2: สร้างรูปทีละ 1 ใบต่อคำขอ (กันคำขอเดียวรวมหลายรูปแล้วชน timeout ของ Edge Function)
      for (let i = 0; i < imagePrompts.length; i++) {
        setProgress(`กำลังสร้างรูปที่ ${i + 1}/${imagePrompts.length}...`);
        const { data: imgData, error: imgError } = await supabase.functions.invoke("generate-ad-content", {
          body: {
            mode: "single_image",
            brand_id: form.brand_id,
            image_prompt: imagePrompts[i],
            image_model: form.image_model,
            image_size: form.image_size,
            reference_images: productReferences,
            image_custom_prompt: form.image_custom_prompt,
          },
        });
        if (imgError) {
          // รูปเดียวพังไม่ควรทำให้ทั้ง batch ล้ม — log ไว้แล้วข้ามไปรูปถัดไป
          console.error(`สร้างรูปที่ ${i + 1} ไม่สำเร็จ:`, await readFunctionErrorMessage(imgError));
          continue;
        }
        if (imgData?.images?.[0]) images.push(imgData.images[0]);
      }

      setProgress("");
      setResult({
        ok: true,
        created_copies: copyData?.copies?.length || 0,
        created_images: images.length,
        copies: copyData?.copies || [],
        images,
      });
      onGenerated?.();
    } catch (err) {
      setError(err.message || "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  const hasSavedBrandVoice = Boolean(brandVoice.brand_voice || brandVoice.target_audience_desc);

  return (
    <div className="w-full max-w-[1400px] space-y-5">
      <SectionTitle
        title="สร้างคอนเทนต์"
        subtitle="ให้ AI เขียนข้อความและสร้างรูปโฆษณาจากบรีฟ แล้วส่งเข้าคิวรออนุมัติ"
      />
      {/* แยกสองคอลัมน์: ซ้ายคือบรีฟที่ต้องคิดใหม่ทุกครั้ง ขวาคือค่าตั้งที่ตั้งครั้งเดียวแล้วใช้ซ้ำ
          เดิมเป็นคอลัมน์แคบยาวเดียว ต้องเลื่อนหาปุ่มสร้าง และทิ้งพื้นที่ขวาว่างทั้งจอ */}
      {/* จุดตัดสองคอลัมน์เดิมอยู่ที่ xl (1280px) จอ 1024–1280 จึงยุบเป็นคอลัมน์เดียว
          ทำให้ปุ่ม "สร้างคอนเทนต์" ตกไปอยู่ใต้ฟอร์มยาวมาก ต้องเลื่อนหา — ลดมาที่ lg */}
      <form onSubmit={handleGenerate} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(330px,1fr)]">
        <div className="ds-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-slate-400">กรอกด้วยตัวเอง หรือดึงค่าจากหน้า "ตั้งค่า" มาเติมให้อัตโนมัติ</span>
          <button
            type="button"
            disabled={!hasSavedBrandVoice}
            onClick={handleAiFillFromSettings}
            className="flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 rounded-lg px-3 py-1.5 font-medium hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
            title={hasSavedBrandVoice ? "" : "ยังไม่มีค่าที่เซฟไว้ในหน้าตั้งค่า"}
          >
            <Wand2 size={13} />
            ให้ AI ช่วยกรอก
          </button>
        </div>
        {brandOptions.length > 0 && (
          <div>
            <label className="text-sm text-slate-600">แบรนด์ CI ที่ใช้สร้างคอนเทนต์</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={form.brand_id}
              onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
            >
              {brandOptions.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">ระบบจะใช้โลโก้ ริบบิ้น และคำอธิบาย CI ของแบรนด์ที่เลือกกับรูปที่สร้าง</p>
          </div>
        )}
        <div>
          <label className="text-sm text-slate-600">ชื่อสินค้า/โปรแกรม</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={form.product_name}
            onChange={(e) => setForm({ ...form, product_name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">ข้อเสนอ / Offer</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            value={form.offer}
            onChange={(e) => setForm({ ...form, offer: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">กลุ่มเป้าหมาย</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            value={form.target_audience_desc}
            onChange={(e) => setForm({ ...form, target_audience_desc: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">โทนแบรนด์</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            value={form.brand_voice}
            onChange={(e) => setForm({ ...form, brand_voice: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm text-slate-600">รูปสินค้าอ้างอิง (ไม่บังคับ)</label>
          <p className="mt-1 text-xs text-slate-400">AI จะใช้รูปนี้เป็นต้นแบบสินค้าในภาพโปรโมทที่สร้างใหม่ · แนบได้สูงสุด 4 รูป</p>
          <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-3">
              {productReferences.map((src, index) => (
                <div key={`${src.slice(0, 32)}-${index}`} className="relative">
                  <img src={src} alt={`สินค้าอ้างอิง ${index + 1}`} className="h-20 w-20 rounded-lg border border-slate-200 bg-white object-cover" />
                  <button
                    type="button"
                    onClick={() => setProductReferences((current) => current.filter((_, i) => i !== index))}
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white shadow hover:bg-rose-600"
                    aria-label={`ลบรูปสินค้า ${index + 1}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {productReferences.length < 4 && (
                <label className="flex h-20 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-600 hover:border-slate-500 hover:bg-slate-100">
                  <Upload size={18} />
                  เพิ่มรูปสินค้า
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={handleProductReferenceFiles} className="hidden" />
                </label>
              )}
            </div>
            {productReferences.length > 0 && <p className="mt-2 text-xs text-slate-500">แนบแล้ว {productReferences.length}/4 รูป · ระบบจะย่อรูปก่อนส่งเพื่อให้สร้างภาพเร็วขึ้น</p>}
            {productReferenceError && <p className="mt-2 text-xs text-rose-600">{productReferenceError}</p>}
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-600">คำสั่งเพิ่มเติมสำหรับรูปภาพ (ไม่บังคับ)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            placeholder='เช่น "วางสินค้าไว้ด้านขวา ใช้พื้นหลังสีดำทอง และเว้นพื้นที่ด้านบนสำหรับหัวข้อ"'
            value={form.image_custom_prompt}
            onChange={(e) => setForm({ ...form, image_custom_prompt: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-400">คำสั่งนี้ใช้กับรูปที่ AI สร้างเท่านั้น ไม่กระทบข้อความโฆษณา</p>
        </div>
        <div>
          <label className="text-sm text-slate-600">คำสั่งเพิ่มเติม (ไม่บังคับ)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            placeholder='เช่น "เน้นโปรโมชั่นช่วงสิ้นปี" หรือ "ห้ามใช้คำว่าฟรี"'
            value={form.custom_prompt}
            onChange={(e) => setForm({ ...form, custom_prompt: e.target.value })}
          />
          {form.custom_prompt.trim() && (
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="radio"
                  checked={form.custom_prompt_mode === "merge"}
                  onChange={() => setForm({ ...form, custom_prompt_mode: "merge" })}
                />
                ผสมกับคำสั่งเดิมของระบบ (แนะนำ — ยังคุมกฎ Meta/ความหลากหลายของ copy อยู่)
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="radio"
                  checked={form.custom_prompt_mode === "override"}
                  onChange={() => setForm({ ...form, custom_prompt_mode: "override" })}
                />
                สั่งเองทั้งหมด (ไม่ใช้คำสั่งเดิมของระบบเลย)
              </label>
            </div>
          )}
        </div>
        </div>

        {/* ติดหนึบตอนเลื่อน — ปุ่มสร้างคอนเทนต์คือปุ่มหลักของหน้านี้ ต้องกดได้ตลอดโดยไม่ต้องเลื่อนกลับขึ้นมา */}
        <div className="ds-card p-5 space-y-4 lg:sticky lg:top-6">
        <div className="text-[12.5px] font-semibold text-slate-500">ตั้งค่าผลลัพธ์</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label className="text-sm text-slate-600">จำนวน copy</label>
            <NumInput min={1} max={10}
              className="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.num_copies}
              onChange={(n) => setForm({ ...form, num_copies: n })}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">จำนวนรูป</label>
            <NumInput min={0} max={10}
              className="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.num_images}
              onChange={(n) => setForm({ ...form, num_images: n })}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">โมเดลเขียนคอนเทนต์</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={form.text_model}
              onChange={(e) => setForm({ ...form, text_model: e.target.value })}
            >
              <option value="claude">Claude (ต้องมี API key)</option>
              <option value="openai">OpenAI (GPT-5)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">โมเดลสร้างรูป</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={form.image_model}
              onChange={(e) => setForm({ ...form, image_model: e.target.value })}
            >
              <option value="gpt-image-1">GPT Image 1</option>
              <option value="gpt-image-2">GPT Image 2 (ล่าสุด)</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">ขนาด/อัตราส่วนรูป</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={form.image_size}
              onChange={(e) => setForm({ ...form, image_size: e.target.value })}
            >
              {IMAGE_SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600">ความยาวคอนเทนต์</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={form.copy_length}
              onChange={(e) => setForm({ ...form, copy_length: e.target.value })}
            >
              {COPY_LENGTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        {settings.launch_config?.image_aspect_ratio || settings.launch_config?.copy_length ? (
          <p className="text-[11px] text-slate-400 -mt-1">ค่าเริ่มต้นด้านบนตั้งตามที่ AI แนะนำไว้ ปรับเองได้</p>
        ) : null}
        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
        {loading && progress && (
          <div className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2 flex items-center gap-2">
            <Loader2 className="animate-spin" size={14} />
            {progress}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          สร้างคอนเทนต์
        </button>
        </div>
      </form>
      {audienceInfo && (
        <div className="text-sm bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 space-y-1.5">
          {audienceInfo.warning ? (
            <div className="text-amber-700">{audienceInfo.warning}</div>
          ) : (
            <>
              <div className="text-blue-800 font-medium">Meta targeting (ความสนใจ/พฤติกรรม) ที่ใช้:</div>
              <div className="flex flex-wrap gap-1.5">
                {audienceInfo.interests.map((i) => (
                  <span key={i.id} className="text-xs bg-white text-blue-700 border border-blue-200 rounded-full px-2.5 py-1">
                    {i.name}
                  </span>
                ))}
              </div>
              {audienceInfo.reasoning && <div className="text-xs text-blue-600">{audienceInfo.reasoning}</div>}
            </>
          )}
        </div>
      )}
      {result && (
        <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
          สร้างสำเร็จ {result.created_copies} copy และ {result.created_images} รูป — ไปดูที่แท็บ "รออนุมัติ" ได้เลย
        </div>
      )}
    </div>
  );
}

export default GenerateTab;
