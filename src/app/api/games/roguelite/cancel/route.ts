import { cancelRogueliteGame } from '@/lib/roguelite';
import { createCancelRoute } from '@/lib/game-route-factory';

export const { POST } = createCancelRoute(cancelRogueliteGame, 'roguelite game');
