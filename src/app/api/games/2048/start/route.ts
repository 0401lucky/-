import { buildGame2048SessionView, startGame2048 } from '@/lib/game-2048';
import { createStartRoute, fail } from '@/lib/game-route-factory';

export const { POST } = createStartRoute(
  async (_request, { user }) => {
    const result = await startGame2048(user.id);
    if (!result.success || !result.session) {
      return fail(result.message ?? '开始游戏失败');
    }

    return { ...buildGame2048SessionView(result.session) };
  },
  { logLabel: '2048 game' },
);
