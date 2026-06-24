import { describe, expect, it } from 'vitest';
import { formatChinaDateTime, formatChinaDateTimeInput, parseChinaDateTimeInput } from '../time';

describe('china time helpers', () => {
  it('parses datetime-local input as China time', () => {
    const timestamp = parseChinaDateTimeInput('2026-06-22T09:30');

    expect(timestamp).toBe(Date.UTC(2026, 5, 22, 1, 30));
  });

  it('rejects invalid calendar dates', () => {
    expect(parseChinaDateTimeInput('2026-02-30T12:00')).toBeNull();
  });

  it('formats timestamps back to China time', () => {
    const timestamp = Date.UTC(2026, 5, 22, 1, 30);

    expect(formatChinaDateTime(timestamp)).toBe('2026-06-22 09:30');
    expect(formatChinaDateTimeInput(timestamp)).toBe('2026-06-22T09:30');
  });
});
