// src/app/api/games/farm/water/route.ts - 浇水

import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { checkActionCooldown, waterPlot, waterAllPlots } from '@/lib/farm';

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
      const { plotIndex, waterAll } = body as { plotIndex?: number; waterAll?: boolean };

      if (waterAll) {
        // 一键浇水
        const result = await waterAllPlots(user.id);
        return NextResponse.json({
          success: true,
          data: {
            farmState: result.farmState,
            wateredCount: result.wateredCount,
          },
        });
      }

      if (typeof plotIndex !== 'number' || !Number.isInteger(plotIndex) || plotIndex < 0) {
        return NextResponse.json(
          { success: false, message: '无效的田地索引' },
          { status: 400 },
        );
      }

      const result = await waterPlot(user.id, plotIndex);

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
        },
      });
    } catch (error) {
      console.error('Farm water error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
