// src/app/api/games/farm/shop/use-item/route.ts - 用户使用即时道具
import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { checkActionCooldown } from '@/lib/farm';
import { useInstantItem } from '@/lib/farm-shop';

export const POST = withUserRateLimit(
  'game:submit',
  async (request: NextRequest, user) => {
    try {
      // 冷却检查
      const canAct = await checkActionCooldown(user.id);
      if (!canAct) {
        return NextResponse.json(
          { success: false, message: '操作太快，请稍后再试' },
          { status: 429 },
        );
      }

      const body = await request.json();
      const { itemId, plotIndex } = body;

      if (typeof itemId !== 'string' || !itemId.trim()) {
        return NextResponse.json(
          { success: false, message: '缺少道具 ID' },
          { status: 400 },
        );
      }

      let parsedPlotIndex: number | undefined;
      if (plotIndex !== undefined) {
        if (typeof plotIndex !== 'number' || !Number.isInteger(plotIndex)) {
          return NextResponse.json(
            { success: false, message: 'plotIndex 必须是整数' },
            { status: 400 },
          );
        }
        parsedPlotIndex = plotIndex;
      }

      const result = await useInstantItem(user.id, itemId, undefined, parsedPlotIndex);

      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message });
      }

      return NextResponse.json({
        success: true,
        data: {
          farmState: result.farmState,
        },
      });
    } catch (error) {
      console.error('Farm shop use-item error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
