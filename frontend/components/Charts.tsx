'use client';
// Shared Recharts wrappers for dashboard and analytics screens.
// All charts are responsive and use the same color palette.

import React from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line,
} from 'recharts';

const COLORS = {
  blue:   '#3b82f6',
  teal:   '#14b8a6',
  green:  '#22c55e',
  amber:  '#f59e0b',
  red:    '#ef4444',
  purple: '#8b5cf6',
  gray:   '#9ca3af',
};

const fmt = (v: number) => `रू ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtShort = (v: number) => {
  if (v >= 100000) return `रू ${(v/100000).toFixed(1)}L`;
  if (v >= 1000)   return `रू ${(v/1000).toFixed(1)}K`;
  return `रू ${v.toFixed(0)}`;
};

const TooltipStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  fontSize: '12px',
  padding: '10px 14px',
};

// ── Revenue Area/Bar Chart ─────────────────────────────────────────────────────
export function RevenueChart({
  data, height = 220,
}: {
  data: { date: string; revenue: number; invoice_count?: number }[];
  height?: number;
}) {
  if (!data.length) return <EmptyChart height={height} message="No sales data for this period" />;

  const formatted = data.map(d => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('en-IN', { month:'short', day:'numeric' }),
    revenue: Number(d.revenue),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={COLORS.blue} stopOpacity={0.15} />
            <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          contentStyle={TooltipStyle}
          formatter={(v: any) => [fmt(v), 'Revenue']}
          labelStyle={{ fontWeight: 600, color: '#374151', marginBottom: 2 }}
        />
        <Area type="monotone" dataKey="revenue" stroke={COLORS.blue} strokeWidth={2}
              fill="url(#revenueGrad)" dot={false} activeDot={{ r: 4, fill: COLORS.blue }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Payment Split Bar Chart ────────────────────────────────────────────────────
export function PaymentBarChart({
  cash, qr, height = 160,
}: {
  cash: number; qr: number; height?: number;
}) {
  const data = [
    { name: 'Cash',       value: cash, fill: COLORS.blue },
    { name: 'QR/Fonepay', value: qr,   fill: COLORS.teal },
  ];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
        <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#374151' }} axisLine={false} tickLine={false} width={72} />
        <Tooltip contentStyle={TooltipStyle} formatter={(v: any) => [fmt(v), 'Amount']} />
        <Bar dataKey="value" radius={[0, 8, 8, 0]}>
          {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Stock Health Donut ─────────────────────────────────────────────────────────
export function StockDonut({
  inStock, lowStock, outOfStock, height = 180,
}: {
  inStock: number; lowStock: number; outOfStock: number; height?: number;
}) {
  const total = inStock + lowStock + outOfStock;
  const pct   = total > 0 ? Math.round(inStock / total * 100) : 0;

  const data = [
    { name: 'In Stock',     value: inStock,    fill: COLORS.green },
    { name: 'Low Stock',    value: lowStock,   fill: COLORS.amber },
    { name: 'Out of Stock', value: outOfStock, fill: COLORS.red   },
  ].filter(d => d.value > 0);

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius="55%" outerRadius="80%"
               startAngle={90} endAngle={-270} paddingAngle={2} dataKey="value">
            {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
          </Pie>
          <Tooltip contentStyle={TooltipStyle} formatter={(v: any, name: any) => [v, name]} />
        </PieChart>
      </ResponsiveContainer>
      {/* Centre label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-bold text-gray-800">{pct}%</span>
        <span className="text-[10px] text-gray-400 font-medium">In Stock</span>
      </div>
    </div>
  );
}

// ── Top Products Bar ───────────────────────────────────────────────────────────
export function TopProductsBar({
  data, height = 220,
}: {
  data: { name: string; total_revenue: number }[];
  height?: number;
}) {
  if (!data.length) return <EmptyChart height={height} message="No product sales data" />;

  const trimmed = data.slice(0, 8).map(d => ({
    ...d,
    label: d.name.length > 16 ? d.name.slice(0, 14) + '…' : d.name,
    revenue: Number(d.total_revenue),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={trimmed} layout="vertical" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
        <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} width={100} />
        <Tooltip contentStyle={TooltipStyle} formatter={(v: any) => [fmt(v), 'Revenue']} />
        <Bar dataKey="revenue" fill={COLORS.purple} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Cashier Performance Bar ────────────────────────────────────────────────────
export function CashierChart({
  data, height = 200,
}: {
  data: { full_name: string; total_revenue: number; invoice_count: number }[];
  height?: number;
}) {
  if (!data.length) return <EmptyChart height={height} message="No cashier data" />;

  const trimmed = data.map(d => ({
    name:    d.full_name.split(' ')[0],
    revenue: Number(d.total_revenue),
    invoices: d.invoice_count,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={trimmed} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={56} />
        <Tooltip contentStyle={TooltipStyle}
                 formatter={(v: any, n: any) => [n==='revenue' ? fmt(v) : v, n==='revenue' ? 'Revenue' : 'Invoices']} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="revenue"  fill={COLORS.blue}  radius={[4,4,0,0]} name="revenue" />
        <Bar dataKey="invoices" fill={COLORS.teal}   radius={[4,4,0,0]} name="invoices" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── VAT Category split donut ───────────────────────────────────────────────────
export function VatSplitDonut({
  data, height = 200,
}: {
  data: { vat_category: string; revenue: number }[];
  height?: number;
}) {
  if (!data.length) return <EmptyChart height={height} message="No sales data" />;

  const CAT_COLORS: Record<string, string> = {
    TAXABLE_13: COLORS.blue, EXEMPT: COLORS.green,
    ZERO_RATED: COLORS.teal, NON_TAXABLE: COLORS.gray,
  };
  const CAT_LABELS: Record<string, string> = {
    TAXABLE_13:'13% VAT', EXEMPT:'Exempt', ZERO_RATED:'Zero-rated', NON_TAXABLE:'Non-taxable',
  };

  const formatted = data.map(d => ({
    name:  CAT_LABELS[d.vat_category] ?? d.vat_category,
    value: Number(d.revenue),
    fill:  CAT_COLORS[d.vat_category] ?? COLORS.gray,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={formatted} cx="50%" cy="50%" innerRadius="45%" outerRadius="70%"
             paddingAngle={3} dataKey="value" label={({ name, percent }: any) => `${name} ${((percent ?? 0)*100).toFixed(0)}%`}
             labelLine={false}>
          {formatted.map((d, i) => <Cell key={i} fill={d.fill} />)}
        </Pie>
        <Tooltip contentStyle={TooltipStyle} formatter={(v: any) => [fmt(v), 'Revenue']} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Returns trend line ─────────────────────────────────────────────────────────
export function ReturnRateChart({
  salesData, returnsData, height = 200,
}: {
  salesData: number[]; returnsData: number[]; height?: number;
}) {
  const data = salesData.map((s, i) => ({
    period: `P${i+1}`,
    sales:  s,
    returns: returnsData[i] ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={56} />
        <Tooltip contentStyle={TooltipStyle} formatter={(v: any) => [fmt(v)]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="sales"   stroke={COLORS.blue}  strokeWidth={2} dot={false} name="Sales" />
        <Line type="monotone" dataKey="returns" stroke={COLORS.red}   strokeWidth={2} dot={false} name="Returns" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyChart({ height, message }: { height: number; message: string }) {
  return (
    <div className="flex items-center justify-center text-gray-300 text-sm" style={{ height }}>
      {message}
    </div>
  );
}
