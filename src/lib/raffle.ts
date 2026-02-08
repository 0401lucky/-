/**
 * 多人抽奖功能 - 核心业务逻辑
 */

import { kv } from "@vercel/kv";
import { nanoid } from "nanoid";
import { creditQuotaToUser } from "./new-api";
import type {
  Raffle,
  RafflePrize,
  RaffleEntry,
  RaffleWinner,
  RaffleStatus,
  CreateRaffleInput,
  UpdateRaffleInput,
  JoinRaffleResult,
  DrawRaffleResult,
  RaffleListItem,
  UserRaffleStatus,
} from "./types/raffle";

// ============ KV Keys ============
const RAFFLE_PREFIX = "raffle:";                          // 活动详情
const RAFFLE_LIST_KEY = "raffle:list";                    // 活动ID列表
const RAFFLE_ACTIVE_KEY = "raffle:active";                // 进行中活动ID集合
const RAFFLE_ENTRIES_PREFIX = "raffle:entries:";          // 参与记录列表
const RAFFLE_PARTICIPANTS_PREFIX = "raffle:participants:"; // 参与者ID集合
const RAFFLE_ENTRY_COUNT_PREFIX = "raffle:entry_count:";  // 参与计数
const USER_RAFFLES_PREFIX = "user:raffles:";              // 用户参与的活动
const USER_RAFFLE_WINS_PREFIX = "user:raffle_wins:";      // 用户中奖记录
const RAFFLE_DRAW_LOCK_PREFIX = "raffle:draw_lock:";      // 开奖分布式锁
const RAFFLE_DELIVERY_QUEUE_KEY = "raffle:delivery:queue"; // 发奖任务队列
const RAFFLE_DELIVERY_ENQUEUED_PREFIX = "raffle:delivery:enqueued:"; // 发奖任务去重标记

const DELIVERY_CONCURRENCY = 5; // P1: 发奖并发上限
const DELIVERY_BATCH_SIZE = 20; // 单次队列处理的最大中奖人数
const PENDING_RETRY_AFTER_MS = 10 * 60 * 1000; // pending 超过 10 分钟可重试

// ============ 活动 CRUD ============

/**
 * 创建抽奖活动
 */
export async function createRaffle(
  input: CreateRaffleInput,
  createdBy: number
): Promise<Raffle> {
  const now = Date.now();
  const id = nanoid(12);

  // 为每个奖品生成ID
  const prizes: RafflePrize[] = input.prizes.map((p) => ({
    ...p,
    id: nanoid(8),
  }));

  const raffle: Raffle = {
    id,
    title: input.title,
    description: input.description,
    coverImage: input.coverImage,
    prizes,
    triggerType: input.triggerType,
    threshold: input.threshold,
    status: "draft",
    participantsCount: 0,
    winnersCount: 0,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await kv.set(`${RAFFLE_PREFIX}${id}`, raffle);
  await kv.lpush(RAFFLE_LIST_KEY, id);

  return raffle;
}

/**
 * 获取活动详情
 */
export async function getRaffle(id: string): Promise<Raffle | null> {
  return await kv.get<Raffle>(`${RAFFLE_PREFIX}${id}`);
}

/**
 * 更新活动（仅限草稿状态）
 */
export async function updateRaffle(
  id: string,
  input: UpdateRaffleInput
): Promise<Raffle | null> {
  const raffle = await getRaffle(id);
  if (!raffle) return null;

  // 只有草稿状态可以修改
  if (raffle.status !== "draft") {
    throw new Error("只能修改草稿状态的活动");
  }

  const now = Date.now();
  let prizes = raffle.prizes;

  // 如果更新了奖品，需要重新生成ID
  if (input.prizes) {
    prizes = input.prizes.map((p) => ({
      ...p,
      id: nanoid(8),
    }));
  }

  const updated: Raffle = {
    ...raffle,
    title: input.title ?? raffle.title,
    description: input.description ?? raffle.description,
    coverImage: input.coverImage ?? raffle.coverImage,
    prizes,
    triggerType: input.triggerType ?? raffle.triggerType,
    threshold: input.threshold ?? raffle.threshold,
    updatedAt: now,
  };

  await kv.set(`${RAFFLE_PREFIX}${id}`, updated);
  return updated;
}

/**
 * 删除活动（仅限草稿或已取消状态）
 */
export async function deleteRaffle(id: string): Promise<boolean> {
  const raffle = await getRaffle(id);
  if (!raffle) return false;

  if (raffle.status !== "draft" && raffle.status !== "cancelled") {
    throw new Error("只能删除草稿或已取消的活动");
  }

  await kv.del(`${RAFFLE_PREFIX}${id}`);
  await kv.lrem(RAFFLE_LIST_KEY, 0, id);
  await kv.srem(RAFFLE_ACTIVE_KEY, id);
  await kv.del(`${RAFFLE_ENTRIES_PREFIX}${id}`);
  await kv.del(`${RAFFLE_PARTICIPANTS_PREFIX}${id}`);
  await kv.del(`${RAFFLE_ENTRY_COUNT_PREFIX}${id}`);

  return true;
}

/**
 * 发布活动（从草稿变为进行中）
 */
export async function publishRaffle(id: string): Promise<Raffle | null> {
  const raffle = await getRaffle(id);
  if (!raffle) return null;

  if (raffle.status !== "draft") {
    throw new Error("只能发布草稿状态的活动");
  }

  // 验证奖品配置
  if (raffle.prizes.length === 0) {
    throw new Error("请至少配置一个奖品");
  }

  const totalQuantity = raffle.prizes.reduce((sum, p) => sum + p.quantity, 0);
  if (totalQuantity === 0) {
    throw new Error("奖品总数量必须大于0");
  }

  const updated: Raffle = {
    ...raffle,
    status: "active",
    updatedAt: Date.now(),
  };

  await kv.set(`${RAFFLE_PREFIX}${id}`, updated);
  await kv.sadd(RAFFLE_ACTIVE_KEY, id);

  return updated;
}

/**
 * 取消活动
 */
export async function cancelRaffle(id: string): Promise<Raffle | null> {
  const raffle = await getRaffle(id);
  if (!raffle) return null;

  if (raffle.status === "ended") {
    throw new Error("已结束的活动无法取消");
  }

  const updated: Raffle = {
    ...raffle,
    status: "cancelled",
    updatedAt: Date.now(),
  };

  await kv.set(`${RAFFLE_PREFIX}${id}`, updated);
  await kv.srem(RAFFLE_ACTIVE_KEY, id);

  return updated;
}

/**
 * 获取活动列表
 */
export async function getRaffleList(options?: {
  status?: RaffleStatus;
  limit?: number;
  offset?: number;
}): Promise<RaffleListItem[]> {
  const { status, limit = 50, offset = 0 } = options || {};

  const ids = await kv.lrange<string>(RAFFLE_LIST_KEY, 0, -1);
  if (ids.length === 0) return [];

  // 批量获取
  const keys = ids.map((id) => `${RAFFLE_PREFIX}${id}`);
  const raffles = await kv.mget<(Raffle | null)[]>(...keys);

  let result = raffles.filter((r): r is Raffle => r !== null);

  // 按状态过滤
  if (status) {
    result = result.filter((r) => r.status === status);
  }

  // 排序：active 在前，然后按创建时间倒序
  result.sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    return b.createdAt - a.createdAt;
  });

  // 分页
  return result.slice(offset, offset + limit).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    coverImage: r.coverImage,
    prizes: r.prizes,
    triggerType: r.triggerType,
    threshold: r.threshold,
    status: r.status,
    participantsCount: r.participantsCount,
    winnersCount: r.winnersCount,
    drawnAt: r.drawnAt,
    createdAt: r.createdAt,
  }));
}

/**
 * 获取进行中的活动列表
 */
export async function getActiveRaffles(): Promise<RaffleListItem[]> {
  const ids = await kv.smembers<string[]>(RAFFLE_ACTIVE_KEY);
  if (!ids || ids.length === 0) return [];

  const keys = ids.map((id) => `${RAFFLE_PREFIX}${id}`);
  const raffles = await kv.mget<(Raffle | null)[]>(...keys);

  return raffles
    .filter((r): r is Raffle => r !== null && r.status === "active")
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      coverImage: r.coverImage,
      prizes: r.prizes,
      triggerType: r.triggerType,
      threshold: r.threshold,
      status: r.status,
      participantsCount: r.participantsCount,
      winnersCount: r.winnersCount,
      drawnAt: r.drawnAt,
      createdAt: r.createdAt,
    }));
}

// ============ 参与抽奖 ============

/**
 * 参与抽奖（Lua 原子操作）
 */
export async function joinRaffle(
  raffleId: string,
  userId: number,
  username: string
): Promise<JoinRaffleResult> {
  const raffleKey = `${RAFFLE_PREFIX}${raffleId}`;
  const entriesKey = `${RAFFLE_ENTRIES_PREFIX}${raffleId}`;
  const participantsKey = `${RAFFLE_PARTICIPANTS_PREFIX}${raffleId}`;
  const entryCountKey = `${RAFFLE_ENTRY_COUNT_PREFIX}${raffleId}`;
  const userRafflesKey = `${USER_RAFFLES_PREFIX}${userId}`;
  const drawLockKey = `${RAFFLE_DRAW_LOCK_PREFIX}${raffleId}`;

  const now = Date.now();
  const entryId = `entry_${now}_${nanoid(8)}`;

  const luaScript = `
    local raffleKey = KEYS[1]
    local entriesKey = KEYS[2]
    local participantsKey = KEYS[3]
    local entryCountKey = KEYS[4]
    local userRafflesKey = KEYS[5]
    local drawLockKey = KEYS[6]

    local now = tonumber(ARGV[1])
    local entryId = ARGV[2]
    local raffleId = ARGV[3]
    local userId = tonumber(ARGV[4])
    local username = ARGV[5]

    -- 1. 获取活动信息
    local raffleJson = redis.call('GET', raffleKey)
    if not raffleJson then
      return {0, '', '活动不存在'}
    end

    local ok, raffle = pcall(cjson.decode, raffleJson)
    if not ok or not raffle then
      return {0, '', '活动数据异常'}
    end

    -- 2. 检查开奖锁（开奖期间禁止新参与，避免漏抽/数据覆盖）
    if redis.call('EXISTS', drawLockKey) == 1 then
      return {0, '', '活动正在开奖，请稍后再试'}
    end

    -- 3. 检查活动状态
    if raffle.status ~= 'active' then
      if raffle.status == 'draft' then
        return {0, '', '活动尚未开始'}
      elseif raffle.status == 'ended' then
        return {0, '', '活动已结束'}
      elseif raffle.status == 'cancelled' then
        return {0, '', '活动已取消'}
      end
      return {0, '', '活动状态异常'}
    end

    -- 4. 检查是否已参与
    local alreadyJoined = redis.call('SISMEMBER', participantsKey, userId)
    if alreadyJoined == 1 then
      return {0, '', '您已经参与过了'}
    end

    -- 5. 分配抽奖号码
    local entryNumber = redis.call('INCR', entryCountKey)

    -- 6. 创建参与记录
    local entry = {
      id = entryId,
      raffleId = raffleId,
      userId = userId,
      username = username,
      entryNumber = entryNumber,
      createdAt = now
    }
    local entryJson = cjson.encode(entry)

    -- 7. 原子写入
    redis.call('LPUSH', entriesKey, entryJson)
    redis.call('SADD', participantsKey, userId)
    redis.call('SADD', userRafflesKey, raffleId)

    -- 8. 更新活动参与人数
    raffle.participantsCount = (raffle.participantsCount or 0) + 1
    raffle.updatedAt = now
    redis.call('SET', raffleKey, cjson.encode(raffle))

    -- 9. 检查是否触发自动开奖
    local shouldDraw = 0
    if raffle.triggerType == 'threshold' and raffle.participantsCount >= raffle.threshold then
      shouldDraw = 1
    end

    return {1, entryJson, 'ok', shouldDraw}
  `;

  const result = (await kv.eval(
    luaScript,
    [raffleKey, entriesKey, participantsKey, entryCountKey, userRafflesKey, drawLockKey],
    [now, entryId, raffleId, userId, username]
  )) as [number, string, string, number?];

  const [success, entryJson, message, shouldDraw] = result;

  if (success !== 1) {
    return { success: false, message };
  }

  const entry: RaffleEntry = JSON.parse(entryJson);

  return {
    success: true,
    message: "参与成功",
    entry,
    shouldDraw: shouldDraw === 1,
  };
}

/**
 * 获取用户参与状态
 */
export async function getUserRaffleStatus(
  raffleId: string,
  userId: number
): Promise<UserRaffleStatus> {
  const participantsKey = `${RAFFLE_PARTICIPANTS_PREFIX}${raffleId}`;
  const hasJoined = (await kv.sismember(participantsKey, userId)) === 1;

  if (!hasJoined) {
    return { hasJoined: false, isWinner: false };
  }

  // 查找用户的参与记录
  const entriesKey = `${RAFFLE_ENTRIES_PREFIX}${raffleId}`;
  const entries = await kv.lrange<RaffleEntry>(entriesKey, 0, -1);
  const entry = entries.find((e) => e.userId === userId);

  // 检查是否中奖
  const raffle = await getRaffle(raffleId);
  let isWinner = false;
  let prize: RaffleWinner | undefined;

  if (raffle?.winners) {
    prize = raffle.winners.find((w) => w.userId === userId);
    isWinner = !!prize;
  }

  return { hasJoined: true, entry, isWinner, prize };
}

/**
 * 获取活动参与者列表
 */
export async function getRaffleEntries(
  raffleId: string,
  limit = 50,
  offset = 0
): Promise<RaffleEntry[]> {
  const entriesKey = `${RAFFLE_ENTRIES_PREFIX}${raffleId}`;
  return await kv.lrange<RaffleEntry>(entriesKey, offset, offset + limit - 1);
}

// ============ 开奖逻辑 ============

/**
 * Fisher-Yates 洗牌算法
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

type RewardDeliveryResult = {
  userId: number;
  username: string;
  prizeName: string;
  success: boolean;
  message: string;
};

type DeliveryQueueJobReason = "draw" | "retry";

interface DeliveryQueueJob {
  raffleId: string;
  reason: DeliveryQueueJobReason;
  enqueuedAt: number;
  attempts: number;
}

function getDeliveryQueueFlagKey(raffleId: string): string {
  return `${RAFFLE_DELIVERY_ENQUEUED_PREFIX}${raffleId}`;
}

function isPendingRetryable(
  winner: RaffleWinner,
  raffleDrawnAt?: number,
  now = Date.now()
): boolean {
  if (winner.rewardStatus !== "pending") return false;

  const attempts = winner.rewardAttempts ?? 0;
  if (attempts === 0) {
    return true;
  }

  const lastAttemptAt = winner.rewardAttemptedAt ?? raffleDrawnAt;
  if (!lastAttemptAt) {
    return true;
  }

  return now - lastAttemptAt >= PENDING_RETRY_AFTER_MS;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  const maxWorkers = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  const workers = Array.from({ length: maxWorkers }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function enqueueRaffleDelivery(
  raffleId: string,
  reason: DeliveryQueueJobReason = "draw"
): Promise<boolean> {
  const flagKey = getDeliveryQueueFlagKey(raffleId);
  const flagSet = await kv.set(flagKey, Date.now(), { nx: true, ex: 60 * 60 });
  if (flagSet !== "OK") {
    return false;
  }

  const job: DeliveryQueueJob = {
    raffleId,
    reason,
    enqueuedAt: Date.now(),
    attempts: 0,
  };
  await kv.lpush(RAFFLE_DELIVERY_QUEUE_KEY, JSON.stringify(job));
  return true;
}

/**
 * 获取开奖分布式锁
 */
async function acquireDrawLock(raffleId: string): Promise<string | null> {
  const lockKey = `${RAFFLE_DRAW_LOCK_PREFIX}${raffleId}`;
  const lockToken = nanoid(16);
  // 奖励发放可能包含多次对 new-api 的网络请求，60 秒锁可能不够用，容易导致锁过期后重复发放
  const result = await kv.set(lockKey, lockToken, { nx: true, ex: 600 });
  return result === "OK" ? lockToken : null;
}

/**
 * 释放开奖分布式锁
 */
async function releaseDrawLock(raffleId: string, lockToken: string): Promise<void> {
  const lockKey = `${RAFFLE_DRAW_LOCK_PREFIX}${raffleId}`;
  const releaseScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;
  await kv.eval(releaseScript, [lockKey], [lockToken]);
}

/**
 * 执行开奖
 */
export async function executeRaffleDraw(
  raffleId: string,
  options?: { waitForDelivery?: boolean; queueOnAsync?: boolean }
): Promise<DrawRaffleResult> {
  const waitForDelivery = options?.waitForDelivery ?? true;
  const queueOnAsync = options?.queueOnAsync ?? true;

  // 1. 获取分布式锁
  const lockToken = await acquireDrawLock(raffleId);
  if (!lockToken) {
    return { success: false, message: "正在开奖中，请稍后" };
  }

  try {
    // 2. 获取活动信息（双重检查）
    const raffle = await getRaffle(raffleId);
    if (!raffle) {
      return { success: false, message: "活动不存在" };
    }

    if (raffle.status !== "active") {
      return { success: false, message: "活动状态不是进行中" };
    }

    // 3. 获取所有参与记录
    const entriesKey = `${RAFFLE_ENTRIES_PREFIX}${raffleId}`;
    const entries = await kv.lrange<RaffleEntry>(entriesKey, 0, -1);

    if (entries.length === 0) {
      // 无人参与，直接结束
      const updated: Raffle = {
        ...raffle,
        status: "ended",
        drawnAt: Date.now(),
        winners: [],
        winnersCount: 0,
        updatedAt: Date.now(),
      };
      await kv.set(`${RAFFLE_PREFIX}${raffleId}`, updated);
      await kv.srem(RAFFLE_ACTIVE_KEY, raffleId);

      return { success: true, message: "无人参与，活动已结束", winners: [] };
    }

    // 4. 洗牌随机打乱
    const shuffled = shuffleArray(entries);

    // 5. 按奖品顺序抽取中奖者
    const winners: RaffleWinner[] = [];
    let winnerIndex = 0;

    for (const prize of raffle.prizes) {
      for (let i = 0; i < prize.quantity && winnerIndex < shuffled.length; i++) {
        const entry = shuffled[winnerIndex];
        winners.push({
          entryId: entry.id,
          userId: entry.userId,
          username: entry.username,
          prizeId: prize.id,
          prizeName: prize.name,
          dollars: prize.dollars,
          rewardStatus: "pending",
        });
        winnerIndex++;
      }
    }

    // 6. 更新活动状态
    const now = Date.now();
    const updated: Raffle = {
      ...raffle,
      status: "ended",
      drawnAt: now,
      winners,
      winnersCount: winners.length,
      updatedAt: now,
    };

    await kv.set(`${RAFFLE_PREFIX}${raffleId}`, updated);
    await kv.srem(RAFFLE_ACTIVE_KEY, raffleId);

    if (!waitForDelivery) {
      // 自动开奖路径：先确保开奖结果落库，再入队处理，避免 Serverless fire-and-forget 丢失
      let enqueueFailed = false;
      if (queueOnAsync) {
        try {
          await enqueueRaffleDelivery(raffleId, "draw");
        } catch (error) {
          enqueueFailed = true;
          console.error(`自动开奖奖励发放入队失败 - 活动 ${raffleId}:`, error);
        }
      }

      return {
        success: true,
        message: enqueueFailed
          ? `开奖成功，共 ${winners.length} 人中奖，但发奖入队失败，请管理员重试`
          : queueOnAsync
            ? `开奖成功，共 ${winners.length} 人中奖，奖励发放排队处理中`
            : `开奖成功，共 ${winners.length} 人中奖`,
        winners,
      };
    }

    // 手动开奖路径：等待奖励发放结果
    const deliveryResults = await deliverRewards(raffleId, winners);

    return {
      success: true,
      message: `开奖成功，共 ${winners.length} 人中奖`,
      winners,
      deliveryResults,
    };
  } finally {
    // 释放锁
    await releaseDrawLock(raffleId, lockToken);
  }
}

/**
 * 发放奖励
 */
async function deliverRewards(
  raffleId: string,
  winners: RaffleWinner[]
): Promise<RewardDeliveryResult[]> {
  const results: RewardDeliveryResult[] = [];

  const raffle = await getRaffle(raffleId);
  if (!raffle) return results;

  // 以活动当前 winners 为准，避免重试时只传入 failed 子集导致覆盖丢失
  const currentWinners = raffle.winners ?? winners;
  const winnerIndexByEntryId = new Map<string, number>();
  currentWinners.forEach((w, idx) => winnerIndexByEntryId.set(w.entryId, idx));
  const updatedWinners = [...currentWinners];

  const updates = await mapWithConcurrency(
    winners,
    DELIVERY_CONCURRENCY,
    async (winnerToProcess): Promise<{
      winnerIndex: number;
      winner: RaffleWinner;
      result: RewardDeliveryResult;
    } | null> => {
      const winnerIndex = winnerIndexByEntryId.get(winnerToProcess.entryId);
      if (winnerIndex === undefined) return null;

      const winner = updatedWinners[winnerIndex];
      if (winner.rewardStatus === "delivered") return null;

      const attemptedAt = Date.now();
      const rewardAttempts = (winner.rewardAttempts ?? 0) + 1;

      try {
        const creditResult = await creditQuotaToUser(winner.userId, winner.dollars) as
          { success: boolean; message: string; newQuota?: number; uncertain?: boolean };

        if (creditResult.success) {
          const deliveredWinner: RaffleWinner = {
            ...winner,
            rewardStatus: "delivered",
            rewardMessage: creditResult.message,
            rewardAttemptedAt: attemptedAt,
            rewardAttempts,
            deliveredAt: Date.now(),
          };

          try {
            // 记录到用户中奖列表（非关键链路，失败仅记录日志，避免误判为发放失败）
            await kv.lpush(`${USER_RAFFLE_WINS_PREFIX}${winner.userId}`, {
              raffleId,
              raffleTitle: raffle.title,
              ...deliveredWinner,
            });
          } catch (logError) {
            console.error(`记录中奖记录失败 - 用户 ${winner.userId}:`, logError);
          }

          return {
            winnerIndex,
            winner: deliveredWinner,
            result: {
              userId: winner.userId,
              username: winner.username,
              prizeName: winner.prizeName,
              success: true,
              message: creditResult.message,
            },
          };
        }

        if (creditResult.uncertain) {
          // 结果不确定：不要标记失败（避免重复发放），保持 pending 便于后续人工核对
          return {
            winnerIndex,
            winner: {
              ...winner,
              rewardStatus: "pending",
              rewardMessage: creditResult.message,
              rewardAttemptedAt: attemptedAt,
              rewardAttempts,
            },
            result: {
              userId: winner.userId,
              username: winner.username,
              prizeName: winner.prizeName,
              success: false,
              message: creditResult.message,
            },
          };
        }

        return {
          winnerIndex,
          winner: {
            ...winner,
            rewardStatus: "failed",
            rewardMessage: creditResult.message,
            rewardAttemptedAt: attemptedAt,
            rewardAttempts,
          },
          result: {
            userId: winner.userId,
            username: winner.username,
            prizeName: winner.prizeName,
            success: false,
            message: creditResult.message,
          },
        };
      } catch (error) {
        console.error(`发放奖励失败 - 用户 ${winner.userId}:`, error);
        return {
          winnerIndex,
          winner: {
            ...winner,
            rewardStatus: "failed",
            rewardMessage: error instanceof Error ? error.message : "发放异常",
            rewardAttemptedAt: attemptedAt,
            rewardAttempts,
          },
          result: {
            userId: winner.userId,
            username: winner.username,
            prizeName: winner.prizeName,
            success: false,
            message: "发放异常",
          },
        };
      }
    }
  );

  for (const update of updates) {
    if (!update) continue;
    updatedWinners[update.winnerIndex] = update.winner;
    results.push(update.result);
  }

  // 更新活动中的中奖者信息
  const updatedRaffle: Raffle = {
    ...raffle,
    winners: updatedWinners,
    updatedAt: Date.now(),
  };
  await kv.set(`${RAFFLE_PREFIX}${raffleId}`, updatedRaffle);

  return results;
}

function getRetryableWinners(
  raffle: Pick<Raffle, "winners" | "drawnAt">,
  now = Date.now()
): RaffleWinner[] {
  const winners = raffle.winners ?? [];
  return winners.filter((winner) => {
    if (winner.rewardStatus === "failed") return true;
    return isPendingRetryable(winner, raffle.drawnAt, now);
  });
}

function getWaitingPendingCount(
  raffle: Pick<Raffle, "winners" | "drawnAt">,
  now = Date.now()
): number {
  const winners = raffle.winners ?? [];
  return winners.filter((winner) => {
    if (winner.rewardStatus !== "pending") return false;
    return !isPendingRetryable(winner, raffle.drawnAt, now);
  }).length;
}

interface ProcessDeliveryJobResult {
  status: "processed" | "locked" | "skipped";
  deliveryResults: RewardDeliveryResult[];
  retryableRemaining: number;
  waitingPending: number;
}

async function processRaffleDeliveryJob(raffleId: string): Promise<ProcessDeliveryJobResult> {
  const lockToken = await acquireDrawLock(raffleId);
  if (!lockToken) {
    return {
      status: "locked",
      deliveryResults: [],
      retryableRemaining: 0,
      waitingPending: 0,
    };
  }

  try {
    const raffle = await getRaffle(raffleId);
    if (!raffle || raffle.status !== "ended" || !raffle.winners) {
      return {
        status: "skipped",
        deliveryResults: [],
        retryableRemaining: 0,
        waitingPending: 0,
      };
    }

    const now = Date.now();
    const retryable = getRetryableWinners(raffle, now);
    if (retryable.length === 0) {
      return {
        status: "skipped",
        deliveryResults: [],
        retryableRemaining: 0,
        waitingPending: getWaitingPendingCount(raffle, now),
      };
    }

    const currentBatch = retryable.slice(0, DELIVERY_BATCH_SIZE);
    const deliveryResults = await deliverRewards(raffleId, currentBatch);

    const latestRaffle = await getRaffle(raffleId);
    if (!latestRaffle) {
      return {
        status: "processed",
        deliveryResults,
        retryableRemaining: 0,
        waitingPending: 0,
      };
    }

    const latestNow = Date.now();
    return {
      status: "processed",
      deliveryResults,
      retryableRemaining: getRetryableWinners(latestRaffle, latestNow).length,
      waitingPending: getWaitingPendingCount(latestRaffle, latestNow),
    };
  } finally {
    await releaseDrawLock(raffleId, lockToken);
  }
}

/**
 * 处理发奖队列（供定时任务/内部接口调用）
 */
export async function processQueuedRaffleDeliveries(
  maxJobs = 1
): Promise<{
  success: boolean;
  message: string;
  processedJobs: number;
  delivered: number;
  failed: number;
  pending: number;
  skippedJobs: number;
  lockedJobs: number;
}> {
  const jobsLimit = Math.max(1, Math.min(maxJobs, 20));

  let processedJobs = 0;
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  let skippedJobs = 0;
  let lockedJobs = 0;

  for (let i = 0; i < jobsLimit; i++) {
    const rawJob = await kv.rpop<string>(RAFFLE_DELIVERY_QUEUE_KEY);
    if (!rawJob) {
      break;
    }

    let job: DeliveryQueueJob | null = null;
    try {
      job = JSON.parse(rawJob) as DeliveryQueueJob;
    } catch {
      continue;
    }

    if (!job?.raffleId) {
      continue;
    }

    const flagKey = getDeliveryQueueFlagKey(job.raffleId);
    const result = await processRaffleDeliveryJob(job.raffleId);

    if (result.status === "locked") {
      lockedJobs += 1;
      await kv.lpush(
        RAFFLE_DELIVERY_QUEUE_KEY,
        JSON.stringify({ ...job, attempts: (job.attempts ?? 0) + 1, enqueuedAt: Date.now() })
      );
      continue;
    }

    if (result.status === "skipped") {
      skippedJobs += 1;
      if (result.waitingPending > 0) {
        await kv.lpush(
          RAFFLE_DELIVERY_QUEUE_KEY,
          JSON.stringify({ ...job, reason: "retry", attempts: (job.attempts ?? 0) + 1, enqueuedAt: Date.now() })
        );
      } else {
        await kv.del(flagKey);
      }
      // 避免本次循环中对同一活动无意义地反复出入队
      if (result.waitingPending > 0) {
        break;
      }
      continue;
    }

    processedJobs += 1;

    for (const item of result.deliveryResults) {
      if (item.success) {
        delivered += 1;
      } else {
        failed += 1;
      }
    }

    pending += result.waitingPending;

    if (result.retryableRemaining > 0 || result.waitingPending > 0) {
      await kv.lpush(
        RAFFLE_DELIVERY_QUEUE_KEY,
        JSON.stringify({ ...job, reason: "retry", attempts: (job.attempts ?? 0) + 1, enqueuedAt: Date.now() })
      );
    } else {
      await kv.del(flagKey);
    }
  }

  return {
    success: true,
    message: `队列处理完成：处理 ${processedJobs} 个任务，成功 ${delivered} 笔，失败 ${failed} 笔，待确认 ${pending} 笔`,
    processedJobs,
    delivered,
    failed,
    pending,
    skippedJobs,
    lockedJobs,
  };
}

/**
 * 重试发放失败/超时 pending 的奖励
 */
export async function retryFailedRewards(
  raffleId: string
): Promise<DrawRaffleResult> {
  // 使用同一把锁，避免多次并发重试导致重复发放
  const lockToken = await acquireDrawLock(raffleId);
  if (!lockToken) {
    return { success: false, message: "正在处理奖励发放，请稍后" };
  }

  try {
    const raffle = await getRaffle(raffleId);

    if (!raffle) {
      return { success: false, message: "活动不存在" };
    }

    if (raffle.status !== "ended" || !raffle.winners) {
      return { success: false, message: "活动未开奖或无中奖者" };
    }

    const now = Date.now();
    const retryCandidates = getRetryableWinners(raffle, now);

    const failedCount = retryCandidates.filter((winner) => winner.rewardStatus === "failed").length;
    const pendingCount = retryCandidates.length - failedCount;

    if (retryCandidates.length === 0) {
      return { success: true, message: "没有需要重试的奖励" };
    }

    const deliveryResults = await deliverRewards(raffleId, retryCandidates);

    return {
      success: true,
      message: `重试完成（失败 ${failedCount} 笔 + 超时待确认 ${pendingCount} 笔），${deliveryResults.filter((r) => r.success).length}/${retryCandidates.length} 成功`,
      deliveryResults,
    };
  } finally {
    await releaseDrawLock(raffleId, lockToken);
  }
}

/**
 * 获取用户中奖记录
 */
export async function getUserRaffleWins(
  userId: number,
  limit = 20
): Promise<(RaffleWinner & { raffleId: string; raffleTitle: string })[]> {
  return await kv.lrange(`${USER_RAFFLE_WINS_PREFIX}${userId}`, 0, limit - 1);
}

/**
 * 获取用户参与的活动列表
 */
export async function getUserRaffles(userId: number): Promise<string[]> {
  return await kv.smembers(`${USER_RAFFLES_PREFIX}${userId}`);
}
