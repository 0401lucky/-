import { cancelGame } from '@/lib/game';
import { createCancelRoute } from '@/lib/game-route-factory';

export const { POST } = createCancelRoute(cancelGame, 'game');
