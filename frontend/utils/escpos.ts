// utils/escpos.ts
// Phase 13b — Thermal receipt printing via WebUSB + escpos
// Build doc §8.2 — runs in the browser on the POS page.
//
// printReceipt(invoiceId) fetches GET /api/invoices/:id which now includes
// full tenant details and formatted_date (Phase 12.5 retrofit).
//
// VAT disclaimer footer printed as required by §21.3.
//
// If no USB printer is connected, printReceipt() returns { ok: false, error }
// without throwing — the checkout flow must NOT crash on a missing printer.

import api from '@/lib/api';

// ESC/POS command bytes
const ESC  = 0x1b;
const GS   = 0x1d;
const INIT = [ESC, 0x40];
const ALIGN_CENTER = [ESC, 0x61, 0x01];
const ALIGN_LEFT   = [ESC, 0x61, 0x00];
const BOLD_ON      = [ESC, 0x45, 0x01];
const BOLD_OFF     = [ESC, 0x45, 0x00];
const DOUBLE_HEIGHT_ON  = [ESC, 0x21, 0x10];
const DOUBLE_HEIGHT_OFF = [ESC, 0x21, 0x00];
const CUT          = [GS,  0x56, 0x41, 0x10];
// Cash drawer pulse: pin 2, on-time 25ms, off-time 250ms
const DRAWER_KICK  = [ESC, 0x70, 0x00, 0x19, 0xfa];
const LF           = [0x0a];
const DASH_LINE    = '─'.repeat(32) + '\n';

/** Encode a UTF-8 string to a Uint8Array */
function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Build the complete receipt byte sequence from the invoice API response */
function buildReceiptBytes(invoice: any): Uint8Array {
  const chunks: number[] = [];

  function push(...bytes: number[]) { chunks.push(...bytes); }
  function text(s: string) { chunks.push(...Array.from(enc(s))); }
  function line(s = '') { text(s + '\n'); }

  push(...INIT);

  // ── Header: business info ─────────────────────────────────────────────
  push(...ALIGN_CENTER, ...BOLD_ON, ...DOUBLE_HEIGHT_ON);
  line(invoice.tenant_business_name ?? 'IMS POS');
  push(...DOUBLE_HEIGHT_OFF, ...BOLD_OFF);

  if (invoice.tenant_address) line(invoice.tenant_address);
  if (invoice.tenant_phone)   line(`Tel: ${invoice.tenant_phone}`);
  if (invoice.tenant_pan_number) line(`PAN: ${invoice.tenant_pan_number}`);
  push(...LF);

  // ── Invoice meta ──────────────────────────────────────────────────────
  push(...ALIGN_LEFT);
  push(...BOLD_ON);
  line(DASH_LINE.trimEnd());
  push(...BOLD_OFF);

  line(`Invoice : ${invoice.invoice_number}`);
  line(`Date    : ${invoice.formatted_date}`);
  line(`Cashier : ${invoice.cashier_name}`);
  line(`Branch  : ${invoice.location_name} (${invoice.location_code})`);

  push(...BOLD_ON);
  line(DASH_LINE.trimEnd());
  push(...BOLD_OFF);

  // ── Line items ────────────────────────────────────────────────────────
  (invoice.items ?? []).forEach((item: any) => {
    line(item.product_name);
    const qty     = Number(item.quantity_sold).toFixed(3).replace(/\.?0+$/, '');
    const price   = `रू ${Number(item.unit_sale_price).toFixed(2)}`;
    const total   = `रू ${Number(item.final_row_total).toFixed(2)}`;
    line(`  ${qty} x ${price}  =  ${total}`);
    if (Number(item.item_discount_flat) > 0) {
      line(`  Discount: -रू ${Number(item.item_discount_flat).toFixed(2)}`);
    }
    if (Number(item.tax_rate_pct) > 0) {
      line(`  VAT ${item.tax_rate_pct}% included`);
    }
  });

  push(...BOLD_ON);
  line(DASH_LINE.trimEnd());
  push(...BOLD_OFF);

  // ── Totals ────────────────────────────────────────────────────────────
  const sub  = Number(invoice.subtotal_amount);
  const tax  = Number(invoice.tax_amount);
  const tot  = Number(invoice.total_amount);
  const bdp  = Number(invoice.bill_discount_pct ?? 0);
  const bdf  = Number(invoice.bill_discount_flat ?? 0);

  if (bdp > 0 || bdf > 0) {
    line(`Bill discount: -रू ${Math.max(bdf, sub * bdp / 100).toFixed(2)}`);
  }
  line(`VAT (incl.)  :  रू ${tax.toFixed(2)}`);
  push(...BOLD_ON);
  line(`TOTAL        :  रू ${tot.toFixed(2)}`);
  push(...BOLD_OFF);

  // ── Payment ───────────────────────────────────────────────────────────
  push(...LF);
  if (invoice.payment_method === 'cash') {
    line(`Cash tendered: रू ${Number(invoice.amount_tendered ?? 0).toFixed(2)}`);
    line(`Change       : रू ${Number(invoice.change_returned ?? 0).toFixed(2)}`);
  } else {
    line(`Payment : QR / Fonepay`);
    if (invoice.qr_transaction_ref) line(`Ref     : ${invoice.qr_transaction_ref}`);
  }

  // ── VAT disclaimer footer — §21.3 ────────────────────────────────────
  push(...BOLD_ON);
  line(DASH_LINE.trimEnd());
  push(...BOLD_OFF);

  push(...ALIGN_CENTER);
  line('NOT A FISCAL VAT INVOICE');
  line('Internal record only — CBMS pending');
  push(...LF);
  line('Thank you for your business!');
  push(...LF, ...LF);

  // Cut + cash drawer pulse
  push(...CUT);
  push(...DRAWER_KICK);

  return new Uint8Array(chunks);
}

export interface PrintResult {
  ok:     boolean;
  error?: string;
}

/**
 * Fetch the invoice and send it to the first connected USB thermal printer.
 * Never throws — returns { ok: false, error } on any failure.
 */
export async function printReceipt(invoiceId: string): Promise<PrintResult> {
  // WebUSB is only available in secure browser contexts
  if (typeof navigator === 'undefined' || !('usb' in navigator)) {
    return { ok: false, error: 'WebUSB not supported in this browser.' };
  }

  // Fetch invoice data
  let invoice: any;
  try {
    const { data } = await api.get(`/api/invoices/${invoiceId}`);
    invoice = data.invoice;
  } catch (err: any) {
    return { ok: false, error: `Could not fetch invoice: ${err.message}` };
  }

  // Request USB device (must have been previously permitted or is currently connected)
  let device: any;
  try {
    const devices = await (navigator as any).usb.getDevices();
    // Use an already-permitted printer, or request one
    device = devices.find((d: any) => d.productName?.toLowerCase().includes('printer'))
          ?? await (navigator as any).usb.requestDevice({ filters: [] });
  } catch {
    return { ok: false, error: 'No USB printer found or permission denied.' };
  }

  try {
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);

    const bytes = buildReceiptBytes(invoice);

    // Find the bulk-out endpoint
    const iface   = device.configuration!.interfaces[0];
    const altIface = iface.alternates[0];
    const endpoint = altIface.endpoints.find(
      (ep: any) => ep.direction === 'out' && ep.type === 'bulk'
    );

    if (!endpoint) {
      await device.close();
      return { ok: false, error: 'No bulk-out endpoint found on printer.' };
    }

    await device.transferOut(endpoint.endpointNumber, bytes.buffer as ArrayBuffer);
    await device.close();
    return { ok: true };
  } catch (err: any) {
    try { await device.close(); } catch { /* ignore */ }
    return { ok: false, error: `Print failed: ${err.message}` };
  }
}
