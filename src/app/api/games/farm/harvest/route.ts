// src/app/api/games/farm/harvest/route.ts - 收获

import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { checkActionCooldown, harvestPlot, harvestAllPlots } from '@/lib/farm';
import { getTodayWeather } from '@/lib/farm-engine';
import { getTodayDateString } from '@/lib/time';

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

      const body = (await request.json().catch(() => null)) as { plotIndex?: number; harvestAll?: boolean } | null;
      if (!body || typeof body !== 'object') {
        return NextResponse.json(
          { success: false, message: '请求体格式错误' },
          { status: 400 },
        );
      }
      const { plotIndex, harvestAll } = body;
      const weather = getTodayWeather(getTodayDateString());

      // 一键收获模式
      if (harvestAll) {
        const result = await harvestAllPlots(user.id);
        if (!result.success) {
          return NextResponse.json(
            { success: false, message: '操作失败，请稍后重试' },
            { status: 400 },
          );
        }
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
            pointsLimitReached: result.limitReached,
            expGained: result.expGained,
            levelUp: result.levelUp,
            newLevel: result.newLevel,
            weather,
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
          pointsLimitReached: result.limitReached,
          expGained: result.expGained,
          levelUp: result.levelUp,
          newLevel: result.newLevel,
          weather,
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
