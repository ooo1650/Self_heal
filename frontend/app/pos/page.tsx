'use client';
// app/pos/page.tsx
// POS Core Loop, Cashier Switch-In, Focused Mode, and Checkout Processes

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import api, {
  isCashierFocusMode,
  getCashierName,
  getCashierMaxDiscount,
  setCashierSession,
  clearCashierSession
} from '@/lib/api';
import { devError, getErrorMessage, getErrorMessageWithOverrides } from '@/lib/getErrorMessage';
import { useAuth } from '@/lib/auth';
import AppShell from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { printReceipt } from '@/utils/escpos';
import {
  Search,
  ShoppingCart,
  User,
  LogOut,
  ChevronRight,
  Plus,
  Trash2,
  QrCode,
  DollarSign,
  AlertTriangle,
  RotateCcw,
  CheckCircle,
  X,
  RefreshCw,
  SearchCode,
  Undo2
} from 'lucide-react';

interface CartItem {
  product_id: string;
  barcode: string;
  name: string;
  unit_name: string;
  unit_price: number;
  mrp: number;
  resolved_vat_rate: number; // e.g. 13 for 13%
  qty: number;
  line_discount_pct: number;
}

export default function PosPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Mode & Authorization States
  const [mounted, setMounted] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [cashiers, setCashiers] = useState<any[]>([]);
  const [checkingCashiers, setCheckingCashiers] = useState(true);
  
  // Cashier Switch-In States
  const [selectedCashier, setSelectedCashier] = useState<any | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [submittingPin, setSubmittingPin] = useState(false);

  // Shift States
  const [activeShift, setActiveShift] = useState<any | null>(null);
  const [checkingShift, setCheckingShift] = useState(true);
  const [openingBalance, setOpeningBalance] = useState('0');
  const [openingShift, setOpeningShift] = useState(false);

  // POS Till Loop States
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scannedCode, setScannedCode] = useState('');
  const [scanning, setScanning] = useState(false);
  
  // Bill Discount (Owner Only)
  const [billDiscountFlat, setBillDiscountFlat] = useState('0');
  const [billDiscountPct, setBillDiscountPct] = useState('0');

  // Checkout States
  const [checkoutMethod, setCheckoutMethod] = useState<'cash' | 'qr' | null>(null);
  const [amountTendered, setAmountTendered] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [submittingCheckout, setSubmittingCheckout] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState<any | null>(null);

  // Dynamic QR States
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrExpiresAt, setQrExpiresAt] = useState('');
  const [qrTimeLeft, setQrTimeLeft] = useState(0);
  const [qrPolling, setQrPolling] = useState(false);
  const [fonepayConfigured, setFonepayConfigured] = useState(false);
  const [checkingFonepay, setCheckingFonepay] = useState(true);

  // Register Product Modal (Owner Only)
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [unregisteredBarcode, setUnregisteredBarcode] = useState('');
  const [newProdName, setNewProdName] = useState('');
  const [newProdCost, setNewProdCost] = useState('');
  
  // Receipt printer toast notifications
  const [printToast, setPrintToast] = useState('');

  const triggerPrint = async (invoiceId: string) => {
    setPrintToast('Printing receipt...');
    const result = await printReceipt(invoiceId);
    if (result.ok) {
      setPrintToast('Receipt printed ✓');
    } else {
      setPrintToast(`Print skipped: ${result.error}`);
    }
    setTimeout(() => setPrintToast(''), 5000);
  };
  const [newProdMrp, setNewProdMrp] = useState('');
  const [newProdVatCat, setNewProdVatCat] = useState('TAXABLE_13');
  const [newProdCustomVat, setNewProdCustomVat] = useState('');
  const [newProdUnit, setNewProdUnit] = useState('Piece');
  const [newProdSalePrice, setNewProdSalePrice] = useState('');
  const [newProdAlertQty, setNewProdAlertQty] = useState('10');
  const [registeringProduct, setRegisteringProduct] = useState(false);
  const [registerError, setRegisterError] = useState('');

  // Close Shift Modal
  const [isCloseShiftOpen, setIsCloseShiftOpen] = useState(false);
  const [closingBalance, setClosingBalance] = useState('');
  const [closeShiftPin, setCloseShiftPin] = useState('');
  const [closeShiftError, setCloseShiftError] = useState('');
  const [closingShift, setClosingShift] = useState(false);
  const [closedShiftSummary, setClosedShiftSummary] = useState<any | null>(null);

  // Sales Returns Modal
  const [isReturnsOpen, setIsReturnsOpen] = useState(false);
  const [searchInvoiceNo, setSearchInvoiceNo] = useState('');
  const [searchingInvoices, setSearchingInvoices] = useState(false);
  const [invoiceSearchResults, setInvoiceSearchResults] = useState<any[]>([]);
  const [selectedReturnInvoice, setSelectedReturnInvoice] = useState<any | null>(null);
  const [returnItemsQty, setReturnItemsQty] = useState<Record<string, number>>({});
  const [returnNotes, setReturnNotes] = useState('');
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnError, setReturnError] = useState('');

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Setup mounted and focus states
  useEffect(() => {
    setMounted(true);
    setIsFocusMode(isCashierFocusMode());
  }, []);

  // Listen for cashier session expiry dispatched by Axios interceptor.
  // Show a clear banner instead of silently reloading.
  useEffect(() => {
    function onCashierExpired() {
      setIsFocusMode(false);
      setPinError('Your cashier session has expired. Please switch in again.');
    }
    window.addEventListener('cashier-session-expired', onCashierExpired);
    return () => window.removeEventListener('cashier-session-expired', onCashierExpired);
  }, []);

  // Fetch cashier list and payment setup info
  useEffect(() => {
    if (!mounted || authLoading || !user) return;

    async function loadInitialData() {
      try {
        setCheckingCashiers(true);
        const { data } = await api.get('/api/cashiers/active-pinned');
        setCashiers(data.cashiers || []);
      } catch (err) {
        devError('[pos/load-cashiers]', err);
      } finally {
        setCheckingCashiers(false);
      }

      try {
        setCheckingFonepay(true);
        const { data } = await api.get('/api/settings/payment-credentials');
        setFonepayConfigured(!!data.fonepay_enabled);
      } catch (err) {
        // Degrade gracefully — cashiers may get 403 if endpoint not available
        devError('[pos/load-fonepay-settings]', err);
        setFonepayConfigured(false);
      } finally {
        setCheckingFonepay(false);
      }
    }

    loadInitialData();
  }, [mounted, authLoading, user]);

  // Check active shift
  const checkActiveShift = async () => {
    try {
      setCheckingShift(true);
      const { data } = await api.get('/api/shifts?status=open');
      if (data.shifts && data.shifts.length > 0) {
        setActiveShift(data.shifts[0]);
      } else {
        setActiveShift(null);
      }
    } catch (err) {
      devError('[pos/check-active-shift]', err);
    } finally {
      setCheckingShift(false);
    }
  };

  useEffect(() => {
    if (!mounted) return;
    if (isFocusMode || (cashiers.length === 0 && !checkingCashiers)) {
      checkActiveShift();
    }
  }, [isFocusMode, cashiers, checkingCashiers, mounted]);

  // Global keydown capture to redirect typing to scanner
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      // If alphanumeric key, focus and start typing in the barcode box
      if (/^[a-zA-Z0-9]$/.test(e.key) && barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Timer for QR countdown
  useEffect(() => {
    if (!qrExpiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((new Date(qrExpiresAt).getTime() - Date.now()) / 1000));
      setQrTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt]);

  // Poll QR payment status
  useEffect(() => {
    if (!qrPolling || !checkoutSuccess?.id) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const { data } = await api.get(`/api/payments/status/${checkoutSuccess.id}`);
        if (data.status === 'completed') {
          setQrPolling(false);
          // Load full invoice details to print
          const res = await api.get(`/api/invoices/${checkoutSuccess.id}`);
          const fullInvoice = res.data.invoice;
          
          // Trigger real receipt printer
          triggerPrint(checkoutSuccess.id);
          
          setCart([]);
          setCheckoutSuccess({
            ...checkoutSuccess,
            payment_status: 'completed',
            invoice_number: fullInvoice.invoice_number
          });
        } else if (data.status === 'expired' || data.status === 'failed') {
          setQrPolling(false);
        }
      } catch {
        // Transient poll failure — keep polling silently
      }
    };

    const interval = setInterval(() => {
      if (qrTimeLeft > 0 && qrPolling) {
        poll();
      } else {
        setQrPolling(false);
        clearInterval(interval);
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [qrPolling, checkoutSuccess, qrTimeLeft, user]);

  if (authLoading || checkingCashiers) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
          <p className="text-sm font-medium text-gray-500">Initializing POS environment...</p>
        </div>
      </div>
    );
  }

  // Helper to re-focus scan box
  const focusScanBox = () => {
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 100);
  };

  // ── Handlers ───────────────────────────────────────────────────────────────

  // Cashier PIN entry submit
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCashier || pin.length !== 4) return;

    try {
      setSubmittingPin(true);
      setPinError('');
      const { data } = await api.post('/api/pos/switch-cashier', {
        cashier_id: selectedCashier.id,
        pin
      });

      setCashierSession(data.cashier_token, data.cashier_name, data.max_item_discount_pct);
      setIsFocusMode(true);
      setPin('');
      setSelectedCashier(null);
    } catch (err: any) {
      devError('[pos/pin-submit]', err);
      const status  = err?.response?.status;
      const errCode = err?.response?.data?.error;
      const remaining = err?.response?.data?.remaining_minutes;

      if (status === 401 && errCode === 'INVALID_PIN') {
        const attemptsLeft = err?.response?.data?.attempts_remaining;
        setPinError(
          attemptsLeft != null
            ? `Incorrect PIN. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`
            : 'Incorrect PIN. Please try again.'
        );
      } else if (status === 423 || errCode === 'PIN_LOCKED') {
        setPinError(
          remaining != null
            ? `Too many wrong attempts. PIN locked for ${remaining} minute${remaining !== 1 ? 's' : ''}.`
            : 'PIN is locked due to too many wrong attempts. Try again later.'
        );
      } else {
        setPinError(getErrorMessageWithOverrides(err, { 404: 'Cashier account not found.' }));
      }
      setPin('');
    } finally {
      setSubmittingPin(false);
    }
  };

  // Open Shift submit
  const handleOpenShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      setOpeningShift(true);
      const { data } = await api.post('/api/shifts/open', {
        location_id: user.location_id,
        opening_cash_balance: parseFloat(openingBalance) || 0
      });
      setActiveShift(data.shift);
      focusScanBox();
    } catch (err: any) {
      devError('[pos/open-shift]', err);
      alert(getErrorMessage(err));
    } finally {
      setOpeningShift(false);
    }
  };

  // Barcode search scan
  const handleBarcodeScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scannedCode.trim();
    if (!code) return;
    handleScan(code);
  };

  const handleScan = async (code: string) => {
    try {
      setScanning(true);
      const { data } = await api.post('/api/pos/scan', { barcode: code });
      
      if (data.status === 'FOUND') {
        const prod = data.product;
        setCart(prev => {
          const idx = prev.findIndex(item => item.barcode === prod.barcode);
          if (idx > -1) {
            const next = [...prev];
            next[idx].qty += 1;
            return next;
          } else {
            return [
              ...prev,
              {
                product_id: prod.product_id,
                barcode: prod.barcode,
                name: prod.name,
                unit_name: prod.unit_name || 'Piece',
                unit_price: Number(prod.sale_price),
                mrp: Number(prod.mrp),
                resolved_vat_rate: Number(prod.resolved_vat_rate || 0),
                qty: 1,
                line_discount_pct: 0
              }
            ];
          }
        });
        setScannedCode('');
      } else {
        // UNREGISTERED
        setUnregisteredBarcode(code);
        if (user?.role === 'owner') {
          setNewProdName('');
          setNewProdCost('');
          setNewProdMrp('');
          setNewProdVatCat('TAXABLE_13');
          setNewProdCustomVat('');
          setNewProdUnit('Piece');
          setNewProdSalePrice('');
          setNewProdAlertQty('10');
          setRegisterError('');
          setIsRegisterOpen(true);
        } else {
          alert('That barcode is not registered. Ask the owner to set it up.');
          setScannedCode('');
        }
      }
    } catch (err: any) {
      devError('[pos/scan]', err);
      alert(getErrorMessage(err));
    } finally {
      setScanning(false);
      focusScanBox();
    }
  };

  // Product register submit
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName || !newProdCost || !newProdMrp || !newProdUnit || !newProdSalePrice) {
      setRegisterError('All required fields must be completed.');
      return;
    }

    const mrpNum = parseFloat(newProdMrp);
    const costNum = parseFloat(newProdCost);
    const saleNum = parseFloat(newProdSalePrice);

    if (mrpNum < costNum) {
      setRegisterError('MRP cannot be lower than the product cost price.');
      return;
    }

    try {
      setRegisteringProduct(true);
      setRegisterError('');

      // Step 1: Create the product
      const prodRes = await api.post('/api/products', {
        name: newProdName,
        base_cost_price: costNum,
        mrp: mrpNum,
        vat_category: newProdVatCat,
        custom_vat_rate: newProdVatCat === 'CUSTOM' ? parseFloat(newProdCustomVat) : null,
        low_stock_alert_qty: parseInt(newProdAlertQty) || 10
      });

      const newProduct = prodRes.data;

      // Step 2: Associate scanned barcode
      const bcRes = await api.post(`/api/products/${newProduct.id}/barcodes`, {
        barcode: unregisteredBarcode,
        unit_name: newProdUnit,
        conversion_factor: 1.0,
        sale_price: saleNum
      });

      // Add to cart
      setCart(prev => [
        ...prev,
        {
          product_id: newProduct.id,
          barcode: unregisteredBarcode,
          name: newProduct.name,
          unit_name: bcRes.data.unit_name,
          unit_price: Number(bcRes.data.sale_price),
          mrp: Number(newProduct.mrp),
          resolved_vat_rate: Number(newProduct.resolved_vat_rate || 0),
          qty: 1,
          line_discount_pct: 0
        }
      ]);

      setIsRegisterOpen(false);
      setScannedCode('');
      focusScanBox();
    } catch (err: any) {
      devError('[pos/register-product]', err);
      setRegisterError(getErrorMessage(err));
    } finally {
      setRegisteringProduct(false);
    }
  };

  // Update item quantity
  const updateQty = (barcode: string, newQty: number) => {
    if (newQty < 1) return;
    setCart(prev =>
      prev.map(item => (item.barcode === barcode ? { ...item, qty: newQty } : item))
    );
  };

  // Update line discount
  const updateLineDiscount = (barcode: string, disc: number) => {
    let finalDisc = Math.max(0, Math.min(100, disc));
    
    // Check cashier discount cap
    const cap = getCashierMaxDiscount();
    if (cap !== null && isFocusMode) {
      finalDisc = Math.min(finalDisc, cap);
    }

    setCart(prev =>
      prev.map(item => (item.barcode === barcode ? { ...item, line_discount_pct: finalDisc } : item))
    );
  };

  // Remove item from cart
  const removeItem = (barcode: string) => {
    setCart(prev => prev.filter(item => item.barcode !== barcode));
    focusScanBox();
  };

  // Calculations
  const cartSummary = (() => {
    let subtotal = 0;
    let taxAmount = 0;
    
    cart.forEach(item => {
      const gross = item.unit_price * item.qty;
      const itemDisc = gross * (item.line_discount_pct / 100);
      const taxable = gross - itemDisc;
      const tax = taxable * (item.resolved_vat_rate / 100);
      
      subtotal += taxable + tax;
      taxAmount += tax;
    });

    const flatDisc = parseFloat(billDiscountFlat) || 0;
    const pctDisc = parseFloat(billDiscountPct) || 0;
    const computedBillDisc = Math.max(flatDisc, subtotal * (pctDisc / 100));

    const total = Math.max(0, subtotal - computedBillDisc);

    return {
      subtotal: parseFloat(subtotal.toFixed(2)),
      tax: parseFloat(taxAmount.toFixed(2)),
      billDiscount: parseFloat(computedBillDisc.toFixed(2)),
      total: parseFloat(total.toFixed(2))
    };
  })();

  // Checkout process
  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    const method = checkoutMethod;
    if (!method) return;

    if (method === 'cash' && !amountTendered) {
      setCheckoutError('Please enter the cash amount tendered by the customer.');
      return;
    }

    const tenderedVal = parseFloat(amountTendered) || 0;
    if (method === 'cash' && tenderedVal < cartSummary.total) {
      setCheckoutError(`Tendered cash must cover the total amount of $${cartSummary.total.toFixed(2)}`);
      return;
    }

    try {
      setSubmittingCheckout(true);
      setCheckoutError('');

      const payload = {
        idempotency_key: crypto.randomUUID(),
        items: cart.map(item => ({
          product_id: item.product_id,
          scanned_barcode: item.barcode,
          quantity_sold: item.qty,
          item_discount_pct: item.line_discount_pct
        })),
        bill_discount_flat: isFocusMode ? 0 : parseFloat(billDiscountFlat) || 0,
        bill_discount_pct: isFocusMode ? 0 : parseFloat(billDiscountPct) || 0,
        payment_method: method,
        amount_tendered: method === 'cash' ? tenderedVal : null
      };

      const { data } = await api.post('/api/invoices/checkout', payload);

      if (method === 'cash') {
        const fullInvoice = data.invoice;
        
        // Print the receipt
        triggerPrint(fullInvoice.id);
        
        setCart([]);
        setCheckoutSuccess(fullInvoice);
        setCheckoutMethod(null);
        setAmountTendered('');
      } else {
        // QR Code flow
        const initRes = await api.post('/api/payments/initiate', {
          invoice_id: data.invoice.id
        });
        
        setCheckoutSuccess(data.invoice);
        setQrDataUrl(initRes.data.qr_data_url);
        setQrExpiresAt(initRes.data.expires_at);
        setQrTimeLeft(initRes.data.expires_in_seconds || 300);
        setQrPolling(true);
      }
    } catch (err: any) {
      devError('[pos/checkout]', err);
      setCheckoutError(getErrorMessage(err));
    } finally {
      setSubmittingCheckout(false);
    }
  };

  // Close shift submit
  const handleCloseShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;

    if (!closingBalance) {
      setCloseShiftError('Please enter the closing cash balance in the drawer.');
      return;
    }

    if (isFocusMode && !closeShiftPin) {
      setCloseShiftError('A cashier PIN confirmation is required to close this shift.');
      return;
    }

    try {
      setClosingShift(true);
      setCloseShiftError('');

      const payload: any = {
        closing_cash_balance: parseFloat(closingBalance) || 0
      };

      if (isFocusMode) {
        payload.pin = closeShiftPin;
      }

      const { data } = await api.post(`/api/shifts/${activeShift.id}/close`, payload);

      setClosedShiftSummary(data.shift || {
        closing_cash_balance: parseFloat(closingBalance),
        expected_cash_balance: data.expected_cash || 0,
        cash_difference: data.cash_difference || 0
      });
    } catch (err: any) {
      devError('[pos/close-shift]', err);
      setCloseShiftError(getErrorMessage(err));
    } finally {
      setClosingShift(false);
    }
  };

  // Complete Shift Close overlay and leave
  const confirmShiftCloseReport = () => {
    setIsCloseShiftOpen(false);
    setClosedShiftSummary(null);
    setClosingBalance('');
    setCloseShiftPin('');
    setActiveShift(null);

    if (isFocusMode) {
      clearCashierSession();
      setIsFocusMode(false);
    }
    router.replace('/dashboard');
  };

  // Search invoice for returns
  const handleInvoiceSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInvoiceNo.trim()) return;

    try {
      setSearchingInvoices(true);
      setReturnError('');
      const { data } = await api.get(`/api/invoices?invoice_number=${searchInvoiceNo.trim()}`);
      setInvoiceSearchResults(data.invoices || []);
      if (data.invoices?.length === 0) {
        setReturnError('No invoices found matching that receipt number.');
      }
    } catch (err: any) {
      devError('[pos/search-invoices]', err);
      setReturnError('Search failed. Please try again.');
    } finally {
      setSearchingInvoices(false);
    }
  };

  // Select invoice to return
  const loadReturnInvoiceDetails = async (invoiceId: string) => {
    try {
      setSearchingInvoices(true);
      setReturnError('');
      const { data } = await api.get(`/api/invoices/${invoiceId}`);
      setSelectedReturnInvoice(data.invoice);
      
      // Initialize return qtys to 0
      const qtys: Record<string, number> = {};
      data.invoice.items?.forEach((item: any) => {
        qtys[item.id] = 0;
      });
      setReturnItemsQty(qtys);
    } catch (err: any) {
      devError('[pos/load-return-invoice]', err);
      setReturnError('Failed to retrieve invoice details.');
    } finally {
      setSearchingInvoices(false);
    }
  };

  // Submit Returns
  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReturnInvoice) return;

    const returnItems = Object.entries(returnItemsQty)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => ({
        invoice_item_id: id,
        returned_qty: qty
      }));

    if (returnItems.length === 0) {
      setReturnError('Please select at least 1 item with a quantity to return.');
      return;
    }

    try {
      setSubmittingReturn(true);
      setReturnError('');

      await api.post(`/api/invoices/${selectedReturnInvoice.id}/return`, {
        idempotency_key: crypto.randomUUID(),
        items: returnItems,
        notes: returnNotes
      });

      alert('Credit note issued. Stock balance has been restored.');
      setIsReturnsOpen(false);
      setSelectedReturnInvoice(null);
      setInvoiceSearchResults([]);
      setSearchInvoiceNo('');
      setReturnNotes('');
      focusScanBox();
    } catch (err: any) {
      devError('[pos/return-submit]', err);
      setReturnError(getErrorMessage(err));
    } finally {
      setSubmittingReturn(false);
    }
  };

  // ── Render Parts ───────────────────────────────────────────────────────────

  // Render 1: Cashier switch-in grid (Picker)
  if (!isFocusMode && cashiers.length > 0) {
    return (
      <div className="min-h-screen bg-brand-blue flex items-center justify-center p-6 text-white">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-extrabold tracking-tight">POS Till Terminal</h1>
            <p className="text-white/70 text-sm">Select cashier account to switch into focused till mode</p>
          </div>

          {!selectedCashier ? (
            <div className="grid grid-cols-2 gap-4 max-h-[350px] overflow-y-auto pr-1">
              {cashiers.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCashier(c);
                    setPin('');
                    setPinError('');
                  }}
                  className="bg-white/10 hover:bg-white/20 border border-white/10 hover:border-white/30 rounded-xl p-5 text-left transition-all duration-200 shadow-sm flex flex-col justify-between h-32 focus:outline-none focus:ring-2 focus:ring-white/50"
                >
                  <User size={24} className="text-white/70" />
                  <span className="font-semibold truncate text-sm">{c.full_name}</span>
                </button>
              ))}
              {/* Back to dashboard */}
              <button
                onClick={() => router.replace('/dashboard')}
                className="col-span-2 mt-4 bg-white text-brand-blue font-bold py-3 rounded-lg text-center hover:bg-white/90 transition-colors"
              >
                Back to Dashboard
              </button>
            </div>
          ) : (
            <Card className="bg-white text-gray-900 border-none shadow-2xl rounded-2xl overflow-hidden">
              <CardHeader className="text-center bg-gray-50 border-b border-gray-100 py-6">
                <CardTitle className="text-lg font-bold text-gray-800">Verify Cashier PIN</CardTitle>
                <CardDescription className="text-xs">
                  Enter 4-digit code for <strong>{selectedCashier.full_name}</strong>
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {pinError && (
                  <div className="bg-red-50 text-red-600 border border-red-100 rounded-lg p-3 text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0" />
                    <span>{pinError}</span>
                  </div>
                )}

                <div className="flex justify-center gap-3">
                  {[0, 1, 2, 3].map(i => (
                    <div
                      key={i}
                      className={`h-12 w-12 rounded-lg border-2 flex items-center justify-center font-bold text-lg transition-all ${
                        pin.length > i
                          ? 'border-brand-blue bg-brand-blue/5 text-brand-blue'
                          : 'border-gray-200 text-gray-300'
                      }`}
                    >
                      {pin.length > i ? '•' : ''}
                    </div>
                  ))}
                </div>

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => pin.length < 4 && setPin(p => p + num)}
                      className="h-12 text-sm font-semibold rounded-lg hover:bg-gray-100 active:bg-gray-200 border border-gray-200/60 flex items-center justify-center focus:outline-none transition-all"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPin('')}
                    className="h-12 text-xs font-bold rounded-lg text-red-600 hover:bg-red-50 flex items-center justify-center focus:outline-none"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => pin.length < 4 && setPin(p => p + '0')}
                    className="h-12 text-sm font-semibold rounded-lg hover:bg-gray-100 active:bg-gray-200 border border-gray-200/60 flex items-center justify-center focus:outline-none transition-all"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={() => setPin(p => p.slice(0, -1))}
                    className="h-12 text-xs font-bold rounded-lg text-gray-600 hover:bg-gray-100 flex items-center justify-center focus:outline-none"
                  >
                    Back
                  </button>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSelectedCashier(null);
                      setPin('');
                      setPinError('');
                    }}
                    className="flex-1 text-gray-500 hover:bg-gray-50 font-semibold"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handlePinSubmit}
                    disabled={pin.length !== 4 || submittingPin}
                    className="flex-1 bg-brand-blue hover:bg-brand-blue-hover text-white font-semibold shadow-md"
                  >
                    {submittingPin ? 'Verifying...' : 'Submit'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // Render 2: Shift Gate (dialog block if no open shift)
  if (!checkingShift && !activeShift) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="bg-brand-blue text-white p-6 text-center">
            <ShoppingCart className="mx-auto h-12 w-12 text-white/80 mb-3" />
            <h2 className="text-xl font-bold">POS Cash Shift Required</h2>
            <p className="text-xs text-white/70 mt-1">Open a till shift to begin processing barcode transactions</p>
          </div>

          <form onSubmit={handleOpenShiftSubmit} className="p-6 space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
                Opening Cash Drawer Balance
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 font-bold text-sm">
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={openingBalance}
                  onChange={e => setOpeningBalance(e.target.value)}
                  className="w-full pl-8 pr-4 py-3 rounded-lg border border-gray-300 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 font-bold text-lg text-gray-800 outline-none"
                  required
                />
              </div>
              <p className="text-[10px] text-gray-400 leading-normal">
                Input the total cash starting balance in the drawer for verification.
              </p>
            </div>

            <div className="flex gap-4 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (isFocusMode) {
                    clearCashierSession();
                    setIsFocusMode(false);
                  }
                  router.replace('/dashboard');
                }}
                className="flex-1 py-3 text-gray-500 font-semibold border-gray-300"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={openingShift}
                className="flex-1 py-3 bg-brand-blue hover:bg-brand-blue-hover text-white font-bold shadow-md"
              >
                {openingShift ? 'Opening...' : 'Open Shift'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Render 3: Active POS Till Screen
  return (
    <AppShell>
      <div className="space-y-6 flex flex-col h-full">
        {/* Top Header section in focused mode */}
        {isFocusMode && (
          <div className="bg-white border border-gray-200 p-4 rounded-xl flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-3">
              <div className="bg-green-100 text-green-800 px-2.5 py-1 rounded-full text-xs font-extrabold border border-green-200/50 flex items-center gap-1.5 uppercase tracking-wider">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Shift Active
              </div>
              <div className="text-xs text-gray-400">
                Opened at: {activeShift?.opened_at ? new Date(activeShift.opened_at).toLocaleTimeString() : ''}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm font-semibold text-gray-800">
                Cashier: <span className="text-brand-blue">{getCashierName() || user?.full_name}</span>
              </div>
              <Button
                onClick={() => {
                  setClosingBalance('');
                  setCloseShiftPin('');
                  setCloseShiftError('');
                  setIsCloseShiftOpen(true);
                }}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs px-4 py-2 h-9 flex items-center gap-1.5 shadow-xs"
              >
                <LogOut size={14} />
                Close Shift
              </Button>
            </div>
          </div>
        )}

        {/* POS Workspaces */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 items-start">
          
          {/* LEFT 2/3 COLUMN: Barcode Scan Box + Cart Table */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Scan Box */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs space-y-3">
              <form onSubmit={handleBarcodeScanSubmit} className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute inset-y-0 left-0 pl-3.5 h-full w-5 text-gray-400 flex items-center" />
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    placeholder="Scan product barcode (or type and hit Enter)..."
                    value={scannedCode}
                    onChange={e => setScannedCode(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 outline-none text-sm transition-all"
                    autoFocus
                  />
                  {scanning && (
                    <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center">
                      <RefreshCw className="h-4 w-4 text-brand-blue animate-spin" />
                    </div>
                  )}
                </div>
                <Button
                  type="submit"
                  disabled={scanning || !scannedCode.trim()}
                  className="bg-brand-blue hover:bg-brand-blue-hover text-white font-semibold px-6"
                >
                  Enter
                </Button>
              </form>
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span>Scanner captured automatically. Try typing without clicking the box.</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsReturnsOpen(true)}
                    className="text-brand-blue hover:underline font-bold flex items-center gap-1"
                  >
                    <RotateCcw size={12} />
                    Process Returns
                  </button>
                  {!isFocusMode && (
                    <>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => {
                          setClosingBalance('');
                          setCloseShiftError('');
                          setIsCloseShiftOpen(true);
                        }}
                        className="text-red-500 hover:underline font-bold flex items-center gap-1"
                      >
                        Close Shift
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Cart Table */}
            <Card className="bg-white border-gray-200 shadow-xs rounded-xl overflow-hidden min-h-[350px] flex flex-col">
              <CardHeader className="bg-gray-50 border-b border-gray-100 py-4 px-5 flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                  <ShoppingCart size={18} className="text-brand-blue" />
                  <CardTitle className="text-sm font-bold text-gray-800">Sales Register Cart</CardTitle>
                </div>
                <span className="text-xs font-semibold text-gray-500 bg-gray-200/60 px-2.5 py-0.5 rounded-full">
                  {cart.reduce((s, i) => s + i.qty, 0)} items
                </span>
              </CardHeader>
              <CardContent className="p-0 flex-1 overflow-x-auto">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 text-gray-400 space-y-3">
                    <ShoppingCart size={48} className="stroke-1 text-gray-300" />
                    <p className="text-sm">Till cart is empty. Scan barcodes to register items.</p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs min-w-[600px]">
                    <thead className="bg-gray-50/50 text-[10px] text-gray-400 uppercase font-semibold border-b border-gray-100">
                      <tr>
                        <th className="py-3 px-5">Product Details</th>
                        <th className="py-3 px-3 text-center">Unit</th>
                        <th className="py-3 px-3 text-center w-24">Qty</th>
                        <th className="py-3 px-3 text-right">Price</th>
                        <th className="py-3 px-3 text-center w-24">Discount%</th>
                        <th className="py-3 px-5 text-right w-28">Row Total</th>
                        <th className="py-3 px-3 text-center w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                      {cart.map(item => {
                        const rowGross = item.unit_price * item.qty;
                        const rowDisc = rowGross * (item.line_discount_pct / 100);
                        const rowTax = (rowGross - rowDisc) * (item.resolved_vat_rate / 100);
                        const rowTotal = rowGross - rowDisc + rowTax;

                        return (
                          <tr key={item.barcode} className="hover:bg-gray-50/50 transition-colors">
                            <td className="py-4 px-5">
                              <div className="font-semibold text-gray-900 leading-tight">{item.name}</div>
                              <div className="text-[10px] text-gray-400 mt-0.5">Code: {item.barcode}</div>
                            </td>
                            <td className="py-4 px-3 text-center text-gray-500 font-semibold">{item.unit_name}</td>
                            <td className="py-4 px-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => updateQty(item.barcode, item.qty - 1)}
                                  className="h-6 w-6 rounded border border-gray-200 flex items-center justify-center hover:bg-gray-100 active:bg-gray-250 font-bold"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  value={item.qty}
                                  onChange={e => updateQty(item.barcode, parseInt(e.target.value) || 1)}
                                  className="w-10 text-center font-bold border border-gray-200 rounded py-0.5"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateQty(item.barcode, item.qty + 1)}
                                  className="h-6 w-6 rounded border border-gray-200 flex items-center justify-center hover:bg-gray-100 active:bg-gray-250 font-bold"
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="py-4 px-3 text-right font-semibold text-gray-900">
                              ${item.unit_price.toFixed(2)}
                            </td>
                            <td className="py-4 px-3 text-center">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.5"
                                value={item.line_discount_pct || ''}
                                placeholder="0"
                                onChange={e => updateLineDiscount(item.barcode, parseFloat(e.target.value) || 0)}
                                className="w-16 text-center font-bold border border-gray-200 rounded py-0.5"
                              />
                            </td>
                            <td className="py-4 px-5 text-right font-bold text-gray-900">
                              ${rowTotal.toFixed(2)}
                            </td>
                            <td className="py-4 px-3 text-center">
                              <button
                                onClick={() => removeItem(item.barcode)}
                                className="text-gray-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* RIGHT 1/3 COLUMN: Totals Panel + Checkout Actions */}
          <div className="space-y-6">
            
            {/* Totals Card */}
            <Card className="bg-white border-gray-200 shadow-xs rounded-xl overflow-hidden">
              <CardHeader className="bg-gray-50 border-b border-gray-100 py-4 px-5">
                <CardTitle className="text-sm font-bold text-gray-800">Order Totals</CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-4 font-semibold text-xs text-gray-650">
                <div className="flex justify-between items-center">
                  <span>Subtotal (VAT Incl.)</span>
                  <span className="text-gray-900 font-bold">${cartSummary.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-gray-500">
                  <span>Resolved VAT (Included)</span>
                  <span className="font-semibold">${cartSummary.tax.toFixed(2)}</span>
                </div>

                {/* Bill Discount (Owner Only) */}
                {!isFocusMode ? (
                  <div className="border-t border-gray-100 pt-3 space-y-2.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                      Bill-Level Discount (Owner Only)
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-gray-400 mb-1 block">Flat Amount ($)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={billDiscountFlat}
                          onChange={e => {
                            setBillDiscountFlat(e.target.value);
                            setBillDiscountPct('0');
                          }}
                          className="w-full border border-gray-200 rounded p-1.5 font-bold text-gray-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 mb-1 block">Percentage (%)</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={billDiscountPct}
                          onChange={e => {
                            setBillDiscountPct(e.target.value);
                            setBillDiscountFlat('0');
                          }}
                          className="w-full border border-gray-200 rounded p-1.5 font-bold text-gray-800 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center text-gray-400 border-t border-gray-100 pt-3">
                    <span>Bill Discount</span>
                    <span className="italic">Unavailable for Cashiers</span>
                  </div>
                )}

                {cartSummary.billDiscount > 0 && (
                  <div className="flex justify-between items-center text-green-600 bg-green-50 p-2 rounded">
                    <span>Applied Discount</span>
                    <span>-${cartSummary.billDiscount.toFixed(2)}</span>
                  </div>
                )}

                <div className="border-t border-gray-200 pt-4 flex justify-between items-center text-gray-900">
                  <span className="text-sm font-bold">Grand Total</span>
                  <span className="text-2xl font-black text-brand-blue">${cartSummary.total.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Checkout Action Panel */}
            <Card className="bg-white border-gray-200 shadow-xs rounded-xl p-5 space-y-4">
              <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">Select Checkout Method</h3>
              
              {checkoutError && (
                <div className="bg-red-50 text-red-600 border border-red-100 rounded-lg p-3.5 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{checkoutError}</span>
                </div>
              )}

              {checkoutSuccess && !checkoutMethod && (
                <div className="bg-green-50 text-green-800 border border-green-100 rounded-lg p-4 space-y-2 text-xs font-medium">
                  <div className="flex items-center gap-1.5 text-green-900 font-bold">
                    <CheckCircle size={16} className="text-green-600" />
                    <span>Transaction Complete</span>
                  </div>
                  <p>Invoice <strong>{checkoutSuccess.invoice_number}</strong> issued successfully.</p>
                  {checkoutSuccess.change_returned !== null && (
                    <div className="bg-white border border-green-200 p-2 rounded text-center mt-2">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider block">Change Due to Customer</span>
                      <strong className="text-lg text-green-700">${Number(checkoutSuccess.change_returned).toFixed(2)}</strong>
                    </div>
                  )}
                  <Button
                    onClick={() => {
                      setCheckoutSuccess(null);
                      focusScanBox();
                    }}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-1.5 h-8 text-xs mt-2"
                  >
                    Next Customer
                  </Button>
                </div>
              )}

              {!checkoutMethod && (!checkoutSuccess || cart.length > 0) && (
                <div className="grid grid-cols-2 gap-4">
                  <button
                    disabled={cart.length === 0}
                    onClick={() => {
                      setCheckoutMethod('cash');
                      setAmountTendered('');
                      setCheckoutError('');
                    }}
                    className="flex flex-col items-center justify-center p-4 border border-gray-200 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                  >
                    <DollarSign size={24} className="text-brand-blue mb-1" />
                    <span className="text-xs font-bold text-gray-800">Pay Cash</span>
                  </button>

                  <button
                    disabled={cart.length === 0}
                    onClick={() => {
                      if (!fonepayConfigured) return;
                      setCheckoutMethod('qr');
                      setCheckoutError('');
                      // Submit checkout automatically to obtain QR code
                      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
                      setTimeout(() => {
                        handleCheckoutSubmit(fakeEvent);
                      }, 50);
                    }}
                    className={`flex flex-col items-center justify-center p-4 border border-gray-200 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/30 ${
                      fonepayConfigured && cart.length > 0
                        ? 'hover:bg-gray-50 active:bg-gray-100'
                        : 'opacity-50 pointer-events-none'
                    }`}
                  >
                    <QrCode size={24} className="text-brand-blue mb-1" />
                    <span className="text-xs font-bold text-gray-800">
                      {fonepayConfigured ? 'Scan QR Code' : 'QR Unavailable'}
                    </span>
                  </button>
                </div>
              )}

              {/* Cash payment prompt details */}
              {checkoutMethod === 'cash' && (
                <form onSubmit={handleCheckoutSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                      Amount Tendered ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={cartSummary.total}
                      placeholder={`Min: $${cartSummary.total.toFixed(2)}`}
                      value={amountTendered}
                      onChange={e => setAmountTendered(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg p-2.5 font-extrabold text-base text-gray-800 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                      autoFocus
                    />
                  </div>

                  {amountTendered && parseFloat(amountTendered) >= cartSummary.total && (
                    <div className="bg-gray-50 p-2.5 rounded border border-gray-150 text-center text-xs">
                      <span className="text-gray-500">Change Due:</span>
                      <strong className="text-sm text-brand-blue ml-1.5 font-extrabold">
                        ${(parseFloat(amountTendered) - cartSummary.total).toFixed(2)}
                      </strong>
                    </div>
                  )}

                  <div className="flex gap-3 text-xs">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCheckoutMethod(null);
                        setAmountTendered('');
                      }}
                      className="flex-1 py-2 text-gray-500 border-gray-300"
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      disabled={submittingCheckout || !amountTendered}
                      className="flex-1 bg-brand-blue hover:bg-brand-blue-hover text-white font-bold"
                    >
                      {submittingCheckout ? 'Processing...' : 'Confirm Checkout'}
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* MODAL 1: QR CODE DISPLAY MODAL */}
      {checkoutMethod === 'qr' && checkoutSuccess && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-6 z-55">
          <Card className="bg-white border-none shadow-2xl max-w-sm w-full rounded-2xl overflow-hidden p-6 space-y-6">
            <div className="text-center space-y-1">
              <h3 className="font-extrabold text-lg text-gray-800">Dynamic QR Payment</h3>
              <p className="text-xs text-gray-400">Scan code using client banking or Fonepay app</p>
            </div>

            <div className="flex flex-col items-center justify-center">
              {qrDataUrl ? (
                <div className="bg-white p-4 border border-gray-100 rounded-2xl shadow-inner">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="Fonepay QR Code" className="w-56 h-56" />
                </div>
              ) : (
                <div className="w-56 h-56 flex flex-col items-center justify-center border border-dashed border-gray-200 rounded-2xl bg-gray-50">
                  <RefreshCw className="h-8 w-8 text-brand-blue animate-spin mb-2" />
                  <span className="text-[10px] text-gray-400">Requesting QR Code...</span>
                </div>
              )}
            </div>

            {qrExpiresAt && (
              <div className="text-center space-y-1.5">
                <span className="text-[10px] font-bold text-gray-450 uppercase tracking-wider block">QR Code Expiration</span>
                {qrTimeLeft > 0 ? (
                  <div className="text-sm font-extrabold text-brand-blue">
                    {Math.floor(qrTimeLeft / 60)}m {qrTimeLeft % 60}s remaining
                  </div>
                ) : (
                  <div className="text-xs font-bold text-red-600 flex items-center justify-center gap-1">
                    <AlertTriangle size={14} />
                    <span>Payment code has expired.</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {qrTimeLeft <= 0 && (
                <Button
                  onClick={() => {
                    // Close QR modal and fallback to cash
                    setCheckoutMethod('cash');
                    setAmountTendered('');
                    setCheckoutSuccess(null);
                    setQrDataUrl('');
                    setQrExpiresAt('');
                    setQrPolling(false);
                  }}
                  className="bg-brand-blue hover:bg-brand-blue-hover text-white font-bold"
                >
                  Pay cash instead
                </Button>
              )}

              <Button
                variant="outline"
                onClick={() => {
                  setCheckoutMethod(null);
                  setCheckoutSuccess(null);
                  setQrDataUrl('');
                  setQrExpiresAt('');
                  setQrPolling(false);
                  focusScanBox();
                }}
                className="text-gray-500 font-semibold"
              >
                Cancel Checkout
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL 2: REGISTER PRODUCT MODAL (Owner Only) */}
      {isRegisterOpen && user?.role === 'owner' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-6 z-55">
          <Card className="bg-white border-none shadow-2xl max-w-md w-full rounded-2xl overflow-hidden">
            <CardHeader className="bg-brand-blue text-white py-5 px-6">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <SearchCode size={18} />
                Unregistered Barcode Found
              </CardTitle>
              <CardDescription className="text-white/70 text-xs mt-1">
                Configure details below to create product and associate barcode <strong>{unregisteredBarcode}</strong>
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleRegisterSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {registerError && (
                <div className="bg-red-50 text-red-600 border border-red-100 rounded-lg p-3 text-xs font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{registerError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3.5">
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Product Name</label>
                  <input
                    type="text"
                    value={newProdName}
                    onChange={e => setNewProdName(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 text-xs font-medium focus:border-brand-blue outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Base Cost Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newProdCost}
                    onChange={e => setNewProdCost(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 text-xs font-medium focus:border-brand-blue outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">MRP ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newProdMrp}
                    onChange={e => {
                      setNewProdMrp(e.target.value);
                      if (!newProdSalePrice) setNewProdSalePrice(e.target.value);
                    }}
                    className="w-full border border-gray-300 rounded p-2 text-xs font-medium focus:border-brand-blue outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">VAT Category</label>
                  <select
                    value={newProdVatCat}
                    onChange={e => setNewProdVatCat(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 text-xs font-medium focus:border-brand-blue outline-none"
                  >
                    <option value="TAXABLE_13">Taxable (13%)</option>
                    <option value="TAX_FREE">Tax Free (0%)</option>
                    <option value="CUSTOM">Custom Rate</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Custom VAT Rate (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={newProdVatCat !== 'CUSTOM'}
                    value={newProdCustomVat}
                    onChange={e => setNewProdCustomVat(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 text-xs font-medium focus:border-brand-blue outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>

                <div className="border-t border-gray-100 col-span-2 pt-3 my-1">
                  <span className="text-[10px] font-bold text-gray-450 uppercase tracking-wider block">Barcode Selling Details</span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Unit (e.g. Piece, Carton)</label>
                  <input
                    type="text"
                    value={newProdUnit}
                    onChange={e => setNewProdUnit(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 text-xs font-medium focus:border-brand-blue outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Sale Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newProdSalePrice}
                    onChange={e => setNewProdSalePrice(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 text-xs font-medium focus:border-brand-blue outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Low Stock Alert Qty</label>
                  <input
                    type="number"
                    value={newProdAlertQty}
                    onChange={e => setNewProdAlertQty(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 text-xs font-medium focus:border-brand-blue outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsRegisterOpen(false);
                    setScannedCode('');
                    focusScanBox();
                  }}
                  className="flex-1 text-gray-500 font-semibold border-gray-300 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={registeringProduct}
                  className="flex-1 bg-brand-blue hover:bg-brand-blue-hover text-white font-bold text-xs"
                >
                  {registeringProduct ? 'Registering...' : 'Register Product'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL 3: CLOSE SHIFT MODAL */}
      {isCloseShiftOpen && activeShift && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-6 z-55">
          <Card className="bg-white border-none shadow-2xl max-w-md w-full rounded-2xl overflow-hidden">
            <CardHeader className="bg-red-600 text-white py-5 px-6">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <LogOut size={18} />
                Close Sales Shift
              </CardTitle>
              <CardDescription className="text-white/70 text-xs mt-1">
                Calculate end-of-day till totals and close active terminal session.
              </CardDescription>
            </CardHeader>
            
            {!closedShiftSummary ? (
              <form onSubmit={handleCloseShiftSubmit} className="p-6 space-y-4">
                {closeShiftError && (
                  <div className="bg-red-50 text-red-600 border border-red-100 rounded-lg p-3 text-xs font-semibold flex items-center gap-1.5">
                    <AlertTriangle size={14} className="shrink-0" />
                    <span>{closeShiftError}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                    Closing Cash Balance ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Enter cash remaining in register..."
                    value={closingBalance}
                    onChange={e => setClosingBalance(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2.5 font-bold text-base focus:border-brand-blue outline-none"
                    required
                  />
                </div>

                {isFocusMode && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                      Confirm Cashier PIN
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      placeholder="Enter your 4-digit code..."
                      value={closeShiftPin}
                      onChange={e => setCloseShiftPin(e.target.value)}
                      className="w-full border border-gray-300 rounded p-2.5 font-bold text-base tracking-widest text-center focus:border-brand-blue outline-none"
                      required
                    />
                  </div>
                )}

                <div className="flex gap-3 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsCloseShiftOpen(false);
                      focusScanBox();
                    }}
                    className="flex-1 text-gray-500 border-gray-300 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={closingShift}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md"
                  >
                    {closingShift ? 'Processing...' : 'Confirm Closure'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="p-6 space-y-5">
                <div className="text-center space-y-1">
                  <CheckCircle size={36} className="text-green-600 mx-auto" />
                  <h3 className="font-extrabold text-lg text-gray-800">Shift Closed Successfully</h3>
                  <p className="text-xs text-gray-400">Reconciliation report generated</p>
                </div>

                <div className="bg-gray-50 border border-gray-150 rounded-xl p-4 space-y-3 text-xs font-semibold text-gray-600">
                  <div className="flex justify-between items-center">
                    <span>Closing Drawer Balance</span>
                    <span className="text-gray-900">${Number(closedShiftSummary.closing_cash_balance).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-gray-500">
                    <span>Expected Balance (Ledger)</span>
                    <span>${Number(closedShiftSummary.expected_cash_balance).toFixed(2)}</span>
                  </div>
                  
                  <div className={`border-t border-gray-200 pt-3 flex justify-between items-center font-bold ${
                    closedShiftSummary.cash_difference < 0 ? 'text-red-600' :
                    closedShiftSummary.cash_difference > 0 ? 'text-green-600' : 'text-gray-900'
                  }`}>
                    <span>Drawer Variance</span>
                    <span>
                      {closedShiftSummary.cash_difference > 0 ? '+' : ''}
                      ${Number(closedShiftSummary.cash_difference).toFixed(2)} 
                      ({closedShiftSummary.cash_difference === 0 ? 'Balanced' : 
                        closedShiftSummary.cash_difference > 0 ? 'Over' : 'Short'})
                    </span>
                  </div>
                </div>

                <Button
                  onClick={confirmShiftCloseReport}
                  className="w-full bg-brand-blue hover:bg-brand-blue-hover text-white font-bold py-2.5"
                >
                  Return to Dashboard
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* MODAL 4: SALES RETURNS MODAL */}
      {isReturnsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-6 z-55">
          <Card className="bg-white border-none shadow-2xl max-w-2xl w-full rounded-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <CardHeader className="bg-brand-blue text-white py-5 px-6 shrink-0 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <RotateCcw size={18} />
                  Issue Sales Return (Credit Note)
                </CardTitle>
                <CardDescription className="text-white/70 text-xs mt-1">
                  Search receipt details and select items to return back to inventory stock.
                </CardDescription>
              </div>
              <button
                onClick={() => {
                  setIsReturnsOpen(false);
                  setSelectedReturnInvoice(null);
                  setInvoiceSearchResults([]);
                  setSearchInvoiceNo('');
                  setReturnNotes('');
                  focusScanBox();
                }}
                className="text-white/70 hover:text-white rounded-lg p-1 hover:bg-white/10"
              >
                <X size={20} />
              </button>
            </CardHeader>

            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              {returnError && (
                <div className="bg-red-50 text-red-600 border border-red-100 rounded-lg p-3 text-xs font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{returnError}</span>
                </div>
              )}

              {/* Step 1: Search Invoice */}
              {!selectedReturnInvoice ? (
                <div className="space-y-4">
                  <form onSubmit={handleInvoiceSearch} className="flex gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute inset-y-0 left-0 pl-3 h-full w-4 text-gray-400 flex items-center" />
                      <input
                        type="text"
                        placeholder="Search receipt invoice number (e.g. INV-LOC-)..."
                        value={searchInvoiceNo}
                        onChange={e => setSearchInvoiceNo(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded text-xs outline-none focus:border-brand-blue"
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={searchingInvoices || !searchInvoiceNo.trim()}
                      className="bg-brand-blue hover:bg-brand-blue-hover text-white text-xs px-4"
                    >
                      {searchingInvoices ? 'Searching...' : 'Search'}
                    </Button>
                  </form>

                  {/* List matching results */}
                  {invoiceSearchResults.length > 0 && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase text-[10px]">
                          <tr>
                            <th className="py-2.5 px-4">Invoice #</th>
                            <th className="py-2.5 px-2">Date</th>
                            <th className="py-2.5 px-2 text-right">Total</th>
                            <th className="py-2.5 px-4 w-20"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-150 font-medium">
                          {invoiceSearchResults.map(inv => (
                            <tr key={inv.id} className="hover:bg-gray-50/50">
                              <td className="py-2.5 px-4 font-bold text-gray-900">{inv.invoice_number}</td>
                              <td className="py-2.5 px-2 text-gray-400">{new Date(inv.created_at).toLocaleDateString()}</td>
                              <td className="py-2.5 px-2 text-right font-semibold">${Number(inv.total_amount).toFixed(2)}</td>
                              <td className="py-2.5 px-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => loadReturnInvoiceDetails(inv.id)}
                                  className="text-brand-blue hover:underline font-bold"
                                >
                                  Select
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                // Step 2: Select Items/Qtys to Return
                <form onSubmit={handleReturnSubmit} className="space-y-5">
                  <div className="bg-gray-50 border border-gray-150 p-4 rounded-xl space-y-1.5 text-xs text-gray-600 font-semibold">
                    <div className="flex justify-between text-gray-900">
                      <span>Receipt Invoice:</span>
                      <strong>{selectedReturnInvoice.invoice_number}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Purchase Date:</span>
                      <span>{selectedReturnInvoice.formatted_date || new Date(selectedReturnInvoice.created_at).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Original Sale Value:</span>
                      <span>${Number(selectedReturnInvoice.total_amount).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="py-2.5 px-4">Item Details</th>
                          <th className="py-2.5 px-2 text-center w-20">Purchased</th>
                          <th className="py-2.5 px-2 text-center w-24">Returned</th>
                          <th className="py-2.5 px-4 text-center w-24">Qty to Return</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-150 font-medium">
                        {selectedReturnInvoice.items?.map((item: any) => {
                          const alreadyRet = Number(item.already_returned || 0);
                          const maxRet = item.quantity_sold - alreadyRet;
                          const currentVal = returnItemsQty[item.id] || 0;

                          return (
                            <tr key={item.id}>
                              <td className="py-3 px-4">
                                <div className="font-bold text-gray-800">{item.product_name || 'Product'}</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">${Number(item.unit_sale_price).toFixed(2)} each</div>
                              </td>
                              <td className="py-3 px-2 text-center text-gray-500 font-bold">{item.quantity_sold}</td>
                              <td className="py-3 px-2 text-center text-red-500 font-semibold">{alreadyRet}</td>
                              <td className="py-3 px-4 text-center">
                                {maxRet > 0 ? (
                                  <input
                                    type="number"
                                    min="0"
                                    max={maxRet}
                                    value={currentVal || ''}
                                    placeholder="0"
                                    onChange={e => {
                                      const val = Math.min(maxRet, Math.max(0, parseInt(e.target.value) || 0));
                                      setReturnItemsQty(prev => ({ ...prev, [item.id]: val }));
                                    }}
                                    className="w-16 text-center border border-gray-250 rounded py-1 font-bold text-gray-900 focus:border-brand-blue outline-none"
                                  />
                                ) : (
                                  <span className="text-[10px] text-gray-400 italic">Fully Returned</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Return Notes / Reason</label>
                    <textarea
                      value={returnNotes}
                      onChange={e => setReturnNotes(e.target.value)}
                      placeholder="Input customer return reason details here..."
                      className="w-full border border-gray-300 rounded p-2.5 text-xs font-medium focus:border-brand-blue outline-none h-16"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSelectedReturnInvoice(null)}
                      className="flex-1 text-gray-500 border-gray-300 text-xs font-semibold"
                    >
                      <Undo2 size={14} className="mr-1 inline" />
                      Back to Search
                    </Button>
                    <Button
                      type="submit"
                      disabled={submittingReturn}
                      className="flex-1 bg-brand-blue hover:bg-brand-blue-hover text-white font-bold text-xs"
                    >
                      {submittingReturn ? 'Submitting...' : 'Submit Return'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── Thermal Printer status toast ── */}
      {printToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg bg-gray-900 text-white border border-gray-800 animate-fade-in">
          {printToast}
        </div>
      )}
    </AppShell>
  );
}
