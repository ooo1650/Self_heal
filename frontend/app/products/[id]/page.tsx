'use client';
// /products/[id] — edit product: fields, image, barcode management

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ChevronRight, Package, Upload, X, CheckCircle2,
  AlertCircle, Loader2, Plus, Trash2, ImageIcon, Barcode
} from 'lucide-react';

const VAT_OPTIONS = [
  { value: 'TAXABLE_13',  label: 'Taxable — 13% VAT' },
  { value: 'EXEMPT',      label: 'Exempt — 0%' },
  { value: 'ZERO_RATED',  label: 'Zero-rated — 0%' },
  { value: 'NON_TAXABLE', label: 'Non-taxable' },
];

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface BarcodeRow {
  barcode: string;
  unit_name: string;
  conversion_factor: string;
  sale_price: string;
  is_active: boolean;
}

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: '', base_cost_price: '', mrp: '', vat_category: 'TAXABLE_13',
    custom_vat_rate: '', low_stock_alert_qty: '10',
  });
  const [barcodes,    setBarcodes]    = useState<BarcodeRow[]>([]);
  const [imageUrl,    setImageUrl]    = useState<string | null>(null);
  const [imageFile,   setImageFile]   = useState<File | null>(null);
  const [imagePreview,setImagePreview]= useState<string | null>(null);
  const [dragOver,    setDragOver]    = useState(false);

  // Add-barcode form
  const [newBc, setNewBc] = useState({ barcode:'', unit_name:'piece', conversion_factor:'1', sale_price:'' });

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [imgSaving,setImgSaving]= useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/api/products/${id}`);
      setForm({
        name:                data.name,
        base_cost_price:     String(data.base_cost_price),
        mrp:                 String(data.mrp),
        vat_category:        data.vat_category,
        custom_vat_rate:     data.custom_vat_rate != null ? String(data.custom_vat_rate) : '',
        low_stock_alert_qty: String(data.low_stock_alert_qty),
      });
      setBarcodes(data.barcodes ?? []);
      setImageUrl(data.image_url ?? null);
    } catch { setError('Failed to load product.'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess(''); setSaving(true);
    try {
      await api.put(`/api/products/${id}`, {
        name:                form.name.trim(),
        base_cost_price:     Number(form.base_cost_price),
        mrp:                 Number(form.mrp),
        vat_category:        form.vat_category,
        custom_vat_rate:     form.custom_vat_rate !== '' ? Number(form.custom_vat_rate) : null,
        low_stock_alert_qty: Number(form.low_stock_alert_qty),
      });

      // Upload image if new one selected
      if (imageFile) {
        setImgSaving(true);
        const fd = new FormData();
        fd.append('image', imageFile);
        const { data: imgData } = await api.post(`/api/products/${id}/image`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setImageUrl(imgData.image_url);
        setImageFile(null);
        setImagePreview(null);
        setImgSaving(false);
      }

      setSuccess('Product saved successfully.');
      load();
    } catch (err: any) {
      devError('[products/edit/save]', err);
      setError(getErrorMessage(err));
    } finally { setSaving(false); }
  }

  async function handleAddBarcode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/api/products/${id}/barcodes`, {
        barcode:           newBc.barcode.trim(),
        unit_name:         newBc.unit_name.trim() || 'piece',
        conversion_factor: Number(newBc.conversion_factor),
        sale_price:        Number(newBc.sale_price),
      });
      setNewBc({ barcode:'', unit_name:'piece', conversion_factor:'1', sale_price:'' });
      load();
    } catch (err: any) {
      devError('[products/edit/add-barcode]', err);
      setError(getErrorMessage(err));
    }
  }

  async function handleDeactivateBarcode(barcode: string) {
    if (!confirm(`Deactivate barcode "${barcode}"?`)) return;
    await api.delete(`/api/products/barcodes/${barcode}`);
    load();
  }

  async function handleRemoveImage() {
    if (!confirm('Remove the current image?')) return;
    await api.patch(`/api/products/${id}`, { image_url: null });
    setImageUrl(null);
  }

  function pickImage(file: File) {
    if (!file.type.startsWith('image/')) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  const isInternal = (bc: string) => bc.startsWith('INT-');

  if (loading) return (
    <AppShell>
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-blue-600" size={28} />
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6 font-sans pb-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <Link href="/products" className="hover:text-gray-600">Products</Link>
          <ChevronRight size={12} />
          <span className="text-gray-600 truncate max-w-xs">{form.name || 'Edit Product'}</span>
        </div>

        {/* Main form card */}
        <Card className="p-6 bg-white border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Package className="text-blue-600" size={18} />
            </div>
            <h1 className="text-lg font-bold text-gray-800">Edit Product</h1>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">
              <CheckCircle2 size={15} />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-5">
            {/* Image */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Product image</label>
              <div className="flex items-start gap-4">
                {/* Current or preview */}
                <div className="h-24 w-24 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center shrink-0">
                  {imagePreview ? (
                    <img src={imagePreview} alt="Preview" className="h-full w-full object-cover" />
                  ) : imageUrl ? (
                    <img src={`${BASE_URL}${imageUrl}`} alt="Current" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon className="text-gray-300" size={28} />
                  )}
                </div>
                <div className="flex flex-col gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm"
                          onClick={() => fileRef.current?.click()}
                          className="text-xs border-gray-300 text-gray-700 gap-1.5">
                    <Upload size={12} /> {imageUrl || imagePreview ? 'Replace image' : 'Upload image'}
                  </Button>
                  {(imageUrl || imagePreview) && (
                    <Button type="button" variant="outline" size="sm"
                            onClick={() => { setImageFile(null); setImagePreview(null); if (imageUrl) handleRemoveImage(); }}
                            className="text-xs border-red-200 text-red-600 gap-1.5">
                      <X size={12} /> Remove
                    </Button>
                  )}
                  <p className="text-xs text-gray-400">JPG, PNG, WEBP · max 5MB</p>
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                     onChange={e => { const f = e.target.files?.[0]; if (f) pickImage(f); }} />
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Product name <span className="text-red-500">*</span>
              </label>
              <input required value={form.name} onChange={set('name')}
                     className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
            </div>

            {/* Prices */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { label:'Cost price (रू)', key:'base_cost_price', req:true },
                { label:'MRP (रू)',        key:'mrp',             req:true },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    {f.label} {f.req && <span className="text-red-500">*</span>}
                  </label>
                  <input type="number" min="0" step="0.01" required={f.req}
                         value={(form as any)[f.key]} onChange={set(f.key)}
                         className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                </div>
              ))}
            </div>

            {/* VAT + low stock */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">VAT category</label>
                <select value={form.vat_category} onChange={set('vat_category')}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:border-blue-500">
                  {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Custom VAT %</label>
                <input type="number" min="0" max="100" step="0.01"
                       value={form.custom_vat_rate} onChange={set('custom_vat_rate')}
                       placeholder="Leave blank"
                       className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Low stock alert qty</label>
              <input type="number" min="0" value={form.low_stock_alert_qty} onChange={set('low_stock_alert_qty')}
                     className="w-40 border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </div>

            <div className="flex gap-3 pt-1">
              <Link href="/products">
                <Button type="button" variant="outline" className="border-gray-300 text-gray-700">Cancel</Button>
              </Link>
              <Button type="submit" disabled={saving || imgSaving}
                      className="flex-1 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {saving || imgSaving
                  ? <><Loader2 size={14} className="animate-spin mr-2" />Saving…</>
                  : 'Save changes'}
              </Button>
            </div>
          </form>
        </Card>

        {/* Barcode management card */}
        <Card className="p-6 bg-white border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Barcode className="text-gray-500" size={18} />
            <h2 className="text-base font-bold text-gray-800">Barcodes & Variants</h2>
          </div>

          {/* Existing barcodes */}
          <div className="space-y-2 mb-5">
            {barcodes.length === 0 && (
              <p className="text-sm text-gray-400">No barcodes yet.</p>
            )}
            {barcodes.map(bc => (
              <div key={bc.barcode}
                   className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
                     bc.is_active ? 'border-gray-200 bg-gray-50/50' : 'border-gray-100 bg-gray-50 opacity-50'
                   }`}>
                <div className="flex items-center gap-3">
                  <span className={`font-mono text-sm font-bold ${
                    isInternal(bc.barcode) ? 'text-blue-600' : 'text-gray-700'
                  }`}>
                    {bc.barcode}
                    {isInternal(bc.barcode) && (
                      <span className="ml-2 text-[10px] font-normal text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded">auto-generated</span>
                    )}
                  </span>
                  <span className="text-xs text-gray-400">
                    {bc.unit_name} · CF {bc.conversion_factor} · रू {Number(bc.sale_price).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!bc.is_active && <span className="text-xs text-gray-400">Inactive</span>}
                  {bc.is_active && (
                    <button onClick={() => handleDeactivateBarcode(bc.barcode)}
                            className="text-red-400 hover:text-red-600 transition-colors p-1 rounded">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add barcode form */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">
              Add barcode variant (loose unit, carton, etc.)
            </p>
            <form onSubmit={handleAddBarcode} className="grid grid-cols-2 gap-3">
              <input required value={newBc.barcode} onChange={e => setNewBc(b=>({...b,barcode:e.target.value}))}
                     placeholder="Barcode *"
                     className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
              <input value={newBc.unit_name} onChange={e => setNewBc(b=>({...b,unit_name:e.target.value}))}
                     placeholder="Unit name (piece)"
                     className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
              <input type="number" min="0.001" step="0.001" required
                     value={newBc.conversion_factor} onChange={e => setNewBc(b=>({...b,conversion_factor:e.target.value}))}
                     placeholder="Conversion factor (1)"
                     className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
              <input type="number" min="0" step="0.01" required
                     value={newBc.sale_price} onChange={e => setNewBc(b=>({...b,sale_price:e.target.value}))}
                     placeholder="Sale price (रू) *"
                     className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
              <Button type="submit"
                      className="col-span-2 bg-gray-800 text-white hover:bg-gray-900 gap-1.5 text-sm">
                <Plus size={14} /> Add barcode variant
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
