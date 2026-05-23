'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Gift,
  LayoutDashboard,
  MessageSquareText,
  UserRound,
} from 'lucide-react';
import TypewriterTitle from '@/components/TypewriterTitle';
import type { PublicAchievement } from '@/lib/profile-achievements';

export type SiteSidebarNavKey = 'home' | 'feedback' | 'checkin' | 'notifications' | 'admin' | 'profile';

interface SiteSidebarProps {
  /** 当前页对应的导航项；用于高亮 */
  activeNav?: SiteSidebarNavKey;
}

interface MeResponse {
  success: boolean;
  user?: {
    id: number;
    username: string;
    displayName: string;
    isAdmin: boolean;
  };
}

interface ProfileSettingsResponse {
  success: boolean;
  data?: {
    displayName: string | null;
    avatarUrl: string | null;
    equippedAchievement?: PublicAchievement | null;
  };
}

interface UnreadCountResponse {
  success: boolean;
  data?: { unreadCount: number };
}

interface SidebarUser {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  customDisplayName: string | null;
  customAvatarUrl: string | null;
  equippedAchievement: PublicAchievement | null;
}

interface ProfileUpdatedDetail {
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
}

const NAV_BASE_ITEMS: Array<{
  key: SiteSidebarNavKey;
  href: string;
  label: string;
  icon: React.ReactNode;
}> = [
  { key: 'feedback', href: '/feedback', label: '反馈墙', icon: <MessageSquareText /> },
  { key: 'checkin', href: '/checkin', label: '每日签到', icon: <CalendarDays /> },
  { key: 'notifications', href: '/notifications', label: '通知中心', icon: <Bell /> },
];

const ADMIN_NAV_ITEM = {
  key: 'admin' as const,
  href: '/admin',
  label: '后台管理',
  icon: <LayoutDashboard />,
};

export function SiteSidebar({ activeNav }: SiteSidebarProps) {
  const [user, setUser] = useState<SidebarUser | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // 是否完成首次身份探测，避免页面闪烁
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      try {
        const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
        const meJson = (await meRes.json().catch(() => ({}))) as MeResponse;
        if (cancelled) return;
        if (!meRes.ok || !meJson.success || !meJson.user) {
          setUser(null);
          setUnreadCount(0);
          setAuthResolved(true);
          return;
        }

        const baseUser: SidebarUser = {
          id: meJson.user.id,
          username: meJson.user.username,
          displayName: meJson.user.displayName,
          isAdmin: meJson.user.isAdmin,
          customDisplayName: null,
          customAvatarUrl: null,
          equippedAchievement: null,
        };
        setUser(baseUser);
        setAuthResolved(true);

        // 并行获取自定义资料和未读数；失败时静默
        const [settingsRes, unreadRes] = await Promise.allSettled([
          fetch('/api/profile/settings', { cache: 'no-store' }),
          fetch('/api/notifications/unread-count', { cache: 'no-store' }),
        ]);

        if (!cancelled && settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
          const json = (await settingsRes.value.json().catch(() => ({}))) as ProfileSettingsResponse;
          if (json.success && json.data) {
            setUser((prev) =>
              prev
                ? {
                    ...prev,
                    customDisplayName: json.data?.displayName ?? null,
                    customAvatarUrl: json.data?.avatarUrl ?? null,
                    equippedAchievement: json.data?.equippedAchievement ?? null,
                  }
                : prev
            );
          }
        }

        if (!cancelled && unreadRes.status === 'fulfilled' && unreadRes.value.ok) {
          const json = (await unreadRes.value.json().catch(() => ({}))) as UnreadCountResponse;
          if (json.success && typeof json.data?.unreadCount === 'number') {
            setUnreadCount(json.data.unreadCount);
          }
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setUnreadCount(0);
          setAuthResolved(true);
        }
      }
    };

    void loadAll();

    // 监听个人资料更新事件，立即同步侧栏头像/昵称
    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ProfileUpdatedDetail>).detail;
      if (!detail) return;
      setUser((prev) =>
        prev
          ? (() => {
              const next: SidebarUser = { ...prev };
              if (Object.prototype.hasOwnProperty.call(detail, 'displayName')) {
                next.customDisplayName = detail.displayName ?? null;
              }
              if (Object.prototype.hasOwnProperty.call(detail, 'avatarUrl')) {
                next.customAvatarUrl = detail.avatarUrl ?? null;
              }
              if (Object.prototype.hasOwnProperty.call(detail, 'equippedAchievement')) {
                next.equippedAchievement = detail.equippedAchievement ?? null;
              }
              return next;
            })()
          : prev
      );
    };
    window.addEventListener('lucky:profile-updated', handleProfileUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener('lucky:profile-updated', handleProfileUpdated);
    };
  }, []);

  const navItems = [...NAV_BASE_ITEMS, ...(user?.isAdmin ? [ADMIN_NAV_ITEM] : [])];

  const displayName = user?.customDisplayName ?? user?.displayName ?? user?.username ?? '';
  const avatarUrl = user?.customAvatarUrl ?? null;
  const initial = (displayName[0] || '?').toUpperCase();
  const isProfileActive = activeNav === 'profile';

  // user-profile 区块文案
  // user-profile 区块文案：未登录显示"请登录"无副标题；
  // 已登录时主标题显示昵称，副标题根据角色区分"管理员/用户"
  let profileTitle = '请登录';
  let profileSub: string | null = null;
  if (user) {
    profileTitle = displayName || user.username;
    profileSub = user.equippedAchievement
      ? `${user.equippedAchievement.emoji} ${user.equippedAchievement.name}`
      : user.isAdmin ? '管理员' : '用户';
  }

  return (
    <aside className="site-sidebar" data-resolved={authResolved ? '1' : '0'}>
      <Link href="/" className={`ss-brand ${activeNav === 'home' ? 'active' : ''}`}>
        <div className="ss-brand-icon">
          <Gift />
        </div>
        <span className="ss-brand-text">Lucky福利站</span>
        <span className="ss-mobile-label">首页</span>
      </Link>

      <div className="ss-hero">
        <h1 className="ss-hero-title">
          <TypewriterTitle
            line1="Welcome to"
            line2="Lucky Station"
            spanClassName="ss-hero-gradient"
          />
        </h1>

        <nav className="ss-nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const isActive = activeNav === item.key;
            const showBadge = item.key === 'notifications' && unreadCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`ss-nav-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="ss-nav-icon">
                  {item.icon}
                  {showBadge && (
                    <span className="ss-nav-badge" aria-label={`${unreadCount} 条未读通知`}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
                <span className="ss-nav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <Link
        href={user ? '/profile' : '/login'}
        className={`ss-user-profile ${isProfileActive ? 'active' : ''}`}
        aria-label={user ? '查看个人主页' : '前往登录'}
      >
        <div className="ss-avatar">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={displayName} className="ss-avatar-img" />
          ) : user ? (
            initial
          ) : (
            <UserRound className="ss-avatar-default" />
          )}
        </div>
        <span className="ss-mobile-profile-label">我的</span>
        <div className="ss-user-info">
          <h4>{profileTitle}</h4>
          {profileSub && <p title={user?.equippedAchievement?.desc ?? profileSub}>{profileSub}</p>}
        </div>
        <ChevronRight className="ss-profile-arrow" />
      </Link>

      <style jsx global>{`
        .site-sidebar {
          flex: 0 0 clamp(420px, 38vw, 720px);
          width: auto;
          padding: 4rem 5rem;
          position: sticky;
          top: 0;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          color: #0f172a;
          box-sizing: border-box;
        }

        .site-sidebar * { box-sizing: border-box; }
        .site-sidebar a { color: inherit; text-decoration: none; }

        .site-sidebar .ss-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: #0f172a;
        }

        .site-sidebar .ss-mobile-label,
        .site-sidebar .ss-mobile-profile-label {
          display: none;
        }

        .site-sidebar .ss-brand-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 20px rgba(255, 122, 0, 0.3);
          flex-shrink: 0;
        }

        .site-sidebar .ss-brand-icon svg {
          width: 24px;
          height: 24px;
          color: #fff;
          stroke-width: 2.5;
        }

        .site-sidebar .ss-hero {
          margin-top: -5vh;
        }

        .site-sidebar .ss-hero-title {
          font-size: 64px;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -2px;
          margin: 0 0 24px;
          /* 始终预留两行高度，避免打字机过程中下方导航按钮被推动 */
          min-height: calc(2 * 1.1em);
        }

        .site-sidebar .ss-hero-title .ss-hero-gradient {
          background: linear-gradient(135deg, #ff5a00, #ff0080);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* 打字机光标在 ss-hero-title 中保持可见的橙色，不被渐变 transparent 影响 */
        .site-sidebar .ss-hero-title .tw-cursor {
          color: #ff5a00;
          -webkit-text-fill-color: #ff5a00;
        }

        .site-sidebar .ss-nav-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .site-sidebar .ss-nav-item {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 24px;
          background: rgba(255, 255, 255, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.6);
          border-radius: 20px;
          font-size: 16px;
          font-weight: 600;
          color: #0f172a;
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          width: fit-content;
          min-width: 220px;
          position: relative;
        }

        .site-sidebar .ss-nav-item:hover {
          background: rgba(255, 255, 255, 0.9);
          transform: translateX(8px);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.03);
          color: #f97316;
        }

        .site-sidebar .ss-nav-item.active {
          background: rgba(249, 115, 22, 0.12);
          border-color: rgba(249, 115, 22, 0.3);
          color: #f97316;
        }

        .site-sidebar .ss-nav-item.active:hover {
          transform: translateX(8px);
        }

        .site-sidebar .ss-nav-icon {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .site-sidebar .ss-nav-item svg {
          width: 20px;
          height: 20px;
        }

        .site-sidebar .ss-nav-label {
          flex: 1;
        }

        .site-sidebar .ss-nav-badge {
          position: absolute;
          top: -6px;
          right: -8px;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: linear-gradient(135deg, #ff004c, #f97316);
          color: #fff;
          font-size: 10px;
          font-weight: 800;
          line-height: 18px;
          text-align: center;
          box-shadow: 0 4px 8px rgba(255, 0, 76, 0.3);
          letter-spacing: -0.2px;
        }

        .site-sidebar .ss-user-profile {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          background: #fff;
          border: 1px solid rgba(15, 23, 42, 0.04);
          border-radius: 999px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
          width: fit-content;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .site-sidebar .ss-user-profile:hover {
          transform: scale(1.02);
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.08);
        }

        .site-sidebar .ss-user-profile.active {
          background: linear-gradient(135deg, rgba(255, 122, 0, 0.08), rgba(255, 0, 76, 0.05));
          border-color: rgba(255, 122, 0, 0.25);
          box-shadow: 0 16px 40px rgba(255, 122, 0, 0.12);
        }

        .site-sidebar .ss-user-profile.active::before {
          content: '当前';
          position: absolute;
          top: -8px;
          left: 16px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          letter-spacing: 0.5px;
        }

        .site-sidebar .ss-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 800;
          color: #fff;
          text-transform: uppercase;
          flex-shrink: 0;
          overflow: hidden;
        }

        .site-sidebar .ss-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .site-sidebar .ss-avatar-default {
          width: 24px;
          height: 24px;
          color: #94a3b8;
          stroke-width: 2;
        }

        .site-sidebar .ss-user-info {
          min-width: 0;
        }

        .site-sidebar .ss-user-info h4 {
          font-size: 16px;
          font-weight: 700;
          margin: 0 0 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 180px;
        }

        .site-sidebar .ss-user-info p {
          font-size: 13px;
          color: #64748b;
          margin: 0;
          max-width: 180px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .site-sidebar .ss-profile-arrow {
          width: 20px;
          height: 20px;
          color: #64748b;
          margin-left: auto;
          flex-shrink: 0;
        }

        @media (max-width: 1200px) {
          .site-sidebar { padding: 3rem; }
          .site-sidebar .ss-hero-title { font-size: 42px; }
        }

        @media (max-width: 992px) {
          .site-sidebar {
            width: 100%;
            height: auto;
            position: relative;
            padding: 1.5rem 2rem 0;
            padding-top: max(1.5rem, env(safe-area-inset-top));
            padding-left: max(2rem, env(safe-area-inset-left));
            padding-right: max(2rem, env(safe-area-inset-right));
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            text-align: left;
            z-index: 10;
          }

          .site-sidebar .ss-brand { font-size: 20px; }
          .site-sidebar .ss-brand-icon {
            width: 32px;
            height: 32px;
            border-radius: 10px;
          }
          .site-sidebar .ss-brand-icon svg { width: 18px; height: 18px; }

          .site-sidebar .ss-user-profile {
            position: absolute;
            top: max(1.5rem, env(safe-area-inset-top));
            right: 2rem;
            margin: 0;
            padding: 0;
            width: auto;
            background: transparent;
            border: none;
            box-shadow: none;
          }
          .site-sidebar .ss-user-profile.active { background: transparent; box-shadow: none; }
          .site-sidebar .ss-user-profile.active::before { display: none; }
          .site-sidebar .ss-user-profile:hover { transform: none; box-shadow: none; }
          .site-sidebar .ss-user-profile .ss-user-info,
          .site-sidebar .ss-user-profile .ss-profile-arrow { display: none; }
          .site-sidebar .ss-user-profile .ss-avatar {
            width: 40px;
            height: 40px;
            margin: 0;
            border: 2px solid #f97316;
          }

          .site-sidebar .ss-hero { margin-top: 1rem; width: 100%; }
          .site-sidebar .ss-hero-title { font-size: 36px; margin-bottom: 16px; }

          .site-sidebar .ss-nav-list {
            flex-direction: row;
            flex-wrap: nowrap;
            overflow-x: auto;
            width: 100%;
            gap: 12px;
            padding-bottom: 16px;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          .site-sidebar .ss-nav-list::-webkit-scrollbar { display: none; }
          .site-sidebar .ss-nav-item {
            flex: 0 0 auto;
            padding: 10px 16px;
            font-size: 14px;
            min-width: 0;
            min-height: 40px;
          }
          .site-sidebar .ss-nav-item:hover { transform: none; }
        }

        @media (max-width: 640px) {
          .site-sidebar {
            position: fixed;
            left: 50%;
            right: auto;
            top: auto;
            bottom: max(0.75rem, env(safe-area-inset-bottom));
            width: min(420px, calc(100% - 1.5rem));
            margin: 0;
            padding: 0.5rem;
            background:
              linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(248, 250, 252, 0.72));
            border: 1px solid rgba(255, 255, 255, 0.92);
            border-radius: 24px;
            box-shadow:
              0 18px 40px rgba(15, 23, 42, 0.13),
              inset 0 1px 0 rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(22px);
            -webkit-backdrop-filter: blur(22px);
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            align-items: stretch;
            gap: 6px;
            overflow: visible;
            transform: translateX(-50%);
            z-index: 80;
          }

          .site-sidebar ~ main {
            padding-bottom: max(7.25rem, calc(5.75rem + env(safe-area-inset-bottom))) !important;
          }

          .site-sidebar .ss-brand {
            max-width: none;
            min-width: 0;
            height: 54px;
            padding: 7px 4px 6px;
            border-radius: 18px;
            flex-direction: column;
            justify-content: center;
            gap: 4px;
            font-size: 11.5px;
            font-weight: 800;
            color: #64748b;
            transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease;
          }

          .site-sidebar .ss-brand.active,
          .site-sidebar .ss-user-profile.active,
          .site-sidebar .ss-nav-item.active {
            background: linear-gradient(135deg, rgba(255, 122, 0, 0.14), rgba(255, 0, 76, 0.08));
            color: #f97316;
            box-shadow: inset 0 0 0 1px rgba(249, 115, 22, 0.14);
          }

          .site-sidebar .ss-brand:active,
          .site-sidebar .ss-user-profile:active,
          .site-sidebar .ss-nav-item:active {
            transform: scale(0.97);
          }

          .site-sidebar .ss-brand-text { display: none; }
          .site-sidebar .ss-mobile-label,
          .site-sidebar .ss-mobile-profile-label {
            display: block;
            max-width: 100%;
            line-height: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .site-sidebar .ss-brand-icon {
            width: 25px;
            height: 25px;
            border-radius: 10px;
            box-shadow: 0 8px 16px rgba(255, 122, 0, 0.2);
          }
          .site-sidebar .ss-brand-icon svg { width: 15px; height: 15px; }

          .site-sidebar .ss-hero,
          .site-sidebar .ss-nav-list {
            display: contents;
          }

          .site-sidebar .ss-user-profile {
            position: relative;
            top: auto;
            right: auto;
            margin: 0;
            width: 100%;
            height: 54px;
            padding: 7px 4px 6px;
            border-radius: 18px;
            background: transparent;
            border: 0;
            box-shadow: none;
            flex-direction: column;
            justify-content: center;
            gap: 4px;
            color: #64748b;
            font-size: 11.5px;
            font-weight: 800;
          }

          .site-sidebar .ss-user-profile:hover {
            transform: none;
            box-shadow: none;
          }

          .site-sidebar .ss-user-profile .ss-avatar {
            width: 25px;
            height: 25px;
            margin: 0;
            border: 0;
            font-size: 11px;
            box-shadow: 0 8px 16px rgba(15, 23, 42, 0.08);
          }

          .site-sidebar .ss-user-profile .ss-user-info,
          .site-sidebar .ss-user-profile .ss-profile-arrow {
            display: none;
          }

          .site-sidebar .ss-hero-title { display: none; }

          .site-sidebar .ss-nav-item {
            width: 100%;
            height: 54px;
            justify-content: center;
            flex-direction: column;
            padding: 7px 4px 6px;
            font-size: 11.5px;
            min-height: 0;
            border-radius: 18px;
            gap: 4px;
            background: transparent;
            border: 0;
            color: #64748b;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            box-shadow: none;
            min-width: 0;
          }

          .site-sidebar .ss-nav-item:hover {
            transform: none;
            background: rgba(255, 255, 255, 0.52);
            color: #f97316;
            box-shadow: none;
          }

          .site-sidebar .ss-nav-label {
            flex: 0 1 auto;
            min-width: 0;
            max-width: 100%;
            line-height: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .site-sidebar .ss-nav-icon {
            width: 25px;
            height: 25px;
          }

          .site-sidebar .ss-nav-item svg { width: 18px; height: 18px; }
          .site-sidebar .ss-avatar-default { width: 15px; height: 15px; }

          .site-sidebar .ss-nav-badge {
            top: -7px;
            right: -8px;
            min-width: 16px;
            height: 16px;
            padding: 0 4px;
            font-size: 9px;
            line-height: 16px;
          }
        }

        @media (max-width: 480px) {
          .site-sidebar {
            bottom: max(0.625rem, env(safe-area-inset-bottom));
            width: calc(100% - 1rem);
            padding: 0.42rem;
            border-radius: 22px;
            gap: 4px;
          }
          .site-sidebar .ss-brand,
          .site-sidebar .ss-user-profile,
          .site-sidebar .ss-nav-item {
            height: 50px;
            border-radius: 16px;
            font-size: 10.5px;
          }
          .site-sidebar .ss-brand-icon,
          .site-sidebar .ss-user-profile .ss-avatar,
          .site-sidebar .ss-nav-icon {
            width: 23px;
            height: 23px;
          }
          .site-sidebar .ss-nav-item svg,
          .site-sidebar .ss-brand-icon svg {
            width: 15px;
            height: 15px;
          }
        }
      `}</style>
    </aside>
  );
}

export default SiteSidebar;
