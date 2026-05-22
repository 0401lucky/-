/**
 * GET/POST /api/internal/number-bomb/settle
 * 数字炸弹结算入口（Cloudflare Cron 或外部调度调用）
 *
 * 鉴权方式与发奖队列保持一致，支持 Authorization Bearer 与 x-raffle-delivery-secret/x-number-bomb-secret 头。
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getPreviousDateString, settleNumberBombDate } from '@/lib/number-bomb';

export const dynamic = 'force-dynamic';

function sanitizeSecretValue(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/\\r\\n|\\n|\\r/g, '')
    .replace(/[\r\n]/g, '')
    .trim();
}

function getAccessToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = sanitizeSecretValue(authHeader.slice(7));
    return token || null;
  }

  const numberBombHeader = sanitizeSecretValue(request.headers.get('x-number-bomb-secret'));
  if (numberBombHeader) return numberBombHeader;

  const fallbackHeader = sanitizeSecretValue(request.headers.get('x-raffle-delivery-secret'));
  if (fallbackHeader) return fallbackHeader;

  return null;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = sanitizeSecretValue(
    process.env.RAFFLE_DELIVERY_CRON_SECRET ?? process.env.CRON_SECRET,
  );
  if (!secret) return false;
  const token = getAccessToken(request);
  if (!token || token.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

async function resolveDate(request: NextRequest): Promise<string> {
  const url = new URL(request.url);
  const queryDate = sanitizeSecretValue(url.searchParams.get('date'));
  if (queryDate) return queryDate;

  if (request.method === 'POST') {
    try {
      const body = await request.json() as { date?: string };
      if (typeof body?.date === 'string' && body.date.trim()) {
        return body.date.trim();
      }
    } catch {
      // ignore body parse errors
    }
  }

  return getPreviousDateString();
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, message: '未授权' },
      { status: 401 },
    );
  }

  try {
    const date = await resolveDate(request);
    const result = await settleNumberBombDate(date);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('数字炸弹结算失败:', error);
    return NextResponse.json(
      { success: false, message: '数字炸弹结算失败' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
