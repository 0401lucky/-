import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { getShopItems, getFarmStatus } from '@/lib/farm-v2';

export const GET = withUserRateLimit(
  'farm:action',
  async (_req: NextRequest, user) => {
    try {
      const items = await getShopItems();
      const status = await getFarmStatus(user.id);
      return NextResponse.json({
        success: true,
        data: {
          items,
          inventory: status.state.inventory,
          balance: status.state.points,
          scarecrowUntil: status.state.scarecrowUntil,
          bellUntil: status.state.bellUntil,
        },
      });
    } catch (e) {
      console.error('farm v2 shop list error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
