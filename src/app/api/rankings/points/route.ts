import { NextResponse } from 'next/server';
import { getPointsLeaderboard, type PointsRankingPeriod } from '@/lib/rankings';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function normalizePeriod(value: string | null): PointsRankingPeriod {
  if (value === 'monthly') {
    return 'monthly';
  }
  return 'all';
}

export const GET = withUserRateLimit(
  'rankings:points',
  async (request) => {
    try {
      const { searchParams } = new URL(request.url);
      const period = normalizePeriod(searchParams.get('period'));
      const limitRaw = Number(searchParams.get('limit') ?? 20);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

      const data = await getPointsLeaderboard(period, limit);

      return NextResponse.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Get points rankings error:', error);
      return NextResponse.json(
        { success: false, message: '获取积分排行榜失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
