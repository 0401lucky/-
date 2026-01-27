'use client';

import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Copy, Check, Package, AlertCircle, LogOut, User as UserIcon, Gift, Sparkles } from 'lucide-react';

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
  newUserOnly?: boolean;
}

interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

interface ClaimedInfo {
  code: string;
  claimedAt: number;
  directCredit?: boolean;
  creditedDollars?: number;
  creditStatus?: 'pending' | 'success' | 'uncertain';
  creditMessage?: string;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [claimedInfo, setClaimedInfo] = useState<ClaimedInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [projectRes, userRes] = await Promise.all([
        fetch(`/api/projects/${id}`),
        fetch('/api/auth/me')
      ]);

      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData.success) {
          setUser(userData.user);
        }
      }

      if (projectRes.ok) {
        const projectData = await projectRes.json();
        if (projectData.success) {
          setProject(projectData.project);
          setClaimedInfo(projectData.claimed);
        } else {
          setError(projectData.message || '获取项目信息失败');
        }
      } else {
        setError('项目不存在或已被删除');
      }
    } catch {
      setError('网络请求失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleClaim = async () => {
    if (!user) {
      router.push(`/login?redirect=/project/${id}`);
      return;
    }

    try {
      setClaiming(true);
      setError(null);
      
      const res = await fetch(`/api/projects/${id}`, {
        method: 'POST',
      });

      const data = await res.json();
      
      if (data.success) {
        setClaimedInfo({
          code: data.code || '',
          claimedAt: Date.now(),
          directCredit: data.directCredit,
          creditedDollars: data.creditedDollars,
          creditStatus: data.creditStatus,
          creditMessage: data.message,
        });
        void fetchData();
      } else {
        setError(data.message || '领取失败');
      }
    } catch {
      setError('领取请求失败，请稍后重试');
    } finally {
      setClaiming(false);
    }
  };

  const handleCopy = () => {
    if (claimedInfo?.code) {
      navigator.clipboard.writeText(claimedInfo.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.refresh();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafaf9]">
        <Loader2 className="w-10 h-10 animate-spin mb-4 text-orange-500" />
        <p className="text-sm font-medium text-stone-500">加载中...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9] p-6">
        <div className="glass rounded-3xl p-10 text-center max-w-md w-full shadow-2xl">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-stone-800 mb-2">出错了</h2>
          <p className="text-stone-500 mb-6 text-sm">{error || '找不到该项目'}</p>
          <Link 
            href="/" 
            className="inline-flex items-center justify-center px-7 py-3 gradient-warm text-white rounded-xl font-semibold w-full hover:shadow-lg shadow-orange-500/20 transition-all active:scale-95"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const isPaused = project.status === 'paused';
  const isSoldOut = project.status === 'exhausted' || project.claimedCount >= project.maxClaims;
  const canClaim = !isPaused && !isSoldOut && !claimedInfo && user;
  const remaining = Math.max(0, project.maxClaims - project.claimedCount);
  const progress = Math.min(100, (project.claimedCount / project.maxClaims) * 100);
  const isDirectProject = project.rewardType === 'direct';

  return (
    <div className="min-h-screen bg-[#fafaf9] relative overflow-hidden">
      {/* 装饰背景 */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-orange-100/40 rounded-full blur-3xl -z-10 translate-x-1/3 -translate-y-1/3"></div>
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-stone-200/40 rounded-full blur-3xl -z-10 -translate-x-1/3 translate-y-1/3"></div>

      {/* 导航栏 */}
      <nav className="glass sticky top-0 z-50 shadow-sm/50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors group">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              <span className="font-medium text-sm">首页</span>
            </Link>
            
            {user && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/60 rounded-full border border-white/50 shadow-sm">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-100 to-stone-100 flex items-center justify-center border border-white">
                    <UserIcon className="w-3 h-3 text-stone-500" />
                  </div>
                  <span className="font-semibold text-stone-600 text-sm hidden sm:block truncate max-w-[120px]">
                    {user.displayName}
                  </span>
                </div>
                <button 
                  onClick={handleLogout} 
                  className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  aria-label="退出登录"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6 sm:py-12">
        <div className="glass rounded-[2rem] shadow-xl shadow-stone-200/50 overflow-hidden animate-fade-in">
          {/* 头部 */}
          <div className="p-6 sm:p-10 border-b border-stone-100 bg-white/30">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 bg-gradient-to-br from-orange-50 to-stone-50 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-white">
                  <Gift className="w-8 h-8 text-orange-500" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-stone-800 mb-2 tracking-tight">{project.name}</h1>
                  <div className="flex flex-wrap gap-2">
                    {project.newUserOnly && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-100 rounded-full text-xs font-bold text-emerald-600 border border-emerald-200">
                        🆕 新用户专享
                      </span>
                    )}
                    {isDirectProject && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-100 rounded-full text-xs font-bold text-orange-700 border border-orange-200">
                        💰 直充 ${project.directDollars}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-stone-100 rounded-full text-xs font-bold text-stone-500">
                      <Package className="w-3.5 h-3.5" />
                      剩余 {remaining} / {project.maxClaims}
                    </span>
                  </div>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold self-start sm:self-center border ${
                isPaused 
                  ? 'bg-amber-50 text-amber-600 border-amber-100' 
                  : isSoldOut 
                    ? 'bg-stone-100 text-stone-500 border-stone-200' 
                    : 'bg-emerald-50 text-emerald-600 border-emerald-100'
              }`}>
                {isPaused ? '已暂停' : isSoldOut ? '已领完' : '进行中'}
              </span>
            </div>
          </div>

          {/* 内容 */}
          <div className="p-6 sm:p-10">
            {/* 描述 */}
            <div className="mb-10">
              <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wide mb-3">活动详情</h3>
              <div className="bg-stone-50/50 rounded-2xl p-6 text-stone-600 leading-relaxed text-sm sm:text-base border border-stone-100">
                {project.description || '该项目暂无详细描述。'}
              </div>
            </div>

            {/* 进度 */}
            <div className="mb-10">
              <div className="flex justify-between mb-2">
                <span className="text-sm font-bold text-stone-400 uppercase tracking-wide">领取进度</span>
                <span className="text-sm font-bold text-orange-600">{Math.round(progress)}%</span>
              </div>
              <div className="h-2.5 bg-stone-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(249,115,22,0.3)]"
                  style={{ width: `${progress}%` }} 
                />
              </div>
            </div>

            {/* 操作区域 */}
            <div className="bg-gradient-to-br from-orange-50/50 to-stone-50/50 rounded-[2rem] p-8 sm:p-12 text-center border border-orange-100/50 relative overflow-hidden">
              {/* 背景装饰 */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/40 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2"></div>
              
               {claimedInfo ? (
                 <div className="animate-fade-in">
                   <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg animate-[bounce_1s_ease-out] ${
                     claimedInfo.directCredit && claimedInfo.creditStatus === 'uncertain'
                       ? 'bg-amber-100 shadow-amber-100/50'
                       : claimedInfo.directCredit && claimedInfo.creditStatus === 'pending'
                         ? 'bg-stone-100 shadow-stone-100/50'
                         : 'bg-emerald-100 shadow-emerald-100/50'
                   }`}>
                     {claimedInfo.directCredit && claimedInfo.creditStatus === 'pending' ? (
                       <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-stone-500 animate-spin" />
                     ) : claimedInfo.directCredit && claimedInfo.creditStatus === 'uncertain' ? (
                       <AlertCircle className="w-8 h-8 sm:w-10 sm:h-10 text-amber-600" />
                     ) : (
                       <Check className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-600" />
                     )}
                   </div>
                   <h3 className="text-2xl sm:text-3xl font-bold text-stone-800 mb-2">
                     {claimedInfo.directCredit && claimedInfo.creditStatus === 'pending'
                       ? '领取处理中'
                       : claimedInfo.directCredit && claimedInfo.creditStatus === 'uncertain'
                         ? '领取已提交'
                         : '领取成功!'}
                   </h3>

                   {claimedInfo.directCredit ? (
                     <>
                       <p className="text-stone-500 mb-8 text-sm sm:text-base">
                         {claimedInfo.creditStatus === 'uncertain'
                           ? '充值结果不确定，请稍后检查余额。如有问题请联系管理员。'
                           : claimedInfo.creditStatus === 'pending'
                             ? '正在处理，请稍后刷新页面查看结果。'
                             : `已直充 $${(claimedInfo.creditedDollars ?? project.directDollars) ?? ''} 到您的账户`}
                       </p>

                       <div className="max-w-md mx-auto">
                         <div className="bg-white border-2 border-orange-200 rounded-2xl p-6 shadow-xl shadow-orange-900/5">
                           <div className="flex items-center justify-between">
                             <span className="text-xs font-bold text-stone-400 uppercase tracking-wide">直充金额</span>
                             <span className="text-2xl font-extrabold text-stone-800 tabular-nums">
                               ${String((claimedInfo.creditedDollars ?? project.directDollars) ?? '')}
                             </span>
                           </div>
                           <div className="mt-4 flex items-center justify-center">
                             <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                               claimedInfo.creditStatus === 'uncertain'
                                 ? 'bg-amber-50 text-amber-700 border-amber-200'
                                 : claimedInfo.creditStatus === 'pending'
                                   ? 'bg-stone-100 text-stone-600 border-stone-200'
                                   : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                             }`}>
                               {claimedInfo.creditStatus === 'uncertain'
                                 ? '待确认'
                                 : claimedInfo.creditStatus === 'pending'
                                   ? '处理中'
                                   : '已直充'}
                             </span>
                           </div>
                         </div>
                       </div>
                     </>
                   ) : (
                     <>
                       <p className="text-stone-500 mb-8 text-sm sm:text-base">这是您的专属兑换码，请妥善保管</p>
                       
                       <div className="relative max-w-md mx-auto group">
                         <div className="bg-white border-2 border-orange-200 rounded-2xl py-5 pl-8 pr-16 font-mono text-xl sm:text-2xl font-bold text-stone-800 break-all shadow-xl shadow-orange-900/5 tracking-wider">
                           {claimedInfo.code}
                         </div>
                         <button 
                           onClick={handleCopy} 
                           className={`absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-xl transition-all hover:scale-105 active:scale-95 ${
                             copied ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                           }`}
                           aria-label="复制兑换码"
                         >
                           {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                         </button>
                       </div>
                     </>
                   )}
                   
                   <p className="mt-6 text-xs text-stone-400 font-medium">
                     领取时间: {new Date(claimedInfo.claimedAt).toLocaleString()}
                   </p>
                 </div>
               ) : (
                <div>
                  {!user ? (
                    <div>
                      <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-6 border border-stone-100 shadow-sm">
                        <UserIcon className="w-8 h-8 text-stone-300" />
                      </div>
                      <h3 className="text-xl font-bold text-stone-800 mb-2">请先登录</h3>
                      <p className="text-stone-500 mb-8 text-sm sm:text-base">
                        登录账号后即可领取{isDirectProject ? '直充福利' : '专属兑换码'}
                      </p>
                      <Link 
                        href={`/login?redirect=/project/${id}`} 
                        className="inline-flex items-center px-8 py-3.5 gradient-warm text-white rounded-xl text-base font-bold shadow-lg shadow-orange-500/25 hover:shadow-orange-500/35 hover:-translate-y-0.5 transition-all active:translate-y-0 active:shadow-sm"
                      >
                        立即登录
                      </Link>
                    </div>
                  ) : (
                    <div>
                      {error && (
                        <div className="flex items-center justify-center gap-2 p-3 mb-6 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-medium">
                          <AlertCircle className="w-4 h-4" />
                          <span>{error}</span>
                        </div>
                      )}
                      
                      {canClaim ? (
                        <div className="flex flex-col items-center">
                          <p className="text-stone-500 mb-8 text-sm sm:text-base font-medium">点击下方按钮即可领取，每人限领一次</p>
                          <button 
                            onClick={handleClaim} 
                            disabled={claiming} 
                            className="group relative inline-flex items-center justify-center px-12 py-4 gradient-warm text-white rounded-2xl text-lg font-bold shadow-xl shadow-orange-500/30 hover:shadow-2xl hover:shadow-orange-500/40 hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none w-full sm:w-auto min-w-[240px] overflow-hidden"
                          >
                            <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></span>
                            {claiming ? (
                              <>
                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                正在领取...
                              </>
                            ) : (
                              <span className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5" />
                                {isDirectProject ? '立即领取并直充' : '立即领取兑换码'}
                              </span>
                            )}
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-5 border border-stone-200">
                            <Package className="w-8 h-8 text-stone-400" />
                          </div>
                          <button disabled className="px-8 py-3.5 bg-stone-100 text-stone-400 rounded-xl text-base font-bold cursor-not-allowed w-full sm:w-auto border border-stone-200">
                            {isPaused ? '项目暂停中' : '已领完'}
                          </button>
                          <p className="mt-4 text-sm text-stone-400 font-medium">
                            {isPaused ? '管理员暂停了该项目的领取' : '手慢了，下次早点来哦'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
