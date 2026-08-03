'use client';

import React, { useEffect, useState, useRef } from 'react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Users, 
  Plus, 
  Key, 
  Edit3, 
  UserX, 
  UserCheck, 
  Lock, 
  Check, 
  AlertCircle, 
  Percent, 
  User, 
  Info,
  Loader2,
  ChevronRight,
  Shield,
  X
} from 'lucide-react';

interface Staff {
  id: string;
  full_name: string;
  email: string | null;
  role: 'owner' | 'staff' | 'cashier';
  access_tier: 'owner' | 'manager' | 'staff';
  max_item_discount_pct: number;
  is_active: boolean;
  pin_set: boolean;
  location_id: string | null;
  location_name: string | null;
  location_code: string | null;
  created_at: string;
}

interface Location {
  id: string;
  location_name: string;
  location_code: string;
  is_main_branch: boolean;
}

export default function StaffSettingsPage() {
  const { user } = useAuth();
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [resettingPinStaff, setResettingPinStaff] = useState<Staff | null>(null);
  
  // Reset PIN specific state
  const [pinConfirmed, setPinConfirmed] = useState(false);

  // Forms state
  const [addForm, setAddForm] = useState({
    fullName: '',
    discountCeiling: 10,
    locationId: '' as string,
    pin: ['', '', '', '']
  });

  const [editForm, setEditForm] = useState({
    fullName: '',
    discountCeiling: 10
  });

  const [resetPinValue, setResetPinValue] = useState(['', '', '', '']);

  // Staff member (role='staff') modal state
  const [isAddStaffModalOpen, setIsAddStaffModalOpen] = useState(false);
  const [addStaffForm, setAddStaffForm] = useState({
    fullName: '',
    email: '',
    password: '',
    discountCeiling: 10,
    locationId: '' as string,
    accessTier: 'staff' as 'manager' | 'staff',
    branchIds: [] as string[],
  });
  const [editingStaffMember, setEditingStaffMember] = useState<Staff | null>(null);
  const [editStaffForm, setEditStaffForm] = useState({
    fullName: '',
    discountCeiling: 10,
    accessTier: 'staff' as 'manager' | 'staff',
  });

  // Refs for PIN inputs
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const resetPinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Fetch staff list — owners and staff from /api/staff, cashiers from /api/cashiers
  const fetchStaff = async () => {
    try {
      setLoading(true);
      setError(null);
      const [staffRes, cashierRes, locRes] = await Promise.all([
        api.get('/api/staff'),
        api.get('/api/cashiers'),
        api.get('/api/tenants/locations'),
      ]);
      const owners   = (staffRes.data.staff || []) as Staff[];
      const cashiers = (cashierRes.data.cashiers || []).map((c: any) => ({
        ...c,
        role:    'cashier' as const,
        email:   null,
        pin_set: true,
      })) as Staff[];
      setStaffList([...owners, ...cashiers]);
      const locs = (locRes.data.locations || []) as Location[];
      setLocations(locs);
      // Default location selectors to main branch if not yet set
      const mainBranch = locs.find(l => l.is_main_branch) ?? locs[0];
      if (mainBranch) {
        setAddForm(prev => prev.locationId ? prev : { ...prev, locationId: mainBranch.id });
        setAddStaffForm(prev => prev.locationId ? prev : { ...prev, locationId: mainBranch.id });
      }
    } catch (err: any) {
      devError('[staff/fetch]', err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && (user.role === 'owner' || user.role === 'staff')) {
      fetchStaff();
    }
  }, [user]);

  // Role Guard validation — cashiers have no access here
  if (!user) return null;
  if (user.role === 'cashier') {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <div className="h-16 w-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4 shadow-sm border border-red-200">
            <Shield size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-800">Access Denied</h2>
          <p className="text-sm text-gray-500 max-w-md mt-2">
            Cashiers do not have access to staff management settings.
          </p>
        </div>
      </AppShell>
    );
  }

  // Capability flags derived from role
  const isOwner        = user.role === 'owner';
  const isLimitedStaff = user.role === 'staff' && user.access_tier === 'staff';
  // isOwner: can create/edit staff + create cashiers
  // isLimitedStaff: can view staff list (read-only) + create cashiers
  // full-access staff (manager): can view/edit staff + create cashiers (cannot create staff — owner-only)

  // Handle Cashier Activation/Deactivation
  const handleToggleStatus = async (staff: Staff) => {
    // Prevent self-deactivation (guard)
    if (staff.id === user.staff_id) return;

    const newStatus = !staff.is_active;
    const actionWord = newStatus ? 'activate' : 'deactivate';

    if (!confirm(`Are you sure you want to ${actionWord} ${staff.full_name}?`)) {
      return;
    }

    try {
      setActionLoading(`status-${staff.id}`);
      const endpoint = staff.role === 'cashier'
        ? `/api/cashiers/${staff.id}/status`
        : `/api/staff/${staff.id}/status`;
      await api.patch(endpoint, { is_active: newStatus });

      // Update local state directly
      setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, is_active: newStatus } : s));
    } catch (err: any) {
      devError('[staff/toggle-status]', err);
      alert(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  // Add Cashier Form Submit
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { fullName, discountCeiling, locationId, pin } = addForm;
    const pinStr = pin.join('');

    if (!fullName.trim()) {
      alert('Please enter a full name.');
      return;
    }
    if (pinStr.length !== 4 || !/^\d{4}$/.test(pinStr)) {
      alert('Please enter a 4-digit PIN.');
      return;
    }

    try {
      setActionLoading('create');
      await api.post('/api/cashiers', {
        full_name:             fullName.trim(),
        pin:                   pinStr,
        max_item_discount_pct: discountCeiling,
        location_id:           locationId || null,
      });

      setIsAddModalOpen(false);
      setAddForm({ fullName: '', discountCeiling: 10, locationId: locations.find(l => l.is_main_branch)?.id ?? '', pin: ['', '', '', ''] });
      fetchStaff();
    } catch (err: any) {
      devError('[staff/create]', err);
      alert(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  // Edit Cashier Form Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    const { fullName, discountCeiling } = editForm;

    if (!fullName.trim()) {
      alert('Please enter a full name.');
      return;
    }

    try {
      setActionLoading(`edit-${editingStaff.id}`);
      const endpoint = editingStaff.role === 'cashier'
        ? `/api/cashiers/${editingStaff.id}`
        : `/api/staff/${editingStaff.id}`;
      await api.put(endpoint, {
        full_name: fullName.trim(),
        max_item_discount_pct: discountCeiling
      });

      setEditingStaff(null);
      fetchStaff();
    } catch (err: any) {
      devError('[staff/update]', err);
      alert(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  // Reset PIN Form Submit
  const handleResetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resettingPinStaff) return;
    const pinStr = resetPinValue.join('');

    if (pinStr.length !== 4 || !/^\d{4}$/.test(pinStr)) {
      alert('Please enter a 4-digit PIN.');
      return;
    }

    try {
      setActionLoading(`pin-${resettingPinStaff.id}`);
      await api.post(`/api/cashiers/${resettingPinStaff.id}/pin`, { pin: pinStr });

      setResettingPinStaff(null);
      setResetPinValue(['', '', '', '']);
      setPinConfirmed(false);
      fetchStaff();
    } catch (err: any) {
      devError('[staff/reset-pin]', err);
      alert(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  // PIN Input Helper - Auto focus shift
  const handlePinChange = (
    val: string, 
    idx: number, 
    type: 'add' | 'reset'
  ) => {
    if (!/^\d*$/.test(val)) return;
    
    if (type === 'add') {
      const newPin = [...addForm.pin];
      newPin[idx] = val.substring(val.length - 1); // Keep last character only
      setAddForm(prev => ({ ...prev, pin: newPin }));
      if (val !== '' && idx < 3) {
        pinInputRefs.current[idx + 1]?.focus();
      }
    } else {
      const newPin = [...resetPinValue];
      newPin[idx] = val.substring(val.length - 1);
      setResetPinValue(newPin);
      if (val !== '' && idx < 3) {
        resetPinInputRefs.current[idx + 1]?.focus();
      }
    }
  };

  const handlePinKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>, 
    idx: number, 
    type: 'add' | 'reset'
  ) => {
    if (e.key === 'Backspace') {
      if (type === 'add') {
        if (addForm.pin[idx] === '' && idx > 0) {
          const newPin = [...addForm.pin];
          newPin[idx - 1] = '';
          setAddForm(prev => ({ ...prev, pin: newPin }));
          pinInputRefs.current[idx - 1]?.focus();
        } else {
          const newPin = [...addForm.pin];
          newPin[idx] = '';
          setAddForm(prev => ({ ...prev, pin: newPin }));
        }
      } else {
        if (resetPinValue[idx] === '' && idx > 0) {
          const newPin = [...resetPinValue];
          newPin[idx - 1] = '';
          setResetPinValue(newPin);
          resetPinInputRefs.current[idx - 1]?.focus();
        } else {
          const newPin = [...resetPinValue];
          newPin[idx] = '';
          setResetPinValue(newPin);
        }
      }
    }
  };

  // PIN pad clicks
  const handlePinPadClick = (digit: string, type: 'add' | 'reset') => {
    if (type === 'add') {
      const emptyIdx = addForm.pin.findIndex(d => d === '');
      if (emptyIdx !== -1) {
        handlePinChange(digit, emptyIdx, 'add');
      }
    } else {
      const emptyIdx = resetPinValue.findIndex(d => d === '');
      if (emptyIdx !== -1) {
        handlePinChange(digit, emptyIdx, 'reset');
      }
    }
  };

  const handlePinPadBackspace = (type: 'add' | 'reset') => {
    if (type === 'add') {
      // Find the last non-empty index
      let lastFilledIdx = -1;
      for (let i = 3; i >= 0; i--) {
        if (addForm.pin[i] !== '') {
          lastFilledIdx = i;
          break;
        }
      }
      if (lastFilledIdx !== -1) {
        const newPin = [...addForm.pin];
        newPin[lastFilledIdx] = '';
        setAddForm(prev => ({ ...prev, pin: newPin }));
        pinInputRefs.current[lastFilledIdx]?.focus();
      }
    } else {
      let lastFilledIdx = -1;
      for (let i = 3; i >= 0; i--) {
        if (resetPinValue[i] !== '') {
          lastFilledIdx = i;
          break;
        }
      }
      if (lastFilledIdx !== -1) {
        const newPin = [...resetPinValue];
        newPin[lastFilledIdx] = '';
        setResetPinValue(newPin);
        resetPinInputRefs.current[lastFilledIdx]?.focus();
      }
    }
  };

  const handlePinPadClear = (type: 'add' | 'reset') => {
    if (type === 'add') {
      setAddForm(prev => ({ ...prev, pin: ['', '', '', ''] }));
      pinInputRefs.current[0]?.focus();
    } else {
      setResetPinValue(['', '', '', '']);
      resetPinInputRefs.current[0]?.focus();
    }
  };

  // Open editing modal
  const startEdit = (staff: Staff) => {
    setEditingStaff(staff);
    setEditForm({
      fullName: staff.full_name,
      discountCeiling: Number(staff.max_item_discount_pct)
    });
  };

  // Open reset PIN modal
  const startResetPin = (staff: Staff) => {
    setResettingPinStaff(staff);
    setResetPinValue(['', '', '', '']);
    setPinConfirmed(false);
  };

  // Filter staff roles
  const ownerStaffList    = staffList.filter(s => s.role === 'owner');
  const staffMemberList   = staffList.filter(s => s.role === 'staff');   // role='staff' — JWT login
  const cashierStaffList  = staffList.filter(s => s.role === 'cashier'); // PIN-only

  // ── Staff member (role='staff') handlers ─────────────────────────────────
  const handleAddStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { fullName, email, password, discountCeiling, locationId, accessTier, branchIds } = addStaffForm;
    if (!fullName.trim() || !email.trim() || !password) {
      alert('Full name, email, and password are required.');
      return;
    }
    try {
      setActionLoading('create-staff');
      // Merge locationId into branch_ids (deduplicated on backend)
      const finalBranchIds = locationId
        ? [...new Set([locationId, ...branchIds])]
        : branchIds;
      await api.post('/api/staff', {
        full_name:             fullName.trim(),
        email:                 email.trim(),
        password,
        max_item_discount_pct: discountCeiling,
        access_tier:           accessTier,
        location_id:           locationId || null,
        branch_ids:            finalBranchIds,
      });
      setIsAddStaffModalOpen(false);
      const defaultLocId = locations.find(l => l.is_main_branch)?.id ?? '';
      setAddStaffForm({ fullName: '', email: '', password: '', discountCeiling: 10, locationId: defaultLocId, accessTier: 'staff', branchIds: [] });
      fetchStaff();
    } catch (err: any) {
      devError('[staff-member/create]', err);
      alert(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const startEditStaffMember = (s: Staff) => {
    setEditingStaffMember(s);
    // Normalise — handles both old ('full'/'limited') and new ('manager'/'staff') values
    const tier: 'manager' | 'staff' = s.access_tier === 'manager' ? 'manager' : 'staff';
    setEditStaffForm({
      fullName:        s.full_name,
      discountCeiling: Number(s.max_item_discount_pct),
      accessTier:      tier,
    });
  };

  const handleEditStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaffMember) return;
    const { fullName, discountCeiling, accessTier } = editStaffForm;
    if (!fullName.trim()) { alert('Please enter a full name.'); return; }
    try {
      setActionLoading(`edit-staff-${editingStaffMember.id}`);
      await api.put(`/api/staff/${editingStaffMember.id}`, {
        full_name:             fullName.trim(),
        max_item_discount_pct: discountCeiling,
        access_tier:           accessTier,
      });
      setEditingStaffMember(null);
      fetchStaff();
    } catch (err: any) {
      devError('[staff-member/update]', err);
      alert(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Breadcrumb / Nav Path */}
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <span>Settings</span>
          <ChevronRight size={12} />
          <span className="text-gray-600">Staff & Cashiers</span>
        </div>

        {/* Top Header Card */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Staff & Cashiers</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-xl">
              {isLimitedStaff
                ? 'View staff accounts. You can create and manage cashier accounts.'
                : 'Manage staff accounts (email login) and cashier accounts (PIN-only till access).'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isOwner && (
              <Button
                variant="outline"
                onClick={() => setIsAddStaffModalOpen(true)}
                className="border-gray-300 text-gray-700 flex items-center gap-2 px-4 py-2 rounded-lg font-semibold cursor-pointer"
              >
                <Plus size={16} />
                <span>Add Staff</span>
              </Button>
            )}
            <Button
              onClick={() => setIsAddModalOpen(true)}
              className="bg-brand-blue hover:bg-brand-blue-hover text-white flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all shadow-xs cursor-pointer"
            >
              <Plus size={16} />
              <span>Add Cashier</span>
            </Button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 text-red-800">
            <AlertCircle className="shrink-0 mt-0.5" size={16} />
            <div className="text-sm">
              <p className="font-semibold">Failed to fetch staff accounts</p>
              <p className="text-xs text-red-600 mt-1">{error}</p>
              <button 
                onClick={fetchStaff} 
                className="mt-2 text-xs font-bold underline text-red-800 hover:text-red-900 cursor-pointer"
              >
                Retry Request
              </button>
            </div>
          </div>
        )}

        {/* Loading Spinner */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="animate-spin text-brand-blue h-8 w-8 mb-2" />
            <p className="text-sm font-semibold text-gray-500">Loading staff database...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 1. Owners / Admins Section */}
            {ownerStaffList.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                  <Shield size={12} className="text-gray-400" />
                  <span>Store Owners & Administrators</span>
                </h3>
                <div className="grid gap-6 md:grid-cols-2">
                  {ownerStaffList.map(owner => (
                    <Card key={owner.id} className="bg-white border-gray-200 shadow-xs relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1.5 h-full bg-brand-blue" />
                      <CardHeader className="pb-3 pl-6">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-800 text-sm">{owner.full_name}</span>
                            <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-blue-100 text-blue-800 border border-blue-200/50 uppercase tracking-wide">
                              Owner
                            </span>
                          </div>
                          {owner.id === user.staff_id && (
                            <span className="text-[10px] text-gray-400 font-semibold italic">
                              You (Logged In)
                            </span>
                          )}
                        </div>
                        <CardDescription className="text-xs font-medium truncate text-gray-400 mt-1">
                          {owner.email}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pl-6 pb-4">
                        <div className="flex flex-col gap-1 text-xs text-gray-500 font-medium">
                          <span className="flex items-center gap-1">
                            Role Level: Full System Administration
                          </span>
                          {owner.location_name && (
                            <span className="mt-1 bg-gray-100 py-1 px-2.5 rounded-md self-start text-gray-600">
                              Location: {owner.location_name} ({owner.location_code})
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Staff Members Section (role='staff' — JWT login) */}
            {staffMemberList.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                  <User size={12} className="text-gray-400" />
                  <span>Staff Members</span>
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  {staffMemberList.map(s => (
                    <Card key={s.id} className={`bg-white border-gray-200 shadow-xs relative overflow-hidden ${!s.is_active ? 'opacity-60' : ''}`}>
                      <div className={`absolute top-0 left-0 w-1.5 h-full ${s.is_active ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                      <CardHeader className="pb-2 pl-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-800 text-sm">{s.full_name}</span>
                            <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full border uppercase tracking-wide ${
                              s.is_active ? 'bg-indigo-50 text-indigo-700 border-indigo-200/50' : 'bg-gray-100 text-gray-500 border-gray-200/50'
                            }`}>
                              {s.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          {/* Access tier badge */}
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${
                            (s.access_tier ?? 'staff') === 'manager'
                              ? 'bg-green-50 text-green-700 border-green-200/50'
                              : 'bg-amber-50 text-amber-700 border-amber-200/50'
                          }`}>
                            {(s.access_tier ?? 'staff') === 'manager' ? 'Manager' : 'Staff'}
                          </span>
                        </div>
                        <CardDescription className="text-xs text-gray-400 mt-1 truncate">{s.email}</CardDescription>
                      </CardHeader>
                      <CardContent className="pl-6 pb-4">
                        <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-2 mb-3">
                          <span className="text-gray-500 flex items-center gap-1">
                            <Percent size={12} className="text-gray-400" />
                            Discount Limit:
                          </span>
                          <span className="font-bold text-gray-800">{s.max_item_discount_pct}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isLimitedStaff && (
                            <Button variant="outline" size="sm"
                              onClick={() => startEditStaffMember(s)}
                              className="text-xs gap-1.5 h-8 font-semibold text-gray-700 border-gray-300 hover:bg-gray-50 cursor-pointer">
                              <Edit3 size={12} /> Edit
                            </Button>
                          )}
                          {!isLimitedStaff && s.id !== user.staff_id && (
                            <Button variant="outline" size="sm"
                              disabled={actionLoading === `status-${s.id}`}
                              onClick={() => handleToggleStatus(s)}
                              className={`text-xs gap-1.5 h-8 font-semibold border-gray-300 cursor-pointer ${
                                s.is_active ? 'text-red-600 hover:bg-red-50/50' : 'text-green-600 hover:bg-green-50/50'
                              }`}>
                              {actionLoading === `status-${s.id}`
                                ? <Loader2 size={12} className="animate-spin" />
                                : s.is_active ? <UserX size={12} /> : <UserCheck size={12} />}
                              {s.is_active ? 'Deactivate' : 'Activate'}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Cashiers Section */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Users size={12} className="text-gray-400" />
                <span>Cashier Staff</span>
              </h3>

              {cashierStaffList.length === 0 ? (
                /* Empty state */
                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center flex flex-col items-center justify-center shadow-xs">
                  <div className="h-12 w-12 rounded-full bg-brand-blue-light text-brand-blue flex items-center justify-center mb-4">
                    <Users size={20} />
                  </div>
                  <h4 className="font-bold text-gray-800 text-base">No cashiers yet</h4>
                  <p className="text-xs text-gray-500 max-w-sm mt-1.5 leading-relaxed">
                    Add one if you want staff to use the till separately from your own account. For solo-owner operations, this is entirely optional.
                  </p>
                  <Button 
                    onClick={() => setIsAddModalOpen(true)}
                    variant="outline"
                    className="mt-5 border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold px-4 py-2 rounded-lg cursor-pointer"
                  >
                    Add Your First Cashier
                  </Button>
                </div>
              ) : (
                /* Cashier Grid */
                <div className="grid gap-6 md:grid-cols-2">
                  {cashierStaffList.map(cashier => (
                    <Card 
                      key={cashier.id} 
                      className={`bg-white border-gray-200 shadow-xs hover:shadow-sm transition-all relative overflow-hidden ${
                        !cashier.is_active ? 'opacity-65' : ''
                      }`}
                    >
                      {/* Active/Inactive state strip */}
                      <div className={`absolute top-0 left-0 w-1.5 h-full ${
                        cashier.is_active ? 'bg-green-500' : 'bg-gray-400'
                      }`} />

                      <CardHeader className="pb-2 pl-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-800 text-sm">{cashier.full_name}</span>
                            <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full border uppercase tracking-wide ${
                              cashier.is_active 
                                ? 'bg-green-100 text-green-800 border-green-200/50' 
                                : 'bg-gray-100 text-gray-700 border-gray-200/50'
                            }`}>
                              {cashier.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          
                          {/* PIN status indicator */}
                          <div className="flex items-center gap-1.5">
                            {cashier.pin_set ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200/40">
                                <Check size={10} className="stroke-[3]" />
                                PIN Set
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/40">
                                <Info size={10} />
                                PIN Missing
                              </span>
                            )}
                          </div>
                        </div>
                        <CardDescription className="text-[10px] font-mono text-gray-400 mt-1">
                          ID: {cashier.id}
                        </CardDescription>
                      </CardHeader>

                      <CardContent className="pl-6 pb-4 space-y-4">
                        {/* Metrics: Max discount limit */}
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-100 mt-2">
                          <span className="text-gray-500 flex items-center gap-1">
                            <Percent size={12} className="text-gray-400" />
                            Discount Limit:
                          </span>
                          <span className="font-bold text-gray-800">
                            {cashier.max_item_discount_pct}%
                          </span>
                        </div>

                        {/* Location context if assigned */}
                        {cashier.location_name && (
                          <div className="text-xs text-gray-500 font-medium">
                            <span className="bg-gray-100 py-1 px-2.5 rounded-md self-start text-gray-600">
                              Location: {cashier.location_name}
                            </span>
                          </div>
                        )}

                        {/* Action buttons bar */}
                        <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEdit(cashier)}
                            className="text-xs flex items-center gap-1.5 px-3 py-1.5 h-8 font-semibold text-gray-700 border-gray-300 hover:bg-gray-50 cursor-pointer"
                          >
                            <Edit3 size={12} />
                            <span>Edit details</span>
                          </Button>
                          
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startResetPin(cashier)}
                            className="text-xs flex items-center gap-1.5 px-3 py-1.5 h-8 font-semibold text-gray-700 border-gray-300 hover:bg-gray-50 cursor-pointer"
                          >
                            <Key size={12} />
                            <span>Reset PIN</span>
                          </Button>

                          {/* Deactivation guard validation */}
                          {cashier.id !== user.staff_id && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={actionLoading === `status-${cashier.id}`}
                              onClick={() => handleToggleStatus(cashier)}
                              className={`text-xs flex items-center gap-1.5 px-3 py-1.5 h-8 font-semibold border-gray-300 hover:bg-gray-50 cursor-pointer ${
                                cashier.is_active 
                                  ? 'text-red-600 hover:text-red-700 hover:bg-red-50/50' 
                                  : 'text-green-600 hover:text-green-700 hover:bg-green-50/50'
                              }`}
                            >
                              {actionLoading === `status-${cashier.id}` ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : cashier.is_active ? (
                                <UserX size={12} />
                              ) : (
                                <UserCheck size={12} />
                              )}
                              <span>{cashier.is_active ? 'Deactivate' : 'Activate'}</span>
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ADD STAFF MEMBER MODAL ── */}
        {isAddStaffModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full mx-4 overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-indigo-600 text-white">
                <div className="flex items-center gap-2">
                  <User size={18} />
                  <h3 className="font-bold text-sm">Add Staff Member</h3>
                </div>
                <button onClick={() => setIsAddStaffModalOpen(false)}
                        className="p-1 hover:bg-white/10 rounded-md transition-colors cursor-pointer">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleAddStaffSubmit}>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Full Name</label>
                    <input type="text" required placeholder="e.g. Ram Sharma"
                           value={addStaffForm.fullName}
                           onChange={e => setAddStaffForm(p => ({ ...p, fullName: e.target.value }))}
                           className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Email</label>
                    <input type="email" required placeholder="staff@example.com"
                           value={addStaffForm.email}
                           onChange={e => setAddStaffForm(p => ({ ...p, email: e.target.value }))}
                           className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Password (min 8 chars)</label>
                    <input type="password" required minLength={8} placeholder="••••••••"
                           value={addStaffForm.password}
                           onChange={e => setAddStaffForm(p => ({ ...p, password: e.target.value }))}
                           className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Discount Ceiling (%)</label>
                    <input type="number" required min="0" max="100" step="0.01"
                           value={addStaffForm.discountCeiling}
                           onChange={e => setAddStaffForm(p => ({ ...p, discountCeiling: Number(e.target.value) }))}
                           className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-indigo-500 outline-none" />
                  </div>
                  {locations.length > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Location</label>
                      <select value={addStaffForm.locationId}
                              onChange={e => setAddStaffForm(p => ({ ...p, locationId: e.target.value }))}
                              className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-indigo-500 outline-none bg-white">
                        {locations.map(l => (
                          <option key={l.id} value={l.id}>
                            {l.location_name} ({l.location_code}){l.is_main_branch ? ' — Main' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Access Level</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['manager', 'staff'] as const).map(tier => (
                        <button key={tier} type="button"
                          onClick={() => setAddStaffForm(p => ({ ...p, accessTier: tier }))}
                          className={`p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${
                            addStaffForm.accessTier === tier
                              ? tier === 'manager' ? 'border-green-500 bg-green-50' : 'border-amber-500 bg-amber-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}>
                          <p className={`text-xs font-bold ${tier === 'manager' ? 'text-green-700' : 'text-amber-700'}`}>
                            {tier === 'manager' ? 'Manager' : 'Staff'}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                            {tier === 'manager'
                              ? 'All settings, analytics, full branch access'
                              : 'Business, Payment & Features settings hidden'}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Branch assignment multi-select */}
                  {locations.length > 1 && (
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Branch Access</label>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-2">
                        {locations.map(l => (
                          <label key={l.id} className="flex items-center gap-2.5 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox"
                              checked={addStaffForm.branchIds.includes(l.id) || addStaffForm.locationId === l.id}
                              onChange={e => {
                                if (e.target.checked) {
                                  setAddStaffForm(p => ({ ...p, branchIds: [...new Set([...p.branchIds, l.id])] }));
                                } else {
                                  setAddStaffForm(p => ({ ...p, branchIds: p.branchIds.filter(x => x !== l.id), locationId: p.locationId === l.id ? '' : p.locationId }));
                                }
                              }}
                              className="w-3.5 h-3.5 rounded border-gray-300 accent-indigo-600" />
                            <span className="text-sm text-gray-700">
                              {l.location_name}
                              {l.is_main_branch && <span className="ml-1 text-[10px] text-gray-400">(Main)</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">Select all branches this staff member can access.</p>
                    </div>
                  )}
                </div>
                <div className="px-6 pb-6 flex gap-2">
                  <Button type="button" variant="outline"
                          onClick={() => setIsAddStaffModalOpen(false)}
                          className="flex-1 border-gray-300 text-gray-700 cursor-pointer">Cancel</Button>
                  <Button type="submit" disabled={actionLoading === 'create-staff'}
                          className="flex-1 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                    {actionLoading === 'create-staff' ? 'Creating…' : 'Create Staff Member'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── EDIT STAFF MEMBER MODAL ── */}
        {editingStaffMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full mx-4 overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-indigo-600 text-white">
                <div className="flex items-center gap-2"><Edit3 size={18} />
                  <h3 className="font-bold text-sm">Edit {editingStaffMember.full_name}</h3>
                </div>
                <button onClick={() => setEditingStaffMember(null)}
                        className="p-1 hover:bg-white/10 rounded-md cursor-pointer"><X size={18} /></button>
              </div>
              <form onSubmit={handleEditStaffSubmit}>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Full Name</label>
                    <input type="text" required value={editStaffForm.fullName}
                           onChange={e => setEditStaffForm(p => ({ ...p, fullName: e.target.value }))}
                           className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Discount (%)</label>
                    <input type="number" min="0" max="100" step="0.01"
                           value={editStaffForm.discountCeiling}
                           onChange={e => setEditStaffForm(p => ({ ...p, discountCeiling: Number(e.target.value) }))}
                           className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Access Level</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['manager', 'staff'] as const).map(tier => (
                        <button key={tier} type="button"
                          onClick={() => setEditStaffForm(p => ({ ...p, accessTier: tier }))}
                          className={`p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${
                            editStaffForm.accessTier === tier
                              ? tier === 'manager' ? 'border-green-500 bg-green-50' : 'border-amber-500 bg-amber-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}>
                          <p className={`text-xs font-bold ${tier === 'manager' ? 'text-green-700' : 'text-amber-700'}`}>
                            {tier === 'manager' ? 'Manager' : 'Staff'}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-6 pb-6 flex gap-2">
                  <Button type="button" variant="outline"
                          onClick={() => setEditingStaffMember(null)}
                          className="flex-1 border-gray-300 text-gray-700">Cancel</Button>
                  <Button type="submit"
                          disabled={actionLoading === `edit-staff-${editingStaffMember.id}`}
                          className="flex-1 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                    {actionLoading === `edit-staff-${editingStaffMember.id}` ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── ADD CASHIER MODAL ── */}
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs animate-fade-in">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full mx-4 overflow-hidden animate-scale-in">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-brand-blue text-white">
                <div className="flex items-center gap-2">
                  <Plus size={18} />
                  <h3 className="font-bold text-sm">Add Cashier Account</h3>
                </div>
                <button 
                  onClick={() => setIsAddModalOpen(false)}
                  className="p-1 hover:bg-white/10 rounded-md transition-colors text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAddSubmit}>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Full Name
                    </label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Hari Prasad"
                      value={addForm.fullName}
                      onChange={e => setAddForm(prev => ({ ...prev, fullName: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Max Discount Ceiling (%)
                    </label>
                    <div className="relative">
                      <input 
                        type="number" 
                        required
                        min="0"
                        max="100"
                        step="0.01"
                        value={addForm.discountCeiling}
                        onChange={e => setAddForm(prev => ({ ...prev, discountCeiling: Number(e.target.value) }))}
                        className="w-full text-sm border border-gray-300 rounded-lg p-2.5 pr-8 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none"
                      />
                      <div className="absolute right-3 top-3 text-gray-400 pointer-events-none text-sm font-semibold">%</div>
                    </div>
                    <span className="text-[10px] text-gray-400 mt-1 block">
                      Limits the maximum discount this cashier can grant on any single item.
                    </span>
                  </div>

                  {locations.length > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                        Location
                      </label>
                      <select value={addForm.locationId}
                              onChange={e => setAddForm(prev => ({ ...prev, locationId: e.target.value }))}
                              className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-brand-blue outline-none bg-white">
                        {locations.map(l => (
                          <option key={l.id} value={l.id}>
                            {l.location_name} ({l.location_code}){l.is_main_branch ? ' — Main' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Masked PIN Field Section */}
                  <div className="pt-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 text-center">
                      Set 4-Digit Login PIN
                    </label>
                    
                    {/* Digit fields */}
                    <div className="flex justify-center gap-3 mb-4">
                      {addForm.pin.map((digit, i) => (
                        <input
                          key={i}
                          id={`pin-digit-${i}`}
                          ref={el => { pinInputRefs.current[i] = el; }}
                          type="password"
                          maxLength={1}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={digit}
                          onChange={e => handlePinChange(e.target.value, i, 'add')}
                          onKeyDown={e => handlePinKeyDown(e, i, 'add')}
                          className="w-12 h-12 text-center text-xl font-bold border border-gray-300 rounded-lg focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none shadow-xs"
                        />
                      ))}
                    </div>

                    {/* Integrated Keypad */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200/50 max-w-xs mx-auto grid grid-cols-3 gap-2 shadow-inner">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handlePinPadClick(num, 'add')}
                          className="py-2.5 text-center font-bold text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-100 active:scale-95 transition-all shadow-xs text-sm cursor-pointer"
                        >
                          {num}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => handlePinPadClear('add')}
                        className="py-2.5 text-center text-xs font-semibold text-gray-500 bg-white border border-gray-200 rounded-md hover:bg-red-50 hover:text-red-600 active:scale-95 transition-all shadow-xs cursor-pointer"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePinPadClick('0', 'add')}
                        className="py-2.5 text-center font-bold text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-100 active:scale-95 transition-all shadow-xs text-sm cursor-pointer"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePinPadBackspace('add')}
                        className="py-2.5 text-center text-xs font-semibold text-gray-500 bg-white border border-gray-200 rounded-md hover:bg-gray-100 active:scale-95 transition-all shadow-xs cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                  <Button 
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddModalOpen(false)}
                    className="text-xs px-4 py-2 border-gray-300 hover:bg-gray-100 text-gray-700 cursor-pointer font-semibold"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit"
                    disabled={actionLoading === 'create'}
                    className="bg-brand-blue hover:bg-brand-blue-hover text-white text-xs px-4 py-2 rounded-lg font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    {actionLoading === 'create' && <Loader2 size={12} className="animate-spin" />}
                    Create Cashier
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── EDIT DETAILS MODAL ── */}
        {editingStaff && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs animate-fade-in">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full mx-4 overflow-hidden animate-scale-in">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-brand-blue text-white">
                <div className="flex items-center gap-2">
                  <Edit3 size={18} />
                  <h3 className="font-bold text-sm">Edit Details: {editingStaff.full_name}</h3>
                </div>
                <button 
                  onClick={() => setEditingStaff(null)}
                  className="p-1 hover:bg-white/10 rounded-md transition-colors text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleEditSubmit}>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Full Name
                    </label>
                    <input 
                      type="text" 
                      required
                      value={editForm.fullName}
                      onChange={e => setEditForm(prev => ({ ...prev, fullName: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Max Discount Ceiling (%)
                    </label>
                    <div className="relative">
                      <input 
                        type="number" 
                        required
                        min="0"
                        max="100"
                        step="0.01"
                        value={editForm.discountCeiling}
                        onChange={e => setEditForm(prev => ({ ...prev, discountCeiling: Number(e.target.value) }))}
                        className="w-full text-sm border border-gray-300 rounded-lg p-2.5 pr-8 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none"
                      />
                      <div className="absolute right-3 top-3 text-gray-400 pointer-events-none text-sm font-semibold">%</div>
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                  <Button 
                    type="button"
                    variant="outline"
                    onClick={() => setEditingStaff(null)}
                    className="text-xs px-4 py-2 border-gray-300 hover:bg-gray-100 text-gray-700 cursor-pointer font-semibold"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit"
                    disabled={actionLoading === `edit-${editingStaff.id}`}
                    className="bg-brand-blue hover:bg-brand-blue-hover text-white text-xs px-4 py-2 rounded-lg font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    {actionLoading === `edit-${editingStaff.id}` && <Loader2 size={12} className="animate-spin" />}
                    Save Changes
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── RESET PIN MODAL ── */}
        {resettingPinStaff && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs animate-fade-in">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full mx-4 overflow-hidden animate-scale-in">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-brand-blue text-white">
                <div className="flex items-center gap-2">
                  <Key size={18} />
                  <h3 className="font-bold text-sm">Reset PIN: {resettingPinStaff.full_name}</h3>
                </div>
                <button 
                  onClick={() => setResettingPinStaff(null)}
                  className="p-1 hover:bg-white/10 rounded-md transition-colors text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Step 1: Confirmation warning screen */}
              {!pinConfirmed ? (
                <div className="p-6 space-y-4">
                  <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4 flex gap-3 text-xs leading-relaxed">
                    <Info className="shrink-0 text-amber-500 mt-0.5" size={16} />
                    <div>
                      <p className="font-bold">Are you sure you want to reset this PIN?</p>
                      <p className="text-gray-600 mt-1">
                        The cashier will immediately be locked out of POS switch-in until they are provided with the new 4-digit PIN code. Historical transaction logs and past shifts remain unaffected.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setResettingPinStaff(null)}
                      className="text-xs px-4 py-2 border-gray-300 hover:bg-gray-100 text-gray-700 cursor-pointer font-semibold"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setPinConfirmed(true)}
                      className="bg-amber-500 hover:bg-amber-600 text-white text-xs px-4 py-2 rounded-lg font-bold cursor-pointer"
                    >
                      Yes, Proceed
                    </Button>
                  </div>
                </div>
              ) : (
                /* Step 2: Set PIN Pad form screen */
                <form onSubmit={handleResetPinSubmit}>
                  <div className="p-6 space-y-4">
                    <p className="text-center text-xs text-gray-500 leading-normal mb-1">
                      Enter the new 4-digit numeric PIN below. The cashier will use this PIN to switch into the till.
                    </p>

                    {/* Digit inputs */}
                    <div className="flex justify-center gap-3 mb-4">
                      {resetPinValue.map((digit, i) => (
                        <input
                          key={i}
                          id={`reset-pin-digit-${i}`}
                          ref={el => { resetPinInputRefs.current[i] = el; }}
                          type="password"
                          maxLength={1}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={digit}
                          onChange={e => handlePinChange(e.target.value, i, 'reset')}
                          onKeyDown={e => handlePinKeyDown(e, i, 'reset')}
                          className="w-12 h-12 text-center text-xl font-bold border border-gray-300 rounded-lg focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none shadow-xs"
                        />
                      ))}
                    </div>

                    {/* Integrated Keypad */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200/50 max-w-xs mx-auto grid grid-cols-3 gap-2 shadow-inner">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handlePinPadClick(num, 'reset')}
                          className="py-2.5 text-center font-bold text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-100 active:scale-95 transition-all shadow-xs text-sm cursor-pointer"
                        >
                          {num}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => handlePinPadClear('reset')}
                        className="py-2.5 text-center text-xs font-semibold text-gray-500 bg-white border border-gray-200 rounded-md hover:bg-red-50 hover:text-red-600 active:scale-95 transition-all shadow-xs cursor-pointer"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePinPadClick('0', 'reset')}
                        className="py-2.5 text-center font-bold text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-100 active:scale-95 transition-all shadow-xs text-sm cursor-pointer"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePinPadBackspace('reset')}
                        className="py-2.5 text-center text-xs font-semibold text-gray-500 bg-white border border-gray-200 rounded-md hover:bg-gray-100 active:scale-95 transition-all shadow-xs cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                    <Button 
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setResettingPinStaff(null);
                        setPinConfirmed(false);
                      }}
                      className="text-xs px-4 py-2 border-gray-300 hover:bg-gray-100 text-gray-700 cursor-pointer font-semibold"
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit"
                      disabled={actionLoading === `pin-${resettingPinStaff.id}`}
                      className="bg-brand-blue hover:bg-brand-blue-hover text-white text-xs px-4 py-2 rounded-lg font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                      {actionLoading === `pin-${resettingPinStaff.id}` && <Loader2 size={12} className="animate-spin" />}
                      Save PIN
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
