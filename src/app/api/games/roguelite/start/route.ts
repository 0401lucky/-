import { buildRogueliteSessionView, startRogueliteGame } from '@/lib/roguelite';
import { createStartRoute, fail } from '@/lib/game-route-factory';

export const { POST } = createStartRoute(
  async (_request, { user }) => {
    const result = await startRogueliteGame(user.id);
    if (!result.success) {
      return fail(result.message ?? '开始游戏失败');
    }

    return { ...buildRogueliteSessionView(result.session!) };
  },
  { unauthorizedMessage: '请先登录', logLabel: 'roguelite game' },
);
