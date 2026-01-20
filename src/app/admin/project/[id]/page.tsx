'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, Loader2, AlertCircle, Users, Package, Clock, User as UserIcon, Check, X, Gift, FileText, Copy } from 'lucide-react';

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

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    // Optional: could add a toast here, but keeping it simple as per requirements to not add new dependencies
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#667eea] to-[#764ba2]">
        <div className="text-center text-white">
          <Loader2 className="w-12 h-12 animate-spin mx-auto" />
          <p className="mt-4 font-medium">加载项目数据...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#667eea] to-[#764ba2] p-6">
        <div className="bg-white rounded-3xl p-10 text-center max-w-md w-full shadow-2xl">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">出错了</h2>
          <p className="text-gray-500 mb-8">{error || '找不到该项目'}</p>
          <Link 
            href="/admin" 
            className="inline-flex items-center justify-center w-full px-6 py-3.5 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-xl font-semibold hover:shadow-lg transition-all active:scale-95"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            返回管理后台
          </Link>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, project.maxClaims - project.claimedCount);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2]">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm shadow-sm transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center py-4 sm:h-20 sm:py-0 gap-4 sm:gap-0">
            <div className="flex items-center gap-3">
              <Link href="/admin" className="flex items-center gap-2 text-gray-500 hover:text-[#667eea] transition-colors">
                <ArrowLeft className="w-5 h-5" />
                <span className="font-medium hidden sm:inline">返回</span>
              </Link>
              <span className="text-gray-300 hidden sm:inline">/</span>
              <span className="font-bold text-gray-800 text-lg truncate max-w-[200px] sm:max-w-md">{project.name}</span>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-8">
        {/* 提示消息 */}
        {success && (
          <div className="p-4 bg-white/95 backdrop-blur-sm rounded-2xl border-l-4 border-emerald-500 shadow-lg flex justify-between items-center animate-fade-in">
            <div className="flex items-center gap-3 text-emerald-700">
              <div className="p-2 bg-emerald-100 rounded-full">
                <Check className="w-5 h-5" />
              </div>
              <span className="font-semibold">{success}</span>
            </div>
            <button onClick={() => setSuccess(null)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        {error && (
          <div className="p-4 bg-white/95 backdrop-blur-sm rounded-2xl border-l-4 border-red-500 shadow-lg flex justify-between items-center animate-fade-in">
            <div className="flex items-center gap-3 text-red-700">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertCircle className="w-5 h-5" />
              </div>
              <span className="font-semibold">{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* 项目信息卡片 */}
        <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 bg-gradient-to-br from-[#667eea] to-[#764ba2] rounded-2xl flex items-center justify-center shadow-lg transform rotate-3 hover:rotate-0 transition-all duration-300">
                <Gift className="w-8 h-8 text-white" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">{project.name}</h1>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    project.status === 'active' 
                      ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-500/20' 
                      : project.status === 'paused' 
                        ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-500/20' 
                        : 'bg-gray-100 text-gray-600 ring-1 ring-gray-500/20'
                  }`}>
                    {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                  </span>
                </div>
                <p className="text-gray-500 mt-2 text-sm md:text-base leading-relaxed max-w-2xl">{project.description || '暂无描述'}</p>
              </div>
            </div>
            
            <label className={`group relative inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-2xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 active:scale-95 cursor-pointer overflow-hidden ${uploading ? 'opacity-70 cursor-not-allowed' : ''}`}>
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
              <Upload className={`w-5 h-5 relative z-10 ${uploading ? 'animate-bounce' : ''}`} />
              <span className="relative z-10">{uploading ? '上传中...' : '追加兑换码'}</span>
              <input type="file" accept=".txt" onChange={handleUploadCodes} disabled={uploading} className="hidden" />
            </label>
          </div>

          {/* 统计网格 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-2xl p-5 md:p-6 border border-indigo-100/50 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 text-indigo-600 mb-2">
                <Users className="w-4 h-4 md:w-5 md:h-5" />
                <span className="text-xs md:text-sm font-bold uppercase tracking-wide">已领取</span>
              </div>
              <p className="text-2xl md:text-4xl font-black text-gray-900">{project.claimedCount}</p>
            </div>
            
            <div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-2xl p-5 md:p-6 border border-pink-100/50 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 text-pink-600 mb-2">
                <Users className="w-4 h-4 md:w-5 md:h-5" />
                <span className="text-xs md:text-sm font-bold uppercase tracking-wide">剩余名额</span>
              </div>
              <p className="text-2xl md:text-4xl font-black text-gray-900">{remaining}</p>
            </div>
            
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl p-5 md:p-6 border border-emerald-100/50 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 text-emerald-600 mb-2">
                <Package className="w-4 h-4 md:w-5 md:h-5" />
                <span className="text-xs md:text-sm font-bold uppercase tracking-wide">库存总量</span>
              </div>
              <p className="text-2xl md:text-4xl font-black text-gray-900">{project.codesCount}</p>
            </div>
            
            <div className="bg-gradient-to-br from-blue-50 to-sky-50 rounded-2xl p-5 md:p-6 border border-blue-100/50 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 text-blue-600 mb-2">
                <Clock className="w-4 h-4 md:w-5 md:h-5" />
                <span className="text-xs md:text-sm font-bold uppercase tracking-wide">创建时间</span>
              </div>
              <p className="text-sm md:text-base font-bold text-gray-900 truncate">
                {new Date(project.createdAt).toLocaleDateString()}
              </p>
              <p className="text-xs text-blue-400 mt-1">
                {new Date(project.createdAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </div>

        {/* 分发记录 - 卡片列表模式 */}
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 backdrop-blur-md rounded-lg text-white">
                <FileText className="w-5 h-5" />
              </div>
              <h2 className="text-xl md:text-2xl font-bold text-white">分发记录</h2>
            </div>
            <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-sm font-semibold text-white">
              {records.length} 条
            </span>
          </div>

          {records.length === 0 ? (
            <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-xl p-12 md:p-20 text-center">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Users className="w-10 h-10 text-gray-300" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">暂无分发记录</h3>
              <p className="text-gray-500">该项目尚未被领取过</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {records.map((record) => (
                <div 
                  key={record.id} 
                  className="bg-white/95 backdrop-blur-sm rounded-2xl p-5 shadow-lg border border-white/20 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center shadow-md ring-2 ring-white">
                        <UserIcon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 leading-tight">{record.username}</p>
                        <p className="text-xs font-medium text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md inline-block mt-1">
                          ID: {record.userId}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <div 
                      onClick={() => handleCopyCode(record.code)}
                      className="relative bg-gray-50 rounded-xl p-3 border border-gray-100 group-hover:border-indigo-200 transition-colors cursor-pointer active:scale-[0.98]"
                      title="点击复制"
                    >
                      <p className="font-mono text-sm text-indigo-600 break-all text-center font-semibold">
                        {record.code}
                      </p>
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Copy className="w-3 h-3 text-gray-400" />
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 border-t border-gray-100 pt-3">
                    <Clock className="w-3.5 h-3.5" />
                    <span>领取于 {new Date(record.claimedAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
