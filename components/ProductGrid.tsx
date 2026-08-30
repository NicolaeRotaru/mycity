'use client';

import { useEffect, useMemo, useRef } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowRight, RotateCcw, SearchX } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductCard from './ProductCard';
import { Button } from '@/components/ui/Button';
import { queryKeys } from '@/lib/queries/keys';
import SkeletonCard, { SkeletonGrid } from './SkeletonCard';
import { classiGriglia, type ColonneMassime } from '@/lib/griglia-prodotti';
import { ErrorState } from './ui/ErrorState';
import { DAY_KEYS, isOpenNow, type StoreHours } from '@/lib/store-hours';
import { leggiProdottiDellaGriglia, type OrdineGriglia } from '@/lib/queries/griglia-prodotti';
import { cEUnAltraPagina, finestraDellaPagina, pagineSuccessiva, unisciPagine } from '@/lib/paginazione';
import { trackSearchPerformed } from '@/lib/analytics/events';

/**
 * L'ordinamento della griglia. Vive con la lettura, in `lib/queries/griglia-prodotti.ts`: chi
 * sceglie l'ordine e chi lo esegue devono guardare la stessa definizione.
 */
export type SortOption = OrdineGriglia;

/**
 * Numero massimo di colonne della griglia. `'default'` mantiene la scala storica
 * della ricerca (fino a 6 col su xl); `4` cappa a 4 colonne — usato dalle pagine
 * collezione/categoria, che hanno meno densità della SRP. Opt-in via prop `maxColumns`.
 */
// Il tipo vive con le classi, in `lib/griglia-prodotti.ts`: chi sceglie le colonne e chi le
// disegna devono guardare la stessa definizione.
export type GridMaxColumns = ColonneMassime;

interface Props {
  categoryId?: string;
  /** Più categorie (es. categoria padre + sottocategorie): usa IN al posto di EQ. */
  categoryIds?: string[];
  sellerId?: string;
  search?: string;
  limit?: number;
  maxPrice?: number;
  minPrice?: number;
  onlyOpenStores?: boolean;
  /** Mostra solo prodotti in promo (promozione attiva del negozio) o scontati
   *  (prezzo pieno barrato > prezzo attuale). */
  onlyPromo?: boolean;
  /** Mostra solo prodotti disponibili (stock illimitato o > 0). */
  onlyInStock?: boolean;
  minRating?: number;
  sort?: SortOption;
  /** Layout "rail" orizzontale scrollabile (per le righe curate della home). */
  rail?: boolean;
  /** Modalità "sezione" (solo con `rail`): mostra un'intestazione "titolo + Vedi tutto"
   *  sopra la rail e si auto-nasconde quando non ci sono prodotti. Usata nelle pagine
   *  categoria-hub, una rail per sottocategoria. */
  title?: string;
  titleHref?: string;
  seeAllHref?: string;
  /**
   * Personalizzazione dello stato "zero risultati" (opzionale, retro-compatibile).
   * Se non passati, lo stato vuoto resta quello generico storico.
   */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Se fornito, lo stato vuoto mostra un'azione "Azzera filtri". */
  onReset?: () => void;
  /** Slot renderizzato sotto lo stato vuoto: "Forse cercavi" + alternative. */
  emptySuggestions?: React.ReactNode;
  /**
   * Notifica al chiamante il numero di prodotti visibili (post-filtro client-side),
   * per la riga conteggio "N prodotti …" renderizzata fuori dalla griglia.
   */
  onCount?: (count: number) => void;
  /**
   * Cap colonne della griglia (solo layout, opt-in). `'default'` (storico) scala
   * fino a 6 col su xl per la SRP; `4` cappa a 4 col per le pagine collezione/categoria.
   */
  maxColumns?: GridMaxColumns;
}

const ProductGrid = ({ categoryId, categoryIds, sellerId, search, limit, maxPrice, minPrice, onlyOpenStores, onlyPromo, onlyInStock, minRating, sort = 'relevance', rail, title, titleHref, seeAllHref, emptyTitle, emptyDescription, onReset, emptySuggestions, onCount, maxColumns = 'default' }: Props) => {
  /**
   * #127 — Il catalogo si fermava a 96 prodotti e non lo diceva.
   *
   * Chi cercava una parola comune («pane», «vino») vedeva novantasei schede e
   * poi il vuoto: non «fine dei risultati», ma la fine di quello che era stato
   * scaricato. I prodotti dal novantasettesimo in poi non esistevano per
   * nessuno — nemmeno per il negoziante che li aveva pubblicati.
   *
   * Ora c'e' «Carica altri»: ogni pressione allarga la finestra.
   */

  /**
   * 22/8/2026 — «CARICA ALTRI» FACEVA SPARIRE LA GRIGLIA.
   *
   * La finestra si allarga cambiando la chiave della cache, e con una chiave
   * nuova React Query non ha niente da mostrare: la griglia si svuotava, la
   * pagina si accorciava di colpo e lo scorrimento saltava in cima. Chi voleva
   * vedere il novantasettesimo prodotto si ritrovava all'inizio, sul primo.
   *
   * `placeholderData` tiene a schermo quelli di prima mentre arrivano i nuovi:
   * la griglia non sparisce e la pagina non si muove.
   */
  /**
   * 22/8/2026 — LE TRE DOMANDE LE FA IL DATABASE, PRIMA.
   *
   * «Aperto adesso» e «voto minimo» si applicavano nel browser, sulle righe
   * gia' arrivate. Siccome tagliare dopo avrebbe accorciato l'elenco, si
   * chiedevano quattro volte le righe che servivano — fino a quattrocento
   * prodotti interi, con le foto, per mostrarne novantasei. E con tre filtri
   * stretti anche quattrocento potevano non bastare: l'elenco usciva corto
   * senza che nessuno lo dicesse.
   */
  const { data: apertiOra } = useQuery<string[]>({
    queryKey: queryKeys.stores.apertiOra,
    enabled: !!onlyOpenStores,
    // Un negozio apre e chiude a ore tonde: cinque minuti di memoria evitano
    // una domanda a ogni scorrimento senza far sbagliare nessuno.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.rpc('negozi_aperti_adesso');
      return ((data ?? []) as Array<{ seller_id: string }>).map((r) => r.seller_id);
    },
  });

  const { data: idsColVoto } = useQuery<string[]>({
    queryKey: queryKeys.products.conVotoAlmeno(minRating ?? 0),
    enabled: minRating !== undefined && minRating > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.rpc('prodotti_con_voto_almeno', { p_min: minRating });
      return ((data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id);
    },
  });

  /**
   * 30/8/2026 (R080) — «CARICA ALTRI» RISCARICAVA OGNI VOLTA ANCHE I PRODOTTI
   * GIA' VISTI.
   *
   * La finestra si allargava moltiplicando il tetto per il numero di pressioni:
   * 96, poi 192 (di cui 96 gia' in memoria), poi 288, poi 384. Alla quarta
   * pressione erano state scaricate 960 righe, con le loro foto, per mostrarne
   * 384 — sulla connessione di chi guarda, e ogni pressione piu' lenta della
   * precedente. E siccome la chiave della cache conteneva il tetto, il
   * risultato di prima veniva buttato via ogni volta.
   *
   * Adesso la finestra si SPOSTA: ogni pressione chiede le sue righe e basta, e
   * quelle gia' arrivate restano dove sono. Lo schema e' quello che la pagina
   * ordini del negozio usa gia' (`lib/paginazione.ts`).
   */
  const dimensionePagina = limit ?? 96;
  // «In promozione» filtra ancora nel browser: per non far uscire una pagina
  // quasi vuota si chiede il doppio, ma resta una finestra, non un tetto che
  // cresce.
  const righePerPagina = onlyPromo ? Math.min(dimensionePagina * 2, 300) : dimensionePagina;

  const domanda = useInfiniteQuery({
    placeholderData: keepPreviousData,
    queryKey: queryKeys.products.grid({ categoryId, categoryIds, sellerId, search, limit: righePerPagina, maxPrice, minPrice, onlyOpenStores, onlyPromo, onlyInStock, minRating, sort }),
    initialPageParam: 0,
    // Senza gli insiemi la query non parte: partirebbe senza filtro, e
    // mostrerebbe proprio i prodotti che il filtro doveva escludere.
    enabled:
      (!onlyOpenStores || apertiOra !== undefined) &&
      (!(minRating !== undefined && minRating > 0) || idsColVoto !== undefined),
    queryFn: async ({ pageParam }) => {
      // 27/8/2026 (R069, R073) — la lettura vera sta in `lib/queries/griglia-prodotti.ts`, dove una
      // prova la puo' eseguire: qui dentro nessuno poteva accorgersi ne' del viaggio in piu' ai
      // negozi approvati ne' della «pertinenza» che ordinava per data.
      return leggiProdottiDellaGriglia(supabase, {
        categoryId,
        categoryIds,
        sellerId,
        search,
        sort,
        maxPrice,
        minPrice,
        onlyInStock,
        apertiOra: onlyOpenStores ? apertiOra ?? [] : undefined,
        idsColVoto: minRating !== undefined && minRating > 0 ? idsColVoto ?? [] : undefined,
        tetto: righePerPagina,
        finestra: finestraDellaPagina(pageParam as number, righePerPagina),
      });
    },
    getNextPageParam: (ultima, tutte) => pagineSuccessiva(ultima.length, tutte.length, righePerPagina),
  });

  const { isLoading, isError, refetch, isFetching } = domanda;
  // Le pagine gia' lette si uniscono togliendo i doppioni: mentre si sfoglia un
  // prodotto nuovo puo' entrare in cima e spostare tutte le righe di uno.
  const products = unisciPagine(domanda.data?.pages ?? []);

  // Carica rating aggregato per i prodotti visibili (per filtro/ordinamento per rating)
  type Prod = {
    id: string; name: string; price: string | number;
    compare_at_price: string | number | null;
    images: string[] | null; stock: number | null; has_variants?: boolean | null; created_at: string;
    seller_id: string | null; category_id: string | null;
    profiles?: { store_name: string | null; is_approved?: boolean; store_hours?: unknown } | null;
  };
  const prods = products as unknown as Prod[];
  type RatingMap = Record<string, { avg: number; count: number }>;
  const { data: ratings = {} as RatingMap } = useQuery<RatingMap>({
    queryKey: queryKeys.products.ratings(prods.map((p) => p.id).sort().join(',')),
    enabled: (minRating !== undefined && minRating > 0) || sort === 'rating',
    queryFn: async (): Promise<RatingMap> => {
      if (prods.length === 0) return {};
      const ids = prods.map((p) => p.id);
      // Aggregazione media/conteggio lato DB (RPC 052) invece di scaricare ogni
      // recensione e mediare in loop nel browser.
      const { data } = await supabase.rpc('product_rating_stats', { p_product_ids: ids });
      const map: RatingMap = {};
      type StatRow = { product_id: string; avg: number | string; count: number };
      for (const r of (data ?? []) as StatRow[]) {
        map[r.product_id] = { avg: Number(r.avg), count: Number(r.count) };
      }
      return map;
    },
  });

  // Filtro "Promozione": insieme degli id prodotto con una promozione attiva del
  // negozio. Riusa la RPC active_promo_products (SECURITY INVOKER → rispetta RLS).
  // I prodotti col solo prezzo barrato (compare_at_price) vengono gestiti più sotto
  // senza query extra.
  const { data: promoIds = new Set<string>() } = useQuery<Set<string>>({
    queryKey: queryKeys.promotions.active,
    enabled: !!onlyPromo,
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const { data } = await supabase.rpc('active_promo_products', { p_limit: 200 });
      const rows = (data ?? []) as Array<{ product_id: string }>;
      return new Set(rows.map((r) => r.product_id));
    },
  });

  // Sconti promo del negozio: calcolati solo in vetrina (quando filtriamo per sellerId).
  type PromoRow = { discount_percent: number; scope: string; category_id: string | null; product_ids: string[] | null };
  const { data: promos = [] } = useQuery<PromoRow[]>({
    queryKey: queryKeys.promotions.byStore(sellerId ?? ''),
    enabled: !!sellerId,
    queryFn: async (): Promise<PromoRow[]> => {
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from('seller_promotions')
        .select('discount_percent, scope, category_id, product_ids')
        .eq('seller_id', sellerId!)
        .eq('status', 'active')
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso);
      return (data ?? []) as PromoRow[];
    },
    staleTime: 60_000,
  });

  const discountFor = (p: Prod): number => {
    if (!sellerId || promos.length === 0) return 0;
    let best = 0;
    for (const promo of promos) {
      const applies =
        promo.scope === 'store' ||
        (promo.scope === 'category' && promo.category_id === p.category_id) ||
        (promo.scope === 'products' && Array.isArray(promo.product_ids) && promo.product_ids.includes(p.id));
      if (applies && promo.discount_percent > best) best = promo.discount_percent;
    }
    return best;
  };

  // Sconto effettivo (%) per l'ordinamento "Sconto maggiore": il maggiore tra
  // lo sconto promo del negozio (solo in vetrina) e lo sconto da prezzo barrato.
  const effectiveDiscount = (p: Prod): number => {
    const promo = discountFor(p);
    const cmp = p.compare_at_price != null ? Number(p.compare_at_price) : 0;
    const price = Number(p.price);
    const struck = cmp > price && cmp > 0 ? Math.round(((cmp - price) / cmp) * 100) : 0;
    return Math.max(promo, struck);
  };

  // Filtro client-side: orari aperti, rating minimo, ordinamento per rating
  const filtered = useMemo(() => {
    let arr = prods;
    if (onlyOpenStores) {
      const todayKey = DAY_KEYS[new Date().getDay()];
      arr = arr.filter((p) => {
        const hours = (p.profiles?.store_hours ?? {}) as StoreHours;
        return isOpenNow(hours[todayKey]);
      });
    }
    if (minRating !== undefined && minRating > 0) {
      arr = arr.filter((p) => (ratings[p.id]?.avg ?? 0) >= minRating);
    }
    if (onlyPromo) {
      arr = arr.filter((p) => {
        const cmp = p.compare_at_price != null ? Number(p.compare_at_price) : 0;
        const discounted = cmp > Number(p.price);
        return promoIds.has(p.id) || discounted;
      });
    }
    if (onlyInStock) {
      // Ridondante ma innocuo: il filtro vero ora e' nella query (#91).
      arr = arr.filter((p) => p.stock == null || p.stock > 0);
    }
    if (sort === 'rating') {
      arr = [...arr].sort((a, b) => {
        const ra = ratings[a.id]?.avg ?? 0;
        const rb = ratings[b.id]?.avg ?? 0;
        return rb - ra;
      });
    }
    if (sort === 'discount_desc') {
      arr = [...arr].sort((a, b) => effectiveDiscount(b) - effectiveDiscount(a));
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prods, onlyOpenStores, minRating, ratings, sort, onlyPromo, onlyInStock, promoIds, promos, sellerId]);

  // Notifica il conteggio visibile (post-filtro) al chiamante, per la riga
  // "N prodotti …" renderizzata fuori dalla griglia (SRP / categoria).
  useEffect(() => {
    if (!onCount || isLoading) return;
    onCount(filtered.length);
  }, [onCount, isLoading, filtered.length]);

  // Funnel: emette `search_performed` (PostHog + GA4) quando una ricerca
  // testuale si risolve. Solo in contesto ricerca (prop `search` valorizzata),
  // una volta per termine (no inflation da refetch/re-render).
  const lastTrackedSearch = useRef<string | null>(null);
  useEffect(() => {
    const term = search?.trim();
    if (!term || isLoading) return;
    if (lastTrackedSearch.current === term) return;
    lastTrackedSearch.current = term;
    // Il numero riportato è quello che la persona VEDE davvero.
    //
    // Prima si mandava `prods.length`: le righe grezze della query, prima dei
    // filtri applicati subito dopo (negozi aperti, valutazione minima, solo in
    // promozione, solo disponibili) e tagliate a 96. Quindi «ricerca con 96
    // risultati» mentre a schermo ne comparivano tre, e la misura di quante
    // ricerche finiscono a vuoto — quella che dice cosa manca in catalogo —
    // era falsa proprio nei casi che contano.
    trackSearchPerformed(term, filtered.length);
  }, [search, isLoading, filtered.length]);

  // Sezione = rail con intestazione: si comporta come un blocco autonomo
  // (titolo + "Vedi tutto") e scompare del tutto quando è vuota.
  const isSection = !!rail && !!title;
  const sectionHeader = title ? (
    <div className="mb-4 flex items-end justify-between gap-4">
      {titleHref ? (
        <Link href={titleHref} className="group min-w-0">
          <h2 className="truncate font-serif text-xl font-bold text-ink-900 transition-colors group-hover:text-primary-700 md:text-2xl">
            {title}
          </h2>
        </Link>
      ) : (
        <h2 className="truncate font-serif text-xl font-bold text-ink-900 md:text-2xl">{title}</h2>
      )}
      {seeAllHref && (
        <Link
          href={seeAllHref}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800"
        >
          Vedi tutto <ArrowRight size={16} strokeWidth={2.4} aria-hidden />
        </Link>
      )}
    </div>
  ) : null;

  if (isLoading) {
    // Sezione: intestazione + rail di skeleton, così la forma non cambia al load.
    if (isSection) {
      return (
        <section>
          {sectionHeader}
          <div className="-mx-4 flex gap-3 overflow-hidden px-4 pb-2 sm:-mx-6 sm:px-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-40 shrink-0 sm:w-44">
                <SkeletonCard />
              </div>
            ))}
          </div>
        </section>
      );
    }
    return <SkeletonGrid count={limit ?? 8} maxColumns={maxColumns} />;
  }

  // Errore di rete/DB: le sezioni-rail si auto-nascondono (come quando sono vuote),
  // altrove mostriamo un errore onesto con "Riprova" invece del falso "Nessun prodotto".
  if (isError) {
    if (isSection) return null;
    return (
      <ErrorState
        title="Impossibile caricare i prodotti"
        description="C'è stato un problema di caricamento. Controlla la connessione e riprova."
        onRetry={() => refetch()}
      />
    );
  }

  if (filtered.length === 0) {
    // Le sezioni per-sottocategoria spariscono quando non hanno prodotti.
    if (isSection) return null;
    // Stato vuoto arricchito (opt-in): titolo/descrizione personalizzati,
    // azione "Azzera filtri" e slot "Forse cercavi" + alternative. Quando
    // nessuna delle nuove prop è passata, resta lo stato storico generico.
    const enriched = !!emptyTitle || !!emptyDescription || !!onReset || !!emptySuggestions;
    if (enriched) {
      return (
        <div className="bg-white border border-cream-300 rounded-2xl px-4 py-12">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-cream-100 text-ink-400">
              <SearchX size={30} strokeWidth={1.7} aria-hidden />
            </div>
            <h3 className="font-serif text-lg font-bold text-ink-900">
              {emptyTitle ?? 'Nessun prodotto trovato'}
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
              {emptyDescription ?? 'Prova a modificare i filtri o cerca qualcos’altro.'}
            </p>
            {onReset && (
              <div className="mt-4 flex items-center justify-center">
                <Button variant="secondary" size="sm" shape="pill" icon={RotateCcw} onClick={onReset}>
                  Azzera filtri
                </Button>
              </div>
            )}
          </div>
          {emptySuggestions}
        </div>
      );
    }
    return (
      <div className="text-center py-16 bg-white border border-cream-300 rounded-xl">
        <SearchX size={48} strokeWidth={1.5} className="mx-auto text-ink-300 mb-3" />
        <p className="text-ink-700 font-semibold mb-1">Nessun prodotto trovato</p>
        <p className="text-sm text-ink-400">Prova a modificare i filtri o cerca qualcos&apos;altro</p>
      </div>
    );
  }

  const renderCard = (p: Prod, i: number) => (
    <ProductCard
      id={p.id}
      name={p.name}
      price={Number(p.price)}
      images={Array.isArray(p.images) ? p.images : []}
      stock={p.stock ?? undefined}
      createdAt={p.created_at}
      storeName={p.profiles?.store_name ?? undefined}
      sellerId={p.seller_id ?? undefined}
      discountPercent={discountFor(p)}
      // 122 — Questa proprietà non veniva passata: la griglia ordinava per
      // «Sconto maggiore» usando compare_at_price, ma poi nessuna card
      // mostrava il prezzo barrato. Il cliente vedeva un ordinamento che non
      // corrispondeva a niente di visibile.
      compareAtPrice={p.compare_at_price != null ? Number(p.compare_at_price) : null}
      hasVariants={p.has_variants ?? false}
      priority={i < 4}
    />
  );

  // Rail: riga orizzontale scrollabile (home + sezioni categoria). Bleed ai bordi.
  if (rail) {
    const railRow = (
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scrollbar-hide px-4 pb-2 sm:-mx-6 sm:px-6">
        {filtered.map((p, i) => (
          <div key={p.id} className="w-40 shrink-0 snap-start sm:w-44">
            {renderCard(p, i)}
          </div>
        ))}
      </div>
    );
    if (!isSection) return railRow;
    return (
      <section>
        {sectionHeader}
        {railRow}
      </section>
    );
  }

  // Pagine collezione/categoria (maxColumns=4): cap a 4 col, meno denso della SRP.
  // Default (SRP): scala storica fino a 6 col su xl.
  //
  // Le classi arrivano da `lib/griglia-prodotti.ts` e non sono più scritte qui: lo scheletro del
  // caricamento aveva il suo elenco, si fermava a quattro colonne, e appena arrivavano i prodotti
  // la pagina si riorganizzava da quattro a sei sotto gli occhi di chi leggeva.
  const classiDellaGriglia = classiGriglia(maxColumns);

  // Se sono tornate esattamente tante righe quante ne abbiamo chieste, quasi
  // certamente ce ne sono altre: si offre di caricarle invece di far finire il
  // catalogo li' in silenzio (#127).
  /**
   * 22/8/2026 — COI FILTRI ATTIVI IL PULSANTE NON CARICAVA NIENTE E NON
   * SPARIVA MAI.
   *
   * Quando sono accesi i filtri che lavorano nel browser (negozio aperto
   * adesso, in promozione, valutazione minima) la lettura chiede un margine:
   * quattro volte la finestra, ma non oltre quattrocento righe. Il pulsante
   * invece si guardava la finestra semplice: a quattrocento righe restava
   * acceso per sempre e ogni pressione riscaricava le stesse identiche righe.
   *
   * Adesso guarda il tetto VERO. Quando quello si esaurisce il pulsante
   * sparisce, che e' la verita': altre righe non ne arriverebbero.
   */
  // 22/8/2026 — «aperto adesso» e «voto minimo» adesso tagliano nel database,
  // quindi il margine serve solo per «in promozione», che resta qui.
  //
  // 30/8/2026 (R080) — E la domanda adesso e' sull'ultima pagina, non sul
  // totale: se l'ultima e' tornata piena quasi certamente ce n'e' un'altra.
  const ultimaPagina = domanda.data?.pages?.[domanda.data.pages.length - 1] ?? [];
  const forseCeNeSonoAltri = cEUnAltraPagina(ultimaPagina.length, righePerPagina);

  return (
    <>
      <div className={classiDellaGriglia}>
        {filtered.map((p, i) => (
          <div key={p.id}>{renderCard(p, i)}</div>
        ))}
      </div>
      {forseCeNeSonoAltri && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => void domanda.fetchNextPage()}
            disabled={isFetching}
            className="rounded-full border border-cream-300 bg-white px-6 py-2.5 text-sm font-semibold text-ink-700 hover:border-primary-300 hover:text-primary-700 disabled:opacity-50"
          >
            {isFetching ? 'Carico…' : 'Carica altri prodotti'}
          </button>
        </div>
      )}
    </>
  );
};

export default ProductGrid;
