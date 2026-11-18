'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import ProductForm, { type ProductInitialValues, type ProductPayload } from '@/components/seller/ProductForm';
import { confirmDialog } from '@/components/ConfirmDialog';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { useConsegnaVeloceDelNegozio } from '@/lib/queries/consegna-veloce-del-negozio';
import { normalizeCondition, type ProductCondition, type ProductUnit } from '@/lib/products/schema';
import { type ProductVariant } from '@/lib/products/variants';
import { controllaScorteVariantiDalBrowser, loadProductVariants, saveProductVariants } from '@/lib/products/persistVariants';
import { AlertTriangle, EyeOff } from 'lucide-react';
import { nascondiProdottoTracciato, salvaProdottoDalBrowser } from '@/lib/products/salva-dal-browser';
import { colonnaDelRecessoPresente } from '@/lib/ordini/recesso';

/** Campo interno della lettura: la banca dati ha gia' la colonna del recesso? */
const RECESSO_SEGNABILE = '__recessoSegnabile';

type Category = { id: string; name: string; slug: string; parent_id: string | null };

/** R16-020 — Un no detto dalla pagina stessa (non collegato, prodotto di un altro negozio): riprovare non serve. */
class LetturaNegata extends Error {}

/**
 * R16-004 — IL PRODOTTO COM'ERA, PER I CAMPI CHE IL SALVATAGGIO HA SCRITTO.
 * Se le varianti cadono dopo che il prodotto è già scritto, la pagina rimanda
 * questi valori (letti all'apertura) e il salvataggio resta tutto o niente.
 * La scorta torna indietro solo se in banca dati c'è ancora quella appena
 * scritta: una vendita arrivata nel frattempo non si cancella.
 */
function comEraPrima(prima: Record<string, unknown>, payload: Record<string, unknown>): Record<string, unknown> {
  const indietro: Record<string, unknown> = {};
  for (const colonna of Object.keys(payload)) {
    if (colonna === 'stock_visto' || colonna === 'stock_confermato') continue;
    indietro[colonna] = prima[colonna];
  }
  if (typeof payload.stock === 'number') indietro.stock_visto = payload.stock;
  return indietro;
}

export default function EditProductPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const qc = useQueryClient();

  const { data: product, isLoading, error, isFetching: prodottoInLettura, isFetchedAfterMount: prodottoRiletto, refetch: rileggiProdotto, fetchStatus: prodottoFetchStatus } = useQuery({
    queryKey: queryKeys.seller.product(id),
    queryFn: async () => {
      const { data: { user }, error: erroreUtente } = await supabase.auth.getUser();
      // R16-020 — Senza rete getUser risponde con un errore: è una lettura caduta (con «Riprova»),
      // non «Non autenticato». Solo la sessione davvero mancante dice «Non autenticato».
      if (erroreUtente && (erroreUtente as { name?: string }).name !== 'AuthSessionMissingError') throw erroreUtente;
      if (!user) throw new LetturaNegata('Non autenticato');
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, compare_at_price, unit, condition, stock, category_id, images, attributes, tags, express_enabled, seller_id, status')
        .eq('id', id)
        .single();
      // R16-020 — Solo «nessuna riga» (PGRST116) vuol dire che il prodotto non c'è: ogni altro
      // errore è una lettura caduta, e la pagina offre «Riprova» invece di «Prodotto non trovato».
      if (error) {
        if ((error as { code?: string }).code === 'PGRST116') return null;
        throw error;
      }
      if ((data as { seller_id?: string }).seller_id !== user.id) {
        throw new LetturaNegata('Non puoi modificare un prodotto che non è tuo');
      }
      // 31/10/2026 — «Escluso dal recesso» (migrazione 180) si legge a parte, con `*`:
      // prima della 180 la colonna non c'e', la riga arriva senza e la spunta resta
      // vuota; il modulo la manda solo se il negoziante la cambia. Con i tipi
      // rigenerati (lib/database.types.ts) la colonna puo' entrare nella lettura qui sopra.
      // Se questa lettura cade il modulo non si apre: aperto, nasconderebbe la spunta
      // e il negoziante non vedrebbe che il prodotto è escluso dal recesso.
      const { data: recesso, error: erroreRecesso } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (erroreRecesso) throw erroreRecesso;
      const nonRecedibile = (recesso as { non_recedibile?: unknown } | null)?.non_recedibile === true;
      // La spunta compare solo se la colonna c'e' davvero (dopo la 180): se no
      // il salvataggio la manderebbe a una colonna che non esiste.
      return {
        ...(data as Record<string, unknown>),
        non_recedibile: nonRecedibile,
        [RECESSO_SEGNABILE]: colonnaDelRecessoPresente(recesso),
      } as Record<string, unknown>;
    },
    // 31/10/2026 — IL MODULO SI APRE SOLO CON LA SCORTA DELLA BANCA DATI.
    // Il modulo tiene la scorta vista all'apertura e la manda accanto a quella
    // nuova: se partisse dalla copia in memoria (letta minuti prima, prima di
    // una vendita) ogni «Salva» direbbe «la scorta e' cambiata», anche dopo
    // aver riaperto il prodotto come chiede il messaggio. Si rilegge sempre,
    // e il modulo aspetta che quella lettura finisca (sotto, prima del modulo).
    refetchOnMount: 'always',
  });

  const { data: variants = [], error: erroreVarianti, isLoading: variantsLoading, isFetching: varianteInLettura, isFetchedAfterMount: variantiRilette, refetch: rileggiVarianti } = useQuery({
    queryKey: [...queryKeys.seller.product(id), 'variants'],
    queryFn: () => loadProductVariants(id),
    refetchOnMount: 'always',
  });

  // Il ripiego `= []` faceva passare una lettura caduta per «non ci sono
  // categorie»: il prodotto sembrava averla persa. Senza categorie il modulo
  // non si apre, e la pagina lo dice con «Riprova».
  const { data: categories = [], isError: categorieNonLette, isLoading: categorieInLettura, isPending: categorieSenzaDati, fetchStatus: categorieFetchStatus, refetch: rileggiCategorie } = useQuery({
    queryKey: queryKeys.categories.form,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from('categories').select('id, name, slug, parent_id').order('name');
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  /**
   * 6/9/2026 — UNA LETTURA CHE NON RIESCE NON SCRIVE PIÙ UN «NO» DEFINITIVO.
   *
   * Il valore di ripiego era `false`, e nessuno guardava se la lettura fosse
   * andata a buon fine. Con la rete lenta o la sessione non ancora pronta, il
   * modulo si apriva dicendo «Spedizione 2-3 giorni» e avvisando il negoziante
   * di attivare la consegna veloce dal profilo — cosa che lui aveva già fatto.
   * Il guaio grosso però era al salvataggio: un prodotto che ereditava la
   * consegna veloce dal negozio (`express_enabled` a NULL) usciva da lì con un
   * `false` scritto sopra, e restava escluso dalla consegna veloce anche dopo
   * che la rete era tornata. Il negoziante cambiava il prezzo e perdeva il
   * vantaggio commerciale, senza vedere niente.
   *
   * La domanda «il negozio offre la consegna veloce?» ha una funzione sola, in
   * `lib/queries/consegna-veloce-del-negozio`: questa pagina e «Nuovo prodotto»
   * condividono la stessa riga di cache, quindi devono condividere anche la
   * risposta.
   */
  const {
    offre: offersExpress,
    inLettura: consegnaInLettura,
    nonLetta: consegnaNonLetta,
  } = useConsegnaVeloceDelNegozio();

  /**
   * 8/9/2026 — IL SALVATAGGIO LASCIA SCRITTO CHI HA CAMBIATO COSA.
   *
   * Qui c'era `supabase.from('products').update(payload)`: la modifica andava
   * a segno e non ne restava traccia da nessuna parte. Le stesse modifiche
   * fatte dall'assistente passando dal server finivano invece nel registro con
   * il valore di prima. Due strade, una protetta e una no — e questa e' quella
   * che usano tutti.
   *
   * Adesso si passa dalla porta unica (`PATCH /api/seller/products/:id`), che
   * rilegge com'era, scrive e registra la differenza. Le varianti restano
   * dov'erano: le riallinea il trigger del database.
   */
  const update = useMutation({
    mutationFn: async ({
      payload,
      variants: nextVariants,
      campiDallAi,
      scorteViste,
    }: {
      payload: ProductPayload;
      variants: ProductVariant[];
      campiDallAi: string[];
      scorteViste: Record<string, number>;
    }) => {
      // Prima il controllo delle scorte delle taglie: se una è cambiata mentre il
      // modulo era aperto, non si scrive niente (prima nome e prezzo restavano
      // salvati e le varianti no).
      await controllaScorteVariantiDalBrowser(id, nextVariants, scorteViste);
      await salvaProdottoDalBrowser({
        prodottoId: id,
        payload: payload as unknown as Record<string, unknown>,
        origine: 'venditore-modulo',
        campiDallAi,
      });
      // Sincronizza le varianti (insert/update/delete); il trigger DB riallinea
      // products.stock e has_variants. Con le scorte viste all'apertura: una
      // variante venduta mentre il modulo era aperto non torna in magazzino.
      try {
        await saveProductVariants(id, nextVariants, scorteViste);
      } catch (errore) {
        // R16-004 — TUTTO O NIENTE: le varianti non sono passate (una taglia
        // venduta fra il controllo e la scrittura, la rete caduta), quindi nome,
        // prezzo e il resto tornano com'erano all'apertura, dalla stessa porta.
        try {
          await salvaProdottoDalBrowser({
            prodottoId: id,
            payload: comEraPrima(product ?? {}, payload as unknown as Record<string, unknown>),
            origine: 'venditore-modulo-annullato',
          });
        } catch {
          throw new Error(
            'Le varianti non si sono salvate, ma le altre modifiche sì e non sono riuscito ad annullarle: riapri il prodotto, controlla e salva di nuovo.',
          );
        }
        throw errore;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      qc.invalidateQueries({ queryKey: queryKeys.seller.product(id) });
      qc.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
      toast.success('Modifiche salvate');
      router.push('/seller/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  /**
   * 27/8/2026 (R029) — QUI SI NASCONDE, NON SI CANCELLA.
   *
   * Cancellare portava via anche le recensioni del prodotto (ON DELETE
   * CASCADE) e il nome di quello che il cliente aveva comprato. Il prodotto va
   * in bozza: sparisce dalla vetrina e resta nella storia degli ordini.
   */
  const nascondiIlProdotto = useMutation({
    mutationFn: async () => {
      // Dalla porta che scrive il registro (PATCH /api/seller/products/:id).
      await nascondiProdottoTracciato(id, 'venditore-modulo');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      qc.invalidateQueries({ queryKey: queryKeys.seller.product(id) });
      toast.success('Prodotto nascosto: lo trovi fra le bozze');
      router.push('/seller/products');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  // R16-020 — Senza rete la lettura va in pausa (pending + paused, ne' caricamento ne' errore):
  // non e' «Prodotto non trovato». Una query spenta (idle) non e' in pausa e non entra qui.
  const prodottoInPausa = product === undefined && prodottoFetchStatus === 'paused';
  if (isLoading || variantsLoading || (prodottoInLettura && !prodottoRiletto) || (varianteInLettura && !variantiRilette) || consegnaInLettura || categorieInLettura) return <LoadingState />;
  // R16-021 — Senza rete la lettura delle categorie e' in pausa (senza dati): stesso avviso, mai il modulo vuoto.
  if ((categorieNonLette || (categorieSenzaDati && categorieFetchStatus === 'paused')) && categories.length === 0) {
    return (
      <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900 max-w-2xl">
        <p className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> Non riesco a leggere le categorie</p>
        <p className="text-sm mb-3">
          Senza l&apos;elenco delle categorie il prodotto sembrerebbe senza categoria. Non l&apos;ha persa: riprova fra un momento.
        </p>
        <button type="button" onClick={() => { void rileggiCategorie(); }} className="text-sm font-semibold text-rose-700 underline">
          Riprova
        </button>
      </div>
    );
  }
  /**
   * 31/10/2026 — SENZA LE VARIANTI LETTE IL MODULO NON SI APRE.
   * Il ripiego `variants = []` apriva il modulo come se il prodotto non avesse
   * taglie: al «Salva» saveProductVariantsServer le cancellava tutte, e negli
   * ordini gia' fatti la riga perdeva la taglia (order_items.variant_id a NULL).
   */
  if (error || erroreVarianti || prodottoInPausa || !product) {
    // R16-020 — Una lettura caduta (rete, errore del database) non è «Prodotto non trovato»:
    // lo dice con parole semplici e offre «Riprova». «Non trovato» solo se la lettura è riuscita.
    const letturaCaduta = error ? !(error instanceof LetturaNegata) : Boolean(erroreVarianti) || prodottoInPausa;
    return (
      <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900 max-w-2xl">
        <p className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> Errore</p>
        <p className="text-sm mb-3">
          {error instanceof LetturaNegata
            ? error.message
            : error || prodottoInPausa
              ? 'Non riesco a leggere il prodotto: controlla la connessione e riprova.'
              : erroreVarianti
                ? 'Non riesco a leggere le taglie e le varianti di questo prodotto. Ricarica la pagina prima di modificarlo: salvando adesso le varianti andrebbero perse.'
                : 'Prodotto non trovato'}
        </p>
        {letturaCaduta && (
          <button type="button" onClick={() => { void rileggiProdotto(); void rileggiVarianti(); }} className="text-sm font-semibold text-rose-700 underline mr-4">
            Riprova
          </button>
        )}
        <Link href="/seller/products" className="text-sm font-semibold text-rose-700 hover:underline">
          ← Torna ai miei prodotti
        </Link>
      </div>
    );
  }

  const attrs = (product.attributes as Record<string, unknown>) ?? {};
  const legacyStato = typeof attrs.stato === 'string' ? attrs.stato : '';
  const initialValues: ProductInitialValues = {
    name: (product.name as string) ?? '',
    description: (product.description as string) ?? '',
    price: (product.price as number) ?? undefined,
    compareAtPrice: (product.compare_at_price as number) ?? undefined,
    unit: ((product.unit as ProductUnit) ?? 'pezzo'),
    condition: ((product.condition as ProductCondition) ?? (normalizeCondition(legacyStato) || null)),
    stock: (product.stock as number | null) ?? null,
    category_id: (product.category_id as string) ?? '',
    images: Array.isArray(product.images) ? (product.images as string[]) : [],
    attributes: attrs,
    tags: Array.isArray(product.tags) ? (product.tags as string[]) : [],
    expressEnabled: (product.express_enabled as boolean | null) ?? null,
    status: (product.status as string) ?? 'available',
    variants,
    nonRecedibile: product.non_recedibile === true,
  };
  // La spunta «escluso dal recesso»: la porta unica PATCH /api/seller/products/:id
  // la tiene (COLONNA_DEL_RECESSO in lib/products/salvataggio-tracciato.ts), e si
  // mostra solo se la banca dati ha la colonna (migrazione 180).
  const recessoSegnabile = product[RECESSO_SEGNABILE] === true;


  const status = product.status as string;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/seller/products" className="text-sm text-primary-700 hover:underline">← I miei prodotti</Link>
        <h1 className="text-2xl font-bold mt-1">Modifica prodotto</h1>
        {status === 'sold' && (
          <p className="text-xs text-accent-700 bg-accent-50 inline-flex items-center gap-1 px-2 py-0.5 rounded mt-1">
            <AlertTriangle size={12} strokeWidth={2.4} aria-hidden /> Segnato come esaurito — non è visibile ai clienti
          </p>
        )}
        {status === 'draft' && (
          <p className="text-xs text-ink-600 bg-cream-100 inline-flex items-center gap-1 px-2 py-0.5 rounded mt-1">
            Bozza — non è ancora visibile ai clienti
          </p>
        )}
      </div>

      <ProductForm
        mode="edit"
        categories={categories}
        initialValues={initialValues}
        submitting={update.isPending}
        deleteLabel="Nascondi prodotto"
        deleting={nascondiIlProdotto.isPending}
        productId={id}
        recessoSegnabile={recessoSegnabile}
        sellerOffersExpress={offersExpress}
        consegnaDelNegozioNonLetta={consegnaNonLetta}
        onSubmit={(payload, ctx) => update.mutate({
            payload,
            variants: ctx.variants,
            campiDallAi: ctx.campiDallAi,
            scorteViste: ctx.scorteViste,
          })}
        onDelete={async () => {
          const ok = await confirmDialog({
            title: 'Nascondere il prodotto?',
            message: `"${product.name as string}" sparisce dalla vetrina e va fra le bozze. Resta negli ordini già fatti, con le sue recensioni: puoi rimetterlo in vendita quando vuoi.`,
            confirmLabel: 'Sì, nascondi',
            danger: true,
            icon: EyeOff,
          });
          if (ok) nascondiIlProdotto.mutate();
        }}
      />
    </div>
  );
}
