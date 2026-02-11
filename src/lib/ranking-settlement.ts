import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { createUserNotification } from './notifications';
import { addPoints } from './points';
import {
  getAllGamesLeaderboardByRange,
  type OverallLeaderboardEntry,
} from './rankings';

const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const LOCK_TTL_SECONDS = 60;
const HISTORY_MAX_PAGE_SIZE = 50;
const REWARD_KEY_TTL_SECONDS = 400 * 24 * 60 * 60;

const DEFAULT_WEEKLY_REWARDS = [500, 300, 200, 100, 50];
const DEFAULT_MONTHLY_REWARDS = [1500, 1000, 600, 300, 200, 100];

export type RankingSettlementPeriod = 'weekly' | 'monthly';
export type RankingSettlementStatus = 'success' | 'partial' | 'failed';

export interface RankingRewardPolicy {
  topN: number;
  rewardPoints: number[];
}

export interface RankingSettlementReward {
  rank: number;
  userId: number;
  username: string;
  totalScore: number;
  totalPoints: number;
  gamesPlayed: number;
  rewardPoints: number;
  status: 'granted' | 'skipped' | 'failed';
  reason?: string;
  balance?: number;
  processedAt: number;
}

export interface RankingSettlementSummary {
  granted: number;
  skipped: number;
  failed: number;
  totalRewardPoints: number;
}

export interface RankingSettlementRecord {
  id: string;
  period: RankingSettlementPeriod;
  periodStart: number;
  periodEnd: number;
  periodLabel: string;
  status: RankingSettlementStatus;
  rewardPolicy: RankingRewardPolicy;
  totalParticipants: number;
  rewards: RankingSettlementReward[];
  summary: RankingSettlementSummary;
  createdAt: number;
  settledAt: number;
  retryCount: number;
  triggeredBy: {
    id: number;
    username: string;
  };
}

export interface RankingSettlementPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface RankingSettlementHistoryResult {
  period: RankingSettlementPeriod;
  pagination: RankingSettlementPagination;
  items: RankingSettlementRecord[];
}

export interface SettleRankingInput {
  period: RankingSettlementPeriod;
  operator: {
    id: number;
    username: string;
  };
  topN?: number;
  rewardPoints?: number[];
  dryRun?: boolean;
  retryFailed?: boolean;
  referenceTime?: number;
}

export interface SettleRankingResult {
  alreadySettled: boolean;
  retried: boolean;
  record: RankingSettlementRecord;
}

interface SettlementRange {
  startAt: number;
  endAt: number;
  label: string;
}

const SETTLEMENT_RECORD_KEY = (period: RankingSettlementPeriod, startAt: number, endAt: number) =>
  `rankings:settlement:record:${period}:${startAt}:${endAt}`;
const SETTLEMENT_INDEX_KEY = (period: RankingSettlementPeriod) =>
  `rankings:settlement:index:${period}`;
const SETTLEMENT_LOCK_KEY = (period: RankingSettlementPeriod, startAt: number, endAt: number) =>
  `rankings:settlement:lock:${period}:${startAt}:${endAt}`;
const SETTLEMENT_REWARDED_KEY = (
  period: RankingSettlementPeriod,
  startAt: number,
  endAt: number,
  userId: number,
) => `rankings:settlement:rewarded:${period}:${startAt}:${endAt}:${userId}`;

function toFiniteNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getChinaDate(date: Date = new Date()): Date {
  return new Date(date.getTime() + CHINA_TZ_OFFSET_MS);
}

function chinaDayStartToUtc(chinaDate: Date): number {
  const start = new Date(chinaDate);
  start.setUTCHours(0, 0, 0, 0);
  return start.getTime() - CHINA_TZ_OFFSET_MS;
}

function formatChinaDate(timestamp: number): string {
  const d = getChinaDate(new Date(timestamp));
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPreviousSettlementRange(
  period: RankingSettlementPeriod,
  referenceTime: number = Date.now(),
): SettlementRange {
  const nowChina = getChinaDate(new Date(referenceTime));

  if (period === 'weekly') {
    const currentWeekStart = new Date(nowChina);
    currentWeekStart.setUTCHours(0, 0, 0, 0);
    const day = currentWeekStart.getUTCDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - diffToMonday);

    const endAt = currentWeekStart.getTime() - CHINA_TZ_OFFSET_MS;
    const startAt = endAt - 7 * 24 * 60 * 60 * 1000;

    return {
      startAt,
      endAt,
      label: `${formatChinaDate(startAt)} ~ ${formatChinaDate(endAt - 1)}`,
    };
  }

  const currentMonthStart = new Date(nowChina);
  currentMonthStart.setUTCDate(1);
  currentMonthStart.setUTCHours(0, 0, 0, 0);

  const endAt = currentMonthStart.getTime() - CHINA_TZ_OFFSET_MS;
  const previousMonthStart = new Date(currentMonthStart);
  previousMonthStart.setUTCMonth(previousMonthStart.getUTCMonth() - 1);
  const startAt = previousMonthStart.getTime() - CHINA_TZ_OFFSET_MS;

  return {
    startAt,
    endAt,
    label: `${formatChinaDate(startAt)} ~ ${formatChinaDate(endAt - 1)}`,
  };
}

function normalizeRewardPolicy(input: SettleRankingInput): RankingRewardPolicy {
  const defaultRewards = input.period === 'weekly' ? DEFAULT_WEEKLY_REWARDS : DEFAULT_MONTHLY_REWARDS;

  const normalizedRewards = (input.rewardPoints ?? defaultRewards)
    .map((value) => Math.max(0, Math.floor(toFiniteNumber(value))))
    .filter((value) => value >= 0);

  const rewardPoints = normalizedRewards.length > 0 ? normalizedRewards : defaultRewards;

  const topNRaw = input.topN ?? rewardPoints.length;
  const topN = Math.max(1, Math.min(100, Math.floor(toFiniteNumber(topNRaw))));

  if (rewardPoints.length >= topN) {
    return {
      topN,
      rewardPoints: rewardPoints.slice(0, topN),
    };
  }

  const padded = [...rewardPoints];
  while (padded.length < topN) {
    padded.push(0);
  }

  return {
    topN,
    rewardPoints: padded,
  };
}

function getSettleStatusFromRewards(rewards: RankingSettlementReward[]): RankingSettlementStatus {
  const failed = rewards.some((item) => item.status === 'failed');
  if (failed) return 'partial';
  return 'success';
}

function summarizeRewards(rewards: RankingSettlementReward[]): RankingSettlementSummary {
  return rewards.reduce<RankingSettlementSummary>(
    (summary, reward) => {
      if (reward.status === 'granted') {
        summary.granted += 1;
        summary.totalRewardPoints += reward.rewardPoints;
      } else if (reward.status === 'failed') {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }
      return summary;
    },
    {
      granted: 0,
      skipped: 0,
      failed: 0,
      totalRewardPoints: 0,
    }
  );
}

async function createRewardNotification(
  userId: number,
  period: RankingSettlementPeriod,
  rank: number,
  rewardPoints: number,
  periodLabel: string,
): Promise<void> {
  await createUserNotification({
    userId,
    type: 'system',
    title: `排行榜奖励已发放（${period === 'weekly' ? '周榜' : '月榜'}）`,
    content: `你在 ${periodLabel} 的${period === 'weekly' ? '周榜' : '月榜'}中获得第 ${rank} 名，奖励 ${rewardPoints} 积分已到账。`,
    data: {
      kind: 'ranking_reward',
      period,
      rank,
      rewardPoints,
      periodLabel,
    },
  });
}

async function settleSingleReward(
  period: RankingSettlementPeriod,
  range: SettlementRange,
  winner: OverallLeaderboardEntry,
  rewardPoints: number,
  dryRun: boolean,
): Promise<RankingSettlementReward> {
  const processedAt = Date.now();
  const base: RankingSettlementReward = {
    rank: winner.rank,
    userId: winner.userId,
    username: winner.username,
    totalScore: winner.totalScore,
    totalPoints: winner.totalPoints,
    gamesPlayed: winner.gamesPlayed,
    rewardPoints,
    status: 'skipped',
    processedAt,
  };

  if (rewardPoints <= 0) {
    return { ...base, reason: 'reward_zero' };
  }

  if (dryRun) {
    return { ...base, reason: 'dry_run' };
  }

  const rewardKey = SETTLEMENT_REWARDED_KEY(period, range.startAt, range.endAt, winner.userId);
  const lockResult = await kv.set(rewardKey, String(processedAt), {
    nx: true,
    ex: REWARD_KEY_TTL_SECONDS,
  });

  if (lockResult !== 'OK') {
    return { ...base, reason: 'already_rewarded' };
  }

  try {
    const pointsResult = await addPoints(
      winner.userId,
      rewardPoints,
      'ranking_reward',
      `${period === 'weekly' ? '周榜' : '月榜'}奖励：第${winner.rank}名`
    );

    await createRewardNotification(
      winner.userId,
      period,
      winner.rank,
      rewardPoints,
      range.label,
    );

    return {
      ...base,
      status: 'granted',
      balance: pointsResult.balance,
    };
  } catch (error) {
    await kv.del(rewardKey);
    const reason = error instanceof Error ? error.message.slice(0, 200) : 'unknown_error';
    return {
      ...base,
      status: 'failed',
      reason,
    };
  }
}

function buildRecordId(period: RankingSettlementPeriod, range: SettlementRange): string {
  return `${period}:${range.startAt}:${range.endAt}:${nanoid(6)}`;
}

async function getSettlementRecord(
  period: RankingSettlementPeriod,
  range: SettlementRange,
): Promise<RankingSettlementRecord | null> {
  return kv.get<RankingSettlementRecord>(SETTLEMENT_RECORD_KEY(period, range.startAt, range.endAt));
}

async function saveSettlementRecord(record: RankingSettlementRecord): Promise<void> {
  await Promise.all([
    kv.set(SETTLEMENT_RECORD_KEY(record.period, record.periodStart, record.periodEnd), record),
    kv.zadd(SETTLEMENT_INDEX_KEY(record.period), {
      score: record.periodEnd,
      member: record.id,
    }),
  ]);
}

async function retryFailedRewards(
  existing: RankingSettlementRecord,
  input: SettleRankingInput,
  range: SettlementRange,
): Promise<RankingSettlementRecord> {
  const nextRewards = [...existing.rewards];
  let retried = false;

  for (let idx = 0; idx < nextRewards.length; idx += 1) {
    const reward = nextRewards[idx];
    if (reward.status !== 'failed' || reward.rewardPoints <= 0) {
      continue;
    }

    retried = true;
    const winner: OverallLeaderboardEntry = {
      rank: reward.rank,
      userId: reward.userId,
      username: reward.username,
      totalScore: reward.totalScore,
      totalPoints: reward.totalPoints,
      gamesPlayed: reward.gamesPlayed,
      gameBreakdown: {},
    };

    nextRewards[idx] = await settleSingleReward(
      existing.period,
      range,
      winner,
      reward.rewardPoints,
      Boolean(input.dryRun),
    );
  }

  if (!retried) {
    return existing;
  }

  const next: RankingSettlementRecord = {
    ...existing,
    rewards: nextRewards,
    summary: summarizeRewards(nextRewards),
    status: getSettleStatusFromRewards(nextRewards),
    retryCount: existing.retryCount + 1,
    settledAt: Date.now(),
    triggeredBy: {
      id: input.operator.id,
      username: input.operator.username,
    },
  };

  await saveSettlementRecord(next);
  return next;
}

export async function settleRankingPeriod(input: SettleRankingInput): Promise<SettleRankingResult> {
  const range = getPreviousSettlementRange(input.period, input.referenceTime);
  const recordKey = SETTLEMENT_RECORD_KEY(input.period, range.startAt, range.endAt);

  const existing = await getSettlementRecord(input.period, range);
  if (existing && !input.retryFailed) {
    return {
      alreadySettled: true,
      retried: false,
      record: existing,
    };
  }

  const lockKey = SETTLEMENT_LOCK_KEY(input.period, range.startAt, range.endAt);
  const lockOk = await kv.set(lockKey, String(Date.now()), {
    nx: true,
    ex: LOCK_TTL_SECONDS,
  });
  if (lockOk !== 'OK') {
    throw new Error('结算任务正在进行中，请稍后重试');
  }

  try {
    const latest = await kv.get<RankingSettlementRecord>(recordKey);
    if (latest) {
      if (input.retryFailed) {
        const retriedRecord = await retryFailedRewards(latest, input, range);
        return {
          alreadySettled: false,
          retried: true,
          record: retriedRecord,
        };
      }

      return {
        alreadySettled: true,
        retried: false,
        record: latest,
      };
    }

    const rewardPolicy = normalizeRewardPolicy(input);
    const snapshot = await getAllGamesLeaderboardByRange(
      range.startAt,
      range.endAt,
      {
        limitPerGame: 100,
        overallLimit: rewardPolicy.topN,
      }
    );

    const winners = snapshot.overall.slice(0, rewardPolicy.topN);
    const rewards: RankingSettlementReward[] = [];

    for (let index = 0; index < winners.length; index += 1) {
      const winner = winners[index];
      const rewardPoints = rewardPolicy.rewardPoints[index] ?? 0;
      const reward = await settleSingleReward(
        input.period,
        range,
        winner,
        rewardPoints,
        Boolean(input.dryRun),
      );
      rewards.push(reward);
    }

    const now = Date.now();
    const record: RankingSettlementRecord = {
      id: buildRecordId(input.period, range),
      period: input.period,
      periodStart: range.startAt,
      periodEnd: range.endAt,
      periodLabel: range.label,
      status: getSettleStatusFromRewards(rewards),
      rewardPolicy,
      totalParticipants: snapshot.overall.length,
      rewards,
      summary: summarizeRewards(rewards),
      createdAt: now,
      settledAt: now,
      retryCount: 0,
      triggeredBy: {
        id: input.operator.id,
        username: input.operator.username,
      },
    };

    await saveSettlementRecord(record);

    return {
      alreadySettled: false,
      retried: false,
      record,
    };
  } finally {
    await kv.del(lockKey);
  }
}

function normalizePage(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value as number));
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(HISTORY_MAX_PAGE_SIZE, Math.max(1, Math.floor(value as number)));
}

function buildPagination(page: number, limit: number, total: number): RankingSettlementPagination {
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}

export async function listRankingSettlementHistory(
  period: RankingSettlementPeriod,
  options: { page?: number; limit?: number } = {}
): Promise<RankingSettlementHistoryResult> {
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);

  const indexKey = SETTLEMENT_INDEX_KEY(period);
  const totalRaw = await kv.zcard(indexKey);
  const total = Number(totalRaw) || 0;

  const start = (page - 1) * limit;
  const end = start + limit - 1;

  const ids = await kv.zrange<string[]>(indexKey, start, end, { rev: true });
  const records =
    Array.isArray(ids) && ids.length > 0
      ? await kv.mget<(RankingSettlementRecord | null)[]>(
          ...ids.map((id) => {
            const parts = id.split(':');
            if (parts.length >= 3) {
              const periodFromId = parts[0] as RankingSettlementPeriod;
              const startAt = Number(parts[1]);
              const endAt = Number(parts[2]);
              if ((periodFromId === 'weekly' || periodFromId === 'monthly') && Number.isFinite(startAt) && Number.isFinite(endAt)) {
                return SETTLEMENT_RECORD_KEY(periodFromId, startAt, endAt);
              }
            }
            return '';
          }).filter(Boolean)
        )
      : [];

  const items = (records ?? []).filter((item): item is RankingSettlementRecord => item !== null);

  return {
    period,
    pagination: buildPagination(page, limit, total),
    items,
  };
}

export function getCurrentSettlementWindow(period: RankingSettlementPeriod): {
  startAt: number;
  endAt: number;
} {
  const nowChina = getChinaDate();

  if (period === 'weekly') {
    const start = new Date(nowChina);
    start.setUTCHours(0, 0, 0, 0);
    const day = start.getUTCDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    start.setUTCDate(start.getUTCDate() - diffToMonday);
    const startAt = start.getTime() - CHINA_TZ_OFFSET_MS;
    return {
      startAt,
      endAt: startAt + 7 * 24 * 60 * 60 * 1000,
    };
  }

  const start = new Date(nowChina);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const startAt = start.getTime() - CHINA_TZ_OFFSET_MS;
  const nextMonth = new Date(start);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

  return {
    startAt,
    endAt: nextMonth.getTime() - CHINA_TZ_OFFSET_MS,
  };
}

export function getTodayStartUtcInChina(now: number = Date.now()): number {
  return chinaDayStartToUtc(getChinaDate(new Date(now)));
}
