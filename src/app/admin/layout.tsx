'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Menu, LogOut, User as UserIcon } from 'lucide-react';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { AdminContext } from '@/components/admin/AdminContext';
import type { AdminUser } from '@/components/admin/AdminContext';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) { router.push('/login?redirect=/admin'); return; }
        const data = await res.json();
        if (!data.success || !data.user?.isAdmin) { router.push('/'); return; }
        if (!cancelled) setUser(data.user as AdminUser);
      } catch {
        router.push('/login?redirect=/admin');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  }, [router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9]">
        <div className="text-center text-orange-500">
          <Loader2 className="w-10 h-10 animate-spin mx-auto" />
          <p className="mt-4 text-sm font-medium text-stone-500">加载管理后台...</p>
        </div>
      </div>
    );
  }

  return (
    <AdminContext.Provider value={{ user }}>
      <div className="min-h-screen flex bg-[#fafaf9]">
        {/* Sidebar */}
        <AdminSidebar
          user={user}
          onLogout={handleLogout}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />

        {/* Main content area */}
        <div className="flex-1 lg:ml-72 min-w-0 p-4 lg:p-6 transition-all duration-300">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 lg:hidden glass rounded-2xl mb-4 shadow-sm border border-white/50">
            <div className="flex items-center justify-between px-4 h-14">
              <button
                onClick={() => setMobileOpen(true)}
                className="p-2 -ml-2 rounded-lg hover:bg-stone-100 text-stone-600"
              >
                <Menu className="w-5 h-5" />
              </button>
              <span className="font-bold text-stone-800 text-sm">管理后台</span>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center">
                  <UserIcon className="w-3.5 h-3.5 text-stone-500" />
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 -mr-2 rounded-lg hover:bg-red-50 text-stone-400 hover:text-red-500"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="min-h-[calc(100vh-6rem)]">{children}</main>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
