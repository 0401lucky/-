import { describe, expect, it } from 'vitest';
import { calculateMatch3PointReward } from '../match3';

describe('match3 reward conversion', () => {
  it('按得分 10% 向下取整发放福利积分', () => {
    expect(calculateMatch3PointReward(0)).toBe(0);
    expect(calculateMatch3PointReward(9)).toBe(0);
    expect(calculateMatch3PointReward(99)).toBe(9);
    expect(calculateMatch3PointReward(860)).toBe(86);
  });
});
