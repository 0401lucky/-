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

export default function AdminFeedbackPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [replying, setReplying] = useState(false);

  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] =
    useState<FeedbackDetailResponse | null>(null);

  const [filterStatus, setFilterStatus] = useState<'all' | FeedbackStatus>('all');
  const [nextStatus, setNextStatus] = useState<FeedbackStatus>('open');
  const [replyContent, setReplyContent] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const router = useRouter();

  const loadFeedbackList = useCallback(async () => {
    setListLoading(true);
    setError(null);

    try {
      const statusQuery =
        filterStatus === 'all' ? '' : `&status=${encodeURIComponent(filterStatus)}`;
      const response = await fetch(
        `/api/admin/feedback?page=1&limit=80${statusQuery}`
      );
      const data = await response.json();

      if (response.status === 403) {
        router.push('/');
        return;
      }

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
      console.error('Load admin feedback list failed:', fetchError);
      setError('获取反馈列表失败，请稍后重试');
    } finally {
      setListLoading(false);
    }
  }, [filterStatus, router]);

  const loadFeedbackDetail = useCallback(async (feedbackId: string) => {
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/admin/feedback/${feedbackId}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '获取反馈详情失败');
        setSelectedDetail(null);
        return;
      }

      const detail = {
        feedback: data.feedback as FeedbackItem,
        messages: (data.messages as FeedbackMessage[]) ?? [],
      };

      setSelectedDetail(detail);
      setNextStatus(detail.feedback.status);
    } catch (fetchError) {
      console.error('Load admin feedback detail failed:', fetchError);
      setError('获取反馈详情失败，请稍后重试');
      setSelectedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (!response.ok) {
          router.push('/login?redirect=/admin/feedback');
          return;
        }

        const data = await response.json();
        if (!data.success || !data.user?.isAdmin) {
          router.push('/');
          return;
        }

        if (!cancelled) {
          setUser(data.user as UserData);
        }
      } catch (fetchError) {
        console.error('Bootstrap admin feedback page failed:', fetchError);
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
      console.error('Logout failed:', logoutError);
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedId) {
      setError('请先选择一条反馈');
      return;
    }

    setStatusSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/admin/feedback/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '状态更新失败');
        return;
      }

      setSuccess('状态更新成功');
      await Promise.all([
        loadFeedbackList(),
        loadFeedbackDetail(selectedId),
      ]);
    } catch (updateError) {
      console.error('Update feedback status failed:', updateError);
      setError('状态更新失败，请稍后重试');
    } finally {
      setStatusSaving(false);
    }
  };

  const handleReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedId) {
      setError('请先选择一条反馈');
      return;
    }

    const trimmed = replyContent.trim();
    if (!trimmed) {
      setError('请输入回复内容');
      return;
    }

    setReplying(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/admin/feedback/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.message || '回复失败');
        return;
      }

      setReplyContent('');
      setSuccess('回复已发送');
      await Promise.all([
        loadFeedbackList(),
        loadFeedbackDetail(selectedId),
      ]);
    } catch (replyError) {
      console.error('Reply feedback failed:', replyError);
      setError('回复失败，请稍后重试');
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

  return (
    <div className="min-h-screen bg-[#fafaf9] overflow-x-hidden">
      <nav className="sticky top-0 z-50 glass border-b border-white/50">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <div className="h-[72px] flex items-center justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <Link
                href="/admin"
                className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm font-medium hidden sm:inline">返回后台</span>
              </Link>
              <div className="w-px h-5 bg-stone-300 hidden sm:block" />
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center border border-orange-200">
                  <MessageSquareText className="w-5 h-5 text-orange-600" />
                </div>
                <span className="text-lg sm:text-xl font-bold text-stone-800 truncate">
                  反馈墙管理
                </span>
              </div>
            </div>

            {user && (
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 rounded-full border border-stone-200/60">
                  <div className="w-6 h-6 rounded-full bg-stone-300 flex items-center justify-center">
                    <User className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-sm font-semibold text-stone-700 hidden sm:inline">
                    {user.displayName || user.username}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 bg-stone-50 hover:bg-red-50 text-stone-400 hover:text-red-500 rounded-lg transition-colors"
                  title="退出登录"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-stone-800">用户反馈总览</h1>
            <p className="text-stone-500 mt-2 text-sm sm:text-base">
              管理员可查看全部反馈、更新状态并回复用户。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-stone-500">状态筛选</span>
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

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
          <section className="glass rounded-2xl border border-white/70 p-5">
            <h2 className="text-lg font-bold text-stone-800 mb-4">反馈列表</h2>
            {listLoading ? (
              <div className="py-10 flex items-center justify-center text-orange-500">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : feedbackList.length === 0 ? (
              <div className="py-8 text-center text-sm text-stone-400 border border-dashed border-stone-200 rounded-xl">
                暂无反馈数据
              </div>
            ) : (
              <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
                {feedbackList.map((item) => (
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
                      <span className="font-semibold text-sm text-stone-700 truncate">
                        {item.username}（UID: {item.userId}）
                      </span>
                      <span
                        className={`text-xs px-2 py-1 rounded-full border ${STATUS_CLASS[item.status]}`}
                      >
                        {STATUS_LABEL[item.status]}
                      </span>
                    </div>
                    <div className="text-xs text-stone-400">#{item.id}</div>
                    <div className="text-xs text-stone-400 mt-1">
                      更新于 {new Date(item.updatedAt).toLocaleString('zh-CN')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="glass rounded-2xl border border-white/70 p-5 min-h-[720px] flex flex-col">
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
                <div className="pb-4 border-b border-stone-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-bold text-stone-800">
                      反馈详情 #{selectedDetail.feedback.id}
                    </h2>
                    <span
                      className={`text-xs px-2 py-1 rounded-full border ${STATUS_CLASS[selectedDetail.feedback.status]}`}
                    >
                      {STATUS_LABEL[selectedDetail.feedback.status]}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-stone-500">
                    <div>用户：{selectedDetail.feedback.username}</div>
                    <div>UID：{selectedDetail.feedback.userId}</div>
                    <div>
                      创建时间：
                      {new Date(selectedDetail.feedback.createdAt).toLocaleString('zh-CN')}
                    </div>
                    <div>
                      更新时间：
                      {new Date(selectedDetail.feedback.updatedAt).toLocaleString('zh-CN')}
                    </div>
                    <div className="sm:col-span-2">
                      联系方式：{selectedDetail.feedback.contact || '未填写'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={nextStatus}
                      onChange={(event) =>
                        setNextStatus(event.target.value as FeedbackStatus)
                      }
                      className="px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm text-stone-700"
                    >
                      <option value="open">待处理</option>
                      <option value="processing">处理中</option>
                      <option value="resolved">已解决</option>
                      <option value="closed">已关闭</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleUpdateStatus}
                      disabled={statusSaving}
                      className="px-4 py-2 rounded-lg bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {statusSaving ? '更新中...' : '更新状态'}
                    </button>
                  </div>
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
                          message.role === 'admin' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <div
                          className={`max-w-[88%] rounded-2xl px-4 py-3 border ${
                            message.role === 'admin'
                              ? 'bg-orange-50 border-orange-200 text-stone-700'
                              : 'bg-stone-50 border-stone-200 text-stone-700'
                          }`}
                        >
                          <div className="text-xs text-stone-400 mb-1 flex items-center gap-2">
                            <span>{message.role === 'admin' ? '管理员' : '用户'}</span>
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
                        ? '当前反馈已关闭，无法回复'
                        : '输入回复内容...'
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none text-sm resize-y disabled:opacity-70"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-stone-400">{replyContent.length}/1000</div>
                    <button
                      type="submit"
                      disabled={replying || selectedDetail.feedback.status === 'closed'}
                      className="px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {replying ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {replying ? '发送中...' : '发送回复'}
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
