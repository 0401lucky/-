/**
 * 签到规则中心化模块
 *
 * 定义周梯度积分、漏签整周降级、抽奖次数、补签卡价格等所有签到规则常量与判定函数。
 * 所有逻辑均为纯函数，便于在前后端共享，并通过单元测试独立覆盖。
 */

import { CHINA_TZ_OFFSET_MS, formatChinaDateKey } from './time';

// 周一(0) → 周日(6) 的基础积分梯度
// 周一/二/三 50；周四/五 60；周六 70；周日 100
export const WEEK_POINTS_GRADIENT = [50, 50, 50, 60, 60, 70, 100] as const;

// 本周一到昨天之间任何一天漏签后，今天起本周剩余每日仅发该固定积分
export const BROKEN_WEEK_POINTS = 50;

// 周一至周六固定额外抽奖
export const WEEKDAY_BONUS_SPINS = 1;
// 周日全勤额外抽奖
export const SUNDAY_FULL_BONUS_SPINS = 2;
// 周日非全勤额外抽奖
export const SUNDAY_DEFAULT_SPINS = 1;

// 补签卡价格（积分）
export const MAKEUP_CARD_POINTS_COST = 30;

function parseDateKeyParts(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function dateKeyToUtcDate(value: string): Date | null {
  const parts = parseDateKeyParts(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function addDaysToDateKey(value: string, days: number): string {
  const date = dateKeyToUtcDate(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 取一个日期对应的"周一为 0"的星期下标。
 * 0 = 周一，1 = 周二，...，6 = 周日
 */
export function getWeekdayMon0(date: Date): number {
  const chinaDate = dateKeyToUtcDate(formatDateKey(date));
  if (!chinaDate) return 0;
  return (chinaDate.getUTCDay() + 6) % 7;
}

/**
 * 取一个日期在中国时区所在周的周一（中国时区 00:00）。
 */
export function getMondayOfWeek(date: Date): Date {
  const mondayKey = addDaysToDateKey(formatDateKey(date), -getWeekdayMon0(date));
  return parseDateKey(mondayKey) ?? new Date(date);
}

/**
 * 把日期格式化为 YYYY-MM-DD（中国时区，与 getTodayDateString 一致）。
 */
export function formatDateKey(date: Date): string {
  return formatChinaDateKey(date);
}

/**
 * 列出本周 7 天的 YYYY-MM-DD 字符串数组。
 * 顺序：周一 → 周日
 */
export function listWeekDateKeys(today: Date): string[] {
  const mondayKey = formatDateKey(getMondayOfWeek(today));
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    out.push(addDaysToDateKey(mondayKey, i));
  }
  return out;
}

/**
 * 判定本周从周一到 today 之前是否存在漏签。
 *
 * - 仅检查周一 ≤ d < today 的范围（不含 today，因为 today 还在签到中）
 * - signedSet 是用户已签日期的集合（YYYY-MM-DD）
 * - 周一签到时此函数返回 false（因为没有更早的本周日子需要检查）
 */
export function hasBrokenBeforeToday(today: Date, signedSet: Set<string>): boolean {
  const mondayKey = formatDateKey(getMondayOfWeek(today));
  const todayKey = formatDateKey(today);
  let cursorKey = mondayKey;
  while (cursorKey !== todayKey) {
    if (!signedSet.has(cursorKey)) return true;
    cursorKey = addDaysToDateKey(cursorKey, 1);
    // 防御：避免 cursor 走过 today。
    if (cursorKey > todayKey) break;
  }
  return false;
}

/**
 * 判定本周一至周六是否全部已签（用于周日 +2 抽奖判定）。
 * 含补签：只要 signedSet 中有该日期即视为已签。
 */
export function isMonThruSatAllSigned(today: Date, signedSet: Set<string>): boolean {
  const mondayKey = formatDateKey(getMondayOfWeek(today));
  for (let i = 0; i < 6; i += 1) {
    if (!signedSet.has(addDaysToDateKey(mondayKey, i))) return false;
  }
  return true;
}

/**
 * 计算指定 weekday 的当日应得积分。
 *
 * @param weekdayMon0 0 = 周一 ... 6 = 周日
 * @param weekBroken 本周一到该 weekday 之前是否存在漏签
 */
export function calcCheckinPoints(weekdayMon0: number, weekBroken: boolean): number {
  if (weekBroken) return BROKEN_WEEK_POINTS;
  const reward = WEEK_POINTS_GRADIENT[weekdayMon0];
  return reward ?? BROKEN_WEEK_POINTS;
}

/**
 * 计算指定 weekday 的当日应得额外抽奖次数。
 *
 * @param weekdayMon0 0 = 周一 ... 6 = 周日
 * @param monThruSatAllSigned 周日才用到，表示周一至周六是否全部已签到（含补签）
 */
export function calcCheckinSpins(
  weekdayMon0: number,
  monThruSatAllSigned: boolean,
): number {
  if (weekdayMon0 === 6) {
    return monThruSatAllSigned ? SUNDAY_FULL_BONUS_SPINS : SUNDAY_DEFAULT_SPINS;
  }
  return WEEKDAY_BONUS_SPINS;
}

/**
 * 给定一个本周内的目标日期与该日的 signedSet（含该日期之前已签的所有日子），
 * 判断该日期对应的"补签后是否仍存在更早漏签"。
 *
 * 用于补签某日时回算应发积分。
 */
export function hasBrokenBeforeDate(
  targetDate: Date,
  signedSet: Set<string>,
): boolean {
  const mondayKey = formatDateKey(getMondayOfWeek(targetDate));
  const targetKey = formatDateKey(targetDate);
  let cursorKey = mondayKey;
  while (cursorKey !== targetKey) {
    if (!signedSet.has(cursorKey)) return true;
    cursorKey = addDaysToDateKey(cursorKey, 1);
    if (cursorKey > targetKey) break;
  }
  return false;
}

/**
 * 判定目标日期是否在本周内（周一 ≤ date ≤ 周日）。
 */
export function isInCurrentWeek(date: Date, today: Date): boolean {
  const mondayThis = formatDateKey(getMondayOfWeek(today));
  const mondayThat = formatDateKey(getMondayOfWeek(date));
  return mondayThis === mondayThat;
}

/**
 * 解析 YYYY-MM-DD 字符串为中国时区 00:00 对应的 Date。
 * 非法输入返回 null。
 */
export function parseDateKey(value: string): Date | null {
  if (typeof value !== 'string') return null;
  const parts = parseDateKeyParts(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - CHINA_TZ_OFFSET_MS);
}
