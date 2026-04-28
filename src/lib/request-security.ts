import { NextResponse } from "next/server";

const UNSAFE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
const TRUSTED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

function getAllowedOrigins(requestUrl: URL): string[] {
  const origins = [normalizeOrigin(requestUrl.origin)];
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    origins.push(normalizeOrigin(process.env.NEXT_PUBLIC_BASE_URL));
  }
  origins.push("http://localhost:3000");
  return Array.from(new Set(origins));
}

function isTrustedNonBrowserRequest(request: Request, requestUrl: URL): boolean {
  if (requestUrl.pathname.startsWith("/api/internal/")) {
    return true;
  }

  return request.headers.has("authorization");
}

/**
 * 校验不安全 API 方法的请求来源，替代 Cloudflare 不支持的 Next Proxy。
 */
export function enforceTrustedApiRequest(request: Request): NextResponse | null {
  const method = request.method.toUpperCase();
  if (!UNSAFE_METHODS.has(method)) {
    return null;
  }

  const requestUrl = new URL(request.url);
  if (!requestUrl.pathname.startsWith("/api/")) {
    return null;
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const allowedOrigins = getAllowedOrigins(requestUrl);
    if (!allowedOrigins.some((allowed) => normalizeOrigin(origin) === allowed)) {
      return NextResponse.json(
        { success: false, message: "请求来源不合法" },
        { status: 403 },
      );
    }
    return null;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !TRUSTED_FETCH_SITES.has(fetchSite)) {
    return NextResponse.json(
      { success: false, message: "跨站请求已被拒绝" },
      { status: 403 },
    );
  }

  if (!fetchSite && !isTrustedNonBrowserRequest(request, requestUrl)) {
    return NextResponse.json(
      { success: false, message: "缺少可信请求来源" },
      { status: 403 },
    );
  }

  return null;
}
