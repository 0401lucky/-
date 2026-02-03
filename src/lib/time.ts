// src/lib/time.ts

/**
 * 中国时区偏移量（毫秒）
 */
const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 获取当前中国时区时间
 */
export function getChinaTime(date: Date = new Date()): Date {
  return new Date(date.getTime() + CHINA_TZ_OFFSET_MS);
}

/**
 * 获取今天日期字符串 (YYYY-MM-DD) - 使用中国时区 (UTC+8)
 */
export function getTodayDateString(): string {
  const chinaTime = getChinaTime();
  const year = chinaTime.getUTCFullYear();
  const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(chinaTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  return Math.ceil((tomorrowUTC.getTime() - now.getTime()) / 1000);
}
