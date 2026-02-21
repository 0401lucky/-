// src/app/api/games/farm/status/route.ts - 轻量状态查询

import { NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { getFarmState } from '@/lib/farm';
import { getTodayWeather, refreshFarmState } from '@/lib/farm-engine';
import { getUserPoints, getDailyEarnedPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import { getTodayDateString } from '@/lib/time';
import { applyAutoHarvest } from '@/lib/farm-shop';

export const GET = withUserRateLimit(
  'api:default',
  async (_request, user) => {
    try {
      const [initialFarmState, initialBalance, initialDailyEarned, dailyLimit] = await Promise.all([
        getFarmState(user.id),
        getUserPoints(user.id),
        getDailyEarnedPoints(user.id),
        getDailyPointsLimit(),
      ]);
      const farmState = initialFarmState;
      let balance = initialBalance;
      let dailyEarned = initialDailyEarned;

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
      let refreshed = refreshFarmState(farmState, Date.now(), weather);

      // 自动收获
      const autoResult = await applyAutoHarvest(refreshed, user.id, weather, Date.now());
      refreshed = autoResult.farmState;
      if (autoResult.autoHarvestPoints > 0) {
        balance = await getUserPoints(user.id);
        dailyEarned = await getDailyEarnedPoints(user.id);
      }

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
