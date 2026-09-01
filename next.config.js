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
  // /tv-members ถูกยุบเข้าไปเป็นแท็บ TradingView ในหน้า /customerdb แล้ว (เนื้อหาเดียวกันเป๊ะ)
  // เก็บเส้นทางเดิมไว้ให้ redirect เพื่อไม่ให้บุ๊กมาร์ก/ลิงก์เก่ากลายเป็น 404
  // ทำที่ชั้น routing ไม่ใช่ใน React เพราะหน้านี้อยู่ใต้ layout ที่เป็น client component
  // การ redirect ระหว่าง render ทำให้ hooks ไม่ตรงกันจนหน้าพัง
  async redirects() {
    return [{ source: "/tv-members", destination: "/customerdb", permanent: false }];
  },
};

module.exports = nextConfig;
