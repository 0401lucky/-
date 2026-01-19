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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <Loader2 style={{ width: 48, height: 48, animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 16 }}>加载管理后台...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      {/* 导航栏 */}
      <nav style={{ 
        background: 'rgba(255,255,255,0.95)', 
        backdropFilter: 'blur(10px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 70 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', textDecoration: 'none' }}>
                <ArrowLeft style={{ width: 20, height: 20 }} />
                <span style={{ fontWeight: 500 }}>返回</span>
              </Link>
              <div style={{ width: 1, height: 24, background: '#e5e7eb' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ 
                  width: 36, height: 36, 
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <LayoutDashboard style={{ width: 20, height: 20, color: 'white' }} />
                </div>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#1f2937' }}>管理后台</span>
              </div>
            </div>
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ 
                  display: 'flex', alignItems: 'center', gap: 8, 
                  padding: '8px 14px', background: '#f3f4f6', borderRadius: 20
                }}>
                  <div style={{ 
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <UserIcon style={{ width: 14, height: 14, color: 'white' }} />
                  </div>
                  <span style={{ fontWeight: 600, color: '#374151', fontSize: 14 }}>{user.displayName}</span>
                </div>
                <button onClick={handleLogout} style={{ 
                  padding: 10, background: '#fef2f2', border: 'none', borderRadius: 10, 
                  cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center'
                }}>
                  <LogOut style={{ width: 18, height: 18 }} />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* 成功提示 */}
        {success && (
          <div style={{ 
            marginBottom: 24, padding: '16px 20px', 
            background: 'rgba(255,255,255,0.95)', borderRadius: 16, 
            border: '2px solid #10b981',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#059669' }}>
              <Check style={{ width: 20, height: 20 }} />
              <span style={{ fontWeight: 600 }}>{success}</span>
            </div>
            <button onClick={() => setSuccess(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
              <X style={{ width: 20, height: 20 }} />
            </button>
          </div>
        )}

        {/* 头部 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: 'white', marginBottom: 8 }}>项目管理</h1>
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16 }}>创建和管理兑换码分发项目</p>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)}
            style={{ 
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 24px', 
              background: 'white', color: '#667eea',
              border: 'none', borderRadius: 14, 
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
            }}
          >
            <Plus style={{ width: 20, height: 20 }} />
            创建新项目
          </button>
        </div>

        {/* 项目列表 */}
        <div style={{ 
          background: 'rgba(255,255,255,0.95)', 
          borderRadius: 24, 
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          overflow: 'hidden'
        }}>
          {projects.length === 0 ? (
            <div style={{ padding: '80px 40px', textAlign: 'center' }}>
              <div style={{ 
                width: 80, height: 80, 
                background: 'linear-gradient(135deg, #f0f4ff 0%, #e8e0ff 100%)',
                borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 24px'
              }}>
                <Package style={{ width: 40, height: 40, color: '#667eea' }} />
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>暂无项目</h2>
              <p style={{ color: '#6b7280' }}>点击上方按钮创建您的第一个项目</p>
            </div>
          ) : (
            <div>
              {/* 表头 */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '2fr 1fr 1.5fr 1fr 1fr 120px',
                padding: '16px 24px',
                background: '#f9fafb',
                borderBottom: '1px solid #e5e7eb',
                fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase'
              }}>
                <span>项目名称</span>
                <span>状态</span>
                <span>领取进度</span>
                <span>库存</span>
                <span>创建时间</span>
                <span style={{ textAlign: 'right' }}>操作</span>
              </div>
              
              {/* 项目行 */}
              {projects.map((project) => (
                <Link 
                  key={project.id} 
                  href={`/admin/project/${project.id}`}
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '2fr 1fr 1.5fr 1fr 1fr 120px',
                    padding: '20px 24px',
                    borderBottom: '1px solid #f3f4f6',
                    textDecoration: 'none',
                    alignItems: 'center',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f9fafb'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  {/* 名称 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ 
                      width: 40, height: 40, borderRadius: 12,
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Gift style={{ width: 20, height: 20, color: 'white' }} />
                    </div>
                    <span style={{ fontWeight: 600, color: '#1f2937', fontSize: 15 }}>{project.name}</span>
                  </div>

                  {/* 状态 */}
                  <div>
                    <span style={{ 
                      padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                      background: project.status === 'active' ? '#d1fae5' : project.status === 'paused' ? '#fef3c7' : '#f3f4f6',
                      color: project.status === 'active' ? '#059669' : project.status === 'paused' ? '#d97706' : '#6b7280'
                    }}>
                      {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                    </span>
                  </div>

                  {/* 进度 */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <Users style={{ width: 16, height: 16, color: '#9ca3af' }} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{project.claimedCount}</span>
                      <span style={{ color: '#9ca3af' }}>/</span>
                      <span style={{ fontSize: 14, color: '#6b7280' }}>{project.maxClaims}</span>
                    </div>
                    <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ 
                        height: '100%', 
                        width: `${Math.min(100, (project.claimedCount / project.maxClaims) * 100)}%`,
                        background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
                        borderRadius: 3
                      }} />
                    </div>
                  </div>

                  {/* 库存 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Package style={{ width: 16, height: 16, color: '#9ca3af' }} />
                    <span style={{ fontWeight: 600, color: '#374151' }}>{project.codesCount}</span>
                  </div>

                  {/* 时间 */}
                  <span style={{ fontSize: 14, color: '#6b7280' }}>
                    {new Date(project.createdAt).toLocaleDateString()}
                  </span>

                  {/* 操作 */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button 
                      onClick={(e) => handleToggleStatus(project, e)}
                      style={{ 
                        width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: project.status === 'active' ? '#fef3c7' : '#d1fae5',
                        color: project.status === 'active' ? '#d97706' : '#059669'
                      }}
                    >
                      {project.status === 'active' ? <Pause style={{ width: 16, height: 16 }} /> : <Play style={{ width: 16, height: 16 }} />}
                    </button>
                    <button 
                      onClick={(e) => handleDelete(project, e)}
                      style={{ 
                        width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#fef2f2', color: '#ef4444'
                      }}
                    >
                      <Trash2 style={{ width: 16, height: 16 }} />
                    </button>
                    <div style={{ 
                      width: 36, height: 36, borderRadius: 10,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#f3f4f6', color: '#6b7280'
                    }}>
                      <ChevronRight style={{ width: 18, height: 18 }} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 创建项目弹窗 */}
      {showCreateModal && (
        <div style={{ 
          position: 'fixed', inset: 0, 
          background: 'rgba(0,0,0,0.5)', 
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, padding: 24
        }}>
          <div style={{ 
            background: 'white', borderRadius: 24, 
            width: '100%', maxWidth: 480,
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            {/* 弹窗头部 */}
            <div style={{ 
              padding: '20px 24px', 
              borderBottom: '1px solid #e5e7eb',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Plus style={{ width: 22, height: 22, color: '#667eea' }} />
                创建新项目
              </h2>
              <button 
                onClick={() => setShowCreateModal(false)}
                style={{ 
                  width: 36, height: 36, borderRadius: 10, 
                  background: '#f3f4f6', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280'
                }}
              >
                <X style={{ width: 20, height: 20 }} />
              </button>
            </div>

            {/* 表单 */}
            <form onSubmit={handleCreateProject} style={{ padding: 24 }}>
              {error && (
                <div style={{ 
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '14px 18px', marginBottom: 20,
                  background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: 12, color: '#dc2626', fontSize: 14
                }}>
                  <AlertCircle style={{ width: 18, height: 18 }} />
                  {error}
                </div>
              )}

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#374151' }}>
                  项目名称 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如: 5刀福利"
                  style={{ 
                    width: '100%', padding: '14px 18px',
                    border: '2px solid #e5e7eb', borderRadius: 12,
                    fontSize: 15, outline: 'none', boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#374151' }}>
                  项目描述
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="可选"
                  rows={3}
                  style={{ 
                    width: '100%', padding: '14px 18px',
                    border: '2px solid #e5e7eb', borderRadius: 12,
                    fontSize: 15, outline: 'none', resize: 'none', boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#374151' }}>
                  限领人数 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="number"
                  value={maxClaims}
                  onChange={(e) => setMaxClaims(e.target.value)}
                  min="1"
                  style={{ 
                    width: '100%', padding: '14px 18px',
                    border: '2px solid #e5e7eb', borderRadius: 12,
                    fontSize: 15, outline: 'none', boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: 28 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#374151' }}>
                  导入兑换码
                </label>
                <div style={{ 
                  border: '2px dashed #d1d5db', borderRadius: 12,
                  padding: '32px 20px', textAlign: 'center',
                  cursor: 'pointer', position: 'relative'
                }}>
                  <input
                    type="file"
                    accept=".txt"
                    onChange={(e) => setCodesFile(e.target.files?.[0] || null)}
                    style={{ 
                      position: 'absolute', inset: 0, 
                      opacity: 0, cursor: 'pointer'
                    }}
                  />
                  <div style={{ 
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #f0f4ff 0%, #e8e0ff 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 16px'
                  }}>
                    <Upload style={{ width: 28, height: 28, color: '#667eea' }} />
                  </div>
                  <p style={{ color: '#6b7280', fontSize: 14 }}>
                    {codesFile ? (
                      <span style={{ color: '#667eea', fontWeight: 600 }}>{codesFile.name}</span>
                    ) : (
                      <>点击选择 <strong>.txt</strong> 文件</>
                    )}
                  </p>
                  <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>每行一个兑换码</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{ 
                    flex: 1, padding: '14px',
                    background: '#f3f4f6', color: '#374151',
                    border: 'none', borderRadius: 12,
                    fontSize: 15, fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  style={{ 
                    flex: 1, padding: '14px',
                    background: creating ? '#9ca3af' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white', border: 'none', borderRadius: 12,
                    fontSize: 15, fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                  }}
                >
                  {creating && <Loader2 style={{ width: 18, height: 18 }} />}
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
