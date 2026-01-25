'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Plus, Pause, Play, Trash2, Upload, 
  Loader2, AlertCircle, Users, Package, LayoutDashboard,
  ChevronRight, LogOut, User as UserIcon, X, Check, Gift, Sparkles, ShoppingBag, Pin
} from 'lucide-react';

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
  pinned?: boolean;
  pinnedAt?: number;
}

interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export default function AdminPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxClaims, setMaxClaims] = useState('100');
  const [rewardType, setRewardType] = useState<'code' | 'direct'>('code');
  const [directDollars, setDirectDollars] = useState('5');
  const [codesFile, setCodesFile] = useState<File | null>(null);
  const [newUserOnly, setNewUserOnly] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const userRes = await fetch('/api/auth/me');
      if (!userRes.ok) {
        router.push('/login?redirect=/admin');
        return;
      }
      const userData = await userRes.json();
      if (!userData.success || !userData.user?.isAdmin) {
        router.push('/');
        return;
      }
      setUser(userData.user);

      const projectsRes = await fetch('/api/admin/projects');
      if (projectsRes.ok) {
        const data = await projectsRes.json();
        if (data.success) {
          setProjects(data.projects);
        }
      }
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请输入项目名称');
      return;
    }
    if (rewardType === 'direct') {
      const dollars = parseFloat(directDollars);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        setError('请输入有效的直充金额（> 0）');
        return;
      }
    }

    setCreating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('description', description.trim());
      formData.append('maxClaims', maxClaims);
      formData.append('newUserOnly', newUserOnly.toString());
      formData.append('rewardType', rewardType);
      if (rewardType === 'direct') {
        formData.append('directDollars', directDollars);
      }
      if (rewardType === 'code' && codesFile) {
        formData.append('codes', codesFile);
      }

      const res = await fetch('/api/admin/projects', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      
      if (data.success) {
        const created = data.project as Project | undefined;
        if (created?.rewardType === 'direct') {
          setSuccess(`项目创建成功! 每人直充 $${created.directDollars}，共 ${created.maxClaims} 份`);
        } else {
          setSuccess(`项目创建成功! 添加了 ${data.codesAdded} 个兑换码`);
        }
        setShowCreateModal(false);
        setName('');
        setDescription('');
        setMaxClaims('100');
        setRewardType('code');
        setDirectDollars('5');
        setCodesFile(null);
        setNewUserOnly(false);
        fetchData();
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError(data.message || '创建失败');
      }
    } catch {
      setError('请求失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newStatus = project.status === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch(`/api/admin/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) fetchData();
    } catch (err) {
      console.error('Toggle status error:', err);
    }
  };

  const handleDelete = async (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`确定要删除项目 "${project.name}" 吗？`)) return;
    try {
      const res = await fetch(`/api/admin/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) fetchData();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleTogglePinned = async (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`/api/admin/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !project.pinned }),
      });
      if (res.ok) fetchData();
    } catch (err) {
      console.error('Toggle pinned error:', err);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9]">
        <div className="text-center text-orange-500">
          <Loader2 className="w-10 h-10 animate-spin mx-auto" />
          <p className="mt-4 text-sm font-medium text-stone-500">加载管理后台...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 glass border-b border-white/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16 sm:h-[72px]">
            <div className="flex items-center gap-3 sm:gap-6 min-w-0">
              <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors">
                <ArrowLeft className="w-4 h-4" />
                <span className="font-medium hidden sm:inline text-sm">首页</span>
              </Link>
              <div className="w-px h-5 bg-stone-300 hidden sm:block" />
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                  <LayoutDashboard className="w-4 h-4 text-orange-600" />
                </div>
                <span className="text-lg font-bold text-stone-800 tracking-tight truncate">
                  <span className="sm:hidden">后台</span>
                  <span className="hidden sm:inline">管理后台</span>
                </span>
              </div>
              {/* 桌面端：快捷入口放在同一行 */}
              <div className="hidden sm:flex items-center gap-3">
                <Link 
                  href="/admin/lottery" 
                  className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-full text-sm font-medium transition-all hover:shadow-lg hover:shadow-orange-200"
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="hidden sm:inline">抽奖管理</span>
                </Link>
                <Link 
                  href="/admin/users" 
                  className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-full text-sm font-medium transition-all hover:shadow-lg hover:shadow-blue-200"
                >
                  <Users className="w-4 h-4" />
                  <span className="hidden sm:inline">用户管理</span>
                </Link>
                <Link 
                  href="/admin/store" 
                  className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-full text-sm font-medium transition-all hover:shadow-lg hover:shadow-purple-200"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span className="hidden sm:inline">商品管理</span>
                </Link>
                <Link 
                  href="/admin/settings" 
                  className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 text-white rounded-full text-sm font-medium transition-all hover:shadow-lg hover:shadow-slate-200"
                >
                  <span className="text-sm">⚙️</span>
                  <span className="hidden sm:inline">设置</span>
                </Link>
              </div>
            </div>
            
            {user && (
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 rounded-full border border-stone-200/50">
                  <div className="w-6 h-6 rounded-full bg-stone-300 flex items-center justify-center">
                    <UserIcon className="w-3 h-3 text-white" />
                  </div>
                  <span className="font-semibold text-stone-600 text-sm hidden sm:inline">{user.displayName}</span>
                </div>
                <button 
                  onClick={handleLogout} 
                  className="p-2 bg-stone-50 hover:bg-red-50 text-stone-400 hover:text-red-500 rounded-lg transition-colors"
                  title="退出登录"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* 移动端：快捷入口单独一行，避免标题/按钮挤压 */}
          <div className="sm:hidden pb-3">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
              <Link 
                href="/admin/lottery" 
                className="shrink-0 flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full text-sm font-medium shadow-sm"
              >
                <Sparkles className="w-4 h-4" />
                <span>抽奖</span>
              </Link>
              <Link 
                href="/admin/users" 
                className="shrink-0 flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-full text-sm font-medium shadow-sm"
              >
                <Users className="w-4 h-4" />
                <span>用户</span>
              </Link>
              <Link 
                href="/admin/store" 
                className="shrink-0 flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full text-sm font-medium shadow-sm"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>商品</span>
              </Link>
              <Link 
                href="/admin/settings" 
                className="shrink-0 flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-slate-600 to-slate-700 text-white rounded-full text-sm font-medium shadow-sm"
              >
                <span className="text-sm">⚙️</span>
                <span>设置</span>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-20">
        {/* 成功提示 */}
        {success && (
          <div className="mb-6 p-4 bg-emerald-50/80 backdrop-blur-sm rounded-2xl border border-emerald-100 flex justify-between items-center animate-fade-in shadow-sm">
            <div className="flex items-center gap-3 text-emerald-700">
              <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <Check className="w-3.5 h-3.5" />
              </div>
              <span className="font-semibold text-sm">{success}</span>
            </div>
            <button 
              onClick={() => setSuccess(null)} 
              className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 头部 */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-stone-800 mb-1 tracking-tight">项目列表</h1>
            <p className="text-stone-500 text-sm">创建和管理您的兑换码分发项目</p>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 gradient-warm text-white hover:opacity-90 transition-all rounded-xl font-bold shadow-lg shadow-orange-500/20 active:translate-y-0.5"
          >
            <Plus className="w-5 h-5" />
            新建项目
          </button>
        </div>

        {/* 项目列表容器 */}
        <div className="glass rounded-3xl shadow-sm overflow-hidden min-h-[400px]">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 px-4">
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4">
                <Package className="w-8 h-8 text-stone-400" />
              </div>
              <h2 className="text-lg font-bold text-stone-700 mb-1">暂无项目</h2>
              <p className="text-stone-500 text-sm">点击右上角按钮创建您的第一个项目</p>
            </div>
          ) : (
            <div>
              {/* Desktop Table Header */}
              <div className="hidden lg:grid grid-cols-[2fr_1fr_1.5fr_1fr_1fr_120px] px-8 py-4 bg-stone-50/80 border-b border-stone-200/60 text-xs font-bold text-stone-400 uppercase tracking-wider">
                <div className="pl-2">项目名称</div>
                <div>状态</div>
                <div>领取进度</div>
                <div>库存</div>
                <div>创建时间</div>
                <div className="text-right pr-2">操作</div>
              </div>
              
              <div className="divide-y divide-stone-100">
                {projects.map((project) => (
                  <Link 
                    key={project.id} 
                    href={`/admin/project/${project.id}`}
                    className="group block hover:bg-stone-50/50 transition-colors duration-200"
                  >
                    {/* Desktop View */}
                    <div className="hidden lg:grid grid-cols-[2fr_1fr_1.5fr_1fr_1fr_120px] px-8 py-5 items-center gap-4">
                      {/* Name */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-50 to-stone-100 flex items-center justify-center border border-stone-200 group-hover:border-orange-200 transition-colors">
                          <Gift className="w-5 h-5 text-orange-500" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-stone-700 text-[15px] truncate group-hover:text-orange-600 transition-colors">{project.name}</span>
                          {project.pinned && (
                            <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-bold border border-orange-200">📌</span>
                          )}
                          {project.newUserOnly && (
                            <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded text-xs font-bold border border-emerald-200">🆕</span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleTogglePinned(project, e)}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95 border ${
                              project.pinned
                                ? 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100'
                                : 'bg-white text-stone-400 border-stone-200 hover:text-orange-600 hover:border-orange-200 hover:bg-orange-50'
                            }`}
                            title={project.pinned ? '取消置顶' : '置顶'}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Status */}
                      <div>
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                          project.status === 'active' 
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                            : project.status === 'paused' 
                              ? 'bg-amber-50 text-amber-600 border-amber-100' 
                              : 'bg-stone-100 text-stone-500 border-stone-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            project.status === 'active' ? 'bg-emerald-500' : project.status === 'paused' ? 'bg-amber-500' : 'bg-stone-400'
                          }`}></span>
                          {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                        </span>
                      </div>

                      {/* Progress */}
                      <div className="pr-8">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-stone-600">{project.claimedCount}</span>
                          <span className="text-stone-300 text-xs">/</span>
                          <span className="text-xs text-stone-400">{project.maxClaims}</span>
                        </div>
                        <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, (project.claimedCount / project.maxClaims) * 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Stock - 显示剩余库存 */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-stone-600">{project.codesCount - project.claimedCount}</span>
                        <span className="text-xs text-stone-400">个</span>
                      </div>

                      {/* Date */}
                      <span className="text-sm text-stone-500">
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>

                      {/* Actions */}
                      <div className="flex justify-end gap-2" onClick={(e) => e.preventDefault()}>
                        <button 
                          onClick={(e) => handleToggleStatus(project, e)}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95 border ${
                            project.status === 'active' 
                              ? 'bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100' 
                              : 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100'
                          }`}
                          title={project.status === 'active' ? '暂停项目' : '启动项目'}
                        >
                          {project.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                        </button>
                        <button 
                          onClick={(e) => handleDelete(project, e)}
                          className="w-8 h-8 rounded-lg bg-white text-stone-400 border border-stone-200 hover:text-red-500 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                          title="删除项目"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <div className="w-8 h-8 rounded-lg bg-stone-50 text-stone-400 flex items-center justify-center border border-stone-100 group-hover:bg-white group-hover:border-orange-200 group-hover:text-orange-500 transition-all">
                            <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="lg:hidden p-5 flex flex-col gap-4 border-b border-stone-100 last:border-0">
                      {/* Card Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center border border-orange-100">
                            <Gift className="w-5 h-5 text-orange-500" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-stone-800 text-base">{project.name}</h3>
                              {project.pinned && (
                                <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-bold border border-orange-200">📌</span>
                              )}
                              {project.newUserOnly && (
                                <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded text-xs font-bold border border-emerald-200">🆕</span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => handleTogglePinned(project, e)}
                                className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
                                  project.pinned
                                    ? 'bg-orange-50 text-orange-600 border-orange-200'
                                    : 'bg-white text-stone-400 border-stone-200 hover:text-orange-600 hover:border-orange-200 hover:bg-orange-50'
                                }`}
                                title={project.pinned ? '取消置顶' : '置顶'}
                              >
                                <Pin className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-stone-400 mt-0.5">
                              <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-bold border ${
                          project.status === 'active' 
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                            : project.status === 'paused' 
                              ? 'bg-amber-50 text-amber-600 border-amber-100' 
                              : 'bg-stone-100 text-stone-500 border-stone-200'
                        }`}>
                          {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                        </span>
                      </div>

                      {/* Progress Section */}
                      <div className="bg-stone-50/50 rounded-xl p-4 border border-stone-100">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-semibold text-stone-500">领取进度</span>
                          <div className="text-xs">
                            <span className="font-bold text-stone-800">{project.claimedCount}</span>
                            <span className="text-stone-300 mx-1">/</span>
                            <span className="text-stone-500">{project.maxClaims}</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full"
                            style={{ width: `${Math.min(100, (project.claimedCount / project.maxClaims) * 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between items-center mt-3 pt-3 border-t border-stone-200/50">
                          <span className="text-xs text-stone-500">剩余库存</span>
                          <span className="font-bold text-stone-800 text-sm">{project.codesCount - project.claimedCount}</span>
                        </div>
                      </div>

                      {/* Card Actions */}
                      <div className="flex items-center gap-3 pt-1" onClick={(e) => e.preventDefault()}>
                        <button 
                          onClick={(e) => handleToggleStatus(project, e)}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                            project.status === 'active' 
                              ? 'bg-white text-amber-600 border-amber-200 hover:bg-amber-50' 
                              : 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50'
                          }`}
                        >
                          {project.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          {project.status === 'active' ? '暂停' : '启动'}
                        </button>
                        <button 
                          onClick={(e) => handleDelete(project, e)}
                          className="w-10 h-10 flex items-center justify-center bg-white text-stone-400 hover:text-red-500 rounded-xl border border-stone-200 hover:border-red-200"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="w-10 h-10 flex items-center justify-center bg-stone-100 text-stone-500 rounded-xl border border-stone-200">
                          <ChevronRight className="w-5 h-5" />
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 创建项目弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm transition-opacity"
            onClick={() => setShowCreateModal(false)}
          />
          
          {/* Modal Content */}
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-fade-in ring-1 ring-black/5 max-h-[90vh] my-6">
            {/* Header */}
            <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
              <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                创建新项目
              </h2>
              <button 
                onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 rounded-full hover:bg-stone-100 flex items-center justify-center text-stone-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateProject} className="p-6 overflow-y-auto max-h-[calc(90vh-72px)]">
              {error && (
                <div className="mb-5 p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2.5 text-red-600 text-sm font-medium">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">
                    项目名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如: 5刀福利"
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">
                    项目描述
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="简要描述活动内容..."
                    rows={3}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-medium resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">
                    限领人数 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={maxClaims}
                    onChange={(e) => setMaxClaims(e.target.value)}
                    min="1"
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">
                    奖励方式 <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setRewardType('code');
                      }}
                      className={`px-4 py-3 rounded-xl border text-sm font-bold transition-colors ${
                        rewardType === 'code'
                          ? 'bg-orange-50 text-orange-700 border-orange-200'
                          : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      兑换码
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRewardType('direct');
                        setCodesFile(null);
                      }}
                      className={`px-4 py-3 rounded-xl border text-sm font-bold transition-colors ${
                        rewardType === 'direct'
                          ? 'bg-orange-50 text-orange-700 border-orange-200'
                          : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      直充额度
                    </button>
                  </div>
                </div>

                {rewardType === 'direct' && (
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">
                      直充金额（USD） <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      value={directDollars}
                      onChange={(e) => setDirectDollars(e.target.value)}
                      min="0.01"
                      step="0.01"
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-stone-800 placeholder-stone-400 font-medium"
                    />
                    <p className="mt-2 text-xs text-stone-400 font-medium">
                      用户领取后将直接充值到其 new-api 账户余额。
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">
                    导入兑换码
                  </label>
                  {rewardType === 'direct' ? (
                    <div className="border border-stone-200 rounded-2xl p-5 bg-stone-50 text-center">
                      <p className="text-sm font-medium text-stone-600">直充项目无需上传兑换码</p>
                      <p className="text-xs text-stone-400 mt-1">库存与限领人数一致</p>
                    </div>
                  ) : (
                  <div className="group relative border-2 border-dashed border-stone-200 hover:border-orange-400 rounded-2xl p-6 transition-colors bg-stone-50 hover:bg-orange-50/30 text-center">
                    <input
                      type="file"
                      accept=".txt"
                      onChange={(e) => setCodesFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="w-12 h-12 bg-white rounded-full shadow-sm border border-stone-100 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform duration-200">
                      <Upload className="w-5 h-5 text-orange-500" />
                    </div>
                    <p className="text-sm font-medium text-stone-600">
                      {codesFile ? (
                        <span className="text-orange-600 font-bold">{codesFile.name}</span>
                      ) : (
                        <>点击选择 <span className="text-stone-900 font-bold">.txt</span> 文件</>
                      )}
                    </p>
                    <p className="text-xs text-stone-400 mt-1">每行一个兑换码</p>
                  </div>
                  )}
                </div>

                {/* 仅限新用户开关 */}
                <div className="flex items-center justify-between p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                      <span className="text-lg">🆕</span>
                    </div>
                    <div>
                      <p className="font-bold text-stone-800 text-sm">仅限新用户</p>
                      <p className="text-xs text-stone-500">只有未领取过任何福利的用户才能领取</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewUserOnly(!newUserOnly)}
                    className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
                      newUserOnly ? 'bg-emerald-500' : 'bg-stone-300'
                    }`}
                  >
                    <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${
                      newUserOnly ? 'left-6' : 'left-1'
                    }`} />
                  </button>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-3 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-xl font-bold transition-colors text-sm"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-3 gradient-warm hover:opacity-90 text-white rounded-xl font-bold shadow-lg shadow-orange-500/20 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all text-sm"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  {creating ? '创建中...' : '创建项目'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
