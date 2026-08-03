'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Users, Plus, Search, ChevronRight, Loader2,
  AlertCircle, Edit3, X, CheckCircle2
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface Supplier {
  id:string; supplier_name:string; pan_number:string|null;
  contact_person:string|null; phone:string|null; email:string|null;
  address:string|null; is_active:boolean;
}
interface FormState {
  supplier_name:string; pan_number:string; contact_person:string;
  phone:string; email:string; address:string;
}
const EMPTY: FormState = { supplier_name:'', pan_number:'', contact_person:'', phone:'', email:'', address:'' };

export default function SuppliersPage() {
  const { user } = useAuth();
  const isOwner  = user?.role === 'owner';
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState<Supplier|null>(null);
  const [form,      setForm]      = useState<FormState>(EMPTY);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/api/suppliers'); setSuppliers(data.suppliers??[]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function openNew()    { setEditing(null); setForm(EMPTY); setFormError(''); setShowForm(true); }
  function openEdit(s:Supplier) {
    setEditing(s);
    setForm({ supplier_name:s.supplier_name, pan_number:s.pan_number??'',
              contact_person:s.contact_person??'', phone:s.phone??'',
              email:s.email??'', address:s.address??'' });
    setFormError(''); setShowForm(true);
  }

  function set(k: keyof FormState) {
    return (e:React.ChangeEvent<HTMLInputElement>) => setForm(f=>({...f,[k]:e.target.value}));
  }

  async function handleSave(e:React.FormEvent) {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      if (editing) await api.put(`/api/suppliers/${editing.id}`, form);
      else         await api.post('/api/suppliers', form);
      setShowForm(false); load();
    } catch (err:any) {
      devError('[suppliers/save]', err);
      setFormError(getErrorMessage(err));
    }
    finally { setSaving(false); }
  }

  async function toggleActive(s:Supplier) {
    await api.patch(`/api/suppliers/${s.id}/status`, { is_active: !s.is_active });
    load();
  }

  const filtered = suppliers.filter(s =>
    !search || s.supplier_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto font-sans">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <Link href="/procurement" className="hover:text-gray-600">Procurement</Link>
          <ChevronRight size={12} /><span className="text-gray-600">Suppliers</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Suppliers</h2>
            <p className="text-sm text-gray-500 mt-0.5">Manage supplier contacts and PAN details.</p>
          </div>
          {isOwner && (
            <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 gap-2 shrink-0">
              <Plus size={15} /> Add Supplier
            </Button>
          )}
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-gray-400" size={15} />
            <input value={search} onChange={e => setSearch(e.target.value)}
                   placeholder="Search supplier name…"
                   className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-4 py-2.5 focus:border-blue-500 outline-none" />
          </div>
        </div>

        {/* Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.6)'}}>
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-800">{editing ? 'Edit Supplier' : 'New Supplier'}</h3>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={16} /></button>
              </div>
              <form onSubmit={handleSave} className="px-6 py-5 space-y-3">
                {[
                  { label:'Supplier name *', key:'supplier_name', req:true },
                  { label:'PAN number',      key:'pan_number' },
                  { label:'Contact person',  key:'contact_person' },
                  { label:'Phone',           key:'phone' },
                  { label:'Email',           key:'email' },
                  { label:'Address',         key:'address' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                    <input required={!!f.req} value={(form as any)[f.key]} onChange={set(f.key as keyof FormState)}
                           className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                ))}
                {formError && <p className="text-xs text-red-600">{formError}</p>}
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}
                          className="flex-1 border-gray-300 text-gray-700">Cancel</Button>
                  <Button type="submit" disabled={saving}
                          className="flex-1 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-blue-600" size={28} /></div>
        ) : (
          <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
            {filtered.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="mx-auto text-gray-300 mb-3" size={36} />
                <p className="font-semibold text-gray-600 text-sm">No suppliers found</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    {['Name','PAN','Contact','Phone','Email','Status',''].map(h => (
                      <th key={h} className="py-3 px-5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(s => (
                    <tr key={s.id} className={`hover:bg-gray-50/50 ${!s.is_active?'opacity-60':''}`}>
                      <td className="py-3 px-5 font-semibold text-gray-800">{s.supplier_name}</td>
                      <td className="py-3 px-5 text-xs text-gray-500 font-mono">{s.pan_number??'—'}</td>
                      <td className="py-3 px-5 text-xs text-gray-500">{s.contact_person??'—'}</td>
                      <td className="py-3 px-5 text-xs text-gray-500">{s.phone??'—'}</td>
                      <td className="py-3 px-5 text-xs text-gray-500">{s.email??'—'}</td>
                      <td className="py-3 px-5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          s.is_active?'bg-green-50 text-green-700 border-green-200':'bg-gray-100 text-gray-500 border-gray-200'
                        }`}>{s.is_active?'Active':'Inactive'}</span>
                      </td>
                      <td className="py-3 px-5">
                        {isOwner && (
                          <div className="flex gap-2">
                            <button onClick={() => openEdit(s)} className="text-blue-600 hover:text-blue-800 transition-colors">
                              <Edit3 size={14} />
                            </button>
                            <button onClick={() => toggleActive(s)}
                                    className={`text-xs font-semibold ${s.is_active?'text-red-500':'text-green-600'}`}>
                              {s.is_active?'Deactivate':'Activate'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
