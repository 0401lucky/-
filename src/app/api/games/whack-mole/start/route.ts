import { buildWhackMoleSessionView, startWhackMoleGame } from '@/lib/whack-mole';
import { createStartRoute, fail } from '@/lib/game-route-factory';
import { normalizeWhackMoleDifficulty } from '@/lib/whack-mole-engine';

export const { POST } = createStartRoute(
  async (request, { user }) => {
    let restartActive = false;
    let difficulty = normalizeWhackMoleDifficulty(undefined);
    try {
      const body = await request.json();
      restartActive = body?.restart === true;
      difficulty = normalizeWhackMoleDifficulty(body?.difficulty);
    } catch {
      // 无 body 时按普通开局处理
    }

    const result = await startWhackMoleGame(user.id, { restartActive, difficulty });
    if (!result.success) {
      return fail(result.message ?? '开始游戏失败');
    }

    const session = result.session!;
    return { ...buildWhackMoleSessionView(session) };
  },
  { logLabel: 'whack mole game' },
);
