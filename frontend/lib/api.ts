// lib/api.ts
// Axios instance with JWT auto-refresh interceptor

import axios from 'axios';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const CASHIER_TOKEN_KEY = 'cashier_token';
const CASHIER_NAME_KEY  = 'cashier_name';
const CASHIER_DISC_KEY  = 'cashier_max_discount_pct';

const api = axios.create({ baseURL: BASE });

/** Persist cashier session for POS focus mode (sessionStorage — tab-scoped). */
export function setCashierSession(
  token: string,
  name: string,
  maxDiscountPct?: number,
) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(CASHIER_TOKEN_KEY, token);
  sessionStorage.setItem(CASHIER_NAME_KEY, name);
  if (maxDiscountPct != null) {
    sessionStorage.setItem(CASHIER_DISC_KEY, String(maxDiscountPct));
  }
}

export function getCashierToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(CASHIER_TOKEN_KEY);
}

export function getCashierName(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(CASHIER_NAME_KEY);
}

export function getCashierMaxDiscount(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(CASHIER_DISC_KEY);
  return raw != null ? Number(raw) : null;
}

export function clearCashierSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(CASHIER_TOKEN_KEY);
  sessionStorage.removeItem(CASHIER_NAME_KEY);
  sessionStorage.removeItem(CASHIER_DISC_KEY);
}

export function isCashierFocusMode(): boolean {
  return !!getCashierToken();
}

/** Slide the 10-min cashier JWT on POS activity. Fire-and-forget. */
export function refreshCashierToken() {
  const token = getCashierToken();
  if (!token) return;
  axios
    .post(`${BASE}/api/pos/refresh-cashier-token`, null, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(({ data }) => {
      if (data.cashier_token) {
        sessionStorage.setItem(CASHIER_TOKEN_KEY, data.cashier_token);
      }
    })
    .catch(() => { /* expired — POS page handles re-auth */ });
}

// Attach access or cashier token to every request.
// Cashier token is ONLY used for POS-related endpoints — never for owner management routes.
const POS_PATHS = ['/api/pos', '/api/invoices', '/api/shifts', '/api/payments'];

api.interceptors.request.use(config => {
  if (typeof window === 'undefined') return config;

  // Respect an explicit Authorization header (e.g. owner token for switch-cashier)
  const existing = config.headers?.Authorization ?? config.headers?.authorization;
  if (existing) return config;

  const url          = config.url ?? '';
  const cashierToken = getCashierToken();
  const ownerToken   = localStorage.getItem('access_token');

  // Only use cashier token on POS-scope endpoints
  const useCashier = cashierToken && POS_PATHS.some(p => url.includes(p));
  const token = useCashier ? cashierToken : ownerToken;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 — attempt refresh, then retry once
// On 403 PASSWORD_CHANGE_REQUIRED — redirect to /change-password
api.interceptors.response.use(
  res => {
    // Slide cashier session on successful POS calls
    if (typeof window !== 'undefined' && getCashierToken()) {
      const url = res.config.url ?? '';
      if (url.includes('/api/pos') || url.includes('/api/invoices') ||
          url.includes('/api/shifts') || url.includes('/api/payments')) {
        refreshCashierToken();
      }
    }
    return res;
  },
  async err => {
    const original = err.config;

    // 403 PASSWORD_CHANGE_REQUIRED — redirect immediately, no retry
    if (err.response?.status === 403 &&
        (err.response?.data?.error === 'PASSWORD_CHANGE_REQUIRED' ||
         err.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED')) {
      if (typeof window !== 'undefined' &&
          !window.location.pathname.startsWith('/change-password')) {
        window.location.href = '/change-password';
      }
      return Promise.reject(err);
    }

    // Cashier token expired — clear focus mode, dispatch event (POS page listens)
    if (err.response?.status === 401 && getCashierToken()) {
      clearCashierSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cashier-session-expired'));
      }
      return Promise.reject(err);
    }

    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) throw new Error('No refresh token');
        const { data } = await axios.post(`${BASE}/api/auth/refresh`, {
          refresh_token: refreshToken,
        });
        localStorage.setItem('access_token', data.access_token);
        if (original.headers) {
          original.headers.Authorization = `Bearer ${data.access_token}`;
        }
        return api(original);
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('auth_user');
        // Dispatch event so AuthProvider can show a session-expired message
        // instead of doing a hard reload that loses UI state.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth-session-expired'));
        }
      }
    }
    return Promise.reject(err);
  }
);

export default api;
