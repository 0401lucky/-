import { NextResponse } from 'next/server';
import { getCheckinStreakLeaderboard, type CheckinRankingPeriod } from '@/lib/rankings';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function normalizePeriod(value: string | null): CheckinRankingPeriod {
  if (value === 'monthly') {
    return 'monthly';
  }
  return 'all';
}

export const GET = withUserRateLimit(
  'rankings:checkin',
  async (request) => {
    try {
      const { searchParams } = new URL(request.url);
      const period = normalizePeriod(searchParams.get('period'));
      const limitRaw = Number(searchParams.get('limit') ?? 20);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

      const data = await getCheckinStreakLeaderboard(period, limit);

      return NextResponse.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Get checkin streak rankings error:', error);
      return NextResponse.json(
        { success: false, message: '获取签到排行榜失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
