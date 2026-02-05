'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Gift, Loader2, Users, Trophy, Play, XCircle, Crown, Check,
  AlertTriangle, RefreshCw, Eye
} from 'lucide-react';

interface RafflePrize {
  id: string;
  name: string;
  dollars: number;
  quantity: number;
}

interface RaffleWinner {
  entryId: string;
  userId: number;
  username: string;
  prizeId: string;
  prizeName: string;
  dollars: number;
  rewardStatus: 'pending' | 'delivered' | 'failed';
  rewardMessage?: string;
  deliveredAt?: number;
}

interface RaffleEntry {
  id: string;
  raffleId: string;
  userId: number;
  username: string;
  entryNumber: number;
  createdAt: number;
}

interface Raffle {
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
  winners?: RaffleWinner[];
  createdBy: number;
  createdAt: number;
  updatedAt: number;
}

export default function AdminRaffleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [raffle, setRaffle] = useState<Raffle | null>(null);
  const [entries, setEntries] = useState<RaffleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/admin/raffle/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setRaffle(data.raffle);
          setEntries(data.entries || []);
        } else {
          setError(data.message || '活动不存在');
        }
      } else {
        setError('活动不存在');
      }
    } catch (err) {
      console.error('加载失败:', err);
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [id]);

  const handlePublish = async () => {
    if (!confirm('确定要发布活动吗？发布后将无法修改。')) return;

    setPublishing(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/raffle/${id}/publish`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        await fetchData();
      } else {
        setError(data.message || '发布失败');
      }
    } catch {
      setError('发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const handleDraw = async () => {
    if (!confirm('确定要立即开奖吗？开奖后活动将结束。')) return;

    setDrawing(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/raffle/${id}/draw`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        await fetchData();
        alert(`开奖成功！共 ${data.winners?.length || 0} 人中奖`);
      } else {
        setError(data.message || '开奖失败');
      }
    } catch {
      setError('开奖失败');
    } finally {
      setDrawing(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('确定要取消活动吗？此操作不可撤销。')) return;

    setCancelling(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/raffle/${id}/cancel`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        await fetchData();
      } else {
        setError(data.message || '取消失败');
      }
    } catch {
      setError('取消失败');
    } finally {
      setCancelling(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <span className="px-3 py-1 bg-stone-100 text-stone-600 text-sm font-bold rounded-full">草稿</span>;
      case 'active':
        return <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-bold rounded-full">进行中</span>;
      case 'ended':
        return <span className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-bold rounded-full">已开奖</span>;
      case 'cancelled':
        return <span className="px-3 py-1 bg-red-100 text-red-700 text-sm font-bold rounded-full">已取消</span>;
      default:
        return null;
    }
  };

  const getTotalPrizeValue = (prizes: RafflePrize[]) => {
    return prizes.reduce((sum, p) => sum + p.dollars * p.quantity, 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
      </div>
    );
  }

  if (error && !raffle) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 gap-4">
        <Gift className="w-16 h-16 text-stone-300" />
        <p className="text-stone-500 font-medium">{error}</p>
        <Link href="/admin/raffle" className="text-pink-500 hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  if (!raffle) return null;

  const failedRewards = raffle.winners?.filter(w => w.rewardStatus === 'failed') || [];

  return (
    <div className="min-h-screen bg-stone-50 pb-20">
      {/* 顶部栏 */}
      <div className="sticky top-0 z-40 bg-white border-b border-stone-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/admin/raffle" className="p-2 hover:bg-stone-100 rounded-lg transition-colors">
                <ArrowLeft className="w-5 h-5 text-stone-600" />
              </Link>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold text-stone-800">{raffle.title}</h1>
                  {getStatusBadge(raffle.status)}
                </div>
                <p className="text-sm text-stone-500">
                  创建于 {new Date(raffle.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2">
              <Link
                href={`/raffle/${id}`}
                target="_blank"
                className="flex items-center gap-2 px-4 py-2 text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-xl font-medium transition-colors"
              >
                <Eye className="w-4 h-4" />
                预览
              </Link>

              {raffle.status === 'draft' && (
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition-colors disabled:opacity-50"
                >
                  {publishing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  发布活动
                </button>
              )}

              {raffle.status === 'active' && (
                <>
                  <button
                    onClick={handleDraw}
                    disabled={drawing}
                    className="flex items-center gap-2 px-4 py-2 bg-pink-500 text-white rounded-xl font-bold hover:bg-pink-600 transition-colors disabled:opacity-50"
                  >
                    {drawing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trophy className="w-4 h-4" />
                    )}
                    立即开奖
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-600 rounded-xl font-bold hover:bg-red-200 transition-colors disabled:opacity-50"
                  >
                    {cancelling ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    取消活动
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-600 text-sm flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-4 border border-stone-200">
            <div className="text-sm text-stone-500 mb-1">参与人数</div>
            <div className="text-2xl font-black text-stone-800">{raffle.participantsCount}</div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-stone-200">
            <div className="text-sm text-stone-500 mb-1">中奖人数</div>
            <div className="text-2xl font-black text-pink-600">{raffle.winnersCount}</div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-stone-200">
            <div className="text-sm text-stone-500 mb-1">奖池总额</div>
            <div className="text-2xl font-black text-green-600">${getTotalPrizeValue(raffle.prizes)}</div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-stone-200">
            <div className="text-sm text-stone-500 mb-1">开奖条件</div>
            <div className="text-lg font-bold text-stone-800">
              {raffle.triggerType === 'threshold' ? `满${raffle.threshold}人` : '手动'}
            </div>
          </div>
        </div>

        {/* 奖品列表 */}
        <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-6">
          <h2 className="text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
            <Gift className="w-5 h-5 text-pink-500" />
            奖品配置
          </h2>

          <div className="space-y-3">
            {raffle.prizes.map((prize, index) => (
              <div key={prize.id} className="flex items-center gap-4 p-3 bg-stone-50 rounded-xl">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  index === 0 ? 'bg-yellow-400 text-white' :
                  index === 1 ? 'bg-stone-400 text-white' :
                  index === 2 ? 'bg-orange-400 text-white' :
                  'bg-stone-200 text-stone-600'
                }`}>
                  {index + 1}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-stone-800">{prize.name}</div>
                  <div className="text-sm text-stone-500">{prize.quantity} 份 × ${prize.dollars}</div>
                </div>
                <div className="text-lg font-bold text-pink-600">${prize.dollars * prize.quantity}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 中奖者列表 */}
        {raffle.status === 'ended' && raffle.winners && raffle.winners.length > 0 && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                <Crown className="w-5 h-5 text-yellow-500" />
                中奖名单
              </h2>

              {failedRewards.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-600">
                    {failedRewards.length} 笔发放失败
                  </span>
                  <button
                    onClick={() => {/* TODO: 实现重试 */}}
                    className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-600 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    重试
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100">
                    <th className="text-left py-2 px-3 text-stone-500 font-medium">用户</th>
                    <th className="text-left py-2 px-3 text-stone-500 font-medium">奖品</th>
                    <th className="text-left py-2 px-3 text-stone-500 font-medium">金额</th>
                    <th className="text-left py-2 px-3 text-stone-500 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {raffle.winners.map((winner) => (
                    <tr key={winner.entryId} className="border-b border-stone-50">
                      <td className="py-3 px-3">
                        <div className="font-medium text-stone-800">{winner.username}</div>
                        <div className="text-xs text-stone-400">ID: {winner.userId}</div>
                      </td>
                      <td className="py-3 px-3 text-stone-600">{winner.prizeName}</td>
                      <td className="py-3 px-3 font-bold text-pink-600">${winner.dollars}</td>
                      <td className="py-3 px-3">
                        {winner.rewardStatus === 'delivered' && (
                          <span className="flex items-center gap-1 text-green-600">
                            <Check className="w-4 h-4" />
                            已发放
                          </span>
                        )}
                        {winner.rewardStatus === 'pending' && (
                          <span className="flex items-center gap-1 text-yellow-600">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            发放中
                          </span>
                        )}
                        {winner.rewardStatus === 'failed' && (
                          <span className="flex items-center gap-1 text-red-600" title={winner.rewardMessage}>
                            <AlertTriangle className="w-4 h-4" />
                            失败
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 参与者列表 */}
        <div className="bg-white rounded-2xl border border-stone-200 p-6">
          <h2 className="text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            参与者列表
            <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs font-bold rounded-full">
              {entries.length}
            </span>
          </h2>

          {entries.length === 0 ? (
            <div className="text-center py-8 text-stone-400">
              暂无参与者
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100">
                    <th className="text-left py-2 px-3 text-stone-500 font-medium">#</th>
                    <th className="text-left py-2 px-3 text-stone-500 font-medium">用户</th>
                    <th className="text-left py-2 px-3 text-stone-500 font-medium">用户ID</th>
                    <th className="text-left py-2 px-3 text-stone-500 font-medium">参与时间</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-stone-50">
                      <td className="py-3 px-3 text-stone-400">#{entry.entryNumber}</td>
                      <td className="py-3 px-3 font-medium text-stone-800">{entry.username}</td>
                      <td className="py-3 px-3 text-stone-500">{entry.userId}</td>
                      <td className="py-3 px-3 text-stone-500">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
