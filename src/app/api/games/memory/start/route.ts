// src/app/api/games/memory/start/route.ts

import {
  startMemoryGame,
  DIFFICULTY_CONFIG,
  buildMemorySessionView,
} from '@/lib/memory';
import { createStartRoute, fail } from '@/lib/game-route-factory';
import type { MemoryDifficulty } from '@/lib/types/game';

export const { POST } = createStartRoute(
  async (request, { user }) => {
    const body = await request.json();
    const difficulty = body.difficulty as MemoryDifficulty;

    if (!difficulty || !DIFFICULTY_CONFIG[difficulty]) {
      return fail('无效的难度选择');
    }

    const result = await startMemoryGame(user.id, difficulty);
    if (!result.success) {
      return fail(result.message ?? '开始游戏失败');
    }

    return {
      sessionId: result.session!.id,
      difficulty: result.session!.difficulty,
      ...buildMemorySessionView(result.session!),
      expiresAt: result.session!.expiresAt,
      config: DIFFICULTY_CONFIG[difficulty],
    };
  },
  { logLabel: 'memory game' },
);
