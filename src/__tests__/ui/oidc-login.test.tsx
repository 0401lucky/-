import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OIDCLogin from '@/components/OIDCLogin';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a> }));

describe('OIDC 登录入口与账号确认', () => {
  let root: Root;
  let container: HTMLDivElement;
  let request: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    push.mockReset();
    refresh.mockReset();
    request = vi.fn(async () => Response.json({ success: true, data: { enabled: true, displayName: 'Casdoor' } }));
    vi.stubGlobal('fetch', request);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(pending = false, errorCode: string | null = null) {
    await act(async () => root.render(<OIDCLogin redirect="/points?tab=history" pending={pending} errorCode={errorCode} />));
  }
  async function input(value: string) {
    const element = container.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function submit() {
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }

  it('启用后显示服务名称并保留登录后的站内目标', async () => {
    await render();
    const link = container.querySelector<HTMLAnchorElement>('a')!;
    expect(link.textContent).toContain('通过 Casdoor 登录');
    expect(link.getAttribute('href')).toBe('/api/auth/oidc/login?redirect=%2Fpoints%3Ftab%3Dhistory');
    expect(request.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('停用时隐藏入口，验证失败仍显示明确提示', async () => {
    request.mockResolvedValueOnce(Response.json({ success: true, data: { enabled: false, displayName: 'Casdoor' } }));
    await render();
    expect(container.querySelector('[data-testid="oidc-login"]')).toBeNull();
    await render(false, 'verification_failed');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('身份验证失败');
  });

  it('绑定错误保留用户名，成功后只跳转到安全的站内页面', async () => {
    await render(true);
    await input('newapi-user');
    request.mockResolvedValueOnce(Response.json({ success: false, message: '未找到已绑定的账号' }, { status: 401 }));
    await submit();
    expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('newapi-user');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('未找到已绑定的账号');
    request.mockResolvedValueOnce(Response.json({ success: true, redirect: '//evil.example.com' }));
    await submit();
    expect(JSON.parse(request.mock.calls.at(-1)![1].body)).toEqual({ username: 'newapi-user' });
    expect(push).toHaveBeenCalledWith('/');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('已过期的验证禁止再次提交，并提供重新验证入口', async () => {
    await render(true);
    await input('newapi-user');
    request.mockResolvedValueOnce(Response.json({ success: false, code: 'OIDC_EXPIRED', message: '身份验证已过期' }, { status: 401 }));
    await submit();
    expect(container.querySelector('button')).toBeDisabled();
    expect(container.querySelector('input')).toBeDisabled();
    expect([...container.querySelectorAll('a')].some((link) => link.textContent === '重新验证身份')).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it('连续提交只发送一次账号确认', async () => {
    await render(true);
    await input('newapi-user');
    let complete!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; }));
    await act(async () => {
      const form = container.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(request.mock.calls.filter(([url]) => url === '/api/auth/oidc/complete')).toHaveLength(1);
    await act(async () => complete(Response.json({ success: true, redirect: '/points' })));
    expect(push).toHaveBeenCalledWith('/points');
  });
});
