'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Plus, Pause, Play, Trash2, Upload, 
  Loader2, AlertCircle, Users, Package, LayoutDashboard,
  ChevronRight, LogOut, User as UserIcon
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
      } else {
        setError(data.message || '创建失败');
      }
    } catch (err) {
      setError('请求失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (project: Project) => {
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

  const handleDelete = async (project: Project) => {
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center text-gray-500 hover:text-gray-900">
                <ArrowLeft className="w-5 h-5 mr-2" />
                <span className="font-medium hidden sm:inline">返回</span>
              </Link>
              <div className="h-6 w-px bg-gray-200" />
              <div className="flex items-center space-x-2">
                <LayoutDashboard className="w-5 h-5 text-blue-600" />
                <span className="font-semibold text-gray-900">管理后台</span>
              </div>
            </div>
            {user && (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2 text-sm text-gray-700">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <span className="font-medium hidden sm:block">{user.displayName}</span>
                </div>
                <button onClick={handleLogout} className="p-2 rounded-full text-gray-500 hover:text-red-600 hover:bg-red-50">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center justify-between">
            <span>{success}</span>
            <button onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 text-xl">&times;</button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">项目管理</h1>
            <p className="mt-1 text-gray-500">管理兑换码项目和分发记录</p>
          </div>
          <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            创建新项目
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">项目名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">领取进度</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">兑换码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link href={`/admin/project/${project.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 flex items-center">
                        {project.name}
                        <ChevronRight className="w-4 h-4 ml-1 text-gray-400" />
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {project.status === 'active' && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-600">进行中</span>}
                      {project.status === 'paused' && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-600">已暂停</span>}
                      {project.status === 'exhausted' && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">已领完</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Users className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">{project.claimedCount} / {project.maxClaims}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Package className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">{project.codesCount}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <button onClick={() => handleToggleStatus(project)} className={`p-2 rounded-md ${project.status === 'active' ? 'text-yellow-600 hover:bg-yellow-50' : 'text-green-600 hover:bg-green-50'}`}>
                        {project.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button onClick={() => handleDelete(project)} className="p-2 rounded-md text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {projects.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">暂无项目</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-900">创建新项目</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-500 text-2xl">&times;</button>
            </div>
            <form onSubmit={handleCreateProject} className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 text-red-600 px-4 py-3 rounded-md text-sm flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  {error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">项目名称 *</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="例如: 5刀福利" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">项目描述</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" placeholder="可选" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">限领人数 *</label>
                <input type="number" value={maxClaims} onChange={(e) => setMaxClaims(e.target.value)} min="1" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">导入兑换码</label>
                <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg hover:border-blue-400">
                  <div className="space-y-1 text-center">
                    <Upload className="mx-auto h-10 w-10 text-gray-400" />
                    <div className="flex text-sm text-gray-600">
                      <label className="relative cursor-pointer font-medium text-blue-600 hover:text-blue-500">
                        <span>选择文件</span>
                        <input type="file" accept=".txt" onChange={(e) => setCodesFile(e.target.files?.[0] || null)} className="sr-only" />
                      </label>
                    </div>
                    <p className="text-xs text-gray-500">{codesFile ? codesFile.name : '.txt 文件，每行一个兑换码'}</p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
                <button type="submit" disabled={creating} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 inline-flex items-center">
                  {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
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
