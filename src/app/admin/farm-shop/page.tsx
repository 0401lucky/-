'use client';

import { useState, useEffect, useCallback } from 'react';

interface FarmShopItemAdmin {
  id: string;
  name: string;
  icon: string;
  description: string;
  effect: string;
  mode: 'buff' | 'instant';
  pointsCost: number;
  durationMs?: number;
  effectValue?: number;
  instantValue?: number;
  dailyLimit?: number;
  maxStack?: number;
  unlockLevel?: number;
  sortOrder: number;
  enabled: boolean;
  purchaseCount?: number;
  createdAt: number;
  updatedAt: number;
}

const EFFECT_OPTIONS = [
  { value: 'auto_water', label: '自动浇水' },
  { value: 'auto_harvest', label: '自动收获' },
  { value: 'pest_shield', label: '害虫防护' },
  { value: 'weather_shield', label: '天气保护' },
  { value: 'yield_bonus', label: '产量加成' },
  { value: 'growth_speed', label: '生长加速' },
  { value: 'growth_boost', label: '全田加速(即时)' },
  { value: 'plot_growth_boost', label: '单田加速(即时)' },
  { value: 'pest_clear', label: '清除害虫(即时)' },
  { value: 'random_plant', label: '随机种植(即时)' },
];

function formatDuration(ms?: number): string {
  if (!ms) return '-';
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 1) return `${hours}h`;
  return `${ms / (60 * 1000)}min`;
}

export default function AdminFarmShopPage() {
  const [items, setItems] = useState<FarmShopItemAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FarmShopItemAdmin | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState<Partial<FarmShopItemAdmin>>({
    name: '',
    icon: '',
    description: '',
    effect: 'auto_water',
    mode: 'buff',
    pointsCost: 100,
    durationMs: undefined,
    effectValue: undefined,
    instantValue: undefined,
    dailyLimit: undefined,
    unlockLevel: undefined,
    sortOrder: 0,
    enabled: true,
  });

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/games/farm/shop/admin');
      const data = await res.json();
      if (data.success) {
        setItems(data.data.items || []);
      } else {
        setMessage({ type: 'error', text: data.message || '获取道具列表失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络请求错误' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleOpenModal = (item?: FarmShopItemAdmin) => {
    if (item) {
      setEditingItem(item);
      setFormData({ ...item });
    } else {
      setEditingItem(null);
      setFormData({
        name: '',
        icon: '',
        description: '',
        effect: 'auto_water',
        mode: 'buff',
        pointsCost: 100,
        durationMs: undefined,
        effectValue: undefined,
        instantValue: undefined,
        dailyLimit: undefined,
        unlockLevel: undefined,
        sortOrder: 0,
        enabled: true,
      });
    }
    setIsModalOpen(true);
    setMessage(null);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      setMessage({ type: 'error', text: '请输入道具名称' });
      return;
    }
    if (!formData.icon?.trim()) {
      setMessage({ type: 'error', text: '请输入图标' });
      return;
    }
    if ((formData.pointsCost ?? 0) < 1) {
      setMessage({ type: 'error', text: '价格必须大于等于1' });
      return;
    }

    setSaving(true);
    try {
      const method = editingItem ? 'PUT' : 'POST';
      const body = editingItem ? { ...formData, id: editingItem.id } : formData;

      const res = await fetch('/api/games/farm/shop/admin', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        setMessage({ type: 'success', text: editingItem ? '道具更新成功' : '道具创建成功' });
        setIsModalOpen(false);
        fetchItems();
      } else {
        setMessage({ type: 'error', text: data.message || '操作失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络请求错误' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个道具吗？')) return;
    try {
      const res = await fetch('/api/games/farm/shop/admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '删除成功' });
        fetchItems();
      } else {
        setMessage({ type: 'error', text: data.message || '删除失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络请求错误' });
    }
  };

  const handleToggleStatus = async (item: FarmShopItemAdmin) => {
    try {
      const res = await fetch('/api/games/farm/shop/admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
      });
      const data = await res.json();
      if (data.success) {
        fetchItems();
      } else {
        setMessage({ type: 'error', text: data.message || '状态更新失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络请求错误' });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">农场道具管理</h1>
          <p className="text-stone-500 text-sm mt-1">管理农场游戏的道具商店，包括 Buff 和即时道具</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-lg font-semibold shadow-md shadow-violet-200 transition-all active:scale-95"
        >
          <span>+</span> 新增道具
        </button>
      </div>

      {message && !isModalOpen && (
        <div className={`mb-8 p-4 rounded-xl text-center shadow-sm border animate-fade-in ${
          message.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-violet-500 rounded-full animate-spin mb-4" />
          <p className="text-slate-500 font-medium">正在加载数据...</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="p-4 font-semibold">道具</th>
                  <th className="p-4 font-semibold">效果</th>
                  <th className="p-4 font-semibold">模式</th>
                  <th className="p-4 font-semibold">价格</th>
                  <th className="p-4 font-semibold">持续</th>
                  <th className="p-4 font-semibold">限购</th>
                  <th className="p-4 font-semibold">购买次数</th>
                  <th className="p-4 font-semibold">状态</th>
                  <th className="p-4 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{item.icon}</span>
                        <div>
                          <div className="font-bold text-slate-900">{item.name}</div>
                          <div className="text-xs text-slate-500 max-w-[180px] truncate">{item.description}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium">
                        {EFFECT_OPTIONS.find(o => o.value === item.effect)?.label ?? item.effect}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2 py-1 rounded-full font-bold border ${
                        item.mode === 'buff'
                          ? 'bg-violet-50 text-violet-700 border-violet-100'
                          : 'bg-orange-50 text-orange-700 border-orange-100'
                      }`}>
                        {item.mode === 'buff' ? '⏱️ Buff' : '⚡ 即时'}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-amber-600 font-bold">{item.pointsCost}</span>
                      <span className="text-xs text-slate-400 ml-1">积分</span>
                    </td>
                    <td className="p-4 text-sm text-slate-600">{formatDuration(item.durationMs)}</td>
                    <td className="p-4 text-sm text-slate-600">
                      {item.dailyLimit ? `${item.dailyLimit}次` : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="p-4 text-sm text-slate-600 font-medium">
                      {(item.purchaseCount ?? 0).toLocaleString()}次
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => handleToggleStatus(item)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                          item.enabled
                            ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                            : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${item.enabled ? 'bg-green-500' : 'bg-slate-400'}`} />
                        {item.enabled ? '上架' : '下架'}
                      </button>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenModal(item)}
                          className="p-2 text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="编辑"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-2 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-16 text-center">
                      <div className="text-slate-400 text-4xl mb-4">🏪</div>
                      <p className="text-slate-500 font-medium">暂无道具数据</p>
                      <p className="text-slate-400 text-sm mt-1">点击右上角新增按钮添加第一个道具</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-slide-up max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">
                {editingItem ? '✏️ 编辑道具' : '✨ 新增道具'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
              {message && isModalOpen && (
                <div className={`p-3 rounded-lg text-sm text-center border ${
                  message.type === 'success' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'
                }`}>
                  {message.text}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">名称</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    placeholder="小猫助手"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">图标</label>
                  <input
                    type="text"
                    required
                    value={formData.icon}
                    onChange={e => setFormData({ ...formData, icon: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                    placeholder="🐱"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 text-sm font-semibold mb-1.5">描述</label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
                  placeholder="道具效果描述"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">效果类型</label>
                  <select
                    value={formData.effect}
                    onChange={e => setFormData({ ...formData, effect: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                  >
                    {EFFECT_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">模式</label>
                  <div className="flex gap-2">
                    <label className={`flex-1 cursor-pointer border-2 rounded-lg px-3 py-2 flex items-center justify-center gap-1 transition-all text-sm ${
                      formData.mode === 'buff' ? 'bg-violet-50 border-violet-400 text-violet-900' : 'bg-white border-slate-200 text-slate-600'
                    }`}>
                      <input type="radio" className="hidden" checked={formData.mode === 'buff'} onChange={() => setFormData({ ...formData, mode: 'buff' })} />
                      ⏱️ Buff
                    </label>
                    <label className={`flex-1 cursor-pointer border-2 rounded-lg px-3 py-2 flex items-center justify-center gap-1 transition-all text-sm ${
                      formData.mode === 'instant' ? 'bg-orange-50 border-orange-400 text-orange-900' : 'bg-white border-slate-200 text-slate-600'
                    }`}>
                      <input type="radio" className="hidden" checked={formData.mode === 'instant'} onChange={() => setFormData({ ...formData, mode: 'instant' })} />
                      ⚡ 即时
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">价格(积分)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formData.pointsCost}
                    onChange={e => setFormData({ ...formData, pointsCost: Number(e.target.value) })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">排序权重</label>
                  <input
                    type="number"
                    value={formData.sortOrder}
                    onChange={e => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">持续(ms)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.durationMs ?? ''}
                    onChange={e => setFormData({ ...formData, durationMs: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="Buff用"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">效果值</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.effectValue ?? ''}
                    onChange={e => setFormData({ ...formData, effectValue: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="如0.25"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">即时值(ms)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.instantValue ?? ''}
                    onChange={e => setFormData({ ...formData, instantValue: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="即时道具用"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">每日限购</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.dailyLimit ?? ''}
                    onChange={e => setFormData({ ...formData, dailyLimit: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="留空不限"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-1.5">解锁等级</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={formData.unlockLevel ?? ''}
                    onChange={e => setFormData({ ...formData, unlockLevel: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="留空不限"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 py-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <label className="flex items-center gap-3 cursor-pointer w-full">
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={formData.enabled}
                      onChange={e => setFormData({ ...formData, enabled: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500" />
                  </div>
                  <span className="text-slate-700 font-medium text-sm">立即上架</span>
                </label>
              </div>

              <div className="flex gap-4 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-sm"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm transition-all shadow-md shadow-violet-200 active:scale-95 disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存道具'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
