'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { MetricCard, LoadingState, defaultRange, DateRange } from '@/components/AnalyticsShell';
import { PaymentBarChart } from '@/components/Charts';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

const fmt = (n: number) => `रू ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export default function PaymentsAnalytics() {
  const [data,    setData]    = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (range: DateRange = defaultRange()) => {
    setLoading(true);
    const { data: d } = await api.get(`/api/analytics/payment-split?start_date=${range.start}&end_date=${range.end}`);
    setData(d); setLoading(false);
  }, []);

  const cash  = data ? Number(data.cash?.total_amount ?? 0) : 0;
  const qr    = data ? Number(data.qr?.total_amount   ?? 0) : 0;
  const grand = data ? Number(data.grand_total ?? 0)         : 0;
  const cashPct = grand > 0 ? (cash / grand * 100).toFixed(1) : '0';
  const qrPct   = grand > 0 ? (qr   / grand * 100).toFixed(1) : '0';

  return (
    <AnalyticsShell title="Payment Split" breadcrumb="Payments" onApply={load}>
      {loading ? <LoadingState /> : !data ? (
        <div className="text-center py-8 text-sm text-gray-400">Select a date range and click Apply.</div>
      ) : (
        <div className="space-y-4">
          {/* KPI cards */}
          <div className="grid grid-cols-3 gap-4">
            <MetricCard label="Cash Sales"   value={fmt(cash)}  accent="text-blue-700" />
            <MetricCard label="QR / Fonepay" value={fmt(qr)}    accent="text-teal-700" />
            <MetricCard label="Grand Total"  value={fmt(grand)} accent="text-gray-800" />
          </div>

          {/* Recharts bar chart */}
          <Card className="bg-white border-gray-200 shadow-sm p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
              Revenue by payment method
            </p>
            <PaymentBarChart cash={cash} qr={qr} height={160} />
          </Card>

          {/* Invoice count breakdown */}
          <Card className="bg-white border-gray-200 shadow-sm p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Invoice count</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                { label: 'Cash invoices',  val: data.cash?.invoice_count ?? 0, color: 'text-blue-700', pct: cashPct },
                { label: 'QR invoices',    val: data.qr?.invoice_count   ?? 0, color: 'text-teal-700', pct: qrPct },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-500">{r.label}</span>
                  <div className="text-right">
                    <span className={`font-bold ${r.color}`}>{r.val}</span>
                    <span className="text-xs text-gray-400 ml-1">({r.pct}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </AnalyticsShell>
  );
}
