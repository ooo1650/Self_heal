// utils/encryption.js
// AES-256-GCM symmetric encryption for sensitive credential storage.
//
// Used to encrypt per-tenant Fonepay password and secret_key before writing
// to tenant_payment_credentials. The encryption key lives only in .env and
// is NEVER stored in the database.
//
// Key: CREDENTIAL_ENCRYPTION_KEY — 32-byte hex string (64 hex chars).
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Encrypted format (single colon-delimited string stored in DB):
//   <iv_hex>:<authTag_hex>:<ciphertext_hex>
//
// AES-256-GCM provides both confidentiality AND integrity (auth tag).
// A fresh random IV is generated for every encrypt() call.

const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12;   // 96-bit IV — recommended for GCM
const TAG_LENGTH = 16;   // 128-bit auth tag

/**
 * Returns the 32-byte encryption key from CREDENTIAL_ENCRYPTION_KEY env var.
 * Throws a clear error if missing or wrong length so the developer sees it
 * at startup rather than silently failing at encrypt/decrypt time.
 */
function getKey() {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not set in .env. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${hex.length} chars`
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns a colon-delimited string: iv_hex:authTag_hex:ciphertext_hex
 *
 * @param {string} text
 * @returns {string}
 */
function encrypt(text) {
  const key    = getKey();
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

/**
 * Decrypt a string previously produced by encrypt().
 * Throws if the auth tag is invalid (tampered ciphertext).
 *
 * @param {string} encryptedText  — iv_hex:authTag_hex:ciphertext_hex
 * @returns {string}  plaintext
 */
function decrypt(encryptedText) {
  const key  = getKey();
  const parts = encryptedText.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format — expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv         = Buffer.from(ivHex,         'hex');
  const authTag    = Buffer.from(authTagHex,    'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),   // throws if auth tag mismatch
  ]);

  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
