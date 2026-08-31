// supabase/functions/generate-ad-content/index.ts
// เรียกจากเว็บแอป (ต้องล็อกอิน) — สร้าง copy และรูป "แยกอิสระจากกัน" ตามจำนวนที่กำหนด (num_copies, num_images)
// copy ไปลง ad_copies, รูปไปลง ad_images — ไม่ผูก 1:1 กันอีกต่อไป
// แอดมินจะไปจับคู่เองภายหลังตอนอนุมัติในหน้า "รออนุมัติ"
//
// Secrets ที่ต้องตั้งใน Edge Functions → Manage secrets:
//   ANTHROPIC_API_KEY   (ใช้เมื่อเลือก text_model = "claude")
//   IMAGE_API_KEY       (ใช้ทั้งสร้างรูป และเมื่อเลือก text_model = "openai" — เป็น OpenAI API key ตัวเดียวกัน)
//
// หลังได้รูปพื้นหลังจาก OpenAI image API แล้ว จะซ้อนโลโก้/ริบบิ้นแบรนด์ (ถ้าตั้งค่าไว้ในหน้า "ตั้งค่า")
// ทับด้วยโค้ดจริงผ่าน ImageScript (composite) แทนการให้ AI วาดโลโก้เอง — แม่นยำ 100% ไม่มีทางเพี้ยน

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";
import { getOpenAIKey } from "../_shared/openai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COPY_SYSTEM_PROMPT = `You are a senior Facebook ads creative team (copywriter + art director) for a trading/forex/gold rebate business in Thailand.
Your output will be read by real Thai traders scrolling their feed, and judged by a human media buyer who can spot generic "AI-written" ad copy instantly and will reject it.

=== COPY RULES (critical — read carefully) ===
Each of the N copy variants MUST sound like it was written by a DIFFERENT copywriter with a different angle. Vary ALL of these across variants, don't reuse the same pattern twice:
- Opening move: some start with a question, some with a bold claim, some with a mini-story/scenario, some lead straight with the number/offer, some call out the reader's pain point directly.
- Sentence rhythm: mix short punchy sentences with longer explanatory ones. Don't make every variant the same length or same paragraph shape.
- Vocabulary: avoid repeating the same stock phrases across variants (e.g. don't have every single variant say "โปร่งใส ตรวจสอบได้" or "ไม่มีการรับประกันผลตอบแทน" worded identically — say it differently each time, or fold the risk disclosure naturally into the sentence instead of appending it as a separate bolted-on clause at the end).
- Tone spread across the batch: aim for a genuine mix — e.g. one casual/conversational like a friend giving a tip, one direct/salesy with numbers upfront, one social-proof/community angle, one curiosity-driven question hook, one that speaks to a specific pain point (high spread costs, opaque rebate terms, etc).
- Write like a Thai native speaker talking to Thai traders, not a translated corporate brochure. Use natural Thai phrasing, contractions, and rhythm real people use — not stiff formal structures.
- Still comply with Meta's financial-services ad policy: no guaranteed-profit claims, no misleading promises. Keep any required risk disclosure, but integrate it naturally instead of pasting the same disclaimer sentence verbatim in every variant.

=== IMAGE PROMPT RULES (critical) ===
Do NOT write generic stock-photo prompts (like "gold bars on a table" or "phone showing a chart"). These produce boring stock images with no ad value.
Instead, write prompts that describe an actual FINISHED AD CREATIVE DESIGN — a graphic layout, like something made in Canva/Photoshop by a designer — including:
- A clear layout structure (e.g. bold headline text at top, supporting visual in the middle, badge/CTA button area at bottom; or split-screen before/after; or numbered step graphic; or price/stat callout card).
- Specific Thai text content to render IN the image (short — 3-8 words max per text element, e.g. a big number+unit like "10.2$/Lot", a short headline, a small badge label), pulled from the brief's offer. Keep text elements short because AI image models often misspell longer Thai text — never ask for a full sentence rendered in-image.
- Concrete design direction: color palette (e.g. "navy blue and gold, black background with gold gradient accents"), typography style (e.g. "bold sans-serif Thai headline font, large size"), composition (e.g. "3-column icon layout", "large number as focal point top-left"), and finish (e.g. "clean fintech app UI mockup", "premium gold bullion product shot with dramatic lighting").
- Vary the layout concept across the requested number of image prompts — don't reuse the same composition idea for every single one (mix: app screenshot mockup style, product/gold bars hero shot with badge overlay, 3-step numbered process graphic, big-number stat card, before/after comparison, testimonial-card style).

Given the brief, produce ad copy variants in Thai, AND separately a list of image prompts for ad creative designs
(the image prompts do not need to map 1:1 to the copy variants — they are used independently for image generation).
Output ONLY valid JSON, no markdown fences, matching this schema:
{
  "variants": [{"headline":"...","primary_text":"...","description":"...","cta":"LEARN_MORE|CONTACT_US|SIGN_UP"}],
  "image_prompts": ["..."]
}
Produce exactly the requested number of copy variants and the requested number of image prompts.`;

// ประกอบ system prompt สุดท้ายตามโหมดที่แอดมินเลือก:
// - "merge" (ค่าเริ่มต้น): ต่อคำสั่งเพิ่มเติมท้าย COPY_SYSTEM_PROMPT เดิม — ยังคุมกฎ Meta policy / ความหลากหลายของ copy / รูปแบบ JSON output อยู่
// - "override": ใช้คำสั่งของแอดมินแทนที่ COPY_SYSTEM_PROMPT ทั้งหมด — แต่ยังคงบังคับ JSON schema ท้ายๆ ไว้เสมอ ไม่งั้น parse ไม่ได้
function buildSystemPrompt(customPrompt: string, mode: string) {
  const trimmed = (customPrompt || "").trim();
  if (!trimmed) return COPY_SYSTEM_PROMPT;

  const jsonSchemaReminder = `Output ONLY valid JSON, no markdown fences, matching this schema:
{
  "variants": [{"headline":"...","primary_text":"...","description":"...","cta":"LEARN_MORE|CONTACT_US|SIGN_UP"}],
  "image_prompts": ["..."]
}
Produce exactly the requested number of copy variants and the requested number of image prompts.`;

  if (mode === "override") {
    // สั่งเองทั้งหมด — ยกเลิกกฎ/สไตล์เดิมของระบบ ใช้ตามที่แอดมินสั่งเป็นหลัก แต่ยังต้องคง JSON schema ไว้ให้ parse ได้
    return `You are a Facebook ads creative team for a trading/forex/gold rebate business in Thailand.
Follow the admin's custom instructions below as the primary and only creative direction — do not follow any other default style rules:

=== ADMIN CUSTOM INSTRUCTIONS (follow exactly) ===
${trimmed}
=== END ADMIN CUSTOM INSTRUCTIONS ===

${jsonSchemaReminder}`;
  }

  // merge — ต่อท้ายคำสั่งเดิม ไม่ลบกฎเดิมออก
  return `${COPY_SYSTEM_PROMPT}

=== ADDITIONAL ADMIN INSTRUCTIONS (apply on top of the rules above, same priority) ===
${trimmed}
=== END ADDITIONAL ADMIN INSTRUCTIONS ===`;
}

function extractJson(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("หา JSON ในคำตอบของโมเดลไม่เจอ: " + trimmed.slice(0, 300));
  }
}

function briefPrompt(brief: Record<string, unknown>, numCopies: number, numImages: number) {
  return `Brief:\n${JSON.stringify(brief)}\n\nสร้าง copy จำนวน ${numCopies} เวอร์ชัน และ image_prompts จำนวน ${numImages} รายการ`;
}

async function generateWithClaude(brief: Record<string, unknown>, numCopies: number, numImages: number, systemPrompt: string) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: "user", content: briefPrompt(brief, numCopies, numImages) }],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Claude API error: ${resp.status} ${t}`);
  }

  const data = await resp.json();
  const rawText = data.content[0].text;
  try {
    return extractJson(rawText);
  } catch {
    throw new Error("Claude ไม่ได้ตอบเป็น JSON ที่ถูกต้อง: " + rawText.slice(0, 300));
  }
}

async function generateWithOpenAI(brief: Record<string, unknown>, numCopies: number, numImages: number, systemPrompt: string) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await getOpenAIKey()}`,
    },
    body: JSON.stringify({
      model: "gpt-5",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: briefPrompt(brief, numCopies, numImages) },
      ],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI API error: ${resp.status} ${t}`);
  }

  const data = await resp.json();
  const rawText = data.choices?.[0]?.message?.content ?? "";
  try {
    return extractJson(rawText);
  } catch {
    throw new Error("OpenAI ไม่ได้ตอบเป็น JSON ที่ถูกต้อง: " + rawText.slice(0, 300));
  }
}

async function insertCopy(
  supabaseAdmin: ReturnType<typeof createClient>,
  brief: Record<string, unknown>,
  variant: { headline: string; primary_text: string; description: string; cta: string },
  textModel: string,
  brandId: string | null = null
) {
  const { data: row, error } = await supabaseAdmin
    .from("ad_copies")
    .insert({
      product: brief.product_name,
      headline: variant.headline,
      primary_text: variant.primary_text,
      description: variant.description,
      cta: variant.cta,
      status: "pending_approval",
      generated_by_model: textModel,
      brand_id: brandId,
    })
    .select()
    .single();
  if (error) throw error;
  return row;
}

type BrandAssets = {
  logo_url?: string;
  logo_position?: string;
  logo_scale_pct?: number;
  ribbon_url?: string;
  ribbon_position?: string;
  ribbon_scale_pct?: number;
  ci_style_description?: string;
};

function selectBrandAssets(config: unknown, brandId: string): BrandAssets {
  const value = config && typeof config === "object" ? config as Record<string, unknown> : {};
  const brands = Array.isArray(value.brands) ? value.brands : [];
  if (brands.length) {
    const selected = brands.find((brand) => brand && typeof brand === "object" && (brand as Record<string, unknown>).id === brandId)
      || brands[0];
    const assets = selected && typeof selected === "object" ? (selected as Record<string, unknown>).assets : null;
    return assets && typeof assets === "object" ? assets as BrandAssets : {};
  }
  // รองรับ settings แบบเก่าที่เก็บ CI ไว้เป็น object เดียว
  return value as BrandAssets;
}

// คำนวณตำแหน่ง (x, y) มุมบนซ้ายของภาพที่จะวาง ตามชื่อตำแหน่งที่เลือกในหน้าตั้งค่า
function resolvePosition(position: string, canvasW: number, canvasH: number, assetW: number, assetH: number) {
  const margin = Math.round(canvasW * 0.03); // เว้นขอบ ~3% ของความกว้างภาพ กันโลโก้ชิดขอบเกินไป
  const x =
    position.includes("left") ? margin :
    position.includes("right") ? canvasW - assetW - margin :
    Math.round((canvasW - assetW) / 2); // center
  const y =
    position.includes("top") ? margin :
    position.includes("bottom") ? canvasH - assetH - margin :
    Math.round((canvasH - assetH) / 2);
  return { x, y };
}

async function fetchAndDecodeImage(url: string) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`โหลดภาพจาก ${url} ไม่สำเร็จ: ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  return await Image.decode(buf);
}

// ซ้อนโลโก้/ริบบิ้นแบรนด์ทับบนภาพพื้นหลังด้วยโค้ดจริง (ไม่ใช่ให้ AI วาด) — แม่นยำ 100% ทุกครั้ง
async function compositeBrandAssets(baseImageBytes: Uint8Array, brandAssets: BrandAssets): Promise<Uint8Array> {
  const hasLogo = Boolean(brandAssets.logo_url);
  const hasRibbon = Boolean(brandAssets.ribbon_url);
  if (!hasLogo && !hasRibbon) return baseImageBytes;

  try {
    const base = await Image.decode(baseImageBytes);

    if (hasLogo) {
      const logo = await fetchAndDecodeImage(brandAssets.logo_url!);
      const scalePct = brandAssets.logo_scale_pct || 15;
      const targetW = Math.round((base.width * scalePct) / 100);
      const targetH = Math.round((logo.height / logo.width) * targetW);
      logo.resize(targetW, targetH);
      const { x, y } = resolvePosition(brandAssets.logo_position || "bottom-right", base.width, base.height, targetW, targetH);
      base.composite(logo, x, y);
    }

    if (hasRibbon) {
      const ribbon = await fetchAndDecodeImage(brandAssets.ribbon_url!);
      const scalePct = brandAssets.ribbon_scale_pct || 25;
      const targetW = Math.round((base.width * scalePct) / 100);
      const targetH = Math.round((ribbon.height / ribbon.width) * targetW);
      ribbon.resize(targetW, targetH);
      const { x, y } = resolvePosition(brandAssets.ribbon_position || "top-left", base.width, base.height, targetW, targetH);
      base.composite(ribbon, x, y);
    }

    return await base.encode();
  } catch (compositeErr) {
    console.error("composite brand assets failed:", compositeErr);
    // ไม่ throw ต่อ — ถ้าซ้อนโลโก้ไม่สำเร็จ (เช่น URL โลโก้เสีย) ให้ใช้รูปพื้นหลังเดิมแทน ดีกว่าทำให้ทั้ง request ล้ม
    return baseImageBytes;
  }
}

// แปลงชื่อตำแหน่ง (top-left, bottom-right, ฯลฯ) ให้เป็นคำอธิบายมุมภาษาอังกฤษที่ image model เข้าใจตรงกัน
function positionLabel(position: string) {
  const map: Record<string, string> = {
    "top-left": "top-left corner",
    "top-right": "top-right corner",
    "bottom-left": "bottom-left corner",
    "bottom-right": "bottom-right corner",
    "bottom-center": "bottom-center edge",
    "top-center": "top-center edge",
  };
  return map[position] || "bottom-right corner";
}

// สร้างข้อความบอก AI ให้ "เว้นพื้นที่ว่าง" ตรงมุมที่จะวางโลโก้/ริบบิ้นจริงในขั้น composite ทีหลัง
// ใช้ scale_pct เดียวกับที่ตั้งไว้ในหน้าตั้งค่าเป๊ะๆ เพื่อให้พื้นที่ว่างพอดีกับขนาดโลโก้จริง — ไม่เยอะไปจนเปลืองพื้นที่ดีไซน์
// ไม่น้อยไปจนโลโก้ไปทับตัวหนังสือ/องค์ประกอบสำคัญในรูป
function buildSafeZoneInstruction(brandAssets: BrandAssets) {
  const zones: string[] = [];
  if (brandAssets.logo_url) {
    const pct = brandAssets.logo_scale_pct || 15;
    // เผื่อระยะขอบ (margin) อีกเล็กน้อยรอบโลโก้ ไม่ใช่แค่ขนาดโลโก้เป๊ะๆ กันโลโก้จริงชิดกับองค์ประกอบในรูปเกินไป
    const safePct = Math.min(35, Math.round(pct * 1.6));
    zones.push(`a logo will be placed in the ${positionLabel(brandAssets.logo_position || "bottom-right")}, occupying roughly ${safePct}% of the image width/height in that corner`);
  }
  if (brandAssets.ribbon_url) {
    const pct = brandAssets.ribbon_scale_pct || 25;
    const safePct = Math.min(40, Math.round(pct * 1.6));
    zones.push(`a ribbon badge will be placed in the ${positionLabel(brandAssets.ribbon_position || "top-left")}, occupying roughly ${safePct}% of the image width/height in that corner`);
  }
  if (zones.length === 0) return "";

  return ` IMPORTANT LAYOUT CONSTRAINT: This design will have brand assets composited on top after generation — ${zones.join(
    " and "
  )}. Leave those corner areas visually clear/empty (simple background, no headline text, no important icons, no faces, no critical visual elements) so the overlay won't cover anything important. Design the rest of the composition around these reserved corners.`;
}

// ขนาดรูปที่ OpenAI image API รองรับ + วลีอธิบายอัตราส่วนสำหรับใส่ใน prompt
const ALLOWED_IMAGE_SIZES: Record<string, string> = {
  "1024x1024": "square 1:1 format",
  "1024x1536": "vertical portrait 2:3 format",
  "1536x1024": "horizontal landscape 3:2 format",
};

function dataUrlToBlob(dataUrl: string): Blob {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("รูป reference ต้องเป็น data URL แบบ base64");
  const mime = match[1].toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    throw new Error("รองรับรูป reference เฉพาะ PNG, JPG หรือ WEBP");
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("รูป reference แต่ละไฟล์ใหญ่เกิน 8 MB");
  return new Blob([bytes], { type: mime });
}

async function generateAndInsertImage(
  supabaseAdmin: ReturnType<typeof createClient>,
  imagePrompt: string,
  imageModel: string,
  brandAssets: BrandAssets,
  imageSize: string,
  referenceImages: string[] = [],
  imageCustomPrompt = "",
  brandId: string | null = null
) {
  let imageUrl: string | null = null;
  const size = ALLOWED_IMAGE_SIZES[imageSize] ? imageSize : "1024x1024";
  const ratioPhrase = ALLOWED_IMAGE_SIZES[size];

  // ถ้าตั้งค่า CI style ไว้ในหน้า "ตั้งค่า" (พิมพ์เองหรือให้ AI สกัดจากภาพตัวอย่าง) ให้ต่อท้าย prompt
  // เพื่อบังคับให้รูปที่สร้างใหม่ทุกครั้งใช้โทนสี/สไตล์เดียวกับ CI ของแบรนด์
  const ciStyleSuffix = brandAssets.ci_style_description
    ? ` Brand style guide to follow closely: ${brandAssets.ci_style_description}`
    : "";

  // บอก AI ล่วงหน้าให้เว้นพื้นที่ว่างตรงมุมที่จะซ้อนโลโก้/ริบบิ้นทีหลัง (คำนวณขนาดจากค่าที่ตั้งไว้จริงในหน้าตั้งค่า)
  // กันปัญหาโลโก้ไปทับหัวข้อ/ไอคอน/ใบหน้าในรูปที่ AI วาดมาเต็มพื้นที่โดยไม่รู้ว่าจะมีโลโก้มาทับ
  const safeZoneSuffix = buildSafeZoneInstruction(brandAssets);
  const referenceSuffix = referenceImages.length
    ? " Use the provided product reference image(s) as the source of truth for the product appearance. Preserve the product identity, shape, colors, packaging, and key details; create a polished promotional ad around it without replacing it with a generic stock product."
    : "";

  try {
    const prompt = `${imagePrompt}. Professional Facebook ad creative design, high production value, ${ratioPhrase}, sharp legible text rendering.${ciStyleSuffix}${safeZoneSuffix}${referenceSuffix}${imageCustomPrompt ? ` Additional image direction from the admin: ${imageCustomPrompt.slice(0, 2000)}` : ""}`;
    let imgResp: Response;
    if (referenceImages.length) {
      // Image Edits รองรับ image[] หลายไฟล์ จึงใช้รูปสินค้าเป็น reference โดยตรง
      // ไม่เก็บไฟล์ต้นฉบับลง storage — ใช้เฉพาะ request นี้เท่านั้น
      const form = new FormData();
      form.append("model", imageModel);
      form.append("prompt", prompt);
      form.append("size", size);
      referenceImages.slice(0, 4).forEach((dataUrl, index) => {
        const blob = dataUrlToBlob(dataUrl);
        const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
        form.append("image[]", blob, `product-reference-${index + 1}.${extension}`);
      });
      imgResp = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { authorization: `Bearer ${await getOpenAIKey()}` },
        body: form,
      });
    } else {
      imgResp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await getOpenAIKey()}`,
        },
        body: JSON.stringify({
          model: imageModel,
          // เดิมสั่ง "no text overlay" ทำให้ได้ภาพสต็อกทั่วไปไม่มีความเป็นโฆษณา
          // ตอนนี้ตั้งใจให้มีข้อความไทยสั้นๆ ในภาพ (จาก imagePrompt ที่ AI ออกแบบมาแล้ว) เพื่อให้ดูเป็นครีเอทีฟโฆษณาจริง
          // หมายเหตุ: โมเดล image gen สะกดภาษาไทยในภาพผิดได้ง่าย ต้องตรวจสอบตัวสะกดในรูปก่อนใช้จริงเสมอ
          prompt,
          size,
        }),
      });
    }

    if (imgResp.ok) {
      const imgData = await imgResp.json();
      const b64 = imgData.data?.[0]?.b64_json;
      if (b64) {
        let bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        bytes = await compositeBrandAssets(bytes, brandAssets);
        const fileName = `${crypto.randomUUID()}.png`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from("ad-creatives")
          .upload(fileName, bytes, { contentType: "image/png" });
        if (!uploadError) {
          const { data: publicUrlData } = supabaseAdmin.storage
            .from("ad-creatives")
            .getPublicUrl(fileName);
          imageUrl = publicUrlData.publicUrl;
        }
      }
    } else {
      console.error("image generation http error:", imgResp.status, await imgResp.text());
    }
  } catch (imgErr) {
    console.error("image generation failed:", imgErr);
    // ไม่ throw ต่อ — insert แถวไว้แบบไม่มีรูป ผู้อนุมัติจะเห็นว่าไม่มีรูปแล้วข้ามไปเลือกอันอื่นได้
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from("ad_images")
    .insert({
      image_prompt: imagePrompt,
      image_url: imageUrl,
      status: "pending_approval",
      generated_by_model: imageModel,
      brand_id: brandId,
    })
    .select()
    .single();

  if (insertError) throw insertError;
  return row;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await authorizeRequest(req, { admin: true, tab: "generate" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: auth.status,
      });
    }
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Reference images are normally storage URLs; keep a bounded allowance for legacy data URLs.
    const brief = await readJsonBody(req, 8 * 1024 * 1024);
    // mode "copies_only" (ค่าเริ่มต้นถ้าไม่ส่ง mode มา = พฤติกรรมเดิมทั้งหมดในคำขอเดียว — เผื่อมีที่อื่นเรียกแบบเก่าอยู่)
    // mode "single_image" ใช้สร้างรูปทีละ 1 ใบต่อคำขอ
    //
    // เหตุผลที่ต้องแยกเป็นหลายคำขอ: ตอนสร้าง 5 copy + 5 รูปในคำขอเดียว รวมเวลารอ OpenAI image API
    // (ที่มักช้ากว่ารูปละ 10-30 วินาที) ต่อกันหลายรูป ทำให้เกินเพดานเวลาต่อ request ของ Edge Function
    // (ขึ้น error "Gateway Timeout" / HTTP 546) เว็บแอปฝั่ง frontend จึงต้องยิงเป็นคำขอย่อยๆ แทน
    const mode = brief.mode === "single_image" ? "single_image" : "copies_only";

    if (mode === "single_image") {
      const imageModel = ["gpt-image-1", "gpt-image-2"].includes(brief.image_model)
        ? brief.image_model
        : "gpt-image-1";
      const imagePrompt = String(brief.image_prompt || "").trim();
      if (!imagePrompt) throw new Error("ต้องส่ง image_prompt มาด้วยสำหรับ mode single_image");
      const imageSize = String(brief.image_size || "1024x1024");
      const referenceImages = Array.isArray(brief.reference_images)
        ? brief.reference_images.filter((v: unknown): v is string => typeof v === "string").slice(0, 4)
        : [];
      const imageCustomPrompt = String(brief.image_custom_prompt || "").trim().slice(0, 2000);
      const brandId = typeof brief.brand_id === "string" && brief.brand_id.trim() ? brief.brand_id.trim() : null;

      const { data: brandAssetsRow } = await supabaseAdmin
        .from("settings")
        .select("value")
        .eq("key", "brand_assets")
        .maybeSingle();
      const brandAssets = selectBrandAssets(brandAssetsRow?.value, String(brief.brand_id || ""));

      const insertedImage = await generateAndInsertImage(
        supabaseAdmin,
        imagePrompt,
        imageModel,
        brandAssets,
        imageSize,
        referenceImages,
        imageCustomPrompt,
        brandId
      );

      return new Response(
        JSON.stringify({ ok: true, created_images: 1, images: [insertedImage] }),
        { headers: { ...corsHeaders, "content-type": "application/json" }, status: 200 }
      );
    }

    // mode "copies_only": สร้าง copy ทั้งหมด + คืน image_prompts กลับไปให้ frontend
    // (แต่ยังไม่สร้างรูปที่นี่ — frontend จะวนเรียก mode single_image ทีละรูปเอง)
    const numCopies = Math.max(1, Math.min(10, brief.num_copies || brief.num_variants || 4));
    const numImages = Math.max(0, Math.min(10, brief.num_images ?? numCopies));
    const textModel = brief.text_model === "claude" ? "claude" : "openai";
    const brandId = typeof brief.brand_id === "string" && brief.brand_id.trim() ? brief.brand_id.trim() : null;

    // คำสั่งเพิ่มเติมที่แอดมินพิมพ์เองในหน้า "สร้างคอนเทนต์" — merge (ต่อท้าย) หรือ override (แทนที่ทั้งหมด)
    const customPromptMode = brief.custom_prompt_mode === "override" ? "override" : "merge";
    const lengthMap: Record<string, string> = {
      short: "สั้น กระชับ ประมาณ 15-25 คำ",
      medium: "ความยาวปานกลาง ประมาณ 30-50 คำ",
      long: "ยาว ให้ข้อมูลครบ ประมาณ 60-90 คำ",
    };
    const lengthInstruction = lengthMap[brief.copy_length]
      ? `\n\n=== COPY LENGTH ===\nEach variant's primary_text should be ${lengthMap[brief.copy_length]}. Keep the headline short and punchy regardless of this length.`
      : "";
    const systemPrompt = buildSystemPrompt(brief.custom_prompt, customPromptMode) + lengthInstruction;

    const parsed =
      textModel === "openai"
        ? await generateWithOpenAI(brief, numCopies, numImages, systemPrompt)
        : await generateWithClaude(brief, numCopies, numImages, systemPrompt);

    const variants = (parsed.variants || []).slice(0, numCopies);
    const imagePrompts = (parsed.image_prompts || []).slice(0, numImages);

    const insertedCopies = await Promise.all(
      variants.map((v: { headline: string; primary_text: string; description: string; cta: string }) =>
        insertCopy(supabaseAdmin, brief, v, textModel, brandId)
      )
    );

    return new Response(
      JSON.stringify({
        ok: true,
        created_copies: insertedCopies.length,
        copies: insertedCopies,
        image_prompts: imagePrompts, // frontend เอาไปวน mode single_image ทีละรายการ
      }),
      { headers: { ...corsHeaders, "content-type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
      status: 500,
    });
  }
});
