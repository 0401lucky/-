import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { startLinkGame, getDailyStats } from '@/lib/linkgame-server';
import { LINKGAME_DIFFICULTY_CONFIG } from '@/lib/linkgame';
import { getDailyPointsLimit } from '@/lib/config';
import type { LinkGameDifficulty } from '@/lib/types/game';

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: '请先登录' },
        { status: 401 }
      );
    }

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
}
