'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Gift,
  Loader2,
  Lock,
  LogIn,
  Sparkles,
  UserRound,
} from 'lucide-react';
import TypewriterTitle from '@/components/TypewriterTitle';
import { getSafeRedirectPath } from '@/lib/navigation';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = getSafeRedirectPath(searchParams.get('redirect'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
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
        setError(data.message || '登录失败，请检查用户名与密码');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lucky-login">
      {/* 返回首页 */}
      <Link href="/" className="back-link">
        <ArrowLeft size={16} strokeWidth={2.4} />
        返回首页
      </Link>

      <div className="login-shell">
        {/* 左侧：品牌 / 介绍 */}
        <aside className="brand-pane">
          <div className="brand">
            <div className="brand-icon">
              <Gift />
            </div>
            <span className="brand-text">Lucky 福利站</span>
          </div>

          <div className="brand-hero">
            <h1 className="brand-title">
              <TypewriterTitle
                line1="Welcome to"
                line2="Lucky Station"
                spanClassName="brand-title-gradient"
              />
            </h1>
            <p className="brand-sub">
              登录解锁每日签到、抽奖、卡牌图鉴与福利兑换的全部功能。
            </p>
          </div>

          <ul className="brand-bullets">
            <li className="bullet b-purple">
              <span className="bullet-dot">
                <Sparkles size={14} strokeWidth={2.4} />
              </span>
              <span>每日签到积分梯度，周末最高单日 100 分</span>
            </li>
            <li className="bullet b-orange">
              <span className="bullet-dot">
                <Gift size={14} strokeWidth={2.4} />
              </span>
              <span>福利兑换、多人抽奖、卡牌收集任你选</span>
            </li>
            <li className="bullet b-pink">
              <span className="bullet-dot">
                <Lock size={14} strokeWidth={2.4} />
              </span>
              <span>使用现有账号一键登录，无需重复注册</span>
            </li>
          </ul>
        </aside>

        {/* 右侧：登录卡片 */}
        <main className="login-card">
          <div className="card-deco" aria-hidden />
          <div className="card-deco-2" aria-hidden />
          <div className="card-header">
            <div className="card-icon">
              <LogIn size={22} strokeWidth={2.4} />
            </div>
            <div className="card-titles">
              <h2>欢迎回来</h2>
              <p>登录后继续你的幸运之旅</p>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <span className="error-dot" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            <label className="field">
              <span className="field-label">用户名</span>
              <span className="field-control">
                <span className="field-icon">
                  <UserRound size={16} strokeWidth={2.4} />
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  autoComplete="username"
                  required
                  disabled={loading}
                />
              </span>
            </label>

            <label className="field">
              <span className="field-label">密码</span>
              <span className="field-control">
                <span className="field-icon">
                  <Lock size={16} strokeWidth={2.4} />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  className="field-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff size={16} strokeWidth={2.4} />
                  ) : (
                    <Eye size={16} strokeWidth={2.4} />
                  )}
                </button>
              </span>
            </label>

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="spin" size={18} strokeWidth={2.4} />
                  <span>登录中…</span>
                </>
              ) : (
                <>
                  <LogIn size={18} strokeWidth={2.4} />
                  <span>立即登录</span>
                </>
              )}
            </button>
          </form>

          <p className="card-footer">
            登录即代表你同意 Lucky 福利站的积分与活动使用规则。
          </p>
        </main>
      </div>

      <style jsx global>{`
        .lucky-login {
          --text-main: #0f172a;
          --text-light: #64748b;
          --card-bg: rgba(255, 255, 255, 0.78);
          --card-border: rgba(255, 255, 255, 1);
          --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.08);
          --radius-xl: 32px;
          --radius-lg: 24px;
          --c-green: #10b981;
          --c-purple: #8b5cf6;
          --c-orange: #f97316;
          --c-red: #f43f5e;
          --c-blue: #3b82f6;
          --c-pink: #ec4899;
          background: transparent;
          color: var(--text-main);
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          min-height: 100vh;
          position: relative;
          isolation: isolate;
          -webkit-font-smoothing: antialiased;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 24px;
          overflow: hidden;
        }

        .lucky-login * {
          box-sizing: border-box;
        }

        .lucky-login a {
          color: inherit;
          text-decoration: none;
        }

        /* 返回首页链接（与签到/卡牌的 mobile-back 同模式） */
        .lucky-login .back-link {
          position: absolute;
          top: 24px;
          left: 24px;
          z-index: 5;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 18px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.6);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.9);
          color: var(--text-main);
          font-size: 13.5px;
          font-weight: 700;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
          transition: all 0.25s ease;
        }
        .lucky-login .back-link:hover {
          color: var(--c-orange);
          transform: translateY(-2px);
          box-shadow: 0 12px 28px rgba(249, 115, 22, 0.18);
        }

        /* 主体两栏布局：左品牌 + 右登录卡 */
        .lucky-login .login-shell {
          width: min(960px, 100%);
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 36px;
          align-items: stretch;
          animation: login-fade 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @keyframes login-fade {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* === 左侧：品牌介绍 === */
        .lucky-login .brand-pane {
          display: flex;
          flex-direction: column;
          gap: 28px;
          padding: 8px 4px;
          align-self: center;
        }

        .lucky-login .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text-main);
        }

        .lucky-login .brand-icon {
          width: 44px;
          height: 44px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 24px rgba(255, 122, 0, 0.32);
          flex-shrink: 0;
        }
        .lucky-login .brand-icon svg {
          width: 22px;
          height: 22px;
          color: #fff;
          stroke-width: 2.4;
        }

        .lucky-login .brand-title {
          font-size: 56px;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -1.8px;
          margin: 0 0 18px;
          color: var(--text-main);
          /* 双行打字机预留高度，避免渲染过程中 brand-sub 上下抖动 */
          min-height: calc(2 * 1.1em);
        }
        .lucky-login .brand-title .brand-title-gradient {
          background: linear-gradient(135deg, #ff5a00, #ff0080);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        /* 打字机光标在渐变文本中保持可见的橙色 */
        .lucky-login .brand-title .tw-cursor {
          color: #ff5a00;
          -webkit-text-fill-color: #ff5a00;
        }

        .lucky-login .brand-sub {
          font-size: 15px;
          line-height: 1.7;
          color: var(--text-light);
          margin: 0;
          max-width: 360px;
        }

        .lucky-login .brand-bullets {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .lucky-login .bullet {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.55);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.85);
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-main);
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
          transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
            box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lucky-login .bullet:hover {
          transform: translateY(-4px);
          box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
        }

        .lucky-login .bullet-dot {
          width: 28px;
          height: 28px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: #fff;
        }

        .lucky-login .bullet.b-orange .bullet-dot { background: linear-gradient(135deg, #fb923c, #f43f5e); box-shadow: 0 8px 16px rgba(249, 115, 22, 0.3); }
        .lucky-login .bullet.b-pink .bullet-dot { background: linear-gradient(135deg, #f472b6, #ec4899); box-shadow: 0 8px 16px rgba(236, 72, 153, 0.3); }
        .lucky-login .bullet.b-purple .bullet-dot { background: linear-gradient(135deg, #a78bfa, #7c3aed); box-shadow: 0 8px 16px rgba(139, 92, 246, 0.3); }

        /* === 右侧：登录卡片（玻璃态） === */
        .lucky-login .login-card {
          position: relative;
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-xl);
          padding: 40px 40px 34px;
          box-shadow: var(--card-shadow);
          overflow: hidden;
          isolation: isolate;
        }

        /* 卡片右上装饰光晕（与首页大卡 ::before 同思路） */
        .lucky-login .card-deco {
          position: absolute;
          right: -25%;
          top: -25%;
          width: 280px;
          height: 280px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255, 122, 0, 0.35), transparent 65%);
          filter: blur(36px);
          z-index: 0;
          pointer-events: none;
        }
        /* 左下辅助光晕（粉色，呼应整站 6 卡多色规则） */
        .lucky-login .card-deco-2 {
          position: absolute;
          left: -22%;
          bottom: -28%;
          width: 240px;
          height: 240px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(236, 72, 153, 0.28), transparent 70%);
          filter: blur(40px);
          z-index: 0;
          pointer-events: none;
        }

        .lucky-login .card-header {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 22px;
          position: relative;
          z-index: 1;
        }

        .lucky-login .card-icon {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 24px rgba(255, 122, 0, 0.35);
          flex-shrink: 0;
        }

        .lucky-login .card-titles h2 {
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.5px;
          margin: 0 0 4px;
          color: var(--text-main);
        }
        .lucky-login .card-titles p {
          font-size: 13px;
          color: var(--text-light);
          margin: 0;
          font-weight: 500;
        }

        /* 错误提示 */
        .lucky-login .login-error {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-radius: 16px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.22);
          color: #be123c;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 18px;
          position: relative;
          z-index: 1;
          animation: login-shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97);
        }
        .lucky-login .error-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #f43f5e;
          flex-shrink: 0;
          box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.18);
        }
        @keyframes login-shake {
          10%, 90% { transform: translateX(-1px); }
          20%, 80% { transform: translateX(2px); }
          30%, 50%, 70% { transform: translateX(-3px); }
          40%, 60% { transform: translateX(3px); }
        }

        /* 表单 */
        .lucky-login .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
          position: relative;
          z-index: 1;
        }

        .lucky-login .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .lucky-login .field-label {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-light);
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }

        .lucky-login .field-control {
          position: relative;
          display: flex;
          align-items: center;
          background: rgba(255, 255, 255, 0.6);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1.5px solid rgba(255, 255, 255, 0.85);
          border-radius: 14px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }
        .lucky-login .field-control:focus-within {
          border-color: var(--c-orange);
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.12);
        }

        .lucky-login .field-icon {
          padding: 0 12px 0 14px;
          color: var(--text-light);
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .lucky-login .field-control:focus-within .field-icon {
          color: var(--c-orange);
        }

        .lucky-login .field-control input {
          flex: 1;
          padding: 14px 14px 14px 0;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-main);
          font-size: 14.5px;
          font-weight: 500;
          font-family: inherit;
          min-width: 0;
        }
        .lucky-login .field-control input::placeholder {
          color: rgba(100, 116, 139, 0.7);
        }
        .lucky-login .field-control input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .lucky-login .field-toggle {
          background: transparent;
          border: none;
          padding: 0 14px;
          color: var(--text-light);
          cursor: pointer;
          display: flex;
          align-items: center;
          flex-shrink: 0;
          transition: color 0.2s ease;
        }
        .lucky-login .field-toggle:hover {
          color: var(--c-orange);
        }

        /* 登录按钮（与首页 brand-icon 同色调橙红渐变） */
        .lucky-login .login-btn {
          margin-top: 6px;
          height: 50px;
          border-radius: 14px;
          border: none;
          color: #fff;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.5px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          box-shadow: 0 14px 28px rgba(255, 70, 70, 0.32);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: transform 0.25s ease, box-shadow 0.25s ease, opacity 0.25s ease;
          position: relative;
          overflow: hidden;
        }
        .lucky-login .login-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.32),
            transparent
          );
          transform: translateX(-150%) skewX(-25deg);
          transition: transform 0.7s ease;
        }
        .lucky-login .login-btn:hover:not(:disabled) {
          transform: translateY(-2px) scale(1.01);
          box-shadow: 0 18px 36px rgba(255, 70, 70, 0.4);
        }
        .lucky-login .login-btn:hover:not(:disabled)::before {
          transform: translateX(150%) skewX(-25deg);
        }
        .lucky-login .login-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
        }
        .lucky-login .login-btn .spin {
          animation: login-spin 1s linear infinite;
        }
        @keyframes login-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .lucky-login .card-footer {
          margin: 18px 0 0;
          font-size: 12px;
          color: var(--text-light);
          text-align: center;
          line-height: 1.6;
          position: relative;
          z-index: 1;
        }

        /* 响应式：≤ 1280 / 1200 / 992 / 640 与首页断点对齐 */
        @media (max-width: 1280px) {
          .lucky-login .login-shell {
            width: min(900px, 100%);
            gap: 32px;
          }
          .lucky-login .brand-title {
            font-size: 50px;
            letter-spacing: -1.6px;
          }
        }

        @media (max-width: 1200px) {
          .lucky-login .login-shell {
            width: min(840px, 100%);
            gap: 28px;
          }
          .lucky-login .login-card {
            padding: 32px 30px 28px;
          }
          .lucky-login .brand-title {
            font-size: 42px;
            letter-spacing: -1.4px;
          }
          .lucky-login .brand-sub {
            font-size: 14px;
          }
        }

        @media (max-width: 992px) {
          .lucky-login {
            padding: 80px 20px 40px;
            align-items: flex-start;
          }
          .lucky-login .login-shell {
            grid-template-columns: 1fr;
            gap: 24px;
            max-width: 480px;
          }
          .lucky-login .brand-pane {
            text-align: center;
            align-items: center;
            padding: 0;
            gap: 18px;
          }
          .lucky-login .brand {
            justify-content: center;
          }
          .lucky-login .brand-title {
            font-size: 36px;
            margin-bottom: 10px;
            letter-spacing: -1.2px;
          }
          .lucky-login .brand-sub {
            font-size: 13.5px;
            margin: 0 auto;
          }
          .lucky-login .brand-bullets {
            display: none;
          }
        }

        @media (max-width: 640px) {
          .lucky-login {
            padding: 76px 16px 32px;
          }
          .lucky-login .back-link {
            top: 16px;
            left: 16px;
            padding: 7px 12px;
            font-size: 12.5px;
          }
          .lucky-login .login-card {
            padding: 28px 22px 24px;
            border-radius: 26px;
          }
          .lucky-login .card-titles h2 {
            font-size: 20px;
          }
          .lucky-login .brand-title {
            font-size: 28px;
            letter-spacing: -1px;
          }
          .lucky-login .login-btn {
            height: 48px;
            font-size: 14.5px;
          }
        }
      `}</style>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fdfcf8',
          }}
        >
          <Loader2
            style={{
              width: 32,
              height: 32,
              color: '#f97316',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
