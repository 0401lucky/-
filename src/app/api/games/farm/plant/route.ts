// src/app/api/games/farm/plant/route.ts - 种植作物

import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { plantCrop } from '@/lib/farm';
import { CROPS } from '@/lib/farm-config';
import { getTodayWeather } from '@/lib/farm-engine';
import { getTodayDateString } from '@/lib/time';
import type { CropId } from '@/lib/types/farm';

export const POST = withUserRateLimit(
  'game:submit',
  async (request: NextRequest, user) => {
    try {
      const body = (await request.json().catch(() => null)) as { plotIndex?: number; cropId?: string } | null;
      if (!body || typeof body !== 'object') {
        return NextResponse.json(
          { success: false, message: '请求体格式错误' },
          { status: 400 },
        );
      }
      const { plotIndex, cropId } = body;

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

      const weather = getTodayWeather(getTodayDateString());

      return NextResponse.json({
        success: true,
        data: {
          farmState: result.farmState,
          newBalance: result.newBalance,
          weather,
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
