'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Home, type LucideIcon } from 'lucide-react';

interface UserInfo {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface MeResponse {
  success?: boolean;
  user?: { id: number; username: string; displayName: string; isAdmin: boolean };
}

interface SettingsResponse {
  success?: boolean;
  data?: { displayName: string | null; avatarUrl: string | null };
}

interface GamePageShellProps {
  /** 顶栏品牌区文字（游戏名） */
  brandTitle: string;
  /** 顶栏品牌区图标 */
  brandIcon: LucideIcon;
  /** 用户积分余额，显示在 user-profile 的 rank-pill */
  balance: number | null | undefined;
  /** Hero 区 JSX 内容（外层 .lucky-hero 由 shell 提供） */
  hero?: ReactNode;
  /** 错误提示（显示在 hero 与主体之间） */
  error?: string | null;
  /** 顶栏返回按钮目标（默认游戏中心） */
  backHref?: string;
  /** 顶栏返回按钮文案（默认"返回游戏中心"） */
  backLabel?: string;
  /** 主体内容（gameplay 区域） */
  children: ReactNode;
}

/**
 * 游戏页公共外壳
 * - 浅色 mesh 背景 + sticky 玻璃 topbar + 居中 main
 * - 提供深绿 Hero 基础容器（内部 JSX 由各游戏自管）
 * - 各游戏可在 children 内追加自己的 <style jsx> 处理游戏专属 UI
 */
export default function GamePageShell({
  brandTitle,
  brandIcon: Icon,
  balance,
  hero,
  error,
  backHref = '/games',
  backLabel = '返回游戏中心',
  children,
}: GamePageShellProps) {
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [meRes, settingsRes] = await Promise.all([
          fetch('/api/auth/me', { cache: 'no-store' }),
          fetch('/api/profile/settings', { cache: 'no-store' }),
        ]);
        const meJson = (await meRes.json().catch(() => null)) as MeResponse | null;
        const settingsJson = (await settingsRes.json().catch(() => null)) as SettingsResponse | null;
        if (cancelled) return;
        if (meJson?.success && meJson.user) {
          setUser({
            username: meJson.user.username,
            displayName: settingsJson?.data?.displayName || meJson.user.displayName,
            avatarUrl: settingsJson?.data?.avatarUrl ?? null,
          });
        }
      } catch {
        // silent; topbar shows fallback
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const initial = (user?.displayName?.[0] ?? user?.username?.[0] ?? '?').toUpperCase();
  const showBalance = balance == null ? '…' : balance.toLocaleString();

  return (
    <div className="games-page">
      <div className="mesh-bg" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Icon size={22} strokeWidth={2.4} />
          </div>
          {brandTitle}
        </div>
        <div className="topbar-right">
          <Link href={backHref} className="btn-icon" aria-label={backLabel} title={backLabel}>
            <Home size={16} strokeWidth={2} />
          </Link>
          <Link href="/profile" className="user-profile" aria-label="查看个人主页">
            <div className="avatar">
              {user?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt={user.displayName} className="avatar-img" />
              ) : (
                initial
              )}
            </div>
            <div className="user-info">
              <h4>{user?.displayName || user?.username || '未登录'}</h4>
              <p>
                <span className="rank-pill">{showBalance}</span>
                积分余额
              </p>
            </div>
          </Link>
        </div>
      </header>

      <main className="games-main">
        {hero && <section className="lucky-hero">{hero}</section>}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {children}
      </main>

      <style jsx global>{`
        /* ───────── PAGE WRAPPER ───────── */
        .games-page {
          --c-green: #10b981;
          --c-green-600: #059669;
          --c-green-700: #047857;
          --c-green-800: #065f46;
          --c-green-900: #064e3b;
          --c-green-50: #ecfdf5;
          --c-green-100: #d1fae5;
          --text-main: #0f172a;
          --text-soft: #64748b;
          --text-light: #94a3b8;
          min-height: 100vh;
          background: #f8fafc;
          color: var(--text-main);
          position: relative;
          overflow-x: hidden;
        }
        .games-page .mesh-bg {
          position: fixed; inset: 0; z-index: 0;
          pointer-events: none;
          background-image:
            radial-gradient(circle at 15% 20%, rgba(167, 243, 208, 0.65) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(110, 231, 183, 0.45) 0%, transparent 50%),
            radial-gradient(circle at 50% 100%, rgba(16, 185, 129, 0.35) 0%, transparent 60%),
            radial-gradient(circle at 50% 50%, rgba(220, 252, 231, 0.85) 0%, transparent 50%);
          filter: blur(60px);
          animation: gpsFluid 18s infinite alternate ease-in-out;
        }
        @keyframes gpsFluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        /* ───────── TOPBAR ───────── */
        .games-page .topbar {
          position: sticky; top: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between;
          gap: 24px; padding: 16px 48px;
          background: rgba(248, 250, 252, 0.65);
          backdrop-filter: blur(24px) saturate(1.6);
          -webkit-backdrop-filter: blur(24px) saturate(1.6);
          border-bottom: 1px solid rgba(255, 255, 255, 0.8);
          padding-top: max(16px, env(safe-area-inset-top));
        }
        .games-page .brand {
          display: flex; align-items: center; gap: 12px;
          font-size: 20px; font-weight: 800; letter-spacing: -0.5px;
          color: var(--text-main); flex-shrink: 0;
        }
        .games-page .brand-icon {
          width: 36px; height: 36px;
          background: linear-gradient(135deg, #34d399, #10b981);
          border-radius: 11px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 8px 16px rgba(16, 185, 129, 0.3);
        }
        .games-page .brand-icon svg { width: 20px; height: 20px; color: #fff; stroke-width: 2.5; }

        .games-page .topbar-right {
          display: flex; align-items: center; gap: 12px; flex-shrink: 0;
        }
        .games-page .topbar .btn-icon {
          width: 40px; height: 40px; border-radius: 50%;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          display: inline-flex; align-items: center; justify-content: center;
          color: var(--text-light); transition: all 0.2s; cursor: pointer;
        }
        .games-page .topbar .btn-icon svg { width: 16px; height: 16px; }
        .games-page .topbar .btn-icon:hover {
          background: #fff; color: var(--c-green); transform: translateY(-1px);
        }

        .games-page .user-profile {
          display: inline-flex; align-items: center; gap: 12px;
          padding: 5px 16px 5px 5px;
          background: #fff; border-radius: 999px;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.04);
          cursor: pointer; transition: transform 0.2s;
          text-decoration: none;
          color: var(--text-main);
        }
        .games-page .user-profile:hover { transform: scale(1.02); }
        .games-page .user-profile .avatar {
          width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, #d1fae5 0%, #10b981 100%);
          color: #fff; display: inline-flex; align-items: center; justify-content: center;
          font-weight: 800; font-size: 14px; flex-shrink: 0;
          overflow: hidden; text-transform: uppercase;
        }
        .games-page .user-profile .avatar-img {
          width: 100%; height: 100%; object-fit: cover;
          border-radius: inherit; display: block;
        }
        .games-page .user-info h4 {
          font-size: 13px; font-weight: 700; line-height: 1.2; margin: 0;
          max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .games-page .user-info p {
          font-size: 11px; color: var(--text-light); margin: 1px 0 0;
          display: inline-flex; align-items: center; gap: 4px;
        }
        .games-page .user-info p .rank-pill {
          background: linear-gradient(135deg, #34d399, #10b981);
          color: #fff;
          padding: 1px 7px; border-radius: 999px;
          font-weight: 800; font-size: 10px; letter-spacing: 0.3px;
          font-variant-numeric: tabular-nums;
        }

        /* ───────── MAIN ───────── */
        .games-page .games-main {
          position: relative; z-index: 1;
          max-width: 1500px;
          margin: 0 auto;
          padding: 28px 48px 96px;
          display: flex;
          flex-direction: column;
          gap: 26px;
        }
        @media (max-width: 1280px) {
          .games-page .games-main { padding: 24px 32px 80px; }
        }
        @media (max-width: 992px) {
          .games-page .games-main { padding: 20px 24px 80px; gap: 22px; }
        }
        @media (max-width: 768px) {
          .games-page .games-main { padding: 16px 14px 100px; gap: 18px; }
          .games-page .topbar { padding: 12px 16px; gap: 8px; }
        }

        .games-page .error-banner {
          padding: 12px 18px;
          border-radius: 16px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          font-size: 14px;
          font-weight: 600;
        }

        /* ───────── HERO ───────── */
        .games-page .lucky-hero {
          position: relative;
          padding: 44px 48px;
          border-radius: 36px;
          background: linear-gradient(135deg, #022c22 0%, #064e3b 35%, #065f46 70%, #047857 100%);
          color: #fff;
          overflow: hidden;
          box-shadow: 0 30px 60px rgba(2, 44, 34, 0.35);
        }
        .games-page .lucky-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 20% 30%, rgba(110, 231, 183, 0.18), transparent 55%),
            radial-gradient(circle at 80% 70%, rgba(52, 211, 153, 0.20), transparent 55%),
            radial-gradient(circle at 50% 100%, rgba(16, 185, 129, 0.30), transparent 60%);
          pointer-events: none;
        }
        .games-page .lucky-hero::after {
          content: '';
          position: absolute;
          top: -40%;
          right: -10%;
          width: 480px;
          height: 480px;
          background: radial-gradient(circle, rgba(110, 231, 183, 0.28), transparent 60%);
          filter: blur(50px);
          pointer-events: none;
          animation: gps-glow-pulse 4.5s ease-in-out infinite;
        }
        @keyframes gps-glow-pulse {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50% { transform: scale(1.18); opacity: 1; }
        }

        .games-page .stars {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .games-page .star {
          position: absolute;
          color: rgba(255, 255, 255, 0.75);
          animation: gps-twinkle 3s ease-in-out infinite;
        }
        @keyframes gps-twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }

        .games-page .float-cards {
          position: absolute;
          top: 50%;
          right: 5%;
          transform: translateY(-50%);
          width: 220px;
          height: 200px;
          z-index: 1;
        }
        .games-page .fc-card {
          position: absolute;
          width: 92px;
          height: 130px;
          border-radius: 14px;
          border: 2.5px solid rgba(255, 255, 255, 0.85);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 38px;
        }
        .games-page .fc-card.fc-1 {
          top: 30px;
          left: 10px;
          background: linear-gradient(135deg, rgba(52, 211, 153, 0.85), rgba(16, 185, 129, 0.7));
          transform: rotate(-12deg);
          animation: gps-float-1 5s ease-in-out infinite;
        }
        .games-page .fc-card.fc-2 {
          top: 10px;
          left: 70px;
          background: linear-gradient(135deg, rgba(110, 231, 183, 0.85), rgba(52, 211, 153, 0.7));
          transform: rotate(0deg);
          animation: gps-float-2 5s ease-in-out infinite 0.4s;
          z-index: 2;
        }
        .games-page .fc-card.fc-3 {
          top: 30px;
          left: 130px;
          background: linear-gradient(135deg, rgba(167, 243, 208, 0.85), rgba(110, 231, 183, 0.7));
          transform: rotate(12deg);
          animation: gps-float-3 5s ease-in-out infinite 0.8s;
        }
        @keyframes gps-float-1 {
          0%, 100% { transform: rotate(-12deg) translateY(0); }
          50% { transform: rotate(-15deg) translateY(-8px); }
        }
        @keyframes gps-float-2 {
          0%, 100% { transform: rotate(0deg) translateY(0); }
          50% { transform: rotate(2deg) translateY(-12px); }
        }
        @keyframes gps-float-3 {
          0%, 100% { transform: rotate(12deg) translateY(0); }
          50% { transform: rotate(15deg) translateY(-8px); }
        }
        .games-page .fc-card .fc-glow {
          position: absolute;
          inset: 6px;
          border-radius: 10px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.2), transparent);
        }

        .games-page .hero-content {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 32px;
          flex-wrap: wrap;
        }
        .games-page .hero-text {
          display: flex;
          flex-direction: column;
          gap: 14px;
          max-width: 540px;
        }
        .games-page .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          background: rgba(110, 231, 183, 0.22);
          border: 1px solid rgba(110, 231, 183, 0.45);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          color: #a7f3d0;
          letter-spacing: 1px;
          backdrop-filter: blur(10px);
          width: fit-content;
        }
        .games-page .hero-badge svg { width: 12px; height: 12px; }
        .games-page .hero-title {
          font-size: 48px;
          font-weight: 900;
          letter-spacing: -1.5px;
          line-height: 1.05;
          margin: 0;
          color: #fff;
        }
        .games-page .hero-title .glow {
          background: linear-gradient(135deg, #6ee7b7, #34d399);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 0 40px rgba(52, 211, 153, 0.4);
        }
        .games-page .hero-sub {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.82);
          line-height: 1.65;
          max-width: 540px;
          margin: 0;
        }
        .games-page .hero-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 4px;
        }
        .games-page .hero-meta-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(255, 255, 255, 0.10);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(10px);
        }
        .games-page .hero-meta-chip svg { color: #6ee7b7; }

        .games-page .hero-points-wrap {
          position: relative;
          z-index: 3;
        }
        .games-page .hero-points-card {
          display: inline-flex;
          align-items: center;
          gap: 16px;
          padding: 18px 26px;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 22px;
          backdrop-filter: blur(18px);
          box-shadow: 0 18px 36px rgba(2, 44, 34, 0.35);
        }
        .games-page .hpc-star {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #fbbf24, #f59e0b);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 8px 18px rgba(245, 158, 11, 0.45);
          flex-shrink: 0;
        }
        .games-page .hpc-star svg { width: 22px; height: 22px; }
        .games-page .hpc-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .games-page .hpc-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.72);
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .games-page .hpc-value {
          font-size: 28px;
          font-weight: 900;
          line-height: 1;
          background: linear-gradient(135deg, #ecfdf5, #a7f3d0);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          letter-spacing: -0.5px;
        }
        .games-page .hpc-value .unit {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.72);
          font-weight: 700;
          margin-left: 6px;
          -webkit-text-fill-color: rgba(255, 255, 255, 0.72);
          background: none;
        }

        /* ───────── HERO RESPONSIVE ───────── */
        @media (max-width: 1024px) {
          .games-page .lucky-hero { padding: 36px 32px; border-radius: 28px; }
          .games-page .hero-title { font-size: 40px; }
          .games-page .float-cards { width: 180px; }
        }
        @media (max-width: 768px) {
          .games-page .lucky-hero { padding: 28px 22px; border-radius: 24px; }
          .games-page .hero-title { font-size: 32px; letter-spacing: -1px; }
          .games-page .float-cards { display: none; }
          .games-page .hero-points-card { padding: 14px 18px; }
          .games-page .hpc-value { font-size: 24px; }
        }
        @media (max-width: 480px) {
          .games-page .lucky-hero { padding: 22px 16px; border-radius: 20px; }
          .games-page .hero-badge { font-size: 11px; padding: 5px 11px; }
          .games-page .hero-title { font-size: 26px; }
        }

        /* ───────── COMMON GLASS CARD (game content) ───────── */
        .games-page .glass-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.68));
          backdrop-filter: blur(30px);
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 32px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 1);
        }
        .games-page .section-title {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-size: 22px;
          font-weight: 900;
          color: var(--text-main);
          letter-spacing: -0.5px;
          margin: 0;
        }
        .games-page .section-title .st-icon {
          width: 36px; height: 36px;
          border-radius: 12px;
          background: linear-gradient(135deg, #10b981, #047857);
          display: flex; align-items: center; justify-content: center;
          color: #fff;
          box-shadow: 0 10px 20px rgba(16, 185, 129, 0.35);
        }

        /* ═══════════════════════════════════════════════════
           可爱插画风库 (cute illustration kit)
           ═══════════════════════════════════════════════════ */

        /* ───── 场景背景：每个游戏的"舞台衬底" ───── */
        .games-page .cute-scene {
          position: relative;
          border-radius: 32px;
          overflow: hidden;
          background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%);
          border: 1px solid rgba(167, 243, 208, 0.6);
          box-shadow: 0 18px 36px rgba(2, 44, 34, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.8);
        }
        .games-page .cute-scene::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 20% 100%, rgba(110, 231, 183, 0.5), transparent 50%),
            radial-gradient(circle at 80% 0%, rgba(255, 255, 255, 0.7), transparent 40%);
          pointer-events: none;
        }
        .games-page .cute-scene-body {
          position: relative;
          z-index: 2;
          padding: 24px 26px;
        }

        /* 场景里的飘浮 emoji（点缀） */
        .games-page .scene-deco {
          position: absolute;
          pointer-events: none;
          opacity: 0.9;
          filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.12));
        }
        .games-page .scene-deco.s-tl { top: 12px; left: 18px; }
        .games-page .scene-deco.s-tr { top: 12px; right: 18px; }
        .games-page .scene-deco.s-bl { bottom: 12px; left: 18px; }
        .games-page .scene-deco.s-br { bottom: 12px; right: 18px; }

        @keyframes cute-sway {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50% { transform: translateY(-6px) rotate(3deg); }
        }
        @keyframes cute-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes cute-spin-slow {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes cute-pop-in {
          0% { transform: scale(0.6) rotate(-12deg); opacity: 0; }
          70% { transform: scale(1.1) rotate(4deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes cute-bounce {
          0%, 100% { transform: scale(1); }
          25% { transform: scale(1.08); }
          50% { transform: scale(0.96); }
          75% { transform: scale(1.04); }
        }
        @keyframes cute-shimmer {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }
        @keyframes cute-tail-wag {
          0%, 100% { transform: rotate(-8deg); }
          50% { transform: rotate(8deg); }
        }
        @keyframes cute-rise-fade {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-30px); opacity: 0; }
        }

        .games-page .anim-sway { animation: cute-sway 4s ease-in-out infinite; }
        .games-page .anim-bob { animation: cute-bob 3s ease-in-out infinite; }
        .games-page .anim-spin-slow { animation: cute-spin-slow 18s linear infinite; }
        .games-page .anim-pop-in { animation: cute-pop-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
        .games-page .anim-bounce { animation: cute-bounce 0.55s ease-in-out; }
        .games-page .anim-shimmer { animation: cute-shimmer 2s ease-in-out infinite; }
        .games-page .anim-tail-wag { animation: cute-tail-wag 0.5s ease-in-out infinite; transform-origin: 50% 100%; }

        /* ───── 可爱按钮：弹跳 / 软糖 / 圆形主操作 ───── */
        .games-page .bouncy-btn {
          position: relative;
          display: inline-flex; align-items: center; justify-content: center;
          gap: 8px;
          padding: 14px 24px;
          border-radius: 999px;
          font-size: 15px; font-weight: 900; letter-spacing: 0.5px;
          border: none;
          color: #fff;
          background: linear-gradient(180deg, #34d399 0%, #10b981 50%, #059669 100%);
          box-shadow:
            0 8px 0 rgba(4, 120, 87, 0.85),
            0 12px 18px rgba(16, 185, 129, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.5);
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          text-decoration: none;
        }
        .games-page .bouncy-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow:
            0 10px 0 rgba(4, 120, 87, 0.85),
            0 16px 22px rgba(16, 185, 129, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.6);
        }
        .games-page .bouncy-btn:active:not(:disabled) {
          transform: translateY(4px);
          box-shadow:
            0 4px 0 rgba(4, 120, 87, 0.85),
            0 6px 10px rgba(16, 185, 129, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.5);
        }
        .games-page .bouncy-btn:disabled {
          background: linear-gradient(180deg, #d4d4d8, #a1a1aa);
          box-shadow: 0 4px 0 rgba(82, 82, 91, 0.5);
          cursor: not-allowed;
          opacity: 0.7;
        }

        .games-page .bouncy-btn.soft {
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
          color: var(--c-green-700);
          border: 2px solid var(--c-green-100);
          box-shadow:
            0 6px 0 rgba(16, 185, 129, 0.15),
            0 10px 16px rgba(16, 185, 129, 0.18);
        }
        .games-page .bouncy-btn.soft:hover:not(:disabled) {
          background: linear-gradient(180deg, #fff 0%, #d1fae5 100%);
          color: var(--c-green-800);
        }

        .games-page .bouncy-btn.danger {
          background: linear-gradient(180deg, #fff 0%, #fef2f2 100%);
          color: #b91c1c;
          border: 2px solid #fecaca;
          box-shadow:
            0 6px 0 rgba(220, 38, 38, 0.15),
            0 10px 16px rgba(220, 38, 38, 0.15);
        }

        /* ───── 软糖卡片：用于难度选、记录条、面板 ───── */
        .games-page .candy-card {
          position: relative;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(236, 253, 245, 0.85));
          border: 2px solid rgba(167, 243, 208, 0.8);
          border-radius: 24px;
          padding: 20px 22px;
          box-shadow:
            0 14px 28px rgba(2, 44, 34, 0.08),
            inset 0 2px 0 rgba(255, 255, 255, 1),
            inset 0 -2px 0 rgba(167, 243, 208, 0.5);
          transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s;
        }
        .games-page .candy-card.is-clickable { cursor: pointer; }
        .games-page .candy-card.is-clickable:hover {
          transform: translateY(-6px) rotate(-1deg);
          box-shadow:
            0 22px 42px rgba(16, 185, 129, 0.22),
            inset 0 2px 0 rgba(255, 255, 255, 1),
            inset 0 -2px 0 rgba(167, 243, 208, 0.5);
        }
        .games-page .candy-card.is-active {
          background: linear-gradient(180deg, #34d399 0%, #10b981 100%);
          border-color: #047857;
          box-shadow:
            0 14px 28px rgba(16, 185, 129, 0.4),
            inset 0 2px 0 rgba(255, 255, 255, 0.4),
            inset 0 -2px 0 rgba(4, 120, 87, 0.5);
          color: #fff;
        }

        /* ───── 数据气泡（分数/连击/状态） ───── */
        .games-page .score-bubble {
          position: relative;
          display: inline-flex; flex-direction: column; align-items: center;
          padding: 12px 20px;
          border-radius: 22px;
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
          border: 2px solid var(--c-green-100);
          box-shadow: 0 6px 14px rgba(16, 185, 129, 0.18);
          min-width: 80px;
        }
        .games-page .score-bubble.is-warn {
          background: linear-gradient(180deg, #fff 0%, #fef3c7 100%);
          border-color: #fcd34d;
          box-shadow: 0 6px 14px rgba(251, 191, 36, 0.25);
        }
        .games-page .score-bubble.is-danger {
          background: linear-gradient(180deg, #fff 0%, #fee2e2 100%);
          border-color: #fca5a5;
          box-shadow: 0 6px 14px rgba(248, 113, 113, 0.25);
        }
        .games-page .score-bubble .sb-label {
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--c-green-700);
          margin-bottom: 2px;
        }
        .games-page .score-bubble.is-warn .sb-label { color: #b45309; }
        .games-page .score-bubble.is-danger .sb-label { color: #b91c1c; }
        .games-page .score-bubble .sb-value {
          font-size: 24px;
          font-weight: 900;
          color: var(--text-main);
          line-height: 1;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.5px;
        }
        .games-page .score-bubble .sb-emoji {
          position: absolute;
          top: -10px; right: -8px;
          font-size: 22px;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
        }

        /* ───── 标签胶囊（emoji + 文字）───── */
        .games-page .cute-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 999px;
          background: linear-gradient(180deg, #fff, #ecfdf5);
          border: 1.5px solid var(--c-green-100);
          color: var(--c-green-700);
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.3px;
          box-shadow: 0 4px 10px rgba(16, 185, 129, 0.12);
        }
        .games-page .cute-pill.amber {
          background: linear-gradient(180deg, #fff, #fef3c7);
          border-color: #fcd34d;
          color: #b45309;
          box-shadow: 0 4px 10px rgba(251, 191, 36, 0.18);
        }
        .games-page .cute-pill.danger {
          background: linear-gradient(180deg, #fff, #fee2e2);
          border-color: #fca5a5;
          color: #b91c1c;
          box-shadow: 0 4px 10px rgba(248, 113, 113, 0.18);
        }
        .games-page .cute-pill.slate {
          background: linear-gradient(180deg, #fff, #f1f5f9);
          border-color: #cbd5e1;
          color: #475569;
        }

        /* ───── 分数浮起动画（消除/命中反馈） ───── */
        .games-page .score-pop {
          position: absolute;
          font-size: 24px;
          font-weight: 900;
          color: #10b981;
          pointer-events: none;
          animation: cute-rise-fade 0.9s ease-out forwards;
          text-shadow: 0 2px 6px rgba(255, 255, 255, 0.9);
        }

        /* ───── 装饰：草坪 / 云朵 / 山影 一体 CSS 图形 ───── */
        .games-page .deco-grass-line {
          position: absolute;
          left: 0; right: 0; bottom: -2px;
          height: 22px;
          background:
            radial-gradient(ellipse 18px 22px at 10% 100%, #34d399 50%, transparent 50%),
            radial-gradient(ellipse 14px 18px at 25% 100%, #10b981 50%, transparent 50%),
            radial-gradient(ellipse 20px 24px at 42% 100%, #34d399 50%, transparent 50%),
            radial-gradient(ellipse 16px 20px at 58% 100%, #10b981 50%, transparent 50%),
            radial-gradient(ellipse 22px 26px at 75% 100%, #34d399 50%, transparent 50%),
            radial-gradient(ellipse 14px 18px at 90% 100%, #10b981 50%, transparent 50%);
          opacity: 0.7;
        }
        .games-page .deco-cloud-line {
          position: absolute;
          left: 0; right: 0; top: -2px;
          height: 32px;
          background:
            radial-gradient(ellipse 30px 16px at 15% 0%, #fff 60%, transparent 60%),
            radial-gradient(ellipse 36px 20px at 40% 0%, #fff 60%, transparent 60%),
            radial-gradient(ellipse 28px 14px at 65% 0%, #fff 60%, transparent 60%),
            radial-gradient(ellipse 40px 22px at 88% 0%, #fff 60%, transparent 60%);
          opacity: 0.6;
          pointer-events: none;
        }
        .games-page .deco-stars-bg {
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle 1.5px at 10% 20%, rgba(255, 255, 255, 0.9), transparent),
            radial-gradient(circle 1px at 30% 60%, rgba(255, 255, 255, 0.7), transparent),
            radial-gradient(circle 2px at 50% 30%, rgba(255, 255, 255, 0.9), transparent),
            radial-gradient(circle 1px at 70% 80%, rgba(255, 255, 255, 0.6), transparent),
            radial-gradient(circle 1.5px at 85% 25%, rgba(255, 255, 255, 0.9), transparent),
            radial-gradient(circle 1px at 15% 75%, rgba(255, 255, 255, 0.7), transparent),
            radial-gradient(circle 2px at 60% 65%, rgba(255, 255, 255, 0.8), transparent);
          pointer-events: none;
        }

        /* ───── 角标徽章（卡片右上角） ───── */
        .games-page .corner-badge {
          position: absolute;
          top: -8px; right: -8px;
          padding: 4px 10px;
          border-radius: 999px;
          background: linear-gradient(180deg, #fbbf24, #f59e0b);
          color: #78350f;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          box-shadow: 0 4px 10px rgba(245, 158, 11, 0.4);
          transform: rotate(8deg);
          z-index: 2;
        }

        /* ───── 大型 emoji 装饰 ───── */
        .games-page .big-emoji {
          display: inline-block;
          filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.2));
          user-select: none;
        }

        /* ───── 微交互：所有 .candy-card / .bouncy-btn 在 mount 时弹入 ───── */
        .games-page .stage-enter {
          animation: cute-pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
        }
      `}</style>
    </div>
  );
}
