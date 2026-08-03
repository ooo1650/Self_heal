'use client';
// components/RegisterProductModal.tsx
// Phase 13b updated — Path A: UNREGISTERED barcode flow from POS scan.
// The scanned barcode is displayed read-only at the top — it IS the barcode.
// On success: product created with this barcode, immediately added to cart.
// Images: drag-and-drop upload, optional. Never appear in the POS cart itself.

import { useState, useRef, useCallback } from 'react';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { X, ImageIcon, Package, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

const VAT_OPTIONS = [
  { value: 'TAXABLE_13',  label: 'Taxable — 13% VAT' },
  { value: 'EXEMPT',      label: 'Exempt — 0%' },
  { value: 'ZERO_RATED',  label: 'Zero-rated — 0%' },
  { value: 'NON_TAXABLE', label: 'Non-taxable' },
];

interface Props {
  barcode:  string;
  onAdded:  (product: any) => void;  // called with scan response → added to cart
  onCancel: () => void;
}

export default function RegisterProductModal({ barcode, onAdded, onCancel }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: '', cost_price: '', mrp: '', sale_price: '',
    unit_name: 'piece', vat_category: 'TAXABLE_13',
  });
  const [imageFile,    setImageFile]    = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [dragOver,     setDragOver]     = useState(false);
  const [working,      setWorking]      = useState(false);
  const [error,        setError]        = useState('');

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

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
    setImagePreview(URL.createObjectURL(file));
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickImage(file);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setWorking(true);
    try {
      // 1. Create product — include the scanned barcode explicitly (Path A)
      const { data: productData } = await api.post('/api/products', {
        name:          form.name.trim(),
        base_cost_price: Number(form.cost_price),
        mrp:           Number(form.mrp),
        sale_price:    form.sale_price ? Number(form.sale_price) : Number(form.mrp),
        unit_name:     form.unit_name.trim() || 'piece',
        vat_category:  form.vat_category,
        barcode:       barcode.trim(),   // the scanned code is used as the real barcode
      });

      const productId = productData.id;

      // 2. Upload image if provided
      if (imageFile && productId) {
        const fd = new FormData();
        fd.append('image', imageFile);
        await api.post(`/api/products/${productId}/image`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        }).catch(() => {}); // image upload failure doesn't block adding to cart
      }

      // 3. Re-scan to get enriched product data for cart
      const { data: scanData } = await api.post('/api/pos/scan', { barcode });
      if (scanData.status === 'FOUND') {
        onAdded(scanData.product);
      } else {
        setError('Product registered but scan still returned UNREGISTERED. Try scanning again.');
      }
    } catch (err: any) {
      devError('[RegisterProductModal/submit]', err);
      setError(getErrorMessage(err));
    } finally { setWorking(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
              <Package className="text-orange-500" size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-800">Register Product</h2>
              <p className="text-xs text-gray-400">Unregistered barcode scanned</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Scanned barcode — read-only */}
        <div className="mx-5 mt-4 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider shrink-0">Barcode</span>
          <span className="font-mono text-sm font-bold text-gray-700">{barcode}</span>
          <span className="ml-auto text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-semibold">
            UNREGISTERED
          </span>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Product name <span className="text-red-500">*</span>
            </label>
            <input required autoFocus value={form.name} onChange={set('name')}
                   placeholder="e.g. Wai Wai Noodles 75g"
                   className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
          </div>

          {/* Prices */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label:'Cost price *', key:'cost_price', req:true, onChange: undefined },
              { label:'MRP *',        key:'mrp',        req:true, onChange: handleMrp },
              { label:'Sale price',   key:'sale_price', req:false, onChange: undefined },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                <input type="number" min="0" step="0.01" required={f.req}
                       value={(form as any)[f.key]}
                       onChange={f.onChange ?? set(f.key)}
                       placeholder="0.00"
                       className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
            ))}
          </div>

          {/* Unit + VAT */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Unit name</label>
              <input value={form.unit_name} onChange={set('unit_name')} placeholder="piece"
                     className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">VAT category</label>
              <select value={form.vat_category} onChange={set('vat_category')}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm bg-white outline-none focus:border-blue-500">
                {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Image upload (optional, drag-and-drop) */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Image <span className="text-gray-400 font-normal">(optional — not shown in cart)</span>
            </label>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-gray-50/50'
              }`}
            >
              {imagePreview ? (
                <div className="relative inline-block">
                  <img src={imagePreview} alt="Preview"
                       className="h-20 w-20 object-cover rounded-lg mx-auto" />
                  <button type="button"
                          onClick={e => { e.stopPropagation(); setImageFile(null); setImagePreview(null); }}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center">
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <>
                  <ImageIcon className="mx-auto text-gray-300 mb-1" size={24} />
                  <p className="text-xs text-gray-400">Drag & drop or click to upload</p>
                </>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                     onChange={e => { const f = e.target.files?.[0]; if (f) pickImage(f); }} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onCancel}
                    className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={working}
                    className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {working ? <><Loader2 size={14} className="animate-spin" />Saving…</> : 'Add to cart'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
