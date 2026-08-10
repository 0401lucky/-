import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('登录页 Turnstile 接入', () => {
  it('从同源接口读取配置，并只在验证完成后提交一次性 token', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/login/page.tsx'),
      'utf8',
    );

    expect(source).toContain("fetch('/api/auth/turnstile-config'");
    expect(source).toContain('turnstileToken: turnstileConfig.enabled');
    expect(source).toContain('loading || turnstileBlocksLogin');
    expect(source).toContain('setTurnstileResetSignal((signal) => signal + 1)');
    expect(source).toContain("data.code === 'TURNSTILE_REQUIRED'");
    expect(source).toContain("data.code === 'TURNSTILE_FAILED'");
    expect(source).toContain('setConfigReloadSignal((signal) => signal + 1)');
  });

  it('显式渲染组件，并覆盖成功、过期、失败及卸载清理', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/TurnstileWidget.tsx'),
      'utf8',
    );

    expect(source).toContain('api.js?render=explicit');
    expect(source).toContain("'expired-callback'");
    expect(source).toContain("'error-callback'");
    expect(source).toContain('window.turnstile.remove(widgetId)');
    expect(source).toContain('window.turnstile.reset(widgetId)');
  });
});
