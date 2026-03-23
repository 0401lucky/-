// src/app/api/games/farm/remove-pest/route.ts - 除虫

import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { removePest } from '@/lib/farm';
import { getTodayWeather } from '@/lib/farm-engine';
import { getTodayDateString } from '@/lib/time';

export const POST = withUserRateLimit(
  'farm:action',
  async (request: NextRequest, user) => {
    try {
      const body = (await request.json().catch(() => null)) as { plotIndex?: number } | null;
      if (!body || typeof body !== 'object') {
        return NextResponse.json(
          { success: false, message: '请求体格式错误' },
          { status: 400 },
        );
      }
      const { plotIndex } = body;

      if (typeof plotIndex !== 'number' || !Number.isInteger(plotIndex) || plotIndex < 0) {
        return NextResponse.json(
          { success: false, message: '无效的田地索引' },
          { status: 400 },
        );
      }

      const result = await removePest(user.id, plotIndex);

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
          weather,
        },
      });
    } catch (error) {
      console.error('Farm remove-pest error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
