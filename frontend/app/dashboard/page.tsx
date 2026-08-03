'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError } from '@/lib/getErrorMessage';
import { useAuth } from '@/lib/auth';
import { RevenueChart, PaymentBarChart, StockDonut, TopProductsBar } from '@/components/Charts';
import {
  TrendingUp, ShoppingCart, Package,
  AlertTriangle, Users, ArrowRight, CheckCircle2, Loader2
} from 'lucide-react';

const fmtCurrency = (n: number) =>
  `रू ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StatCard({ label, value, sub, subColor = 'text-gray-400', icon: Icon, iconColor = 'text-blue-600', href, loading }: any) {
  const inner = (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-5 h-full ${href ? 'hover:shadow-md hover:border-blue-300 transition-all cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{label}</p>
        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
          <Icon size={16} className={iconColor} />
        </div>
      </div>
      {loading
        ? <div className="h-8 flex items-center"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
        : <>
            <p className="text-2xl font-bold text-gray-800 leading-tight">{value}</p>
            {sub && <p className={`text-xs font-semibold mt-1.5 ${subColor}`}>{sub}</p>}
          </>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [loading,       setLoading]       = useState(true);
  const [revenue,       setRevenue]       = useState<any>(null);
  const [payments,      setPayments]      = useState<any>(null);
  const [alerts,        setAlerts]        = useState<any[]>([]);
  const [topProducts,   setTopProducts]   = useState<any[]>([]);
  const [chartRows,     setChartRows]     = useState<any[]>([]);
  const [invHealth,     setInvHealth]     = useState({ inStock:0, low:0, out:0 });
  const [openShifts,    setOpenShifts]    = useState(0);
  const [activeProds,   setActiveProds]   = useState(0);
  const [recentInv,     setRecentInv]     = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const today      = new Date().toISOString().slice(0,10);
      const daysAgo30  = new Date(Date.now()-30*24*60*60*1000).toISOString().slice(0,10);
      const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`;
      try {
        const [revR, splitR, alertR, topR, shiftsR, prodsR, invR, chartR, recentR] = await Promise.all([
          api.get(`/api/analytics/revenue?start_date=${today}&end_date=${today}`),
          api.get(`/api/analytics/payment-split?start_date=${today}&end_date=${today}`),
          api.get('/api/analytics/stock-alerts'),
          api.get(`/api/analytics/top-sellers?start_date=${monthStart}&end_date=${today}&limit=8`),
          api.get('/api/shifts?status=open&limit=20'),
          api.get('/api/products'),
          api.get('/api/inventory'),
          api.get(`/api/analytics/revenue-chart?start_date=${daysAgo30}&end_date=${today}`),
          api.get('/api/invoices?is_return=false&limit=5'),
        ]);
        setRevenue(revR.data);
        setPayments(splitR.data);
        setAlerts(alertR.data.alerts ?? []);
        setTopProducts(topR.data.by_revenue ?? []);
        setOpenShifts((shiftsR.data.shifts ?? []).length);
        setActiveProds((prodsR.data.products ?? []).filter((p:any)=>p.is_active).length);
        setChartRows(chartR.data.chart ?? []);
        setRecentInv(recentR.data.invoices ?? []);
        const inv = invR.data.inventory ?? [];
        setInvHealth({
          inStock: inv.filter((r:any) => !r.is_negative_stock && !r.is_low_stock && Number(r.stock_on_hand) > 0).length,
          low:     inv.filter((r:any) => r.is_low_stock && !r.is_negative_stock).length,
          out:     inv.filter((r:any) => r.is_negative_stock || Number(r.stock_on_hand) <= 0).length,
        });
      } catch(e) { devError('[dashboard/load]', e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const totalRevToday = Number(revenue?.current?.total_revenue ?? 0);
  const change        = revenue?.percent_change ?? null;
  const cashAmt       = Number(payments?.cash?.total_amount ?? 0);
  const qrAmt         = Number(payments?.qr?.total_amount   ?? 0);
  const totalAlerts   = alerts.length;

  return (
    <AppShell>
      <div className="space-y-5 max-w-6xl mx-auto font-sans">

        {/* Welcome header */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">
              Good {new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}, {user?.full_name.split(' ')[0]} 👋
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}
            </p>
          </div>
          <Link href="/pos" className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
            <ShoppingCart size={16} /> Open POS
          </Link>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Today's Revenue"   value={fmtCurrency(totalRevToday)}
            sub={change!=null?`${change>=0?'▲':'▼'} ${Math.abs(change).toFixed(1)}% vs yesterday`:`${revenue?.current?.invoice_count??0} invoices`}
            subColor={change!=null?(change>=0?'text-green-600':'text-red-500'):'text-gray-400'}
            icon={TrendingUp} iconColor="text-blue-600" href="/analytics" loading={loading} />
          <StatCard label="Open Shifts"  value={String(openShifts)}
            sub={openShifts===0?'No active shifts':`${openShifts} active`}
            subColor={openShifts===0?'text-gray-400':'text-green-600'}
            icon={Users} iconColor="text-indigo-600" href="/analytics/shifts" loading={loading} />
          <StatCard label="Active Products" value={String(activeProds)}
            icon={Package} iconColor="text-teal-600" href="/products" loading={loading} />
          <StatCard label="Stock Alerts" value={String(totalAlerts)}
            sub={totalAlerts===0?'All levels healthy':`${alerts.filter(a=>a.is_negative_stock).length} negative · ${alerts.filter(a=>!a.is_negative_stock&&a.is_low_stock).length} low`}
            subColor={totalAlerts>0?'text-amber-600':'text-green-600'}
            icon={AlertTriangle} iconColor={totalAlerts>0?'text-amber-500':'text-green-500'}
            href="/analytics/stock-alerts" loading={loading} />
        </div>

        {/* Revenue chart + Stock donut */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Revenue Overview</h3>
                <p className="text-xs text-gray-400 mt-0.5">Daily revenue — last 30 days</p>
              </div>
              <Link href="/analytics" className="text-xs text-blue-600 font-semibold flex items-center gap-1">
                Full analytics <ArrowRight size={12} />
              </Link>
            </div>
            {loading
              ? <div className="flex items-center justify-center h-52"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
              : <RevenueChart data={chartRows} height={220} />}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-800">Stock Health</h3>
              <Link href="/inventory" className="text-xs text-blue-600 font-semibold flex items-center gap-1">
                View <ArrowRight size={12} />
              </Link>
            </div>
            {loading
              ? <div className="flex items-center justify-center h-44"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
              : <StockDonut inStock={invHealth.inStock} lowStock={invHealth.low} outOfStock={invHealth.out} height={160} />}
            <div className="mt-3 space-y-1.5 text-xs">
              {[
                { label:'In Stock',     val:invHealth.inStock, color:'bg-green-500' },
                { label:'Low Stock',    val:invHealth.low,     color:'bg-amber-400' },
                { label:'Out / Neg',    val:invHealth.out,     color:'bg-red-500' },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${s.color}`} />
                    <span className="text-gray-500">{s.label}</span>
                  </div>
                  <span className="font-bold text-gray-700">{s.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top products bar + Payment split */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-800">Top Products (this month)</h3>
              <Link href="/analytics/top-sellers" className="text-xs text-blue-600 font-semibold flex items-center gap-1">
                Full list <ArrowRight size={12} />
              </Link>
            </div>
            {loading
              ? <div className="flex items-center justify-center h-52"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
              : <TopProductsBar data={topProducts.map(p=>({name:p.name,total_revenue:Number(p.total_revenue)}))} height={220} />}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-800">Today's Payments</h3>
              <Link href="/analytics/payments" className="text-xs text-blue-600 font-semibold flex items-center gap-1">
                Detail <ArrowRight size={12} />
              </Link>
            </div>
            {loading
              ? <div className="flex items-center justify-center h-52"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
              : <>
                  <PaymentBarChart cash={cashAmt} qr={qrAmt} height={130} />
                  <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-sm">
                    <span className="text-gray-500 font-medium">Total today</span>
                    <span className="font-bold text-blue-700">{fmtCurrency(cashAmt+qrAmt)}</span>
                  </div>
                </>}
          </div>
        </div>

        {/* Recent invoices + Alerts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Recent invoices */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-800">Recent Invoices</h3>
              <Link href="/analytics/shifts" className="text-xs text-blue-600 font-semibold flex items-center gap-1">
                View all <ArrowRight size={12} />
              </Link>
            </div>
            {loading
              ? <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-gray-300" size={20} /></div>
              : recentInv.length===0
                ? <p className="px-5 py-6 text-center text-xs text-gray-400">No invoices today</p>
                : <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['Invoice','Cashier','Method','Total','Time'].map(h=>(
                          <th key={h} className="px-4 py-2.5 text-left font-bold text-gray-400 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {recentInv.map((inv:any, i:number)=>(
                        <tr key={i} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 font-mono font-semibold text-gray-700">{inv.invoice_number}</td>
                          <td className="px-4 py-2.5 text-gray-500">{inv.cashier_name}</td>
                          <td className="px-4 py-2.5">
                            <span className={`font-semibold px-1.5 py-0.5 rounded text-[9px] uppercase ${inv.payment_method==='cash'?'bg-blue-50 text-blue-700':'bg-teal-50 text-teal-700'}`}>
                              {inv.payment_method}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-bold text-gray-800">रू {Number(inv.total_amount).toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-gray-400">{new Date(inv.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>}
          </div>

          {/* Stock alerts */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-800">Stock Alerts</h3>
              <Link href="/inventory/adjust" className="text-xs text-blue-600 font-semibold flex items-center gap-1">
                Adjust <ArrowRight size={12} />
              </Link>
            </div>
            {loading
              ? <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-gray-300" size={20} /></div>
              : alerts.length===0
                ? <div className="px-5 py-6 text-center">
                    <CheckCircle2 className="mx-auto text-green-400 mb-2" size={24} />
                    <p className="text-xs font-semibold text-gray-500">All stock levels healthy</p>
                  </div>
                : <div className="divide-y divide-gray-50">
                    {alerts.slice(0,6).map((a:any,i:number)=>(
                      <div key={i} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <p className="text-xs font-semibold text-gray-800">{a.product_name}</p>
                          <p className="text-[10px] text-gray-400">{a.location_name}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${a.is_negative_stock?'text-red-600':'text-amber-600'}`}>
                            {Number(a.stock_on_hand).toFixed(0)}
                          </p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${a.is_negative_stock?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}>
                            {a.is_negative_stock?'NEGATIVE':'LOW'}
                          </span>
                        </div>
                      </div>
                    ))}
                    {alerts.length>6&&(
                      <div className="px-5 py-2.5 text-center">
                        <Link href="/analytics/stock-alerts" className="text-xs text-blue-600 font-semibold">
                          +{alerts.length-6} more →
                        </Link>
                      </div>
                    )}
                  </div>}
          </div>
        </div>

      </div>
    </AppShell>
  );
}
