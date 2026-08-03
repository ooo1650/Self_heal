'use client';
// app/login/page.tsx
// Phase 15a + Phase 16a — Login, forgot password, and branch selection flow

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, requiresBranchSelection, BranchSelectionRequired } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Lock, Mail, ShieldAlert, RefreshCw, ShieldCheck, GitBranch, Zap } from 'lucide-react';
import axios from 'axios';
import api from '@/lib/api';
import { devError, getErrorMessage, getErrorMessageWithOverrides } from '@/lib/getErrorMessage';

export default function LoginPage() {
  const { user, login, selectBranch, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // forgotPasswordStep: 'login' | 'otp' | 'reset' | 'branch'
  const [step, setStep] = useState<'login' | 'otp' | 'reset' | 'branch'>('login');

  // Branch selection state
  const [branchPending, setBranchPending]   = useState<BranchSelectionRequired | null>(null);
  const [branches, setBranches]             = useState<{ id: string; location_name: string; location_code: string }[]>([]);
  const [selectingBranch, setSelectingBranch] = useState(false);

  // Forgot password state
  const [otpCode, setOtpCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailDestination, setEmailDestination] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [otpErrorMsg, setOtpErrorMsg] = useState<string | null>(null);
  const [passwordErrorMsg, setPasswordErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!loading && user && step === 'login') router.replace('/dashboard');
  }, [user, loading, router, step]);

  useEffect(() => {
    if (cooldown > 0) {
      timerRef.current = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [cooldown]);

  // Fetch branch names when branch selection is needed
  useEffect(() => {
    if (!branchPending) return;
    api.get('/api/tenants/locations', {
      headers: { Authorization: `Bearer ${branchPending.access_token}` },
    }).then(({ data }) => {
      const all = (data.locations ?? []) as any[];
      setBranches(all.filter(l => branchPending.branch_ids.includes(l.id)));
    }).catch(() => {
      // Fallback: show IDs if location names can't be loaded
      setBranches(branchPending.branch_ids.map(id => ({ id, location_name: id, location_code: '' })));
    });
  }, [branchPending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setErrorMsg('Please fill in all fields.'); return; }
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      let subdomain: string | undefined;
      if (typeof window !== 'undefined') {
        const match = window.location.hostname.match(/^([a-z0-9-]+)\.yourims\.com$/i);
        if (match?.[1]) subdomain = match[1].toLowerCase();
      }
      const result = await login(email, password, subdomain);

      if (requiresBranchSelection(result)) {
        setBranchPending(result);
        setStep('branch');
        return;
      }
      if (result.must_change_password) {
        router.push('/change-password');
      } else {
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      devError('[login/submit]', err);
      setErrorMsg(getErrorMessageWithOverrides(err, { 401: 'Invalid email or password.' }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectBranch = async (locationId: string) => {
    if (!branchPending) return;
    setSelectingBranch(true);
    setErrorMsg(null);
    try {
      const u = await selectBranch(locationId, branchPending.access_token);
      if (u.must_change_password) {
        router.push('/change-password');
      } else {
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      devError('[login/select-branch]', err);
      setErrorMsg(getErrorMessage(err));
    } finally {
      setSelectingBranch(false);
    }
  };

  const handleForgotPasswordRequestOtp = useCallback(async () => {
    if (cooldown > 0 || requestingOtp) return;
    if (!email) { setErrorMsg('Please enter your email address first.'); return; }
    setRequestingOtp(true);
    setErrorMsg(null);
    setOtpErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { data } = await api.post('/api/auth/forgot-password/request-otp', { email });
      setEmailDestination(data.email || 'your registered email');
      setCooldown(60);
      setStep('otp');
    } catch (err: unknown) {
      devError('[login/forgot-otp-request]', err);
      setErrorMsg(getErrorMessageWithOverrides(err, {
        429: 'Please wait before requesting another code.',
        404: 'No account found with that email address.',
      }));
    } finally { setRequestingOtp(false); }
  }, [email, cooldown, requestingOtp]);

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length !== 6 || !/^\d+$/.test(otpCode)) {
      setOtpErrorMsg('Verification code must be exactly 6 digits.');
      return;
    }
    setVerifyingOtp(true);
    setOtpErrorMsg(null);
    try {
      const { data } = await api.post('/api/auth/forgot-password/verify-otp', { email, otp_code: otpCode });
      setResetToken(data.reset_token);
      setStep('reset');
    } catch (err: unknown) {
      devError('[login/verify-otp]', err);
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        const code = (err.response?.data as any)?.error;
        setOtpErrorMsg(code === 'EXPIRED_OTP'
          ? 'Verification code has expired. Please request a new code.'
          : 'Invalid verification code. Please check and try again.');
      } else { setOtpErrorMsg(getErrorMessage(err)); }
    } finally { setVerifyingOtp(false); }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordErrorMsg(null);
    if (newPassword.length < 8) { setPasswordErrorMsg('Password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setPasswordErrorMsg('Passwords do not match.'); return; }
    setResettingPassword(true);
    try {
      await api.post('/api/auth/forgot-password/reset', { token: resetToken, new_password: newPassword });
      setSuccessMsg('Password reset successfully. Please log in.');
      setStep('login');
      setOtpCode(''); setNewPassword(''); setConfirmPassword(''); setResetToken(''); setPassword('');
    } catch (err: unknown) {
      devError('[login/reset-password]', err);
      setPasswordErrorMsg(getErrorMessage(err));
    } finally { setResettingPassword(false); }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-radial from-gray-100 to-gray-200/50 p-6 font-sans">
      <div className="w-full max-w-md flex flex-col items-center">

        {/* ── Demo credentials banner — controlled by NEXT_PUBLIC_SHOW_DEMO_BANNER ── */}
        {process.env.NEXT_PUBLIC_SHOW_DEMO_BANNER === 'true' && (
          <div className="w-full mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-xs">
            <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">Try the Demo</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-blue-500 text-xs">Email</span>
                <span className="font-mono font-semibold text-blue-900 select-all text-xs">demo@laxmikirana.com</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-blue-500 text-xs">Password</span>
                <span className="font-mono font-semibold text-blue-900 select-all text-xs">demo1234</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-blue-500 text-xs">Cashier PIN</span>
                <span className="font-mono font-semibold text-blue-900 select-all text-xs">1234 (Sita)</span>
              </div>
            </div>
            <p className="text-[10px] text-blue-400 mt-2.5">Staff view · POS and inventory access only</p>
          </div>
        )}

        <div className="w-full bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">

        {/* Brand banner */}
        <div className="bg-brand-blue px-8 py-8 text-center text-white relative">
          <div className="absolute top-4 left-4 h-6 w-6 rounded-md bg-white/10 flex items-center justify-center font-bold text-xs">I</div>
          <h2 className="text-2xl font-bold tracking-tight">
            {step === 'login'  ? 'Welcome Back'           :
             step === 'otp'    ? 'Verification Required'  :
             step === 'reset'  ? 'Reset Password'         :
             'Select Branch'}
          </h2>
          <p className="text-white/70 text-xs mt-1 font-medium tracking-wide">
            {step === 'login'  ? 'Inventory & Point of Sale System' :
             step === 'otp'    ? 'Enter the code sent to your email' :
             step === 'reset'  ? 'Choose a strong new password'      :
             `Hi ${branchPending?.full_name ?? ''} — choose your active branch`}
          </p>
        </div>

        {/* Success banner (password reset) */}
        {successMsg && step === 'login' && (
          <div className="mx-8 mt-6 flex items-start gap-3 bg-green-50 border border-green-200 text-green-800 p-3.5 rounded-lg text-xs font-semibold">
            <ShieldCheck className="text-green-600 shrink-0 mt-0.5" size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* ── STEP: login ── */}
        {step === 'login' && (
          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            {errorMsg && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 p-3.5 rounded-lg text-xs font-semibold">
                <ShieldAlert className="text-red-600 shrink-0 mt-0.5" size={16} />
                <span>{errorMsg}</span>
              </div>
            )}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 tracking-wide block">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="owner@example.com" required
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50/50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all placeholder:text-gray-400" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-700 tracking-wide">Password</label>
                  <button type="button" onClick={handleForgotPasswordRequestOtp} disabled={requestingOtp}
                    className="text-xs font-bold text-brand-blue hover:text-brand-blue-hover transition-colors disabled:opacity-50">
                    {requestingOtp ? 'Sending...' : 'Forgot Password?'}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••" required
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50/50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all placeholder:text-gray-400" />
                </div>
              </div>
            </div>
            <Button type="submit" disabled={submitting}
              className="w-full bg-brand-blue hover:bg-brand-blue-hover text-white py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all flex items-center justify-center gap-2">
              {submitting
                ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /><span>Signing In...</span></>
                : <span>Sign In</span>}
            </Button>
          </form>
        )}

        {/* ── STEP: branch selection ── */}
        {step === 'branch' && branchPending && (
          <div className="p-8 space-y-4">
            {errorMsg && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 p-3.5 rounded-lg text-xs font-semibold">
                <ShieldAlert className="text-red-600 shrink-0 mt-0.5" size={16} />
                <span>{errorMsg}</span>
              </div>
            )}
            <p className="text-xs text-gray-500 text-center">You have access to multiple branches. Select the one you are working at today.</p>
            <div className="space-y-2">
              {branches.length === 0 && (
                <div className="flex items-center justify-center py-6">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-blue border-t-transparent" />
                </div>
              )}
              {branches.map(b => (
                <button key={b.id} type="button"
                  disabled={selectingBranch}
                  onClick={() => handleSelectBranch(b.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-gray-50 hover:bg-brand-blue hover:text-white border border-gray-200 hover:border-brand-blue rounded-xl transition-all text-left group disabled:opacity-50">
                  <GitBranch size={18} className="text-brand-blue group-hover:text-white shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{b.location_name}</p>
                    {b.location_code && <p className="text-xs text-gray-400 group-hover:text-white/70">{b.location_code}</p>}
                  </div>
                  {selectingBranch && (
                    <div className="ml-auto h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  )}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setStep('login'); setBranchPending(null); setBranches([]); }}
              className="w-full text-center text-xs font-bold text-gray-500 hover:text-gray-700 py-1">
              ← Back to login
            </button>
          </div>
        )}

        {/* ── STEP: OTP verification ── */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="p-8 space-y-6">
            {otpErrorMsg && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 p-3.5 rounded-lg text-xs font-semibold">
                <ShieldAlert className="text-red-600 shrink-0 mt-0.5" size={16} />
                <span>{otpErrorMsg}</span>
              </div>
            )}
            <div className="bg-gray-50 border border-gray-200/60 p-4 rounded-xl space-y-4">
              <div className="flex items-start gap-3">
                <Mail className="text-brand-blue shrink-0 mt-0.5" size={16} />
                <div>
                  <span className="text-xs font-bold text-gray-700 block">Verification Code Sent</span>
                  <span className="text-[11px] text-gray-500 block">To <strong className="text-gray-800">{emailDestination || 'your email'}</strong></span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-700">Enter 6-digit OTP</label>
                  <button type="button" onClick={handleForgotPasswordRequestOtp} disabled={cooldown > 0 || requestingOtp}
                    className={`text-xs font-bold flex items-center gap-1 ${cooldown > 0 ? 'text-gray-400 cursor-not-allowed' : 'text-brand-blue hover:text-brand-blue-hover'}`}>
                    <RefreshCw size={12} className={requestingOtp ? 'animate-spin' : ''} />
                    <span>{cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend Code'}</span>
                  </button>
                </div>
                <input type="text" maxLength={6} value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000" required disabled={verifyingOtp}
                  className="w-full text-center tracking-widest text-lg font-bold py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all" />
              </div>
            </div>
            <div className="space-y-3">
              <Button type="submit" disabled={verifyingOtp}
                className="w-full bg-brand-blue hover:bg-brand-blue-hover text-white py-2.5 rounded-lg text-sm font-semibold shadow-md flex items-center justify-center gap-2">
                {verifyingOtp ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /><span>Verifying...</span></> : 'Verify OTP'}
              </Button>
              <button type="button" onClick={() => { setStep('login'); setErrorMsg(null); setOtpErrorMsg(null); }}
                className="w-full text-center text-xs font-bold text-gray-500 hover:text-gray-700 py-1">Back to Login</button>
            </div>
          </form>
        )}

        {/* ── STEP: reset password ── */}
        {step === 'reset' && (
          <form onSubmit={handleResetPassword} className="p-8 space-y-6">
            {passwordErrorMsg && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 p-3.5 rounded-lg text-xs font-semibold">
                <ShieldAlert className="text-red-600 shrink-0 mt-0.5" size={16} />
                <span>{passwordErrorMsg}</span>
              </div>
            )}
            <div className="space-y-4">
              {(['New Password', 'Confirm New Password'] as const).map((label, i) => (
                <div key={label} className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 block">{label}</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input type="password"
                      value={i === 0 ? newPassword : confirmPassword}
                      onChange={e => i === 0 ? setNewPassword(e.target.value) : setConfirmPassword(e.target.value)}
                      placeholder="•••••••• (min 8 chars)" required disabled={resettingPassword}
                      className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50/50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all placeholder:text-gray-400" />
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <Button type="submit" disabled={resettingPassword}
                className="w-full bg-brand-blue hover:bg-brand-blue-hover text-white py-2.5 rounded-lg text-sm font-semibold shadow-md flex items-center justify-center gap-2">
                {resettingPassword ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /><span>Updating...</span></> : 'Update Password'}
              </Button>
              <button type="button" onClick={() => { setStep('login'); setOtpCode(''); setNewPassword(''); setConfirmPassword(''); setResetToken(''); }}
                className="w-full text-center text-xs font-bold text-gray-500 hover:text-gray-700 py-1">Cancel</button>
            </div>
          </form>
        )}
        </div>{/* end white card */}

        {/* ── Self-Healing Demo Controls button — navigates to /demo ── */}
        <a
          href="/demo"
          className="mt-5 flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-600 shadow-sm transition-all"
        >
          <Zap size={13} className="text-yellow-500" />
          Self-Healing Demo Controls
        </a>

      </div>
    </div>
  );
}
