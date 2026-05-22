import { NextRequest, NextResponse } from 'next/server';
import { stepRogueliteGame } from '@/lib/roguelite';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { RogueliteGameStepPayload } from '@/lib/roguelite';

export const POST = withUserRateLimit(
  'game:submit',
  async (request: NextRequest, user) => {
    try {
      const body = (await request.json()) as RogueliteGameStepPayload;
      const result = await stepRogueliteGame(user.id, body);
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
      console.error('Step roguelite game error:', error);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
