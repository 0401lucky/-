// src/app/api/games/farm/harvest/route.ts - 收获

import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { checkActionCooldown, harvestPlot, harvestAllPlots } from '@/lib/farm';

export const POST = withUserRateLimit(
  'game:submit',
  async (request: NextRequest, user) => {
    try {
      const canAct = await checkActionCooldown(user.id);
      if (!canAct) {
        return NextResponse.json(
          { success: false, message: '操作太频繁，请稍等' },
          { status: 429 },
        );
      }

      const body = await request.json();
      const { plotIndex, harvestAll } = body as { plotIndex?: number; harvestAll?: boolean };

      // 一键收获模式
      if (harvestAll) {
        const result = await harvestAllPlots(user.id);
        return NextResponse.json({
          success: true,
          data: {
            farmState: result.farmState,
            harvests: result.harvests,
            totalPointsEarned: result.totalPointsEarned,
            harvestedCount: result.harvestedCount,
            newBalance: result.newBalance,
            dailyEarned: result.dailyEarned,
            limitReached: result.limitReached,
            expGained: result.expGained,
            levelUp: result.levelUp,
            newLevel: result.newLevel,
          },
        });
      }

      if (typeof plotIndex !== 'number' || !Number.isInteger(plotIndex) || plotIndex < 0) {
        return NextResponse.json(
          { success: false, message: '无效的田地索引' },
          { status: 400 },
        );
      }

      const result = await harvestPlot(user.id, plotIndex);

      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 },
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          farmState: result.farmState,
          harvest: result.harvest,
          pointsEarned: result.pointsEarned,
          newBalance: result.newBalance,
          dailyEarned: result.dailyEarned,
          limitReached: result.limitReached,
          expGained: result.expGained,
          levelUp: result.levelUp,
          newLevel: result.newLevel,
        },
      });
    } catch (error) {
      console.error('Farm harvest error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
