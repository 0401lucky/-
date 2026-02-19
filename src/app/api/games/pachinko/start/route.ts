import { NextResponse } from 'next/server';
import { startGame, isInCooldown, getCooldownRemaining } from '@/lib/game';
import { createStartRoute, fail } from '@/lib/game-route-factory';

export const { POST } = createStartRoute(
  async (_request, { user, dailyStats, dailyPointsLimit, pointsLimitReached }) => {
    // pachinko 特有：冷却时间检查
    const inCooldown = await isInCooldown(user.id);
    if (inCooldown) {
      const remaining = await getCooldownRemaining(user.id);
      return NextResponse.json({
        success: false,
        message: '请稍候再试',
        cooldownRemaining: remaining,
      }, { status: 429 });
    }

    const result = await startGame(user.id);
    if (!result.success || !result.session) {
      return fail(result.message || '开始游戏失败');
    }

    return {
      sessionId: result.session.id,
      seed: result.session.seed,
      expiresAt: result.session.expiresAt,
      dailyStats,
      dailyPointsLimit,
      pointsLimitReached,
    };
  },
  { unauthorizedMessage: '未登录', logLabel: 'game' },
);
