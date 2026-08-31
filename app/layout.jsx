import "./globals.css";
import UpdateBanner from "@/components/shared/UpdateBanner";
import AuthListener from "@/components/shared/AuthListener";

export const metadata = {
  title: "AdFlow OS — ระบบยิงโฆษณาและตอบแชทอัตโนมัติ",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon-64.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AdFlow",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F4F7FB",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" suppressHydrationWarning className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* IBM Plex Sans Thai = ตัวอักษรทั้งระบบ (ครอบไทย+ละตินในตระกูลเดียว)
            IBM Plex Mono = ตัวเลขที่ต้องเทียบกันเป็นคอลัมน์ (ยอดเงิน สถิติ วันเวลา) */}
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Sans+Thai:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthListener />
        {children}
        <UpdateBanner />
      </body>
    </html>
  );
}
