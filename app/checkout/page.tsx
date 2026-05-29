'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CartItem, getCart, clearCart, removeFromCart } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';
import { notify } from '@/lib/notifications';
import { haversineKm, riderFee } from '@/lib/geo';
import { validateCoupon, type Coupon } from '@/lib/coupons';
import { trackCheckoutStarted, trackOrderPlaced } from '@/lib/analytics/events';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { StepIndicator } from '@/components/checkout/StepIndicator';
import { ShippingAddressForm } from '@/components/checkout/ShippingAddressForm';
import { PaymentMethodSelector } from '@/components/checkout/PaymentMethodSelector';
import { B2BInvoiceForm } from '@/components/checkout/B2BInvoiceForm';
import { OrderSummary } from '@/components/checkout/OrderSummary';
import { CartGroupsList } from '@/components/checkout/CartGroupsList';
import { CouponInput } from '@/components/checkout/CouponInput';
import { friendlyError, apiErrorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { logger } from '@/lib/logger';

type AddressForm = {
  fullName: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  notes: string;
};

const CHECKOUT_STEPS: { num: number; label: string }[] = [
  { num: 1, label: 'Carrello' },
  { num: 2, label: 'Indirizzo' },
  { num: 3, label: 'Conferma' },
];

const SHIPPING_PER_ORDER = 4.9;

const SHIPPING_COST_FOR = (subtotal: number) => (subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_PER_ORDER);

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  useEffect(() => {
    const c = getCart();
    setCart(c);
    if (c.length > 0) {
      const totalCents = Math.round(c.reduce((s, i) => s + i.price * i.quantity, 0) * 100);
      trackCheckoutStarted(totalCents, c.reduce((s, i) => s + i.quantity, 0));
    }
  }, []);

  // Raggruppa il carrello per seller. Usa il sellerId gia' presente nel CartItem
  // (formato nuovo). Per gli item vecchi senza sellerId, fa un lookup sui products.
  const { data: cartData, isLoading: loadingGroups } = useQuery({
    queryKey: queryKeys.checkout.groups(cart.map((c) => `${c.id}:${c.sellerId ?? ''}`).join(',')),
    enabled: cart.length > 0,
    queryFn: async () => {
      // Valida TUTTI gli item del carrello contro il DB (non solo i legacy
      // senza sellerId): l'RLS (migrations/023) ritorna solo prodotti
      // `available` di venditori approvati, quindi un id non presente qui è
      // stale/non-disponibile (re-seed, prodotto rimosso, venditore sospeso)
      // e verrà rimosso dal carrello a valle.
      const lookupMap = new Map<string, string>(); // productId → seller_id (fonte: DB)
      const stockMap = new Map<string, number>();  // productId → stock disponibile (DB)
      const validIds = new Set<string>();

      if (cart.length > 0) {
        const { data: products, error: pErr } = await supabase
          .from('products')
          .select('id, seller_id, stock')
          .in('id', cart.map((c) => c.id));
        if (pErr) throw pErr;
        for (const p of products ?? []) {
          validIds.add(p.id);
          if (p.seller_id) lookupMap.set(p.id, p.seller_id);
          stockMap.set(p.id, p.stock ?? 0);
        }
      }

      const sellerInfo = new Map<string, { name: string; lat: number | null; lng: number | null }>();
      const allSellerIds = Array.from(
        new Set([
          ...cart.map((c) => c.sellerId).filter(Boolean) as string[],
          ...Array.from(lookupMap.values()),
        ]),
      );
      if (allSellerIds.length > 0) {
        const { data: sellers } = await supabase
          .from('profiles')
          .select('id, store_name, store_lat, store_lng')
          .in('id', allSellerIds);
        for (const s of sellers ?? []) {
          sellerInfo.set(s.id, {
            name: s.store_name ?? 'Negozio',
            lat: s.store_lat,
            lng: s.store_lng,
          });
        }
      }

      const sellerMap = new Map<string, {
        sellerId: string;
        storeName: string;
        storeLat: number | null;
        storeLng: number | null;
        items: CartItem[];
      }>();
      const orphanItems: CartItem[] = [];

      for (const item of cart) {
        // Item con id non più valido nel DB → "non più disponibile".
        if (!validIds.has(item.id)) {
          orphanItems.push(item);
          continue;
        }
        // Per gli item validi il seller_id del DB è la fonte di verità.
        const sellerId = lookupMap.get(item.id) ?? item.sellerId;
        if (!sellerId) {
          orphanItems.push(item);
          continue;
        }
        if (!sellerMap.has(sellerId)) {
          const info = sellerInfo.get(sellerId);
          sellerMap.set(sellerId, {
            sellerId,
            storeName: info?.name ?? item.storeName ?? 'Negozio',
            storeLat: info?.lat ?? null,
            storeLng: info?.lng ?? null,
            items: [],
          });
        }
        sellerMap.get(sellerId)!.items.push(item);
      }

      // Articoli la cui quantità supera lo stock disponibile (verifica al checkout,
      // non solo lato API): blocca l'ordine e segnala invece di fallire dopo.
      const stockIssues = cart
        .filter((it) => validIds.has(it.id) && it.quantity > (stockMap.get(it.id) ?? 0))
        .map((it) => ({ id: it.id, name: it.name, requested: it.quantity, available: stockMap.get(it.id) ?? 0 }));

      return { groups: Array.from(sellerMap.values()), orphans: orphanItems, stockIssues };
    },
  });

  const groups = cartData?.groups ?? [];
  const orphans = useMemo(() => cartData?.orphans ?? [], [cartData]);
  const stockIssues = useMemo(() => cartData?.stockIssues ?? [], [cartData]);

  // Auto-rimozione degli articoli non più disponibili (id stale dopo re-seed,
  // prodotto rimosso/non-disponibile, venditore sospeso): li togliamo dal
  // carrello e avvisiamo una sola volta per set di id (evita doppio toast in
  // StrictMode / sui refetch). Senza questo l'ordine fallirebbe solo lato API
  // con un "Prodotti non trovati" criptico.
  const notifiedOrphansRef = useRef<string>('');
  useEffect(() => {
    if (orphans.length === 0) return;
    const key = orphans.map((o) => o.id).sort().join(',');
    if (notifiedOrphansRef.current === key) return;
    notifiedOrphansRef.current = key;
    orphans.forEach((o) => removeFromCart(o.id));
    setCart(getCart());
    toast.error(
      `Alcuni articoli non sono più disponibili e sono stati rimossi dal carrello: ${orphans
        .map((o) => o.name)
        .join(', ')}`,
    );
  }, [orphans]);

  const groupSubtotal = (g: { items: CartItem[] }) =>
    g.items.reduce((s, it) => s + it.price * it.quantity, 0);

  // Check stato auth all'avvio
  const { data: authUser } = useQuery({
    queryKey: queryKeys.checkout.authUser,
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: 60_000,
  });

  // Indirizzi salvati
  type SavedAddress = { id: string; full_name: string; address: string; city: string; zip: string; phone: string; notes: string | null; lat: number | null; lng: number | null; is_default: boolean };
  const { data: savedAddresses = [] } = useQuery({
    queryKey: queryKeys.checkout.userAddresses(authUser?.id ?? ''),
    enabled: !!authUser?.id,
    queryFn: async (): Promise<SavedAddress[]> => {
      const { data } = await supabase
        .from('user_addresses')
        .select('*')
        .eq('user_id', authUser!.id)
        .order('is_default', { ascending: false });
      return (data ?? []) as SavedAddress[];
    },
  });

  const [form, setForm] = useState<AddressForm & { lat: number | null; lng: number | null }>({
    fullName: '', address: '', city: 'Piacenza', zip: '29121', phone: '', notes: '',
    lat: null, lng: null,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof AddressForm, string>>>({});
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name as keyof AddressForm] ? { ...prev, [name]: undefined } : prev));
  };

  // Quando arrivano gli indirizzi salvati, pre-seleziona il default
  useEffect(() => {
    if (savedAddresses.length > 0 && !form.fullName) {
      const def = savedAddresses.find((a) => a.is_default) ?? savedAddresses[0];
      setForm({
        fullName: def.full_name, address: def.address, city: def.city,
        zip: def.zip, phone: def.phone, notes: def.notes ?? '',
        lat: def.lat, lng: def.lng,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAddresses]);

  const applySavedAddress = (id: string) => {
    if (!id) return;
    const a = savedAddresses.find((x) => x.id === id);
    if (!a) return;
    setForm({
      fullName: a.full_name, address: a.address, city: a.city,
      zip: a.zip, phone: a.phone, notes: a.notes ?? '',
      lat: a.lat, lng: a.lng,
    });
  };

  // Coupon
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ coupon: Coupon; discount: number; freeShipping: boolean } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Ritiro in negozio (-10%, no spedizione)
  const [pickupInStore, setPickupInStore] = useState(false);

  // B2B: ordinare per la mia azienda → fattura elettronica
  // Esperti: Finance Manager + Trust&Safety: P.IVA + SDI obbligatori se attivo.
  // SDI o PEC per fatturazione elettronica italiana.
  const [b2bActive, setB2bActive] = useState(false);
  const [b2bForm, setB2bForm] = useState({ company_name: '', vat_number: '', sdi_code: '', pec: '' });

  // Pagamento: 'cod' = contanti alla consegna (sempre disponibile);
  // 'card' = Stripe Checkout, disponibile solo se la sitewide publishable
  // key e' configurata su Render (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).
  const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  const stripeAvailable = !!STRIPE_PUBLISHABLE_KEY;
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'card'>(stripeAvailable ? 'card' : 'cod');
  const PICKUP_DISCOUNT_PERCENT = 10;

  // Distanza-based shipping per ogni gruppo, se entrambe le coords sono note
  const shippingFor = (g: { storeLat: number | null; storeLng: number | null; items: CartItem[] }): number => {
    if (pickupInStore) return 0;
    const subtotal = groupSubtotal(g);
    if (subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
    if (g.storeLat && g.storeLng && form.lat && form.lng) {
      const km = haversineKm(g.storeLat, g.storeLng, form.lat, form.lng);
      return riderFee(km);
    }
    return SHIPPING_COST_FOR(subtotal);
  };

  const applyCoupon = async () => {
    setCouponError(null);
    const result = await validateCoupon(couponCode, grandSubtotal, authUser?.id ?? null);
    if (!result.ok) {
      setCouponError(result.reason);
      setAppliedCoupon(null);
      return;
    }
    setAppliedCoupon({ coupon: result.coupon, discount: result.discount, freeShipping: result.freeShipping });
    toast.success(`Codice "${result.coupon.code}" applicato`);
  };

  const grandSubtotal = groups.reduce((s, g) => s + groupSubtotal(g), 0);
  const pickupDiscount = pickupInStore ? Math.round(grandSubtotal * (PICKUP_DISCOUNT_PERCENT / 100) * 100) / 100 : 0;
  const grandShipping = appliedCoupon?.freeShipping ? 0 : groups.reduce((s, g) => s + shippingFor(g), 0);
  const discount = appliedCoupon?.discount ?? 0;
  const grandTotal = Math.max(0, grandSubtotal + grandShipping - discount - pickupDiscount);

  const placeOrders = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Niente errore: redirezione al sign-in mantenendo il checkout come destinazione
        router.push('/sign-in?returnTo=/checkout');
        throw new Error('REDIRECT_TO_SIGNIN');
      }
      if (groups.length === 0) throw new Error('Il carrello è vuoto');

      // Coords delivery: usa quelle dell'indirizzo salvato; altrimenti geocoda
      let deliveryLat: number | null = form.lat;
      let deliveryLng: number | null = form.lng;
      if (deliveryLat == null || deliveryLng == null) {
        try {
          const q = encodeURIComponent(`${form.address}, ${form.zip} ${form.city}, Italia`);
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=it`,
          );
          const json = await res.json();
          if (Array.isArray(json) && json[0]) {
            deliveryLat = parseFloat(json[0].lat);
            deliveryLng = parseFloat(json[0].lon);
          }
        } catch {}
      }

      const createdOrders: string[] = [];

      // Distribuisce lo sconto in proporzione al subtotale di ogni gruppo
      const couponDiscount = appliedCoupon?.discount ?? 0;
      const couponCodeUsed = appliedCoupon?.coupon.code ?? null;

      for (const g of groups) {
        const subtotal = groupSubtotal(g);
        const shipping = appliedCoupon?.freeShipping ? 0 : shippingFor(g);
        const portionOfCoupon = grandSubtotal > 0
          ? Math.round((couponDiscount * (subtotal / grandSubtotal)) * 100) / 100
          : 0;
        const portionOfPickup = pickupInStore
          ? Math.round(subtotal * (PICKUP_DISCOUNT_PERCENT / 100) * 100) / 100
          : 0;
        const portionOfDiscount = portionOfCoupon + portionOfPickup;
        const total = Math.max(0, subtotal + shipping - portionOfDiscount);

        const { data: order, error: orderError } = await supabase.from('orders').insert({
          user_id: user.id,
          seller_id: g.sellerId,
          total_price: total,
          shipping_cost: shipping,
          discount_amount: portionOfDiscount,
          coupon_code: couponCodeUsed,
          pickup_in_store: pickupInStore,
          payment_status: 'PENDING',
          delivery_status: 'NEW',
          delivery_full_name: form.fullName,
          delivery_phone: form.phone,
          delivery_address: form.address,
          delivery_city: form.city,
          delivery_zip: form.zip,
          delivery_notes: form.notes || null,
          delivery_lat: deliveryLat,
          delivery_lng: deliveryLng,
          payment_method: 'cod',
        }).select().single();
        if (orderError) throw orderError;

        const items = g.items.map((item) => ({
          order_id: order.id,
          product_id: item.id,
          quantity: item.quantity,
          unit_price: item.price,
        }));
        const { error: itemsError } = await supabase.from('order_items').insert(items);
        if (itemsError) throw itemsError;

        // B2B: salva dettagli fatturazione elettronica per questo ordine
        if (b2bActive && b2bForm.company_name && b2bForm.vat_number) {
          const { error: bErr } = await supabase.from('business_orders').insert({
            order_id: order.id,
            company_name: b2bForm.company_name.trim(),
            vat_number: b2bForm.vat_number.trim().toUpperCase(),
            sdi_code: b2bForm.sdi_code.trim().toUpperCase() || null,
            pec: b2bForm.pec.trim().toLowerCase() || null,
            invoice_required: true,
          });
          // Non bloccare l'ordine se la migration 035 non è applicata
          if (bErr && !bErr.message.includes('does not exist')) {
            // Log ma non interrompere — l'ordine è già creato
            logger.warn('business_orders insert failed', { message: bErr.message });
          }
        }

        // Notifica il seller
        notify({
          userId: g.sellerId,
          title: '🎉 Nuovo ordine!',
          body: `${form.fullName} ha effettuato un ordine da ${formatPrice(total)}`,
          link: `/seller/orders/${order.id}`,
        });

        trackOrderPlaced(order.id, Math.round(total * 100), 'cod', g.sellerId);
        createdOrders.push(order.id);
      }

      return createdOrders;
    },
    onSuccess: (orderIds) => {
      clearCart();
      // Behavioral Scientist + CRO: gratifica immediata su purchase success.
      // Flag in sessionStorage → la order detail page mostra ConfettiBurst.
      try { sessionStorage.setItem('mc_just_ordered', '1'); } catch { /* noop */ }
      if (orderIds.length === 1) {
        toast.success('Ordine effettuato! 🎉');
        router.push(`/orders/${orderIds[0]}`);
      } else {
        toast.success(`${orderIds.length} ordini effettuati! 🎉`);
        router.push('/orders');
      }
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message === 'REDIRECT_TO_SIGNIN') return;
      toast.error(friendlyError(err));
    },
  });

  // Mutation: pagamento con carta via Stripe Checkout.
  // Multi-seller supportato via /api/stripe/checkout che insert un
  // pending_checkouts + crea una sola charge sul marketplace; il webhook
  // crea N ordini (uno per seller) con stessa transfer_group.
  const payWithStripe = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/sign-in?returnTo=/checkout');
        throw new Error('REDIRECT_TO_SIGNIN');
      }
      if (groups.length === 0) {
        throw new Error('Il carrello è vuoto');
      }

      // Costruisci payload groups con shipping per gruppo (pre-coupon).
      const apiGroups = groups.map((g) => ({
        sellerId: g.sellerId,
        items: g.items.map((it) => ({ productId: it.id, quantity: it.quantity })),
        shippingCents: appliedCoupon?.freeShipping ? 0 : Math.round(shippingFor(g) * 100),
      }));

      const couponDiscountCents = Math.round((appliedCoupon?.discount ?? 0) * 100);
      const pickupDiscountCents = Math.round(pickupDiscount * 100);

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          groups: apiGroups,
          delivery: {
            fullName: form.fullName,
            address: form.address,
            city: form.city,
            zip: form.zip,
            phone: form.phone,
            notes: form.notes || null,
            lat: form.lat,
            lng: form.lng,
          },
          couponCode: appliedCoupon?.coupon.code ?? null,
          couponDiscountCents,
          pickupDiscountCents,
          pickupInStore,
          b2b: b2bActive && b2bForm.company_name && b2bForm.vat_number ? {
            company_name: b2bForm.company_name.trim(),
            vat_number: b2bForm.vat_number.trim().toUpperCase(),
            sdi_code: b2bForm.sdi_code.trim().toUpperCase() || null,
            pec: b2bForm.pec.trim().toLowerCase() || null,
          } : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(apiErrorMessage(data, 'Errore creazione pagamento'));
      }
      return data.url as string;
    },
    onSuccess: (url) => {
      // Redirect alla pagina Stripe Hosted Checkout. Il rientro avviene
      // su /orders?stripe=success o /cart?stripe=canceled (vedi /api/stripe/checkout).
      window.location.assign(url);
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message === 'REDIRECT_TO_SIGNIN') return;
      toast.error(friendlyError(err));
    },
  });

  const isCheckingOut = placeOrders.isPending || payWithStripe.isPending;

  const validateAddress = (): Partial<Record<keyof AddressForm, string>> => {
    const e: Partial<Record<keyof AddressForm, string>> = {};
    if (!form.fullName.trim()) e.fullName = 'Inserisci nome e cognome';
    if (!form.address.trim()) e.address = 'Inserisci l\'indirizzo di consegna';
    if (!form.city.trim()) e.city = 'Inserisci la città';
    if (!/^\d{5}$/.test(form.zip.trim())) e.zip = 'CAP non valido (5 cifre)';
    if (form.phone.trim().replace(/\D/g, '').length < 8) e.phone = 'Numero di telefono non valido';
    return e;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) {
      router.push('/sign-in?returnTo=/checkout');
      return;
    }
    const fieldErrors = validateAddress();
    setErrors(fieldErrors);
    const firstInvalid = (['fullName', 'address', 'city', 'zip', 'phone'] as const).find((k) => fieldErrors[k]);
    if (firstInvalid) {
      const el = document.querySelector<HTMLElement>(`[name="${firstInvalid}"]`);
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (stockIssues.length > 0) {
      toast.error('Alcuni articoli superano la disponibilità: riduci le quantità nel carrello.');
      return;
    }
    if (paymentMethod === 'card' && stripeAvailable) {
      payWithStripe.mutate();
    } else {
      placeOrders.mutate();
    }
  };

  if (cart.length === 0) {
    return (
      <div className="container mx-auto p-12 text-center space-y-4">
        <p className="text-ink-500 text-lg">Il tuo carrello è vuoto.</p>
        <Button href="/">Torna al negozio</Button>
      </div>
    );
  }

  if (loadingGroups) {
    return <LoadingState />;
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-6xl">
      <StepIndicator steps={CHECKOUT_STEPS} currentStep={2} />

      {!authUser && (
        <div className="bg-primary-50 border-2 border-primary-200 rounded-xl p-4 mb-6 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-primary-900">
            <strong>🔑 Per completare l'ordine devi accedere</strong> — i tuoi articoli restano nel carrello.
          </p>
          <Button href="/sign-in?returnTo=/checkout" size="sm">Accedi ora</Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <ShippingAddressForm
            form={form}
            savedAddresses={savedAddresses}
            errors={errors}
            onChange={handleChange}
            onSubmit={handleSubmit}
            onApplySavedAddress={applySavedAddress}
          />

          {/* RITIRO IN NEGOZIO */}
          <label className={`block border-2 rounded-xl p-4 cursor-pointer transition-all ${
            pickupInStore ? 'border-olive-400 bg-olive-50' : 'border-cream-300 bg-white hover:border-olive-200'
          }`}>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={pickupInStore}
                onChange={(e) => setPickupInStore(e.target.checked)}
                className="mt-1 w-4 h-4 accent-olive-600"
              />
              <div className="flex-1">
                <p className="font-bold text-ink-900">🏪 Ritira tu in negozio — risparmia {PICKUP_DISCOUNT_PERCENT}%</p>
                <p className="text-sm text-ink-600 mt-0.5">
                  Niente spedizione, sconto subito. Vai tu al negozio quando l'ordine è pronto.
                </p>
              </div>
              {pickupInStore && (
                <span className="bg-olive-500 text-white text-xs font-bold px-2 py-1 rounded shrink-0">
                  −{formatPrice(pickupDiscount)}
                </span>
              )}
            </div>
          </label>

          <B2BInvoiceForm
            active={b2bActive}
            onToggle={setB2bActive}
            form={b2bForm}
            onChange={setB2bForm}
          />

          <PaymentMethodSelector
            value={paymentMethod}
            onChange={setPaymentMethod}
            stripeAvailable={stripeAvailable}
            multiSeller={groups.length > 1}
          />

          {/* RIEPILOGO PER NEGOZIO */}
          {groups.length > 1 && (
            <div className="bg-accent-50 border border-accent-200 rounded-xl p-4 text-sm text-accent-800">
              <strong>Il tuo carrello include prodotti da {groups.length} negozi diversi.</strong>{' '}
              {paymentMethod === 'card'
                ? `Un unico pagamento, ${groups.length} ordini separati: ogni negozio prepara e fa consegnare il proprio.`
                : `Verranno creati ${groups.length} ordini separati, uno per ciascun negozio. Ogni rider consegna il proprio ordine.`}
            </div>
          )}

          {orphans.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-800 space-y-3">
              <p>
                <strong>⚠ {orphans.length} {orphans.length === 1 ? 'prodotto non è più disponibile' : 'prodotti non sono più disponibili'}</strong>: {orphans.map((o) => o.name).join(', ')}.
              </p>
              <button
                type="button"
                onClick={() => {
                  orphans.forEach((o) => removeFromCart(o.id));
                  setCart(getCart());
                  toast.success('Articoli non disponibili rimossi');
                }}
                className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg font-semibold text-sm"
              >
                Rimuovi dal carrello
              </button>
            </div>
          )}

          {stockIssues.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
              <strong>⚠ Disponibilità insufficiente</strong> per: {stockIssues.map((s) => `${s.name} (richiesti ${s.requested}, disponibili ${s.available})`).join('; ')}. Riduci le quantità nel carrello per procedere.
            </div>
          )}

          {groups.length === 0 && orphans.length === 0 && !loadingGroups && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-800">
              <strong>⚠ Errore nel caricamento dei prodotti.</strong> Prova a ricaricare la pagina, oppure svuota il carrello e riprova.
            </div>
          )}
        </div>

        {/* RIEPILOGO ORDINE */}
        <div className="lg:sticky lg:top-32 h-fit space-y-4">
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-cream-50 border-b px-5 py-3 flex justify-between items-center">
              <h2 className="font-bold">Riepilogo ordine</h2>
              <span className="text-xs text-ink-400">{cart.length} articoli</span>
            </div>

            <CartGroupsList groups={groups} />

            {/* Coupon input */}
            <CouponInput
              couponCode={couponCode}
              appliedCoupon={appliedCoupon}
              couponError={couponError}
              onCodeChange={(c) => { setCouponCode(c); setCouponError(null); }}
              onApply={applyCoupon}
              onRemove={() => { setAppliedCoupon(null); setCouponCode(''); }}
            />

            <OrderSummary
              subtotal={grandSubtotal}
              shipping={grandShipping}
              pickupDiscount={pickupDiscount}
              couponDiscount={discount}
              total={grandTotal}
              isCheckingOut={isCheckingOut}
              paymentMethod={paymentMethod}
              disabled={groups.length === 0 || stockIssues.length > 0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
