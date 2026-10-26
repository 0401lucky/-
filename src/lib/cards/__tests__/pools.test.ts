import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITED_POOL, fromPoolDateTimeInput, getLimitedPoolStatus, oneMonthLater, toPoolDateTimeInput,
} from '../pools';

describe('限定卡池开放时间', () => {
  const startsAt = Date.parse('2026-10-26T10:00:00+08:00');
  const pool = { ...DEFAULT_LIMITED_POOL, enabled: true, startsAt, endsAt: oneMonthLater(startsAt) };

  it('在开始时间开放，在结束时间关闭', () => {
    expect(getLimitedPoolStatus(pool, startsAt - 1)).toBe('upcoming');
    expect(getLimitedPoolStatus(pool, startsAt)).toBe('open');
    expect(getLimitedPoolStatus(pool, pool.endsAt - 1)).toBe('open');
    expect(getLimitedPoolStatus(pool, pool.endsAt)).toBe('expired');
    expect(getLimitedPoolStatus({ ...pool, enabled: false }, startsAt)).toBe('disabled');
    expect(getLimitedPoolStatus({ ...pool, drawCost: 0 }, startsAt)).toBe('disabled');
  });

  it('北京时间输入不随浏览器所在时区改变', () => {
    expect(toPoolDateTimeInput(startsAt)).toBe('2026-10-26T10:00');
    expect(fromPoolDateTimeInput('2026-10-26T10:00')).toBe(startsAt);
    expect(fromPoolDateTimeInput('')).toBe(0);
  });

  it('一个自然月在短月份的月末截断，保留时分秒', () => {
    expect(new Date(oneMonthLater(Date.parse('2027-01-31T12:34:56Z'))).toISOString()).toBe('2027-02-28T12:34:56.000Z');
    expect(new Date(oneMonthLater(Date.parse('2028-01-31T12:34:56Z'))).toISOString()).toBe('2028-02-29T12:34:56.000Z');
    expect(oneMonthLater(Date.parse('2027-01-31T01:00:00+08:00'))).toBe(Date.parse('2027-02-28T01:00:00+08:00'));
    expect(new Date(pool.endsAt).toISOString()).toBe('2026-11-26T02:00:00.000Z');
  });
});
