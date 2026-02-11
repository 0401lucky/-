import { describe, expect, it } from 'vitest';
import { secureRandomFloat, secureRandomIndex } from '@/lib/random';

describe('secure random utilities', () => {
  it('secureRandomIndex returns valid index range', () => {
    for (let i = 0; i < 100; i++) {
      const value = secureRandomIndex(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it('secureRandomFloat returns value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const value = secureRandomFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('secureRandomIndex throws for invalid length', () => {
    expect(() => secureRandomIndex(0)).toThrow('Invalid collection length');
    expect(() => secureRandomIndex(-1)).toThrow('Invalid collection length');
    expect(() => secureRandomIndex(1.5)).toThrow('Invalid collection length');
  });
});
