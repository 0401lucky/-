'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Copy, Check, Package, AlertCircle, LogOut, User as UserIcon } from 'lucide-react';

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center max-w-md w-full">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">出错了</h2>
          <p className="text-gray-600 mb-6">{error || '找不到该项目'}</p>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors w-full"
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
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="flex items-center text-gray-500 hover:text-gray-900 transition-colors">
                <ArrowLeft className="w-5 h-5 mr-2" />
                <span className="font-medium">返回列表</span>
              </Link>
            </div>
            {user && (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2 text-sm text-gray-700">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <span className="font-medium hidden sm:block">{user.displayName || user.username}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-full text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="退出登录"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-8 sm:px-10 border-b border-gray-100">
            <div className="flex items-start justify-between flex-col sm:flex-row gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{project.name}</h1>
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                  <span className="flex items-center bg-gray-100 px-3 py-1 rounded-full">
                    <Package className="w-4 h-4 mr-1.5" />
                    剩余 {remaining} / {project.maxClaims}
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {isPaused ? (
                  <span className="inline-flex items-center px-4 py-2 rounded-full bg-yellow-100 text-yellow-800 font-medium text-sm">
                    已暂停
                  </span>
                ) : isSoldOut ? (
                  <span className="inline-flex items-center px-4 py-2 rounded-full bg-gray-100 text-gray-600 font-medium text-sm">
                    已领完
                  </span>
                ) : (
                  <span className="inline-flex items-center px-4 py-2 rounded-full bg-green-100 text-green-600 font-medium text-sm">
                    进行中
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="px-6 py-8 sm:px-10 space-y-8">
            {/* Description */}
            <div className="prose prose-blue max-w-none">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">项目详情</h3>
              <div className="text-gray-600 leading-relaxed whitespace-pre-wrap">
                {project.description || '该项目暂无详细描述。'}
              </div>
            </div>

            {/* Progress */}
            <div>
              <div className="flex justify-between text-sm font-medium text-gray-700 mb-2">
                <span>领取进度</span>
                <span className="text-blue-600">{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div 
                  className="bg-blue-600 h-3 rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-right text-xs text-gray-500 mt-1">
                已领取 {project.claimedCount} / {project.maxClaims}
              </p>
            </div>

            {/* Action Area */}
            <div className="bg-gray-50 rounded-xl p-6 sm:p-8 border border-gray-100">
              {claimedInfo ? (
                <div className="text-center">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600">
                    <Check className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">领取成功!</h3>
                  <p className="text-gray-500 mb-6">这是您的专属兑换码，请妥善保管</p>
                  
                  <div className="max-w-md mx-auto relative">
                    <div className="bg-white border border-blue-200 rounded-lg p-4 font-mono text-xl sm:text-2xl text-blue-600 tracking-wider break-all shadow-sm">
                      {claimedInfo.code}
                    </div>
                    <button
                      onClick={handleCopy}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                      title="复制兑换码"
                    >
                      {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-4">
                    领取时间: {new Date(claimedInfo.claimedAt).toLocaleString()}
                  </p>
                </div>
              ) : (
                <div className="text-center">
                  {!user ? (
                    <div className="space-y-4">
                      <p className="text-gray-600">请先登录后领取兑换码</p>
                      <Link
                        href={`/login?redirect=/project/${id}`}
                        className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                      >
                        立即登录
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-md text-sm mb-4 flex items-center justify-center">
                          <AlertCircle className="w-4 h-4 mr-2" />
                          {error}
                        </div>
                      )}
                      
                      {canClaim ? (
                        <button
                          onClick={handleClaim}
                          disabled={claiming}
                          className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 border border-transparent text-lg font-medium rounded-xl shadow-lg shadow-blue-600/20 text-white bg-blue-600 hover:bg-blue-700 hover:shadow-blue-600/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:-translate-y-0.5"
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
                      ) : (
                        <button
                          disabled
                          className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3 border border-gray-300 text-base font-medium rounded-lg text-gray-400 bg-gray-100 cursor-not-allowed"
                        >
                          {isPaused ? '已暂停' : '已领完'}
                        </button>
                      )}
                      
                      <p className="text-sm text-gray-500">
                        {canClaim ? '点击按钮即可领取，每人限领一次' : '当前无法领取兑换码'}
                      </p>
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
