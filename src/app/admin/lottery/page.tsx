'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgePercent,
  BarChart3,
  Bomb,
  Check,
  Clock3,
  Loader2,
  Palette,
  RefreshCw,
  Save,
  Sparkles,
  Ticket,
  ToggleLeft,
  ToggleRight,
  Trophy,
  Users,
  X,
} from 'lucide-react';

interface TierStats {
  id: string;
  name: string;
  value: number;
  probability: number;
  color: string;
  codesCount: number;
  usedCount: number;
  available: number;
  enabled?: boolean;
}

interface LotteryRecord {
  id: string;
  username: string;
  oderId: string;
  tierName: string;
  tierValue: number;
  code: string;
  directCredit?: boolean;
  pointsAwarded?: number;
  createdAt: number;
}

interface LotteryConfigState {
  enabled: boolean;
  mode: 'points';
  dailyDirectLimit: number;
  dailySpinLimit: number;
}

interface NumberBombPreview {
  date: string;
  systemNumber: number;
  recentStats?: NumberBombDailyStats[];
}

interface NumberBombDailyStats {
  date: string;
  systemNumber: number | null;
  participantCount: number;
  totalBetCount: number;
  wonCount: number;
  lostCount: number;
  pendingCount: number;
  cancelledCount: number;
  selectedCounts: Record<string, number>;
  participants?: NumberBombParticipant[];
  winners?: NumberBombParticipant[];
}

interface NumberBombParticipant {
  userId: number;
  username: string;
  selectedNumber: number;
  status: 'pending' | 'won' | 'lost' | 'cancelled';
  multiplier: number;
  ticketCost: number;
  rewardPoints?: number;
  createdAt: number;
  settledAt?: number;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeTier(tier: TierStats): TierStats {
  return {
    ...tier,
    enabled: tier.enabled !== false,
    probability: Number(tier.probability) || 0,
    value: Number(tier.value) || 0,
  };
}

const numberBombStatusText: Record<NumberBombParticipant['status'], string> = {
  pending: '待开奖',
  won: '中奖',
  lost: '未中',
  cancelled: '已取消',
};

function getNumberBombStatusClass(status: NumberBombParticipant['status']): string {
  if (status === 'won') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (status === 'pending') return 'bg-orange-50 text-orange-700 ring-orange-100';
  if (status === 'lost') return 'bg-stone-100 text-stone-600 ring-stone-200';
  return 'bg-zinc-100 text-zinc-500 ring-zinc-200';
}

export default function AdminLotteryPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingBomb, setLoadingBomb] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [config, setConfig] = useState<LotteryConfigState>({
    enabled: true,
    mode: 'points',
    dailyDirectLimit: 2000,
    dailySpinLimit: 10,
  });
  const [tiers, setTiers] = useState<TierStats[]>([]);
  const [records, setRecords] = useState<LotteryRecord[]>([]);
  const [numberBomb, setNumberBomb] = useState<NumberBombPreview | null>(null);

  const enabledProbabilityTotal = useMemo(
    () => tiers
      .filter((tier) => tier.enabled !== false)
      .reduce((sum, tier) => sum + Number(tier.probability || 0), 0),
    [tiers],
  );
  const enabledTierCount = tiers.filter((tier) => tier.enabled !== false).length;
  const maxPrize = tiers.reduce((max, tier) => Math.max(max, tier.enabled === false ? 0 : tier.value), 0);
  const numberBombStats = numberBomb?.recentStats ?? [];
  const recentBombParticipants = numberBombStats.reduce((sum, day) => sum + day.participantCount, 0);
  const recentBombWinners = numberBombStats.reduce((sum, day) => sum + day.wonCount, 0);

  const fetchNumberBomb = useCallback(async () => {
    setLoadingBomb(true);
    try {
      const res = await fetch('/api/admin/lottery/number-bomb');
      const data = await res.json();
      if (data.success) {
        setNumberBomb(data.data);
      }
    } catch (err) {
      console.error('Fetch number bomb preview error:', err);
    } finally {
      setLoadingBomb(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lotteryRes] = await Promise.all([
        fetch('/api/admin/lottery?page=1&limit=80'),
        fetchNumberBomb(),
      ]);
      const data = await lotteryRes.json();
      if (!data.success) {
        setError(data.message || '加载抽奖配置失败');
        return;
      }

      setConfig({
        enabled: data.config?.enabled ?? true,
        mode: 'points',
        dailyDirectLimit: data.config?.dailyDirectLimit ?? 2000,
        dailySpinLimit: data.config?.dailySpinLimit ?? 10,
      });
      setTiers((data.tiers || []).map(normalizeTier));
      setRecords(data.records || []);
    } catch (err) {
      console.error('Fetch lottery admin data error:', err);
      setError('加载抽奖配置失败');
    } finally {
      setLoading(false);
    }
  }, [fetchNumberBomb]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const updateTier = (id: string, patch: Partial<TierStats>) => {
    setTiers((current) => current.map((tier) => (
      tier.id === id ? normalizeTier({ ...tier, ...patch }) : tier
    )));
  };

  const handleSave = async () => {
    const activeTiers = tiers.filter((tier) => tier.enabled !== false);
    if (activeTiers.length === 0) {
      setError('至少需要启用一个奖项');
      return;
    }
    if (Math.abs(enabledProbabilityTotal - 100) > 0.01) {
      setError(`启用奖项概率合计必须为 100%，当前为 ${enabledProbabilityTotal.toFixed(2)}%`);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/admin/lottery/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: config.enabled,
          mode: 'points',
          dailySpinLimit: config.dailySpinLimit,
          tiers: tiers.map((tier) => ({
            id: tier.id,
            name: tier.name,
            value: tier.value,
            color: tier.color,
            probability: tier.probability,
            enabled: tier.enabled !== false,
          })),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || '保存失败');
        return;
      }
      setSuccess('抽奖配置已保存，前台幸运抽奖会立即读取新规则');
      await fetchData();
    } catch (err) {
      console.error('Save lottery config error:', err);
      setError('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7 px-4 py-8 sm:px-6">
      <div className="overflow-hidden rounded-[28px] border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-rose-50 p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-orange-600 shadow-sm ring-1 ring-orange-100">
              <Sparkles className="h-3.5 w-3.5" />
              积分抽奖管理
            </div>
            <h1 className="text-2xl font-black text-stone-900 md:text-4xl">幸运抽奖后台</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
              当前抽奖统一发放站内积分。旧兑换码和美元直充逻辑仅保留历史读取，不再从后台新增。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-2xl bg-white/80 px-4 py-2 text-xs font-bold text-stone-600 shadow-sm ring-1 ring-orange-100">
              每日上限
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={config.dailySpinLimit}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  setConfig((prev) => ({
                    ...prev,
                    dailySpinLimit: Number.isSafeInteger(next) ? Math.min(100, Math.max(1, next)) : prev.dailySpinLimit,
                  }));
                }}
                className="w-16 rounded-xl border border-orange-100 bg-white px-2 py-1 text-center text-sm font-black text-stone-900 outline-none focus:border-orange-300"
              />
              次
            </label>
            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold shadow-sm transition ${
                config.enabled
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                  : 'bg-stone-800 text-white hover:bg-stone-900'
              }`}
            >
              {config.enabled ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
              {config.enabled ? '抽奖已开放' : '抽奖已关闭'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              保存配置
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <AlertCircle className="h-5 w-5" />
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto rounded-lg p-1 hover:bg-red-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          <Check className="h-5 w-5" />
          {success}
          <button type="button" onClick={() => setSuccess(null)} className="ml-auto rounded-lg p-1 hover:bg-emerald-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-white bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-stone-500">
            <Ticket className="h-4 w-4 text-orange-500" />
            启用奖项
          </div>
          <div className="mt-3 text-3xl font-black text-stone-900">{enabledTierCount}</div>
        </div>
        <div className="rounded-2xl border border-white bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-stone-500">
            <BadgePercent className="h-4 w-4 text-rose-500" />
            启用概率合计
          </div>
          <div className={`mt-3 text-3xl font-black ${Math.abs(enabledProbabilityTotal - 100) <= 0.01 ? 'text-emerald-600' : 'text-red-500'}`}>
            {enabledProbabilityTotal.toFixed(2)}%
          </div>
        </div>
        <div className="rounded-2xl border border-white bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-stone-500">
            <Trophy className="h-4 w-4 text-amber-500" />
            最高积分
          </div>
          <div className="mt-3 text-3xl font-black text-stone-900">{maxPrize}</div>
        </div>
        <div className="rounded-2xl border border-white bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-stone-500">
              <Bomb className="h-4 w-4 text-fuchsia-500" />
              今天的数字
            </div>
            <button
              type="button"
              onClick={fetchNumberBomb}
              className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
              title="刷新"
            >
              {loadingBomb ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="text-3xl font-black text-stone-900">{numberBomb?.systemNumber ?? '-'}</span>
            <span className="pb-1 text-xs font-semibold text-stone-500">{numberBomb?.date ?? '未生成'}</span>
          </div>
        </div>
      </div>

      <section className="rounded-[28px] border border-white bg-white p-4 shadow-sm md:p-6">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-black text-fuchsia-700 ring-1 ring-fuchsia-100">
              <Bomb className="h-3.5 w-3.5" />
              数字炸弹近七天
            </div>
            <h2 className="flex items-center gap-2 text-lg font-black text-stone-900">
              <BarChart3 className="h-5 w-5 text-fuchsia-500" />
              参与与中奖概览
            </h2>
            <p className="text-sm text-stone-500">按自然日统计有效参与名单、中奖名单和 0-9 选择分布。</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <div className="rounded-2xl bg-stone-50 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-black text-stone-500">
                <Users className="h-4 w-4 text-fuchsia-500" />
                近七天参与
              </div>
              <div className="mt-1 text-2xl font-black text-stone-900">{recentBombParticipants}</div>
            </div>
            <div className="rounded-2xl bg-stone-50 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-black text-stone-500">
                <Trophy className="h-4 w-4 text-amber-500" />
                中奖人数
              </div>
              <div className="mt-1 text-2xl font-black text-stone-900">{recentBombWinners}</div>
            </div>
          </div>
        </div>

        {numberBombStats.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-10 text-center text-sm font-semibold text-stone-400">
            暂无数字炸弹统计
          </div>
        ) : (
          <div className="space-y-3">
            {numberBombStats.map((day) => {
              const digitCounts = Array.from({ length: 10 }, (_, digit) => ({
                digit,
                count: Number(day.selectedCounts?.[String(digit)] ?? 0),
              }));
              const participants = day.participants ?? [];
              const winners = day.winners ?? [];
              const maxCount = Math.max(1, ...digitCounts.map((item) => item.count));
              const settledCount = day.wonCount + day.lostCount;

              return (
                <div key={day.date} className="rounded-2xl border border-stone-100 bg-stone-50/70 p-4">
                  <div className="grid gap-3 xl:grid-cols-[160px_1fr] xl:items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-base font-black text-stone-900">{day.date}</div>
                        {day.systemNumber !== null && (
                          <span className="rounded-full bg-stone-900 px-2 py-0.5 text-xs font-black text-white">
                            开 {day.systemNumber}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl bg-white px-3 py-2">
                          <div className="font-bold text-stone-400">参与</div>
                          <div className="text-lg font-black text-stone-900">{day.participantCount}</div>
                        </div>
                        <div className="rounded-xl bg-white px-3 py-2">
                          <div className="font-bold text-stone-400">中奖</div>
                          <div className="text-lg font-black text-emerald-600">{day.wonCount}</div>
                        </div>
                        <div className="rounded-xl bg-white px-3 py-2">
                          <div className="font-bold text-stone-400">已开奖</div>
                          <div className="text-lg font-black text-stone-900">{settledCount}</div>
                        </div>
                        <div className="rounded-xl bg-white px-3 py-2">
                          <div className="font-bold text-stone-400">待开奖</div>
                          <div className="text-lg font-black text-orange-600">{day.pendingCount}</div>
                        </div>
                      </div>
                      {day.cancelledCount > 0 && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-stone-500">
                          <Clock3 className="h-3.5 w-3.5" />
                          取消 {day.cancelledCount}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      {digitCounts.map(({ digit, count }) => (
                        <div key={digit} className="rounded-xl bg-white px-3 py-2">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-fuchsia-50 text-xs font-black text-fuchsia-700">
                              {digit}
                            </span>
                            <span className="text-xs font-black text-stone-600">{count} 人</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                            <div
                              className="h-full rounded-full bg-fuchsia-500"
                              style={{ width: count === 0 ? '0%' : `${Math.max(6, (count / maxCount) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-100">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-black text-stone-800">
                          <Users className="h-4 w-4 text-fuchsia-500" />
                          参与名单
                        </div>
                        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-black text-stone-600">
                          {participants.length} 人
                        </span>
                      </div>
                      {participants.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-stone-200 px-3 py-6 text-center text-xs font-semibold text-stone-400">
                          暂无参与人员
                        </div>
                      ) : (
                        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                          {participants.map((participant) => (
                            <div
                              key={`${day.date}-participant-${participant.userId}`}
                              className="flex flex-wrap items-center gap-2 rounded-xl bg-stone-50 px-3 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-black text-stone-900">
                                  {participant.username || `用户 ${participant.userId}`}
                                </div>
                                <div className="mt-0.5 text-xs font-semibold text-stone-400">
                                  ID {participant.userId} · {formatTime(participant.createdAt)}
                                </div>
                              </div>
                              <span className="rounded-lg bg-fuchsia-50 px-2 py-1 text-xs font-black text-fuchsia-700">
                                选 {participant.selectedNumber}
                              </span>
                              <span className="rounded-lg bg-white px-2 py-1 text-xs font-black text-stone-500 ring-1 ring-stone-100">
                                x{participant.multiplier}
                              </span>
                              <span className={`rounded-lg px-2 py-1 text-xs font-black ring-1 ${getNumberBombStatusClass(participant.status)}`}>
                                {numberBombStatusText[participant.status]}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl bg-white p-3 ring-1 ring-amber-100">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-black text-stone-800">
                          <Trophy className="h-4 w-4 text-amber-500" />
                          中奖名单
                        </div>
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700">
                          {winners.length} 人
                        </span>
                      </div>
                      {winners.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-amber-100 px-3 py-6 text-center text-xs font-semibold text-stone-400">
                          暂无中奖人员
                        </div>
                      ) : (
                        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                          {winners.map((winner) => (
                            <div
                              key={`${day.date}-winner-${winner.userId}`}
                              className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50/70 px-3 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-black text-stone-900">
                                  {winner.username || `用户 ${winner.userId}`}
                                </div>
                                <div className="mt-0.5 text-xs font-semibold text-amber-700/70">
                                  ID {winner.userId} · {formatTime(winner.settledAt ?? winner.createdAt)}
                                </div>
                              </div>
                              <span className="rounded-lg bg-white px-2 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100">
                                选 {winner.selectedNumber}
                              </span>
                              <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
                                +{winner.rewardPoints ?? 0} 分
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-white bg-white p-4 shadow-sm md:p-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-stone-900">奖项配置</h2>
            <p className="text-sm text-stone-500">启用奖项才会进入前台抽奖池；停用奖项的概率不会参与合计。</p>
          </div>
          <div className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600">
            模式：站内积分
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-y-3">
            <thead>
              <tr className="text-left text-xs font-black uppercase text-stone-400">
                <th className="px-3">状态</th>
                <th className="px-3">奖项名称</th>
                <th className="px-3">积分值</th>
                <th className="px-3">颜色</th>
                <th className="px-3">概率</th>
                <th className="px-3">历史记录</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.id} className="rounded-2xl bg-stone-50">
                  <td className="rounded-l-2xl px-3 py-3">
                    <button
                      type="button"
                      onClick={() => updateTier(tier.id, { enabled: tier.enabled === false })}
                      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${
                        tier.enabled !== false
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-stone-200 text-stone-500'
                      }`}
                    >
                      {tier.enabled !== false ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                      {tier.enabled !== false ? '启用' : '停用'}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <input
                      value={tier.name}
                      onChange={(event) => updateTier(tier.id, { name: event.target.value })}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-800 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={tier.value}
                      onChange={(event) => updateTier(tier.id, { value: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })}
                      className="w-28 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-800 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={tier.color}
                        onChange={(event) => updateTier(tier.id, { color: event.target.value })}
                        className="h-10 w-12 rounded-xl border border-stone-200 bg-white p-1"
                      />
                      <div className="flex items-center gap-1 text-xs font-semibold text-stone-500">
                        <Palette className="h-3.5 w-3.5" />
                        {tier.color}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={tier.probability}
                        onChange={(event) => updateTier(tier.id, { probability: Math.max(0, Number.parseFloat(event.target.value) || 0) })}
                        className="w-28 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-800 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      />
                      <span className="text-sm font-bold text-stone-500">%</span>
                    </div>
                  </td>
                  <td className="rounded-r-2xl px-3 py-3 text-sm text-stone-500">
                    已出 {tier.usedCount} 次
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[28px] border border-white bg-white p-4 shadow-sm md:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-stone-900">最近抽奖记录</h2>
            <p className="text-sm text-stone-500">积分模式会记录实际发放的积分，0 分代表谢谢惠顾。</p>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700 transition hover:bg-stone-200"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
        <div className="overflow-hidden rounded-2xl border border-stone-100">
          {records.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm font-semibold text-stone-400">暂无抽奖记录</div>
          ) : (
            <div className="divide-y divide-stone-100">
              {records.slice(0, 30).map((record) => (
                <div key={record.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1.2fr_1fr_.8fr_.8fr] md:items-center">
                  <div>
                    <div className="font-bold text-stone-800">{record.username || `用户 ${record.oderId}`}</div>
                    <div className="text-xs text-stone-400">{formatTime(record.createdAt)}</div>
                  </div>
                  <div className="font-semibold text-stone-700">{record.tierName}</div>
                  <div className="font-black text-orange-600">
                    +{record.pointsAwarded ?? record.tierValue ?? 0} 积分
                  </div>
                  <div className="text-xs font-semibold text-stone-400 md:text-right">
                    {record.directCredit ? '历史直充' : record.code ? '历史兑换码' : '积分抽奖'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
