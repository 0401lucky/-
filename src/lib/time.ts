// src/lib/time.ts

/**
 * 获取今天日期字符串 (YYYY-MM-DD) - 使用中国时区 (UTC+8)
 */
export function getTodayDateString(): string {
  const now = new Date();
  // 转换为中国时区 (UTC+8)
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = chinaTime.getUTCFullYear();
  const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(chinaTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
