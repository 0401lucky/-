/**
 * GET/POST /api/internal/eco/theft-investigation
 * 环保行动偷盗追查入口（Cloudflare Cron 或外部调度调用）。
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runEcoTheftInvestigations } from '@/lib/eco';

export const dynamic = 'force-dynamic';

function sanitizeSecretValue(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/\\r\\n|\\n|\\r/g, '')
    .replace(/[\r\n]/g, '')
    .trim();
}

function parseLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(Math.floor(parsed), 100));
}

function getAccessToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = sanitizeSecretValue(authHeader.slice(7));
    return token || null;
  }

  const ecoHeader = sanitizeSecretValue(request.headers.get('x-eco-cron-secret'));
  if (ecoHeader) return ecoHeader;

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

async function resolveLimit(request: NextRequest): Promise<number> {
  const url = new URL(request.url);
  const queryLimit = url.searchParams.get('limit');
  if (queryLimit) return parseLimit(queryLimit);

  if (request.method === 'POST') {
    try {
      const body = await request.json() as { limit?: number };
      if (body?.limit !== undefined) return parseLimit(body.limit);
    } catch {
      // 忽略无 body 或解析失败，使用默认值
    }
  }

  return 25;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, message: '未授权' },
      { status: 401 },
    );
  }

  try {
    const limit = await resolveLimit(request);
    const result = await runEcoTheftInvestigations({ limit });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('环保行动偷盗追查失败:', error);
    return NextResponse.json(
      { success: false, message: '环保行动偷盗追查失败' },
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
