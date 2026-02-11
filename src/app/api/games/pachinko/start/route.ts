import { NextResponse } from 'next/server';
import { startGame, isInCooldown, getCooldownRemaining, getDailyStats } from '@/lib/game';
import { getDailyPointsLimit } from '@/lib/config';
import { withUserRateLimit } from '@/lib/rate-limit';

export const POST = withUserRateLimit(
  'game:start',
  async (_request, user) => {
    try {
      // 检查冷却时间
      const inCooldown = await isInCooldown(user.id);
      if (inCooldown) {
        const remaining = await getCooldownRemaining(user.id);
        return NextResponse.json({
          success: false,
          message: '请稍候再试',
          cooldownRemaining: remaining,
        }, { status: 429 });
      }

      // 获取今日统计和积分上限
      const [dailyStats, dailyPointsLimit] = await Promise.all([
        getDailyStats(user.id),
        getDailyPointsLimit(),
      ]);
      
      // 检查今日积分是否已达上限 - 仍然允许游玩，但标记不会获得积分
      const pointsLimitReached = dailyStats && dailyStats.pointsEarned >= dailyPointsLimit;

      // 开始游戏
      const result = await startGame(user.id);

      if (!result.success || !result.session) {
        return NextResponse.json({
          success: false,
          message: result.message || '开始游戏失败',
        }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        data: {
          sessionId: result.session.id,
          seed: result.session.seed,
          expiresAt: result.session.expiresAt,
          dailyStats,
          dailyPointsLimit,
          pointsLimitReached,
        },
      });
    } catch (error) {
      console.error('Start game error:', error);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '未登录' }
);
