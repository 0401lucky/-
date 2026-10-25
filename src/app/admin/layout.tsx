'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  ChevronRight,
  Loader2,
  Menu,
  ShieldCheck,
} from 'lucide-react';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { AdminContext, type AdminUser } from '@/components/admin/AdminContext';
import {
  AdminFeedbackProvider,
  useAdminFeedback,
} from '@/components/admin/AdminFeedback';
import { AdminError } from '@/components/admin/AdminUI';
import { getAdminLocation } from '@/components/admin/navigation';
import './admin.css';

function AdminWorkspace({
  user,
  children,
}: {
  user: AdminUser;
  children: ReactNode;
}) {
  const [mobileMenu, setMobileMenu] = useState({ open: false, pathname: '' });
  const [loggingOut, setLoggingOut] = useState(false);
  const { notify, confirmLeave } = useAdminFeedback();
  const router = useRouter();
  const pathname = usePathname();
  const location = getAdminLocation(pathname);

  const mobileOpen = mobileMenu.open && mobileMenu.pathname === pathname;
  if (mobileMenu.open && mobileMenu.pathname !== pathname) {
    setMobileMenu({ open: false, pathname });
  }

  const handleLogout = async () => {
    if (loggingOut || !(await confirmLeave())) return;
    setLoggingOut(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('退出失败，请稍后重试');
      router.replace('/');
    } catch (error) {
      notify(
        error instanceof Error ? error.message : '网络异常，退出失败',
        'error',
      );
      setLoggingOut(false);
    }
  };

  return (
    <AdminContext.Provider value={{ user }}>
      <div className="admin-workspace">
        <a
          href="#admin-main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3"
        >
          跳到主要内容
        </a>
        <AdminSidebar
          user={user}
          onLogout={() => void handleLogout()}
          loggingOut={loggingOut}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileMenu({ open: false, pathname })}
        />
        <div className="min-w-0 pt-16 lg:ml-60">
          <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-stone-200 bg-white/95 px-4 sm:px-7 lg:left-60">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenu({ open: true, pathname })}
                className="admin-icon-button -ml-2 lg:hidden"
                aria-label="打开导航菜单"
                aria-expanded={mobileOpen}
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="hidden text-xs text-stone-400 sm:block">
                {location.group}
              </span>
              <ChevronRight
                className="hidden h-3.5 w-3.5 text-stone-300 sm:block"
                aria-hidden="true"
              />
              <span className="truncate text-sm font-medium text-stone-700">
                {location.name}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <span className="hidden items-center gap-1.5 text-xs text-stone-500 md:flex">
                <ShieldCheck
                  className="h-3.5 w-3.5 text-emerald-600"
                  aria-hidden="true"
                />
                管理员工作区
              </span>
              <span className="hidden h-4 w-px bg-stone-200 md:block" />
              <Link
                href="/"
                className="flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-orange-700"
              >
                访问站点
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </header>
          <main
            id="admin-main"
            tabIndex={-1}
            className="mx-auto min-h-[calc(100dvh-4rem)] max-w-[1500px] p-4 outline-none sm:p-6 xl:p-8"
          >
            {children}
          </main>
        </div>
      </div>
    </AdminContext.Provider>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const loadUser = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch('/api/auth/me', {
          signal,
          cache: 'no-store',
        });
        if (signal?.aborted) return;
        if (response.status === 401) {
          router.replace(
            `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`,
          );
          return;
        }
        if (!response.ok) throw new Error('暂时无法验证管理员身份，请重试');
        const data = await response.json();
        if (signal?.aborted) return;
        if (!data.success || !data.user?.isAdmin) {
          router.replace('/');
          return;
        }
        setUser(data.user as AdminUser);
      } catch (error) {
        if (!signal?.aborted)
          setError(
            error instanceof Error
              ? error.message
              : '网络异常，请检查连接后重试',
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadUser(controller.signal);
    return () => controller.abort();
  }, [loadUser]);

  if (loading || !user)
    return (
      <div className="admin-workspace flex min-h-screen items-center justify-center p-6">
        {error ? (
          <div className="max-w-lg">
            <AdminError
              message={error}
              onRetry={() => {
                setLoading(true);
                setError(null);
                void loadUser();
              }}
            />
          </div>
        ) : (
          <div
            role="status"
            className="flex items-center gap-3 text-sm text-stone-500"
          >
            <Loader2
              className="h-5 w-5 animate-spin text-orange-600"
              aria-hidden="true"
            />
            正在进入管理后台…
          </div>
        )}
      </div>
    );

  return (
    <AdminFeedbackProvider>
      <AdminWorkspace user={user}>{children}</AdminWorkspace>
    </AdminFeedbackProvider>
  );
}
