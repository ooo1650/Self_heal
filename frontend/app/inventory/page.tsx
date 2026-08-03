'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Package, Search, ChevronRight, AlertTriangle,
  TrendingDown, CheckCircle, Loader2, SlidersHorizontal
} from 'lucide-react';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface StockRow {
  product_id:        string;
  product_name:      string;
  location_id:       string;
  location_name:     string;
  location_code:     string;
  stock_on_hand:     string;
  low_stock_alert_qty: string;
  is_low_stock:      boolean;
  is_negative_stock: boolean;
  image_url?:        string | null;
}

interface Location { id: string; name: string; }

function StockBadge({ row }: { row: StockRow }) {
  const qty = Number(row.stock_on_hand);
  if (row.is_negative_stock) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
      <TrendingDown size={9} /> NEGATIVE ({qty.toFixed(3)})
    </span>
  );
  if (row.is_low_stock) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
      <AlertTriangle size={9} /> LOW ({qty.toFixed(0)})
    </span>
  );
  if (qty <= 0) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-100">
      OUT OF STOCK
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">
      <CheckCircle size={9} /> IN STOCK ({qty.toFixed(0)})
    </span>
  );
}

export default function InventoryPage() {
  const [rows,      setRows]      = useState<StockRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locFilter, setLocFilter] = useState('');
  const [search,    setSearch]    = useState('');
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (locFilter) params.set('location_id', locFilter);
      const { data } = await api.get(`/api/inventory?${params}`);
      const inv: StockRow[] = data.inventory ?? [];
      setRows(inv);
      // Extract unique locations
      const seen = new Map<string,string>();
      inv.forEach(r => { if (!seen.has(r.location_id)) seen.set(r.location_id, r.location_name); });
      setLocations([...seen.entries()].map(([id,name]) => ({ id, name })));
    } catch (err) { devError('[inventory/load]', err); setError('Failed to load inventory.'); }
    finally { setLoading(false); }
  }, [locFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    !search || r.product_name.toLowerCase().includes(search.toLowerCase())
  );

  const alertCount = rows.filter(r => r.is_negative_stock || r.is_low_stock).length;

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl mx-auto font-sans">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <span>Inventory</span><ChevronRight size={12} /><span className="text-gray-600">Stock</span>
        </div>

        {/* Header */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Inventory</h2>
            <p className="text-sm text-gray-500 mt-1">Stock on hand across all locations.</p>
          </div>
          <div className="flex gap-3">
            {alertCount > 0 && (
              <Link href="/inventory/adjust">
                <Button className="bg-amber-500 hover:bg-amber-600 text-white gap-2 text-sm">
                  <AlertTriangle size={14} /> {alertCount} alert{alertCount !== 1 ? 's' : ''} — Adjust
                </Button>
              </Link>
            )}
            <Link href="/inventory/adjust">
              <Button variant="outline" className="border-gray-300 text-gray-700 gap-2 text-sm">
                <SlidersHorizontal size={14} /> Adjust Stock
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 text-gray-400" size={15} />
            <input value={search} onChange={e => setSearch(e.target.value)}
                   placeholder="Search product name…"
                   className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-4 py-2.5 focus:border-blue-500 outline-none" />
          </div>
          {locations.length > 1 && (
            <select value={locFilter} onChange={e => setLocFilter(e.target.value)}
                    className="text-xs border border-gray-300 rounded-lg p-2.5 bg-white font-medium text-gray-700 focus:border-blue-500 outline-none">
              <option value="">All branches</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="animate-spin text-blue-600 h-8 w-8 mb-2" />
            <p className="text-sm font-semibold text-gray-500">Loading inventory…</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
        ) : (
          <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
            {filtered.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="mx-auto text-gray-300 mb-3" size={40} />
                <p className="font-semibold text-gray-600">No stock records found</p>
                <p className="text-xs text-gray-400 mt-1">Add opening stock via the inventory adjust screen.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                      <th className="py-3 px-5 w-14 text-center">Image</th>
                      <th className="py-3 px-5">Product</th>
                      <th className="py-3 px-5">Branch</th>
                      <th className="py-3 px-5 text-right">On Hand</th>
                      <th className="py-3 px-5 text-right">Alert Qty</th>
                      <th className="py-3 px-5">Status</th>
                      <th className="py-3 px-5 text-center w-24">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((r, i) => (
                      <tr key={i}
                          className={`hover:bg-gray-50/50 transition-colors ${
                            r.is_negative_stock ? 'bg-red-50/30' : r.is_low_stock ? 'bg-amber-50/20' : ''
                          }`}>
                        <td className="py-3 px-5 text-center">
                          <div className="h-9 w-9 mx-auto rounded-lg bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center">
                            {r.image_url
                              ? <img src={`${BASE}${r.image_url}`} alt={r.product_name} className="h-full w-full object-cover" />
                              : <Package className="text-gray-300" size={14} />}
                          </div>
                        </td>
                        <td className="py-3 px-5">
                          <Link href={`/products/${r.product_id}`}
                                className="font-semibold text-gray-800 hover:text-blue-600 transition-colors">
                            {r.product_name}
                          </Link>
                        </td>
                        <td className="py-3 px-5 text-xs text-gray-500">
                          {r.location_name} <span className="text-gray-300">({r.location_code})</span>
                        </td>
                        <td className="py-3 px-5 text-right font-bold text-gray-800">
                          {Number(r.stock_on_hand).toFixed(3)}
                        </td>
                        <td className="py-3 px-5 text-right text-xs text-gray-400">
                          {Number(r.low_stock_alert_qty).toFixed(0)}
                        </td>
                        <td className="py-3 px-5"><StockBadge row={r} /></td>
                        <td className="py-3 px-5 text-center">
                          <Link href={`/inventory/adjust?product_id=${r.product_id}&location_id=${r.location_id}`}>
                            <Button variant="outline" size="sm"
                                    className="text-xs h-7 px-2 border-gray-300 text-gray-700 hover:bg-gray-50">
                              Adjust
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
