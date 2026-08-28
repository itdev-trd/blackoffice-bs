import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// build id ต่อรอบ build — ฝังในแอป (__BUILD_ID__) และเขียนเป็น dist/version.json
// แอปจะ poll version.json แล้วเทียบ ถ้าไม่ตรง = มี deploy ใหม่ → แจ้ง/รีโหลดอัตโนมัติ
const BUILD_ID = String(Date.now());

export default defineConfig({
  plugins: [
    react(),
    (() => {
      let outDir = "dist";
      return {
        name: "emit-version-json",
        apply: "build",
        configResolved(cfg) { outDir = resolve(cfg.root, cfg.build.outDir); },
        closeBundle() {
          try {
            mkdirSync(outDir, { recursive: true });
            writeFileSync(resolve(outDir, "version.json"), JSON.stringify({ id: BUILD_ID }));
          } catch (e) { console.warn("emit version.json failed", e); }
        },
      };
    })(),
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("exceljs") || id.includes("jszip") || id.includes("fast-csv") || id.includes("archiver") || id.includes("readable-stream")) return "excel-export";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("emoji-picker-react")) return "emoji-picker";
          if (id.includes("react")) return "vendor-react";
          return "vendor";
        },
      },
    },
  },
});
