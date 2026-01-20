'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, LayoutDashboard, Loader2, Gift, ChevronRight, Sparkles } from 'lucide-react';

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
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9]">
        <div className="text-center text-orange-500">
          <Loader2 className="w-10 h-10 animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 glass transition-all duration-300">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="flex justify-between items-center h-[72px]">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105 group-hover:rotate-3">
                <Gift className="w-5 h-5 text-orange-600" />
              </div>
              <span className="text-xl font-bold text-stone-800 tracking-tight group-hover:text-orange-600 transition-colors">福利中心</span>
            </Link>

            {/* 用户区域 */}
            <div className="flex items-center gap-4">
              {user ? (
                <>
                  {user.isAdmin && (
                    <Link 
                      href="/admin" 
                      className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-600 rounded-xl text-sm font-semibold hover:bg-orange-50 hover:text-orange-600 transition-all duration-300"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      <span className="hidden sm:inline">后台管理</span>
                    </Link>
                  )}
                  <div className="flex items-center gap-3 pl-4 border-l border-stone-200">
                    <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center border border-white shadow-sm">
                      <User className="w-4 h-4 text-stone-500" />
                    </div>
                    <span className="hidden md:block font-semibold text-stone-700 text-sm">{user.displayName || user.username}</span>
                    <button
                      onClick={handleLogout}
                      className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-200"
                      title="退出登录"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                </>
              ) : (
                <Link
                  href="/login"
                  className="px-6 py-2.5 gradient-warm text-white rounded-xl text-sm font-semibold shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 hover:-translate-y-0.5 transition-all duration-300"
                >
                  登录
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-[1200px] mx-auto px-6 py-16">
        <div className="mb-16 text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 border border-orange-100 text-orange-600 text-xs font-bold uppercase tracking-wider mb-4">
            <Sparkles className="w-3 h-3" />
            <span>Exclusive Rewards</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-stone-800 mb-6 tracking-tight">
            发现您的<span className="text-gradient-primary">专属福利</span>
          </h1>
          <p className="text-lg text-stone-500 max-w-lg mx-auto leading-relaxed">
            精选优质资源，限时限量免费领取。
            <br className="hidden sm:block" />
            登录即可获取您的专属兑换码。
          </p>
        </div>

        {projects.length === 0 ? (
          <div className="glass rounded-3xl p-10 sm:p-20 text-center mx-auto max-w-2xl">
            <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Gift className="w-9 h-9 text-stone-300" />
            </div>
            <h2 className="text-xl font-bold text-stone-800 mb-2">暂无活动</h2>
            <p className="text-stone-500">当前没有可进行的兑换活动，请稍后再来。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project, index) => {
              const remaining = Math.max(0, project.maxClaims - project.claimedCount);
              const progress = Math.min(100, (project.claimedCount / project.maxClaims) * 100);
              
              const statusConfig = {
                active: { bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-500', label: '进行中' },
                paused: { bg: 'bg-amber-50', text: 'text-amber-600', dot: 'bg-amber-500', label: '已暂停' },
                exhausted: { bg: 'bg-stone-100', text: 'text-stone-500', dot: 'bg-stone-400', label: '已领完' }
              };

              const currentStatus = statusConfig[project.status];

              return (
                <Link
                  key={project.id}
                  href={`/project/${project.id}`}
                  className="glass-card rounded-2xl p-6 group block"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="flex justify-between items-start mb-5">
                    <div className="w-12 h-12 bg-gradient-to-br from-orange-50 to-stone-50 rounded-xl flex items-center justify-center border border-orange-100/50 group-hover:scale-110 transition-transform duration-300">
                      <Gift className="w-6 h-6 text-orange-500" />
                    </div>
                    <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border border-transparent ${currentStatus.bg} ${currentStatus.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${currentStatus.dot}`}></span>
                      {currentStatus.label}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-stone-800 mb-2 line-clamp-1 group-hover:text-orange-600 transition-colors">
                    {project.name}
                  </h3>
                  <p className="text-sm text-stone-500 mb-6 h-10 line-clamp-2 leading-relaxed">
                    {project.description || '暂无描述'}
                  </p>

                  <div className="mb-5">
                    <div className="flex justify-between mb-2 text-xs font-medium">
                      <span className="text-stone-400">已领 {project.claimedCount}</span>
                      <span className={remaining < 10 ? 'text-orange-600 font-bold' : 'text-stone-500'}>
                        剩 {remaining}
                      </span>
                    </div>
                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-5 border-t border-stone-100">
                    <span className="text-xs text-stone-400 font-medium px-2 py-1 bg-stone-50 rounded">
                      库存: {project.codesCount}
                    </span>
                    <span className="text-sm font-bold text-stone-800 flex items-center gap-1 group-hover:gap-2 group-hover:text-orange-600 transition-all">
                      去领取 <ChevronRight className="w-4 h-4" />
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
