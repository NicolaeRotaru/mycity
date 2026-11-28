'use client';

import { useState, use, useRef, useEffect } from 'react';
import { ANELLO, classiBottoneCuore } from '@/lib/design/cuore-preferito';
import FotoConRipiego from '@/components/ui/FotoConRipiego';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart, Banknote, Bike, MessageCircle, RotateCcw, Store, ShoppingCart, Ban, Check, Flame, Package, ShieldCheck, Star, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { fotoDiCasa } from '@/lib/storage/foto-di-casa';
import { domandaProdotto, negozioDellaSchedaOperativo } from '@/lib/queries/catalogo';
import { addToCart, getCart, updateQuantity, type CartItem } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { discountedUnitCents, fetchActiveDiscounts } from '@/lib/promotions';
import { scontoMostrato } from '@/lib/sconto-mostrato';
import { LARGHEZZA_MASSIMA, sizedImage } from '@/lib/image-url';
import { SIZES_FOTO_PRODOTTO } from '@/lib/preload-foto';
import { LOW_STOCK_THRESHOLD, NEW_PRODUCT_DAYS } from '@/lib/constants';
import { fraseResoDelProdotto, frasePagamento, promessaSpedizione } from '@/lib/promesse-pubbliche';
import { esclusiAncheDallaCategoria } from '@/lib/ordini/recesso-per-categoria';
import { sopraIlTettoDeiContanti } from '@/lib/ordini/tetto-dei-contanti';
import { vociDellaConsegna } from '@/lib/ordini/prezzi';
import { ErrorState } from '@/components/ui/ErrorState';
import { RatingStars } from '@/components/ui/RatingStars';
import { CHIAVI_FUORI_DALLA_GRIGLIA, findLabelForKey, formatAttributeValue } from '@/lib/category-attributes';
import { UNIT_SUFFIX, CONDITION_LABELS, type ProductUnit, type ProductCondition } from '@/lib/products/schema';
import { statoSceltaVarianti, valoreSenzaVariante } from '@/lib/products/variants';
import { loadProductVariants } from '@/lib/products/persistVariants';
import { deriveQualityMarks } from '@/lib/products/qualityMarks';
import { useFavorites } from '@/components/hooks/useFavorites';
import { eAcceso, siPuoPremere, statoInterruttore } from '@/lib/stato-interruttore';
import { useProfile } from '@/components/hooks/useProfile';
import { useShoppingMode, useCanPurchase } from '@/components/hooks/useShoppingMode';
import { ricordaMetodoScelto } from '@/components/checkout/PaymentMethodSelector';
import ContactSellerButton from '@/components/ContactSellerButton';
import ProductViewTracker from '@/components/ProductViewTracker';
import ProductQA from '@/components/ProductQA';
import RecentlyViewed from '@/components/RecentlyViewed';
import StickyAddToCart from '@/components/StickyAddToCart';
import { AttivaAbbonamento } from '@/components/products/AttivaAbbonamento';
import { eDiSdg } from '@/lib/products/sdgSeller';
import { CHIAVE_PREVENTIVO, leggiPreventivoAgenzia } from '@/components/seller/preventivo-agenzia';
import { dettagliDelServizio, eServizio, ETICHETTA_PRENOTA, ETICHETTA_PRENOTA_CORTA } from '@/lib/products/servizio';
import QuandoSiVede from '@/components/QuandoSiVede';
import SimilarProducts from '@/components/SimilarProducts';
import ActivePromoBadge from '@/components/ActivePromoBadge';
import AddToListButton from '@/components/AddToListButton';
import PhotoReviewUpload from '@/components/PhotoReviewUpload';
import { SellerCard } from '@/components/products/SellerCard';
import { VendutoDa } from '@/components/products/VendutoDa';
import { Segnala } from '@/components/Segnala';
import { AllergensAccordion } from '@/components/products/AllergensAccordion';
import { FrequentlyBoughtTogether } from '@/components/products/FrequentlyBoughtTogether';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { QualityMarks } from '@/components/ui/QualityMarks';
import { DeliveryCutoff } from '@/components/ui/DeliveryCutoff';
import { useExternalProduct } from '@/components/hooks/useExternalProduct';
import { SocialProof } from '@/components/ui/SocialProof';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';
import { trackReviewSubmitted } from '@/lib/analytics/events';
import caricatoreFotoRemote from '@/lib/image-loader';
import { FOTO_MANCANTE } from '@/lib/foto-mancante';
import { INVITI_E_PUNTI_ACCESI } from '@/lib/funzioni-al-lancio';
import { creaFrenoDoppioTocco } from '@/lib/ui/freno-doppio-tocco';

// Chiavi attributo gestite dall'accordion "Ingredienti e allergeni": vengono
// escluse dalla griglia generica "Caratteristiche" per non duplicarle.
const ALLERGEN_ACCORDION_KEYS = ['allergeni', 'ingredienti', 'conservazione', 'valori_nutrizionali'];
// R24-003 — Una recensione di questo cliente su questo prodotto c'è già.
const GIA_RECENSITO = 'Hai già recensito questo prodotto: resta pubblicata la recensione di prima.';

/**
 * 30/8/2026 (R068) — La forma della scheda e la domanda che la legge stanno in
 * `lib/queries/catalogo.ts`: da li' le usa anche il guscio della pagina, che
 * precarica il prodotto sul server e lo consegna dentro l'HTML.
 */

/**
 * R08-005 — La quantita' netta scritta dal negozio («190 g», «1kg», «1,5 L», «75cl»), letta in modo
 * tollerante. Torna la quantita' in grammi o in millilitri e la famiglia (peso o volume), oppure
 * null se non e' un numero con un'unita' riconosciuta («6 pezzi», «boh», «0 g»).
 * Il punto con tre cifre dopo e' quello delle migliaia, all'italiana: «1.000 g» sono mille grammi.
 * Fuori da 1 g/ml … 50 kg/l per un pezzo o una confezione il dato e' sbagliato: nessuna riga.
 */
function leggiQuantitaNetta(v: unknown): { quantita: number; famiglia: 'kg' | 'l' } | null {
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(kg|g|gr|grammi|l|lt|litri|litro|ml|cl|dl)\.?\s*$/i.exec(v);
  if (!m) return null;
  const cifre = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(m[1]) ? m[1].replace(/\./g, '') : m[1];
  const n = Number(cifre.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2].toLowerCase();
  const per =
    u === 'kg' || u === 'l' || u === 'lt' || u === 'litri' || u === 'litro' ? 1000 : u === 'cl' ? 10 : u === 'dl' ? 100 : 1;
  const quantita = n * per;
  if (quantita < 1 || quantita > 50000) return null;
  const famiglia = u === 'kg' || u === 'g' || u === 'gr' || u === 'grammi' ? 'kg' : 'l';
  return { quantita, famiglia };
}

/**
 * R08-005 — Il prezzo per unita' di misura (Codice del Consumo): € al chilo o al litro, al centesimo.
 * Solo quando il prezzo e' a pezzo o a confezione e la quantita' netta e' leggibile; altrimenti null
 * (nessuna riga, mai un numero inventato).
 */
function prezzoPerUnitaDiMisura(
  prezzo: unknown,
  unitaDiVendita: string | null | undefined,
  quantitaNetta: unknown,
): { valore: number; unita: 'kg' | 'l' } | null {
  if (unitaDiVendita && unitaDiVendita !== 'pezzo' && unitaDiVendita !== 'confezione') return null;
  const p = typeof prezzo === 'number' ? prezzo : Number(prezzo);
  if (!Number.isFinite(p) || p <= 0) return null;
  const q = leggiQuantitaNetta(quantitaNetta);
  if (!q) return null;
  // Il conto si fa in centesimi interi: 3,15 € per 400 g sono 7,875 → 7,88, come 1,25 € per 400 g → 3,13.
  const centesimi = Math.round((Math.round(p * 100) * 1000) / q.quantita);
  if (centesimi <= 0) return null;
  return { valore: centesimi / 100, unita: q.famiglia };
}

export default function ProductPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const router = useRouter();
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const frenoAggiunta = useRef(creaFrenoDoppioTocco());
  // Il freno vale per la stessa scelta (variante + quantità): una scelta diversa riparte da capo.
  const sceltaFrenata = useRef<string | null>(null);
  // 5/11/2026 — Dopo il primo tocco su «Compra ora» il pulsante si spegne fino al cambio pagina.
  const [inPartenza, setInPartenza] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  // R02-006 — Le righe che il carrello ha già: «Compra ora» apre la cassa su TUTTO il carrello, e il
  // tetto dei contanti si guarda lì. Si rileggono a ogni cambio del carrello (anche da un'altra scheda).
  const [righeDelCarrello, setRigheDelCarrello] = useState<CartItem[]>([]);
  // R01-009 — Il prezzo di oggi delle ALTRE righe (centesimi, promo compresa), riletto come la cassa.
  const [centsDiOggi, setCentsDiOggi] = useState<Record<string, number>>({});
  const [activeImg, setActiveImg] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  // R08-003 — L'indirizzo dello zoom che non ha risposto (foto cancellata): al suo posto il segnaposto,
  // lo stesso di FotoConRipiego. Si ricorda l'indirizzo, non un vero/falso: un'altra foto riprova.
  const [zoomFallito, setZoomFallito] = useState<string | null>(null);
  /**
   * #135 e #120 — Il visore a schermo intero era un `fixed inset-0` scritto a
   * mano: nessun Esc, nessuna trappola del fuoco, nessun blocco dello
   * scorrimento. Da tastiera si finiva a navigare la pagina sotto il velo nero,
   * senza vedere dove si era e senza modo di chiudere; sul telefono la pagina
   * scorreva dietro la foto. E si dichiarava `aria-modal`, cioe' prometteva
   * esattamente quello che non faceva.
   *
   * Lo stesso hook dei pannelli filtri: Esc, fuoco che entra e torna al
   * pulsante, scorrimento bloccato.
   */
  const lightboxRef = useRef<HTMLDivElement>(null);
  const zoomTriggerRef = useRef<HTMLButtonElement>(null);
  /** Quante foto ha il prodotto: l'elenco nasce piu' sotto, dopo i controlli
   *  di caricamento, e gli hook devono stare tutti prima. */
  const numeroFoto = useRef(1);
  // "Nuovo" calcolato post-hydration (come ProductCard): Date.now() differisce
  // server/client e su prodotti vicini al limite NEW_PRODUCT_DAYS causa mismatch.
  const [isNew, setIsNew] = useState(false);
  // Carosello: contenitore scroll-snap della foto principale + swipe nel lightbox.
  const galleryRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const { isAuthenticated, profile, isSeller, isAdmin } = useProfile();
  const shoppingMode = useShoppingMode(isSeller);
  const mayPurchase = useCanPurchase(isAdmin, isSeller, shoppingMode);
  const { favorites, lettoDavvero: preferitiLetti, toggle: toggleFav } = useFavorites();
  // Tre stati, non due — regola condivisa in `lib/stato-interruttore.ts`. Col terzo il cuore non
  // puo' dire di no, e il bottone non puo' agire: `toggle` decide se aggiungere o togliere
  // guardando la lista, e su una lista che non ha letto sceglierebbe a caso.
  const statoCuore = statoInterruttore({ letto: preferitiLetti, dentro: favorites.has(id) });
  const isFav = eAcceso(statoCuore);
  const cuorePremibile = siPuoPremere(statoCuore);

  // Form recensione
  // R24-003 — Le stelle partono vuote: con 5 già scelte, chi non le toccava lasciava cinque stelle
  // senza averle scelte. «Pubblica» resta spento finché non si vota, e dopo l'invio si torna a zero.
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewPhotos, setReviewPhotos] = useState<string[]>([]);
  // R24-003 — Il freno al doppio invio, come in app/orders/[id]/review/page.tsx (R24-012):
  // `isPending` diventa vero solo al disegno dopo, e due invii nello stesso istante facevano due
  // scritture; la seconda urtava il vincolo e chi recensiva per la prima volta leggeva «Hai già
  // recensito». Si riapre solo se l'invio non riesce; dopo il successo resta chiuso e lo dice.
  const invioRecensione = useRef<'libero' | 'in_volo' | 'fatto'>('libero');

  // Ordinamento + filtro "Con foto" delle recensioni (client-side, sui dati già caricati).
  const [reviewSort, setReviewSort] = useState<'recent' | 'top' | 'low'>('recent');
  const [reviewsOnlyPhoto, setReviewsOnlyPhoto] = useState(false);
  // Il nodo della sezione recensioni. Sta in uno stato e non in una `ref` perche'
  // la sezione non esiste al primo giro (la pagina mostra lo scheletro): con la
  // `ref` l'osservatore si sarebbe attaccato al vuoto e non sarebbe mai scattato.
  const [nodoRecensioni, setNodoRecensioni] = useState<HTMLElement | null>(null);
  const [recensioniInVista, setRecensioniInVista] = useState(false);

  // 30/8/2026 (R068) — LA SCHEDA ARRIVAVA VUOTA NELL'HTML.
  //
  // Questa pagina e' tutta del browser: il telefono scaricava il codice, lo
  // eseguiva, e solo allora chiedeva nome, prezzo e foto. Due viaggi di rete in
  // fila prima di vedere qualcosa, sulla pagina che fa comprare.
  //
  // La domanda adesso vive in `lib/queries/catalogo.ts` e la fa anche il guscio
  // (`layout.tsx`), che gira sul server: quando questo codice parte, la risposta
  // e' gia' in mano e qui non si va in rete. La riga qui sotto non sa niente di
  // tutto questo — ed e' il punto: funziona perche' la domanda e' LA STESSA.
  const { data: product, isLoading, isError, refetch } = useQuery(domandaProdotto(supabase, id));

  // Varianti (taglie/colori): caricate a parte, alimentano i selettori opzione.
  // 31/10/2026 — «Escluso dal recesso» (migrazione 180) si legge a parte, con `*`:
  // prima della 180 la colonna non c'e', la riga arriva senza e vale la frase
  // generale (FRASE_RESO di lib/promesse-pubbliche, che nomina gli esclusi); cosi'
  // anche se la lettura cade. La frase si sceglie la', mai una copia qui.
  const { data: rigaDelRecesso = null, isPending: tipoInLettura } = useQuery({
    queryKey: ['product', id, 'recesso'],
    // 27/11/2026 — Finché questa lettura non risponde non si sa se è un servizio, e il carrello
    // aspetta: un solo nuovo tentativo, per non tenerlo spento a lungo se cade.
    retry: 1,
    queryFn: async () => {
      const { data: letta } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
      const riga = letta as { tipo?: unknown; durata_minuti?: unknown; dove_servizio?: unknown } | null;
      // R09-015 — Anche il pane escluso per categoria (non solo con la spunta): la regola dei resi.
      const [data = null] = letta ? await esclusiAncheDallaCategoria(supabase, [letta as { category_id?: unknown }]) : [];
      // 27/11/2026 — Con la stessa lettura (`*`, che regge anche prima della 999g) arriva il `tipo`:
      // senza la colonna la riga non lo porta, e l'annuncio resta un prodotto.
      return {
        non_recedibile: (data as { non_recedibile?: unknown } | null)?.non_recedibile === true,
        tipo: riga?.tipo === 'servizio' ? 'servizio' : 'prodotto',
        durata_minuti: riga?.durata_minuti ?? null,
        dove_servizio: riga?.dove_servizio ?? null,
      };
    },
  });
  // 27/11/2026 — Un servizio (migrazione 999g) non si compra col carrello: si prenota scrivendo al negozio.
  // Gli abbonamenti di SDG sono servizi (999g) ma hanno il loro percorso (AttivaAbbonamento), che vince.
  const eUnServizio = eServizio(rigaDelRecesso) && !eDiSdg(product?.seller_id);
  // 28/11/2026 — Sulla pagina di un abbonamento di SDG, un negozio già abbonato non deve vedere «Scegli l'abbonamento».
  const { data: preventivoDelNegozio } = useQuery({
    queryKey: CHIAVE_PREVENTIVO,
    queryFn: leggiPreventivoAgenzia,
    enabled: isSeller && eDiSdg(product?.seller_id),
    retry: false,
  });
  const dettagliServizio = eUnServizio && rigaDelRecesso ? dettagliDelServizio(rigaDelRecesso) : null;
  const fraseReso = fraseResoDelProdotto(rigaDelRecesso);

  const { data: variants = [], isError: variantiInErrore, refetch: rileggiVarianti } = useQuery({
    queryKey: ['product-variants', id],
    queryFn: () => loadProductVariants(id),
  });

  // Prodotto importato da marketplace: tempo di consegna esterno in tempo reale
  // (snapshot in cache + refresh in background lato server).
  const external = useExternalProduct(id, {
    hasExternal: !!(product as { external_source_url?: string | null } | undefined)?.external_source_url,
  });

  type ReviewRow = {
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    user_id: string;
    photo_urls: string[] | null;
    verified_purchase: boolean;
  };
  // 6/9/2026 — LE RECENSIONI PESAVANO SUL PULSANTE «AGGIUNGI AL CARRELLO».
  //
  // Era una domanda sola: duecento recensioni INTERE — commento e foto comprese —
  // chieste all'apertura della pagina, in gara di banda con la foto del prodotto e
  // col pulsante che fa comprare. Il commento e' il campo pesante, ed e' anche
  // l'unico che nessuno legge finche' non scorre fin laggiu'.
  //
  // Adesso sono due domande con due pesi diversi:
  //  · il RIEPILOGO chiede due colonne sole — voto e foto — e parte subito, perche'
  //    la media e il numero di recensioni si leggono in alto, accanto al titolo.
  //  · l'ELENCO porta i commenti, cioe' il grosso, e parte solo quando la sezione
  //    delle recensioni si avvicina allo schermo.
  //
  // Le due chiavi nascono dalla stessa radice `queryKeys.reviews.detail(id)`: chi
  // invalida dopo una recensione nuova le prende tutte e due, senza saperlo.
  type RiepilogoRow = Pick<ReviewRow, 'rating' | 'photo_urls'>;
  const { data: riepilogoRecensioni = [] } = useQuery({
    queryKey: [...queryKeys.reviews.detail(id), 'riepilogo'],
    queryFn: async (): Promise<RiepilogoRow[]> => {
      const { data, error } = await supabase.from('reviews')
        .select('rating, photo_urls').eq('product_id', id)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as RiepilogoRow[];
    },
  });

  const {
    data: reviews = [],
    isSuccess: elencoRecensioniPronto,
    isError: elencoRecensioniRotto,
    refetch: ricaricaRecensioni,
  } = useQuery({
    queryKey: [...queryKeys.reviews.detail(id), 'elenco'],
    enabled: recensioniInVista,
    queryFn: async (): Promise<ReviewRow[]> => {
      const { data, error } = await supabase.from('reviews')
        .select('id, rating, comment, created_at, user_id, photo_urls, verified_purchase').eq('product_id', id)
        .order('verified_purchase', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });

  const submitReview = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/sign-in?returnTo=/product/${id}`);
        throw new Error('REDIRECT');
      }
      // Verified purchase: controlla se l'utente ha un ordine consegnato
      // contenente questo prodotto. Trust & Safety: badge anti-fake reviews.
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('id, orders!inner(user_id, delivery_status)')
        .eq('product_id', id)
        .eq('orders.user_id', user.id)
        .eq('orders.delivery_status', 'DELIVERED')
        .limit(1);
      const verified = (orderItems?.length ?? 0) > 0;

      const { error } = await supabase.from('reviews').insert({
        product_id: id,
        user_id: user.id,
        rating: reviewRating,
        comment: reviewComment.trim() || null,
        photo_urls: reviewPhotos.length > 0 ? reviewPhotos : null,
        verified_purchase: verified,
      });
      if (error) throw error;

      // SICUREZZA: il bonus fedeltà per recensione-con-foto (+20) è accreditato
      // SERVER-SIDE da un trigger su `reviews` (migration 059), con valore fisso.
      // Prima veniva chiamata `award_loyalty_points` dal browser con p_delta
      // arbitrario: un utente poteva accreditarsi punti illimitati. La RPC ora
      // è eseguibile solo da service_role.
    },
    onSuccess: () => {
      // #224 — La recensione era nel catalogo eventi e non la emetteva
      // nessuno. Si contava quante ne arrivavano guardando la tabella, mai
      // dentro il funnel: non si poteva legare «ha recensito» a «ha ricomprato».
      void trackReviewSubmitted(id, reviewRating, reviewPhotos.length > 0);
      qc.invalidateQueries({ queryKey: queryKeys.reviews.detail(id) });
      setReviewComment('');
      setReviewRating(0);
      setReviewPhotos([]);
      toast.success(
        // 5/11/2026 — I punti sono spenti al lancio: si promettono solo se l'interruttore è acceso.
        reviewPhotos.length > 0 && INVITI_E_PUNTI_ACCESI
          ? `Grazie! Recensione pubblicata · +20 punti loyalty per le foto`
          : 'Grazie per la recensione!'
      );
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message === 'REDIRECT') return;
      // R24-003 — La seconda recensione urta il vincolo (product_id, user_id): si dice cosa è
      // successo, invece di «Questo valore è già stato usato».
      if ((err as { code?: string } | null)?.code === '23505') {
        toast.error(GIA_RECENSITO);
        return;
      }
      toast.error(friendlyError(err));
    },
  });

  /**
   * 5/11/2026 — IL MODULO SI APRIVA A CHI NON PUÒ RECENSIRE.
   * Il database accetta la recensione solo da chi ha un ordine consegnato con questo prodotto;
   * agli altri, dopo stelle, commento e foto caricate, arrivava solo «non hai i permessi».
   * Qui si chiede prima, con la stessa domanda della verifica d'acquisto. Finché non si sa (o se
   * la lettura cade) il modulo resta: decide comunque il database.
   */
  const { data: haRicevutoIlProdotto } = useQuery({
    queryKey: ['reviews', 'puo-recensire', id, profile?.id ?? ''],
    enabled: !!profile?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('order_items')
        .select('id, orders!inner(user_id, delivery_status)')
        .eq('product_id', id)
        .eq('orders.user_id', profile!.id)
        .eq('orders.delivery_status', 'DELIVERED')
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
  });

  /**
   * 5/11/2026 — LO SCONTO DELLA PROMOZIONE DEL NEGOZIO NEL PREZZO GRANDE.
   * Carrello e cassa applicano lo sconto (product_active_discount); la scheda mostrava in grande il
   * prezzo pieno, e quello vero solo nel riquadrino della promo. Stessa chiave e stessa lettura di
   * ActivePromoBadge: una domanda sola.
   */
  // R02-011 (dopo il collaudo) — Se la lettura cade anche dopo i nuovi tentativi, lo zero di
  // ripiego NON vuol dire «nessuno sconto»: la scheda lo dice (scontoNonVerificato) invece di
  // presentare il prezzo pieno come quello che si paga.
  const { data: scontoPromo = 0, isError: scontoNonVerificato } = useQuery({
    queryKey: queryKeys.products.activeDiscount(id),
    retry: 3,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('product_active_discount', { p_product: id });
      // 12/11/2026 (R02-011) — Una lettura caduta non è «nessuno sconto»: con `return 0` lo zero
      // restava in memoria per un minuto (stessa chiave della scheda) e si mostrava il prezzo pieno,
      // mentre la cassa applica lo sconto. Si lancia: React Query riprova, e non si salva lo zero.
      if (error) throw error;
      return Number(data) || 0;
    },
    staleTime: 60_000,
    // R18-007 — La scheda lasciata aperta oltre la fine della promo la rilegge ogni minuto, invece di
    // tenere lo sconto letto all'apertura (cassa e carrello restano il presidio).
    refetchInterval: 60_000,
  });

  useBottomSheetA11y(lightbox, lightboxRef, zoomTriggerRef, () => setLightbox(false));

  // #135 — Le frecce sinistra/destra sfogliano le foto, come ci si aspetta da
  // un visore a schermo intero. Prima si poteva solo con lo swipe o col mouse.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      const n = numeroFoto.current;
      if (n < 2) return;
      if (e.key === 'ArrowLeft') setActiveImg((p) => (p - 1 + n) % n);
      if (e.key === 'ArrowRight') setActiveImg((p) => (p + 1) % n);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  // Quando si chiude il lightbox (dove si naviga con frecce/swipe), riallinea
  // il carosello principale alla foto corrente.
  useEffect(() => {
    if (lightbox) return;
    const el = galleryRef.current;
    if (el) el.scrollTo({ left: activeImg * el.clientWidth, behavior: 'auto' });
  }, [lightbox, activeImg]);

  // Badge "Nuovo" sulla galleria: prodotto creato da meno di NEW_PRODUCT_DAYS.
  const createdAt = (product as { created_at?: string | null } | undefined)?.created_at ?? null;
  useEffect(() => {
    if (!createdAt) return;
    const age = (Date.now() - new Date(createdAt).getTime()) / 86400000;
    setIsNew(age < NEW_PRODUCT_DAYS);
  }, [createdAt]);

  useEffect(() => {
    const rileggi = () => setRigheDelCarrello(getCart());
    rileggi();
    window.addEventListener('cart:updated', rileggi);
    window.addEventListener('storage', rileggi);
    return () => {
      window.removeEventListener('cart:updated', rileggi);
      window.removeEventListener('storage', rileggi);
    };
  }, []);

  // R01-009 — Le altre righe del carrello hanno il prezzo del giorno in cui sono entrate; la cassa lo
  // rilegge dal prodotto, con la promo di oggi (lib/ordini/valida-carrello.ts). Qui si fa lo stesso,
  // come la pagina del carrello: una lettura sola, rifatta solo quando cambiano i prodotti delle altre
  // righe. Finché non torna, o se cade, vale il prezzo salvato: cassa e rotta dei contanti restano il presidio.
  const idAltreRighe = Array.from(new Set(righeDelCarrello.map((c) => c.id).filter((x) => x !== id))).sort().join(',');
  useEffect(() => {
    if (!idAltreRighe) return;
    const ids = idAltreRighe.split(',');
    let vivo = true;
    void (async () => {
      try {
        const [prodotti, sconti] = await Promise.all([
          supabase.from('products').select('id, price').in('id', ids),
          fetchActiveDiscounts(supabase, ids),
        ]);
        if (!vivo || prodotti.error || sconti.scontiNonLetti) return;
        const oggi: Record<string, number> = {};
        for (const p of (prodotti.data ?? []) as Array<{ id: string; price: number | string | null }>) {
          const pieno = Number(p.price ?? NaN);
          if (Number.isFinite(pieno)) oggi[p.id] = discountedUnitCents(pieno, sconti.get(p.id) ?? 0);
        }
        setCentsDiOggi(oggi);
      } catch {
        // Lettura caduta: resta il prezzo salvato nel carrello.
      }
    })();
    return () => { vivo = false; };
  }, [idAltreRighe]);

  // L'elenco delle recensioni parte quando la sezione si avvicina allo schermo.
  useEffect(() => {
    if (recensioniInVista) return;
    // La sezione non e' ancora in pagina (scheletro, errore, prodotto assente):
    // si aspetta, e l'effetto ripassa quando il nodo arriva.
    if (!nodoRecensioni) return;
    // Browser senza il sensore: si chiede subito, com'era prima. Meglio pesante
    // che muto.
    if (typeof IntersectionObserver === 'undefined') {
      setRecensioniInVista(true);
      return;
    }
    const osservatore = new IntersectionObserver(
      (voci) => { if (voci.some((v) => v.isIntersecting)) setRecensioniInVista(true); },
      // 600px di anticipo: i commenti si scaricano mentre la persona sta ancora
      // scorrendo, cosi' quando arriva li trova gia' li'.
      { rootMargin: '600px 0px' },
    );
    osservatore.observe(nodoRecensioni);
    return () => osservatore.disconnect();
  }, [nodoRecensioni, recensioniInVista]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-pulse">
          <div className="bg-cream-200 h-96 rounded-xl" />
          <div className="space-y-3">
            <div className="h-6 bg-cream-200 rounded w-3/4" />
            <div className="h-4 bg-cream-100 rounded w-1/2" />
            <div className="h-10 bg-cream-200 rounded w-1/3" />
            <div className="h-24 bg-cream-100 rounded" />
            <div className="h-12 bg-cream-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  // Errore di rete/DB: messaggio onesto + "Riprova" (prima cadeva nel generico "Prodotto non trovato").
  if (isError) {
    return (
      <div className="container mx-auto p-8 max-w-md text-center mt-8">
        <ErrorState
          title="Impossibile caricare il prodotto"
          description="C'è stato un problema di caricamento. Controlla la connessione e riprova."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // Prodotto realmente assente: blocco coerente col design (come "Prodotto non disponibile").
  if (!product) {
    return (
      <div className="container mx-auto p-8 max-w-md text-center mt-8 bg-white rounded-2xl border">
        <Package size={48} strokeWidth={1.5} className="mx-auto text-ink-300 mb-3" aria-hidden />
        <h1 className="text-xl font-bold text-ink-900 mb-2">Prodotto non disponibile</h1>
        {/* 5/11/2026 — Un prodotto segnato «esaurito» dal negozio non si legge più per chi compra,
            e cadeva qui: «non esiste o è stato rimosso» era falso per il pane finito per oggi. */}
        <p className="text-sm text-ink-600 mb-5">
          Questo prodotto ora non è in vendita: può essere finito per oggi, oppure il negozio l&apos;ha tolto.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button href="/stores">Vedi i negozi</Button>
          <Button href="/search" variant="secondary">Cerca qualcosa di simile</Button>
        </div>
      </div>
    );
  }

  // Negozio sospeso o non approvato → prodotto non acquistabile. Il negozio arriva
  // dalla vista pubblica dei negozi (R3): regge anche quando `profiles` e' chiusa.
  if (!negozioDellaSchedaOperativo(product)) {
    return (
      <div className="container mx-auto p-8 max-w-md text-center mt-8 bg-white rounded-2xl border">
        <Ban size={48} strokeWidth={1.5} className="mx-auto text-ink-300 mb-3" aria-hidden />
        <h1 className="text-xl font-bold text-ink-900 mb-2">Prodotto non disponibile</h1>
        <p className="text-sm text-ink-600 mb-5">
          Questo prodotto non è al momento acquistabile perché il negozio non è operativo.
        </p>
        <Button href="/">← Torna al marketplace</Button>
      </div>
    );
  }

  const images: string[] = Array.isArray(product.images) && product.images.length > 0
    ? (product.images as string[])
    : [FOTO_MANCANTE];
  numeroFoto.current = images.length;

  // Media, numero e istogramma nascono dal RIEPILOGO: e' l'insieme completo, e
  // resta giusto anche quando l'elenco dei commenti non e' ancora arrivato.
  const totaleRecensioni = riepilogoRecensioni.length;
  const avgRating = totaleRecensioni
    ? riepilogoRecensioni.reduce((s: number, r) => s + Number(r.rating), 0) / totaleRecensioni
    : 0;

  // Recensioni filtrate ("Con foto") + ordinate (recenti / voto alto / voto basso),
  // tutto client-side sull'elenco già caricato: nessuna query né dato aggiuntivo.
  const conFoto = (r: { photo_urls: string[] | null }) =>
    Array.isArray(r.photo_urls) && r.photo_urls.some(fotoDiCasa);
  const photoReviewCount = riepilogoRecensioni.filter(conFoto).length;
  const visibleReviews = (reviewsOnlyPhoto
    ? reviews.filter(conFoto)
    : [...reviews]
  ).sort((a, b) => {
    if (reviewSort === 'top') return Number(b.rating) - Number(a.rating);
    if (reviewSort === 'low') return Number(a.rating) - Number(b.rating);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const prezzoPieno = Number(product.price);
  // Il prezzo che si paga: con la promo attiva, scontato come in cassa (al centesimo).
  const price = scontoPromo > 0 ? discountedUnitCents(prezzoPieno, scontoPromo) / 100 : prezzoPieno;
  // Prezzo pieno barrato + unità + condizione (campi di primo livello).
  const compareAt = (product as { compare_at_price?: number | string | null }).compare_at_price;
  const compareAtNum = compareAt != null ? Number(compareAt) : null;
  // R18-006 — Con la promozione attiva il prezzo di listino non si mostra: ci sarebbero due prezzi barrati
  // e un «Risparmi» calcolato sul pieno (come fa già la scheda delle griglie).
  // R10-004 (onda 2) — Barrato e bollino con la regola unica della scheda delle griglie
  // (`scontoMostrato`): un listino appena sopra il prezzo (100,002 contro 100) non barra «100,00 €»
  // accanto a «100,00 €» e non scrive «-0%»; una promo che al centesimo non cambia il prezzo non
  // barra il pieno.
  const sconto = scontoMostrato({ prezzo: prezzoPieno, scontoPercento: scontoPromo, prezzoDiListino: compareAtNum });
  const compareValid = sconto.origine === 'listino' && compareAtNum != null;
  const comparePct = sconto.percento;
  const unitRaw = (product as { unit?: string | null }).unit ?? null;
  const unitSuffix = unitRaw && unitRaw !== 'pezzo' ? (UNIT_SUFFIX[unitRaw as ProductUnit] ?? '') : '';
  // R08-005 — Per gli alimenti, accanto al prezzo il prezzo al chilo o al litro (Codice del Consumo),
  // calcolato dalla quantita' netta dichiarata. Senza quantita' leggibile non si scrive niente.
  const attributiProdotto = (product.attributes ?? {}) as Record<string, unknown>;
  const eAlimento = product.categories?.slug === 'alimentari'
    || 'allergeni' in attributiProdotto || 'ingredienti' in attributiProdotto;
  const conditionRaw = (product as { condition?: string | null }).condition ?? null;
  const conditionLabel = conditionRaw ? (CONDITION_LABELS[conditionRaw as ProductCondition] ?? conditionRaw) : null;
  // Varianti: i selettori derivano dalle varianti; la disponibilità mostrata è
  // quella della variante selezionata (o del prodotto se non ci sono varianti).
  const hasVariants = Boolean((product as { has_variants?: boolean }).has_variants) || variants.length > 0;
  // R08-011 — Dove sta la scelta (tutta fatta, combinazione che non c'è, da fare) lo dice una funzione
  // pura, provata a parte: tutte le opzioni scelte ma nessuna variante con quella coppia non è «scegli».
  const {
    gruppi: optionGroups,
    variante: selectedVariant,
    combinazioneMancante,
    daScegliere: needsVariantChoice,
  } = statoSceltaVarianti(variants, selectedOptions, hasVariants);
  const COMBINAZIONE_CHE_NON_CE = 'Questa combinazione non c\'è: prova un\'altra opzione.';
  // R18-010 — Se il peso è un asse delle varianti, il prezzo al chilo usa il peso del formato scelto (e nessuna
  // riga finché non se ne sceglie uno), non quello del prodotto base.
  const pesoVariabile = variants.some((v) => typeof v.options?.peso === 'string');
  const pesoPerPrezzoUnitario = pesoVariabile ? selectedVariant?.options?.peso : attributiProdotto.peso;
  const prezzoUnitario = eAlimento ? prezzoPerUnitaDiMisura(price, unitRaw, pesoPerPrezzoUnitario) : null;

  const stock: number | undefined = hasVariants
    ? (selectedVariant ? selectedVariant.stock : undefined)
    : (product.stock ?? undefined);
  const isLowStock = stock !== undefined && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
  /**
   * 22/8/2026 — CON LE VARIANTI TUTTE ESAURITE LA BARRA DICEVA «DISPONIBILE».
   *
   * Finché nessuna variante è scelta, `stock` è `undefined`: non zero, non un
   * numero. I due rami dell'etichetta guardavano solo «è zero?» e «è basso?»,
   * quindi `undefined` cadeva nel ramo buono e usciva «Disponibile · pronto per
   * la consegna» — su un prodotto di cui non c'era più una sola taglia.
   *
   * La persona sceglieva le opzioni una per una e le trovava tutte spente,
   * dopo che le era stato detto che il prodotto c'era.
   */
  const tutteLeVariantiEsaurite =
    hasVariants && variants.length > 0 && variants.every((v) => v.stock === 0);
  const isOutOfStock = stock === 0 || tutteLeVariantiEsaurite;
  // 24/11/2026 — I prodotti di SDG Agenzia sono abbonamenti: niente carrello, si attivano dal preventivo.
  const eAbbonamentoSdg = eDiSdg(product.seller_id);
  const canAdd = !eAbbonamentoSdg && !eUnServizio && !tipoInLettura && !isOutOfStock && !needsVariantChoice && !combinazioneMancante && mayPurchase;

  // 5/11/2026 — La descrizione della foto che il negozio scrive per chi non vede (`alt_text`)
  // non arrivava a nessuno: si toglieva dalla griglia «perché già usata come testo alternativo»,
  // ma la foto usava il nome del prodotto. Adesso la prima foto la usa; senza, resta il nome.
  const altDelNegozio = (product.attributes as Record<string, unknown> | null | undefined)?.alt_text;
  const altPrimaFoto = typeof altDelNegozio === 'string' && altDelNegozio.trim() ? altDelNegozio.trim() : product.name;

  // Marchi di qualità (DOP/DOC/IGP/Bio/Vegano…) derivati da tag + attributi.
  const qualityMarks = deriveQualityMarks(product);

  // Quantità legata allo stock: cap derivato (niente nuovo hook dopo gli early
  // return). `qty` è il valore mostrato/usato, sempre ≤ stock disponibile.
  const maxQty = stock === undefined ? Infinity : Math.max(1, stock);
  const qty = Math.min(quantity, maxQty);

  // R02-006 — «Paghi alla consegna» solo dove la cassa accetta davvero i contanti. Il tetto della legge
  // (lib/ordini/tetto-dei-contanti.ts, non si tocca) vale sul lordo di TUTTO il carrello, merce più
  // consegna, come in cassa e nella rotta dei contanti. Si conta quindi il carrello che la cassa
  // troverà: le righe che ci sono già più questo prodotto, al prezzo che si paga (promo compresa) e
  // nella quantità scelta; la consegna con la regola della cassa (vociDellaConsegna: un euro per ogni
  // negozio in più e per ogni negozio sotto i 10 €) e con la veloce, che costa un euro in più e in
  // cassa si può ancora scegliere. Si promette solo quello che vale qualunque consegna si scelga.
  // Due conti, uno per strada: «Compra ora» porta la riga di questo prodotto alla quantità scelta,
  // «Aggiungi» (anche dalla barra in fondo) la somma a quella che c'è.
  const stessaRiga = (c: CartItem) => c.id === product.id && (c.variantId ?? null) === (selectedVariant?.id ?? null);
  const negozioQui = product.seller_id ?? product.id;
  const lordoDelCarrelloCents = (righe: CartItem[], pezziQui: number) => {
    const perNegozio = new Map<string, number>([[negozioQui, Math.round(price * 100) * pezziQui]]);
    for (const c of righe) {
      const negozio = c.sellerId ?? `senza-negozio:${c.id}`;
      // R01-009 — Al prezzo di oggi, come la cassa: questo prodotto (un'altra variante) a quello della
      // scheda, le altre righe a quello riletto; finché manca, a quello salvato nel carrello.
      const unitaCents = c.id === product.id ? Math.round(price * 100) : (centsDiOggi[c.id] ?? Math.round(Number(c.price) * 100));
      const riga = unitaCents * Math.max(0, Number(c.quantity) || 0);
      perNegozio.set(negozio, (perNegozio.get(negozio) ?? 0) + (Number.isFinite(riga) ? riga : 0));
    }
    const negozi = [...perNegozio.values()].map((m) => ({ spesaCents: m, merceCents: m }));
    const merce = negozi.reduce((t, g) => t + g.merceCents, 0);
    return merce + vociDellaConsegna({ pickupInStore: false, negozi, consegnaVeloce: true }).totaleCents;
  };
  const altreRighe = righeDelCarrello.filter((c) => !stessaRiga(c));
  const pezziGiaQui = righeDelCarrello.filter(stessaRiga).reduce((t, c) => t + (Number(c.quantity) || 0), 0);
  const lordoContantiCents = lordoDelCarrelloCents(altreRighe, qty);
  const contantiQui = !sopraIlTettoDeiContanti(lordoContantiCents);
  const lordoAggiungendoCents = lordoDelCarrelloCents(altreRighe, pezziGiaQui + qty);
  const contantiAggiungendo = !sopraIlTettoDeiContanti(lordoAggiungendoCents);
  // R01-009 — Il riquadro verde e «Compri sicuro» non appartengono a un pulsante: stanno accanto ad
  // «Aggiungi al carrello» (che somma) e a «Compra ora» (che porta la riga alla quantità scelta).
  // Promettono i contanti solo se reggono su tutte e due le strade; il testo di «Compra ora» e il
  // ricordo di 'cod' restano legati a `contantiQui`, perché lì la strada è una sola.
  const contantiSuTutteEDue = contantiQui && contantiAggiungendo;
  const lordoPiuAltoCents = Math.max(lordoContantiCents, lordoAggiungendoCents);
  // Quando le due strade divergono il riquadro non dice niente sul pagamento: «Sopra il tetto non si
  // può pagare in contanti» accanto a «Compra ora · paghi alla consegna» si legge «non puoi comprare».
  // Ne parla il pulsante, che sa la sua strada; il resto del riquadro (consegna, reso) resta.
  const stradeDivergono = contantiQui !== contantiAggiungendo;

  // Le parole sulla spedizione non si scrivono qui: le decide `promessaSpedizione()`, che le fa
  // nascere dalla cifra che la cassa addebita davvero. Scritte a mano, questa scheda prometteva
  // «Spedizione gratuita» e non nominava da nessuna parte i 3 € di consegna che partono comunque:
  // il cliente li vedeva per la prima volta nel carrello, cioe' dopo aver scelto.
  //
  // 16/11/2026 (R29-005) — Senza il valore del carrello: dalla fine della soglia non cambiava la
  // risposta. La pastiglia «gratis» si accende solo se la consegna davvero non si paga.
  const spedizione = promessaSpedizione();
  const consegnaSenzaCosto = spedizione.dettaglioConsegna === null;
  // R08-002 — Nel riquadro verde la consegna è una riga corta + il rimando alla tariffa intera. La riga
  // è la frase principale delle promesse (`titolo`, «Consegna MyCity da 3,00 € per tutto il carrello»):
  // niente frase nuova, gli importi vengono dalle costanti. La tariffa intera, `dettaglioConsegna`,
  // la legge la cassa e la dice la pagina Spedizioni.
  const rigaConsegna = spedizione.titolo;

  const sellerProfile = Array.isArray(product.profiles) ? product.profiles[0] : product.profiles;
  // 29/10/2026 — Qui c'era `expressEligible` (interruttore Express del prodotto e del negozio): decideva
  // fra «arriva oggi» e «Consegna in 2-3 giorni», ma la cassa non lo guarda e non ha una consegna a
  // 2-3 giorni. La riga della consegna segue la cassa: `rigaConsegnaDellaScheda` in DeliveryCutoff.

  const purchaseBlockedMessage = isAdmin
    ? 'Gli account assistenza non possono acquistare sul marketplace.'
    : 'Apri il marketplace dal pulsante «Vai al marketplace» nella dashboard negozio.';

  const handleAdd = () => {
    // 27/11/2026 — Un abbonamento o un servizio non entrano nel carrello, qualunque pulsante li chiami.
    if (eAbbonamentoSdg || eUnServizio || tipoInLettura) return;
    if (!mayPurchase) {
      toast.error(purchaseBlockedMessage);
      return;
    }
    if (needsVariantChoice) {
      toast.error(`Scegli ${optionGroups.map((g) => g.name.toLowerCase()).join(' e ')} prima di aggiungere`);
      return;
    }
    if (combinazioneMancante) {
      toast.error(COMBINAZIONE_CHE_NON_CE);
      return;
    }
    // R02-008 — Il pulsante resta raggiungibile da tastiera anche quando non si può comprare
    // (aria-disabled): premuto, dice perché invece di aggiungere.
    if (isOutOfStock) {
      toast.error(selectedVariant ? 'Questa combinazione è esaurita: prova un\'altra opzione.' : 'Prodotto esaurito.');
      return;
    }
    // R02-016 — Il secondo tocco dello stesso gesto (scheda o barra in fondo) non aggiunge un altro
    // pezzo: addToCart somma alla riga che c'è. Il tocco frenato non sparisce in silenzio: lo dice.
    // Il freno scarta solo il tocco ripetuto sulla stessa scelta: un'altra variante o un'altra
    // quantità entro il secondo è un'aggiunta nuova, non un doppio tocco.
    const scelta = `${selectedVariant?.id ?? ''}|${qty}`;
    if (sceltaFrenata.current !== scelta) {
      sceltaFrenata.current = scelta;
      frenoAggiunta.current = creaFrenoDoppioTocco();
    }
    if (!frenoAggiunta.current()) {
      // Un id fisso: più tocchi frenati aggiornano lo stesso avviso invece di impilarne di uguali.
      toast.info('Già aggiunto: controlla il carrello', { id: 'gia-aggiunto', duration: 2000 });
      return;
    }
    addToCart({
      id: product.id,
      name: product.name,
      // R02-020 / R02-021 — Al carrello il prezzo che la scheda e la barra in fondo mostrano: con la
      // promo attiva quello scontato, al centesimo come la cassa (`discountedUnitCents`). Carrello e
      // cassa non lo scontano di nuovo: rileggono il prezzo pieno e la promo dal database e lo
      // sostituiscono. Col pieno qui, il carrello scriveva «il prezzo è sceso» a ogni promo.
      price,
      image: images[0],
      quantity: qty,
      sellerId: product.seller_id ?? sellerProfile?.id ?? undefined,
      storeName: sellerProfile?.store_name ?? undefined,
      variantId: selectedVariant?.id,
      variantLabel: selectedVariant?.label,
    });
    toast.success(
      `${product.name}${selectedVariant ? ` (${selectedVariant.label})` : ''} aggiunto al carrello`,
      { duration: 2000 },
    );
  };

  const handleBuyNow = () => {
    if (inPartenza) return;
    if (eAbbonamentoSdg || eUnServizio || tipoInLettura) return;
    if (!mayPurchase) {
      toast.error(purchaseBlockedMessage);
      return;
    }
    if (needsVariantChoice) {
      toast.error(`Scegli ${optionGroups.map((g) => g.name.toLowerCase()).join(' e ')} prima di continuare`);
      return;
    }
    if (combinazioneMancante) {
      toast.error(COMBINAZIONE_CHE_NON_CE);
      return;
    }
    // R02-008 (dopo il collaudo) — Anche «Compra ora» resta nel giro del Tab quando non si può
    // comprare: premuto su un esaurito, lo dice invece di aprire la cassa.
    if (isOutOfStock) {
      toast.error(selectedVariant ? 'Questa combinazione è esaurita: prova un\'altra opzione.' : 'Prodotto esaurito.');
      return;
    }
    setInPartenza(true);
    // 5/11/2026 — «Compra ora» compra QUESTA quantità: se la riga c'è già si porta alla
    // quantità scelta invece di sommarla (prima chi aveva già un filone ne trovava due).
    const giaNelCarrello = getCart().some(
      (c) => c.id === product.id && (c.variantId ?? null) === (selectedVariant?.id ?? null),
    );
    if (giaNelCarrello) {
      updateQuantity(product.id, qty, selectedVariant?.id);
    } else {
      addToCart({
        id: product.id,
        name: product.name,
        price,
        image: images[0],
        quantity: qty,
        sellerId: product.seller_id ?? sellerProfile?.id ?? undefined,
        storeName: sellerProfile?.store_name ?? undefined,
        variantId: selectedVariant?.id,
        variantLabel: selectedVariant?.label,
      });
    }
    // Il pulsante promette «paghi alla consegna»: la promessa viaggia fino alla
    // cassa, che senza questa riga si apriva sempre con la carta selezionata.
    // R02-007 — Sopra il tetto dei contanti il pulsante non lo promette, e la cassa non riparte da lì.
    if (contantiQui) ricordaMetodoScelto('cod');
    router.push('/checkout');
  };

  // #83 — I dati strutturati del prodotto sono passati nel guscio
  // (app/product/[id]/layout.tsx), che è un componente server: finiscono
  // nell'HTML subito, invece di comparire solo dopo che il JavaScript è stato
  // scaricato e avviato. Un prezzo che compare al secondo giro del crawler è
  // un prezzo che nei risultati può mancare.

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
      <Breadcrumb className="mb-4" items={[
        { label: 'Home', href: '/' },
        ...(product.categories?.name && product.categories?.slug
          ? [{ label: product.categories.name, href: `/category/${product.categories.slug}` }]
          : []),
        { label: product.name },
      ]} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1fr_320px] gap-6">
        {/* GALLERIA — carosello scorrevole (swipe/scroll orizzontale) */}
        <div className="space-y-3">
          <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-surface-200">
            <div
              ref={galleryRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (!el.clientWidth) return;
                const idx = Math.round(el.scrollLeft / el.clientWidth);
                if (idx !== activeImg && idx >= 0 && idx < images.length) setActiveImg(idx);
              }}
              className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scrollbar-hide bg-surface-0"
            >
              {/* `object-cover` era ricopiato dalle schede in griglia, dove riempire il
                  quadrato e' giusto. Sul dettaglio la regola e' opposta, e lo dice gia'
                  lib/image-url.ts: per `detail` l'altezza NON viene imposta «per mostrare
                  l'intero prodotto». Il server mandava la foto intera e il foglio di stile
                  ne buttava via i bordi: di una bottiglia sparivano il collo o l'etichetta.
                  Con `object-contain` si vede tutta; lo sfondo del riquadro e' quello della
                  pagina, quindi le bande non si notano — ed e' la stessa scelta che fa gia'
                  l'ingrandimento. */}
              {images.map((img, i) => (
                <div key={i} className="relative h-full w-full shrink-0 snap-center">
                  <FotoConRipiego
                    src={sizedImage(img, 'detail')}
                    alt={i === 0 ? altPrimaFoto : `${product.name} — foto ${i + 1}`}
                    fill
                    priority={i === 0}
                    sizes={SIZES_FOTO_PRODOTTO}
                    loader={caricatoreFotoRemote}
                    className="object-contain"
                  />
                  <button
                    type="button"
                    ref={i === activeImg ? zoomTriggerRef : undefined}
                    onClick={() => setLightbox(true)}
                    aria-label="Ingrandisci foto"
                    // #135 — Da tastiera si raggiunge solo la foto in vista: le
                    // altre sono nel carosello ma non sono ancora «qui», e
                    // otto tabulazioni sulla stessa immagine non aiutano nessuno.
                    tabIndex={i === activeImg ? 0 : -1}
                    className="absolute inset-0 z-[1] cursor-zoom-in"
                  />
                </div>
              ))}
            </div>
            {/* Overlay badge in alto a sinistra: sconto (−N%) + "Nuovo" (parità con le
                card), poi gli stati di stock. Impilati in colonna come nel mockup. */}
            <div className="absolute top-4 left-4 z-[2] flex flex-col gap-1.5">
              {compareValid && comparePct !== null && <Badge variant="discount" size="md">-{comparePct}%</Badge>}
              {isNew && !isOutOfStock && <Badge variant="new" size="md">Nuovo</Badge>}
              {isOutOfStock && <Badge variant="soldout" size="md">ESAURITO</Badge>}
              {isLowStock && !isOutOfStock && (
                <Badge variant="lowstock" size="md">
                  {stock === 1 ? 'Ultimo pezzo' : `Solo ${stock} rimasti`}
                </Badge>
              )}
            </div>
            {/* Pallini indicatore (mobile) */}
            {images.length > 1 && (
              <div className="absolute bottom-3 left-1/2 z-[2] flex -translate-x-1/2 gap-1.5 sm:hidden">
                {images.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${activeImg === i ? 'w-4 bg-primary-600' : 'w-1.5 bg-white/70 ring-1 ring-surface-300'}`}
                  />
                ))}
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-2">
              {images.slice(0, 5).map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setActiveImg(i);
                    const el = galleryRef.current;
                    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
                  }}
                  aria-label={`Mostra foto ${i + 1}`}
                  aria-pressed={activeImg === i}
                  className={`relative aspect-square bg-surface-50 rounded-lg overflow-hidden border-2 transition ${
                    activeImg === i ? 'border-primary-600' : 'border-transparent hover:border-surface-300'
                  }`}
                >
                  <FotoConRipiego src={sizedImage(img, 'thumb')} alt="" fill sizes="80px" loading="lazy" loader={caricatoreFotoRemote} className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* LIGHTBOX a schermo intero — vede la foto intera, con navigazione */}
        {lightbox && (
          <div
            ref={lightboxRef}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setLightbox(false)}
            onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
            onTouchEnd={(e) => {
              const start = touchStartX.current;
              touchStartX.current = null;
              if (start == null || images.length < 2) return;
              const dx = (e.changedTouches[0]?.clientX ?? start) - start;
              if (Math.abs(dx) < 40) return;
              setActiveImg((prev) =>
                dx < 0 ? (prev + 1) % images.length : (prev - 1 + images.length) % images.length,
              );
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Foto di ${product.name}`}
          >
            <button
              type="button"
              onClick={() => setLightbox(false)}
              aria-label="Chiudi"
              className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white hover:bg-white/25"
            >
              ×
            </button>
            {/* «Ingrandisci» chiedeva la stessa misura di prima (1200px) dentro un riquadro
                largo il 95% dello schermo: su un portatile fine si vedeva la foto di prima,
                solo piu' grande e piu' morbida. Qui si chiede la larghezza massima che il
                sito considera sensata. */}
            <img
              src={zoomFallito === sizedImage(images[activeImg], LARGHEZZA_MASSIMA) ? FOTO_MANCANTE : sizedImage(images[activeImg], LARGHEZZA_MASSIMA)}
              alt={activeImg === 0 ? altPrimaFoto : `${product.name} — foto ${activeImg + 1}`}
              className="max-h-[90vh] max-w-[95vw] object-contain"
              onClick={(e) => e.stopPropagation()}
              onError={() => {
                const indirizzo = sizedImage(images[activeImg], LARGHEZZA_MASSIMA);
                if (indirizzo !== FOTO_MANCANTE) setZoomFallito(indirizzo);
              }}
            />
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActiveImg((activeImg - 1 + images.length) % images.length); }}
                  aria-label="Foto precedente"
                  className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl leading-none text-white hover:bg-white/25"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActiveImg((activeImg + 1) % images.length); }}
                  aria-label="Foto successiva"
                  className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl leading-none text-white hover:bg-white/25"
                >
                  ›
                </button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">
                  {activeImg + 1} / {images.length}
                </div>
              </>
            )}
          </div>
        )}

        {/* INFO
            3/9/2026 — L'ORDINE DEI BLOCCHI ERA ROVESCIATO, e su telefono la colonna è una sola.
            Prima si leggeva: negozio, «Segnala questo contenuto», ragione sociale e partita IVA —
            e solo dopo COSA si sta guardando e QUANTO costa. Chi apre un prodotto dal telefono
            aveva l'invito a segnalare un abuso prima del nome. Anche i titoli erano invertiti:
            «Venduto da» apre con un <h2>, e stava sopra l'<h1> della pagina.
            Adesso: nome, prezzo e riquadro rassicurazione in cima; il negozio subito sotto; chi
            vende davvero e il canale per le segnalazioni in fondo, dove si cercano. */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h1 className="flex-1 font-serif text-3xl font-bold leading-tight text-ink-900 md:text-4xl">{product.name}</h1>
            <button
              type="button"
              onClick={() => {
                toggleFav.mutate(id, {
                  onError: (err: unknown) => {
                    if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
                      toast.error('Accedi per salvare nei preferiti');
                    } else {
                      // Senza questo ramo un salvataggio fallito era muto: il cuore tornava com'era
                      // e nessuno diceva perche'. Adesso la scrittura fallisce davvero, quindi il
                      // messaggio deve esserci.
                      toast.error('Non sono riuscito a salvare il preferito. Riprova fra un momento.');
                    }
                  },
                });
              }}
              disabled={!cuorePremibile}
              aria-label={!cuorePremibile ? 'Non sono riuscito a leggere i tuoi preferiti' : isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
              aria-pressed={cuorePremibile ? isFav : undefined}
              title={!cuorePremibile ? 'Non sono riuscito a leggere i tuoi preferiti: riprova fra un momento' : undefined}
              className={`shrink-0 w-11 h-11 rounded-full border-2 flex items-center justify-center transition-transform focus-visible:ring-2 ${ANELLO} focus-visible:ring-offset-2 ${
                !cuorePremibile
                  ? 'bg-white border-cream-200 text-ink-200 cursor-not-allowed'
                  : classiBottoneCuore(isFav)
              }`}
            >
              <Heart size={20} strokeWidth={2.4} fill={isFav ? 'currentColor' : 'none'} aria-hidden />
            </button>
          </div>

          {/* Aggiungi a lista */}
          <div className="flex">
            <AddToListButton productId={id} />
          </div>

          {/* Marchi di qualità: DOP/DOC/IGP/Bio/Vegano… (derivati da tag + attributi) */}
          <QualityMarks marks={qualityMarks} />

          {/* Rating */}
          <div className="flex items-center gap-3 flex-wrap">
            {totaleRecensioni > 0 ? (
              <>
                <RatingStars rating={avgRating} size={18} />
                <a href="#recensioni" className="text-sm text-ink-600 underline hover:text-primary-700">
                  {totaleRecensioni} recensioni
                </a>
              </>
            ) : (
              <span className="text-sm text-ink-400">Sii il primo a recensire questo prodotto</span>
            )}
            <SocialProof productId={id} />
          </div>

          <div className="border-y border-surface-200 py-4 space-y-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-4xl font-extrabold font-serif text-ink-900">
                {formatPrice(price)}
                {unitSuffix && <span className="text-base font-semibold text-ink-400">{unitSuffix}</span>}
              </span>
              {prezzoUnitario && (
                <span className="text-sm text-ink-600" data-testid="prezzo-unitario">
                  ({formatPrice(prezzoUnitario.valore)}/{prezzoUnitario.unita === 'kg' ? 'kg' : 'L'})
                </span>
              )}
              {sconto.origine === 'promo' && (
                <span className="text-lg text-ink-400 line-through">
                  <span className="sr-only">Prezzo pieno </span>{formatPrice(prezzoPieno)}
                </span>
              )}
              {compareValid && (
                <>
                  <span className="text-lg text-ink-400 line-through">{formatPrice(compareAtNum)}</span>
                  <span className="text-sm font-bold text-secondary-600">Risparmi {formatPrice(compareAtNum - prezzoPieno)}</span>
                </>
              )}
              <span className="text-sm text-ink-400">IVA inclusa</span>
            </div>
            {eUnServizio && (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-semibold text-primary-700">
                Servizio{dettagliServizio ? ` · ${dettagliServizio}` : ''}
              </span>
            )}
            {conditionLabel && !eUnServizio && (
              <span className="inline-flex w-fit items-center rounded-full bg-cream-100 px-2.5 py-0.5 text-xs font-semibold text-ink-700">
                Condizione: {conditionLabel}
              </span>
            )}
            {/* Promo attiva del negozio (prezzo barrato + nuovo prezzo) */}
            <ActivePromoBadge productId={id} basePrice={prezzoPieno} />
            {scontoNonVerificato && (
              <p role="status" className="text-xs text-ink-600">
                Non riusciamo a verificare le promozioni del negozio: il prezzo finale, con gli eventuali
                sconti, lo vedi nel carrello.
              </p>
            )}

            {/* Card rassicurazione consolidata (mockup 50-product): ETA consegna +
                pagamento alla consegna + reso, in un unico riquadro olive. Le righe
                dinamiche restano tali (DeliveryCutoff conserva la sua logica). */}
            {/* 27/11/2026 — Per un servizio consegna, pagamento alla consegna e reso non valgono: si
                prenota scrivendo al negozio, e il resto si concorda con lui. */}
            {eUnServizio ? (
            <div className="flex flex-col gap-2 rounded-lg bg-olive-50 border border-olive-200 px-3.5 py-3">
              <span className="inline-flex items-center gap-2 text-sm text-olive-800">
                <MessageCircle size={16} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
                <span>Si prenota scrivendo al negozio: giorno, ora e pagamento li concordi con lui.</span>
              </span>
            </div>
            ) : (
            <div className="flex flex-col gap-2 rounded-lg bg-olive-50 border border-olive-200 px-3.5 py-3">
              {/* Consegna: marketplace esterno se importato, altrimenti la regola della cassa */}
              <DeliveryCutoff
                variant="inline"
                esaurito={isOutOfStock}
                storeHours={(sellerProfile as { store_hours?: unknown } | null)?.store_hours}
                negozioId={(sellerProfile?.id ?? product.seller_id) || undefined}
                externalDeliveryLabel={external?.delivery_label}
              />
              {!stradeDivergono && (
                <span className="inline-flex items-center gap-2 text-sm text-olive-800">
                  <Banknote size={16} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
                  {/* La frase nasce dall'elenco dei metodi del checkout: la carta alla consegna
                      non esiste, e chi si fidava proprio per non anticipare i soldi lo scopriva alla
                      cassa, dopo l'indirizzo — dove abbandonare costa di piu'. */}
                  <span>{frasePagamento(undefined, lordoPiuAltoCents)}</span>
                </span>
              )}
              {/* Il costo di consegna: fin qui non compariva da nessuna parte, e il primo posto
                  dove si vedeva era il carrello. Chi legge la promessa qui sopra deve leggere
                  anche questo, sullo stesso schermo e prima di scegliere. */}
              {spedizione.dettaglioConsegna && (
                <span className="inline-flex items-center gap-2 text-sm text-olive-800">
                  <Bike size={16} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
                  <span>
                    {rigaConsegna}
                    {' · '}
                    <Link href="/shipping" className="underline underline-offset-2 hover:text-olive-950">come si calcola</Link>
                  </span>
                </span>
              )}
              <span className="inline-flex items-center gap-2 text-sm text-olive-800">
                <RotateCcw size={16} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
                {/* «gratuito» valeva solo per il difetto, non per il ripensamento: la pagina
                    resi dice che il cambio idea lo paga il cliente, e i freschi sono esclusi. */}
                {fraseReso}
              </span>
            </div>
            )}

            {/* 27/10/2026 (terzo giro) — Qui c'era la riga di `FreeShippingProgress`: «Consegna a casa 3,00 €
                per negozio», subito sotto «Consegna MyCity 3,00 € per negozio» del riquadro qui sopra.
                Due nomi per la stessa cifra si leggono come due costi da sommare: la consegna si dice
                una volta sola, nel riquadro, col nome di carrello, cassa e ordine (`VOCE_CONSEGNA`). */}
          </div>

          {/* Scheda venditore: avatar, valutazione (reale, da store_reviews),
              "dal AAAA" (created_at), link al negozio. Sta sotto il titolo e il prezzo:
              di chi ti fidi si decide dopo aver visto cosa costa. */}
          {(sellerProfile?.id ?? product.seller_id) && (
            <SellerCard
              sellerId={(sellerProfile?.id ?? product.seller_id) as string}
              storeName={product.profiles?.store_name ?? 'Negozio'}
            />
          )}

          {/* 5/11/2026 — Se le varianti non si leggono il selettore non si disegna e il prodotto
              diventava impossibile da comprare senza un perché: lo si dice, con «Riprova». */}
          {hasVariants && variantiInErrore && optionGroups.length === 0 && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-sm text-secondary-800">
              <span>Non riusciamo a caricare le opzioni di questo prodotto.</span>
              <button
                type="button"
                onClick={() => { void rileggiVarianti(); }}
                className="font-semibold underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 rounded"
              >
                Riprova
              </button>
            </div>
          )}

          {/* SELETTORE VARIANTI (taglie/colori) */}
          {hasVariants && optionGroups.length > 0 && (
            <div className="space-y-3">
              {optionGroups.map((g) => (
                <div key={g.name}>
                  {/* #142 — Il titolo del gruppo (Taglia, Colore…) non era
                      collegato ai pulsanti sotto: da screen reader si sentiva
                      «M, premuto» senza sapere M di che cosa. */}
                  <p id={`opt-${g.name}`} className="text-sm font-semibold text-ink-700 mb-1.5">
                    {findLabelForKey(g.name)}
                    {selectedOptions[g.name] && (
                      <span className="ml-1.5 font-normal text-ink-500">· {selectedOptions[g.name]}</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`opt-${g.name}`}>
                    {g.values.map((val) => {
                      const active = selectedOptions[g.name] === val;
                      // R02-008 — Un valore che porta solo a combinazioni esaurite lo si dice prima
                      // di sceglierlo, anche a chi usa il lettore di schermo.
                      const conQuestoValore = variants.filter((v) => v.options?.[g.name] === val);
                      const esaurito = conQuestoValore.length > 0 && conQuestoValore.every((v) => v.stock === 0);
                      // R24-018 — Con le altre scelte già fatte, questo valore ha una variante? Se no
                      // si spegne (barrato, e lo sente anche il lettore di schermo) prima di sceglierlo.
                      const altreScelte = Object.entries(selectedOptions).filter(([k, s]) => k !== g.name && s);
                      const senzaVariante = valoreSenzaVariante(variants, selectedOptions, g.name, val);
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setSelectedOptions((prev) => ({ ...prev, [g.name]: val }))}
                          aria-pressed={active}
                          // R08-011 — Spento per chi legge con lo schermo: aria-disabled, non `disabled`,
                          // così un tocco non cade nel vuoto ma dice «Questa combinazione non c'è».
                          aria-disabled={senzaVariante && !active ? true : undefined}
                          aria-label={esaurito ? `${val}, esaurito` : undefined}
                          className={`min-w-[2.5rem] rounded-lg border-2 px-3 py-1.5 text-sm font-semibold transition ${
                            active
                              ? 'border-primary-600 bg-primary-50 text-primary-800'
                              : senzaVariante
                                ? 'border-dashed border-surface-300 bg-white text-ink-500 line-through hover:border-primary-300'
                                : 'border-surface-300 bg-white text-ink-700 hover:border-primary-300'
                          }`}
                        >
                          {val}
                          {senzaVariante && (
                            <span className="sr-only">, non disponibile con {altreScelte.map(([, s]) => s).join(' e ')}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {/* 5/11/2026 — Regione sempre montata: il cambio di disponibilità della variante
                  si annuncia a chi usa il lettore di schermo. */}
              <div id="disponibilita-variante">
              <div role="status" aria-live="polite">
              {needsVariantChoice ? (
                <p className="text-xs text-ink-500">
                  Scegli {optionGroups.map((g) => g.name.toLowerCase()).join(' e ')} per vedere la disponibilità.
                </p>
              ) : combinazioneMancante ? (
                <p className="text-xs font-semibold text-secondary-700">{COMBINAZIONE_CHE_NON_CE}</p>
              ) : selectedVariant && selectedVariant.stock === 0 ? (
                <p className="text-xs font-semibold text-secondary-700">Variante esaurita — prova un&apos;altra combinazione.</p>
              ) : selectedVariant && selectedVariant.stock <= LOW_STOCK_THRESHOLD ? (
                <p className="text-xs font-semibold text-secondary-700">
                  {selectedVariant.stock === 1 ? 'Ultimo pezzo' : `Solo ${selectedVariant.stock} rimasti`} per «{selectedVariant.label}».
                </p>
              ) : null}
              </div>
              </div>
            </div>
          )}

          <div>
            {/* h2, come «Recensioni»: erano h3 sotto l'h1 del nome, quindi la scaletta
                saltava un gradino (h1 → h3 → h2). E stavano a 14px grigi mentre il
                paragrafo che intestano e' a 16px piu' scuro: il titolo pesava meno del
                testo. Stessa classe per tutti i titoli di sezione della pagina. */}
            <h2 className="font-serif text-2xl font-bold text-ink-900 mb-2">Descrizione</h2>
            <p className="text-ink-700 leading-relaxed whitespace-pre-line">{product.description}</p>
          </div>

          {/* Caratteristiche — esclude le chiavi food mostrate nell'accordion
              "Ingredienti e allergeni" per evitare duplicazioni. */}
          {product.attributes &&
            typeof product.attributes === 'object' &&
            (() => {
              const entries = Object.entries(product.attributes as Record<string, unknown>).filter(
                ([key]) => !ALLERGEN_ACCORDION_KEYS.includes(key) && !CHIAVI_FUORI_DALLA_GRIGLIA.includes(key),
              );
              if (entries.length === 0) return null;
              return (
                <div>
                  <h2 className="font-serif text-2xl font-bold text-ink-900 mb-2">
                    Caratteristiche
                  </h2>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                    {entries.map(([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between items-baseline gap-3 py-1.5 border-b border-cream-200"
                      >
                        <dt className="text-sm text-ink-500">{findLabelForKey(key)}</dt>
                        <dd className="text-sm text-ink-800 font-medium text-right">
                          {formatAttributeValue(value, key)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })()}

          {/* Ingredienti & allergeni — solo se valorizzati dal venditore (dato reale) */}
          <AllergensAccordion attributes={product.attributes} />

          {/* Provenienza — l'unico segnale non già coperto dalla card rassicurazione
              olive sopra (ETA + COD + reso lì consolidati, per non duplicare). */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <Store size={14} strokeWidth={2} className="text-ink-400 shrink-0" aria-hidden />
              Negozi di Piacenza
            </span>
          </div>

          {/* Chi vende davvero: ragione sociale, sede, partita IVA. Deve esserci — è con
              quest'azienda che si stipula il contratto — ma si cerca dopo aver deciso, non
              prima di sapere cosa si sta guardando. */}
          {(sellerProfile?.id ?? product.seller_id) && (
            <VendutoDa
              sellerId={(sellerProfile?.id ?? product.seller_id) as string}
              storeName={product.profiles?.store_name}
            />
          )}

          {/* Il canale per dirci che qualcosa non va: prima non esisteva da nessuna parte
              sul sito. Sta in fondo, non sopra il nome del prodotto. */}
          <div className="pt-1">
            <Segnala tipo="prodotto" oggettoId={product.id} />
          </div>
        </div>

        {/* CTA STICKY
            3/9/2026 — FRA 768 E 1023 PIXEL QUESTO RIQUADRO FINIVA DA SOLO IN SECONDA RIGA.
            La griglia qui sopra è `md:grid-cols-2` e ha tre figli: galleria, informazioni e questo.
            Alla misura media il terzo andava a capo, sotto tutta la colonna delle informazioni —
            che è altissima — e la cella accanto restava vuota. Su un iPad in verticale e su un
            telefono grande girato non c'era nessun pulsante d'acquisto in vista, perché in quella
            fascia la barra in fondo era già sparita (era `md:hidden`, ora `lg:hidden`).
            `md:col-span-2` gli fa occupare la riga intera invece di una cella spaiata; da `lg`
            torna la colonna sua, appiccicata a destra. */}
        <div className="md:col-span-2 lg:col-span-1 lg:sticky lg:top-[var(--header-height)] h-fit">
          <div className="bg-surface-0 border border-surface-200 rounded-xl p-5 shadow-card space-y-3">
            <div className="text-2xl font-extrabold font-serif text-ink-900">{formatPrice(price)}</div>
            {eAbbonamentoSdg ? (
              <AttivaAbbonamento chiGuardaEUnNegozio={isSeller} giaAbbonato={preventivoDelNegozio ? !!preventivoDelNegozio.attivo : null} />
            ) : eUnServizio ? (
              <>
                {dettagliServizio && <p className="text-xs text-ink-600">Servizio · {dettagliServizio}</p>}
                {(sellerProfile?.id ?? product.seller_id) ? (
                  <ContactSellerButton
                    id="prenota-servizio"
                    sellerId={sellerProfile?.id ?? product.seller_id}
                    className="w-full"
                    label={ETICHETTA_PRENOTA}
                  />
                ) : null}
              </>
            ) : (
            <>
            {consegnaSenzaCosto && (
              <Badge variant="free" icon={Bike}>{spedizione.titolo}</Badge>
            )}
            <p className="text-xs">
              {isOutOfStock ? (
                <span className="text-secondary-700 font-bold">Esaurito</span>
              ) : needsVariantChoice ? (
                // Nessuna variante scelta: la disponibilità non si sa ancora, e
                // dirla sarebbe inventarla.
                <span className="text-ink-600 font-semibold">
                  Scegli le opzioni per vedere la disponibilità
                </span>
              ) : combinazioneMancante ? (
                <span className="text-secondary-700 font-bold">Combinazione non disponibile</span>
              ) : isLowStock ? (
                <span className="text-secondary-700 font-bold inline-flex items-center gap-1"><Flame size={13} strokeWidth={2.4} aria-hidden /> {stock === 1 ? 'Ultimo pezzo' : `Solo ${stock} rimasti`}</span>
              ) : (
                <span className="text-olive-700 font-bold inline-flex items-center gap-1"><Check size={13} strokeWidth={2.6} aria-hidden /> Disponibile · pronto per la consegna</span>
              )}
            </p>

            {/* #142 — L'etichetta «Q.tà» era una label senza niente a cui
                agganciarsi (`for` mancante, e nessun campo: i tre pezzi sono due
                pulsanti e un numero). Per uno screen reader restava una parola
                sospesa, e il numero cambiava in silenzio: si premeva «+» e non
                veniva annunciato niente. Ora e' un gruppo con un nome, e il
                valore si annuncia da solo quando cambia. */}
            <div className="flex items-center gap-3 pt-2 flex-wrap" role="group" aria-label="Quantità">
              <span className="text-sm font-medium" aria-hidden>Q.tà:</span>
              <div className="flex items-center border border-surface-300 rounded-lg">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, qty - 1))}
                  disabled={qty <= 1}
                  aria-label="Diminuisci quantità"
                  className="w-9 h-9 hover:bg-surface-50 rounded-l-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >−</button>
                <output aria-live="polite" aria-atomic="true" className="w-10 text-center font-semibold">{qty}</output>
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(maxQty, qty + 1))}
                  disabled={qty >= maxQty}
                  aria-label="Aumenta quantità"
                  className="w-9 h-9 hover:bg-surface-50 rounded-r-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >+</button>
              </div>
              {Number.isFinite(maxQty) && qty >= maxQty && !isOutOfStock && (
                <span className="text-xs text-ink-500">Massimo disponibile: {maxQty}</span>
              )}
            </div>

            <Button
              id="acquisto-principale"
              variant="accent"
              size="lg"
              fullWidth
              onClick={handleAdd}
              // R02-008 — Con `disabled` il pulsante usciva dal giro del Tab: chi non vede premeva
              // Tab e finiva su «Contatta il venditore» senza sapere perché. Resta raggiungibile,
              // dice di non essere disponibile e punta al messaggio della disponibilità.
              aria-disabled={!canAdd || undefined}
              aria-describedby={hasVariants && optionGroups.length > 0 ? 'disponibilita-variante' : undefined}
              // Lo stesso aspetto «spento» del Button (fondo e testo espliciti, 8,80:1), non
              // l'opacità al 50%, che il Button vieta perché porta il contrasto a 1,62:1.
              className="aria-disabled:bg-cream-200 aria-disabled:text-ink-600 aria-disabled:shadow-none aria-disabled:cursor-not-allowed aria-disabled:hover:bg-cream-200 aria-disabled:hover:shadow-none"
              icon={canAdd ? ShoppingCart : undefined}
            >
              {needsVariantChoice ? 'Scegli le opzioni' : isOutOfStock || combinazioneMancante ? 'Non disponibile' : 'Aggiungi al carrello'}
            </Button>

            <button
              type="button"
              onClick={handleBuyNow}
              // R02-008 (dopo il collaudo) — aria-disabled e non disabled: resta raggiungibile da
              // tastiera e dice di non essere disponibile; handleBuyNow non apre la cassa.
              aria-disabled={!canAdd || inPartenza || undefined}
              aria-describedby={hasVariants && optionGroups.length > 0 ? 'disponibilita-variante' : undefined}
              aria-busy={inPartenza || undefined}
              className={`block w-full text-center py-3 rounded-lg font-bold ${
                !canAdd || inPartenza
                  ? 'bg-cream-200 text-ink-600 cursor-not-allowed'
                  : 'bg-ink-900 hover:bg-ink-800 text-white'
              }`}
            >
              {inPartenza ? 'Apro la cassa…' : contantiQui ? 'Compra ora · paghi alla consegna' : 'Compra ora'}
            </button>
            </>
            )}

            {!eUnServizio && (sellerProfile?.id ?? product.seller_id) && (
              <ContactSellerButton
                sellerId={sellerProfile?.id ?? product.seller_id}
                className="w-full"
                label="Contatta il venditore"
              />
            )}

            <div className="pt-3 border-t border-surface-200 space-y-1.5 text-xs text-ink-500">
              {eAbbonamentoSdg ? (
                <p className="flex items-center gap-1.5"><Package size={13} className="shrink-0" aria-hidden /> Venduto da <strong className="text-ink-700">MyCity</strong> · lo realizza {product.profiles?.store_name}</p>
              ) : eUnServizio ? (
              <p className="flex items-center gap-1.5"><Package size={13} className="shrink-0" aria-hidden /> Servizio di <strong className="text-ink-700">{product.profiles?.store_name}</strong></p>
              ) : (
              <p className="flex items-center gap-1.5"><Package size={13} className="shrink-0" aria-hidden /> Venduto da <strong className="text-ink-700">{product.profiles?.store_name}</strong> · consegna MyCity</p>
              )}
              {contantiSuTutteEDue && !eUnServizio && (
                <p className="flex items-center gap-1.5"><ShieldCheck size={13} className="shrink-0" aria-hidden /> Compri sicuro: paghi solo quando arriva.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SPESSO COMPRATI INSIEME — altri prodotti disponibili dello stesso negozio
          (dato reale: nessun co-acquisto inventato).

          3/9/2026 — Da qui in giu' le sezioni si montano quando ci si arriva. Aprendo la scheda
          partivano dieci interrogazioni tutte insieme, e quattro erano di roba in fondo alla
          pagina: occupavano le connessioni proprio mentre dovevano arrivare il prezzo e la foto
          grande. Regola: sopra la piega si carica subito, sotto la piega quando ci si arriva. */}
      {(sellerProfile?.id ?? product.seller_id) && (
        <QuandoSiVede altezzaMinima={320}>
          <FrequentlyBoughtTogether
            productId={id}
            sellerId={(sellerProfile?.id ?? product.seller_id) as string}
            storeName={product.profiles?.store_name ?? undefined}
          />
        </QuandoSiVede>
      )}

      {/* RECENSIONI */}
      {/* Il margine di scorrimento serve a non finire SOTTO l'intestazione fissa. Ma
          l'intestazione e' `relative md:sticky` (components/Navbar.tsx): sotto md non e'
          fissa, e quei 144px diventavano una fascia di vuoto sopra il titolo per chi
          toccava «N recensioni» dal telefono. Da md in su lo spazio lo dà gia' lo scroll-padding-top
          di html (app/globals.css): un margine in piu' si sommerebbe e fermerebbe l'ancora troppo in basso. */}
      <section
        id="recensioni"
        ref={setNodoRecensioni}
        className="mt-12 space-y-6 scroll-mt-4 md:scroll-mt-0"
      >
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-serif text-2xl font-bold text-ink-900">
            Recensioni
            {totaleRecensioni > 0 && (
              <span className="ml-3 text-base font-normal text-ink-500">
                <span className="text-accent-700">★</span> {avgRating.toFixed(1).replace('.', ',')} ({totaleRecensioni})
              </span>
            )}
          </h2>
        </div>

        {/* Riepilogo voti: media + distribuzione stelle (5★→1★) */}
        {totaleRecensioni > 0 && (
          <div className="bg-white border border-cream-200 rounded-xl p-5 grid gap-5 sm:grid-cols-[200px_1fr]">
            <div className="text-center sm:border-r sm:border-cream-200">
              <div className="text-5xl font-extrabold font-serif text-ink-900">{avgRating.toFixed(1).replace('.', ',')}</div>
              <div className="mt-1 flex justify-center">
                <RatingStars rating={avgRating} size={18} />
              </div>
              <p className="text-sm text-ink-500 mt-1">
                {totaleRecensioni} {totaleRecensioni === 1 ? 'recensione' : 'recensioni'}
              </p>
            </div>
            <div className="space-y-1.5 self-center">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = riepilogoRecensioni.filter((r) => Math.round(Number(r.rating)) === star).length;
                const pct = totaleRecensioni > 0 ? (count / totaleRecensioni) * 100 : 0;
                return (
                  <div key={star} className="flex items-center gap-3">
                    <span className="w-10 shrink-0 text-right text-xs font-semibold text-ink-600">{star}★</span>
                    <div className="flex-1 h-2 bg-cream-200 rounded-full overflow-hidden">
                      <div className="h-full bg-accent-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-8 shrink-0 text-xs text-ink-500">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Form nuova recensione */}
        <div className="bg-white border-2 border-primary-100 rounded-xl p-5">
          {/* h3 senza classe di misura usciva a 20px in Fraunces per la regola di
              globals.css, cioe' piu' grande dei titoli di pari grado. Qui il grado e'
              giusto — sta dentro la sezione «Recensioni» — e la misura e' dichiarata. */}
          <h3 className="font-serif text-lg font-bold text-ink-900 mb-1">Lascia la tua recensione</h3>
          {/* 5/11/2026 — Come verifichiamo le recensioni (art. 22 c.4-bis Codice del Consumo):
              è la regola che il database applica davvero. */}
          <p className="mb-3 text-xs text-ink-500">
            Pubblicano recensioni solo i clienti con un ordine consegnato di questo prodotto.
            {INVITI_E_PUNTI_ACCESI && ' Chi aggiunge una foto riceve 20 punti fedeltà.'}
          </p>
          {!isAuthenticated ? (
            <p className="text-sm text-ink-600">
              <Link href={`/sign-in?returnTo=/product/${id}`} className="text-primary-700 font-semibold hover:underline">
                Accedi
              </Link>{' '}
              per recensire questo prodotto.
            </p>
          ) : haRicevutoIlProdotto === false ? (
            <p className="text-sm text-ink-600">Puoi recensire questo prodotto dopo averlo ricevuto.</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (reviewRating < 1 || invioRecensione.current === 'in_volo') return;
                if (invioRecensione.current === 'fatto') {
                  toast.error(GIA_RECENSITO);
                  return;
                }
                invioRecensione.current = 'in_volo';
                submitReview.mutate(undefined, {
                  onSuccess: () => { invioRecensione.current = 'fatto'; },
                  onError: () => { invioRecensione.current = 'libero'; },
                });
              }}
              className="space-y-3"
            >
              {/* #142 — Le stelle erano cinque pulsanti senza stato: si sentiva
                  «3 stelle, pulsante» sia prima sia dopo averlo premuto, e
                  nessuno diceva che quel voto era quello scelto. */}
              <div className="flex gap-1" role="group" aria-label="Il tuo voto">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setReviewRating(n)}
                    aria-pressed={n <= reviewRating}
                    className="text-3xl hover:scale-110 transition-transform"
                    aria-label={`${n} ${n === 1 ? 'stella' : 'stelle'}`}
                  >
                    {/* Le stelle spente erano `text-ink-300` (#A8A29E): 2,52 a 1 sul bianco,
                        sotto il 3 a 1 che serve a un comando da toccare. Prima del clic sono
                        spente tutte e cinque, quindi l'unico comando della schermata stava
                        nel grigio piu' chiaro della tavolozza. `ink-400` (#78716C) fa 4,80.
                        Stessa cura gia' fatta in app/orders/[id]/review/page.tsx. */}
                    <span className={n <= reviewRating ? 'text-accent-700' : 'text-ink-400'}>★</span>
                  </button>
                ))}
              </div>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                rows={3}
                placeholder="Scrivi un commento (opzionale)…"
                className="w-full border border-cream-300 p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 resize-none"
              />
              {/* Foto recensione (i +20 punti valgono solo con i punti accesi). */}
              {profile?.id && (
                <PhotoReviewUpload
                  userId={profile.id}
                  productId={id}
                  onUploaded={setReviewPhotos}
                />
              )}
              {reviewRating < 1 && <p className="text-xs text-ink-500">Tocca le stelle per votare.</p>}
              <Button type="submit" loading={submitReview.isPending} disabled={reviewRating < 1} size="sm">Pubblica recensione</Button>
            </form>
          )}
        </div>

        {/* Controlli lista: ordinamento + filtro "Con foto" (client-side) */}
        {totaleRecensioni > 0 && elencoRecensioniPronto && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-sm text-ink-500">
              Ordina
              <select
                value={reviewSort}
                onChange={(e) => setReviewSort(e.target.value as 'recent' | 'top' | 'low')}
                className="bg-white border border-cream-300 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-700"
              >
                <option value="recent">Più recenti</option>
                <option value="top">Voto più alto</option>
                <option value="low">Voto più basso</option>
              </select>
            </label>
            {photoReviewCount > 0 && (
              <button
                type="button"
                onClick={() => setReviewsOnlyPhoto((v) => !v)}
                aria-pressed={reviewsOnlyPhoto}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  reviewsOnlyPhoto
                    ? 'border-primary-400 bg-primary-50 text-primary-700'
                    : 'border-cream-300 bg-white text-ink-600 hover:border-primary-300'
                }`}
              >
                <ImageIcon size={14} strokeWidth={2.2} aria-hidden /> Con foto · {photoReviewCount}
              </button>
            )}
          </div>
        )}

        {/* Lista recensioni — quattro stati, non uno solo: niente recensioni,
            commenti ancora in arrivo, filtro che non pesca nulla, elenco pieno. */}
        {totaleRecensioni === 0 ? (
          <div className="bg-white border rounded-xl p-8 text-center">
            <Star size={40} strokeWidth={1.5} className="mx-auto text-ink-300 mb-2" aria-hidden />
            <p className="text-ink-600 font-medium">Nessuna recensione ancora</p>
            <p className="text-sm text-ink-400">Sii il primo a condividere la tua esperienza</p>
          </div>
        ) : elencoRecensioniRotto ? (
          <div className="bg-white border rounded-xl p-8 text-center">
            <p className="text-ink-700 font-medium">Non sono riuscito a caricare le recensioni</p>
            <p className="mt-1 text-sm text-ink-500">Il voto medio qui sopra è quello vero.</p>
            <button
              type="button"
              onClick={() => { void ricaricaRecensioni(); }}
              className="mt-3 text-sm font-semibold text-primary-700 hover:underline"
            >
              Riprova
            </button>
          </div>
        ) : !elencoRecensioniPronto ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true">
            <span className="sr-only">Carico le recensioni…</span>
            {[0, 1].map((i) => (
              <div key={i} className="bg-white border border-cream-200 rounded-xl p-5 animate-pulse space-y-3">
                <div className="h-4 w-1/3 rounded bg-cream-200" />
                <div className="h-3 w-full rounded bg-cream-100" />
                <div className="h-3 w-4/5 rounded bg-cream-100" />
              </div>
            ))}
          </div>
        ) : visibleReviews.length === 0 ? (
          <div className="bg-white border rounded-xl p-8 text-center">
            <ImageIcon size={40} strokeWidth={1.5} className="mx-auto text-ink-300 mb-2" aria-hidden />
            <p className="text-ink-600 font-medium">Nessuna recensione con foto</p>
            <button
              type="button"
              onClick={() => setReviewsOnlyPhoto(false)}
              className="text-sm text-primary-700 font-semibold hover:underline"
            >
              Mostra tutte le recensioni
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleReviews.map((r) => (
              <div key={r.id} className="bg-white border border-cream-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <RatingStars rating={Number(r.rating)} size={16} />
                    {/* Verified Purchase badge — Trust & Safety insight */}
                    {r.verified_purchase && (
                      <span className="inline-flex items-center gap-1 text-2xs font-bold bg-olive-100 text-olive-800 px-2 py-0.5 rounded-full">
                        <Check size={11} strokeWidth={3} aria-hidden /> Acquisto verificato
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-400">
                    {new Date(r.created_at).toLocaleDateString('it-IT')}
                  </p>
                </div>
                {r.comment && <p className="text-ink-700 text-sm mb-2">{r.comment}</p>}
                {/* Foto recensione: grid responsive (Mobile Engineer) */}
                {/* La recensione si inserisce dal browser e sull'indirizzo delle foto non
                    c'e' nessun controllo: cosi' com'era, chi ha comprato davvero poteva
                    piazzare un collegamento a scelta sulla pagina pubblica del prodotto,
                    dentro la cornice di fiducia del marketplace. `fotoDiCasa` tiene solo
                    gli indirizzi `https` del nostro archivio — la stessa regola che la
                    scheda del reso applica gia' (components/seller/ReturnRequestCard.tsx).
                    Il testo alternativo era «Foto recensione» per tutte e quattro: un
                    lettore di schermo diceva quattro volte la stessa cosa. */}
                {Array.isArray(r.photo_urls) && r.photo_urls.filter(fotoDiCasa).length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {r.photo_urls.filter(fotoDiCasa).slice(0, 4).map((url: string, i: number) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block relative aspect-square rounded-lg overflow-hidden bg-cream-100 hover:opacity-80">
                        {/* 5/11/2026 — col caricatore: la misura la fa il CDN di Supabase, non una
                            seconda volta l'ottimizzatore di Vercel su una foto già ridotta. */}
                        <FotoConRipiego
                          src={url}
                          alt={`Foto ${i + 1} della recensione`}
                          fill
                          sizes="(max-width: 768px) 25vw, 200px"
                          loader={caricatoreFotoRemote}
                          className="object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                )}
                {/* 12/11/2026 (R02-005) — Ogni recensione si può segnalare: i Termini promettono
                    di togliere quelle non genuine. */}
                <div className="mt-2">
                  <Segnala tipo="recensione" oggettoId={r.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Q&A */}
      <section className="mt-12">
        <QuandoSiVede altezzaMinima={260}>
          <ProductQA
            productId={id}
            sellerId={sellerProfile?.id ?? product.seller_id}
          />
        </QuandoSiVede>
      </section>

      {/* Ultimi visti dell'utente (esclude questo prodotto) */}
      <section className="mt-12">
        <QuandoSiVede altezzaMinima={280}>
          <RecentlyViewed excludeId={id} />
        </QuandoSiVede>
      </section>

      {/* CORRELATI: SimilarProducts intelligente (seller + categoria) */}
      <section className="mt-12">
        <QuandoSiVede altezzaMinima={320}>
          <SimilarProducts
            productId={id}
            categoryId={product.category_id ?? undefined}
            sellerId={sellerProfile?.id ?? product.seller_id}
          />
        </QuandoSiVede>
      </section>

      {/* Sticky CTA mobile — con stepper quantità, "{qty}×{price}" e totale */}
      {/* 27/11/2026 — Per un servizio la barra in fondo non aggiunge al carrello: porta a «Prenota». */}
      {!eAbbonamentoSdg && eUnServizio && (
      <StickyAddToCart
        price={price}
        bersaglio="prenota-servizio"
        available
        onAdd={() => document.getElementById('prenota-servizio')?.click()}
        etichette={{ corta: ETICHETTA_PRENOTA_CORTA, intera: ETICHETTA_PRENOTA }}
      />
      )}
      {!eAbbonamentoSdg && !eUnServizio && (
      <StickyAddToCart
        price={price}
        // R02-012 — Con la promo attiva la barra riceve anche il pieno e lo barra accanto, come il
        // prezzo grande qui sopra: senza, chi scorreva leggeva sotto un prezzo diverso da quello di sopra.
        prezzoPieno={prezzoPieno}
        bersaglio="acquisto-principale"
        available={canAdd}
        onAdd={handleAdd}
        note="Paghi alla consegna"
        // R02-007 — Sopra il tetto dei contanti la riga non si passa. La frase resta scritta qui sopra:
        // è quella che la prova della barra misura a 360 pixel.
        // R02-006 — Il pulsante della barra è «Aggiungi»: il tetto si guarda sul carrello come lo lascia lui.
        {...(contantiAggiungendo ? {} : { note: undefined })}
        qty={qty}
        onDec={() => setQuantity(Math.max(1, qty - 1))}
        onInc={() => setQuantity(Math.min(maxQty, qty + 1))}
        canDec={qty > 1}
        canInc={qty < maxQty}
      />
      )}

      {/* Tracking view (side-effect only) */}
      <ProductViewTracker
        productId={id}
        price={price}
        category={product.categories?.slug ?? undefined}
        sellerId={sellerProfile?.id ?? product.seller_id ?? undefined}
        chiGuardaEAdmin={isAdmin}
      />
    </div>
  );
}
