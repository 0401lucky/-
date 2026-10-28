'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Clock3,
  Gamepad2,
  History,
  Info,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import {
  AdminDialog,
  AdminError,
  AdminLoading,
  AdminPageHeader,
} from '@/components/admin/AdminUI';
import {
  useAdminFeedback,
  useAdminUnsavedChanges,
} from '@/components/admin/AdminFeedback';
import {
  CONFIG_FIELDS,
  configToDraft,
  validateConfigDraft,
  type ConfigDraft,
  type ConfigKey,
  type SystemConfig,
} from '@/lib/admin/settings';
import { adminRequest } from '@/lib/admin/request';
import { formatChinaDateTime } from '@/lib/time';
import OIDCSettings from '@/components/admin/OIDCSettings';

const groups = [
  {
    id: 'game',
    title: '游戏规则',
    description: '控制每日游戏积分产出。',
    Icon: Gamepad2,
  },
  {
    id: 'wallet',
    title: '钱包与提现',
    description: '配置账户额度限制和普通用户提现次数。',
    Icon: Wallet,
  },
  {
    id: 'vip',
    title: 'VIP 与月卡',
    description: '管理购买价格、有效期和会员专属权益。',
    Icon: Sparkles,
  },
] as const;

export default function AdminSettingsPage() {
  const { notify, confirm } = useAdminFeedback();
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [oidcDirty, setOIDCDirty] = useState(false);

  const loadConfig = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await adminRequest<{ config: SystemConfig }>(
        '/api/admin/config',
        { signal },
      );
      if (signal?.aborted) return;
      if (
        !data.config ||
        CONFIG_FIELDS.some(({ key }) => !Number.isSafeInteger(data.config[key]))
      )
        throw new Error('配置数据不完整，请重新加载');
      setConfig(data.config);
      setDraft(configToDraft(data.config));
      setError(null);
    } catch (error) {
      if (!signal?.aborted)
        setError(error instanceof Error ? error.message : '配置加载失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadConfig(controller.signal);
    return () => controller.abort();
  }, [loadConfig]);

  const changes = useMemo(
    () =>
      config && draft
        ? CONFIG_FIELDS.filter(
            ({ key }) =>
              !draft[key].trim() || Number(draft[key]) !== config[key],
          )
        : [],
    [config, draft],
  );
  const dirty = changes.length > 0;
  useAdminUnsavedChanges(dirty || oidcDirty);
  const validation = useMemo(
    () => (draft ? validateConfigDraft(draft) : null),
    [draft],
  );
  const invalidCount = Object.keys(validation?.errors ?? {}).length;

  const updateField = (key: ConfigKey, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setSaveError(null);
  };

  const discardChanges = async () => {
    if (!config || !dirty || savingRef.current) return;
    if (
      await confirm({
        title: '放弃本次修改？',
        description: `将还原 ${changes.length} 项未保存的配置，恢复到上次从服务器读取的值。`,
        confirmLabel: '放弃修改',
        danger: true,
      })
    ) {
      setDraft(configToDraft(config));
      setSaveError(null);
      notify('已还原为上次保存的配置', 'info');
    }
  };

  const saveConfig = async () => {
    if (!draft || savingRef.current) return;
    const checked = validateConfigDraft(draft);
    if (Object.keys(checked.errors).length > 0) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      // Go API 要求完整提交全部九个字段，禁止仅发送修改项。
      const data = await adminRequest<{ config: SystemConfig }>(
        '/api/admin/config',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(checked.values),
        },
      );
      if (
        !data.config ||
        CONFIG_FIELDS.some(({ key }) => !Number.isSafeInteger(data.config[key]))
      )
        throw new Error('保存响应不完整，请核对配置后重试');
      setConfig(data.config);
      setDraft(configToDraft(data.config));
      setReviewOpen(false);
      notify('系统配置已保存');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (loading) return <AdminLoading label="正在读取系统配置…" />;
  if (!config || !draft)
    return (
      <div className="space-y-6">
        <AdminPageHeader
          eyebrow="系统 / SETTINGS"
          title="系统设置"
          description="管理游戏、钱包和 VIP 的运行规则。"
        />
        <AdminError
          message={error ?? '配置暂时不可用'}
          onRetry={() => {
            setLoading(true);
            setError(null);
            void loadConfig();
          }}
        />
      </div>
    );

  return (
    <div className="space-y-6 pb-32 sm:pb-24">
      <AdminPageHeader
        eyebrow="系统 / SETTINGS"
        title="系统设置"
        description="集中管理运行规则，修改后可先核对差异，再统一保存。"
        actions={
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${dirty || oidcDirty ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}
          >
            {dirty || oidcDirty ? (
              <Clock3 className="h-3.5 w-3.5" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {dirty ? `${changes.length} 项运行规则待保存` : oidcDirty ? 'OIDC 设置待保存' : '全部修改已保存'}
          </span>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        <form
          id="admin-settings-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && !invalidCount && !saving) {
              setSaveError(null);
              setReviewOpen(true);
            }
          }}
          className="min-w-0 space-y-5"
        >
          {groups.map(({ id, title, description, Icon }, groupIndex) => (
            <section
              id={`settings-${id}`}
              key={id}
              className="admin-panel scroll-mt-24 overflow-hidden"
              aria-labelledby={`settings-${id}-title`}
            >
              <div className="flex items-center gap-3 border-b border-stone-100 px-5 py-5 sm:px-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-600">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2
                    id={`settings-${id}-title`}
                    className="text-sm font-semibold text-stone-900"
                  >
                    {title}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-stone-400">
                    {description}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-stone-300">
                  0{groupIndex + 1}
                </span>
              </div>
              <fieldset
                disabled={saving}
                className="divide-y divide-stone-100 px-5 sm:px-6"
              >
                {CONFIG_FIELDS.filter((field) => field.group === id).map(
                  (field) => {
                    const fieldError = validation?.errors[field.key];
                    const changed = changes.some(
                      (item) => item.key === field.key,
                    );
                    return (
                      <div
                        key={field.key}
                        className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_180px] sm:gap-6"
                      >
                        <div>
                          <label
                            htmlFor={field.key}
                            className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-stone-700"
                          >
                            {field.label}
                            {changed && (
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-orange-600"
                                aria-label="已修改"
                              />
                            )}
                          </label>
                          <p
                            id={`${field.key}-hint`}
                            className="max-w-lg text-xs leading-6 text-stone-500"
                          >
                            {field.description}
                          </p>
                        </div>
                        <div>
                          <div className="relative">
                            <input
                              id={field.key}
                              type="number"
                              inputMode="numeric"
                              min={field.min}
                              max={field.max}
                              step={1}
                              required
                              className="admin-input pr-20 text-right tabular-nums"
                              value={draft[field.key]}
                              onChange={(event) =>
                                updateField(field.key, event.target.value)
                              }
                              aria-invalid={Boolean(fieldError)}
                              aria-describedby={`${field.key}-hint${fieldError ? ` ${field.key}-error` : ''}`}
                            />
                            <span className="pointer-events-none absolute right-3 top-2.5 text-xs leading-5 text-stone-400">
                              {field.unit}
                            </span>
                          </div>
                          {fieldError ? (
                            <p
                              id={`${field.key}-error`}
                              role="alert"
                              className="mt-2 text-xs leading-5 text-red-700"
                            >
                              {fieldError}
                            </p>
                          ) : (
                            <p className="mt-2 text-right text-[11px] text-stone-400">
                              范围 {field.min.toLocaleString()}–
                              {field.max.toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
              </fieldset>
            </section>
          ))}
        </form>

        <aside className="space-y-4 xl:sticky xl:top-24">
          <div className="admin-panel p-5">
            <p className="mb-3 text-xs font-semibold text-stone-800">
              快速定位
            </p>
            <nav aria-label="设置分组" className="space-y-1">
              <a href="#settings-oidc" className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-xs text-stone-500 hover:bg-stone-50 hover:text-orange-700"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /><span className="flex-1">自定义 OIDC 登录</span></a>
              {groups.map(({ id, title, Icon }) => (
                <a
                  key={id}
                  href={`#settings-${id}`}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-xs text-stone-500 hover:bg-stone-50 hover:text-orange-700"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="flex-1">{title}</span>
                  <span className="text-stone-300">
                    {CONFIG_FIELDS.filter((field) => field.group === id).length}{' '}
                    项
                  </span>
                </a>
              ))}
            </nav>
          </div>
          <div className="rounded-xl border border-orange-100 bg-orange-50/70 p-5">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-orange-800">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              配置提示
            </div>
            <p className="text-xs leading-6 text-orange-900/70">
              保存后，相关业务将按照新配置执行。请先核对提现限制、月卡价格与权益，避免影响正在参与活动的用户。
            </p>
            <p className="mt-3 border-t border-orange-200/60 pt-3 text-xs leading-6 text-orange-900/70">
              月卡累计时长上限必须不小于单次月卡时长。
            </p>
          </div>
          <div className="admin-panel p-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-stone-700">
              <History
                className="h-3.5 w-3.5 text-stone-400"
                aria-hidden="true"
              />
              最近保存
            </div>
            <p className="text-xs leading-6 text-stone-500">
              {config.updatedAt
                ? formatChinaDateTime(config.updatedAt)
                : '暂无保存记录'}
            </p>
            <p className="mt-1 break-all text-xs text-stone-400">
              操作人：{config.updatedBy || '—'}
            </p>
            <p className="mt-3 text-[11px] text-stone-400">
              时间统一按中国时间显示
            </p>
          </div>
        </aside>
      </div>

      <OIDCSettings onDirtyChange={setOIDCDirty} />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:left-60 xl:px-8">
        <div className="admin-save-bar pointer-events-auto mx-auto flex max-w-[1436px] flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white px-4 py-4 sm:px-5">
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${dirty ? 'bg-orange-500' : 'bg-emerald-500'}`}
            />
            <span aria-live="polite">
              {invalidCount
                ? `有 ${invalidCount} 项配置需要修正`
                : dirty
                  ? `已修改 ${changes.length} 项配置，尚未保存`
                  : oidcDirty ? 'OIDC 设置待保存，请使用 OIDC 区域的保存按钮' : '当前配置已同步'}
              <span className="ml-2 hidden text-stone-400 lg:inline">
                修改将在确认保存后生效
              </span>
            </span>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              type="button"
              className="admin-button-secondary flex-1 sm:flex-none"
              disabled={!dirty || saving}
              onClick={() => void discardChanges()}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              放弃修改
            </button>
            <button
              type="submit"
              form="admin-settings-form"
              className="admin-button-primary flex-1 sm:flex-none"
              disabled={!dirty || invalidCount > 0 || saving}
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              预览并保存
            </button>
          </div>
        </div>
      </div>

      <AdminDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="确认配置变更"
        description={`请核对以下 ${changes.length} 项修改，确认后将统一保存。`}
        busy={saving}
        wide
        footer={
          <>
            <button
              type="button"
              className="admin-button-secondary"
              disabled={saving}
              onClick={() => setReviewOpen(false)}
            >
              返回编辑
            </button>
            <button
              type="button"
              className="admin-button-primary"
              disabled={saving || !dirty || invalidCount > 0}
              onClick={() => void saveConfig()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? '保存中…' : '确认保存'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {saveError && <AdminError message={saveError} />}
          <div className="overflow-hidden rounded-lg border border-stone-200">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-stone-100 bg-stone-50 px-4 py-2.5 text-xs text-stone-500">
              <span>配置项</span>
              <span>修改前 → 修改后</span>
            </div>
            <div className="divide-y divide-stone-100">
              {changes.map((field) => (
                <div
                  key={field.key}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 px-4 py-4 text-xs"
                >
                  <span className="font-medium leading-5 text-stone-700">
                    {field.label}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 tabular-nums">
                    <span className="text-stone-400">
                      {config[field.key].toLocaleString()}
                    </span>
                    <ArrowRight
                      className="h-3 w-3 text-stone-300"
                      aria-hidden="true"
                    />
                    <span className="font-semibold text-orange-800">
                      {Number(draft[field.key]).toLocaleString()}
                    </span>
                    <span className="text-stone-400">{field.unit}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="flex items-start gap-2 text-xs leading-6 text-stone-500">
            <Info className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            确认保存前，修改不会影响当前运行规则。
          </p>
        </div>
      </AdminDialog>
    </div>
  );
}
