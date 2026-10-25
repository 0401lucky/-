'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Command, LogOut, UserRound, X } from 'lucide-react';
import type { AdminUser } from './AdminContext';
import { ADMIN_NAV_GROUPS, isAdminNavActive } from './navigation';

interface SidebarProps {
  user: AdminUser;
  onLogout: () => void;
  loggingOut: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function SidebarContent({
  user,
  onLogout,
  loggingOut,
  onNavClick,
}: Pick<SidebarProps, 'user' | 'onLogout' | 'loggingOut'> & {
  onNavClick?: () => void;
}) {
  const pathname = usePathname();
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <Link
        href="/admin/dashboard"
        onClick={onNavClick}
        className="flex h-20 shrink-0 items-center gap-3 px-6"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-700 text-white">
          <Command className="h-5 w-5" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-base font-semibold tracking-tight text-stone-900">
            LuCy Station
          </span>
          <span className="mt-0.5 block text-[11px] tracking-[0.12em] text-stone-400">
            运营管理后台
          </span>
        </span>
      </Link>
      <nav
        aria-label="后台主导航"
        className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6 pt-3"
      >
        {ADMIN_NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-2 px-3 text-[11px] font-medium tracking-wider text-stone-400">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map(({ name, href, icon: Icon }) => {
                const active = isAdminNavActive(href, pathname);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavClick}
                      aria-current={active ? 'page' : undefined}
                      className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${active ? 'bg-orange-50 text-orange-800' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-900'}`}
                    >
                      {active && (
                        <span className="absolute -left-4 h-5 w-[3px] rounded-r bg-orange-700" />
                      )}
                      <Icon
                        className={`h-[18px] w-[18px] ${active ? 'text-orange-700' : 'text-stone-400'}`}
                        aria-hidden="true"
                      />
                      {name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-stone-100 p-4">
        <Link
          href="/"
          onClick={onNavClick}
          className="mb-4 flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2.5 text-xs font-medium text-stone-500 hover:bg-stone-50"
        >
          访问站点
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <div className="flex items-center gap-2.5 px-1">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500">
            <UserRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-stone-800">
              {user.displayName || user.username}
            </p>
            <p className="mt-0.5 text-[11px] text-stone-400">管理员</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            className="admin-icon-button"
            title="退出登录"
            aria-label="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminSidebar({
  mobileOpen,
  onMobileClose,
  ...props
}: SidebarProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    const query = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (query.matches) onMobileClose();
    };
    closeOnDesktop();
    query.addEventListener('change', closeOnDesktop);
    return () => query.removeEventListener('change', closeOnDesktop);
  }, [mobileOpen, onMobileClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!mobileOpen || !dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [mobileOpen]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-stone-200 lg:block">
        <SidebarContent {...props} />
      </aside>
      <dialog
        ref={dialogRef}
        aria-label="后台导航菜单"
        className="admin-mobile-nav fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] border-0 bg-white p-0 shadow-2xl backdrop:bg-stone-900/40 lg:hidden"
        onCancel={(event) => {
          event.preventDefault();
          onMobileClose();
        }}
        onClick={(event) => {
          if (event.currentTarget === event.target) onMobileClose();
        }}
      >
        <button
          type="button"
          onClick={onMobileClose}
          className="admin-icon-button absolute right-2 top-5 z-10"
          aria-label="关闭导航菜单"
        >
          <X className="h-4 w-4" />
        </button>
        <SidebarContent {...props} onNavClick={onMobileClose} />
      </dialog>
    </>
  );
}
