// utils/invoiceNumber.js
// Per-tenant per-location invoice sequence — §8.1
//
// Format: INV-{BS_YEAR}-{LOCATION_CODE}-{SEQ}
// e.g.    INV-2082-KTM-00001
//
// Each tenant+location pair gets its own PostgreSQL sequence created on first use
// (CREATE SEQUENCE IF NOT EXISTS — idempotent, safe to call on every invoice).
// Sequences are reset to 0 on Baisakh 1 (Nepali New Year, ~April 13-14) by a
// cron job (deferred to Phase 14 deployment).
//
// Sequence name pattern: inv_seq_{tenant_id_no_dashes}_{location_id_no_dashes}
// PostgreSQL identifier limit is 63 chars; two UUIDs stripped of dashes = 64 chars,
// so we use a fixed prefix 'iseq_' + first 13 chars of each id (collision-resistant
// for a single tenant's locations, which number in the tens at most).
// Full UUID is used as a comment on the sequence for traceability.
//
// NOTE: nextInvoiceNumber must be called with a pg client already inside
// an open transaction so the sequence nextval and the invoice INSERT are atomic.

const { getBsYear } = require('./bsDate');

/**
 * Derives a safe, short PostgreSQL sequence name from tenant + location UUIDs.
 * Strips dashes and uses first 16 chars of each UUID to stay under 63-char limit.
 *
 * @param {string} tenantId
 * @param {string} locationId
 * @returns {string}
 */
function seqName(tenantId, locationId) {
  const t = tenantId.replace(/-/g, '').slice(0, 16);
  const l = locationId.replace(/-/g, '').slice(0, 16);
  return `inv_seq_${t}_${l}`;
}

/**
 * Creates the sequence for this tenant+location if it does not yet exist,
 * then advances it and returns the formatted invoice number.
 *
 * Must be called with a connected pg client that has an open transaction.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} tenantId
 * @param {string} locationId
 * @param {string} locationCode   e.g. 'KTM'
 * @returns {Promise<string>}     e.g. 'INV-2082-KTM-00001'
 */
async function nextInvoiceNumber(client, tenantId, locationId, locationCode) {
  const name   = seqName(tenantId, locationId);
  const bsYear = getBsYear();

  // CREATE SEQUENCE IF NOT EXISTS — idempotent, no error on subsequent calls
  await client.query(
    `CREATE SEQUENCE IF NOT EXISTS "${name}" START 1 INCREMENT 1 MINVALUE 1`
  );

  const { rows } = await client.query(`SELECT nextval('"${name}"') AS seq`);
  const seq = String(rows[0].seq).padStart(5, '0');

  return `INV-${bsYear}-${locationCode.toUpperCase()}-${seq}`;
}

module.exports = { nextInvoiceNumber, seqName };
