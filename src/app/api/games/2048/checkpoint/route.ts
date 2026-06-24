import { NextRequest, NextResponse } from 'next/server';
import { buildGame2048SessionView, checkpointGame2048, type Game2048CheckpointSubmit } from '@/lib/game-2048';
import { withUserRateLimit } from '@/lib/rate-limit';

export const POST = withUserRateLimit('game:action', async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as Game2048CheckpointSubmit;
    if (!body || typeof body.sessionId !== 'string' || !Array.isArray(body.moves)) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const result = await checkpointGame2048(user.id, body);
    if (!result.success || !result.session) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: buildGame2048SessionView(result.session),
    });
  } catch (error) {
    console.error('Checkpoint 2048 game error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
