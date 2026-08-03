'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CreditCard, CheckCircle2, AlertCircle, Loader2,
  RefreshCw, Clock, Shield, X
} from 'lucide-react';

type State = 'loading' | 'not_configured' | 'unverified' | 'verifying' | 'verified' | 'failed';

export default function PaymentSettings() {
  const router = useRouter();
  const [state,      setState]      = useState<State>('loading');
  const [creds,      setCreds]      = useState<any>(null);
  const [form,       setForm]       = useState({ fonepay_merchant_code:'', fonepay_username:'', fonepay_password:'', fonepay_secret_key:'' });
  const [qrData,     setQrData]     = useState<{invoice_id:string; qr_data_url:string; expires_at:string}|null>(null);
  const [countdown,  setCountdown]  = useState(0);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');
  const pollRef  = useRef<ReturnType<typeof setInterval>|null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);

  useEffect(() => {
    // Backend access gate — 403 for limited staff, redirects gracefully
    api.get('/api/settings/payment').catch(err => {
      if (err?.response?.status === 403) {
        router.replace('/settings');
      }
    });

    loadCreds();
    return () => { clearPoll(); };
  }, []);

  async function loadCreds() {
    setState('loading');
    try {
      const { data } = await api.get('/api/settings/payment-credentials');
      setCreds(data);
      if (!data.fonepay_enabled || !data.fonepay_merchant_code) setState('not_configured');
      else if (data.verification_status === 'verified')   setState('verified');
      else if (data.verification_status === 'verifying')  setState('verifying');
      else                                                  setState('unverified');
    } catch { setState('not_configured'); }
  }

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function handleSaveCreds(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try {
      await api.put('/api/settings/payment-credentials', form);
      setSuccess('Credentials saved. Status: unverified.');
      setForm({ fonepay_merchant_code:'', fonepay_username:'', fonepay_password:'', fonepay_secret_key:'' });
      setTimeout(() => { setSuccess(''); loadCreds(); }, 1500);
    } catch (err: any) {
      devError('[settings/payment/save-creds]', err);
      setError(getErrorMessage(err));
    } finally { setSaving(false); }
  }

  function clearPoll() {
    if (pollRef.current)  clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  async function startVerification() {
    setError('');
    try {
      const { data } = await api.post('/api/settings/payment-credentials/verify');
      setQrData(data);
      setState('verifying');
      setCountdown(data.expires_in_seconds ?? 300);

      timerRef.current = setInterval(() => {
        setCountdown(c => { if (c <= 1) { clearPoll(); return 0; } return c - 1; });
      }, 1000);

      pollRef.current = setInterval(async () => {
        try {
          const { data: statusData } = await api.get(`/api/payments/status/${data.invoice_id}`);
          if (statusData.status === 'completed') {
            clearPoll();
            await api.patch('/api/settings/payment-credentials/verified', { invoice_id: data.invoice_id });
            setState('verified'); setQrData(null);
            loadCreds();
          } else if (statusData.status === 'expired') {
            clearPoll(); setState('unverified'); setQrData(null);
            setError('QR expired. Try again.');
          }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (err: any) {
      devError('[settings/payment/start-verification]', err);
      setError(getErrorMessage(err));
    }
  }

  function resetCredentials() {
    clearPoll(); setQrData(null); setState('not_configured');
    setForm({ fonepay_merchant_code:'', fonepay_username:'', fonepay_password:'', fonepay_secret_key:'' });
    setError('');
  }

  const mins = String(Math.floor(countdown/60)).padStart(2,'0');
  const secs = String(countdown%60).padStart(2,'0');

  return (
    <AppShell>
      <div className="max-w-lg mx-auto space-y-5 font-sans">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center shrink-0">
              <CreditCard className="text-teal-600" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800">Payment — Fonepay QR</h1>
              <p className="text-xs text-gray-400 mt-0.5">Configure and verify QR payment credentials.</p>
            </div>
          </div>

          {/* ── LOADING ── */}
          {state === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-blue-600" size={24} />
            </div>
          )}

          {/* ── NOT CONFIGURED ── */}
          {state === 'not_configured' && (
            <form onSubmit={handleSaveCreds} className="space-y-4">
              <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                Enter your Fonepay merchant credentials from the Fonepay merchant portal.
                Credentials are encrypted at rest (AES-256-GCM). Secrets are never returned by the API.
              </p>
              {[
                { label:'Merchant code *', key:'fonepay_merchant_code', type:'text' },
                { label:'Username *',      key:'fonepay_username',      type:'text' },
                { label:'Password *',      key:'fonepay_password',      type:'password' },
                { label:'Secret key *',    key:'fonepay_secret_key',    type:'password' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">{f.label}</label>
                  <input required type={f.type} value={(form as any)[f.key]} onChange={set(f.key)}
                         className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500" />
                </div>
              ))}
              {error   && <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm"><AlertCircle size={15}/>{error}</div>}
              {success && <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm"><CheckCircle2 size={15}/>{success}</div>}
              <Button type="submit" disabled={saving}
                      className="w-full bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 gap-2">
                {saving ? <><Loader2 size={14} className="animate-spin"/>Saving…</> : <><Shield size={14}/>Save credentials</>}
              </Button>
            </form>
          )}

          {/* ── UNVERIFIED ── */}
          {state === 'unverified' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-700 mb-1">Credentials saved — not yet verified</p>
                <p className="text-xs text-amber-600">
                  Merchant: <span className="font-mono font-bold">{creds?.fonepay_merchant_code}</span>
                  {' · '}User: {creds?.fonepay_username}
                </p>
              </div>
              <p className="text-sm text-gray-600">
                Complete a ₨1 test payment to verify your credentials are working correctly.
              </p>
              {error && <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm"><AlertCircle size={15} className="shrink-0 mt-0.5"/>{error}</div>}
              <div className="flex gap-2">
                <Button onClick={startVerification} className="flex-1 bg-teal-600 text-white hover:bg-teal-700 gap-2">
                  <CreditCard size={14} /> Start ₨1 Verification
                </Button>
                <Button onClick={resetCredentials} variant="outline"
                        className="border-gray-300 text-gray-500 gap-1.5 text-xs">
                  <X size={12}/> Re-enter
                </Button>
              </div>
            </div>
          )}

          {/* ── VERIFYING (QR displayed) ── */}
          {state === 'verifying' && qrData && (
            <div className="space-y-4 text-center">
              <p className="text-sm font-semibold text-gray-700">Scan to complete ₨1 verification payment</p>
              <div className="inline-block bg-white border-2 border-gray-200 rounded-xl p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrData.qr_data_url} alt="Fonepay QR" className="w-48 h-48 mx-auto" />
              </div>
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-gray-500">Waiting for payment…</span>
              </div>
              <p className={`text-sm font-bold ${countdown < 60 ? 'text-red-600' : 'text-amber-600'}`}>
                <Clock size={14} className="inline mr-1" />Expires in {mins}:{secs}
              </p>
              {countdown === 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-red-600">QR expired.</p>
                  <Button onClick={() => { setState('unverified'); setQrData(null); }}
                          variant="outline" className="text-xs border-gray-300 text-gray-600">
                    Try again
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── VERIFIED ── */}
          {state === 'verified' && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
                <CheckCircle2 className="mx-auto text-green-500 mb-2" size={32} />
                <p className="text-base font-bold text-green-700">Payment Verified ✓</p>
                <p className="text-xs text-green-600 mt-1">
                  Merchant: <span className="font-mono font-bold">{creds?.fonepay_merchant_code}</span>
                </p>
                {creds?.verified_at && (
                  <p className="text-xs text-green-500 mt-0.5">
                    Verified {new Date(creds.verified_at).toLocaleString()}
                  </p>
                )}
              </div>
              <p className="text-xs text-gray-400 text-center">
                QR payments are now active. Cashiers can select "QR / Fonepay" at checkout.
              </p>
              <Button onClick={resetCredentials} variant="outline"
                      className="w-full border-gray-300 text-gray-600 gap-2 text-sm">
                <RefreshCw size={14} /> Replace credentials (resets to unverified)
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
