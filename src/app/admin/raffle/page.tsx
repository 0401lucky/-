'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Gift, Loader2, Plus, Users, Trophy, Clock, Eye,
  Trash2, Edit
} from 'lucide-react';

interface RafflePrize {
  id: string;
  name: string;
  dollars: number;
  quantity: number;
}

interface RaffleItem {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  prizes: RafflePrize[];
  triggerType: 'threshold' | 'manual';
  threshold: number;
  status: 'draft' | 'active' | 'ended' | 'cancelled';
  participantsCount: number;
  winnersCount: number;
  drawnAt?: number;
  createdAt: number;
}

export default function AdminRaffleListPage() {
  const [loading, setLoading] = useState(true);
  const [raffles, setRaffles] = useState<RaffleItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchRaffles = useCallback(async () => {
    try {
      const url = statusFilter === 'all'
        ? '/api/admin/raffle'
        : `/api/admin/raffle?status=${statusFilter}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setRaffles(data.raffles || []);
        }
      }
    } catch (error) {
      console.error('加载失败:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchRaffles();
  }, [fetchRaffles]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个活动吗？')) return;

    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/raffle/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setRaffles(raffles.filter(r => r.id !== id));
      } else {
        alert(data.message || '删除失败');
      }
    } catch {
      alert('删除失败');
    } finally {
      setDeleting(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <span className="px-2 py-1 bg-stone-100 text-stone-600 text-xs font-bold rounded-full">草稿</span>;
      case 'active':
        return <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full">进行中</span>;
      case 'ended':
        return <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">已开奖</span>;
      case 'cancelled':
        return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full">已取消</span>;
      default:
        return null;
    }
  };

  const getTotalPrizeValue = (prizes: RafflePrize[]) => {
    return prizes.reduce((sum, p) => sum + p.dollars * p.quantity, 0);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
      </div>
    );
  }

  return (
    <div className="pb-20">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">多人抽奖管理</h1>
          <p className="text-stone-500 text-sm mt-1">创建和管理抽奖活动</p>
        </div>
        <Link
          href="/admin/raffle/create"
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all"
        >
          <Plus className="w-5 h-5" />
          创建活动
        </Link>
      </div>

      {/* 筛选器 */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
          {[
            { value: 'all', label: '全部' },
            { value: 'draft', label: '草稿' },
            { value: 'active', label: '进行中' },
            { value: 'ended', label: '已开奖' },
            { value: 'cancelled', label: '已取消' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-colors ${
                statusFilter === opt.value
                  ? 'bg-pink-100 text-pink-700'
                  : 'bg-white text-stone-600 hover:bg-stone-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 活动列表 */}
        {raffles.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-stone-200">
            <Gift className="w-16 h-16 mx-auto mb-4 text-stone-300" />
            <h3 className="text-lg font-bold text-stone-500 mb-2">暂无活动</h3>
            <p className="text-stone-400 mb-6">点击上方按钮创建第一个抽奖活动</p>
            <Link
              href="/admin/raffle/create"
              className="inline-flex items-center gap-2 px-6 py-3 bg-pink-500 text-white rounded-xl font-bold"
            >
              <Plus className="w-5 h-5" />
              创建活动
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {raffles.map((raffle) => (
              <div key={raffle.id} className="bg-white rounded-2xl border border-stone-200 p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-start gap-4">
                  {/* 封面 */}
                  {raffle.coverImage && (
                    <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-stone-100 shrink-0">
                      <Image src={raffle.coverImage} alt={raffle.title} fill className="object-cover" unoptimized />
                    </div>
                  )}

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-stone-800 truncate">{raffle.title}</h3>
                      {getStatusBadge(raffle.status)}
                    </div>

                    <p className="text-sm text-stone-500 mb-4 line-clamp-2">{raffle.description}</p>

                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <div className="flex items-center gap-1 text-stone-500">
                        <Trophy className="w-4 h-4" />
                        <span>${getTotalPrizeValue(raffle.prizes)} 奖池</span>
                      </div>
                      <div className="flex items-center gap-1 text-stone-500">
                        <Users className="w-4 h-4" />
                        <span>{raffle.participantsCount} 人参与</span>
                      </div>
                      {raffle.triggerType === 'threshold' && (
                        <div className="flex items-center gap-1 text-stone-500">
                          <Clock className="w-4 h-4" />
                          <span>满 {raffle.threshold} 人开奖</span>
                        </div>
                      )}
                      {raffle.status === 'ended' && (
                        <div className="flex items-center gap-1 text-pink-600">
                          <Trophy className="w-4 h-4" />
                          <span>{raffle.winnersCount} 人中奖</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/admin/raffle/${raffle.id}`}
                      className="p-2 text-stone-500 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-colors"
                      title="查看详情"
                    >
                      <Eye className="w-5 h-5" />
                    </Link>

                    {raffle.status === 'draft' && (
                      <>
                        <Link
                          href={`/admin/raffle/${raffle.id}?edit=true`}
                          className="p-2 text-stone-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="编辑"
                        >
                          <Edit className="w-5 h-5" />
                        </Link>
                        <button
                          onClick={() => handleDelete(raffle.id)}
                          disabled={deleting === raffle.id}
                          className="p-2 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="删除"
                        >
                          {deleting === raffle.id ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Trash2 className="w-5 h-5" />
                          )}
                        </button>
                      </>
                    )}

                    {raffle.status === 'cancelled' && (
                      <button
                        onClick={() => handleDelete(raffle.id)}
                        disabled={deleting === raffle.id}
                        className="p-2 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="删除"
                      >
                        {deleting === raffle.id ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Trash2 className="w-5 h-5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
