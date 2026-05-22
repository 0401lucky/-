import { cancelWhackMoleGame } from '@/lib/whack-mole';
import { createCancelRoute } from '@/lib/game-route-factory';

export const { POST } = createCancelRoute(cancelWhackMoleGame, 'whack mole game');
