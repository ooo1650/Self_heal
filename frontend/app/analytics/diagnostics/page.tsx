'use client';
import React, { useState, useCallback } from 'react';
import AnalyticsShell, { Badge, EmptyState, LoadingState, defaultRange } from '@/components/AnalyticsShell';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';

const LEVEL_COLOR: Record<string,'green'|'amber'|'red'|'blue'|'gray'> = {
  info:'blue', warning:'amber', error:'red'
};

export default function Diagnostics() {
  const [rows,    setRows]    = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [level,   setLevel]   = useState('');
  const [limit,   setLimit]   = useState('50');
  const [expanded,setExpanded]= useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit });
    if (level) params.set('log_level', level);
    const { data } = await api.get(`/api/analytics/diagnostics?${params}`);
    setRows(data.logs??[]); setLoaded(true); setLoading(false); setExpanded(new Set());
  }, [level, limit]);

  function toggleExpand(i: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  return (
    <AnalyticsShell title="System Diagnostics" breadcrumb="Diagnostics" onApply={load} showDatePicker={false}
      headerActions={
        <div className="flex gap-2">
          <select value={level} onChange={e=>setLevel(e.target.value)}
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white outline-none">
            <option value="">All levels</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
          <select value={limit} onChange={e=>setLimit(e.target.value)}
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white outline-none">
            {['20','50','100','200','500'].map(n=><option key={n} value={n}>Last {n}</option>)}
          </select>
        </div>
      }>
      {loading ? <LoadingState /> : !loaded ? (
        <div className="text-center py-8 text-sm text-gray-400">Click Apply to load logs.</div>
      ) : rows.length===0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center text-sm font-semibold text-green-700">
          ✓ No log entries found
        </div>
      ) : (
        <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Time','Level','Module','Message','Branch'].map(h=>(
                  <th key={h} className="py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r,i) => {
                const exp = expanded.has(i);
                return (
                  <tr key={i} className={`hover:bg-gray-50/50 ${r.log_level==='error'?'bg-red-50/20':r.log_level==='warning'?'bg-amber-50/20':''}`}>
                    <td className="py-2.5 px-4 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                    </td>
                    <td className="py-2.5 px-4">
                      <Badge label={r.log_level.toUpperCase()} color={LEVEL_COLOR[r.log_level]??'gray'} />
                    </td>
                    <td className="py-2.5 px-4 text-xs font-mono text-gray-500">{r.module_origin}</td>
                    <td className="py-2.5 px-4 text-xs text-gray-700 max-w-xs">
                      <button onClick={() => toggleExpand(i)} className="text-left w-full">
                        {exp ? r.alert_message : r.alert_message.slice(0,80) + (r.alert_message.length>80?'…':'')}
                      </button>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-gray-400">{r.location_name??'—'}</td>
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
