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
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* 装饰背景圆 */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-200/20 rounded-full blur-3xl -z-10 animate-blob"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-stone-200/40 rounded-full blur-3xl -z-10 animate-blob animation-delay-2000"></div>

      <Link 
        href="/" 
        className="fixed top-6 left-6 flex items-center gap-2 text-stone-500 hover:text-stone-800 text-sm font-medium py-2.5 px-4 bg-white/50 hover:bg-white/80 backdrop-blur-sm rounded-xl transition-all border border-white/20 hover:shadow-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        返回首页
      </Link>

      <div className="w-full max-w-[400px] glass rounded-3xl p-8 sm:p-10 shadow-2xl shadow-orange-900/5 animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-100 to-stone-100 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner border border-white">
            <Gift className="w-8 h-8 text-orange-500" />
          </div>
          <h1 className="text-2xl font-bold text-stone-800 mb-2 tracking-tight">
            欢迎回来
          </h1>
          <p className="text-stone-500 text-sm">
            使用您的 API 账号登录系统
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-6 text-sm text-center font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block mb-2 text-xs font-bold text-stone-500 uppercase tracking-wide">
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              required
              className="w-full px-4 py-3.5 bg-stone-50/50 border border-stone-200 rounded-xl text-stone-800 text-[15px] outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all placeholder:text-stone-400"
            />
          </div>

          <div>
            <label className="block mb-2 text-xs font-bold text-stone-500 uppercase tracking-wide">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
              className="w-full px-4 py-3.5 bg-stone-50/50 border border-stone-200 rounded-xl text-stone-800 text-[15px] outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all placeholder:text-stone-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 gradient-warm text-white rounded-xl text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 hover:-translate-y-0.5 transition-all active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none mt-2"
          >
            {loading && <Loader2 className="w-5 h-5 animate-spin" />}
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9]">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
