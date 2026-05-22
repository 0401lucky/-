import { buildMinesweeperSessionView, startMinesweeperGame } from '@/lib/minesweeper';
import { MINESWEEPER_DIFFICULTY_CONFIG, type MinesweeperDifficulty } from '@/lib/minesweeper-engine';
import { createStartRoute, fail } from '@/lib/game-route-factory';

function normalizeDifficulty(value: unknown): MinesweeperDifficulty | null {
  return typeof value === 'string' && value in MINESWEEPER_DIFFICULTY_CONFIG
    ? value as MinesweeperDifficulty
    : null;
}

export const { POST } = createStartRoute(
  async (request, { user }) => {
    let difficulty: MinesweeperDifficulty = 'easy';
    let restartActive = false;
    try {
      const body = await request.json();
      difficulty = normalizeDifficulty(body?.difficulty) ?? 'easy';
      restartActive = body?.restart === true;
    } catch {
      // 无 body 时默认简单难度
    }

    const result = await startMinesweeperGame(user.id, difficulty, { restartActive });
    if (!result.success) {
      return fail(result.message ?? '开始游戏失败');
    }

    return { ...buildMinesweeperSessionView(result.session!) };
  },
  { unauthorizedMessage: '请先登录', logLabel: 'minesweeper game' },
);
