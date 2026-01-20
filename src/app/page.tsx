'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, LayoutDashboard, Loader2, Gift, ChevronRight } from 'lucide-react';

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

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [projectsRes, userRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/auth/me')
      ]);

      if (projectsRes.ok) {
        const data = await projectsRes.json();
        if (data.success) {
          setProjects(data.projects);
        }
      }

      if (userRes.ok) {
        const data = await userRes.json();
        if (data.success) {
          setUser(data.user);
        }
      }
    } catch (error) {
      console.error('Failed to fetch data', error);
    } finally {
      setLoading(false);
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#667eea] to-[#764ba2]">
        <div className="text-center text-white">
          <Loader2 className="w-12 h-12 animate-spin mx-auto" />
          <p className="mt-4 text-sm font-medium">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2]">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm shadow-sm transition-all duration-300">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="flex justify-between items-center h-[70px]">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-11 h-11 bg-gradient-to-br from-[#667eea] to-[#764ba2] rounded-xl flex items-center justify-center shadow-lg shadow-[#667eea]/40 transition-transform group-hover:scale-105">
                <Gift className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">兑换码中心</span>
            </Link>

            {/* 用户区域 */}
            <div className="flex items-center gap-4">
              {user ? (
                <>
                  {user.isAdmin && (
                    <Link 
                      href="/admin" 
                      className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-xl text-sm font-semibold shadow-lg shadow-[#667eea]/30 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
                    >
                      <LayoutDashboard className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                      <span className="hidden sm:inline">管理后台</span>
                    </Link>
                  )}
                  <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center border-2 border-[#667eea]/20">
                      <User className="w-[18px] h-[18px] text-[#667eea]" />
                    </div>
                    <span className="hidden md:block font-semibold text-gray-700">{user.displayName || user.username}</span>
                    <button
                      onClick={handleLogout}
                      className="p-2.5 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 hover:text-red-600 transition-colors duration-200 flex items-center justify-center"
                      title="退出登录"
                    >
                      <LogOut className="w-[18px] h-[18px]" />
                    </button>
                  </div>
                </>
              ) : (
                <Link
                  href="/login"
                  className="px-7 py-3 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-xl text-sm font-semibold shadow-lg shadow-[#667eea]/40 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
                >
                  登录
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-[1200px] mx-auto px-6 py-12">
        <div className="mb-12 text-center">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white mb-4 drop-shadow-md">
            发现专属福利
          </h1>
          <p className="text-base sm:text-lg text-white/90 max-w-lg mx-auto font-medium">
            领取独家兑换码，限时限量，先到先得
          </p>
        </div>

        {projects.length === 0 ? (
          <div className="bg-white/95 backdrop-blur-sm rounded-3xl p-10 sm:p-20 text-center shadow-2xl shadow-black/5 mx-auto max-w-2xl">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Gift className="w-10 h-10 text-[#667eea]" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-3">暂无项目</h2>
            <p className="text-gray-500">当前没有可用的兑换码项目，请稍后再来</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
            {projects.map((project) => {
              const remaining = Math.max(0, project.maxClaims - project.claimedCount);
              const progress = Math.min(100, (project.claimedCount / project.maxClaims) * 100);
              
              const statusColors = {
                active: { bg: 'bg-emerald-100', text: 'text-emerald-600', label: '进行中' },
                paused: { bg: 'bg-amber-100', text: 'text-amber-600', label: '已暂停' },
                exhausted: { bg: 'bg-gray-100', text: 'text-gray-500', label: '已领完' }
              };

              const currentStatus = statusColors[project.status];

              return (
                <Link
                  key={project.id}
                  href={`/project/${project.id}`}
                  className="group block bg-white/95 backdrop-blur-sm rounded-2xl p-7 shadow-lg shadow-black/5 hover:shadow-2xl hover:shadow-black/10 hover:-translate-y-1 transition-all duration-300"
                >
                  <div className="flex justify-between items-start mb-5">
                    <div className="p-3 bg-gradient-to-br from-[#667eea] to-[#764ba2] rounded-xl text-white shadow-md shadow-[#667eea]/20">
                      <Gift className="w-6 h-6" />
                    </div>
                    <span className={`px-3.5 py-1.5 rounded-full text-xs font-bold ${currentStatus.bg} ${currentStatus.text}`}>
                      {currentStatus.label}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-gray-800 mb-2.5 line-clamp-1 group-hover:text-[#667eea] transition-colors">
                    {project.name}
                  </h3>
                  <p className="text-sm text-gray-500 mb-6 h-10 line-clamp-2 leading-relaxed">
                    {project.description || '暂无描述'}
                  </p>

                  <div className="mb-5">
                    <div className="flex justify-between mb-2 text-xs text-gray-500 font-medium">
                      <span>已领取 {project.claimedCount}</span>
                      <span className={remaining < 10 ? 'text-red-500 font-bold' : 'text-gray-500'}>
                        剩余 {remaining} / {project.maxClaims}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-5 border-t border-gray-100">
                    <span className="text-xs text-gray-400 bg-gray-50 px-2.5 py-1 rounded-md font-medium">
                      库存: {project.codesCount}
                    </span>
                    <span className="text-sm font-bold text-[#667eea] flex items-center gap-1 group-hover:gap-2 transition-all">
                      立即领取 <ChevronRight className="w-[18px] h-[18px]" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
