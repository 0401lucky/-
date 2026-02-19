// src/app/api/games/farm/init/route.ts - 初始化/获取农场

import { NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { getOrCreateFarm } from '@/lib/farm';
import { getTodayWeather } from '@/lib/farm-engine';
import { getUserPoints, getDailyEarnedPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import { getTodayDateString } from '@/lib/time';

export const POST = withUserRateLimit(
  'game:start',
  async (_request, user) => {
    try {
      const [farmState, balance, dailyEarned, dailyLimit] = await Promise.all([
        getOrCreateFarm(user.id),
        getUserPoints(user.id),
        getDailyEarnedPoints(user.id),
        getDailyPointsLimit(),
      ]);

      const weather = getTodayWeather(getTodayDateString());

      return NextResponse.json({
        success: true,
        data: {
          farmState,
          weather,
          balance,
          dailyEarned,
          dailyLimit,
          pointsLimitReached: dailyEarned >= dailyLimit,
        },
      });
    } catch (error) {
      console.error('Farm init error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
