import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DrawPage from '@/app/cards/draw/page';
import AdminCardsPage from '@/app/admin/cards/page';
import { ALBUMS, CARDS } from '@/lib/cards/config';
import { PITY_THRESHOLDS, RARITY_PROBABILITIES } from '@/lib/cards/constants';
import type { LimitedPoolConfig } from '@/lib/cards/types';
import type { SingleDrawResult } from '@/lib/cards/draw-types';

const { notify, router } = vi.hoisted(() => ({ notify: vi.fn(), router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock('@/components/admin/AdminFeedback', () => ({ useAdminFeedback: () => ({ notify, confirm: vi.fn() }) }));
vi.mock('@/lib/cards/draw-animation', () => ({ prepareDrawImages: vi.fn(async () => {}), waitForDrawIntro: vi.fn(async () => {}) }));
vi.mock('@/components/cards/DrawReveal', () => ({
  DrawReveal: ({ results, drawCost = 1, againDisabled, onAgain, onClose }: { results: SingleDrawResult[]; drawCost?: number; againDisabled: boolean; onAgain: () => void; onClose: () => void }) => (
    <div role="dialog"><button disabled={againDisabled} onClick={onAgain}>再抽一次 −{results.length * drawCost}</button><button onClick={onClose}>收下卡牌</button></div>
  ),
}));

describe('限定卡池用户流程', () => {
  const now = Date.parse('2026-10-26T02:00:00Z');
  let container: HTMLDivElement;
  let root: Root;
  let drawsAvailable: number;
  let serverTime: number | undefined;
  let rules: {
    rarityProbabilities: typeof RARITY_PROBABILITIES;
    pityThresholds: typeof PITY_THRESHOLDS;
    cardDrawPrice: number;
    fragmentValues: typeof RARITY_PROBABILITIES;
    exchangePrices: typeof RARITY_PROBABILITIES;
    limitedPool: LimitedPoolConfig;
    updatedAt: number;
  };
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('alert', vi.fn());
    window.history.replaceState(null, '', '/cards/draw');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    drawsAvailable = 11;
    serverTime = undefined;
    rules = {
      rarityProbabilities: RARITY_PROBABILITIES,
      pityThresholds: PITY_THRESHOLDS,
      cardDrawPrice: 900,
      fragmentValues: { common: 9, rare: 14, epic: 26, legendary: 50, legendary_rare: 100 },
      exchangePrices: { common: 30, rare: 80, epic: 200, legendary: 500, legendary_rare: 1000 },
      limitedPool: { enabled: true, albumId: 'hok-modern-s1', drawCost: 2, startsAt: now - 1000, endsAt: now + 86400000 },
      updatedAt: now,
    };
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    fetchMock = vi.fn<typeof fetch>(async (url, options) => {
      const path = String(url);
      if (path === '/api/auth/me') return json({ success: true });
      if (path === '/api/cards/inventory') return json({ success: true, data: { inventory: [], fragments: 0, drawsAvailable, collectionRewards: [] } });
      if (path === '/api/cards/rules' || path === '/api/admin/cards/rules') {
        if (options?.method === 'PATCH') rules = JSON.parse(String(options.body));
        return json({ success: true, data: { ...rules, serverTime: serverTime ?? Date.now() } });
      }
      if (path.startsWith('/api/admin/cards/users')) return json({ success: true, users: [], pagination: { total: 0, hasMore: false } });
      if (path === '/api/admin/cards/albums') return json({ success: true, albums: ALBUMS.map((album) => ({ ...album, currentReward: album.reward, defaultReward: album.reward })), tiers: [] });
      if (path === '/api/cards/draw') {
        const input = JSON.parse(String(options?.body));
        if (input.rulesUpdatedAt !== rules.updatedAt) return json({ success: false, message: '卡池配置已更新，请刷新后重试', drawsAvailable }, 400);
        const card = CARDS.find((card) => card.albumId === (input.poolId === 'limited' ? rules.limitedPool.albumId : 'animal-s1'))!;
        drawsAvailable -= input.count * (input.poolId === 'limited' ? rules.limitedPool.drawCost : 1);
        const cards = Array.from({ length: input.count }, () => ({ card, isDuplicate: false }));
        return json({ success: true, data: { success: true, drawsAvailable, ...(input.count === 1 ? cards[0] : { cards }) } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const button = (label: string) => [...container.querySelectorAll('button')].find((entry) => entry.textContent?.includes(label))!;
  const click = async (label: string) => { await act(async () => button(label).click()); };
  const renderDraw = async () => { await act(async () => root.render(<DrawPage />)); };
  const drawCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/cards/draw');

  it('切换卡池后显示限定卡册和真实的单抽、五连抽消耗', async () => {
    await renderDraw();
    expect(button('单抽').textContent).toContain('−1');
    await click('限定卡池');
    expect(button('限定卡池')).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.pool-info')?.textContent).toContain('王者荣耀现代图鉴限定池');
    expect(container.querySelector('.pool-info')?.textContent).toContain('128 张');
    expect(button('单抽').textContent).toContain('−2');
    expect(button('五连抽').textContent).toContain('−10');
  });

  it('余额只有 9 次时禁用限定池五连抽', async () => {
    drawsAvailable = 9;
    await renderDraw();
    await click('限定卡池');
    expect(button('单抽')).toBeEnabled();
    expect(button('五连抽')).toBeDisabled();
    await click('五连抽');
    expect(drawCalls()).toHaveLength(0);
  });

  it('限定五连抽传入指定卡池，余额不足时再次抽取保持禁用', async () => {
    await renderDraw();
    await click('限定卡池');
    await click('五连抽');
    expect(JSON.parse(String(drawCalls()[0][1]?.body))).toMatchObject({ count: 5, poolId: 'limited', rulesUpdatedAt: now });
    expect(drawsAvailable).toBe(1);
    expect(button('再抽一次')).toHaveTextContent('−10');
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(button('再抽一次')).toBeDisabled();
    await click('再抽一次');
    expect(drawCalls()).toHaveLength(1);
  });

  it('使用服务端时间，倒计时到期后停止抽取', async () => {
    serverTime = now;
    rules.limitedPool.endsAt = now + 1000;
    vi.setSystemTime(now - 3600000);
    await renderDraw();
    await click('限定卡池');
    expect(button('单抽')).toBeEnabled();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.textContent).toContain('本期限定池已结束');
    expect(button('单抽')).toBeDisabled();
    expect(button('五连抽')).toBeDisabled();
  });

  it('旧配置被拒绝后刷新价格，不展示成功结果', async () => {
    await renderDraw();
    await click('限定卡池');
    // 后台修改配置，页面中的旧响应保持不变。
    rules = { ...rules, limitedPool: { ...rules.limitedPool, drawCost: 3 }, updatedAt: now + 1 };
    await click('单抽');
    expect(alert).toHaveBeenCalledWith('卡池配置已更新，请刷新后重试');
    expect(drawsAvailable).toBe(11);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(button('单抽').textContent).toContain('−3');
  });

  it('从卡册入口进入时自动选中对应的限定池', async () => {
    window.history.replaceState(null, '', '/cards/draw?albumId=hok-modern-s1');
    await renderDraw();
    expect(button('限定卡池')).toHaveAttribute('aria-pressed', 'true');
  });

  it('后台可以更改限定卡册和消耗，并保存北京时间区间', async () => {
    await act(async () => root.render(<AdminCardsPage />));
    await click('规则');
    const field = (label: string) => [...container.querySelectorAll('label')].find((entry) => entry.textContent?.includes(label))!;
    const select = field('限定卡册').querySelector('select')!;
    await act(async () => { select.value = 'tarot'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const input = field('限定池单抽消耗').querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '3');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('限定池五连抽消耗 15 次');
    await click('保存规则');
    const saved = fetchMock.mock.calls.find(([url, options]) => url === '/api/admin/cards/rules' && options?.method === 'PATCH')!;
    expect(JSON.parse(String(saved[1]?.body)).limitedPool).toMatchObject({ albumId: 'tarot', drawCost: 3, startsAt: now - 1000, endsAt: now + 86400000 });
    expect(notify).toHaveBeenCalledWith('卡牌规则保存成功');
  });

  it('后台一键设置从现在开始的一个自然月', async () => {
    rules.limitedPool = { ...rules.limitedPool, enabled: false, startsAt: 0, endsAt: 0 };
    await act(async () => root.render(<AdminCardsPage />));
    await click('规则');
    await click('从现在开放一个月');
    await click('保存规则');
    const saved = fetchMock.mock.calls.find(([url, options]) => url === '/api/admin/cards/rules' && options?.method === 'PATCH')!;
    expect(JSON.parse(String(saved[1]?.body)).limitedPool).toMatchObject({ enabled: true, startsAt: now, endsAt: Date.parse('2026-11-26T02:00:00Z') });
  });
});
