'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, LayoutDashboard, Loader2, Gift } from 'lucide-react';

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
      return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-600">已暂停</span>;
    }
    if (project.status === 'exhausted' || project.claimedCount >= project.maxClaims) {
      return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">已领完</span>;
    }
    return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-600">进行中</span>;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Gift className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-gray-900">兑换码中心</span>
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              {user ? (
                <>
                  {user.isAdmin && (
                    <Link
                      href="/admin"
                      className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                    >
                      <LayoutDashboard className="w-4 h-4 mr-2" />
                      <span className="hidden sm:inline">管理后台</span>
                    </Link>
                  )}
                  <div className="flex items-center space-x-3 pl-4 border-l border-gray-200">
                    <div className="flex items-center space-x-2 text-sm text-gray-700">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                        <User className="w-4 h-4" />
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
                </>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  登录
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">项目列表</h1>
          <p className="mt-2 text-gray-600">发现并领取最新的兑换码资源</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => {
            const remaining = Math.max(0, project.maxClaims - project.claimedCount);
            const progress = Math.min(100, (project.claimedCount / project.maxClaims) * 100);
            
            return (
              <Link
                key={project.id}
                href={`/project/${project.id}`}
                className="group block bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-200 transition-all duration-200 overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                      {project.name}
                    </h3>
                    {getStatusBadge(project)}
                  </div>
                  
                  <p className="text-gray-500 text-sm mb-6 line-clamp-2 min-h-[40px]">
                    {project.description || '暂无描述'}
                  </p>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>剩余: {remaining}</span>
                      <span>总数: {project.maxClaims}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center group-hover:bg-blue-50/50 transition-colors">
                  <span className="text-xs text-gray-500">
                    兑换码: {project.codesCount} 个
                  </span>
                  <span className="text-sm font-medium text-blue-600 group-hover:translate-x-1 transition-transform inline-flex items-center">
                    查看详情 &rarr;
                  </span>
                </div>
              </Link>
            );
          })}
          
          {projects.length === 0 && (
            <div className="col-span-full text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
              <div className="mx-auto w-12 h-12 text-gray-400 mb-3">
                <Gift className="w-12 h-12" />
              </div>
              <h3 className="text-lg font-medium text-gray-900">暂无项目</h3>
              <p className="mt-1 text-gray-500">当前没有可用的兑换码项目</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
