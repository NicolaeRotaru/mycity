'use client';

import { useState, useEffect } from 'react';
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
import { friendlyError } from '@/lib/errors';

type AddressForm = {
  fullName: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  notes: string;
};

const Step = ({ num, label, active, done }: { num: number; label: string; active?: boolean; done?: boolean }) => (
  <div className="flex items-center gap-2">
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
        done ? 'bg-olive-500 text-white' : active ? 'bg-primary-700 text-white' : 'bg-cream-200 text-ink-500'
      }`}
    >
      {done ? '✓' : num}
    </div>
    <span className={`text-sm font-semibold ${active ? 'text-primary-800' : done ? 'text-olive-700' : 'text-ink-400'}`}>
      {label}
    </span>
  </div>
);

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
    queryKey: ['checkout-groups', cart.map((c) => `${c.id}:${c.sellerId ?? ''}`).join(',')],
    enabled: cart.length > 0,
    queryFn: async () => {
      const itemsMissingSeller = cart.filter((c) => !c.sellerId);

      // Lookup solo per gli item legacy senza sellerId
      const lookupMap = new Map<string, string>(); // productId → sellerId
      const sellerNames = new Map<string, string>(); // sellerId → store_name

      if (itemsMissingSeller.length > 0) {
        const { data: products, error: pErr } = await supabase
          .from('products')
          .select('id, seller_id')
          .in('id', itemsMissingSeller.map((c) => c.id));
        if (pErr) throw pErr;
        for (const p of products ?? []) {
          if (p.seller_id) lookupMap.set(p.id, p.seller_id);
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
        const sellerId = item.sellerId ?? lookupMap.get(item.id);
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

      return { groups: Array.from(sellerMap.values()), orphans: orphanItems };
    },
  });

  const groups = cartData?.groups ?? [];
  const orphans = cartData?.orphans ?? [];

  const groupSubtotal = (g: { items: CartItem[] }) =>
    g.items.reduce((s, it) => s + it.price * it.quantity, 0);

  // Check stato auth all'avvio
  const { data: authUser } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: 60_000,
  });

  // Indirizzi salvati
  const { data: savedAddresses = [] } = useQuery({
    queryKey: ['user-addresses', authUser?.id],
    enabled: !!authUser?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('user_addresses')
        .select('*')
        .eq('user_id', authUser!.id)
        .order('is_default', { ascending: false });
      return data ?? [];
    },
  });

  const [form, setForm] = useState<AddressForm & { lat: number | null; lng: number | null }>({
    fullName: '', address: '', city: 'Piacenza', zip: '29121', phone: '', notes: '',
    lat: null, lng: null,
  });
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  // Quando arrivano gli indirizzi salvati, pre-seleziona il default
  useEffect(() => {
    if (savedAddresses.length > 0 && !form.fullName) {
      const def = savedAddresses.find((a: any) => a.is_default) ?? savedAddresses[0];
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
    const a = savedAddresses.find((x: any) => x.id === id);
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
            console.warn('business_orders insert failed:', bErr.message);
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
    onError: (err: any) => {
      if (err?.message === 'REDIRECT_TO_SIGNIN') return; // gia' redirezionato
      toast.error(friendlyError(err));
    },
  });

  // Mutation: pagamento con carta via Stripe Checkout.
  // Limitazione MVP: supporta solo carrelli single-seller. Multi-seller
  // con carta richiederebbe creare N sessioni Stripe e gestire il flusso
  // a step. Per ora multi-seller forza COD (radio "Carta" disabilitata).
  const payWithStripe = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/sign-in?returnTo=/checkout');
        throw new Error('REDIRECT_TO_SIGNIN');
      }
      if (groups.length !== 1) {
        throw new Error('Il pagamento con carta supporta un solo negozio per volta. Rimuovi gli articoli degli altri negozi o usa contanti.');
      }
      const g = groups[0];
      const shipping = appliedCoupon?.freeShipping ? 0 : shippingFor(g);

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sellerId: g.sellerId,
          items: g.items.map((it) => ({ productId: it.id, quantity: it.quantity })),
          shippingCents: Math.round(shipping * 100),
          metadata: {
            delivery_address: form.address,
            delivery_city: form.city,
            delivery_zip: form.zip,
            delivery_phone: form.phone,
            delivery_notes: form.notes ?? '',
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? 'Errore creazione pagamento');
      }
      return data.url as string;
    },
    onSuccess: (url) => {
      // Redirect alla pagina Stripe Hosted Checkout. Il rientro avviene
      // su /orders?stripe=success o /cart?stripe=canceled (vedi /api/stripe/checkout).
      window.location.assign(url);
    },
    onError: (err: any) => {
      if (err?.message === 'REDIRECT_TO_SIGNIN') return;
      toast.error(friendlyError(err));
    },
  });

  const isCheckingOut = placeOrders.isPending || payWithStripe.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) {
      router.push('/sign-in?returnTo=/checkout');
      return;
    }
    if (!form.fullName.trim() || !form.address.trim() || !form.city.trim() || !form.zip.trim() || !form.phone.trim()) {
      toast.error('Compila tutti i campi obbligatori');
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
        <Link href="/" className="inline-block bg-primary-700 hover:bg-primary-800 text-white px-6 py-2 rounded-lg">
          Torna al negozio
        </Link>
      </div>
    );
  }

  if (loadingGroups) {
    return <LoadingState />;
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-6xl">
      <div className="flex items-center justify-center gap-4 sm:gap-8 mb-8 flex-wrap">
        <Step num={1} label="Carrello" done />
        <div className="w-8 sm:w-16 h-px bg-cream-300" />
        <Step num={2} label="Indirizzo" active />
        <div className="w-8 sm:w-16 h-px bg-cream-300" />
        <Step num={3} label="Conferma" />
      </div>

      {!authUser && (
        <div className="bg-primary-50 border-2 border-primary-200 rounded-xl p-4 mb-6 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-primary-900">
            <strong>🔑 Per completare l'ordine devi accedere</strong> — i tuoi articoli restano nel carrello.
          </p>
          <Link
            href="/sign-in?returnTo=/checkout"
            className="bg-primary-700 hover:bg-primary-800 text-white px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap"
          >
            Accedi ora
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* INDIRIZZO */}
          <div className="bg-white border rounded-xl p-6 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">📍 Indirizzo di consegna</h2>

            {savedAddresses.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">
                  Indirizzo salvato
                </label>
                <select
                  onChange={(e) => applySavedAddress(e.target.value)}
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  {savedAddresses.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      📍 {a.label} — {a.address}, {a.city}
                      {a.is_default ? ' (predefinito)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-ink-400 mt-1">
                  Oppure modifica i campi sotto. <Link href="/profile/addresses" className="text-primary-700 hover:underline">Gestisci indirizzi</Link>
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" id="checkout-form">
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Nome e cognome</label>
                <input type="text" name="fullName" value={form.fullName} onChange={handleChange}
                  placeholder="Mario Rossi"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Indirizzo</label>
                <input type="text" name="address" value={form.address} onChange={handleChange}
                  placeholder="Via Roma 1"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink-700 mb-1">Città</label>
                  <input type="text" name="city" value={form.city} onChange={handleChange}
                    className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-700 mb-1">CAP</label>
                  <input type="text" name="zip" value={form.zip} onChange={handleChange}
                    className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Telefono</label>
                <input type="tel" name="phone" value={form.phone} onChange={handleChange}
                  placeholder="3331234567"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
                <p className="text-xs text-ink-400 mt-1">Il rider ti chiamerà se serve per la consegna</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">
                  Note per il rider <span className="text-ink-400 font-normal">(opzionale)</span>
                </label>
                <textarea name="notes" value={form.notes} onChange={handleChange}
                  rows={2}
                  placeholder="Es. citofono Rossi, suonare al 2° piano…"
                  className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none" />
              </div>
            </form>
          </div>

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

          {/* B2B — fattura elettronica per aziende */}
          <div className="bg-white border rounded-xl p-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={b2bActive}
                onChange={(e) => setB2bActive(e.target.checked)}
                className="mt-1 w-4 h-4 accent-primary-600"
              />
              <div className="flex-1">
                <p className="font-bold text-ink-900">🏢 Sto comprando per la mia azienda — voglio la fattura elettronica</p>
                <p className="text-sm text-ink-600 mt-0.5">
                  Inviata via SDI/PEC entro 12 giorni. Detraibilità completa.
                </p>
              </div>
            </label>
            {b2bActive && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-cream-200">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-ink-700 mb-1">Ragione sociale *</label>
                  <input
                    type="text"
                    value={b2bForm.company_name}
                    onChange={(e) => setB2bForm({ ...b2bForm, company_name: e.target.value })}
                    placeholder="Acme S.r.l."
                    className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
                    required={b2bActive}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-700 mb-1">Partita IVA *</label>
                  <input
                    type="text"
                    value={b2bForm.vat_number}
                    onChange={(e) => setB2bForm({ ...b2bForm, vat_number: e.target.value.toUpperCase() })}
                    placeholder="IT12345678901"
                    pattern="^(IT)?[0-9]{11}$"
                    className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm font-mono"
                    required={b2bActive}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-700 mb-1">Codice SDI (7 caratteri)</label>
                  <input
                    type="text"
                    value={b2bForm.sdi_code}
                    onChange={(e) => setB2bForm({ ...b2bForm, sdi_code: e.target.value.toUpperCase() })}
                    placeholder="0000000"
                    maxLength={7}
                    className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-ink-700 mb-1">PEC (alternativa a SDI)</label>
                  <input
                    type="email"
                    value={b2bForm.pec}
                    onChange={(e) => setB2bForm({ ...b2bForm, pec: e.target.value })}
                    placeholder="azienda@pec.it"
                    className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <p className="sm:col-span-2 text-xs text-ink-500">
                  Compila SDI <strong>o</strong> PEC. Se nessuno, la fattura va al sistema di interscambio centrale.
                </p>
              </div>
            )}
          </div>

          {/* PAGAMENTO */}
          <div className="bg-white border rounded-xl p-6">
            <h2 className="text-xl font-bold flex items-center gap-2 mb-4">💳 Metodo di pagamento</h2>
            <div className="space-y-3">
              {stripeAvailable && (
                <label
                  className={`flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-colors ${
                    paymentMethod === 'card'
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-cream-300 bg-white hover:border-primary-200'
                  } ${groups.length > 1 ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="card"
                    checked={paymentMethod === 'card'}
                    disabled={groups.length > 1}
                    onChange={() => setPaymentMethod('card')}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="font-bold text-ink-900">💳 Carta di credito / debito</p>
                    <p className="text-sm text-ink-600">
                      Visa, Mastercard, Amex, Apple Pay, Google Pay — pagamento sicuro su Stripe.
                    </p>
                    {groups.length > 1 && (
                      <p className="text-xs text-accent-700 mt-1">
                        ⚠ Il pagamento con carta richiede ordini da un solo negozio per volta.
                      </p>
                    )}
                  </div>
                </label>
              )}

              <label
                className={`flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-colors ${
                  paymentMethod === 'cod'
                    ? 'border-accent-400 bg-accent-50'
                    : 'border-cream-300 bg-white hover:border-accent-200'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cod"
                  checked={paymentMethod === 'cod'}
                  onChange={() => setPaymentMethod('cod')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="font-bold text-ink-900">💵 Contanti alla consegna</p>
                  <p className="text-sm text-ink-600">Paghi al rider quando ricevi il pacco.</p>
                </div>
              </label>
            </div>
          </div>

          {/* RIEPILOGO PER NEGOZIO */}
          {groups.length > 1 && (
            <div className="bg-accent-50 border border-accent-200 rounded-xl p-4 text-sm text-accent-800">
              <strong>Il tuo carrello include prodotti da {groups.length} negozi diversi.</strong> Verranno creati {groups.length} ordini separati, uno per ciascun negozio. Ogni rider consegna il proprio ordine.
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

            <div className="divide-y max-h-72 overflow-y-auto">
              {groups.map((g) => (
                <div key={g.sellerId} className="px-5 py-3">
                  <p className="text-xs font-semibold text-primary-800 mb-2">🏪 {g.storeName}</p>
                  {g.items.map((item) => (
                    <div key={item.id} className="flex gap-3 items-center pl-2 py-1">
                      <div className="relative w-10 h-10 bg-cream-100 rounded shrink-0 overflow-hidden">
                        <Image
                          src={sizedImage(item.image ?? 'https://placehold.co/100x100/eef2ff/6366f1?text=?', 'thumb')}
                          alt={item.name}
                          fill
                          sizes="40px"
                          unoptimized
                          className="object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-ink-800 text-sm truncate">{item.name}</p>
                        <p className="text-xs text-ink-400">×{item.quantity}</p>
                      </div>
                      <span className="font-semibold text-ink-800 text-sm">{formatPrice(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Coupon input */}
            <div className="px-5 py-3 border-t bg-cream-50/50">
              {appliedCoupon ? (
                <div className="flex items-center justify-between bg-olive-50 border border-olive-200 rounded px-3 py-2 text-sm">
                  <span className="text-olive-800">
                    ✓ <strong>{appliedCoupon.coupon.code}</strong> applicato (−{formatPrice(appliedCoupon.discount)})
                  </span>
                  <button
                    type="button"
                    onClick={() => { setAppliedCoupon(null); setCouponCode(''); }}
                    className="text-rose-600 hover:underline text-xs"
                  >
                    Rimuovi
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponCode}
                      onChange={(e) => { setCouponCode(e.target.value); setCouponError(null); }}
                      placeholder="Codice sconto (es. BENVENUTO10)"
                      className="flex-1 border p-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                    <button
                      type="button"
                      onClick={applyCoupon}
                      className="bg-primary-700 hover:bg-primary-800 text-white px-3 py-2 rounded text-sm font-semibold"
                    >
                      Applica
                    </button>
                  </div>
                  {couponError && <p className="text-xs text-rose-600">{couponError}</p>}
                </div>
              )}
            </div>

            <div className="px-5 py-4 space-y-2 border-t bg-cream-50/50 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-600">Subtotale</span>
                <span className="font-semibold">{formatPrice(grandSubtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-600">Spedizione</span>
                <span className={`font-semibold ${grandShipping === 0 ? 'text-olive-600' : ''}`}>
                  {grandShipping === 0 ? 'GRATUITA' : formatPrice(grandShipping)}
                </span>
              </div>
              {pickupDiscount > 0 && (
                <div className="flex justify-between text-olive-700">
                  <span>Sconto ritiro in negozio</span>
                  <span className="font-semibold">−{formatPrice(pickupDiscount)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex justify-between text-olive-700">
                  <span>Sconto codice</span>
                  <span className="font-semibold">−{formatPrice(discount)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t font-bold text-lg">
                <span>Totale</span>
                <span className="text-primary-800">{formatPrice(grandTotal)}</span>
              </div>
            </div>

            <button
              type="submit"
              form="checkout-form"
              disabled={isCheckingOut}
              className={`w-full disabled:opacity-50 py-4 font-extrabold text-base transition-colors shadow-lg ${
                paymentMethod === 'card'
                  ? 'bg-primary-700 hover:bg-primary-800 text-white'
                  : 'bg-accent-400 hover:bg-accent-500 text-ink-900'
              }`}
            >
              {isCheckingOut
                ? (paymentMethod === 'card' ? 'Apertura pagamento sicuro…' : 'Elaborazione…')
                : (paymentMethod === 'card'
                    ? `🔒 Paga con carta · ${formatPrice(grandTotal)}`
                    : `✓ Conferma ordine · ${formatPrice(grandTotal)}`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
