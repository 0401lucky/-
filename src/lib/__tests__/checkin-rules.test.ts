import { describe, expect, it } from 'vitest';
import {
  BROKEN_WEEK_POINTS,
  SUNDAY_DEFAULT_SPINS,
  SUNDAY_FULL_BONUS_SPINS,
  WEEKDAY_BONUS_SPINS,
  WEEK_POINTS_GRADIENT,
  calcCheckinPoints,
  calcCheckinSpins,
  formatDateKey,
  getMondayOfWeek,
  getWeekdayMon0,
  hasBrokenBeforeDate,
  hasBrokenBeforeToday,
  isInCurrentWeek,
  isMonThruSatAllSigned,
  listWeekDateKeys,
  parseDateKey,
} from '../checkin-rules';

describe('checkin-rules: 周梯度积分', () => {
  it('正常梯度按周一到周日发放', () => {
    expect(WEEK_POINTS_GRADIENT).toEqual([50, 50, 50, 60, 60, 70, 100]);
    for (let i = 0; i < 7; i += 1) {
      expect(calcCheckinPoints(i, false)).toBe(WEEK_POINTS_GRADIENT[i]);
    }
  });

  it('本周漏签后整周降级为 50 分', () => {
    for (let i = 0; i < 7; i += 1) {
      expect(calcCheckinPoints(i, true)).toBe(BROKEN_WEEK_POINTS);
    }
  });

  it('非法 weekday 返回保底分数', () => {
    expect(calcCheckinPoints(-1, false)).toBe(BROKEN_WEEK_POINTS);
    expect(calcCheckinPoints(7, false)).toBe(BROKEN_WEEK_POINTS);
  });
});

describe('checkin-rules: 抽奖机会', () => {
  it('周一至周六固定 1 抽', () => {
    for (let i = 0; i < 6; i += 1) {
      expect(calcCheckinSpins(i, false)).toBe(WEEKDAY_BONUS_SPINS);
      expect(calcCheckinSpins(i, true)).toBe(WEEKDAY_BONUS_SPINS);
    }
  });

  it('周日全勤 +2，否则 +1', () => {
    expect(calcCheckinSpins(6, true)).toBe(SUNDAY_FULL_BONUS_SPINS);
    expect(calcCheckinSpins(6, false)).toBe(SUNDAY_DEFAULT_SPINS);
  });
});

describe('checkin-rules: 日期工具', () => {
  it('getWeekdayMon0：周一 0、周日 6', () => {
    // 2026-05-04 是周一
    expect(getWeekdayMon0(new Date(2026, 4, 4))).toBe(0);
    // 2026-05-10 是周日
    expect(getWeekdayMon0(new Date(2026, 4, 10))).toBe(6);
    // 2026-05-07 是周四
    expect(getWeekdayMon0(new Date(2026, 4, 7))).toBe(3);
  });

  it('日期工具按中国时区计算，避免 UTC 环境跨日错位', () => {
    const utcNight = new Date('2026-05-20T16:30:00.000Z');
    expect(formatDateKey(utcNight)).toBe('2026-05-21');
    expect(getWeekdayMon0(utcNight)).toBe(3);
    expect(formatDateKey(getMondayOfWeek(utcNight))).toBe('2026-05-18');
  });

  it('getMondayOfWeek：取所在周的周一', () => {
    const wed = new Date(2026, 4, 6); // 周三
    expect(formatDateKey(getMondayOfWeek(wed))).toBe('2026-05-04');
    const sun = new Date(2026, 4, 10); // 周日
    expect(formatDateKey(getMondayOfWeek(sun))).toBe('2026-05-04');
    const mon = new Date(2026, 4, 4);
    expect(formatDateKey(getMondayOfWeek(mon))).toBe('2026-05-04');
  });

  it('listWeekDateKeys：周一开始的 7 个日期', () => {
    const days = listWeekDateKeys(new Date(2026, 4, 6));
    expect(days).toEqual([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
      '2026-05-09',
      '2026-05-10',
    ]);
  });

  it('isInCurrentWeek：判断是否同一周', () => {
    const mon = new Date(2026, 4, 4); // 周一
    const sun = new Date(2026, 4, 10); // 周日
    const nextMon = new Date(2026, 4, 11); // 下周一
    expect(isInCurrentWeek(mon, sun)).toBe(true);
    expect(isInCurrentWeek(sun, mon)).toBe(true);
    expect(isInCurrentWeek(nextMon, mon)).toBe(false);
  });

  it('parseDateKey：解析合法 YYYY-MM-DD，拒绝非法', () => {
    const d = parseDateKey('2026-05-07');
    expect(d).not.toBeNull();
    expect(formatDateKey(d!)).toBe('2026-05-07');
    expect(parseDateKey('2026-13-01')).toBeNull();
    expect(parseDateKey('abc')).toBeNull();
    expect(parseDateKey('')).toBeNull();
  });
});

describe('checkin-rules: 漏签判定', () => {
  it('周一签到无前置漏签', () => {
    const mon = new Date(2026, 4, 4); // 周一
    expect(hasBrokenBeforeToday(mon, new Set())).toBe(false);
  });

  it('周三签到，若周一周二已签则未漏签', () => {
    const wed = new Date(2026, 4, 6);
    const set = new Set(['2026-05-04', '2026-05-05']);
    expect(hasBrokenBeforeToday(wed, set)).toBe(false);
  });

  it('周三签到，若周一未签则视为漏签', () => {
    const wed = new Date(2026, 4, 6);
    const set = new Set(['2026-05-05']);
    expect(hasBrokenBeforeToday(wed, set)).toBe(true);
  });

  it('hasBrokenBeforeDate：补签当日的回算', () => {
    // 假设当前周一/三已签，要回算补签周二的应发积分
    const tue = new Date(2026, 4, 5);
    const setBeforeTue = new Set(['2026-05-04']);
    // 周二之前只有周一，已签，因此无漏签
    expect(hasBrokenBeforeDate(tue, setBeforeTue)).toBe(false);

    const wed = new Date(2026, 4, 6);
    const setBeforeWed = new Set(['2026-05-04']); // 周二仍漏
    expect(hasBrokenBeforeDate(wed, setBeforeWed)).toBe(true);
  });
});

describe('checkin-rules: 周一至周六全勤判定', () => {
  it('周一至周六全签返回 true（含补签）', () => {
    const sun = new Date(2026, 4, 10);
    const set = new Set([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
      '2026-05-09',
    ]);
    expect(isMonThruSatAllSigned(sun, set)).toBe(true);
  });

  it('周一至周六任一未签返回 false', () => {
    const sun = new Date(2026, 4, 10);
    const set = new Set([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      // 周四漏
      '2026-05-08',
      '2026-05-09',
    ]);
    expect(isMonThruSatAllSigned(sun, set)).toBe(false);
  });
});
