'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AnalyticsShell, { MetricCard, defaultRange } from '@/components/AnalyticsShell';
import { RevenueChart, PaymentBarChart, CashierChart } from '@/components/Charts';
import api from '@/lib/api';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const fmt = (n: number) => `रू ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AnalyticsOverview() {
  const [rev,    setRev]    = useState<any>(null);
  const [split,  setSplit]  = useState<any>(null);
  const [ret,    setRet]    = useState<any>(null);
  const [pvs,    setPvs]    = useState<any>(null);
  const [chartRows, setChartRows] = useState<any[]>([]);
  const [cashiers,  setCashiers]  = useState<any[]>([]);
  const [loading,setLoading]= useState(false);
  const [toast,  setToast]  = useState('');

  const load = useCallback(async (range = defaultRange()) => {
    setLoading(true);
    const q = `start_date=${range.start}&end_date=${range.end}`;
    try {
      const [r,s,rt,p,cr,ca] = await Promise.all([
        api.get(`/api/analytics/revenue?${q}`),
        api.get(`/api/analytics/payment-split?${q}`),
        api.get(`/api/analytics/returns-summary?${q}`),
        api.get(`/api/analytics/purchase-vs-sales?${q}`),
        api.get(`/api/analytics/revenue-chart?${q}`),
        api.get(`/api/analytics/cashier-performance?${q}`),
      ]);
      setRev(r.data); setSplit(s.data); setRet(rt.data); setPvs(p.data);
      setChartRows(cr.data.chart ?? []);
      setCashiers(ca.data.cashiers ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function exportReport() {
    setToast('Export coming soon — will download as PDF/CSV in Phase 16.');
    setTimeout(() => setToast(''), 4000);
  }

  const revenue    = rev   ? Number(rev.current.total_revenue)       : 0;
  const grossProfit= pvs   ? Number(pvs.total_sales) - Number(pvs.total_purchases) : 0;
  const returnRate = ret   ? ret.return_rate_pct                      : null;
  const cashAmt    = split ? Number(split.cash?.total_amount??0)      : 0;
  const qrAmt      = split ? Number(split.qr?.total_amount??0)        : 0;
  const grand      = cashAmt + qrAmt;
  const cashPct    = grand > 0 ? (cashAmt/grand*100).toFixed(1) : '0';
  const qrPct      = grand > 0 ? (qrAmt /grand*100).toFixed(1) : '0';

  const LINKS = [
    { href:'/analytics/products',   label:'Product ROI',       desc:'Margin & profitability per product' },
    { href:'/analytics/top-sellers',label:'Top Sellers',        desc:'Ranked by qty and revenue' },
    { href:'/analytics/cashiers',   label:'Cashier Performance',desc:'Invoice count, revenue, return rate' },
    { href:'/analytics/shifts',     label:'Shift Reports',      desc:'Cash reconciliation, variance flags' },
    { href:'/analytics/slow-stock', label:'Slow-Moving Stock',  desc:'Products with no recent sales' },
    { href:'/analytics/expiry',     label:'Expiry Tracker',     desc:'Products nearing expiry' },
    { href:'/analytics/stock-alerts',label:'Stock Alerts',      desc:'Negative & low-stock products' },
    { href:'/analytics/diagnostics',label:'Diagnostics',        desc:'System logs and error events' },
  ];

  return (
    <AnalyticsShell
      title="Analytics Overview"
      onApply={load}
      headerActions={
        <Button variant="outline" onClick={exportReport}
                className="border-gray-300 text-gray-700 gap-2 text-xs">
          <Download size={14} /> Export Report
        </Button>
      }
    >
      {/* Summary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Revenue" value={fmt(revenue)}
                    change={rev?.percent_change} href="/analytics/products" accent="text-blue-700" />
        <MetricCard label="Gross Profit" value={fmt(grossProfit)}
                    accent={grossProfit >= 0 ? 'text-green-700' : 'text-red-600'}
                    href="/analytics/procurement" />
        <MetricCard label="Return Rate"
                    value={returnRate != null ? `${returnRate}%` : '—'}
                    accent={returnRate && returnRate > 10 ? 'text-red-600' : 'text-gray-800'}
                    href="/analytics/returns" />
        <MetricCard label="Invoices" value={String(rev?.current?.invoice_count ?? '—')}
                    href="/analytics/shifts" />
      </div>

      {/* Payment split visual */}
      <Card className="bg-white border-gray-200 shadow-sm p-5">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
          Payment Split <Link href="/analytics/payments" className="ml-2 text-blue-500 normal-case font-normal text-xs">View detail →</Link>
        </p>
        <div className="flex h-4 rounded-full overflow-hidden mb-3 bg-gray-100">
          <div style={{ width: `${cashPct}%`, background:'#2563eb' }} className="transition-all duration-500" />
          <div style={{ width: `${qrPct}%`,  background:'#0d9488' }} className="transition-all duration-500" />
        </div>
        <div className="flex gap-6 text-xs text-gray-600">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
            Cash {cashPct}% — {fmt(cashAmt)}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-teal-600" />
            QR {qrPct}% — {fmt(qrAmt)}
          </div>
        </div>
      </Card>

      {/* Quick links grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {LINKS.map(l => (
          <Link key={l.href} href={l.href}>
            <Card className="p-4 bg-white border-gray-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all h-full cursor-pointer">
              <p className="text-sm font-bold text-gray-800">{l.label}</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{l.desc}</p>
            </Card>
          </Link>
        ))}
      </div>

      {/* Revenue chart */}
      {chartRows.length > 0 && (
        <Card className="bg-white border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-bold text-gray-800">Revenue Trend</p>
              <p className="text-xs text-gray-400 mt-0.5">Daily revenue for the selected period</p>
            </div>
          </div>
          <RevenueChart data={chartRows} height={240} />
        </Card>
      )}

      {/* Payment split + Cashier chart */}
      {(split || cashiers.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {split && (
            <Card className="bg-white border-gray-200 shadow-sm p-5">
              <p className="text-sm font-bold text-gray-800 mb-4">Payment Split</p>
              <PaymentBarChart
                cash={Number(split.cash?.total_amount ?? 0)}
                qr={Number(split.qr?.total_amount ?? 0)}
                height={140}
              />
              <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs">
                <span className="text-gray-500">Cash invoices: <strong>{split.cash?.invoice_count ?? 0}</strong></span>
                <span className="text-gray-500">QR invoices: <strong>{split.qr?.invoice_count ?? 0}</strong></span>
              </div>
            </Card>
          )}
          {cashiers.length > 0 && (
            <Card className="bg-white border-gray-200 shadow-sm p-5">
              <p className="text-sm font-bold text-gray-800 mb-4">Cashier Performance</p>
              <CashierChart data={cashiers} height={200} />
            </Card>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl">
          {toast}
        </div>
      )}
    </AnalyticsShell>
  );
}
