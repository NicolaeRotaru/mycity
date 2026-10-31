/**
 * Salvare un prodotto lasciando scritto CHI ha cambiato COSA, e quanto valeva
 * prima.
 *
 * 8/9/2026 — LA TRACCIA ESISTEVA SU UNA STRADA SOLA.
 *
 * Le modifiche fatte dall'assistente passando dal server — «applica» nella chat
 * catalogo, il lavoro in blocco — finivano nel registro delle azioni con dentro
 * il valore precedente di ogni campo toccato (`writeAudit`, azione
 * `product.update`). Le altre no. Il modulo del prodotto nel browser scriveva
 * diritto sul catalogo (`supabase.from('products').update(payload)`), e cosi'
 * faceva anche la modifica veloce di prezzo e scorta nell'elenco: due porte che
 * cambiano un prezzo senza che resti scritto da nessuna parte ne' che l'ha
 * fatto ne' cosa c'era prima.
 *
 * Il guaio non e' teorico: la banda del 30% ferma il prezzo assurdo proposto
 * dal modello, ma il negoziante quel prezzo puo' comunque accettarlo a mano e
 * salvarlo. Quando poi in vetrina compaiono 2 € al posto di 20 €, senza traccia
 * non si sa ne' quando e' successo, ne' se il numero l'aveva scritto lui o
 * l'aveva proposto l'assistente, ne' a quanto tornare.
 *
 * La cura: le pagine del venditore che MODIFICANO un prodotto (il modulo, la
 * modifica veloce dell'elenco) passano tutte da qui — rilegge com'era, scrive,
 * e registra la differenza.
 *
 * 31/10/2026 — QUESTA PORTA NON E' L'UNICA, E NON VA DETTO CHE LO SIA. La regola
 * per riga «Sellers can update their own products» (migrations/001) e' ancora
 * in piedi: il client del browser puo' scrivere `products` senza passare di
 * qui, e la traccia si salta. E' una regola delle pagine, non del dato. Per
 * farla diventare del dato serve una migrazione che tolga quella regola (o un
 * trigger che pretenda il passaggio dal server): lavoro di sicurezza, fuori da
 * questo file. Fino ad allora, una pagina nuova che scrive diretto non la
 * ferma nessuno.
 *
 * Niente `next/server` e niente client vero: il database e il registro entrano
 * come argomenti, cosi' una prova puo' ESEGUIRE questa funzione invece di
 * cercare parole nel sorgente.
 */

import type { AuditAction } from '@/lib/audit';
import type { CategoryRow } from '@/lib/products/aiPatch';
import {
  daCompletareDopoLaModifica,
  messaggioDaCompletare,
  type ProdottoAttuale,
} from '@/lib/products/prontoPerLaVendita';

/**
 * Le colonne di `products` che il venditore puo' cambiare dal suo pannello.
 *
 * È una lista chiusa, e serve a due cose insieme: dire quali campi confrontare
 * per la traccia, e buttare via tutto il resto prima di scrivere. `seller_id`
 * non c'e' apposta — un corpo di richiesta che lo contenesse potrebbe regalare
 * a chi chiama il prodotto di un altro negozio.
 */
export const COLONNE_DEL_VENDITORE = [
  'name',
  'description',
  'price',
  'compare_at_price',
  'unit',
  'condition',
  'stock',
  'category_id',
  'images',
  'attributes',
  'tags',
  'express_enabled',
  'status',
] as const;

export type ColonnaDelVenditore = (typeof COLONNE_DEL_VENDITORE)[number];

/**
 * 31/10/2026 — LA SCORTA CHE IL NEGOZIANTE AVEVA DAVANTI.
 *
 * Non e' una colonna: e' la condizione della scrittura. La scorta si scrive
 * come numero assoluto, e mentre il modulo resta aperto le vendite la
 * abbassano. Alle 9 il fornaio apre la focaccia (5), alle 9:05 ne vendono due
 * (in banca dati 3), alle 9:10 scrive 6 per aggiungerne una appena sfornata:
 * senza condizione in banca dati andava 6, e due focacce che non esistono
 * tornavano in vetrina. Con `stock_visto` accanto a `stock` la porta scrive
 * solo se in banca dati c'e' ancora il numero visto; se no si ferma e lo dice.
 * Passa da `colonneAmmesse` perche' le rotte buttano via tutto il resto.
 */
export const SCORTA_VISTA = 'stock_visto';

/** Le colonne da rileggere prima di scrivere, per sapere com'era. */
export const COLONNE_DA_RILEGGERE = ['id', 'seller_id', ...COLONNE_DEL_VENDITORE].join(', ');

/**
 * Tiene solo le colonne ammesse. Tutto il resto — `id`, `seller_id`,
 * `created_at`, campi inventati — sparisce senza far rumore.
 */
export function colonneAmmesse(corpo: unknown): Record<string, unknown> {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return {};
  const dentro = corpo as Record<string, unknown>;
  const pulito: Record<string, unknown> = {};
  for (const colonna of COLONNE_DEL_VENDITORE) {
    if (colonna in dentro && dentro[colonna] !== undefined) pulito[colonna] = dentro[colonna];
  }
  const vista = dentro[SCORTA_VISTA];
  if (typeof vista === 'number' && Number.isFinite(vista)) pulito[SCORTA_VISTA] = vista;
  return pulito;
}

/**
 * Due valori sono lo stesso valore?
 *
 * Il confronto e' largo di proposito. Il database restituisce i numeri con la
 * virgola come stringa («20.00») mentre il modulo manda un numero (20): un
 * confronto secco direbbe «prezzo cambiato» a ogni salvataggio e il registro si
 * riempirebbe di modifiche mai fatte, che e' un altro modo di non sapere piu'
 * niente. Vuoto, nullo e assente valgono uguale per lo stesso motivo.
 */
function stessoValore(a: unknown, b: unknown): boolean {
  const vuoto = (v: unknown) => v === null || v === undefined || v === '';
  if (vuoto(a) && vuoto(b)) return true;
  if (vuoto(a) !== vuoto(b)) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return a === b;
}

/** I nomi delle colonne che il salvataggio cambia davvero. */
export function campiCambiati(
  prima: Record<string, unknown>,
  dopo: Record<string, unknown>,
): ColonnaDelVenditore[] {
  const cambiati: ColonnaDelVenditore[] = [];
  for (const colonna of COLONNE_DEL_VENDITORE) {
    if (!(colonna in dopo)) continue;
    if (!stessoValore(prima[colonna], dopo[colonna])) cambiati.push(colonna);
  }
  return cambiati;
}

/**
 * Quali colonne di `products` andrebbe a scrivere un suggerimento
 * dell'assistente.
 *
 * Serve a rispondere alla domanda che oggi non ha risposta: «quel prezzo
 * l'aveva proposto l'AI o l'ha scritto il negoziante?». Il modulo del prodotto
 * segna i campi che l'assistente ha toccato, e al salvataggio quei nomi
 * arrivano nel registro. I nomi del suggerimento non sono quelli delle colonne
 * (`category_slug` finisce in `category_id`, `unlimited_stock` in `stock`):
 * la traduzione sta qui, non in un componente.
 */
export function colonneDelPatchAi(patch: Record<string, unknown> | null | undefined): ColonnaDelVenditore[] {
  if (!patch || typeof patch !== 'object') return [];
  const mappa: Record<string, ColonnaDelVenditore> = {
    name: 'name',
    description: 'description',
    price: 'price',
    compare_at_price: 'compare_at_price',
    unit: 'unit',
    condition: 'condition',
    stock: 'stock',
    unlimited_stock: 'stock',
    category_id: 'category_id',
    category_slug: 'category_id',
    subcategory_name: 'category_id',
    tags: 'tags',
    attributes: 'attributes',
    attributes_remove: 'attributes',
    images: 'images',
    status: 'status',
  };
  const colonne: ColonnaDelVenditore[] = [];
  for (const [chiave, valore] of Object.entries(patch)) {
    if (valore === undefined) continue;
    const colonna = mappa[chiave];
    if (colonna && !colonne.includes(colonna)) colonne.push(colonna);
  }
  return colonne;
}

/** La voce del registro, nella forma che `writeAudit` gia' conosce. */
export type VoceDiTraccia = {
  actorId: string;
  action: AuditAction;
  targetTable: 'products';
  targetId: string;
  metadata: {
    origine: string;
    campi: string[];
    prima: Record<string, unknown>;
    dopo: Record<string, unknown>;
    /** I campi che il negoziante non ha scritto: glieli ha proposti l'assistente. */
    daAi: string[];
  };
};

/**
 * Costruisce la voce, o `null` se non e' cambiato niente.
 *
 * Nel registro finiscono SOLO i campi cambiati, con il valore di prima e quello
 * di dopo. Salvare tutta la riga a ogni giro riempirebbe la tabella di foto
 * identiche e renderebbe illeggibile proprio la cosa che serve: cosa e'
 * cambiato.
 */
export function tracciaDellaModifica(opts: {
  prodottoId: string;
  attoreId: string;
  origine: string;
  prima: Record<string, unknown>;
  dopo: Record<string, unknown>;
  campiDallAi?: string[];
}): VoceDiTraccia | null {
  const campi = campiCambiati(opts.prima, opts.dopo);
  if (campi.length === 0) return null;

  const prima: Record<string, unknown> = {};
  const dopo: Record<string, unknown> = {};
  for (const campo of campi) {
    prima[campo] = opts.prima[campo] ?? null;
    dopo[campo] = opts.dopo[campo] ?? null;
  }
  // Solo i campi che l'assistente ha proposto E che sono davvero cambiati: se
  // il negoziante ha riscritto a mano sopra il suggerimento, quel campo non e'
  // piu' dell'AI.
  const daAi = (opts.campiDallAi ?? []).filter((c) => (campi as string[]).includes(c));

  return {
    actorId: opts.attoreId,
    action: 'product.update',
    targetTable: 'products',
    targetId: opts.prodottoId,
    metadata: { origine: opts.origine, campi, prima, dopo, daAi },
  };
}

// ---------------------------------------------------------------------------
// La porta di scrittura
// ---------------------------------------------------------------------------

type RispostaLettura = {
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
};

type CatenaLettura = {
  eq: (colonna: string, valore: string) => CatenaLettura;
  maybeSingle: () => PromiseLike<RispostaLettura>;
};

type CatenaScrittura = {
  eq: (colonna: string, valore: string | number) => CatenaScrittura;
  /** Rilegge le righe scritte: serve a sapere se il confronta-e-scrivi ha trovato la riga. */
  select?: (colonne: string) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>;
} & PromiseLike<{ error: { message?: string } | null }>;

/** Una lettura di piu' righe (l'albero delle categorie). */
type RispostaElenco = {
  data: Record<string, unknown>[] | null;
  error: { message?: string } | null;
};

/** Il minimo che serve del client Supabase: cosi' una prova puo' passargliene uno finto. */
export type ClientDelCatalogo = {
  from: (tabella: string) => {
    select: (colonne: string) => CatenaLettura & PromiseLike<RispostaElenco>;
    update: (valori: Record<string, unknown>) => CatenaScrittura;
  };
};

export class ProdottoNonTuo extends Error {
  constructor() {
    super('Non puoi modificare un prodotto che non è tuo');
    this.name = 'ProdottoNonTuo';
  }
}

/**
 * La modifica metterebbe in vendita una scheda incompleta. Il messaggio e'
 * scritto per il negoziante (dice cosa manca): la rotta lo passa com'e', e
 * riprovare non serve — serve completare la scheda.
 */
export class DaCompletare extends Error {
  readonly mancanti: string[];
  constructor(messaggio: string, mancanti: string[]) {
    super(messaggio);
    this.name = 'DaCompletare';
    this.mancanti = mancanti;
  }
}

/**
 * 27/10/2026 — «ATTIVA» DALL'ELENCO METTEVA IN VENDITA UNA BOZZA SENZA ALLERGENI.
 *
 * Il modulo lascia salvare una bozza incompleta e blocca solo la
 * pubblicazione. Ma nell'elenco «I miei prodotti» ogni bozza ha «Attiva», che
 * passa da questa porta con `{ status: 'available' }` — e la porta non
 * guardava niente: una focaccia senza allergeni ne' ingredienti andava in
 * vetrina (Reg. UE 1169/2011). Il controllo sta qui, nell'unica porta, cosi'
 * vale per il modulo, per l'elenco e per chiunque chiami la rotta. Le regole
 * sono quelle del modulo e delle rotte dell'assistente
 * (`daCompletareDopoLaModifica`): una regola sola, non tre copie.
 *
 * Le categorie si leggono solo quando la modifica mette (o sposta di
 * categoria) un prodotto in vendita: un prezzo cambiato su un prodotto gia' in
 * vetrina non paga una lettura in piu'. Le foto si contano su quello che si
 * sta scrivendo, se c'e': il modulo aggiunge la prima foto e pubblica nello
 * stesso salvataggio.
 */
async function controllaCheSiPossaVendere(
  db: ClientDelCatalogo,
  prima: Record<string, unknown>,
  daScrivere: Record<string, unknown>,
): Promise<void> {
  const statoDopo = 'status' in daScrivere ? daScrivere.status : prima.status;
  if (statoDopo !== 'available') return;
  const cambiaCategoria = 'category_id' in daScrivere && daScrivere.category_id !== prima.category_id;
  if (prima.status === 'available' && !cambiaCategoria) return;

  const { data: categorie, error } = await db.from('categories').select('id, name, slug, parent_id');
  if (error) throw error;

  const { mancanti, categoriaNuova } = daCompletareDopoLaModifica({
    prima: {
      ...(prima as unknown as ProdottoAttuale),
      images: ('images' in daScrivere ? daScrivere.images : prima.images) as string[] | null,
    },
    update: daScrivere,
    categories: (categorie ?? []) as unknown as CategoryRow[],
  });
  if (mancanti.length > 0) throw new DaCompletare(messaggioDaCompletare(mancanti, categoriaNuova), mancanti);
}

/**
 * La scorta in banca dati non e' piu' quella che il negoziante aveva davanti:
 * nel frattempo qualcuno ha comprato. La scorta non si scrive, e il messaggio
 * dice cosa fare — riprovare con lo stesso numero darebbe lo stesso errore.
 *
 * E' un `DaCompletare` di proposito: e' la famiglia degli errori scritti per
 * il negoziante, che la rotta passa com'e' invece di «Riprova». Niente `code`
 * del database: `friendlyError` lo coprirebbe con «valore non valido».
 */
export class ScortaCambiata extends DaCompletare {
  readonly vista: number;
  readonly attuale: unknown;
  constructor(vista: number, attuale: unknown) {
    const ora =
      typeof attuale === 'number' || (typeof attuale === 'string' && attuale !== '')
        ? `ora sono ${attuale}`
        : 'nel frattempo è cambiata';
    super(
      `La scorta è cambiata mentre modificavi: avevi davanti ${vista} pezzi, ${ora}. Riapri il prodotto, controlla il numero e salva di nuovo.`,
      ['scorta'],
    );
    this.name = 'ScortaCambiata';
    this.vista = vista;
    this.attuale = attuale;
  }
}

export type EsitoSalvataggio = {
  /** I campi davvero cambiati (vuoto = il salvataggio non ha mosso niente). */
  campi: string[];
  /** Vero se la voce di registro e' stata consegnata a chi la scrive. */
  tracciato: boolean;
};

/**
 * L'unica porta: rilegge, scrive, registra.
 *
 * L'ordine conta. Si rilegge PRIMA perche' dopo la scrittura il valore
 * precedente non esiste piu' da nessuna parte. Si scrive prima di registrare
 * perche' una modifica che il database rifiuta non e' successa e non va nel
 * registro. E il registro non puo' far fallire un salvataggio riuscito: se la
 * scrittura della traccia va storta il negoziante non deve perdere il lavoro,
 * il guasto lo racconta chi scrive (`writeAudit` lo manda al logger).
 */
export async function salvaProdottoTracciato(opts: {
  db: ClientDelCatalogo;
  prodottoId: string;
  attoreId: string;
  payload: Record<string, unknown>;
  origine: string;
  campiDallAi?: string[];
  scriviTraccia: (voce: VoceDiTraccia) => void | Promise<void>;
}): Promise<EsitoSalvataggio> {
  const { [SCORTA_VISTA]: scortaVista, ...daScrivere } = colonneAmmesse(opts.payload);
  // Il confronta-e-scrivi: con la scorta vista accanto, la scorta non toccata
  // non parte (in banca dati resta quella vera) e quella cambiata si scrive
  // solo se nessuno l'ha mossa nel frattempo.
  let condizione: number | undefined;
  if ('stock' in daScrivere && typeof scortaVista === 'number') {
    if (stessoValore(daScrivere.stock, scortaVista)) delete daScrivere.stock;
    else condizione = scortaVista;
  }
  if (Object.keys(daScrivere).length === 0) return { campi: [], tracciato: false };

  const { data: prima, error: erroreLettura } = await opts.db
    .from('products')
    .select(COLONNE_DA_RILEGGERE)
    .eq('id', opts.prodottoId)
    .maybeSingle();
  if (erroreLettura) throw erroreLettura;
  if (!prima || prima.seller_id !== opts.attoreId) throw new ProdottoNonTuo();

  if (condizione !== undefined && !stessoValore(prima.stock, condizione)) {
    throw new ScortaCambiata(condizione, prima.stock);
  }

  // Prima di scrivere: una scheda incompleta non entra in vetrina da questa
  // porta. Non da tutte: il caricamento da file e il primo inserimento del
  // nuovo prodotto scrivono `products` dal browser senza passare di qui, e la'
  // il database ferma solo l'alimentare senza allergeni (migrazione 126).
  await controllaCheSiPossaVendere(opts.db, prima, daScrivere);

  // Il filtro sul negozio resta anche nella scrittura: la regola per riga del
  // database e' l'ultima difesa, non l'unica.
  const scrittura = opts.db
    .from('products')
    .update(daScrivere)
    .eq('id', opts.prodottoId)
    .eq('seller_id', opts.attoreId);
  if (condizione === undefined) {
    const { error } = await scrittura;
    if (error) throw error;
  } else {
    // Fra la rilettura e la scrittura passano millisecondi, ma un ordine ci sta:
    // la condizione va nella scrittura stessa, e una riga non trovata vuol dire
    // che la scorta e' cambiata proprio in quel momento.
    const condizionata = scrittura.eq('stock', condizione);
    if (!condizionata.select) throw new Error('Il client del catalogo non sa rileggere la riga scritta.');
    const { data, error } = await condizionata.select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new ScortaCambiata(condizione, undefined);
  }

  const voce = tracciaDellaModifica({
    prodottoId: opts.prodottoId,
    attoreId: opts.attoreId,
    origine: opts.origine,
    prima,
    dopo: daScrivere,
    campiDallAi: opts.campiDallAi,
  });
  if (!voce) return { campi: [], tracciato: false };

  try {
    await opts.scriviTraccia(voce);
  } catch {
    return { campi: voce.metadata.campi, tracciato: false };
  }
  return { campi: voce.metadata.campi, tracciato: true };
}
