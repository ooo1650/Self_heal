// lib/getErrorMessage.ts
//
// Centralised error message helper for all API call catch blocks.
//
// Rules:
//   - NEVER surface raw backend error messages, SQL text, constraint names,
//     or stack traces to the user.
//   - Map by HTTP status code where useful; fall back to a generic message.
//   - All console.error calls are wrapped so they only fire outside production.
//
// Usage:
//   import { getErrorMessage, devError } from '@/lib/getErrorMessage';
//
//   catch (err) {
//     devError('[context]', err);          // dev-only log
//     setError(getErrorMessage(err));      // safe user message
//   }

import axios from 'axios';

/** Log to console only in non-production environments.
 *  Skips expected HTTP error codes (401, 403, 404, 429) that are
 *  normal API responses, not bugs — keeps the console clean during dev.
 */
export function devError(context: string, err: unknown): void {
  if (process.env.NODE_ENV === 'production') return;
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    // These are expected, user-facing API responses — not worth logging
    if (status === 401 || status === 403 || status === 404 || status === 429) return;
  }
  console.error(context, err);
}

/**
 * Returns a short, user-safe error string for a caught Axios (or unknown) error.
 *
 * @param err     The caught error value (any type — handles non-Axios throws too).
 * @param context Optional hint for logging; never shown to the user.
 */
export function getErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    // Network-level failure or non-Axios throw
    return 'Something went wrong. Please check your connection and try again.';
  }

  const status = err.response?.status;

  switch (status) {
    case 400:
      return 'Invalid request. Please check your input and try again.';
    case 401:
      return 'Invalid email or password.';
    case 403:
      return "You don't have permission to do this.";
    case 404:
      return 'Not found.';
    case 409:
      return 'This already exists. Please use a different value.';
    case 413:
      return 'The file is too large to upload.';
    case 422:
      return 'The request could not be processed. Please review your input.';
    case 423:
      return 'This account is temporarily locked. Please try again later.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/**
 * Variant for forms that display a more contextual message on specific known
 * status codes (e.g. login returns 401 which should read "Invalid email or
 * password" rather than the generic 401 text).
 *
 * Additional status-specific overrides can be passed as the second argument:
 *   getErrorMessageWithOverrides(err, { 409: 'That email is already in use.' })
 */
export function getErrorMessageWithOverrides(
  err: unknown,
  overrides: Partial<Record<number | 'network', string>> = {},
): string {
  if (!axios.isAxiosError(err)) {
    return overrides['network'] ?? 'Something went wrong. Please check your connection and try again.';
  }

  const status = err.response?.status;
  if (status && status in overrides) {
    return overrides[status as number]!;
  }

  return getErrorMessage(err);
}
