'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ClipboardList, Plus, ChevronRight, Loader2, X,
  Search, Eye
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

const STATUS_STYLES: Record<string,string> = {
  pending:            'bg-amber-50 text-amber-700 border-amber-200',
  partially_received: 'bg-blue-50 text-blue-700 border-blue-200',
  fully_received:     'bg-green-50 text-green-700 border-green-200',
  cancelled:          'bg-gray-100 text-gray-500 border-gray-200',
};
const STATUS_LABELS: Record<string,string> = {
  pending:'Pending', partially_received:'Partial', fully_received:'Received', cancelled:'Cancelled',
};

interface PO { id:string; po_number:string; supplier_name:string; status:string;
  location_name:string; item_count:number; total_order_value:string; expected_date:string|null; created_at:string; }
interface Supplier { id:string; supplier_name:string; }
interface Product  { id:string; name:string; mrp:string; }
interface Branch   { id:string; location_name:string; }

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const isOwner  = user?.role === 'owner';
  const [orders,    setOrders]    = useState<PO[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products,  setProducts]  = useState<Product[]>([]);
  const [locations, setLocations] = useState<Branch[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detailId,   setDetailId]  = useState<string|null>(null);
  const [detail,     setDetail]    = useState<any>(null);
  const [form, setForm] = useState({ supplier_id:'', location_id:'', po_number:'',
                                      expected_date:'', notes:'' });
  const [lines, setLines] = useState<{product_id:string;ordered_qty:string;unit_cost:string}[]>([
    { product_id:'', ordered_qty:'', unit_cost:'' }
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const [ord, sup, prd] = await Promise.all([
        api.get(`/api/purchase-orders?${params}`),
        api.get('/api/suppliers?active=true'),
        api.get('/api/products?active=true'),
      ]);
      setOrders(ord.data.purchase_orders??[]);
      setSuppliers(sup.data.suppliers??[]);
      setProducts(prd.data.products??[]);
      // Extract locations from orders
      const seen = new Map<string,string>();
      (ord.data.purchase_orders??[]).forEach((o:any) => seen.set(o.location_id||'', o.location_name||''));
      setLocations([...seen.entries()].filter(([id])=>id).map(([id,name])=>({id, location_name:name})));
    } finally { setLoading(false); }
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  async function loadDetail(id:string) {
    setDetailId(id);
    const { data } = await api.get(`/api/purchase-orders/${id}`);
    setDetail(data.purchase_order);
  }

  async function handleCreate(e:React.FormEvent) {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      const locId = user?.location_id ?? locations[0]?.id ?? '';
      await api.post('/api/purchase-orders', {
        supplier_id:   form.supplier_id,
        location_id:   form.location_id || locId,
        po_number:     form.po_number.trim(),
        expected_date: form.expected_date || undefined,
        notes:         form.notes || undefined,
        items: lines.filter(l=>l.product_id&&l.ordered_qty&&l.unit_cost).map(l=>({
          product_id: l.product_id, ordered_qty: Number(l.ordered_qty), unit_cost: Number(l.unit_cost),
        })),
      });
      setShowCreate(false); load();
    } catch (err:any) {
      devError('[orders/create]', err);
      setFormError(getErrorMessage(err));
    }
    finally { setSaving(false); }
  }

  const filtered = orders.filter(o =>
    !search || o.po_number.toLowerCase().includes(search.toLowerCase()) ||
    o.supplier_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto font-sans">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <Link href="/procurement" className="hover:text-gray-600">Procurement</Link>
          <ChevronRight size={12} /><span className="text-gray-600">Purchase Orders</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Purchase Orders</h2>
            <p className="text-sm text-gray-500 mt-0.5">Track supplier orders and receiving status.</p>
          </div>
          {isOwner && (
            <Button onClick={() => { setShowCreate(true); setFormError('');
              setForm({ supplier_id:'', location_id: user?.location_id??'',
                po_number:'PO-'+Date.now().toString().slice(-6), expected_date:'', notes:'' });
              setLines([{product_id:'',ordered_qty:'',unit_cost:''}]); }}
                    className="bg-blue-600 text-white hover:bg-blue-700 gap-2 shrink-0">
              <Plus size={15} /> New PO
            </Button>
          )}
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 text-gray-400" size={15} />
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search PO number or supplier…"
                   className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-4 py-2.5 focus:border-blue-500 outline-none" />
          </div>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
                  className="text-xs border border-gray-300 rounded-lg p-2.5 bg-white font-medium text-gray-700 focus:border-blue-500 outline-none">
            <option value="">All Status</option>
            {Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{background:'rgba(0,0,0,0.6)'}}>
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl my-4">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-800">New Purchase Order</h3>
                <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Supplier *</label>
                    <select required value={form.supplier_id} onChange={e=>setForm(f=>({...f,supplier_id:e.target.value}))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
                      <option value="">Select supplier</option>
                      {suppliers.map(s=><option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">PO Number *</label>
                    <input required value={form.po_number} onChange={e=>setForm(f=>({...f,po_number:e.target.value}))}
                           className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Expected date</label>
                    <input type="date" value={form.expected_date} onChange={e=>setForm(f=>({...f,expected_date:e.target.value}))}
                           className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                    <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
                           className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                </div>
                {/* Line items */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-600">Items</label>
                    <button type="button" onClick={() => setLines(l=>[...l,{product_id:'',ordered_qty:'',unit_cost:''}])}
                            className="text-xs text-blue-600 font-semibold hover:text-blue-800">+ Add item</button>
                  </div>
                  {lines.map((l,i)=>(
                    <div key={i} className="grid grid-cols-12 gap-2 mb-2">
                      <select value={l.product_id} onChange={e=>{const n=[...lines];n[i]={...n[i],product_id:e.target.value};setLines(n);}}
                              className="col-span-6 border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                        <option value="">Product</option>
                        {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input type="number" min="0" placeholder="Qty" value={l.ordered_qty}
                             onChange={e=>{const n=[...lines];n[i]={...n[i],ordered_qty:e.target.value};setLines(n);}}
                             className="col-span-3 border border-gray-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                      <input type="number" min="0" placeholder="Cost" value={l.unit_cost}
                             onChange={e=>{const n=[...lines];n[i]={...n[i],unit_cost:e.target.value};setLines(n);}}
                             className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                      <button type="button" onClick={() => setLines(l=>l.filter((_,j)=>j!==i))}
                              className="col-span-1 text-red-400 hover:text-red-600 text-center">✕</button>
                    </div>
                  ))}
                </div>
                {formError && <p className="text-xs text-red-600">{formError}</p>}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}
                          className="flex-1 border-gray-300 text-gray-700">Cancel</Button>
                  <Button type="submit" disabled={saving}
                          className="flex-1 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Creating…' : 'Create PO'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Detail modal */}
        {detailId && detail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{background:'rgba(0,0,0,0.6)'}}>
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl my-4">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-800">{detail.po_number}</h3>
                <button onClick={() => { setDetailId(null); setDetail(null); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div className="px-6 py-5">
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div><p className="text-xs text-gray-400">Supplier</p><p className="font-semibold text-gray-800">{detail.supplier_name}</p></div>
                  <div><p className="text-xs text-gray-400">Status</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLES[detail.status]??''}`}>
                      {STATUS_LABELS[detail.status]??detail.status}
                    </span>
                  </div>
                </div>
                <table className="w-full text-xs border-collapse mb-3">
                  <thead><tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-semibold text-gray-500">Product</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-500">Ordered</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-500">Received</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-500">Unit Cost</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {(detail.items??[]).map((it:any,i:number)=>(
                      <tr key={i}>
                        <td className="py-2 px-3 text-gray-700">{it.product_name}</td>
                        <td className="py-2 px-3 text-right text-gray-700">{Number(it.ordered_qty).toFixed(0)}</td>
                        <td className="py-2 px-3 text-right">
                          <span className={Number(it.received_qty)>=Number(it.ordered_qty)?'text-green-600 font-semibold':'text-gray-600'}>
                            {Number(it.received_qty).toFixed(0)}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-500">रू {Number(it.unit_cost).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-blue-600" size={28} /></div>
        ) : (
          <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
            {filtered.length === 0 ? (
              <div className="p-12 text-center">
                <ClipboardList className="mx-auto text-gray-300 mb-3" size={36} />
                <p className="font-semibold text-gray-600 text-sm">No purchase orders found</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    {['PO Number','Supplier','Branch','Items','Value','Expected','Status',''].map(h=>(
                      <th key={h} className="py-3 px-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(o => (
                    <tr key={o.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-gray-800 text-xs">{o.po_number}</td>
                      <td className="py-3 px-4 text-gray-700 text-xs">{o.supplier_name}</td>
                      <td className="py-3 px-4 text-xs text-gray-500">{o.location_name}</td>
                      <td className="py-3 px-4 text-xs text-center text-gray-500">{o.item_count}</td>
                      <td className="py-3 px-4 text-xs text-right text-gray-600 font-medium">
                        रू {Number(o.total_order_value).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500">
                        {o.expected_date ? new Date(o.expected_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLES[o.status]??''}`}>
                          {STATUS_LABELS[o.status]??o.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <button onClick={() => loadDetail(o.id)}
                                className="text-blue-500 hover:text-blue-700 transition-colors">
                          <Eye size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
