import { cancelLinkGame } from '@/lib/linkgame-server';
import { createCancelRoute } from '@/lib/game-route-factory';

export const { POST } = createCancelRoute(cancelLinkGame, 'linkgame');
