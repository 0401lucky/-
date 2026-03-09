import { NextResponse } from 'next/server';
import { getCheckinStreakLeaderboard, type CheckinRankingPeriod } from '@/lib/rankings';
import { withAuthenticatedUser } from '@/lib/rate-limit';
import {
  buildKvUnavailablePayload,
  getKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@/lib/kv';

const PRIVATE_RANKING_CACHE_CONTROL = 'private, max-age=15, stale-while-revalidate=45';

function normalizePeriod(value: string | null): CheckinRankingPeriod {
  if (value === 'monthly') {
    return 'monthly';
  }
  return 'all';
}

export const GET = withAuthenticatedUser(
  async (request) => {
    try {
      const { searchParams } = new URL(request.url);
      const period = normalizePeriod(searchParams.get('period'));
      const limitRaw = Number(searchParams.get('limit') ?? 20);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

      const data = await getCheckinStreakLeaderboard(period, limit);

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
          buildKvUnavailablePayload('签到排行榜服务暂时不可用，请稍后重试'),
          {
            status: 503,
            headers: {
              'Retry-After': KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
            },
          }
        );
      }

      console.error('Get checkin streak rankings error:', error);
      return NextResponse.json(
        { success: false, message: '获取签到排行榜失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
