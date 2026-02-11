'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, BellRing, Activity, AlertTriangle } from 'lucide-react';

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
    pointsFlow: {
      todayIn: number;
      todayOut: number;
      todayNet: number;
    };
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

function formatDateTime(timestamp: number): string {
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

export default function AdminDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);

  const fetchDashboard = useCallback(async (detect = false, silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!meRes.ok) {
        router.push('/login?redirect=/admin/dashboard');
        return;
      }

      const meData = await meRes.json();
      if (!meData.success || !meData.user?.isAdmin) {
        router.push('/');
        return;
      }

      const url = detect ? '/api/admin/dashboard?detect=1' : '/api/admin/dashboard?detect=0';
      const res = await fetch(url, { cache: 'no-store' });
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
  }, [router]);

  useEffect(() => {
    void fetchDashboard(false, false);
  }, [fetchDashboard]);

  const alertLevelClass = useMemo(() => {
    return {
      info: 'text-sky-600 bg-sky-50 border-sky-200',
      warning: 'text-amber-700 bg-amber-50 border-amber-200',
      critical: 'text-red-700 bg-red-50 border-red-200',
    } as const;
  }, []);

  const handleResolve = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/alerts/${id}/resolve`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || '处理告警失败');
      }
      await fetchDashboard(false, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理告警失败');
    }
  };

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      <nav className="sticky top-0 z-50 glass border-b border-white/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 text-sm">
              <ArrowLeft className="w-4 h-4" />
              返回管理后台
            </Link>
            <div className="w-px h-5 bg-stone-300" />
            <div className="flex items-center gap-2 font-semibold text-stone-800">
              <Activity className="w-4 h-4 text-indigo-500" />
              运营仪表盘
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchDashboard(true, true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 text-sm"
              disabled={refreshing}
            >
              <AlertTriangle className="w-4 h-4" />
              运行检测
            </button>
            <button
              onClick={() => void fetchDashboard(false, true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 text-sm disabled:opacity-50"
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-xs text-stone-500">用户活跃</p>
            <p className="text-lg font-semibold text-stone-800 mt-2">DAU {loading ? '-' : data?.dashboard.users.dau ?? 0}</p>
            <p className="text-xs text-stone-500 mt-1">MAU {loading ? '-' : data?.dashboard.users.mau ?? 0} / 总用户 {loading ? '-' : data?.dashboard.users.total ?? 0}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-xs text-stone-500">兑换量</p>
            <p className="text-lg font-semibold text-stone-800 mt-2">项目兑换 {loading ? '-' : data?.dashboard.redemption.todayClaims ?? 0}</p>
            <p className="text-xs text-stone-500 mt-1">抽奖次数 {loading ? '-' : data?.dashboard.redemption.todayLotterySpins ?? 0}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-xs text-stone-500">积分流转</p>
            <p className="text-lg font-semibold text-emerald-600 mt-2">+{loading ? '-' : data?.dashboard.pointsFlow.todayIn ?? 0}</p>
            <p className="text-xs text-red-600 mt-1">-{loading ? '-' : data?.dashboard.pointsFlow.todayOut ?? 0}</p>
            <p className="text-xs text-stone-500 mt-1">净值 {loading ? '-' : data?.dashboard.pointsFlow.todayNet ?? 0}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-xs text-stone-500">游戏参与率</p>
            <p className="text-lg font-semibold text-stone-800 mt-2">{loading ? '-' : `${data?.dashboard.games.participationRate ?? 0}%`}</p>
            <p className="text-xs text-stone-500 mt-1">参与用户 {loading ? '-' : data?.dashboard.games.participants ?? 0}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-xs text-stone-500">告警概览</p>
            <p className="text-lg font-semibold text-stone-800 mt-2">活跃 {loading ? '-' : data?.dashboard.alerts.active ?? 0}</p>
            <p className="text-xs text-amber-700 mt-1">Warning {loading ? '-' : data?.dashboard.alerts.warning ?? 0}</p>
            <p className="text-xs text-red-700 mt-1">Critical {loading ? '-' : data?.dashboard.alerts.critical ?? 0}</p>
          </div>
        </section>

        {data?.detection && (
          <section className="bg-white border border-stone-200 rounded-2xl p-5 text-sm text-stone-600">
            最近一次检测：扫描用户 {data.detection.scannedUsers}，触发告警 {data.detection.triggeredAlerts}
          </section>
        )}

        <section className="bg-white border border-stone-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BellRing className="w-4 h-4 text-rose-500" />
            <h2 className="text-base font-semibold text-stone-800">活跃告警</h2>
          </div>
          {loading ? (
            <p className="text-sm text-stone-500">加载中...</p>
          ) : (
            <div className="space-y-3">
              {(data?.alerts.active ?? []).length > 0 ? (
                data?.alerts.active.map((alert) => (
                  <div key={alert.id} className="border border-stone-200 rounded-xl p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded-md border text-xs font-semibold ${alertLevelClass[alert.level]}`}>
                            {alert.level.toUpperCase()}
                          </span>
                          <span className="text-stone-700 font-medium truncate">{alert.name}</span>
                        </div>
                        <p className="text-stone-600 break-all">{alert.message}</p>
                        <p className="text-xs text-stone-400 mt-1">{formatDateTime(alert.timestamp)}</p>
                      </div>
                      <button
                        onClick={() => void handleResolve(alert.id)}
                        className="px-2.5 py-1 rounded-lg border border-stone-200 text-xs text-stone-600 hover:bg-stone-50"
                      >
                        标记已处理
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-stone-500">暂无活跃告警</p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
