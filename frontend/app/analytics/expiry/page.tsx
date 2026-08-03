'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { EmptyState, LoadingState, defaultRange } from '@/components/AnalyticsShell';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

export default function ExpiryTracker() {
  const [rows,    setRows]    = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [days,    setDays]    = useState('30');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await api.get(`/api/analytics/expiry?days=${days}`);
    setRows(data.expiring??[]); setLoaded(true); setLoading(false);
  }, [days]);

  return (
    <AnalyticsShell title="Expiry Tracker" breadcrumb="Expiry" onApply={load} showDatePicker={false}
      headerActions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Expiring within</span>
          <select value={days} onChange={e=>setDays(e.target.value)}
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white outline-none">
            {['7','14','30','60','90'].map(n=><option key={n} value={n}>{n} days</option>)}
          </select>
        </div>
      }>
      {loading ? <LoadingState /> : !loaded ? (
        <div className="text-center py-8 text-sm text-gray-400">Click Apply to load data.</div>
      ) : rows.length===0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center text-sm font-semibold text-green-700">
          ✓ No products expiring within {days} days
        </div>
      ) : (
        <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Product','Expiry Date','Days Until Expiry','Stock on Hand'].map(h=>(
                  <th key={h} className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r,i) => {
                const d       = Number(r.days_until_expiry);
                const expired = d < 0;
                const urgent  = !expired && d <= 7;
                return (
                  <tr key={i} className={`hover:bg-gray-50/50 ${expired?'bg-red-50/40':urgent?'bg-amber-50/30':''}`}>
                    <td className="py-3 px-4 font-semibold text-gray-800">{r.name}</td>
                    <td className="py-3 px-4 text-xs text-gray-600 font-mono">{r.expiry_date}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs font-bold ${expired?'text-red-600':urgent?'text-amber-600':'text-gray-500'}`}>
                        {expired ? `Expired ${Math.abs(d)} day${Math.abs(d)!==1?'s':''} ago` : `${d} day${d!==1?'s':''}`}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-700">{Number(r.stock_on_hand).toFixed(0)}</td>
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
