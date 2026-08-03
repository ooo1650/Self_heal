'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Button } from '@/components/ui/button';
import { Sliders, Save, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface Flags { useBarcodes:boolean; sizeColorModifiers:boolean; expiryTracking:boolean; binTracking:boolean; }
const FEATURES: { key: keyof Flags; label: string; desc: string }[] = [
  { key:'useBarcodes',        label:'Barcode Scanning',        desc:'Enable barcode lookup on the POS scan field. Required for multi-unit products.' },
  { key:'sizeColorModifiers', label:'Size / Colour Variants',  desc:'Allow item modifiers (e.g. S/M/L, Red/Blue) on invoice line items.' },
  { key:'expiryTracking',     label:'Expiry Date Tracking',    desc:'Track expiry_date in product attributes. Enables the Expiry Tracker analytics report.' },
  { key:'binTracking',        label:'Bin / Location Tracking', desc:'Enable bin-level stock tracking within a branch (advanced warehouse mode).' },
];
const BIZ_TYPES = ['RETAIL','WHOLESALE','RESTAURANT','PHARMACY'];

export default function FeaturesSettings() {
  const router = useRouter();
  const [flags,   setFlags]   = useState<Flags>({ useBarcodes:true, sizeColorModifiers:true, expiryTracking:false, binTracking:false });
  const [bizType, setBizType] = useState('RETAIL');
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState('');
  const [error,   setError]   = useState('');

  useEffect(() => {
    // Backend access gate — 403 for limited staff, redirects gracefully
    api.get('/api/settings/features').catch(err => {
      if (err?.response?.status === 403) {
        router.replace('/settings');
      }
    });

    api.get('/api/tenants/me/config').then(r => {
      const cfg = r.data.config ?? {};
      if (cfg.features) setFlags(f => ({ ...f, ...cfg.features }));
      if (cfg.business_type) setBizType(cfg.business_type);
    }).finally(() => setLoading(false));
  }, [router]);

  async function handleSave() {
    setSaving(true); setSuccess(''); setError('');
    try {
      await api.patch('/api/tenants/me/config', { business_type: bizType, features: flags });
      setSuccess('Feature flags saved.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      devError('[settings/features/save]', err);
      setError(getErrorMessage(err));
    }
    finally { setSaving(false); }
  }

  return (
    <AppShell>
      <div className="max-w-lg mx-auto space-y-5 font-sans">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
              <Sliders className="text-purple-600" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800">Feature Flags</h1>
              <p className="text-xs text-gray-400 mt-0.5">Enable or disable platform features for your business.</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-blue-600" size={24} /></div>
          ) : (
            <div className="space-y-5">
              {/* Business type */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Business type</label>
                <select value={bizType} onChange={e => setBizType(e.target.value)}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500">
                  {BIZ_TYPES.map(t => <option key={t} value={t}>{t.charAt(0)+t.slice(1).toLowerCase()}</option>)}
                </select>
              </div>

              {/* Toggle switches */}
              <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-100">
                {FEATURES.map(f => (
                  <div key={f.key} className="flex items-center justify-between px-4 py-4">
                    <div className="flex-1 mr-4">
                      <p className="text-sm font-semibold text-gray-800">{f.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{f.desc}</p>
                    </div>
                    <button
                      onClick={() => setFlags(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${flags[f.key] ? 'bg-purple-600' : 'bg-gray-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${flags[f.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                ))}
              </div>

              {success && <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm"><CheckCircle2 size={15}/>{success}</div>}
              {error   && <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm"><AlertCircle size={15}/>{error}</div>}

              <Button onClick={handleSave} disabled={saving}
                      className="w-full bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 gap-2">
                {saving ? <><Loader2 size={14} className="animate-spin"/>Saving…</> : <><Save size={14}/>Save feature flags</>}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
