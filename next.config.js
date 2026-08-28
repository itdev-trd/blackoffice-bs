const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

// build id ต่อรอบ build/dev-start — ฝังในแอป (NEXT_PUBLIC_BUILD_ID) และเขียนเป็น public/version.json
// แอปจะ poll version.json แล้วเทียบ ถ้าไม่ตรง = มี deploy ใหม่ → แจ้ง/รีโหลดอัตโนมัติ (ดู UpdateBanner)
const BUILD_ID = String(Date.now());
try {
  writeFileSync(resolve(__dirname, "public/version.json"), JSON.stringify({ id: BUILD_ID }));
} catch (e) {
  console.warn("emit version.json failed", e);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  generateBuildId: async () => BUILD_ID,
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
};

module.exports = nextConfig;
