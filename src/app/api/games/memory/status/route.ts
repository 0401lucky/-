// src/app/api/games/memory/status/route.ts

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getUserPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import { 
  getDailyStats, 
  getActiveMemorySession, 
  isInCooldown, 
  getCooldownRemaining,
  DIFFICULTY_CONFIG,
  buildMemorySessionView,
} from '@/lib/memory';
import type { MemoryDifficulty } from '@/lib/types/game';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const [balance, dailyStats, activeSession, inCooldown, dailyPointsLimit] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
      getActiveMemorySession(user.id),
      isInCooldown(user.id),
      getDailyPointsLimit(),
    ]);

    let cooldownRemaining = 0;
    if (inCooldown) {
      cooldownRemaining = await getCooldownRemaining(user.id);
    }

    // 检查是否已达积分上限
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
          ...buildMemorySessionView(activeSession),
          expiresAt: activeSession.expiresAt,
          config: DIFFICULTY_CONFIG[activeSession.difficulty as MemoryDifficulty],
        } : null,
      },
    });
  } catch (error) {
    console.error('Get memory status error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
