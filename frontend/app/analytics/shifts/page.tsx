'use client';
import React, { useState, useEffect, useCallback } from 'react';
import AnalyticsShell, { Badge, EmptyState, LoadingState, defaultRange } from '@/components/AnalyticsShell';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

const fmtTime = (s:string) => new Date(s).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});

export default function ShiftsAnalytics() {
  const [rows,    setRows]    = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await api.get('/api/shifts?limit=100');
    setRows(data.shifts??[]); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <AnalyticsShell title="Shift Reports" breadcrumb="Shifts" onApply={() => load()} showDatePicker={false}>
      {loading ? <LoadingState /> : rows.length===0 ? <EmptyState message="No shifts found" /> : (
        <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Cashier','Branch','Opened','Closed','Status','Opening','Closing','Expected','Diff'].map(h=>(
                  <th key={h} className="py-3 px-3 text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((s,i) => {
                const diff    = s.cash_difference!=null ? Number(s.cash_difference) : null;
                const exp     = s.expected_cash ? Number(s.expected_cash) : 0;
                const variance= diff!=null && exp>0 && Math.abs(diff) > exp*0.05;
                return (
                  <tr key={i} className={`hover:bg-gray-50/50 ${variance?'bg-amber-50/30':''}`}>
                    <td className="py-2.5 px-3 font-semibold text-gray-800 text-xs">{s.cashier_name}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">{s.location_code}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">{fmtTime(s.opened_at)}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">{s.closed_at?fmtTime(s.closed_at):'—'}</td>
                    <td className="py-2.5 px-3">
                      <Badge label={s.status} color={s.status==='open'?'green':'gray'} />
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">रू {Number(s.opening_cash_balance).toFixed(0)}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">
                      {s.closing_cash_balance!=null?`रू ${Number(s.closing_cash_balance).toFixed(0)}`:'—'}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">
                      {s.expected_cash!=null?`रू ${Number(s.expected_cash).toFixed(0)}`:'—'}
                    </td>
                    <td className="py-2.5 px-3 text-xs font-semibold"
                        style={{color:diff==null?'#9ca3af':diff>=0?'#16a34a':'#dc2626'}}>
                      {diff==null?'—':`${diff>=0?'+':''}रू ${diff.toFixed(0)}`}
                      {variance && ' ⚠'}
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
