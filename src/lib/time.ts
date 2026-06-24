// src/lib/time.ts

/**
 * 中国时区偏移量（毫秒）
 */
export const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

const CHINA_DATE_TIME_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * 获取当前中国时区时间
 */
export function getChinaTime(date: Date = new Date()): Date {
  return new Date(date.getTime() + CHINA_TZ_OFFSET_MS);
}

/**
 * 将任意时刻格式化为中国时区日期字符串 (YYYY-MM-DD)
 */
export function formatChinaDateKey(date: Date = new Date()): string {
  const chinaTime = getChinaTime(date);
  const year = chinaTime.getUTCFullYear();
  const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(chinaTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 将后台 datetime-local 输入按中国时间解释，并转换为 UTC 毫秒时间戳。
 */
export function parseChinaDateTimeInput(value: unknown): number | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = CHINA_DATE_TIME_INPUT_RE.exec(trimmed);
  if (!match) return null;

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = secondRaw === undefined ? 0 : Number(secondRaw);

  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second) - CHINA_TZ_OFFSET_MS;
  const chinaTime = getChinaTime(new Date(timestamp));

  if (
    chinaTime.getUTCFullYear() !== year ||
    chinaTime.getUTCMonth() !== month - 1 ||
    chinaTime.getUTCDate() !== day ||
    chinaTime.getUTCHours() !== hour ||
    chinaTime.getUTCMinutes() !== minute ||
    chinaTime.getUTCSeconds() !== second
  ) {
    return null;
  }

  return timestamp;
}

function formatChinaDateTimeParts(timestamp: number): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} | null {
  if (!Number.isFinite(timestamp)) return null;

  const chinaTime = getChinaTime(new Date(timestamp));
  return {
    year: String(chinaTime.getUTCFullYear()),
    month: String(chinaTime.getUTCMonth() + 1).padStart(2, '0'),
    day: String(chinaTime.getUTCDate()).padStart(2, '0'),
    hour: String(chinaTime.getUTCHours()).padStart(2, '0'),
    minute: String(chinaTime.getUTCMinutes()).padStart(2, '0'),
  };
}

/**
 * 格式化为后台展示用的中国时间。
 */
export function formatChinaDateTime(timestamp: number | null | undefined): string {
  if (timestamp == null) return '';

  const parts = formatChinaDateTimeParts(timestamp);
  if (!parts) return '';

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/**
 * 格式化为 input[type=datetime-local] 可识别的中国时间。
 */
export function formatChinaDateTimeInput(timestamp: number | null | undefined): string {
  if (timestamp == null) return '';

  const parts = formatChinaDateTimeParts(timestamp);
  if (!parts) return '';

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * 获取今天日期字符串 (YYYY-MM-DD) - 使用中国时区 (UTC+8)
 */
export function getTodayDateString(): string {
  return formatChinaDateKey();
}

/**
 * 获取距离中国时区次日0点的秒数
 */
export function getSecondsUntilMidnight(): number {
  const now = new Date();
  const chinaTime = getChinaTime(now);
  const tomorrow = new Date(chinaTime);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  // 转回 UTC 计算差值
  const tomorrowUTC = new Date(tomorrow.getTime() - CHINA_TZ_OFFSET_MS);
  return Math.max(1, Math.ceil((tomorrowUTC.getTime() - now.getTime()) / 1000));
}
