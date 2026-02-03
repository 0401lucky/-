// src/lib/metrics.ts
// 监控指标和告警系统

import { kv } from '@vercel/kv';
import { getTodayDateString } from './time';

/**
 * 指标类型
 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * 指标标签
 */
export interface MetricTags {
  [key: string]: string | number | boolean;
}

/**
 * 指标数据点
 */
interface MetricPoint {
  name: string;
  type: MetricType;
  value: number;
  tags?: MetricTags;
  timestamp: number;
}

/**
 * 告警级别
 */
export type AlertLevel = 'info' | 'warning' | 'critical';

/**
 * 告警记录
 */
interface AlertRecord {
  id: string;
  level: AlertLevel;
  name: string;
  message: string;
  tags?: MetricTags;
  timestamp: number;
  resolved?: boolean;
  resolvedAt?: number;
}

// KV Keys
const METRICS_PREFIX = 'metrics:';
const ALERTS_KEY = 'alerts:active';
const ALERTS_HISTORY_KEY = 'alerts:history';
const DAILY_STATS_PREFIX = 'stats:daily:';

// 配置
const MAX_ALERTS_HISTORY = 1000;
const METRICS_TTL = 86400; // 24小时

/**
 * 记录计数器指标（累加）
 */
export async function incrementCounter(
  name: string,
  value: number = 1,
  tags?: MetricTags
): Promise<void> {
  const today = getTodayDateString();
  const key = `${DAILY_STATS_PREFIX}${today}:${name}`;

  try {
    await kv.incrby(key, value);
    // 设置过期时间（7天）
    const ttl = await kv.ttl(key);
    if (ttl === -1) {
      await kv.expire(key, 7 * 86400);
    }
  } catch (error) {
    console.error('Failed to increment counter:', error);
  }
}

/**
 * 记录仪表盘指标（设置当前值）
 */
export async function setGauge(
  name: string,
  value: number,
  tags?: MetricTags
): Promise<void> {
  const key = `${METRICS_PREFIX}gauge:${name}`;

  try {
    const point: MetricPoint = {
      name,
      type: 'gauge',
      value,
      tags,
      timestamp: Date.now(),
    };
    await kv.set(key, point, { ex: METRICS_TTL });
  } catch (error) {
    console.error('Failed to set gauge:', error);
  }
}

/**
 * 触发告警
 */
export async function triggerAlert(
  level: AlertLevel,
  name: string,
  message: string,
  tags?: MetricTags
): Promise<void> {
  const alert: AlertRecord = {
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    level,
    name,
    message,
    tags,
    timestamp: Date.now(),
  };

  try {
    // 添加到活跃告警
    await kv.hset(ALERTS_KEY, { [alert.id]: JSON.stringify(alert) });
    // 添加到历史记录
    await kv.lpush(ALERTS_HISTORY_KEY, alert);
    await kv.ltrim(ALERTS_HISTORY_KEY, 0, MAX_ALERTS_HISTORY - 1);

    // 记录告警计数
    await incrementCounter(`alerts.${level}`, 1, { name });
  } catch (error) {
    console.error('Failed to trigger alert:', error);
  }
}

/**
 * 解除告警
 */
export async function resolveAlert(alertId: string): Promise<void> {
  try {
    const alertJson = await kv.hget<string>(ALERTS_KEY, alertId);
    if (alertJson) {
      const alert: AlertRecord = JSON.parse(alertJson);
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      await kv.hdel(ALERTS_KEY, alertId);
      await kv.lpush(ALERTS_HISTORY_KEY, alert);
    }
  } catch (error) {
    console.error('Failed to resolve alert:', error);
  }
}

/**
 * 获取活跃告警
 */
export async function getActiveAlerts(): Promise<AlertRecord[]> {
  try {
    const alerts = await kv.hgetall<Record<string, string>>(ALERTS_KEY);
    if (!alerts) return [];
    return Object.values(alerts).map(json => JSON.parse(json));
  } catch (error) {
    console.error('Failed to get active alerts:', error);
    return [];
  }
}

/**
 * 获取每日统计数据
 */
export async function getDailyStats(
  date?: string
): Promise<Record<string, number>> {
  const targetDate = date || getTodayDateString();
  const pattern = `${DAILY_STATS_PREFIX}${targetDate}:*`;

  try {
    // 使用 scan 获取所有匹配的 key
    const keys: string[] = [];
    let cursor: number = 0;
    do {
      const result = await kv.scan(cursor, {
        match: pattern,
        count: 100,
      });
      cursor = Number(result[0]);
      keys.push(...result[1]);
    } while (cursor !== 0);

    if (keys.length === 0) return {};

    // 批量获取值
    const values = await kv.mget<number[]>(...keys);
    const stats: Record<string, number> = {};

    keys.forEach((key, index) => {
      const name = key.replace(`${DAILY_STATS_PREFIX}${targetDate}:`, '');
      stats[name] = values[index] || 0;
    });

    return stats;
  } catch (error) {
    console.error('Failed to get daily stats:', error);
    return {};
  }
}

// ============ 预定义的业务指标 ============

/**
 * 业务指标命名空间
 */
export const BusinessMetrics = {
  // 抽奖相关
  lottery: {
    spin: (tier: string) => incrementCounter('lottery.spin', 1, { tier }),
    spinDirect: (dollars: number) => incrementCounter('lottery.spin.direct', dollars),
    spinFailed: (reason: string) => incrementCounter('lottery.spin.failed', 1, { reason }),
  },

  // 卡牌相关
  cards: {
    draw: (rarity: string) => incrementCounter('cards.draw', 1, { rarity }),
    exchange: () => incrementCounter('cards.exchange', 1),
  },

  // 游戏相关
  games: {
    start: (game: string) => incrementCounter('games.start', 1, { game }),
    complete: (game: string, score: number) => incrementCounter('games.complete', 1, { game, score }),
  },

  // 兑换码相关
  claims: {
    success: (projectId: string) => incrementCounter('claims.success', 1, { projectId }),
    failed: (reason: string) => incrementCounter('claims.failed', 1, { reason }),
  },

  // 用户相关
  users: {
    login: () => incrementCounter('users.login', 1),
    checkin: () => incrementCounter('users.checkin', 1),
    newUser: () => incrementCounter('users.new', 1),
  },

  // API 相关
  api: {
    request: (endpoint: string) => incrementCounter('api.requests', 1, { endpoint }),
    error: (endpoint: string, status: number) => incrementCounter('api.errors', 1, { endpoint, status }),
    rateLimited: (endpoint: string) => incrementCounter('api.rate_limited', 1, { endpoint }),
  },
};
