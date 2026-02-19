import { cancelMatch3Game } from '@/lib/match3';
import { createCancelRoute } from '@/lib/game-route-factory';

export const { POST } = createCancelRoute(cancelMatch3Game, 'match3 game');
