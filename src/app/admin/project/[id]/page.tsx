'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, Loader2, AlertCircle, Users, Package, Clock, User as UserIcon } from 'lucide-react';

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center max-w-md w-full">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">出错了</h2>
          <p className="text-gray-600 mb-6">{error || '找不到该项目'}</p>
          <Link href="/admin" className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 w-full">
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回管理后台
          </Link>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, project.maxClaims - project.claimedCount);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/admin" className="flex items-center text-gray-500 hover:text-gray-900">
                <ArrowLeft className="w-5 h-5 mr-2" />
                <span className="font-medium">返回管理后台</span>
              </Link>
            </div>
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
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-xl">&times;</button>
          </div>
        )}

        {/* Project Info */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{project.name}</h1>
              <p className="text-gray-500">{project.description || '暂无描述'}</p>
            </div>
            <div className="flex-shrink-0">
              {project.status === 'active' && <span className="px-3 py-1 text-sm font-semibold rounded-full bg-green-100 text-green-600">进行中</span>}
              {project.status === 'paused' && <span className="px-3 py-1 text-sm font-semibold rounded-full bg-yellow-100 text-yellow-600">已暂停</span>}
              {project.status === 'exhausted' && <span className="px-3 py-1 text-sm font-semibold rounded-full bg-gray-100 text-gray-600">已领完</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center text-gray-500 mb-1">
                <Users className="w-4 h-4 mr-2" />
                <span className="text-sm">已领取</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{project.claimedCount}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center text-gray-500 mb-1">
                <Users className="w-4 h-4 mr-2" />
                <span className="text-sm">剩余名额</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{remaining}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center text-gray-500 mb-1">
                <Package className="w-4 h-4 mr-2" />
                <span className="text-sm">兑换码总数</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{project.codesCount}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center text-gray-500 mb-1">
                <Clock className="w-4 h-4 mr-2" />
                <span className="text-sm">创建时间</span>
              </div>
              <p className="text-sm font-medium text-gray-900">{new Date(project.createdAt).toLocaleString()}</p>
            </div>
          </div>

          {/* Upload Codes */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 mb-3">追加兑换码</h3>
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 cursor-pointer">
                <Upload className="w-4 h-4 mr-2" />
                {uploading ? '上传中...' : '选择 .txt 文件'}
                <input type="file" accept=".txt" onChange={handleUploadCodes} disabled={uploading} className="sr-only" />
              </label>
              <span className="text-sm text-gray-500">每行一个兑换码</span>
            </div>
          </div>
        </div>

        {/* Claim Records */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">分发记录</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">兑换码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">领取时间</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {records.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 mr-3">
                          <UserIcon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{record.username}</p>
                          <p className="text-xs text-gray-500">ID: {record.userId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded">{record.code}</code>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(record.claimedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center">
                      <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">暂无分发记录</p>
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
