'use client';
// components/AppShell.tsx
// Responsive dashboard layout containing sidebar navigation, user headers, and main content panel

import React, { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { isCashierFocusMode, getCashierName } from '@/lib/api';
import api from '@/lib/api';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Truck,
  BarChart3,
  Settings,
  LogOut,
  User,
  Menu,
  X,
  Bell,
  ChevronDown,
  TrendingUp,
  AlertTriangle,
  TrendingDown,
  CheckCircle2,
  Loader2,
  GitBranch,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard',   href: '/dashboard',   icon: LayoutDashboard },
  { name: 'POS',         href: '/pos',          icon: ShoppingCart },
  { name: 'Products',    href: '/products',     icon: Package },
  { name: 'Inventory',   href: '/inventory',    icon: TrendingUp },
  { name: 'Procurement', href: '/procurement',  icon: Truck },
];

const SETTINGS_SUB: { name: string; href: string }[] = [
  { name: 'Business',  href: '/settings/business' },
  { name: 'Branches',  href: '/settings/branches' },
  { name: 'Staff',     href: '/settings/staff' },
  { name: 'Payment',   href: '/settings/payment' },
  { name: 'Features',  href: '/settings/features' },
  { name: 'VAT',       href: '/settings/vat' },
];

const ANALYTICS_SUB: { name: string; href: string }[] = [
  { name: 'Overview',       href: '/analytics' },
  { name: 'Product ROI',    href: '/analytics/products' },
  { name: 'Top Sellers',    href: '/analytics/top-sellers' },
  { name: 'Payments',       href: '/analytics/payments' },
  { name: 'Cashiers',       href: '/analytics/cashiers' },
  { name: 'Shifts',         href: '/analytics/shifts' },
  { name: 'Returns',        href: '/analytics/returns' },
  { name: 'Procurement',    href: '/analytics/procurement' },
  { name: 'Branches',       href: '/analytics/branches' },
  { name: 'Slow Stock',     href: '/analytics/slow-stock' },
  { name: 'Expiry',         href: '/analytics/expiry' },
  { name: 'Stock Alerts',   href: '/analytics/stock-alerts' },
  { name: 'Diagnostics',    href: '/analytics/diagnostics' },
];

// ── Collapsible nav group — must be a named component so hooks are called correctly ──
// Using IIFEs inside JSX violates Rules of Hooks (hook count changes between renders).
function CollapsibleNavGroup({
  label, icon: Icon, items, pathname, rootPrefix,
}: {
  label:      string;
  icon:       React.ComponentType<{ size?: number; className?: string }>;
  items:      { name: string; href: string }[];
  pathname:   string;
  rootPrefix: string;
}) {
  const isActive = pathname.startsWith(rootPrefix);
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${
          isActive
            ? 'bg-white/15 text-white font-semibold border-l-4 border-white -ml-1 pl-3'
            : 'text-white/70 hover:text-white hover:bg-white/10'
        }`}
      >
        <Icon size={18} className={isActive ? 'text-white' : 'text-white/70'} />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-3">
          {items.map(sub => {
            const active = pathname === sub.href;
            return (
              <Link key={sub.href} href={sub.href}
                className={`block px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                  active ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}>
                {sub.name}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Notification panel ────────────────────────────────────────────────────────
interface StockAlert {
  product_id:       string;
  product_name:     string;
  location_id:      string;
  location_name:    string;
  location_code:    string;
  stock_on_hand:    string;
  is_negative_stock: boolean;
  is_low_stock:     boolean;
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const [alerts,  setAlerts]  = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    api.get('/api/analytics/stock-alerts')
      .then(({ data }) => setAlerts(data.alerts ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const negCount = alerts.filter(a => a.is_negative_stock).length;
  const lowCount = alerts.filter(a => !a.is_negative_stock && a.is_low_stock).length;

  return (
    <div className="absolute right-0 top-10 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div>
          <p className="text-sm font-bold text-gray-800">Stock Alerts</p>
          {!loading && !error && (
            <p className="text-xs text-gray-400 mt-0.5">
              {alerts.length === 0
                ? 'All levels healthy'
                : `${negCount > 0 ? `${negCount} negative` : ''}${negCount > 0 && lowCount > 0 ? ', ' : ''}${lowCount > 0 ? `${lowCount} low` : ''}`}
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-gray-400" size={20} />
          </div>
        ) : error ? (
          <div className="py-6 text-center text-xs text-gray-400 px-4">
            Could not load alerts.
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-8 text-center px-4">
            <CheckCircle2 className="mx-auto text-green-500 mb-2" size={24} />
            <p className="text-xs font-semibold text-gray-600">No stock alerts</p>
            <p className="text-xs text-gray-400 mt-0.5">All products at healthy levels</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {alerts.map((a, i) => (
              <Link
                key={i}
                href={`/inventory/adjust?product_id=${a.product_id}&location_id=${a.location_id}`}
                onClick={onClose}
                className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group"
              >
                <div className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                  a.is_negative_stock ? 'bg-red-100' : 'bg-amber-100'
                }`}>
                  {a.is_negative_stock
                    ? <TrendingDown size={12} className="text-red-600" />
                    : <AlertTriangle size={12} className="text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate group-hover:text-blue-600 transition-colors">
                    {a.product_name}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {a.location_name} · On hand: <span className={`font-bold ${a.is_negative_stock ? 'text-red-600' : 'text-amber-600'}`}>
                      {Number(a.stock_on_hand).toFixed(2)}
                    </span>
                  </p>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${
                  a.is_negative_stock
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {a.is_negative_stock ? 'NEG' : 'LOW'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {!loading && !error && alerts.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50">
          <Link
            href="/analytics/stock-alerts"
            onClick={onClose}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
          >
            View all in Stock Alerts →
          </Link>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [notifOpen,   setNotifOpen]   = useState(false);
  const [alertCount,  setAlertCount]  = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  // Branch switcher state (owner only)
  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false);
  const [allBranches, setAllBranches] = useState<{ id: string; location_name: string; location_code: string }[]>([]);
  const [activeBranchName, setActiveBranchName] = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const branchSwitcherRef = useRef<HTMLDivElement>(null);

  // Derive whether this user can see restricted settings sub-pages
  // Limited staff: Staff + VAT are allowed; Business/Payment/Features/Branches blocked.
  // Full staff (manager) and owners: all settings visible.
  const isLimitedStaff = mounted && user
    ? (user.role === 'staff' && user.access_tier === 'staff')
    : false;

  const isOwner = mounted && user ? user.access_tier === 'owner' : false;

  // Build filtered settings sub-nav
  const filteredSettingsSub = SETTINGS_SUB.filter(item => {
    if (!isLimitedStaff) return true;
    // Staff tier: hide Business, Payment, Features, Branches — show Staff and VAT
    return item.href !== '/settings/business'
        && item.href !== '/settings/payment'
        && item.href !== '/settings/features'
        && item.href !== '/settings/branches';
  });

  // Close notification panel when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notifOpen]);

  // Fetch alert count on mount (owner only — cashier can't call analytics)
  const fetchAlertCount = useCallback(async () => {
    if (!user || user.role !== 'owner') return;
    try {
      const { data } = await api.get('/api/analytics/stock-alerts');
      setAlertCount((data.alerts ?? []).length);
    } catch {
      // Silent — badge just shows 0
    }
  }, [user]);

  // Fetch branches and resolve active branch name (owner only)
  useEffect(() => {
    if (!mounted || !user || user.access_tier !== 'owner') return;
    api.get('/api/tenants/locations').then(({ data }) => {
      const locs = data.locations ?? [];
      setAllBranches(locs);
      const active = locs.find((l: any) => l.id === user.location_id);
      setActiveBranchName(active?.location_name ?? null);
    }).catch(() => {});
  }, [mounted, user]);

  // Close branch switcher on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (branchSwitcherRef.current && !branchSwitcherRef.current.contains(e.target as Node)) {
        setBranchSwitcherOpen(false);
      }
    }
    if (branchSwitcherOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [branchSwitcherOpen]);

  const handleBranchSwitch = useCallback(async (locationId: string) => {
    if (!user || switchingBranch) return;
    setSwitchingBranch(true);
    try {
      const accessToken = localStorage.getItem('access_token') ?? '';
      const { data } = await api.post('/api/auth/select-branch', { location_id: locationId });
      localStorage.setItem('access_token', data.access_token);
      // Update user in context with new location
      const branch = allBranches.find(b => b.id === locationId);
      setActiveBranchName(branch?.location_name ?? null);
      setBranchSwitcherOpen(false);
      // Reload to reinitialise all data with new branch context
      window.location.reload();
    } catch {
      // Silent
    } finally {
      setSwitchingBranch(false);
    }
  }, [user, switchingBranch, allBranches]);

  useEffect(() => {
    if (mounted && user) fetchAlertCount();
  }, [mounted, user, fetchAlertCount]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Derived values (safely computed after mount to prevent SSR hydration mismatch)
  const cashierMode = mounted && user ? (isCashierFocusMode() || user.role === 'cashier') : false;
  const cashierName = mounted ? getCashierName() : null;

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
          <p className="text-sm font-medium text-gray-500">Loading Session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Cashier or POS focus mode: Full-screen, no sidebar
  if (cashierMode) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
        {/* Simple Cashier Header */}
        <header className="h-16 border-b border-gray-200 bg-white px-6 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-brand-blue flex items-center justify-center text-white font-bold text-sm shadow-xs">
              IMS
            </div>
            <div>
              <span className="text-sm font-semibold text-gray-800">POS Focused Mode</span>
              {cashierName && (
                <span className="text-xs text-gray-400 block -mt-0.5">Cashier: {cashierName}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-700 bg-gray-100 py-1.5 px-3 rounded-full font-medium">
              <User size={14} className="text-gray-500" />
              <span>{user.full_name}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="text-gray-600 hover:text-red-600 gap-1.5"
            >
              <LogOut size={16} />
              <span>Exit</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex font-sans">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-brand-blue text-white shadow-xl z-20">
        {/* Brand Logo Header */}
        <div className="h-16 flex items-center gap-3 px-6 border-b border-white/10">
          <div className="h-9 w-9 rounded-lg bg-white text-brand-blue flex items-center justify-center font-bold text-lg shadow-sm">
            I
          </div>
          <div className="flex flex-col">
            <span className="font-bold tracking-wide text-sm leading-tight">IMS Platform</span>
            <span className="text-[10px] text-white/60 tracking-wider">ENTERPRISE</span>
          </div>
        </div>

        {/* Navigation Section */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${
                  active
                    ? 'bg-white/15 text-white shadow-inner font-semibold border-l-4 border-white -ml-1 pl-3'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon size={18} className={active ? 'text-white' : 'text-white/70'} />
                <span>{item.name}</span>
              </Link>
            );
          })}

          <CollapsibleNavGroup
            label="Analytics"
            icon={BarChart3}
            items={ANALYTICS_SUB}
            pathname={pathname}
            rootPrefix="/analytics"
          />

          <CollapsibleNavGroup
            label="Settings"
            icon={Settings}
            items={filteredSettingsSub}
            pathname={pathname}
            rootPrefix="/settings"
          />
        </nav>

        {/* Sidebar Footer User Section */}
        <div className="p-4 border-t border-white/10 bg-black/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center text-white border border-white/10 shadow-xs">
              <User size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate leading-tight">{user.full_name}</p>
              <p className="text-[11px] text-white/60 capitalize mt-0.5 font-medium">{user.role}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-red-600/20 hover:bg-red-600/40 text-red-100 hover:text-white text-xs font-semibold rounded-md transition-colors border border-red-500/20"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-gray-200 px-6 flex items-center justify-between sticky top-0 z-10 shadow-xs">
          <div className="flex items-center gap-4">
            {/* Mobile menu trigger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-lg font-bold text-gray-800 capitalize">
              {pathname.substring(1) || 'Dashboard'}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen(o => !o)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-colors relative"
                aria-label="Notifications"
              >
                <Bell size={18} />
                {alertCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <NotificationPanel
                  onClose={() => { setNotifOpen(false); fetchAlertCount(); }}
                />
              )}
            </div>

            {/* Separator */}
            <div className="h-6 w-px bg-gray-200" />

            {/* Branch badge + owner switcher */}
            <div className="hidden sm:flex flex-col text-right" ref={branchSwitcherRef}>
              {isOwner && allBranches.length > 1 ? (
                <div className="relative">
                  <button
                    onClick={() => setBranchSwitcherOpen(o => !o)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-md transition-colors"
                  >
                    <Building2 size={12} className="text-gray-500" />
                    <span>{activeBranchName ?? 'Select Branch'}</span>
                    {switchingBranch
                      ? <Loader2 size={10} className="animate-spin" />
                      : <ChevronDown size={10} />}
                  </button>
                  {branchSwitcherOpen && (
                    <div className="absolute right-0 top-8 w-52 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3 pt-2.5 pb-1">Switch Branch</p>
                      {allBranches.map(b => (
                        <button key={b.id} onClick={() => handleBranchSwitch(b.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-gray-50 transition-colors ${b.id === user?.location_id ? 'font-bold text-brand-blue' : 'text-gray-700'}`}>
                          <GitBranch size={12} className="shrink-0 text-gray-400" />
                          <span className="truncate">{b.location_name}</span>
                          {b.id === user?.location_id && <span className="ml-auto text-[9px] bg-brand-blue/10 text-brand-blue px-1.5 py-0.5 rounded-full">Active</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-md">
                  {activeBranchName ?? (user?.location_id ? `Branch` : 'All Branches')}
                </span>
              )}
              <span className="text-[10px] text-gray-400 mt-0.5">
                Tenant: {user.tenant_id}
              </span>
            </div>
          </div>
        </header>

        {/* Dashboard Content Canvas */}
        <main className="flex-1 p-8 bg-gray-50/50">{children}</main>
      </div>

      {/* Mobile Drawer Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="relative flex flex-col w-64 bg-brand-blue text-white h-full shadow-2xl animate-slide-in">
            {/* Close button */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-white/10">
              <span className="font-bold tracking-wide text-sm">IMS Menu</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 text-white/80 hover:text-white hover:bg-white/10 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            {/* Mobile Nav Links */}
            <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
              {NAV_ITEMS.map(item => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${
                      active
                        ? 'bg-white/15 text-white font-semibold border-l-4 border-white'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Icon size={18} />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Mobile Footer */}
            <div className="p-4 border-t border-white/10 bg-black/10">
              <p className="text-sm font-semibold truncate">{user.full_name}</p>
              <p className="text-[10px] text-white/60 capitalize mb-3">{user.role}</p>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  logout();
                }}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-red-600/20 hover:bg-red-600/40 text-red-100 hover:text-white text-xs font-semibold rounded-md border border-red-500/20 transition-colors"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
          {/* Backdrop click closer */}
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}
    </div>
  );
}
