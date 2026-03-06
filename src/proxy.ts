import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const TRUSTED_FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);

function getAllowedOrigins(request: NextRequest): string[] {
  const origins: string[] = [request.nextUrl.origin.replace(/\/+$/, '')];
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    origins.push(process.env.NEXT_PUBLIC_BASE_URL.replace(/\/+$/, ''));
  }
  origins.push('http://localhost:3000');
  return Array.from(new Set(origins));
}

function isTrustedNonBrowserRequest(request: NextRequest): boolean {
  if (request.nextUrl.pathname.startsWith('/api/internal/')) {
    return true;
  }

  return request.headers.has('authorization');
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  const method = request.method.toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && request.nextUrl.pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    if (origin) {
      const allowedOrigins = getAllowedOrigins(request);
      if (!allowedOrigins.some(allowed => origin === allowed)) {
        return NextResponse.json(
          { success: false, message: '请求来源不合法' },
          { status: 403 }
        );
      }
    } else {
      const fetchSite = request.headers.get('sec-fetch-site');
      if (fetchSite && !TRUSTED_FETCH_SITES.has(fetchSite)) {
        return NextResponse.json(
          { success: false, message: '跨站请求已被拒绝' },
          { status: 403 }
        );
      }

      if (!fetchSite && !isTrustedNonBrowserRequest(request)) {
        return NextResponse.json(
          { success: false, message: '缺少可信请求来源' },
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
