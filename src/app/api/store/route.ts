import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getStoreItems, getExchangeLogs } from '@/lib/store';
import { getUserPoints } from '@/lib/points';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

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
}
