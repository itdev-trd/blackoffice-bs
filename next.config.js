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

  // Header ความปลอดภัย + กฎแคช
  // อยู่ที่นี่แทน vercel.json เพราะ next.config ใช้ได้ทั้งตอน next start ในเครื่อง
  // และตอน deploy จริง — ทำให้ทดสอบก่อนขึ้นได้ ไม่ต้องรอไปเห็นผลบน production
  async headers() {
    const noStore = { key: "Cache-Control", value: "no-store, must-revalidate" };
    return [
      {
        // ไฟล์นี้คือกลไกตรวจว่ามี deploy ใหม่ (UpdateBanner poll ทุก 3 นาที)
        // ถ้า CDN แคชไว้ ผู้ใช้จะไม่มีวันรู้ว่ามีเวอร์ชันใหม่
        source: "/version.json",
        headers: [noStore],
      },
      {
        // service worker ต้องอัปเดตได้ทันที ไม่งั้นค้างเวอร์ชันเก่าข้ามวัน
        source: "/sw.js",
        headers: [noStore, { key: "Service-Worker-Allowed", value: "/" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
