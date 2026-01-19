'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Copy, Check, Package, AlertCircle, LogOut, User as UserIcon, Calendar, Info, ShieldCheck } from 'lucide-react';

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

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
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
    } catch (err) {
      setError('网络请求失败');
    } finally {
      setLoading(false);
    }
  };

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
          code: data.code,
          claimedAt: Date.now()
        });
        if (project) {
          setProject({
            ...project,
            claimedCount: project.claimedCount + 1
          });
        }
      } else {
        setError(data.message || '领取失败');
      }
    } catch (err) {
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
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      router.refresh();
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50/50 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
          <p className="text-gray-500 text-sm font-medium">加载项目详情...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white/80 backdrop-blur-xl p-8 rounded-2xl shadow-xl border border-white/50 text-center max-w-md w-full">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">出错了</h2>
          <p className="text-gray-600 mb-6">{error || '找不到该项目'}</p>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 w-full"
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

  return (
    <div className="min-h-screen bg-gray-50 selection:bg-indigo-100 selection:text-indigo-900">
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none z-0"></div>
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 transition-all duration-300">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="flex items-center text-gray-500 hover:text-indigo-600 transition-colors group">
                <ArrowLeft className="w-5 h-5 mr-2 group-hover:-translate-x-1 transition-transform" />
                <span className="font-medium">返回列表</span>
              </Link>
            </div>
            {user && (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2 text-sm text-gray-700 bg-gray-50/50 px-3 py-1.5 rounded-full border border-gray-200/50">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs">
                    <UserIcon className="w-3 h-3" />
                  </div>
                  <span className="font-medium hidden sm:block">{user.displayName || user.username}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="退出登录"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 overflow-hidden">
          {/* Header */}
          <div className="relative px-6 py-8 sm:px-10 border-b border-gray-100 bg-gradient-to-r from-gray-50/50 to-white">
            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
              <Package className="w-32 h-32 text-indigo-600 transform rotate-12 translate-x-8 -translate-y-8" />
            </div>
            
            <div className="relative z-10 flex items-start justify-between flex-col sm:flex-row gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">{project.name}</h1>
                  {isPaused ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                      已暂停
                    </span>
                  ) : isSoldOut ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-800 border border-gray-200">
                      已领完
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 animate-pulse">
                      进行中
                    </span>
                  )}
                </div>
                
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                  <span className="flex items-center bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full border border-gray-200/60 shadow-sm">
                    <Package className="w-4 h-4 mr-1.5 text-indigo-500" />
                    剩余: <span className="font-semibold text-gray-900 ml-1">{remaining}</span> / {project.maxClaims}
                  </span>
                  <span className="flex items-center bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full border border-gray-200/60 shadow-sm">
                    <Calendar className="w-4 h-4 mr-1.5 text-indigo-500" />
                    {new Date(project.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-8 sm:px-10 space-y-10">
            {/* Description */}
            <div className="prose prose-indigo max-w-none">
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-5 h-5 text-indigo-500" />
                <h3 className="text-lg font-bold text-gray-900 m-0">项目详情</h3>
              </div>
              <div className="bg-gray-50/50 rounded-xl p-5 border border-gray-100 text-gray-600 leading-relaxed whitespace-pre-wrap">
                {project.description || '该项目暂无详细描述。'}
              </div>
            </div>

            {/* Progress */}
            <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
              <div className="flex justify-between items-end mb-3">
                <span className="text-sm font-semibold text-gray-700">领取进度</span>
                <span className="text-2xl font-bold text-indigo-600">{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden shadow-inner">
                <div 
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all duration-1000 ease-out shadow-lg shadow-indigo-500/20"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs font-medium text-gray-500">
                <span>0</span>
                <span>{project.maxClaims}</span>
              </div>
            </div>

            {/* Action Area */}
            <div className="bg-gradient-to-b from-gray-50 to-white rounded-2xl p-6 sm:p-10 border border-gray-100 shadow-inner">
              {claimedInfo ? (
                <div className="text-center relative">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-16">
                     <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center animate-bounce shadow-xl border-4 border-white">
                        <Check className="w-10 h-10 text-green-600" />
                     </div>
                  </div>
                  
                  <div className="mt-8">
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">领取成功!</h3>
                    <p className="text-gray-500 mb-8">这是您的专属兑换码，请妥善保管</p>
                    
                    <div className="max-w-lg mx-auto relative group">
                      <div className="bg-white border-2 border-indigo-100 rounded-xl p-6 font-mono text-2xl sm:text-3xl text-indigo-600 font-bold tracking-wider break-all shadow-sm group-hover:border-indigo-300 transition-colors">
                        {claimedInfo.code}
                      </div>
                      <button
                        onClick={handleCopy}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 text-gray-400 hover:text-white hover:bg-indigo-600 rounded-lg transition-all shadow-sm"
                        title="复制兑换码"
                      >
                        {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                      </button>
                    </div>
                    <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-400 bg-gray-50 inline-flex px-4 py-2 rounded-full border border-gray-100">
                      <ShieldCheck className="w-4 h-4" />
                      领取时间: {new Date(claimedInfo.claimedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  {!user ? (
                    <div className="space-y-6">
                      <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto text-indigo-400">
                        <UserIcon className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">请先登录</h3>
                        <p className="text-gray-600 mt-1">登录账号后即可领取专属兑换码</p>
                      </div>
                      <Link
                        href={`/login?redirect=/project/${id}`}
                        className="inline-flex items-center px-8 py-3.5 border border-transparent text-base font-medium rounded-xl shadow-lg shadow-indigo-500/20 text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 transition-all transform hover:-translate-y-0.5"
                      >
                        立即登录
                        <ArrowLeft className="w-4 h-4 ml-2 rotate-180" />
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {error && (
                        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm mb-6 flex items-center justify-center animate-in fade-in zoom-in duration-200">
                          <AlertCircle className="w-5 h-5 mr-2" />
                          {error}
                        </div>
                      )}
                      
                      {canClaim ? (
                        <div>
                          <p className="text-gray-600 mb-6">点击下方按钮即可领取，每人限领一次</p>
                          <button
                            onClick={handleClaim}
                            disabled={claiming}
                            className="group relative w-full sm:w-auto min-w-[200px] inline-flex items-center justify-center px-8 py-4 border border-transparent text-lg font-bold rounded-xl shadow-xl shadow-indigo-600/20 text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-70 disabled:cursor-not-allowed transition-all transform hover:-translate-y-1 active:translate-y-0"
                          >
                            {claiming ? (
                              <>
                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                正在处理...
                              </>
                            ) : (
                              <>
                                立即领取兑换码
                                <Package className="w-5 h-5 ml-2 group-hover:rotate-12 transition-transform" />
                              </>
                            )}
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                           <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400">
                            {isPaused ? <AlertCircle className="w-8 h-8" /> : <Package className="w-8 h-8" />}
                           </div>
                          <button
                            disabled
                            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 border border-gray-200 text-base font-medium rounded-xl text-gray-400 bg-gray-50 cursor-not-allowed shadow-none"
                          >
                            {isPaused ? '项目暂停中' : '已领完'}
                          </button>
                          <p className="text-sm text-gray-400 mt-3">
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
