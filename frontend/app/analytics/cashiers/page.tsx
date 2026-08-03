'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { Badge, EmptyState, LoadingState, defaultRange, DateRange } from '@/components/AnalyticsShell';
import { CashierChart } from '@/components/Charts';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

export default function CashierPerformance() {
  const [rows,    setRows]    = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const load = useCallback(async (range: DateRange = defaultRange()) => {
    setLoading(true);
    const { data } = await api.get(`/api/analytics/cashier-performance?start_date=${range.start}&end_date=${range.end}`);
    setRows(data.cashiers ?? []); setLoaded(true); setLoading(false);
  }, []);

  return (
    <AnalyticsShell title="Cashier Performance" breadcrumb="Cashiers" onApply={load}>
      {loading ? <LoadingState /> : !loaded ? (
        <div className="text-center py-8 text-sm text-gray-400">Select a date range and click Apply.</div>
      ) : rows.length === 0 ? <EmptyState message="No sales data for this period" /> : (
        <div className="space-y-4">
          {/* Recharts bar chart */}
          <Card className="bg-white border-gray-200 shadow-sm p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
              Revenue & Invoices by Cashier
            </p>
            <CashierChart data={rows} height={220} />
          </Card>

          {/* Detail table */}
          <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Cashier','Role','Branch','Invoices','Revenue','Avg Txn','Returns','Return %'].map(h => (
                    <th key={h} className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const highReturn = Number(r.return_rate_pct) > 20;
                  return (
                    <tr key={i} className={`hover:bg-gray-50/50 ${highReturn ? 'bg-amber-50/30' : ''}`}>
                      <td className="py-3 px-4 font-semibold text-gray-800">{r.full_name}</td>
                      <td className="py-3 px-4"><Badge label={r.role} color={r.role === 'owner' ? 'blue' : 'gray'} /></td>
                      <td className="py-3 px-4 text-xs text-gray-500">{r.location_name}</td>
                      <td className="py-3 px-4 font-medium text-gray-700">{r.invoice_count}</td>
                      <td className="py-3 px-4 font-bold text-blue-700">रू {Number(r.total_revenue).toFixed(2)}</td>
                      <td className="py-3 px-4 text-xs text-gray-500">रू {Number(r.avg_transaction_value).toFixed(2)}</td>
                      <td className="py-3 px-4 text-gray-600">{r.return_count}</td>
                      <td className="py-3 px-4">
                        {r.return_rate_pct != null
                          ? <Badge label={`${r.return_rate_pct}%`} color={highReturn ? 'amber' : 'green'} />
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </AnalyticsShell>
  );
}
