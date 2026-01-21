'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Upload, Loader2, Save, AlertCircle, 
  Users, Package, Clock, User as UserIcon, Check, X, 
  Percent, LayoutDashboard, Gift, Trash2
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
  createdAt: number;
}

interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export default function AdminLotteryPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TierStats[]>([]);
  const [records, setRecords] = useState<LotteryRecord[]>([]);
  const [config, setConfig] = useState<{ enabled: boolean; probabilities: Record<string, number> }>({
    enabled: true,
    probabilities: {}
  });
  
  // 表单状态
  const [probabilities, setProbabilities] = useState<Record<string, number>>({});
  const [savingConfig, setSavingConfig] = useState(false);
  const [selectedTier, setSelectedTier] = useState(TIERS[0].id);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  
  // 消息提示
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // 验证权限
      const userRes = await fetch('/api/auth/me');
      if (!userRes.ok) {
        router.push('/login?redirect=/admin/lottery');
        return;
      }
      const userData = await userRes.json();
      if (!userData.success || !userData.user?.isAdmin) {
        router.push('/');
        return;
      }
      setUser(userData.user);

      // 获取数据
      const dataRes = await fetch('/api/admin/lottery');
      if (dataRes.ok) {
        const data = await dataRes.json();
        if (data.success) {
          setStats(data.tiers || []);
          setRecords(data.records || []);
          setConfig(data.config || { enabled: true, probabilities: {} });
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
      const res = await fetch('/api/admin/lottery/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probabilities, enabled: config.enabled })
      });

      const data = await res.json();
      if (data.success) {
        setSuccess('配置保存成功');
        setConfig(prev => ({ ...prev, probabilities }));
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.message || '保存失败');
      }
    } catch (err) {
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
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.message || '上传失败');
      }
    } catch (err) {
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
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.message || '清空失败');
      }
    } catch (err) {
      setError('请求失败');
    } finally {
      setClearing(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9]">
        <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 glass border-b border-white/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <div className="flex items-center gap-4">
              <Link href="/admin" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors">
                <ArrowLeft className="w-4 h-4" />
                <span className="font-medium text-sm hidden sm:inline">返回后台</span>
              </Link>
              <div className="w-px h-5 bg-stone-300 hidden sm:block" />
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                  <Gift className="w-4 h-4 text-orange-600" />
                </div>
                <span className="text-lg font-bold text-stone-800 tracking-tight">抽奖管理</span>
              </div>
            </div>
            
            {user && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 rounded-full border border-stone-200/50">
                  <UserIcon className="w-4 h-4 text-stone-500" />
                  <span className="font-semibold text-stone-600 text-sm hidden sm:inline">{user.displayName}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-20 space-y-8">
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

        {/* 库存概览 */}
        <section>
          <h2 className="text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-500" />
            库存概览
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {stats.map((stat) => {
              const tierConfig = TIERS.find(t => t.id === stat.id) || TIERS[0];
              const progress = stat.codesCount > 0 ? (stat.usedCount / stat.codesCount) * 100 : 0;
              const isLowStock = stat.available === 0;

              return (
                <div key={stat.id} className={`glass-card p-4 rounded-2xl border ${isLowStock ? 'border-red-200 bg-red-50/30' : 'border-white/60'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className={`text-xs font-bold uppercase ${tierConfig.color}`}>{tierConfig.name}</div>
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
            <span className="text-xs font-bold text-stone-400 bg-stone-100 px-2 py-1 rounded-md">最新 50 条</span>
          </div>

          <div className="glass rounded-3xl overflow-hidden shadow-sm">
            {records.length === 0 ? (
              <div className="p-12 text-center text-stone-400">暂无中奖数据</div>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-stone-50/80 border-b border-stone-200">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-stone-500 uppercase tracking-wide">用户</th>
                      <th className="px-6 py-4 text-xs font-bold text-stone-500 uppercase tracking-wide">奖品</th>
                      <th className="px-6 py-4 text-xs font-bold text-stone-500 uppercase tracking-wide">兑换码</th>
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
                        <td className="px-6 py-4 font-mono text-sm text-stone-500">{record.code}</td>
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
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
