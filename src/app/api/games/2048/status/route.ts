import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDailyPointsLimit } from '@/lib/config';
import {
  buildGame2048SessionView,
  getActiveGame2048Session,
  getDailyStats,
  getGame2048CooldownRemaining,
  getGame2048Records,
  isInGame2048Cooldown,
} from '@/lib/game-2048';
import { getUserPoints } from '@/lib/points';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const [balance, dailyStats, activeSession, inCooldown, dailyLimit, records] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
      getActiveGame2048Session(user.id),
      isInGame2048Cooldown(user.id),
      getDailyPointsLimit(),
      getGame2048Records(user.id, 10),
    ]);

    const cooldownRemaining = inCooldown
      ? await getGame2048CooldownRemaining(user.id)
      : 0;

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
        activeSession: activeSession ? buildGame2048SessionView(activeSession) : null,
      },
    });
  } catch (error) {
    console.error('Get 2048 status error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
