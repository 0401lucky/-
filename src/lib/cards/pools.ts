import { HOK_MODERN_ALBUM_ID } from './hok-modern';
import type { LimitedPoolConfig } from './types';

export const DEFAULT_LIMITED_POOL: LimitedPoolConfig = {
  enabled: false,
  albumId: HOK_MODERN_ALBUM_ID,
  drawCost: 2,
  startsAt: 0,
  endsAt: 0,
};

export type LimitedPoolStatus = 'disabled' | 'upcoming' | 'open' | 'expired';

export function getLimitedPoolStatus(pool: LimitedPoolConfig, now: number): LimitedPoolStatus {
  if (!pool.enabled || !Number.isInteger(pool.drawCost) || pool.drawCost < 1 || pool.drawCost > 100 ||
      pool.startsAt <= 0 || pool.endsAt <= pool.startsAt) return 'disabled';
  if (now < pool.startsAt) return 'upcoming';
  if (now >= pool.endsAt) return 'expired';
  return 'open';
}

export function formatPoolTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function formatPoolRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分 ${seconds % 60} 秒`;
}

export function toPoolDateTimeInput(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp + 8 * 3600000).toISOString().slice(0, 16);
}

export function fromPoolDateTimeInput(value: string): number {
  if (!value) return 0;
  const timestamp = Date.parse(`${value}+08:00`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function oneMonthLater(timestamp: number): number {
  const beijingOffset = 8 * 3600000;
  const start = new Date(timestamp + beijingOffset);
  const end = new Date(timestamp + beijingOffset);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return end.getTime() - beijingOffset;
}
