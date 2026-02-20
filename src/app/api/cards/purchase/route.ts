import { NextResponse } from 'next/server';
import { kv } from '@/lib/d1-kv';
import { getAuthUser } from '@/lib/auth';
import { CARD_DRAW_PRICE } from '@/lib/cards/constants';
import { nanoid } from 'nanoid';
import type { PointsLog } from '@/lib/types/store';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export async function POST() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  // 速率限制检查
  const rateLimitResult = await checkRateLimit(user.id.toString(), {
    prefix: "ratelimit:cards:purchase",
  });
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult);
  }

  const userId = user.id;
  const pointsKey = `points:${userId}`;
  const cardsKey = `cards:user:${userId}`;
  const amount = CARD_DRAW_PRICE;
  const drawAward = 1;

  try {
    // 1. Check points balance
    const currentPoints = Number(await kv.get<number>(pointsKey)) || 0;
    if (currentPoints < amount) {
      return NextResponse.json({
        success: false,
        message: '积分不足',
        balance: currentPoints,
      });
    }

    // 2. Deduct points
    const newBalance = await kv.decrby(pointsKey, amount);

    // 3. Award draws - get current card data or initialize
    const cardData = await kv.get<Record<string, unknown>>(cardsKey) ?? {
      inventory: [],
      fragments: 0,
      pityCounter: 0,
      drawsAvailable: 1,
      collectionRewards: [],
    };
    const currentDraws = Number(cardData.drawsAvailable) || 0;
    cardData.drawsAvailable = currentDraws + drawAward;
    await kv.set(cardsKey, cardData);

    const drawsAvailable = cardData.drawsAvailable;

    // Record points log
    const log: PointsLog = {
      id: nanoid(),
      amount: -amount,
      source: 'exchange',
      description: `购买动物卡抽卡次数 x${drawAward}`,
      balance: newBalance,
      createdAt: Date.now(),
    };

    const logKey = `points_log:${userId}`;
    await kv.lpush(logKey, log);
    await kv.ltrim(logKey, 0, 99);

    return NextResponse.json({
      success: true,
      message: `成功购买 ${drawAward} 次抽卡机会`,
      newBalance,
      drawsAvailable
    });
  } catch (error) {
    console.error('Purchase card draw error:', error);
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}
