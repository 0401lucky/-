import { cancelGame2048 } from '@/lib/game-2048';
import { createCancelRoute } from '@/lib/game-route-factory';

export const { POST } = createCancelRoute(cancelGame2048, '2048 game');
