import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DrawReveal } from '@/components/cards/DrawReveal';
import { CARDS } from '@/lib/cards/config';
import { DRAW_MOTION, getShowcaseDuration } from '@/lib/cards/draw-animation';
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

describe('流星预告抽卡动画', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let onClose: Mock<() => void>;
  let onAgain: Mock<() => void>;
  let preference: MediaQueryList;
  let motionListeners: Set<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    motionListeners = new Set();
    preference = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => motionListeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: () => void) => motionListeners.delete(listener)),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => preference));
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
  const click = async (label: string) => { await act(async () => button(label).click()); };
  const advance = async (duration: number) => { await act(async () => vi.advanceTimersByTimeAsync(duration)); };
  const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]')!;
  const images = () => [...container.querySelectorAll('img')];
  const render = async ({ drawResults = results, againDisabled = false, cooldownRemaining = 0, drawCost = 1 } = {}) => {
    await act(async () => root.render(<DrawReveal results={drawResults} cooldownRemaining={cooldownRemaining}
      drawCost={drawCost} againDisabled={againDisabled} onClose={onClose} onAgain={onAgain} />));
  };
  const showFirst = () => advance(DRAW_MOTION.meteor + DRAW_MOTION.impact);
  const changeMotion = async (matches: boolean) => {
    await act(async () => {
      Object.assign(preference, { matches });
      motionListeners.forEach((listener) => listener());
    });
  };

  it('最高等级预告后按接口顺序逐张展示高清卡面，最后汇总且仅庆祝一次', async () => {
    const ordered = [results[1], results[0], results[4], results[2], results[3]];
    await render({ drawResults: ordered });
    expect(dialog()).toHaveAttribute('data-phase', 'meteor');
    expect(container.querySelector('[data-meteor-rarity]')).toHaveAttribute('data-meteor-rarity', 'legendary_rare');
    expect(images()).toHaveLength(0);
    await showFirst();
    for (const [index, result] of ordered.entries()) {
      expect(dialog()).toHaveAttribute('data-phase', 'showcase');
      expect(images()).toHaveLength(1);
      expect(images()[0]).toHaveAttribute('alt', result.card.name);
      expect(images()[0]).toHaveAttribute('src', result.card.image);
      expect(container.textContent).toContain(`第 ${index + 1} / 5 张`);
      await advance(getShowcaseDuration(result.card.rarity));
    }
    expect(dialog()).toHaveAttribute('data-phase', 'complete');
    expect(images().map((image) => image.alt)).toEqual(ordered.map((result) => result.card.name));
    expect(images().map((image) => image.getAttribute('src'))).toEqual(ordered.map((result) => result.card.thumbnailImage));
    expect(button('收下卡牌')).toBeEnabled();
    expect(container.textContent).toContain('5 张卡牌 · 4 张新卡');
    expect(container.textContent).toContain('+14 碎片');
    expect(create).toHaveBeenCalledTimes(1);
    expect(burst).toHaveBeenCalledTimes(2);
    expect(burst.mock.calls.reduce((sum, [options]) => sum + options.particleCount, 0)).toBeLessThanOrEqual(64);
  });

  it('流星期间跳过直接显示全部结果，取消后续动画和彩屑', async () => {
    await render();
    await click('跳过动画');
    expect(button('收下卡牌')).toBeEnabled();
    expect(images()).toHaveLength(5);
    await advance(20000);
    expect(burst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('点击下一张能加速，快速重复点击只推进一张且不会被旧计时器再次推进', async () => {
    await render();
    await showFirst();
    await advance(DRAW_MOTION.minimumShowcase);
    await act(async () => { button('下一张').click(); button('下一张').click(); });
    expect(images()[0]).toHaveAttribute('alt', results[1].card.name);
    await advance(getShowcaseDuration('common') - DRAW_MOTION.minimumShowcase);
    expect(images()[0]).toHaveAttribute('alt', results[1].card.name);
  });

  it('高等级卡停留更久，点击卡面和方向键也能继续', async () => {
    await render({ drawResults: [results[0], results[4], results[1]] });
    await showFirst();
    await advance(getShowcaseDuration('common'));
    expect(images()[0]).toHaveAttribute('alt', results[4].card.name);
    await advance(getShowcaseDuration('common'));
    expect(dialog()).toHaveAttribute('data-phase', 'showcase');
    await act(async () => dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(images()[0]).toHaveAttribute('alt', results[1].card.name);
    await advance(DRAW_MOTION.minimumShowcase);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="下一张卡牌"]')!.click());
    expect(dialog()).toHaveAttribute('data-phase', 'complete');
  });

  it('特效已经开始后跳过会立即清理，后续不重复发射', async () => {
    await render({ drawResults: [results[4], results[0], results[4]] });
    await showFirst();
    await advance(DRAW_MOTION.celebrationDelay);
    expect(burst).toHaveBeenCalledTimes(2);
    await click('跳过动画');
    expect(reset).toHaveBeenCalled();
    await advance(20000);
    expect(images()).toHaveLength(3);
    expect(burst).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('单抽保留大卡和高清图，入场后即可收下且彩屑自然结束', async () => {
    await render({ drawResults: [results[4]] });
    await showFirst();
    const portrait = images()[0];
    await advance(DRAW_MOTION.materialize);
    expect(dialog()).toHaveAttribute('data-phase', 'complete');
    expect(images()).toEqual([portrait]);
    expect(portrait).toHaveAttribute('src', results[4].card.image);
    expect(button('收下卡牌')).toBeEnabled();
    expect(burst).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();
  });

  it.each([0, 1])('低等级卡 %s 不创建粒子画布', async (index) => {
    await render({ drawResults: [results[index]] });
    await showFirst();
    await advance(DRAW_MOTION.materialize);
    expect(button('收下卡牌')).toBeEnabled();
    expect(create).not.toHaveBeenCalled();
  });

  it('收下卡牌只触发一次退出回调，并停止彩屑', async () => {
    await render({ drawResults: [results[4]] });
    await showFirst();
    await advance(DRAW_MOTION.materialize);
    await act(async () => { button('收下卡牌').click(); button('收下卡牌').click(); });
    expect(onClose).not.toHaveBeenCalled();
    await advance(DRAW_MOTION.exit);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAgain).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalled();
  });

  it('再次抽卡先完成退场，重复点击只触发一次回调', async () => {
    await render();
    await click('跳过动画');
    await act(async () => { button('再抽一次').click(); button('再抽一次').click(); });
    expect(onAgain).not.toHaveBeenCalled();
    await advance(DRAW_MOTION.exit);
    expect(onAgain).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('冷却期间不能再次抽卡', async () => {
    await render({ cooldownRemaining: 3 });
    await click('跳过动画');
    expect(button('冷却中 3s')).toBeDisabled();
    await act(async () => button('冷却中 3s').click());
    expect(onAgain).not.toHaveBeenCalled();
  });

  it('限定池再次抽卡显示真实消耗，余额不足时保持禁用', async () => {
    await render({ drawCost: 2, againDisabled: true });
    await click('跳过动画');
    expect(button('再抽一次')).toHaveTextContent('−10');
    expect(button('再抽一次')).toBeDisabled();
    await click('再抽一次');
    expect(onAgain).not.toHaveBeenCalled();
  });

  it.each(['meteor', 'showcase'])('%s 阶段卸载清理动画计时器、粒子和动态偏好监听', async (phase) => {
    await render({ drawResults: [results[4]] });
    if (phase === 'showcase') {
      await showFirst();
      await advance(DRAW_MOTION.celebrationDelay);
    }
    const fired = burst.mock.calls.length;
    await act(async () => root.unmount());
    mounted = false;
    await advance(20000);
    expect(burst).toHaveBeenCalledTimes(fired);
    expect(motionListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('自动推进时保留卡面按钮的键盘焦点', async () => {
    await render();
    await showFirst();
    const card = container.querySelector<HTMLButtonElement>('[aria-label="下一张卡牌"]')!;
    await act(async () => card.focus());
    await advance(getShowcaseDuration('common'));
    expect(images()[0]).toHaveAttribute('alt', results[1].card.name);
    expect(document.activeElement).toBe(card);
  });

  it('Tab 留在弹层内，Esc 先跳过，再关闭', async () => {
    await render();
    expect(document.activeElement).toBe(button('跳过动画'));
    await act(async () => button('跳过动画').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(container.querySelector('[aria-label="跳过抽卡动画"]'));
    await act(async () => dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(button('收下卡牌'));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await advance(DRAW_MOTION.exit);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('弹层卸载后恢复进入前的键盘焦点', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    try {
      opener.focus();
      await render();
      expect(document.activeElement).toBe(button('跳过动画'));
      await act(async () => root.unmount());
      mounted = false;
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it('冷却值更新不会重启流星或逐张揭晓', async () => {
    await render({ cooldownRemaining: 5 });
    await advance(1000);
    await render({ cooldownRemaining: 4 });
    await advance(DRAW_MOTION.meteor + DRAW_MOTION.impact - 1000);
    expect(images()[0]).toHaveAttribute('alt', results[0].card.name);
    await advance(getShowcaseDuration('common'));
    expect(images()[0]).toHaveAttribute('alt', results[1].card.name);
  });

  it('减少动态效果时直接显示全部结果，不发射彩屑', async () => {
    Object.assign(preference, { matches: true });
    await render();
    expect(images()).toHaveLength(5);
    expect(button('收下卡牌')).toBeEnabled();
    await advance(5000);
    expect(burst).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('中途开启减少动态效果会停止特效，关闭该偏好也不重播', async () => {
    await render({ drawResults: [results[4], results[0]] });
    await showFirst();
    await advance(DRAW_MOTION.celebrationDelay);
    await changeMotion(true);
    expect(dialog()).toHaveAttribute('data-phase', 'complete');
    expect(images()).toHaveLength(2);
    expect(reset).toHaveBeenCalled();
    await changeMotion(false);
    await advance(20000);
    expect(burst).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('退出中切换动态偏好不会丢失退出回调', async () => {
    await render();
    await click('跳过动画');
    await click('收下卡牌');
    await changeMotion(true);
    await advance(DRAW_MOTION.exit);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
