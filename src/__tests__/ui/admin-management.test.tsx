import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import AdminPage from '@/app/admin/page';
import AdminSettingsPage from '@/app/admin/settings/page';
import { AdminFeedbackProvider } from '@/components/admin/AdminFeedback';
import type { SystemConfig } from '@/lib/admin/settings';
import type { OIDCConfig } from '@/lib/oidc';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => (
    <a {...props}>{children}</a>
  ),
}));

const config: SystemConfig = {
  dailyPointsLimit: 5000,
  dailyWithdrawLimit: 4,
  vipDailyWithdrawLimit: 8,
  vipPricePoints: 3000,
  vipDurationDays: 30,
  vipWithdrawFeePercent: 50,
  vipDailyLotterySpins: 2,
  vipMaxTotalDays: 365,
  withdrawBalanceCapDollars: 10000,
};
const oidcConfig: OIDCConfig = {
  enabled: true, displayName: 'Casdoor', issuerUrl: 'https://casdoor.example.com',
  discoveryUrl: '', clientId: 'welfare-client', redirectUrl: 'https://welfare.example.com/api/auth/oidc/callback',
  scopes: 'openid profile email', tokenAuthMethod: 'client_secret_post', newApiProvider: 'oidc',
  newApiProviderId: 0, subjectClaim: 'sub', usernameClaim: 'preferred_username', clientSecretConfigured: true,
};
const projects = Array.from({ length: 18 }, (_, index) => ({
  id: `project-${index}`,
  name: `福利 ${index}`,
  description: '积分活动',
  maxClaims: 100,
  claimedCount: index,
  codesCount: 100,
  status: index % 2 === 0 ? 'active' : 'paused',
  createdAt: index + 1,
  createdBy: 'lucky',
  rewardType: 'direct',
  directPoints: 500,
}));

const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal',
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close',
);

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
    },
  });
});
afterAll(() => {
  if (showModalDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      'showModal',
      showModalDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (closeDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      'close',
      closeDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('后台项目与设置流程', () => {
  let container: HTMLDivElement;
  let root: Root;
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    request = vi.fn(async (url: string) => {
      if (url === '/api/admin/config')
        return Response.json({ success: true, config });
      if (url === '/api/admin/auth/oidc')
        return Response.json({ success: true, config: oidcConfig, newApiReady: true });
      if (url === '/api/admin/projects')
        return Response.json({ success: true, projects });
      return Response.json({ success: true });
    });
    vi.stubGlobal('fetch', request);
    push.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(children: ReactNode) {
    await act(async () =>
      root.render(<AdminFeedbackProvider>{children}</AdminFeedbackProvider>),
    );
  }
  function button(label: string, scope: ParentNode = container) {
    const found = [...scope.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label,
    );
    expect(found, `button ${label}`).toBeDefined();
    return found!;
  }
  async function click(label: string, scope: ParentNode = container) {
    await act(async () => button(label, scope).click());
  }
  async function input(selector: string, value: string) {
    const element = container.querySelector<
      HTMLInputElement | HTMLSelectElement
    >(selector)!;
    expect(element).not.toBeNull();
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
        element,
        value,
      );
      element.dispatchEvent(
        new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {
          bubbles: true,
        }),
      );
    });
  }
  function dialog() {
    return container.querySelector<HTMLDialogElement>('dialog[open]')!;
  }

  it('加载失败不会误报空列表，重试后支持分页和组合筛选', async () => {
    request.mockResolvedValueOnce(
      Response.json(
        { success: false, message: '数据库暂不可用' },
        { status: 503 },
      ),
    );
    await render(<AdminPage />);
    expect(container.textContent).toContain('数据库暂不可用');
    expect(container.textContent).not.toContain('还没有福利项目');
    await click('重试');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(15);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="下一页"]')!
        .click(),
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    await input('[aria-label="项目状态"]', 'active');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(9);
    expect(container.textContent).toContain('1 / 1 页');
    await input('[aria-label="搜索项目"]', '福利 16');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    await input('[aria-label="奖励类型"]', 'code');
    expect(container.textContent).toContain('没有匹配的项目');
    await click('清除筛选');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(15);
  });

  it('项目删除需要确认，服务端失败后保留原记录并展示错误', async () => {
    await render(<AdminPage />);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'tbody [aria-label="删除「福利 17」"]',
        )!
        .click(),
    );
    expect(dialog().textContent).toContain('删除后项目无法恢复');
    await click('取消', dialog());
    expect(
      request.mock.calls.some(([, options]) => options?.method === 'DELETE'),
    ).toBe(false);
    request.mockResolvedValueOnce(
      Response.json({ success: false, message: '删除被拒绝' }, { status: 400 }),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'tbody [aria-label="删除「福利 17」"]',
        )!
        .click(),
    );
    await click('删除项目', dialog());
    expect(container.querySelector('tbody')!.textContent).toContain('福利 17');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      '删除被拒绝',
    );
  });

  it('创建项目提交积分与中国时间，失败保留表单，成功回到第一页', async () => {
    await render(<AdminPage />);
    await click('新建项目');
    await input('#project-name', '  新人福利  ');
    await input('#project-claims', '25');
    await input('#project-points', '200');
    await input('#project-pause', '2099-01-02T12:30');
    request.mockResolvedValueOnce(
      Response.json(
        { success: false, message: '创建暂不可用' },
        { status: 503 },
      ),
    );
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    expect(dialog().textContent).toContain('创建暂不可用');
    expect(
      container.querySelector<HTMLInputElement>('#project-name')!.value,
    ).toBe('  新人福利  ');
    request.mockResolvedValueOnce(
      Response.json({
        success: true,
        project: {
          ...projects[0],
          id: 'created',
          name: '新人福利',
          createdAt: Date.now(),
        },
      }),
    );
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    const submitted = request.mock.calls.at(-1)![1].body as FormData;
    expect(Object.fromEntries(submitted)).toMatchObject({
      name: '新人福利',
      maxClaims: '25',
      directPoints: '200',
      rewardType: 'direct',
      autoPauseAt: '2099-01-02T12:30',
    });
    expect(dialog()).toBeNull();
    expect(container.querySelector('tbody')!.textContent).toContain('新人福利');
  });

  it('配置前端校验空值、整数与月卡时长约束，合法的零费率可保存', async () => {
    await render(<AdminSettingsPage />);
    expect(button('预览并保存')).toBeDisabled();
    await input('#vipDurationDays', '60');
    await input('#vipMaxTotalDays', '30');
    expect(container.textContent).toContain('累计时长上限不能小于月卡时长');
    expect(button('预览并保存')).toBeDisabled();
    await input('#vipMaxTotalDays', '365');
    await input('#vipWithdrawFeePercent', '');
    expect(button('预览并保存')).toBeDisabled();
    await input('#vipWithdrawFeePercent', '1.5');
    expect(button('预览并保存')).toBeDisabled();
    await input('#vipWithdrawFeePercent', '0');
    expect(button('预览并保存')).toBeEnabled();
    expect(request.mock.calls.filter(([url]) => url === '/api/admin/config')).toHaveLength(1);
  });

  it('OIDC 保存失败保留草稿，成功后清空密钥输入并解除未保存提醒', async () => {
    await render(<AdminSettingsPage />);
    expect(container.querySelector<HTMLInputElement>('#oidc-client-secret')!.value).toBe('');
    expect(container.querySelector<HTMLInputElement>('#oidc-subject-claim')!.readOnly).toBe(true);
    await input('#oidc-display-name', '企业统一登录');
    await input('#oidc-client-secret', 'replacement-secret');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    request.mockResolvedValueOnce(Response.json({ success: false, message: '发现文档校验失败' }, { status: 400 }));
    await click('保存 OIDC 设置');
    expect(container.textContent).toContain('发现文档校验失败');
    expect(container.querySelector<HTMLInputElement>('#oidc-display-name')!.value).toBe('企业统一登录');
    expect(container.querySelector<HTMLInputElement>('#oidc-client-secret')!.value).toBe('replacement-secret');
    request.mockResolvedValueOnce(Response.json({ success: true, config: { ...oidcConfig, displayName: '企业统一登录' } }));
    await click('保存 OIDC 设置');
    const saves = request.mock.calls.filter(([url, options]) => url === '/api/admin/auth/oidc' && options?.method === 'PUT');
    expect(saves).toHaveLength(2);
    const payload = JSON.parse(saves[1][1].body);
    expect(payload).toMatchObject({ displayName: '企业统一登录', clientSecret: 'replacement-secret', newApiProviderId: 0 });
    expect(payload).not.toHaveProperty('clientSecretConfigured');
    expect(container.querySelector<HTMLInputElement>('#oidc-client-secret')!.value).toBe('');
    expect(button('保存 OIDC 设置')).toBeDisabled();
    expect(container.textContent).toContain('OIDC 配置已保存并生效');
    const savedUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(savedUnload);
    expect(savedUnload.defaultPrevented).toBe(false);
  });

  it('OIDC 自定义提供商提交数字 ID，空密钥保留现有凭据且提交中不能重复保存', async () => {
    await render(<AdminSettingsPage />);
    await input('#oidc-new-api-provider', 'custom');
    await input('#oidc-new-api-provider-id', '4');
    await input('#oidc-subject-claim', 'id');
    let complete!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const form = container.querySelector<HTMLFormElement>('#admin-oidc-form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const saves = request.mock.calls.filter(([url, options]) => url === '/api/admin/auth/oidc' && options?.method === 'PUT');
    expect(saves).toHaveLength(1);
    const payload = JSON.parse(saves[0][1].body);
    expect(payload).toMatchObject({ newApiProvider: 'custom', newApiProviderId: 4, subjectClaim: 'id' });
    expect(payload).not.toHaveProperty('clientSecret');
    await act(async () => complete(Response.json({ success: true, config: { ...oidcConfig, newApiProvider: 'custom', newApiProviderId: 4, subjectClaim: 'id' } })));
    expect(button('保存 OIDC 设置')).toBeDisabled();
  });

  it('预览配置差异，完整提交九个字段，保存失败不丢修改，提交中不能重复保存', async () => {
    await render(<AdminSettingsPage />);
    await input('#vipPricePoints', '4000');
    await click('预览并保存');
    expect(dialog().textContent).toContain('3,000');
    expect(dialog().textContent).toContain('4,000');
    request.mockResolvedValueOnce(
      Response.json(
        { success: false, message: '保存暂不可用' },
        { status: 503 },
      ),
    );
    await click('确认保存', dialog());
    expect(dialog().textContent).toContain('保存暂不可用');
    expect(
      container.querySelector<HTMLInputElement>('#vipPricePoints')!.value,
    ).toBe('4000');
    let complete!: (response: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    await click('确认保存', dialog());
    expect(button('保存中…', dialog())).toBeDisabled();
    await click('保存中…', dialog());
    const putRequests = request.mock.calls.filter(
      ([, options]) => options?.method === 'PUT',
    );
    expect(putRequests).toHaveLength(2);
    expect(JSON.parse(putRequests[1][1].body)).toEqual({
      ...config,
      vipPricePoints: 4000,
    });
    await act(async () =>
      complete(
        Response.json({
          success: true,
          config: { ...config, vipPricePoints: 4000 },
        }),
      ),
    );
    expect(dialog()).toBeNull();
    expect(button('预览并保存')).toBeDisabled();
    expect(container.textContent).toContain('系统配置已保存');
  });

  it('未保存时拦截页面链接和关闭页面，取消后保留修改，确认后才导航', async () => {
    await render(
      <>
        <a href="/admin">返回项目</a>
        <AdminSettingsPage />
      </>,
    );
    await input('#dailyWithdrawLimit', '5');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () =>
      container.querySelector<HTMLAnchorElement>('a[href="/admin"]')!.click(),
    );
    expect(push).not.toHaveBeenCalled();
    await click('取消', dialog());
    expect(
      container.querySelector<HTMLInputElement>('#dailyWithdrawLimit')!.value,
    ).toBe('5');
    await act(async () =>
      container.querySelector<HTMLAnchorElement>('a[href="/admin"]')!.click(),
    );
    await click('放弃修改并离开', dialog());
    expect(push).toHaveBeenCalledWith('/admin');
  });

  it('放弃配置需要确认，确认后恢复服务器原值并解除未保存提醒', async () => {
    await render(<AdminSettingsPage />);
    await input('#dailyPointsLimit', '6000');
    await click('放弃修改');
    await click('取消', dialog());
    expect(
      container.querySelector<HTMLInputElement>('#dailyPointsLimit')!.value,
    ).toBe('6000');
    await click('放弃修改');
    await click('放弃修改', dialog());
    expect(
      container.querySelector<HTMLInputElement>('#dailyPointsLimit')!.value,
    ).toBe('5000');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });
});
