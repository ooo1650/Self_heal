'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { SortTh, EmptyState, LoadingState, defaultRange, DateRange } from '@/components/AnalyticsShell';
import { TopProductsBar } from '@/components/Charts';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

const fmt = (n: number) => `रू ${Number(n).toLocaleString('en-IN',{minimumFractionDigits:2})}`;

export default function ProductROI() {
  const [rows,    setRows]    = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [sortKey, setSortKey] = useState('gross_profit');
  const [sortAsc, setSortAsc] = useState(false);

  const load = useCallback(async (range: DateRange = defaultRange()) => {
    setLoading(true);
    const { data } = await api.get(`/api/analytics/product-roi?start_date=${range.start}&end_date=${range.end}`);
    setRows(data.products??[]); setLoaded(true); setLoading(false);
  }, []);

  function onSort(k: string) {
    if (sortKey===k) setSortAsc(a=>!a); else { setSortKey(k); setSortAsc(false); }
  }

  const sorted = [...rows].sort((a,b) => {
    const v = Number(b[sortKey]) - Number(a[sortKey]);
    return sortAsc ? -v : v;
  });

  return (
    <AnalyticsShell title="Product ROI" breadcrumb="Product ROI" onApply={load}>
      {loading ? <LoadingState /> : !loaded ? (
        <div className="text-center py-8 text-sm text-gray-400">Select a date range and click Apply to load data.</div>
      ) : sorted.length === 0 ? <EmptyState message="No sales in this period" /> : (
        <div className="space-y-4">
          {/* Bar chart of top 8 by gross profit */}
          <Card className="bg-white border-gray-200 shadow-sm p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Top Products by Revenue</p>
            <TopProductsBar
              data={sorted.slice(0,8).map(p => ({ name: p.name, total_revenue: Number(p.total_revenue) }))}
              height={240}
            />
          </Card>

          {/* Detail table */}
          <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Product</th>
                <SortTh label="Units Sold" sortKey="units_sold" current={sortKey} asc={sortAsc} onSort={onSort} />
                <SortTh label="Revenue"    sortKey="total_revenue" current={sortKey} asc={sortAsc} onSort={onSort} />
                <SortTh label="COGS"       sortKey="total_cogs" current={sortKey} asc={sortAsc} onSort={onSort} />
                <SortTh label="Gross Profit" sortKey="gross_profit" current={sortKey} asc={sortAsc} onSort={onSort} />
                <SortTh label="Margin %" sortKey="margin_pct" current={sortKey} asc={sortAsc} onSort={onSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((p,i) => {
                const gp = Number(p.gross_profit);
                const neg = gp < 0;
                return (
                  <tr key={i} className={`hover:bg-gray-50/50 ${neg?'bg-red-50/30':''}`}>
                    <td className="py-3 px-4 font-semibold text-gray-800">{p.name}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{Number(p.units_sold).toFixed(0)}</td>
                    <td className="py-3 px-4 text-right text-gray-700 font-medium">{fmt(p.total_revenue)}</td>
                    <td className="py-3 px-4 text-right text-gray-500">{fmt(p.total_cogs)}</td>
                    <td className={`py-3 px-4 text-right font-bold ${neg?'text-red-600':'text-green-700'}`}>{fmt(gp)}</td>
                    <td className={`py-3 px-4 text-right font-semibold ${neg?'text-red-600':'text-blue-600'}`}>
                      {p.margin_pct!=null?`${p.margin_pct}%`:'—'}
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
