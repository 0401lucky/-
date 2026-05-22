'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Boxes,
  Check,
  Edit3,
  Loader2,
  PackagePlus,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Sprout,
  Tag,
  Trash2,
  X,
} from 'lucide-react';

type StoreItemType = 'lottery_spin' | 'card_draw' | 'makeup_card';
type AdminTab = 'items' | 'categories' | 'farm';

interface StoreCategory {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface StoreItem {
  id: string;
  name: string;
  description: string;
  type: StoreItemType | 'quota_direct';
  categoryId?: string;
  pointsCost: number;
  value: number;
  purchaseCount?: number;
  dailyLimit?: number;
  sortOrder: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface FarmItem {
  key: string;
  name: string;
  emoji: string;
  category: string;
  cost: number;
  description: string;
  dailyLimit?: number;
  durationMinutes?: number;
  speedReduceMinutes?: number;
  petEffect?: Record<string, number>;
  override?: {
    cost?: number;
    dailyLimit?: number;
    durationMinutes?: number;
    speedReduceMinutes?: number;
    petEffect?: Record<string, number>;
  };
}

const itemTypeOptions: Array<{ value: StoreItemType; label: string }> = [
  { value: 'lottery_spin', label: '抽奖次数' },
  { value: 'card_draw', label: '卡牌抽卡' },
  { value: 'makeup_card', label: '补签卡' },
];

const adminTabs = [
  { id: 'items', label: '积分商品', Icon: Boxes },
  { id: 'categories', label: '商品分类', Icon: Tag },
  { id: 'farm', label: '农场商品', Icon: Sprout },
] as const;

const emptyItemForm: Partial<StoreItem> = {
  name: '',
  description: '',
  type: 'lottery_spin',
  pointsCost: 100,
  value: 1,
  sortOrder: 0,
  enabled: true,
};

const emptyCategoryForm: Partial<StoreCategory> = {
  name: '',
  color: '#06b6d4',
  sortOrder: 10,
  enabled: true,
};

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getTypeLabel(type: StoreItem['type']) {
  if (type === 'card_draw') return '卡牌抽卡';
  if (type === 'makeup_card') return '补签卡';
  if (type === 'quota_direct') return '历史直充';
  return '抽奖次数';
}

export default function AdminStorePage() {
  const [tab, setTab] = useState<AdminTab>('items');
  const [items, setItems] = useState<StoreItem[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [farmItems, setFarmItems] = useState<FarmItem[]>([]);
  const [farmDrafts, setFarmDrafts] = useState<Record<string, Partial<FarmItem>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StoreItem | null>(null);
  const [itemForm, setItemForm] = useState<Partial<StoreItem>>(emptyItemForm);

  const [categoryForm, setCategoryForm] = useState<Partial<StoreCategory>>(emptyCategoryForm);

  const enabledCategories = useMemo(
    () => categories.filter((category) => category.enabled),
    [categories],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/store/admin', { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) {
        setMessage({ type: 'error', text: data.message || '获取商品配置失败' });
        return;
      }
      const nextItems = (data.data.items || []) as StoreItem[];
      const nextCategories = (data.data.categories || []) as StoreCategory[];
      const nextFarmItems = (data.data.farmItems || []) as FarmItem[];
      setItems(nextItems);
      setCategories(nextCategories);
      setFarmItems(nextFarmItems);
      setFarmDrafts(Object.fromEntries(nextFarmItems.map((item) => [item.key, {
        cost: item.cost,
        dailyLimit: item.dailyLimit,
        durationMinutes: item.durationMinutes,
        speedReduceMinutes: item.speedReduceMinutes,
        petEffect: item.petEffect ?? item.override?.petEffect,
      }])));
    } catch (error) {
      console.error('Fetch admin store error:', error);
      setMessage({ type: 'error', text: '网络请求失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openItemModal = (item?: StoreItem) => {
    setEditingItem(item ?? null);
    setItemForm(item ? { ...item } : {
      ...emptyItemForm,
      categoryId: enabledCategories[0]?.id,
    });
    setItemModalOpen(true);
    setMessage(null);
  };

  const closeItemModal = () => {
    setItemModalOpen(false);
    setEditingItem(null);
    setItemForm(emptyItemForm);
  };

  const saveItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!itemForm.name?.trim()) return setMessage({ type: 'error', text: '请输入商品名称' });
    if (!itemForm.description?.trim()) return setMessage({ type: 'error', text: '请输入商品描述' });
    if (!itemForm.categoryId) return setMessage({ type: 'error', text: '请选择商品分类' });
    if (itemForm.type === 'quota_direct') return setMessage({ type: 'error', text: '历史直充商品不能新建或改为该类型' });

    setSaving('item');
    try {
      const res = await fetch('/api/store/admin', {
        method: editingItem ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingItem ? { ...itemForm, id: editingItem.id } : itemForm),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage({ type: 'error', text: data.message || '保存失败' });
        return;
      }
      setMessage({ type: 'success', text: '商品已保存' });
      closeItemModal();
      await fetchData();
    } catch (error) {
      console.error('Save item error:', error);
      setMessage({ type: 'error', text: '保存失败' });
    } finally {
      setSaving(null);
    }
  };

  const toggleItem = async (item: StoreItem) => {
    if (item.type === 'quota_direct' && !item.enabled) {
      setMessage({ type: 'error', text: '历史直充商品只能兼容展示，不能重新上架' });
      return;
    }
    setSaving(item.id);
    try {
      const res = await fetch('/api/store/admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage({ type: 'error', text: data.message || '状态更新失败' });
        return;
      }
      await fetchData();
    } finally {
      setSaving(null);
    }
  };

  const deleteItem = async (item: StoreItem) => {
    if (!confirm(`确定删除「${item.name}」吗？`)) return;
    setSaving(item.id);
    try {
      const res = await fetch('/api/store/admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage({ type: 'error', text: data.message || '删除失败' });
        return;
      }
      setMessage({ type: 'success', text: '商品已删除' });
      await fetchData();
    } finally {
      setSaving(null);
    }
  };

  const saveCategory = async (category?: StoreCategory) => {
    const payload = category ?? categoryForm;
    if (!payload.name?.trim()) return setMessage({ type: 'error', text: '请输入分类名称' });
    setSaving(`category:${payload.id ?? 'new'}`);
    try {
      const res = await fetch('/api/store/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: payload.id,
          name: payload.name,
          color: payload.color,
          sortOrder: Number(payload.sortOrder ?? 0),
          enabled: payload.enabled !== false,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage({ type: 'error', text: data.message || '分类保存失败' });
        return;
      }
      setCategoryForm(emptyCategoryForm);
      setMessage({ type: 'success', text: '分类已保存，前台筛选会同步更新' });
      await fetchData();
    } finally {
      setSaving(null);
    }
  };

  const patchFarmDraft = (key: string, patch: Partial<FarmItem>) => {
    setFarmDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch,
      },
    }));
  };

  const patchFarmEffect = (key: string, effectKey: string, value: string) => {
    const parsed = numberOrUndefined(value);
    setFarmDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        petEffect: {
          ...(current[key]?.petEffect ?? {}),
          ...(parsed === undefined ? {} : { [effectKey]: parsed }),
        },
      },
    }));
  };

  const saveFarmItem = async (item: FarmItem) => {
    setSaving(`farm:${item.key}`);
    try {
      const draft = farmDrafts[item.key] ?? {};
      const res = await fetch('/api/store/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'farm-item',
          key: item.key,
          cost: draft.cost,
          dailyLimit: draft.dailyLimit,
          durationMinutes: draft.durationMinutes,
          speedReduceMinutes: draft.speedReduceMinutes,
          petEffect: draft.petEffect,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage({ type: 'error', text: data.message || '农场商品保存失败' });
        return;
      }
      setMessage({ type: 'success', text: '农场商品配置已保存，购买与使用会读取新配置' });
      await fetchData();
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <div className="rounded-[28px] border border-white bg-gradient-to-br from-white via-orange-50 to-cyan-50 p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-black text-orange-600 shadow-sm">
              <Boxes className="h-3.5 w-3.5" />
              商品管理
            </div>
            <h1 className="text-2xl font-black text-stone-900 md:text-4xl">积分商店与农场商品</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
              积分商品同步前台商店分类；农场商品只编辑现有物品的价格、限购和已有数值效果。
            </p>
          </div>
          <button
            type="button"
            onClick={() => openItemModal()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-orange-600"
          >
            <PackagePlus className="h-5 w-5" />
            新增积分商品
          </button>
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${
          message.type === 'success'
            ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
            : 'border-red-100 bg-red-50 text-red-700'
        }`}>
          {message.type === 'success' ? <Check className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          {message.text}
          <button type="button" onClick={() => setMessage(null)} className="ml-auto rounded-lg p-1 hover:bg-white/70">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 rounded-2xl bg-white p-2 shadow-sm">
        {adminTabs.map(({ id, label, Icon }) => (
          <button
            key={id as string}
            type="button"
            onClick={() => setTab(id as AdminTab)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition ${
              tab === id
                ? 'bg-stone-900 text-white'
                : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={fetchData}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-stone-100 px-4 py-2 text-sm font-bold text-stone-600 hover:bg-stone-200"
        >
          <RefreshCw className="h-4 w-4" />
          刷新
        </button>
      </div>

      {tab === 'items' && (
        <section className="overflow-hidden rounded-[28px] border border-white bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-stone-50 text-xs font-black uppercase text-stone-400">
                <tr>
                  <th className="p-5">商品</th>
                  <th className="p-5">分类</th>
                  <th className="p-5">类型</th>
                  <th className="p-5">定价</th>
                  <th className="p-5">限购</th>
                  <th className="p-5">状态</th>
                  <th className="p-5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {items.map((item) => {
                  const category = categories.find((cat) => cat.id === item.categoryId);
                  const isLegacy = item.type === 'quota_direct';
                  return (
                    <tr key={item.id} className="hover:bg-stone-50/70">
                      <td className="p-5">
                        <div className="font-black text-stone-900">{item.name}</div>
                        <div className="mt-1 max-w-[320px] truncate text-sm text-stone-500">{item.description}</div>
                      </td>
                      <td className="p-5">
                        <span className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-black text-stone-700">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: category?.color ?? '#94a3b8' }} />
                          {category?.name ?? '未分类'}
                        </span>
                      </td>
                      <td className="p-5 text-sm font-bold text-stone-600">{getTypeLabel(item.type)}</td>
                      <td className="p-5">
                        <div className="font-black text-orange-600">{item.pointsCost.toLocaleString()} 积分</div>
                        <div className="text-xs font-semibold text-stone-400">获得 {item.value}</div>
                      </td>
                      <td className="p-5 text-sm font-semibold text-stone-600">
                        {item.dailyLimit ? `${item.dailyLimit} 次/日` : '不限'}
                      </td>
                      <td className="p-5">
                        <button
                          type="button"
                          disabled={saving === item.id}
                          onClick={() => toggleItem(item)}
                          className={`rounded-full px-3 py-1 text-xs font-black ${
                            item.enabled
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-stone-200 text-stone-500'
                          } ${isLegacy ? 'cursor-not-allowed opacity-70' : ''}`}
                        >
                          {isLegacy ? '历史只读' : item.enabled ? '上架中' : '已下架'}
                        </button>
                      </td>
                      <td className="p-5">
                        <div className="flex justify-end gap-2">
                          {!isLegacy && (
                            <button
                              type="button"
                              onClick={() => openItemModal(item)}
                              className="rounded-xl bg-blue-50 p-2 text-blue-600 hover:bg-blue-100"
                              title="编辑"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}
                          {!isLegacy && (
                            <button
                              type="button"
                              onClick={() => deleteItem(item)}
                              className="rounded-xl bg-red-50 p-2 text-red-500 hover:bg-red-100"
                              title="删除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'categories' && (
        <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveCategory();
            }}
            className="rounded-[28px] border border-white bg-white p-5 shadow-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-stone-900">
              <Plus className="h-5 w-5 text-orange-500" />
              新增分类
            </h2>
            <div className="space-y-4">
              <input
                value={categoryForm.name ?? ''}
                onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                placeholder="分类名称"
              />
              <div className="flex gap-3">
                <input
                  type="color"
                  value={categoryForm.color ?? '#06b6d4'}
                  onChange={(event) => setCategoryForm({ ...categoryForm, color: event.target.value })}
                  className="h-11 w-14 rounded-xl border border-stone-200 p-1"
                />
                <input
                  type="number"
                  value={categoryForm.sortOrder ?? 10}
                  onChange={(event) => setCategoryForm({ ...categoryForm, sortOrder: Number(event.target.value) })}
                  className="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  placeholder="排序"
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-bold text-stone-600">
                <input
                  type="checkbox"
                  checked={categoryForm.enabled !== false}
                  onChange={(event) => setCategoryForm({ ...categoryForm, enabled: event.target.checked })}
                />
                启用分类
              </label>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-black text-white hover:bg-orange-600"
              >
                <Save className="h-4 w-4" />
                保存分类
              </button>
            </div>
          </form>

          <div className="rounded-[28px] border border-white bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-stone-900">
              <Palette className="h-5 w-5 text-cyan-500" />
              分类列表
            </h2>
            <div className="space-y-3">
              {categories.map((category) => (
                <div key={category.id} className="grid gap-3 rounded-2xl bg-stone-50 p-3 md:grid-cols-[1fr_92px_90px_84px_90px] md:items-center">
                  <input
                    value={category.name}
                    onChange={(event) => setCategories((current) => current.map((cat) => cat.id === category.id ? { ...cat, name: event.target.value } : cat))}
                    className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold outline-none"
                  />
                  <input
                    type="color"
                    value={category.color}
                    onChange={(event) => setCategories((current) => current.map((cat) => cat.id === category.id ? { ...cat, color: event.target.value } : cat))}
                    className="h-10 w-full rounded-xl border border-stone-200 bg-white p-1"
                  />
                  <input
                    type="number"
                    value={category.sortOrder}
                    onChange={(event) => setCategories((current) => current.map((cat) => cat.id === category.id ? { ...cat, sortOrder: Number(event.target.value) } : cat))}
                    className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold outline-none"
                  />
                  <label className="flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-stone-600">
                    <input
                      type="checkbox"
                      checked={category.enabled}
                      onChange={(event) => setCategories((current) => current.map((cat) => cat.id === category.id ? { ...cat, enabled: event.target.checked } : cat))}
                    />
                    启用
                  </label>
                  <button
                    type="button"
                    onClick={() => saveCategory(category)}
                    disabled={saving === `category:${category.id}`}
                    className="rounded-xl bg-stone-900 px-3 py-2 text-sm font-black text-white hover:bg-stone-700"
                  >
                    保存
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'farm' && (
        <section className="rounded-[28px] border border-white bg-white p-4 shadow-sm md:p-6">
          <div className="mb-5">
            <h2 className="text-lg font-black text-stone-900">农场商品</h2>
            <p className="mt-1 text-sm text-stone-500">
              这里只覆盖现有农场物品的价格、限购、持续时间、加速分钟和宠物属性变化，不新增物品和效果类型。
            </p>
          </div>
          <div className="space-y-3">
            {farmItems.map((item) => {
              const draft = farmDrafts[item.key] ?? item;
              const petEffect = draft.petEffect ?? item.petEffect ?? {};
              return (
                <div key={item.key} className="rounded-2xl bg-stone-50 p-4">
                  <div className="grid gap-4 lg:grid-cols-[1.4fr_110px_110px_110px_110px_1.4fr_92px] lg:items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{item.emoji}</span>
                        <span className="font-black text-stone-900">{item.name}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-stone-500">{item.category}</span>
                      </div>
                      <p className="mt-1 text-sm text-stone-500">{item.description}</p>
                    </div>
                    <label className="text-xs font-bold text-stone-500">
                      价格
                      <input
                        type="number"
                        min="0"
                        value={draft.cost ?? 0}
                        onChange={(event) => patchFarmDraft(item.key, { cost: Math.max(0, Number(event.target.value) || 0) })}
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-800 outline-none"
                      />
                    </label>
                    <label className="text-xs font-bold text-stone-500">
                      日限购
                      <input
                        type="number"
                        min="0"
                        value={draft.dailyLimit ?? ''}
                        onChange={(event) => patchFarmDraft(item.key, { dailyLimit: numberOrUndefined(event.target.value) })}
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-800 outline-none"
                        placeholder="不限"
                      />
                    </label>
                    <label className="text-xs font-bold text-stone-500">
                      持续分钟
                      <input
                        type="number"
                        min="1"
                        value={draft.durationMinutes ?? ''}
                        onChange={(event) => patchFarmDraft(item.key, { durationMinutes: numberOrUndefined(event.target.value) })}
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-800 outline-none"
                        placeholder="-"
                      />
                    </label>
                    <label className="text-xs font-bold text-stone-500">
                      加速分钟
                      <input
                        type="number"
                        min="1"
                        value={draft.speedReduceMinutes ?? ''}
                        onChange={(event) => patchFarmDraft(item.key, { speedReduceMinutes: numberOrUndefined(event.target.value) })}
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-800 outline-none"
                        placeholder="-"
                      />
                    </label>
                    <div>
                      <div className="mb-1 text-xs font-bold text-stone-500">宠物属性变化</div>
                      {Object.keys(petEffect).length === 0 ? (
                        <div className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-stone-400">无宠物属性</div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(petEffect).map(([effectKey, value]) => (
                            <label key={effectKey} className="text-[11px] font-bold text-stone-500">
                              {effectKey}
                              <input
                                type="number"
                                value={value}
                                onChange={(event) => patchFarmEffect(item.key, effectKey, event.target.value)}
                                className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-bold text-stone-800 outline-none"
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={saving === `farm:${item.key}`}
                      onClick={() => saveFarmItem(item)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {saving === `farm:${item.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      保存
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {itemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm">
          <form onSubmit={saveItem} className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-black text-stone-900">{editingItem ? '编辑积分商品' : '新增积分商品'}</h2>
              <button type="button" onClick={closeItemModal} className="rounded-xl p-2 text-stone-400 hover:bg-stone-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-4">
              <input
                value={itemForm.name ?? ''}
                onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                placeholder="商品名称"
              />
              <textarea
                value={itemForm.description ?? ''}
                onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })}
                className="min-h-20 resize-none rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                placeholder="商品描述"
              />
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-bold text-stone-600">
                  商品类型
                  <select
                    value={itemForm.type ?? 'lottery_spin'}
                    onChange={(event) => setItemForm({ ...itemForm, type: event.target.value as StoreItemType })}
                    className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 outline-none"
                  >
                    {itemTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-bold text-stone-600">
                  商品分类
                  <select
                    value={itemForm.categoryId ?? ''}
                    onChange={(event) => setItemForm({ ...itemForm, categoryId: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 outline-none"
                  >
                    <option value="">请选择分类</option>
                    {enabledCategories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <input
                  type="number"
                  min="1"
                  value={itemForm.pointsCost ?? 1}
                  onChange={(event) => setItemForm({ ...itemForm, pointsCost: Math.max(1, Number(event.target.value) || 1) })}
                  className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold outline-none"
                  placeholder="积分价格"
                />
                <input
                  type="number"
                  min="1"
                  value={itemForm.value ?? 1}
                  onChange={(event) => setItemForm({ ...itemForm, value: Math.max(1, Number(event.target.value) || 1) })}
                  className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold outline-none"
                  placeholder="获得数值"
                />
                <input
                  type="number"
                  min="0"
                  value={itemForm.dailyLimit ?? ''}
                  onChange={(event) => setItemForm({ ...itemForm, dailyLimit: numberOrUndefined(event.target.value) })}
                  className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold outline-none"
                  placeholder="每日限购"
                />
                <input
                  type="number"
                  value={itemForm.sortOrder ?? 0}
                  onChange={(event) => setItemForm({ ...itemForm, sortOrder: Number(event.target.value) || 0 })}
                  className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-bold outline-none"
                  placeholder="排序"
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-bold text-stone-600">
                <input
                  type="checkbox"
                  checked={itemForm.enabled !== false}
                  onChange={(event) => setItemForm({ ...itemForm, enabled: event.target.checked })}
                />
                上架销售
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={closeItemModal} className="flex-1 rounded-xl border border-stone-200 px-4 py-3 text-sm font-black text-stone-600 hover:bg-stone-50">
                取消
              </button>
              <button type="submit" disabled={saving === 'item'} className="flex-1 rounded-xl bg-orange-500 px-4 py-3 text-sm font-black text-white hover:bg-orange-600 disabled:opacity-60">
                {saving === 'item' ? '保存中...' : '保存商品'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
