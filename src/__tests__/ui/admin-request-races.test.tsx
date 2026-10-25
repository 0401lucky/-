import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminFeedbackPage from '@/app/admin/feedback/page';
import AdminRewardsPage from '@/app/admin/rewards/page';

const { router, confirm } = vi.hoisted(() => ({
  router: { push: vi.fn() },
  confirm: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/components/admin/AdminFeedback', () => ({
  useAdminFeedback: () => ({ confirm }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

const feedbackItems = ['A', 'B'].map((id, index) => ({
  id,
  userId: index + 1,
  username: `user-${id}`,
  status: id === 'A' ? 'processing' : 'open',
  createdAt: 1,
  updatedAt: 1,
}));

function feedbackResponse(id: string) {
  return Response.json({
    success: true,
    feedback: feedbackItems.find((item) => item.id === id),
    messages: [],
  });
}

describe('后台请求与分页回归', () => {
  let container: HTMLDivElement;
  let root: Root;
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    request = vi.fn();
    vi.stubGlobal('fetch', request);
    confirm.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(children: ReactNode) {
    await act(async () => root.render(children));
  }

  function button(label: string) {
    const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
    expect(found, `button ${label}`).toBeDefined();
    return found!;
  }

  async function selectFeedback(id: string) {
    const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(`user-${id}（UID:`));
    expect(found).toBeDefined();
    await act(async () => found!.click());
  }

  function detail() {
    return container.querySelector('section:last-child')!;
  }

  async function fill(selector: string, value: string) {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    expect(element).not.toBeNull();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function mockFeedbackRequests(loadDetail: (id: string, init?: RequestInit) => Promise<Response>) {
    request.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/admin/feedback?')) {
        return Promise.resolve(Response.json({ success: true, items: feedbackItems, pagination: { page: 1, hasMore: false } }));
      }
      return loadDetail(url.split('/').at(-1)!, init);
    });
  }

  it('奖励记录可以连续前后翻页，每次只请求目标页', async () => {
    const requestedPages: number[] = [];
    request.mockImplementation(async (url: string) => {
      const page = Number(new URL(url, 'http://local.test').searchParams.get('page'));
      requestedPages.push(page);
      return Response.json({ success: true, data: { items: [], total: 30, totalPages: 3 } });
    });
    await render(<AdminRewardsPage />);
    expect(container.textContent).toContain('第 1 / 3 页');
    await act(async () => button('下一页').click());
    expect(container.textContent).toContain('第 2 / 3 页');
    await act(async () => button('下一页').click());
    expect(container.textContent).toContain('第 3 / 3 页');
    expect(button('下一页')).toBeDisabled();
    await act(async () => button('上一页').click());
    expect(container.textContent).toContain('第 2 / 3 页');
    await act(async () => button('上一页').click());
    expect(button('上一页')).toBeDisabled();
    expect(requestedPages).toEqual([1, 2, 3, 2, 1]);
  });

  it('反馈 A 晚于 B 返回时，保持 B 的详情与状态', async () => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    mockFeedbackRequests((id) => id === 'A' ? pendingA.promise : pendingB.promise);
    await render(<AdminFeedbackPage />);
    await selectFeedback('B');
    await act(async () => pendingB.resolve(feedbackResponse('B')));
    await act(async () => pendingA.resolve(feedbackResponse('A')));
    expect(detail().textContent).toContain('反馈详情 #B');
    expect(detail().textContent).not.toContain('user-A');
    expect(detail().querySelector('select')).toHaveValue('open');
  });

  it('切换到 B 的加载期间清除 A 的旧详情，不能对旧内容进行回复或状态操作', async () => {
    const pendingB = deferred<Response>();
    mockFeedbackRequests((id) => id === 'A' ? Promise.resolve(feedbackResponse('A')) : pendingB.promise);
    await render(<AdminFeedbackPage />);
    expect(detail().textContent).toContain('反馈详情 #A');
    await selectFeedback('B');
    expect(detail().textContent).not.toContain('反馈详情 #A');
    expect(detail().querySelector('form')).toBeNull();
    expect(detail().querySelector('button')).toBeNull();
    await act(async () => pendingB.resolve(feedbackResponse('B')));
    expect(detail().textContent).toContain('反馈详情 #B');
  });

  it.each(['http', 'network'])('过期反馈请求失败（%s）不会清空新反馈的详情或显示旧错误', async (failure) => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    mockFeedbackRequests((id) => id === 'A' ? pendingA.promise : pendingB.promise);
    await render(<AdminFeedbackPage />);
    await selectFeedback('B');
    await act(async () => pendingB.resolve(feedbackResponse('B')));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      if (failure === 'http') pendingA.resolve(Response.json({ success: false, message: 'A 的旧请求失败' }, { status: 503 }));
      else pendingA.reject(new Error('A 的旧请求失败'));
    });
    expect(detail().textContent).toContain('反馈详情 #B');
    expect(container.textContent).not.toContain('A 的旧请求失败');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('旧请求完成不会提前解除新反馈的加载状态', async () => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    mockFeedbackRequests((id) => id === 'A' ? pendingA.promise : pendingB.promise);
    await render(<AdminFeedbackPage />);
    await selectFeedback('B');
    await act(async () => pendingA.resolve(feedbackResponse('A')));
    expect(detail().textContent).not.toContain('反馈详情 #A');
    expect(detail().textContent).not.toContain('反馈详情加载失败');
    expect(detail().querySelector('svg.animate-spin')).not.toBeNull();
    await act(async () => pendingB.resolve(feedbackResponse('B')));
    expect(detail().textContent).toContain('反馈详情 #B');
  });

  it('A → B → A 时取消前两次请求，第一次 A 的响应也不能覆盖新的 A', async () => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    const latestA = deferred<Response>();
    let aRequests = 0;
    mockFeedbackRequests((id) => id === 'B' ? pendingB.promise : ++aRequests === 1 ? pendingA.promise : latestA.promise);
    await render(<AdminFeedbackPage />);
    const firstSignal = request.mock.calls.find(([url]) => url === '/api/admin/feedback/A')![1].signal as AbortSignal;
    await selectFeedback('B');
    const secondSignal = request.mock.calls.find(([url]) => url === '/api/admin/feedback/B')![1].signal as AbortSignal;
    await selectFeedback('A');
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(true);
    await act(async () => latestA.resolve(Response.json({ success: true, feedback: { ...feedbackItems[0], status: 'resolved' }, messages: [] })));
    await act(async () => pendingA.resolve(feedbackResponse('A')));
    await act(async () => pendingB.resolve(feedbackResponse('B')));
    expect(detail().textContent).toContain('反馈详情 #A');
    expect(detail().querySelector('select')).toHaveValue('resolved');
  });

  it('旧工单的状态更新完成后，不刷新旧详情或中断当前工单加载', async () => {
    const pendingUpdate = deferred<Response>();
    const pendingB = deferred<Response>();
    mockFeedbackRequests((id, init) => init?.method === 'PATCH' ? pendingUpdate.promise : id === 'A' ? Promise.resolve(feedbackResponse('A')) : pendingB.promise);
    await render(<AdminFeedbackPage />);
    await act(async () => button('更新状态').click());
    await selectFeedback('B');
    const signalB = request.mock.calls.find(([url]) => url === '/api/admin/feedback/B')![1].signal as AbortSignal;
    await act(async () => pendingUpdate.resolve(Response.json({ success: true })));
    expect(signalB.aborted).toBe(false);
    expect(detail().querySelector('svg.animate-spin')).not.toBeNull();
    expect(request.mock.calls.filter(([url, init]) => url === '/api/admin/feedback/A' && !init?.method)).toHaveLength(1);
    await act(async () => pendingB.resolve(feedbackResponse('B')));
    expect(detail().textContent).toContain('反馈详情 #B');
    expect(container.textContent).not.toContain('状态更新成功');
  });

  it('旧工单的回复完成后，不清空新工单的草稿，也不重新显示旧详情', async () => {
    const pendingReply = deferred<Response>();
    mockFeedbackRequests((id, init) => init?.method === 'POST' ? pendingReply.promise : Promise.resolve(feedbackResponse(id)));
    await render(<AdminFeedbackPage />);
    await fill('textarea', '回复 A');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await selectFeedback('B');
    await fill('textarea', 'B 的新草稿');
    await act(async () => pendingReply.resolve(Response.json({ success: true })));
    expect(detail().textContent).toContain('反馈详情 #B');
    expect(detail().querySelector('textarea')).toHaveValue('B 的新草稿');
    expect(request.mock.calls.filter(([url]) => url === '/api/admin/feedback/A')).toHaveLength(1);
    expect(container.textContent).not.toContain('回复已发送');
  });

  it('奖励发放完成后仍能主动刷新第一页，后续翻页不会触发初始化请求', async () => {
    const requestedPages: number[] = [];
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ success: true, data: { distributedCount: 2 } });
      requestedPages.push(Number(new URL(url, 'http://local.test').searchParams.get('page')));
      return Response.json({ success: true, data: { items: [], total: 20, totalPages: 2 } });
    });
    await render(<AdminRewardsPage />);
    await act(async () => button('下一页').click());
    await fill('input[placeholder="输入积分数量"]', '100');
    await fill('input[placeholder="如: 新年积分奖励"]', '奖励测试');
    await fill('textarea', '感谢参与');
    await act(async () => button('确认发放').click());
    const confirmationButton = [...container.querySelectorAll('button')].filter((item) => item.textContent?.trim() === '确认发放').at(-1)!;
    await act(async () => confirmationButton.click());
    expect(container.textContent).toContain('发放完成！已向 2 位用户发送奖励通知。');
    expect(container.textContent).toContain('第 1 / 2 页');
    await act(async () => button('下一页').click());
    expect(container.textContent).toContain('第 2 / 2 页');
    expect(requestedPages).toEqual([1, 2, 1, 2]);
  });
});
