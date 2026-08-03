'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AnalyticsShell, { Badge, EmptyState, LoadingState, defaultRange } from '@/components/AnalyticsShell';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Info } from 'lucide-react';

export default function StockAlerts() {
  const [rows,    setRows]    = useState<any[]>([]);
  const [note,    setNote]    = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await api.get('/api/analytics/stock-alerts');
    setRows(data.alerts??[]); setNote(data.matview_note??''); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const negCount = rows.filter(r=>r.is_negative_stock).length;
  const lowCount = rows.filter(r=>!r.is_negative_stock&&r.is_low_stock).length;

  return (
    <AnalyticsShell title="Stock Alerts" breadcrumb="Stock Alerts" onApply={load} showDatePicker={false}>
      {/* Matview info banner */}
      {note && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>{note}</span>
        </div>
      )}

      {/* Summary */}
      {!loading && (
        <div className="flex gap-3">
          <div className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 flex items-center gap-2">
            <span className="text-2xl font-bold text-red-600">{negCount}</span>
            <span className="text-xs font-semibold text-red-600">Negative stock</span>
          </div>
          <div className="px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 flex items-center gap-2">
            <span className="text-2xl font-bold text-amber-600">{lowCount}</span>
            <span className="text-xs font-semibold text-amber-600">Low stock</span>
          </div>
        </div>
      )}

      {loading ? <LoadingState /> : rows.length===0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center text-sm font-semibold text-green-700">
          ✓ No stock alerts — all products at healthy levels
        </div>
      ) : (
        <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Product','Branch','On Hand','Alert Qty','Status','Action'].map(h=>(
                  <th key={h} className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r,i) => (
                <tr key={i} className={`hover:bg-gray-50/50 ${r.is_negative_stock?'bg-red-50/30':'bg-amber-50/20'}`}>
                  <td className="py-3 px-4 font-semibold text-gray-800">{r.product_name}</td>
                  <td className="py-3 px-4 text-xs text-gray-500">
                    {r.location_name} <span className="text-gray-300">({r.location_code})</span>
                  </td>
                  <td className="py-3 px-4 font-bold" style={{color:r.is_negative_stock?'#dc2626':'#d97706'}}>
                    {Number(r.stock_on_hand).toFixed(3)}
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-400">{Number(r.low_stock_alert_qty).toFixed(0)}</td>
                  <td className="py-3 px-4">
                    <Badge
                      label={r.is_negative_stock?'Negative':'Low'}
                      color={r.is_negative_stock?'red':'amber'}
                    />
                  </td>
                  <td className="py-3 px-4">
                    <Link
                      href={`/inventory/adjust?product_id=${r.product_id}&location_id=${r.location_id}`}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                      Adjust →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </AnalyticsShell>
  );
}
