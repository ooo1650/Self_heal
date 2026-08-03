'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ChevronRight, AlertTriangle, CheckCircle2, Loader2,
  TrendingDown, Package, SlidersHorizontal
} from 'lucide-react';

interface AdjustRow {
  product_id:       string;
  product_name:     string;
  location_id:      string;
  location_name:    string;
  stock_on_hand:    string;
  is_negative_stock:boolean;
  is_low_stock:     boolean;
  adjust_to:        string;
  notes:            string;
}

function AdjustContent() {
  const params       = useSearchParams();
  const filterPid    = params.get('product_id');
  const filterLid    = params.get('location_id');

  const [rows,    setRows]    = useState<AdjustRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [done,    setDone]    = useState<string[]>([]);  // product_id:location_id keys
  const [results, setResults] = useState<any[]>([]);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all inventory — filter to alerts + any specific product from query param
      const { data } = await api.get('/api/inventory');
      let inv = data.inventory ?? [];

      if (filterPid) {
        // If coming from a specific product, show that row even if stock is OK
        inv = inv.filter((r: any) => r.product_id === filterPid || r.is_negative_stock || r.is_low_stock);
      } else {
        inv = inv.filter((r: any) => r.is_negative_stock || r.is_low_stock);
      }

      setRows(inv.map((r: any) => ({
        ...r,
        adjust_to: '',
        notes: '',
      })));
    } finally { setLoading(false); }
  }, [filterPid]);

  useEffect(() => { load(); }, [load]);

  function updateRow(idx: number, field: 'adjust_to' | 'notes', val: string) {
    setRows(prev => { const n = [...prev]; n[idx] = { ...n[idx], [field]: val }; return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pending = rows.filter(r => r.adjust_to !== '');
    if (pending.length === 0) { setError('Enter at least one "Adjust to" value.'); return; }
    setSaving(true); setError('');
    try {
      const payload = pending.map(r => ({
        product_id:   r.product_id,
        location_id:  r.location_id,
        new_quantity: Number(r.adjust_to),
        notes:        r.notes || undefined,
      }));
      // Owner-only endpoint — always use owner token, never cashier token
      const ownerToken = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const { data } = await api.post('/api/inventory/adjust', payload,
        ownerToken ? { headers: { Authorization: `Bearer ${ownerToken}` } } : undefined
      );
      setResults(data.adjusted ?? []);
      setDone(prev => [...prev, ...pending.map(r => `${r.product_id}:${r.location_id}`)]);
      load();
    } catch (err: any) {
      devError('[inventory/adjust]', err);
      setError(getErrorMessage(err));
    } finally { setSaving(false); }
  }

  const adjKey = (r: AdjustRow) => `${r.product_id}:${r.location_id}`;

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl mx-auto font-sans">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <Link href="/inventory" className="hover:text-gray-600">Inventory</Link>
          <ChevronRight size={12} />
          <span className="text-gray-600">Adjust Stock</span>
        </div>

        {/* Header */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <SlidersHorizontal className="text-amber-600" size={18} />
            </div>
            <h2 className="text-xl font-bold text-gray-800">Stock Adjustment</h2>
          </div>
          <p className="text-sm text-gray-500 ml-12">
            Enter the physical count in "Adjust to". The system computes the delta automatically.
          </p>
        </div>

        {/* Results after submit */}
        {results.length > 0 && (
          <Card className="p-5 bg-green-50 border-green-200">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="text-green-600" size={18} />
              <h3 className="font-bold text-green-800 text-sm">Adjustments Applied</h3>
            </div>
            <div className="space-y-1.5">
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs text-green-700">
                  <span>{r.product_id.slice(0,8)}…</span>
                  <span className="font-mono">
                    {Number(r.old_stock).toFixed(2)} → {Number(r.new_stock).toFixed(2)}
                    {' '}<span className={`font-bold ${r.delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ({r.delta >= 0 ? '+' : ''}{Number(r.delta).toFixed(3)})
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Adjust form */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-blue-600" size={28} />
          </div>
        ) : rows.length === 0 ? (
          <Card className="p-12 text-center bg-white border-gray-200">
            <CheckCircle2 className="mx-auto text-green-500 mb-3" size={36} />
            <p className="font-semibold text-gray-700">No alerts to resolve</p>
            <p className="text-xs text-gray-400 mt-1">All products are at healthy stock levels.</p>
          </Card>
        ) : (
          <form onSubmit={handleSubmit}>
            <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-2 px-5 py-2.5 bg-gray-50 border-b border-gray-200
                              text-xs font-bold text-gray-500 uppercase tracking-wider">
                <span className="col-span-3">Product</span>
                <span className="col-span-2">Branch</span>
                <span className="col-span-1 text-right">Current</span>
                <span className="col-span-1 text-center">Status</span>
                <span className="col-span-2 text-center">Adjust to</span>
                <span className="col-span-3">Notes</span>
              </div>

              {rows.map((row, idx) => {
                const adjusted = done.includes(adjKey(row));
                const current  = Number(row.stock_on_hand);
                const target   = row.adjust_to !== '' ? Number(row.adjust_to) : null;
                const delta    = target !== null ? target - current : null;

                return (
                  <div key={adjKey(row)}
                       className={`grid grid-cols-12 gap-2 px-5 py-3 items-center border-b border-gray-100 last:border-0
                                   ${adjusted ? 'bg-green-50/40 opacity-60' : ''}`}>
                    <div className="col-span-3">
                      <p className="text-sm font-semibold text-gray-800 leading-tight">{row.product_name}</p>
                    </div>
                    <div className="col-span-2 text-xs text-gray-500">{row.location_name}</div>
                    <div className={`col-span-1 text-right text-sm font-bold ${
                      row.is_negative_stock ? 'text-red-600' : row.is_low_stock ? 'text-amber-600' : 'text-gray-700'
                    }`}>
                      {current.toFixed(2)}
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {row.is_negative_stock
                        ? <TrendingDown className="text-red-500" size={14} />
                        : <AlertTriangle className="text-amber-500" size={14} />}
                    </div>
                    <div className="col-span-2 flex flex-col gap-0.5">
                      {adjusted ? (
                        <span className="text-xs text-green-600 font-semibold text-center">✓ Done</span>
                      ) : (
                        <>
                          <input
                            type="number" step="0.001" min="0"
                            value={row.adjust_to}
                            onChange={e => updateRow(idx, 'adjust_to', e.target.value)}
                            placeholder={current.toFixed(2)}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center outline-none focus:border-blue-500"
                          />
                          {delta !== null && (
                            <span className={`text-[10px] text-center font-semibold ${delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {delta >= 0 ? '+' : ''}{delta.toFixed(3)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="col-span-3">
                      {!adjusted && (
                        <input
                          value={row.notes}
                          onChange={e => updateRow(idx, 'notes', e.target.value)}
                          placeholder="Reason (optional)"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </Card>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm mt-4">{error}</div>
            )}

            <div className="flex gap-3 mt-4">
              <Link href="/inventory">
                <Button type="button" variant="outline" className="border-gray-300 text-gray-700">
                  Back to Inventory
                </Button>
              </Link>
              <Button type="submit" disabled={saving || rows.every(r => !r.adjust_to)}
                      className="flex-1 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 gap-2">
                {saving ? <><Loader2 size={14} className="animate-spin" />Applying…</> : 'Apply adjustments'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}

export default function AdjustPage() {
  return <Suspense fallback={null}><AdjustContent /></Suspense>;
}
