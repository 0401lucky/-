import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kvMock = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
};

vi.mock('@/lib/d1-kv', () => ({
  kv: kvMock,
}));

type MockResponseInit = {
  headers?: Record<string, string>;
  status?: number;
};

function createJsonResponse(data: unknown, init: MockResponseInit = {}) {
  const status = init.status ?? 200;
  const headers = new Map<string, string>();
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    headers.set(key.toLowerCase(), value);
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      },
      getSetCookie() {
        const cookie = headers.get('set-cookie');
        return cookie ? [cookie] : [];
      },
    },
    json: vi.fn().mockResolvedValue(data),
  };
}

describe('creditQuotaToUser', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NEW_API_URL = 'https://newapi.example.com';
    process.env.NEW_API_ADMIN_ACCESS_TOKEN = 'token-abc';
    process.env.NEW_API_ADMIN_USER_ID = '900';

    kvMock.set.mockResolvedValue('OK');
    kvMock.get.mockResolvedValue(null);
    kvMock.del.mockResolvedValue(1);
  });

  afterEach(() => {
    delete process.env.NEW_API_URL;
    delete process.env.NEW_API_ADMIN_ACCESS_TOKEN;
    delete process.env.NEW_API_ADMIN_USER_ID;
    vi.unstubAllGlobals();
  });

  it('uses /api/user/manage to add quota with access token headers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          id: 123,
          username: 'alice',
          display_name: 'Alice',
          role: 1,
          status: 1,
          email: 'alice@example.com',
          quota: 2000,
          used_quota: 0,
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        message: '',
      }));

    vi.stubGlobal('fetch', fetchMock);

    const { creditQuotaToUser } = await import('../new-api');
    const result = await creditQuotaToUser(123, 2);

    expect(result).toEqual({
      success: true,
      message: '成功充值 $2',
      newQuota: 1002000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://newapi.example.com/api/user/123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token-abc',
          'New-Api-User': '900',
        }),
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://newapi.example.com/api/user/manage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'token-abc',
          'New-Api-User': '900',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          id: 123,
          action: 'add_quota',
          mode: 'add',
          value: 1000000,
        }),
      }),
    );

    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? 'GET');
    expect(methods).not.toContain('PUT');
  });

  it('verifies quota by GET when manage API returns failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          id: 123,
          username: 'alice',
          display_name: 'Alice',
          role: 1,
          status: 1,
          email: 'alice@example.com',
          quota: 0,
          used_quota: 0,
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        success: false,
        message: 'temporary error',
      }))
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          id: 123,
          quota: 500000,
        },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const { creditQuotaToUser } = await import('../new-api');
    const result = await creditQuotaToUser(123, 1);

    expect(result).toEqual({
      success: true,
      message: '充值已确认成功',
      newQuota: 500000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://newapi.example.com/api/user/123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token-abc',
          'New-Api-User': '900',
        }),
      }),
    );
  });

  it('returns failure when access token env is missing', async () => {
    delete process.env.NEW_API_ADMIN_ACCESS_TOKEN;

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { creditQuotaToUser } = await import('../new-api');
    const result = await creditQuotaToUser(123, 1);

    expect(result.success).toBe(false);
    expect(result.message).toContain('NEW_API_ADMIN_ACCESS_TOKEN');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
