'use client';
// /products/new — Path B: create product without a physical barcode
// Backend auto-generates INT-XXXXX internal code and inserts it into product_barcodes.
// The generated code is shown clearly in the success state.

import React, { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ChevronRight, Package, Upload, X, CheckCircle2,
  AlertCircle, Loader2, ImageIcon
} from 'lucide-react';

const VAT_OPTIONS = [
  { value: 'TAXABLE_13',  label: 'Taxable — 13% VAT' },
  { value: 'EXEMPT',      label: 'Exempt — 0%' },
  { value: 'ZERO_RATED',  label: 'Zero-rated — 0%' },
  { value: 'NON_TAXABLE', label: 'Non-taxable' },
];

interface FormState {
  name:                string;
  base_cost_price:     string;
  mrp:                 string;
  sale_price:          string;
  unit_name:           string;
  vat_category:        string;
  custom_vat_rate:     string;
  low_stock_alert_qty: string;
}

export default function NewProductPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<FormState>({
    name: '', base_cost_price: '', mrp: '', sale_price: '',
    unit_name: 'piece', vat_category: 'TAXABLE_13',
    custom_vat_rate: '', low_stock_alert_qty: '10',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ id: string; name: string; code: string } | null>(null);

  function set(k: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  // Auto-fill sale_price from MRP when MRP changes and sale_price is blank/same
  function handleMrp(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setForm(f => ({
      ...f, mrp: val,
      sale_price: f.sale_price === '' || f.sale_price === f.mrp ? val : f.sale_price,
    }));
  }

  function pickImage(file: File) {
    if (!file.type.startsWith('image/')) return;
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickImage(file);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      // Create product — no barcode sent → backend auto-generates INT-XXXXX
      const { data } = await api.post('/api/products', {
        name:                form.name.trim(),
        base_cost_price:     Number(form.base_cost_price),
        mrp:                 Number(form.mrp),
        sale_price:          form.sale_price ? Number(form.sale_price) : Number(form.mrp),
        unit_name:           form.unit_name.trim() || 'piece',
        vat_category:        form.vat_category,
        custom_vat_rate:     form.custom_vat_rate !== '' ? Number(form.custom_vat_rate) : null,
        low_stock_alert_qty: Number(form.low_stock_alert_qty),
        // No barcode field — triggers auto-generate path on server
      });

      const productId = data.id;
      const generatedCode = data.barcode; // INT-XXXXX returned by server

      // Upload image if provided
      if (imageFile && productId) {
        const fd = new FormData();
        fd.append('image', imageFile);
        await api.post(`/api/products/${productId}/image`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      setCreated({ id: productId, name: data.name, code: generatedCode });
    } catch (err: any) {
      devError('[products/new]', err);
      setError(getErrorMessage(err));
    } finally { setSaving(false); }
  }

  // ── Success screen ───────────────────────────────────────────────────────
  if (created) {
    return (
      <AppShell>
        <div className="max-w-lg mx-auto space-y-6 font-sans">
          <Card className="p-8 text-center border-green-200 bg-green-50/30">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="text-green-600" size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-1">Product Created</h2>
            <p className="text-sm text-gray-500 mb-4">{created.name}</p>

            {/* Internal code — shown prominently */}
            <div className="bg-white border-2 border-green-300 rounded-xl px-6 py-4 mb-6 inline-block">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Internal Code
              </p>
              <p className="text-2xl font-mono font-bold text-green-700">{created.code}</p>
              <p className="text-xs text-gray-400 mt-1">
                Type this code into the POS scan field to find this product
              </p>
            </div>

            <div className="flex gap-3 justify-center">
              <Button
                onClick={() => router.push('/products')}
                variant="outline"
                className="border-gray-300 text-gray-700"
              >
                Back to catalog
              </Button>
              <Button
                onClick={() => router.push(`/products/${created.id}`)}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                Edit product
              </Button>
              <Button
                onClick={() => {
                  setCreated(null);
                  setForm({ name:'', base_cost_price:'', mrp:'', sale_price:'',
                    unit_name:'piece', vat_category:'TAXABLE_13',
                    custom_vat_rate:'', low_stock_alert_qty:'10' });
                  setImageFile(null); setImagePreview(null);
                }}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                Add another
              </Button>
            </div>
          </Card>
        </div>
      </AppShell>
    );
  }

  // ── Create form ──────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6 font-sans">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <Link href="/products" className="hover:text-gray-600">Products</Link>
          <ChevronRight size={12} />
          <span className="text-gray-600">Add Product</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Package className="text-blue-600" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800">New Product</h1>
              <p className="text-xs text-gray-400 mt-0.5">
                No barcode? An internal code (INT-XXXXX) will be auto-generated.
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Image drop zone */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Product image <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div
                ref={dropRef}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-gray-50/50'
                }`}
              >
                {imagePreview ? (
                  <div className="relative inline-block">
                    <img src={imagePreview} alt="Preview"
                         className="h-28 w-28 object-cover rounded-lg mx-auto" />
                    <button type="button"
                            onClick={e => { e.stopPropagation(); setImageFile(null); setImagePreview(null); }}
                            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center">
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <>
                    <ImageIcon className="mx-auto text-gray-300 mb-2" size={32} />
                    <p className="text-sm text-gray-500">Drag & drop or <span className="text-blue-600 font-semibold">browse</span></p>
                    <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP · max 5MB</p>
                  </>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                       onChange={e => { const f = e.target.files?.[0]; if (f) pickImage(f); }} />
              </div>
            </div>

            {/* Product name */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Product name <span className="text-red-500">*</span>
              </label>
              <input required value={form.name} onChange={set('name')}
                     placeholder="e.g. Wai Wai Noodles 75g"
                     className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
            </div>

            {/* Prices row */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Cost price (रू)', key: 'base_cost_price' as const, req: true },
                { label: 'MRP (रू)',        key: 'mrp'             as const, req: true, onChange: handleMrp },
                { label: 'Sale price (रू)', key: 'sale_price'      as const, req: false },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    {f.label} {f.req && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="number" min="0" step="0.01"
                    required={f.req}
                    value={form[f.key]}
                    onChange={f.onChange ?? set(f.key)}
                    placeholder="0.00"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>

            {/* Unit + low stock row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Unit name</label>
                <input value={form.unit_name} onChange={set('unit_name')} placeholder="piece"
                       className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Low stock alert</label>
                <input type="number" min="0" value={form.low_stock_alert_qty} onChange={set('low_stock_alert_qty')}
                       className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </div>
            </div>

            {/* VAT row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">VAT category</label>
                <select value={form.vat_category} onChange={set('vat_category')}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 bg-white">
                  {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Custom VAT % <span className="text-gray-400">(overrides category)</span>
                </label>
                <input type="number" min="0" max="100" step="0.01"
                       value={form.custom_vat_rate} onChange={set('custom_vat_rate')}
                       placeholder="Leave blank to use category rate"
                       className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </div>
            </div>

            {/* Internal code note */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              <strong>No barcode field</strong> — an internal code (e.g. INT-00042) will be auto-generated
              and assigned as this product's barcode. You can type it into the POS scan field.
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Link href="/products">
                <Button type="button" variant="outline" className="border-gray-300 text-gray-700">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" disabled={saving}
                      className="flex-1 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? <><Loader2 size={14} className="animate-spin mr-2" />Creating…</> : 'Create product'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
