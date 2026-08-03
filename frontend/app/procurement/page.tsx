'use client';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { Card } from '@/components/ui/card';
import { Truck, Users, ClipboardList, PackageCheck, ChevronRight } from 'lucide-react';

const TILES = [
  { href:'/procurement/suppliers', icon:Users,         label:'Suppliers',       desc:'Manage supplier contacts and PAN numbers.' },
  { href:'/procurement/orders',    icon:ClipboardList, label:'Purchase Orders', desc:'Create and track POs by supplier.' },
  { href:'/procurement/grn',       icon:PackageCheck,  label:'Goods Received',  desc:'Record deliveries and update stock.' },
];

export default function ProcurementPage() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl mx-auto font-sans">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <span>Procurement</span>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <Truck className="text-blue-600" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Procurement</h2>
            <p className="text-sm text-gray-500 mt-0.5">Manage suppliers, purchase orders, and goods received notes.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {TILES.map(t => (
            <Link key={t.href} href={t.href}>
              <Card className="p-5 bg-white border-gray-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all cursor-pointer h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center mb-3">
                  <t.icon className="text-blue-600" size={20} />
                </div>
                <h3 className="font-bold text-gray-800 mb-1">{t.label}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{t.desc}</p>
                <div className="flex items-center gap-1 mt-3 text-xs font-semibold text-blue-600">
                  Open <ChevronRight size={12} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
