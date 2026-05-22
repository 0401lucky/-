import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDailyPointsLimit } from '@/lib/config';
import { getUserPoints } from '@/lib/points';
import {
  buildMinesweeperSessionView,
  getActiveMinesweeperSession,
  getDailyStats,
  getMinesweeperCooldownRemaining,
  getMinesweeperRecords,
  isInMinesweeperCooldown,
} from '@/lib/minesweeper';
import { MINESWEEPER_DIFFICULTY_CONFIG } from '@/lib/minesweeper-engine';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const [balance, dailyStats, activeSession, inCooldown, dailyLimit, records] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
      getActiveMinesweeperSession(user.id),
      isInMinesweeperCooldown(user.id),
      getDailyPointsLimit(),
      getMinesweeperRecords(user.id, 10),
    ]);

    const cooldownRemaining = inCooldown ? await getMinesweeperCooldownRemaining(user.id) : 0;

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
        difficulties: Object.values(MINESWEEPER_DIFFICULTY_CONFIG),
        activeSession: activeSession ? buildMinesweeperSessionView(activeSession) : null,
      },
    });
  } catch (error) {
    console.error('Get minesweeper status error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
