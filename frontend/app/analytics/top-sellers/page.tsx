'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { EmptyState, LoadingState, defaultRange, DateRange } from '@/components/AnalyticsShell';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

export default function TopSellers() {
  const [data,    setData]    = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [limit,   setLimit]   = useState('10');

  const load = useCallback(async (range: DateRange = defaultRange()) => {
    setLoading(true);
    const { data: d } = await api.get(`/api/analytics/top-sellers?start_date=${range.start}&end_date=${range.end}&limit=${limit}`);
    setData(d); setLoading(false);
  }, [limit]);

  function RankTable({ rows, valueKey, label }: { rows:any[]; valueKey:string; label:string }) {
    return (
      <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider">{label}</h3>
        </div>
        {rows.length===0 ? <div className="p-8 text-center text-xs text-gray-400">No data</div> : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {rows.map((r,i) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="py-3 px-4 w-10">
                    <span className={`text-xs font-bold ${i===0?'text-yellow-500':i===1?'text-gray-500':i===2?'text-orange-400':'text-gray-300'}`}>
                      #{i+1}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-medium text-gray-800">{r.name}</td>
                  <td className="py-3 px-4 text-right font-bold text-blue-700">
                    {valueKey==='total_qty' ? Number(r.total_qty).toFixed(0) : `रू ${Number(r.total_revenue).toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    );
  }

  return (
    <AnalyticsShell title="Top Sellers" breadcrumb="Top Sellers" onApply={load}
      headerActions={
        <select value={limit} onChange={e=>{setLimit(e.target.value);}}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-700 outline-none">
          {['10','25','50'].map(n=><option key={n} value={n}>Top {n}</option>)}
        </select>
      }>
      {loading ? <LoadingState /> : !data ? (
        <div className="text-center py-8 text-sm text-gray-400">Select a date range and click Apply.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RankTable rows={data.by_quantity??[]} valueKey="total_qty"     label="By Quantity Sold" />
          <RankTable rows={data.by_revenue??[]}  valueKey="total_revenue" label="By Revenue"       />
        </div>
      )}
    </AnalyticsShell>
  );
}
