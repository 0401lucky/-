import type { Metadata } from "next";
import "./globals.css";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
        <DesktopPet />
      </body>
    </html>
  );
}
