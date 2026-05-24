import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFarmMaturityEmailConfigured, sendFarmMaturityEmail, sendFarmWaterReminderEmail } from '../email';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('farm maturity email', () => {
  it('reports configuration status from env', () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.FARM_MAIL_FROM;
    expect(isFarmMaturityEmailConfigured()).toBe(false);

    process.env.RESEND_API_KEY = 'test-key';
    process.env.FARM_MAIL_FROM = 'farm@example.com';
    expect(isFarmMaturityEmailConfigured()).toBe(true);
  });

  it('skips send when email env is missing', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.FARM_MAIL_FROM;

    const result = await sendFarmMaturityEmail({
      to: '123456@qq.com',
      cropName: '小麦',
      matureAt: 1_700_000_000_000,
      petName: '小白猫',
    });

    expect(result).toEqual({ sent: false, skipped: true, reason: 'email_not_configured' });
  });

  it('sends email through configured HTTP provider', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.FARM_MAIL_FROM = 'farm@example.com';
    process.env.RESEND_API_URL = 'https://mail.test/emails';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn(),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendFarmMaturityEmail({
      to: '123456@qq.com',
      cropName: '小麦',
      matureAt: 1_700_000_000_000,
      petName: '小白猫',
    });

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledWith('https://mail.test/emails', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      }),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.from).toBe('farm@example.com');
    expect(body.to).toEqual(['123456@qq.com']);
    expect(body.subject).toContain('小麦');
    expect(body.text).toContain('小白猫');
  });

  it('sends watering reminder email through configured HTTP provider', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.FARM_MAIL_FROM = 'farm@example.com';
    process.env.RESEND_API_URL = 'https://mail.test/emails';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn(),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendFarmWaterReminderEmail({
      to: '123456@qq.com',
      cropName: '胡萝卜',
      landIndex: 2,
      waterDueAt: 1_700_000_000_000,
      petName: '小白猫',
    });

    expect(result).toEqual({ sent: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual(['123456@qq.com']);
    expect(body.subject).toContain('第 2 块地');
    expect(body.text).toContain('胡萝卜');
    expect(body.text).toContain('小白猫');
  });

  it('throws when provider returns an error', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.FARM_MAIL_FROM = 'farm@example.com';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('provider down'),
    }));

    await expect(sendFarmMaturityEmail({
      to: '123456@qq.com',
      cropName: '小麦',
      matureAt: 1_700_000_000_000,
    })).rejects.toThrow('邮件发送失败: 500 provider down');
  });
});
