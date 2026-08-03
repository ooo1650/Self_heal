'use client';
// app/settings/branches/page.tsx
// Phase 16a — Branch management screen (owner only)

import React, { useEffect, useState, useCallback } from 'react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Button } from '@/components/ui/button';
import {
  Building2, Plus, Edit3, UserX, Users, MapPin, Phone,
  ChevronRight, Loader2, AlertCircle, X, Check, Star,
  Shield,
} from 'lucide-react';

interface Branch {
  id:               string;
  location_name:    string;
  location_code:    string;
  is_main_branch:   boolean;
  is_headquarters:  boolean;
  address:          string | null;
  phone:            string | null;
  staff_count:      number;
  cashier_count:    number;
  created_at:       string;
}

interface BranchStaff {
  id:            string;
  full_name:     string;
  email:         string;
  role:          string;
  access_tier:   string;
  is_active:     boolean;
  assigned_at:   string;
}

interface AllStaff {
  id:          string;
  full_name:   string;
  email:       string;
  access_tier: string;
}

const EMPTY_FORM = { location_name: '', location_code: '', address: '', phone: '', is_headquarters: false };

export default function BranchesPage() {
  const { user } = useAuth();
  const router   = useRouter();

  const [branches, setBranches]         = useState<Branch[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Create / edit modal
  const [modalOpen, setModalOpen]       = useState(false);
  const [editTarget, setEditTarget]     = useState<Branch | null>(null);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [formError, setFormError]       = useState<string | null>(null);
  const [formSaving, setFormSaving]     = useState(false);

  // Branch detail slide-over
  const [detailBranch, setDetailBranch] = useState<Branch | null>(null);
  const [branchStaff, setBranchStaff]   = useState<BranchStaff[]>([]);
  const [allStaff, setAllStaff]         = useState<AllStaff[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assignIds, setAssignIds]       = useState<string[]>([]);
  const [assigning, setAssigning]       = useState(false);

  const isOwner = user?.access_tier === 'owner' || user?.role === 'owner';

  const fetchBranches = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.get('/api/tenants/locations');
      setBranches(data.locations ?? []);
    } catch (err: any) {
      devError('[branches/fetch]', err);
      setError(getErrorMessage(err));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (user && isOwner) fetchBranches();
  }, [user, isOwner, fetchBranches]);

  // Redirect non-owners
  useEffect(() => {
    if (user && !isOwner) router.replace('/settings');
  }, [user, isOwner, router]);

  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (b: Branch) => {
    setEditTarget(b);
    setForm({ location_name: b.location_name, location_code: b.location_code,
              address: b.address ?? '', phone: b.phone ?? '', is_headquarters: b.is_headquarters });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.location_name.trim() || !form.location_code.trim()) {
      setFormError('Branch name and code are required.');
      return;
    }
    setFormSaving(true); setFormError(null);
    try {
      if (editTarget) {
        await api.put(`/api/locations/${editTarget.id}`, form);
      } else {
        await api.post('/api/locations', form);
      }
      setModalOpen(false);
      fetchBranches();
    } catch (err: any) {
      devError('[branches/save]', err);
      setFormError(getErrorMessage(err));
    } finally { setFormSaving(false); }
  };

  const openDetail = async (b: Branch) => {
    setDetailBranch(b);
    setBranchStaff([]);
    setAssignIds([]);
    setDetailLoading(true);
    try {
      const [staffRes, allRes] = await Promise.all([
        api.get(`/api/locations/${b.id}/staff`),
        api.get('/api/staff'),
      ]);
      setBranchStaff(staffRes.data.staff ?? []);
      const assigned = new Set((staffRes.data.staff ?? []).map((s: any) => s.id));
      setAllStaff((allRes.data.staff ?? []).filter((s: any) => s.role === 'staff' && !assigned.has(s.id)));
    } catch (err: any) {
      devError('[branches/detail]', err);
    } finally { setDetailLoading(false); }
  };

  const handleAssign = async () => {
    if (!detailBranch || assignIds.length === 0) return;
    setAssigning(true);
    try {
      await Promise.all(assignIds.map(staffId =>
        api.post(`/api/staff/${staffId}/branches`, { branch_ids: [detailBranch.id] })
      ));
      openDetail(detailBranch);
      setAssignIds([]);
      fetchBranches();
    } catch (err: any) {
      devError('[branches/assign]', err);
    } finally { setAssigning(false); }
  };

  const handleRemoveStaff = async (staffId: string) => {
    if (!detailBranch) return;
    setActionLoading(`remove-${staffId}`);
    try {
      await api.delete(`/api/staff/${staffId}/branches/${detailBranch.id}`);
      openDetail(detailBranch);
      fetchBranches();
    } catch (err: any) {
      devError('[branches/remove-staff]', err);
    } finally { setActionLoading(null); }
  };

  if (!user) return null;

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <span>Settings</span><ChevronRight size={12} /><span className="text-gray-600">Branches</span>
        </div>

        {/* Header */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Branch Management</h2>
            <p className="text-sm text-gray-500 mt-1">Manage your business locations and assign staff to branches.</p>
          </div>
          <Button onClick={openCreate}
            className="bg-brand-blue hover:bg-brand-blue-hover text-white flex items-center gap-2 px-4 py-2 rounded-lg font-semibold shrink-0">
            <Plus size={16} /><span>Add Branch</span>
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 text-red-800">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="text-sm"><p className="font-semibold">Failed to load branches</p><p className="text-xs mt-1">{error}</p></div>
          </div>
        )}

        {/* Branch grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-brand-blue h-8 w-8" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {branches.map(b => (
              <div key={b.id} className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden hover:shadow-sm transition-shadow">
                <div className={`h-1.5 w-full ${b.is_headquarters ? 'bg-amber-400' : b.is_main_branch ? 'bg-brand-blue' : 'bg-gray-300'}`} />
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-800 text-sm">{b.location_name}</h3>
                        <span className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{b.location_code}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {b.is_headquarters && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                            <Star size={8} />HQ
                          </span>
                        )}
                        {b.is_main_branch && (
                          <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">Main</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openEdit(b)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors">
                        <Edit3 size={14} />
                      </button>
                    </div>
                  </div>

                  {b.address && (
                    <div className="flex items-start gap-1.5 text-xs text-gray-500 mb-1">
                      <MapPin size={12} className="mt-0.5 shrink-0 text-gray-400" />
                      <span>{b.address}</span>
                    </div>
                  )}
                  {b.phone && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
                      <Phone size={12} className="text-gray-400" /><span>{b.phone}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-4 pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Users size={12} className="text-gray-400" />
                      <span><strong className="text-gray-800">{b.staff_count}</strong> staff</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Shield size={12} className="text-gray-400" />
                      <span><strong className="text-gray-800">{b.cashier_count}</strong> cashiers</span>
                    </div>
                    <button onClick={() => openDetail(b)}
                      className="ml-auto text-xs font-semibold text-brand-blue hover:underline">
                      Manage staff →
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── CREATE / EDIT MODAL ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full mx-4 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-brand-blue text-white">
              <div className="flex items-center gap-2">
                <Building2 size={18} />
                <h3 className="font-bold text-sm">{editTarget ? `Edit: ${editTarget.location_name}` : 'Add Branch'}</h3>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-1 hover:bg-white/10 rounded-md"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              {formError && <p className="text-xs text-red-600 font-semibold bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>}
              {[
                { label: 'Branch Name *', key: 'location_name', placeholder: 'e.g. Downtown Branch' },
                { label: 'Branch Code *', key: 'location_code', placeholder: 'e.g. DT01' },
                { label: 'Address',       key: 'address',       placeholder: 'Street, City' },
                { label: 'Phone',         key: 'phone',         placeholder: '9800000000' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{f.label}</label>
                  <input type="text" placeholder={f.placeholder}
                    value={(form as any)[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none" />
                </div>
              ))}
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <div onClick={() => setForm(p => ({ ...p, is_headquarters: !p.is_headquarters }))}
                  className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${form.is_headquarters ? 'bg-amber-400' : 'bg-gray-200'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${form.is_headquarters ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
                <span className="text-sm font-semibold text-gray-700">Set as Headquarters</span>
              </label>
            </div>
            <div className="px-6 pb-6 flex gap-2">
              <Button variant="outline" onClick={() => setModalOpen(false)} className="flex-1 border-gray-300 text-gray-700">Cancel</Button>
              <Button onClick={handleSave} disabled={formSaving} className="flex-1 bg-brand-blue text-white hover:bg-brand-blue-hover disabled:opacity-50">
                {formSaving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Branch'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── BRANCH DETAIL SLIDE-OVER ── */}
      {detailBranch && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30 backdrop-blur-xs" onClick={() => setDetailBranch(null)} />
          <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
            {/* Header */}
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-brand-blue text-white shrink-0">
              <div>
                <h3 className="font-bold text-sm">{detailBranch.location_name}</h3>
                <p className="text-white/60 text-xs mt-0.5">Staff assignment</p>
              </div>
              <button onClick={() => setDetailBranch(null)} className="p-1 hover:bg-white/10 rounded-md"><X size={18} /></button>
            </div>

            <div className="flex-1 p-5 space-y-5">
              {detailLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-brand-blue" size={20} /></div>
              ) : (
                <>
                  {/* Assigned staff */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Assigned Staff ({branchStaff.length})</h4>
                    {branchStaff.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No staff assigned to this branch yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {branchStaff.map(s => (
                          <div key={s.id} className={`flex items-center justify-between p-3 rounded-lg border ${s.is_active ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-gray-50 opacity-60'}`}>
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{s.full_name}</p>
                              <p className="text-xs text-gray-400">{s.email} · <span className="capitalize">{s.access_tier}</span></p>
                            </div>
                            <button onClick={() => handleRemoveStaff(s.id)}
                              disabled={actionLoading === `remove-${s.id}`}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50">
                              {actionLoading === `remove-${s.id}` ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Assign new staff */}
                  {allStaff.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Add Staff to Branch</h4>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
                        {allStaff.map(s => (
                          <label key={s.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <div onClick={() => setAssignIds(prev =>
                              prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id]
                            )}
                              className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${assignIds.includes(s.id) ? 'bg-brand-blue border-brand-blue' : 'border-gray-300'}`}>
                              {assignIds.includes(s.id) && <Check size={10} className="text-white stroke-[3]" />}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{s.full_name}</p>
                              <p className="text-xs text-gray-400 capitalize">{s.access_tier}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      <Button onClick={handleAssign} disabled={assigning || assignIds.length === 0}
                        className="w-full mt-3 bg-brand-blue text-white hover:bg-brand-blue-hover disabled:opacity-50">
                        {assigning ? 'Assigning…' : `Assign ${assignIds.length > 0 ? `(${assignIds.length})` : ''} to Branch`}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
