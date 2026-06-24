'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  Recycle,
  RefreshCw,
  Save,
  Trophy,
  Users,
} from 'lucide-react';

type EcoPrizeKey = 'diamond' | 'coin' | 'necklace' | 'trophy' | 'photo';
type PrizeLotSource = 'claim' | 'stolen' | 'restored';

interface EcoAdminPrizeLot {
  id: string;
  acquiredAt: number;
  source: PrizeLotSource;
  stolenFromUserId: number | null;
  stolenAt: number | null;
}

interface EcoAdminPrizeHolder {
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  lifetimeCount: number;
  currentCount: number;
  stolenCount: number;
  lots: EcoAdminPrizeLot[];
}

interface EcoAdminPrize {
  key: EcoPrizeKey;
  name: string;
  emoji: string;
  imageSrc: string;
  defaultRate: number;
  currentRate: number;
  globalLimit: number;
  totalLifetimeClaims: number;
  totalCurrentInventory: number;
  holderCount: number;
  holders: EcoAdminPrizeHolder[];
}

interface EcoAdminTheft {
  id: string;
  key: EcoPrizeKey;
  prizeName: string;
  prizeEmoji: string;
  originalUserId: number;
  originalUsername: string;
  originalDisplayName: string | null;
  thiefUserId: number;
  thiefUsername: string;
  thiefDisplayName: string | null;
  message: string;
  stolenAt: number;
  resolvedAt: number | null;
  outcome: 'caught' | 'escaped' | null;
}

interface EcoAdminManualTrashRow {
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  total: number;
  days: Record<string, number>;
}

interface EcoAdminData {
  generatedAt: number;
  prizes: EcoAdminPrize[];
  thefts: EcoAdminTheft[];
  manualTrash: {
    days: string[];
    rows: EcoAdminManualTrashRow[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
    };
  };
}

interface ApiResponse {
  success: boolean;
  data?: EcoAdminData;
  message?: string;
}

function formatRatePercent(rate: number): string {
  const percent = rate * 100;
  const fixed = percent >= 1 ? percent.toFixed(4) : percent.toFixed(6);
  return fixed.replace(/\.?0+$/, '');
}

function parsePercentInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getDisplayName(user: { username: string; displayName: string | null; userId: number }): string {
  return user.displayName || user.username || `#${user.userId}`;
}

function getLotSourceLabel(source: PrizeLotSource): string {
  if (source === 'stolen') return '偷取';
  if (source === 'restored') return '追回';
  return '拾取';
}

function getTheftOutcomeLabel(outcome: EcoAdminTheft['outcome'], resolvedAt: number | null): string {
  if (!resolvedAt) return '追查中';
  if (outcome === 'caught') return '已抓获';
  if (outcome === 'escaped') return '已逃脱';
  return '已结束';
}

export default function AdminEcoPage() {
  const [data, setData] = useState<EcoAdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingRates, setSavingRates] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [trashPage, setTrashPage] = useState(1);
  const [activePrizeKey, setActivePrizeKey] = useState<EcoPrizeKey | null>(null);
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/eco?trashPage=${trashPage}`, { cache: 'no-store' });
      const payload = (await res.json()) as ApiResponse;
      if (!res.ok || !payload.success || !payload.data) {
        setMessage({ type: 'error', text: payload.message || '获取环保管理数据失败' });
        return;
      }

      setData(payload.data);
      setDraftRates(Object.fromEntries(
        payload.data.prizes.map((prize) => [prize.key, formatRatePercent(prize.currentRate)]),
      ));
      setActivePrizeKey((current) => (
        current && payload.data?.prizes.some((prize) => prize.key === current)
          ? current
          : payload.data?.prizes[0]?.key ?? null
      ));
    } catch (error) {
      console.error('Fetch eco admin data error:', error);
      setMessage({ type: 'error', text: '网络请求失败' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [trashPage]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const selectedPrize = useMemo(() => {
    if (!data) return null;
    return data.prizes.find((prize) => prize.key === activePrizeKey) ?? data.prizes[0] ?? null;
  }, [activePrizeKey, data]);

  const rateDraftState = useMemo(() => {
    if (!data) return { total: 0, invalid: true };
    let invalid = false;
    const total = data.prizes.reduce((sum, prize) => {
      const value = parsePercentInput(draftRates[prize.key] ?? '');
      if (!Number.isFinite(value) || value < 0 || value > 100) invalid = true;
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    if (total > 100) invalid = true;
    return { total, invalid };
  }, [data, draftRates]);

  const saveRates = async () => {
    if (!data || rateDraftState.invalid) return;
    setSavingRates(true);
    setMessage(null);
    try {
      const prizeRates = Object.fromEntries(
        data.prizes.map((prize) => [
          prize.key,
          parsePercentInput(draftRates[prize.key] ?? '0') / 100,
        ]),
      );
      const res = await fetch('/api/admin/eco', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prizeRates }),
      });
      const payload = (await res.json()) as { success: boolean; message?: string };
      if (!res.ok || !payload.success) {
        setMessage({ type: 'error', text: payload.message || '保存失败' });
        return;
      }
      setMessage({ type: 'success', text: '环保奖品概率已保存' });
      await fetchData();
    } catch (error) {
      console.error('Save eco prize rates error:', error);
      setMessage({ type: 'error', text: '保存失败' });
    } finally {
      setSavingRates(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center text-emerald-600">
          <Loader2 className="w-10 h-10 animate-spin mx-auto" />
          <p className="mt-4 text-sm font-medium text-stone-500">加载环保管理...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
          环保管理数据加载失败
        </div>
      </div>
    );
  }

  const pagination = data.manualTrash.pagination;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <Recycle className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-stone-800">环保管理</h1>
              <p className="text-sm text-stone-500 mt-1">最近更新：{formatDateTime(data.generatedAt)}</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => void fetchData()}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-bold text-stone-600 shadow-sm hover:bg-stone-50 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {message && (
        <div className={`rounded-2xl border px-5 py-3 text-sm font-semibold ${
          message.type === 'success'
            ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
            : 'border-red-100 bg-red-50 text-red-700'
        }`}
        >
          {message.text}
        </div>
      )}

      <section className="rounded-2xl border border-stone-200/70 bg-white shadow-sm overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-stone-100 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-bold text-stone-800 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              奖品概率
            </h2>
            <p className="text-xs text-stone-500 mt-1">当前合计 {rateDraftState.total.toFixed(6).replace(/\.?0+$/, '')}%</p>
          </div>
          <button
            onClick={() => void saveRates()}
            disabled={savingRates || rateDraftState.invalid}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingRates ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            保存概率
          </button>
        </div>

        <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-2 xl:grid-cols-5">
          {data.prizes.map((prize) => (
            <div key={prize.key} className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
              <div className="flex items-center gap-3">
                <Image
                  src={prize.imageSrc}
                  alt={prize.name}
                  width={44}
                  height={44}
                  className="w-11 h-11 rounded-xl object-contain bg-white border border-stone-100"
                />
                <div className="min-w-0">
                  <h3 className="font-bold text-stone-800 truncate">{prize.name}</h3>
                  <p className="text-xs text-stone-500">全服上限 {prize.globalLimit}</p>
                </div>
              </div>
              <label className="block mt-4 text-xs font-bold text-stone-500">
                出现概率 %
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.000001"
                  value={draftRates[prize.key] ?? ''}
                  onChange={(event) => setDraftRates((current) => ({
                    ...current,
                    [prize.key]: event.target.value,
                  }))}
                  className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
              <p className="mt-2 text-xs text-stone-400">默认 {formatRatePercent(prize.defaultRate)}%</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200/70 bg-white shadow-sm overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-stone-100">
          <h2 className="text-base font-bold text-stone-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-500" />
            奖品获得分类
          </h2>
        </div>
        <div className="p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap gap-2">
            {data.prizes.map((prize) => {
              const active = selectedPrize?.key === prize.key;
              return (
                <button
                  key={prize.key}
                  onClick={() => setActivePrizeKey(prize.key)}
                  className={`rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${
                    active
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {prize.name}
                  <span className="ml-2 text-xs opacity-70">{prize.holderCount} 人</span>
                </button>
              );
            })}
          </div>

          {selectedPrize && (
            <div className="overflow-hidden rounded-2xl border border-stone-200">
              <div className="grid gap-3 border-b border-stone-100 bg-stone-50 px-5 py-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-stone-500">累计获得</p>
                  <p className="mt-1 text-xl font-bold text-stone-800">{selectedPrize.totalLifetimeClaims}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">当前持有</p>
                  <p className="mt-1 text-xl font-bold text-stone-800">{selectedPrize.totalCurrentInventory}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">获得玩家</p>
                  <p className="mt-1 text-xl font-bold text-stone-800">{selectedPrize.holderCount}</p>
                </div>
              </div>

              {selectedPrize.holders.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-stone-400">暂无玩家获得该奖品</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left">
                    <thead className="bg-white text-xs font-bold uppercase text-stone-400">
                      <tr>
                        <th className="px-5 py-3">玩家</th>
                        <th className="px-5 py-3">累计</th>
                        <th className="px-5 py-3">当前</th>
                        <th className="px-5 py-3">偷取获得</th>
                        <th className="px-5 py-3">最近明细</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {selectedPrize.holders.map((holder) => (
                        <tr key={holder.userId} className="hover:bg-stone-50/70">
                          <td className="px-5 py-4">
                            <div className="font-bold text-stone-800">{getDisplayName(holder)}</div>
                            <div className="text-xs text-stone-400">ID: {holder.userId} · {holder.username}</div>
                          </td>
                          <td className="px-5 py-4 text-sm font-bold text-stone-700">{holder.lifetimeCount}</td>
                          <td className="px-5 py-4 text-sm font-bold text-stone-700">{holder.currentCount}</td>
                          <td className="px-5 py-4 text-sm font-bold text-stone-700">{holder.stolenCount}</td>
                          <td className="px-5 py-4">
                            {holder.lots.length === 0 ? (
                              <span className="text-sm text-stone-400">旧库存无明细</span>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {holder.lots.slice(0, 4).map((lot) => (
                                  <span key={lot.id} className="rounded-lg bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600">
                                    {getLotSourceLabel(lot.source)} · {formatDateTime(lot.acquiredAt)}
                                  </span>
                                ))}
                                {holder.lots.length > 4 && (
                                  <span className="rounded-lg bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-500">
                                    +{holder.lots.length - 4}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200/70 bg-white shadow-sm overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-stone-100">
          <h2 className="text-base font-bold text-stone-800 flex items-center gap-2">
            <History className="w-5 h-5 text-rose-500" />
            偷取记录
          </h2>
        </div>
        {data.thefts.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-stone-400">暂无偷取记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-stone-50 text-xs font-bold uppercase text-stone-400">
                <tr>
                  <th className="px-5 py-3">时间</th>
                  <th className="px-5 py-3">奖品</th>
                  <th className="px-5 py-3">原主人</th>
                  <th className="px-5 py-3">偷取者</th>
                  <th className="px-5 py-3">状态</th>
                  <th className="px-5 py-3">留言</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.thefts.map((record) => (
                  <tr key={record.id} className="hover:bg-stone-50/70">
                    <td className="px-5 py-4 text-sm font-semibold text-stone-600">{formatDateTime(record.stolenAt)}</td>
                    <td className="px-5 py-4 text-sm font-bold text-stone-800">{record.prizeEmoji} {record.prizeName}</td>
                    <td className="px-5 py-4">
                      <div className="font-bold text-stone-800">{record.originalDisplayName || record.originalUsername}</div>
                      <div className="text-xs text-stone-400">ID: {record.originalUserId}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-bold text-stone-800">{record.thiefDisplayName || record.thiefUsername}</div>
                      <div className="text-xs text-stone-400">ID: {record.thiefUserId}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-600">
                        {getTheftOutcomeLabel(record.outcome, record.resolvedAt)}
                      </span>
                    </td>
                    <td className="px-5 py-4 max-w-[280px] truncate text-sm text-stone-500" title={record.message || '-'}>
                      {record.message || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-stone-200/70 bg-white shadow-sm overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-stone-100 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-bold text-stone-800 flex items-center gap-2">
              <Recycle className="w-5 h-5 text-emerald-500" />
              7 天手捡垃圾
            </h2>
            <p className="text-xs text-stone-500 mt-1">共 {pagination.total} 名玩家 · 每页 {pagination.limit} 名</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTrashPage((current) => Math.max(1, current - 1))}
              disabled={pagination.page <= 1 || refreshing}
              className="inline-flex items-center gap-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
              上一页
            </button>
            <span className="px-2 text-sm font-bold text-stone-500">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => setTrashPage((current) => Math.min(pagination.totalPages, current + 1))}
              disabled={!pagination.hasMore || refreshing}
              className="inline-flex items-center gap-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
            >
              下一页
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-stone-50 text-xs font-bold uppercase text-stone-400">
              <tr>
                <th className="px-5 py-3">玩家</th>
                {data.manualTrash.days.map((dateKey) => (
                  <th key={dateKey} className="px-4 py-3 text-right">{dateKey.slice(5)}</th>
                ))}
                <th className="px-5 py-3 text-right">合计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.manualTrash.rows.length === 0 ? (
                <tr>
                  <td colSpan={data.manualTrash.days.length + 2} className="px-5 py-12 text-center text-sm text-stone-400">
                    暂无手捡统计
                  </td>
                </tr>
              ) : (
                data.manualTrash.rows.map((row) => (
                  <tr key={row.userId} className="hover:bg-stone-50/70">
                    <td className="px-5 py-4">
                      <div className="font-bold text-stone-800">{getDisplayName(row)}</div>
                      <div className="text-xs text-stone-400">ID: {row.userId} · {row.username}</div>
                    </td>
                    {data.manualTrash.days.map((dateKey) => (
                      <td key={`${row.userId}-${dateKey}`} className="px-4 py-4 text-right text-sm font-semibold text-stone-600">
                        {row.days[dateKey] ?? 0}
                      </td>
                    ))}
                    <td className="px-5 py-4 text-right text-sm font-bold text-emerald-700">{row.total}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
