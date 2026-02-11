import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getUserPoints, getPointsLogs } from '@/lib/points';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  const [balance, logs] = await Promise.all([
    getUserPoints(user.id),
    getPointsLogs(user.id, 20),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      balance,
      logs,
    },
  });
}
