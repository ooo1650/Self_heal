// utils/bsDate.js
// Bikram Sambat (BS) date utilities — §8.1
// Uses the installed 'bikram-sambat' package: { toBik(y,m,d) → {year,month,day} }
//
// BS year is used in invoice numbers: INV-{BS_YEAR}-{LOCATION_CODE}-{SEQ}

const { toBik } = require('bikram-sambat');

/**
 * Returns the current Bikram Sambat year as a 4-digit number.
 * Optionally accepts a JS Date to convert a specific point in time.
 *
 * @param {Date} [jsDate=new Date()]
 * @returns {number}  e.g. 2082
 */
function getBsYear(jsDate = new Date()) {
  const bs = toBik(jsDate.getFullYear(), jsDate.getMonth() + 1, jsDate.getDate());
  return bs.year;
}

/**
 * Returns a full BS date string in YYYY-MM-DD format.
 * Used for receipt printing and report display.
 *
 * @param {Date} [jsDate=new Date()]
 * @returns {string}  e.g. "2082-09-17"
 */
function formatBsDate(jsDate = new Date()) {
  const bs = toBik(jsDate.getFullYear(), jsDate.getMonth() + 1, jsDate.getDate());
  const m  = String(bs.month).padStart(2, '0');
  const d  = String(bs.day).padStart(2, '0');
  return `${bs.year}-${m}-${d}`;
}

module.exports = { getBsYear, formatBsDate };
