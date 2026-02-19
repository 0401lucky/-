// src/app/api/games/farm/shop/route.ts - 用户获取道具商品列表
import { NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { getAllFarmShopItems } from '@/lib/farm-shop';
import { getOrCreateFarm } from '@/lib/farm';

export const GET = withUserRateLimit(
  'api:default',
  async (_request, user) => {
    try {
      const [items, farmState] = await Promise.all([
        getAllFarmShopItems(),
        getOrCreateFarm(user.id),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          items,
          activeBuffs: farmState.activeBuffs ?? [],
          inventory: farmState.inventory ?? {},
        },
      });
    } catch (error) {
      console.error('Farm shop list error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
