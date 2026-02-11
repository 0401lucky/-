'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, Loader2, Save, AlertCircle,
  Users, Package, Clock, Check, X,
  Percent, LayoutDashboard, Gift, Trash2, RefreshCw, Eye
} from 'lucide-react';

// 档位定义
const TIERS = [
  { id: 'tier_1', name: '1刀福利', color: 'text-amber-500', bg: 'bg-amber-50' },
  { id: 'tier_3', name: '3刀福利', color: 'text-orange-400', bg: 'bg-orange-50' },
  { id: 'tier_5', name: '5刀福利', color: 'text-orange-500', bg: 'bg-orange-100' },
  { id: 'tier_10', name: '10刀福利', color: 'text-orange-600', bg: 'bg-orange-200' },
  { id: 'tier_15', name: '15刀福利', color: 'text-red-500', bg: 'bg-red-50' },
  { id: 'tier_20', name: '20刀福利', color: 'text-red-600', bg: 'bg-red-100' },
];

interface TierStats {
  id: string;
  name: string;
  value: number;
  probability: number;
  color: string;
  codesCount: number;
  usedCount: number;
  available: number;
}

interface LotteryRecord {
  id: string;
  username: string;
  oderId: string;
  tierName: string;
  tierValue: number;
  code: string;
  directCredit?: boolean;
  createdAt: number;
}

interface LotteryConfigState {
  enabled: boolean;
  mode: 'code' | 'direct' | 'hybrid';
  dailyDirectLimit: number;
  probabilities: Record<string, number>;
}

export default function AdminLotteryPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TierStats[]>([]);
  const [records, setRecords] = useState<LotteryRecord[]>([]);
  const [config, setConfig] = useState<LotteryConfigState>({
    enabled: true,
    mode: 'direct',
    dailyDirectLimit: 2000,
    probabilities: {}
  });
  
  // 今日已发放额度
  const [todayDirect, setTodayDirect] = useState(0);
  
  // 概率映射表
  const [probabilityMap, setProbabilityMap] = useState<Record<string, number>>({});
  
  // 分页状态
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  
  // 表单状态
  const [probabilities, setProbabilities] = useState<Record<string, number>>({});
  const [savingConfig, setSavingConfig] = useState(false);
  const [selectedTier, setSelectedTier] = useState(TIERS[0].id);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  
  // 兑换码详情弹窗
  const [detailTier, setDetailTier] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<{
    tierId: string;
    total: number;
    usedCount: number;
    availableCount: number;
    used: string[];
    available: string[];
  } | null>(null);
  
  // 消息提示
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSuccessClear = useCallback(() => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => {
      setSuccess(null);
      successTimeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      // 获取数据（重置分页）
        const dataRes = await fetch('/api/admin/lottery?page=1&limit=50');
        if (dataRes.ok) {
          const data = await dataRes.json();
          if (data.success) {
            setStats(data.tiers || []);
            setRecords(data.records || []);
            setProbabilityMap(data.probabilityMap || {});
            setPage(1);
            setHasMore(data.pagination?.hasMore ?? false);
            // 处理配置数据（注意 0 是有效值，不应被覆盖）
            const configData = data.config || {};
            setConfig({
              enabled: configData.enabled ?? true,
              mode: configData.mode || 'direct',
              dailyDirectLimit: typeof configData.dailyDirectLimit === 'number' 
                ? configData.dailyDirectLimit 
                : 2000,
              probabilities: {}
            });
            setTodayDirect(data.todayDirectTotal || 0);
            // 从 tiers 数组构建 probabilities 对象
            const probs: Record<string, number> = {};
            (data.tiers || []).forEach((tier: TierStats) => {
              probs[tier.id] = tier.probability;
            });
            setProbabilities(probs);
          }
        }
    } catch (err) {
      console.error('Fetch error:', err);
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // 加载更多记录
  const loadMoreRecords = async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await fetch(`/api/admin/lottery?page=${nextPage}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.records?.length > 0) {
          setRecords(prev => [...prev, ...data.records]);
          setPage(nextPage);
          setHasMore(data.pagination?.hasMore ?? false);
        } else {
          setHasMore(false);
        }
      }
    } catch (err) {
      console.error('Load more error:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleProbabilityChange = (id: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setProbabilities(prev => ({ ...prev, [id]: num }));
    }
  };

  const handleSaveConfig = async () => {
    // 验证总和是否为100%
    const total = Object.values(probabilities).reduce((sum, val) => sum + val, 0);
    if (Math.abs(total - 100) > 0.01) {
      setError(`概率总和必须为100%，当前为 ${total.toFixed(2)}%`);
      return;
    }

    setSavingConfig(true);
    setError(null);
    setSuccess(null);

    try {
      // 将 probabilities 对象转换为后端期望的 tiers 数组格式
      const tiersArray = Object.entries(probabilities).map(([id, probability]) => ({
        id,
        probability
      }));
      
      const res = await fetch('/api/admin/lottery/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tiers: tiersArray, 
          enabled: config.enabled,
          mode: config.mode,
          dailyDirectLimit: config.dailyDirectLimit
        })
      });

      const data = await res.json();
      if (data.success) {
        setSuccess('配置保存成功');
        scheduleSuccessClear();
      } else {
        setError(data.message || '保存失败');
      }
    } catch {
      setError('网络请求失败');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('codes', uploadFile);

      const res = await fetch(`/api/admin/lottery/tiers/${selectedTier}/codes`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (data.success) {
        setSuccess(`成功上传 ${data.addedCount} 个兑换码`);
        setUploadFile(null);
        // 刷新数据
        fetchData();
        scheduleSuccessClear();
      } else {
        setError(data.message || '上传失败');
      }
    } catch {
      setError('上传请求失败');
    } finally {
      setUploading(false);
    }
  };

  const handleClearTier = async (tierId: string) => {
    const tierName = TIERS.find(t => t.id === tierId)?.name || tierId;
    if (!confirm(`确定要清空【${tierName}】的所有库存吗？此操作不可恢复！`)) {
      return;
    }

    setClearing(tierId);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/admin/lottery/tiers/${tierId}/codes`, {
        method: 'DELETE'
      });

      const data = await res.json();
      if (data.success) {
        setSuccess(`已清空【${tierName}】的 ${data.cleared} 个兑换码`);
        fetchData();
        scheduleSuccessClear();
      } else {
        setError(data.message || '清空失败');
      }
    } catch {
      setError('请求失败');
    } finally {
      setClearing(null);
    }
  };

  const handleRecalculate = async () => {
    if (!confirm('确定要重新统计吗？\n\n此操作会：\n1. 扫描所有已发放记录\n2. 根据兑换码检索真实所属档位\n3. 更新各档位的已使用计数\n\n可能需要一些时间，请耐心等待。')) {
      return;
    }

    setRecalculating(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/admin/lottery/recalculate', {
        method: 'POST'
      });

      const data = await res.json();
      if (data.success) {
        setSuccess(`重新统计完成！处理 ${data.processed} 条记录，发现 ${data.corrected} 条档位不匹配`);
        scheduleSuccessClear();
        if (data.details && data.details.length > 0) {
          console.log('档位不匹配详情:', data.details);
          alert(`发现 ${data.corrected} 条档位不匹配的记录，详情已打印到控制台。\n\n示例：\n${data.details.slice(0, 3).map((d: {code: string; recorded: string; actual: string}) => `码 ${d.code.substring(0, 8)}... 记录为 ${d.recorded}，实际为 ${d.actual}`).join('\n')}`);
        }
        fetchData();
      } else {
        setError(data.message || '重新统计失败');
      }
    } catch {
      setError('请求失败');
    } finally {
      setRecalculating(false);
    }
  };

  const handleViewDetail = async (tierId: string) => {
    setDetailTier(tierId);
    setDetailLoading(true);
    setDetailData(null);

    try {
      const res = await fetch(`/api/admin/lottery/tiers/${tierId}/detail`);
      const data = await res.json();
      if (data.success) {
        setDetailData(data);
      } else {
        setError(data.message || '获取详情失败');
        setDetailTier(null);
      }
    } catch {
      setError('请求失败');
      setDetailTier(null);
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-8">
        {/* 提示区 */}
        {error && (
          <div className="p-4 bg-red-50/80 backdrop-blur-sm rounded-2xl border border-red-100 flex items-center gap-3 text-red-600 animate-fade-in">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium text-sm">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}
        {success && (
          <div className="p-4 bg-emerald-50/80 backdrop-blur-sm rounded-2xl border border-emerald-100 flex items-center gap-3 text-emerald-600 animate-fade-in">
            <Check className="w-5 h-5" />
            <span className="font-medium text-sm">{success}</span>
            <button onClick={() => setSuccess(null)} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* 发放模式配置 */}
        <section className="glass rounded-3xl p-6 md:p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5 text-orange-500" />
              发放模式
            </h2>
            {config.mode === 'direct' && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-stone-500">今日已发放:</span>
                <span className={`font-bold ${todayDirect >= config.dailyDirectLimit ? 'text-red-500' : 'text-green-600'}`}>
                  ${todayDirect}
                </span>
                <span className="text-stone-400">/</span>
                <span className="text-stone-500">${config.dailyDirectLimit}</span>
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* 兑换码模式 */}
            <button
              onClick={() => setConfig(prev => ({ ...prev, mode: 'code' }))}
              className={`p-4 rounded-2xl border-2 transition-all text-left ${
                config.mode === 'code' 
                  ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-100' 
                  : 'border-stone-200 bg-white hover:border-stone-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Package className={`w-5 h-5 ${config.mode === 'code' ? 'text-orange-500' : 'text-stone-400'}`} />
                <span className={`font-bold ${config.mode === 'code' ? 'text-orange-600' : 'text-stone-700'}`}>
                  兑换码模式
                </span>
              </div>
              <p className="text-xs text-stone-500">
                抽中后发放预设的兑换码，用户需手动兑换
              </p>
            </button>
            
            {/* 直充模式 */}
            <button
              onClick={() => setConfig(prev => ({ ...prev, mode: 'direct' }))}
              className={`p-4 rounded-2xl border-2 transition-all text-left ${
                config.mode === 'direct' 
                  ? 'border-green-500 bg-green-50 ring-2 ring-green-100' 
                  : 'border-stone-200 bg-white hover:border-stone-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Gift className={`w-5 h-5 ${config.mode === 'direct' ? 'text-green-500' : 'text-stone-400'}`} />
                <span className={`font-bold ${config.mode === 'direct' ? 'text-green-600' : 'text-stone-700'}`}>
                  直充模式
                </span>
                <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full font-bold">推荐</span>
              </div>
              <p className="text-xs text-stone-500">
                抽中后直接充值到用户账户，无需兑换码
              </p>
            </button>
            
            {/* 混合模式 */}
            <button
              onClick={() => setConfig(prev => ({ ...prev, mode: 'hybrid' }))}
              className={`p-4 rounded-2xl border-2 transition-all text-left ${
                config.mode === 'hybrid' 
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' 
                  : 'border-stone-200 bg-white hover:border-stone-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <RefreshCw className={`w-5 h-5 ${config.mode === 'hybrid' ? 'text-blue-500' : 'text-stone-400'}`} />
                <span className={`font-bold ${config.mode === 'hybrid' ? 'text-blue-600' : 'text-stone-700'}`}>
                  混合模式
                </span>
              </div>
              <p className="text-xs text-stone-500">
                优先直充，失败时降级为兑换码
              </p>
            </button>
          </div>
          
          {/* 每日直充上限配置 */}
          {(config.mode === 'direct' || config.mode === 'hybrid') && (
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-center gap-4">
                <label className="text-sm font-bold text-stone-600 whitespace-nowrap">
                  每日直充上限
                </label>
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-2.5 text-stone-400">$</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={config.dailyDirectLimit}
                    onChange={(e) => setConfig(prev => ({ 
                      ...prev, 
                      dailyDirectLimit: Math.max(0, parseInt(e.target.value) || 0) 
                    }))}
                    className="w-full pl-7 pr-4 py-2 bg-white border border-stone-200 rounded-xl focus:border-orange-500 focus:ring-2 focus:ring-orange-100 outline-none text-stone-800 font-mono"
                  />
                </div>
                <p className="text-xs text-stone-400 hidden md:block">
                  积分商店兑换不受此限制
                </p>
              </div>
            </div>
          )}
        </section>

        {/* 库存概览 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
              <Package className="w-5 h-5 text-orange-500" />
              库存概览
            </h2>
            <button
              onClick={handleRecalculate}
              disabled={recalculating}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
            >
              {recalculating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              重新统计
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {stats.map((stat) => {
              const tierConfig = TIERS.find(t => t.id === stat.id) || TIERS[0];
              const progress = stat.codesCount > 0 ? (stat.usedCount / stat.codesCount) * 100 : 0;
              const isLowStock = stat.available === 0;

              return (
                <div key={stat.id} className={`glass-card p-4 rounded-2xl border ${isLowStock ? 'border-red-200 bg-red-50/30' : 'border-white/60'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className={`text-xs font-bold uppercase ${tierConfig.color}`}>{tierConfig.name}</div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleViewDetail(stat.id)}
                        className="p-1 text-stone-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
                        title="查看兑换码"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {stat.available > 0 && (
                        <button
                          onClick={() => handleClearTier(stat.id)}
                          disabled={clearing === stat.id}
                          className="p-1 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="清空库存"
                        >
                          {clearing === stat.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-stone-800 mb-1">{stat.available}</div>
                  <div className="text-xs text-stone-400 mb-3">可用 / 总量 {stat.codesCount}</div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${isLowStock ? 'bg-red-500' : 'bg-orange-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 概率配置 */}
          <section className="glass rounded-3xl p-6 md:p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                <Percent className="w-5 h-5 text-orange-500" />
                概率配置
              </h2>
              <button 
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white rounded-xl text-sm font-bold hover:bg-stone-700 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                保存
              </button>
            </div>
            
            <div className="space-y-4">
              {TIERS.map((tier) => (
                <div key={tier.id} className="flex items-center gap-4">
                  <span className={`w-24 text-sm font-bold ${tier.color}`}>{tier.name}</span>
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={probabilities[tier.id] || 0}
                      onChange={(e) => handleProbabilityChange(tier.id, e.target.value)}
                      className="w-full px-4 py-2 bg-white/50 border border-stone-200 rounded-xl focus:border-orange-500 focus:ring-2 focus:ring-orange-100 outline-none text-stone-800 font-mono"
                    />
                    <span className="absolute right-3 top-2.5 text-stone-400 text-sm">%</span>
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t border-stone-100 flex justify-between items-center">
                <span className="text-sm font-bold text-stone-500">总计</span>
                <span className={`text-lg font-bold font-mono ${
                  Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 100) < 0.01 
                    ? 'text-emerald-500' 
                    : 'text-red-500'
                }`}>
                  {Object.values(probabilities).reduce((a, b) => a + b, 0).toFixed(2)}%
                </span>
              </div>
            </div>
          </section>

          {/* 上传兑换码 */}
          <section className="glass rounded-3xl p-6 md:p-8">
            <h2 className="text-lg font-bold text-stone-800 mb-6 flex items-center gap-2">
              <Upload className="w-5 h-5 text-orange-500" />
              上传库存
            </h2>
            
            <form onSubmit={handleUpload} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">选择档位</label>
                <div className="grid grid-cols-3 gap-2">
                  {TIERS.map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setSelectedTier(tier.id)}
                      className={`py-2 px-3 rounded-xl text-sm font-bold border transition-all ${
                        selectedTier === tier.id
                          ? `bg-white border-orange-500 text-orange-600 shadow-sm ring-2 ring-orange-100`
                          : 'bg-stone-50 border-stone-200 text-stone-500 hover:bg-white'
                      }`}
                    >
                      {tier.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">上传文件</label>
                <div className="group relative border-2 border-dashed border-stone-200 hover:border-orange-400 rounded-2xl p-8 transition-colors bg-stone-50/50 hover:bg-orange-50/30 text-center">
                  <input
                    type="file"
                    accept=".txt"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className="w-12 h-12 bg-white rounded-full shadow-sm border border-stone-100 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                    <Upload className="w-5 h-5 text-orange-500" />
                  </div>
                  <p className="text-sm font-medium text-stone-600">
                    {uploadFile ? (
                      <span className="text-orange-600 font-bold">{uploadFile.name}</span>
                    ) : (
                      <>点击选择 <span className="text-stone-900 font-bold">.txt</span> 文件</>
                    )}
                  </p>
                  <p className="text-xs text-stone-400 mt-1">每行一个兑换码</p>
                </div>
              </div>

              <button
                type="submit"
                disabled={!uploadFile || uploading}
                className="w-full py-3 gradient-warm text-white rounded-xl font-bold shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {uploading ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> 上传中...</span> : '确认上传'}
              </button>
            </form>
          </section>
        </div>

        {/* 中奖记录 */}
        <section>
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
              <Users className="w-5 h-5 text-orange-500" />
              近期中奖记录
            </h2>
            <span className="text-xs font-bold text-stone-400 bg-stone-100 px-2 py-1 rounded-md">已加载 {records.length} 条</span>
          </div>

          <div className="glass rounded-3xl overflow-hidden shadow-sm">
            {records.length === 0 ? (
              <div className="p-12 text-center text-stone-400">暂无中奖数据</div>
            ) : (
              <div className="w-full overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="bg-stone-50/80 border-b border-stone-200 sticky top-0">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-stone-500 uppercase tracking-wide">用户</th>
                      <th className="px-6 py-4 text-xs font-bold text-stone-500 uppercase tracking-wide">奖品</th>
                      <th className="px-6 py-4 text-xs font-bold text-stone-500 uppercase tracking-wide">概率</th>
                      <th className="px-6 py-4 text-xs font-bold text-stone-500 uppercase tracking-wide">发放方式</th>
                      <th className="px-6 py-4 text-xs font-bold text-stone-500 uppercase tracking-wide">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {records.map((record) => (
                      <tr key={record.id} className="hover:bg-orange-50/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-stone-700 text-sm">{record.username}</div>
                          <div className="text-[10px] text-stone-400">ID: {record.oderId}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-bold bg-stone-100 text-stone-600">
                            {record.tierName}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-bold ${
                            (probabilityMap[record.tierName] || 0) <= 1 
                              ? 'bg-red-100 text-red-600' 
                              : (probabilityMap[record.tierName] || 0) <= 5 
                                ? 'bg-orange-100 text-orange-600'
                                : 'bg-stone-100 text-stone-600'
                          }`}>
                            {probabilityMap[record.tierName] !== undefined 
                              ? `${probabilityMap[record.tierName]}%` 
                              : '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {record.directCredit ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold bg-green-100 text-green-700">
                              <Check className="w-3 h-3" />
                              已直充
                            </span>
                          ) : (
                            <code className="font-mono text-sm text-stone-500">{record.code}</code>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-stone-400">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(record.createdAt).toLocaleString()}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {/* 加载更多按钮 */}
                {hasMore && (
                  <div className="p-4 text-center border-t border-stone-100">
                    <button
                      onClick={loadMoreRecords}
                      disabled={loadingMore}
                      className="px-6 py-2 bg-orange-500 text-white rounded-lg font-bold text-sm hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {loadingMore ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          加载中...
                        </span>
                      ) : (
                        '加载更多'
                      )}
                    </button>
                  </div>
                )}
                
                {!hasMore && records.length > 0 && (
                  <div className="p-4 text-center text-stone-400 text-sm border-t border-stone-100">
                    已加载全部记录
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 兑换码详情弹窗 */}
      {detailTier && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDetailTier(null)}>
          <div 
            className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-stone-800">
                {TIERS.find(t => t.id === detailTier)?.name || detailTier} - 兑换码详情
              </h3>
              <button
                onClick={() => setDetailTier(null)}
                className="p-2 hover:bg-stone-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-stone-500" />
              </button>
            </div>
            
            {detailLoading ? (
              <div className="p-12 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
              </div>
            ) : detailData ? (
              <div className="p-6">
                <div className="flex gap-4 mb-4">
                  <div className="flex-1 p-3 bg-green-50 rounded-xl text-center">
                    <div className="text-2xl font-bold text-green-600">{detailData.availableCount}</div>
                    <div className="text-xs text-green-500 font-medium">可用</div>
                  </div>
                  <div className="flex-1 p-3 bg-stone-100 rounded-xl text-center">
                    <div className="text-2xl font-bold text-stone-600">{detailData.usedCount}</div>
                    <div className="text-xs text-stone-500 font-medium">已使用</div>
                  </div>
                  <div className="flex-1 p-3 bg-orange-50 rounded-xl text-center">
                    <div className="text-2xl font-bold text-orange-600">{detailData.total}</div>
                    <div className="text-xs text-orange-500 font-medium">总计</div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 max-h-[50vh] overflow-auto">
                  {/* 可用的码 */}
                  <div>
                    <h4 className="text-sm font-bold text-green-600 mb-2 sticky top-0 bg-white py-1">
                      ✓ 可用 ({detailData.availableCount})
                    </h4>
                    <div className="space-y-1">
                      {detailData.available.length === 0 ? (
                        <p className="text-sm text-stone-400 italic">无可用兑换码</p>
                      ) : (
                        detailData.available.map((code, i) => (
                          <div key={i} className="text-xs font-mono bg-green-50 text-green-700 px-2 py-1 rounded break-all">
                            {code}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  
                  {/* 已使用的码 */}
                  <div>
                    <h4 className="text-sm font-bold text-stone-500 mb-2 sticky top-0 bg-white py-1">
                      ✗ 已使用 ({detailData.usedCount})
                    </h4>
                    <div className="space-y-1">
                      {detailData.used.length === 0 ? (
                        <p className="text-sm text-stone-400 italic">无已使用兑换码</p>
                      ) : (
                        detailData.used.map((code, i) => (
                          <div key={i} className="text-xs font-mono bg-stone-100 text-stone-500 px-2 py-1 rounded break-all line-through">
                            {code}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-stone-500">加载失败</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}




