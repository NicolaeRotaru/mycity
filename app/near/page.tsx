'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { List, Map as MapIcon, MapPin, RadioTower } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import StoreListRow from '@/components/StoreListRow';
import { ErrorState } from '@/components/ui/ErrorState';
import NearbyStoresMapLazy, { type NearbyStore } from '@/components/NearbyStoresMapLazy';
import { type ProductPreview, type StoreCardData } from '@/components/StorePreviewCard';
import CollectionHeader from '@/components/CollectionHeader';
import { haversineKm } from '@/lib/geo';
import { frasePosizione, motivoPosizione, siAspetta, type MotivoPosizione } from '@/lib/posizione';
import { queryKeys } from '@/lib/queries/keys';
import { leggiInBlocchi } from '@/lib/supabase/blocchi';
import { conRipiegoSchema, senzaColonne, stessaFormaDi, COLONNE_124_VISTA } from '@/lib/db/migrazione-124';

type Store = StoreCardData & {
  store_phone: string | null;
  store_lat: number | null;
  store_lng: number | null;
};

type ProductLite = ProductPreview & { seller_id: string };

/** Quanti negozi al massimo si portano a casa: un tetto scritto, invece di quello a sorpresa. */
const TETTO_NEGOZI_VICINI = 200;

const fetchNearData = async () => {
  // 22/8/2026 — le due bandierine Stripe arrivano sulla vista con la
  // migrazione 124: su un database che non l'ha ancora, PostgREST rifiuta la
  // select INTERA e la pagina «Vicino a te» resta senza un solo negozio.
  // 22/8/2026 — `store_media` era qui e non si mostrava da nessuna parte.
  // È la galleria fotografica del negozio: un campo JSON che può pesare
  // decine di kilobyte per negozio, moltiplicato per ogni negozio, scaricato
  // su ogni apertura di «Vicino a te» — dove non compare una sola di quelle
  // foto. Resta su /stores, che invece la usa.
  const SELECT_NEAR =
    'id, store_name, store_phone, store_address, store_lat, store_lng, store_logo, store_hours, is_approved, stripe_charges_enabled, stripe_payouts_enabled';
  // 27/8/2026 (R081) — non c'era nessun tetto scritto, e PostgREST ne ha uno suo: mille righe,
  // sempre, anche quando nessuno lo chiede. Superate quelle, dei negozi sparirebbero dall'elenco
  // senza che niente lo dica. Duecento è una scelta dichiarata: la pagina «Vicino a te» ordina per
  // distanza e nessuno scorre oltre. (Su /stores lo stesso difetto resta aperto: quel file è di un
  // altro lotto.)
  const conBandierine = () => supabase.from('seller_public_profiles').select(SELECT_NEAR).limit(TETTO_NEGOZI_VICINI);
  const { data: storesRaw, error: erroreNegozi } = await conRipiegoSchema(
    'near/page:seller_public_profiles',
    conBandierine,
    () =>
      stessaFormaDi<Awaited<ReturnType<typeof conBandierine>>>(
        supabase.from('seller_public_profiles').select(senzaColonne(SELECT_NEAR, COLONNE_124_VISTA)).limit(TETTO_NEGOZI_VICINI),
      ),
  );
  // L'errore veniva ingoiato: `conRipiegoSchema` non lancia — restituisce il risultato com'e' — e
  // il campo `error` non lo leggeva nessuno. Quindi una lettura fallita non diventava mai un
  // errore: la query andava a buon fine con `stores: []`, e a schermo usciva «0 negozi a Piacenza».
  // Cioe' il sito rispondeva a una domanda che nessuno aveva potuto porre.
  if (erroreNegozi) throw erroreNegozi;

  const stores = (storesRaw ?? []) as Store[];
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) return { stores: [], productsByStore: {}, reviewsByStore: {} };

  // #93 — L'elenco dei negozi viaggia nell'indirizzo della richiesta, 37
  // caratteri l'uno: oltre i due-trecento negozi la richiesta viene rifiutata e
  // qui si legge «nessun prodotto». Si spezza in blocchi da cento.
  /**
   * 22/8/2026 — IL RIPIEGO GIRAVA SEMPRE, ANCHE QUANDO NON SERVIVA.
   *
   * Si scaricavano fino a quattrocento prodotti interi e poi si chiamava
   * `store_cards`, che dà la stessa cosa fatta meglio: quando la seconda
   * rispondeva — cioè quasi sempre — i quattrocento venivano buttati via, ma
   * erano già arrivati fino al telefono di chi guardava.
   */
  const [schedeRes, reviewsRes] = await Promise.all([
    supabase.rpc('store_cards', { p_per_store: 4, p_limit: 500 }),
    // 22/8/2026 — QUI SI SCARICAVA OGNI RECENSIONE DI OGNI NEGOZIO per farne
    // la media nel browser. Con cinquanta negozi e cinquanta recensioni l'uno
    // sono duemilacinquecento righe che viaggiano fino al telefono, per
    // produrre due numeri per negozio. La funzione che le somma nel database
    // esiste da luglio (migrazione 052) ed e' gia' aperta a chi non ha
    // l'account: la pagina gemella /stores la usa, questa no.
    supabase.rpc('store_review_stats', { p_store_ids: storeIds }),
  ]);

  // #89 — Stessa cosa di /stores: il taglio globale (400 prodotti in tutto)
  // lasciava senza vetrina i negozi che non pubblicano da un po'. La funzione
  // della migrazione 122 prende i primi quattro DI OGNI negozio; se non e'
  // ancora applicata si resta al giro di prima.
  const schede = (schedeRes.data ?? []) as Array<{ seller_id: string; prodotti: ProductLite[] }>;
  const productsByStore: Record<string, ProductLite[]> = {};
  for (const riga of schede) {
    if (riga.prodotti && riga.prodotti.length > 0) productsByStore[riga.seller_id] = riga.prodotti;
  }

  // Il ripiego: solo se la funzione non ha risposto.
  if (schede.length === 0) {
    const productsRes = await leggiInBlocchi<ProductLite>(storeIds, (blocco) =>
      supabase
        .from('products')
        .select('id, name, price, images, seller_id')
        .in('seller_id', blocco)
        .eq('status', 'available')
        .order('created_at', { ascending: false })
        .limit(400) as unknown as PromiseLike<{ data: ProductLite[] | null; error: { message?: string } | null }>,
    );
    for (const p of (productsRes.data ?? []) as ProductLite[]) {
      if (productsByStore[p.seller_id]?.length) continue;
      (productsByStore[p.seller_id] ??= []).push(p);
    }
  }

  const reviewsByStore: Record<string, { avg: number; count: number }> = {};
  for (const r of (reviewsRes.data ?? []) as { store_id: string; avg: number | string; count: number }[]) {
    reviewsByStore[r.store_id] = { avg: Number(r.avg), count: Number(r.count) };
  }

  return { stores, productsByStore, reviewsByStore };
};

export default function NearMePage() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [motivo, setMotivo] = useState<MotivoPosizione | null>(null);
  const [cerco, setCerco] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [radiusKm, setRadiusKm] = useState(5);

  /**
   * 24/8/2026 — IL PERMESSO NON SI CHIEDE PIÙ A FREDDO, E LA PAGINA NON ASPETTA PIÙ.
   *
   * Prima questa richiesta partiva dentro un effetto al montaggio: il riquadro di sistema arrivava
   * prima di qualsiasi contenuto e senza una riga che dicesse perché. Un permesso chiesto così
   * viene negato molto più spesso — e su iPhone, una volta negato, non lo richiede più nessuno: si
   * deve andare nelle impostazioni del telefono. Cioè un «no» dato in due secondi spegneva la
   * funzione per sempre.
   *
   * Adesso parte da un gesto: si vede prima cosa c'è, poi si decide se dire dove si è. Il perché
   * completo, e le altre due metà del difetto, stanno in lib/posizione.ts.
   */
  const chiediPosizione = useCallback(() => {
    if (!navigator.geolocation) {
      setMotivo('non-disponibile');
      return;
    }
    setCerco(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setMotivo(null);
        setCerco(false);
      },
      (err) => {
        // Il testo NON è quello del browser: è in inglese e cambia da browser a browser.
        setMotivo(motivoPosizione(err));
        setCerco(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.stores.nearV2,
    queryFn: fetchNearData,
  });

  // Riferimento stabile (evita di ricalcolare i useMemo a ogni render quando data è undefined).
  const stores = useMemo<Store[]>(() => data?.stores ?? [], [data]);
  const productsByStore = data?.productsByStore ?? {};
  const reviewsByStore = data?.reviewsByStore ?? {};

  // Calcola distanza (se abbiamo la posizione) e ordina per vicinanza.
  const ranked = useMemo(
    () =>
      stores
        .map((s) => ({
          store: s,
          distance:
            pos && s.store_lat != null && s.store_lng != null
              ? haversineKm(pos.lat, pos.lng, Number(s.store_lat), Number(s.store_lng))
              : null,
        }))
        .sort((a, b) => {
          if (a.distance == null) return b.distance == null ? 0 : 1;
          if (b.distance == null) return -1;
          return a.distance - b.distance;
        }),
    [stores, pos],
  );

  // Con la posizione filtriamo per raggio; senza, mostriamo tutti i negozi.
  const filtered = useMemo(
    () => (pos ? ranked.filter((x) => x.distance != null && x.distance <= radiusKm) : ranked),
    [ranked, pos, radiusKm],
  );

  const mapStores: NearbyStore[] = useMemo(
    () =>
      filtered
        .filter((x) => x.store.store_lat != null && x.store.store_lng != null)
        .map((x) => ({
          id: x.store.id,
          name: x.store.store_name,
          lat: Number(x.store.store_lat),
          lng: Number(x.store.store_lng),
        })),
    [filtered],
  );

  // Una lettura fallita non e' un elenco vuoto. Prima usciva «0 negozi a Piacenza» — una frase che
  // il sito non poteva sostenere, e che a un cliente dice «qui non c'e' niente per te».
  if (isError) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <ErrorState
          title="Non riusciamo a caricare i negozi"
          description="Abbiamo provato a leggere le botteghe della tua zona e non ci siamo riusciti. Non vuol dire che non ce ne siano: riprova fra un attimo."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // Si aspetta SOLO quello che serve davvero: i negozi. La posizione serve a ORDINARLI, e una lista
  // non ordinata è meglio di una schermata d'attesa su una cosa che magari non arriverà mai — il
  // riquadro di sistema può restare lì senza risposta, e prima la pagina restava bloccata con lui.
  if (siAspetta({ negoziInArrivo: isLoading })) {
    return (
      <div className="container mx-auto p-8 text-center text-ink-500 flex items-center justify-center gap-2">
        <RadioTower size={18} strokeWidth={2.2} aria-hidden /> Carico i negozi…
      </div>
    );
  }

  const toggleBtn = (target: 'list' | 'map', label: string, Icon: typeof List) => (
    <button
      type="button"
      onClick={() => setView(target)}
      aria-pressed={view === target}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
        view === target ? 'bg-primary-700 text-white shadow-warm-sm' : 'text-ink-600 hover:bg-cream-50'
      }`}
    >
      <Icon size={16} strokeWidth={2.2} aria-hidden /> {label}
    </button>
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <CollectionHeader
        icon={MapPin}
        eyebrow="Negozi vicini"
        title="Vicino a te"
        blurb="I negozi della tua zona a Piacenza, con consegna locale rapida."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Vicino a te' }]}
      />

      <p className="mb-4 text-ink-500">
        {filtered.length} {filtered.length === 1 ? 'negozio' : 'negozi'}
        {pos ? ` entro ${radiusKm} km` : ' a Piacenza'}
      </p>

      {/* L'invito, prima del permesso: si dice a cosa serve, e il riquadro di sistema arriva DOPO il
          gesto. Chi non lo tocca vede comunque tutti i negozi. */}
      {!pos && !motivo && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-cream-300 bg-surface-0 px-4 py-3 text-sm text-ink-700">
          <MapPin size={18} strokeWidth={2.2} className="shrink-0 text-primary-700" aria-hidden />
          <span className="min-w-0 flex-1">Per ordinarli dal più vicino serve sapere dove sei. Il telefono te lo chiederà.</span>
          <button
            type="button"
            onClick={chiediPosizione}
            disabled={cerco}
            className="rounded-lg bg-primary-700 px-3.5 py-2 text-sm font-bold text-white hover:bg-primary-800 disabled:opacity-60"
          >
            {cerco ? 'Cerco…' : 'Ordina per vicinanza'}
          </button>
        </div>
      )}

      {motivo && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-ink-700">
          <MapPin size={18} strokeWidth={2.2} className="shrink-0 text-accent-500" aria-hidden />
          <span className="min-w-0 flex-1">{frasePosizione(motivo)}</span>
          {motivo !== 'negato' && (
            <button
              type="button"
              onClick={chiediPosizione}
              disabled={cerco}
              className="rounded-lg bg-cream-100 px-3.5 py-2 text-sm font-bold text-ink-900 hover:bg-cream-200 disabled:opacity-60"
            >
              {cerco ? 'Cerco…' : 'Riprova'}
            </button>
          )}
        </div>
      )}

      {/* Controlli: toggle Lista/Mappa + slider raggio */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-xl border border-surface-200 bg-white p-1 shadow-card">
          {toggleBtn('list', 'Lista', List)}
          {toggleBtn('map', 'Mappa', MapIcon)}
        </div>

        {pos && (
          <label className="flex items-center gap-3 text-sm text-ink-600">
            <span className="whitespace-nowrap font-semibold">Raggio: {radiusKm} km</span>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="h-2 w-40 cursor-pointer accent-primary-600 sm:w-56"
              aria-label="Raggio di ricerca in km"
            />
          </label>
        )}
      </div>

      {view === 'map' ? (
        mapStores.length > 0 || pos ? (
          <NearbyStoresMapLazy userPos={pos} stores={mapStores} radiusKm={radiusKm} />
        ) : (
          <div className="rounded-2xl border border-surface-200 bg-cream-50 p-8 text-center text-ink-500">
            Nessun negozio con posizione da mostrare sulla mappa.
          </div>
        )
      ) : filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(({ store, distance }) => (
            <StoreListRow
              key={store.id}
              store={store}
              products={productsByStore[store.id] ?? []}
              reviews={reviewsByStore[store.id]}
              distanceKm={distance}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-surface-200 bg-cream-50 p-8 text-center text-ink-500">
          Nessun negozio entro {radiusKm} km. Aumenta il raggio per vederne di più.
        </div>
      )}
    </div>
  );
}
