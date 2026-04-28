'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Album } from 'lucide-react';

interface StoreItem {
  id: string;
  name: string;
  description: string;
  type: 'lottery_spin' | 'quota_direct' | 'card_draw';
  pointsCost: number;
  value: number;
  dailyLimit?: number;
}

interface ExchangeLog {
  id: string;
  itemName: string;
  pointsCost: number;
  createdAt: number;
}

function StoreContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromCards = searchParams.get('from') === 'cards';
  const [items, setItems] = useState<StoreItem[]>([]);
  const [balance, setBalance] = useState(0);
  const [recentExchanges, setRecentExchanges] = useState<ExchangeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [exchanging, setExchanging] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [quantityItem, setQuantityItem] = useState<StoreItem | null>(null);
  const [quantity, setQuantity] = useState(1);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/store');
      const data = await res.json();
      if (data.success) {
        setItems(data.data.items || []);
        setBalance(data.data.balance);
        setRecentExchanges(data.data.recentExchanges);
      }
    } catch (err) {
      console.error('Fetch store data error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExchange = async (itemId: string, qty: number = 1) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const quantitySafe = Number.isSafeInteger(qty) ? qty : Math.floor(Number(qty));
    const quantityValue = Number.isFinite(quantitySafe) ? Math.max(1, quantitySafe) : 1;
    const totalCost = item.pointsCost * quantityValue;

    if (balance < totalCost) {
      setMessage({ type: 'error', text: '积分不足' });
      return;
    }

    setExchanging(itemId);
    setMessage(null);

    try {
      const res = await fetch('/api/store/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, quantity: quantityValue }),
      });
      const data = await res.json();

      if (data.success) {
        const drawsAvailable = data.data?.drawsAvailable;
        const successText = typeof drawsAvailable === 'number'
          ? `${data.message || '兑换成功！'}，当前剩余 ${drawsAvailable} 次卡牌抽卡`
          : data.message || '兑换成功！';
        setMessage({ type: 'success', text: successText });
        setBalance(data.data?.newBalance ?? balance);
        setQuantityItem(null);
        setQuantity(1);
        // 刷新数据
        fetchData();
      } else {
        setMessage({ type: 'error', text: data.message || data.error || '兑换失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    } finally {
      setExchanging(null);
    }
  };

  const isUnlimitedItem = (item: StoreItem) => (item.dailyLimit ?? 0) <= 0;

  const openQuantitySelector = (item: StoreItem) => {
    if (balance < item.pointsCost) return;
    setQuantityItem(item);
    setQuantity(1);
  };

  useEffect(() => {
    if (!quantityItem) return;
    const maxAffordable = Math.max(1, Math.floor(balance / quantityItem.pointsCost));
    setQuantity((q) => Math.min(Math.max(1, q), maxAffordable));
  }, [balance, quantityItem]);

  const getItemIcon = (type: string) => {
    if (type === 'card_draw') return <Album className="w-8 h-8 text-blue-500" />;
    return type === 'lottery_spin' ? '🎟️' : '💰';
  };

  const getItemStyles = (type: string) => {
    switch (type) {
      case 'lottery_spin':
        return {
          bg: 'bg-gradient-to-r from-purple-50 to-pink-50',
          badge: 'bg-purple-100 text-purple-700',
          label: '抽奖'
        };
      case 'card_draw':
        return {
          bg: 'bg-gradient-to-r from-blue-50 to-indigo-50',
          badge: 'bg-blue-100 text-blue-700',
          label: '卡牌'
        };
      default:
        return {
          bg: 'bg-gradient-to-r from-green-50 to-teal-50',
          badge: 'bg-green-100 text-green-700',
          label: '直充'
        };
    }
  };

  const maxAffordableQuantity = quantityItem
    ? Math.max(1, Math.floor(balance / quantityItem.pointsCost))
    : 1;
  const clampedQuantity = quantityItem
    ? Math.min(Math.max(1, quantity), maxAffordableQuantity)
    : 1;
  const totalCost = quantityItem ? quantityItem.pointsCost * clampedQuantity : 0;
  const canAffordTotal = quantityItem ? balance >= totalCost : false;
  const isExchangingQuantityItem = quantityItem ? exchanging === quantityItem.id : false;

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-12">
          <button
            onClick={() => router.push(fromCards ? '/cards' : '/games')}
            className="group flex items-center text-slate-500 hover:text-slate-800 transition-colors font-medium"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span>
            {fromCards ? '返回集卡' : '游戏中心'}
          </button>
          
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200">
             <span className="text-yellow-500">⭐</span>
             <span className="font-bold text-slate-900">{loading ? '...' : balance}</span>
          </div>
        </div>

        <div className="text-center mb-16">
          <h1 className="text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">
            积分商店
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            使用您的游戏积分兑换超值奖励。
          </p>
        </div>

        {/* 消息提示 */}
        {message && (
          <div className={`mb-8 p-4 rounded-xl text-center shadow-sm border ${
            message.type === 'success' 
              ? 'bg-green-50 border-green-200 text-green-700' 
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {message.text}
          </div>
        )}

        {/* 积分余额展示区 */}
        <div className="bg-white rounded-2xl p-8 mb-12 shadow-sm border border-slate-100 flex items-center justify-between relative overflow-hidden">
           <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-yellow-50 to-transparent pointer-events-none"></div>
           <div>
              <p className="text-slate-500 font-medium mb-1">当前可用积分余额</p>
              <h2 className="text-5xl font-extrabold text-slate-900 tracking-tight">{balance}</h2>
           </div>
           <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center text-4xl shadow-inner text-yellow-500 z-10">
             ⭐
           </div>
        </div>

        {/* 商品列表 */}
        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
            <p className="text-slate-400">正在加载商品...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
            {items.map((item) => {
              const canAfford = balance >= item.pointsCost;
              const isExchanging = exchanging === item.id;
              const styles = getItemStyles(item.type);
              const unlimited = isUnlimitedItem(item);

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col h-full"
                >
                  {/* 商品头部 */}
                  <div className={`h-32 ${styles.bg} p-6 flex items-center gap-6 relative overflow-hidden`}>
                    <div className="absolute right-[-20px] top-[-20px] w-32 h-32 rounded-full bg-white opacity-20 transform rotate-45"></div>
                    
                    <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-3xl shadow-sm bg-white`}>
                       {getItemIcon(item.type)}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900 mb-1">{item.name}</h3>
                      <div className="flex gap-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${styles.badge}`}>
                           {styles.label}
                        </span>
                        {item.dailyLimit && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                限购 {item.dailyLimit}
                            </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 商品信息与操作 */}
                  <div className="p-6 flex flex-col flex-1">
                    <p className="text-slate-500 text-sm mb-6 flex-1 leading-relaxed">
                        {item.description}
                    </p>

                    <div className="flex items-center justify-between mt-auto pt-6 border-t border-slate-100">
                      <div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-0.5">价格</div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-bold text-slate-900">{item.pointsCost}</span>
                            <span className="text-sm text-slate-500 font-medium">积分</span>
                        </div>
                      </div>

                      <button
                        onClick={() => (unlimited ? openQuantitySelector(item) : handleExchange(item.id))}
                        disabled={!canAfford || isExchanging}
                        className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-all shadow-sm ${
                          canAfford && !isExchanging
                            ? 'bg-slate-900 text-white hover:bg-slate-800 hover:shadow-md hover:-translate-y-0.5'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {isExchanging ? (
                            <span className="flex items-center gap-2">
                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                兑换中
                            </span>
                        ) : canAfford ? (unlimited ? '选择数量' : '立即兑换') : '积分不足'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 不限购商品：选择数量弹窗 */}
        {quantityItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => (isExchangingQuantityItem ? null : setQuantityItem(null))}
            />
            <div className="relative w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
              <div className="p-6">
                <h3 className="text-lg font-bold text-slate-900">选择兑换数量</h3>
                <p className="text-sm text-slate-500 mt-1">{quantityItem.name}</p>

                <div className="mt-6 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    disabled={isExchangingQuantityItem || clampedQuantity <= 1}
                    className="w-10 h-10 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    −
                  </button>

                  <input
                    type="number"
                    min={1}
                    max={maxAffordableQuantity}
                    value={clampedQuantity}
                    onChange={(e) => {
                      const n = Math.floor(Number(e.target.value));
                      if (!Number.isFinite(n)) return;
                      setQuantity(Math.min(Math.max(1, n), maxAffordableQuantity));
                    }}
                    className="flex-1 h-10 rounded-lg border border-slate-200 px-3 text-center font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />

                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.min(maxAffordableQuantity, q + 1))}
                    disabled={isExchangingQuantityItem || clampedQuantity >= maxAffordableQuantity}
                    className="w-10 h-10 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-slate-500">总价</span>
                  <span className="font-bold text-slate-900">{totalCost} 积分</span>
                </div>

                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setQuantityItem(null)}
                    disabled={isExchangingQuantityItem}
                    className="flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExchange(quantityItem.id, clampedQuantity)}
                    disabled={!canAffordTotal || isExchangingQuantityItem}
                    className={`flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm transition-all shadow-sm ${
                      canAffordTotal && !isExchangingQuantityItem
                        ? 'bg-slate-900 text-white hover:bg-slate-800 hover:shadow-md'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {isExchangingQuantityItem ? '兑换中...' : '确认兑换'}
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-400">
                  最多可兑换 {maxAffordableQuantity} 份（以当前积分余额计算）
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 最近兑换记录 */}
        {recentExchanges.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">最近兑换记录</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {recentExchanges.slice(0, 5).map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 transition-colors"
                >
                  <span className="text-slate-700 font-medium">{log.itemName}</span>
                  <div className="flex items-center gap-6">
                    <span className="text-red-500 font-mono font-bold">-{log.pointsCost}</span>
                    <span className="text-slate-400 text-xs">
                      {new Date(log.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 说明 */}
        <div className="mt-12 text-center text-slate-400 text-xs">
          <p>积分可通过游戏获得，每日上限 1000 积分 • 如有问题请联系管理员</p>
        </div>
      </div>
    </div>
  );
}

export default function StorePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin"></div>
      </div>
    }>
      <StoreContent />
    </Suspense>
  );
}
