// src/app/games/farm/components/ItemShop.tsx

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FarmShopItem, ActiveBuff } from '@/lib/types/farm-shop';

interface ItemShopProps {
  balance: number;
  activeBuffs: ActiveBuff[];
  inventory: Record<string, number>;
  farmLevel: number;
  onPurchase: (itemId: string) => Promise<boolean>;
  onUseItem: (itemId: string, plotIndex?: number) => Promise<boolean>;
  onClose: () => void;
}

type TabType = 'shop' | 'bag';

function formatDuration(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 1) return `${hours}h`;
  const minutes = ms / (60 * 1000);
  return `${minutes}min`;
}

export default function ItemShop({
  balance,
  activeBuffs,
  inventory,
  farmLevel,
  onPurchase,
  onUseItem,
  onClose,
}: ItemShopProps) {
  const [tab, setTab] = useState<TabType>('shop');
  const [items, setItems] = useState<FarmShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/games/farm/shop');
      const data = await res.json();
      if (data.success) {
        setItems(data.data.items || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handlePurchase = async (itemId: string) => {
    setActionLoading(true);
    setMessage(null);
    try {
      const ok = await onPurchase(itemId);
      if (ok) {
        setMessage({ type: 'success', text: '购买成功！' });
        await fetchItems();
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleUseItem = async (itemId: string) => {
    setActionLoading(true);
    setMessage(null);
    try {
      const ok = await onUseItem(itemId);
      if (ok) {
        setMessage({ type: 'success', text: '使用成功！' });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const now = Date.now();
  const shopItems = items.filter(i => i.enabled);
  const buffItems = shopItems.filter(i => i.mode === 'buff');
  const instantItems = shopItems.filter(i => i.mode === 'instant');
  const itemById = new Map(items.map(item => [item.id, item] as const));

  // 背包：显示所有有库存道具（包括已下架道具）
  const inventoryItems = Object.entries(inventory)
    .filter(([, count]) => count > 0)
    .map(([itemId, count]) => ({
      itemId,
      count,
      item: itemById.get(itemId),
    }));
  const inventoryTotalCount = inventoryItems.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-hidden border border-white/60"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'farmPlotEntrance 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
      >
        {/* 头部 */}
        <div className="bg-gradient-to-r from-violet-500 to-purple-600 text-white px-6 py-4 flex items-center justify-between relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.15),transparent_50%)]" />
          <div className="flex items-center gap-2 relative z-10">
            <span className="text-xl">🏪</span>
            <h3 className="font-bold text-lg">道具商店</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all relative z-10 active:scale-90"
          >
            ✕
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-slate-100">
          <button
            onClick={() => setTab('shop')}
            className={`flex-1 py-3 text-sm font-medium transition-all ${
              tab === 'shop'
                ? 'text-violet-700 border-b-2 border-violet-500 bg-violet-50/50'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            🛒 道具商店
          </button>
          <button
            onClick={() => setTab('bag')}
            className={`flex-1 py-3 text-sm font-medium transition-all relative ${
              tab === 'bag'
                ? 'text-violet-700 border-b-2 border-violet-500 bg-violet-50/50'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            🎒 我的背包
            {inventoryTotalCount > 0 && (
              <span className="absolute top-2 right-[30%] w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {inventoryTotalCount}
              </span>
            )}
          </button>
        </div>

        {/* 余额 */}
        <div className="px-4 py-2 bg-violet-50/80 text-sm text-violet-700 flex items-center gap-1.5 border-b border-violet-100/60">
          <span>⭐</span>
          <span>余额: <b>{balance}</b> 积分</span>
        </div>

        {/* 消息 */}
        {message && (
          <div className={`mx-4 mt-3 px-3 py-2 rounded-lg text-sm text-center ${
            message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.text}
          </div>
        )}

        {/* 内容 */}
        <div className="p-4 overflow-y-auto max-h-[55vh] space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-slate-400 animate-pulse">加载中...</div>
            </div>
          ) : tab === 'shop' ? (
            <>
              {/* Buff 道具 */}
              {buffItems.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Buff 道具（时限生效）</h4>
                  <div className="space-y-2">
                    {buffItems.map((item, index) => {
                      const isActive = activeBuffs.some(b => b.effect === item.effect && b.expiresAt > now);
                      const canAfford = balance >= item.pointsCost;
                      const levelLocked = item.unlockLevel ? farmLevel < item.unlockLevel : false;
                      const disabled = isActive || !canAfford || levelLocked || actionLoading;

                      return (
                        <button
                          key={item.id}
                          onClick={() => !disabled && handlePurchase(item.id)}
                          disabled={disabled}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left
                            ${disabled
                              ? 'opacity-50 cursor-not-allowed border-slate-100 bg-slate-50'
                              : 'border-violet-200/60 bg-violet-50/30 hover:bg-violet-100 hover:border-violet-300 hover:shadow-md active:scale-[0.98]'
                            }`}
                          style={{
                            animation: `farmShopItemSlide 0.4s ease-out both`,
                            animationDelay: `${index * 50 + 100}ms`,
                          }}
                        >
                          <span className="text-2xl drop-shadow-sm">{item.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-800 text-sm">{item.name}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>
                            {item.durationMs && (
                              <div className="text-xs text-violet-500 mt-0.5">⏱ {formatDuration(item.durationMs)}</div>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            {isActive ? (
                              <div className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-full">已激活</div>
                            ) : levelLocked ? (
                              <div className="text-xs text-slate-400">Lv.{item.unlockLevel}</div>
                            ) : (
                              <div className={`text-sm font-bold ${canAfford ? 'text-amber-600' : 'text-red-400'}`}>
                                {item.pointsCost} ⭐
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 即时道具 */}
              {instantItems.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">即时道具（购买后进入背包）</h4>
                  <div className="space-y-2">
                    {instantItems.map((item, index) => {
                      const canAfford = balance >= item.pointsCost;
                      const levelLocked = item.unlockLevel ? farmLevel < item.unlockLevel : false;
                      const disabled = !canAfford || levelLocked || actionLoading;
                      const ownedCount = inventory[item.id] ?? 0;

                      return (
                        <button
                          key={item.id}
                          onClick={() => !disabled && handlePurchase(item.id)}
                          disabled={disabled}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left
                            ${disabled
                              ? 'opacity-50 cursor-not-allowed border-slate-100 bg-slate-50'
                              : 'border-orange-200/60 bg-orange-50/30 hover:bg-orange-100 hover:border-orange-300 hover:shadow-md active:scale-[0.98]'
                            }`}
                          style={{
                            animation: `farmShopItemSlide 0.4s ease-out both`,
                            animationDelay: `${(buffItems.length + index) * 50 + 100}ms`,
                          }}
                        >
                          <span className="text-2xl drop-shadow-sm">{item.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-800 text-sm">
                              {item.name}
                              {ownedCount > 0 && (
                                <span className="ml-1.5 text-xs text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full">
                                  x{ownedCount}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>
                          </div>
                          <div className="text-right shrink-0">
                            {levelLocked ? (
                              <div className="text-xs text-slate-400">Lv.{item.unlockLevel}</div>
                            ) : (
                              <div className={`text-sm font-bold ${canAfford ? 'text-amber-600' : 'text-red-400'}`}>
                                {item.pointsCost} ⭐
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* 背包 Tab */
            <div>
              {inventoryItems.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <div className="text-4xl mb-3">🎒</div>
                  <p>背包是空的</p>
                  <p className="text-xs mt-1">去商店购买即时道具吧</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {inventoryItems.map(({ itemId, count, item }) => {
                    const icon = item?.icon ?? '⚠️';
                    const name = item?.name ?? '失效道具';
                    const description = item?.description ?? '该道具已下架或删除，无法继续使用';
                    const canUse = Boolean(item) && !actionLoading;

                    return (
                      <div
                        key={itemId}
                        className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white"
                      >
                        <span className="text-2xl">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-800 text-sm">
                            {name}
                            <span className="ml-1.5 text-xs text-slate-500">x{count}</span>
                            {item && !item.enabled && (
                              <span className="ml-1.5 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                                已下架
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{description}</div>
                        </div>
                        <button
                          onClick={() => item && handleUseItem(item.id)}
                          disabled={!canUse}
                          className="px-3 py-1.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white text-xs font-medium rounded-lg transition-all disabled:opacity-50 active:scale-95 shadow-sm"
                        >
                          {item ? '使用' : '失效'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
