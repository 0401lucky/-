'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Package, Sparkles, Gift, Activity,
  Users, MessageSquareText, Megaphone,
  ShoppingBag, Layers, Settings,
  LogOut, Home, X,
  User as UserIcon,
} from 'lucide-react';
import type { AdminUser } from './AdminContext';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '运营管理',
    items: [
      { name: '项目管理', href: '/admin', icon: Package },
      { name: '抽奖管理', href: '/admin/lottery', icon: Sparkles },
      { name: '多人抽奖', href: '/admin/raffle', icon: Gift },
      { name: '运营仪表盘', href: '/admin/dashboard', icon: Activity },
    ],
  },
  {
    label: '内容与用户',
    items: [
      { name: '用户管理', href: '/admin/users', icon: Users },
      { name: '反馈墙', href: '/admin/feedback', icon: MessageSquareText },
      { name: '公告管理', href: '/admin/announcements', icon: Megaphone },
    ],
  },
  {
    label: '商城与收藏',
    items: [
      { name: '商品管理', href: '/admin/store', icon: ShoppingBag },
      { name: '卡牌管理', href: '/admin/cards', icon: Layers },
    ],
  },
  {
    label: '系统',
    items: [
      { name: '设置', href: '/admin/settings', icon: Settings },
    ],
  },
];

function isActive(href: string, pathname: string) {
  if (href === '/admin') return pathname === '/admin';
  return pathname.startsWith(href);
}

/* ---------- sidebar content (shared between desktop & mobile) ---------- */

function SidebarContent({
  user,
  onLogout,
  onNavClick,
}: {
  user: AdminUser;
  onLogout: () => void;
  onNavClick?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full">
      {/* Logo / Brand */}
      <div className="px-5 py-5 border-b border-stone-200/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl gradient-warm flex items-center justify-center shadow-sm">
            <span className="text-white text-lg font-bold">A</span>
          </div>
          <span className="text-lg font-bold text-stone-800 tracking-tight">管理后台</span>
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-400">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href, pathname);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavClick}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        active
                          ? 'bg-orange-50 text-orange-700 border-l-2 border-orange-500 shadow-sm'
                          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-800 border-l-2 border-transparent'
                      }`}
                    >
                      <Icon className={`w-[18px] h-[18px] ${active ? 'text-orange-500' : 'text-stone-400'}`} />
                      {item.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom: user info + actions */}
      <div className="border-t border-stone-200/60 p-4 space-y-3">
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
        >
          <Home className="w-4 h-4" />
          返回首页
        </Link>
        <div className="flex items-center justify-between px-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center shrink-0">
              <UserIcon className="w-3.5 h-3.5 text-stone-500" />
            </div>
            <span className="text-sm font-semibold text-stone-700 truncate">{user.displayName}</span>
          </div>
          <button
            onClick={onLogout}
            className="p-2 rounded-lg hover:bg-red-50 text-stone-400 hover:text-red-500 transition-colors"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- exported component ---------- */

export default function AdminSidebar({
  user,
  onLogout,
  mobileOpen,
  onMobileClose,
}: {
  user: AdminUser;
  onLogout: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-60 bg-white/80 backdrop-blur-xl border-r border-stone-200/60 z-40">
        <SidebarContent user={user} onLogout={onLogout} />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
            onClick={onMobileClose}
          />
          {/* drawer */}
          <aside className="relative w-72 max-w-[80vw] h-full bg-white shadow-2xl animate-slide-in-left">
            <button
              onClick={onMobileClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent user={user} onLogout={onLogout} onNavClick={onMobileClose} />
          </aside>
        </div>
      )}
    </>
  );
}
