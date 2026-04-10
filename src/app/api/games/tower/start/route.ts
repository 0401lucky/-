// src/app/api/games/tower/start/route.ts

import { buildTowerSessionView, startTowerGame } from '@/lib/tower';
import { createStartRoute, fail } from '@/lib/game-route-factory';
import type { TowerDifficulty } from '@/lib/tower-engine';

const VALID_DIFFICULTIES: TowerDifficulty[] = ['normal', 'hard', 'hell'];

export const { POST } = createStartRoute(
  async (request, { user }) => {
    // 解析难度参数（可选）
    let difficulty: TowerDifficulty | undefined;
    try {
      const body = await request.json();
      if (body?.difficulty) {
        if (VALID_DIFFICULTIES.includes(body.difficulty)) {
          difficulty = body.difficulty;
        } else {
          return fail('无效的难度选择');
        }
      }
    } catch {
      // 无 body 或解析失败 → 默认无难度（向后兼容）
    }

    const result = await startTowerGame(user.id, difficulty);
    if (!result.success) {
      return fail(result.message ?? '开始游戏失败');
    }

    const session = result.session!;
    return { ...buildTowerSessionView(session) };
  },
  { unauthorizedMessage: '请先登录', logLabel: 'tower game' },
);
