// routes/auth.js
// Phase 2 — Tenant registration, login, JWT refresh
//
// POST /api/auth/register  — create tenant + main branch + owner staff account
// POST /api/auth/login     — verify credentials, issue access + refresh tokens
// POST /api/auth/refresh   — exchange valid refresh token for new access token

const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { sendWelcomeEmail, sendMail } = require('../utils/mailer');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build the JWT payload that goes into both access and refresh tokens.
 * Includes location_id for single-branch staff/managers.
 */
function buildPayload(staffRow, tenantId, locationId = null) {
  const payload = {
    tenant_id:   tenantId,
    staff_id:    staffRow.id,
    role:        staffRow.role,
  };
  if (locationId) payload.location_id = locationId;
  return payload;
}

/**
 * Issue a short-lived access token (15 min) and a long-lived refresh token (8 h).
 */
function issueTokens(payload) {
  const access_token = jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const refresh_token = jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '8h' }
  );
  return { access_token, refresh_token };
}

// ── POST /api/auth/register ────────────────────────────────────────────────────
// Creates:
//   1. tenants row
//   2. locations row  (main branch, is_main_branch = true)
//   3. staff row      (role = 'owner', hashed password)
//
// All three writes are wrapped in a single transaction so a partial failure
// leaves no orphaned rows.
//
// Body: { business_name, subdomain, owner_email, password,
//          pan_number?, address?, phone?, location_name?, location_code? }

router.post('/register', async (req, res) => {
  const {
    business_name,
    subdomain,
    owner_email,
    password,
    pan_number    = null,
    address       = null,
    phone         = null,
    location_name = 'Main Branch',
    location_code = 'MAIN',
  } = req.body;

  // ── Basic input validation ─────────────────────────────────────────────────
  if (!business_name || !subdomain || !owner_email || !password) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      required: ['business_name', 'subdomain', 'owner_email', 'password'],
    });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT', min_length: 8 });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Create tenant ───────────────────────────────────────────────────
    const tenantId = uuidv4();
    await client.query(
      `INSERT INTO tenants
         (id, business_name, subdomain, owner_email, pan_number, address, phone, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenantId,
        business_name,
        subdomain.toLowerCase().trim(),
        owner_email.toLowerCase().trim(),
        pan_number,
        address,
        phone,
        JSON.stringify({
          business_type: 'RETAIL',
          features: {
            useBarcodes:        true,
            sizeColorModifiers: true,
            expiryTracking:     false,
            binTracking:        false,
          },
        }),
      ]
    );

    // ── 2. Create main branch location ─────────────────────────────────────
    const locationId = uuidv4();
    await client.query(
      `INSERT INTO locations
         (id, tenant_id, location_name, location_code, is_main_branch)
       VALUES ($1, $2, $3, $4, $5)`,
      [locationId, tenantId, location_name, location_code.toUpperCase().trim(), true]
    );

    // ── 3. Create owner staff account ──────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, 12);
    const staffId      = uuidv4();
    await client.query(
      `INSERT INTO staff
         (id, tenant_id, location_id, full_name, email, password_hash, role,
          max_item_discount_pct, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        staffId,
        tenantId,
        locationId,
        business_name,          // owner display name defaults to business name
        owner_email.toLowerCase().trim(),
        passwordHash,
        'owner',
        100.00,                 // owner has no discount ceiling
        true,
        true,                   // Phase 14a: new owner must change password on first login
      ]
    );

    await client.query('COMMIT');

    // Fire welcome email — non-blocking, never fails the response
    sendWelcomeEmail(owner_email.toLowerCase().trim(), business_name).catch(() => {});

    return res.status(201).json({
      message:     'Tenant registered successfully',
      tenant_id:   tenantId,
      location_id: locationId,
      staff_id:    staffId,
    });
  } catch (err) {
    await client.query('ROLLBACK');

    // Unique constraint violations — subdomain or email already taken
    if (err.code === '23505') {
      const detail = err.detail || '';
      if (detail.includes('subdomain')) {
        return res.status(409).json({ error: 'SUBDOMAIN_TAKEN', subdomain });
      }
      if (detail.includes('owner_email') || detail.includes('email')) {
        return res.status(409).json({ error: 'EMAIL_TAKEN', owner_email });
      }
      return res.status(409).json({ error: 'DUPLICATE_VALUE', detail });
    }

    console.error('[auth/register]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ── POST /api/auth/login ───────────────────────────────────────────────────────
// Body: { email, password, subdomain? }
// If subdomain is provided: scope the lookup to that tenant only (multi-tenant
// deployment where each tenant logs in via their own subdomain).
// If subdomain is omitted: fall back to global email lookup (dev/localhost).
// Response shape is unchanged.

router.post('/login', async (req, res) => {
  const { email, password, subdomain } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['email', 'password'] });
  }

  try {
    let staff;

    if (subdomain) {
      // ── Subdomain-scoped login ───────────────────────────────────────────────
      // Step 1: resolve tenant from subdomain
      const { rows: tenantRows } = await db.query(
        'SELECT id FROM tenants WHERE subdomain = $1',
        [subdomain.toLowerCase().trim()]
      );
      if (tenantRows.length === 0) {
        return res.status(404).json({
          error:   'TENANT_NOT_FOUND',
          message: `No account found for subdomain "${subdomain}"`,
        });
      }
      const tenantId = tenantRows[0].id;

      // Step 2: scope staff lookup to this tenant
      const { rows } = await db.query(
        `SELECT s.id, s.tenant_id, s.location_id, s.full_name,
                s.email, s.password_hash, s.role, s.is_active,
                s.max_item_discount_pct, s.must_change_password, s.access_tier
         FROM staff s
         WHERE s.email = $1 AND s.tenant_id = $2`,
        [email.toLowerCase().trim(), tenantId]
      );
      staff = rows[0];
    } else {
      // ── Global lookup (dev / localhost fallback) ─────────────────────────────
      const { rows } = await db.query(
        `SELECT s.id, s.tenant_id, s.location_id, s.full_name,
                s.email, s.password_hash, s.role, s.is_active,
                s.max_item_discount_pct, s.must_change_password, s.access_tier
         FROM staff s
         WHERE s.email = $1`,
        [email.toLowerCase().trim()]
      );
      staff = rows[0];
    }

    // Use the same generic message for not-found and wrong-password to avoid user enumeration
    if (!staff) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    if (!staff.is_active) {
      return res.status(403).json({ error: 'ACCOUNT_DEACTIVATED' });
    }

    const passwordMatch = await bcrypt.compare(password, staff.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    // ── Phase 16a: resolve branch context ──────────────────────────────────
    // Owner: no location in token — selects branch in UI per-request
    // Manager/Staff with 1 branch: bake location_id into token
    // Manager/Staff with multiple branches: return branch list, frontend shows selector
    let tokenLocationId = null;
    let branchIds       = [];

    if (staff.role !== 'owner') {
      const { rows: branchRows } = await db.query(
        `SELECT location_id FROM staff_branch_access
         WHERE staff_id = $1 AND tenant_id = $2
         ORDER BY created_at ASC`,
        [staff.id, staff.tenant_id]
      );
      branchIds = branchRows.map(r => r.location_id);

      if (branchIds.length === 1) {
        tokenLocationId = branchIds[0];
      } else if (branchIds.length === 0) {
        // No branches assigned — use location_id from staff row as fallback
        tokenLocationId = staff.location_id ?? null;
      }
      // If multiple branches, tokenLocationId stays null and frontend shows selector
    }

    const payload = buildPayload(staff, staff.tenant_id, tokenLocationId);
    const tokens  = issueTokens(payload);

    const response = {
      ...tokens,
      staff_id:              staff.id,
      role:                  staff.role,
      full_name:             staff.full_name,
      tenant_id:             staff.tenant_id,
      location_id:           tokenLocationId ?? staff.location_id,
      max_item_discount_pct: staff.max_item_discount_pct,
      must_change_password:  staff.must_change_password,
      access_tier:           staff.access_tier,
    };

    // If multi-branch staff/manager, include branch list so frontend can show selector
    if (staff.role !== 'owner' && branchIds.length > 1) {
      response.requires_branch_selection = true;
      response.branch_ids = branchIds;
    }

    return res.json(response);
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/auth/refresh ─────────────────────────────────────────────────────
// Exchanges a valid refresh token for a new access token.
// Body: { refresh_token }
// Returns: { access_token }

router.post('/refresh', (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['refresh_token'] });
  }

  try {
    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);

    // Preserve location_id if it was baked into the original token
    const payload = {
      tenant_id: decoded.tenant_id,
      staff_id:  decoded.staff_id,
      role:      decoded.role,
    };
    if (decoded.location_id) payload.location_id = decoded.location_id;

    const access_token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });

    return res.json({ access_token });
  } catch (err) {
    return res.status(401).json({ error: 'REFRESH_TOKEN_EXPIRED', message: 'Please log in again' });
  }
});

// ── POST /api/auth/change-password ────────────────────────────────────────────
// Phase 14b — Forced password change on first login.
// Requires tenantAuth (Bearer token). Exempt from requirePasswordChange middleware.
//
// Body: { current_password, new_password }
// Verifies current_password against stored hash, hashes new_password with bcrypt-12,
// updates password_hash and sets must_change_password = false.

const tenantAuth = require('../middleware/tenantAuth');

// ── POST /api/auth/request-password-change-otp ───────────────────────────────
// Phase 15a — Generates and sends an OTP for the forced first-login password change.
// Requires tenantAuth (Bearer token). Rate-limited to max 1 request per 60 seconds.
router.post('/request-password-change-otp', tenantAuth, async (req, res) => {
  try {
    // 1. Fetch user status and email
    const { rows: staffRows } = await db.query(
      'SELECT id, email, must_change_password FROM staff WHERE id = $1 AND tenant_id = $2',
      [req.staffId, req.tenantId]
    );

    if (staffRows.length === 0) {
      return res.status(404).json({ error: 'STAFF_NOT_FOUND', message: 'Staff member not found.' });
    }

    const staff = staffRows[0];

    // 2. Reject if OTP is not required
    if (staff.must_change_password !== true) {
      return res.status(400).json({
        error: 'OTP_NOT_REQUIRED',
        message: 'OTP is only required on forced first-time login password change.',
      });
    }

    // 3. Rate limiting check (max 1 request per 60 seconds)
    const { rows: lastOtpRows } = await db.query(
      'SELECT created_at FROM password_change_otps WHERE staff_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
      [req.staffId]
    );

    if (lastOtpRows.length > 0) {
      const elapsedMs = Date.now() - new Date(lastOtpRows[0].created_at).getTime();
      if (elapsedMs < 60000) {
        const remainingSeconds = Math.ceil((60000 - elapsedMs) / 1000);
        return res.status(429).json({
          error: 'OTP_RATE_LIMIT',
          message: `Please wait ${remainingSeconds} seconds before requesting a new OTP.`,
          retry_after: remainingSeconds
        });
      }
    }

    // 4. Generate 6-digit code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // 5. Store OTP in database
    await db.query(
      'INSERT INTO password_change_otps (staff_id, otp_code, expires_at) VALUES ($1, $2, $3)',
      [req.staffId, otpCode, expiresAt]
    );

    // 6. Send code via Nodemailer sendMail()
    const subject = 'Your IMS password verification code';
    const text = [
      `Hi,`,
      ``,
      `Your 6-digit OTP verification code is: ${otpCode}`,
      ``,
      `This code will expire in 10 minutes.`,
      ``,
      `— IMS Platform`,
    ].join('\n');

    await sendMail({ to: staff.email, subject, text });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV ONLY] Generated OTP for staff_id ${req.staffId}: ${otpCode}`);
    }

    // Obfuscate email for UI response confirmation (e.g. ow***@testshop.com)
    const obfuscatedEmail = staff.email.replace(/^(..)(.*)(@.*)$/, (_, p1, p2, p3) => p1 + '*'.repeat(Math.min(p2.length, 5)) + p3);

    return res.json({
      message: 'OTP sent successfully.',
      email: obfuscatedEmail
    });
  } catch (err) {
    console.error('[auth/request-password-change-otp]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/auth/change-password ────────────────────────────────────────────
// Phase 14b / Phase 15a — Password change endpoint.
// Requires tenantAuth. If must_change_password=true, also requires a valid otp_code.
router.post('/change-password', tenantAuth, async (req, res) => {
  const { current_password, new_password, otp_code } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['current_password', 'new_password'],
    });
  }

  // Same validation rule as registration — min 8 chars
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT', min_length: 8 });
  }

  if (current_password === new_password) {
    return res.status(400).json({
      error:   'SAME_PASSWORD',
      message: 'New password must be different from the current password.',
    });
  }

  try {
    // Fetch current hash and status
    const { rows: staffRows } = await db.query(
      'SELECT id, password_hash, must_change_password FROM staff WHERE id = $1 AND tenant_id = $2',
      [req.staffId, req.tenantId]
    );

    if (staffRows.length === 0) {
      return res.status(401).json({ error: 'STAFF_NOT_FOUND' });
    }

    const staff = staffRows[0];

    // OTP validation if first login forced password change
    let otpIdToMarkUsed = null;
    if (staff.must_change_password === true) {
      if (!otp_code) {
        return res.status(400).json({
          error: 'MISSING_OTP',
          message: 'OTP verification code is required.',
        });
      }

      // Check for matching, unused, unexpired OTP
      const { rows: otpRows } = await db.query(
        'SELECT id, expires_at FROM password_change_otps WHERE staff_id = $1 AND otp_code = $2 AND used = false ORDER BY created_at DESC LIMIT 1',
        [req.staffId, otp_code]
      );

      if (otpRows.length === 0) {
        return res.status(400).json({
          error: 'INVALID_OTP',
          message: 'Invalid verification code.',
        });
      }

      const otp = otpRows[0];
      if (new Date(otp.expires_at) < new Date()) {
        return res.status(400).json({
          error: 'EXPIRED_OTP',
          message: 'Verification code has expired.',
        });
      }

      otpIdToMarkUsed = otp.id;
    }

    // Verify current password
    const match = await bcrypt.compare(current_password, staff.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'INVALID_CURRENT_PASSWORD' });
    }

    // Hash new password
    const newHash = await bcrypt.hash(new_password, 12);

    // Update staff and optionally mark OTP used in database
    if (otpIdToMarkUsed) {
      await db.query('UPDATE password_change_otps SET used = true WHERE id = $1', [otpIdToMarkUsed]);
    }

    await db.query(
      `UPDATE staff
       SET password_hash        = $1,
           must_change_password = false
       WHERE id = $2 AND tenant_id = $3`,
      [newHash, req.staffId, req.tenantId]
    );

    return res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('[auth/change-password]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/auth/forgot-password/request-otp ────────────────────────────────
// Unauthenticated endpoint to request an OTP code for resetting a forgotten password.
// Rate-limited to max 1 request per 60 seconds.
router.post('/forgot-password/request-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['email'] });
  }

  try {
    // 1. Fetch user status and email
    const { rows: staffRows } = await db.query(
      'SELECT id, email, is_active FROM staff WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (staffRows.length === 0) {
      return res.status(404).json({ error: 'STAFF_NOT_FOUND', message: 'No staff account found with this email address.' });
    }

    const staff = staffRows[0];

    if (!staff.is_active) {
      return res.status(403).json({ error: 'ACCOUNT_DEACTIVATED', message: 'This staff account has been deactivated.' });
    }

    // 2. Rate limiting check (max 1 request per 60 seconds)
    const { rows: lastOtpRows } = await db.query(
      'SELECT created_at FROM password_change_otps WHERE staff_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
      [staff.id]
    );

    if (lastOtpRows.length > 0) {
      const elapsedMs = Date.now() - new Date(lastOtpRows[0].created_at).getTime();
      if (elapsedMs < 60000) {
        const remainingSeconds = Math.ceil((60000 - elapsedMs) / 1000);
        return res.status(429).json({
          error: 'OTP_RATE_LIMIT',
          message: `Please wait ${remainingSeconds} seconds before requesting a new OTP.`,
          retry_after: remainingSeconds
        });
      }
    }

    // 3. Generate 6-digit code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // 4. Store OTP in database
    await db.query(
      'INSERT INTO password_change_otps (staff_id, otp_code, expires_at) VALUES ($1, $2, $3)',
      [staff.id, otpCode, expiresAt]
    );

    // 5. Send code via Nodemailer sendMail()
    const subject = 'Your IMS password reset verification code';
    const text = [
      `Hi,`,
      ``,
      `Your 6-digit OTP verification code to reset your password is: ${otpCode}`,
      ``,
      `This code will expire in 10 minutes.`,
      ``,
      `— IMS Platform`,
    ].join('\n');

    await sendMail({ to: staff.email, subject, text });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV ONLY] Generated Password Reset OTP for staff_id ${staff.id}: ${otpCode}`);
    }

    // Obfuscate email for UI response confirmation (e.g. ow***@testshop.com)
    const obfuscatedEmail = staff.email.replace(/^(..)(.*)(@.*)$/, (_, p1, p2, p3) => p1 + '*'.repeat(Math.min(p2.length, 5)) + p3);

    return res.json({
      message: 'OTP sent successfully.',
      email: obfuscatedEmail
    });
  } catch (err) {
    console.error('[auth/forgot-password/request-otp]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/auth/forgot-password/verify-otp ─────────────────────────────────
// Unauthenticated endpoint to verify the forgot-password OTP.
// Returns a short-lived reset token (JWT) on success.
router.post('/forgot-password/verify-otp', async (req, res) => {
  const { email, otp_code } = req.body;

  if (!email || !otp_code) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      required: ['email', 'otp_code'],
    });
  }

  try {
    // 1. Fetch user
    const { rows: staffRows } = await db.query(
      'SELECT id FROM staff WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (staffRows.length === 0) {
      return res.status(404).json({ error: 'STAFF_NOT_FOUND', message: 'Staff member not found.' });
    }

    const staff = staffRows[0];

    // 2. Check for matching, unused, unexpired OTP
    const { rows: otpRows } = await db.query(
      'SELECT id, expires_at FROM password_change_otps WHERE staff_id = $1 AND otp_code = $2 AND used = false ORDER BY created_at DESC LIMIT 1',
      [staff.id, otp_code]
    );

    if (otpRows.length === 0) {
      return res.status(400).json({
        error: 'INVALID_OTP',
        message: 'Invalid verification code.',
      });
    }

    const otp = otpRows[0];
    if (new Date(otp.expires_at) < new Date()) {
      return res.status(400).json({
        error: 'EXPIRED_OTP',
        message: 'Verification code has expired.',
      });
    }

    // 3. Mark OTP as used
    await db.query('UPDATE password_change_otps SET used = true WHERE id = $1', [otp.id]);

    // 4. Issue a short-lived password reset token (10 mins)
    const reset_token = jwt.sign(
      { staff_id: staff.id, action: 'reset_password' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    return res.json({
      message: 'OTP verified successfully.',
      reset_token
    });
  } catch (err) {
    console.error('[auth/forgot-password/verify-otp]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/auth/forgot-password/reset ──────────────────────────────────────
// Unauthenticated endpoint to submit the new password using the reset token.
router.post('/forgot-password/reset', async (req, res) => {
  const { token, new_password } = req.body;

  if (!token || !new_password) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      required: ['token', 'new_password'],
    });
  }

  if (new_password.length < 8) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT', min_length: 8 });
  }

  try {
    // 1. Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        error: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'The reset token has expired or is invalid. Please request a new OTP.',
      });
    }

    if (decoded.action !== 'reset_password' || !decoded.staff_id) {
      return res.status(401).json({ error: 'INVALID_TOKEN_ACTION' });
    }

    // 2. Hash new password
    const newHash = await bcrypt.hash(new_password, 12);

    // 3. Update password and clear must_change_password
    await db.query(
      `UPDATE staff
       SET password_hash = $1,
           must_change_password = false
       WHERE id = $2`,
      [newHash, decoded.staff_id]
    );

    return res.json({ message: 'Password has been reset successfully.' });
  } catch (err) {
    console.error('[auth/forgot-password/reset]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/auth/select-branch ──────────────────────────────────────────────
// Phase 16b — Called after login when requires_branch_selection = true,
// or by an owner to switch active branch context.
// Issues a new access token with location_id baked in.
// Requires valid Bearer token (tenantAuth).
//
// Body: { location_id }
// Returns: { access_token, location_id }

router.post('/select-branch', tenantAuth, async (req, res) => {
  const { location_id } = req.body;
  if (!location_id) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['location_id'] });
  }

  try {
    // Verify location belongs to this tenant
    const { rows: locRows } = await db.query(
      'SELECT id, location_name FROM locations WHERE id = $1 AND tenant_id = $2',
      [location_id, req.tenantId]
    );
    if (locRows.length === 0) {
      return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
    }

    // For non-owners, verify they have branch access
    if (req.userRole !== 'owner') {
      const { rows: accessRows } = await db.query(
        `SELECT 1 FROM staff_branch_access
         WHERE staff_id = $1 AND location_id = $2 AND tenant_id = $3`,
        [req.staffId, location_id, req.tenantId]
      );
      if (accessRows.length === 0) {
        return res.status(403).json({ error: 'BRANCH_ACCESS_DENIED' });
      }
    }

    // Fetch staff row for payload
    const { rows: staffRows } = await db.query(
      'SELECT id, role FROM staff WHERE id = $1 AND tenant_id = $2',
      [req.staffId, req.tenantId]
    );
    if (staffRows.length === 0) {
      return res.status(404).json({ error: 'STAFF_NOT_FOUND' });
    }

    const payload = {
      tenant_id:   req.tenantId,
      staff_id:    req.staffId,
      role:        req.userRole,
      location_id: location_id,
    };

    const access_token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });

    return res.json({
      access_token,
      location_id,
      location_name: locRows[0].location_name,
    });
  } catch (err) {
    console.error('[auth/select-branch]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
