import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "兑换码领取中心",
  description: "领取你的专属兑换码",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
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
      </body>
    </html>
  );
}
