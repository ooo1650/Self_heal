'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Button } from '@/components/ui/button';
import { Building2, Save, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface Form {
  business_name: string; pan_number: string;
  address: string; phone: string; logo_url: string;
}

export default function BusinessSettings() {
  const router = useRouter();
  const [form,    setForm]    = useState<Form>({ business_name:'', pan_number:'', address:'', phone:'', logo_url:'' });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState('');
  const [error,   setError]   = useState('');

  useEffect(() => {
    // Backend access gate — 403 for limited staff, redirects gracefully
    api.get('/api/settings/business').catch(err => {
      if (err?.response?.status === 403) {
        router.replace('/settings');
      }
    });

    api.get('/api/tenants/me').then(r => {
      const t = r.data.tenant;
      setForm({
        business_name: t.business_name ?? '',
        pan_number:    t.pan_number   ?? '',
        address:       t.address      ?? '',
        phone:         t.phone        ?? '',
        logo_url:      t.logo_url     ?? '',
      });
    }).finally(() => setLoading(false));
  }, [router]);

  function set(k: keyof Form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setSuccess(''); setError('');
    try {
      await api.patch('/api/tenants/me', form);
      setSuccess('Business information saved successfully.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      devError('[settings/business/save]', err);
      setError(getErrorMessage(err));
    } finally { setSaving(false); }
  }

  const fields: { label: string; key: keyof Form; placeholder: string; required?: boolean }[] = [
    { label: 'Business name',  key: 'business_name', placeholder: 'Sharma General Store', required: true },
    { label: 'PAN number',     key: 'pan_number',    placeholder: '123456789' },
    { label: 'Address',        key: 'address',        placeholder: 'Kathmandu, Nepal' },
    { label: 'Phone',          key: 'phone',          placeholder: '9800000000' },
    { label: 'Logo URL',       key: 'logo_url',       placeholder: 'https://yoursite.com/logo.png' },
  ];

  return (
    <AppShell>
      <div className="max-w-lg mx-auto space-y-5 font-sans">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <Building2 className="text-blue-600" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800">Business Settings</h1>
              <p className="text-xs text-gray-400 mt-0.5">This information appears on receipts and invoices.</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-blue-600" size={24} />
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              {fields.map(f => (
                <div key={f.key}>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {f.label} {f.required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="text"
                    required={f.required}
                    value={form[f.key]}
                    onChange={set(f.key)}
                    placeholder={f.placeholder}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}

              {success && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm">
                  <CheckCircle2 size={16} />{success}
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
                  <AlertCircle size={16} />{error}
                </div>
              )}

              <Button type="submit" disabled={saving}
                      className="w-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 gap-2">
                {saving ? <><Loader2 size={14} className="animate-spin" />Saving…</> : <><Save size={14} />Save changes</>}
              </Button>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}
