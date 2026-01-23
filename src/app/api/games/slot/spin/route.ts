import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { spinSlot } from '@/lib/slot';

export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const result = await spinSlot(user.id);

    if (!result.success) {
      const status = result.cooldownRemaining ? 429 : 400;
      return NextResponse.json(
        { success: false, message: result.message, cooldownRemaining: result.cooldownRemaining ?? 0 },
        { status }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Spin slot error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

