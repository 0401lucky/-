import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 启用压缩
  compress: true,

  // 图片优化
  images: {
    formats: ["image/avif", "image/webp"],
  },

  // 实验性优化
  experimental: {
    // 按需导入图标库，减少 bundle 体积
    optimizePackageImports: ["lucide-react", "react-icons"],
  },

  // 生产环境移除 console.log（保留 warn/error）
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["warn", "error"] }
        : false,
  },

  // 优化服务端外部包
  serverExternalPackages: ["matter-js"],
};

export default nextConfig;
