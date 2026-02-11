'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, CheckCircle2, Clock3, MailOpen, RefreshCw, X } from 'lucide-react';

interface NotificationItem {
  id: string;
  type: 'system' | 'announcement' | 'feedback_reply' | 'lottery_win' | 'raffle_win';
  title: string;
  content: string;
  createdAt: number;
  readAt?: number;
  isRead: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<NotificationItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(
    async (targetPage = page, silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!meRes.ok) {
          router.push('/login?redirect=/notifications');
          return;
        }
        const meData = await meRes.json();
        if (!meData.success) {
          router.push('/login?redirect=/notifications');
          return;
        }

        const res = await fetch(`/api/notifications?page=${targetPage}&limit=20`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || '获取通知失败');
        }

        setItems(Array.isArray(data.data?.items) ? data.data.items : []);
        setUnreadCount(Number(data.data?.unreadCount) || 0);
        setPagination(data.data?.pagination ?? null);
        setPage(targetPage);
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取通知失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, router]
  );

  useEffect(() => {
    void fetchNotifications(1);
  }, [fetchNotifications]);

  const markRead = async (ids: string[], markAll = false) => {
    if (marking) return;
    setMarking(true);
    setError(null);

    try {
      const res = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, markAll }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '标记已读失败');
      }

      await fetchNotifications(page, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '标记已读失败');
    } finally {
      setMarking(false);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const typeLabel: Record<NotificationItem['type'], string> = {
    system: '系统通知',
    announcement: '公告通知',
    feedback_reply: '反馈回复',
    lottery_win: '抽奖中奖',
    raffle_win: '多人抽奖中奖',
  };

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      <nav className="sticky top-0 z-50 glass border-b border-white/50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm font-medium">返回首页</span>
              </Link>
              <div className="w-px h-5 bg-stone-300" />
              <div className="flex items-center gap-2 text-stone-800 font-bold">
                <Bell className="w-4 h-4 text-sky-600" />
                <span>通知中心</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2 py-1 bg-sky-50 text-sky-700 rounded-full border border-sky-100">
                未读 {unreadCount}
              </span>
              <button
                onClick={() => void fetchNotifications(page, true)}
                disabled={refreshing}
                className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                title="刷新"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-stone-500">查看中奖结果、反馈回复和系统公告。</p>
          <button
            onClick={() => void markRead([], true)}
            disabled={marking || unreadCount === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-50"
          >
            <MailOpen className="w-4 h-4" />
            全部标为已读
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-stone-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center rounded-2xl border border-stone-200 bg-white">
            <Clock3 className="w-6 h-6 mx-auto text-stone-400 mb-2" />
            <p className="text-stone-600 font-medium">暂无通知</p>
            <p className="text-sm text-stone-400 mt-1">有新的中奖或系统消息时会在这里显示。</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedItem(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedItem(item);
                  }
                }}
                className={`rounded-2xl border p-4 bg-white transition-colors cursor-pointer ${
                  item.isRead ? 'border-stone-200' : 'border-sky-200 bg-sky-50/30'
                } hover:border-sky-300`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
                        {typeLabel[item.type]}
                      </span>
                      {!item.isRead && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200 font-semibold">
                          未读
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-stone-800">{item.title}</h3>
                    <p className="mt-1 text-sm text-stone-600 whitespace-pre-wrap break-words">{item.content}</p>
                    <p className="mt-2 text-xs text-sky-600">点击查看详情</p>
                    <p className="mt-2 text-xs text-stone-400">{formatTime(item.createdAt)}</p>
                  </div>
                  {!item.isRead && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void markRead([item.id]);
                      }}
                      disabled={marking}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-sky-200 text-sky-700 text-xs font-medium hover:bg-sky-50 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      已读
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              disabled={page <= 1 || refreshing}
              onClick={() => void fetchNotifications(page - 1, true)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 text-stone-600 disabled:opacity-50"
            >
              上一页
            </button>
            <span className="text-sm text-stone-500">
              第 {page} / {pagination.totalPages} 页
            </span>
            <button
              disabled={!pagination.hasMore || refreshing}
              onClick={() => void fetchNotifications(page + 1, true)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 text-stone-600 disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        )}

        {selectedItem && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="关闭详情"
              className="absolute inset-0 bg-black/40"
              onClick={() => setSelectedItem(null)}
            />
            <div className="relative w-full max-w-2xl rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
                      {typeLabel[selectedItem.type]}
                    </span>
                    {!selectedItem.isRead && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200 font-semibold">
                        未读
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-stone-800">{selectedItem.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:bg-stone-50"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="mt-4 text-sm text-stone-600 whitespace-pre-wrap break-words">{selectedItem.content}</p>
              <p className="mt-4 text-xs text-stone-400">发布时间：{formatTime(selectedItem.createdAt)}</p>

              <div className="mt-5 flex items-center justify-end gap-2">
                {!selectedItem.isRead && (
                  <button
                    type="button"
                    disabled={marking}
                    onClick={async () => {
                      await markRead([selectedItem.id]);
                      setSelectedItem(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-sky-200 text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    标记已读
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-stone-200 text-stone-600 hover:bg-stone-50"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
