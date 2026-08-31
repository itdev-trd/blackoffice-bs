/** @type {import('tailwindcss').Config} */

// ระบบดีไซน์ AdFlow OS — เครื่องมือทำงานภายใน ไม่ใช่หน้าการตลาด
// หลักการ: แน่นแต่อ่านง่าย, เส้นขอบผมเส้นทำงานแทนเงา, สีมีความหมายเสมอ
//
// neutral ใช้ slate ของ Tailwind ตามเดิม — เป็น ramp ที่เอนเย็นเข้าชุดกับ accent น้ำเงิน
// และ JSX ทั้งโปรเจกต์เขียนด้วย slate มาแต่ต้น การคงไว้ลดความเสี่ยงและไม่ต้องแก้ 13k บรรทัด
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // ธีมมืดตาม mockup ที่ผู้ใช้ส่งมา (GitHub-dark inspired)
        night: {
          base: "#0D1117",
          surface: "#161B22",
          surface2: "#1C2128",
          border: "#30363D",
          "border-subtle": "#21262D",
          ink: "#E6EDF3",
          "ink-2": "#8B949E",
          "ink-3": "#484F58",
          accent: "#1F6FEB",
          "accent-light": "#58A6FF",
        },
        // accent เดียวของระบบ — ปุ่มหลัก, เมนูที่เลือก, ลิงก์
        brand: {
          50: "#EEF1FE",
          100: "#DFE5FD",
          200: "#C2CDFB",
          300: "#9AAAF7",
          400: "#6C81F0",
          500: "#4A5FE8",
          600: "#3452E0", // ค่าหลัก
          700: "#2A41B8",
          800: "#26398F",
          900: "#243472",
        },
        // สีสถานะ — แยกจาก accent เพื่อไม่ให้ "สำคัญ" กับ "ดี/แย่" ปนกัน
        ok: { fg: "#0E9F5F", bg: "#E7F8EF", border: "#B7E9CF" },
        warn: { fg: "#B7791F", bg: "#FDF2E3", border: "#F2DDB4" },
        danger: { fg: "#D0362A", bg: "#FDEDEC", border: "#F6C9C5" },
        info: { fg: "#3452E0", bg: "#EEF1FE", border: "#C2CDFB" },
      },
      fontFamily: {
        // IBM Plex Sans Thai ครอบทั้งไทยและละตินในตัวเดียว จึงไม่ต้องมีฟอนต์หัวข้อแยก
        // (ฟอนต์ละตินสวยๆ ส่วนใหญ่ไม่มีสระไทย หัวข้อไทยจะ fallback แล้วดูไม่เข้าชุด)
        // ลำดับชั้นสร้างด้วยน้ำหนัก+ขนาด ไม่ใช่การสลับ family
        sans: ['"IBM Plex Sans Thai"', '"Noto Sans Thai"', "system-ui", "sans-serif"],
        // ตัวเลขทุกที่ที่ต้องเทียบกันเป็นคอลัมน์ (ยอดเงิน, สถิติ, วันเวลา)
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        // ขั้นบันไดตัวอักษร — ใช้เท่าที่จำเป็น ไม่ต้องมีทุกขนาด
        "2xs": ["11px", { lineHeight: "1.45" }],
      },
      borderRadius: {
        // การ์ด 14px / ตัวควบคุม 10px — ไม่ใช้ rounded-2xl ทั่วไปจนดูเป็นของเล่น
        card: "14px",
        control: "10px",
      },
      boxShadow: {
        // เงาไว้บอก "ลอยอยู่เหนือ" เท่านั้น (dropdown, modal) การ์ดปกติใช้เส้นขอบ
        card: "0 1px 2px rgba(20,23,31,.04)",
        pop: "0 10px 30px -12px rgba(20,23,31,.18), 0 2px 6px rgba(20,23,31,.06)",
        modal: "0 24px 60px -20px rgba(20,23,31,.28)",
      },
      transitionTimingFunction: {
        ui: "cubic-bezier(.2,.8,.2,1)",
      },
    },
  },
  plugins: [],
};
