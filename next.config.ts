import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // 启用压缩
  compress: true,

  // 图片优化
  images: {
    formats: ["image/avif", "image/webp"],
    // Cloudflare + R2 自定义图片路由下，关闭 Next 内置优化，直接走原图 URL
    unoptimized: true,
  },

  // 实验性优化
  experimental: {
    // 按需导入图标库，减少 bundle 体积
    optimizePackageImports: ["lucide-react", "react-icons"],
  },

  // 统一下发静态安全响应头，避免页面流量经过 middleware
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  // 优化服务端外部包
  serverExternalPackages: ["matter-js"],
};

export default nextConfig;
