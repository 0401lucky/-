// src/app/api/games/match3/status/route.ts

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getUserPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import {
  getActiveMatch3Session,
  getCooldownRemaining,
  getDailyStats,
  getMatch3Records,
  isInCooldown,
} from '@/lib/match3';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const [balance, dailyStats, activeSession, inCooldown, dailyPointsLimit, records] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
      getActiveMatch3Session(user.id),
      isInCooldown(user.id),
      getDailyPointsLimit(),
      getMatch3Records(user.id, 10),
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
              config: activeSession.config,
              timeLimitMs: activeSession.timeLimitMs,
              startedAt: activeSession.startedAt,
              expiresAt: activeSession.expiresAt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Get match3 status error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

