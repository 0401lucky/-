import { NextRequest, NextResponse } from 'next/server';
import { stepMinesweeperGame, type MinesweeperGameStepPayload } from '@/lib/minesweeper';
import { withUserRateLimit } from '@/lib/rate-limit';

export const POST = withUserRateLimit('game:submit', async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as MinesweeperGameStepPayload;
    if (!body.sessionId || !body.action) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const result = await stepMinesweeperGame(user.id, body);
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
    console.error('Step minesweeper game error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
