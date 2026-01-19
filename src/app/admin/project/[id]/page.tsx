'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Upload, Loader2, AlertCircle, Users, Package, Clock, 
  User as UserIcon, Check, FileText, ChevronRight, Hash, LogOut
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

interface ClaimRecord {
  id: string;
  projectId: string;
  userId: number;
  username: string;
  code: string;
  claimedAt: number;
}

export default function AdminProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [records, setRecords] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchData();
  }, [id]);

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

      const res = await fetch(`/api/admin/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setProject(data.project);
          setRecords(data.records || []);
        } else {
          setError(data.message);
        }
      } else {
        setError('项目不存在');
      }
    } catch (err) {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadCodes = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('codes', file);

      const res = await fetch(`/api/admin/projects/${id}`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      
      if (data.success) {
        setSuccess(`成功添加 ${data.codesAdded} 个兑换码`);
        fetchData();
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError(data.message || '上传失败');
      }
    } catch (err) {
      setError('上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
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
          <p className="text-gray-500 text-sm font-medium">加载项目数据...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white/80 backdrop-blur-xl p-8 rounded-2xl shadow-xl border border-white/50 text-center max-w-md w-full">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">出错了</h2>
          <p className="text-gray-600 mb-6">{error || '找不到该项目'}</p>
          <Link 
            href="/admin" 
            className="inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 w-full"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回管理后台
          </Link>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, project.maxClaims - project.claimedCount);

  return (
    <div className="min-h-screen bg-gray-50 selection:bg-indigo-100 selection:text-indigo-900">
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none z-0"></div>

      <nav className="sticky top-0 z-10 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-2">
              <Link href="/admin" className="flex items-center text-gray-500 hover:text-indigo-600 transition-colors group">
                <ArrowLeft className="w-5 h-5 mr-1 group-hover:-translate-x-1 transition-transform" />
                <span className="font-medium hidden sm:inline">返回管理后台</span>
              </Link>
              <ChevronRight className="w-4 h-4 text-gray-300 hidden sm:block" />
              <span className="text-gray-900 font-medium truncate max-w-[150px] sm:max-w-xs">{project.name}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="退出登录"
            >
              <LogOut className="w-5 h-5" />
            </button>
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
              <Check className="w-4 h-4" />
            </button>
          </div>
        )}
        {error && (
          <div className="mb-6 bg-red-50/80 backdrop-blur-sm border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between shadow-sm animate-in slide-in-from-top-2">
            <div className="flex items-center">
               <AlertCircle className="w-5 h-5 mr-2" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100/50 transition-colors">
              <Check className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Project Info */}
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 p-6 sm:p-8 mb-8">
          <div className="flex flex-col md:flex-row justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{project.name}</h1>
                {project.status === 'active' && <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 animate-pulse">进行中</span>}
                {project.status === 'paused' && <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-200">已暂停</span>}
                {project.status === 'exhausted' && <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-gray-100 text-gray-800 border border-gray-200">已领完</span>}
              </div>
              <p className="text-gray-500 max-w-2xl leading-relaxed">{project.description || '暂无描述信息'}</p>
            </div>
            
            <div className="flex-shrink-0">
               <label className="group relative inline-flex items-center justify-center px-6 py-3 border border-indigo-200 text-sm font-medium rounded-xl text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-300 cursor-pointer transition-all shadow-sm overflow-hidden">
                <div className="absolute inset-0 w-full h-full bg-indigo-100/50 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500"></div>
                <div className="relative flex items-center">
                   <Upload className={`w-5 h-5 mr-2 ${uploading ? 'animate-bounce' : ''}`} />
                   {uploading ? '正在上传...' : '追加兑换码'}
                </div>
                <input type="file" accept=".txt" onChange={handleUploadCodes} disabled={uploading} className="sr-only" />
              </label>
              <p className="mt-2 text-xs text-center text-gray-400">支持 .txt 格式导入</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            <div className="bg-gradient-to-br from-indigo-50 to-white rounded-xl p-5 border border-indigo-100/50 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                 <Users className="w-16 h-16 text-indigo-600 transform rotate-12 translate-x-4 -translate-y-4" />
              </div>
              <div className="flex items-center text-indigo-600/70 mb-2 font-medium">
                <Users className="w-4 h-4 mr-2" />
                <span className="text-sm">已领取人数</span>
              </div>
              <p className="text-3xl font-bold text-gray-900">{project.claimedCount}</p>
            </div>
            
            <div className="bg-gradient-to-br from-purple-50 to-white rounded-xl p-5 border border-purple-100/50 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                 <Package className="w-16 h-16 text-purple-600 transform rotate-12 translate-x-4 -translate-y-4" />
              </div>
              <div className="flex items-center text-purple-600/70 mb-2 font-medium">
                <Package className="w-4 h-4 mr-2" />
                <span className="text-sm">剩余名额</span>
              </div>
              <p className="text-3xl font-bold text-gray-900">{remaining}</p>
            </div>
            
            <div className="bg-gradient-to-br from-pink-50 to-white rounded-xl p-5 border border-pink-100/50 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
               <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                 <Hash className="w-16 h-16 text-pink-600 transform rotate-12 translate-x-4 -translate-y-4" />
              </div>
              <div className="flex items-center text-pink-600/70 mb-2 font-medium">
                <Hash className="w-4 h-4 mr-2" />
                <span className="text-sm">库存总量</span>
              </div>
              <p className="text-3xl font-bold text-gray-900">{project.codesCount}</p>
            </div>
            
            <div className="bg-gradient-to-br from-blue-50 to-white rounded-xl p-5 border border-blue-100/50 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
               <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                 <Clock className="w-16 h-16 text-blue-600 transform rotate-12 translate-x-4 -translate-y-4" />
              </div>
              <div className="flex items-center text-blue-600/70 mb-2 font-medium">
                <Clock className="w-4 h-4 mr-2" />
                <span className="text-sm">创建时间</span>
              </div>
              <p className="text-sm font-semibold text-gray-900 mt-2">{new Date(project.createdAt).toLocaleDateString()}</p>
              <p className="text-xs text-gray-500">{new Date(project.createdAt).toLocaleTimeString()}</p>
            </div>
          </div>
        </div>

        {/* Claim Records */}
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/30">
            <h2 className="text-lg font-bold text-gray-900 flex items-center">
              <FileText className="w-5 h-5 mr-2 text-indigo-500" />
              分发记录
              <span className="ml-2 px-2.5 py-0.5 rounded-full bg-gray-100 text-xs font-medium text-gray-600 border border-gray-200">
                {records.length} 条记录
              </span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50/50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">领取用户</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">兑换码</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">领取时间</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-50">
                {records.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-indigo-600 mr-3 border border-indigo-200/50">
                          <UserIcon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{record.username}</p>
                          <p className="text-xs text-gray-400">ID: {record.userId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-sm font-mono text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-100">{record.code}</code>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(record.claimedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-16 text-center">
                      <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Users className="w-8 h-8 text-gray-300" />
                      </div>
                      <p className="text-gray-900 font-medium">暂无分发记录</p>
                      <p className="text-gray-500 text-sm mt-1">该项目尚未被领取过</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
