'use client';

import { useEffect, useRef, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, Loader2, AlertCircle, Users, Package, Clock, User as UserIcon, Check, X, Gift, FileText, Copy } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  description: string;
  maxClaims: number;
  claimedCount: number;
  codesCount: number;
  status: 'active' | 'paused' | 'exhausted';
  createdAt: number;
  createdBy: string;
  rewardType?: 'code' | 'direct';
  directDollars?: number;
}

interface ClaimRecord {
  id: string;
  projectId: string;
  userId: number;
  username: string;
  code: string;
  claimedAt: number;
  directCredit?: boolean;
  creditedDollars?: number;
  creditStatus?: 'pending' | 'success' | 'uncertain';
  creditMessage?: string;
}

export default function AdminProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [records, setRecords] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [appendClaims, setAppendClaims] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setProject(data.project);
          setRecords(data.records || []);
        } else {
          setError(data.message);
        }
      } else {
        setError('项目不存在');
      }
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const scheduleSuccessClear = useCallback(() => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => {
      setSuccess(null);
      successTimeoutRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const handleUploadCodes = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('codes', file);

      const res = await fetch(`/api/admin/projects/${id}`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      
      if (data.success) {
        setSuccess(`成功添加 ${data.codesAdded} 个兑换码`);
        fetchData();
        scheduleSuccessClear();
      } else {
        setError(data.message || '上传失败');
      }
    } catch {
      setError('上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleAppendClaims = async () => {
    const delta = parseInt(appendClaims, 10);
    if (!Number.isFinite(delta) || delta < 1) {
      setError('追加名额必须是正整数（≥1）');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('appendClaims', String(delta));

      const res = await fetch(`/api/admin/projects/${id}`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(`成功追加 ${data.appended ?? delta} 个名额`);
        fetchData();
        scheduleSuccessClear();
      } else {
        setError(data.message || '追加失败');
      }
    } catch {
      setError('追加失败');
    } finally {
      setUploading(false);
    }
  };

  const handleCopyCode = (code: string) => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    // Optional: could add a toast here, but keeping it simple as per requirements to not add new dependencies
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center text-orange-500">
          <Loader2 className="w-10 h-10 animate-spin mx-auto" />
          <p className="mt-4 font-medium text-stone-500">加载项目数据...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center p-6 py-20">
        <div className="glass rounded-3xl p-10 text-center max-w-md w-full shadow-2xl">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-stone-800 mb-2">出错了</h2>
          <p className="text-stone-500 mb-8 text-sm">{error || '找不到该项目'}</p>
          <Link 
            href="/admin" 
            className="inline-flex items-center justify-center w-full px-6 py-3 gradient-warm text-white rounded-xl font-semibold hover:shadow-lg shadow-orange-500/20 transition-all active:scale-95"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回管理后台
          </Link>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, project.maxClaims - project.claimedCount);
  const isDirectProject = project.rewardType === 'direct';

  return (
    <div>
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-800">{project.name}</h1>
      </div>

      {/* 主内容 */}
      <div className="space-y-8">
        {/* 提示消息 */}
        {success && (
          <div className="p-4 bg-emerald-50/80 backdrop-blur-sm rounded-2xl border border-emerald-100 shadow-sm flex justify-between items-center animate-fade-in">
            <div className="flex items-center gap-3 text-emerald-700">
              <div className="p-1.5 bg-emerald-100 rounded-full">
                <Check className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm">{success}</span>
            </div>
            <button onClick={() => setSuccess(null)} className="text-emerald-400 hover:text-emerald-600 p-1 hover:bg-emerald-100 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {error && (
          <div className="p-4 bg-red-50/80 backdrop-blur-sm rounded-2xl border border-red-100 shadow-sm flex justify-between items-center animate-fade-in">
            <div className="flex items-center gap-3 text-red-700">
              <div className="p-1.5 bg-red-100 rounded-full">
                <AlertCircle className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm">{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 p-1 hover:bg-red-100 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 项目信息卡片 */}
        <div className="glass rounded-3xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 bg-gradient-to-br from-orange-100 to-stone-100 rounded-2xl flex items-center justify-center border border-white shadow-sm">
                <Gift className="w-8 h-8 text-orange-500" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl md:text-3xl font-bold text-stone-800 tracking-tight">{project.name}</h1>
                  {isDirectProject && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-orange-50 text-orange-700 border border-orange-200">
                      💰 直充 ${project.directDollars}
                    </span>
                  )}
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    project.status === 'active' 
                      ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                      : project.status === 'paused' 
                        ? 'bg-amber-50 text-amber-600 border border-amber-100' 
                        : 'bg-stone-100 text-stone-500 border border-stone-200'
                  }`}>
                    {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                  </span>
                </div>
                <p className="text-stone-500 mt-2 text-sm md:text-base leading-relaxed max-w-2xl">{project.description || '暂无描述'}</p>
              </div>
            </div>
            
            {isDirectProject ? (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                <input
                  type="number"
                  min="1"
                  value={appendClaims}
                  onChange={(e) => setAppendClaims(e.target.value)}
                  className="w-full sm:w-32 px-4 py-3 bg-white border border-stone-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 font-medium"
                  placeholder="追加名额"
                  disabled={uploading}
                />
                <button
                  type="button"
                  onClick={handleAppendClaims}
                  disabled={uploading}
                  className={`group relative inline-flex items-center justify-center gap-2 px-6 py-3 gradient-warm text-white rounded-xl font-semibold shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 transition-all duration-300 active:scale-95 overflow-hidden ${uploading ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  <Users className={`w-4 h-4 relative z-10 ${uploading ? 'animate-bounce' : ''}`} />
                  <span className="relative z-10 text-sm">{uploading ? '处理中...' : '追加名额'}</span>
                </button>
              </div>
            ) : (
              <label className={`group relative inline-flex items-center justify-center gap-2 px-6 py-3 gradient-warm text-white rounded-xl font-semibold shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 transition-all duration-300 active:scale-95 cursor-pointer overflow-hidden ${uploading ? 'opacity-70 cursor-not-allowed' : ''}`}>
                <Upload className={`w-4 h-4 relative z-10 ${uploading ? 'animate-bounce' : ''}`} />
                <span className="relative z-10 text-sm">{uploading ? '上传中...' : '追加兑换码'}</span>
                <input type="file" accept=".txt" onChange={handleUploadCodes} disabled={uploading} className="hidden" />
              </label>
            )}
          </div>

          {/* 统计网格 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <div className="bg-stone-50/50 rounded-2xl p-5 md:p-6 border border-stone-100 hover:bg-white hover:shadow-sm transition-all">
              <div className="flex items-center gap-2 text-stone-500 mb-2">
                <Users className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wide">已领取</span>
              </div>
              <p className="text-2xl md:text-3xl font-bold text-stone-800">{project.claimedCount}</p>
            </div>
            
            <div className="bg-orange-50/30 rounded-2xl p-5 md:p-6 border border-orange-100/50 hover:bg-orange-50/50 hover:shadow-sm transition-all">
              <div className="flex items-center gap-2 text-orange-600 mb-2">
                <Users className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wide">剩余名额</span>
              </div>
              <p className="text-2xl md:text-3xl font-bold text-orange-600">{remaining}</p>
            </div>
            
            <div className="bg-stone-50/50 rounded-2xl p-5 md:p-6 border border-stone-100 hover:bg-white hover:shadow-sm transition-all">
              <div className="flex items-center gap-2 text-stone-500 mb-2">
                <Package className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wide">库存总量</span>
              </div>
              <p className="text-2xl md:text-3xl font-bold text-stone-800">{project.codesCount}</p>
            </div>
            
            <div className="bg-stone-50/50 rounded-2xl p-5 md:p-6 border border-stone-100 hover:bg-white hover:shadow-sm transition-all">
              <div className="flex items-center gap-2 text-stone-500 mb-2">
                <Clock className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wide">创建时间</span>
              </div>
              <p className="text-sm font-semibold text-stone-800 truncate mt-1">
                {new Date(project.createdAt).toLocaleDateString()}
              </p>
              <p className="text-xs text-stone-400 mt-0.5">
                {new Date(project.createdAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </div>

        {/* 分发记录 - 卡片列表模式 */}
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-stone-200/50 backdrop-blur-md rounded-lg text-stone-600">
                <FileText className="w-5 h-5" />
              </div>
              <h2 className="text-lg md:text-xl font-bold text-stone-800">分发记录</h2>
            </div>
            <span className="px-3 py-1 bg-stone-200/50 backdrop-blur-md rounded-full text-xs font-bold text-stone-600">
              {records.length} 条
            </span>
          </div>

          {records.length === 0 ? (
            <div className="glass rounded-3xl p-12 md:p-20 text-center border-dashed border-2 border-stone-200">
              <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-stone-300" />
              </div>
              <h3 className="text-lg font-bold text-stone-700 mb-1">暂无记录</h3>
              <p className="text-stone-400 text-sm">该项目尚未被领取过</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {records.map((record) => (
                <div 
                  key={record.id} 
                  className="glass-card rounded-2xl p-5 group border border-white/60"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center border border-white shadow-sm">
                        <UserIcon className="w-5 h-5 text-stone-400" />
                      </div>
                      <div>
                        <p className="font-bold text-stone-800 leading-tight text-sm">{record.username}</p>
                        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mt-0.5">
                          ID: {record.userId}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    {record.directCredit ? (
                      <div className="relative bg-stone-50/80 rounded-xl p-4 border border-stone-100 group-hover:border-orange-200 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-stone-400 uppercase tracking-wide">直充金额</span>
                          <span className="text-lg font-extrabold text-stone-800 tabular-nums">${record.creditedDollars}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-center">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                            record.creditStatus === 'uncertain'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}>
                            {record.creditStatus === 'uncertain' ? '待确认' : '已直充'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div 
                        onClick={() => handleCopyCode(record.code)}
                        className="relative bg-stone-50/80 rounded-xl p-3 border border-stone-100 group-hover:border-orange-200 transition-colors cursor-pointer active:scale-[0.98]"
                        title="点击复制"
                      >
                        <p className="font-mono text-sm text-stone-700 break-all text-center font-semibold group-hover:text-orange-600 transition-colors">
                          {record.code}
                        </p>
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Copy className="w-3 h-3 text-stone-400" />
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-1.5 text-xs text-stone-400 border-t border-stone-100 pt-3">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(record.claimedAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

