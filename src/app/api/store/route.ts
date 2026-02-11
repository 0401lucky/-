import { NextResponse } from 'next/server';
import { getStoreItems, getExchangeLogs } from '@/lib/store';
import { getUserPoints } from '@/lib/points';
import { withAuth } from '@/lib/api-guards';

export const GET = withAuth(
  async (_request, user) => {
    const [items, balance, recentExchanges] = await Promise.all([
      getStoreItems(),
      getUserPoints(user.id),
      getExchangeLogs(user.id, 10),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        items,
        balance,
        recentExchanges,
      },
    });
  },
  { unauthorizedMessage: '未登录' }
);
