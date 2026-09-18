import "./globals.css";
import "./studio.css";
import "./nova.css";
import { Noto_Sans_Thai, Roboto } from "next/font/google";
import UpdateBanner from "@/components/shared/UpdateBanner";
import KeyboardViewport from "@/components/shared/KeyboardViewport";
import AuthListener from "@/components/shared/AuthListener";
import ServiceWorkerRegistrar from "@/components/shared/ServiceWorkerRegistrar";

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-sans-thai",
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata = {
  title: "Besight — ระบบยิงโฆษณาและตอบแชทอัตโนมัติ",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/besight-logo.svg", type: "image/svg+xml" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    // iOS บางรุ่นขอ /apple-touch-icon-precomposed.png ก่อน ถ้าไม่เจอจะไปจับภาพหน้าจอมาทำไอคอนแทน
    // (ไอคอนบนหน้าจอโฮมเลยกลายเป็นภาพหน้าเว็บเบลอ ๆ) — วางไฟล์ไว้ทั้งสองชื่อ
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
      { url: "/apple-touch-icon-precomposed.png", sizes: "180x180" },
    ],
  },
  // statusBarStyle "default" = iOS กันพื้นที่แถบสถานะให้เอง เนื้อหาไม่มุดไปใต้ติ่งจอ/นาฬิกา
  // (เดิม black-translucent เนื้อหามุดขึ้นไปใต้แถบสถานะ และตัวอักษรนาฬิกา/แบตเป็นสีขาว
  //  ทับพื้นหลังสว่างของแอปจนอ่านไม่ออกในโหมดเพิ่มลงหน้าจอโฮม)
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Besight",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // คีย์บอร์ดเด้งขึ้นมาให้ย่อพื้นที่เนื้อหา ไม่ใช่เลื่อนจอทั้งใบขึ้น (Android Chrome)
  // iOS ยังไม่รองรับค่านี้ จึงมี KeyboardViewport อ่าน visualViewport มาช่วยอีกชั้น
  interactiveWidget: "resizes-content",
  // สีแถบระบบต้องตรงกับพื้นแอปจริง ๆ ทั้งสองธีม — เดิม manifest เป็น #0D1117 (มืด) แต่หน้าเว็บสว่าง
  // เปิดจากหน้าจอโฮมบน Android เลยได้แถบบนสีดำคาดอยู่เหนือแอปสีสว่าง
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F7FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0D1117" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" suppressHydrationWarning className={`${notoSansThai.variable} ${roboto.variable}`}>
      <head>
        {/* ทาคลาสธีมก่อนหน้าจอวาด — ไม่งั้นเห็นจอขาวแวบก่อนกลายเป็นมืด
            ต้องเป็น inline script เพราะ React hydrate ทีหลังเสมอ */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("ui.theme.v2");var d=t==="dark";document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){document.documentElement.classList.remove("dark");}})();`,
          }}
        />
      </head>
      <body>
        <AuthListener />
        <ServiceWorkerRegistrar />
        {children}
        <UpdateBanner />
        <KeyboardViewport />
      </body>
    </html>
  );
}
