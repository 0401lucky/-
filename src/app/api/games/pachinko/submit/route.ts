import { NextResponse } from 'next/server';
import { submitGameResult, getDailyStats } from '@/lib/game';
import { getUserPoints } from '@/lib/points';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { GameResultSubmit } from '@/lib/types/game';

export const POST = withUserRateLimit('game:submit', async (request: Request, user) => {
  try {
    const body = await request.json();
    
    const result: GameResultSubmit = {
      sessionId: body.sessionId,
      score: body.score,
      duration: body.duration,
      balls: body.balls || [],
    };

    // 验证必要字段
    if (!result.sessionId || typeof result.score !== 'number') {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const submitResult = await submitGameResult(user.id, result);

    if (!submitResult.success) {
      return NextResponse.json({
        success: false,
        message: submitResult.message,
      }, { status: 400 });
    }

    // 获取最新状态
    const [newBalance, dailyStats] = await Promise.all([
      getUserPoints(user.id),
      getDailyStats(user.id),
    ]);

    return NextResponse.json({
      success: true,
      message: submitResult.message,
      data: {
        record: submitResult.record,
        pointsEarned: submitResult.record?.pointsEarned || 0,
        newBalance,
        dailyStats,
      },
    });
  } catch (error) {
    console.error('Submit game error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
