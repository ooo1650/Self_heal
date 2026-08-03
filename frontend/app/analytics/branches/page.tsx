'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { EmptyState, LoadingState, defaultRange, DateRange } from '@/components/AnalyticsShell';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

const fmt = (n:number) => `रू ${Number(n).toLocaleString('en-IN',{minimumFractionDigits:2})}`;

export default function BranchesAnalytics() {
  const [rows,    setRows]    = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const load = useCallback(async (range: DateRange = defaultRange()) => {
    setLoading(true);
    const { data } = await api.get(`/api/analytics/branches?start_date=${range.start}&end_date=${range.end}`);
    setRows(data.branches??[]); setLoaded(true); setLoading(false);
  }, []);

  return (
    <AnalyticsShell title="Branch Comparison" breadcrumb="Branches" onApply={load}>
      {loading ? <LoadingState /> : !loaded ? (
        <div className="text-center py-8 text-sm text-gray-400">Select a date range and click Apply.</div>
      ) : rows.length===0 ? <EmptyState message="No branch data" /> : (
        <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Branch','Code','Main','Transactions','Revenue','COGS','Gross Profit'].map(h=>(
                  <th key={h} className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r,i) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="py-3 px-4 font-semibold text-gray-800">{r.location_name}</td>
                  <td className="py-3 px-4 font-mono text-xs text-blue-600">{r.location_code}</td>
                  <td className="py-3 px-4 text-xs text-amber-500 font-bold">{r.is_main_branch?'★':''}</td>
                  <td className="py-3 px-4 text-gray-700">{r.transaction_count}</td>
                  <td className="py-3 px-4 font-bold text-blue-700">{fmt(r.total_revenue)}</td>
                  <td className="py-3 px-4 text-gray-500">{fmt(r.total_cogs)}</td>
                  <td className={`py-3 px-4 font-bold ${Number(r.gross_profit)>=0?'text-green-700':'text-red-600'}`}>
                    {fmt(r.gross_profit)}
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
