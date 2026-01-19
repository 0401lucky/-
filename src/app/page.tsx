'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, LayoutDashboard, Loader2, Gift, ChevronRight, Zap } from 'lucide-react';

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

  const getStatusBadge = (project: Project) => {
    if (project.status === 'paused') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
          已暂停
        </span>
      );
    }
    if (project.status === 'exhausted' || project.claimedCount >= project.maxClaims) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
          已领完
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5 animate-pulse"></span>
        进行中
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50/50 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
          <p className="text-gray-500 text-sm font-medium">加载资源中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 selection:bg-indigo-100 selection:text-indigo-900">
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none z-0"></div>
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="flex items-center space-x-3 group">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform duration-300">
                  <Gift className="w-6 h-6 text-white" />
                </div>
                <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600">
                  兑换码中心
                </span>
              </Link>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4">
              {user ? (
                <>
                  {user.isAdmin && (
                    <Link
                      href="/admin"
                      className="flex items-center px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 transition-all duration-200"
                      title="管理后台"
                    >
                      <LayoutDashboard className="w-5 h-5 sm:mr-2" />
                      <span className="hidden sm:inline">管理后台</span>
                    </Link>
                  )}
                  <div className="flex items-center space-x-3 pl-2 sm:pl-4 sm:border-l border-gray-200/60">
                    <div className="flex items-center space-x-2 text-sm text-gray-700">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-indigo-600 border border-indigo-200/50 shadow-sm">
                        <User className="w-4 h-4" />
                      </div>
                      <span className="font-medium hidden sm:block text-gray-900">{user.displayName || user.username}</span>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="退出登录"
                    >
                      <LogOut className="w-5 h-5" />
                    </button>
                  </div>
                </>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex items-center px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30 transform hover:-translate-y-0.5 transition-all duration-200"
                >
                  登录
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-12 text-center sm:text-left">
          <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl tracking-tight mb-3">
            项目列表
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            发现并领取最新的独家兑换码资源，限时限量，先到先得。
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {projects.map((project) => {
            const remaining = Math.max(0, project.maxClaims - project.claimedCount);
            const percentage = (project.claimedCount / project.maxClaims) * 100;
            const progress = Math.min(100, percentage);
            
            return (
              <Link
                key={project.id}
                href={`/project/${project.id}`}
                className="group relative flex flex-col bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-gray-200/60 shadow-sm hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-300 hover:-translate-y-1"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-300">
                    <Zap className="w-5 h-5" />
                  </div>
                  {getStatusBadge(project)}
                </div>
                
                <h3 className="text-xl font-bold text-gray-900 mb-2 line-clamp-1 group-hover:text-indigo-600 transition-colors">
                  {project.name}
                </h3>
                
                <p className="text-gray-500 text-sm mb-6 line-clamp-2 min-h-[40px] leading-relaxed">
                  {project.description || '暂无描述信息'}
                </p>

                <div className="mt-auto space-y-3">
                  <div className="flex justify-between text-xs font-medium text-gray-500">
                    <span>已领取 {Math.round(progress)}%</span>
                    <span className={remaining < 10 ? "text-amber-600" : "text-gray-500"}>
                      仅剩 {remaining} / {project.maxClaims}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-1000 ease-out ${
                        remaining === 0 ? 'bg-gray-400' : 'bg-gradient-to-r from-indigo-500 to-purple-500'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-400 bg-gray-50 px-2 py-1 rounded-md">
                    库存: {project.codesCount}
                  </span>
                  <span className="text-sm font-semibold text-indigo-600 flex items-center group-hover:translate-x-1 transition-transform">
                    立即领取 <ChevronRight className="w-4 h-4 ml-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
          
          {projects.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 bg-white/50 backdrop-blur-sm rounded-2xl border border-dashed border-gray-300 text-center">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                <Gift className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">暂无项目</h3>
              <p className="text-gray-500">当前没有可用的兑换码项目，请稍后再来</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
