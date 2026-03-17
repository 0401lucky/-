// src/app/api/games/farm/status/route.ts - 轻量状态查询

import { NextResponse } from 'next/server';
import { withAuthenticatedUser } from '@/lib/rate-limit';
import { getFarmState } from '@/lib/farm';
import { getTodayWeather } from '@/lib/farm-engine';
import { getUserPoints, getDailyEarnedPoints } from '@/lib/points';
import { getDailyPointsLimit } from '@/lib/config';
import { getTodayDateString } from '@/lib/time';
import { applyAutoHarvest } from '@/lib/farm-shop';

export const GET = withAuthenticatedUser(
  async (_request, user) => {
    try {
      const [initialFarmState, initialBalance, initialDailyEarned, dailyLimit] = await Promise.all([
        getFarmState(user.id),
        getUserPoints(user.id),
        getDailyEarnedPoints(user.id),
        getDailyPointsLimit(),
      ]);
      const farmState = initialFarmState;
      const balance = initialBalance;
      const dailyEarned = initialDailyEarned;

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
      const autoResult = await applyAutoHarvest(farmState, user.id, weather, Date.now());
      const refreshed = autoResult.farmState;
      const latestBalance = autoResult.newBalance ?? balance;
      const latestDailyEarned = autoResult.dailyEarned ?? dailyEarned;
      const pointsLimitReached = autoResult.limitReached ?? latestDailyEarned >= dailyLimit;

      return NextResponse.json({
        success: true,
        data: {
          initialized: true,
          farmState: refreshed,
          weather,
          balance: latestBalance,
          dailyEarned: latestDailyEarned,
          dailyLimit,
          pointsLimitReached,
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
