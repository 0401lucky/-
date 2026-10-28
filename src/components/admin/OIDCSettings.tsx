'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { AdminError, AdminLoading } from './AdminUI';
import { useAdminFeedback } from './AdminFeedback';
import { adminRequest } from '@/lib/admin/request';
import { OIDC_CALLBACK_PATH, type OIDCConfig } from '@/lib/oidc';
import { formatChinaDateTime } from '@/lib/time';

type Draft = Omit<OIDCConfig, 'newApiProviderId' | 'updatedAt' | 'updatedBy'> & {
  newApiProviderId: string;
  clientSecret: string;
};

function toDraft(config: OIDCConfig, origin: string): Draft {
  return {
    enabled: config.enabled,
    displayName: config.displayName,
    issuerUrl: config.issuerUrl,
    discoveryUrl: config.discoveryUrl,
    clientId: config.clientId,
    redirectUrl: config.redirectUrl || `${origin}${OIDC_CALLBACK_PATH}`,
    scopes: config.scopes,
    tokenAuthMethod: config.tokenAuthMethod,
    newApiProvider: config.newApiProvider,
    newApiProviderId: String(config.newApiProviderId),
    subjectClaim: config.subjectClaim,
    usernameClaim: config.usernameClaim,
    clientSecretConfigured: config.clientSecretConfigured,
    clientSecret: '',
  };
}

export default function OIDCSettings({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { notify } = useAdminFeedback();
  const [config, setConfig] = useState<OIDCConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [origin, setOrigin] = useState('');
  const [newApiReady, setNewApiReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await adminRequest<{ config: OIDCConfig; newApiReady: boolean }>('/api/admin/auth/oidc', { signal });
      if (signal?.aborted) return;
      if (!data.config || typeof data.config.enabled !== 'boolean') throw new Error('OIDC 配置响应不完整');
      const currentOrigin = window.location.origin;
      setOrigin(currentOrigin);
      setConfig(data.config);
      setDraft(toDraft(data.config, currentOrigin));
      setNewApiReady(data.newApiReady);
      setError(null);
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof Error ? error.message : 'OIDC 配置加载失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const dirty = useMemo(() => Boolean(config && draft && JSON.stringify(draft) !== JSON.stringify(toDraft(config, origin))), [config, draft, origin]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || savingRef.current || !dirty) return;
    const providerId = draft.newApiProvider === 'custom' ? Number(draft.newApiProviderId) : 0;
    if (draft.newApiProvider === 'custom' && (!Number.isSafeInteger(providerId) || providerId <= 0)) {
      setError('自定义 OAuth 的提供商 ID 必须为正整数');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const { clientSecret, ...values } = draft;
      const data = await adminRequest<{ config: OIDCConfig }>('/api/admin/auth/oidc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, newApiProviderId: providerId, clientSecretConfigured: undefined, ...(clientSecret ? { clientSecret } : {}) }),
      });
      if (!data.config || typeof data.config.enabled !== 'boolean') throw new Error('保存响应不完整，请重新核对配置');
      setConfig(data.config);
      setDraft(toDraft(data.config, origin));
      notify('OIDC 配置已保存并生效');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'OIDC 配置保存失败');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section id="settings-oidc" className="admin-panel scroll-mt-24 overflow-hidden" aria-labelledby="settings-oidc-title">
      <div className="flex items-center gap-3 border-b border-stone-100 px-5 py-5 sm:px-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-600"><ShieldCheck className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="settings-oidc-title" className="text-sm font-semibold text-stone-900">自定义 OIDC 登录</h2>
          <p className="mt-1 text-xs leading-5 text-stone-400">接入 Casdoor 等身份服务，已在 new-api 绑定的用户可使用原有福利站账号。</p>
        </div>
        {config && <span className={`rounded-full px-2.5 py-1 text-xs ${config.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{config.enabled ? '已启用' : '未启用'}</span>}
      </div>
      {loading ? <AdminLoading label="正在读取 OIDC 配置…" /> : !draft ? (
        <div className="p-5"><AdminError message={error || 'OIDC 配置暂时不可用'} onRetry={() => { setLoading(true); void load(); }} /></div>
      ) : (
        <form id="admin-oidc-form" onSubmit={(event) => void save(event)} className="space-y-5 p-5 sm:p-6">
          {error && <AdminError message={error} />}
          <fieldset disabled={saving} className="space-y-5">
            <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-stone-700">
              <input id="oidc-enabled" type="checkbox" checked={draft.enabled} onChange={(event) => update('enabled', event.target.checked)} className="h-4 w-4 accent-orange-600" />
              启用自定义 OIDC 登录
            </label>
            {!newApiReady && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-800">福利站的 new-api 管理端连接尚未配置，启用前需配置 NEW_API_URL 和管理员系统访问令牌，以确认用户已绑定身份服务。</p>}
            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2 text-xs font-medium text-stone-600">登录按钮名称
                <input id="oidc-display-name" className="admin-input block w-full" value={draft.displayName} maxLength={60} required onChange={(event) => update('displayName', event.target.value)} />
              </label>
              <label className="space-y-2 text-xs font-medium text-stone-600">Issuer 地址
                <input id="oidc-issuer-url" type="url" className="admin-input block w-full" value={draft.issuerUrl} placeholder="https://casdoor.example.com" required={draft.enabled} onChange={(event) => update('issuerUrl', event.target.value)} />
              </label>
              <label className="space-y-2 text-xs font-medium text-stone-600">客户端 ID
                <input id="oidc-client-id" className="admin-input block w-full" value={draft.clientId} autoComplete="off" required={draft.enabled} onChange={(event) => update('clientId', event.target.value)} />
              </label>
              <label className="space-y-2 text-xs font-medium text-stone-600">客户端密钥
                <input id="oidc-client-secret" type="password" className="admin-input block w-full" value={draft.clientSecret} autoComplete="new-password" required={draft.enabled && !draft.clientSecretConfigured} placeholder={draft.clientSecretConfigured ? '已设置，留空保留现有密钥' : '填写 Casdoor 应用的客户端密钥'} onChange={(event) => update('clientSecret', event.target.value)} />
                <span className="block font-normal leading-5 text-stone-400">修改 Issuer、发现文档地址或客户端 ID 时，需重新填写密钥。</span>
              </label>
            </div>
            <label className="block space-y-2 text-xs font-medium text-stone-600">福利站回调地址
              <input id="oidc-redirect-url" type="url" className="admin-input block w-full" value={draft.redirectUrl} required={draft.enabled} onChange={(event) => update('redirectUrl', event.target.value)} />
              <span className="block font-normal leading-5 text-stone-400">将此完整地址添加到 Casdoor 应用的 Redirect URLs；路径固定为 {OIDC_CALLBACK_PATH}。</span>
            </label>
            <details className="rounded-lg border border-stone-200 p-4">
              <summary className="cursor-pointer text-xs font-semibold text-stone-700">高级设置与 new-api 账号匹配</summary>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <label className="space-y-2 text-xs font-medium text-stone-600 md:col-span-2">发现文档地址（可选）
                  <input id="oidc-discovery-url" type="url" className="admin-input block w-full" value={draft.discoveryUrl} placeholder="留空使用 Issuer 下的 /.well-known/openid-configuration" onChange={(event) => update('discoveryUrl', event.target.value)} />
                  <span className="block font-normal leading-5 text-stone-400">Casdoor 应用使用独立证书时，填写 /.well-known/应用名称/openid-configuration。</span>
                </label>
                <label className="space-y-2 text-xs font-medium text-stone-600">授权范围
                  <input id="oidc-scopes" className="admin-input block w-full" value={draft.scopes} onChange={(event) => update('scopes', event.target.value)} required />
                  <span className="block font-normal leading-5 text-stone-400">空格分隔，必须包含 openid。</span>
                </label>
                <label className="space-y-2 text-xs font-medium text-stone-600">客户端认证方式
                  <select id="oidc-token-auth-method" className="admin-input block w-full" value={draft.tokenAuthMethod} onChange={(event) => update('tokenAuthMethod', event.target.value as Draft['tokenAuthMethod'])}>
                    <option value="client_secret_post">client_secret_post</option>
                    <option value="client_secret_basic">client_secret_basic</option>
                  </select>
                </label>
                <label className="space-y-2 text-xs font-medium text-stone-600">new-api 接入方式
                  <select id="oidc-new-api-provider" className="admin-input block w-full" value={draft.newApiProvider} onChange={(event) => {
                    const provider = event.target.value as Draft['newApiProvider'];
                    setDraft((current) => current ? { ...current, newApiProvider: provider, ...(provider === 'oidc' ? { subjectClaim: 'sub' } : {}) } : current);
                    setError(null);
                  }}>
                    <option value="oidc">内置 OIDC</option><option value="custom">自定义 OAuth 提供商</option>
                  </select>
                </label>
                {draft.newApiProvider === 'custom' && <label className="space-y-2 text-xs font-medium text-stone-600">new-api 提供商 ID
                  <input id="oidc-new-api-provider-id" type="number" min="1" step="1" className="admin-input block w-full" value={draft.newApiProviderId} required onChange={(event) => update('newApiProviderId', event.target.value)} />
                  <span className="block font-normal leading-5 text-stone-400">填写 new-api 中 Casdoor 自定义 OAuth 提供商的数字 ID。</span>
                </label>}
                <label className="space-y-2 text-xs font-medium text-stone-600">绑定身份字段
                  <input id="oidc-subject-claim" className="admin-input block w-full" value={draft.subjectClaim} required readOnly={draft.newApiProvider === 'oidc'} onChange={(event) => update('subjectClaim', event.target.value)} />
                  <span className="block font-normal leading-5 text-stone-400">默认 sub，需与 new-api 保存的用户 ID 字段一致；支持点分隔路径。</span>
                </label>
                <label className="space-y-2 text-xs font-medium text-stone-600">用户名字段
                  <input id="oidc-username-claim" className="admin-input block w-full" value={draft.usernameClaim} required onChange={(event) => update('usernameClaim', event.target.value)} />
                  <span className="block font-normal leading-5 text-stone-400">默认 preferred_username；两边用户名不同的用户可在首次登录时补充 new-api 用户名。</span>
                </label>
              </div>
            </details>
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-100 pt-5">
            <p className="text-xs leading-5 text-stone-400">{config?.updatedAt ? `最近保存：${formatChinaDateTime(config.updatedAt)} · ${config.updatedBy || '—'}` : '保存后生效，无需重启服务。'}</p>
            <div className="flex gap-2">
              <button type="button" className="admin-button-secondary" disabled={!dirty || saving} onClick={() => { if (config) setDraft(toDraft(config, origin)); setError(null); }}><RotateCcw className="h-3.5 w-3.5" />还原 OIDC 修改</button>
              <button type="submit" className="admin-button-primary" disabled={!dirty || saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{saving ? '保存 OIDC 中…' : '保存 OIDC 设置'}</button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
