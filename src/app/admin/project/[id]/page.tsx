'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, Loader2, AlertCircle, Users, Package, Clock, User as UserIcon, Check, X, Gift, FileText } from 'lucide-react';

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

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <Loader2 style={{ width: 48, height: 48, animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 16 }}>加载项目数据...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 24 }}>
        <div style={{ background: 'white', borderRadius: 24, padding: 40, textAlign: 'center', maxWidth: 400, width: '100%', boxShadow: '0 25px 80px rgba(0,0,0,0.25)' }}>
          <div style={{ width: 64, height: 64, background: '#fef2f2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <AlertCircle style={{ width: 32, height: 32, color: '#ef4444' }} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>出错了</h2>
          <p style={{ color: '#6b7280', marginBottom: 24 }}>{error || '找不到该项目'}</p>
          <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '14px 28px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', borderRadius: 12, textDecoration: 'none', fontWeight: 600, width: '100%' }}>
            <ArrowLeft style={{ width: 18, height: 18, marginRight: 8 }} />
            返回管理后台
          </Link>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, project.maxClaims - project.claimedCount);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      {/* 导航栏 */}
      <nav style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 70 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', textDecoration: 'none' }}>
                <ArrowLeft style={{ width: 20, height: 20 }} />
                <span style={{ fontWeight: 500 }}>返回管理后台</span>
              </Link>
              <span style={{ color: '#d1d5db' }}>/</span>
              <span style={{ fontWeight: 600, color: '#1f2937' }}>{project.name}</span>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* 提示消息 */}
        {success && (
          <div style={{ marginBottom: 24, padding: '16px 20px', background: 'rgba(255,255,255,0.95)', borderRadius: 16, border: '2px solid #10b981', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#059669' }}>
              <Check style={{ width: 20, height: 20 }} />
              <span style={{ fontWeight: 600 }}>{success}</span>
            </div>
            <button onClick={() => setSuccess(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
              <X style={{ width: 20, height: 20 }} />
            </button>
          </div>
        )}
        {error && (
          <div style={{ marginBottom: 24, padding: '16px 20px', background: 'rgba(255,255,255,0.95)', borderRadius: 16, border: '2px solid #ef4444', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#dc2626' }}>
              <AlertCircle style={{ width: 20, height: 20 }} />
              <span style={{ fontWeight: 600 }}>{error}</span>
            </div>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
              <X style={{ width: 20, height: 20 }} />
            </button>
          </div>
        )}

        {/* 项目信息 */}
        <div style={{ background: 'rgba(255,255,255,0.95)', borderRadius: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', padding: 32, marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 24, marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 56, height: 56, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Gift style={{ width: 28, height: 28, color: 'white' }} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1f2937' }}>{project.name}</h1>
                  <span style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: project.status === 'active' ? '#d1fae5' : project.status === 'paused' ? '#fef3c7' : '#f3f4f6', color: project.status === 'active' ? '#059669' : project.status === 'paused' ? '#d97706' : '#6b7280' }}>
                    {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                  </span>
                </div>
                <p style={{ color: '#6b7280', marginTop: 4 }}>{project.description || '暂无描述'}</p>
              </div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '14px 24px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', borderRadius: 14, fontSize: 14, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
              <Upload style={{ width: 18, height: 18 }} />
              {uploading ? '上传中...' : '追加兑换码'}
              <input type="file" accept=".txt" onChange={handleUploadCodes} disabled={uploading} style={{ display: 'none' }} />
            </label>
          </div>

          {/* 统计卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            <div style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #e8e0ff 100%)', borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#667eea', marginBottom: 8 }}>
                <Users style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>已领取</span>
              </div>
              <p style={{ fontSize: 32, fontWeight: 800, color: '#1f2937' }}>{project.claimedCount}</p>
            </div>
            <div style={{ background: 'linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)', borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ec4899', marginBottom: 8 }}>
                <Users style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>剩余名额</span>
              </div>
              <p style={{ fontSize: 32, fontWeight: 800, color: '#1f2937' }}>{remaining}</p>
            </div>
            <div style={{ background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', marginBottom: 8 }}>
                <Package style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>库存总量</span>
              </div>
              <p style={{ fontSize: 32, fontWeight: 800, color: '#1f2937' }}>{project.codesCount}</p>
            </div>
            <div style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3b82f6', marginBottom: 8 }}>
                <Clock style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>创建时间</span>
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>{new Date(project.createdAt).toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* 分发记录 */}
        <div style={{ background: 'rgba(255,255,255,0.95)', borderRadius: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 32px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 12 }}>
            <FileText style={{ width: 20, height: 20, color: '#667eea' }} />
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1f2937' }}>分发记录</h2>
            <span style={{ padding: '4px 12px', background: '#f3f4f6', borderRadius: 20, fontSize: 12, fontWeight: 600, color: '#6b7280' }}>{records.length} 条</span>
          </div>

          {records.length === 0 ? (
            <div style={{ padding: '80px 40px', textAlign: 'center' }}>
              <div style={{ width: 64, height: 64, background: '#f3f4f6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <Users style={{ width: 32, height: 32, color: '#9ca3af' }} />
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#1f2937', marginBottom: 8 }}>暂无分发记录</h3>
              <p style={{ color: '#6b7280' }}>该项目尚未被领取过</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '16px 32px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>用户</th>
                    <th style={{ padding: '16px 32px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>兑换码</th>
                    <th style={{ padding: '16px 32px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>领取时间</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '20px 32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <UserIcon style={{ width: 16, height: 16, color: 'white' }} />
                          </div>
                          <div>
                            <p style={{ fontWeight: 600, color: '#1f2937' }}>{record.username}</p>
                            <p style={{ fontSize: 12, color: '#9ca3af' }}>ID: {record.userId}</p>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '20px 32px' }}>
                        <code style={{ padding: '6px 12px', background: '#f0f4ff', borderRadius: 8, fontFamily: 'monospace', fontSize: 14, color: '#667eea' }}>{record.code}</code>
                      </td>
                      <td style={{ padding: '20px 32px', color: '#6b7280', fontSize: 14 }}>
                        {new Date(record.claimedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
