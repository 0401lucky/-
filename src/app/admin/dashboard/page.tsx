'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CircleDollarSign,
  Gamepad2,
  Gift,
  LineChart,
  Megaphone,
  MessageSquareText,
  PieChart,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  WalletCards,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type PointsAnalyticsPeriod = 'day' | 'week' | 'month';

interface PointsPathDetail {
  description: string;
  total: number;
  count: number;
}

interface PointsPathCategory {
  key: string;
  label: string;
  total: number;
  count: number;
  userCount: number;
  percent: number;
  average: number;
  topDescriptions: PointsPathDetail[];
}

interface PointsPathSeries {
  key: string;
  label: string;
  total: number;
  points: Array<{
    bucketStart: number;
    label: string;
    value: number;
    count: number;
  }>;
}

interface PointsDirectionAnalytics {
  total: number;
  count: number;
  userCount: number;
  average: number;
  categories: PointsPathCategory[];
  series: PointsPathSeries[];
}

interface PointsAnalytics {
  period: PointsAnalyticsPeriod;
  range: {
    startAt: number;
    endAt: number;
    label: string;
    bucketUnit: 'hour' | 'day';
  };
  bucketLabels: string[];
  earning: PointsDirectionAnalytics;
  spending: PointsDirectionAnalytics;
  meta: {
    storage: 'native' | 'legacy';
    scannedUsers: number;
    scannedLogs: number;
    maxLogsPerUser: number | null;
    truncatedUsers: number;
    truncatedLogs: boolean;
  };
}

interface DashboardData {
  dashboard: {
    generatedAt: number;
    users: {
      total: number;
      dau: number;
      mau: number;
    };
    redemption: {
      todayClaims: number;
      todayLotterySpins: number;
    };
    engagement?: {
      todayCheckins: number;
      todayCardDraws: number;
      todayCardExchanges: number;
      todayGamesStarted: number;
      todayGamesCompleted: number;
    };
    operations?: {
      projects: {
        total: number;
        active: number;
        remainingSlots: number;
      };
      raffles: {
        active: number;
      };
      store: {
        enabledItems: number;
      };
      feedback: {
        open: number;
        processing: number;
      };
      announcements: {
        published: number;
      };
    };
    pointsFlow: {
      todayIn: number;
      todayOut: number;
      todayNet: number;
    };
    pointsAnalytics: PointsAnalytics;
    games: {
      participants: number;
      participationRate: number;
    };
    alerts: {
      active: number;
      warning: number;
      critical: number;
    };
  };
  alerts: {
    active: Array<{
      id: string;
      level: 'info' | 'warning' | 'critical';
      name: string;
      message: string;
      timestamp: number;
      tags?: Record<string, unknown>;
    }>;
    history: Array<{
      id: string;
      level: 'info' | 'warning' | 'critical';
      name: string;
      message: string;
      timestamp: number;
      resolved?: boolean;
      resolvedAt?: number;
    }>;
  };
  detection: {
    scannedUsers: number;
    triggeredAlerts: number;
  } | null;
}

interface MetricCard {
  label: string;
  value: string;
  detail: string;
  Icon: LucideIcon;
  tone: 'orange' | 'emerald' | 'sky' | 'purple' | 'rose' | 'stone';
}

const toneClass: Record<MetricCard['tone'], {
  card: string;
  icon: string;
  value: string;
}> = {
  orange: {
    card: 'border-orange-100 bg-orange-50/70',
    icon: 'bg-orange-100 text-orange-600',
    value: 'text-orange-700',
  },
  emerald: {
    card: 'border-emerald-100 bg-emerald-50/70',
    icon: 'bg-emerald-100 text-emerald-600',
    value: 'text-emerald-700',
  },
  sky: {
    card: 'border-sky-100 bg-sky-50/70',
    icon: 'bg-sky-100 text-sky-600',
    value: 'text-sky-700',
  },
  purple: {
    card: 'border-purple-100 bg-purple-50/70',
    icon: 'bg-purple-100 text-purple-600',
    value: 'text-purple-700',
  },
  rose: {
    card: 'border-rose-100 bg-rose-50/70',
    icon: 'bg-rose-100 text-rose-600',
    value: 'text-rose-700',
  },
  stone: {
    card: 'border-stone-200 bg-white',
    icon: 'bg-stone-100 text-stone-600',
    value: 'text-stone-800',
  },
};

const alertLevelClass = {
  info: 'text-sky-700 bg-sky-50 border-sky-200',
  warning: 'text-amber-700 bg-amber-50 border-amber-200',
  critical: 'text-red-700 bg-red-50 border-red-200',
} as const;

const alertLevelLabel = {
  info: '提示',
  warning: '警告',
  critical: '严重',
} as const;

const pointsPeriodOptions: Array<{ value: PointsAnalyticsPeriod; label: string; detail: string }> = [
  { value: 'day', label: '按日', detail: '今日按小时' },
  { value: 'week', label: '按周', detail: '近 7 天' },
  { value: 'month', label: '按月', detail: '本月按天' },
];

const chartColors = [
  '#f97316',
  '#0ea5e9',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#14b8a6',
  '#64748b',
  '#ef4444',
  '#84cc16',
];

function formatDateTime(timestamp: number | undefined): string {
  if (!timestamp) return '-';
  try {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

function formatNumber(value: number | undefined): string {
  return (value ?? 0).toLocaleString('zh-CN');
}

function formatSigned(value: number | undefined): string {
  const num = value ?? 0;
  return `${num >= 0 ? '+' : ''}${num.toLocaleString('zh-CN')}`;
}

function formatPercent(value: number | undefined): string {
  return `${(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
}

function buildPieGradient(categories: PointsPathCategory[], total: number): string {
  if (total <= 0 || categories.length === 0) {
    return 'conic-gradient(#e7e5e4 0deg 360deg)';
  }
  let cursor = 0;
  const segments = categories.map((category, index) => {
    const start = cursor;
    const degrees = Math.max(0, (category.total / total) * 360);
    cursor += degrees;
    const color = chartColors[index % chartColors.length];
    return `${color} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
  });
  if (cursor < 360) {
    segments.push(`#e7e5e4 ${cursor.toFixed(2)}deg 360deg`);
  }
  return `conic-gradient(${segments.join(', ')})`;
}

function mergeDisplaySeries(series: PointsPathSeries[], maxSeries = 6): PointsPathSeries[] {
  if (series.length <= maxSeries) return series;
  const primary = series.slice(0, maxSeries - 1);
  const rest = series.slice(maxSeries - 1);
  const basePoints = primary[0]?.points ?? rest[0]?.points ?? [];
  const other: PointsPathSeries = {
    key: 'other',
    label: '其他途径',
    total: rest.reduce((sum, item) => sum + item.total, 0),
    points: basePoints.map((point, index) => ({
      bucketStart: point.bucketStart,
      label: point.label,
      value: rest.reduce((sum, item) => sum + (item.points[index]?.value ?? 0), 0),
      count: rest.reduce((sum, item) => sum + (item.points[index]?.count ?? 0), 0),
    })),
  };
  return [...primary, other];
}

function shouldShowAxisLabel(index: number, total: number): boolean {
  if (total <= 8) return true;
  const step = Math.ceil(total / 6);
  return index === 0 || index === total - 1 || index % step === 0;
}

function PointsPieChart({
  title,
  analytics,
  tone,
}: {
  title: string;
  analytics: PointsDirectionAnalytics | undefined;
  tone: 'earning' | 'spending';
}) {
  const categories = analytics?.categories ?? [];
  const total = analytics?.total ?? 0;

  return (
    <div className="rounded-xl border border-stone-100 bg-stone-50/70 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PieChart className={`h-4 w-4 ${tone === 'earning' ? 'text-emerald-600' : 'text-rose-600'}`} />
          <h3 className="text-sm font-black text-stone-800">{title}扇形图</h3>
        </div>
        <span className="text-xs font-bold text-stone-400">
          {formatNumber(categories.length)} 类
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[170px_1fr] md:items-center">
        <div className="relative mx-auto h-40 w-40 shrink-0 rounded-full border border-white shadow-inner"
          style={{ background: buildPieGradient(categories, total) }}
        >
          <div className="absolute inset-8 flex flex-col items-center justify-center rounded-full bg-white text-center shadow-sm">
            <span className={`text-xl font-black ${tone === 'earning' ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatNumber(total)}
            </span>
            <span className="mt-1 text-[11px] font-bold text-stone-400">积分总量</span>
          </div>
        </div>

        {categories.length > 0 ? (
          <div className="space-y-2">
            {categories.slice(0, 8).map((category, index) => (
              <div key={category.key} className="grid grid-cols-[12px_1fr_auto] items-center gap-2 text-xs">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: chartColors[index % chartColors.length] }}
                />
                <span className="min-w-0 truncate font-bold text-stone-700">{category.label}</span>
                <span className="font-black text-stone-800">
                  {formatNumber(category.total)}
                  <span className="ml-1 font-semibold text-stone-400">{formatPercent(category.percent)}</span>
                </span>
              </div>
            ))}
            {categories.length > 8 && (
              <div className="text-xs font-semibold text-stone-400">
                其余 {formatNumber(categories.length - 8)} 类见下方明细
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-stone-200 bg-white py-8 text-center text-sm font-semibold text-stone-400">
            当前周期暂无积分流水
          </div>
        )}
      </div>
    </div>
  );
}

function PointsLineChart({
  title,
  analytics,
  tone,
}: {
  title: string;
  analytics: PointsDirectionAnalytics | undefined;
  tone: 'earning' | 'spending';
}) {
  const series = mergeDisplaySeries(analytics?.series ?? []);
  const pointCount = series[0]?.points.length ?? 0;
  const maxValue = Math.max(
    1,
    ...series.flatMap((item) => item.points.map((point) => point.value)),
  );
  const width = 640;
  const height = 230;
  const padding = { top: 18, right: 22, bottom: 42, left: 54 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const axisPoints = series[0]?.points ?? [];
  const lineWidth = Math.max(1, pointCount - 1);

  return (
    <div className="rounded-xl border border-stone-100 bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LineChart className={`h-4 w-4 ${tone === 'earning' ? 'text-emerald-600' : 'text-rose-600'}`} />
          <h3 className="text-sm font-black text-stone-800">{title}折线图</h3>
        </div>
        <span className="text-xs font-bold text-stone-400">
          峰值 {formatNumber(maxValue)}
        </span>
      </div>

      {series.length > 0 ? (
        <>
          <div className="overflow-hidden rounded-lg border border-stone-100 bg-stone-50">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-[230px] w-full" role="img" aria-label={`${title}折线图`}>
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = padding.top + chartHeight * ratio;
                const value = Math.round(maxValue * (1 - ratio));
                return (
                  <g key={ratio}>
                    <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e7e5e4" strokeDasharray="4 4" />
                    <text x={padding.left - 10} y={y + 4} textAnchor="end" className="fill-stone-400 text-[10px] font-semibold">
                      {formatNumber(value)}
                    </text>
                  </g>
                );
              })}

              {series.map((item, seriesIndex) => {
                const color = chartColors[seriesIndex % chartColors.length];
                const points = item.points.map((point, index) => {
                  const x = padding.left + (index / lineWidth) * chartWidth;
                  const y = padding.top + chartHeight - (point.value / maxValue) * chartHeight;
                  return `${x.toFixed(2)},${y.toFixed(2)}`;
                }).join(' ');
                return (
                  <g key={item.key}>
                    <polyline
                      points={points}
                      fill="none"
                      stroke={color}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {item.points.map((point, index) => {
                      if (point.value <= 0) return null;
                      const x = padding.left + (index / lineWidth) * chartWidth;
                      const y = padding.top + chartHeight - (point.value / maxValue) * chartHeight;
                      return <circle key={`${item.key}-${point.bucketStart}`} cx={x} cy={y} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />;
                    })}
                  </g>
                );
              })}

              {axisPoints.map((point, index) => {
                if (!shouldShowAxisLabel(index, axisPoints.length)) return null;
                const x = padding.left + (index / lineWidth) * chartWidth;
                return (
                  <text key={point.bucketStart} x={x} y={height - 16} textAnchor="middle" className="fill-stone-400 text-[10px] font-semibold">
                    {point.label}
                  </text>
                );
              })}
            </svg>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {series.map((item, index) => (
              <span key={item.key} className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2 py-1 text-[11px] font-bold text-stone-600">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }} />
                {item.label}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 py-14 text-center text-sm font-semibold text-stone-400">
          当前周期暂无折线数据
        </div>
      )}
    </div>
  );
}

function PointsPathTable({
  analytics,
  tone,
}: {
  analytics: PointsDirectionAnalytics | undefined;
  tone: 'earning' | 'spending';
}) {
  const categories = analytics?.categories ?? [];

  return (
    <div className="rounded-xl border border-stone-100 bg-white">
      <div className="grid grid-cols-[1.35fr_0.8fr_0.7fr_0.7fr] gap-3 border-b border-stone-100 px-4 py-3 text-xs font-black text-stone-500">
        <span>具体途径</span>
        <span className="text-right">积分</span>
        <span className="text-right">人数/笔数</span>
        <span className="text-right">占比</span>
      </div>
      {categories.length > 0 ? (
        <div className="divide-y divide-stone-100">
          {categories.map((category) => (
            <div key={category.key} className="px-4 py-3">
              <div className="grid grid-cols-[1.35fr_0.8fr_0.7fr_0.7fr] items-start gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-black text-stone-800">{category.label}</p>
                  <p className="mt-1 text-xs font-semibold text-stone-400">
                    平均每笔 {formatNumber(category.average)} 积分
                  </p>
                </div>
                <div className={`text-right font-black ${tone === 'earning' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {formatNumber(category.total)}
                </div>
                <div className="text-right text-xs font-bold text-stone-500">
                  {formatNumber(category.userCount)} 人 / {formatNumber(category.count)} 笔
                </div>
                <div className="text-right text-xs font-black text-stone-700">
                  {formatPercent(category.percent)}
                </div>
              </div>
              {category.topDescriptions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {category.topDescriptions.slice(0, 3).map((detail) => (
                    <span key={`${category.key}-${detail.description}`} className="max-w-full truncate rounded-md bg-stone-50 px-2 py-1 text-[11px] font-semibold text-stone-500">
                      {detail.description} · {formatNumber(detail.total)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center text-sm font-semibold text-stone-400">暂无明细</div>
      )}
    </div>
  );
}

function PointsAnalyticsPanel({
  title,
  description,
  analytics,
  tone,
}: {
  title: string;
  description: string;
  analytics: PointsDirectionAnalytics | undefined;
  tone: 'earning' | 'spending';
}) {
  const Icon = tone === 'earning' ? TrendingUp : TrendingDown;
  const toneText = tone === 'earning' ? 'text-emerald-700' : 'text-rose-700';
  const toneBg = tone === 'earning' ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100';

  return (
    <div className={`rounded-2xl border p-5 ${toneBg}`}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-sm">
              <Icon className={`h-4 w-4 ${toneText}`} />
            </span>
            <div>
              <h2 className="text-base font-black text-stone-900">{title}</h2>
              <p className="mt-1 text-xs font-semibold text-stone-500">{description}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className={`text-lg font-black ${toneText}`}>{formatNumber(analytics?.total)}</p>
            <p className="text-[11px] font-bold text-stone-400">总积分</p>
          </div>
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-lg font-black text-stone-800">{formatNumber(analytics?.userCount)}</p>
            <p className="text-[11px] font-bold text-stone-400">涉及用户</p>
          </div>
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-lg font-black text-stone-800">{formatNumber(analytics?.count)}</p>
            <p className="text-[11px] font-bold text-stone-400">流水笔数</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <PointsPieChart title={title} analytics={analytics} tone={tone} />
        <PointsLineChart title={title} analytics={analytics} tone={tone} />
      </div>

      <div className="mt-4">
        <PointsPathTable analytics={analytics} tone={tone} />
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [pointsPeriod, setPointsPeriod] = useState<PointsAnalyticsPeriod>('day');

  const fetchDashboard = useCallback(async (detect = false, forceRefresh = false, silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('detect', detect ? '1' : '0');
      params.set('pointsPeriod', pointsPeriod);
      if (forceRefresh) {
        params.set('refresh', '1');
      }
      const res = await fetch(`/api/admin/dashboard?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || '获取管理仪表盘失败');
      }

      setData(json.data as DashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pointsPeriod]);

  useEffect(() => {
    void fetchDashboard(false, false, false);
  }, [fetchDashboard]);

  const dashboard = data?.dashboard;
  const operations = dashboard?.operations;
  const engagement = dashboard?.engagement;
  const pointsAnalytics = dashboard?.pointsAnalytics;

  const metricCards = useMemo<MetricCard[]>(() => [
    {
      label: '今日活跃',
      value: loading ? '-' : `${formatNumber(dashboard?.users.dau)} 人`,
      detail: `MAU ${formatNumber(dashboard?.users.mau)} / 总用户 ${formatNumber(dashboard?.users.total)}`,
      Icon: Users,
      tone: 'sky',
    },
    {
      label: '福利项目',
      value: loading ? '-' : `${formatNumber(operations?.projects.active)} 个进行中`,
      detail: `剩余名额 ${formatNumber(operations?.projects.remainingSlots)} / 项目总数 ${formatNumber(operations?.projects.total)}`,
      Icon: Gift,
      tone: 'orange',
    },
    {
      label: '积分净流转',
      value: loading ? '-' : formatSigned(dashboard?.pointsFlow.todayNet),
      detail: `收入 +${formatNumber(dashboard?.pointsFlow.todayIn)} / 消耗 -${formatNumber(dashboard?.pointsFlow.todayOut)}`,
      Icon: WalletCards,
      tone: (dashboard?.pointsFlow.todayNet ?? 0) >= 0 ? 'emerald' : 'rose',
    },
    {
      label: '游戏参与',
      value: loading ? '-' : `${formatNumber(dashboard?.games.participants)} 人`,
      detail: `参与率 ${dashboard?.games.participationRate ?? 0}% / 今日完成 ${formatNumber(engagement?.todayGamesCompleted)} 局`,
      Icon: Gamepad2,
      tone: 'purple',
    },
    {
      label: '反馈待办',
      value: loading ? '-' : `${formatNumber(operations?.feedback.open)} 条待处理`,
      detail: `处理中 ${formatNumber(operations?.feedback.processing)} 条`,
      Icon: MessageSquareText,
      tone: (operations?.feedback.open ?? 0) > 0 ? 'rose' : 'stone',
    },
    {
      label: '风险告警',
      value: loading ? '-' : `${formatNumber(dashboard?.alerts.active)} 个活跃`,
      detail: `警告 ${formatNumber(dashboard?.alerts.warning)} / 严重 ${formatNumber(dashboard?.alerts.critical)}`,
      Icon: AlertTriangle,
      tone: (dashboard?.alerts.critical ?? 0) > 0 ? 'rose' : 'stone',
    },
  ], [dashboard, engagement, loading, operations]);

  const operationRows = [
    { label: '今日签到', value: formatNumber(engagement?.todayCheckins), Icon: CheckCircle2 },
    { label: '项目领取', value: formatNumber(dashboard?.redemption.todayClaims), Icon: Gift },
    { label: '幸运抽奖', value: formatNumber(dashboard?.redemption.todayLotterySpins), Icon: Sparkles },
    { label: '卡牌抽取', value: formatNumber(engagement?.todayCardDraws), Icon: Trophy },
    { label: '卡牌兑换', value: formatNumber(engagement?.todayCardExchanges), Icon: WalletCards },
    { label: '游戏开始', value: formatNumber(engagement?.todayGamesStarted), Icon: Gamepad2 },
  ];

  const quickLinks = [
    {
      href: '/admin',
      label: '福利项目',
      value: `${formatNumber(operations?.projects.active)} 个进行中`,
      Icon: Gift,
    },
    {
      href: '/admin/raffle',
      label: '多人抽奖',
      value: `${formatNumber(operations?.raffles.active)} 个进行中`,
      Icon: Sparkles,
    },
    {
      href: '/admin/store',
      label: '积分商城',
      value: `${formatNumber(operations?.store.enabledItems)} 个上架商品`,
      Icon: ShoppingBag,
    },
    {
      href: '/admin/feedback',
      label: '反馈墙',
      value: `${formatNumber((operations?.feedback.open ?? 0) + (operations?.feedback.processing ?? 0))} 条待跟进`,
      Icon: MessageSquareText,
    },
    {
      href: '/admin/announcements',
      label: '公告管理',
      value: `${formatNumber(operations?.announcements.published)} 条已发布`,
      Icon: Megaphone,
    },
  ];

  const handleResolve = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/alerts/${id}/resolve`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || '处理告警失败');
      }
      await fetchDashboard(false, true, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理告警失败');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 border border-orange-100 text-orange-700 text-xs font-bold mb-3">
            <Activity className="w-3.5 h-3.5" />
            LuCy Station 运营工作台
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-stone-800 tracking-tight">
            运营仪表盘
          </h1>
          <p className="text-stone-500 mt-2 text-sm">
            聚合福利项目、积分流转、小游戏、商城、反馈与告警，便于快速判断今日运营状态。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-xs text-stone-500">
            生成于 {formatDateTime(dashboard?.generatedAt)}
          </div>
          <button
            onClick={() => void fetchDashboard(true, true, true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-200 bg-white text-amber-700 hover:bg-amber-50 text-sm font-semibold disabled:opacity-50"
            disabled={refreshing}
          >
            <AlertTriangle className="w-4 h-4" />
            运行检测
          </button>
          <button
            onClick={() => void fetchDashboard(false, true, true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 text-sm font-semibold disabled:opacity-50"
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-medium">
          {error}
        </div>
      )}

      {data?.detection && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          最近一次检测：扫描用户 {formatNumber(data.detection.scannedUsers)} 人，触发告警 {formatNumber(data.detection.triggeredAlerts)} 个。
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {metricCards.map((metric) => {
          const Icon = metric.Icon;
          const classes = toneClass[metric.tone];
          return (
            <div key={metric.label} className={`rounded-2xl border p-5 ${classes.card}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-stone-500">{metric.label}</p>
                  <p className={`mt-2 text-2xl font-black tracking-tight ${classes.value}`}>
                    {metric.value}
                  </p>
                  <p className="mt-2 text-xs text-stone-500 leading-relaxed">
                    {metric.detail}
                  </p>
                </div>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${classes.icon}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
              <CircleDollarSign className="h-3.5 w-3.5" />
              全站积分途径分析
            </div>
            <h2 className="text-xl font-black text-stone-900">用户赚钱与花费积分途径</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-500">
              按全部用户积分流水聚合，区分收入与支出，展示每个途径的积分总量、涉及人数、流水笔数、占比和高频描述。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pointsPeriodOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPointsPeriod(option.value)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                  pointsPeriod === option.value
                    ? 'border-orange-300 bg-orange-50 text-orange-700'
                    : 'border-stone-200 bg-white text-stone-500 hover:border-orange-200 hover:bg-orange-50/60'
                }`}
              >
                <span className="block text-sm font-black">{option.label}</span>
                <span className="block text-[11px] font-semibold opacity-75">{option.detail}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
            <p className="text-xs font-bold text-stone-400">统计周期</p>
            <p className="mt-1 text-lg font-black text-stone-800">{pointsAnalytics?.range.label ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <p className="text-xs font-bold text-emerald-500">赚钱积分</p>
            <p className="mt-1 text-lg font-black text-emerald-700">{formatNumber(pointsAnalytics?.earning.total)}</p>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">
            <p className="text-xs font-bold text-rose-500">花费积分</p>
            <p className="mt-1 text-lg font-black text-rose-700">{formatNumber(pointsAnalytics?.spending.total)}</p>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3">
            <p className="text-xs font-bold text-sky-500">扫描范围</p>
            <p className="mt-1 text-sm font-black text-sky-700">
              {formatNumber(pointsAnalytics?.meta.scannedUsers)} 用户 / {formatNumber(pointsAnalytics?.meta.scannedLogs)} 流水
            </p>
            <p className="mt-1 text-[11px] font-semibold text-sky-500">
              {pointsAnalytics?.meta.storage === 'native' ? 'D1 热表统计' : `KV 流水统计${pointsAnalytics?.meta.maxLogsPerUser ? `，单用户最多 ${formatNumber(pointsAnalytics.meta.maxLogsPerUser)} 条` : ''}`}
            </p>
          </div>
        </div>

        {(pointsAnalytics?.meta.truncatedLogs || (pointsAnalytics?.meta.truncatedUsers ?? 0) > 0) && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            当前周期流水量较大，已有 {formatNumber(pointsAnalytics?.meta.truncatedUsers)} 个用户触达旧 KV 单用户扫描上限，图表仍按已扫描流水展示。
          </div>
        )}

        <div className="space-y-5">
          <PointsAnalyticsPanel
            title="赚钱积分途径"
            description="所有正向积分流水，包含游戏收益、签到奖励、福利领取、抽奖中奖、榜单奖励和退款回滚。"
            analytics={pointsAnalytics?.earning}
            tone="earning"
          />
          <PointsAnalyticsPanel
            title="花费积分途径"
            description="所有负向积分流水，包含商城兑换、账户提现、农场购买、环保道具、数字炸弹投注和处罚扣分。"
            analytics={pointsAnalytics?.spending}
            tone="spending"
          />
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-base font-bold text-stone-800">今日互动概览</h2>
              <p className="text-xs text-stone-400 mt-1">来自当前可用埋点和积分流水统计</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {operationRows.map((row) => {
              const Icon = row.Icon;
              return (
                <div key={row.label} className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-stone-500">
                    <Icon className="w-4 h-4 text-stone-400" />
                    {row.label}
                  </div>
                  <p className="mt-2 text-xl font-black text-stone-800">{loading ? '-' : row.value}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-base font-bold text-stone-800 mb-5">快捷运营入口</h2>
          <div className="space-y-2">
            {quickLinks.map((link) => {
              const Icon = link.Icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 px-4 py-3 hover:border-orange-200 hover:bg-orange-50/50 transition-colors"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-stone-100 text-stone-600 flex items-center justify-center">
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="font-bold text-sm text-stone-700">{link.label}</span>
                  </span>
                  <span className="text-xs font-semibold text-stone-400">{loading ? '-' : link.value}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <BellRing className="w-4 h-4 text-rose-500" />
            <h2 className="text-base font-bold text-stone-800">活跃告警</h2>
          </div>
          {loading ? (
            <p className="text-sm text-stone-500">加载中...</p>
          ) : (data?.alerts.active ?? []).length > 0 ? (
            <div className="space-y-3">
              {data?.alerts.active.map((alert) => (
                <div key={alert.id} className="border border-stone-200 rounded-xl p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded-md border text-xs font-bold ${alertLevelClass[alert.level]}`}>
                          {alertLevelLabel[alert.level]}
                        </span>
                        <span className="text-stone-800 font-bold truncate">{alert.name}</span>
                      </div>
                      <p className="text-stone-600 break-words leading-relaxed">{alert.message}</p>
                      <p className="text-xs text-stone-400 mt-2">{formatDateTime(alert.timestamp)}</p>
                    </div>
                    <button
                      onClick={() => void handleResolve(alert.id)}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-semibold text-stone-600 hover:bg-stone-50"
                    >
                      标记已处理
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-stone-200 py-10 text-center">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
              <p className="text-sm font-semibold text-stone-600">暂无活跃告警</p>
              <p className="text-xs text-stone-400 mt-1">当前运营状态未发现需要处理的异常。</p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-base font-bold text-stone-800 mb-4">最近告警记录</h2>
          {loading ? (
            <p className="text-sm text-stone-500">加载中...</p>
          ) : (data?.alerts.history ?? []).length > 0 ? (
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {data?.alerts.history.slice(0, 8).map((alert) => (
                <div key={`${alert.id}-${alert.timestamp}`} className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${alertLevelClass[alert.level]}`}>
                      {alertLevelLabel[alert.level]}
                    </span>
                    <span className="text-[11px] text-stone-400">{formatDateTime(alert.resolvedAt ?? alert.timestamp)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-stone-700 line-clamp-1">{alert.name}</p>
                  <p className="mt-1 text-xs text-stone-500 line-clamp-2">{alert.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-500">暂无告警历史</p>
          )}
        </div>
      </section>
    </div>
  );
}
