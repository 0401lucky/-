// src/app/api/games/tower/status/route.ts

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getUserPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import {
  getActiveTowerSession,
  getCooldownRemaining,
  getDailyStats,
  getTowerRecords,
  isInCooldown,
} from '@/lib/tower';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const [balance, dailyStats, activeSession, inCooldown, dailyPointsLimit, records] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
      getActiveTowerSession(user.id),
      isInCooldown(user.id),
      getDailyPointsLimit(),
      getTowerRecords(user.id, 10),
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
        dailyStats: dailyStats
          ? {
              gamesPlayed: dailyStats.gamesPlayed,
              pointsEarned: dailyStats.pointsEarned,
            }
          : null,
        inCooldown,
        cooldownRemaining,
        dailyLimit: dailyPointsLimit,
        pointsLimitReached,
        records,
        activeSession: activeSession
          ? {
              sessionId: activeSession.id,
              seed: activeSession.seed,
              startedAt: activeSession.startedAt,
              expiresAt: activeSession.expiresAt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Get tower status error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
