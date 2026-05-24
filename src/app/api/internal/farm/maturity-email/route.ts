/**
 * GET/POST /api/internal/farm/maturity-email
 * 开心农场作物成熟 / 浇水邮件提醒入口（Cloudflare Cron 或外部调度调用）。
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { processFarmMaturityEmails } from '@/lib/farm-v2';

export const dynamic = 'force-dynamic';

function sanitizeSecretValue(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/\\r\\n|\\n|\\r/g, '')
    .replace(/[\r\n]/g, '')
    .trim();
}

function parseMaxUsers(value: string | number | null | undefined): number {
  if (value == null || value === '') return 100;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(Math.floor(parsed), 500));
}

function getAccessToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = sanitizeSecretValue(authHeader.slice(7));
    return token || null;
  }

  const farmHeader = sanitizeSecretValue(request.headers.get('x-farm-mail-secret'));
  if (farmHeader) return farmHeader;

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

async function resolveMaxUsers(request: NextRequest): Promise<number> {
  const queryValue = new URL(request.url).searchParams.get('maxUsers');
  let maxUsers = parseMaxUsers(queryValue);

  if (request.method === 'POST') {
    try {
      const body = await request.json() as { maxUsers?: number };
      if (body?.maxUsers !== undefined) {
        maxUsers = parseMaxUsers(body.maxUsers);
      }
    } catch {
      // 忽略无 body 或解析失败，使用 query/default。
    }
  }

  return maxUsers;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, message: '未授权' },
      { status: 401 },
    );
  }

  try {
    const maxUsers = await resolveMaxUsers(request);
    const result = await processFarmMaturityEmails(maxUsers);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('农场邮件提醒处理失败:', error);
    return NextResponse.json(
      { success: false, message: '农场邮件提醒处理失败' },
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
