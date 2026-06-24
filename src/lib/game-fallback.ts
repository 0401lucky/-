import { nanoid } from 'nanoid';
import { kv } from '@/lib/d1-kv';
import { getAllUsers } from './kv';
import { getUserPoints, applyPointsDeltaInsideUserEconomyLock } from './points';
import { withKvLock, withUserEconomyLock } from './economy-lock';

export const GAME_FALLBACK_ADMIN_USERNAME = 'cian';
export const GAME_FALLBACK_ADMIN_EMPTY_MESSAGE = '请立刻告诉管理员，管理员账户没钱了';

export type GameFallbackKey =
  | '2048'
  | 'memory'
  | 'match3'
  | 'linkgame'
  | 'minesweeper'
  | 'roguelite'
  | 'whack-mole';

interface GameFallbackTransferRecord {
  id: string;
  gameKey: GameFallbackKey;
  sessionId: string;
  userId: number;
  adminUserId?: number;
  adminUsername: string;
  score: number;
  pointsEarned: number;
  pointReward: number;
  description: string;
  createdAt: number;
}

export interface GameFallbackTransferInput {
  gameKey: GameFallbackKey;
  sessionId: string;
  userId: number;
  score: number;
  pointReward: number;
  gameName: string;
  resultLabel: string;
}

export interface GameFallbackTransferSuccess {
  success: true;
  pointsEarned: number;
  adminUserId?: number;
  alreadySettled: boolean;
}

export interface GameFallbackTransferFailure {
  success: false;
  message: string;
  adminInsufficient?: boolean;
}

export type GameFallbackTransferResult =
  | GameFallbackTransferSuccess
  | GameFallbackTransferFailure;

const FALLBACK_SETTLEMENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const FALLBACK_LOCK_TTL_SECONDS = 20;
const FALLBACK_LOCK_MAX_RETRIES = 80;
const FALLBACK_LOCK_RETRY_MS = 50;

const FALLBACK_SETTLEMENT_KEY = (gameKey: GameFallbackKey, sessionId: string) =>
  `game:fallback:settlement:${gameKey}:${sessionId}`;

const FALLBACK_LOCK_KEY = (gameKey: GameFallbackKey, sessionId: string) =>
  `game:fallback:lock:${gameKey}:${sessionId}`;

function normalizeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer`);
  }
  return value;
}

async function findFallbackAdminUser(): Promise<{ id: number; username: string } | null> {
  const users = await getAllUsers();
  return users.find(
    (user) => user.username.toLowerCase() === GAME_FALLBACK_ADMIN_USERNAME,
  ) ?? null;
}

async function withOrderedUserLocks<T>(
  firstUserId: number,
  secondUserId: number,
  handler: () => Promise<T>,
): Promise<T> {
  if (firstUserId === secondUserId) {
    return withUserEconomyLock(firstUserId, handler, {
      maxRetries: 80,
      retryMs: 50,
      timeoutMessage: 'GAME_FALLBACK_USER_LOCK_TIMEOUT',
    });
  }

  const [lowerUserId, higherUserId] = [firstUserId, secondUserId].sort((a, b) => a - b);
  return withUserEconomyLock(lowerUserId, async () => (
    withUserEconomyLock(higherUserId, handler, {
      maxRetries: 80,
      retryMs: 50,
      timeoutMessage: 'GAME_FALLBACK_USER_LOCK_TIMEOUT',
    })
  ), {
    maxRetries: 80,
    retryMs: 50,
    timeoutMessage: 'GAME_FALLBACK_USER_LOCK_TIMEOUT',
  });
}

async function saveFallbackTransferRecord(record: GameFallbackTransferRecord): Promise<void> {
  await kv.set(FALLBACK_SETTLEMENT_KEY(record.gameKey, record.sessionId), record, {
    ex: FALLBACK_SETTLEMENT_TTL_SECONDS,
  });
}

export async function settleGameFallbackTransfer(
  input: GameFallbackTransferInput,
): Promise<GameFallbackTransferResult> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    return { success: false, message: '无效的会话ID' };
  }

  const score = normalizeSafeInteger(Math.max(0, Math.floor(input.score)), 'score');
  const pointReward = normalizeSafeInteger(
    Math.max(0, Math.floor(input.pointReward)),
    'pointReward',
  );
  const settlementKey = FALLBACK_SETTLEMENT_KEY(input.gameKey, sessionId);

  return withKvLock(
    FALLBACK_LOCK_KEY(input.gameKey, sessionId),
    async () => {
      const existing = await kv.get<GameFallbackTransferRecord>(settlementKey);
      if (existing) {
        return {
          success: true,
          pointsEarned: existing.pointsEarned,
          adminUserId: existing.adminUserId,
          alreadySettled: true,
        };
      }

      const description = `${input.gameName}${input.resultLabel}得分 ${score}，福利积分 ${pointReward}`;

      if (pointReward <= 0) {
        await saveFallbackTransferRecord({
          id: nanoid(),
          gameKey: input.gameKey,
          sessionId,
          userId: input.userId,
          adminUsername: GAME_FALLBACK_ADMIN_USERNAME,
          score,
          pointsEarned: 0,
          pointReward,
          description,
          createdAt: Date.now(),
        });
        return { success: true, pointsEarned: 0, alreadySettled: false };
      }

      const admin = await findFallbackAdminUser();
      if (!admin) {
        return {
          success: false,
          adminInsufficient: true,
          message: GAME_FALLBACK_ADMIN_EMPTY_MESSAGE,
        };
      }

      return withOrderedUserLocks(admin.id, input.userId, async () => {
        const adminBalance = await getUserPoints(admin.id);
        if (adminBalance < pointReward) {
          return {
            success: false,
            adminInsufficient: true,
            message: GAME_FALLBACK_ADMIN_EMPTY_MESSAGE,
          };
        }

        const outDescription = `游戏兜底转出：${description}，用户 ${input.userId}，session ${sessionId}`;
        const inDescription = `游戏兜底到账：${description}，来自管理员 ${admin.username}`;

        const deductResult = await applyPointsDeltaInsideUserEconomyLock(
          admin.id,
          -pointReward,
          'admin_adjust',
          outDescription,
        );
        if (!deductResult.success) {
          return {
            success: false,
            adminInsufficient: true,
            message: GAME_FALLBACK_ADMIN_EMPTY_MESSAGE,
          };
        }

        try {
          const addResult = await applyPointsDeltaInsideUserEconomyLock(
            input.userId,
            pointReward,
            'admin_adjust',
            inDescription,
          );
          if (!addResult.success) {
            throw new Error(addResult.message ?? '游戏兜底到账失败');
          }
        } catch (error) {
          await applyPointsDeltaInsideUserEconomyLock(
            admin.id,
            pointReward,
            'admin_adjust',
            `游戏兜底回滚：${description}，用户 ${input.userId}，session ${sessionId}`,
          );
          throw error;
        }

        await saveFallbackTransferRecord({
          id: nanoid(),
          gameKey: input.gameKey,
          sessionId,
          userId: input.userId,
          adminUserId: admin.id,
          adminUsername: admin.username,
          score,
          pointsEarned: pointReward,
          pointReward,
          description,
          createdAt: Date.now(),
        });

        return {
          success: true,
          pointsEarned: pointReward,
          adminUserId: admin.id,
          alreadySettled: false,
        };
      });
    },
    {
      ttlSeconds: FALLBACK_LOCK_TTL_SECONDS,
      maxRetries: FALLBACK_LOCK_MAX_RETRIES,
      retryMs: FALLBACK_LOCK_RETRY_MS,
      timeoutMessage: 'GAME_FALLBACK_LOCK_TIMEOUT',
    },
  );
}
