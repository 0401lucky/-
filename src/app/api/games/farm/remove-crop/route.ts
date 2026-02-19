// src/app/api/games/farm/remove-crop/route.ts - 铲除作物

import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { checkActionCooldown, removeCrop } from '@/lib/farm';

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
      const { plotIndex } = body as { plotIndex?: number };

      if (typeof plotIndex !== 'number' || !Number.isInteger(plotIndex) || plotIndex < 0) {
        return NextResponse.json(
          { success: false, message: '无效的田地索引' },
          { status: 400 },
        );
      }

      const result = await removeCrop(user.id, plotIndex);

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
      console.error('Farm remove-crop error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
