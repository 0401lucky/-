import { cancelMinesweeperGame } from '@/lib/minesweeper';
import { createCancelRoute } from '@/lib/game-route-factory';

export const { POST } = createCancelRoute(cancelMinesweeperGame, 'minesweeper game');
