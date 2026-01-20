'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Copy, Check, Package, AlertCircle, LogOut, User as UserIcon, Gift } from 'lucide-react';

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
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.refresh();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white">
        <Loader2 className="w-12 h-12 animate-spin mb-4" />
        <p className="text-lg font-medium opacity-90">加载项目详情...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#667eea] to-[#764ba2] p-6">
        <div className="bg-white rounded-3xl p-10 text-center max-w-md w-full shadow-2xl">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">出错了</h2>
          <p className="text-gray-500 mb-6">{error || '找不到该项目'}</p>
          <Link 
            href="/" 
            className="inline-flex items-center justify-center px-7 py-3.5 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-xl font-semibold w-full hover:shadow-lg transition-shadow"
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
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2]">
      {/* 导航栏 */}
      <nav className="bg-white/95 backdrop-blur-md shadow-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[70px]">
            <Link href="/" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors group">
              <ArrowLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
              <span className="font-medium">返回首页</span>
            </Link>
            
            {user && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-full">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center shadow-sm">
                    <UserIcon className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="font-semibold text-gray-700 text-sm hidden sm:block truncate max-w-[120px]">
                    {user.displayName}
                  </span>
                </div>
                <button 
                  onClick={handleLogout} 
                  className="p-2.5 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition-colors"
                  aria-label="退出登录"
                >
                  <LogOut className="w-[18px] h-[18px]" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6 sm:py-10">
        <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-xl overflow-hidden">
          {/* 头部 */}
          <div className="p-6 sm:p-8 border-b border-gray-100">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-gradient-to-br from-[#667eea] to-[#764ba2] rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-indigo-200">
                  <Gift className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">{project.name}</h1>
                  <div className="flex flex-wrap gap-2">
                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-full text-xs font-medium text-gray-500">
                      <Package className="w-3.5 h-3.5" />
                      剩余 {remaining} / {project.maxClaims}
                    </span>
                  </div>
                </div>
              </div>
              <span className={`px-4 py-2 rounded-full text-xs font-bold self-start sm:self-center ${
                isPaused 
                  ? 'bg-amber-100 text-amber-600' 
                  : isSoldOut 
                    ? 'bg-gray-100 text-gray-500' 
                    : 'bg-emerald-100 text-emerald-600'
              }`}>
                {isPaused ? '已暂停' : isSoldOut ? '已领完' : '进行中'}
              </span>
            </div>
          </div>

          {/* 内容 */}
          <div className="p-6 sm:p-8">
            {/* 描述 */}
            <div className="mb-8">
              <h3 className="text-base font-bold text-gray-700 mb-3">项目详情</h3>
              <div className="bg-gray-50 rounded-2xl p-5 text-gray-500 leading-relaxed text-sm sm:text-base">
                {project.description || '该项目暂无详细描述。'}
              </div>
            </div>

            {/* 进度 */}
            <div className="mb-8 bg-gray-50 rounded-2xl p-6">
              <div className="flex justify-between mb-3">
                <span className="text-sm font-semibold text-gray-700">领取进度</span>
                <span className="text-lg font-bold text-[#667eea]">{Math.round(progress)}%</span>
              </div>
              <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }} 
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-400">
                <span>已领取 {project.claimedCount}</span>
                <span>总数 {project.maxClaims}</span>
              </div>
            </div>

            {/* 操作区域 */}
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-6 sm:p-10 text-center border border-indigo-100/50">
              {claimedInfo ? (
                <div>
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-100">
                    <Check className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-600" />
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">领取成功!</h3>
                  <p className="text-gray-500 mb-6 text-sm sm:text-base">这是您的专属兑换码，请妥善保管</p>
                  
                  <div className="relative max-w-md mx-auto group">
                    <div className="bg-white border-2 border-[#667eea] rounded-2xl py-4 pl-6 pr-14 font-mono text-xl sm:text-2xl font-bold text-[#667eea] break-all shadow-lg shadow-indigo-100">
                      {claimedInfo.code}
                    </div>
                    <button 
                      onClick={handleCopy} 
                      className={`absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-xl transition-all hover:scale-110 active:scale-95 ${
                        copied ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                      aria-label="复制兑换码"
                    >
                      {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    </button>
                  </div>
                  
                  <p className="mt-4 text-xs text-gray-400">
                    领取时间: {new Date(claimedInfo.claimedAt).toLocaleString()}
                  </p>
                </div>
              ) : (
                <div>
                  {!user ? (
                    <div>
                      <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-5 border-2 border-gray-100 shadow-sm">
                        <UserIcon className="w-8 h-8 text-gray-400" />
                      </div>
                      <h3 className="text-xl font-bold text-gray-800 mb-2">请先登录</h3>
                      <p className="text-gray-500 mb-8 text-sm sm:text-base">登录账号后即可领取专属兑换码</p>
                      <Link 
                        href={`/login?redirect=/project/${id}`} 
                        className="inline-flex items-center px-8 py-4 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-2xl text-base font-bold shadow-lg shadow-indigo-200 hover:shadow-xl hover:scale-105 transition-all"
                      >
                        立即登录
                      </Link>
                    </div>
                  ) : (
                    <div>
                      {error && (
                        <div className="flex items-center justify-center gap-2 p-3 mb-6 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                          <AlertCircle className="w-4 h-4" />
                          <span>{error}</span>
                        </div>
                      )}
                      
                      {canClaim ? (
                        <div className="flex flex-col items-center">
                          <p className="text-gray-500 mb-6 text-sm sm:text-base">点击下方按钮即可领取，每人限领一次</p>
                          <button 
                            onClick={handleClaim} 
                            disabled={claiming} 
                            className="inline-flex items-center justify-center px-10 py-4 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-2xl text-lg font-bold shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none w-full sm:w-auto min-w-[200px]"
                          >
                            {claiming ? (
                              <>
                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                正在领取...
                              </>
                            ) : (
                              '立即领取兑换码'
                            )}
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-5">
                            <Package className="w-8 h-8 text-gray-400" />
                          </div>
                          <button disabled className="px-8 py-4 bg-gray-100 text-gray-400 rounded-2xl text-base font-semibold cursor-not-allowed w-full sm:w-auto">
                            {isPaused ? '项目暂停中' : '已领完'}
                          </button>
                          <p className="mt-4 text-sm text-gray-400">
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
