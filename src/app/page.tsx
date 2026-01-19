'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, LayoutDashboard, Loader2, Gift, ChevronRight } from 'lucide-react';

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

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [projectsRes, userRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/auth/me')
      ]);

      if (projectsRes.ok) {
        const data = await projectsRes.json();
        if (data.success) {
          setProjects(data.projects);
        }
      }

      if (userRes.ok) {
        const data = await userRes.json();
        if (data.success) {
          setUser(data.user);
        }
      }
    } catch (error) {
      console.error('Failed to fetch data', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      router.refresh();
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <Loader2 style={{ width: 48, height: 48, animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 16, fontSize: 14 }}>加载中...</p>
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
            {/* Logo */}
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
              <div style={{ 
                width: 44, 
                height: 44, 
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)'
              }}>
                <Gift style={{ width: 24, height: 24, color: 'white' }} />
              </div>
              <span style={{ fontSize: 22, fontWeight: 700, color: '#1a1a2e' }}>兑换码中心</span>
            </Link>

            {/* 用户区域 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {user ? (
                <>
                  {user.isAdmin && (
                    <Link 
                      href="/admin" 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 8,
                        padding: '10px 18px',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        borderRadius: 10,
                        textDecoration: 'none',
                        fontSize: 14,
                        fontWeight: 600,
                        boxShadow: '0 4px 15px rgba(102, 126, 234, 0.3)',
                        transition: 'transform 0.2s, box-shadow 0.2s'
                      }}
                    >
                      <LayoutDashboard style={{ width: 18, height: 18 }} />
                      <span>管理后台</span>
                    </Link>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 16, borderLeft: '1px solid #e5e7eb' }}>
                    <div style={{ 
                      width: 40, 
                      height: 40, 
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #f0f4ff 0%, #e8e0ff 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid #667eea'
                    }}>
                      <User style={{ width: 18, height: 18, color: '#667eea' }} />
                    </div>
                    <span style={{ fontWeight: 600, color: '#374151' }}>{user.displayName || user.username}</span>
                    <button
                      onClick={handleLogout}
                      style={{ 
                        padding: 10,
                        background: '#fef2f2',
                        border: 'none',
                        borderRadius: 10,
                        cursor: 'pointer',
                        color: '#ef4444',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <LogOut style={{ width: 18, height: 18 }} />
                    </button>
                  </div>
                </>
              ) : (
                <Link
                  href="/login"
                  style={{ 
                    padding: '12px 28px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    borderRadius: 12,
                    textDecoration: 'none',
                    fontSize: 15,
                    fontWeight: 600,
                    boxShadow: '0 4px 20px rgba(102, 126, 234, 0.4)'
                  }}
                >
                  登录
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <h1 style={{ fontSize: 42, fontWeight: 800, color: 'white', marginBottom: 16, textShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            发现专属福利
          </h1>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.85)', maxWidth: 500, margin: '0 auto' }}>
            领取独家兑换码，限时限量，先到先得
          </p>
        </div>

        {projects.length === 0 ? (
          <div style={{ 
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(10px)',
            borderRadius: 24,
            padding: '80px 40px',
            textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)'
          }}>
            <div style={{ 
              width: 80, 
              height: 80, 
              background: 'linear-gradient(135deg, #f0f4ff 0%, #e8e0ff 100%)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px'
            }}>
              <Gift style={{ width: 40, height: 40, color: '#667eea' }} />
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937', marginBottom: 12 }}>暂无项目</h2>
            <p style={{ color: '#6b7280', fontSize: 16 }}>当前没有可用的兑换码项目，请稍后再来</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 28 }}>
            {projects.map((project) => {
              const remaining = Math.max(0, project.maxClaims - project.claimedCount);
              const progress = Math.min(100, (project.claimedCount / project.maxClaims) * 100);
              
              return (
                <Link
                  key={project.id}
                  href={`/project/${project.id}`}
                  style={{ 
                    background: 'rgba(255,255,255,0.95)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: 20,
                    padding: 28,
                    textDecoration: 'none',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
                    transition: 'transform 0.3s, box-shadow 0.3s',
                    display: 'block'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                    <div style={{ 
                      padding: 12,
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      borderRadius: 14
                    }}>
                      <Gift style={{ width: 24, height: 24, color: 'white' }} />
                    </div>
                    <span style={{ 
                      padding: '6px 14px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      background: project.status === 'active' ? '#d1fae5' : project.status === 'paused' ? '#fef3c7' : '#f3f4f6',
                      color: project.status === 'active' ? '#059669' : project.status === 'paused' ? '#d97706' : '#6b7280'
                    }}>
                      {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '已领完'}
                    </span>
                  </div>

                  <h3 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', marginBottom: 10 }}>
                    {project.name}
                  </h3>
                  <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24, minHeight: 40, lineHeight: 1.6 }}>
                    {project.description || '暂无描述'}
                  </p>

                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
                      <span>已领取 {project.claimedCount}</span>
                      <span style={{ fontWeight: 600, color: remaining < 10 ? '#ef4444' : '#6b7280' }}>
                        剩余 {remaining} / {project.maxClaims}
                      </span>
                    </div>
                    <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ 
                        height: '100%',
                        width: `${progress}%`,
                        background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
                        borderRadius: 4,
                        transition: 'width 0.5s'
                      }} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, borderTop: '1px solid #f3f4f6' }}>
                    <span style={{ fontSize: 12, color: '#9ca3af', background: '#f9fafb', padding: '4px 10px', borderRadius: 6 }}>
                      库存: {project.codesCount}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#667eea', display: 'flex', alignItems: 'center' }}>
                      立即领取 <ChevronRight style={{ width: 18, height: 18, marginLeft: 4 }} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
