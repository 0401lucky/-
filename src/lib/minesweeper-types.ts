import type {
  MinesweeperAction,
  MinesweeperDifficulty,
  MinesweeperGameState,
  MinesweeperScoreBreakdown,
  MinesweeperStateView,
} from './minesweeper-engine';
import type { GameSessionStatus } from './types/game';

export interface MinesweeperGameSession {
  id: string;
  userId: number;
  gameType: 'minesweeper';
  difficulty: MinesweeperDifficulty;
  seed: string;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
  state: MinesweeperGameState;
  actions: MinesweeperAction[];
}

export interface MinesweeperGameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: 'minesweeper';
  difficulty: MinesweeperDifficulty;
  won: boolean;
  score: number;
  pointsEarned: number;
  duration: number;
  moves: number;
  flagsUsed: number;
  revealedSafe: number;
  mines: number;
  scoreBreakdown: MinesweeperScoreBreakdown;
  createdAt: number;
}

export interface MinesweeperSessionView {
  sessionId: string;
  difficulty: MinesweeperDifficulty;
  startedAt: number;
  expiresAt: number;
  actionsCount: number;
  state: MinesweeperStateView;
  scorePreview?: MinesweeperScoreBreakdown;
  pointRewardPreview?: number;
}
