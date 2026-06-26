import type {
  RogueliteAction,
  RogueliteGameState,
  RogueliteScoreBreakdown,
  RogueliteStateView,
} from './roguelite-engine';
import type { GameSessionStatus } from './types/game';

export interface RogueliteGameSession {
  id: string;
  userId: number;
  gameType: 'roguelite';
  seed: string;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
  state: RogueliteGameState;
  actions: RogueliteAction[];
  actionCount?: number;
  moveCount?: number;
}

export interface RogueliteGameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: 'roguelite';
  won: boolean;
  finalFloor: number;
  floorsCleared: number;
  score: number;
  pointsEarned: number;
  stardust: number;
  hpRemaining: number;
  relics: number;
  monstersDefeated: number;
  chestsOpened: number;
  stepsUsed: number;
  duration: number;
  scoreBreakdown: RogueliteScoreBreakdown;
  createdAt: number;
}

export interface RogueliteSessionView {
  sessionId: string;
  startedAt: number;
  expiresAt: number;
  actionsCount: number;
  state: RogueliteStateView;
}
