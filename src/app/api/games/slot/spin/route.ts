import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { spinSlot, type SlotPlayMode } from '@/lib/slot';
import { recordUser } from '@/lib/kv';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    // 记录/更新用户信息（便于排行榜与管理端展示）
    await recordUser(user.id, user.username);

    let mode: SlotPlayMode = 'earn';
    try {
      const body = await request.json();
      if (body?.mode === 'bet') {
        mode = 'bet';
      }
    } catch {
      // ignore invalid body
    }

    const result = await spinSlot(user.id, mode);

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
