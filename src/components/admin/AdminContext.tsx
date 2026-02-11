'use client';

import { createContext, useContext } from 'react';

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

interface AdminContextValue {
  user: AdminUser;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within AdminContext');
  return ctx;
}
