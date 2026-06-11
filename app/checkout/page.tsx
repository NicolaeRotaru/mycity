'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { AlertTriangle, Store, Zap } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CartItem, getCart, clearCart, removeFromCart } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';
import { haversineKm, riderFee } from '@/lib/geo';
import { isExpressEligible } from '@/lib/products/express';
import { validateCoupon, type Coupon } from '@/lib/coupons';
import { trackCheckoutStarted, trackCheckoutStep, trackCouponApplied, trackOrderPlaced } from '@/lib/analytics/events';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { StepIndicator, CHECKOUT_STEPS } from '@/components/checkout/StepIndicator';
import { ShippingAddressForm } from '@/components/checkout/ShippingAddressForm';
import { PaymentMethodSelector } from '@/components/checkout/PaymentMethodSelector';
import { B2BInvoiceForm } from '@/components/checkout/B2BInvoiceForm';
import { OrderSummary } from '@/components/checkout/OrderSummary';
import { CartGroupsList } from '@/components/checkout/CartGroupsList';
import { CouponInput } from '@/components/checkout/CouponInput';
import { FreeShippingProgress } from '@/components/ui/FreeShippingProgress';
import { friendlyError, apiErrorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

type AddressForm = {
  fullName: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  notes: string;
};

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
      const hasVariantsMap = new Map<string, boolean>(); // productId → ha varianti
      const validIds = new Set<string>();

      if (cart.length > 0) {
        const { data: products, error: pErr } = await supabase
          .from('products')
          .select('id, seller_id, stock, has_variants')
          .in('id', cart.map((c) => c.id));
        if (pErr) throw pErr;
        for (const p of products ?? []) {
          validIds.add(p.id);
          if (p.seller_id) lookupMap.set(p.id, p.seller_id);
          stockMap.set(p.id, p.stock ?? 0);
          hasVariantsMap.set(p.id, Boolean((p as { has_variants?: boolean }).has_variants));
        }
      }

      // Stock per variante (per gli articoli con variante scelta).
      const variantStock = new Map<string, number>();
      const variantIds = cart.map((c) => c.variantId).filter(Boolean) as string[];
      if (variantIds.length > 0) {
        const { data: vs } = await supabase
          .from('product_variants')
          .select('id, stock')
          .in('id', variantIds);
        for (const v of vs ?? []) variantStock.set(v.id as string, (v.stock as number) ?? 0);
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

      // Disponibilità per riga: stock della variante se presente, altrimenti del
      // prodotto. Blocca e segnala invece di fallire dopo.
      const availableFor = (it: CartItem) =>
        it.variantId ? (variantStock.get(it.variantId) ?? 0) : (stockMap.get(it.id) ?? 0);
      const stockIssues = cart
        .filter((it) => validIds.has(it.id) && it.quantity > availableFor(it))
        .map((it) => ({ id: it.id, name: it.name, requested: it.quantity, available: availableFor(it) }));

      // Articoli con varianti ma senza variante scelta (es. aggiunti da una card):
      // vanno completati nella scheda prodotto prima di ordinare.
      const variantIssues = cart
        .filter((it) => validIds.has(it.id) && hasVariantsMap.get(it.id) && !it.variantId)
        .map((it) => ({ id: it.id, name: it.name }));

      const groupsArr = Array.from(sellerMap.values());

      // Express (best-effort): query SEPARATA dal percorso critico. Se le colonne
      // non esistono ancora (migrazione 071 non applicata) PostgREST ritorna
      // errore→data null: nessun badge Express, ma il checkout NON si rompe.
      let expressStores: string[] = [];
      if (groupsArr.length > 0) {
        const sellerIds = groupsArr.map((g) => g.sellerId);
        const [{ data: exProducts }, { data: exSellers }] = await Promise.all([
          supabase.from('products').select('id, express_enabled').in('id', cart.map((c) => c.id)),
          supabase.from('profiles').select('id, offers_express').in('id', sellerIds),
        ]);
        if (exProducts && exSellers) {
          const exMap = new Map<string, boolean | null>();
          for (const p of exProducts) exMap.set(p.id, (p as { express_enabled?: boolean | null }).express_enabled ?? null);
          const offersMap = new Map<string, boolean>();
          for (const s of exSellers) offersMap.set(s.id, Boolean((s as { offers_express?: boolean }).offers_express));
          expressStores = groupsArr
            .filter((g) => offersMap.get(g.sellerId) && g.items.every((it) => isExpressEligible(exMap.get(it.id) ?? null, offersMap.get(g.sellerId) ?? false)))
            .map((g) => g.storeName);
        }
      }

      return { groups: groupsArr, orphans: orphanItems, stockIssues, variantIssues, expressStores };
    },
  });

  const groups = cartData?.groups ?? [];
  const orphans = useMemo(() => cartData?.orphans ?? [], [cartData]);
  const stockIssues = useMemo(() => cartData?.stockIssues ?? [], [cartData]);
  const variantIssues = useMemo(() => cartData?.variantIssues ?? [], [cartData]);
  const expressStores = useMemo(() => cartData?.expressStores ?? [], [cartData]);

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

  // Defer-the-wall: ripristina l'indirizzo digitato da ospite prima del login
  // (salvato in handleSubmit), così non va perso dopo l'accesso.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('mc_checkout_draft');
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<typeof form>;
      setForm((prev) => ({ ...prev, ...draft }));
      sessionStorage.removeItem('mc_checkout_draft');
    } catch { /* noop */ }
  }, []);

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
    trackCouponApplied(result.coupon.code, Math.round(result.discount * 100));
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

      // SICUREZZA: gli ordini COD vengono creati SERVER-SIDE (/api/orders/cod),
      // che ricalcola prezzi, spedizione e sconti dal DB. Il client invia solo
      // prodotti+quantità, l'indirizzo e l'eventuale coupon; nessun importo.
      const res = await fetch('/api/orders/cod', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          groups: groups.map((g) => ({
            sellerId: g.sellerId,
            items: g.items.map((it) => ({ productId: it.id, quantity: it.quantity, variantId: it.variantId ?? null })),
          })),
          delivery: {
            fullName: form.fullName,
            address: form.address,
            city: form.city,
            zip: form.zip,
            phone: form.phone,
            notes: form.notes || null,
            lat: deliveryLat,
            lng: deliveryLng,
          },
          couponCode: appliedCoupon?.coupon.code ?? null,
          pickupInStore,
          b2b: b2bActive && b2bForm.company_name && b2bForm.vat_number ? {
            company_name: b2bForm.company_name.trim(),
            vat_number: b2bForm.vat_number.trim().toUpperCase(),
            sdi_code: b2bForm.sdi_code.trim().toUpperCase() || null,
            pec: b2bForm.pec.trim().toLowerCase() || null,
          } : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(body, 'Creazione ordine fallita'));
      const createdOrders: string[] = (body as { orderIds?: string[] }).orderIds ?? [];
      // Misura: una conversione = un purchase col totale reale del checkout.
      // Multi-seller crea N ordini ma con un solo flusso di pagamento: per non
      // gonfiare il fatturato in GA4 emettiamo un order_placed aggregato sul
      // primo orderId (transaction_id), seller 'multi' se più negozi.
      if (createdOrders.length > 0) {
        trackOrderPlaced(
          createdOrders[0],
          Math.round(grandTotal * 100),
          'cod',
          groups.length === 1 ? groups[0].sellerId : 'multi',
          { coupon: appliedCoupon?.coupon.code },
        );
      }
      return createdOrders;
    },
    onSuccess: (orderIds) => {
      clearCart();
      // Behavioral Scientist + CRO: gratifica immediata su purchase success.
      // Flag in sessionStorage → la order detail page mostra ConfettiBurst.
      try { sessionStorage.setItem('mc_just_ordered', '1'); } catch { /* noop */ }
      if (orderIds.length === 1) {
        toast.success('Ordine effettuato!');
        router.push(`/orders/${orderIds[0]}`);
      } else {
        toast.success(`${orderIds.length} ordini effettuati!`);
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
        items: g.items.map((it) => ({ productId: it.id, quantity: it.quantity, variantId: it.variantId ?? null })),
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
      // Stash del valore d'acquisto per emettere `purchase` (GA4) + `order_placed`
      // al rientro su /orders?stripe=success: lì gli ordini sono già creati dal
      // webhook ma il client non ne conosce i totali, quindi li portiamo da qui.
      try {
        sessionStorage.setItem('mc_pending_purchase', JSON.stringify({
          valueCents: Math.round(grandTotal * 100),
          coupon: appliedCoupon?.coupon.code ?? null,
          sellerId: groups.length === 1 ? groups[0].sellerId : 'multi',
        }));
      } catch { /* noop */ }
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
    if (variantIssues.length > 0) {
      toast.error('Scegli le opzioni (taglia/colore) per alcuni articoli prima di ordinare.');
      return;
    }
    trackCheckoutStep('address', { city: form.city });
    // Defer-the-wall: l'indirizzo si compila da ospiti; l'accesso è richiesto
    // solo qui, al commit, salvando la bozza per ripristinarla al ritorno.
    if (!authUser) {
      try { sessionStorage.setItem('mc_checkout_draft', JSON.stringify(form)); } catch { /* noop */ }
      router.push('/sign-in?returnTo=/checkout');
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
      <h1 className="sr-only">Completa il tuo ordine</h1>
      <StepIndicator steps={CHECKOUT_STEPS} currentStep={2} />

      {!authUser && (
        <div className="bg-olive-50 border border-olive-200 rounded-xl p-4 mb-6 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-olive-900">
            <strong>Compila pure il tuo indirizzo qui sotto.</strong> Ti chiederemo di accedere solo al momento di confermare l&apos;ordine — i dati che inserisci restano salvati.
          </p>
          <Link href="/sign-in?returnTo=/checkout" className="text-sm font-semibold text-primary-700 hover:underline shrink-0">
            Ho già un account →
          </Link>
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
                <p className="font-bold text-ink-900 flex items-center gap-2"><Store size={16} aria-hidden /> Ritira tu in negozio — risparmia {PICKUP_DISCOUNT_PERCENT}%</p>
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

          {expressStores.length > 0 && !pickupInStore && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-2">
              <Zap size={16} className="shrink-0 mt-0.5 text-amber-500" aria-hidden />
              <span><strong>Consegna Express disponibile</strong> (~30–60 min, se ci sono rider) per: {expressStores.join(', ')}. Altrimenti consegna standard 24–48h.</span>
            </div>
          )}

          <B2BInvoiceForm
            active={b2bActive}
            onToggle={setB2bActive}
            form={b2bForm}
            onChange={setB2bForm}
          />

          <PaymentMethodSelector
            value={paymentMethod}
            onChange={(m) => { setPaymentMethod(m); trackCheckoutStep('payment_method', { method: m }); }}
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
              <p className="flex items-start gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
                <span><strong>{orphans.length} {orphans.length === 1 ? 'prodotto non è più disponibile' : 'prodotti non sono più disponibili'}</strong>: {orphans.map((o) => o.name).join(', ')}.</span>
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
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
              <span><strong>Disponibilità insufficiente</strong> per: {stockIssues.map((s) => `${s.name} (richiesti ${s.requested}, disponibili ${s.available})`).join('; ')}. Riduci le quantità nel carrello per procedere.</span>
            </div>
          )}

          {variantIssues.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
              <span>
                <strong>Scegli le opzioni</strong> (taglia/colore) per: {variantIssues.map((v) => v.name).join(', ')}.{' '}
                Apri il prodotto, seleziona la variante e aggiungilo di nuovo al carrello.
              </span>
            </div>
          )}

          {groups.length === 0 && orphans.length === 0 && !loadingGroups && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-800 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
              <span><strong>Errore nel caricamento dei prodotti.</strong> Prova a ricaricare la pagina, oppure svuota il carrello e riprova.</span>
            </div>
          )}
        </div>

        {/* RIEPILOGO ORDINE */}
        <div className="lg:sticky lg:top-32 h-fit space-y-4">
          <div className="bg-white border border-surface-200 rounded-xl shadow-card overflow-hidden">
            <div className="bg-surface-50 border-b border-surface-200 px-5 py-3 flex justify-between items-center">
              <h2 className="font-bold">Riepilogo ordine</h2>
              <span className="text-xs text-ink-400">{cart.length} articoli</span>
            </div>

            <CartGroupsList groups={groups} />

            {/* Spinta add-back: a un soffio dalla spedizione gratis */}
            <div className="px-5 pt-3">
              <FreeShippingProgress subtotal={grandSubtotal} />
            </div>

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
              disabled={groups.length === 0 || stockIssues.length > 0 || variantIssues.length > 0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
