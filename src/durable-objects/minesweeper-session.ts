import { DurableObject } from 'cloudflare:workers';
import {
  MINESWEEPER_MAX_BATCH_ACTIONS,
  MINESWEEPER_MAX_ACTIONS,
  buildMinesweeperStateView,
  calculateMinesweeperPointReward,
  calculateMinesweeperScore,
  resolveMinesweeperAction,
  resolveMinesweeperActions,
  type MinesweeperAction,
  type MinesweeperActionOutcome,
  type MinesweeperDifficulty,
  type MinesweeperGameState,
  type MinesweeperScoreBreakdown,
  type MinesweeperStateView,
} from '../lib/minesweeper-engine';
import type { GameSessionStatus } from '../lib/types/game';

const GAME_TYPE = 'minesweeper' as const;
const SESSION_STORAGE_KEY = 'session';

interface MinesweeperGameSession {
  id: string;
  userId: number;
  gameType: typeof GAME_TYPE;
  difficulty: MinesweeperDifficulty;
  seed: string;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
  state: MinesweeperGameState;
  actions: MinesweeperAction[];
}

interface MinesweeperSessionView {
  sessionId: string;
  difficulty: MinesweeperDifficulty;
  startedAt: number;
  expiresAt: number;
  actionsCount: number;
  state: MinesweeperStateView;
  scorePreview?: MinesweeperScoreBreakdown;
  pointRewardPreview?: number;
}

type DurableStepResult = {
  success: boolean;
  session?: MinesweeperSessionView;
  outcome?: MinesweeperActionOutcome;
  outcomes?: MinesweeperActionOutcome[];
  skipped?: number;
  message?: string;
  code?: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function normalizeActions(value: unknown): MinesweeperAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter((action): action is MinesweeperAction =>
    Boolean(action) && typeof action === 'object' && typeof (action as { type?: unknown }).type === 'string',
  );
}

function normalizeSession(raw: unknown): MinesweeperGameSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const session = raw as Partial<MinesweeperGameSession>;
  if (
    typeof session.id !== 'string'
    || typeof session.userId !== 'number'
    || session.gameType !== GAME_TYPE
    || typeof session.difficulty !== 'string'
    || typeof session.seed !== 'string'
    || typeof session.startedAt !== 'number'
    || typeof session.expiresAt !== 'number'
    || typeof session.status !== 'string'
    || !session.state
  ) {
    return null;
  }

  return {
    id: session.id,
    userId: session.userId,
    gameType: GAME_TYPE,
    difficulty: session.difficulty as MinesweeperDifficulty,
    seed: session.seed,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    status: session.status as GameSessionStatus,
    state: session.state,
    actions: normalizeActions(session.actions),
  };
}

function normalizePosition(value: unknown): { row: number; col: number } | null {
  if (!value || typeof value !== 'object') return null;
  const position = value as { row?: unknown; col?: unknown };
  if (typeof position.row !== 'number' || typeof position.col !== 'number') return null;
  if (!Number.isInteger(position.row) || !Number.isInteger(position.col)) return null;
  return { row: position.row, col: position.col };
}

function normalizeAction(value: unknown): MinesweeperAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== 'reveal' && raw.type !== 'flag' && raw.type !== 'chord') {
    return null;
  }
  const position = normalizePosition(raw.position);
  return position ? { type: raw.type, position } : null;
}

function normalizeStepActions(value: unknown): MinesweeperAction[] | null {
  if (!Array.isArray(value)) return null;
  const actions: MinesweeperAction[] = [];
  for (const item of value) {
    const action = normalizeAction(item);
    if (!action) return null;
    actions.push(action);
  }
  return actions;
}

function getSessionDuration(session: Pick<MinesweeperGameSession, 'startedAt' | 'state'>): number {
  const endAt = session.state.status === 'playing'
    ? Date.now()
    : (typeof session.state.endedAt === 'number' ? session.state.endedAt : Date.now());
  return Math.max(0, endAt - session.startedAt);
}

function buildSessionView(session: MinesweeperGameSession): MinesweeperSessionView {
  const scorePreview = session.state.status === 'playing'
    ? undefined
    : calculateMinesweeperScore(session.state, getSessionDuration(session));

  return {
    sessionId: session.id,
    difficulty: session.difficulty,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    actionsCount: session.actions.length,
    state: buildMinesweeperStateView(session.state),
    scorePreview,
    pointRewardPreview: scorePreview ? calculateMinesweeperPointReward(scorePreview.total) : undefined,
  };
}

export class MinesweeperSessionDurableObject extends DurableObject {
  private session: MinesweeperGameSession | null | undefined;

  constructor(private readonly state: DurableObjectState, env: unknown) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method !== 'POST') {
      return json({ success: false, message: 'Method Not Allowed' }, 405);
    }

    if (url.pathname === '/init') {
      return this.handleInit(request);
    }
    if (url.pathname === '/step') {
      return this.handleStep(request);
    }
    if (url.pathname === '/step-batch') {
      return this.handleStepBatch(request);
    }
    if (url.pathname === '/snapshot') {
      return this.handleSnapshot(request);
    }
    if (url.pathname === '/delete') {
      return this.handleDelete(request);
    }

    return json({ success: false, message: 'Not Found' }, 404);
  }

  async alarm(): Promise<void> {
    const session = await this.loadSession();
    if (!session || Date.now() <= session.expiresAt + 60_000) return;
    this.session = null;
    await this.state.storage.delete(SESSION_STORAGE_KEY);
  }

  private async readJson(request: Request): Promise<Record<string, unknown>> {
    try {
      const body = await request.json();
      return body && typeof body === 'object' ? body as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  private async loadSession(): Promise<MinesweeperGameSession | null> {
    if (this.session !== undefined) {
      return this.session;
    }

    this.session = normalizeSession(await this.state.storage.get(SESSION_STORAGE_KEY));
    return this.session;
  }

  private async saveSession(session: MinesweeperGameSession): Promise<void> {
    this.session = session;
    await this.state.storage.put(SESSION_STORAGE_KEY, session);
    await this.state.storage.setAlarm(session.expiresAt + 60_000);
  }

  private async handleInit(request: Request): Promise<Response> {
    const body = await this.readJson(request);
    const session = normalizeSession(body.session);
    if (!session) {
      return json({ success: false, message: '无效的扫雷会话' }, 400);
    }

    await this.saveSession(session);
    return json({ success: true });
  }

  private async handleStep(request: Request): Promise<Response> {
    const body = await this.readJson(request);
    const userId = Number(body.userId);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const action = normalizeAction(body.action);

    if (!Number.isSafeInteger(userId) || !sessionId || !action) {
      return json({ success: false, message: '参数错误' }, 400);
    }

    const session = await this.loadSession();
    const precheck = this.validateSession(session, userId, sessionId);
    if (!precheck.success) {
      return json(precheck);
    }
    if (!session) {
      return json({ success: false, message: '游戏会话不存在或已过期', code: 'not_initialized' });
    }
    if (session.actions.length >= MINESWEEPER_MAX_ACTIONS) {
      return json({ success: false, message: '操作次数过多' });
    }

    const resolved = resolveMinesweeperAction(session.state, action);
    if (!resolved.ok) {
      return json({ success: false, message: resolved.message });
    }
    if (resolved.state.status !== 'playing' && typeof resolved.state.endedAt !== 'number') {
      resolved.state.endedAt = Date.now();
    }

    const nextSession: MinesweeperGameSession = {
      ...session,
      state: resolved.state,
      actions: [...session.actions, action],
    };
    await this.saveSession(nextSession);

    return json({
      success: true,
      session: buildSessionView(nextSession),
      outcome: resolved.outcome,
    } satisfies DurableStepResult);
  }

  private async handleStepBatch(request: Request): Promise<Response> {
    const body = await this.readJson(request);
    const userId = Number(body.userId);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const actions = normalizeStepActions(body.actions);

    if (!Number.isSafeInteger(userId) || !sessionId || !actions) {
      return json({ success: false, message: '参数错误' }, 400);
    }
    if (actions.length === 0) {
      return json({ success: false, message: '操作不能为空' }, 400);
    }
    if (actions.length > MINESWEEPER_MAX_BATCH_ACTIONS) {
      return json({ success: false, message: '单次操作过多' }, 400);
    }

    const session = await this.loadSession();
    const precheck = this.validateSession(session, userId, sessionId);
    if (!precheck.success) {
      return json(precheck);
    }
    if (!session) {
      return json({ success: false, message: '游戏会话不存在或已过期', code: 'not_initialized' });
    }
    if (session.actions.length + actions.length > MINESWEEPER_MAX_ACTIONS) {
      return json({ success: false, message: '操作次数过多' });
    }

    const resolved = resolveMinesweeperActions(session.state, actions);
    if (!resolved.ok) {
      return json({ success: false, message: resolved.message });
    }
    if (resolved.state.status !== 'playing' && typeof resolved.state.endedAt !== 'number') {
      resolved.state.endedAt = Date.now();
    }

    const nextSession: MinesweeperGameSession = resolved.appliedActions.length > 0
      ? {
        ...session,
        state: resolved.state,
        actions: [...session.actions, ...resolved.appliedActions],
      }
      : session;
    if (resolved.appliedActions.length > 0) {
      await this.saveSession(nextSession);
    }

    return json({
      success: true,
      session: buildSessionView(nextSession),
      outcome: resolved.outcomes.length > 0 ? resolved.outcomes[resolved.outcomes.length - 1] : undefined,
      outcomes: resolved.outcomes,
      skipped: resolved.skipped,
    } satisfies DurableStepResult);
  }

  private async handleSnapshot(request: Request): Promise<Response> {
    const body = await this.readJson(request);
    const userId = Number(body.userId);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const session = await this.loadSession();
    const precheck = this.validateSession(session, userId, sessionId, { allowEnded: true, allowExpired: true });
    if (!precheck.success) {
      return json(precheck);
    }
    return json({ success: true, session });
  }

  private async handleDelete(request: Request): Promise<Response> {
    const body = await this.readJson(request);
    const userId = Number(body.userId);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const session = await this.loadSession();

    if (session && session.userId === userId && session.id === sessionId) {
      this.session = null;
      await this.state.storage.delete(SESSION_STORAGE_KEY);
      await this.state.storage.deleteAlarm();
    }

    return json({ success: true });
  }

  private validateSession(
    session: MinesweeperGameSession | null,
    userId: number,
    sessionId: string,
    options: { allowEnded?: boolean; allowExpired?: boolean } = {},
  ): DurableStepResult {
    if (!Number.isSafeInteger(userId) || !sessionId) {
      return { success: false, message: '参数错误' };
    }
    if (!session) {
      return { success: false, message: '游戏会话不存在或已过期', code: 'not_initialized' };
    }
    if (session.id !== sessionId) {
      return { success: false, message: '游戏会话已不是当前活跃局', code: 'not_initialized' };
    }
    if (session.userId !== userId) {
      return { success: false, message: '会话不属于该用户' };
    }
    if (!options.allowEnded && session.status !== 'playing') {
      return { success: false, message: '游戏会话已结束' };
    }
    if (!options.allowEnded && session.state.status !== 'playing') {
      return { success: false, message: '游戏会话已结束' };
    }
    if (!options.allowExpired && Date.now() > session.expiresAt) {
      return { success: false, message: '游戏会话已过期', code: 'not_initialized' };
    }
    return { success: true };
  }
}
