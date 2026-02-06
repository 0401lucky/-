import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
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

  // Lua script to atomically deduct points and increment drawsAvailable
  const luaScript = `
    local pointsKey = KEYS[1]
    local cardsKey = KEYS[2]
    local amount = tonumber(ARGV[1])
    local drawAward = tonumber(ARGV[2])

    -- 1. Check points balance
    local currentPoints = tonumber(redis.call('GET', pointsKey) or '0')
    if currentPoints < amount then
      return {0, currentPoints}
    end

    -- 2. Deduct points
    local newBalance = redis.call('DECRBY', pointsKey, amount)

    -- 3. Award draws
    -- Get current card data or initialize
    local cardDataJson = redis.call('GET', cardsKey)
    local cardData = {}
    
    if cardDataJson then
      cardData = cjson.decode(cardDataJson)
    else
      cardData = {
        inventory = {},
        fragments = 0,
        pityCounter = 0,
        drawsAvailable = 1, -- Default initial draws
        collectionRewards = {}
      }
    end

    cardData.drawsAvailable = (cardData.drawsAvailable or 0) + drawAward
    
    local newCardDataJson = cjson.encode(cardData)
    redis.call('SET', cardsKey, newCardDataJson)

    return {1, newBalance, cardData.drawsAvailable}
  `;

  try {
    const result = await kv.eval(luaScript, [pointsKey, cardsKey], [amount, drawAward]) as [number, number, number];
    const [success, balance, drawsAvailable] = result;

    if (success === 0) {
      return NextResponse.json({ 
        success: false, 
        message: '积分不足', 
        balance 
      });
    }

    // Record points log
    const log: PointsLog = {
      id: nanoid(),
      amount: -amount,
      source: 'exchange',
      description: `购买动物卡抽卡次数 x${drawAward}`,
      balance,
      createdAt: Date.now(),
    };

    const logKey = `points_log:${userId}`;
    await kv.lpush(logKey, log);
    await kv.ltrim(logKey, 0, 99);

    return NextResponse.json({
      success: true,
      message: `成功购买 ${drawAward} 次抽卡机会`,
      newBalance: balance,
      drawsAvailable
    });
  } catch (error) {
    console.error('Purchase card draw error:', error);
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}
