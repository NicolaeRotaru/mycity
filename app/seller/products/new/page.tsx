'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import ProductForm, { type ProductInitialValues, type ProductPayload } from '@/components/seller/ProductForm';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import ImportFromUrlBox, { type ImportResult } from '@/components/products/ImportFromUrlBox';
import BulkPhotoCreate from '@/components/seller/BulkPhotoCreate';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { DOVE_SI_FA, MESSAGGIO_SERVIZI_NON_ANCORA_ATTIVI, mancanoLeColonneDelServizio, type DoveSiFa } from '@/lib/products/servizio';
import { queryKeys } from '@/lib/queries/keys';
import { AI_NEGOZI_ACCESA } from '@/lib/funzioni-al-lancio';
import { colonnaDelRecessoPresente } from '@/lib/ordini/recesso';
import { useConsegnaVeloceDelNegozio } from '@/lib/queries/consegna-veloce-del-negozio';
import { trackProductPublished } from '@/lib/analytics/events';
import { loadAutosave, clearAutosave } from '@/lib/hooks/useFormAutosave';
import type { ProductUnit, ProductCondition } from '@/lib/products/schema';
import { type ProductVariant } from '@/lib/products/variants';
import { saveProductVariants, loadProductVariants } from '@/lib/products/persistVariants';

const AUTOSAVE_KEY = 'mc_new_product_draft';

type Category = { id: string; name: string; slug: string; parent_id: string | null };

type Snapshot = {
  name?: string;
  description?: string;
  price?: number | string;
  compareAtPrice?: number | string;
  stock?: number | string;
  category_id?: string;
  imageUrls?: string[];
  attributes?: Record<string, unknown>;
  tags?: string[];
  unit?: ProductUnit;
  condition?: ProductCondition | '';
  fastDelivery?: boolean;
  unlimitedStock?: boolean;
};

function snapshotToInitial(s: Snapshot): ProductInitialValues | undefined {
  // Ripristina solo se c'è contenuto significativo.
  if (!s || (!s.name && !s.description && !(s.imageUrls?.length))) return undefined;
  return {
    name: s.name ?? '',
    description: s.description ?? '',
    price: s.price ?? undefined,
    compareAtPrice: s.compareAtPrice ?? undefined,
    unit: s.unit ?? 'pezzo',
    condition: (s.condition || null) as ProductCondition | null,
    stock: s.unlimitedStock ? null : (s.stock != null && s.stock !== '' ? Number(s.stock) : undefined),
    category_id: s.category_id ?? '',
    images: Array.isArray(s.imageUrls) ? s.imageUrls : [],
    attributes: s.attributes ?? {},
    tags: Array.isArray(s.tags) ? s.tags : [],
    expressEnabled: s.fastDelivery ?? null,
    status: 'available',
  };
}

function NewProductInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromId = searchParams.get('from');
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [importNonce, setImportNonce] = useState(0);

  // R16-021 — Il ripiego `= []` faceva passare una lettura caduta per «non ci sono categorie»:
  // il modulo chiedeva di sceglierne una che non c'era. Come in «Modifica prodotto», senza
  // categorie il modulo non si apre e la pagina lo dice con «Riprova».
  const { data: categories = [], isError: categorieNonLette, isLoading: categorieInLettura, isPending: categorieSenzaDati, fetchStatus: categorieFetchStatus, refetch: rileggiCategorie } = useQuery({
    queryKey: queryKeys.categories.form,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, parent_id')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  /**
   * 31/10/2026 — LA SPUNTA «ESCLUSO DAL RECESSO» SOLO SE LA BANCA DATI LA SA SALVARE.
   * Prima della migrazione 180 la colonna non c'e': un prodotto nuovo con la
   * spunta non si salvava (PostgREST rifiuta la colonna, PGRST204). Si guarda
   * una riga qualsiasi letta con `*` (i tipi del database non conoscono ancora
   * la colonna): se c'e' `non_recedibile` la spunta compare, se no resta nascosta
   * e il prodotto si salva come sempre.
   *
   * 12/11/2026 (R10-004) — Una lettura caduta NON vale piu' «no»: prima `return false` con
   * `staleTime: Infinity` teneva il «no» in memoria per tutta la sessione, e la spunta
   * spariva fino al ricaricamento. Ora l'errore si lancia: React Query riprova, la spunta
   * resta nascosta solo finche' non si sa (il ripiego `= false` qui sotto), e la risposta
   * vera si rilegge dopo qualche minuto.
   */
  const { data: recessoSegnabile = false } = useQuery({
    queryKey: ['products', 'colonna-del-recesso'],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.from('products').select('*').limit(1).maybeSingle();
      if (error) throw error;
      return colonnaDelRecessoPresente(data);
    },
    staleTime: 5 * 60_000,
  });

  /**
   * 6/9/2026 — QUESTA PAGINA E «MODIFICA PRODOTTO» ERANO DUE STRADE PER LA
   * STESSA DOMANDA.
   *
   * Stessa riga di cache, due funzioni scritte a mano: qui la sessione non
   * ancora pronta valeva «il negozio non offre la consegna veloce», e quel «no»
   * finiva in cache buono per tutti. Poi il negoziante apriva la modifica di un
   * prodotto e si ritrovava il consiglio di attivare una cosa che ha già
   * attiva. Adesso la funzione è una sola, in
   * `lib/queries/consegna-veloce-del-negozio`.
   */
  const {
    offre: offersExpress,
    inLettura: consegnaInLettura,
    nonLetta: consegnaNonLetta,
  } = useConsegnaVeloceDelNegozio();

  // Duplica: precarica da un prodotto esistente (?from=ID).
  const { data: source, isLoading: loadingSource, isError: sorgenteNonLetta, fetchStatus: sorgenteFetchStatus, isFetching: sorgenteInLettura, isFetchedAfterMount: sorgenteRiletta, refetch: rileggiSorgente } = useQuery({
    queryKey: ['duplicate-source', fromId],
    enabled: !!fromId,
    // R14-012: la sorgente si rilegge a ogni apertura: una copia in memoria di pochi secondi prima
    // (i 30 s del sito) può avere la spunta del recesso di prima.
    staleTime: 0,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('products')
        .select('*') // con `*` arriva anche non_recedibile, quando la colonna c'è (migrazione 180)
        .eq('id', fromId)
        .single();
      if (error) throw error;
      if ((data as { seller_id?: string }).seller_id && (data as { seller_id?: string }).seller_id !== user.id) {
        throw new Error('Non puoi duplicare un prodotto che non è tuo');
      }
      return data as Record<string, unknown>;
    },
  });

  // Duplica: carica anche le varianti del prodotto sorgente (id azzerati → nuove).
  // Senza le taglie lette la copia non si apre: nascerebbe senza, e nessuno lo direbbe.
  const { data: taglieLette, isLoading: loadingVariants, isError: variantiNonLette, fetchStatus: taglieFetchStatus, isFetching: taglieInLettura, isFetchedAfterMount: taglieRilette, refetch: rileggiVarianti } = useQuery({
    queryKey: ['duplicate-variants', fromId],
    enabled: !!fromId,
    // R14-012: come la sorgente, le taglie si rileggono a ogni apertura.
    staleTime: 0,
    queryFn: () => loadProductVariants(fromId!),
  });
  const sourceVariants = useMemo(() => taglieLette ?? [], [taglieLette]);
  // Le taglie mai lette e ferme senza rete: la copia non si apre con zero taglie che non sono vere.
  const taglieNonArrivate = !!fromId && taglieLette === undefined && (variantiNonLette || taglieFetchStatus === 'paused');
  // Senza il prodotto da duplicare (lettura caduta, o in pausa senza rete) il modulo non si apre
  // vuoto come un prodotto nuovo: si dice, con «Riprova», e si apre pieno quando la lettura riesce.
  const sorgenteNonArrivata = !!fromId && !source && (sorgenteNonLetta || sorgenteFetchStatus === 'paused');
  /**
   * 20/11/2026 (S01-002) — LA COPIA DI UN PRODOTTO ESCLUSO DAL RECESSO NON NASCE RECEDIBILE IN SILENZIO.
   * La spunta (e il suo salvataggio) aspettava la lettura a parte della colonna: finche' quella non
   * rispondeva (in volo, caduta, senza rete) valeva «no», e la copia di un pane escluso dal recesso
   * si salvava recedibile, senza spunta a video e senza avviso. In «Duplica» la risposta c'e' gia':
   * il prodotto da duplicare e' letto con `*`, e se ha `non_recedibile` la colonna c'e'. Il modulo si
   * apre solo con la sorgente arrivata, quindi quando si apre lo sa sempre.
   */
  const recessoSegnabileQui = recessoSegnabile || (!!fromId && colonnaDelRecessoPresente(source));

  const initialValues: ProductInitialValues | undefined = useMemo(() => {
    if (imported) {
      return {
        name: imported.name,
        description: imported.description,
        price: imported.suggested_price ?? undefined,
        unit: 'pezzo',
        condition: null,
        stock: 1,
        category_id: imported.subcategory_id ?? imported.category_id ?? '',
        images: imported.image_urls,
        attributes: imported.attributes,
        tags: imported.tags,
        expressEnabled: null,
        status: 'available',
      };
    }
    if (fromId) {
      if (!source) return undefined;
      const s = source;
      return {
        name: s.name ? `${s.name as string} (copia)` : '',
        description: (s.description as string) ?? '',
        price: (s.price as number) ?? undefined,
        compareAtPrice: (s.compare_at_price as number) ?? undefined,
        unit: ((s.unit as ProductUnit) ?? 'pezzo'),
        condition: (s.condition as ProductCondition) ?? null,
        stock: (s.stock as number | null) ?? undefined,
        category_id: (s.category_id as string) ?? '',
        images: Array.isArray(s.images) ? (s.images as string[]) : [],
        attributes: (s.attributes as Record<string, unknown>) ?? {},
        tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
        expressEnabled: (s.express_enabled as boolean | null) ?? null,
        status: 'draft',
        variants: sourceVariants.map((v) => ({ ...v, id: undefined })),
        // «Escluso dal recesso» si copia: la copia di un pane non diventa recedibile.
        nonRecedibile: s.non_recedibile === true,
        // 27/11/2026 — La copia di un servizio resta un servizio (999g; prima della 999g `tipo` non c'è).
        tipo: s.tipo === 'servizio' ? 'servizio' : 'prodotto',
        durataMinuti: typeof s.durata_minuti === 'number' ? s.durata_minuti : null,
        doveServizio: (DOVE_SI_FA as readonly unknown[]).includes(s.dove_servizio) ? (s.dove_servizio as DoveSiFa) : null,
      };
    }
    return snapshotToInitial(loadAutosave<Snapshot>(AUTOSAVE_KEY) ?? {});
  }, [imported, fromId, source, sourceVariants]);

  /**
   * IL MODULO APERTO RESTA APERTO QUANDO TORNA LA RETE.
   * Aperta la pagina senza rete, al ritorno della rete le letture ripartivano (la consegna del
   * negozio, la copia da duplicare) e la pagina rimetteva il caricamento al posto del modulo: il
   * modulo si smontava e quello che il negoziante aveva scritto spariva. Adesso, aperto per un
   * prodotto (nuovo, o la copia di `from`), il modulo resta finché la pagina non passa a un altro;
   * e resta con la risposta sulla consegna dell'apertura: una consegna non letta all'apertura non
   * diventa un «no» indovinato solo perché la risposta arriva dopo.
   */
  const chiaveDelModulo = fromId ?? '';
  const [aperto, setAperto] = useState<{ per: string; offre: boolean | undefined; consegnaNonLetta: boolean; taglie: string; sorgente: string; volta: number } | null>(null);
  const giaAperto = aperto !== null && aperto.per === chiaveDelModulo ? aperto : null;
  const caricamento = (fromId && (loadingSource || loadingVariants || (sorgenteInLettura && !sorgenteRiletta) || (taglieInLettura && !taglieRilette))) || consegnaInLettura || categorieInLettura;
  const categorieMancanti = (categorieNonLette || (categorieSenzaDati && categorieFetchStatus === 'paused')) && categories.length === 0;
  const moduloPronto = !caricamento && !categorieMancanti && !sorgenteNonArrivata && !taglieNonArrivate;
  const firmaDelleTaglie = fromId && Array.isArray(sourceVariants) ? JSON.stringify(sourceVariants.map((v) => [v.id ?? null, v.options, v.label])) : '';
  // R14-012: come le taglie, anche la spunta del recesso e gli altri valori della sorgente il modulo li legge
  // solo all'apertura: aperta sulla sorgente della memoria (rilettura caduta, senza rete), si confrontano.
  const firmaDellaSorgente = fromId && source ? JSON.stringify({ ...initialValues, variants: undefined }) : '';
  if (!giaAperto && moduloPronto) setAperto({ per: chiaveDelModulo, offre: offersExpress, consegnaNonLetta, taglie: firmaDelleTaglie, sorgente: firmaDellaSorgente, volta: 0 });
  const consegnaDelModulo = giaAperto ?? { offre: offersExpress, consegnaNonLetta };
  /**
   * LA COPIA APERTA SENZA RETE NON NASCE SULLE TAGLIE DELLA MEMORIA.
   * Finché il prodotto da duplicare e le sue taglie non sono riletti (fermi senza rete, in volo,
   * caduti) la copia non si salva, e lo dice; se le taglie rilette non sono quelle con cui la copia
   * si è aperta, non si salva finché non la si riapre con quelle vere. Il testo resta nel modulo.
   */
  const copiaNonRiletta = !!fromId && (
    sorgenteFetchStatus === 'paused' || taglieFetchStatus === 'paused'
    || (sorgenteInLettura && !sorgenteRiletta) || (taglieInLettura && !taglieRilette)
    || sorgenteNonLetta || variantiNonLette
  );
  const taglieDellaCopiaCambiate = !!fromId && !copiaNonRiletta && giaAperto !== null && giaAperto.taglie !== firmaDelleTaglie;
  const sorgenteDellaCopiaCambiata = !!fromId && !copiaNonRiletta && giaAperto !== null && giaAperto.sorgente !== firmaDellaSorgente;
  const copiaFerma = copiaNonRiletta
    ? sorgenteFetchStatus === 'paused' || taglieFetchStatus === 'paused'
      ? 'Senza rete non posso salvare la copia: quello che hai scritto resta qui, salva quando torna la connessione.'
      : sorgenteNonLetta || variantiNonLette
        ? 'Non riesco a rileggere il prodotto da duplicare e le sue taglie: la copia non si salva finché non ci riesco. Quello che hai scritto resta qui.'
        : 'Sto rileggendo il prodotto da duplicare: salva fra un momento, quello che hai scritto resta qui.'
    : taglieDellaCopiaCambiate
      ? 'Le taglie del prodotto da duplicare sono cambiate da quando hai aperto la copia: riaprila con le taglie aggiornate prima di salvare.'
      : sorgenteDellaCopiaCambiata
        ? 'Il prodotto da duplicare è cambiato da quando hai aperto la copia (per esempio la spunta «escluso dal recesso»): riaprila con i dati aggiornati prima di salvare.'
        : null;

  // Dopo un inserimento riuscito il modulo resta chiuso fino al cambio di pagina: `create.isPending`
  // torna falso prima che router.push porti via, e un clic in quel momento creava un secondo prodotto.
  const [creato, setCreato] = useState(false);

  const create = useMutation({
    mutationFn: async ({ payload, variants }: { payload: ProductPayload; variants: ProductVariant[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const external = imported
        ? {
            external_source_url: imported.external.source_url,
            external_marketplace: imported.external.marketplace,
            external_data: {
              price: imported.external.price,
              currency: imported.external.currency,
              delivery_min_days: imported.external.delivery_min_days,
              delivery_max_days: imported.external.delivery_max_days,
              delivery_label: imported.external.delivery_label,
              availability: imported.external.availability,
              source_title: imported.external.source_title,
              fetched_at: imported.external.fetched_at,
            },
            external_synced_at: new Date().toISOString(),
          }
        : {};
      const { data, error } = await supabase
        .from('products')
        .insert({ ...payload, seller_id: user.id, ...external })
        .select('id')
        .single();
      if (error) throw error;
      if (variants.length > 0) {
        try {
          await saveProductVariants(data.id as string, variants);
        } catch (errore) {
          // Il prodotto esiste già: un secondo «Salva» ne creerebbe un altro.
          throw new TaglieNonSalvate(data.id as string, errore);
        }
      }
      return { id: data.id as string, sellerId: user.id, status: payload.status };
    },
    onSuccess: ({ id, sellerId, status }) => {
      setCreato(true);
      clearAutosave(AUTOSAVE_KEY);
      if (status === 'available') trackProductPublished(id, sellerId);
      toast.success(status === 'draft' ? 'Bozza salvata' : 'Prodotto pubblicato!');
      router.push('/seller/products');
    },
    onError: (err: unknown) => {
      if (err instanceof TaglieNonSalvate) {
        // Il prodotto esiste già: anche qui il modulo resta chiuso fino alla pagina della modifica.
        setCreato(true);
        clearAutosave(AUTOSAVE_KEY);
        toast.error(`Il prodotto è stato creato, ma le taglie no (${friendlyError(err.causa)}). Aggiungile qui dalla modifica.`);
        router.push(`/seller/products/${err.prodottoId}/edit`);
        return;
      }
      // 27/11/2026 — Un servizio salvato prima della migrazione 999g: il database non ha ancora le colonne.
      if (mancanoLeColonneDelServizio(err)) {
        toast.error(MESSAGGIO_SERVIZI_NON_ANCORA_ATTIVI);
        return;
      }
      toast.error(friendlyError(err));
    },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <SellerPageTitle
        eyebrow="Catalogo"
        title={fromId ? 'Duplica prodotto' : 'Nuovo prodotto'}
        sub={fromId
          ? 'Parti da una copia e modifica quello che serve.'
          : AI_NEGOZI_ACCESA
            ? 'Compila la scheda — o lascia che l\'AI la prepari per te da foto, voce o link.'
            : 'Compila la scheda: nome, foto, prezzo e descrizione.'}
        className="mb-0"
      />

      {/* AI spenta al lancio (carta #209): niente creazione da foto né da link. */}
      {!fromId && AI_NEGOZI_ACCESA && (
        <>
          <BulkPhotoCreate onCreated={() => router.push('/seller/products')} />
          <ImportFromUrlBox
            onImported={(data) => {
              setImported(data);
              setImportNonce((n) => n + 1);
            }}
          />
        </>
      )}

      {giaAperto || moduloPronto ? null : caricamento ? (
        <LoadingState />
      ) : categorieMancanti ? (
        <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900">
          <p className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> Non riesco a leggere le categorie</p>
          <p className="text-sm mb-3">
            Senza l&apos;elenco delle categorie non puoi scegliere dove mettere il prodotto. Riprova fra un momento.
          </p>
          <button type="button" onClick={() => { void rileggiCategorie(); }} className="text-sm font-semibold text-rose-700 underline">
            Riprova
          </button>
        </div>
      ) : sorgenteNonArrivata ? (
        <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900">
          <p className="font-bold mb-1">Non riesco a caricare il prodotto da duplicare</p>
          <p className="text-sm mb-3">Senza il prodotto la copia partirebbe vuota. Riprova fra un momento.</p>
          <button type="button" onClick={() => { void rileggiSorgente(); }} className="text-sm font-semibold text-rose-700 underline">Riprova</button>
        </div>
      ) : taglieNonArrivate ? (
        <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900">
          <p className="font-bold mb-1">Non riesco a leggere le taglie del prodotto da duplicare</p>
          <p className="text-sm mb-3">La copia nascerebbe senza taglie. Riprova fra un momento.</p>
          <button type="button" onClick={() => { void rileggiVarianti(); }} className="text-sm font-semibold text-rose-700 underline">Riprova</button>
        </div>
      ) : null}
      {(giaAperto || moduloPronto) && copiaFerma && (
        <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">
          <p className="flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> {copiaFerma}</p>
          {(sorgenteNonLetta || variantiNonLette) && (
            <button type="button" onClick={() => { void rileggiSorgente(); void rileggiVarianti(); }} className="mt-2 font-semibold text-amber-800 underline">
              Riprova
            </button>
          )}
          {(taglieDellaCopiaCambiate || sorgenteDellaCopiaCambiata) && giaAperto && (
            <button
              type="button"
              onClick={() => setAperto({ ...giaAperto, taglie: firmaDelleTaglie, sorgente: firmaDellaSorgente, volta: giaAperto.volta + 1 })}
              className="mt-2 font-semibold text-amber-800 underline"
            >
              {taglieDellaCopiaCambiate ? 'Riapri la copia con le taglie aggiornate' : 'Riapri la copia con i dati aggiornati'} (perdi quello che non hai salvato)
            </button>
          )}
        </div>
      )}
      {(giaAperto || moduloPronto) && (
        <ProductForm
          key={`${chiaveDelModulo}:${importNonce}:${giaAperto?.volta ?? 0}`}
          mode="create"
          categories={categories}
          initialValues={initialValues}
          submitting={create.isPending || creato}
          sellerOffersExpress={consegnaDelModulo.offre}
          consegnaDelNegozioNonLetta={consegnaDelModulo.consegnaNonLetta}
          recessoSegnabile={recessoSegnabileQui}
          autosaveKey={fromId ? undefined : AUTOSAVE_KEY}
          // R01-012 — l'invio finisce quando finisce l'inserimento: fino ad allora il modulo
          // non ne fa partire un altro (l'errore lo dice già `onError` della mutazione).
          onSubmit={(payload, ctx) => {
            if (copiaFerma) {
              toast.error(copiaFerma);
              return;
            }
            return create.mutateAsync({ payload, variants: ctx.variants }).catch(() => undefined);
          }}
          onDiscard={async () => {
            const ok = await confirmDialog({
              title: 'Eliminare questo prodotto?',
              message: 'I dati inseriti per questo nuovo prodotto verranno persi.',
              confirmLabel: 'Sì, elimina',
              danger: true,
              icon: Trash2,
            });
            if (!ok) return;
            clearAutosave(AUTOSAVE_KEY);
            router.push('/seller/products');
          }}
        />
      )}
    </div>
  );
}

/** L'inserimento è riuscito, le taglie no: si va alla modifica del prodotto creato. */
class TaglieNonSalvate extends Error {
  constructor(readonly prodottoId: string, readonly causa: unknown) {
    super('Taglie non salvate');
    this.name = 'TaglieNonSalvate';
  }
}

export default function NewProductPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <NewProductInner />
    </Suspense>
  );
}
