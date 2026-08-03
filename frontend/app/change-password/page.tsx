'use client';
// app/change-password/page.tsx
// Isolated password change screen (no AppShell) with OTP verification (Phase 15a)

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import api from '@/lib/api';
import axios from 'axios';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Button } from '@/components/ui/button';
import { Lock, ShieldAlert, ShieldCheck, Mail, RefreshCw } from 'lucide-react';

export default function ChangePasswordPage() {
  const { user, updateUser, loading } = useAuth();
  const router = useRouter();

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // OTP verification fields
  const [otpCode, setOtpCode] = useState('');
  const [emailDestination, setEmailDestination] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [requestingOtp, setRequestingOtp] = useState(false);

  // Error/Success messaging
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [otpErrorMsg, setOtpErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const otpRequestedOnMount = useRef(false);

  const handleRequestOtp = useCallback(async () => {
    if (cooldown > 0 || requestingOtp) return;
    
    setRequestingOtp(true);
    setOtpErrorMsg(null);
    setErrorMsg(null);

    try {
      const { data } = await api.post('/api/auth/request-password-change-otp');
      setEmailDestination(data.email || 'your registered email');
      setCooldown(60); // 60s cooldown
    } catch (err: unknown) {
      devError('[change-password/request-otp]', err);
      setOtpErrorMsg(getErrorMessage(err));
    } finally {
      setRequestingOtp(false);
    }
  }, [cooldown, requestingOtp]);

  // If not logged in, redirect to login
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  // Request OTP automatically on mount once
  useEffect(() => {
    if (!loading && user && user.must_change_password && !otpRequestedOnMount.current) {
      otpRequestedOnMount.current = true;
      handleRequestOtp();
    }
  }, [loading, user, handleRequestOtp]);

  // Cooldown timer handler
  useEffect(() => {
    if (cooldown > 0) {
      timerRef.current = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setOtpErrorMsg(null);
    setSuccessMsg(null);

    // Form validations
    if (!currentPassword || !newPassword || !confirmPassword || !otpCode) {
      setErrorMsg('Please fill in all fields.');
      return;
    }

    if (otpCode.length !== 6 || !/^\d+$/.test(otpCode)) {
      setOtpErrorMsg('OTP verification code must be exactly 6 digits.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('New passwords do not match.');
      return;
    }

    if (currentPassword === newPassword) {
      setErrorMsg('New password must be different from current password.');
      return;
    }

    setSubmitting(true);

    try {
      await api.post('/api/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
        otp_code: otpCode,
      });

      setSuccessMsg('Password changed successfully! Redirecting...');
      
      // Update local state so they are no longer forced to change password
      updateUser({ must_change_password: false });
      
      setTimeout(() => {
        router.push('/dashboard');
      }, 1500);
    } catch (err: unknown) {
      devError('[change-password/submit]', err);
      // Map specific error codes to user-safe messages without leaking backend detail
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        const errCode = (err.response?.data as { error?: string })?.error;
        if (errCode === 'MISSING_OTP' || errCode === 'INVALID_OTP') {
          setOtpErrorMsg('Invalid verification code. Please check and try again.');
        } else if (errCode === 'EXPIRED_OTP') {
          setOtpErrorMsg('Verification code has expired. Please request a new code.');
        } else if (errCode === 'INVALID_CURRENT_PASSWORD') {
          setErrorMsg('The current password you entered is incorrect.');
        } else if (errCode === 'PASSWORD_TOO_SHORT') {
          setErrorMsg('New password must be at least 8 characters long.');
        } else if (errCode === 'SAME_PASSWORD') {
          setErrorMsg('New password must be different from your current password.');
        } else {
          setErrorMsg(getErrorMessage(err));
        }
      } else {
        setErrorMsg(getErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-radial from-gray-100 to-gray-200/50 p-6 font-sans">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-xl">
        {/* Brand Banner */}
        <div className="bg-brand-blue px-8 py-8 text-center text-white relative">
          <h2 className="text-xl font-bold tracking-tight">Security Verification Required</h2>
          <p className="text-white/70 text-xs mt-1 font-medium tracking-wide">
            Enter the 6-digit OTP code sent to your email to update your password.
          </p>
        </div>

        {/* Form area */}
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {successMsg && (
            <div className="flex items-start gap-3 bg-green-50 border border-green-200 text-green-800 p-3.5 rounded-lg text-xs font-semibold">
              <ShieldCheck className="text-green-600 shrink-0 mt-0.5" size={16} />
              <span>{successMsg}</span>
            </div>
          )}

          {/* OTP section */}
          <div className="bg-gray-50 border border-gray-200/60 p-4 rounded-xl space-y-4">
            <div className="flex items-start gap-3">
              <Mail className="text-brand-blue shrink-0 mt-0.5" size={16} />
              <div className="space-y-1">
                <span className="text-xs font-bold text-gray-700 block">Verification Code Sent</span>
                <span className="text-[11px] text-gray-500 block leading-tight">
                  We sent a 6-digit code to <strong className="text-gray-800">{emailDestination || '...'}</strong>.
                </span>
              </div>
            </div>

            {/* OTP Input and Resend Button */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-700 tracking-wide">
                  Enter 6-digit OTP
                </label>
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={cooldown > 0 || requestingOtp}
                  className={`text-xs font-bold flex items-center gap-1 transition-colors ${
                    cooldown > 0
                      ? 'text-gray-400 cursor-not-allowed'
                      : 'text-brand-blue hover:text-brand-blue-hover'
                  }`}
                >
                  <RefreshCw size={12} className={requestingOtp ? 'animate-spin' : ''} />
                  <span>{cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend Code'}</span>
                </button>
              </div>

              <input
                type="text"
                maxLength={6}
                value={otpCode}
                onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                disabled={submitting}
                className="w-full text-center tracking-widest text-lg font-bold py-2 bg-white border border-gray-200 rounded-lg shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all"
              />
              
              {otpErrorMsg && (
                <div className="flex items-start gap-2 text-red-700 text-[11px] font-semibold mt-1">
                  <ShieldAlert className="text-red-500 shrink-0 mt-0.5" size={13} />
                  <span>{otpErrorMsg}</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {errorMsg && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 p-3.5 rounded-lg text-xs font-semibold animate-shake">
                <ShieldAlert className="text-red-600 shrink-0 mt-0.5" size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Current Password Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 tracking-wide block">
                Current Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                  <Lock size={16} />
                </div>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={submitting}
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50/50 border border-gray-200 rounded-lg shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* New Password Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 tracking-wide block">
                New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                  <Lock size={16} />
                </div>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="•••••••• (min 8 chars)"
                  required
                  disabled={submitting}
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50/50 border border-gray-200 rounded-lg shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* Confirm New Password Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 tracking-wide block">
                Confirm New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                  <Lock size={16} />
                </div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={submitting}
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50/50 border border-gray-200 rounded-lg shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all placeholder:text-gray-400"
                />
              </div>
            </div>
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand-blue hover:bg-brand-blue-hover text-white py-2.5 rounded-lg text-sm font-semibold tracking-wide shadow-md transition-all duration-200 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Updating Password...</span>
              </>
            ) : (
              <span>Update Password</span>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
