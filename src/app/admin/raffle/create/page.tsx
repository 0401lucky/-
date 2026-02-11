'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Gift, Loader2, Plus, Trash2, DollarSign, Users, Save
} from 'lucide-react';

interface PrizeInput {
  name: string;
  dollars: number;
  quantity: number;
}

export default function CreateRafflePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表单状态
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [triggerType, setTriggerType] = useState<'threshold' | 'manual'>('threshold');
  const [threshold, setThreshold] = useState(100);
  const [prizes, setPrizes] = useState<PrizeInput[]>([
    { name: '一等奖', dollars: 10, quantity: 1 },
    { name: '二等奖', dollars: 5, quantity: 3 },
    { name: '三等奖', dollars: 1, quantity: 10 },
  ]);

  const addPrize = () => {
    setPrizes([...prizes, { name: '', dollars: 1, quantity: 1 }]);
  };

  const removePrize = (index: number) => {
    if (prizes.length <= 1) return;
    setPrizes(prizes.filter((_, i) => i !== index));
  };

  const updatePrize = (index: number, field: keyof PrizeInput, value: string | number) => {
    const updated = [...prizes];
    if (field === 'name') {
      updated[index].name = value as string;
    } else if (field === 'dollars') {
      updated[index].dollars = Number(value) || 0;
    } else if (field === 'quantity') {
      updated[index].quantity = Number(value) || 0;
    }
    setPrizes(updated);
  };

  const getTotalPrizeValue = () => {
    return prizes.reduce((sum, p) => sum + p.dollars * p.quantity, 0);
  };

  const getTotalPrizeCount = () => {
    return prizes.reduce((sum, p) => sum + p.quantity, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 验证
    if (!title.trim()) {
      setError('请填写活动标题');
      return;
    }
    if (!description.trim()) {
      setError('请填写活动描述');
      return;
    }
    if (prizes.some(p => !p.name.trim())) {
      setError('请填写所有奖品名称');
      return;
    }
    if (prizes.some(p => p.dollars <= 0)) {
      setError('奖品金额必须大于0');
      return;
    }
    if (prizes.some(p => p.quantity <= 0)) {
      setError('奖品数量必须大于0');
      return;
    }
    if (triggerType === 'threshold' && threshold <= 0) {
      setError('人数阈值必须大于0');
      return;
    }

    setSaving(true);

    try {
      const res = await fetch('/api/admin/raffle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          coverImage: coverImage.trim() || undefined,
          triggerType,
          threshold,
          prizes: prizes.map(p => ({
            name: p.name.trim(),
            dollars: p.dollars,
            quantity: p.quantity,
          })),
        }),
      });

      const data = await res.json();

      if (data.success) {
        router.push(`/admin/raffle/${data.raffle.id}`);
      } else {
        setError(data.message || '创建失败');
      }
    } catch {
      setError('创建失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-20">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-800">创建抽奖活动</h1>
        <p className="text-stone-500 text-sm mt-1">设置活动信息和奖品</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-3xl">
        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-600 text-sm">
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
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：新年福利大抽奖"
                className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                活动描述 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
                value={coverImage}
                onChange={(e) => setCoverImage(e.target.value)}
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
                triggerType === 'threshold'
                  ? 'border-pink-500 bg-pink-50'
                  : 'border-stone-200 hover:border-stone-300'
              }`}>
                <input
                  type="radio"
                  name="triggerType"
                  value="threshold"
                  checked={triggerType === 'threshold'}
                  onChange={() => setTriggerType('threshold')}
                  className="sr-only"
                />
                <div className="font-bold text-stone-800 mb-1">人数阈值</div>
                <div className="text-sm text-stone-500">满足指定人数后自动开奖</div>
              </label>

              <label className={`flex-1 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                triggerType === 'manual'
                  ? 'border-pink-500 bg-pink-50'
                  : 'border-stone-200 hover:border-stone-300'
              }`}>
                <input
                  type="radio"
                  name="triggerType"
                  value="manual"
                  checked={triggerType === 'manual'}
                  onChange={() => setTriggerType('manual')}
                  className="sr-only"
                />
                <div className="font-bold text-stone-800 mb-1">手动开奖</div>
                <div className="text-sm text-stone-500">由管理员手动触发开奖</div>
              </label>
            </div>

            {triggerType === 'threshold' && (
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  开奖人数 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
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
              总价值: <span className="font-bold text-pink-600">${getTotalPrizeValue()}</span>
              {' · '}
              共 <span className="font-bold">{getTotalPrizeCount()}</span> 份
            </div>
          </div>

          <div className="space-y-4">
            {prizes.map((prize, index) => (
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
                  disabled={prizes.length <= 1}
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

        {/* 提交按钮 */}
        <div className="flex gap-4">
          <Link
            href="/admin/raffle"
            className="flex-1 py-4 text-center text-stone-600 bg-white border border-stone-200 rounded-xl font-bold hover:bg-stone-50 transition-colors"
          >
            取消
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                保存草稿
              </>
            )}
          </button>
        </div>

        <p className="text-center text-sm text-stone-400 mt-4">
          保存后可在活动详情页发布活动
        </p>
      </form>
    </div>
  );
}
