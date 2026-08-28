import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("content generator accepts product reference images and forwards them to image generation", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const functionSource = await read("supabase/functions/generate-ad-content/index.ts");

  assert.match(frontend, /รูปสินค้าอ้างอิง/);
  assert.match(frontend, /คำสั่งเพิ่มเติมสำหรับรูปภาพ/);
  assert.match(frontend, /accept=\"image\/png,image\/jpeg,image\/webp\" multiple/);
  assert.match(frontend, /reference_images: productReferences/);
  assert.match(frontend, /image_custom_prompt: \"\"/);
  assert.match(functionSource, /https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(functionSource, /form\.append\("image\[\]"/);
  assert.match(functionSource, /dataUrlToBlob/);
  assert.match(functionSource, /referenceImages\.slice\(0, 4\)/);
  assert.match(functionSource, /Additional image direction from the admin/);
  assert.match(functionSource, /brief\.image_custom_prompt/);
});

test("content generator keeps the generation endpoint when no product reference is provided", async () => {
  const functionSource = await read("supabase/functions/generate-ad-content/index.ts");
  assert.match(functionSource, /https:\/\/api\.openai\.com\/v1\/images\/generations/);
  assert.match(functionSource, /if \(referenceImages\.length\)/);
});

test("content generator and settings support separate CI profiles per brand", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const functionSource = await read("supabase/functions/generate-ad-content/index.ts");
  assert.match(frontend, /function normalizeBrandConfig\(raw\)/);
  assert.match(frontend, /เพิ่มแบรนด์/);
  assert.match(frontend, /แบรนด์ CI ที่ใช้สร้างคอนเทนต์/);
  assert.match(frontend, /brand_id: form\.brand_id/);
  assert.match(frontend, /value: brandConfig/);
  assert.match(functionSource, /function selectBrandAssets\(config: unknown, brandId: string\)/);
  assert.match(functionSource, /selectBrandAssets\(brandAssetsRow\?\.value, String\(brief\.brand_id/);
});

test("approval queue separates assets by brand and persists the selected brand", async () => {
  const frontend = await read("ai-ads-app.jsx");
  const functionSource = await read("supabase/functions/generate-ad-content/index.ts");
  const migration = await read("supabase/migrations/20260825090000_ad_content_brand_id.sql");

  assert.match(frontend, /function ReviewTab\(\{ adCopies, adImages, onChanged, brandConfig \}/);
  assert.match(frontend, /แบรนด์ CI/);
  assert.match(frontend, /ไม่ระบุแบรนด์/);
  assert.match(frontend, /brandConfig=\{normalizeBrandConfig\(settings\.brand_assets\)\}/);
  assert.match(functionSource, /brand_id: brandId/);
  assert.match(functionSource, /const brandId = typeof brief\.brand_id === "string"/);
  assert.match(migration, /ad_copies[\s\S]*add column if not exists brand_id text/);
  assert.match(migration, /ad_images[\s\S]*add column if not exists brand_id text/);
});
