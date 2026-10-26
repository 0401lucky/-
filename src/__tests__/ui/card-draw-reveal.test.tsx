import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DrawReveal } from '@/components/cards/DrawReveal';
import { CARDS } from '@/lib/cards/config';
import { DRAW_MOTION } from '@/lib/cards/draw-animation';
import type { SingleDrawResult } from '@/lib/cards/draw-types';

const { burst, reset, create } = vi.hoisted(() => {
  const reset = vi.fn();
  const burst = Object.assign(vi.fn(), { reset });
  return { burst, reset, create: vi.fn(() => burst) };
});
vi.mock('canvas-confetti', () => ({ default: { create } }));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const results: SingleDrawResult[] = ['common', 'rare', 'epic', 'legendary', 'legendary_rare'].map((rarity, index) => ({
  card: CARDS.find((card) => card.albumId === 'hok-modern-s1' && card.rarity === rarity)!,
  isDuplicate: index === 1,
  fragmentsAdded: index === 1 ? 14 : undefined,
}));

describe('抽卡揭晓动画', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let onClose: Mock<() => void>;
  let onAgain: Mock<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    onClose = vi.fn<() => void>();
    onAgain = vi.fn<() => void>();
  });
  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const button = (label: string) => [...container.querySelectorAll('button')].find((entry) => entry.textContent?.includes(label))!;
  const advance = async (duration: number) => { await act(async () => vi.advanceTimersByTime(duration)); };
  const render = async (againDisabled = false) => {
    await act(async () => root.render(<DrawReveal results={results} cooldownRemaining={againDisabled ? 3 : 0}
      againDisabled={againDisabled} onClose={onClose} onAgain={onAgain} />));
  };

  it('依次翻开五张卡，只为本次最高稀有度触发一次有限彩屑', async () => {
    await render();
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    await advance(DRAW_MOTION.firstFlip);
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    await advance(4 * DRAW_MOTION.flipStagger + DRAW_MOTION.flip + DRAW_MOTION.settle);
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(5);
    expect(button('收下卡牌')).toBeEnabled();
    expect(container.textContent).toContain('5 张卡牌 · 4 张新卡');
    expect(container.textContent).toContain('+14 碎片');
    expect(create).toHaveBeenCalledTimes(1);
    expect(burst).toHaveBeenCalledTimes(2);
    expect(burst.mock.calls.reduce((sum, [options]) => sum + options.particleCount, 0)).toBeLessThanOrEqual(64);
  });

  it('立即揭晓会取消自动翻牌，后续不会再次发射彩屑', async () => {
    await render();
    await advance(DRAW_MOTION.firstFlip);
    await act(async () => button('立即揭晓').click());
    await advance(DRAW_MOTION.skip);
    expect(button('收下卡牌')).toBeEnabled();
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(5);
    await advance(5000);
    expect(burst).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('可单独点开一张卡，自动揭晓不会重复触发它', async () => {
    await render();
    const card = container.querySelector<HTMLButtonElement>('[aria-label="揭晓第 5 张卡牌"]')!;
    await act(async () => card.click());
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    await advance(3000);
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(5);
    expect(burst).toHaveBeenCalledTimes(2);
  });

  it('收下卡牌只触发一次退出回调，并停止彩屑', async () => {
    await render();
    await act(async () => button('立即揭晓').click());
    await advance(DRAW_MOTION.skip);
    await act(async () => { button('收下卡牌').click(); button('收下卡牌').click(); });
    expect(onClose).not.toHaveBeenCalled();
    await advance(DRAW_MOTION.exit);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAgain).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalled();
  });

  it('再次抽卡先完成退场，重复点击只触发一次回调', async () => {
    await render();
    await act(async () => button('立即揭晓').click());
    await advance(DRAW_MOTION.skip);
    await act(async () => { button('再抽一次').click(); button('再抽一次').click(); });
    expect(onAgain).not.toHaveBeenCalled();
    await advance(DRAW_MOTION.exit);
    expect(onAgain).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('冷却期间不能再次抽卡', async () => {
    await render(true);
    await act(async () => button('立即揭晓').click());
    await advance(DRAW_MOTION.skip);
    expect(button('冷却中 3s')).toBeDisabled();
    await act(async () => button('冷却中 3s').click());
    expect(onAgain).not.toHaveBeenCalled();
  });

  it('退出弹层后清理所有自动翻牌和特效计时器', async () => {
    await render();
    await act(async () => root.unmount());
    mounted = false;
    await advance(5000);
    expect(burst).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('自动翻开卡牌时保留键盘焦点', async () => {
    await render();
    const card = container.querySelector<HTMLButtonElement>('[aria-label="揭晓第 1 张卡牌"]')!;
    await act(async () => card.focus());
    await advance(DRAW_MOTION.firstFlip);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(card);
  });

  it('减少动态效果时直接显示全部结果，不发射彩屑', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    await render();
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(5);
    expect(button('收下卡牌')).toBeEnabled();
    await advance(5000);
    expect(burst).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
