'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { AlertTriangle, ArrowLeft, MapPin, Store, Truck, Wallet } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CartItem, getCart, clearCart, removeFromCart } from '@/lib/cart';
import { statoDellaVista } from '@/lib/stato-vista';
import { chiaveTentativo, chiudiTentativo } from '@/lib/ordini/tentativo';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { FREE_SHIPPING_THRESHOLD, PLATFORM_DELIVERY_FEE_CENTS, PICKUP_DISCOUNT_PERCENT } from '@/lib/constants';
import { shippingForEuro } from '@/lib/shipping';
import { fetchActiveDiscounts, discountedUnitCents } from '@/lib/promotions';
import { validateCouponFromBrowser, type Coupon } from '@/lib/coupons';
import { trackCheckoutStarted, trackCheckoutStep, trackCouponApplied, trackOrderPlaced } from '@/lib/analytics/events';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Field';
import { StepIndicator, CHECKOUT_STEPS } from '@/components/checkout/StepIndicator';
import { StepCard } from '@/components/checkout/StepCard';
import { ShippingAddressForm } from '@/components/checkout/ShippingAddressForm';
import { PaymentMethodSelector } from '@/components/checkout/PaymentMethodSelector';
import { DeliverySlotPicker, resolveSlotLabel, SLOT_DEFAULTS } from '@/components/checkout/DeliverySlotPicker';
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

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  /**
   * Come nel carrello: `useState([])` parte vuoto perché deve partire da qualcosa. Senza questa
   * bandierina il primo controllo del render — che qui precedeva perfino `loadingGroups` — diceva
   * «Il tuo carrello è vuoto» a chi stava per pagare.
   */
  const [carrelloLetto, setCarrelloLetto] = useState(false);
  useEffect(() => {
    const c = getCart();
    setCart(c);
    setCarrelloLetto(true);
    if (c.length === 0) return;
    const totalCents = Math.round(c.reduce((s, i) => s + i.price * i.quantity, 0) * 100);
    // #225 — L'avvio del checkout si contava a ogni ingresso nella pagina,
    // mentre l'acquisto aveva l'anti-doppione. Chi torna indietro a correggere
    // l'indirizzo e rientra contava due volte: il tasso di conversione da
    // «checkout iniziato» ad «acquisto» usciva piu' basso del vero, e nessuno
    // sapeva di quanto. La chiave e' legata al contenuto del carrello: un
    // carrello diverso e' un checkout diverso e va contato.
    const impronta = `${c.map((i) => `${i.id}:${i.variantId ?? ''}:${i.quantity}`).join('|')}#${totalCents}`;
    const chiave = `mc_checkout_started_${impronta}`;
    try {
      if (sessionStorage.getItem(chiave)) return;
      sessionStorage.setItem(chiave, '1');
    } catch { /* sessionStorage non disponibile: si conta comunque */ }
    trackCheckoutStarted(totalCents, c.reduce((s, i) => s + i.quantity, 0));
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
      const priceMap = new Map<string, number>(); // productId → prezzo di ADESSO (DB)
      const validIds = new Set<string>();

      if (cart.length > 0) {
        // #114 — Anche il prezzo. Il totale mostrato qui veniva calcolato sui
        // prezzi salvati nel carrello, che sono quelli del giorno in cui il
        // prodotto e' stato aggiunto: il server, che rilegge dal database,
        // ne addebitava altri. Chi aveva un carrello di una settimana prima
        // vedeva 24 euro e si trovava 27 sull'estratto conto — o il contrario,
        // e allora ci rimettevamo noi.
        const ids = cart.map((c) => c.id);
        let { data: products, error: pErr } = await supabase
          .from('products')
          .select('id, seller_id, stock, has_variants, price, express_enabled')
          .in('id', ids);
        // #85 — Ripiego che scatta una volta sola, non due viaggi fissi per
        // tutti: se `express_enabled` non esistesse (migrazione 071 non
        // applicata), si rilegge senza quella colonna invece di far fallire il
        // checkout. 42703 = colonna inesistente.
        if (pErr?.code === '42703') {
          const ripiego = await supabase
            .from('products')
            .select('id, seller_id, stock, has_variants, price')
            .in('id', ids);
          products = (ripiego.data ?? []).map((r) => ({ ...r, express_enabled: null })) as typeof products;
          pErr = ripiego.error;
        }
        if (pErr) throw pErr;

        // 22/8/2026 — IL PREZZO IN PROMOZIONE SPARIVA ALLA CASSA.
        //
        // Qui si rileggeva la sola colonna `products.price`, cioe' il prezzo
        // PIENO, e con quello si sovrascriveva il prezzo del carrello. Il
        // cliente vedeva 7 euro nel carrello, apriva il checkout e trovava 10
        // con l'avviso «il prezzo e' passato da 7,00 a 10,00»: il momento esatto
        // in cui si abbandona. E le due rotte che creano l'ordine lo sconto lo
        // applicano eccome, quindi il totale mostrato non era quello addebitato.
        //
        // Peggio ancora sulla soglia della spedizione gratuita e sul minimo dei
        // codici sconto: la pagina li valutava sul subtotale pieno, il server su
        // quello scontato. Carrello a 31 euro pieni / 28 scontati: la pagina
        // prometteva la spedizione gratis, il server la addebitava.
        //
        // `fetchActiveDiscounts` e' la stessa funzione che usano le due rotte:
        // una chiamata sola per tutto il carrello, con ripiego a zero sconto se
        // qualcosa non risponde.
        const sconti = await fetchActiveDiscounts(supabase, ids);

        for (const p of products ?? []) {
          validIds.add(p.id);
          if (p.seller_id) lookupMap.set(p.id, p.seller_id);
          // 103 / 153 — `stock = null` in questo progetto vuol dire
          // «disponibilità illimitata»: lo dicono la scheda prodotto, la
          // griglia, il server e la funzione atomica di riserva. Solo QUI
          // diventava zero. Effetto: un prodotto senza limite di scorte non si
          // poteva comprare — il checkout lo dichiarava esaurito e spegneva il
          // pulsante, senza che il negoziante potesse capire perché.
          stockMap.set(p.id, p.stock == null ? Number.POSITIVE_INFINITY : p.stock);
          hasVariantsMap.set(p.id, Boolean((p as { has_variants?: boolean }).has_variants));
          const prezzoPieno = Number((p as { price?: number | string | null }).price ?? NaN);
          if (Number.isFinite(prezzoPieno)) {
            // Il prezzo che la pagina usa e' quello che il server fara' pagare.
            priceMap.set(p.id, discountedUnitCents(prezzoPieno, sconti.get(p.id) ?? 0) / 100);
          }
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
        let { data: sellers, error: sErr } = await supabase
          .from('profiles')
          .select('id, store_name, store_lat, store_lng, offers_express')
          .in('id', allSellerIds);
        if (sErr?.code === '42703') {
          const ripiego = await supabase
            .from('profiles')
            .select('id, store_name, store_lat, store_lng')
            .in('id', allSellerIds);
          sellers = (ripiego.data ?? []).map((r) => ({ ...r, offers_express: false })) as typeof sellers;
        }
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
        // #114 — La riga entra nel gruppo col prezzo di adesso, non con quello
        // che aveva quando e' stata messa nel carrello.
        const prezzoAggiornato = priceMap.get(item.id);
        sellerMap.get(sellerId)!.items.push(
          prezzoAggiornato != null && prezzoAggiornato !== item.price
            ? { ...item, price: prezzoAggiornato }
            : item,
        );
      }

      // #114 — Quali prezzi sono cambiati sotto il naso del cliente: si dice,
      // non si cambia il totale in silenzio.
      const prezziCambiati = cart
        .filter((it) => {
          const adesso = priceMap.get(it.id);
          return adesso != null && Math.abs(adesso - it.price) >= 0.01;
        })
        .map((it) => ({ id: it.id, name: it.name, prima: it.price, adesso: priceMap.get(it.id) as number }));

      // Disponibilità per riga: stock della variante se presente, altrimenti del
      // prodotto. Blocca e segnala invece di fallire dopo.
      const availableFor = (it: CartItem) =>
        it.variantId
          ? (variantStock.get(it.variantId) ?? 0)
          : (stockMap.get(it.id) ?? Number.POSITIVE_INFINITY);
      const stockIssues = cart
        .filter((it) => validIds.has(it.id) && it.quantity > availableFor(it))
        .map((it) => ({ id: it.id, name: it.name, requested: it.quantity, available: availableFor(it) }));

      // Articoli con varianti ma senza variante scelta (es. aggiunti da una card):
      // vanno completati nella scheda prodotto prima di ordinare.
      const variantIssues = cart
        .filter((it) => validIds.has(it.id) && hasVariantsMap.get(it.id) && !it.variantId)
        .map((it) => ({ id: it.id, name: it.name }));

      const groupsArr = Array.from(sellerMap.values());

      // LA PROMESSA DI CONSEGNA E' UNA SOLA: 30-60 minuti (Nicola, 21/8/2026).
      //
      // Qui c'era il calcolo di quali negozi facessero l'«Express», che serviva
      // a un riquadro con scritto «Express ~30-60 min per questi negozi,
      // altrimenti standard 24-48h». Erano due promesse diverse nella stessa
      // schermata, e il cliente non poteva sapere quale valesse per lui.
      // Il riquadro non c'e' piu' e il calcolo con lui.
      //
      // `express_enabled` e `offers_express` restano nelle due letture qui
      // sopra: non le usa piu' nessuno per il testo, ma toglierle vorrebbe dire
      // mettere le mani nel ripiego che tiene in piedi il checkout se la
      // migrazione 071 non e' applicata. Non si tocca quel ripiego per due
      // colonne che non costano un viaggio in piu'.
      return { groups: groupsArr, orphans: orphanItems, stockIssues, variantIssues, prezziCambiati };
    },
  });

  const groups = cartData?.groups ?? [];
  const orphans = useMemo(() => cartData?.orphans ?? [], [cartData]);
  const stockIssues = useMemo(() => cartData?.stockIssues ?? [], [cartData]);
  const prezziCambiati = useMemo(() => cartData?.prezziCambiati ?? [], [cartData]);
  const variantIssues = useMemo(() => cartData?.variantIssues ?? [], [cartData]);

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

  // Credito MyCity (gift card / punti convertiti) — spendibile sugli ordini COD.
  const { data: walletCents = 0 } = useQuery({
    queryKey: queryKeys.wallet.byUser(authUser?.id ?? ''),
    enabled: !!authUser?.id,
    queryFn: async (): Promise<number> => {
      const { data } = await supabase.from('profiles').select('wallet_balance_cents').eq('id', authUser!.id).single();
      return (data?.wallet_balance_cents as number) ?? 0;
    },
  });

  const [form, setForm] = useState<AddressForm & { lat: number | null; lng: number | null }>({
    fullName: '', address: '', city: 'Piacenza', zip: '29121', phone: '', notes: '',
    lat: null, lng: null,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof AddressForm, string>>>({});
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
      // #3 e #162 — Se cambia l'indirizzo, le coordinate di prima non valgono
      // piu'. Prima restavano attaccate: si sceglieva un indirizzo salvato, si
      // correggeva la via a mano, e il fattorino veniva mandato al punto
      // vecchio — con la strada nuova scritta sulla scheda. Il costo della
      // consegna, che dipende dalla distanza, veniva calcolato sullo stesso
      // punto sbagliato.
      ...(name === 'address' || name === 'city' || name === 'zip' ? { lat: null, lng: null } : {}),
    }));
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
      // #112 — La bozza dell'ordine stava nella memoria della SCHEDA
      // (sessionStorage): il link di conferma dell'email apre una scheda nuova,
      // quindi chi si registrava dal checkout ritrovava il modulo vuoto e
      // doveva riscrivere indirizzo, telefono e note. Ora sta nella memoria del
      // browser (localStorage) e sopravvive alla scheda nuova. Si cancella
      // comunque appena viene ripresa, come prima.
      const raw = localStorage.getItem('mc_checkout_draft') ?? sessionStorage.getItem('mc_checkout_draft');
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<typeof form>;
      setForm((prev) => ({ ...prev, ...draft }));
      localStorage.removeItem('mc_checkout_draft');
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
  const [verificaCodice, setVerificaCodice] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Ritiro in negozio (-10%, no spedizione)
  const [pickupInStore, setPickupInStore] = useState(false);

  // Fascia di consegna ("Quando vuoi riceverlo", step 2). Solo presentazione
  // lato client + una stringa leggibile persistita su orders.delivery_slot.
  // Nessun impatto su totali/spedizione: la matematica resta invariata.
  const [slotDay, setSlotDay] = useState<'now' | 'today' | 'tomorrow'>('today');
  const [slotTodayTime, setSlotTodayTime] = useState(SLOT_DEFAULTS.todayTime);
  const [slotTomorrowTime, setSlotTomorrowTime] = useState(SLOT_DEFAULTS.tomorrowTime);
  // null quando ritiro in negozio (nessuna consegna) o non applicabile.
  const deliverySlot = resolveSlotLabel(slotDay, slotTodayTime, slotTomorrowTime, pickupInStore);

  // Usa il credito MyCity (opt-in, default sì): applicato solo agli ordini COD.
  const [useCredit, setUseCredit] = useState(true);


  // Pagamento: 'cod' = contanti alla consegna (sempre disponibile);
  // 'card' = Stripe Checkout, disponibile solo se la sitewide publishable
  // key e' configurata in produzione (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).
  const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  const stripeAvailable = !!STRIPE_PUBLISHABLE_KEY;
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'card'>(stripeAvailable ? 'card' : 'cod');
  /**
   * #3 — La spedizione la calcola la fonte unica, non questa pagina.
   *
   * La formula era riscritta qui dentro, con due costanti copiate a mano
   * (4,90 e 10%). Due copie della stessa regola sono due regole: quella del
   * server e quella del browser possono divergere in qualunque momento, e
   * quando divergono il cliente vede un prezzo e ne paga un altro. E' gia'
   * successo, ed e' il difetto piu' costoso da spiegare a chi compra.
   *
   * `shippingForEuro` e' la stessa funzione che usa il server quando crea
   * l'ordine: gli stessi dati danno per forza lo stesso centesimo.
   */
  const shippingFor = (g: { storeLat: number | null; storeLng: number | null; items: CartItem[] }): number =>
    shippingForEuro({
      subtotal: groupSubtotal(g),
      storeLat: g.storeLat,
      storeLng: g.storeLng,
      deliveryLat: form.lat,
      deliveryLng: form.lng,
      pickupInStore,
      freeShipping: appliedCoupon?.freeShipping,
    });

  const applyCoupon = async () => {
    setCouponError(null);
    setVerificaCodice(true);
    try {
      const result = await validateCouponFromBrowser(couponCode, grandSubtotal);
      if (!result.ok) {
        setCouponError(result.reason);
        setAppliedCoupon(null);
        return;
      }
      setAppliedCoupon({ coupon: result.coupon, discount: result.discount, freeShipping: result.freeShipping });
      trackCouponApplied(result.coupon.code, Math.round(result.discount * 100));
      toast.success(`Codice "${result.coupon.code}" applicato`);
    } finally {
      setVerificaCodice(false);
    }
  };


  const grandSubtotal = groups.reduce((s, g) => s + groupSubtotal(g), 0);
  const pickupDiscount = pickupInStore ? Math.round(grandSubtotal * (PICKUP_DISCOUNT_PERCENT / 100) * 100) / 100 : 0;
  const grandShipping = appliedCoupon?.freeShipping ? 0 : groups.reduce((s, g) => s + shippingFor(g), 0);
  const platformDeliveryFee = pickupInStore ? 0 : groups.length * (PLATFORM_DELIVERY_FEE_CENTS / 100);
  const discount = appliedCoupon?.discount ?? 0;
  const grandTotal = Math.max(0, grandSubtotal + grandShipping + platformDeliveryFee - discount - pickupDiscount);
  const walletEuro = (walletCents ?? 0) / 100;
  // Il credito si applica solo agli ordini COD in questo flusso (la carta passa da
  // Stripe, dove il credito arriverà più avanti). Mai più del totale dell'ordine.
  const creditApplied = paymentMethod === 'cod' && useCredit ? Math.min(walletEuro, grandTotal) : 0;
  const finalTotal = Math.max(0, grandTotal - creditApplied);

  /**
   * 22/8/2026 — LO SCONTO RESTAVA QUELLO DI PRIMA SE IL CARRELLO CAMBIAVA.
   *
   * Il coupon si verificava una volta, al momento di premere «Applica», e
   * l'importo restava congelato. Poi la persona toglieva un prodotto: lo sconto
   * calcolato su cinquanta euro restava attaccato a un carrello da venti. Nei
   * casi peggiori — «10 € su una spesa da 40» — lo sconto sopravviveva a un
   * carrello che non aveva più diritto ad averlo, e il rifiuto arrivava alla
   * cassa, dopo che la persona aveva già messo l'indirizzo.
   *
   * Qui si rifà il conto quando cambia il totale. Se il codice non vale più,
   * lo si toglie dicendo perché — non in silenzio alla fine.
   */
  useEffect(() => {
    const codice = appliedCoupon?.coupon.code;
    if (!codice) return;
    let vivo = true;
    void (async () => {
      const esito = await validateCouponFromBrowser(codice, grandSubtotal);
      if (!vivo) return;
      if (!esito.ok) {
        setAppliedCoupon(null);
        setCouponError(esito.reason);
        toast.warning(`Il codice "${codice}" non vale più su questo carrello: ${esito.reason}`);
        return;
      }
      // Stesso codice, importo aggiornato al carrello di adesso.
      if (esito.discount !== appliedCoupon.discount || esito.freeShipping !== appliedCoupon.freeShipping) {
        setAppliedCoupon({ coupon: esito.coupon, discount: esito.discount, freeShipping: esito.freeShipping });
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grandSubtotal, appliedCoupon?.coupon.code]);

  /**
   * LA CHIAVE DEL TENTATIVO — chi ordina due volte la stessa spesa deve poterla
   * ordinare due volte (21/8/2026).
   *
   * Qui c'era l'impronta del CARRELLO: contenuto + totale + ritiro, passati in
   * un hash. Serviva a impedire che due clic sullo stesso pulsante creassero
   * due ordini, e per quello funzionava.
   *
   * Ma quell'impronta non cambia mai. Maria compra due filoni ogni martedi':
   * stesso carrello, stesso totale, stesso indirizzo, quindi stessa impronta —
   * per sempre. Il martedi' dopo il server riconosceva la chiave, restituiva
   * gli ordini della settimana prima e il sito le mostrava «Ordine effettuato».
   * Lei aspettava il pane. Al negozio non era arrivato niente. Ed e' il caso
   * piu' normale che esista per un panificio.
   *
   * La chiave adesso identifica IL TENTATIVO, non la spesa: nasce al primo
   * invio, resta uguale se quell'invio viene ripetuto (doppio clic, rete che
   * ritenta, pagina ricaricata a meta'), e muore quando l'ordine e' andato a
   * buon fine. Il tentativo dopo ne avra' una nuova.
   *
   * Vive in `sessionStorage` perche' una pagina ricaricata mentre l'ordine
   * parte e' esattamente il caso che il doppione deve coprire: se la chiave
   * morisse col componente, quel ricaricamento creerebbe il secondo ordine.
   */
  const nuovaChiaveTentativo = useCallback(
    () =>
      chiaveTentativo(
        typeof window === 'undefined' ? null : window.sessionStorage,
        () =>
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      ),
    [],
  );

  const chiudiIlTentativo = useCallback(
    () => chiudiTentativo(typeof window === 'undefined' ? null : window.sessionStorage),
    [],
  );

  const placeOrders = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Niente errore: redirezione al sign-in mantenendo il checkout come destinazione
        router.push('/sign-in?returnTo=/checkout');
        throw new Error('REDIRECT_TO_SIGNIN');
      }
      if (groups.length === 0) throw new Error('Il carrello è vuoto');

      /**
       * 22/8/2026 — QUESTA GEOLOCALIZZAZIONE ERA LAVORO BUTTATO.
       *
       * Qui il browser risolveva l'indirizzo scritto a mano e mandava le
       * coordinate al server. Il server le buttava — giustamente: il prezzo
       * della consegna dipende dalla distanza, e un numero che arriva dal
       * browser si puo' cambiare. Quindi era una chiamata di rete in piu' su
       * ogni checkout, proprio nel momento in cui la persona ha la carta in
       * mano, per un risultato che nessuno usava.
       *
       * Adesso la destinazione se la calcola il server (lib/geocodifica.ts), e
       * qui restano solo le coordinate dell'indirizzo GIA' SALVATO: sono le
       * stesse su cui il server calcola il prezzo, quindi l'anteprima e
       * l'addebito dicono la stessa cifra.
       */
      const deliveryLat: number | null = form.lat;
      const deliveryLng: number | null = form.lng;

      // SICUREZZA: gli ordini COD vengono creati SERVER-SIDE (/api/orders/cod),
      // che ricalcola prezzi, spedizione e sconti dal DB. Il client invia solo
      // prodotti+quantità, l'indirizzo e l'eventuale coupon; nessun importo.
      // #172 — Una chiave per tentativo di checkout: se il pulsante viene
      // premuto due volte, o se la rete ritenta da sola, il server riconosce il
      // doppione e restituisce gli ordini gia' creati invece di farne altri.
      // Vive quanto il carrello: cambia solo quando cambia cosa si sta comprando.
      const chiaveTentativo = `cod-${nuovaChiaveTentativo()}`;
      const res = await fetch('/api/orders/cod', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': chiaveTentativo },
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
          useCredit,
          deliverySlot,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(body, 'Creazione ordine fallita'));
      // 22/8/2026 — la rotta adesso risponde al contratto del progetto,
      // `{ ok: true, data: { … } }`. Si legge da `data`, con il vecchio posto
      // come ripiego finché non è tutto pubblicato.
      const corpoCod = body as {
        data?: { orderIds?: string[] };
        orderIds?: string[];
      };
      const createdOrders: string[] = corpoCod.data?.orderIds ?? corpoCod.orderIds ?? [];
      const ordiniVeri = (body as { ordini?: Array<{ id: string; sellerId: string; totalCents: number }> }).ordini ?? [];
      // #210 e #213 — Prima partiva UN evento solo, con due difetti dentro.
      //
      // Il primo: l'importo era `grandTotal`, cioe' la stima del browser prima
      // del credito MyCity. Il cliente pagava 22 euro e nella misura ne
      // risultavano 40. Ora l'importo e' quello che risponde il server, ordine
      // per ordine: e' l'unico che sa quanto e' stato davvero addebitato.
      //
      // Il secondo: un carrello con due negozi crea due ordini, ma l'evento era
      // uno e il venditore diventava la parola «multi». Il fatturato per negozio
      // non esisteva, e il conto degli acquisti non tornava mai con la tabella
      // degli ordini. Ora un evento per ordine, col negozio vero, e il
      // `checkout_id` comune per riconoscere che vengono dallo stesso carrello.
      const carrelloId = createdOrders[0] ?? null;
      for (const o of ordiniVeri) {
        trackOrderPlaced(o.id, o.totalCents, 'cod', o.sellerId, {
          coupon: appliedCoupon?.coupon.code,
          checkoutId: carrelloId,
        });
      }
      return createdOrders;
    },
    onSuccess: (orderIds) => {
      // Il tentativo e' andato a buon fine: la sua chiave ha finito il lavoro.
      // Se restasse, il prossimo ordine identico si vedrebbe restituire questo.
      chiudiIlTentativo();
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
          deliverySlot,
        }),
      });
      const data = await res.json();
      // 22/8/2026 — la rotta risponde al contratto `{ ok, data }`. Il vecchio
      // posto resta come ripiego finché non è tutto pubblicato.
      const corpo = data as { data?: { url?: string }; url?: string };
      const indirizzo = corpo.data?.url ?? corpo.url;
      if (!res.ok || !indirizzo) {
        throw new Error(apiErrorMessage(data, 'Errore creazione pagamento'));
      }
      return indirizzo;
    },
    onSuccess: (url) => {
      // Stash del valore d'acquisto per emettere `purchase` (GA4) + `order_placed`
      // al rientro su /orders?stripe=success: lì gli ordini sono già creati dal
      // webhook ma il client non ne conosce i totali, quindi li portiamo da qui.
      try {
        // #210 — Qui resta solo il codice sconto, che il rientro non puo'
        // ricavare dalla riga ordine. L'importo e il negozio NON si portano
        // piu' dal browser: al rientro si leggono da `orders`, dove il webhook
        // Stripe ha scritto quello che e' stato davvero incassato.
        sessionStorage.setItem('mc_pending_purchase', JSON.stringify({
          coupon: appliedCoupon?.coupon.code ?? null,
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
    // Indirizzo/città/CAP non obbligatori per il ritiro in negozio (fix #24).
    if (!pickupInStore) {
      if (!form.address.trim()) e.address = 'Inserisci l\'indirizzo di consegna';
      if (!form.city.trim()) e.city = 'Inserisci la città';
      if (!/^\d{5}$/.test(form.zip.trim())) e.zip = 'CAP non valido (5 cifre)';
    }
    if (form.phone.trim().replace(/\D/g, '').length < 8) e.phone = 'Numero di telefono non valido';
    return e;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors = validateAddress();
    setErrors(fieldErrors);
    const firstInvalid = (['fullName', 'address', 'city', 'zip', 'phone'] as const).find((k) => fieldErrors[k]);
    if (firstInvalid) {
      // 127 — Il fuoco si cercava nello stesso giro in cui si scrivevano gli
      // errori: il form era ancora nascosto e `focus()` non attaccava su niente.
      // Un fotogramma di attesa e il campo esiste, e' visibile, e ci si puo'
      // andare. E se per qualunque motivo non ci fosse, si dice comunque cosa
      // manca, invece di lasciare la persona davanti a un pulsante muto.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[name="${firstInvalid}"]`);
        if (el) {
          el.focus();
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else {
          toast.error(fieldErrors[firstInvalid] ?? 'Controlla i dati di consegna');
        }
      });
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
      try { localStorage.setItem('mc_checkout_draft', JSON.stringify(form)); } catch { /* noop */ }
      router.push('/sign-in?returnTo=/checkout');
      return;
    }
    if (paymentMethod === 'card' && stripeAvailable) {
      payWithStripe.mutate();
    } else {
      placeOrders.mutate();
    }
  };

  // I tre esiti, nell'ordine giusto: prima «non ho ancora guardato», poi «ho guardato e non c'è
  // niente». Prima stavano al contrario, e il ramo del vuoto vinceva sempre.
  const vistaCarrello = statoDellaVista({ letto: carrelloLetto, caricando: loadingGroups, quanti: cart.length });

  if (vistaCarrello.mostraScheletro) {
    return <LoadingState />;
  }

  if (vistaCarrello.mostraVuoto) {
    return (
      <div className="container mx-auto p-12 text-center space-y-4">
        <p className="text-ink-500 text-lg">Il tuo carrello è vuoto.</p>
        <Button href="/">Torna al negozio</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-6xl pb-28 lg:pb-8">
      {/* Back-to-cart + H1 serif visibile */}
      <Link
        href="/cart"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900 mb-1"
      >
        <ArrowLeft size={17} aria-hidden /> Torna al carrello
      </Link>
      <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900 mb-5">Conferma il tuo ordine</h1>

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
        <div className="lg:col-span-2 space-y-4">
          {/* STEP 1 — Indirizzo */}
          <StepCard n={1} icon={MapPin} title="Indirizzo di consegna">
            <ShippingAddressForm
              form={form}
              savedAddresses={savedAddresses}
              errors={errors}
              onChange={handleChange}
              onSubmit={handleSubmit}
              onApplySavedAddress={applySavedAddress}
            />
          </StepCard>

          {/* STEP 2 — Quando vuoi riceverlo (consegna / express / ritiro) */}
          <StepCard n={2} icon={Truck} title="Quando vuoi riceverlo">
            {pickupInStore ? (
              <div className="flex items-center gap-2 rounded-xl border border-olive-200 bg-olive-50 px-4 py-3 text-sm text-olive-800">
                <Store size={16} className="text-olive-700 shrink-0" aria-hidden /> Ritiro in negozio selezionato — nessun costo di consegna. Vai tu quando l&apos;ordine è pronto.
              </div>
            ) : (
              <>
                {/* Chooser fascia di consegna (day tiles + finestre orarie). Solo
                    a domicilio: il ritiro in negozio non richiede una fascia. */}
                <DeliverySlotPicker
                  day={slotDay}
                  onDayChange={setSlotDay}
                  todayTime={slotTodayTime}
                  onTodayTimeChange={setSlotTodayTime}
                  tomorrowTime={slotTomorrowTime}
                  onTomorrowTimeChange={setSlotTomorrowTime}
                />

                {/* Metodo + costo di consegna (invariato). */}
                <div className="flex items-center justify-between rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 mt-3">
                  <div>
                    <p className="font-bold text-ink-900">Consegna a domicilio</p>
                    <p className="text-sm text-ink-600">In 30-60 minuti dalla conferma del negozio{groups.length > 1 ? ` · ${groups.length} negozi` : ''}</p>
                  </div>
                  <span className="font-serif text-lg font-extrabold text-ink-900">
                    {grandShipping === 0 ? <span className="text-olive-700">Gratis</span> : formatPrice(grandShipping)}
                  </span>
                </div>
              </>
            )}
          </StepCard>

          {/* STEP 3 — Come paghi (carta / COD + ritiro come tile metodo) */}
          <StepCard n={3} icon={Wallet} title="Come paghi">
            <PaymentMethodSelector
              value={paymentMethod}
              onChange={(m) => { setPaymentMethod(m); trackCheckoutStep('payment_method', { method: m }); }}
              stripeAvailable={stripeAvailable}
              multiSeller={groups.length > 1}
              pickupInStore={pickupInStore}
              onPickupChange={setPickupInStore}
              pickupDiscount={pickupDiscount}
              pickupDiscountPercent={PICKUP_DISCOUNT_PERCENT}
            />

            {/* Credito MyCity — solo COD in questo flusso */}
            {paymentMethod === 'cod' && walletEuro > 0 && (
              <label className="mt-3 flex items-start gap-3 p-4 rounded-xl border-2 border-cream-300 bg-white cursor-pointer hover:border-primary-200">
                <input
                  type="checkbox"
                  checked={useCredit}
                  onChange={(e) => setUseCredit(e.target.checked)}
                  className="mt-2.5 w-4 h-4 accent-primary-600"
                />
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                  <Wallet size={20} aria-hidden />
                </span>
                <div className="flex-1">
                  <p className="font-bold text-ink-900">Usa il mio credito MyCity</p>
                  <p className="text-sm text-ink-600 mt-0.5">
                    Hai {formatPrice(walletEuro)} di credito.{creditApplied > 0 ? ` Applicati ${formatPrice(creditApplied)} a questo ordine.` : ''}
                  </p>
                </div>
              </label>
            )}

            {/* NOTE PER IL RIDER — spostate qui (step conferma) come da mockup.
                Stesso `name="notes"` + handler: aggiorna `form.notes` nello state,
                che è ciò che le mutation di submit leggono. Nessun cambio di logica. */}
            <div className="mt-4">
              <Textarea
                label="Note per il rider (opzionale)"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                rows={2}
                placeholder="Es. citofono Rossi, suonare al 2° piano…"
                className="resize-none"
              />
            </div>
          </StepCard>

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
            <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-800 space-y-3">
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

          {/* 22/8/2026 — QUESTI RIQUADRI NON VENIVANO MAI ANNUNCIATI.
              Compaiono dopo che la pagina e' gia' a schermo, e senza
              `role="alert"` uno screen reader non li legge: chi non vede sente
              solo che il pulsante di conferma non risponde piu', senza sapere
              perche'. `role="alert"` li fa leggere appena compaiono — e' la
              stessa correzione gia' applicata ai campi del modulo. */}
          {stockIssues.length > 0 && (
            <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
              <span><strong>Disponibilità insufficiente</strong> per: {stockIssues.map((s) => `${s.name} (richiesti ${s.requested}, disponibili ${s.available})`).join('; ')}. Riduci le quantità nel carrello per procedere.</span>
            </div>
          )}

          {/* #114 — Il prezzo e' cambiato da quando l'articolo e' entrato nel
              carrello: si dice, con la cifra di prima e quella di adesso. Il
              totale qui sotto e' gia' quello nuovo, cioe' quello che verra'
              addebitato davvero. */}
          {prezziCambiati.length > 0 && (
            <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
              <span>
                <strong>Il prezzo è cambiato</strong> da quando avevi messo nel carrello:{' '}
                {prezziCambiati.map((p) => `${p.name} (${formatPrice(p.prima)} → ${formatPrice(p.adesso)})`).join('; ')}.
                Il totale qui sotto è già aggiornato.
              </span>
            </div>
          )}

          {variantIssues.length > 0 && (
            <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
              <span>
                <strong>Scegli le opzioni</strong> (taglia/colore) per: {variantIssues.map((v) => v.name).join(', ')}.{' '}
                Apri il prodotto, seleziona la variante e aggiungilo di nuovo al carrello.
              </span>
            </div>
          )}

          {groups.length === 0 && orphans.length === 0 && !loadingGroups && (
            <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-800 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
              <span><strong>Errore nel caricamento dei prodotti.</strong> Prova a ricaricare la pagina, oppure svuota il carrello e riprova.</span>
            </div>
          )}
        </div>

        {/* RIEPILOGO ORDINE */}
        <div className="lg:sticky lg:top-[var(--header-height)] h-fit space-y-4">
          <div className="bg-white border border-surface-200 rounded-xl shadow-card overflow-hidden">
            <div className="bg-surface-50 border-b border-surface-200 px-5 py-3 flex justify-between items-center">
              <h2 className="font-serif text-lg font-bold text-ink-900">Riepilogo</h2>
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
              applying={verificaCodice}
            />

            <OrderSummary
              subtotal={grandSubtotal}
              shipping={grandShipping}
              platformDeliveryFee={platformDeliveryFee}
              pickupDiscount={pickupDiscount}
              couponDiscount={discount}
              creditApplied={creditApplied}
              total={finalTotal}
              isCheckingOut={isCheckingOut}
              paymentMethod={paymentMethod}
              disabled={groups.length === 0 || stockIssues.length > 0 || variantIssues.length > 0}
            />
          </div>
        </div>
      </div>

      {/* Barra conferma mobile sticky — riusa lo stesso submit di OrderSummary
          (form="checkout-form"): nessuna logica nuova, solo un secondo trigger.
          Nascosta su desktop (lì c'è la sidebar sticky). Non intrappola il focus:
          è un singolo bottone nel flusso tab naturale. */}
      {/* 22/8/2026 — IL BANNER DEI COOKIE COPRIVA «CONFERMA ORDINE».
          Sul telefono questa barra sta incollata in fondo, e il banner dei
          cookie pure: chi non ha ancora scelto se ne trova due sovrapposte, con
          il banner sopra. Il pulsante che chiude l'ordine — l'ultimo tocco di
          tutto il percorso — resta sotto e non si preme. La barra del prodotto
          (StickyAddToCart) lo sapeva gia' e si alzava; questa no. */}
      <div
        className="lg:hidden fixed inset-x-0 bottom-0 z-sticky bg-white border-t border-cream-300 shadow-warm-lg px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center gap-3"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--altezza-banner-cookie, 0px))' }}
      >
        <div className="leading-tight">
          <div className="text-2xs font-semibold uppercase tracking-label text-ink-500">Totale</div>
          <div className="font-serif text-xl font-extrabold text-ink-900">{formatPrice(finalTotal)}</div>
        </div>
        <button
          type="submit"
          form="checkout-form"
          disabled={isCheckingOut || groups.length === 0 || stockIssues.length > 0 || variantIssues.length > 0}
          aria-label={
            paymentMethod === 'card'
              ? 'Paga con carta e conferma ordine'
              : 'Ordina e paga alla consegna'
          }
          className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-700 hover:bg-primary-800 text-white disabled:opacity-50 disabled:cursor-not-allowed py-3 rounded-lg font-extrabold text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
        >
          {isCheckingOut
            ? (paymentMethod === 'card' ? 'Apertura…' : 'Elaborazione…')
            : (paymentMethod === 'card' ? 'Paga con carta' : 'Ordina e paga alla consegna')}
        </button>
      </div>
    </div>
  );
}
