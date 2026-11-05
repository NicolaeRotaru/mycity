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
import {
  CASELLE_FINTE_FILA,
  CLASSI_CASELLA_FILA,
  CLASSI_FILA,
  classiGriglia,
  type ColonneMassime,
} from '@/lib/griglia-prodotti';
import { ErrorState } from './ui/ErrorState';
import { chiaveDiOggi, isOpenNow, type StoreHours } from '@/lib/store-hours';
import { leggiProdottiDellaGriglia, type OrdineGriglia } from '@/lib/queries/griglia-prodotti';
import { cEUnAltraPagina, finestraDellaPagina, pagineSuccessiva, unisciPagine } from '@/lib/paginazione';
import { trackSearchPerformed } from '@/lib/analytics/events';
import { fetchActiveDiscounts } from '@/lib/promotions';

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

/**
 * IL SEGNO CHE LA GRIGLIA SI STA AGGIORNANDO.
 *
 * 6/9/2026, secondo giro — LO STESSO SEGNALE CANCELLAVA I PRODOTTI A CHI VEDE POCO.
 *
 * Il segnale di prima schiariva tutta la griglia a meta' (`opacity-50`) lasciando
 * le schede cliccabili. Una schiaritura sul contenitore non tocca solo il grigio
 * di sfondo: mescola col fondo pagina OGNI cosa che sta dentro. Rifatto il conto
 * sui colori veri di `tailwind.config.ts`, mentre arrivavano i nuovi risultati il
 * nome del prodotto passava da 15,9 a 3,3 volte il fondo (ne servono 4,5), il nome
 * del negozio a 2,3, e il «+» che mette nel carrello a 2,1 (ne servono 3). Cioe':
 * chi tocca un filtro su una rete lenta smette di leggere i prodotti che stava
 * guardando, e il pulsante che fa comprare quasi sparisce — proprio la persona per
 * cui il segnale era stato pensato.
 *
 * Il segnale adesso e' una riga sottile sopra la griglia: si vede che sta
 * lavorando, e non tocca il contrasto di niente. Restano dov'erano `aria-busy`
 * sul contenitore e la riga «Aggiorno i risultati…» per chi ascolta.
 *
 * `animate-progress-fill` e non una pulsazione: una pulsazione fa ballare
 * l'opacita', ed e' esattamente la cosa da cui veniamo. La riga ha un colore
 * fermo — `primary-700` sul fondo pagina stacca 6,3 volte — e chi ha chiesto meno
 * animazioni la vede comparire ferma, che e' comunque il segnale.
 */
function BarraSiAggiorna({ acceso }: { acceso: boolean }) {
  if (!acceso) return null;
  return (
    <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-cream-200" aria-hidden>
      <div className="h-full w-full rounded-full bg-primary-700 animate-progress-fill" />
    </div>
  );
}

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
  /**
   * 6/9/2026 — Le prime quattro foto vengono chieste al browser come urgenti
   * (`priority`, che diventa un precaricamento). Ha senso solo se questa
   * griglia e' la prima cosa della pagina. Chi mette la griglia sotto qualcos'
   * altro — una collezione di negozio, per esempio — passa `false`: le foto si
   * caricano quando servono, senza rubare la coda a quello che si sta guardando.
   * Resta acceso di serie per non cambiare le pagine in cui la griglia E' la
   * prima cosa (novita', piu-venduti, ricerca, categoria).
   */
  prioritaPrimeFoto?: boolean;
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

const ProductGrid = ({ categoryId, categoryIds, sellerId, search, limit, maxPrice, minPrice, onlyOpenStores, onlyPromo, onlyInStock, minRating, sort = 'relevance', rail, prioritaPrimeFoto = true, title, titleHref, seeAllHref, emptyTitle, emptyDescription, onReset, emptySuggestions, onCount, maxColumns = 'default' }: Props) => {
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
  const domandaAperti = useQuery<string[]>({
    queryKey: queryKeys.stores.apertiOra,
    enabled: !!onlyOpenStores,
    // Un negozio apre e chiude a ore tonde: cinque minuti di memoria evitano
    // una domanda a ogni scorrimento senza far sbagliare nessuno.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // 5/11/2026 — L'errore si lancia: se diventasse una lista vuota la
      // griglia direbbe «i filtri sono troppo stretti» quando invece non sa.
      const { data, error } = await supabase.rpc('negozi_aperti_adesso');
      if (error) throw error;
      return ((data ?? []) as Array<{ seller_id: string }>).map((r) => r.seller_id);
    },
  });
  const apertiOra = domandaAperti.data;

  const domandaVoto = useQuery<string[]>({
    queryKey: queryKeys.products.conVotoAlmeno(minRating ?? 0),
    enabled: minRating !== undefined && minRating > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('prodotti_con_voto_almeno', { p_min: minRating });
      if (error) throw error;
      return ((data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id);
    },
  });
  const idsColVoto = domandaVoto.data;
  const filtroInErrore =
    (!!onlyOpenStores && domandaAperti.isError) ||
    (minRating !== undefined && minRating > 0 && domandaVoto.isError);

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

  /**
   * 6/9/2026 — CAMBIANDO UN FILTRO LA GRIGLIA RESTAVA IDENTICA, SENZA UN SEGNO.
   *
   * La lettura tiene a schermo i prodotti di prima mentre arrivano i nuovi
   * (`placeholderData: keepPreviousData`), e la chiave della domanda contiene prezzo,
   * disponibilità, negozio aperto, voto minimo e ordinamento. Quindi al cambio di un filtro parte
   * una lettura nuova ma `isLoading` resta falso: per chi guarda non succede niente, e su una rete
   * lenta si tocca il filtro due o tre volte pensando che non abbia preso.
   *
   * Adesso mentre si aggiorna compare una riga sottile sopra la griglia (`BarraSiAggiorna`), il
   * contenitore si dichiara occupato (`aria-busy`), e chi usa un lettore di schermo sente una riga
   * che glielo dice.
   *
   * ⚠️ LA GRIGLIA NON SI SCHIARISCE PIU'. Il primo tentativo la portava a meta' opacita': il perche'
   * non si puo' fare sta scritto sopra `BarraSiAggiorna`, coi contrasti rifatti sui colori veri.
   * ⚠️ NON si spegne il tocco sui prodotti: durante un aggiornamento le schede vecchie sono ancora
   * vere e cliccabili, e togliere il tocco farebbe perdere il prodotto a chi lo stava premendo.
   * ⚠️ E NON conta il «Carica altri prodotti»: lì si aggiungono righe in fondo, il pulsante dice
   * già «Carico…», e schiarire tutta la griglia sarebbe uno sfarfallio senza motivo.
   */
  const stoAggiornando = isFetching && !domanda.isFetchingNextPage;
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
  // 5/11/2026 — Serve solo a ordinare per «più recensiti». Il voto minimo lo
  // filtra già il database (`prodotti_con_voto_almeno`, qui sopra): rifarlo nel
  // browser su medie non ancora arrivate scartava tutto, e la griglia diceva
  // «Nessun prodotto trovato» a ogni «Carica altri». Mentre arriva la risposta
  // nuova resta quella di prima, così l'ordine non salta.
  const domandaVoti = useQuery<RatingMap>({
    placeholderData: keepPreviousData,
    queryKey: queryKeys.products.ratings(prods.map((p) => p.id).sort().join(',')),
    enabled: sort === 'rating',
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
  const ratings: RatingMap = domandaVoti.data ?? {};

  // Filtro "Promozione": insieme degli id prodotto con una promozione attiva del
  // negozio. Riusa la RPC active_promo_products (SECURITY INVOKER → rispetta RLS).
  // I prodotti col solo prezzo barrato (compare_at_price) vengono gestiti più sotto
  // senza query extra.
  // 31/10/2026 — una chiave SUA. La pagina /promozioni salva sotto queryKeys.promotions.active
  // le righe della promo (un elenco); qui serve un insieme di id. Con la stessa chiave la griglia
  // leggeva l'elenco della pagina e ci chiamava sopra .has(): con zero promozioni la pagina
  // disegna proprio questa griglia, e andava in errore. Sotto lo stesso prefisso, così chi
  // invalida le promozioni attive invalida anche questa.
  const domandaPromo = useQuery<Set<string>>({
    queryKey: [...queryKeys.promotions.active, 'ids'],
    enabled: !!onlyPromo,
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const { data } = await supabase.rpc('active_promo_products', { p_limit: 200 });
      const rows = (data ?? []) as Array<{ product_id: string }>;
      return new Set(rows.map((r) => r.product_id));
    },
  });
  const promoIds = domandaPromo.data ?? new Set<string>();

  /**
   * 5/11/2026 — LO SCONTO DELLE PROMOZIONI SI LEGGE PER OGNI GRIGLIA, DALLA FONTE DELLA CASSA.
   *
   * Prima si leggeva solo dentro la vetrina di un negozio, e con la stessa chiave della pagina del
   * negozio che chiedeva altre colonne: in ricerca, categorie e home le schede mostravano il
   * prezzo pieno (anche col filtro «In promozione»), e in vetrina lo sconto su tutto il negozio
   * spariva perché la griglia trovava in memoria le righe della pagina, senza `scope`.
   * Adesso la percentuale per prodotto arriva da `product_active_discounts`, la stessa funzione
   * che usa la cassa per far pagare il prezzo scontato: una chiamata sola per i prodotti visibili.
   */
  const idsVisibili = prods.map((p) => p.id).sort().join(',');
  const { data: scontiPromo } = useQuery<Map<string, number>>({
    queryKey: ['promotions', 'sconti-griglia', idsVisibili],
    enabled: prods.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: () => fetchActiveDiscounts(supabase, prods.map((p) => p.id)),
  });

  const discountFor = (p: Prod): number => scontiPromo?.get(p.id) ?? 0;

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
      const todayKey = chiaveDiOggi();
      arr = arr.filter((p) => {
        const hours = (p.profiles?.store_hours ?? {}) as StoreHours;
        return isOpenNow(hours[todayKey]);
      });
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
    /**
     * 6/9/2026 — «PIÙ RECENSITI» ORDINAVA PER MEDIA DEI VOTI, NON PER QUANTE RECENSIONI CI SONO.
     *
     * Questo ordinamento si chiama «Più recensiti» in italiano e «Most reviewed» in inglese, ma
     * confrontava `avg`: un prodotto con UNA recensione a cinque stelle scavalcava uno con
     * quaranta recensioni a 4,8. Chi cerca il prodotto più recensito cerca la prova che in tanti
     * l'hanno comprato — cioè il numero, non la media. Il voto alto ha già la sua strada: il
     * filtro «voto minimo» qui sopra, e nella scheda prodotto l'ordinamento «Voto più alto».
     *
     * A parità di numero di recensioni decide la media, così due prodotti con lo stesso conto non
     * escono in un ordine che cambia a ogni caricamento.
     */
    if (sort === 'rating') {
      arr = [...arr].sort((a, b) => {
        const ca = ratings[a.id]?.count ?? 0;
        const cb = ratings[b.id]?.count ?? 0;
        if (cb !== ca) return cb - ca;
        return (ratings[b.id]?.avg ?? 0) - (ratings[a.id]?.avg ?? 0);
      });
    }
    if (sort === 'discount_desc') {
      arr = [...arr].sort((a, b) => effectiveDiscount(b) - effectiveDiscount(a));
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prods, onlyOpenStores, ratings, sort, onlyPromo, onlyInStock, promoIds, scontiPromo]);

  // Notifica il conteggio visibile (post-filtro) al chiamante, per la riga
  // "N prodotti …" renderizzata fuori dalla griglia (SRP / categoria).
  // 5/11/2026 — Le letture da cui dipendono i filtri contano come «sto caricando»: finché non
  // arrivano, l'elenco vuoto non vuol dire «nessun prodotto».
  const caricando =
    isLoading || domandaAperti.isLoading || domandaVoto.isLoading || domandaPromo.isLoading;
  const inErrore = isError || filtroInErrore;

  // Con la lettura in errore il conteggio non si sa: non si dichiara «0 prodotti» sopra
  // il messaggio d'errore.
  useEffect(() => {
    if (!onCount || caricando || inErrore) return;
    onCount(filtered.length);
  }, [onCount, caricando, inErrore, filtered.length]);

  // Funnel: emette `search_performed` (PostHog + GA4) quando una ricerca
  // testuale si risolve. Solo in contesto ricerca (prop `search` valorizzata),
  // una volta per termine (no inflation da refetch/re-render).
  const lastTrackedSearch = useRef<string | null>(null);
  useEffect(() => {
    const term = search?.trim();
    // Con `keepPreviousData` a schermo ci sono ancora i risultati del termine di prima:
    // si conta solo quando sono arrivati quelli di questo termine.
    if (!term || caricando || domanda.isPlaceholderData) return;
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
  }, [search, caricando, domanda.isPlaceholderData, filtered.length]);

  /**
   * LA FORMA DEL BLOCCO SI DECIDE UNA VOLTA SOLA.
   *
   * 3/9/2026 — prima la decideva due volte: il ramo del caricamento guardava
   * `isSection` (fila **e** titolo) e il ramo a dati arrivati guardava `rail`.
   * In home il titolo lo scrive il renderer fuori dal componente, quindi le due
   * risposte erano diverse: scheletro a griglia, dati in fila, e la pagina che
   * si accorciava di un metro sotto gli occhi di chi leggeva.
   *
   * `formaFila` è quella domanda, fatta una volta. `isSection` resta, ma dice
   * un'altra cosa: se la fila si porta dietro anche la sua intestazione.
   */
  const formaFila = !!rail;
  // Sezione = fila con intestazione: si comporta come un blocco autonomo
  // (titolo + "Vedi tutto") e scompare del tutto quando è vuota.
  const isSection = formaFila && !!title;
  /**
   * 6/9/2026 — I TITOLI DELLE FILE VENIVANO TAGLIATI INVECE DI ANDARE A CAPO.
   *
   * Tutte e due le varianti dell'intestazione (con link e senza) avevano `truncate`: una riga
   * sola, il resto mozzato con tre puntini. Il titolo divide la riga col collegamento «Vedi
   * tutto», che e' `shrink-0` e quindi non cede spazio: su uno schermo da 320px al titolo ne
   * restano circa 180, cioe' una dozzina di lettere in Fraunces grassetto a 20px. Nomi come
   * «Abbigliamento sportivo» o «Latticini & Formaggi» non ci stavano — e il nome della
   * sottocategoria e' l'unica cosa che dice alla persona cosa sta guardando.
   *
   * `line-clamp-2` fa quello che serve: va a capo, e taglia solo dopo la seconda riga. La
   * misura parte piu' piccola sul telefono (`text-lg`) e risale da tablet in su, cosi' il
   * caso da 320px sta dentro senza toccare come si vede da grande.
   */
  const sectionHeader = title ? (
    <div className="mb-4 flex items-end justify-between gap-4">
      {titleHref ? (
        <Link href={titleHref} className="group min-w-0">
          <h2 className="line-clamp-2 font-serif text-lg font-bold text-ink-900 transition-colors group-hover:text-primary-700 sm:text-xl md:text-2xl">
            {title}
          </h2>
        </Link>
      ) : (
        <h2 className="line-clamp-2 min-w-0 font-serif text-lg font-bold text-ink-900 sm:text-xl md:text-2xl">{title}</h2>
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

  if (caricando) {
    // Fila: scheletro a fila, così la forma non cambia quando arrivano i dati.
    // La condizione è `formaFila`, la stessa che userà il ramo qui sotto:
    // guardava `isSection`, e in home usciva una griglia di dodici scheletri
    // che poi si stringeva in una riga sola.
    if (formaFila) {
      return (
        <section>
          {isSection && sectionHeader}
          <div className={CLASSI_FILA}>
            {Array.from({ length: CASELLE_FINTE_FILA }).map((_, i) => (
              <div key={i} className={CLASSI_CASELLA_FILA}>
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
  if (filtroInErrore) {
    if (isSection) return null;
    return (
      <ErrorState
        title={onlyOpenStores && domandaAperti.isError ? 'Non riesco a sapere chi è aperto adesso' : 'Non riesco a leggere i voti dei prodotti'}
        description="Il filtro non si può applicare in questo momento. Riprova, oppure togli il filtro."
        onRetry={() => { void domandaAperti.refetch(); void domandaVoto.refetch(); }}
      />
    );
  }

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
      priority={prioritaPrimeFoto && i < 4}
    />
  );

  // Fila: riga orizzontale scrollabile (home + sezioni categoria). Bleed ai bordi.
  // Stessa condizione e stesse classi dello scheletro qui sopra: è la riga che
  // impedisce alle due forme di tornare a divergere.
  if (formaFila) {
    const railRow = (
      <>
        <BarraSiAggiorna acceso={stoAggiornando} />
        <div
          className={CLASSI_FILA}
          aria-busy={stoAggiornando}
        >
          {filtered.map((p, i) => (
            <div key={p.id} className={CLASSI_CASELLA_FILA}>
              {renderCard(p, i)}
            </div>
          ))}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {stoAggiornando ? 'Aggiorno i risultati…' : ''}
        </p>
      </>
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
      <BarraSiAggiorna acceso={stoAggiornando} />
      <div
        className={classiDellaGriglia}
        aria-busy={stoAggiornando}
      >
        {filtered.map((p, i) => (
          <div key={p.id}>{renderCard(p, i)}</div>
        ))}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {stoAggiornando ? 'Aggiorno i risultati…' : ''}
      </p>
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
