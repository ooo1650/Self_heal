'use client';
// lib/auth.tsx
// Auth Context Provider — Phase 16a update
// Handles branch-selection flow for multi-branch staff/managers.

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import api from './api';

export interface AuthUser {
  staff_id:              string;
  tenant_id:             string;
  location_id:           string | null;
  role:                  'owner' | 'staff' | 'cashier';
  full_name:             string;
  max_item_discount_pct: number;
  must_change_password:  boolean;
  access_tier:           'owner' | 'manager' | 'staff';
}

// Returned by login() when the user must choose a branch before the session is complete
export interface BranchSelectionRequired {
  requires_branch_selection: true;
  branch_ids:                string[];
  staff_id:                  string;
  full_name:                 string;
  access_token:              string;   // partial token (no location_id) for calling select-branch
  refresh_token:             string;
}

export type LoginResult = AuthUser | BranchSelectionRequired;

export function requiresBranchSelection(r: LoginResult): r is BranchSelectionRequired {
  return (r as BranchSelectionRequired).requires_branch_selection === true;
}

interface AuthCtx {
  user:         AuthUser | null;
  loading:      boolean;
  login:        (email: string, password: string, subdomain?: string) => Promise<LoginResult>;
  selectBranch: (locationId: string, partialToken: string) => Promise<AuthUser>;
  logout:       () => void;
  updateUser:   (updatedUser: Partial<AuthUser>) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

// ── Session-expired toast banner ──────────────────────────────────────────────
function SessionExpiredBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3
                 bg-gray-900 text-white text-sm font-medium px-5 py-3.5 rounded-xl shadow-2xl
                 border border-white/10 max-w-sm w-full mx-4"
    >
      <span className="flex-1">Your session has expired.</span>
      <Link
        href="/login"
        onClick={onDismiss}
        className="shrink-0 text-xs font-bold bg-white text-gray-900 px-3 py-1.5 rounded-lg
                   hover:bg-gray-100 transition-colors"
      >
        Sign in again
      </Link>
      <button
        onClick={onDismiss}
        className="shrink-0 text-white/60 hover:text-white transition-colors text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ── Normalise access_tier from server response ────────────────────────────────
// Handles old ('full'/'limited') and new ('owner'/'manager'/'staff') values.
function normaliseAccessTier(data: any): AuthUser['access_tier'] {
  const t = data.access_tier;
  if (t === 'owner' || t === 'manager' || t === 'staff') return t;
  if (data.role === 'owner') return 'owner';
  if (t === 'full')    return 'manager';
  if (t === 'limited') return 'staff';
  return 'staff';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,           setUser]           = useState<AuthUser | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const pathname = usePathname();

  const isAuthPage = pathname?.startsWith('/login') || pathname?.startsWith('/change-password');

  useEffect(() => {
    function onExpired() { setUser(null); setSessionExpired(true); }
    window.addEventListener('auth-session-expired', onExpired);
    return () => window.removeEventListener('auth-session-expired', onExpired);
  }, []);

  // Rehydrate from localStorage on mount
  useEffect(() => {
    async function rehydrate() {
      const raw          = localStorage.getItem('auth_user');
      const accessToken  = localStorage.getItem('access_token');
      const refreshToken = localStorage.getItem('refresh_token');

      if (raw && accessToken && refreshToken) {
        try {
          let isExpired = false;
          try {
            const parts = accessToken.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1]));
              if (typeof payload.exp === 'number') {
                isExpired = Date.now() >= (payload.exp * 1000) - 10000;
              }
            } else { isExpired = true; }
          } catch { isExpired = true; }

          if (isExpired) {
            const { data } = await api.post('/api/auth/refresh', { refresh_token: refreshToken });
            localStorage.setItem('access_token', data.access_token);
          }
          setUser(JSON.parse(raw));
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('auth_user');
          setUser(null);
        }
      } else {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('auth_user');
        setUser(null);
      }
      setLoading(false);
    }
    rehydrate();
  }, []);

  const login = useCallback(async (
    email: string,
    password: string,
    subdomain?: string,
  ): Promise<LoginResult> => {
    const body: Record<string, string> = { email, password };
    if (subdomain) body.subdomain = subdomain;
    const { data } = await api.post('/api/auth/login', body);

    // Multi-branch staff/manager — needs branch selection before session is complete
    if (data.requires_branch_selection) {
      // Store partial tokens temporarily so selectBranch can use them
      localStorage.setItem('access_token',  data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      return {
        requires_branch_selection: true,
        branch_ids:   data.branch_ids,
        staff_id:     data.staff_id,
        full_name:    data.full_name,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      };
    }

    // Single-branch or owner — complete session immediately
    localStorage.setItem('access_token',  data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);

    const u: AuthUser = {
      staff_id:              data.staff_id,
      tenant_id:             data.tenant_id,
      location_id:           data.location_id ?? null,
      role:                  data.role,
      full_name:             data.full_name,
      max_item_discount_pct: Number(data.max_item_discount_pct || 0),
      must_change_password:  !!data.must_change_password,
      access_tier:           normaliseAccessTier(data),
    };
    localStorage.setItem('auth_user', JSON.stringify(u));
    setUser(u);
    setSessionExpired(false);
    return u;
  }, []);

  // Called after branch selection step — exchanges partial token for branch-scoped token
  const selectBranch = useCallback(async (
    locationId: string,
    partialToken: string,
  ): Promise<AuthUser> => {
    const { data } = await api.post(
      '/api/auth/select-branch',
      { location_id: locationId },
      { headers: { Authorization: `Bearer ${partialToken}` } },
    );

    localStorage.setItem('access_token', data.access_token);

    // Fetch fresh user profile using the new scoped token
    const profileRes = await api.get('/api/tenants/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });

    // We need full_name, tenant_id etc — re-read from auth_user that was partially set
    const existing = localStorage.getItem('auth_user');
    const partial  = existing ? JSON.parse(existing) : {};

    const u: AuthUser = {
      ...partial,
      location_id:  locationId,
      access_token: data.access_token,
    };
    localStorage.setItem('auth_user', JSON.stringify(u));
    setUser(u);
    setSessionExpired(false);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('auth_user');
    setUser(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
  }, []);

  const updateUser = useCallback((updatedUser: Partial<AuthUser>) => {
    setUser(prev => {
      if (!prev) return null;
      const next = { ...prev, ...updatedUser };
      localStorage.setItem('auth_user', JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, login, selectBranch, logout, updateUser }}>
      {sessionExpired && !isAuthPage && (
        <SessionExpiredBanner onDismiss={() => setSessionExpired(false)} />
      )}
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
