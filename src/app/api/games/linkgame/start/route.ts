import { startLinkGame } from '@/lib/linkgame-server';
import { LINKGAME_DIFFICULTY_CONFIG } from '@/lib/linkgame';
import { createStartRoute, fail } from '@/lib/game-route-factory';
import type { LinkGameDifficulty } from '@/lib/types/game';

export const { POST } = createStartRoute(
  async (request, { user, dailyStats, dailyPointsLimit, pointsLimitReached }) => {
    const body = await request.json();
    const difficulty = body.difficulty as LinkGameDifficulty;

    if (!difficulty || !LINKGAME_DIFFICULTY_CONFIG[difficulty]) {
      return fail('无效的难度选择');
    }

    const result = await startLinkGame(user.id, difficulty);
    if (!result.success) {
      return fail(result.message ?? '开始游戏失败');
    }

    return {
      sessionId: result.session!.id,
      difficulty: result.session!.difficulty,
      tileLayout: result.session!.tileLayout,
      expiresAt: result.session!.expiresAt,
      config: LINKGAME_DIFFICULTY_CONFIG[difficulty],
      dailyStats,
      dailyPointsLimit,
      pointsLimitReached,
    };
  },
  { logLabel: 'link game' },
);
