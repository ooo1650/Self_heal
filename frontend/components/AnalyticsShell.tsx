'use client';
// Shared wrapper for every analytics screen.
// Provides: date range state, quick-select buttons, apply handler, period label.
// Usage:
//   <AnalyticsShell title="Product ROI" onApply={setDates}>
//     {children}
//   </AnalyticsShell>

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Calendar, ChevronRight, BarChart3 } from 'lucide-react';

export interface DateRange { start: string; end: string; }

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function lastMonthStart(): string {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-1);
  return d.toISOString().slice(0,10);
}
function lastMonthEnd(): string {
  const d = new Date(); d.setDate(0); // last day of prev month
  return d.toISOString().slice(0,10);
}

export function defaultRange(): DateRange {
  return { start: monthStart(), end: today() };
}

interface QuickBtn { label: string; start: string; end: string; }
const QUICK: QuickBtn[] = [
  { label: 'This month', start: monthStart(),      end: today()          },
  { label: 'Last month', start: lastMonthStart(),  end: lastMonthEnd()   },
  { label: 'Last 7 days',start: daysAgo(7),        end: today()          },
  { label: 'Last 30 days',start: daysAgo(30),      end: today()          },
];

interface Props {
  title:       string;
  breadcrumb?: string;
  onApply:     (range: DateRange) => void;
  showDatePicker?: boolean;
  children:    React.ReactNode;
  headerActions?: React.ReactNode;
}

export default function AnalyticsShell({
  title, breadcrumb, onApply, showDatePicker = true, children, headerActions,
}: Props) {
  const [start, setStart] = useState(monthStart());
  const [end,   setEnd]   = useState(today());
  const [active, setActive] = useState('This month');

  const apply = useCallback((s: string, e: string, label?: string) => {
    setStart(s); setEnd(e);
    if (label) setActive(label);
    onApply({ start: s, end: e });
  }, [onApply]);

  return (
    <AppShell>
      <div className="space-y-5 max-w-6xl mx-auto font-sans">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <Link href="/analytics" className="hover:text-gray-600 flex items-center gap-1">
            <BarChart3 size={11} /> Analytics
          </Link>
          {breadcrumb && <><ChevronRight size={11} /><span className="text-gray-600">{breadcrumb}</span></>}
        </div>

        {/* Header card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <h1 className="text-xl font-bold text-gray-800">{title}</h1>
            {headerActions && <div className="flex gap-2">{headerActions}</div>}
          </div>

          {showDatePicker && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {/* Quick select */}
              {QUICK.map(q => (
                <button key={q.label}
                        onClick={() => apply(q.start, q.end, q.label)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-semibold border transition-colors ${
                          active === q.label
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                        }`}>
                  {q.label}
                </button>
              ))}
              {/* Manual inputs */}
              <div className="flex items-center gap-2 ml-auto">
                <Calendar size={14} className="text-gray-400" />
                <input type="date" value={start} onChange={e => { setStart(e.target.value); setActive('custom'); }}
                       className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:border-blue-500 outline-none" />
                <span className="text-xs text-gray-400">to</span>
                <input type="date" value={end} onChange={e => { setEnd(e.target.value); setActive('custom'); }}
                       className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:border-blue-500 outline-none" />
                <Button size="sm" onClick={() => apply(start, end)}
                        className="bg-blue-600 text-white hover:bg-blue-700 text-xs h-8 px-3">
                  Apply
                </Button>
              </div>
            </div>
          )}
        </div>

        {children}
      </div>
    </AppShell>
  );
}

/** Metric card — large number with optional % change */
export function MetricCard({
  label, value, change, changeLabel, href, accent
}: {
  label: string; value: string; change?: number | null;
  changeLabel?: string; href?: string; accent?: string;
}) {
  const inner = (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-5 h-full ${href ? 'hover:shadow-md hover:border-blue-300 transition-all cursor-pointer' : ''}`}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? 'text-gray-800'}`}>{value}</p>
      {change !== undefined && change !== null && (
        <p className={`text-xs font-semibold mt-1.5 ${change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% {changeLabel ?? 'vs prior period'}
        </p>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

/** Sortable table header cell */
export function SortTh({
  label, sortKey, current, asc, onSort
}: {
  label: string; sortKey: string; current: string; asc: boolean;
  onSort: (k: string) => void;
}) {
  const active = current === sortKey;
  return (
    <th className="py-3 px-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-800"
        onClick={() => onSort(sortKey)}>
      {label} {active ? (asc ? '↑' : '↓') : <span className="text-gray-300">↕</span>}
    </th>
  );
}

/** Status badge */
export function Badge({
  label, color
}: { label: string; color: 'green'|'amber'|'red'|'blue'|'gray' }) {
  const styles = {
    green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red:   'bg-red-50 text-red-700 border-red-200',
    blue:  'bg-blue-50 text-blue-700 border-blue-200',
    gray:  'bg-gray-100 text-gray-600 border-gray-200',
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${styles[color]}`}>
      {label}
    </span>
  );
}

/** Empty state */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
      <BarChart3 className="mx-auto text-gray-300 mb-3" size={36} />
      <p className="font-semibold text-gray-500 text-sm">{message}</p>
    </div>
  );
}

/** Loading state */
export function LoadingState() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 flex items-center justify-center gap-3 text-gray-400">
      <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm font-medium">Loading…</span>
    </div>
  );
}
