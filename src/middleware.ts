import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function getAllowedOrigins(request: NextRequest): string[] {
  const origins: string[] = [];
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    origins.push(process.env.NEXT_PUBLIC_BASE_URL.replace(/\/+$/, ''));
  }
  // 从请求的 Host 头推断 Origin
  const host = request.headers.get('host');
  if (host) {
    origins.push(`https://${host}`);
    origins.push(`http://${host}`);
  }
  // 本地开发
  origins.push('http://localhost:3000');
  return origins;
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // 添加安全头
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  // CSRF 防护：对写操作检查 Origin
  const method = request.method.toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && request.nextUrl.pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    // 内部 Cron 调用可能没有 Origin header，跳过检查
    if (origin) {
      const allowedOrigins = getAllowedOrigins(request);
      if (!allowedOrigins.some(allowed => origin === allowed)) {
        return NextResponse.json(
          { success: false, message: '请求来源不合法' },
          { status: 403 }
        );
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
