/**
 * 多人抽奖功能 - 核心业务逻辑
 */

import { kv } from '@/lib/d1-kv';
import { randomInt } from "crypto";
import { nanoid } from "nanoid";
import { maskUserId } from "./logging";
import { createUserNotification } from './notifications';
import { withKvLock } from './economy-lock';
import { addPoints } from './points';
import type {
  Raffle,
  RafflePrize,
  RaffleEntry,
  RaffleWinner,
  RaffleMode,
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
const RAFFLE_JOIN_LOCK_PREFIX = "raffle:join_lock:";      // 参与/开奖串行锁
const RAFFLE_DELIVERY_QUEUE_KEY = "raffle:delivery:queue"; // 发奖任务队列
const RAFFLE_DELIVERY_PROCESSING_QUEUE_KEY = "raffle:delivery:processing"; // 发奖处理中队列
const RAFFLE_DELIVERY_ENQUEUED_PREFIX = "raffle:delivery:enqueued:"; // 发奖任务去重标记
const RAFFLE_DELIVERY_IDEMPOTENCY_PREFIX = "raffle:delivery:state:"; // 发奖幂等状态

const DELIVERY_CONCURRENCY = 5; // P1: 发奖并发上限
const DELIVERY_BATCH_SIZE = 20; // 单次队列处理的最大中奖人数
const PENDING_RETRY_AFTER_MS = 10 * 60 * 1000; // pending 超过 10 分钟可重试
const DELIVERY_JOB_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 处理队列任务 5 分钟未 ack 视为崩溃可恢复
const DELIVERY_IDEMPOTENCY_PROCESSING_TTL_SECONDS = 15 * 60; // 单笔发奖 processing 锁 15 分钟
const DELIVERY_IDEMPOTENCY_UNCERTAIN_TTL_SECONDS = 24 * 60 * 60; // uncertain 状态保留 24 小时
const DELIVERY_IDEMPOTENCY_DELIVERED_TTL_SECONDS = 90 * 24 * 60 * 60; // delivered 幂等状态保留 90 天

export function normalizeRaffleRewardPoints(
  pointsValue: unknown,
  legacyDollarsValue?: unknown
): number | null {
  const toPositivePoints = (value: unknown): number | null => {
    const points = Number(value);
    if (!Number.isFinite(points) || points <= 0) {
      return null;
    }
    const rounded = Math.round(points);
    return rounded > 0 ? rounded : null;
  };

  const normalizedPoints = toPositivePoints(pointsValue);
  if (normalizedPoints !== null) {
    return normalizedPoints;
  }

  return toPositivePoints(legacyDollarsValue);
}

export function getRaffleMode(raffle: Pick<Raffle, "mode"> | null | undefined): RaffleMode {
  return raffle?.mode === "red_packet" ? "red_packet" : "draw";
}

function normalizePositiveInteger(value: unknown, fieldName: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`${fieldName}必须为正整数`);
  }
  return normalized;
}

function normalizeOptionalTimestamp(value: unknown, fieldName: string): number | undefined {
  if (value == null || value === "") return undefined;

  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`${fieldName}不正确`);
  }
  return normalized;
}

function normalizeDrawTriggerType(value: unknown): "threshold" | "manual" | "scheduled" {
  if (value === "manual" || value === "scheduled" || value === "threshold") {
    return value;
  }
  return "threshold";
}

export function isRaffleScheduledDrawDue(
  raffle: Pick<Raffle, "mode" | "status" | "triggerType" | "scheduledDrawAt">,
  now = Date.now()
): boolean {
  return (
    getRaffleMode(raffle) === "draw" &&
    raffle.status === "active" &&
    raffle.triggerType === "scheduled" &&
    Number.isFinite(raffle.scheduledDrawAt) &&
    (raffle.scheduledDrawAt ?? 0) <= now
  );
}

export function normalizeRedPacketConfig(input: {
  redPacketTotalPoints?: unknown;
  redPacketTotalSlots?: unknown;
}): { totalPoints: number; totalSlots: number } {
  const totalPoints = normalizePositiveInteger(input.redPacketTotalPoints, "红包总积分");
  const totalSlots = normalizePositiveInteger(input.redPacketTotalSlots, "可参与人数");

  if (totalPoints < totalSlots) {
    throw new Error("红包总积分不能小于可参与人数");
  }

  return { totalPoints, totalSlots };
}

export function buildRedPacketPackets(totalPointsValue: unknown, totalSlotsValue: unknown): number[] {
  const { totalPoints, totalSlots } = normalizeRedPacketConfig({
    redPacketTotalPoints: totalPointsValue,
    redPacketTotalSlots: totalSlotsValue,
  });

  if (totalSlots === 1) {
    return [totalPoints];
  }

  const packets: number[] = [];
  let remainingPoints = totalPoints;
  let remainingSlots = totalSlots;

  while (remainingSlots > 1) {
    const maxValue = remainingPoints - remainingSlots + 1;
    const average = remainingPoints / remainingSlots;
    const cap = Math.max(1, Math.min(maxValue, Math.floor(average * 2)));
    const safeCap = Math.min(cap, 2 ** 48 - 1);
    const value = randomInt(1, safeCap + 1);
    packets.push(value);
    remainingPoints -= value;
    remainingSlots -= 1;
  }

  packets.push(remainingPoints);
  return shuffleArray(packets);
}

function getRafflePrizePoints(prize: Pick<RafflePrize, "points" | "dollars">): number {
  return normalizeRaffleRewardPoints(prize.points, prize.dollars) ?? 0;
}

function getRaffleWinnerPoints(winner: Pick<RaffleWinner, "points" | "dollars">): number {
  return normalizeRaffleRewardPoints(winner.points, winner.dollars) ?? 0;
}

function getRaffleJoinLockKey(raffleId: string): string {
  return `${RAFFLE_JOIN_LOCK_PREFIX}${raffleId}`;
}

async function withRaffleJoinLock<T>(raffleId: string, handler: () => Promise<T>): Promise<T> {
  return withKvLock(getRaffleJoinLockKey(raffleId), handler, {
    ttlSeconds: 15,
    maxRetries: 120,
    retryMs: 20,
    timeoutMessage: 'RAFFLE_JOIN_BUSY',
  });
}

function buildRafflePrizes(inputPrizes: CreateRaffleInput["prizes"]): RafflePrize[] {
  const rawPrizes = inputPrizes ?? [];
  if (rawPrizes.length === 0) {
    throw new Error("请至少配置一个奖品");
  }

  return rawPrizes.map((p) => {
    const points = normalizeRaffleRewardPoints(p.points, p.dollars);
    if (points === null) {
      throw new Error("奖品积分必须大于0");
    }

    const quantity = normalizePositiveInteger(p.quantity, "奖品数量");

    return {
      id: nanoid(8),
      name: p.name,
      points,
      quantity,
    };
  });
}

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
  const mode = input.mode === "red_packet" ? "red_packet" : "draw";
  const redPacketConfig = mode === "red_packet" ? normalizeRedPacketConfig(input) : null;
  const triggerType = mode === "draw" ? normalizeDrawTriggerType(input.triggerType) : "manual";
  const scheduledDrawAt = triggerType === "scheduled"
    ? normalizeOptionalTimestamp(input.scheduledDrawAt, "开奖时间")
    : undefined;

  if (triggerType === "scheduled" && scheduledDrawAt === undefined) {
    throw new Error("请选择到点开奖时间");
  }

  // 为每个奖品生成ID，并把历史额度字段统一归一化为站内积分。
  const prizes: RafflePrize[] = mode === "draw" ? buildRafflePrizes(input.prizes) : [];

  const raffle: Raffle = {
    id,
    mode,
    title: input.title,
    description: input.description,
    coverImage: input.coverImage,
    prizes,
    triggerType,
    threshold: triggerType === "threshold" ? (input.threshold ?? 1) : redPacketConfig?.totalSlots ?? 1,
    scheduledDrawAt,
    status: "draft",
    participantsCount: 0,
    winnersCount: 0,
    redPacketTotalPoints: redPacketConfig?.totalPoints,
    redPacketTotalSlots: redPacketConfig?.totalSlots,
    redPacketRemainingPoints: redPacketConfig?.totalPoints,
    redPacketRemainingSlots: redPacketConfig?.totalSlots,
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
  const currentMode = getRaffleMode(raffle);
  const nextMode = input.mode === "red_packet" ? "red_packet" : input.mode === "draw" ? "draw" : currentMode;
  const nextTriggerType = nextMode === "draw"
    ? input.triggerType !== undefined
      ? normalizeDrawTriggerType(input.triggerType)
      : normalizeDrawTriggerType(raffle.triggerType)
    : "manual";
  const nextScheduledDrawAt = nextTriggerType === "scheduled"
    ? normalizeOptionalTimestamp(input.scheduledDrawAt ?? raffle.scheduledDrawAt, "开奖时间")
    : undefined;

  if (nextTriggerType === "scheduled" && nextScheduledDrawAt === undefined) {
    throw new Error("请选择到点开奖时间");
  }

  const prizes = nextMode === "draw"
    ? input.prizes
      ? buildRafflePrizes(input.prizes)
      : currentMode === "draw"
        ? raffle.prizes
        : buildRafflePrizes([])
    : [];

  const nextRedPacketConfig = nextMode === "red_packet"
    ? normalizeRedPacketConfig({
        redPacketTotalPoints: input.redPacketTotalPoints ?? raffle.redPacketTotalPoints,
        redPacketTotalSlots: input.redPacketTotalSlots ?? raffle.redPacketTotalSlots,
      })
    : null;

  const updated: Raffle = {
    ...raffle,
    mode: nextMode,
    title: input.title ?? raffle.title,
    description: input.description ?? raffle.description,
    coverImage: input.coverImage ?? raffle.coverImage,
    prizes,
    triggerType: nextTriggerType,
    threshold: nextTriggerType === "threshold" ? (input.threshold ?? raffle.threshold ?? 1) : nextRedPacketConfig?.totalSlots ?? 1,
    scheduledDrawAt: nextScheduledDrawAt,
    redPacketTotalPoints: nextRedPacketConfig?.totalPoints,
    redPacketTotalSlots: nextRedPacketConfig?.totalSlots,
    redPacketRemainingPoints: nextRedPacketConfig?.totalPoints,
    redPacketRemainingSlots: nextRedPacketConfig?.totalSlots,
    redPacketPackets: undefined,
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

  await Promise.all([
    kv.del(`${RAFFLE_PREFIX}${id}`),
    kv.lrem(RAFFLE_LIST_KEY, 0, id),
    kv.srem(RAFFLE_ACTIVE_KEY, id),
    kv.del(`${RAFFLE_ENTRIES_PREFIX}${id}`),
    kv.del(`${RAFFLE_PARTICIPANTS_PREFIX}${id}`),
    kv.del(`${RAFFLE_ENTRY_COUNT_PREFIX}${id}`),
  ]);

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

  const mode = getRaffleMode(raffle);
  let updated: Raffle;

  if (mode === "red_packet") {
    const { totalPoints, totalSlots } = normalizeRedPacketConfig({
      redPacketTotalPoints: raffle.redPacketTotalPoints,
      redPacketTotalSlots: raffle.redPacketTotalSlots,
    });
    const packets = buildRedPacketPackets(totalPoints, totalSlots);

    updated = {
      ...raffle,
      mode,
      prizes: [],
      triggerType: "manual",
      threshold: totalSlots,
      status: "active",
      participantsCount: 0,
      winnersCount: 0,
      winners: [],
      redPacketTotalPoints: totalPoints,
      redPacketTotalSlots: totalSlots,
      redPacketRemainingPoints: totalPoints,
      redPacketRemainingSlots: totalSlots,
      redPacketPackets: packets,
      updatedAt: Date.now(),
    };
  } else {
    // 验证奖品配置
    if (raffle.prizes.length === 0) {
      throw new Error("请至少配置一个奖品");
    }

    const totalQuantity = raffle.prizes.reduce((sum, p) => sum + p.quantity, 0);
    if (totalQuantity === 0) {
      throw new Error("奖品总数量必须大于0");
    }

    updated = {
      ...raffle,
      mode,
      status: "active",
      updatedAt: Date.now(),
    };
  }

  await Promise.all([
    kv.set(`${RAFFLE_PREFIX}${id}`, updated),
    kv.sadd(RAFFLE_ACTIVE_KEY, id),
  ]);

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

  await Promise.all([
    kv.set(`${RAFFLE_PREFIX}${id}`, updated),
    kv.srem(RAFFLE_ACTIVE_KEY, id),
  ]);

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
  const raffles = await kv.mget<Raffle>(...keys);

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
    mode: getRaffleMode(r),
    title: r.title,
    description: r.description,
    coverImage: r.coverImage,
    prizes: r.prizes,
    triggerType: r.triggerType,
    threshold: r.threshold,
    scheduledDrawAt: r.scheduledDrawAt,
    status: r.status,
    participantsCount: r.participantsCount,
    winnersCount: r.winnersCount,
    drawnAt: r.drawnAt,
    redPacketTotalPoints: r.redPacketTotalPoints,
    redPacketTotalSlots: r.redPacketTotalSlots,
    redPacketRemainingPoints: r.redPacketRemainingPoints,
    redPacketRemainingSlots: r.redPacketRemainingSlots,
    createdAt: r.createdAt,
  }));
}

/**
 * 获取进行中的活动列表
 */
export async function getActiveRaffles(): Promise<RaffleListItem[]> {
  const ids = await kv.smembers<string>(RAFFLE_ACTIVE_KEY);
  if (!ids || ids.length === 0) return [];

  const keys = ids.map((id) => `${RAFFLE_PREFIX}${id}`);
  const raffles = await kv.mget<Raffle>(...keys);

  return raffles
    .filter((r): r is Raffle => r !== null && r.status === "active")
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      mode: getRaffleMode(r),
      title: r.title,
      description: r.description,
      coverImage: r.coverImage,
      prizes: r.prizes,
      triggerType: r.triggerType,
      threshold: r.threshold,
      scheduledDrawAt: r.scheduledDrawAt,
      status: r.status,
      participantsCount: r.participantsCount,
      winnersCount: r.winnersCount,
      drawnAt: r.drawnAt,
      redPacketTotalPoints: r.redPacketTotalPoints,
      redPacketTotalSlots: r.redPacketTotalSlots,
      redPacketRemainingPoints: r.redPacketRemainingPoints,
      redPacketRemainingSlots: r.redPacketRemainingSlots,
      createdAt: r.createdAt,
    }));
}

export async function processDueScheduledRaffleDraws(
  now = Date.now(),
  limit = 20
): Promise<{
  checked: number;
  due: number;
  drawn: number;
  skipped: number;
  failed: number;
  errors: Array<{ raffleId: string; message: string }>;
}> {
  const ids = await kv.smembers<string>(RAFFLE_ACTIVE_KEY);
  if (!ids || ids.length === 0) {
    return { checked: 0, due: 0, drawn: 0, skipped: 0, failed: 0, errors: [] };
  }

  const keys = ids.map((id) => `${RAFFLE_PREFIX}${id}`);
  const raffles = await kv.mget<Raffle>(...keys);
  const dueRaffles = (raffles ?? [])
    .filter((raffle): raffle is Raffle => raffle !== null && isRaffleScheduledDrawDue(raffle, now))
    .sort((a, b) => (a.scheduledDrawAt ?? 0) - (b.scheduledDrawAt ?? 0))
    .slice(0, Math.max(1, Math.floor(limit)));

  let drawn = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ raffleId: string; message: string }> = [];

  for (const raffle of dueRaffles) {
    try {
      const result = await executeRaffleDraw(raffle.id, { waitForDelivery: false });
      if (result.success) {
        drawn += 1;
      } else {
        skipped += 1;
        errors.push({ raffleId: raffle.id, message: result.message });
      }
    } catch (error) {
      failed += 1;
      errors.push({
        raffleId: raffle.id,
        message: error instanceof Error ? error.message : "到点开奖失败",
      });
    }
  }

  return {
    checked: ids.length,
    due: dueRaffles.length,
    drawn,
    skipped,
    failed,
    errors,
  };
}

// ============ 参与抽奖 ============

/**
 * 参与抽奖（使用活动级串行锁保证一致性）
 */
export async function joinRaffle(
  raffleId: string,
  userId: number,
  username: string
): Promise<JoinRaffleResult> {
  return withRaffleJoinLock(raffleId, async () => {
    const raffleKey = `${RAFFLE_PREFIX}${raffleId}`;
    const entriesKey = `${RAFFLE_ENTRIES_PREFIX}${raffleId}`;
    const participantsKey = `${RAFFLE_PARTICIPANTS_PREFIX}${raffleId}`;
    const entryCountKey = `${RAFFLE_ENTRY_COUNT_PREFIX}${raffleId}`;
    const userRafflesKey = `${USER_RAFFLES_PREFIX}${userId}`;
    const drawLockKey = `${RAFFLE_DRAW_LOCK_PREFIX}${raffleId}`;

    const now = Date.now();
    const entryId = `entry_${now}_${nanoid(8)}`;

    const raffle = await kv.get<Raffle>(raffleKey);
    if (!raffle) return { success: false, message: "活动不存在" };

    if (getRaffleMode(raffle) === "red_packet") {
      return { success: false, message: "请使用抢红包入口参与活动" };
    }

    const drawLockExists = await kv.exists(drawLockKey);
    if (drawLockExists) return { success: false, message: "活动正在开奖，请稍后再试" };

    if (raffle.status !== "active") {
      if (raffle.status === "draft") return { success: false, message: "活动尚未开始" };
      if (raffle.status === "ended") return { success: false, message: "活动已结束" };
      if (raffle.status === "cancelled") return { success: false, message: "活动已取消" };
      return { success: false, message: "活动状态异常" };
    }

    if (isRaffleScheduledDrawDue(raffle, now)) {
      return { success: false, message: "活动已到开奖时间，正在等待开奖，请稍后刷新" };
    }

    const alreadyJoined = await kv.sismember(participantsKey, userId);
    if (alreadyJoined === 1) return { success: false, message: "您已经参与过了" };

    const entryNumber = await kv.incr(entryCountKey);
    const entry: RaffleEntry = {
      id: entryId,
      raffleId,
      userId,
      username,
      entryNumber,
      createdAt: now,
    };

    const originalRaffle: Raffle = { ...raffle };
    let entryWritten = false;
    let participantWritten = false;
    let userRaffleWritten = false;
    let raffleUpdated = false;

    try {
      await kv.lpush(entriesKey, entry);
      entryWritten = true;
      await kv.sadd(participantsKey, userId);
      participantWritten = true;
      await kv.sadd(userRafflesKey, raffleId);
      userRaffleWritten = true;

      raffle.participantsCount = (raffle.participantsCount ?? 0) + 1;
      raffle.updatedAt = now;
      await kv.set(raffleKey, raffle);
      raffleUpdated = true;

      const shouldDraw = raffle.triggerType === "threshold" && raffle.participantsCount >= (raffle.threshold ?? Infinity);
      return { success: true, message: "参与成功", entry, shouldDraw };
    } catch (error) {
      if (raffleUpdated) {
        await kv.set(raffleKey, originalRaffle).catch((rollbackError) => {
          console.error('Rollback raffle participant counter failed:', rollbackError);
        });
      }
      if (userRaffleWritten) {
        await kv.srem(userRafflesKey, raffleId).catch((rollbackError) => {
          console.error('Rollback user raffle index failed:', rollbackError);
        });
      }
      if (participantWritten) {
        await kv.srem(participantsKey, userId).catch((rollbackError) => {
          console.error('Rollback raffle participant membership failed:', rollbackError);
        });
      }
      if (entryWritten) {
        await kv.lrem(entriesKey, 1, entry).catch((rollbackError) => {
          console.error('Rollback raffle entry list failed:', rollbackError);
        });
      }
      throw error;
    }
  });
}

function sumRedPacketPackets(packets: number[]): number {
  return packets.reduce((sum, value) => sum + value, 0);
}

function normalizeRemainingRedPacketPackets(raffle: Raffle): number[] {
  const packets = Array.isArray(raffle.redPacketPackets)
    ? raffle.redPacketPackets.filter((value) => Number.isSafeInteger(value) && value > 0)
    : [];
  const fallbackSlots = raffle.redPacketRemainingSlots ?? packets.length;
  const fallbackPoints = raffle.redPacketRemainingPoints ?? sumRedPacketPackets(packets);

  if (
    packets.length > 0
    && packets.length === fallbackSlots
    && sumRedPacketPackets(packets) === fallbackPoints
  ) {
    return [...packets];
  }

  if (fallbackSlots > 0 && fallbackPoints >= fallbackSlots) {
    return buildRedPacketPackets(fallbackPoints, fallbackSlots);
  }

  return [];
}

/**
 * 抢红包（使用活动级串行锁保证不超发）
 */
export async function grabRedPacket(
  raffleId: string,
  userId: number,
  username: string
): Promise<JoinRaffleResult> {
  return withRaffleJoinLock(raffleId, async () => {
    const raffleKey = `${RAFFLE_PREFIX}${raffleId}`;
    const entriesKey = `${RAFFLE_ENTRIES_PREFIX}${raffleId}`;
    const participantsKey = `${RAFFLE_PARTICIPANTS_PREFIX}${raffleId}`;
    const entryCountKey = `${RAFFLE_ENTRY_COUNT_PREFIX}${raffleId}`;
    const userRafflesKey = `${USER_RAFFLES_PREFIX}${userId}`;

    const now = Date.now();
    const entryId = `entry_${now}_${nanoid(8)}`;

    const raffle = await kv.get<Raffle>(raffleKey);
    if (!raffle) return { success: false, message: "活动不存在" };

    if (getRaffleMode(raffle) !== "red_packet") {
      return { success: false, message: "当前活动不是抢红包" };
    }

    if (raffle.status !== "active") {
      if (raffle.status === "draft") return { success: false, message: "活动尚未开始" };
      if (raffle.status === "ended") return { success: false, message: "红包已抢完" };
      if (raffle.status === "cancelled") return { success: false, message: "活动已取消" };
      return { success: false, message: "活动状态异常" };
    }

    const alreadyJoined = await kv.sismember(participantsKey, userId);
    if (alreadyJoined === 1) return { success: false, message: "您已经抢过红包了" };

    const packets = normalizeRemainingRedPacketPackets(raffle);
    const packetAmount = packets.shift();

    if (typeof packetAmount !== "number" || !Number.isSafeInteger(packetAmount) || packetAmount <= 0) {
      const ended: Raffle = {
        ...raffle,
        status: "ended",
        drawnAt: raffle.drawnAt ?? now,
        redPacketRemainingPoints: 0,
        redPacketRemainingSlots: 0,
        redPacketPackets: [],
        updatedAt: now,
      };
      await Promise.all([
        kv.set(raffleKey, ended),
        kv.srem(RAFFLE_ACTIVE_KEY, raffleId),
      ]);
      return { success: false, message: "红包已抢完" };
    }

    const amount = packetAmount;
    const entryNumber = await kv.incr(entryCountKey);
    const entry: RaffleEntry = {
      id: entryId,
      raffleId,
      userId,
      username,
      entryNumber,
      createdAt: now,
    };

    const remainingPoints = sumRedPacketPackets(packets);
    const isLastPacket = packets.length === 0;
    const winner: RaffleWinner = {
      entryId,
      userId,
      username,
      prizeId: "red_packet",
      prizeName: "抢红包",
      points: amount,
      rewardStatus: "pending",
    };

    const originalRaffle: Raffle = { ...raffle };
    let entryWritten = false;
    let participantWritten = false;
    let userRaffleWritten = false;
    let raffleUpdated = false;

    try {
      await kv.lpush(entriesKey, entry);
      entryWritten = true;
      await kv.sadd(participantsKey, userId);
      participantWritten = true;
      await kv.sadd(userRafflesKey, raffleId);
      userRaffleWritten = true;

      const updated: Raffle = {
        ...raffle,
        mode: "red_packet",
        participantsCount: (raffle.participantsCount ?? 0) + 1,
        winnersCount: (raffle.winnersCount ?? 0) + 1,
        winners: [...(raffle.winners ?? []), winner],
        status: isLastPacket ? "ended" : "active",
        drawnAt: isLastPacket ? now : raffle.drawnAt,
        redPacketRemainingPoints: remainingPoints,
        redPacketRemainingSlots: packets.length,
        redPacketPackets: packets,
        updatedAt: now,
      };

      const updateTasks: Promise<unknown>[] = [kv.set(raffleKey, updated)];
      if (isLastPacket) {
        updateTasks.push(kv.srem(RAFFLE_ACTIVE_KEY, raffleId));
      }
      await Promise.all(updateTasks);
      raffleUpdated = true;

      try {
        const deliveryResults = await deliverRewards(raffleId, [winner]);
        const deliveryResult = deliveryResults[0];
        const latestRaffle = await getRaffle(raffleId);
        const deliveredWinner = latestRaffle?.winners?.find((item) => item.entryId === entryId) ?? winner;

        return {
          success: true,
          message: deliveryResult?.success
            ? `抢到 ${amount} 积分，已到账`
            : `抢到 ${amount} 积分，发放确认中`,
          entry,
          reward: deliveredWinner,
        };
      } catch (deliveryError) {
        console.error("红包积分发放确认失败", {
          raffleId,
          userId: maskUserId(userId),
          error: deliveryError,
        });

        return {
          success: true,
          message: `抢到 ${amount} 积分，发放确认中`,
          entry,
          reward: winner,
        };
      }
    } catch (error) {
      if (raffleUpdated) {
        await kv.set(raffleKey, originalRaffle).catch((rollbackError) => {
          console.error("Rollback red packet raffle failed:", rollbackError);
        });
      }
      if (userRaffleWritten) {
        await kv.srem(userRafflesKey, raffleId).catch((rollbackError) => {
          console.error("Rollback user raffle index failed:", rollbackError);
        });
      }
      if (participantWritten) {
        await kv.srem(participantsKey, userId).catch((rollbackError) => {
          console.error("Rollback red packet participant membership failed:", rollbackError);
        });
      }
      if (entryWritten) {
        await kv.lrem(entriesKey, 1, entry).catch((rollbackError) => {
          console.error("Rollback red packet entry list failed:", rollbackError);
        });
      }
      throw error;
    }
  });
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

  // 查找用户的参与记录和活动详情（并行）
  const entriesKey = `${RAFFLE_ENTRIES_PREFIX}${raffleId}`;
  const [entries, raffle] = await Promise.all([
    kv.lrange<RaffleEntry>(entriesKey, 0, -1),
    getRaffle(raffleId),
  ]);
  const entry = entries.find((e) => e.userId === userId);

  // 检查是否中奖
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
    const j = randomInt(i + 1);
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
  processingStartedAt?: number;
  processingToken?: string;
}

type DeliveryIdempotencyStatus = "processing" | "delivered" | "uncertain";

interface DeliveryIdempotencyState {
  status: DeliveryIdempotencyStatus;
  updatedAt: number;
  message?: string;
}

function getDeliveryQueueFlagKey(raffleId: string): string {
  return `${RAFFLE_DELIVERY_ENQUEUED_PREFIX}${raffleId}`;
}

function getDeliveryIdempotencyKey(raffleId: string, entryId: string): string {
  return `${RAFFLE_DELIVERY_IDEMPOTENCY_PREFIX}${raffleId}:${entryId}`;
}

function normalizeDeliveryQueueJob(job: DeliveryQueueJob): DeliveryQueueJob {
  return {
    raffleId: job.raffleId,
    reason: job.reason === "draw" ? "draw" : "retry",
    enqueuedAt: typeof job.enqueuedAt === "number" ? job.enqueuedAt : Date.now(),
    attempts: Math.max(0, Math.floor(job.attempts ?? 0)),
    processingStartedAt:
      typeof job.processingStartedAt === "number" ? job.processingStartedAt : undefined,
    processingToken: typeof job.processingToken === "string" ? job.processingToken : undefined,
  };
}

function buildRetryDeliveryJob(job: DeliveryQueueJob, now = Date.now()): DeliveryQueueJob {
  const normalizedJob = normalizeDeliveryQueueJob(job);
  return {
    raffleId: normalizedJob.raffleId,
    reason: "retry",
    enqueuedAt: now,
    attempts: normalizedJob.attempts + 1,
  };
}

async function popDeliveryJobToProcessingQueue(): Promise<string | null> {
  const now = Date.now();
  const processingToken = nanoid(10);

  const raw = await kv.rpop(RAFFLE_DELIVERY_QUEUE_KEY);
  if (!raw) return null;

  let rawStr: string;
  if (typeof raw === "string") {
    rawStr = raw;
  } else if (typeof raw === "object") {
    try {
      rawStr = JSON.stringify(raw);
    } catch {
      return null;
    }
  } else {
    return null;
  }

  try {
    const decoded = JSON.parse(rawStr) as DeliveryQueueJob;
    decoded.processingStartedAt = now;
    decoded.processingToken = processingToken;
    const encoded = JSON.stringify(decoded);
    await kv.lpush(RAFFLE_DELIVERY_PROCESSING_QUEUE_KEY, encoded);
    return encoded;
  } catch {
    await kv.lpush(RAFFLE_DELIVERY_PROCESSING_QUEUE_KEY, rawStr);
    return rawStr;
  }
}

async function ackProcessingDeliveryJob(rawProcessingJob: string): Promise<boolean> {
  const removed = await kv.lrem(RAFFLE_DELIVERY_PROCESSING_QUEUE_KEY, 1, rawProcessingJob);
  return Number(removed) > 0;
}

async function requeueProcessingDeliveryJob(
  rawProcessingJob: string,
  jobToRequeue: DeliveryQueueJob
): Promise<boolean> {
  const removed = await kv.lrem(RAFFLE_DELIVERY_PROCESSING_QUEUE_KEY, 1, rawProcessingJob);
  if (Number(removed) > 0) {
    await kv.lpush(RAFFLE_DELIVERY_QUEUE_KEY, JSON.stringify(jobToRequeue));
    return true;
  }
  return false;
}

async function recoverTimedOutProcessingDeliveryJobs(now = Date.now()): Promise<number> {
  const processingJobs = await kv.lrange<string>(RAFFLE_DELIVERY_PROCESSING_QUEUE_KEY, 0, -1);
  if (processingJobs.length === 0) {
    return 0;
  }

  let recovered = 0;

  for (const rawProcessingJob of processingJobs) {
    let parsedJob: DeliveryQueueJob | null = null;
    try {
      parsedJob = normalizeDeliveryQueueJob(JSON.parse(rawProcessingJob) as DeliveryQueueJob);
    } catch {
      const removed = await ackProcessingDeliveryJob(rawProcessingJob);
      if (removed) {
        recovered += 1;
      }
      continue;
    }

    if (!parsedJob.raffleId) {
      const removed = await ackProcessingDeliveryJob(rawProcessingJob);
      if (removed) {
        recovered += 1;
      }
      continue;
    }

    const startedAt = parsedJob.processingStartedAt ?? parsedJob.enqueuedAt;
    if (now - startedAt < DELIVERY_JOB_PROCESSING_TIMEOUT_MS) {
      continue;
    }

    const retryJob = buildRetryDeliveryJob(parsedJob, now);
    const moved = await requeueProcessingDeliveryJob(rawProcessingJob, retryJob);
    if (moved) {
      recovered += 1;
    }
  }

  return recovered;
}

function parseDeliveryIdempotencyState(
  rawState: DeliveryIdempotencyState | DeliveryIdempotencyStatus | null
): DeliveryIdempotencyState | null {
  if (!rawState) return null;

  if (typeof rawState === "string") {
    if (
      rawState === "processing" ||
      rawState === "delivered" ||
      rawState === "uncertain"
    ) {
      return {
        status: rawState,
        updatedAt: Date.now(),
      };
    }
    return null;
  }

  if (
    typeof rawState.status !== "string" ||
    (rawState.status !== "processing" &&
      rawState.status !== "delivered" &&
      rawState.status !== "uncertain")
  ) {
    return null;
  }

  return {
    status: rawState.status,
    updatedAt:
      typeof rawState.updatedAt === "number" && Number.isFinite(rawState.updatedAt)
        ? rawState.updatedAt
        : Date.now(),
    message: typeof rawState.message === "string" ? rawState.message : undefined,
  };
}

async function getDeliveryIdempotencyState(
  raffleId: string,
  entryId: string
): Promise<DeliveryIdempotencyState | null> {
  const key = getDeliveryIdempotencyKey(raffleId, entryId);
  const rawState = await kv.get<DeliveryIdempotencyState | DeliveryIdempotencyStatus>(key);
  return parseDeliveryIdempotencyState(rawState ?? null);
}

async function setDeliveryIdempotencyState(
  raffleId: string,
  entryId: string,
  state: DeliveryIdempotencyState,
  ttlSeconds: number,
  options?: {
    nx?: boolean;
  }
): Promise<boolean> {
  const setOptions = options?.nx
    ? { ex: ttlSeconds, nx: true as const }
    : { ex: ttlSeconds };

  const setResult = await kv.set(getDeliveryIdempotencyKey(raffleId, entryId), state, setOptions);

  return setResult === "OK";
}

async function clearDeliveryIdempotencyState(raffleId: string, entryId: string): Promise<void> {
  await kv.del(getDeliveryIdempotencyKey(raffleId, entryId));
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
  const current = await kv.get<string>(lockKey);
  if (current === lockToken) {
    await kv.del(lockKey);
  }
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

  const lockToken = await acquireDrawLock(raffleId);
  if (!lockToken) {
    return { success: false, message: "正在开奖中，请稍后" };
  }

  try {
    const preparation = await withRaffleJoinLock(raffleId, async () => {
      const raffle = await getRaffle(raffleId);
      if (!raffle) {
        return { success: false as const, message: "活动不存在", winners: [] as RaffleWinner[] };
      }

      if (getRaffleMode(raffle) === "red_packet") {
        return { success: false as const, message: "抢红包活动无需开奖", winners: [] as RaffleWinner[] };
      }

      if (raffle.status !== "active") {
        return { success: false as const, message: "活动状态不是进行中", winners: [] as RaffleWinner[] };
      }

      const entriesKey = `${RAFFLE_ENTRIES_PREFIX}${raffleId}`;
      const entries = await kv.lrange<RaffleEntry>(entriesKey, 0, -1);

      if (entries.length === 0) {
        const updated: Raffle = {
          ...raffle,
          status: "ended",
          drawnAt: Date.now(),
          winners: [],
          winnersCount: 0,
          updatedAt: Date.now(),
        };
        await Promise.all([
          kv.set(`${RAFFLE_PREFIX}${raffleId}`, updated),
          kv.srem(RAFFLE_ACTIVE_KEY, raffleId),
        ]);

        return {
          success: true as const,
          message: "无人参与，活动已结束",
          winners: [] as RaffleWinner[],
        };
      }

      const shuffled = shuffleArray(entries);
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
            points: getRafflePrizePoints(prize),
            rewardStatus: "pending",
          });
          winnerIndex++;
        }
      }

      const now = Date.now();
      const updated: Raffle = {
        ...raffle,
        status: "ended",
        drawnAt: now,
        winners,
        winnersCount: winners.length,
        updatedAt: now,
      };

      await Promise.all([
        kv.set(`${RAFFLE_PREFIX}${raffleId}`, updated),
        kv.srem(RAFFLE_ACTIVE_KEY, raffleId),
      ]);

      return {
        success: true as const,
        message: `开奖成功，共 ${winners.length} 人中奖`,
        winners,
      };
    });

    if (!preparation.success) {
      return { success: false, message: preparation.message };
    }

    const winners = preparation.winners;

    if (winners.length === 0) {
      return { success: true, message: preparation.message, winners: [] };
    }

    if (!waitForDelivery) {
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

    const deliveryResults = await deliverRewards(raffleId, winners);

    return {
      success: true,
      message: `开奖成功，共 ${winners.length} 人中奖`,
      winners,
      deliveryResults,
    };
  } finally {
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
      if (winner.rewardStatus === "delivered") {
        return {
          winnerIndex,
          winner,
          result: {
            userId: winner.userId,
            username: winner.username,
            prizeName: winner.prizeName,
            success: true,
            message: winner.rewardMessage ?? "奖励已发放（幂等跳过）",
          },
        };
      }

      const idempotencyKey = getDeliveryIdempotencyKey(raffleId, winner.entryId);
      const idempotencyState = await getDeliveryIdempotencyState(raffleId, winner.entryId);
      if (idempotencyState?.status === "delivered") {
        const deliveredWinner: RaffleWinner = {
          ...winner,
          rewardStatus: "delivered",
          rewardMessage: idempotencyState.message ?? winner.rewardMessage ?? "奖励已发放（幂等跳过）",
          deliveredAt: winner.deliveredAt ?? idempotencyState.updatedAt,
        };

        return {
          winnerIndex,
          winner: deliveredWinner,
          result: {
            userId: winner.userId,
            username: winner.username,
            prizeName: winner.prizeName,
            success: true,
            message: deliveredWinner.rewardMessage ?? "奖励已发放（幂等跳过）",
          },
        };
      }

      if (idempotencyState?.status === "processing") {
        return {
          winnerIndex,
          winner: {
            ...winner,
            rewardStatus: "pending",
            rewardMessage: idempotencyState.message ?? "奖励发放处理中",
          },
          result: {
            userId: winner.userId,
            username: winner.username,
            prizeName: winner.prizeName,
            success: false,
            message: idempotencyState.message ?? "奖励发放处理中",
          },
        };
      }

      const attemptedAt = Date.now();
      const rewardAttempts = (winner.rewardAttempts ?? 0) + 1;
      const processingMessage = "奖励发放处理中";

      const processingLocked = await setDeliveryIdempotencyState(
        raffleId,
        winner.entryId,
        {
          status: "processing",
          updatedAt: attemptedAt,
          message: processingMessage,
        },
        DELIVERY_IDEMPOTENCY_PROCESSING_TTL_SECONDS,
        { nx: true }
      );

      if (!processingLocked) {
        const latestState = await getDeliveryIdempotencyState(raffleId, winner.entryId);
        if (latestState?.status === "delivered") {
          const deliveredWinner: RaffleWinner = {
            ...winner,
            rewardStatus: "delivered",
            rewardMessage: latestState.message ?? winner.rewardMessage ?? "奖励已发放（幂等跳过）",
            deliveredAt: winner.deliveredAt ?? latestState.updatedAt,
          };

          return {
            winnerIndex,
            winner: deliveredWinner,
            result: {
              userId: winner.userId,
              username: winner.username,
              prizeName: winner.prizeName,
              success: true,
              message: deliveredWinner.rewardMessage ?? "奖励已发放（幂等跳过）",
            },
          };
        }

        return {
          winnerIndex,
          winner: {
            ...winner,
            rewardStatus: "pending",
            rewardMessage: latestState?.message ?? "奖励发放处理中",
          },
          result: {
            userId: winner.userId,
            username: winner.username,
            prizeName: winner.prizeName,
            success: false,
            message: latestState?.message ?? "奖励发放处理中",
          },
        };
      }

      try {
        const points = getRaffleWinnerPoints(winner);
        if (points <= 0) {
          throw new Error("奖品积分配置异常");
        }

        const pointsResult = await addPoints(
          winner.userId,
          points,
          "raffle_win",
          `多人抽奖：${raffle.title} - ${winner.prizeName}`
        );
        const successMessage = `已发放 ${points} 积分，当前余额 ${pointsResult.balance}`;

        await setDeliveryIdempotencyState(
          raffleId,
          winner.entryId,
          {
            status: "delivered",
            updatedAt: Date.now(),
            message: successMessage,
          },
          DELIVERY_IDEMPOTENCY_DELIVERED_TTL_SECONDS
        );

        const deliveredWinner: RaffleWinner = {
          ...winner,
          points,
          rewardStatus: "delivered",
          rewardMessage: successMessage,
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
          console.error("记录中奖记录失败", { userId: maskUserId(winner.userId), error: logError });
        }

        try {
          await createUserNotification({
            userId: winner.userId,
            type: 'raffle_win',
            title: '多人抽奖中奖：' + raffle.title,
            content: '恭喜获得 ' + winner.prizeName + '（' + points + ' 积分）',
            data: {
              raffleId,
              prizeName: winner.prizeName,
              points,
              entryId: winner.entryId,
            },
          });
        } catch (notifyError) {
          console.error("记录中奖通知失败", { userId: maskUserId(winner.userId), error: notifyError });
        }

        return {
          winnerIndex,
          winner: deliveredWinner,
          result: {
            userId: winner.userId,
            username: winner.username,
            prizeName: winner.prizeName,
            success: true,
            message: successMessage,
          },
        };
      } catch (error) {
        console.error("发放奖励失败", { userId: maskUserId(winner.userId), error });
        const uncertainMessage = error instanceof Error ? error.message : "发放异常";

        try {
          await setDeliveryIdempotencyState(
            raffleId,
            winner.entryId,
            {
              status: "uncertain",
              updatedAt: Date.now(),
              message: uncertainMessage,
            },
            DELIVERY_IDEMPOTENCY_UNCERTAIN_TTL_SECONDS
          );
        } catch (idempotencyError) {
          console.error("写入发放 uncertain 状态失败", {
            userId: maskUserId(winner.userId),
            error: idempotencyError,
          });
        }

        return {
          winnerIndex,
          winner: {
            ...winner,
            rewardStatus: "pending",
            rewardMessage: uncertainMessage,
            rewardAttemptedAt: attemptedAt,
            rewardAttempts,
          },
          result: {
            userId: winner.userId,
            username: winner.username,
            prizeName: winner.prizeName,
            success: false,
            message: uncertainMessage,
          },
        };
      } finally {
        const finalState = await kv.get<DeliveryIdempotencyState | DeliveryIdempotencyStatus>(
          idempotencyKey
        );
        const normalizedFinalState = parseDeliveryIdempotencyState(finalState ?? null);
        if (normalizedFinalState?.status === "processing") {
          await clearDeliveryIdempotencyState(raffleId, winner.entryId);
        }
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

  await recoverTimedOutProcessingDeliveryJobs();

  let processedJobs = 0;
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  let skippedJobs = 0;
  let lockedJobs = 0;

  for (let i = 0; i < jobsLimit; i++) {
    const rawProcessingJob = await popDeliveryJobToProcessingQueue();
    if (!rawProcessingJob) {
      break;
    }

    let job: DeliveryQueueJob | null = null;
    try {
      job = normalizeDeliveryQueueJob(JSON.parse(rawProcessingJob) as DeliveryQueueJob);
    } catch {
      await ackProcessingDeliveryJob(rawProcessingJob);
      continue;
    }

    if (!job?.raffleId) {
      await ackProcessingDeliveryJob(rawProcessingJob);
      continue;
    }

    const flagKey = getDeliveryQueueFlagKey(job.raffleId);
    const result = await processRaffleDeliveryJob(job.raffleId);

    if (result.status === "locked") {
      lockedJobs += 1;

      await requeueProcessingDeliveryJob(rawProcessingJob, buildRetryDeliveryJob(job));
      continue;
    }

    if (result.status === "skipped") {
      skippedJobs += 1;
      if (result.waitingPending > 0) {
        await requeueProcessingDeliveryJob(rawProcessingJob, buildRetryDeliveryJob(job));
      } else {
        await ackProcessingDeliveryJob(rawProcessingJob);
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
      await requeueProcessingDeliveryJob(rawProcessingJob, buildRetryDeliveryJob(job));
    } else {
      await ackProcessingDeliveryJob(rawProcessingJob);
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

    const mode = getRaffleMode(raffle);

    const retryWithCurrentRaffle = async (currentRaffle: Raffle): Promise<DrawRaffleResult> => {
      const retryableStatus = mode === "red_packet"
        ? currentRaffle.status === "active" || currentRaffle.status === "ended"
        : currentRaffle.status === "ended";

      if (!retryableStatus || !currentRaffle.winners) {
        return { success: false, message: "活动未产生可重试的奖励记录" };
      }

      const now = Date.now();
      const retryCandidates = getRetryableWinners(currentRaffle, now);

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
    };

    if (mode === "red_packet") {
      return await withRaffleJoinLock(raffleId, async () => {
        const latestRaffle = await getRaffle(raffleId);
        if (!latestRaffle) {
          return { success: false, message: "活动不存在" };
        }
        return retryWithCurrentRaffle(latestRaffle);
      });
    }

    return await retryWithCurrentRaffle(raffle);
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




