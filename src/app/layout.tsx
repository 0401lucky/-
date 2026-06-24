import type { Metadata, Viewport } from "next";
import "./globals.css";
import BrowserCompatibility from "@/components/BrowserCompatibility";
import DesktopPet from "@/components/desktop-pet/DesktopPet";

export const metadata: Metadata = {
  title: "LuCy Station",
  description: "LuCy Station",
  icons: {
    icon: "/site-icon.png",
    shortcut: "/site-icon.png",
    apple: "/site-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fdfcf8",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <BrowserCompatibility />
        {children}
        <DesktopPet />
      </body>
    </html>
  );
}
