'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { EmptyState, LoadingState, defaultRange } from '@/components/AnalyticsShell';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

export default function SlowStock() {
  const [rows,    setRows]    = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [days,    setDays]    = useState('60');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await api.get(`/api/analytics/slow-moving?days=${days}`);
    setRows(data.slow_moving??[]); setLoaded(true); setLoading(false);
  }, [days]);

  return (
    <AnalyticsShell title="Slow-Moving Stock" breadcrumb="Slow Stock" onApply={load} showDatePicker={false}
      headerActions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">No sales in</span>
          <select value={days} onChange={e=>setDays(e.target.value)}
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white outline-none">
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
      }>
      {loading ? <LoadingState /> : !loaded ? (
        <div className="text-center py-8 text-sm text-gray-400">Click Apply to load data.</div>
      ) : rows.length===0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center text-sm font-semibold text-green-700">
          ✓ No slow-moving products in the last {days} days
        </div>
      ) : (
        <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Product','MRP','Stock on Hand','Alert Qty','Last Sold'].map(h=>(
                  <th key={h} className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r,i) => {
                const neverSold = r.days_since_last_sale==null;
                return (
                  <tr key={i} className={`hover:bg-gray-50/50 ${neverSold?'bg-red-50/30':''}`}>
                    <td className="py-3 px-4 font-semibold text-gray-800">{r.name}</td>
                    <td className="py-3 px-4 text-xs text-gray-500">रू {Number(r.mrp).toFixed(2)}</td>
                    <td className="py-3 px-4 font-medium text-gray-700">{Number(r.stock_on_hand).toFixed(0)}</td>
                    <td className="py-3 px-4 text-xs text-gray-400">{Number(r.low_stock_alert_qty).toFixed(0)}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs font-semibold ${neverSold?'text-red-600':'text-amber-600'}`}>
                        {neverSold ? 'Never sold' : `${r.days_since_last_sale} days ago`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </AnalyticsShell>
  );
}
