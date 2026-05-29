import { getCloudflareContext } from '@opennextjs/cloudflare';
import type {
  MinesweeperGameSession,
  MinesweeperGameStepPayload,
  MinesweeperSessionView,
} from './minesweeper';

type MinesweeperDurableEnv = {
  MINESWEEPER_SESSION_DO?: DurableObjectNamespace;
};

type DurableStepResult = {
  success: boolean;
  session?: MinesweeperSessionView;
  outcome?: unknown;
  message?: string;
  code?: string;
};

type DurableSnapshotResult = {
  success: boolean;
  session?: MinesweeperGameSession;
  message?: string;
  code?: string;
};

function getMinesweeperDurableNamespace(): DurableObjectNamespace | null {
  try {
    const context = getCloudflareContext() as { env?: MinesweeperDurableEnv } | undefined;
    return context?.env?.MINESWEEPER_SESSION_DO ?? null;
  } catch {
    return null;
  }
}

function getStub(sessionId: string): DurableObjectStub | null {
  const namespace = getMinesweeperDurableNamespace();
  if (!namespace || !sessionId) return null;
  return namespace.get(namespace.idFromName(`minesweeper:${sessionId}`));
}

async function postJson<T>(stub: DurableObjectStub, path: string, body: unknown): Promise<T> {
  const response = await stub.fetch(`https://minesweeper-session${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return await response.json() as T;
}

export function hasMinesweeperDurableObjectBinding(): boolean {
  return getMinesweeperDurableNamespace() !== null;
}

export async function initializeMinesweeperDurableSession(session: MinesweeperGameSession): Promise<boolean> {
  const stub = getStub(session.id);
  if (!stub) return false;

  try {
    const result = await postJson<{ success: boolean; message?: string }>(stub, '/init', { session });
    if (!result.success) {
      console.warn('初始化扫雷 Durable Object 会话失败:', result.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error('初始化扫雷 Durable Object 会话异常:', error);
    return false;
  }
}

export async function stepMinesweeperDurableSession(
  userId: number,
  payload: MinesweeperGameStepPayload,
): Promise<DurableStepResult | null> {
  const stub = getStub(payload.sessionId);
  if (!stub) return null;

  try {
    const result = await postJson<DurableStepResult>(stub, '/step', {
      userId,
      sessionId: payload.sessionId,
      action: payload.action,
    });
    return result.code === 'not_initialized' ? null : result;
  } catch (error) {
    console.error('扫雷 Durable Object step 异常，回退原路径:', error);
    return null;
  }
}

export async function getMinesweeperDurableSessionSnapshot(
  userId: number,
  sessionId: string,
): Promise<MinesweeperGameSession | null> {
  const stub = getStub(sessionId);
  if (!stub) return null;

  try {
    const result = await postJson<DurableSnapshotResult>(stub, '/snapshot', { userId, sessionId });
    return result.success && result.session ? result.session : null;
  } catch (error) {
    console.error('读取扫雷 Durable Object 快照异常:', error);
    return null;
  }
}

export async function deleteMinesweeperDurableSession(userId: number, sessionId: string): Promise<void> {
  const stub = getStub(sessionId);
  if (!stub) return;

  try {
    await postJson<{ success: boolean }>(stub, '/delete', { userId, sessionId });
  } catch (error) {
    console.error('删除扫雷 Durable Object 会话异常:', error);
  }
}
