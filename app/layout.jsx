import "./globals.css";
import { Noto_Sans_Thai, Roboto } from "next/font/google";
import UpdateBanner from "@/components/shared/UpdateBanner";
import AuthListener from "@/components/shared/AuthListener";

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
    icon: "/besight-logo.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Besight",
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
    <html lang="th" suppressHydrationWarning className={`dark ${notoSansThai.variable} ${roboto.variable}`}>
      <body>
        <AuthListener />
        {children}
        <UpdateBanner />
      </body>
    </html>
  );
}
