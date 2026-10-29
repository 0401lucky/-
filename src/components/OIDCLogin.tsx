'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Loader2, ShieldCheck, UserRound } from 'lucide-react';
import { OIDC_ERROR_MESSAGES } from '@/lib/oidc';
import { getSafeRedirectPath } from '@/lib/navigation';

export default function OIDCLogin({ redirect, pending, errorCode }: { redirect: string; pending: boolean; errorCode: string | null }) {
  const router = useRouter();
  const [config, setConfig] = useState<{ enabled: boolean; displayName: string } | null>(null);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const submitting = useRef(false);
  const loginUrl = `/api/auth/oidc/login?redirect=${encodeURIComponent(redirect)}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/oidc/config', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!controller.signal.aborted && response.ok && data.success && typeof data.data?.enabled === 'boolean' && typeof data.data?.displayName === 'string') setConfig(data.data);
      })
      .catch(() => { /* Password login remains available if unified login is unavailable. */ });
    return () => controller.abort();
  }, []);

  async function complete(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || expired) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/oidc/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (data.code === 'OIDC_EXPIRED') setExpired(true);
        throw new Error(data.message || '未找到已绑定的账号');
      }
      router.push(getSafeRedirectPath(data.redirect));
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : '网络错误，请稍后重试');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  const message = error || (errorCode ? OIDC_ERROR_MESSAGES[errorCode] || '统一登录失败，请重新尝试。' : null);
  if (!pending && !config?.enabled && !message) return null;

  return (
    <div className="oidc-login" data-testid="oidc-login">
      {message && <div className="login-error" role="alert"><span className="error-dot" /><span>{message}</span></div>}
      {pending ? (
        <>
          <p className="oidc-hint">身份服务验证已完成。若两边用户名不同，请填写已绑定当前身份的 new-api 用户名。</p>
          <form onSubmit={(event) => void complete(event)} className="login-form">
            <label className="field">
              <span className="field-label">new-api 用户名</span>
              <span className="field-control">
                <span className="field-icon"><UserRound size={18} /></span>
                <input id="oidc-account-username" value={username} required autoComplete="username" maxLength={256} disabled={loading || expired} placeholder="已绑定当前身份的用户名" onChange={(event) => setUsername(event.target.value)} />
              </span>
            </label>
            <button type="submit" className="login-btn" disabled={loading || expired || !username.trim()}>{loading ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}<span>{loading ? '核对账号中…' : '验证绑定并登录'}</span></button>
          </form>
          <div className="oidc-links"><a href={loginUrl}>重新验证身份</a><Link href={`/login?redirect=${encodeURIComponent(redirect)}`}>使用密码登录</Link></div>
        </>
      ) : config?.enabled ? (
        <>
          <a href={loginUrl} className="oidc-btn">
            <span className="oidc-btn-icon" aria-hidden="true"><ShieldCheck size={20} strokeWidth={2.2} /></span>
            <span className="oidc-btn-label">通过 {config.displayName} 登录</span>
            <ArrowRight className="oidc-btn-arrow" size={18} aria-hidden="true" />
          </a>
          <div className="oidc-divider"><span>或使用账号密码</span></div>
        </>
      ) : null}
    </div>
  );
}
