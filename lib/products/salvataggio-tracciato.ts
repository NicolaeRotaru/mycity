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
 * La cura e' la stessa delle altre malattie «protezione su una strada sola»: la
 * regola scende sul DATO. Qui dentro c'e' l'unica porta di scrittura del
 * catalogo per il venditore — legge com'era, scrive, e registra la differenza —
 * e le pagine non fanno altro che chiamarla. Una porta nuova che nasce domani
 * o passa di qui, o non scrive.
 *
 * Niente `next/server` e niente client vero: il database e il registro entrano
 * come argomenti, cosi' una prova puo' ESEGUIRE questa funzione invece di
 * cercare parole nel sorgente.
 */

import type { AuditAction } from '@/lib/audit';

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
  eq: (colonna: string, valore: string) => CatenaScrittura;
} & PromiseLike<{ error: { message?: string } | null }>;

/** Il minimo che serve del client Supabase: cosi' una prova puo' passargliene uno finto. */
export type ClientDelCatalogo = {
  from: (tabella: string) => {
    select: (colonne: string) => CatenaLettura;
    update: (valori: Record<string, unknown>) => CatenaScrittura;
  };
};

export class ProdottoNonTuo extends Error {
  constructor() {
    super('Non puoi modificare un prodotto che non è tuo');
    this.name = 'ProdottoNonTuo';
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
  const daScrivere = colonneAmmesse(opts.payload);
  if (Object.keys(daScrivere).length === 0) return { campi: [], tracciato: false };

  const { data: prima, error: erroreLettura } = await opts.db
    .from('products')
    .select(COLONNE_DA_RILEGGERE)
    .eq('id', opts.prodottoId)
    .maybeSingle();
  if (erroreLettura) throw erroreLettura;
  if (!prima || prima.seller_id !== opts.attoreId) throw new ProdottoNonTuo();

  // Il filtro sul negozio resta anche nella scrittura: la regola per riga del
  // database e' l'ultima difesa, non l'unica.
  const { error } = await opts.db
    .from('products')
    .update(daScrivere)
    .eq('id', opts.prodottoId)
    .eq('seller_id', opts.attoreId);
  if (error) throw error;

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
