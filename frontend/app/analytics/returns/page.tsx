'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { MetricCard, LoadingState, defaultRange, DateRange } from '@/components/AnalyticsShell';
import api from '@/lib/api';

const fmt = (n:number) => `रू ${Number(n).toLocaleString('en-IN',{minimumFractionDigits:2})}`;

export default function ReturnsAnalytics() {
  const [data,    setData]    = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (range: DateRange = defaultRange()) => {
    setLoading(true);
    const { data:d } = await api.get(`/api/analytics/returns-summary?start_date=${range.start}&end_date=${range.end}`);
    setData(d); setLoading(false);
  }, []);

  const netRevenue = data ? Number(data.total_sales) - Number(data.total_returns) : 0;

  return (
    <AnalyticsShell title="Returns Summary" breadcrumb="Returns" onApply={load}>
      {loading ? <LoadingState /> : !data ? (
        <div className="text-center py-8 text-sm text-gray-400">Select a date range and click Apply.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total Sales"
                      value={fmt(data.total_sales)}
                      accent="text-blue-700" />
          <MetricCard label="Total Returns"
                      value={fmt(data.total_returns)}
                      accent="text-red-600" />
          <MetricCard label="Return Rate"
                      value={data.return_rate_pct!=null?`${data.return_rate_pct}%`:'—'}
                      accent={data.return_rate_pct>10?'text-red-600':'text-gray-800'} />
          <MetricCard label="Net Revenue"
                      value={fmt(netRevenue)}
                      accent={netRevenue>=0?'text-green-700':'text-red-600'} />
        </div>
      )}
    </AnalyticsShell>
  );
}
