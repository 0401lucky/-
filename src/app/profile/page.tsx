'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, UserRound, Sparkles, BellRing, Gamepad2 } from 'lucide-react';

interface ProfileOverviewData {
  user: {
    id: number;
    username: string;
  };
  points: {
    balance: number;
    recentLogs: Array<{
      amount: number;
      source: string;
      description: string;
      createdAt: number;
    }>;
  };
  cards: {
    owned: number;
    total: number;
    fragments: number;
    drawsAvailable: number;
    completionRate: number;
    albums: Array<{
      id: string;
      name: string;
      owned: number;
      total: number;
      completionRate: number;
    }>;
  };
  gameplay: {
    checkinStreak: number;
    totalCheckinDays: number;
    recentRecords: Array<{
      gameType: string;
      score: number;
      pointsEarned: number;
      createdAt: number;
    }>;
  };
  notifications: {
    unreadCount: number;
    recent: Array<{
      id: string;
      title: string;
      content: string;
      type: string;
      createdAt: number;
      isRead: boolean;
    }>;
  };
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

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProfileOverviewData | null>(null);

  const fetchData = async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!meRes.ok) {
        router.push('/login?redirect=/profile');
        return;
      }

      const meData = await meRes.json();
      if (!meData.success) {
        router.push('/login?redirect=/profile');
        return;
      }

      const overviewRes = await fetch('/api/profile/overview', { cache: 'no-store' });
      const overviewData = await overviewRes.json();

      if (!overviewRes.ok || !overviewData.success) {
        throw new Error(overviewData.message || '获取个人主页失败');
      }

      setData(overviewData.data as ProfileOverviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recentPointsDelta = useMemo(() => {
    const logs = data?.points.recentLogs ?? [];
    return logs.slice(0, 5).reduce((sum, item) => sum + item.amount, 0);
  }, [data]);

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      <nav className="sticky top-0 z-50 glass border-b border-white/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 text-sm">
              <ArrowLeft className="w-4 h-4" />
              返回首页
            </Link>
            <div className="w-px h-5 bg-stone-300" />
            <div className="flex items-center gap-2 font-semibold text-stone-800">
              <UserRound className="w-4 h-4 text-orange-500" />
              个人主页
            </div>
          </div>

          <button
            onClick={() => void fetchData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-xs text-stone-500 mb-2">当前积分</p>
            <p className="text-2xl font-bold text-stone-800">{loading ? '-' : data?.points.balance ?? 0}</p>
            <p className="text-xs text-stone-500 mt-2">近 5 条流水净变动 {loading ? '-' : recentPointsDelta}</p>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-xs text-stone-500 mb-2">卡牌收集进度</p>
            <p className="text-2xl font-bold text-stone-800">
              {loading ? '-' : `${data?.cards.owned ?? 0}/${data?.cards.total ?? 0}`}
            </p>
            <p className="text-xs text-stone-500 mt-2">完成率 {loading ? '-' : `${data?.cards.completionRate ?? 0}%`}</p>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-xs text-stone-500 mb-2">签到连续天数</p>
            <p className="text-2xl font-bold text-stone-800">{loading ? '-' : `${data?.gameplay.checkinStreak ?? 0} 天`}</p>
            <p className="text-xs text-stone-500 mt-2">累计签到 {loading ? '-' : `${data?.gameplay.totalCheckinDays ?? 0} 天`}</p>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              <h2 className="text-base font-semibold text-stone-800">图鉴进度</h2>
            </div>
            {loading ? (
              <p className="text-sm text-stone-500">加载中...</p>
            ) : (
              <div className="space-y-2">
                {(data?.cards.albums ?? []).map((album) => (
                  <div key={album.id} className="border border-stone-200 rounded-xl p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-stone-700">{album.name}</span>
                      <span className="text-stone-500">{album.owned}/{album.total}</span>
                    </div>
                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${Math.min(100, album.completionRate)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Gamepad2 className="w-4 h-4 text-emerald-500" />
              <h2 className="text-base font-semibold text-stone-800">近期游戏记录</h2>
            </div>
            {loading ? (
              <p className="text-sm text-stone-500">加载中...</p>
            ) : (
              <div className="space-y-2">
                {(data?.gameplay.recentRecords ?? []).length > 0 ? (
                  data?.gameplay.recentRecords.map((record, index) => (
                    <div key={`${record.gameType}-${record.createdAt}-${index}`} className="border border-stone-200 rounded-xl p-3 text-sm flex items-center justify-between">
                      <div>
                        <p className="text-stone-700 font-medium">{record.gameType}</p>
                        <p className="text-xs text-stone-500">{formatDateTime(record.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-stone-800 font-semibold">{record.score}</p>
                        <p className="text-xs text-stone-500">积分 {record.pointsEarned >= 0 ? '+' : ''}{record.pointsEarned}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-stone-500">暂无记录</p>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="bg-white border border-stone-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-sky-500" />
              <h2 className="text-base font-semibold text-stone-800">最新通知</h2>
            </div>
            <Link href="/notifications" className="text-xs text-sky-600 hover:text-sky-700">前往通知中心</Link>
          </div>

          {loading ? (
            <p className="text-sm text-stone-500">加载中...</p>
          ) : (
            <div className="space-y-2">
              {(data?.notifications.recent ?? []).length > 0 ? (
                data?.notifications.recent.map((item) => (
                  <div key={item.id} className="border border-stone-200 rounded-xl p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-stone-800 truncate pr-2">{item.title}</p>
                      <span className={`text-xs ${item.isRead ? 'text-stone-400' : 'text-sky-600'}`}>
                        {item.isRead ? '已读' : '未读'}
                      </span>
                    </div>
                    <p className="text-stone-500 text-xs line-clamp-2">{item.content}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-stone-500">暂无通知</p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
