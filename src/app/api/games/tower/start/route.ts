// src/app/api/games/tower/start/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getDailyPointsLimit } from '@/lib/config';
import { getDailyStats, startTowerGame } from '@/lib/tower';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { TowerDifficulty } from '@/lib/tower-engine';

const VALID_DIFFICULTIES: TowerDifficulty[] = ['normal', 'hard', 'hell'];

export const POST = withUserRateLimit(
  'game:start',
  async (request: NextRequest, user) => {
    try {
      // 解析难度参数
      let difficulty: TowerDifficulty | undefined;
      try {
        const body = await request.json();
        if (body?.difficulty) {
          if (VALID_DIFFICULTIES.includes(body.difficulty)) {
            difficulty = body.difficulty;
          } else {
            return NextResponse.json({ success: false, message: '无效的难度选择' }, { status: 400 });
          }
        }
      } catch {
        // 无 body 或解析失败 → 默认无难度（向后兼容）
      }

      const [dailyStats, dailyPointsLimit] = await Promise.all([getDailyStats(user.id), getDailyPointsLimit()]);

      const pointsLimitReached = dailyStats && dailyStats.pointsEarned >= dailyPointsLimit;

      const result = await startTowerGame(user.id, difficulty);
      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: 400 });
      }

      const session = result.session!;
      return NextResponse.json({
        success: true,
        data: {
          sessionId: session.id,
          seed: session.seed,
          startedAt: session.startedAt,
          expiresAt: session.expiresAt,
          difficulty: session.difficulty,
          dailyStats: {
            gamesPlayed: dailyStats.gamesPlayed,
            pointsEarned: dailyStats.pointsEarned,
          },
          dailyLimit: dailyPointsLimit,
          pointsLimitReached,
        },
      });
    } catch (error) {
      console.error('Start tower game error:', error);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' }
);
