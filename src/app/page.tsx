'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, LayoutDashboard, Loader2, Gift, ChevronRight, Sparkles, Trophy, ArrowRight } from 'lucide-react';

interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

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

export default function HomePage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [userRes, projectsRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/projects')
      ]);

      if (userRes.ok) {
        const data = await userRes.json();
        if (data.success) {
          setUser(data.user);
        }
      }

      if (projectsRes.ok) {
        const data = await projectsRes.json();
        if (data.success) {
          setProjects(data.projects.slice(0, 3)); // 仅展示前3个作为推荐
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
    <div className="min-h-screen bg-[#fafaf9] overflow-x-hidden">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 glass border-b border-white/50 transition-all duration-300">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="flex justify-between items-center h-[72px]">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105 group-hover:rotate-3 border border-orange-200">
                <Gift className="w-5 h-5 text-orange-600" />
              </div>
              <span className="text-xl font-extrabold text-stone-800 tracking-tight group-hover:text-orange-600 transition-colors">Lucky福利站</span>
            </Link>

            {/* 用户区域 */}
            <div className="flex items-center gap-4">
              {user ? (
                <>
                  {user.isAdmin && (
                    <Link 
                      href="/admin" 
                      className="hidden sm:flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-600 rounded-xl text-sm font-semibold hover:bg-orange-50 hover:text-orange-600 transition-all duration-300 border border-stone-200"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      <span>后台管理</span>
                    </Link>
                  )}
                  <div className="flex items-center gap-3 pl-4 sm:border-l sm:border-stone-200">
                    <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center border border-stone-100 shadow-sm">
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
                  className="px-6 py-2.5 gradient-warm text-white rounded-xl text-sm font-bold shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 hover:-translate-y-0.5 transition-all duration-300"
                >
                  登录
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-[1200px] mx-auto px-6 py-12 md:py-20">
        <div className="mb-16 text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 border border-orange-100 text-orange-600 text-xs font-bold uppercase tracking-wider mb-4 shadow-sm">
            <Sparkles className="w-3 h-3" />
            <span>Welcome to Lucky Station</span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-stone-800 mb-6 tracking-tight leading-tight">
            欢迎来到 <span className="text-gradient-primary relative inline-block">
              Lucky福利站
              <svg className="absolute w-full h-3 -bottom-1 left-0 text-orange-200 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none">
                <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="8" fill="none" />
              </svg>
            </span>
          </h1>
          <p className="text-lg text-stone-500 max-w-lg mx-auto leading-relaxed">
            为您准备了丰富的专属福利和每日抽奖机会。
            <br className="hidden sm:block" />
            登录即可参与，100% 真实有效。
          </p>
        </div>

        {/* 双入口卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-20">
          {/* 兑换码入口 */}
          <Link href="/projects" className="group relative overflow-hidden glass rounded-3xl p-8 sm:p-10 hover:shadow-xl hover:shadow-orange-500/10 transition-all duration-500 hover:-translate-y-1 border border-white/60">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-orange-50 to-transparent rounded-full blur-3xl -z-10 translate-x-1/3 -translate-y-1/3 group-hover:bg-orange-100 transition-colors"></div>
            
            <div className="flex flex-col h-full justify-between relative z-10">
              <div>
                <div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center mb-6 border border-orange-100 group-hover:scale-110 transition-transform duration-300 shadow-sm">
                  <Gift className="w-7 h-7 text-orange-500" />
                </div>
                <h2 className="text-2xl font-bold text-stone-800 mb-3 group-hover:text-orange-600 transition-colors">福利兑换</h2>
                <p className="text-stone-500 leading-relaxed mb-8">
                  领取限时限量的专属福利兑换码。包含各类会员、点数充值等优质资源，先到先得。
                </p>
              </div>
              <div className="flex items-center text-orange-600 font-bold group/btn">
                <span className="group-hover/btn:mr-2 transition-all">立即查看</span>
                <ArrowRight className="w-5 h-5 ml-1 transition-transform group-hover/btn:translate-x-1" />
              </div>
            </div>
          </Link>

          {/* 抽奖入口 */}
          <Link href="/lottery" className="group relative overflow-hidden glass rounded-3xl p-8 sm:p-10 hover:shadow-xl hover:shadow-red-500/10 transition-all duration-500 hover:-translate-y-1 border border-white/60">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-red-50 to-transparent rounded-full blur-3xl -z-10 translate-x-1/3 -translate-y-1/3 group-hover:bg-red-100 transition-colors"></div>
            
            <div className="flex flex-col h-full justify-between relative z-10">
              <div>
                <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-6 border border-red-100 group-hover:scale-110 transition-transform duration-300 shadow-sm">
                  <Trophy className="w-7 h-7 text-red-500" />
                </div>
                <h2 className="text-2xl font-bold text-stone-800 mb-3 group-hover:text-red-600 transition-colors">幸运抽奖</h2>
                <p className="text-stone-500 leading-relaxed mb-8">
                  每日免费抽取一次幸运大奖！最高可得 20刀 额度，100% 中奖概率，不容错过。
                </p>
              </div>
              <div className="flex items-center text-red-600 font-bold group/btn">
                <span className="group-hover/btn:mr-2 transition-all">试试手气</span>
                <ArrowRight className="w-5 h-5 ml-1 transition-transform group-hover/btn:translate-x-1" />
              </div>
            </div>
          </Link>
        </div>

        {/* 推荐项目预览 */}
        {projects.length > 0 && (
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6 px-2">
              <h3 className="text-lg font-bold text-stone-700 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-500" />
                热门福利
              </h3>
              <Link href="/projects" className="text-sm font-semibold text-stone-400 hover:text-orange-500 flex items-center gap-1 transition-colors">
                全部福利 <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/project/${project.id}`}
                  className="glass-card p-5 rounded-2xl flex flex-col gap-3 hover:bg-white transition-colors border border-white/40"
                >
                  <div className="flex justify-between items-start">
                    <span className="font-bold text-stone-800 line-clamp-1">{project.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      project.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-stone-100 text-stone-500'
                    }`}>
                      {project.status === 'active' ? '进行中' : '已结束'}
                    </span>
                  </div>
                  <div className="w-full bg-stone-100 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-orange-400 rounded-full" 
                      style={{ width: `${Math.min(100, (project.claimedCount / project.maxClaims) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-stone-400">
                    <span>剩 {Math.max(0, project.maxClaims - project.claimedCount)} 份</span>
                    <span>库存 {project.codesCount}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* 底部版权 */}
      <footer className="py-8 text-center text-stone-400 text-sm">
        <p>© 2024 Lucky福利站. All rights reserved.</p>
      </footer>
    </div>
  );
}
