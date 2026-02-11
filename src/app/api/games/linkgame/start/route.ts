import { NextRequest, NextResponse } from 'next/server';
import { startLinkGame, getDailyStats } from '@/lib/linkgame-server';
import { LINKGAME_DIFFICULTY_CONFIG } from '@/lib/linkgame';
import { getDailyPointsLimit } from '@/lib/config';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { LinkGameDifficulty } from '@/lib/types/game';

export const POST = withUserRateLimit(
  'game:start',
  async (request: NextRequest, user) => {
    try {
      const [dailyStats, dailyPointsLimit] = await Promise.all([
        getDailyStats(user.id),
        getDailyPointsLimit(),
      ]);
      
      const pointsLimitReached = dailyStats && dailyStats.pointsEarned >= dailyPointsLimit;

      const body = await request.json();
      const difficulty = body.difficulty as LinkGameDifficulty;

      if (!difficulty || !LINKGAME_DIFFICULTY_CONFIG[difficulty]) {
        return NextResponse.json(
          { success: false, message: '无效的难度选择' },
          { status: 400 }
        );
      }

      const result = await startLinkGame(user.id, difficulty);

      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          sessionId: result.session!.id,
          difficulty: result.session!.difficulty,
          tileLayout: result.session!.tileLayout,
          expiresAt: result.session!.expiresAt,
          config: LINKGAME_DIFFICULTY_CONFIG[difficulty],
          dailyStats,
          dailyPointsLimit,
          pointsLimitReached,
        },
      });
    } catch (error) {
      console.error('Start link game error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
