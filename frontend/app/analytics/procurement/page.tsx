'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { MetricCard, LoadingState, defaultRange, DateRange } from '@/components/AnalyticsShell';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

const fmt = (n:number) => `रू ${Number(n).toLocaleString('en-IN',{minimumFractionDigits:2})}`;

export default function ProcurementAnalytics() {
  const [data,    setData]    = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (range: DateRange = defaultRange()) => {
    setLoading(true);
    const { data:d } = await api.get(`/api/analytics/purchase-vs-sales?start_date=${range.start}&end_date=${range.end}`);
    setData(d); setLoading(false);
  }, []);

  return (
    <AnalyticsShell title="Purchase vs Sales" breadcrumb="Procurement" onApply={load}>
      {loading ? <LoadingState /> : !data ? (
        <div className="text-center py-8 text-sm text-gray-400">Select a date range and click Apply.</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Total Purchases (GRN)"
                        value={fmt(data.total_purchases)} accent="text-amber-700" />
            <MetricCard label="Total Sales"
                        value={fmt(data.total_sales)} accent="text-blue-700" />
            <MetricCard label="Gross Profit"
                        value={fmt(data.gross_profit)}
                        accent={Number(data.gross_profit)>=0?'text-green-700':'text-red-600'} />
            <MetricCard label="Gross Margin %"
                        value={data.gross_margin_pct!=null?`${data.gross_margin_pct}%`:'—'} />
          </div>
          <Card className="bg-white border-gray-200 shadow-sm p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Current Inventory Value</p>
            <p className="text-3xl font-bold text-gray-800">{fmt(data.current_inventory_value)}</p>
            <p className="text-xs text-gray-400 mt-1">Point-in-time snapshot — cost × stock on hand across all active products.</p>
          </Card>
        </div>
      )}
    </AnalyticsShell>
  );
}
