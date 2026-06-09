import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('roguelite page wiring', () => {
  it('无尽阶段提供撤离动作入口，允许进入结算流程', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/games/roguelite/page.tsx'),
      'utf8',
    );

    expect(source).toContain('撤离迷阵');
    expect(source).toContain("onEscape={() => void stepGame({ type: 'escape' })}");
  });

  it('行动失败后会同步服务端迷阵状态，避免 pending 状态卡死', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/games/roguelite/page.tsx'),
      'utf8',
    );

    expect(source).toContain('shouldRefreshRogueliteStatusAfterStepError');
    expect(source).toContain("message.includes('HTTP 503')");
    expect(source).toContain("message.includes('当前事件尚未处理完成')");
    expect(source).toContain("message.includes('行动次数过多')");
    expect(source).toContain('data?.data?.session');
    expect(source).toContain('void fetchStatus();');
    expect(source).toContain('已同步迷阵状态，请先处理当前事件');
  });
});
