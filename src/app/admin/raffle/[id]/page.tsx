'use client';

import { useCallback, useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Gift, Loader2, Users, Trophy, Play, XCircle, Crown, Check,
  AlertTriangle, RefreshCw, Eye, Pencil, Plus, Trash2, DollarSign, Save, X
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

interface PrizeInput {
  name: string;
  dollars: number;
  quantity: number;
}

export default function AdminRaffleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [raffle, setRaffle] = useState<Raffle | null>(null);
  const [entries, setEntries] = useState<RaffleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // 编辑模式
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // 编辑表单状态
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCoverImage, setEditCoverImage] = useState('');
  const [editTriggerType, setEditTriggerType] = useState<'threshold' | 'manual'>('threshold');
  const [editThreshold, setEditThreshold] = useState(100);
  const [editPrizes, setEditPrizes] = useState<PrizeInput[]>([]);

  const initEditForm = useCallback((r: Raffle) => {
    setEditTitle(r.title);
    setEditDescription(r.description);
    setEditCoverImage(r.coverImage || '');
    setEditTriggerType(r.triggerType);
    setEditThreshold(r.threshold);
    setEditPrizes(r.prizes.map(p => ({
      name: p.name,
      dollars: p.dollars,
      quantity: p.quantity,
    })));
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/raffle/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setRaffle(data.raffle);
          setEntries(data.entries || []);
          // 初始化编辑表单
          initEditForm(data.raffle);
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
  }, [id, initEditForm]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // 检查 URL 参数是否有 edit=true
  useEffect(() => {
    if (searchParams.get('edit') === 'true' && raffle?.status === 'draft') {
      setIsEditing(true);
    }
  }, [searchParams, raffle?.status]);

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

  const handleRetryFailedRewards = async () => {
    if (!confirm('确定要重试发放失败的奖励吗？')) return;

    setRetrying(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/raffle/${id}/retry`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        await fetchData();
        alert(data.message || '重试完成');
      } else {
        setError(data.message || '重试失败');
      }
    } catch {
      setError('重试失败');
    } finally {
      setRetrying(false);
    }
  };

  // 编辑相关函数
  const addPrize = () => {
    setEditPrizes([...editPrizes, { name: '', dollars: 1, quantity: 1 }]);
  };

  const removePrize = (index: number) => {
    if (editPrizes.length <= 1) return;
    setEditPrizes(editPrizes.filter((_, i) => i !== index));
  };

  const updatePrize = (index: number, field: keyof PrizeInput, value: string | number) => {
    const updated = [...editPrizes];
    if (field === 'name') {
      updated[index].name = value as string;
    } else if (field === 'dollars') {
      updated[index].dollars = Number(value) || 0;
    } else if (field === 'quantity') {
      updated[index].quantity = Number(value) || 0;
    }
    setEditPrizes(updated);
  };

  const getEditTotalPrizeValue = () => {
    return editPrizes.reduce((sum, p) => sum + p.dollars * p.quantity, 0);
  };

  const getEditTotalPrizeCount = () => {
    return editPrizes.reduce((sum, p) => sum + p.quantity, 0);
  };

  const handleCancelEdit = () => {
    if (raffle) {
      initEditForm(raffle);
    }
    setIsEditing(false);
    setError(null);
    // 移除 URL 参数
    router.replace(`/admin/raffle/${id}`);
  };

  const handleSaveEdit = async () => {
    setError(null);

    // 验证
    if (!editTitle.trim()) {
      setError('请填写活动标题');
      return;
    }
    if (!editDescription.trim()) {
      setError('请填写活动描述');
      return;
    }
    if (editPrizes.some(p => !p.name.trim())) {
      setError('请填写所有奖品名称');
      return;
    }
    if (editPrizes.some(p => p.dollars <= 0)) {
      setError('奖品金额必须大于0');
      return;
    }
    if (editPrizes.some(p => p.quantity <= 0)) {
      setError('奖品数量必须大于0');
      return;
    }
    if (editTriggerType === 'threshold' && editThreshold <= 0) {
      setError('人数阈值必须大于0');
      return;
    }

    setSaving(true);

    try {
      const res = await fetch(`/api/admin/raffle/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim(),
          coverImage: editCoverImage.trim() || undefined,
          triggerType: editTriggerType,
          threshold: editThreshold,
          prizes: editPrizes.map(p => ({
            name: p.name.trim(),
            dollars: p.dollars,
            quantity: p.quantity,
          })),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setRaffle(data.raffle);
        setIsEditing(false);
        router.replace(`/admin/raffle/${id}`);
      } else {
        setError(data.message || '保存失败');
      }
    } catch {
      setError('保存失败，请稍后重试');
    } finally {
      setSaving(false);
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

  // 编辑模式渲染
  if (isEditing && raffle.status === 'draft') {
    return (
      <div className="min-h-screen bg-stone-50 pb-20">
        {/* 顶部栏 */}
        <div className="sticky top-0 z-40 bg-white border-b border-stone-200 shadow-sm">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={handleCancelEdit}
                  className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-5 h-5 text-stone-600" />
                </button>
                <div>
                  <h1 className="text-xl font-bold text-stone-800">编辑活动</h1>
                  <p className="text-sm text-stone-500">修改活动信息和奖品配置</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="flex items-center gap-2 px-4 py-2 text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-xl font-medium transition-colors"
                >
                  <X className="w-4 h-4" />
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 py-6">
          {/* 错误提示 */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-600 text-sm flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              {error}
            </div>
          )}

          {/* 基本信息 */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-6">
            <h2 className="text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
              <Gift className="w-5 h-5 text-pink-500" />
              基本信息
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  活动标题 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="例如：新年福利大抽奖"
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  活动描述 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="描述活动规则和奖品信息..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 outline-none transition-all resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  封面图片（可选）
                </label>
                <input
                  type="url"
                  value={editCoverImage}
                  onChange={(e) => setEditCoverImage(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 outline-none transition-all"
                />
              </div>
            </div>
          </div>

          {/* 开奖条件 */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-6">
            <h2 className="text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-500" />
              开奖条件
            </h2>

            <div className="space-y-4">
              <div className="flex gap-4">
                <label className={`flex-1 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  editTriggerType === 'threshold'
                    ? 'border-pink-500 bg-pink-50'
                    : 'border-stone-200 hover:border-stone-300'
                }`}>
                  <input
                    type="radio"
                    name="triggerType"
                    value="threshold"
                    checked={editTriggerType === 'threshold'}
                    onChange={() => setEditTriggerType('threshold')}
                    className="sr-only"
                  />
                  <div className="font-bold text-stone-800 mb-1">人数阈值</div>
                  <div className="text-sm text-stone-500">满足指定人数后自动开奖</div>
                </label>

                <label className={`flex-1 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  editTriggerType === 'manual'
                    ? 'border-pink-500 bg-pink-50'
                    : 'border-stone-200 hover:border-stone-300'
                }`}>
                  <input
                    type="radio"
                    name="triggerType"
                    value="manual"
                    checked={editTriggerType === 'manual'}
                    onChange={() => setEditTriggerType('manual')}
                    className="sr-only"
                  />
                  <div className="font-bold text-stone-800 mb-1">手动开奖</div>
                  <div className="text-sm text-stone-500">由管理员手动触发开奖</div>
                </label>
              </div>

              {editTriggerType === 'threshold' && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    开奖人数 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={editThreshold}
                    onChange={(e) => setEditThreshold(Number(e.target.value))}
                    min={1}
                    className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 outline-none transition-all"
                  />
                  <p className="text-xs text-stone-400 mt-1">满足此人数后自动开奖</p>
                </div>
              )}
            </div>
          </div>

          {/* 奖品配置 */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-500" />
                奖品配置
              </h2>
              <div className="text-sm text-stone-500">
                总价值: <span className="font-bold text-pink-600">${getEditTotalPrizeValue()}</span>
                {' · '}
                共 <span className="font-bold">{getEditTotalPrizeCount()}</span> 份
              </div>
            </div>

            <div className="space-y-4">
              {editPrizes.map((prize, index) => (
                <div key={index} className="flex items-start gap-3 p-4 bg-stone-50 rounded-xl">
                  <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center font-bold text-sm shrink-0">
                    {index + 1}
                  </div>

                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-stone-500 mb-1">奖品名称</label>
                      <input
                        type="text"
                        value={prize.name}
                        onChange={(e) => updatePrize(index, 'name', e.target.value)}
                        placeholder="例如：一等奖"
                        className="w-full px-3 py-2 rounded-lg border border-stone-200 focus:border-pink-500 outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-stone-500 mb-1">金额（美元）</label>
                      <input
                        type="number"
                        value={prize.dollars}
                        onChange={(e) => updatePrize(index, 'dollars', e.target.value)}
                        min={0.01}
                        step={0.01}
                        className="w-full px-3 py-2 rounded-lg border border-stone-200 focus:border-pink-500 outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-stone-500 mb-1">数量</label>
                      <input
                        type="number"
                        value={prize.quantity}
                        onChange={(e) => updatePrize(index, 'quantity', e.target.value)}
                        min={1}
                        className="w-full px-3 py-2 rounded-lg border border-stone-200 focus:border-pink-500 outline-none text-sm"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removePrize(index)}
                    disabled={editPrizes.length <= 1}
                    className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addPrize}
              className="mt-4 w-full py-3 border-2 border-dashed border-stone-200 rounded-xl text-stone-500 hover:border-pink-500 hover:text-pink-500 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              添加奖品
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 查看模式渲染
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
                <>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 px-4 py-2 text-blue-600 bg-blue-100 hover:bg-blue-200 rounded-xl font-medium transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    编辑
                  </button>
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
                </>
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
                    onClick={handleRetryFailedRewards}
                    disabled={retrying}
                    className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-600 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {retrying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
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
