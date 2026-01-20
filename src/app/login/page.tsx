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
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center p-6">
      <Link 
        href="/" 
        className="fixed top-6 left-6 flex items-center gap-2 text-white text-sm font-medium py-2.5 px-4 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl transition-colors"
      >
        <ArrowLeft className="w-[18px] h-[18px]" />
        返回首页
      </Link>

      <div className="w-full max-w-md bg-white/95 backdrop-blur-sm rounded-3xl p-6 sm:p-8 md:p-10 shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-[#667eea] to-[#764ba2] rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-[#667eea]/40">
            <Gift className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl sm:text-[26px] font-bold text-gray-800 mb-2">
            欢迎回来
          </h1>
          <p className="text-gray-500 text-[15px]">
            使用 API 账号登录
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3.5 rounded-xl mb-6 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="block mb-2 text-sm font-semibold text-gray-700">
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              required
              className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-xl text-[15px] outline-none focus:border-[#667eea] focus:ring-4 focus:ring-[#667eea]/10 transition-all placeholder:text-gray-400"
            />
          </div>

          <div className="mb-7">
            <label className="block mb-2 text-sm font-semibold text-gray-700">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
              className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-xl text-[15px] outline-none focus:border-[#667eea] focus:ring-4 focus:ring-[#667eea]/10 transition-all placeholder:text-gray-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-xl text-base font-semibold flex items-center justify-center gap-2.5 shadow-lg shadow-[#667eea]/35 hover:shadow-xl hover:shadow-[#667eea]/45 hover:-translate-y-0.5 transition-all active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          >
            {loading && <Loader2 className="w-5 h-5 animate-spin" />}
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
      <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-white animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
