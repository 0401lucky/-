import { kv } from '@/lib/d1-kv';
import { getAllUsers } from './kv';
import { getUserPoints } from './points';
import { getActiveAlerts, triggerAlert, resolveAlert, getDailyStats } from './metrics';

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
const POINTS_SPIKE_THRESHOLD = 5000;
const LOTTERY_HIGH_FREQUENCY_THRESHOLD = 80;
const DEFAULT_DETECTION_CONCURRENCY = 4;
const MAX_DETECTION_CONCURRENCY = 16;

const GAME_ACTIVITY_KEYS = [
  (userId: number) => `slot:records:${userId}`,
  (userId: number) => `linkgame:records:${userId}`,
  (userId: number) => `match3:records:${userId}`,
  (userId: number) => `memory:records:${userId}`,
  (userId: number) => `game:records:${userId}`,
  (userId: number) => `tower:records:${userId}`,
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
  pointsFlow: {
    todayIn: number;
    todayOut: number;
    todayNet: number;
  };
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
} = {}): Promise<DashboardOverview> {
  const now = options.referenceTime ?? Date.now();
  const maxAgeMs = Math.max(1, Math.floor(options.maxAgeMs ?? DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS * 1000));

  if (!options.forceRefresh) {
    const cached = await readCachedSnapshot<DashboardOverview>(DASHBOARD_OVERVIEW_CACHE_KEY, maxAgeMs, now);
    if (cached) {
      return cached;
    }
  }

  return withInFlightTask(DASHBOARD_OVERVIEW_CACHE_KEY, async () => {
    if (!options.forceRefresh) {
      const cached = await readCachedSnapshot<DashboardOverview>(DASHBOARD_OVERVIEW_CACHE_KEY, maxAgeMs, now);
      if (cached) {
        return cached;
      }
    }

    const dashboard = await getDashboardOverview({ referenceTime: now });
    await writeCachedSnapshot(DASHBOARD_OVERVIEW_CACHE_KEY, dashboard, DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS);
    return dashboard;
  });
}

export async function getDashboardOverview(options: { referenceTime?: number } = {}): Promise<DashboardOverview> {
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

  const dailyStats = await getDailyStats();
  const todayClaims = toFiniteNumber(dailyStats['claims.success']);
  const todayLotterySpins =
    toFiniteNumber(dailyStats['lottery.spin']) + toFiniteNumber(dailyStats['lottery.spin.direct']);

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
    pointsFlow: {
      todayIn: pointsIn,
      todayOut: pointsOut,
      todayNet: pointsIn - pointsOut,
    },
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
