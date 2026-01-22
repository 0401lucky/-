import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { submitGameResult, getDailyStats } from '@/lib/game';
import { getUserPoints } from '@/lib/points';
import type { GameResultSubmit } from '@/lib/types/game';

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

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
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
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
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
