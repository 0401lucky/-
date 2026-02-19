// src/app/api/games/farm/status/route.ts - 轻量状态查询

import { NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { getFarmState } from '@/lib/farm';
import { getTodayWeather, refreshFarmState } from '@/lib/farm-engine';
import { getUserPoints, getDailyEarnedPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import { getTodayDateString } from '@/lib/time';

export const GET = withUserRateLimit(
  'api:default',
  async (_request, user) => {
    try {
      const [farmState, balance, dailyEarned, dailyLimit] = await Promise.all([
        getFarmState(user.id),
        getUserPoints(user.id),
        getDailyEarnedPoints(user.id),
        getDailyPointsLimit(),
      ]);

      if (!farmState) {
        return NextResponse.json({
          success: true,
          data: {
            initialized: false,
            balance,
            dailyEarned,
            dailyLimit,
            pointsLimitReached: dailyEarned >= dailyLimit,
          },
        });
      }

      const weather = getTodayWeather(getTodayDateString());
      const refreshed = refreshFarmState(farmState, Date.now(), weather);

      return NextResponse.json({
        success: true,
        data: {
          initialized: true,
          farmState: refreshed,
          weather,
          balance,
          dailyEarned,
          dailyLimit,
          pointsLimitReached: dailyEarned >= dailyLimit,
        },
      });
    } catch (error) {
      console.error('Farm status error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
