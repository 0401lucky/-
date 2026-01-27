import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getUserPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import { 
  getDailyStats, 
  getActiveLinkGameSession, 
  isInCooldown, 
  getCooldownRemaining 
} from '@/lib/linkgame-server';
import { LINKGAME_DIFFICULTY_CONFIG } from '@/lib/linkgame';
import type { LinkGameDifficulty } from '@/lib/types/game';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const [balance, dailyStats, activeSession, inCooldown, dailyPointsLimit] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
      getActiveLinkGameSession(user.id),
      isInCooldown(user.id),
      getDailyPointsLimit(),
    ]);

    let cooldownRemaining = 0;
    if (inCooldown) {
      cooldownRemaining = await getCooldownRemaining(user.id);
    }

    const pointsLimitReached = dailyStats && dailyStats.pointsEarned >= dailyPointsLimit;

    return NextResponse.json({
      success: true,
      data: {
        balance,
        dailyStats: dailyStats ? {
          gamesPlayed: dailyStats.gamesPlayed,
          pointsEarned: dailyStats.pointsEarned,
        } : null,
        inCooldown,
        cooldownRemaining,
        dailyLimit: dailyPointsLimit,
        pointsLimitReached,
        activeSession: activeSession ? {
          sessionId: activeSession.id,
          difficulty: activeSession.difficulty,
          tileLayout: activeSession.tileLayout,
          expiresAt: activeSession.expiresAt,
          config: LINKGAME_DIFFICULTY_CONFIG[activeSession.difficulty as LinkGameDifficulty],
        } : null,
      },
    });
  } catch (error) {
    console.error('Get linkgame status error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
