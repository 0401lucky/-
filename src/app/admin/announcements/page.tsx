'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Megaphone, Plus, Save, Trash2 } from 'lucide-react';

type AnnouncementStatus = 'draft' | 'published' | 'archived';

interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  status: AnnouncementStatus;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
}

export default function AdminAnnouncementsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | AnnouncementStatus>('all');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<AnnouncementStatus>('published');

  const isEditing = useMemo(() => editingId !== null, [editingId]);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!meRes.ok) {
        router.push('/login?redirect=/admin/announcements');
        return;
      }
      const meData = await meRes.json();
      if (!meData.success || !meData.user?.isAdmin) {
        router.push('/');
        return;
      }

      const res = await fetch(`/api/admin/announcements?status=${statusFilter}&limit=50`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '获取公告失败');
      }

      setItems(Array.isArray(data.data?.items) ? data.data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取公告失败');
    } finally {
      setLoading(false);
    }
  }, [router, statusFilter]);

  useEffect(() => {
    void fetchAnnouncements();
  }, [fetchAnnouncements]);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setContent('');
    setStatus('published');
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError('标题和内容不能为空');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const method = isEditing ? 'PATCH' : 'POST';
      const endpoint = isEditing
        ? `/api/admin/announcements/${editingId}`
        : '/api/admin/announcements';

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || (isEditing ? '更新失败' : '创建失败'));
      }

      setSuccess(isEditing ? '公告更新成功' : '公告创建成功');
      resetForm();
      await fetchAnnouncements();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: AnnouncementItem) => {
    setEditingId(item.id);
    setTitle(item.title);
    setContent(item.content);
    setStatus(item.status === 'archived' ? 'draft' : item.status);
    setError(null);
    setSuccess(null);
  };

  const archiveAnnouncement = async (id: string) => {
    if (!confirm('确定要归档这条公告吗？')) return;

    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '归档失败');
      }
      setSuccess('公告已归档');
      if (editingId === id) {
        resetForm();
      }
      await fetchAnnouncements();
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档失败');
    }
  };

  const formatTime = (ts?: number) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const statusText: Record<AnnouncementStatus, string> = {
    draft: '草稿',
    published: '已发布',
    archived: '已归档',
  };

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      <nav className="sticky top-0 z-40 glass border-b border-white/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 text-sm">
              <ArrowLeft className="w-4 h-4" />
              返回后台
            </Link>
            <div className="w-px h-5 bg-stone-300" />
            <div className="flex items-center gap-2 font-semibold text-stone-800">
              <Megaphone className="w-4 h-4 text-cyan-600" />
              公告管理
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-stone-800 mb-4">
            {isEditing ? '编辑公告' : '新建公告'}
          </h2>

          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="block text-xs text-stone-500 mb-1">标题</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-cyan-500 outline-none"
                placeholder="请输入公告标题"
              />
            </div>

            <div>
              <label className="block text-xs text-stone-500 mb-1">内容</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={5000}
                rows={8}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-cyan-500 outline-none resize-y"
                placeholder="请输入公告内容"
              />
            </div>

            <div>
              <label className="block text-xs text-stone-500 mb-1">状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AnnouncementStatus)}
                className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-cyan-500 outline-none"
              >
                <option value="published">发布并推送</option>
                <option value="draft">仅保存草稿</option>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-60"
              >
                {isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {isEditing ? '保存修改' : '创建公告'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 rounded-xl border border-stone-200 text-stone-600 text-sm"
                >
                  取消编辑
                </button>
              )}
            </div>
          </form>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {success && <p className="mt-4 text-sm text-emerald-600">{success}</p>}
        </section>

        <section className="lg:col-span-3 bg-white border border-stone-200 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-base font-semibold text-stone-800">公告列表</h2>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | AnnouncementStatus)}
              className="px-3 py-1.5 rounded-lg border border-stone-200 text-sm bg-stone-50"
            >
              <option value="all">全部状态</option>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
              <option value="archived">已归档</option>
            </select>
          </div>

          {loading ? (
            <div className="p-8 text-center text-stone-500">加载中...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-stone-400">暂无公告数据</div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="border border-stone-200 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-stone-600">
                          {statusText[item.status]}
                        </span>
                        <span className="text-xs text-stone-400">更新于 {formatTime(item.updatedAt)}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-stone-800">{item.title}</h3>
                      <p className="mt-1 text-sm text-stone-600 whitespace-pre-wrap break-words">
                        {item.content}
                      </p>
                      <p className="mt-2 text-xs text-stone-400">发布时间：{formatTime(item.publishedAt)}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <button
                        onClick={() => startEdit(item)}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-cyan-200 text-cyan-700 hover:bg-cyan-50"
                      >
                        编辑
                      </button>
                      {item.status !== 'archived' && (
                        <button
                          onClick={() => void archiveAnnouncement(item.id)}
                          className="px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          归档
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
