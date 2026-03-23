// src/app/api/games/farm/shop/purchase/route.ts - 用户购买道具
import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { purchaseFarmShopItem } from '@/lib/farm-shop';

export const POST = withUserRateLimit(
  'farm:action',
  async (request: NextRequest, user) => {
    try {
      const body = await request.json();
      const { itemId, quantity } = body;

      if (typeof itemId !== 'string' || !itemId.trim()) {
        return NextResponse.json(
          { success: false, message: '缺少道具 ID' },
          { status: 400 },
        );
      }

      let parsedQuantity = 1;
      if (quantity !== undefined) {
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
          return NextResponse.json(
            { success: false, message: '购买数量必须是大于 0 的整数' },
            { status: 400 },
          );
        }
        parsedQuantity = quantity;
      }

      const result = await purchaseFarmShopItem(user.id, itemId, undefined, parsedQuantity);

      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message });
      }

      return NextResponse.json({
        success: true,
        data: {
          farmState: result.farmState,
          newBalance: result.newBalance,
          dailyEarned: result.dailyEarned,
          pointsLimitReached: result.limitReached,
        },
      });
    } catch (error) {
      console.error('Farm shop purchase error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
