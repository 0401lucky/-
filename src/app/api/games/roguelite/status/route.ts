import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getUserPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import {
  buildRogueliteSessionView,
  getActiveRogueliteSession,
  getDailyStats,
  getRogueliteCooldownRemaining,
  getRogueliteRecords,
  isInRogueliteCooldown,
} from '@/lib/roguelite';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const [balance, dailyStats, activeSession, inCooldown, dailyPointsLimit, records] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
      getActiveRogueliteSession(user.id),
      isInRogueliteCooldown(user.id),
      getDailyPointsLimit(),
      getRogueliteRecords(user.id, 10),
    ]);

    const cooldownRemaining = inCooldown ? await getRogueliteCooldownRemaining(user.id) : 0;
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
        pointsLimitReached: false,
        records,
        activeSession: activeSession ? buildRogueliteSessionView(activeSession) : null,
      },
    });
  } catch (error) {
    console.error('Get roguelite status error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
