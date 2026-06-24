import { kv } from '@/lib/d1-kv';
import { getAllProjects, getAllUsers } from './kv';
import { getUserPoints } from './points';
import { getActiveAlerts, triggerAlert, resolveAlert, getDailyStats } from './metrics';
import { listAllFeedback } from './feedback';
import { listPublishedAnnouncements } from './announcements';
import { getActiveRaffles } from './raffle';
import { getStoreItems } from './store';
import { getNativePointLogsInRange, isNativeHotStoreReady } from './hot-d1';
import type { PointsLog, PointsSource } from './types/store';

const DASHBOARD_OVERVIEW_CACHE_KEY = 'dashboard:overview:cache';
const DASHBOARD_ALERTS_CACHE_KEY_PREFIX = 'dashboard:alerts:cache:';
const DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS = 2 * 60;
const DASHBOARD_ALERTS_CACHE_TTL_SECONDS = 20;

type CachedSnapshot<T> = {
  createdAt: number;
  data: T;
};

const inFlightDashboardTasks = new Map<string, Promise<unknown>>();

const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const RECENT_SCAN_LIMIT = 200;
const POINTS_ANALYTICS_NATIVE_LIMIT = 100_000;
const POINTS_ANALYTICS_LEGACY_SCAN_LIMIT = 5_000;
const POINTS_ANALYTICS_LEGACY_BATCH_SIZE = 25;
const POINTS_SPIKE_THRESHOLD = 5000;
const LOTTERY_HIGH_FREQUENCY_THRESHOLD = 80;
const DEFAULT_DETECTION_CONCURRENCY = 4;
const MAX_DETECTION_CONCURRENCY = 16;

const GAME_ACTIVITY_KEYS = [
  (userId: number) => `linkgame:records:${userId}`,
  (userId: number) => `match3:records:${userId}`,
  (userId: number) => `memory:records:${userId}`,
  (userId: number) => `game:records:${userId}`,
  (userId: number) => `whack_mole:records:${userId}`,
  (userId: number) => `roguelite:records:${userId}`,
  (userId: number) => `minesweeper:records:${userId}`,
  (userId: number) => `game_2048:records:${userId}`,
];

interface AlertItem {
  id: string;
  level: 'info' | 'warning' | 'critical';
  name: string;
  message: string;
  tags?: Record<string, string | number | boolean>;
  timestamp: number;
  resolved?: boolean;
  resolvedAt?: number;
}

export type DashboardPointsAnalyticsPeriod = 'day' | 'week' | 'month';
export type DashboardPointsDirection = 'earning' | 'spending';

export interface DashboardPointsPathDetail {
  description: string;
  total: number;
  count: number;
}

export interface DashboardPointsPathCategory {
  key: string;
  label: string;
  total: number;
  count: number;
  userCount: number;
  percent: number;
  average: number;
  topDescriptions: DashboardPointsPathDetail[];
}

export interface DashboardPointsPathSeries {
  key: string;
  label: string;
  total: number;
  points: Array<{
    bucketStart: number;
    label: string;
    value: number;
    count: number;
  }>;
}

export interface DashboardPointsDirectionAnalytics {
  total: number;
  count: number;
  userCount: number;
  average: number;
  categories: DashboardPointsPathCategory[];
  series: DashboardPointsPathSeries[];
}

export interface DashboardPointsAnalytics {
  period: DashboardPointsAnalyticsPeriod;
  range: {
    startAt: number;
    endAt: number;
    label: string;
    bucketUnit: 'hour' | 'day';
  };
  bucketLabels: string[];
  earning: DashboardPointsDirectionAnalytics;
  spending: DashboardPointsDirectionAnalytics;
  meta: {
    storage: 'native' | 'legacy';
    scannedUsers: number;
    scannedLogs: number;
    maxLogsPerUser: number | null;
    truncatedUsers: number;
    truncatedLogs: boolean;
  };
}

export interface DashboardOverview {
  generatedAt: number;
  users: {
    total: number;
    dau: number;
    mau: number;
  };
  redemption: {
    todayClaims: number;
    todayLotterySpins: number;
  };
  engagement: {
    todayCheckins: number;
    todayCardDraws: number;
    todayCardExchanges: number;
    todayGamesStarted: number;
    todayGamesCompleted: number;
  };
  operations: {
    projects: {
      total: number;
      active: number;
      remainingSlots: number;
    };
    raffles: {
      active: number;
    };
    store: {
      enabledItems: number;
    };
    feedback: {
      open: number;
      processing: number;
    };
    announcements: {
      published: number;
    };
  };
  pointsFlow: {
    todayIn: number;
    todayOut: number;
    todayNet: number;
  };
  pointsAnalytics: DashboardPointsAnalytics;
  games: {
    participants: number;
    participationRate: number;
  };
  alerts: {
    active: number;
    warning: number;
    critical: number;
  };
}

interface AlertsSnapshot {
  active: AlertItem[];
  history: AlertItem[];
}

function getAlertsCacheKey(historyLimit: number): string {
  return `${DASHBOARD_ALERTS_CACHE_KEY_PREFIX}${historyLimit}`;
}

function getDashboardOverviewCacheKey(period: DashboardPointsAnalyticsPeriod): string {
  return `${DASHBOARD_OVERVIEW_CACHE_KEY}:${period}`;
}

function isCacheFresh(createdAt: number, maxAgeMs: number, now: number): boolean {
  return Number.isFinite(createdAt) && createdAt > 0 && now - createdAt <= maxAgeMs;
}

async function readCachedSnapshot<T>(
  key: string,
  maxAgeMs: number,
  now = Date.now()
): Promise<T | null> {
  try {
    const cached = await kv.get<CachedSnapshot<T>>(key);
    if (!cached || typeof cached !== 'object') {
      return null;
    }

    if (!isCacheFresh(Number(cached.createdAt), maxAgeMs, now)) {
      return null;
    }

    return cached.data ?? null;
  } catch {
    return null;
  }
}

async function writeCachedSnapshot<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
  try {
    await kv.set(key, { createdAt: Date.now(), data }, { ex: ttlSeconds });
  } catch {
    // ignore cache write errors
  }
}

async function withInFlightTask<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlightDashboardTasks.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const task = factory().finally(() => {
    inFlightDashboardTasks.delete(key);
  });

  inFlightDashboardTasks.set(key, task as Promise<unknown>);
  return task;
}

function toFiniteNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function getChinaDate(date: Date = new Date()): Date {
  return new Date(date.getTime() + CHINA_TZ_OFFSET_MS);
}

function formatChinaDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getChinaDayStartUtc(referenceTime: number = Date.now()): number {
  const chinaDate = getChinaDate(new Date(referenceTime));
  chinaDate.setUTCHours(0, 0, 0, 0);
  return chinaDate.getTime() - CHINA_TZ_OFFSET_MS;
}

function getChinaMonthStartUtc(referenceTime: number = Date.now()): number {
  const chinaDate = getChinaDate(new Date(referenceTime));
  chinaDate.setUTCDate(1);
  chinaDate.setUTCHours(0, 0, 0, 0);
  return chinaDate.getTime() - CHINA_TZ_OFFSET_MS;
}

function getNextChinaMonthStartUtc(referenceTime: number = Date.now()): number {
  const chinaDate = getChinaDate(new Date(referenceTime));
  chinaDate.setUTCDate(1);
  chinaDate.setUTCMonth(chinaDate.getUTCMonth() + 1);
  chinaDate.setUTCHours(0, 0, 0, 0);
  return chinaDate.getTime() - CHINA_TZ_OFFSET_MS;
}

function formatChinaHourLabel(timestamp: number): string {
  const china = getChinaDate(new Date(timestamp));
  return `${String(china.getUTCHours()).padStart(2, '0')}:00`;
}

function formatChinaDayLabel(timestamp: number): string {
  const china = getChinaDate(new Date(timestamp));
  return `${String(china.getUTCMonth() + 1).padStart(2, '0')}/${String(china.getUTCDate()).padStart(2, '0')}`;
}

function normalizeDashboardPointsPeriod(value: unknown): DashboardPointsAnalyticsPeriod {
  return value === 'week' || value === 'month' ? value : 'day';
}

function getPointsAnalyticsRange(
  period: DashboardPointsAnalyticsPeriod,
  referenceTime: number,
): {
  startAt: number;
  endAt: number;
  scanEndAt: number;
  label: string;
  bucketUnit: 'hour' | 'day';
  bucketMs: number;
} {
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const todayStart = getChinaDayStartUtc(referenceTime);

  if (period === 'week') {
    return {
      startAt: todayStart - 6 * dayMs,
      endAt: todayStart + dayMs,
      scanEndAt: referenceTime + 1,
      label: '近 7 天',
      bucketUnit: 'day',
      bucketMs: dayMs,
    };
  }

  if (period === 'month') {
    return {
      startAt: getChinaMonthStartUtc(referenceTime),
      endAt: getNextChinaMonthStartUtc(referenceTime),
      scanEndAt: referenceTime + 1,
      label: '本月',
      bucketUnit: 'day',
      bucketMs: dayMs,
    };
  }

  return {
    startAt: todayStart,
    endAt: todayStart + dayMs,
    scanEndAt: referenceTime + 1,
    label: '今日',
    bucketUnit: 'hour',
    bucketMs: hourMs,
  };
}

function buildPointBuckets(range: ReturnType<typeof getPointsAnalyticsRange>): Array<{ startAt: number; label: string }> {
  const buckets: Array<{ startAt: number; label: string }> = [];
  for (let startAt = range.startAt; startAt < range.endAt; startAt += range.bucketMs) {
    buckets.push({
      startAt,
      label: range.bucketUnit === 'hour' ? formatChinaHourLabel(startAt) : formatChinaDayLabel(startAt),
    });
  }
  return buckets;
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function describeSource(source: string): string {
  const labels: Partial<Record<PointsSource, string>> = {
    game_play: '游戏与互动',
    game_win: '游戏胜利',
    daily_login: '每日登录',
    checkin_bonus: '签到奖励',
    exchange: '积分商城兑换',
    exchange_refund: '兑换退款',
    exchange_withdraw: '账户提现',
    exchange_topup: '账户充值',
    admin_adjust: '管理员调整',
    card_collection: '卡牌收集',
    ranking_reward: '排行榜奖励',
    reward_claim: '福利项目领取',
    lottery_win: '幸运抽奖',
    raffle_win: '多人抽奖',
    number_bomb_bet: '数字炸弹投注',
    number_bomb_refund: '数字炸弹退款',
    number_bomb_reward: '数字炸弹奖励',
  };
  return labels[source as PointsSource] ?? (source || '未知来源');
}

function path(key: string, label: string): { key: string; label: string } {
  return { key, label };
}

function classifySpendingPath(source: string, description: string): { key: string; label: string } {
  if (source === 'exchange_withdraw' || description.includes('提现')) {
    return path('account_withdraw', '账户额度提现');
  }
  if (source === 'number_bomb_bet') {
    return path('number_bomb_bet', '数字炸弹投注');
  }
  if (source === 'admin_adjust') {
    return path('admin_deduct', '管理员扣除');
  }
  if (source === 'game_play' && description.includes('环保行动偷盗处罚')) {
    return path('eco_theft_penalty', '环保偷盗处罚');
  }
  if (source === 'game_play' && description.includes('回滚')) {
    return path('game_income_rollback', '游戏收益回滚');
  }
  if (source === 'card_collection' && description.includes('回滚')) {
    return path('card_reward_rollback', '卡牌奖励回滚');
  }
  if (source === 'ranking_reward' && description.includes('回滚')) {
    return path('ranking_reward_rollback', '榜单奖励回滚');
  }
  if (source === 'exchange') {
    if (description.includes('购买动物卡抽卡次数')) {
      return path('card_draw_purchase', '卡牌抽卡购买');
    }
    if (description.includes('环保行动道具')) {
      return path('eco_item_purchase', '环保行动道具');
    }
    if (description.includes('农场购买种子')) {
      return path('farm_seed_purchase', '农场种子购买');
    }
    if (description.includes('农场购买第')) {
      return path('farm_land_purchase', '农场土地购买');
    }
    if (description.includes('农场再次领养宠物')) {
      return path('farm_pet_adopt', '农场宠物领养');
    }
    if (description.includes('农场购买:')) {
      return path('farm_supply_purchase', '农场道具购买');
    }
    if (description.startsWith('兑换 ')) {
      return path('store_exchange', '积分商城兑换');
    }
    return path('exchange_other', '其他兑换支出');
  }
  return path(`${source || 'unknown'}_spending`, `${describeSource(source)}支出`);
}

function classifyEarningPath(source: string, description: string): { key: string; label: string } {
  if (source === 'exchange_topup' || description.includes('账户额度充值')) {
    return path('account_topup', '账户额度充值');
  }
  if (source === 'exchange_refund' || description.includes('退款') || description.includes('回滚')) {
    return path('points_refund', '积分退款/回滚');
  }
  if (source === 'checkin_bonus' || source === 'daily_login') {
    return path('checkin_bonus', '签到与登录奖励');
  }
  if (source === 'reward_claim') {
    return path('project_reward_claim', '福利项目领取');
  }
  if (source === 'lottery_win') {
    return path('lottery_win', '幸运抽奖中奖');
  }
  if (source === 'raffle_win') {
    return path('raffle_win', '多人抽奖中奖');
  }
  if (source === 'card_collection') {
    return path('card_collection', '卡牌收集奖励');
  }
  if (source === 'ranking_reward') {
    return path('ranking_reward', '排行榜奖励');
  }
  if (source === 'number_bomb_refund') {
    return path('number_bomb_refund', '数字炸弹退款');
  }
  if (source === 'number_bomb_reward') {
    return path('number_bomb_reward', '数字炸弹奖励');
  }
  if (source === 'admin_adjust') {
    return path('admin_grant', '管理员加分');
  }
  if (source === 'game_win') {
    return path('game_win', '游戏胜利奖励');
  }
  if (source === 'game_play') {
    if (description.includes('环保行动偷盗赔偿')) {
      return path('eco_theft_compensation', '环保偷盗赔偿');
    }
    if (description.includes('环保行动出售')) {
      return path('eco_prize_sale', '环保奖品出售');
    }
    if (description.includes('环保行动商人收购')) {
      return path('eco_merchant_sale', '环保商人收购');
    }
    if (description.includes('环保行动黑市出售')) {
      return path('eco_black_market_sale', '环保黑市出售');
    }
    if (description.includes('环保行动')) {
      return path('eco_recycling', '环保行动回收');
    }
    if (includesAny(description, ['开心农场', '农场', '宠物', '偷菜'])) {
      return path('farm_income', '开心农场收益');
    }
    if (description.includes('连连看')) {
      return path('linkgame_income', '连连看收益');
    }
    if (description.includes('消消乐')) {
      return path('match3_income', '消消乐收益');
    }
    if (description.includes('记忆游戏')) {
      return path('memory_income', '记忆游戏收益');
    }
    if (description.includes('扫雷')) {
      return path('minesweeper_income', '扫雷收益');
    }
    if (description.includes('打地鼠')) {
      return path('whack_mole_income', '打地鼠收益');
    }
    if (description.includes('星尘迷阵')) {
      return path('roguelite_income', '星尘迷阵收益');
    }
    if (description.includes('2048')) {
      return path('game_2048_income', '2048收益');
    }
    return path('game_play_other', '其他游戏收益');
  }
  return path(`${source || 'unknown'}_earning`, `${describeSource(source)}收入`);
}

function classifyPointsPath(log: Pick<PointsLog, 'amount' | 'source' | 'description'>): {
  direction: DashboardPointsDirection;
  key: string;
  label: string;
} | null {
  const amount = toFiniteNumber(log.amount);
  if (amount === 0) return null;
  const source = String(log.source || 'unknown');
  const description = String(log.description || '');
  const classified = amount > 0
    ? classifyEarningPath(source, description)
    : classifySpendingPath(source, description);
  return {
    direction: amount > 0 ? 'earning' : 'spending',
    ...classified,
  };
}

type DashboardPointLog = PointsLog & { userId: number };

interface PointDescriptionDraft {
  total: number;
  count: number;
}

interface PointCategoryDraft {
  key: string;
  label: string;
  total: number;
  count: number;
  users: Set<number>;
  bucketTotals: number[];
  bucketCounts: number[];
  descriptions: Map<string, PointDescriptionDraft>;
}

interface DirectionDraft {
  total: number;
  count: number;
  users: Set<number>;
  categories: Map<string, PointCategoryDraft>;
}

function createDirectionDraft(): DirectionDraft {
  return {
    total: 0,
    count: 0,
    users: new Set<number>(),
    categories: new Map<string, PointCategoryDraft>(),
  };
}

function getOrCreateCategoryDraft(
  draft: DirectionDraft,
  key: string,
  label: string,
  bucketCount: number,
): PointCategoryDraft {
  const existing = draft.categories.get(key);
  if (existing) return existing;
  const created: PointCategoryDraft = {
    key,
    label,
    total: 0,
    count: 0,
    users: new Set<number>(),
    bucketTotals: Array.from({ length: bucketCount }, () => 0),
    bucketCounts: Array.from({ length: bucketCount }, () => 0),
    descriptions: new Map<string, PointDescriptionDraft>(),
  };
  draft.categories.set(key, created);
  return created;
}

function normalizeDescription(description: string): string {
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : '无描述';
}

function toPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 10000) / 100;
}

function finalizeDirectionAnalytics(
  draft: DirectionDraft,
  buckets: Array<{ startAt: number; label: string }>,
): DashboardPointsDirectionAnalytics {
  const categories = Array.from(draft.categories.values())
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.label.localeCompare(b.label, 'zh-CN');
    })
    .map((category) => ({
      key: category.key,
      label: category.label,
      total: category.total,
      count: category.count,
      userCount: category.users.size,
      percent: toPercent(category.total, draft.total),
      average: category.count > 0 ? Math.round(category.total / category.count) : 0,
      topDescriptions: Array.from(category.descriptions.entries())
        .map(([description, item]) => ({ description, total: item.total, count: item.count }))
        .sort((a, b) => {
          if (b.total !== a.total) return b.total - a.total;
          return b.count - a.count;
        })
        .slice(0, 5),
    }));

  const series = Array.from(draft.categories.values())
    .sort((a, b) => b.total - a.total)
    .map((category) => ({
      key: category.key,
      label: category.label,
      total: category.total,
      points: buckets.map((bucket, index) => ({
        bucketStart: bucket.startAt,
        label: bucket.label,
        value: category.bucketTotals[index] ?? 0,
        count: category.bucketCounts[index] ?? 0,
      })),
    }));

  return {
    total: draft.total,
    count: draft.count,
    userCount: draft.users.size,
    average: draft.count > 0 ? Math.round(draft.total / draft.count) : 0,
    categories,
    series,
  };
}

async function loadLegacyPointLogsForAnalytics(
  users: Array<{ id: number | string }>,
  startAt: number,
  endAt: number,
): Promise<{
  logs: DashboardPointLog[];
  scannedLogs: number;
  truncatedUsers: number;
}> {
  const logs: DashboardPointLog[] = [];
  let scannedLogs = 0;
  let truncatedUsers = 0;

  for (let index = 0; index < users.length; index += POINTS_ANALYTICS_LEGACY_BATCH_SIZE) {
    const batch = users.slice(index, index + POINTS_ANALYTICS_LEGACY_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (user) => {
      const userId = Number(user.id);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return { userLogs: [] as DashboardPointLog[], scanned: 0, truncated: false };
      }

      const rawLogs = await kv.lrange<PointsLog>(
        `points_log:${userId}`,
        0,
        POINTS_ANALYTICS_LEGACY_SCAN_LIMIT - 1,
      );

      const userLogs = (rawLogs ?? [])
        .filter((log) => {
          const createdAt = toFiniteNumber(log?.createdAt);
          const amount = toFiniteNumber(log?.amount);
          return amount !== 0 && createdAt >= startAt && createdAt < endAt;
        })
        .map((log) => ({ ...log, userId }));

      const lastLog = rawLogs?.[rawLogs.length - 1];
      const truncated = (rawLogs?.length ?? 0) >= POINTS_ANALYTICS_LEGACY_SCAN_LIMIT
        && toFiniteNumber(lastLog?.createdAt) >= startAt;

      return {
        userLogs,
        scanned: rawLogs?.length ?? 0,
        truncated,
      };
    }));

    for (const result of batchResults) {
      logs.push(...result.userLogs);
      scannedLogs += result.scanned;
      if (result.truncated) truncatedUsers += 1;
    }
  }

  return { logs, scannedLogs, truncatedUsers };
}

async function buildDashboardPointsAnalytics(
  users: Array<{ id: number | string }>,
  options: {
    period?: DashboardPointsAnalyticsPeriod;
    referenceTime?: number;
  } = {},
): Promise<DashboardPointsAnalytics> {
  const period = normalizeDashboardPointsPeriod(options.period);
  const now = options.referenceTime ?? Date.now();
  const range = getPointsAnalyticsRange(period, now);
  const buckets = buildPointBuckets(range);
  const bucketLabels = buckets.map((bucket) => bucket.label);
  const bucketCount = Math.max(1, buckets.length);
  const storage: 'native' | 'legacy' = await isNativeHotStoreReady() ? 'native' : 'legacy';

  let logs: DashboardPointLog[] = [];
  let scannedLogs = 0;
  let truncatedUsers = 0;
  let truncatedLogs = false;

  if (storage === 'native') {
    logs = await getNativePointLogsInRange(range.startAt, range.scanEndAt, POINTS_ANALYTICS_NATIVE_LIMIT);
    scannedLogs = logs.length;
    truncatedLogs = logs.length >= POINTS_ANALYTICS_NATIVE_LIMIT;
  } else {
    const loaded = await loadLegacyPointLogsForAnalytics(users, range.startAt, range.scanEndAt);
    logs = loaded.logs;
    scannedLogs = loaded.scannedLogs;
    truncatedUsers = loaded.truncatedUsers;
  }

  const drafts: Record<DashboardPointsDirection, DirectionDraft> = {
    earning: createDirectionDraft(),
    spending: createDirectionDraft(),
  };

  for (const log of logs) {
    const createdAt = toFiniteNumber(log.createdAt);
    const amount = toFiniteNumber(log.amount);
    const classified = classifyPointsPath(log);
    if (!classified || createdAt < range.startAt || createdAt >= range.scanEndAt) continue;

    const value = Math.abs(amount);
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((createdAt - range.startAt) / range.bucketMs)),
    );
    const draft = drafts[classified.direction];
    const category = getOrCreateCategoryDraft(draft, classified.key, classified.label, bucketCount);
    const userId = Number(log.userId);
    const description = normalizeDescription(String(log.description || ''));
    const descDraft = category.descriptions.get(description) ?? { total: 0, count: 0 };

    draft.total += value;
    draft.count += 1;
    if (Number.isSafeInteger(userId) && userId > 0) draft.users.add(userId);

    category.total += value;
    category.count += 1;
    category.bucketTotals[bucketIndex] += value;
    category.bucketCounts[bucketIndex] += 1;
    if (Number.isSafeInteger(userId) && userId > 0) category.users.add(userId);

    descDraft.total += value;
    descDraft.count += 1;
    category.descriptions.set(description, descDraft);
  }

  return {
    period,
    range: {
      startAt: range.startAt,
      endAt: range.scanEndAt,
      label: range.label,
      bucketUnit: range.bucketUnit,
    },
    bucketLabels,
    earning: finalizeDirectionAnalytics(drafts.earning, buckets),
    spending: finalizeDirectionAnalytics(drafts.spending, buckets),
    meta: {
      storage,
      scannedUsers: users.length,
      scannedLogs,
      maxLogsPerUser: storage === 'legacy' ? POINTS_ANALYTICS_LEGACY_SCAN_LIMIT : null,
      truncatedUsers,
      truncatedLogs,
    },
  };
}

async function hasActivitySince(userId: number, startAt: number): Promise<boolean> {
  const [logs, lotteryRecords, ...gameRecords] = await Promise.all([
    kv.lrange<{ createdAt?: number }>(`points_log:${userId}`, 0, RECENT_SCAN_LIMIT - 1),
    kv.lrange<{ createdAt?: number }>(`lottery:user:records:${userId}`, 0, RECENT_SCAN_LIMIT - 1),
    ...GAME_ACTIVITY_KEYS.map((buildKey) =>
      kv.lrange<{ createdAt?: number }>(buildKey(userId), 0, RECENT_SCAN_LIMIT - 1)
    ),
  ]);

  const hasSince = (items: typeof logs) =>
    (items ?? []).some((item) => toFiniteNumber(item?.createdAt) >= startAt);

  return hasSince(logs) || hasSince(lotteryRecords) || gameRecords.some(hasSince);
}

async function hasGameActivitySince(userId: number, startAt: number): Promise<boolean> {
  const allRecords = await Promise.all(
    GAME_ACTIVITY_KEYS.map((buildKey) =>
      kv.lrange<{ createdAt?: number }>(buildKey(userId), 0, RECENT_SCAN_LIMIT - 1)
    )
  );
  return allRecords.some((records) =>
    (records ?? []).some((item) => toFiniteNumber(item?.createdAt) >= startAt)
  );
}

async function getTodayPointsFlowByUser(userId: number, todayStartAt: number): Promise<{ incoming: number; outgoing: number }> {
  const logs = await kv.lrange<{ amount?: number; createdAt?: number }>(
    `points_log:${userId}`,
    0,
    RECENT_SCAN_LIMIT - 1,
  );

  let incoming = 0;
  let outgoing = 0;

  for (const log of logs ?? []) {
    const createdAt = toFiniteNumber(log?.createdAt);
    if (createdAt < todayStartAt) continue;

    const amount = toFiniteNumber(log?.amount);
    if (amount > 0) {
      incoming += amount;
    } else if (amount < 0) {
      outgoing += Math.abs(amount);
    }
  }

  return { incoming, outgoing };
}

async function triggerAlertOncePerDay(
  key: string,
  level: 'info' | 'warning' | 'critical',
  name: string,
  message: string,
  tags: Record<string, string | number | boolean>,
): Promise<boolean> {
  const today = formatChinaDate(getChinaDate());
  const dedupeKey = `anomaly:alert:${today}:${key}`;
  const ok = await kv.set(dedupeKey, '1', { nx: true, ex: 48 * 60 * 60 });
  if (ok !== 'OK') return false;
  await triggerAlert(level, name, message, tags);
  return true;
}

async function detectUserAnomalies(
  user: { id: number | string; username: string },
  todayStartAt: number,
): Promise<number> {
  const userId = Number(user.id);
  if (!Number.isFinite(userId) || userId <= 0) return 0;

  let triggeredAlerts = 0;
  const pointsBaselineKey = `anomaly:baseline:points:${userId}`;
  const [currentPoints, baselineRaw] = await Promise.all([
    getUserPoints(userId),
    kv.get<number>(pointsBaselineKey),
  ]);

  const baseline = toFiniteNumber(baselineRaw);
  const delta = currentPoints - baseline;

  if (baseline > 0 && delta >= POINTS_SPIKE_THRESHOLD) {
    const triggered = await triggerAlertOncePerDay(
      `points_spike:${userId}`,
      'warning',
      'points_spike',
      `用户 ${user.username} 积分短时增长异常（+${delta}）`,
      {
        userId,
        username: user.username,
        delta,
      }
    );
    if (triggered) {
      triggeredAlerts += 1;
    }
  }

  await kv.set(pointsBaselineKey, currentPoints, { ex: 72 * 60 * 60 });

  const lotteryRecords = await kv.lrange<{ createdAt?: number }>(
    `lottery:user:records:${userId}`,
    0,
    RECENT_SCAN_LIMIT - 1,
  );
  const todayLotteryCount = (lotteryRecords ?? []).reduce((count, record) => {
    return toFiniteNumber(record?.createdAt) >= todayStartAt ? count + 1 : count;
  }, 0);

  if (todayLotteryCount >= LOTTERY_HIGH_FREQUENCY_THRESHOLD) {
    const triggered = await triggerAlertOncePerDay(
      `lottery_high_frequency:${userId}`,
      'critical',
      'lottery_high_frequency',
      `用户 ${user.username} 今日抽奖频次异常（${todayLotteryCount} 次）`,
      {
        userId,
        username: user.username,
        count: todayLotteryCount,
      }
    );
    if (triggered) {
      triggeredAlerts += 1;
    }
  }

  return triggeredAlerts;
}

export async function runAnomalyDetection(options: {
  referenceTime?: number;
  maxUsers?: number;
  concurrency?: number;
} = {}): Promise<{
  scannedUsers: number;
  triggeredAlerts: number;
}> {
  const now = options.referenceTime ?? Date.now();
  const todayStartAt = getChinaDayStartUtc(now);
  const allUsers = await getAllUsers();

  const maxUsers = toPositiveInteger(options.maxUsers, allUsers.length);
  const users = allUsers.slice(0, Math.min(maxUsers, allUsers.length));
  const concurrency = Math.min(
    MAX_DETECTION_CONCURRENCY,
    toPositiveInteger(options.concurrency, DEFAULT_DETECTION_CONCURRENCY),
  );
  const workerCount = Math.max(1, Math.min(concurrency, users.length || 1));

  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    let workerTriggered = 0;

    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= users.length) break;

      const user = users[currentIndex];
      workerTriggered += await detectUserAnomalies(user, todayStartAt);
    }

    return workerTriggered;
  });

  const triggerCounts = await Promise.all(workers);
  const triggeredAlerts = triggerCounts.reduce((sum, value) => sum + value, 0);

  return {
    scannedUsers: users.length,
    triggeredAlerts,
  };
}

export async function getCachedDashboardOverview(options: {
  referenceTime?: number;
  maxAgeMs?: number;
  forceRefresh?: boolean;
  pointsPeriod?: DashboardPointsAnalyticsPeriod;
} = {}): Promise<DashboardOverview> {
  const now = options.referenceTime ?? Date.now();
  const maxAgeMs = Math.max(1, Math.floor(options.maxAgeMs ?? DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS * 1000));
  const pointsPeriod = normalizeDashboardPointsPeriod(options.pointsPeriod);
  const cacheKey = getDashboardOverviewCacheKey(pointsPeriod);

  if (!options.forceRefresh) {
    const cached = await readCachedSnapshot<DashboardOverview>(cacheKey, maxAgeMs, now);
    if (cached) {
      return cached;
    }
  }

  return withInFlightTask(cacheKey, async () => {
    if (!options.forceRefresh) {
      const cached = await readCachedSnapshot<DashboardOverview>(cacheKey, maxAgeMs, now);
      if (cached) {
        return cached;
      }
    }

    const dashboard = await getDashboardOverview({ referenceTime: now, pointsPeriod });
    await writeCachedSnapshot(cacheKey, dashboard, DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS);
    return dashboard;
  });
}

export async function getDashboardOverview(options: {
  referenceTime?: number;
  pointsPeriod?: DashboardPointsAnalyticsPeriod;
} = {}): Promise<DashboardOverview> {
  const now = options.referenceTime ?? Date.now();
  const todayStartAt = getChinaDayStartUtc(now);
  const monthStartAt = getChinaMonthStartUtc(now);
  const users = await getAllUsers();

  const validUsers = users.filter((u) => {
    const id = Number(u.id);
    return Number.isFinite(id) && id > 0;
  });

  const perUserResults = await Promise.all(
    validUsers.map(async (user) => {
      const userId = Number(user.id);
      const [activeToday, activeMonth, gameToday, flowToday] = await Promise.all([
        hasActivitySince(userId, todayStartAt),
        hasActivitySince(userId, monthStartAt),
        hasGameActivitySince(userId, todayStartAt),
        getTodayPointsFlowByUser(userId, todayStartAt),
      ]);
      return { activeToday, activeMonth, gameToday, flowToday };
    })
  );

  let dau = 0;
  let mau = 0;
  let gameParticipants = 0;
  let pointsIn = 0;
  let pointsOut = 0;

  for (const r of perUserResults) {
    if (r.activeToday) dau += 1;
    if (r.activeMonth) mau += 1;
    if (r.gameToday) gameParticipants += 1;
    pointsIn += r.flowToday.incoming;
    pointsOut += r.flowToday.outgoing;
  }

  const [dailyStats, pointsAnalytics] = await Promise.all([
    getDailyStats(),
    buildDashboardPointsAnalytics(validUsers, {
      period: options.pointsPeriod,
      referenceTime: now,
    }),
  ]);
  const todayClaims = toFiniteNumber(dailyStats['claims.success']);
  const todayLotterySpins =
    toFiniteNumber(dailyStats['lottery.spin']) + toFiniteNumber(dailyStats['lottery.spin.direct']);
  const todayCheckins = toFiniteNumber(dailyStats['users.checkin']);
  const todayCardDraws = toFiniteNumber(dailyStats['cards.draw']);
  const todayCardExchanges = toFiniteNumber(dailyStats['cards.exchange']);
  const todayGamesStarted = toFiniteNumber(dailyStats['games.start']);
  const todayGamesCompleted = toFiniteNumber(dailyStats['games.complete']);

  const [
    projects,
    activeRaffles,
    storeItems,
    openFeedback,
    processingFeedback,
    publishedAnnouncements,
  ] = await Promise.all([
    getAllProjects(),
    getActiveRaffles(),
    getStoreItems(),
    listAllFeedback({ page: 1, limit: 1, status: 'open' }),
    listAllFeedback({ page: 1, limit: 1, status: 'processing' }),
    listPublishedAnnouncements({ page: 1, limit: 1 }),
  ]);

  const activeProjects = projects.filter((project) => project.status === 'active');
  const remainingProjectSlots = activeProjects.reduce((sum, project) => {
    const maxClaims = toFiniteNumber(project.maxClaims);
    const claimedCount = toFiniteNumber(project.claimedCount);
    return sum + Math.max(0, maxClaims - claimedCount);
  }, 0);

  const activeAlerts = await getActiveAlerts();
  const warningAlerts = activeAlerts.filter((item) => item.level === 'warning').length;
  const criticalAlerts = activeAlerts.filter((item) => item.level === 'critical').length;

  const participationRate = users.length > 0
    ? Math.min(100, Math.round((gameParticipants / users.length) * 10000) / 100)
    : 0;

  return {
    generatedAt: now,
    users: {
      total: users.length,
      dau,
      mau,
    },
    redemption: {
      todayClaims,
      todayLotterySpins,
    },
    engagement: {
      todayCheckins,
      todayCardDraws,
      todayCardExchanges,
      todayGamesStarted,
      todayGamesCompleted,
    },
    operations: {
      projects: {
        total: projects.length,
        active: activeProjects.length,
        remainingSlots: remainingProjectSlots,
      },
      raffles: {
        active: activeRaffles.length,
      },
      store: {
        enabledItems: storeItems.length,
      },
      feedback: {
        open: openFeedback.pagination.total,
        processing: processingFeedback.pagination.total,
      },
      announcements: {
        published: publishedAnnouncements.pagination.total,
      },
    },
    pointsFlow: {
      todayIn: pointsIn,
      todayOut: pointsOut,
      todayNet: pointsIn - pointsOut,
    },
    pointsAnalytics,
    games: {
      participants: gameParticipants,
      participationRate,
    },
    alerts: {
      active: activeAlerts.length,
      warning: warningAlerts,
      critical: criticalAlerts,
    },
  };
}

export async function getCachedAlertsSnapshot(options: {
  historyLimit?: number;
  maxAgeMs?: number;
  forceRefresh?: boolean;
} = {}): Promise<AlertsSnapshot> {
  const historyLimit = Math.max(1, Math.min(200, Math.floor(toFiniteNumber(options.historyLimit ?? 50))));
  const cacheKey = getAlertsCacheKey(historyLimit);
  const now = Date.now();
  const maxAgeMs = Math.max(1, Math.floor(options.maxAgeMs ?? DASHBOARD_ALERTS_CACHE_TTL_SECONDS * 1000));

  if (!options.forceRefresh) {
    const cached = await readCachedSnapshot<AlertsSnapshot>(cacheKey, maxAgeMs, now);
    if (cached) {
      return cached;
    }
  }

  return withInFlightTask(cacheKey, async () => {
    if (!options.forceRefresh) {
      const cached = await readCachedSnapshot<AlertsSnapshot>(cacheKey, maxAgeMs, now);
      if (cached) {
        return cached;
      }
    }

    const snapshot = await getAlertsSnapshot({ historyLimit });
    await writeCachedSnapshot(cacheKey, snapshot, DASHBOARD_ALERTS_CACHE_TTL_SECONDS);
    return snapshot;
  });
}

export async function getAlertsSnapshot(options: { historyLimit?: number } = {}): Promise<AlertsSnapshot> {
  const active = await getActiveAlerts();
  const historyLimit = Math.max(1, Math.min(200, Math.floor(toFiniteNumber(options.historyLimit ?? 50))));
  const historyRaw = await kv.lrange<unknown>('alerts:history', 0, historyLimit - 1);

  const history = (historyRaw ?? [])
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const value = item as AlertItem;
      if (!value.id || !value.level || !value.name) return null;
      return value;
    })
    .filter((item): item is AlertItem => item !== null);

  return {
    active: active as AlertItem[],
    history,
  };
}

export async function resolveAlertById(alertId: string): Promise<void> {
  await resolveAlert(alertId);
}
