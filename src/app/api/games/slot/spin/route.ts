import { NextRequest, NextResponse } from 'next/server';
import { spinSlot, type SlotPlayMode } from '@/lib/slot';
import { recordUser } from '@/lib/kv';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = withUserRateLimit('slot:spin', async (request: NextRequest, user) => {
  try {
    // 记录/更新用户信息（便于排行榜与管理端展示）
    await recordUser(user.id, user.username);

    let mode: SlotPlayMode = 'earn';
    let betCost: number | undefined;
    try {
      const body = await request.json();
      if (body?.mode === 'bet') {
        mode = 'bet';
      }
      if (body?.betCost !== undefined) {
        const parsed = Number(body.betCost);
        if (Number.isFinite(parsed)) {
          betCost = parsed;
        }
      }
    } catch {
      // ignore invalid body
    }

    const result = await spinSlot(user.id, mode, betCost);

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
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
