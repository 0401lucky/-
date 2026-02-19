import { cancelMemoryGame } from '@/lib/memory';
import { createCancelRoute } from '@/lib/game-route-factory';

export const { POST } = createCancelRoute(cancelMemoryGame, 'memory game');
