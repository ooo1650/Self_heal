'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PackageCheck, Plus, ChevronRight, Loader2, X, Eye, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface GRN { id:string; grn_number:string; supplier_name:string; location_name:string;
  received_date:string; item_count:number; total_grn_value:string; po_id:string|null; }
interface Supplier { id:string; supplier_name:string; }
interface Product  { id:string; name:string; }
interface OpenPO   { id:string; po_number:string; supplier_name:string; supplier_id:string; }

export default function GrnPage() {
  const { user } = useAuth();
  const isOwner  = user?.role === 'owner';
  const [grns,      setGrns]      = useState<GRN[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products,  setProducts]  = useState<Product[]>([]);
  const [openPOs,   setOpenPOs]   = useState<OpenPO[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [showCreate,setShowCreate]= useState(false);
  const [detailId,  setDetailId]  = useState<string|null>(null);
  const [detail,    setDetail]    = useState<any>(null);
  const [form, setForm] = useState({
    supplier_id:'', po_id:'', grn_number:'', received_date: new Date().toISOString().slice(0,10),
    bill_reference:'', notes:''
  });
  const [lines, setLines] = useState<{product_id:string;received_qty:string;unit_cost:string}[]>([
    {product_id:'',received_qty:'',unit_cost:''}
  ]);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState('');
  const [success,   setSuccess]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, s, p, po] = await Promise.all([
        api.get('/api/grn'),
        api.get('/api/suppliers?active=true'),
        api.get('/api/products?active=true'),
        api.get('/api/purchase-orders?status=pending'),
      ]);
      setGrns(g.data.grns??[]);
      setSuppliers(s.data.suppliers??[]);
      setProducts(p.data.products??[]);
      setOpenPOs((po.data.purchase_orders??[]).map((o:any)=>({
        id:o.id, po_number:o.po_number, supplier_name:o.supplier_name, supplier_id:o.supplier_id
      })));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function handlePoSelect(poId:string) {
    const po = openPOs.find(p=>p.id===poId);
    setForm(f=>({...f, po_id:poId, supplier_id: po?.supplier_id ?? f.supplier_id}));
  }

  async function handleCreate(e:React.FormEvent) {
    e.preventDefault(); setSaving(true); setFormError(''); setSuccess('');
    try {
      const locId = user?.location_id ?? '';
      const { data } = await api.post('/api/grn', {
        supplier_id:    form.supplier_id,
        location_id:    locId,
        po_id:          form.po_id || undefined,
        grn_number:     form.grn_number.trim(),
        received_date:  form.received_date,
        bill_reference: form.bill_reference || undefined,
        notes:          form.notes || undefined,
        items: lines.filter(l=>l.product_id&&l.received_qty&&l.unit_cost).map(l=>({
          product_id: l.product_id, received_qty: Number(l.received_qty), unit_cost: Number(l.unit_cost),
        })),
      });
      const poUpdate = data.po_status_updated_to;
      setSuccess(`GRN ${data.grn.grn_number} created. Stock updated.${poUpdate?` PO → ${poUpdate}.`:''}`);
      setShowCreate(false); load();
    } catch (err:any) {
      devError('[grn/create]', err);
      setFormError(getErrorMessage(err));
    }
    finally { setSaving(false); }
  }

  async function loadDetail(id:string) {
    setDetailId(id);
    const { data } = await api.get(`/api/grn/${id}`);
    setDetail(data.grn);
  }

  const filtered = grns.filter(g =>
    !search || g.grn_number.toLowerCase().includes(search.toLowerCase()) ||
    g.supplier_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto font-sans">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <Link href="/procurement" className="hover:text-gray-600">Procurement</Link>
          <ChevronRight size={12} /><span className="text-gray-600">Goods Received</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Goods Received Notes</h2>
            <p className="text-sm text-gray-500 mt-0.5">Record deliveries and auto-update stock balances.</p>
          </div>
          {isOwner && (
            <Button onClick={() => { setShowCreate(true); setFormError(''); setSuccess('');
              setForm({ supplier_id:'', po_id:'', grn_number:'GRN-'+Date.now().toString().slice(-6),
                received_date: new Date().toISOString().slice(0,10), bill_reference:'', notes:'' });
              setLines([{product_id:'',received_qty:'',unit_cost:''}]); }}
                    className="bg-blue-600 text-white hover:bg-blue-700 gap-2 shrink-0">
              <Plus size={15} /> New GRN
            </Button>
          )}
        </div>

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-green-700 text-sm font-medium">
            ✓ {success}
          </div>
        )}

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-gray-400" size={15} />
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search GRN number or supplier…"
                   className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-4 py-2.5 focus:border-blue-500 outline-none" />
          </div>
        </div>

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{background:'rgba(0,0,0,0.6)'}}>
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl my-4">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-800">New Goods Received Note</h3>
                <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <form onSubmit={handleCreate} className="px-6 py-5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Link to PO (optional)</label>
                    <select value={form.po_id} onChange={e=>handlePoSelect(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs bg-white outline-none focus:border-blue-500">
                      <option value="">— Ad-hoc (no PO) —</option>
                      {openPOs.map(p=><option key={p.id} value={p.id}>{p.po_number} · {p.supplier_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Supplier *</label>
                    <select required value={form.supplier_id} onChange={e=>setForm(f=>({...f,supplier_id:e.target.value}))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs bg-white outline-none focus:border-blue-500">
                      <option value="">Select supplier</option>
                      {suppliers.map(s=><option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">GRN Number *</label>
                    <input required value={form.grn_number} onChange={e=>setForm(f=>({...f,grn_number:e.target.value}))}
                           className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Received date *</label>
                    <input required type="date" value={form.received_date} onChange={e=>setForm(f=>({...f,received_date:e.target.value}))}
                           className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Bill reference</label>
                    <input value={form.bill_reference} onChange={e=>setForm(f=>({...f,bill_reference:e.target.value}))}
                           className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                    <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
                           className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                </div>
                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-600">Received items *</label>
                    <button type="button" onClick={() => setLines(l=>[...l,{product_id:'',received_qty:'',unit_cost:''}])}
                            className="text-xs text-blue-600 font-semibold hover:text-blue-800">+ Add item</button>
                  </div>
                  {lines.map((l,i)=>(
                    <div key={i} className="grid grid-cols-12 gap-2 mb-2">
                      <select value={l.product_id} onChange={e=>{const n=[...lines];n[i]={...n[i],product_id:e.target.value};setLines(n);}}
                              className="col-span-6 border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                        <option value="">Product</option>
                        {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input type="number" min="0.001" step="0.001" placeholder="Qty" value={l.received_qty}
                             onChange={e=>{const n=[...lines];n[i]={...n[i],received_qty:e.target.value};setLines(n);}}
                             className="col-span-3 border border-gray-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                      <input type="number" min="0" step="0.01" placeholder="Cost" value={l.unit_cost}
                             onChange={e=>{const n=[...lines];n[i]={...n[i],unit_cost:e.target.value};setLines(n);}}
                             className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
                      <button type="button" onClick={() => setLines(l=>l.filter((_,j)=>j!==i))}
                              className="col-span-1 text-red-400 hover:text-red-600 text-center text-lg leading-none">✕</button>
                    </div>
                  ))}
                </div>
                {formError && <p className="text-xs text-red-600">{formError}</p>}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}
                          className="flex-1 border-gray-300 text-gray-700">Cancel</Button>
                  <Button type="submit" disabled={saving}
                          className="flex-1 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save GRN & update stock'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Detail modal */}
        {detailId && detail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{background:'rgba(0,0,0,0.6)'}}>
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl my-4">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-800">{detail.grn_number}</h3>
                <button onClick={() => { setDetailId(null); setDetail(null); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div className="px-6 py-5">
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div><p className="text-xs text-gray-400">Supplier</p><p className="font-semibold text-gray-800">{detail.supplier_name}</p></div>
                  <div><p className="text-xs text-gray-400">Branch</p><p className="font-semibold text-gray-800">{detail.location_name}</p></div>
                  <div><p className="text-xs text-gray-400">Date</p><p className="text-gray-700">{detail.received_date}</p></div>
                  <div><p className="text-xs text-gray-400">PO link</p>
                    <p className={`text-xs font-semibold ${detail.po_id?'text-blue-600':'text-gray-400'}`}>
                      {detail.po_id?'Linked':'Ad-hoc'}
                    </p>
                  </div>
                </div>
                <table className="w-full text-xs border-collapse">
                  <thead><tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-semibold text-gray-500">Product</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-500">Received</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-500">Unit Cost</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-500">Value</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {(detail.items??[]).map((it:any,i:number)=>(
                      <tr key={i}>
                        <td className="py-2 px-3 text-gray-700">{it.product_name}</td>
                        <td className="py-2 px-3 text-right font-semibold text-gray-700">{Number(it.received_qty).toFixed(3)}</td>
                        <td className="py-2 px-3 text-right text-gray-500">रू {Number(it.unit_cost).toFixed(2)}</td>
                        <td className="py-2 px-3 text-right font-semibold text-gray-800">
                          रू {(Number(it.received_qty)*Number(it.unit_cost)).toFixed(2)}
                        </td>
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
                <PackageCheck className="mx-auto text-gray-300 mb-3" size={36} />
                <p className="font-semibold text-gray-600 text-sm">No GRNs found</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    {['GRN #','Supplier','Branch','Date','Items','Value','PO',''].map(h=>(
                      <th key={h} className="py-3 px-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(g=>(
                    <tr key={g.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-gray-800 text-xs">{g.grn_number}</td>
                      <td className="py-3 px-4 text-xs text-gray-700">{g.supplier_name}</td>
                      <td className="py-3 px-4 text-xs text-gray-500">{g.location_name}</td>
                      <td className="py-3 px-4 text-xs text-gray-500">{new Date(g.received_date).toLocaleDateString()}</td>
                      <td className="py-3 px-4 text-xs text-center text-gray-500">{g.item_count}</td>
                      <td className="py-3 px-4 text-xs text-right font-medium text-gray-700">
                        रू {Number(g.total_grn_value).toFixed(2)}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          g.po_id ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'
                        }`}>{g.po_id?'Linked':'Ad-hoc'}</span>
                      </td>
                      <td className="py-3 px-4">
                        <button onClick={() => loadDetail(g.id)}
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
