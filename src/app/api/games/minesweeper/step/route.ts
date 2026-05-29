import { NextRequest, NextResponse } from 'next/server';
import {
  stepMinesweeperGame,
  stepMinesweeperGameBatch,
  type MinesweeperGameStepBatchPayload,
  type MinesweeperGameStepPayload,
  type MinesweeperSessionView,
} from '@/lib/minesweeper';
import { withUserRateLimit } from '@/lib/rate-limit';

type StepRouteResult = {
  success: boolean;
  session?: MinesweeperSessionView;
  outcome?: unknown;
  outcomes?: unknown[];
  skipped?: number;
  message?: string;
};

export const POST = withUserRateLimit('game:action', async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as Partial<MinesweeperGameStepPayload & MinesweeperGameStepBatchPayload>;
    if (!body.sessionId || (!body.action && !body.actions)) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const result: StepRouteResult = Array.isArray(body.actions)
      ? await stepMinesweeperGameBatch(user.id, {
        sessionId: body.sessionId,
        actions: body.actions,
      })
      : await stepMinesweeperGame(user.id, {
        sessionId: body.sessionId,
        action: body.action!,
      });
    if (!result.success) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        session: result.session,
        outcome: result.outcome,
        outcomes: result.outcomes,
        skipped: result.skipped,
      },
    });
  } catch (error) {
    console.error('Step minesweeper game error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
