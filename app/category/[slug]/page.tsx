'use client';;
import { use, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useEffect } from 'react';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { trackCategoryViewed } from '@/lib/analytics/events';
import { Filter, RotateCcw, Tag, PackageCheck, CircleDot, Star, X, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase/client';
import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';
import ProductGrid, { type SortOption } from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { queryKeys } from '@/lib/queries/keys';
import { contaProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import { domandaCategoriePiene, soloLePiene } from '@/lib/queries/categorie-piene';
import { domandaAlberoCategorie, type CategoriaDellAlbero } from '@/components/CategoryBar';

/**
 * 13/11/2026 (R15-010) — Una categoria senza prodotti diceva «Non abbiamo trovato questo
 * prodotto»: la frase della ricerca (`search.noResultsDescription`), che su una categoria non ha
 * senso — nessuno ha cercato un prodotto. Qui si dice cosa succede davvero.
 */
const CATEGORIA_ANCORA_VUOTA = 'In questa categoria non ci sono ancora prodotti dei negozi di Piacenza. Guarda le altre categorie o cerca quello che ti serve.';

export default function CategoryPage(props: { params: Promise<{ slug: string }> }) {
  const params = use(props.params);
  const { slug } = params;
  useEffect(() => { trackCategoryViewed(slug); }, [slug]);
  const t = useTranslations('search');
  const ta = useTranslations('actions');
  const tn = useTranslations('nav');

  type SubcatRow = { id: string; slug: string; name: string; icon: string | null };

  /**
   * #96 — Due attese in fila prima che partisse qualunque richiesta di prodotti.
   *
   * Si caricava la categoria, si aspettava; solo dopo partivano le
   * sottocategorie (`enabled: !!category`), si aspettava di nuovo; e solo a
   * quel punto le griglie chiedevano i prodotti. Due giri di rete a vuoto —
   * su una connessione mobile mezzo secondo buono — prima che comparisse
   * qualcosa, sulla pagina da cui la gente entra nel catalogo.
   *
   * Categoria e sottocategorie stanno nella stessa tabella e si possono
   * chiedere insieme: una lettura sola, `slug = questa OPPURE genitore =
   * questa`, e poi si separano qui.
   */
  const memoriaDelleCategorie = useQueryClient();
  const { data: alberoCategoria, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.categories.bySlug(slug),
    queryFn: async () => {
      // Le categorie sono poche decine: si leggono tutte in un colpo e si
      // separano qui. Costa meno di due viaggi in fila.
      // R16-009 — Le righe sono quelle dell'albero del menu e del piede (`domandaAlberoCategorie`,
      // stessa chiave del precarico del sito): `fetchQuery` le prende dalla memoria se ci sono e
      // sono fresche, si aggancia alla lettura del menu se è in corso, e torna al database solo
      // altrimenti. Prima la pagina le rileggeva tutte con una sua chiave.
      const righe: CategoriaDellAlbero[] = await memoriaDelleCategorie.fetchQuery(domandaAlberoCategorie(supabase));
      const padre = righe.find((r) => r.slug === slug) ?? null;
      // 6/9/2026 — Il briciolo di pane saltava la categoria madre: su
      // /category/libri-romanzi diceva «Home › Categorie › Romanzi», senza
      // «Libri». Chi voleva risalire di un livello doveva riaprire il menu, e
      // i dati strutturati per Google avevano lo stesso buco. La madre e' gia'
      // qui dentro — le righe sono tutte lette sopra — bastava cercarla.
      const madre = padre?.parent_id
        ? righe.find((r) => r.id === padre.parent_id) ?? null
        : null;
      return {
        category: padre,
        madre,
        subcategories: padre ? righe.filter((r) => r.parent_id === padre.id) : [],
      };
    },
    staleTime: 10 * 60_000,
  });
  const category = alberoCategoria?.category ?? null;
  /** La categoria che sta un livello sopra questa, quando questa e' una sottocategoria. */
  const madre = alberoCategoria?.madre ?? null;
  const subcategories: SubcatRow[] = alberoCategoria?.subcategories ?? [];
  const subsLoading = isLoading;

  /**
   * 17/11/2026 — I BOTTONI DELLE SOTTOCATEGORIE PORTAVANO ANCHE AL VUOTO.
   *
   * La pagina di una categoria madre metteva un bottone per ogni figlia, anche per quelle senza un
   * prodotto: un clic e si arrivava a «non ci sono ancora prodotti». Home, piede e indice delle
   * categorie le toglievano già, con la stessa lettura e la stessa chiave: qui si fa lo stesso. Si
   * aspetta la risposta per non far comparire e poi sparire un bottone; se la lettura fallisce si
   * mostrano tutte, come prima. Una rilettura caduta, però, non butta via le piene già note
   * (R08-007/R08-005): react-query le tiene in `data` anche in stato
   * d'errore. Le file dei prodotti restano su tutte le figlie: si nascondono da sole quando sono
   * vuote.
   */
  const piene = useQuery(domandaCategoriePiene(supabase));
  const sottocategoriePiene: SubcatRow[] = piene.isLoading
    ? []
    : soloLePiene(subcategories, piene.data ?? null);

  /**
   * 17/11/2026 — CON LA LETTURA DEI PRODOTTI CADUTA, LA CATEGORIA MADRE RESTAVA BIANCA.
   *
   * Nella pagina di una categoria madre ogni fila di prodotti (una per sottocategoria, più «Altri
   * prodotti») si nasconde da sola quando la sua lettura va in errore, e non lo dice a nessuno:
   * sotto i bottoni delle sottocategorie restava il vuoto, senza un «riprova». Qui si chiede al
   * database quanti prodotti ha l'albero (una domanda sola, senza righe): se non risponde, la
   * pagina lo dice invece di restare bianca.
   */
  const queryClient = useQueryClient();
  const idsDelHub =
    category && category.parent_id === null && subcategories.length > 0
      ? [category.id, ...subcategories.map((s) => s.id)]
      : null;
  const conteggioHub = useQuery({
    queryKey: queryKeys.products.grid({ conteggio: true, categoryIds: idsDelHub }),
    enabled: !!idsDelHub,
    staleTime: 60_000,
    queryFn: () => contaProdottiDellaGriglia(supabase, { categoryIds: idsDelHub ?? [] }),
  });
  // `contaProdottiDellaGriglia` risponde null quando la lettura fallisce, invece di lanciare.
  const prodottiDelHubCaduti =
    !!idsDelHub && (conteggioHub.isError || (conteggioHub.isSuccess && conteggioHub.data === null));

  /**
   * 17/11/2026 — E SE CADONO LE FILE MA IL CONTEGGIO RISPONDE?
   *
   * Il conteggio qui sopra è un'altra domanda: se lui risponde e le file cadono, la madre restava
   * bianca lo stesso (una fila caduta si nasconde senza chiamare `onCount`). Qui la pagina guarda
   * nella memoria di react-query come stanno le domande delle file, senza osservarle: un
   * osservatore con la stessa chiave riscriverebbe le opzioni della domanda della fila. Le chiavi
   * sono quelle delle file del hub in `components/ProductGrid.tsx` (12 prodotti, ordine di
   * pertinenza). Se il client non dà la sua memoria, le due liste restano vuote e decide il
   * conteggio, come prima.
   */
  const memoriaDelleDomande =
    typeof queryClient.getQueryCache === 'function' ? queryClient.getQueryCache() : null;
  const iscrivitiAllaMemoria = useCallback(
    (avvisa: () => void) => memoriaDelleDomande?.subscribe(avvisa) ?? (() => {}),
    [memoriaDelleDomande],
  );
  /**
   * 25/11/2026 — L'IMPRONTA DI OGNI FILA SI CALCOLA UNA VOLTA, NON A OGNI EVENTO DELLA MEMORIA.
   *
   * Il controllo qui sotto gira a ogni evento della memoria delle domande, e su questa pagina gli
   * eventi sono centinaia: ogni fila ne genera a ogni disegno. Prima cercava ogni fila con
   * `find({ exact: true })`, che scorre TUTTE le domande e per ognuna ricalcola l'impronta della
   * chiave cercata: sul telefono erano quasi due secondi di processore bloccato. Adesso le
   * impronte si calcolano qui, quando cambiano le file, e la ricerca e' diretta (`get`).
   * L'impronta e' la stessa che usa react-query (`hashKey`): nessuna domanda imposta la sua.
   */
  const chiaveDelHub = idsDelHub ? idsDelHub.join(',') : '';
  const fileDaControllare = useMemo((): Array<[string, readonly unknown[], string]> => {
    if (!chiaveDelHub) return [];
    const [madreId, ...figlie] = chiaveDelHub.split(',');
    const file: Array<[string, Record<string, unknown>]> = [
      ...figlie.map((id): [string, Record<string, unknown>] => [id, { categoryId: id, limit: 12, sort: 'relevance' }]),
      [madreId, { categoryIds: [madreId], limit: 12, sort: 'relevance' }],
    ];
    return file.map(([fila, filtri]) => {
      const chiave = queryKeys.products.grid(filtri);
      return [fila, chiave, hashKey(chiave)];
    });
  }, [chiaveDelHub]);
  const statoDelleFileInMemoria = useSyncExternalStore(
    iscrivitiAllaMemoria,
    () => {
      if (!memoriaDelleDomande || !idsDelHub) return '|';
      const cadute: string[] = [];
      const inArrivo: string[] = [];
      for (const [fila, chiave, impronta] of fileDaControllare) {
        const domanda = typeof memoriaDelleDomande.get === 'function'
          ? memoriaDelleDomande.get(impronta)
          : memoriaDelleDomande.find({ queryKey: chiave, exact: true });
        const stato = domanda?.state.status;
        if (stato === 'error') cadute.push(fila);
        else if (stato !== 'success') inArrivo.push(fila);
      }
      return `${cadute.join(',')}|${inArrivo.join(',')}`;
    },
    () => '|',
  );
  const [fileCaduteTesto, fileInArrivoTesto] = statoDelleFileInMemoria.split('|');
  const fileCadute = new Set(fileCaduteTesto ? fileCaduteTesto.split(',') : []);
  const fileInArrivo = fileInArrivoTesto ? fileInArrivoTesto.split(',') : [];

  // Stato filtri — ESCLUSIVAMENTE le dimensioni già supportate da ProductGrid.
  const [maxPrice, setMaxPrice] = useState<number>(500);
  const [minPrice, setMinPrice] = useState<number>(0);
  const [sort, setSort] = useState<SortOption>('relevance');
  const [onlyPromo, setOnlyPromo] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [onlyOpenStores, setOnlyOpenStores] = useState(false);
  const [minRating, setMinRating] = useState<number>(0);
  // R14-013 — Il conto della griglia vale solo per i filtri con cui è stato dato. La griglia, quando il
  // conto non si sa (ferma al tetto, senza totale del database), non lo dice: il numero di prima
  // non resta a video per i filtri nuovi. Il conto nuovo ha un `onCount` nuovo, e la griglia lo ridice
  // appena lo sa; se «non so» (`null`) lo dice, il numero sparisce.
  const chiaveFiltri = [slug, maxPrice, minPrice, onlyPromo, onlyInStock, onlyOpenStores, minRating, sort].join('|');
  const [contoDato, setContoDato] = useState<{ chiave: string; n: number | null } | null>(null);
  const segnaRisultati = useCallback(
    (n: number | null) => setContoDato({ chiave: chiaveFiltri, n }),
    [chiaveFiltri],
  );
  const resultCount = contoDato && contoDato.chiave === chiaveFiltri ? contoDato.n : null;
  const [filtersOpen, setFiltersOpen] = useState(false);
  // 5/11/2026 — Nel ramo hub ogni fila vuota si nasconde da sola: se lo fanno tutte, sotto i
  // bottoni delle sottocategorie la pagina restava bianca. Qui si raccolgono i conti delle file.
  // R11-012 — `null` = la fila non sa il suo conto (lettura caduta, ferma al tetto): non è «vuota».
  const [contiDelleFile, setContiDelleFile] = useState<Record<string, number | null>>({});
  const segnaConto = useCallback((fila: string, n: number | null) => {
    setContiDelleFile((c) => (c[fila] === n ? c : { ...c, [fila]: n }));
  }, []);
  // #134 — Il pannello si dichiarava `aria-modal` e non si comportava da
  // modale: da tastiera il fuoco restava dietro il velo, senza Esc e senza
  // uscita. Lo stesso pannello nella pagina di ricerca era gia' a posto: era
  // scritto li' dentro e nessuno l'aveva estratto.
  const sheetRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  useBottomSheetA11y(filtersOpen, sheetRef, filterTriggerRef, () => setFiltersOpen(false), { indietroChiude: true });

  const reset = () => {
    setMaxPrice(500);
    setMinPrice(0);
    setSort('relevance');
    setOnlyPromo(false);
    setOnlyInStock(false);
    setOnlyOpenStores(false);
    setMinRating(0);
  };

  const activeFilters = [
    minPrice > 0,
    maxPrice < 500,
    onlyPromo,
    onlyInStock,
    onlyOpenStores,
    minRating > 0,
    sort !== 'relevance',
  ].filter(Boolean).length;

  if (isLoading) return <LoadingState />;
  /**
   * 27/8/2026 (R094) — «CATEGORIA NON TROVATA» ANCHE QUANDO ERA SOLO CADUTA LA RETE.
   *
   * `category` resta nullo in due casi che non c'entrano niente fra loro: la categoria non esiste,
   * oppure la lettura è fallita. Finivano tutti e due nella stessa riga di testo, senza «riprova» e
   * senza una via d'uscita verso il catalogo. E per lo slug davvero morto la pagina rispondeva 200,
   * quindi per Google restava una pagina valida da proporre.
   */
  if (isError) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-8">
        <ErrorState
          title="Non riesco a caricare questa categoria"
          description="C'è stato un problema di collegamento. La categoria probabilmente c'è: riprova fra un attimo."
          onRetry={() => { void refetch(); }}
          backHref="/categorie"
          backLabel="Vedi tutte le categorie"
        />
      </div>
    );
  }
  if (!category) notFound();
  // Per le categorie principali aspettiamo le sottocategorie prima di decidere
  // hub vs griglia piatta, così non c'è un flash dal layout sbagliato.
  if (category.parent_id === null && subsLoading) return <LoadingState />;

  // Hub: categoria principale con sottocategorie → una rail scrollabile per ognuna.
  const isHub = category.parent_id === null && subcategories.length > 0;

  // Schema.org BreadcrumbList JSON-LD (Home > Categoria) per rich results Google.
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: '/' },
      { '@type': 'ListItem', position: 2, name: 'Categorie', item: '/categorie' },
      ...(madre ? [{ '@type': 'ListItem', position: 3, name: madre.name, item: `/category/${madre.slug}` }] : []),
      { '@type': 'ListItem', position: madre ? 4 : 3, name: category.name, item: `/category/${slug}` },
    ],
  };

  // Chip dei filtri attivi (rimovibili) — solo dimensioni reali della pagina.
  type Chip = { key: string; label: string; clear: () => void };
  const chips: Chip[] = [];
  if (minPrice > 0 && maxPrice < 500) chips.push({ key: 'price', label: t('filterPriceRange', { min: minPrice, max: maxPrice }), clear: () => { setMinPrice(0); setMaxPrice(500); } });
  else if (maxPrice < 500) chips.push({ key: 'pmax', label: t('filterPrice', { max: maxPrice }), clear: () => setMaxPrice(500) });
  else if (minPrice > 0) chips.push({ key: 'pmin', label: t('filterPriceMin', { min: minPrice }), clear: () => setMinPrice(0) });
  if (minRating > 0) chips.push({ key: 'rating', label: t('chip.minRating', { rating: minRating }), clear: () => setMinRating(0) });
  if (onlyPromo) chips.push({ key: 'promo', label: t('chip.promotion'), clear: () => setOnlyPromo(false) });
  if (onlyInStock) chips.push({ key: 'stock', label: t('chip.inStock'), clear: () => setOnlyInStock(false) });
  if (onlyOpenStores) chips.push({ key: 'open', label: t('chip.openNow'), clear: () => setOnlyOpenStores(false) });
  if (sort !== 'relevance') chips.push({ key: 'sort', label: t(`sort.${sort}`), clear: () => setSort('relevance') });

  // Header serif + breadcrumb condiviso tra hub e griglia — riusa CollectionHeader
  // (stesso componente di novita/regali/promozioni). L'emoji di categoria viene
  // mostrata nel chip terracotta; `Tag` resta il fallback lucide.
  const header = (
    <CollectionHeader
      icon={Tag}
      emoji={category.icon}
      eyebrow="Categoria"
      title={category.name}
      blurb="Esplora i prodotti della categoria dai negozi di Piacenza."
      breadcrumb={[
        { label: tn('home'), href: '/' },
        { label: 'Categorie', href: '/categorie' },
        ...(madre ? [{ label: madre.name, href: `/category/${madre.slug}` }] : []),
        { label: category.name },
      ]}
    />
  );

  // Controlli filtro condivisi tra colonna desktop e bottom-sheet mobile.
  const filterControls = (
    <div className="divide-y divide-cream-100">
      <div className="pb-3">
        <label className="block">
          <span className="block text-xs font-semibold text-ink-500 mb-1 uppercase tracking-label">{t('sortBy')}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
          >
            <option value="relevance">{t('sort.relevance')}</option>
            <option value="newest">{t('sort.newest')}</option>
            <option value="price_asc">{t('sort.price_asc')}</option>
            <option value="price_desc">{t('sort.price_desc')}</option>
            <option value="discount_desc">{t('sort.discount_desc')}</option>
            <option value="rating">{t('sort.rating')}</option>
          </select>
        </label>
      </div>

      {/* Range prezzo */}
      <div className="py-3">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs font-semibold text-ink-500 uppercase tracking-label">{t('price')}</span>
          <span className="font-bold text-primary-700 text-xs">{minPrice} € – {maxPrice}{maxPrice >= 500 ? '+' : ''} €</span>
        </div>
        <input
          type="range"
          min={0}
          max={500}
          step={5}
          value={minPrice}
          onChange={(e) => setMinPrice(Math.min(Number(e.target.value), maxPrice - 5))}
          className="w-full accent-primary-600"
          aria-label={t('minPrice')}
        />
        <input
          type="range"
          min={5}
          max={500}
          step={5}
          value={maxPrice}
          onChange={(e) => setMaxPrice(Math.max(Number(e.target.value), minPrice + 5))}
          className="w-full accent-primary-600"
          aria-label={t('maxPrice')}
        />
      </div>

      {/* Rating minimo */}
      <div className="py-3">
        <span className="text-xs font-semibold text-ink-500 mb-1.5 uppercase tracking-label flex items-center gap-1">
          <Star size={11} strokeWidth={2.2} />
          {t('minRating')}
        </span>
        <div className="flex gap-1.5">
          {[0, 3, 4, 4.5].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setMinRating(r)}
              aria-pressed={minRating === r}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${
                minRating === r
                  ? 'bg-primary-700 text-white border-primary-700'
                  : 'bg-white text-ink-700 border-cream-300 hover:border-primary-300'
              }`}
            >
              {r === 0 ? t('ratingAll') : `${r}+`}
            </button>
          ))}
        </div>
      </div>

      {/* Checkbox */}
      <div className="pt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={onlyPromo} onChange={(e) => setOnlyPromo(e.target.checked)} className="accent-primary-600" />
          <Tag size={14} strokeWidth={2.2} className="text-secondary-600" />
          <span>{t('promotion')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} className="accent-primary-600" />
          <PackageCheck size={14} strokeWidth={2.2} className="text-olive-600" />
          <span>{t('inStock')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={onlyOpenStores} onChange={(e) => setOnlyOpenStores(e.target.checked)} className="accent-primary-600" />
          <CircleDot size={14} strokeWidth={2.2} className="text-olive-600" />
          <span>{t('openNow')}</span>
        </label>
      </div>
    </div>
  );

  // 3/9/2026 — Qui c'era scritto che una categoria madre NON tira dentro i prodotti delle figlie
  // («restiamo sul comportamento storico»): era la decisione che faceva dire «nessun risultato» a
  // una categoria piena. Adesso l'albero lo risolve la lettura unica delle griglie
  // (`lib/queries/griglia-prodotti.ts`), quindi la madre porta con sé le sue figlie e da qui basta
  // passare la categoria corrente.
  const gridProps = {
    categoryId: category.id,
    maxPrice: maxPrice < 500 ? maxPrice : undefined,
    minPrice: minPrice > 0 ? minPrice : undefined,
    onlyOpenStores,
    onlyPromo,
    onlyInStock,
    minRating: minRating > 0 ? minRating : undefined,
    sort,
  } as const;

  // Hub: rail per ogni sottocategoria. Mantiene il comportamento storico, ma con
  // header serif + breadcrumb e una riga "Sottocategorie".
  if (isHub) {
    const fileDelHub = [...subcategories.map((s) => s.id), category.id];
    return (
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-8">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />
        {header}

        {sottocategoriePiene.length > 0 && (
          <section>
            <h2 className="font-serif text-xl font-bold text-ink-900 mb-3">Sottocategorie</h2>
            <div className="flex flex-wrap gap-2.5">
              {sottocategoriePiene.map((s) => (
                <Link
                  key={s.id}
                  href={`/category/${s.slug}`}
                  className="bg-white border border-cream-300 rounded-full px-4 py-2 hover:bg-primary-50 hover:border-primary-400 text-sm font-medium transition-colors"
                >
                  {s.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="space-y-10">
          {subcategories.map((s) => (
            <ProductGrid
              key={s.id}
              rail
              limit={12}
              categoryId={s.id}
              title={s.name}
              titleHref={`/category/${s.slug}`}
              seeAllHref={`/category/${s.slug}`}
              onCount={(n) => segnaConto(s.id, n)}
              // 25/11/2026 — Le figlie che l'elenco delle piene da' per vuote non mostrano lo
              // scheletro: sparivano dopo un secondo e le file sotto risalivano (CLS 0,17-0,52 sul
              // telefono). La fila resta: se ha prodotti, compare quando arrivano.
              scheletro={piene.isLoading || !piene.data || piene.data.includes(s.id)}
            />
          ))}
          {/* 5/11/2026 — Solo i prodotti messi sulla madre: con `categoryId` la lettura allargava
              alle figlie e ogni prodotto compariva due volte, nella sua fila e qui. */}
          <ProductGrid
            rail
            limit={12}
            categoryIds={[category.id]}
            title="Altri prodotti"
            onCount={(n) => segnaConto(category.id, n)}
          />
        </div>

        {/* 17/11/2026 — Lettura caduta e nessuna fila a schermo: si dice, invece del vuoto.
            Basta che siano cadute le file (ognuna caduta o vuota, almeno una caduta), anche se il
            conteggio risponde; e se cade il conteggio mentre le file arrivano, si aspetta. */}
        {((fileDelHub.every((fila) => fileCadute.has(fila) || contiDelleFile[fila] === 0) &&
          fileDelHub.some((fila) => fileCadute.has(fila))) ||
          (prodottiDelHubCaduti &&
            fileInArrivo.length === 0 &&
            !fileDelHub.every((fila) => contiDelleFile[fila] === 0) &&
            !fileDelHub.some((fila) => (contiDelleFile[fila] ?? 0) > 0))) && (
            <ErrorState
              title="Non riesco a caricare i prodotti di questa categoria"
              description="C'è stato un problema di collegamento: i prodotti probabilmente ci sono. Riprova fra un attimo."
              onRetry={() => queryClient.invalidateQueries({ queryKey: queryKeys.products.all })}
              backHref="/categorie"
              backLabel="Vedi tutte le categorie"
            />
          )}

        {fileDelHub.every((fila) => contiDelleFile[fila] === 0) && (
            <div className="rounded-2xl border border-cream-300 bg-white px-4 py-12 text-center">
              <p className="font-serif text-lg font-bold text-ink-900">{t('noResultsGeneric')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{CATEGORIA_ANCORA_VUOTA}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Link href="/categorie" className="rounded-full border border-cream-300 px-4 py-2 text-sm font-semibold text-ink-800 hover:border-primary-400">
                  Vedi tutte le categorie
                </Link>
                <Link href="/search" className="rounded-full bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800">
                  Cerca un prodotto
                </Link>
              </div>
            </div>
          )}
      </div>
    );
  }

  // Griglia piatta (categoria foglia o padre senza sottocategorie):
  // header serif + breadcrumb, colonna filtri faccettata (collassabile su mobile),
  // riga conteggio, chip row e zero-results arricchito.
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 md:grid-cols-4 gap-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />

      <div className="md:col-span-4">{header}</div>

      {sottocategoriePiene.length > 0 && (
        <section className="md:col-span-4">
          <div className="flex flex-wrap gap-2.5">
            {sottocategoriePiene.map((s) => (
              <Link
                key={s.id}
                href={`/category/${s.slug}`}
                className="bg-white border border-cream-300 rounded-full px-4 py-2 hover:bg-primary-50 hover:border-primary-400 text-sm font-medium transition-colors"
              >
                {s.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* DESKTOP: colonna filtri faccettata */}
      <aside className="hidden md:block md:col-span-1 bg-white border border-cream-300 rounded-2xl p-4 h-fit md:sticky md:top-[var(--header-height)] shadow-warm">
        <div className="flex items-center justify-between pb-3 border-b border-cream-100 mb-1">
          <h2 className="font-serif font-bold text-ink-900 flex items-center gap-2">
            <Filter size={16} strokeWidth={2.2} className="text-primary-600" />
            {t('filters')}
            {activeFilters > 0 && (
              <span className="bg-primary-600 text-white text-2xs font-bold rounded-full px-1.5 py-0.5 leading-none">
                {activeFilters}
              </span>
            )}
          </h2>
          {activeFilters > 0 && (
            <button onClick={reset} className="text-xs text-ink-500 hover:text-primary-700 inline-flex items-center gap-1">
              <RotateCcw size={12} />
              {t('reset')}
            </button>
          )}
        </div>
        {filterControls}
      </aside>

      {/* MOBILE: trigger "Filtri" */}
      <div className="md:hidden flex items-center justify-end">
        <button
          ref={filterTriggerRef}
          onClick={() => setFiltersOpen(true)}
          aria-label={t('filters')}
          aria-expanded={filtersOpen}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold shadow-warm-sm transition-colors ${
            activeFilters > 0
              ? 'bg-primary-700 text-white hover:bg-primary-800'
              : 'bg-white text-primary-700 border border-primary-200 hover:bg-primary-50'
          }`}
        >
          <Filter size={15} strokeWidth={2.4} className={activeFilters > 0 ? 'text-white' : 'text-primary-600'} />
          <span>{t('filters')}</span>
          {activeFilters > 0 && (
            <span className="bg-white text-primary-700 text-2xs font-extrabold rounded-full min-w-[1.1rem] px-1 py-0.5 leading-none">
              {activeFilters}
            </span>
          )}
        </button>
      </div>

      {/* MOBILE: bottom-sheet filtri */}
      {filtersOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('filters')}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setFiltersOpen(false)} />
          <div ref={sheetRef} className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl shadow-warm-lg max-h-[85vh] flex flex-col pb-safe">
            <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-cream-200 rounded-t-2xl">
              <h2 className="font-serif font-bold text-ink-900 flex items-center gap-2">
                <Filter size={16} strokeWidth={2.2} className="text-primary-600" />
                {t('filters')}
                {activeFilters > 0 && (
                  <span className="bg-primary-600 text-white text-2xs font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {activeFilters}
                  </span>
                )}
              </h2>
              <button onClick={() => setFiltersOpen(false)} aria-label={ta('close')} className="text-ink-400 hover:text-ink-700 p-1">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3">{filterControls}</div>
            <div className="border-t border-cream-200 p-3 flex gap-2">
              {activeFilters > 0 && (
                <button
                  onClick={reset}
                  className="flex-1 inline-flex items-center justify-center gap-1 border border-cream-300 text-ink-700 font-semibold py-2.5 rounded-xl"
                >
                  <RotateCcw size={14} /> {t('reset')}
                </button>
              )}
              <button
                onClick={() => setFiltersOpen(false)}
                className="flex-1 bg-primary-700 hover:bg-primary-800 text-white font-bold py-2.5 rounded-xl"
              >
                {t('showResults')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Risultati — 148: era un secondo <main> annidato nel <main> del layout. */}
      <section aria-label="Risultati" className="md:col-span-3 space-y-4">
        {/* Riga conteggio */}
        {/* 144 — vedi la pagina di ricerca: il conteggio si annuncia da solo. */}
        <p role="status" aria-live="polite" className="text-sm text-ink-500">
          {resultCount !== null ? t('countLine', { count: resultCount }) : ''}
        </p>

        {/* Chip dei filtri attivi (rimovibili) */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('activeFilters')}>
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={c.clear}
                aria-label={t('removeFilter', { label: c.label })}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 pl-3 pr-2 py-1 text-sm font-semibold text-primary-800 hover:bg-primary-100 transition-colors"
              >
                {c.label}
                <X size={14} strokeWidth={2.4} className="text-primary-700" aria-hidden />
              </button>
            ))}
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 px-2 py-1 text-sm font-semibold text-ink-500 hover:text-primary-700 transition-colors"
            >
              <RotateCcw size={13} aria-hidden /> {t('clearAll')}
            </button>
          </div>
        )}

        <ProductGrid
          {...gridProps}
          maxColumns={4}
          onCount={segnaRisultati}
          emptyTitle={t('noResultsGeneric')}
          emptyDescription={activeFilters > 0 ? t('noResultsFiltered') : CATEGORIA_ANCORA_VUOTA}
          onReset={activeFilters > 0 ? reset : undefined}
          emptySuggestions={
            <div className="mt-6 space-y-6">
              {sottocategoriePiene.length > 0 && (
                <div className="text-center">
                  <p className="mb-2 text-sm text-ink-500">{t('didYouMean')}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {sottocategoriePiene.slice(0, 6).map((s) => (
                      <Link
                        key={s.id}
                        href={`/category/${s.slug}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3.5 py-1.5 text-sm font-semibold text-primary-800 hover:bg-primary-100 transition-colors"
                      >
                        <Search size={13} strokeWidth={2.4} aria-hidden /> {s.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-cream-200 pt-5">
                <ProductGrid rail limit={12} categoryId={category.id} title={t('alsoInteresting')} sort="newest" />
              </div>
            </div>
          }
        />
      </section>
    </div>
  );
}
