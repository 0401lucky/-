import { NextRequest, NextResponse } from 'next/server';
import { settleMemoryFallback } from '@/lib/memory';
import { settleMatch3Fallback, type Match3GameResultSubmit } from '@/lib/match3';
import { settleLinkGameFallback } from '@/lib/linkgame-server';
import { settleMinesweeperFallback, type MinesweeperGameResultSubmit } from '@/lib/minesweeper';
import { settleRogueliteFallback, type RogueliteGameResultSubmit } from '@/lib/roguelite';
import { settleWhackMoleFallback, type WhackMoleResultSubmit } from '@/lib/whack-mole';
import { settleGame2048Fallback, type Game2048ResultSubmit } from '@/lib/game-2048';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { LinkGameResultSubmit, MemoryGameResultSubmit } from '@/lib/types/game';
import type { GameFallbackKey } from '@/lib/game-fallback';

type FallbackBody = {
  game?: GameFallbackKey;
  sessionId?: string;
} & Record<string, unknown>;

function isFallbackGame(value: unknown): value is GameFallbackKey {
  return value === '2048'
    || value === 'memory'
    || value === 'match3'
    || value === 'linkgame'
    || value === 'minesweeper'
    || value === 'roguelite'
    || value === 'whack-mole';
}

export const POST = withUserRateLimit('game:submit', async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as FallbackBody;
    if (!isFallbackGame(body.game) || typeof body.sessionId !== 'string' || body.sessionId.trim() === '') {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const payload = { ...body, sessionId: body.sessionId.trim() };
    const result = await (async () => {
      switch (body.game) {
        case '2048':
          return settleGame2048Fallback(user.id, payload as Game2048ResultSubmit);
        case 'memory':
          return settleMemoryFallback(user.id, payload as Pick<MemoryGameResultSubmit, 'sessionId'>);
        case 'match3':
          return settleMatch3Fallback(user.id, payload as Match3GameResultSubmit);
        case 'linkgame':
          return settleLinkGameFallback(user.id, payload as LinkGameResultSubmit);
        case 'minesweeper':
          return settleMinesweeperFallback(user.id, payload as MinesweeperGameResultSubmit);
        case 'roguelite':
          return settleRogueliteFallback(user.id, payload as RogueliteGameResultSubmit);
        case 'whack-mole':
          return settleWhackMoleFallback(user.id, payload as WhackMoleResultSubmit);
        default:
          return { success: false, message: '参数错误' };
      }
    })();

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
          adminInsufficient: result.adminInsufficient === true,
        },
        { status: result.adminInsufficient ? 409 : 400 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        record: result.record,
        pointsEarned: result.pointsEarned,
        fallback: true,
      },
    });
  } catch (error) {
    console.error('Game fallback settlement error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
