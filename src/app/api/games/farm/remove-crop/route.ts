// src/app/api/games/farm/remove-crop/route.ts - 铲除作物

import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { removeCrop, removeAllWitheredCrops } from '@/lib/farm';
import { getTodayWeather } from '@/lib/farm-engine';
import { getTodayDateString } from '@/lib/time';

export const POST = withUserRateLimit(
  'farm:action',
  async (request: NextRequest, user) => {
    try {
      const body = (await request.json().catch(() => null)) as { plotIndex?: number; removeAllWithered?: boolean } | null;
      if (!body || typeof body !== 'object') {
        return NextResponse.json(
          { success: false, message: '请求体格式错误' },
          { status: 400 },
        );
      }
      const { plotIndex, removeAllWithered } = body;
      const weather = getTodayWeather(getTodayDateString());

      // 一键铲除枯萎作物模式
      if (removeAllWithered) {
        const result = await removeAllWitheredCrops(user.id);
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
            removedCount: result.removedCount,
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
          weather,
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
