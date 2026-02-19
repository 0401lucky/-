// src/app/api/games/match3/start/route.ts

import { startMatch3Game } from '@/lib/match3';
import { createStartRoute, fail } from '@/lib/game-route-factory';

export const { POST } = createStartRoute(
  async (_request, { user, dailyStats, dailyPointsLimit, pointsLimitReached }) => {
    const result = await startMatch3Game(user.id);
    if (!result.success) {
      return fail(result.message ?? '开始游戏失败');
    }

    const session = result.session!;
    return {
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
    };
  },
  { logLabel: 'match3 game' },
);
