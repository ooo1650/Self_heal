// utils/vatResolver.js
// Resolves the effective VAT rate for a product.
// §6.1 — Four VAT categories defined in the database enum vat_category_enum.
// §6.2 — custom_vat_rate on the product row overrides the category rate when set.
//
// Usage:
//   const { resolveVatRate } = require('../utils/vatResolver');
//   const rate = resolveVatRate(productRow);  // returns a Number, e.g. 13, 0

const VAT_RATES = {
  TAXABLE_13:  13.00,
  EXEMPT:       0.00,
  ZERO_RATED:   0.00,
  NON_TAXABLE:  0.00,
};

/**
 * Returns the effective VAT rate percentage for a product row.
 * custom_vat_rate (owner-set) takes precedence over the category default.
 * Falls back to 0 for any unrecognised category.
 *
 * @param {object} product - A row from the products table
 * @param {string} product.vat_category
 * @param {string|number|null} product.custom_vat_rate
 * @returns {number}
 */
function resolveVatRate(product) {
  if (product.custom_vat_rate !== null && product.custom_vat_rate !== undefined) {
    return Number(product.custom_vat_rate);
  }
  return VAT_RATES[product.vat_category] ?? 0.00;
}

module.exports = { resolveVatRate };
