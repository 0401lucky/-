import { NextResponse } from 'next/server';
import { getDailyPointsLimit } from '@/lib/config';
import { getDailyStats } from '@/lib/daily-stats';
import { getUserPoints } from '@/lib/points';
import { withAuthenticatedUser } from '@/lib/rate-limit';

export const GET = withAuthenticatedUser(
  async (_request, user) => {
    try {
      const [balance, dailyStats, dailyLimit] = await Promise.all([
        getUserPoints(user.id),
        getDailyStats(user.id),
        getDailyPointsLimit(),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          balance,
          dailyStats: {
            gamesPlayed: dailyStats.gamesPlayed,
            pointsEarned: dailyStats.pointsEarned,
          },
          dailyLimit,
          pointsLimitReached: dailyStats.pointsEarned >= dailyLimit,
        },
      });
    } catch (error) {
      console.error('Get games overview error:', error);
      return NextResponse.json({ success: false, message: '获取游戏概览失败' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '未登录' },
);
