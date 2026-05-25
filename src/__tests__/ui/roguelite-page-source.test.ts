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
});
