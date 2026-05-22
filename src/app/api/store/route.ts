import { NextResponse } from 'next/server';
import { getStoreItems, getExchangeLogs, getStoreCategories } from '@/lib/store';
import { getUserPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import { getDailyStats } from '@/lib/daily-stats';
import { withAuth } from '@/lib/api-guards';

export const GET = withAuth(
  async (_request, user) => {
    const [items, categories, balance, recentExchanges, dailyLimit, dailyStats] = await Promise.all([
      getStoreItems(),
      getStoreCategories(),
      getUserPoints(user.id),
      getExchangeLogs(user.id, 10),
      getDailyPointsLimit(),
      getDailyStats(user.id),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        items,
        categories,
        balance,
        recentExchanges,
        dailyLimit,
        dailyEarned: dailyStats?.pointsEarned ?? 0,
      },
    });
  },
  { unauthorizedMessage: '未登录' }
);
