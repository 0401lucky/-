import { NextRequest, NextResponse } from 'next/server';
import { flipMemoryCard } from '@/lib/memory';
import { withUserRateLimit } from '@/lib/rate-limit';

export const POST = withUserRateLimit(
  'game:submit',
  async (request: NextRequest, user) => {
    try {
      const body = await request.json();
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
      const cardIndex = Number(body?.cardIndex);

      if (!sessionId || !Number.isInteger(cardIndex)) {
        return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
      }

      const result = await flipMemoryCard(user.id, sessionId, cardIndex);
      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, data: result.data });
    } catch (error) {
      console.error('Flip memory card error:', error);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' }
);
