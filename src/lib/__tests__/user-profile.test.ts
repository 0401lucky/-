import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import {
  CUSTOM_AVATAR_MAX_LENGTH,
  CUSTOM_DISPLAY_NAME_MAX_LENGTH,
  QQ_EMAIL_MAX_LENGTH,
  getCustomUserProfile,
  updateCustomUserProfile,
  validateAvatarValue,
  validateDisplayName,
  validateQqEmail,
} from '../user-profile';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

describe('validateDisplayName', () => {
  it('treats null/undefined/empty as clear-instruction', () => {
    expect(validateDisplayName(null)).toEqual({ valid: true, value: null });
    expect(validateDisplayName(undefined)).toEqual({ valid: true, value: null });
    expect(validateDisplayName('')).toEqual({ valid: true, value: null });
    expect(validateDisplayName('   ')).toEqual({ valid: true, value: null });
  });

  it('rejects non-string types', () => {
    const result = validateDisplayName(123 as unknown);
    expect(result.valid).toBe(false);
  });

  it('accepts normal display names', () => {
    expect(validateDisplayName('小明')).toEqual({ valid: true, value: '小明' });
    expect(validateDisplayName('  Alice  ')).toEqual({ valid: true, value: 'Alice' });
  });

  it('rejects names exceeding max length', () => {
    const tooLong = 'a'.repeat(CUSTOM_DISPLAY_NAME_MAX_LENGTH + 1);
    const result = validateDisplayName(tooLong);
    expect(result.valid).toBe(false);
  });

  it('rejects names with control characters', () => {
    const result = validateDisplayName('hi\x00there');
    expect(result.valid).toBe(false);
  });
});

describe('validateAvatarValue', () => {
  it('returns null for clear-instruction', () => {
    expect(validateAvatarValue(null)).toEqual({ valid: true, value: null });
    expect(validateAvatarValue('')).toEqual({ valid: true, value: null });
    expect(validateAvatarValue('   ')).toEqual({ valid: true, value: null });
  });

  it('accepts https URLs', () => {
    const url = 'https://example.com/a.png';
    expect(validateAvatarValue(url)).toEqual({ valid: true, value: url });
  });

  it('accepts http URLs', () => {
    const url = 'http://example.com/a.png';
    expect(validateAvatarValue(url)).toEqual({ valid: true, value: url });
  });

  it('rejects non-http(s) URLs', () => {
    const result = validateAvatarValue('ftp://example.com/a.png');
    expect(result.valid).toBe(false);
  });

  it('rejects malformed URLs', () => {
    const result = validateAvatarValue('not-a-url');
    expect(result.valid).toBe(false);
  });

  it('accepts data URLs of supported image types', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    expect(validateAvatarValue(dataUrl)).toEqual({ valid: true, value: dataUrl });
  });

  it('rejects data URLs of unsupported MIME', () => {
    const result = validateAvatarValue('data:text/plain;base64,aGVsbG8=');
    expect(result.valid).toBe(false);
  });

  it('rejects oversized data URLs', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(CUSTOM_AVATAR_MAX_LENGTH + 100);
    const result = validateAvatarValue(huge);
    expect(result.valid).toBe(false);
  });
});

describe('validateQqEmail', () => {
  it('returns null for clear-instruction', () => {
    expect(validateQqEmail(null)).toEqual({ valid: true, value: null });
    expect(validateQqEmail(undefined)).toEqual({ valid: true, value: null });
    expect(validateQqEmail('')).toEqual({ valid: true, value: null });
    expect(validateQqEmail('   ')).toEqual({ valid: true, value: null });
  });

  it('normalizes valid QQ email values', () => {
    expect(validateQqEmail('  123456@QQ.COM  ')).toEqual({ valid: true, value: '123456@qq.com' });
  });

  it('rejects non-QQ email values', () => {
    const result = validateQqEmail('123456@example.com');
    expect(result.valid).toBe(false);
  });

  it('rejects invalid QQ numbers', () => {
    expect(validateQqEmail('1234@qq.com').valid).toBe(false);
    expect(validateQqEmail('012345@qq.com').valid).toBe(false);
  });

  it('rejects values with control characters', () => {
    const result = validateQqEmail('123456@qq.com\x00');
    expect(result.valid).toBe(false);
  });

  it('rejects oversized values', () => {
    const tooLong = `${'1'.repeat(QQ_EMAIL_MAX_LENGTH)}@qq.com`;
    const result = validateQqEmail(tooLong);
    expect(result.valid).toBe(false);
  });
});

describe('getCustomUserProfile', () => {
  const mockGet = vi.mocked(kv.get);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty object when no record stored', async () => {
    mockGet.mockResolvedValue(null);
    const result = await getCustomUserProfile(1);
    expect(result).toEqual({});
  });

  it('returns sanitized record when stored', async () => {
    mockGet.mockResolvedValue({
      displayName: 'Alice',
      avatarUrl: 'https://example.com/a.png',
      qqEmail: '123456@qq.com',
      updatedAt: 1000,
    });
    const result = await getCustomUserProfile(1);
    expect(result).toEqual({
      displayName: 'Alice',
      avatarUrl: 'https://example.com/a.png',
      qqEmail: '123456@qq.com',
      updatedAt: 1000,
    });
  });

  it('drops malformed fields', async () => {
    mockGet.mockResolvedValue({
      displayName: 123,
      avatarUrl: '',
      qqEmail: 'bad@example.com',
      updatedAt: 'invalid',
    });
    const result = await getCustomUserProfile(1);
    expect(result).toEqual({});
  });
});

describe('updateCustomUserProfile', () => {
  const mockGet = vi.mocked(kv.get);
  const mockSet = vi.mocked(kv.set);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      displayName: 'Old',
      avatarUrl: 'https://example.com/old.png',
      updatedAt: 1000,
    });
    mockSet.mockResolvedValue('OK');
  });

  it('updates displayName only when avatarUrl is omitted', async () => {
    const result = await updateCustomUserProfile(1, { displayName: 'New' });
    expect(result.displayName).toBe('New');
    expect(result.avatarUrl).toBe('https://example.com/old.png');
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it('clears avatarUrl when set to null', async () => {
    const result = await updateCustomUserProfile(1, { avatarUrl: null });
    expect(result.avatarUrl).toBeUndefined();
    expect(result.displayName).toBe('Old');
  });

  it('updates qqEmail when provided', async () => {
    const result = await updateCustomUserProfile(1, { qqEmail: '654321@qq.com' });
    expect(result.qqEmail).toBe('654321@qq.com');
    expect(result.displayName).toBe('Old');
  });

  it('clears qqEmail when set to null', async () => {
    mockGet.mockResolvedValue({
      displayName: 'Old',
      avatarUrl: 'https://example.com/old.png',
      qqEmail: '123456@qq.com',
      updatedAt: 1000,
    });

    const result = await updateCustomUserProfile(1, { qqEmail: null });
    expect(result.qqEmail).toBeUndefined();
    expect(result.displayName).toBe('Old');
  });

  it('updates updatedAt timestamp on every write', async () => {
    const before = Date.now() - 1;
    const result = await updateCustomUserProfile(1, { displayName: 'New' });
    expect(result.updatedAt).toBeGreaterThan(before);
  });
});
