import { NextResponse } from 'next/server';
import {
  listRankingSettlementHistory,
  type RankingSettlementPeriod,
} from '@/lib/ranking-settlement';
import { withAuthenticatedUser } from '@/lib/rate-limit';
import {
  buildKvUnavailablePayload,
  getKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@/lib/kv';

const PRIVATE_RANKING_CACHE_CONTROL = 'private, max-age=15, stale-while-revalidate=45';

function normalizePeriod(value: string | null): RankingSettlementPeriod {
  return value === 'monthly' ? 'monthly' : 'weekly';
}

function normalizePage(value: string | null): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.floor(num));
}

function normalizeLimit(value: string | null): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 20;
  return Math.max(1, Math.min(50, Math.floor(num)));
}

export const GET = withAuthenticatedUser(
  async (request) => {
    try {
      const { searchParams } = new URL(request.url);
      const period = normalizePeriod(searchParams.get('period'));
      const page = normalizePage(searchParams.get('page'));
      const limit = normalizeLimit(searchParams.get('limit'));

      const data = await listRankingSettlementHistory(period, { page, limit });

      const response = NextResponse.json({
        success: true,
        data,
      });
      response.headers.set('Cache-Control', PRIVATE_RANKING_CACHE_CONTROL);
      return response;
    } catch (error) {
      const kvInsight = getKvErrorInsight(error);
      if (kvInsight.isUnavailable) {
        return NextResponse.json(
          buildKvUnavailablePayload('排行榜历史服务暂时不可用，请稍后重试'),
          {
            status: 503,
            headers: {
              'Retry-After': KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
            },
          }
        );
      }

      console.error('Get ranking settlement history error:', error);
      return NextResponse.json(
        { success: false, message: '获取排行榜结算历史失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
