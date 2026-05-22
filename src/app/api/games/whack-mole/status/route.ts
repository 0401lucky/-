import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDailyPointsLimit } from '@/lib/config';
import { getUserPoints } from '@/lib/points';
import {
  buildWhackMoleSessionView,
  getActiveWhackMoleSession,
  getDailyStats,
  getWhackMoleCooldownRemaining,
  getWhackMoleRecords,
  isInWhackMoleCooldown,
} from '@/lib/whack-mole';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const [balance, dailyStats, activeSession, inCooldown, dailyLimit, records] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
      getActiveWhackMoleSession(user.id),
      isInWhackMoleCooldown(user.id),
      getDailyPointsLimit(),
      getWhackMoleRecords(user.id, 10),
    ]);

    const cooldownRemaining = inCooldown ? await getWhackMoleCooldownRemaining(user.id) : 0;

    return NextResponse.json({
      success: true,
      data: {
        balance,
        dailyStats: {
          gamesPlayed: dailyStats.gamesPlayed,
          pointsEarned: dailyStats.pointsEarned,
        },
        inCooldown,
        cooldownRemaining,
        dailyLimit,
        pointsLimitReached: false,
        records,
        activeSession: activeSession ? buildWhackMoleSessionView(activeSession) : null,
      },
    });
  } catch (error) {
    console.error('Get whack mole status error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
