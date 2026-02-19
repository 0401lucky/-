// src/app/api/games/farm/plant/route.ts - 种植作物

import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { checkActionCooldown, plantCrop } from '@/lib/farm';
import { CROPS } from '@/lib/farm-config';
import type { CropId } from '@/lib/types/farm';

export const POST = withUserRateLimit(
  'game:submit',
  async (request: NextRequest, user) => {
    try {
      // 冷却检查
      const canAct = await checkActionCooldown(user.id);
      if (!canAct) {
        return NextResponse.json(
          { success: false, message: '操作太频繁，请稍等' },
          { status: 429 },
        );
      }

      const body = await request.json();
      const { plotIndex, cropId } = body as { plotIndex?: number; cropId?: string };

      if (typeof plotIndex !== 'number' || !Number.isInteger(plotIndex) || plotIndex < 0) {
        return NextResponse.json(
          { success: false, message: '无效的田地索引' },
          { status: 400 },
        );
      }

      if (!cropId || !CROPS[cropId as CropId]) {
        return NextResponse.json(
          { success: false, message: '无效的作物类型' },
          { status: 400 },
        );
      }

      const result = await plantCrop(user.id, plotIndex, cropId as CropId);

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
          newBalance: result.newBalance,
        },
      });
    } catch (error) {
      console.error('Farm plant error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
