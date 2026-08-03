'use client';
import React, { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import {
  Check, Loader2, ChevronRight, LogOut,
  Building2, Users, CreditCard, Sliders, Receipt,
  Plus, Trash2, Edit2, KeyRound, ShieldCheck, Eye, EyeOff
} from 'lucide-react';

// ── Shared primitives ──────────────────────────────────────────────────────────

function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="px-0 pt-6 pb-2">
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{title}</h2>
      {desc && <p className="text-xs text-gray-400 mt-0.5">{desc}</p>}
    </div>
  );
}

function SettingRow({
  label, value, onSave, type = 'text', placeholder, hint,
}: {
  label: string; value: string; type?: string;
  onSave: (v: string) => Promise<void>;
  placeholder?: string; hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState(value);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => { setVal(value); }, [value]);

  async function save() {
    if (val === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(val);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); setEditing(false); }
  }

  return (
    <div className="flex items-center justify-between py-3.5 border-b border-gray-100 last:border-0 group">
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {editing ? (
          <>
            <input
              autoFocus type={type} value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setVal(value); setEditing(false); } }}
              placeholder={placeholder}
              className="text-sm border border-blue-400 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-200 w-48"
            />
            <button onClick={save} disabled={saving}
                    className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
            </button>
            <button onClick={() => { setVal(value); setEditing(false); }}
                    className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">Cancel</button>
          </>
        ) : (
          <>
            <span className={`text-sm ${val ? 'text-gray-600' : 'text-gray-300'}`}>
              {type === 'password' ? (val ? '••••••••' : 'Not set') : (val || <span className="text-gray-300 italic">Not set</span>)}
            </span>
            {saved && <Check size={14} className="text-green-500" />}
            <button onClick={() => setEditing(true)}
                    className="text-xs text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity ml-1 font-medium">
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label, hint, value, onToggle,
}: {
  label: string; hint?: string; value: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 mr-4">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <button
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${value ? 'bg-blue-600' : 'bg-gray-200'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow mt-0.5 transition duration-200 ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-1">{children}</div>;
}

// ── Main settings page ─────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user, logout } = useAuth();

  // Business info
  const [biz, setBiz] = useState({ business_name:'', pan_number:'', address:'', phone:'', logo_url:'' });

  // Feature flags
  const [flags,   setFlags]   = useState({ useBarcodes:true, sizeColorModifiers:true, expiryTracking:false, binTracking:false });
  const [bizType, setBizType] = useState('RETAIL');

  // Staff
  const [staff,      setStaff]      = useState<any[]>([]);
  const [locations,  setLocations]  = useState<any[]>([]);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [staffForm, setStaffForm]   = useState({ full_name:'', email:'', password:'', location_id:'', max_item_discount_pct:'10' });
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffError,  setStaffError]  = useState('');
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [newPwd,       setNewPwd]     = useState('');
  const [showNewPwd,   setShowNewPwd] = useState(false);

  // Payment
  const [payStatus, setPayStatus]   = useState<any>(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const [tenantRes, cfgRes, staffRes, locRes, payRes] = await Promise.all([
      api.get('/api/tenants/me').catch(() => null),
      api.get('/api/tenants/me/config').catch(() => null),
      api.get('/api/staff').catch(() => null),
      api.get('/api/locations').catch(() => null),
      api.get('/api/settings/payment-credentials').catch(() => null),
    ]);
    if (tenantRes) {
      const t = tenantRes.data.tenant;
      setBiz({ business_name:t.business_name??'', pan_number:t.pan_number??'',
               address:t.address??'', phone:t.phone??'', logo_url:t.logo_url??'' });
    }
    if (cfgRes) {
      const cfg = cfgRes.data.config ?? {};
      if (cfg.features) setFlags(f => ({...f,...cfg.features}));
      if (cfg.business_type) setBizType(cfg.business_type);
    }
    if (staffRes)  setStaff(staffRes.data.staff ?? []);
    if (locRes)    setLocations(locRes.data.locations ?? []);
    if (payRes)    setPayStatus(payRes.data);
  }

  // Biz field save
  async function saveBizField(key: string, val: string) {
    const updated = { ...biz, [key]: val };
    setBiz(updated);
    await api.patch('/api/tenants/me', { [key]: val });
  }

  // Feature toggle save
  async function toggleFlag(key: keyof typeof flags) {
    const updated = { ...flags, [key]: !flags[key] };
    setFlags(updated);
    await api.patch('/api/tenants/me/config', { features: updated });
  }

  // Add cashier
  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault(); setStaffSaving(true); setStaffError('');
    try {
      await api.post('/api/staff', {
        full_name: staffForm.full_name.trim(), email: staffForm.email.trim(),
        password: staffForm.password, location_id: staffForm.location_id||undefined,
        max_item_discount_pct: Number(staffForm.max_item_discount_pct),
      });
      setShowAddStaff(false);
      setStaffForm({full_name:'',email:'',password:'',location_id:'',max_item_discount_pct:'10'});
      const r = await api.get('/api/staff'); setStaff(r.data.staff??[]);
    } catch (err: any) {
      devError('[settings/add-staff]', err);
      setStaffError(getErrorMessage(err));
    } finally { setStaffSaving(false); }
  }

  async function toggleStaffActive(s: any) {
    if (s.id === user?.staff_id) return;
    await api.patch(`/api/staff/${s.id}/status`, { is_active: !s.is_active });
    const r = await api.get('/api/staff'); setStaff(r.data.staff??[]);
  }

  async function handleResetPwd(e: React.FormEvent) {
    e.preventDefault();
    await api.put(`/api/staff/${resetTarget.id}/password`, { new_password: newPwd });
    setResetTarget(null); setNewPwd('');
  }

  const VAT_CATS = [
    { v:'TAXABLE_13', r:'13%', d:'Standard commercial goods — FMCG, electronics, clothing' },
    { v:'EXEMPT',     r:'0%',  d:'Basic foodstuffs, medicine, educational materials' },
    { v:'ZERO_RATED', r:'0%',  d:'Exports and government-specified zero-rated items' },
    { v:'NON_TAXABLE',r:'N/A', d:'Outside VAT scope — financial services' },
  ];

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto pb-16 font-sans">

        {/* Page title */}
        <div className="pt-2 pb-4">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        </div>

        {/* ── BUSINESS ────────────────────────────────── */}
        <SectionHeader title="Business" desc="Appears on receipts and invoices." />
        <Card>
          <SettingRow label="Business name"   value={biz.business_name}   onSave={v=>saveBizField('business_name',v)}   placeholder="Your store name" />
          <SettingRow label="PAN number"      value={biz.pan_number}      onSave={v=>saveBizField('pan_number',v)}      placeholder="123456789" />
          <SettingRow label="Address"         value={biz.address}         onSave={v=>saveBizField('address',v)}         placeholder="Kathmandu, Nepal" />
          <SettingRow label="Phone"           value={biz.phone}           onSave={v=>saveBizField('phone',v)}           placeholder="9800000000" />
          <SettingRow label="Logo URL"        value={biz.logo_url}        onSave={v=>saveBizField('logo_url',v)}        placeholder="https://…/logo.png" />
        </Card>

        {/* ── STAFF ───────────────────────────────────── */}
        <SectionHeader title="Staff & Cashiers" />
        <Card>
          {staff.map((s, i) => (
            <div key={s.id} className={`flex items-center justify-between py-3.5 ${i < staff.length-1 ? 'border-b border-gray-100' : ''}`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-bold shrink-0">
                  {s.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{s.full_name}</p>
                  <p className="text-xs text-gray-400">{s.email} · <span className="capitalize">{s.role}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.is_active?'bg-green-100 text-green-700':'bg-gray-100 text-gray-400'}`}>
                  {s.is_active?'Active':'Inactive'}
                </span>
                <button onClick={() => { setResetTarget(s); setNewPwd(''); }}
                        className="text-xs text-gray-400 hover:text-blue-600 transition-colors" title="Reset password">
                  <KeyRound size={14} />
                </button>
                {s.id !== user?.staff_id && (
                  <button onClick={() => toggleStaffActive(s)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors" title={s.is_active?'Deactivate':'Activate'}>
                    {s.is_active ? <Trash2 size={14} /> : <ShieldCheck size={14} />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {/* Add cashier */}
          {!showAddStaff ? (
            <div className="py-3">
              <button onClick={() => setShowAddStaff(true)}
                      className="flex items-center gap-2 text-sm text-blue-600 font-medium hover:text-blue-800 transition-colors">
                <Plus size={15} /> Add cashier
              </button>
            </div>
          ) : (
            <form onSubmit={handleAddStaff} className="pt-3 pb-1 space-y-2 border-t border-gray-100 mt-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">New Cashier</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {key:'full_name', ph:'Full name', type:'text'},
                  {key:'email',     ph:'Email',     type:'email'},
                  {key:'password',  ph:'Password (min 8)',  type:'password'},
                  {key:'max_item_discount_pct', ph:'Max discount %', type:'number'},
                ].map(f => (
                  <input key={f.key} required type={f.type} placeholder={f.ph}
                         value={(staffForm as any)[f.key]}
                         onChange={e => setStaffForm(s=>({...s,[f.key]:e.target.value}))}
                         className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
                ))}
                <select value={staffForm.location_id} onChange={e => setStaffForm(s=>({...s,location_id:e.target.value}))}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400 col-span-2">
                  <option value="">No branch assigned</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}
                </select>
              </div>
              {staffError && <p className="text-xs text-red-500">{staffError}</p>}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={staffSaving}
                        className="text-xs font-semibold bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {staffSaving ? 'Creating…' : 'Create'}
                </button>
                <button type="button" onClick={() => { setShowAddStaff(false); setStaffError(''); }}
                        className="text-xs text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-100">Cancel</button>
              </div>
            </form>
          )}
        </Card>

        {/* Reset password modal */}
        {resetTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:'rgba(0,0,0,0.5)'}}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-80">
              <p className="text-sm font-bold text-gray-800 mb-1">Reset password</p>
              <p className="text-xs text-gray-400 mb-3">{resetTarget.full_name}</p>
              <form onSubmit={handleResetPwd} className="space-y-3">
                <div className="relative">
                  <input required type={showNewPwd?'text':'password'} minLength={8}
                         placeholder="New password" value={newPwd}
                         onChange={e => setNewPwd(e.target.value)}
                         className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 pr-9" />
                  <button type="button" onClick={() => setShowNewPwd(v=>!v)}
                          className="absolute right-2.5 top-2.5 text-gray-400">
                    {showNewPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="flex-1 text-sm font-semibold bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700">Save</button>
                  <button type="button" onClick={()=>setResetTarget(null)}
                          className="flex-1 text-sm text-gray-600 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── PAYMENT ─────────────────────────────────── */}
        <SectionHeader title="Payment — Fonepay QR" />
        <Card>
          <div className="flex items-center justify-between py-3.5 border-b border-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-700">Status</p>
              {payStatus?.fonepay_merchant_code && (
                <p className="text-xs text-gray-400 mt-0.5">Merchant: {payStatus.fonepay_merchant_code} · User: {payStatus.fonepay_username}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {payStatus?.verification_status === 'verified' ? (
                <span className="flex items-center gap-1 text-xs font-bold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                  <ShieldCheck size={11}/> Verified
                </span>
              ) : payStatus?.fonepay_enabled ? (
                <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">Unverified</span>
              ) : (
                <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">Not configured</span>
              )}
              <a href="/settings/payment" className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5">
                Manage <ChevronRight size={12}/>
              </a>
            </div>
          </div>
        </Card>

        {/* ── FEATURES ────────────────────────────────── */}
        <SectionHeader title="Features" desc="Changes take effect immediately." />
        <Card>
          <ToggleRow label="Barcode Scanning"       hint="Required for multi-unit products and POS scan."     value={flags.useBarcodes}        onToggle={()=>toggleFlag('useBarcodes')} />
          <ToggleRow label="Size / Colour Variants"  hint="Item modifiers on invoice lines (S/M/L, colours)."  value={flags.sizeColorModifiers} onToggle={()=>toggleFlag('sizeColorModifiers')} />
          <ToggleRow label="Expiry Date Tracking"    hint="Enables the Expiry Tracker analytics report."       value={flags.expiryTracking}     onToggle={()=>toggleFlag('expiryTracking')} />
          <ToggleRow label="Bin / Location Tracking" hint="Bin-level stock tracking within a branch."          value={flags.binTracking}        onToggle={()=>toggleFlag('binTracking')} />
          <div className="flex items-center justify-between py-3.5">
            <p className="text-sm font-medium text-gray-700">Business type</p>
            <select value={bizType}
                    onChange={async e => { setBizType(e.target.value); await api.patch('/api/tenants/me/config',{business_type:e.target.value}); }}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white outline-none focus:border-blue-400">
              {['RETAIL','WHOLESALE','RESTAURANT','PHARMACY'].map(t=>(
                <option key={t} value={t}>{t.charAt(0)+t.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </div>
        </Card>

        {/* ── VAT REFERENCE ───────────────────────────── */}
        <SectionHeader title="VAT Categories" desc="Nepal VAT reference — §6.1. Edit per-product from Products." />
        <Card>
          {VAT_CATS.map((cat, i) => (
            <div key={cat.v} className={`flex items-center justify-between py-3.5 ${i<VAT_CATS.length-1?'border-b border-gray-100':''}`}>
              <div>
                <p className="text-sm font-medium text-gray-700 font-mono">{cat.v}</p>
                <p className="text-xs text-gray-400 mt-0.5">{cat.d}</p>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ml-4 shrink-0 ${
                cat.r==='13%'?'bg-blue-100 text-blue-700':cat.r==='0%'?'bg-green-100 text-green-700':'bg-gray-100 text-gray-500'
              }`}>{cat.r}</span>
            </div>
          ))}
          <div className="py-3">
            <p className="text-xs text-orange-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 leading-relaxed">
              ⚠ Receipts show VAT breakdown but are <strong>not fiscal VAT invoices</strong> until CBMS is active — §21.1
            </p>
          </div>
        </Card>

        {/* ── ACCOUNT / LOGOUT ────────────────────────── */}
        <SectionHeader title="Account" />
        <Card>
          <div className="flex items-center justify-between py-3.5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
                {user?.full_name?.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">{user?.full_name}</p>
                <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
              </div>
            </div>
          </div>
          <div className="py-3">
            <button
              onClick={logout}
              className="flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-800 transition-colors py-1"
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </Card>

        <div className="h-8" />
      </div>
    </AppShell>
  );
}
