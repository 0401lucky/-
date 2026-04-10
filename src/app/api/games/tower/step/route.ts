import { NextRequest, NextResponse } from 'next/server';
import { stepTowerGame } from '@/lib/tower';
import { withUserRateLimit } from '@/lib/rate-limit';

export const POST = withUserRateLimit(
  'game:submit',
  async (request: NextRequest, user) => {
    try {
      const body = await request.json();

      if (!body?.sessionId || !Number.isInteger(body?.laneIndex)) {
        return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
      }

      const result = await stepTowerGame(user.id, {
        sessionId: body.sessionId,
        laneIndex: body.laneIndex,
      });
      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        data: {
          session: result.session,
          outcome: result.outcome,
        },
      });
    } catch (error) {
      console.error('Step tower game error:', error);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
