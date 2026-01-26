'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface StoreItem {
  id: string;
  name: string;
  description: string;
  type: 'lottery_spin' | 'quota_direct';
  pointsCost: number;
  value: number;
  purchaseCount?: number;
  dailyLimit?: number;
  sortOrder: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export default function AdminStorePage() {
  const router = useRouter();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StoreItem | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Form Data
  const [formData, setFormData] = useState<Partial<StoreItem>>({
    name: '',
    description: '',
    type: 'lottery_spin',
    pointsCost: 100,
    value: 1,
    sortOrder: 0,
    enabled: true,
  });

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/store/admin');
      const data = await res.json();
      if (data.success) {
        setItems(data.data.items || []);
      } else {
        setMessage({ type: 'error', text: data.message || '获取商品列表失败' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: '网络请求错误' });
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleOpenModal = (item?: StoreItem) => {
    if (item) {
      setEditingItem(item);
      setFormData({ ...item });
    } else {
      setEditingItem(null);
      setFormData({
        name: '',
        description: '',
        type: 'lottery_spin',
        pointsCost: 100,
        value: 1,
        dailyLimit: undefined,
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

  const validateForm = () => {
    if (!formData.name?.trim()) return '请输入商品名称';
    if (!formData.description?.trim()) return '请输入商品描述';
    if ((formData.pointsCost ?? 0) < 1) return '积分价格必须大于等于1';
    if ((formData.value ?? 0) <= 0) return '获得数值必须大于0';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateForm();
    if (error) {
      setMessage({ type: 'error', text: error });
      return;
    }

    setSaving(true);
    try {
      const method = editingItem ? 'PUT' : 'POST';
      const body = editingItem ? { ...formData, id: editingItem.id } : formData;

      const res = await fetch('/api/store/admin', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        setMessage({ type: 'success', text: editingItem ? '商品更新成功' : '商品创建成功' });
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
    if (!confirm('确定要删除这个商品吗？此操作无法撤销。')) return;

    try {
      const res = await fetch('/api/store/admin', {
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

  const handleToggleStatus = async (item: StoreItem) => {
    try {
      const res = await fetch('/api/store/admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, enabled: !item.enabled }),
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
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/admin')}
              className="group flex items-center justify-center w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-all shadow-sm"
            >
              <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
            </button>
            <div>
               <h1 className="text-2xl font-bold text-slate-900">商品管理</h1>
               <p className="text-sm text-slate-500">管理积分商城的商品上架、定价与库存</p>
            </div>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-semibold shadow-md shadow-indigo-200 transition-all active:scale-95"
          >
            <span>+</span> 新增商品
          </button>
        </div>

        {/* Global Message */}
        {message && !isModalOpen && (
          <div className={`mb-8 p-4 rounded-xl text-center shadow-sm border animate-fade-in ${
            message.type === 'success' 
              ? 'bg-green-50 border-green-200 text-green-700' 
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {message.text}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
            <p className="text-slate-500 font-medium">正在加载数据...</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                    <th className="p-5 font-semibold">名称 / 描述</th>
                    <th className="p-5 font-semibold">类型</th>
                    <th className="p-5 font-semibold">定价 / 价值</th>
                    <th className="p-5 font-semibold">每日限购</th>
                    <th className="p-5 font-semibold">已购买</th>
                    <th className="p-5 font-semibold">排序权重</th>
                    <th className="p-5 font-semibold">状态</th>
                    <th className="p-5 font-semibold text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="p-5">
                        <div className="font-bold text-slate-900 text-base">{item.name}</div>
                        <div className="text-sm text-slate-500 max-w-[240px] truncate mt-0.5">{item.description}</div>
                      </td>
                      <td className="p-5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${
                          item.type === 'lottery_spin' 
                            ? 'bg-purple-50 text-purple-700 border-purple-100' 
                            : 'bg-blue-50 text-blue-700 border-blue-100'
                        }`}>
                          {item.type === 'lottery_spin' ? '🎟️ 抽奖次数' : '💰 直充额度'}
                        </span>
                      </td>
                      <td className="p-5">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-baseline gap-1">
                             <span className="text-yellow-600 font-bold">{item.pointsCost}</span>
                             <span className="text-xs text-slate-400 font-medium">积分</span>
                          </div>
                          <div className="text-slate-400 text-xs bg-slate-100 px-1.5 py-0.5 rounded w-fit">
                             = {item.value} {item.type === 'lottery_spin' ? '次' : 'USD'}
                          </div>
                        </div>
                      </td>
                      <td className="p-5 text-slate-600 text-sm font-medium">
                        {item.dailyLimit ? `${item.dailyLimit} 次` : <span className="text-slate-400 font-normal">无限制</span>}
                      </td>
                      <td className="p-5 text-slate-600 text-sm font-medium">
                        {(item.purchaseCount ?? 0).toLocaleString()} 次
                      </td>
                      <td className="p-5 text-slate-600 font-mono text-sm">
                        {item.sortOrder}
                      </td>
                      <td className="p-5">
                        <button 
                          onClick={() => handleToggleStatus(item)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                            item.enabled 
                              ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' 
                              : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${item.enabled ? 'bg-green-500' : 'bg-slate-400'}`}></span>
                          {item.enabled ? '上架中' : '已下架'}
                        </button>
                      </td>
                      <td className="p-5 text-right">
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
                      <td colSpan={8} className="p-16 text-center">
                        <div className="text-slate-400 text-4xl mb-4">📦</div>
                        <p className="text-slate-500 font-medium">暂无商品数据</p>
                        <p className="text-slate-400 text-sm mt-1">点击右上角新增按钮添加第一个商品</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Edit/Create Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-slide-up transform transition-all">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                {editingItem ? '✏️ 编辑商品' : '✨ 新增商品'}
              </h2>
              <button 
                 onClick={handleCloseModal} 
                 className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors text-xl"
              >
                 ×
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {message && isModalOpen && (
                <div className={`p-3 rounded-lg text-sm text-center border ${
                  message.type === 'success' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'
                }`}>
                  {message.text}
                </div>
              )}

              <div className="grid grid-cols-2 gap-5">
                <div className="col-span-2">
                  <label className="block text-slate-700 text-sm font-semibold mb-2">商品名称</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-400"
                    placeholder="例如：高级抽奖券"
                  />
                </div>
                
                <div className="col-span-2">
                  <label className="block text-slate-700 text-sm font-semibold mb-2">商品描述</label>
                  <textarea
                    required
                    rows={2}
                    value={formData.description}
                    onChange={e => setFormData({...formData, description: e.target.value})}
                    className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all resize-none placeholder:text-slate-400"
                    placeholder="简短描述商品的用途..."
                  />
                </div>

                <div className="col-span-2">
                   <label className="block text-slate-700 text-sm font-semibold mb-3">商品类型</label>
                   <div className="grid grid-cols-2 gap-4">
                     <label className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col gap-3 transition-all ${
                       formData.type === 'quota_direct' 
                         ? 'bg-blue-50 border-blue-500/50 text-blue-900' 
                         : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                     }`}>
                       <input 
                         type="radio" 
                         name="type" 
                         value="quota_direct"
                         checked={formData.type === 'quota_direct'}
                         onChange={() => setFormData({...formData, type: 'quota_direct'})}
                         className="hidden" 
                       />
                       <div className="flex items-center justify-between">
                          <span className="text-2xl">💰</span>
                          {formData.type === 'quota_direct' && <span className="w-2 h-2 rounded-full bg-blue-500"></span>}
                       </div>
                       <div>
                         <span className="font-bold text-sm block mb-0.5">直充额度</span>
                         <span className="text-xs opacity-70 block">直接增加余额</span>
                       </div>
                     </label>

                     <label className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col gap-3 transition-all ${
                       formData.type === 'lottery_spin' 
                         ? 'bg-purple-50 border-purple-500/50 text-purple-900' 
                         : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                     }`}>
                       <input 
                         type="radio" 
                         name="type" 
                         value="lottery_spin"
                         checked={formData.type === 'lottery_spin'}
                         onChange={() => setFormData({...formData, type: 'lottery_spin'})}
                         className="hidden" 
                       />
                       <div className="flex items-center justify-between">
                          <span className="text-2xl">🎟️</span>
                          {formData.type === 'lottery_spin' && <span className="w-2 h-2 rounded-full bg-purple-500"></span>}
                       </div>
                       <div>
                         <span className="font-bold text-sm block mb-0.5">抽奖次数</span>
                         <span className="text-xs opacity-70 block">增加游戏机会</span>
                       </div>
                     </label>
                   </div>
                </div>

                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-2">积分价格</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      required
                      value={formData.pointsCost}
                      onChange={e => setFormData({...formData, pointsCost: Number(e.target.value)})}
                      className="w-full bg-white border border-slate-300 rounded-lg pl-4 pr-12 py-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">PTS</span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-2">获得数值</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={formData.value}
                    onChange={e => setFormData({...formData, value: Number(e.target.value)})}
                    className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-2">每日限购</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.dailyLimit || ''}
                    onChange={e => {
                      const val = e.target.value === '' ? undefined : Number(e.target.value);
                      setFormData({...formData, dailyLimit: val === 0 ? undefined : val});
                    }}
                    placeholder="留空为不限"
                    className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 text-sm font-semibold mb-2">排序权重</label>
                  <input
                    type="number"
                    value={formData.sortOrder}
                    onChange={e => setFormData({...formData, sortOrder: Number(e.target.value)})}
                    className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 py-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                 <label className="flex items-center gap-3 cursor-pointer w-full group">
                   <div className="relative">
                     <input 
                       type="checkbox" 
                       className="peer sr-only"
                       checked={formData.enabled} 
                       onChange={e => setFormData({...formData, enabled: e.target.checked})} 
                     />
                     <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                   </div>
                   <span className="text-slate-700 font-medium group-hover:text-slate-900 transition-colors">立即上架销售</span>
                 </label>
              </div>

              <div className="flex gap-4 pt-4 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors font-semibold"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-all shadow-md shadow-indigo-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  {saving ? '保存中...' : '保存商品'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
