'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth';
import api from '@/lib/api';
import { devError, getErrorMessage } from '@/lib/getErrorMessage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Package, 
  Plus, 
  Search, 
  Edit3, 
  AlertCircle, 
  Loader2, 
  ChevronRight, 
  Eye 
} from 'lucide-react';

interface Product {
  id: string;
  name: string;
  base_cost_price: string;
  mrp: string;
  vat_category: 'TAXABLE_13' | 'EXEMPT' | 'ZERO_RATED' | 'NON_TAXABLE';
  custom_vat_rate: string | null;
  resolved_vat_rate: number;
  low_stock_alert_qty: string;
  is_active: boolean;
  image_url: string | null;
  total_stock: number;
  barcode: string | null;
  barcodes: {
    barcode: string;
    unit_name: string;
    conversion_factor: string;
    sale_price: string;
    is_active: boolean;
  }[];
}

const VAT_LABELS = {
  TAXABLE_13: '13% VAT',
  EXEMPT: 'Exempt',
  ZERO_RATED: '0% Rated',
  NON_TAXABLE: 'Non-Taxable'
};

export default function ProductsPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters and Search
  const [searchTerm, setSearchTerm] = useState('');
  const [vatFilter, setVatFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data } = await api.get('/api/products');
      setProducts(data.products || []);
    } catch (err: any) {
      devError('[products/fetch]', err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchProducts();
    }
  }, [user]);

  const handleToggleStatus = async (product: Product) => {
    if (user?.role !== 'owner') return;

    const newStatus = !product.is_active;
    const actionWord = newStatus ? 'activate' : 'deactivate';

    if (!confirm(`Are you sure you want to ${actionWord} "${product.name}"?`)) {
      return;
    }

    try {
      setActionLoading(`status-${product.id}`);
      await api.patch(`/api/products/${product.id}/status`, { is_active: newStatus });
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_active: newStatus } : p));
    } catch (err: any) {
      devError('[products/toggle-status]', err);
      alert(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  if (!user) return null;

  const isOwner = user.role === 'owner';

  // Apply filters
  const filteredProducts = products.filter(product => {
    // 1. Search filter (Name or Barcode)
    const matchesSearch = 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.barcode && product.barcode.toLowerCase().includes(searchTerm.toLowerCase())) ||
      product.barcodes.some(b => b.barcode.toLowerCase().includes(searchTerm.toLowerCase()));

    // 2. VAT Filter
    const matchesVat = vatFilter === 'ALL' || product.vat_category === vatFilter;

    // 3. Status Filter
    const matchesStatus = 
      statusFilter === 'ALL' || 
      (statusFilter === 'ACTIVE' && product.is_active) || 
      (statusFilter === 'INACTIVE' && !product.is_active);

    return matchesSearch && matchesVat && matchesStatus;
  });

  const getStockBadge = (stock: number, alertQty: number) => {
    if (stock <= 0) {
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-100 text-red-800 border border-red-200/50">
          Out of Stock (0)
        </span>
      );
    }
    if (stock <= alertQty) {
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-200/50">
          Low Stock ({stock})
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-green-100 text-green-800 border border-green-200/50">
        In Stock ({stock})
      </span>
    );
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl mx-auto font-sans">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <span>Inventory</span>
          <ChevronRight size={12} />
          <span className="text-gray-600">Products</span>
        </div>

        {/* Header Block */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Product Catalog</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-xl">
              View and manage products, barcode variants, prices, and stock levels across the catalog.
            </p>
          </div>
          {isOwner && (
            <Link href="/products/new" passHref legacyBehavior>
              <Button className="bg-brand-blue hover:bg-brand-blue-hover text-white flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all shrink-0 shadow-xs cursor-pointer">
                <Plus size={16} />
                <span>Add Product</span>
              </Button>
            </Link>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 text-red-800">
            <AlertCircle className="shrink-0 mt-0.5" size={16} />
            <div className="text-sm">
              <p className="font-semibold">Failed to fetch products</p>
              <p className="text-xs text-red-600 mt-1">{error}</p>
              <button 
                onClick={fetchProducts} 
                className="mt-2 text-xs font-bold underline text-red-800 hover:text-red-900 cursor-pointer"
              >
                Retry Request
              </button>
            </div>
          </div>
        )}

        {/* Toolbar: Search and Filters */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative w-full sm:flex-1">
            <Search className="absolute left-3 top-3 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Search by name, barcode..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-4 py-2.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none"
            />
          </div>
          <div className="flex gap-3 w-full sm:w-auto shrink-0">
            <select
              value={vatFilter}
              onChange={e => setVatFilter(e.target.value)}
              className="text-xs border border-gray-300 rounded-lg p-2.5 bg-white font-medium text-gray-700 focus:border-brand-blue outline-none cursor-pointer"
            >
              <option value="ALL">All Taxes</option>
              <option value="TAXABLE_13">13% VAT</option>
              <option value="EXEMPT">Exempt</option>
              <option value="ZERO_RATED">0% Rated</option>
              <option value="NON_TAXABLE">Non-Taxable</option>
            </select>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-xs border border-gray-300 rounded-lg p-2.5 bg-white font-medium text-gray-700 focus:border-brand-blue outline-none cursor-pointer"
            >
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>
          </div>
        </div>

        {/* Loading Spinner */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="animate-spin text-brand-blue h-8 w-8 mb-2" />
            <p className="text-sm font-semibold text-gray-500">Loading catalog...</p>
          </div>
        ) : (
          <Card className="bg-white border-gray-200 shadow-xs overflow-hidden">
            {filteredProducts.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <div className="h-12 w-12 rounded-full bg-brand-blue-light text-brand-blue flex items-center justify-center mb-4">
                  <Package size={20} />
                </div>
                <h4 className="font-bold text-gray-800 text-base">No products found</h4>
                <p className="text-xs text-gray-500 max-w-sm mt-1.5 leading-relaxed">
                  Try adjusting your filters or search terms. If you haven&apos;t added any products yet, click &quot;Add Product&quot; to begin.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                      <th className="py-4 px-6 w-16 text-center">Image</th>
                      <th className="py-4 px-6">Product Details</th>
                      <th className="py-4 px-6">VAT Category</th>
                      <th className="py-4 px-6 text-right">Cost Price</th>
                      <th className="py-4 px-6 text-right">Sale Price</th>
                      <th className="py-4 px-6 text-right">MRP</th>
                      <th className="py-4 px-6 text-center">Stock</th>
                      {isOwner && <th className="py-4 px-6 text-center w-24">Active</th>}
                      <th className="py-4 px-6 text-center w-24">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {filteredProducts.map(product => {
                      const activeBarcode = product.barcode;
                      const hasImage = !!product.image_url;
                      const activeBarcodesCount = product.barcodes.filter(b => b.is_active).length;

                      // Find default/primary barcode details for sale price
                      const matchingBarcode = product.barcodes.find(b => b.barcode === product.barcode);
                      const displaySalePrice = matchingBarcode ? Number(matchingBarcode.sale_price) : Number(product.mrp);

                      return (
                        <tr 
                          key={product.id} 
                          className={`hover:bg-gray-50/50 transition-colors ${
                            !product.is_active ? 'bg-gray-50/30 opacity-70' : ''
                          }`}
                        >
                          {/* Image Column */}
                          <td className="py-4 px-6 text-center">
                            <div className="h-10 w-10 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
                              {hasImage ? (
                                <img 
                                  src={`${api.defaults.baseURL}${product.image_url}`} 
                                  alt={product.name} 
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <Package className="text-gray-400" size={16} />
                              )}
                            </div>
                          </td>

                          {/* Details Column */}
                          <td className="py-4 px-6">
                            <div className="font-semibold text-gray-800 hover:text-brand-blue transition-colors">
                              <Link href={`/products/${product.id}`}>
                                {product.name}
                              </Link>
                            </div>
                            {activeBarcode && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-sm border border-gray-200/50">
                                  {activeBarcode}
                                </span>
                                {activeBarcodesCount > 1 && (
                                  <span className="text-[9px] text-gray-400 font-semibold bg-gray-50 px-1 rounded-sm border">
                                    +{activeBarcodesCount - 1} variant(s)
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* VAT Category Badges */}
                          <td className="py-4 px-6">
                            <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${
                              product.vat_category === 'TAXABLE_13' 
                                ? 'bg-blue-50 text-blue-800 border-blue-200/50' 
                                : product.vat_category === 'EXEMPT' 
                                ? 'bg-green-50 text-green-800 border-green-200/50' 
                                : 'bg-gray-100 text-gray-700 border-gray-200/50'
                            }`}>
                              {VAT_LABELS[product.vat_category]}
                            </span>
                          </td>

                          {/* Prices */}
                          <td className="py-4 px-6 text-right font-medium text-gray-600">
                            रू {Number(product.base_cost_price).toFixed(2)}
                          </td>
                          <td className="py-4 px-6 text-right font-bold text-gray-800">
                            रू {displaySalePrice.toFixed(2)}
                          </td>
                          <td className="py-4 px-6 text-right font-medium text-gray-500 text-xs">
                            रू {Number(product.mrp).toFixed(2)}
                          </td>

                          {/* Stock Badge */}
                          <td className="py-4 px-6 text-center">
                            {getStockBadge(product.total_stock, Number(product.low_stock_alert_qty))}
                          </td>

                          {/* Active Switch Toggle */}
                          {isOwner && (
                            <td className="py-4 px-6 text-center">
                              <button
                                disabled={actionLoading === `status-${product.id}`}
                                onClick={() => handleToggleStatus(product)}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none focus:ring-1 focus:ring-brand-blue ${
                                  product.is_active ? 'bg-green-500' : 'bg-gray-300'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                    product.is_active ? 'translate-x-4' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </td>
                          )}

                          {/* Edit / View Button */}
                          <td className="py-4 px-6 text-center">
                            <Link href={`/products/${product.id}`} passHref legacyBehavior>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-xs h-8 px-2.5 flex items-center gap-1 border-gray-300 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold"
                              >
                                <Edit3 size={12} />
                                <span>{isOwner ? 'Edit' : 'View'}</span>
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
