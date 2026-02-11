// src/app/api/games/memory/start/route.ts

import { NextRequest, NextResponse } from 'next/server';
import {
  startMemoryGame,
  DIFFICULTY_CONFIG,
  getDailyStats,
  buildMemorySessionView,
} from '@/lib/memory';
import { getDailyPointsLimit } from '@/lib/config';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { MemoryDifficulty } from '@/lib/types/game';

export const POST = withUserRateLimit(
  'game:start',
  async (request: NextRequest, user) => {
    try {
      // 获取今日统计和积分上限
      const [dailyStats, dailyPointsLimit] = await Promise.all([
        getDailyStats(user.id),
        getDailyPointsLimit(),
      ]);
      
      // 检查今日积分是否已达上限 - 仍然允许游玩，但标记不会获得积分
      const pointsLimitReached = dailyStats && dailyStats.pointsEarned >= dailyPointsLimit;

      const body = await request.json();
      const difficulty = body.difficulty as MemoryDifficulty;

      // 验证难度参数
      if (!difficulty || !DIFFICULTY_CONFIG[difficulty]) {
        return NextResponse.json(
          { success: false, message: '无效的难度选择' },
          { status: 400 }
        );
      }

      const result = await startMemoryGame(user.id, difficulty);

      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          sessionId: result.session!.id,
          difficulty: result.session!.difficulty,
          ...buildMemorySessionView(result.session!),
          expiresAt: result.session!.expiresAt,
          config: DIFFICULTY_CONFIG[difficulty],
          dailyStats,
          dailyPointsLimit,
          pointsLimitReached,
        },
      });
    } catch (error) {
      console.error('Start memory game error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
