'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Receipt, AlertTriangle, ExternalLink } from 'lucide-react';

const VAT_CATEGORIES = [
  { value:'TAXABLE_13',  rate:'13%', color:'bg-blue-50 text-blue-700 border-blue-200',
    description:'Standard commercial goods', examples:'FMCG, electronics, clothing, general retail' },
  { value:'EXEMPT',      rate:'0%',  color:'bg-green-50 text-green-700 border-green-200',
    description:'Basic essentials — VAT exempt by law', examples:'Basic foodstuffs, medicine, educational materials' },
  { value:'ZERO_RATED',  rate:'0%',  color:'bg-gray-50 text-gray-700 border-gray-200',
    description:'Zero-rated — exported or government specified', examples:'Export goods, government-specified zero-rated items' },
  { value:'NON_TAXABLE', rate:'N/A', color:'bg-yellow-50 text-yellow-700 border-yellow-200',
    description:'Outside VAT scope entirely', examples:'Financial services, VAT-exempt entities' },
];

export default function VATSettings() {
  const router = useRouter();
  const [customProducts, setCustomProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Backend access gate — 403 for limited staff, redirects gracefully
    api.get('/api/settings/vat').catch(err => {
      if (err?.response?.status === 403) {
        router.replace('/settings');
      }
    });

    api.get('/api/products').then(r => {
      const all = r.data.products ?? [];
      setCustomProducts(all.filter((p: any) => p.custom_vat_rate != null));
    }).finally(() => setLoading(false));
  }, [router]);

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-5 font-sans">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
              <Receipt className="text-orange-600" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800">VAT Settings</h1>
              <p className="text-xs text-gray-400 mt-0.5">Nepal VAT categories per Master Spec §6.1. Edit per-product VAT from the product page.</p>
            </div>
          </div>

          {/* VAT reference table */}
          <div className="space-y-3 mb-6">
            {VAT_CATEGORIES.map(cat => (
              <div key={cat.value} className={`border rounded-xl px-4 py-3 ${cat.color}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-bold">{cat.value}</span>
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full border ${cat.color}`}>{cat.rate}</span>
                </div>
                <p className="text-sm font-semibold">{cat.description}</p>
                <p className="text-xs opacity-70 mt-0.5">{cat.examples}</p>
              </div>
            ))}
          </div>

          {/* IRD disclaimer §21.1 */}
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-orange-500 shrink-0 mt-0.5" size={16} />
              <div>
                <p className="text-xs font-bold text-orange-700 mb-1">IRD Compliance Notice — §21.1</p>
                <p className="text-xs text-orange-600 leading-relaxed">
                  Receipts show full VAT breakdown but are <strong>NOT valid fiscal VAT invoices</strong> until
                  the CBMS module is active and registered with IRD. Merchants already VAT-registered with IRD
                  should be informed at onboarding.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Products with custom VAT rate */}
        <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800">Products with Custom VAT Rate</h2>
            <span className="text-xs text-gray-400">
              {loading ? '…' : `${customProducts.length} product${customProducts.length!==1?'s':''}`}
            </span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
          ) : customProducts.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No products have custom VAT rates — all use their category default.
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Product','Category','Custom Rate','MRP',''].map(h => (
                    <th key={h} className="py-2.5 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customProducts.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4 font-semibold text-gray-800">{p.name}</td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-500">{p.vat_category}</td>
                    <td className="py-3 px-4 font-bold text-orange-600">{p.custom_vat_rate}%</td>
                    <td className="py-3 px-4 text-xs text-gray-500">रू {Number(p.mrp).toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <Link href={`/products/${p.id}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800">
                        Edit <ExternalLink size={10} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
