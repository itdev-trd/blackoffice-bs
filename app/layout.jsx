import "./globals.css";
import UpdateBanner from "@/components/shared/UpdateBanner";
import AuthListener from "@/components/shared/AuthListener";

export const metadata = {
  title: "AI Ads Automation — ระบบยิงโฆษณาอัตโนมัติ",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon-64.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI Ads",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090B10",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=Noto+Sans+Thai:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          // ตั้งธีมก่อน React render เพื่อกันหน้ากระพริบ โดยคง dark เป็นค่าเริ่มต้นสำหรับผู้ใช้เดิม
          dangerouslySetInnerHTML={{
            __html: `try {
              var theme = localStorage.getItem("ui.theme") === "light" ? "light" : "dark";
              document.documentElement.classList.add("theme-" + theme);
              document.documentElement.dataset.theme = theme;
              document.documentElement.style.colorScheme = theme;
            } catch (e) { document.documentElement.classList.add("theme-dark"); }`,
          }}
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
