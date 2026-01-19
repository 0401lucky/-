'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowLeft, Gift } from 'lucide-react';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (data.success) {
        router.push(redirect);
        router.refresh();
      } else {
        setError(data.message || '登录失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }}>
      <Link 
        href="/" 
        style={{ 
          position: 'fixed',
          top: 24,
          left: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'white',
          textDecoration: 'none',
          fontSize: 14,
          fontWeight: 500,
          padding: '10px 16px',
          background: 'rgba(255,255,255,0.15)',
          borderRadius: 10
        }}
      >
        <ArrowLeft style={{ width: 18, height: 18 }} />
        返回首页
      </Link>

      <div style={{ 
        width: '100%',
        maxWidth: 420,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 24,
        padding: 40,
        boxShadow: '0 25px 80px rgba(0,0,0,0.25)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ 
            width: 64, 
            height: 64, 
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 10px 30px rgba(102, 126, 234, 0.4)'
          }}>
            <Gift style={{ width: 32, height: 32, color: 'white' }} />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>
            欢迎回来
          </h1>
          <p style={{ color: '#6b7280', fontSize: 15 }}>
            使用 API 账号登录
          </p>
        </div>

        {error && (
          <div style={{ 
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            padding: '14px 18px',
            borderRadius: 12,
            marginBottom: 24,
            fontSize: 14,
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#374151' }}>
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              required
              style={{ 
                width: '100%',
                padding: '14px 18px',
                border: '2px solid #e5e7eb',
                borderRadius: 12,
                fontSize: 15,
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: 28 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#374151' }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
              style={{ 
                width: '100%',
                padding: '14px 18px',
                border: '2px solid #e5e7eb',
                borderRadius: 12,
                fontSize: 15,
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ 
              width: '100%',
              padding: '16px',
              background: loading ? '#9ca3af' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              boxShadow: loading ? 'none' : '0 10px 30px rgba(102, 126, 234, 0.35)'
            }}
          >
            {loading && <Loader2 style={{ width: 20, height: 20 }} className="animate-spin" />}
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Loader2 style={{ width: 40, height: 40, color: 'white' }} className="animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
