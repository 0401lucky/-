'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Copy, Check, Package, AlertCircle, LogOut, User as UserIcon, Gift } from 'lucide-react';

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

interface ClaimedInfo {
  code: string;
  claimedAt: number;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [claimedInfo, setClaimedInfo] = useState<ClaimedInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [projectRes, userRes] = await Promise.all([
        fetch(`/api/projects/${id}`),
        fetch('/api/auth/me')
      ]);

      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData.success) {
          setUser(userData.user);
        }
      }

      if (projectRes.ok) {
        const projectData = await projectRes.json();
        if (projectData.success) {
          setProject(projectData.project);
          setClaimedInfo(projectData.claimed);
        } else {
          setError(projectData.message || '获取项目信息失败');
        }
      } else {
        setError('项目不存在或已被删除');
      }
    } catch (err) {
      setError('网络请求失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!user) {
      router.push(`/login?redirect=/project/${id}`);
      return;
    }

    try {
      setClaiming(true);
      setError(null);
      
      const res = await fetch(`/api/projects/${id}`, {
        method: 'POST',
      });

      const data = await res.json();
      
      if (data.success) {
        setClaimedInfo({
          code: data.code,
          claimedAt: Date.now()
        });
        if (project) {
          setProject({
            ...project,
            claimedCount: project.claimedCount + 1
          });
        }
      } else {
        setError(data.message || '领取失败');
      }
    } catch (err) {
      setError('领取请求失败，请稍后重试');
    } finally {
      setClaiming(false);
    }
  };

  const handleCopy = () => {
    if (claimedInfo?.code) {
      navigator.clipboard.writeText(claimedInfo.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.refresh();
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <Loader2 style={{ width: 48, height: 48, animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 16 }}>加载项目详情...</p>
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
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '14px 28px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', borderRadius: 12, textDecoration: 'none', fontWeight: 600, width: '100%' }}>
            <ArrowLeft style={{ width: 18, height: 18, marginRight: 8 }} />
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const isPaused = project.status === 'paused';
  const isSoldOut = project.status === 'exhausted' || project.claimedCount >= project.maxClaims;
  const canClaim = !isPaused && !isSoldOut && !claimedInfo && user;
  const remaining = Math.max(0, project.maxClaims - project.claimedCount);
  const progress = Math.min(100, (project.claimedCount / project.maxClaims) * 100);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      {/* 导航栏 */}
      <nav style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 70 }}>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', textDecoration: 'none' }}>
              <ArrowLeft style={{ width: 20, height: 20 }} />
              <span style={{ fontWeight: 500 }}>返回首页</span>
            </Link>
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#f3f4f6', borderRadius: 20 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <UserIcon style={{ width: 14, height: 14, color: 'white' }} />
                  </div>
                  <span style={{ fontWeight: 600, color: '#374151', fontSize: 14 }}>{user.displayName}</span>
                </div>
                <button onClick={handleLogout} style={{ padding: 10, background: '#fef2f2', border: 'none', borderRadius: 10, cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center' }}>
                  <LogOut style={{ width: 18, height: 18 }} />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ background: 'rgba(255,255,255,0.95)', borderRadius: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
          {/* 头部 */}
          <div style={{ padding: '32px 32px 24px', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 56, height: 56, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Gift style={{ width: 28, height: 28, color: 'white' }} />
                </div>
                <div>
                  <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>{project.name}</h1>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#f3f4f6', borderRadius: 20, fontSize: 13, color: '#6b7280' }}>
                      <Package style={{ width: 14, height: 14 }} />
                      剩余 {remaining} / {project.maxClaims}
                    </span>
                  </div>
                </div>
              </div>
              <span style={{ padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, background: isPaused ? '#fef3c7' : isSoldOut ? '#f3f4f6' : '#d1fae5', color: isPaused ? '#d97706' : isSoldOut ? '#6b7280' : '#059669' }}>
                {isPaused ? '已暂停' : isSoldOut ? '已领完' : '进行中'}
              </span>
            </div>
          </div>

          {/* 内容 */}
          <div style={{ padding: 32 }}>
            {/* 描述 */}
            <div style={{ marginBottom: 32 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#374151', marginBottom: 12 }}>项目详情</h3>
              <div style={{ background: '#f9fafb', borderRadius: 16, padding: 20, color: '#6b7280', lineHeight: 1.7 }}>
                {project.description || '该项目暂无详细描述。'}
              </div>
            </div>

            {/* 进度 */}
            <div style={{ marginBottom: 32, background: '#f9fafb', borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>领取进度</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: '#667eea' }}>{Math.round(progress)}%</span>
              </div>
              <div style={{ height: 12, background: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)', borderRadius: 6, transition: 'width 0.5s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
                <span>已领取 {project.claimedCount}</span>
                <span>总数 {project.maxClaims}</span>
              </div>
            </div>

            {/* 操作区域 */}
            <div style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #faf5ff 100%)', borderRadius: 20, padding: 40, textAlign: 'center' }}>
              {claimedInfo ? (
                <div>
                  <div style={{ width: 72, height: 72, background: '#d1fae5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', boxShadow: '0 10px 30px rgba(16, 185, 129, 0.2)' }}>
                    <Check style={{ width: 36, height: 36, color: '#059669' }} />
                  </div>
                  <h3 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>领取成功!</h3>
                  <p style={{ color: '#6b7280', marginBottom: 24 }}>这是您的专属兑换码，请妥善保管</p>
                  <div style={{ position: 'relative', maxWidth: 500, margin: '0 auto' }}>
                    <div style={{ background: 'white', border: '2px solid #667eea', borderRadius: 16, padding: '20px 60px 20px 24px', fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: '#667eea', wordBreak: 'break-all', boxShadow: '0 10px 30px rgba(102, 126, 234, 0.15)' }}>
                      {claimedInfo.code}
                    </div>
                    <button onClick={handleCopy} style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', padding: 10, background: copied ? '#d1fae5' : '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', color: copied ? '#059669' : '#6b7280' }}>
                      {copied ? <Check style={{ width: 20, height: 20 }} /> : <Copy style={{ width: 20, height: 20 }} />}
                    </button>
                  </div>
                  <p style={{ marginTop: 16, fontSize: 13, color: '#9ca3af' }}>
                    领取时间: {new Date(claimedInfo.claimedAt).toLocaleString()}
                  </p>
                </div>
              ) : (
                <div>
                  {!user ? (
                    <div>
                      <div style={{ width: 64, height: 64, background: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', border: '2px solid #e5e7eb' }}>
                        <UserIcon style={{ width: 32, height: 32, color: '#9ca3af' }} />
                      </div>
                      <h3 style={{ fontSize: 20, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>请先登录</h3>
                      <p style={{ color: '#6b7280', marginBottom: 24 }}>登录账号后即可领取专属兑换码</p>
                      <Link href={`/login?redirect=/project/${id}`} style={{ display: 'inline-flex', alignItems: 'center', padding: '16px 32px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', borderRadius: 14, textDecoration: 'none', fontSize: 16, fontWeight: 600, boxShadow: '0 10px 30px rgba(102, 126, 234, 0.35)' }}>
                        立即登录
                      </Link>
                    </div>
                  ) : (
                    <div>
                      {error && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 20px', marginBottom: 24, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#dc2626', fontSize: 14 }}>
                          <AlertCircle style={{ width: 18, height: 18 }} />
                          {error}
                        </div>
                      )}
                      {canClaim ? (
                        <div>
                          <p style={{ color: '#6b7280', marginBottom: 24 }}>点击下方按钮即可领取，每人限领一次</p>
                          <button onClick={handleClaim} disabled={claiming} style={{ display: 'inline-flex', alignItems: 'center', padding: '18px 40px', background: claiming ? '#9ca3af' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', border: 'none', borderRadius: 14, fontSize: 18, fontWeight: 700, cursor: claiming ? 'not-allowed' : 'pointer', boxShadow: claiming ? 'none' : '0 10px 30px rgba(102, 126, 234, 0.35)' }}>
                            {claiming && <Loader2 style={{ width: 22, height: 22, marginRight: 10 }} />}
                            {claiming ? '正在领取...' : '立即领取兑换码'}
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div style={{ width: 64, height: 64, background: '#f3f4f6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                            <Package style={{ width: 32, height: 32, color: '#9ca3af' }} />
                          </div>
                          <button disabled style={{ padding: '16px 32px', background: '#f3f4f6', color: '#9ca3af', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 600, cursor: 'not-allowed' }}>
                            {isPaused ? '项目暂停中' : '已领完'}
                          </button>
                          <p style={{ marginTop: 16, fontSize: 14, color: '#9ca3af' }}>
                            {isPaused ? '管理员暂停了该项目的领取' : '手慢了，下次早点来哦'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
