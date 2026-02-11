import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import {
  clearLoginFailures,
  createSessionToken,
  getLoginLockStatus,
  parseSessionToken,
  recordLoginFailure,
  revokeAllUserSessions,
  revokeSessionToken,
  verifySessionSignature,
  verifySessionWithRevocation,
} from '@/lib/auth';

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    ttl: vi.fn(),
    expire: vi.fn(),
  },
}));

describe('auth security hardening', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvIncr = vi.mocked(kv.incr);
  const mockKvTtl = vi.mocked(kv.ttl);
  const mockKvExpire = vi.mocked(kv.expire);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.NODE_ENV = 'test';
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue('OK');
    mockKvDel.mockResolvedValue(1);
    mockKvIncr.mockResolvedValue(1);
    mockKvTtl.mockResolvedValue(-1);
    mockKvExpire.mockResolvedValue(1);
  });

  it('uses timing-safe signature verification', () => {
    const payload = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64');
    const token = createSessionToken({
      id: 1,
      username: 'alice',
      displayName: 'Alice',
      iat: Date.now(),
      exp: Date.now() + 60_000,
    });

    const signature = token.split('.')[1]!;
    expect(verifySessionSignature(payload, signature)).toBe(false);

    const validParts = token.split('.');
    expect(verifySessionSignature(validParts[0]!, validParts[1]!)).toBe(true);
  });

  it('adds jti and iat to session token', () => {
    const token = createSessionToken({
      id: 1,
      username: 'alice',
      displayName: 'Alice',
      exp: Date.now() + 60_000,
    });

    const parsed = parseSessionToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed?.jti).toBeTruthy();
    expect(parsed?.iat).toBeTypeOf('number');
  });

  it('can revoke token and rejects revoked session', async () => {
    const token = createSessionToken({
      id: 2,
      username: 'bob',
      displayName: 'Bob',
      iat: Date.now(),
      exp: Date.now() + 60_000,
    });

    await revokeSessionToken(token);
    expect(mockKvSet).toHaveBeenCalled();

    const parsed = parseSessionToken(token)!;
    mockKvGet
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce(null);

    const verified = await verifySessionWithRevocation(token);
    expect(verified).toBeNull();
    expect(mockKvGet).toHaveBeenNthCalledWith(1, `auth:session:blacklist:${parsed.jti}`);
  });

  it('supports revoke-all by user timestamp', async () => {
    await revokeAllUserSessions(123);
    expect(mockKvSet).toHaveBeenCalledWith(
      'auth:session:revoked-after:123',
      expect.any(String),
      { ex: 180 * 24 * 60 * 60 }
    );
  });

  it('locks login after repeated failures', async () => {
    mockKvIncr
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5);

    for (let i = 0; i < 4; i++) {
      const failure = await recordLoginFailure('Alice');
      expect(failure.locked).toBe(false);
    }

    const fifth = await recordLoginFailure('Alice');
    expect(fifth.locked).toBe(true);
    expect(fifth.remainingSeconds).toBe(15 * 60);

    mockKvTtl.mockResolvedValueOnce(120);
    const status = await getLoginLockStatus('Alice');
    expect(status).toEqual({ locked: true, remainingSeconds: 120 });

    await clearLoginFailures('Alice');
    expect(mockKvDel).toHaveBeenCalled();
  });
});
