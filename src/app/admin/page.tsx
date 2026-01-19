'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Plus, Pause, Play, Trash2, Upload, 
  Loader2, AlertCircle, Users, Package, LayoutDashboard,
  ChevronRight, LogOut, User as UserIcon, X, Check, FileText
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50/50 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
          <p className="text-gray-500 text-sm font-medium">加载管理后台...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 selection:bg-indigo-100 selection:text-indigo-900">
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none z-0"></div>

      <nav className="sticky top-0 z-10 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center text-gray-500 hover:text-indigo-600 transition-colors group">
                <ArrowLeft className="w-5 h-5 mr-2 group-hover:-translate-x-1 transition-transform" />
                <span className="font-medium hidden sm:inline">返回首页</span>
              </Link>
              <div className="h-6 w-px bg-gray-200" />
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-indigo-50 rounded-lg">
                  <LayoutDashboard className="w-5 h-5 text-indigo-600" />
                </div>
                <span className="font-bold text-gray-900">管理后台</span>
              </div>
            </div>
            {user && (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2 text-sm text-gray-700 bg-gray-50/50 px-3 py-1.5 rounded-full border border-gray-200/50">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs">
                    <UserIcon className="w-3 h-3" />
                  </div>
                  <span className="font-medium hidden sm:block">{user.displayName}</span>
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

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {success && (
          <div className="mb-6 bg-emerald-50/80 backdrop-blur-sm border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl flex items-center justify-between shadow-sm animate-in slide-in-from-top-2">
            <div className="flex items-center">
              <div className="w-5 h-5 bg-emerald-100 rounded-full flex items-center justify-center mr-2">
                <Check className="w-3 h-3 text-emerald-600" />
              </div>
              <span>{success}</span>
            </div>
            <button onClick={() => setSuccess(null)} className="text-emerald-500 hover:text-emerald-700 p-1 rounded-full hover:bg-emerald-100/50 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">项目管理</h1>
            <p className="mt-1 text-gray-500">创建新项目，管理兑换码分发状态</p>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="inline-flex items-center px-4 py-2.5 text-sm font-bold rounded-xl text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 transform hover:-translate-y-0.5 transition-all duration-200"
          >
            <Plus className="w-5 h-5 mr-2" />
            创建新项目
          </button>
        </div>

        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200/50">
              <thead className="bg-gray-50/50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">项目名称</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">领取进度</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">库存</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">创建时间</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-gray-50/80 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link href={`/admin/project/${project.id}`} className="flex items-center">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center mr-3 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                          <Package className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                          {project.name}
                        </span>
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {project.status === 'active' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5 animate-pulse"></span>
                          进行中
                        </span>
                      )}
                      {project.status === 'paused' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                          已暂停
                        </span>
                      )}
                      {project.status === 'exhausted' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                          已领完
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Users className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm font-medium text-gray-700">{project.claimedCount}</span>
                        <span className="text-xs text-gray-400 mx-1">/</span>
                        <span className="text-sm text-gray-500">{project.maxClaims}</span>
                      </div>
                      <div className="w-24 h-1 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                        <div 
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.min(100, (project.claimedCount / project.maxClaims) * 100)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <FileText className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm font-medium text-gray-900">{project.codesCount}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <button 
                        onClick={(e) => handleToggleStatus(project, e)} 
                        className={`p-2 rounded-lg transition-colors ${
                          project.status === 'active' 
                            ? 'text-amber-600 hover:bg-amber-50 bg-amber-50/50' 
                            : 'text-emerald-600 hover:bg-emerald-50 bg-emerald-50/50'
                        }`}
                        title={project.status === 'active' ? '暂停' : '恢复'}
                      >
                        {project.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button 
                        onClick={(e) => handleDelete(project, e)} 
                        className="p-2 rounded-lg text-red-600 hover:bg-red-50 bg-red-50/50 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <Link 
                        href={`/admin/project/${project.id}`}
                        className="inline-flex p-2 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        title="详情"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
                {projects.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Package className="w-8 h-8 text-gray-300" />
                      </div>
                      <h3 className="text-lg font-medium text-gray-900">暂无项目</h3>
                      <p className="text-gray-500 mt-1">点击右上角创建您的第一个兑换码项目</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full transform scale-100 animate-in zoom-in-95 duration-200">
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-2xl">
              <h2 className="text-lg font-bold text-gray-900 flex items-center">
                <Plus className="w-5 h-5 mr-2 text-indigo-600" />
                创建新项目
              </h2>
              <button 
                onClick={() => setShowCreateModal(false)} 
                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateProject} className="p-6 space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  {error}
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">项目名称 <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all" 
                  placeholder="例如: 5刀福利" 
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">项目描述</label>
                <textarea 
                  value={description} 
                  onChange={(e) => setDescription(e.target.value)} 
                  rows={3} 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none transition-all" 
                  placeholder="请输入项目描述信息（可选）" 
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">限领人数 <span className="text-red-500">*</span></label>
                <input 
                  type="number" 
                  value={maxClaims} 
                  onChange={(e) => setMaxClaims(e.target.value)} 
                  min="1" 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all" 
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">导入兑换码</label>
                <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-200 border-dashed rounded-xl hover:border-indigo-400 hover:bg-gray-50 transition-all group cursor-pointer relative">
                  <input 
                    type="file" 
                    accept=".txt" 
                    onChange={(e) => setCodesFile(e.target.files?.[0] || null)} 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                  />
                  <div className="space-y-2 text-center pointer-events-none">
                    <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                      <Upload className="h-6 w-6 text-indigo-500" />
                    </div>
                    <div className="flex text-sm text-gray-600 justify-center">
                      <span className="font-semibold text-indigo-600">点击上传</span>
                      <span className="pl-1">或拖拽文件到此处</span>
                    </div>
                    <p className="text-xs text-gray-500">{codesFile ? <span className="text-indigo-600 font-medium">{codesFile.name}</span> : '.txt 文件，每行一个兑换码'}</p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button 
                  type="button" 
                  onClick={() => setShowCreateModal(false)} 
                  className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  disabled={creating} 
                  className="px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center shadow-md shadow-indigo-500/20 transition-all transform active:scale-95"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      创建中...
                    </>
                  ) : '创建项目'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
