'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import ProductForm, { type ProductInitialValues, type ProductPayload } from '@/components/seller/ProductForm';
import { confirmDialog } from '@/components/ConfirmDialog';
import { COLONNE_DEL_SERVIZIO, DOVE_SI_FA, MESSAGGIO_SERVIZI_NON_ANCORA_ATTIVI, mancanoLeColonneDelServizio, type DoveSiFa } from '@/lib/products/servizio';
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

/**
 * IL MODULO APERTO RESTA APERTO, CON I DATI CON CUI SI È APERTO.
 *
 * Aperta la pagina senza rete (riga e taglie in memoria), al ritorno della rete le letture
 * ripartivano e la pagina rimetteva il caricamento al posto del modulo: il modulo si smontava e
 * quello che il negoziante aveva scritto spariva. Adesso, una volta aperto, il modulo resta, e
 * resta con la riga, le taglie e la risposta sulla consegna dell'apertura: è quello che il
 * negoziante ha davanti, e il modulo confronta con quello che cosa ha cambiato lui.
 */
type Apertura = {
  id: string;
  riga: Record<string, unknown>;
  taglie: ProductVariant[];
  offre: boolean | undefined;
  consegnaNonLetta: boolean;
  /** Cambia con «Riapri con i dati aggiornati»: il modulo si rimonta con la riga di adesso. */
  volta: number;
};

/** Le colonne che il Salva rimanda sempre col valore del modulo (la scorta e il recesso no: partono solo se cambiati). */
const COLONNE_DEL_MODULO: Record<string, string> = {
  name: 'nome',
  description: 'descrizione',
  price: 'prezzo',
  compare_at_price: 'prezzo pieno',
  unit: 'unità',
  condition: 'condizione',
  category_id: 'categoria',
  images: 'foto',
  attributes: 'caratteristiche',
  tags: 'etichette',
  express_enabled: 'consegna',
  status: 'stato',
};

function normale(colonna: string, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  if ((colonna === 'price' || colonna === 'compare_at_price') && Number.isFinite(Number(v))) return Number(v);
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map((x) => normale('', x));
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, normale('', o[k])]));
  }
  return v;
}
const uguale = (colonna: string, a: unknown, b: unknown) =>
  JSON.stringify(normale(colonna, a)) === JSON.stringify(normale(colonna, b));

/** Le taglie per nome, opzioni e posto (la scorta no: quella la tengono le scorte viste). */
function firmaTaglie(taglie: ProductVariant[], conScorta = false): string {
  return JSON.stringify(taglie.map((t) => [t.id ?? null, normale('', t.options), t.label, ...(conScorta ? [t.stock] : [])]));
}

/**
 * IL SALVA SCRIVE QUELLO CHE HA CAMBIATO IL NEGOZIANTE, NON RISCRIVE QUELLO CAMBIATO ALTROVE.
 * Una colonna che da un altro telefono è cambiata mentre il modulo era aperto, e che qui il
 * negoziante non ha toccato, non parte: in banca dati resta il valore nuovo. Se l'ha cambiata
 * anche lui, vale la sua scelta.
 */
function soloQuelloCambiatoQui(
  payload: ProductPayload,
  allApertura: Record<string, unknown>,
  adesso: Record<string, unknown>,
): ProductPayload {
  const daScrivere = { ...payload } as unknown as Record<string, unknown>;
  for (const colonna of Object.keys(COLONNE_DEL_MODULO)) {
    if (!(colonna in daScrivere)) continue;
    const cambiataAltrove = !uguale(colonna, adesso[colonna], allApertura[colonna]);
    const cambiataQui = !uguale(colonna, daScrivere[colonna], allApertura[colonna]);
    if (cambiataAltrove && !cambiataQui) delete daScrivere[colonna];
  }
  return daScrivere as unknown as ProductPayload;
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
      // 27/11/2026 — Con la stessa lettura arrivano tipo, durata e «dove si fa» (migrazione 999g).
      // Prima della 999g la riga non li ha e non si aggiungono: l'annuncio resta un prodotto.
      const colonneDelServizio: Record<string, unknown> = {};
      for (const c of COLONNE_DEL_SERVIZIO) {
        if (recesso && c in (recesso as Record<string, unknown>)) colonneDelServizio[c] = (recesso as Record<string, unknown>)[c];
      }
      return {
        ...(data as Record<string, unknown>),
        ...colonneDelServizio,
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

  const { data: variantiLette, error: erroreVarianti, isLoading: variantsLoading, isFetching: varianteInLettura, isFetchedAfterMount: variantiRilette, refetch: rileggiVarianti, fetchStatus: variantiFetchStatus } = useQuery({
    queryKey: [...queryKeys.seller.product(id), 'variants'],
    queryFn: () => loadProductVariants(id),
    refetchOnMount: 'always',
  });
  const variants = variantiLette ?? [];
  const [apertura, setApertura] = useState<Apertura | null>(null);

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
      salvaTaglie,
    }: {
      payload: ProductPayload;
      variants: ProductVariant[];
      campiDallAi: string[];
      scorteViste: Record<string, number>;
      /** false: le taglie sono cambiate altrove e qui nessuno le ha toccate, quindi non si riscrivono. */
      salvaTaglie?: boolean;
    }) => {
      // Prima il controllo delle scorte delle taglie: se una è cambiata mentre il
      // modulo era aperto, non si scrive niente (prima nome e prezzo restavano
      // salvati e le varianti no).
      if (salvaTaglie !== false) await controllaScorteVariantiDalBrowser(id, nextVariants, scorteViste);
      await salvaProdottoDalBrowser({
        prodottoId: id,
        payload: payload as unknown as Record<string, unknown>,
        origine: 'venditore-modulo',
        campiDallAi,
      });
      if (salvaTaglie === false) return;
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
    // 27/11/2026 — Un servizio salvato prima della migrazione 999g: il database non ha ancora le colonne.
    onError: (err: unknown) =>
      toast.error(mancanoLeColonneDelServizio(err) ? MESSAGGIO_SERVIZI_NON_ANCORA_ATTIVI : friendlyError(err)),
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
  // Le taglie mai lette e ferme senza rete: il modulo non si apre con zero taglie che non sono vere.
  const taglieInPausa = variantiLette === undefined && variantiFetchStatus === 'paused';
  const giaAperto = apertura !== null && apertura.id === id ? apertura : null;
  // Il caricamento e gli avvisi al posto del modulo valgono solo finché il modulo non si è aperto:
  // dopo, quando la rete torna e le letture ripartono, il modulo resta dov'è.
  if (!giaAperto) {
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
    if (error || erroreVarianti || prodottoInPausa || taglieInPausa || !product) {
      // R16-020 — Una lettura caduta (rete, errore del database) non è «Prodotto non trovato»:
      // lo dice con parole semplici e offre «Riprova». «Non trovato» solo se la lettura è riuscita.
      const letturaCaduta = error ? !(error instanceof LetturaNegata) : Boolean(erroreVarianti) || prodottoInPausa || taglieInPausa;
      return (
        <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900 max-w-2xl">
          <p className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> Errore</p>
          <p className="text-sm mb-3">
            {error instanceof LetturaNegata
              ? error.message
              : error || prodottoInPausa
                ? 'Non riesco a leggere il prodotto: controlla la connessione e riprova.'
                : erroreVarianti || taglieInPausa
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
  }

  // Il modulo si apre adesso (e da qui in poi resta), oppure è già aperto: con i dati dell'apertura.
  const modulo: Apertura = giaAperto ?? {
    id,
    riga: product as Record<string, unknown>,
    taglie: variants,
    offre: offersExpress,
    consegnaNonLetta,
    volta: 0,
  };
  if (!giaAperto) setApertura(modulo);

  /**
   * IL SALVA ASPETTA LA RIGA E LE TAGLIE RILETTE.
   * Il modulo aperto senza rete parte dalla copia in memoria: finché la rilettura non è riuscita
   * (ferma senza rete, in volo, caduta) il Salva non scrive niente, lo dice, e il testo resta.
   */
  const rigaNonRiletta = prodottoFetchStatus === 'paused' || (prodottoInLettura && !prodottoRiletto) || Boolean(error) || !product;
  const taglieNonRilette = variantiFetchStatus === 'paused' || (varianteInLettura && !variantiRilette) || Boolean(erroreVarianti);
  const senzaRete = prodottoFetchStatus === 'paused' || variantiFetchStatus === 'paused';
  const motivoDelSalvaFermo = !rigaNonRiletta && !taglieNonRilette
    ? null
    : senzaRete
      ? 'Senza rete non posso salvare: quello che hai scritto resta qui, salva quando torna la connessione.'
      : (prodottoInLettura && !prodottoRiletto) || (varianteInLettura && !variantiRilette)
        ? 'Sto rileggendo il prodotto: salva fra un momento, quello che hai scritto resta qui.'
        : product === null
          ? 'Non trovo più questo prodotto: forse è stato tolto da un altro telefono. Non salvo niente.'
          : 'Non riesco a rileggere il prodotto e le sue taglie: non salvo niente finché non ci riesco. Quello che hai scritto resta qui.';
  const rilettureCadute = Boolean(error) || Boolean(erroreVarianti);

  // Cosa è cambiato altrove mentre il modulo era aperto (solo con la riga riletta, e non dopo il proprio Salva).
  const adesso = !rigaNonRiletta && product ? (product as Record<string, unknown>) : null;
  const taglieCambiateAltrove = !taglieNonRilette && firmaTaglie(variants) !== firmaTaglie(modulo.taglie);
  const cambiatiAltrove = adesso && !update.isPending && !update.isSuccess
    ? [
        ...Object.entries(COLONNE_DEL_MODULO).filter(([c]) => !uguale(c, adesso[c], modulo.riga[c])).map(([, nome]) => nome),
        ...(adesso.non_recedibile !== modulo.riga.non_recedibile ? ['escluso dal recesso'] : []),
        ...(taglieCambiateAltrove ? ['taglie'] : []),
      ]
    : [];
  const riapri = () => {
    if (!product) return;
    setApertura({ id, riga: product as Record<string, unknown>, taglie: variants, offre: offersExpress, consegnaNonLetta, volta: modulo.volta + 1 });
  };

  const riga = modulo.riga;
  const attrs = (riga.attributes as Record<string, unknown>) ?? {};
  const legacyStato = typeof attrs.stato === 'string' ? attrs.stato : '';
  const initialValues: ProductInitialValues = {
    name: (riga.name as string) ?? '',
    description: (riga.description as string) ?? '',
    price: (riga.price as number) ?? undefined,
    compareAtPrice: (riga.compare_at_price as number) ?? undefined,
    unit: ((riga.unit as ProductUnit) ?? 'pezzo'),
    condition: ((riga.condition as ProductCondition) ?? (normalizeCondition(legacyStato) || null)),
    stock: (riga.stock as number | null) ?? null,
    category_id: (riga.category_id as string) ?? '',
    images: Array.isArray(riga.images) ? (riga.images as string[]) : [],
    attributes: attrs,
    tags: Array.isArray(riga.tags) ? (riga.tags as string[]) : [],
    expressEnabled: (riga.express_enabled as boolean | null) ?? null,
    status: (riga.status as string) ?? 'available',
    variants: modulo.taglie,
    nonRecedibile: riga.non_recedibile === true,
    tipo: riga.tipo === 'servizio' ? 'servizio' : 'prodotto',
    durataMinuti: typeof riga.durata_minuti === 'number' ? riga.durata_minuti : null,
    doveServizio: (DOVE_SI_FA as readonly unknown[]).includes(riga.dove_servizio) ? (riga.dove_servizio as DoveSiFa) : null,
  };
  // La spunta «escluso dal recesso»: la porta unica PATCH /api/seller/products/:id
  // la tiene (COLONNA_DEL_RECESSO in lib/products/salvataggio-tracciato.ts), e si
  // mostra solo se la banca dati ha la colonna (migrazione 180).
  const recessoSegnabile = riga[RECESSO_SEGNABILE] === true;


  const status = riga.status as string;

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

      {motivoDelSalvaFermo && (
        <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">
          <p className="flex items-center gap-1.5"><AlertTriangle size={16} aria-hidden /> {motivoDelSalvaFermo}</p>
          {rilettureCadute && (
            <button type="button" onClick={() => { void rileggiProdotto(); void rileggiVarianti(); }} className="mt-2 font-semibold text-amber-800 underline">
              Riprova
            </button>
          )}
        </div>
      )}
      {cambiatiAltrove.length > 0 && (
        <div role="status" className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">
          <p>
            Mentre il modulo era aperto questo prodotto è cambiato da un&apos;altra parte ({cambiatiAltrove.join(', ')}).
            Qui vedi ancora i valori di prima: salvando scrivo solo quello che cambi tu, e quei cambi restano.
            {taglieCambiateAltrove && ' Per cambiare le taglie, prima riapri il modulo.'}
          </p>
          <button type="button" onClick={riapri} className="mt-2 font-semibold text-amber-800 underline">
            Riapri con i dati aggiornati (perdi quello che non hai salvato)
          </button>
        </div>
      )}

      <ProductForm
        key={modulo.volta}
        mode="edit"
        categories={categories}
        initialValues={initialValues}
        submitting={update.isPending}
        deleteLabel="Nascondi prodotto"
        deleting={nascondiIlProdotto.isPending}
        productId={id}
        recessoSegnabile={recessoSegnabile}
        sellerOffersExpress={modulo.offre}
        consegnaDelNegozioNonLetta={modulo.consegnaNonLetta}
        onSubmit={(payload, ctx) => {
          if (motivoDelSalvaFermo) {
            toast.error(motivoDelSalvaFermo);
            return;
          }
          const fresca = product as Record<string, unknown>;
          const daScrivere = soloQuelloCambiatoQui(payload, modulo.riga, fresca);
          const taglieToccateQui = firmaTaglie(ctx.variants, true) !== firmaTaglie(modulo.taglie, true);
          // Le taglie cambiate altrove: se qui nessuno le ha toccate non si riscrivono; se le ha
          // toccate anche il negoziante (o cambia la scorta di un prodotto che adesso ha le taglie),
          // salvando cancellerebbe quei cambi: non si salva e si chiede di riaprire.
          if (taglieCambiateAltrove && (taglieToccateQui || ('stock' in daScrivere && variants.length > 0))) {
            toast.error('Le taglie di questo prodotto sono cambiate da un\'altra parte: per non cancellare quei cambi non salvo. Riapri il modulo con i dati aggiornati.');
            return;
          }
          update.mutate({
            payload: daScrivere,
            variants: ctx.variants,
            campiDallAi: ctx.campiDallAi,
            scorteViste: ctx.scorteViste,
            ...(taglieCambiateAltrove ? { salvaTaglie: false } : {}),
          });
        }}
        onDelete={async () => {
          const ok = await confirmDialog({
            title: 'Nascondere il prodotto?',
            message: `"${riga.name as string}" sparisce dalla vetrina e va fra le bozze. Resta negli ordini già fatti, con le sue recensioni: puoi rimetterlo in vendita quando vuoi.`,
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
