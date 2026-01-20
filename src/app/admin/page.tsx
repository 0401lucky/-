'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Plus, Pause, Play, Trash2, Upload, 
  Loader2, AlertCircle, Users, Package, LayoutDashboard,
  ChevronRight, LogOut, User as UserIcon, X, Check, Gift
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
  const [codesFile, setCodesFile] = useState<File | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
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
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请输入项目名称');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('description', description.trim());
      formData.append('maxClaims', maxClaims);
      if (codesFile) {
        formData.append('codes', codesFile);
      }

      const res = await fetch('/api/admin/projects', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      
      if (data.success) {
        setSuccess(`项目创建成功! 添加了 ${data.codesAdded} 个兑换码`);
        setShowCreateModal(false);
        setName('');
        setDescription('');
        setMaxClaims('100');
        setCodesFile(null);
        fetchData();
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError(data.message || '创建失败');
      }
    } catch (err) {
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

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#667eea] to-[#764ba2]">
        <div className="text-center text-white">
          <Loader2 className="w-12 h-12 animate-spin mx-auto" />
          <p className="mt-4 text-lg font-medium">加载管理后台...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2]">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm shadow-sm border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16 sm:h-[70px]">
            <div className="flex items-center gap-4 sm:gap-6">
              <Link href="/" className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors">
                <ArrowLeft className="w-5 h-5" />
                <span className="font-medium hidden sm:inline">返回</span>
              </Link>
              <div className="w-px h-6 bg-gray-200 hidden sm:block" />
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center shadow-md">
                  <LayoutDashboard className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg sm:text-xl font-bold text-gray-800">管理后台</span>
              </div>
            </div>
            
            {user && (
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-2 sm:gap-3 px-3 py-1.5 sm:px-4 sm:py-2 bg-gray-50 rounded-full border border-gray-100">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center ring-2 ring-white">
                    <UserIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                  </div>
                  <span className="font-semibold text-gray-700 text-sm hidden sm:inline">{user.displayName}</span>
                </div>
                <button 
                  onClick={handleLogout} 
                  className="p-2 sm:p-2.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl transition-colors"
                  title="退出登录"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-20">
        {/* 成功提示 */}
        {success && (
          <div className="mb-6 p-4 bg-white/95 backdrop-blur-sm rounded-2xl border-2 border-green-500 shadow-lg flex justify-between items-center animate-fade-in">
            <div className="flex items-center gap-3 text-green-600">
              <Check className="w-5 h-5 flex-shrink-0" />
              <span className="font-semibold">{success}</span>
            </div>
            <button 
              onClick={() => setSuccess(null)} 
              className="p-1 hover:bg-green-50 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* 头部 */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-2 drop-shadow-sm">项目管理</h1>
            <p className="text-white/80 text-sm sm:text-base">创建和管理兑换码分发项目</p>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-3.5 bg-white text-[#667eea] hover:bg-gray-50 active:scale-95 transition-all rounded-2xl font-bold shadow-xl shadow-indigo-900/20"
          >
            <Plus className="w-5 h-5" />
            创建新项目
          </button>
        </div>

        {/* 项目列表容器 */}
        <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden min-h-[300px]">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-4">
              <div className="w-20 h-20 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-full flex items-center justify-center mb-6">
                <Package className="w-10 h-10 text-[#667eea]" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">暂无项目</h2>
              <p className="text-gray-500">点击上方按钮创建您的第一个项目</p>
            </div>
          ) : (
            <div>
              {/* Desktop Table Header */}
              <div className="hidden lg:grid grid-cols-[2fr_1fr_1.5fr_1fr_1fr_120px] px-6 py-4 bg-gray-50/50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <div className="pl-2">项目名称</div>
                <div>状态</div>
                <div>领取进度</div>
                <div>库存</div>
                <div>创建时间</div>
                <div className="text-right pr-2">操作</div>
              </div>
              
              <div className="divide-y divide-gray-100">
                {projects.map((project) => (
                  <Link 
                    key={project.id} 
                    href={`/admin/project/${project.id}`}
                    className="group block hover:bg-gray-50 transition-colors duration-200"
                  >
                    {/* Desktop View */}
                    <div className="hidden lg:grid grid-cols-[2fr_1fr_1.5fr_1fr_1fr_120px] px-6 py-5 items-center gap-4">
                      {/* Name */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                          <Gift className="w-5 h-5 text-white" />
                        </div>
                        <span className="font-semibold text-gray-800 text-[15px] truncate pr-4">{project.name}</span>
                      </div>

                      {/* Status */}
                      <div>
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${
                          project.status === 'active' 
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                            : project.status === 'paused' 
                              ? 'bg-amber-50 text-amber-600 border-amber-100' 
                              : 'bg-gray-100 text-gray-500 border-gray-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            project.status === 'active' ? 'bg-emerald-500' : project.status === 'paused' ? 'bg-amber-500' : 'bg-gray-400'
                          }`}></span>
                          {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                        </span>
                      </div>

                      {/* Progress */}
                      <div className="pr-8">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Users className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-semibold text-gray-700">{project.claimedCount}</span>
                          <span className="text-gray-400 text-xs">/</span>
                          <span className="text-sm text-gray-500">{project.maxClaims}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, (project.claimedCount / project.maxClaims) * 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Stock */}
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-gray-400" />
                        <span className="font-semibold text-gray-700">{project.codesCount}</span>
                      </div>

                      {/* Date */}
                      <span className="text-sm text-gray-500">
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>

                      {/* Actions */}
                      <div className="flex justify-end gap-2" onClick={(e) => e.preventDefault()}>
                        <button 
                          onClick={(e) => handleToggleStatus(project, e)}
                          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${
                            project.status === 'active' 
                              ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' 
                              : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          }`}
                          title={project.status === 'active' ? '暂停项目' : '启动项目'}
                        >
                          {project.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                        </button>
                        <button 
                          onClick={(e) => handleDelete(project, e)}
                          className="w-9 h-9 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                          title="删除项目"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer">
                            <ChevronRight className="w-5 h-5" />
                        </div>
                      </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="lg:hidden p-5 flex flex-col gap-4">
                      {/* Card Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center shadow-md">
                            <Gift className="w-6 h-6 text-white" />
                          </div>
                          <div>
                            <h3 className="font-bold text-gray-800 text-lg">{project.name}</h3>
                            <div className="flex items-center gap-2 text-sm text-gray-500 mt-0.5">
                              <span className="text-xs">{new Date(project.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                          project.status === 'active' 
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                            : project.status === 'paused' 
                              ? 'bg-amber-50 text-amber-600 border-amber-100' 
                              : 'bg-gray-100 text-gray-500 border-gray-200'
                        }`}>
                          {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                        </span>
                      </div>

                      {/* Progress Section */}
                      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-600">
                            <Users className="w-4 h-4" />
                            <span>领取进度</span>
                          </div>
                          <div className="text-sm">
                            <span className="font-bold text-gray-900">{project.claimedCount}</span>
                            <span className="text-gray-400 mx-1">/</span>
                            <span className="text-gray-500">{project.maxClaims}</span>
                          </div>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-full"
                            style={{ width: `${Math.min(100, (project.claimedCount / project.maxClaims) * 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-200/50">
                          <div className="flex items-center gap-1.5 text-sm text-gray-600">
                            <Package className="w-4 h-4" />
                            <span>剩余库存</span>
                          </div>
                          <span className="font-bold text-gray-900">{project.codesCount}</span>
                        </div>
                      </div>

                      {/* Card Actions */}
                      <div className="flex items-center gap-3 pt-1" onClick={(e) => e.preventDefault()}>
                        <button 
                          onClick={(e) => handleToggleStatus(project, e)}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors ${
                            project.status === 'active' 
                              ? 'bg-amber-50 text-amber-600 border border-amber-100' 
                              : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                          }`}
                        >
                          {project.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                          {project.status === 'active' ? '暂停' : '启动'}
                        </button>
                        <button 
                          onClick={(e) => handleDelete(project, e)}
                          className="w-12 h-12 flex items-center justify-center bg-red-50 text-red-500 rounded-xl border border-red-100"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                        <div className="w-12 h-12 flex items-center justify-center bg-gray-100 text-gray-500 rounded-xl border border-gray-200 cursor-pointer">
                          <ChevronRight className="w-6 h-6" />
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setShowCreateModal(false)}
          />
          
          {/* Modal Content */}
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-[#667eea]" />
                </div>
                创建新项目
              </h2>
              <button 
                onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateProject} className="p-6">
              {error && (
                <div className="mb-5 p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2.5 text-red-600 text-sm font-medium">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    项目名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如: 5刀福利"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-[#667eea] focus:ring-4 focus:ring-indigo-100 transition-all outline-none text-gray-800 placeholder-gray-400 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    项目描述
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="可选"
                    rows={3}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-[#667eea] focus:ring-4 focus:ring-indigo-100 transition-all outline-none text-gray-800 placeholder-gray-400 font-medium resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    限领人数 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={maxClaims}
                    onChange={(e) => setMaxClaims(e.target.value)}
                    min="1"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-[#667eea] focus:ring-4 focus:ring-indigo-100 transition-all outline-none text-gray-800 placeholder-gray-400 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    导入兑换码
                  </label>
                  <div className="group relative border-2 border-dashed border-gray-300 hover:border-[#667eea] rounded-2xl p-6 transition-colors bg-gray-50 hover:bg-indigo-50/50 text-center">
                    <input
                      type="file"
                      accept=".txt"
                      onChange={(e) => setCodesFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="w-14 h-14 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform duration-200">
                      <Upload className="w-6 h-6 text-[#667eea]" />
                    </div>
                    <p className="text-sm font-medium text-gray-600">
                      {codesFile ? (
                        <span className="text-[#667eea] font-bold">{codesFile.name}</span>
                      ) : (
                        <>点击选择 <span className="text-gray-900 font-bold">.txt</span> 文件</>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">每行一个兑换码</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-3.5 bg-gradient-to-r from-[#667eea] to-[#764ba2] hover:opacity-90 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/20 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                >
                  {creating && <Loader2 className="w-5 h-5 animate-spin" />}
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
