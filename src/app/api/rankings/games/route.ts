import { NextResponse } from 'next/server';
import { getAllGamesLeaderboard, type RankingPeriod } from '@/lib/rankings';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function normalizePeriod(value: string | null): RankingPeriod {
  if (value === 'weekly' || value === 'monthly') {
    return value;
  }
  return 'daily';
}

export const GET = withUserRateLimit(
  'rankings:games',
  async (request) => {
    try {
      const { searchParams } = new URL(request.url);
      const period = normalizePeriod(searchParams.get('period'));
      const limitRaw = Number(searchParams.get('limit') ?? 20);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

      const data = await getAllGamesLeaderboard(period, {
        limitPerGame: limit,
        overallLimit: limit,
      });

      return NextResponse.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Get game rankings error:', error);
      return NextResponse.json(
        { success: false, message: '获取游戏排行榜失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
