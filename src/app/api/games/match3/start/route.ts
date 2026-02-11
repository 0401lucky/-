// src/app/api/games/match3/start/route.ts

import { NextResponse } from 'next/server';
import { getDailyPointsLimit } from '@/lib/config';
import { getDailyStats, startMatch3Game } from '@/lib/match3';
import { withUserRateLimit } from '@/lib/rate-limit';

export const POST = withUserRateLimit(
  'game:start',
  async (_request, user) => {
    try {
      const [dailyStats, dailyPointsLimit] = await Promise.all([getDailyStats(user.id), getDailyPointsLimit()]);

      const pointsLimitReached = dailyStats && dailyStats.pointsEarned >= dailyPointsLimit;

      const result = await startMatch3Game(user.id);
      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: 400 });
      }

      const session = result.session!;
      return NextResponse.json({
        success: true,
        data: {
          sessionId: session.id,
          seed: session.seed,
          config: session.config,
          timeLimitMs: session.timeLimitMs,
          startedAt: session.startedAt,
          expiresAt: session.expiresAt,
          dailyStats: {
            gamesPlayed: dailyStats.gamesPlayed,
            pointsEarned: dailyStats.pointsEarned,
          },
          dailyLimit: dailyPointsLimit,
          pointsLimitReached,
        },
      });
    } catch (error) {
      console.error('Start match3 game error:', error);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' }
);
