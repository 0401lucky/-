'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  LogOut,
  MessageSquareText,
  Send,
  User,
  LayoutDashboard,
} from 'lucide-react';

type FeedbackStatus = 'open' | 'processing' | 'resolved' | 'closed';
type FeedbackRole = 'user' | 'admin';

interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

interface FeedbackItem {
  id: string;
  userId: number;
  username: string;
  contact?: string;
  status: FeedbackStatus;
  createdAt: number;
  updatedAt: number;
  latestMessageRole?: FeedbackRole | null;
  latestMessageAt?: number | null;
}

interface FeedbackMessage {
  id: string;
  feedbackId: string;
  role: FeedbackRole;
  content: string;
  createdAt: number;
  createdBy: string;
}

interface FeedbackDetailResponse {
  feedback: FeedbackItem;
  messages: FeedbackMessage[];
}

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

const STATUS_CLASS: Record<FeedbackStatus, string> = {
  open: 'bg-orange-50 text-orange-600 border-orange-200',
  processing: 'bg-blue-50 text-blue-600 border-blue-200',
  resolved: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  closed: 'bg-stone-100 text-stone-500 border-stone-200',
};

function getFeedbackReadStorageKey(userId: number): string {
  return `feedback:read-admin-reply:${userId}`;
}

function parseReadMap(raw: string | null): Record<string, number> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, number> = {};
    Object.entries(parsed).forEach(([feedbackId, value]) => {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        next[feedbackId] = value;
      }
    });
    return next;
  } catch {
    return {};
  }
}

export default function FeedbackPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [replying, setReplying] = useState(false);

  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] =
    useState<FeedbackDetailResponse | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | FeedbackStatus>('all');
  const [readByFeedback, setReadByFeedback] = useState<Record<string, number>>({});

  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [replyContent, setReplyContent] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const router = useRouter();

  const markFeedbackRead = useCallback(
    (feedbackId: string, readAt: number) => {
      if (!user || !Number.isFinite(readAt) || readAt <= 0) {
        return;
      }

      setReadByFeedback((prev) => {
        const previousReadAt = prev[feedbackId] ?? 0;
        const nextReadAt = Math.max(previousReadAt, readAt);
        if (nextReadAt === previousReadAt) {
          return prev;
        }

        const next = {
          ...prev,
          [feedbackId]: nextReadAt,
        };

        localStorage.setItem(
          getFeedbackReadStorageKey(user.id),
          JSON.stringify(next)
        );

        return next;
      });
    },
    [user]
  );

  const loadFeedbackList = useCallback(async () => {
    setListLoading(true);
    setError(null);

    try {
      const statusQuery =
        filterStatus === 'all' ? '' : `&status=${encodeURIComponent(filterStatus)}`;
      const response = await fetch(`/api/feedback?page=1&limit=30${statusQuery}`);

      if (response.status === 401) {
        router.push('/login?redirect=/feedback');
        return;
      }

      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '获取反馈列表失败');
        return;
      }

      const items = (data.items as FeedbackItem[]) ?? [];
      setFeedbackList(items);
      setSelectedId((prev) => {
        if (prev && items.some((item) => item.id === prev)) {
          return prev;
        }
        return items[0]?.id ?? null;
      });
    } catch (fetchError) {
      console.error('Load feedback list failed:', fetchError);
      setError('获取反馈列表失败，请稍后重试');
    } finally {
      setListLoading(false);
    }
  }, [filterStatus, router]);

  const loadFeedbackDetail = useCallback(async (feedbackId: string) => {
    setDetailLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/feedback/${feedbackId}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '获取反馈详情失败');
        setSelectedDetail(null);
        return;
      }

      const messages = (data.messages as FeedbackMessage[]) ?? [];

      setSelectedDetail({
        feedback: data.feedback as FeedbackItem,
        messages,
      });

      const latestAdminReplyAt = messages.reduce((latest, message) => {
        if (message.role !== 'admin') {
          return latest;
        }
        return Math.max(latest, message.createdAt);
      }, 0);

      if (latestAdminReplyAt > 0) {
        markFeedbackRead(feedbackId, latestAdminReplyAt);
      }
    } catch (fetchError) {
      console.error('Load feedback detail failed:', fetchError);
      setError('获取反馈详情失败，请稍后重试');
      setSelectedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [markFeedbackRead]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (!response.ok) {
          router.push('/login?redirect=/feedback');
          return;
        }

        const data = await response.json();
        if (!data.success || !data.user) {
          router.push('/login?redirect=/feedback');
          return;
        }

        if (!cancelled) {
          setUser(data.user as UserData);
        }
      } catch (fetchError) {
        console.error('Bootstrap feedback page failed:', fetchError);
        if (!cancelled) {
          setError('初始化页面失败，请刷新重试');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!user) {
      setReadByFeedback({});
      return;
    }

    const raw = localStorage.getItem(getFeedbackReadStorageKey(user.id));
    setReadByFeedback(parseReadMap(raw));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void loadFeedbackList();
  }, [user, filterStatus, loadFeedbackList]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    void loadFeedbackDetail(selectedId);
  }, [selectedId, loadFeedbackDetail]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      router.push('/');
      router.refresh();
    } catch (logoutError) {
      console.error('Logout failed', logoutError);
    }
  };

  const handleSubmitFeedback = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      setError('请填写反馈内容');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: trimmedContent,
          contact: contact.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '提交反馈失败');
        return;
      }

      setSuccess('反馈已提交，我们会尽快处理');
      setContent('');
      setContact('');

      if (data.feedback?.id && typeof data.feedback?.updatedAt === 'number') {
        markFeedbackRead(data.feedback.id as string, data.feedback.updatedAt as number);
      }

      await loadFeedbackList();
      if (data.feedback?.id) {
        setSelectedId(data.feedback.id as string);
      }
    } catch (submitError) {
      console.error('Submit feedback failed:', submitError);
      setError('提交反馈失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedId) {
      setError('请先选择一条反馈');
      return;
    }

    const trimmedContent = replyContent.trim();
    if (!trimmedContent) {
      setError('请填写留言内容');
      return;
    }

    setReplying(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/feedback/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmedContent }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '留言失败');
        return;
      }

      setReplyContent('');
      setSuccess('留言成功');

      if (data.feedback?.id && typeof data.feedback?.updatedAt === 'number') {
        markFeedbackRead(data.feedback.id as string, data.feedback.updatedAt as number);
      }

      await Promise.all([
        loadFeedbackList(),
        loadFeedbackDetail(selectedId),
      ]);
    } catch (replyError) {
      console.error('Reply feedback failed:', replyError);
      setError('留言失败，请稍后重试');
    } finally {
      setReplying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafaf9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  const unreadCount = feedbackList.filter((item) => {
    if (item.latestMessageRole !== 'admin') {
      return false;
    }

    const latestAdminReplyAt = item.latestMessageAt ?? 0;
    const readAt = readByFeedback[item.id] ?? 0;
    return latestAdminReplyAt > readAt;
  }).length;

  return (
    <div className="min-h-screen bg-[#fafaf9] overflow-x-hidden">
      <nav className="sticky top-0 z-50 glass border-b border-white/50 transition-all duration-300">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <div className="flex items-center gap-4 min-w-0">
              <Link
                href="/"
                className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm font-medium hidden sm:inline">首页</span>
              </Link>
              <div className="w-px h-5 bg-stone-300 hidden sm:block" />
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center border border-orange-200">
                  <MessageSquareText className="w-5 h-5 text-orange-600" />
                </div>
                <span className="text-lg sm:text-xl font-bold text-stone-800 truncate">反馈墙</span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              {user?.isAdmin && (
                <Link
                  href="/admin"
                  className="flex items-center gap-2 px-2.5 py-2 sm:px-4 sm:py-2 bg-stone-100 text-stone-600 rounded-xl text-sm font-semibold hover:bg-orange-50 hover:text-orange-600 transition-all duration-300 border border-stone-200"
                  title="后台管理"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span className="hidden sm:inline">后台管理</span>
                </Link>
              )}

              {user ? (
                <div className="flex items-center gap-3 pl-2 sm:pl-4 sm:border-l sm:border-stone-200">
                  <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center border border-stone-100 shadow-sm">
                    <User className="w-4 h-4 text-stone-500" />
                  </div>
                  <span className="hidden md:block font-semibold text-stone-700 text-sm">
                    {user.displayName || user.username}
                  </span>
                  <button
                    onClick={handleLogout}
                    className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-200"
                    title="退出登录"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Link
                  href="/login?redirect=/feedback"
                  className="px-6 py-2.5 gradient-warm text-white rounded-xl text-sm font-bold shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 hover:-translate-y-0.5 transition-all duration-300"
                >
                  登录
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-stone-800">我的反馈</h1>
            <p className="text-stone-500 mt-2 text-sm sm:text-base">
              这里仅展示你自己的反馈记录，管理员会在同一会话回复你。
            </p>
          </div>
          <div className="text-xs font-medium text-stone-500 bg-stone-100 px-3 py-2 rounded-lg">
            可见范围：仅本人 + 管理员
          </div>
        </div>

        {(error || success) && (
          <div className="mb-6 space-y-3">
            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-medium">
                {error}
              </div>
            )}
            {success && (
              <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 text-sm font-medium">
                {success}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          <div className="space-y-6">
            <section className="glass rounded-2xl border border-white/70 p-5">
              <h2 className="text-lg font-bold text-stone-800 mb-4">提交新反馈</h2>
              <form className="space-y-4" onSubmit={handleSubmitFeedback}>
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">
                    联系方式（可选）
                  </label>
                  <input
                    value={contact}
                    onChange={(event) => setContact(event.target.value)}
                    maxLength={100}
                    placeholder="例如 QQ / 邮箱 / 手机号"
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">
                    反馈内容
                  </label>
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    rows={5}
                    maxLength={1000}
                    placeholder="请描述你遇到的问题或建议"
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none text-sm resize-y"
                  />
                  <div className="mt-1 text-right text-xs text-stone-400">
                    {content.length}/1000
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 rounded-xl gradient-warm text-white font-bold text-sm shadow-lg shadow-orange-500/20 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {submitting ? '提交中...' : '提交反馈'}
                </button>
              </form>
            </section>

            <section className="glass rounded-2xl border border-white/70 p-5">
              <div className="flex items-center justify-between mb-4 gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-stone-800">反馈列表</h2>
                  {unreadCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 text-red-600 border border-red-200 text-xs font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      {unreadCount} 条新回复
                    </span>
                  )}
                </div>
                <select
                  value={filterStatus}
                  onChange={(event) =>
                    setFilterStatus(event.target.value as 'all' | FeedbackStatus)
                  }
                  className="px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm text-stone-700"
                >
                  <option value="all">全部状态</option>
                  <option value="open">待处理</option>
                  <option value="processing">处理中</option>
                  <option value="resolved">已解决</option>
                  <option value="closed">已关闭</option>
                </select>
              </div>

              {listLoading ? (
                <div className="py-10 flex items-center justify-center text-orange-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : feedbackList.length === 0 ? (
                <div className="py-8 text-center text-sm text-stone-400 border border-dashed border-stone-200 rounded-xl">
                  暂无反馈记录
                </div>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {feedbackList.map((item) => {
                    const latestAdminReplyAt = item.latestMessageAt ?? 0;
                    const readAt = readByFeedback[item.id] ?? 0;
                    const hasUnreadReply =
                      item.latestMessageRole === 'admin' && latestAdminReplyAt > readAt;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={`w-full text-left p-3 rounded-xl border transition-colors ${
                          selectedId === item.id
                            ? 'bg-orange-50 border-orange-200'
                            : 'bg-white border-stone-200 hover:border-orange-200 hover:bg-orange-50/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-stone-500 font-medium">#{item.id}</span>
                            {hasUnreadReply && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 text-[11px] font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                新回复
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-xs px-2 py-1 rounded-full border ${STATUS_CLASS[item.status]}`}
                          >
                            {STATUS_LABEL[item.status]}
                          </span>
                        </div>
                        <div className="text-xs text-stone-400">
                          更新于 {new Date(item.updatedAt).toLocaleString('zh-CN')}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="glass rounded-2xl border border-white/70 p-5 min-h-[640px] flex flex-col">
            {!selectedId ? (
              <div className="flex-1 flex items-center justify-center text-sm text-stone-400 border border-dashed border-stone-200 rounded-xl">
                请选择一条反馈查看详情
              </div>
            ) : detailLoading && !selectedDetail ? (
              <div className="flex-1 flex items-center justify-center text-orange-500">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : selectedDetail ? (
              <>
                <div className="pb-4 border-b border-stone-200">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <h2 className="text-lg font-bold text-stone-800">反馈会话 #{selectedDetail.feedback.id}</h2>
                    <span
                      className={`text-xs px-2 py-1 rounded-full border ${STATUS_CLASS[selectedDetail.feedback.status]}`}
                    >
                      {STATUS_LABEL[selectedDetail.feedback.status]}
                    </span>
                  </div>
                  {selectedDetail.feedback.contact && (
                    <p className="text-sm text-stone-500">
                      联系方式：{selectedDetail.feedback.contact}
                    </p>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto py-4 space-y-3">
                  {selectedDetail.messages.length === 0 ? (
                    <div className="text-sm text-stone-400 text-center py-8 border border-dashed border-stone-200 rounded-xl">
                      暂无会话内容
                    </div>
                  ) : (
                    selectedDetail.messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${
                          message.role === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-3 border ${
                            message.role === 'user'
                              ? 'bg-orange-50 border-orange-200 text-stone-700'
                              : 'bg-stone-50 border-stone-200 text-stone-700'
                          }`}
                        >
                          <div className="text-xs text-stone-400 mb-1 flex items-center gap-2">
                            <span>{message.role === 'user' ? '我' : '管理员'}</span>
                            <span>·</span>
                            <span>{new Date(message.createdAt).toLocaleString('zh-CN')}</span>
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                            {message.content}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleReply} className="pt-4 border-t border-stone-200 space-y-3">
                  <textarea
                    value={replyContent}
                    onChange={(event) => setReplyContent(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    disabled={selectedDetail.feedback.status === 'closed'}
                    placeholder={
                      selectedDetail.feedback.status === 'closed'
                        ? '当前反馈已关闭，无法继续留言'
                        : '继续补充说明...'
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none text-sm resize-y disabled:opacity-70"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-stone-400">{replyContent.length}/1000</div>
                    <button
                      type="submit"
                      disabled={replying || selectedDetail.feedback.status === 'closed'}
                      className="px-4 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {replying ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {replying ? '发送中...' : '发送留言'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-stone-400 border border-dashed border-stone-200 rounded-xl">
                反馈详情加载失败，请重新选择
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
