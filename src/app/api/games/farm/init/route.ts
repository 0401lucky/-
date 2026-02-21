// src/app/api/games/farm/init/route.ts - 初始化/获取农场

import { NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { getOrCreateFarm } from '@/lib/farm';
import { getTodayWeather } from '@/lib/farm-engine';
import { getUserPoints, getDailyEarnedPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import { getTodayDateString } from '@/lib/time';
import { applyAutoHarvest } from '@/lib/farm-shop';

export const POST = withUserRateLimit(
  'game:start',
  async (_request, user) => {
    try {
      const [initialFarmState, initialBalance, initialDailyEarned, dailyLimit] = await Promise.all([
        getOrCreateFarm(user.id),
        getUserPoints(user.id),
        getDailyEarnedPoints(user.id),
        getDailyPointsLimit(),
      ]);
      let farmState = initialFarmState;
      let balance = initialBalance;
      let dailyEarned = initialDailyEarned;

      const weather = getTodayWeather(getTodayDateString());

      // 自动收获
      const autoResult = await applyAutoHarvest(farmState, user.id, weather, Date.now());
      farmState = autoResult.farmState;
      if (autoResult.autoHarvestPoints > 0) {
        balance = await getUserPoints(user.id);
        dailyEarned = await getDailyEarnedPoints(user.id);
      }

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
