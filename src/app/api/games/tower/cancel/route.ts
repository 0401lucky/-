import { cancelTowerGame } from '@/lib/tower';
import { createCancelRoute } from '@/lib/game-route-factory';

export const { POST } = createCancelRoute(cancelTowerGame, 'tower game');
