import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDailyStats, getGameRecords, isInCooldown, getCooldownRemaining, getActiveSession } from '@/lib/game';
import { getUserPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const [balance, dailyStats, records, inCooldown, activeSession, dailyPointsLimit] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
      getGameRecords(user.id, 10),
      isInCooldown(user.id),
      getActiveSession(user.id),
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
        dailyStats,
        records,
        inCooldown,
        cooldownRemaining,
        dailyLimit: dailyPointsLimit, // 动态积分上限
        pointsLimitReached,
        // 如果有活跃会话，返回会话信息供恢复
        activeSession: activeSession ? {
          sessionId: activeSession.id,
          seed: activeSession.seed,
          expiresAt: activeSession.expiresAt,
        } : null,
      },
    });
  } catch (error) {
    console.error('Get status error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
