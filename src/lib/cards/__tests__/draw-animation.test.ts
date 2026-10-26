import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARDS } from '../config';
import { DRAW_MOTION, getDrawImage, prepareDrawImages, waitForDrawIntro } from '../draw-animation';

describe('抽卡图片准备', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('单抽使用高清图，连抽使用缩略图', () => {
    expect(getDrawImage(CARDS[0], true)).toBe(CARDS[0].image);
    expect(getDrawImage(CARDS[0], false)).toBe(CARDS[0].thumbnailImage);
  });

  it('重复卡图只准备一次，并等待解码完成', async () => {
    const decoded: (() => void)[] = [];
    const images: { onload: (() => void) | null; onerror: (() => void) | null; src: string }[] = [];
    class FakeImage {
      onload = null;
      onerror = null;
      src = '';
      decode = () => new Promise<void>((resolve) => decoded.push(resolve));
      constructor() { images.push(this); }
    }
    vi.stubGlobal('Image', FakeImage);
    const done = vi.fn();
    const pending = prepareDrawImages([CARDS[0], CARDS[0]], new AbortController().signal).then(done);
    expect(images).toHaveLength(1);
    images[0].onload?.();
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    decoded[0]();
    await pending;
    expect(done).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('图片卡住时最多等待 1600 毫秒', async () => {
    vi.stubGlobal('Image', class { onload = null; onerror = null; src = ''; });
    const done = vi.fn();
    const pending = prepareDrawImages([CARDS[0]], new AbortController().signal).then(done);
    await vi.advanceTimersByTimeAsync(DRAW_MOTION.imageTimeout - 1);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toHaveBeenCalledOnce();
  });

  it('离开页面会立即结束图片等待和蓄光等待', async () => {
    vi.stubGlobal('Image', class { onload = null; onerror = null; src = ''; });
    const signal = new AbortController();
    const pending = Promise.all([prepareDrawImages([CARDS[0]], signal.signal), waitForDrawIntro(signal.signal)]);
    signal.abort();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
