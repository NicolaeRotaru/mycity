import type { SupabaseClient } from '@supabase/supabase-js';
import { attachSellerProfiles, fetchSellerPublicMap, type SellerPublicProfile } from '@/lib/queries/seller-public-profiles';
import { DIMENSIONE_BLOCCO, inBlocchi, leggiInBlocchi } from '@/lib/supabase/blocchi';
import { NEW_PRODUCT_DAYS } from '@/lib/constants';
import { discountedUnitCents } from '@/lib/promotions';

/**
 * LA LETTURA CHE STA SOTTO OGNI GRIGLIA DI PRODOTTI DEL SITO.
 *
 * Sta qui, e non dentro il componente, per due motivi. Il primo: è la lettura più calda del sito —
 * home, categorie, vetrina del negozio, pagina dei risultati — e due difetti seri ci sono passati
 * senza che nessuna prova potesse accorgersene. Il secondo: in questa repo un componente React non
 * si può montare in una prova, quindi finché la lettura viveva dentro il componente non era
 * verificabile da nessuno.
 *
 * 27/8/2026 (R069) — prima si chiedeva l'elenco di TUTTI i negozi approvati e lo si rispediva
 * indietro dentro un `.in(...)`: un viaggio di rete in più prima di ogni griglia, e — passate le
 * poche centinaia di negozi — un indirizzo troppo lungo, un 414, e il catalogo vuoto mentre il sito
 * risponde «va tutto bene». Dalla migrazione 129 quel filtro lo fa già la regola del database sulla
 * stessa query. La rete di sicurezza nel browser (il controllo su `is_approved` in fondo) resta.
 *
 * 27/8/2026 (R073) — «ordina per pertinenza» ordinava per data, e cercava solo dentro il nome. Ora
 * la pertinenza la calcola il database con `search_products_smart`, la stessa funzione che usa il
 * suggeritore sotto la barra di ricerca; `ilike` resta come ripiego per le parole tagliate a metà
 * («pomo» per «Pomodori»), che la ricerca italiana non riconosce.
 */

export type OrdineGriglia = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating' | 'discount_desc';

export type RigaGriglia = {
  id: string;
  name: string;
  price: string | number;
  compare_at_price: string | number | null;
  images: string[] | null;
  stock: number | null;
  has_variants?: boolean | null;
  created_at: string;
  seller_id: string | null;
  category_id: string | null;
  /** R21-005 — Solo ordinando per prezzo, con la migrazione 911: il prezzo che si paga. */
  prezzo_pagato?: string | number | null;
  profiles?: SellerPublicProfile | null;
};

export interface DomandaGriglia {
  categoryId?: string;
  categoryIds?: string[];
  sellerId?: string;
  search?: string;
  sort: OrdineGriglia;
  /**
   * Il prezzo massimo, compreso: guarda il prezzo che si paga (R21-006). R21-010 — Senza la
   * migrazione 911 gli id che solo in promozione ci scendono sotto li chiede la lettura da sé.
   */
  maxPrice?: number;
  minPrice?: number;
  onlyInStock?: boolean;
  /** Negozi aperti adesso (già risolti dal chiamante) — assente = filtro spento. */
  apertiOra?: string[];
  /** Prodotti con voto almeno N (già risolti dal chiamante) — assente = filtro spento. */
  idsColVoto?: string[];
  /** Solo i prodotti pubblicati da questo istante in poi (ISO) — assente = filtro spento. */
  creatiDal?: string;
  /** Quante righe chiedere al database. */
  tetto: number;
  /**
   * 30/8/2026 (R080) — LA FINESTRA CHE SI SPOSTA, INVECE DEL TETTO CHE SI
   * ALLARGA.
   *
   * «Carica altri» rifaceva la stessa lettura con un tetto piu' alto: 96, poi
   * 192, poi 288, poi 384 — e buttava via il risultato di prima. Alla quarta
   * pressione erano state scaricate 960 righe, con le loro foto, per mostrarne
   * 384: traffico e attesa crescono col QUADRATO delle pressioni, sulla
   * connessione di chi guarda, e ogni pressione e' piu' lenta della precedente.
   *
   * Con la finestra ogni pressione chiede le sue righe e basta. Estremi
   * inclusi, come `.range()` di PostgREST.
   *
   * Nota che non va saltata: una finestra con un ordinamento non deterministico
   * puo' saltare o ripetere righe fra una pagina e l'altra — per questo
   * l'identificativo e' sempre il secondo criterio d'ordine, qui sotto.
   */
  finestra?: readonly [number, number];
}

const COLONNE = 'id, name, price, compare_at_price, images, stock, has_variants, created_at, seller_id, category_id';

/**
 * 26/11/2026 (R21-003) — IL PREZZO CHE SI PAGA LO SA IL DATABASE.
 *
 * I filtri e l'ordine di prezzo guardavano il prezzo pieno (`price`), mentre la scheda mostra e la
 * cassa addebita quello scontato: con «minimo 10 €» un prodotto da 12 € al -25% (9 € alla cassa)
 * restava nell'elenco. La migrazione 911 dà a `products` la colonna calcolata `prezzo_pagato` (il
 * pieno meno la promozione attiva, con la regola di `product_active_discounts` e l'arrotondamento di
 * `discountedUnitCents`) e la lettura taglia su quella.
 *
 * IL RIPIEGO, PERCHÉ IL CODICE ARRIVA PRIMA DELLA MIGRAZIONE. Il sito va online a ogni unione, le
 * migrazioni le applica Nicola dopo: senza la colonna PostgREST risponde 42703 e la griglia andava
 * in errore (/regali già all'apertura). Allora prima di usarla si chiede se c'è (`cePrezzoPagato`,
 * una riga, una volta per client), e se una lettura cade lo stesso perché manca la si rifà alla
 * vecchia maniera, sul prezzo pieno. Con la migrazione applicata il ripiego non scatta più.
 */
const COLONNA_PREZZO_PAGATO = 'prezzo_pagato';
/** Senza la colonna si richiede dopo cinque minuti: la migrazione può arrivare con la pagina aperta. */
const RICHIEDI_SENZA_PREZZO_PAGATO_MS = 5 * 60_000;
const notiPrezzoPagato = new WeakMap<object, { c: boolean; finoA: number }>();

/** L'errore dice che la colonna calcolata non c'è (migrazione 911 non applicata)? */
function mancaPrezzoPagato(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const codice = String(e.code ?? '');
  if (codice === '42703' || codice === '42883') return true;
  return codice.startsWith('PGRST') && `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`.includes(COLONNA_PREZZO_PAGATO);
}

/**
 * Con la colonna la lettura non va: manca (sopra) oppure il database ha superato il suo tempo
 * (57014, `statement_timeout` di anon) ordinando o tagliando su `prezzo_pagato` in un catalogo grande.
 * In tutti e due i casi lista e conteggio ripiegano sul prezzo pieno, e per cinque minuti non la riprovano.
 */
function prezzoPagatoNonVa(error: unknown): boolean {
  return mancaPrezzoPagato(error) || String((error as { code?: unknown } | null)?.code ?? '') === '57014';
}

function segnaSenzaPrezzoPagato(supabase: SupabaseClient): void {
  notiPrezzoPagato.set(supabase, { c: false, finoA: Date.now() + RICHIEDI_SENZA_PREZZO_PAGATO_MS });
}

/**
 * La colonna `prezzo_pagato` c'è? Una riga sola, e la risposta si ricorda per questo client. Una
 * risposta che non porta la colonna (uno schema vecchio, un database finto delle prove) vale «no»;
 * una lettura caduta per un altro motivo vale «no» solo per questa volta.
 */
async function cePrezzoPagato(supabase: SupabaseClient): Promise<boolean> {
  const noto = notiPrezzoPagato.get(supabase);
  if (noto && (noto.c || Date.now() < noto.finoA)) return noto.c;
  try {
    const { data, error } = await supabase.from('products').select(`id, ${COLONNA_PREZZO_PAGATO}`).limit(1);
    if (error) {
      if (mancaPrezzoPagato(error)) segnaSenzaPrezzoPagato(supabase);
      return false;
    }
    const prima = (Array.isArray(data) ? data[0] : undefined) as Record<string, unknown> | undefined;
    if (prima !== undefined && !(COLONNA_PREZZO_PAGATO in prima)) {
      segnaSenzaPrezzoPagato(supabase);
      return false;
    }
    notiPrezzoPagato.set(supabase, { c: true, finoA: Infinity });
    return true;
  } catch {
    return false;
  }
}

/** La domanda guarda il prezzo (filtro o ordine)? Solo allora serve sapere se `prezzo_pagato` c'è. */
function guardaIlPrezzo(d: Pick<DomandaGriglia, 'minPrice' | 'maxPrice'> & { sort?: OrdineGriglia }): boolean {
  return d.minPrice !== undefined || d.maxPrice !== undefined || d.sort === 'price_asc' || d.sort === 'price_desc';
}

/**
 * 17/11/2026 (R02-012) — «CARICA ALTRI» SI FERMAVA SE IL FILTRO IN FONDO SCARTAVA RIGHE.
 *
 * La pagina si chiede al database piena (la `finestra`), poi in fondo a `leggiProdottiDellaGriglia`
 * si tolgono le righe dei negozi fuori vetrina. Chi sfoglia decideva «è l'ultima» contando le righe
 * tornate: una pagina piena con una riga scartata sembrava l'ultima, e «Carica altri» spariva con
 * altri prodotti ancora da vedere. Ora le righe LETTE viaggiano attaccate alla pagina
 * (`righeLette`, non enumerabile: non entra nei confronti, nei cicli né nel JSON) e chi sfoglia
 * decide su quelle. Dove manca (una pagina ricopiata da altri) vale la lunghezza, come prima.
 */
export type PaginaGriglia = RigaGriglia[] & { readonly righeLette?: number };

/**
 * 13/11/2026 (R15-011) — LA FINESTRA DELLE NOVITÀ.
 *
 * «Novità» era il catalogo intero ordinato per data. Una novità è un prodotto «Nuovo» come lo
 * dice la scheda (`NEW_PRODUCT_DAYS`, 14 giorni): l'inizio della finestra si arrotonda all'ora
 * perché finisce nella chiave della cache e non deve cambiare a ogni render.
 */
export function inizioFinestraNovita(adesso: Date = new Date(), giorni: number = NEW_PRODUCT_DAYS): string {
  const dal = new Date(adesso.getTime() - giorni * 86_400_000);
  dal.setUTCMinutes(0, 0, 0);
  return dal.toISOString();
}

/**
 * R01-008 — I PRODOTTI CHE SOLO IN PROMOZIONE SCENDONO SOTTO LA SOGLIA.
 *
 * R21-010 — Oggi è solo il ripiego della lettura qui sotto, finché la migrazione 911 non è applicata
 * (con lei il massimo guarda `prezzo_pagato`): ProductGrid non lo chiama più per conto suo.
 *
 * «Sotto i 10 €» tagliava sul prezzo pieno: un prodotto da 12 € al -25% (9 € alla cassa) restava
 * fuori. Qui si leggono i prodotti con una promozione attiva (`active_promo_products`, la stessa
 * regola di `product_active_discounts` che usa la cassa) e si tengono quelli col prezzo pieno alla
 * soglia o sopra che, scontati come li sconta la cassa (`discountedUnitCents`), stanno sotto.
 * Gli id finiscono nell'indirizzo (`id.in.(…)` dentro l'`or`): al massimo `DIMENSIONE_BLOCCO`, i più
 * economici, perché un indirizzo troppo lungo darebbe un 414 e la griglia vuota.
 * Una lettura caduta vale «nessuno»: la pagina resta quella di prima invece di andare in errore.
 */
const TETTO_PROMO_LETTE = 1000;

export async function idsCheInPromoScendonoSotto(
  supabase: SupabaseClient,
  soglia: number,
  sellerId?: string,
): Promise<string[]> {
  const { data, error } = await supabase.rpc('active_promo_products', {
    p_limit: TETTO_PROMO_LETTE,
    ...(sellerId ? { p_seller: sellerId } : {}),
  });
  if (error || !Array.isArray(data)) return [];
  const sogliaCent = Math.round(soglia * 100);
  return (data as Array<{ product_id: string; price: number | string; discount_percent: number | null }>)
    .map((r) => ({ id: r.product_id, pieno: Number(r.price), pagato: discountedUnitCents(r.price, Number(r.discount_percent) || 0) }))
    .filter((r) => !!r.id && Number.isFinite(r.pieno) && Math.round(r.pieno * 100) >= sogliaCent && r.pagato < sogliaCent)
    .sort((a, b) => a.pagato - b.pagato || (a.id < b.id ? -1 : 1))
    .slice(0, DIMENSIONE_BLOCCO)
    .map((r) => r.id);
}

/**
 * R21-010 — Il massimo senza `prezzo_pagato`: gli id che col prezzo pieno stanno sopra `maxPrice` e
 * in promozione ci scendono, fino a `maxPrice` compreso. `idsCheInPromoScendonoSotto` vuole la soglia
 * esclusa: è il centesimo dopo il massimo (9,995 → 10,00; 10 → 10,01).
 */
function idsScontatiFinoA(supabase: SupabaseClient, maxPrice: number, sellerId?: string): Promise<string[]> {
  return idsCheInPromoScendonoSotto(supabase, (Math.floor(maxPrice * 100 + 1e-6) + 1) / 100, sellerId);
}

/** Quanti risultati chiedere alla ricerca del database: mai più della finestra a schermo. */
const TETTO_PERTINENZA = 200;

/**
 * Gli id dei prodotti più pertinenti, in ordine di pertinenza. Lista vuota = «non lo so»: chi
 * chiama ripiega su `ilike`, che è meno bravo ma non lascia nessuno a mani vuote.
 */
async function idsPiuPertinenti(supabase: SupabaseClient, termine: string, tetto: number): Promise<string[]> {
  const { data, error } = await supabase.rpc('search_products_smart', {
    q: termine,
    lim: Math.min(tetto, TETTO_PERTINENZA),
  });
  // Se la funzione non c'è (migrazione non applicata) o la rete cade, non si lascia la pagina
  // vuota: si torna al ripiego di prima.
  if (error) return [];
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id).filter(Boolean);
}

/** I filtri che la lettura e il conteggio devono applicare uguali. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applicaFiltriComuni<Q extends { in: any; eq: any; lte: any; gte: any; or: any }>(
  q: Q,
  d: Pick<DomandaGriglia, 'sellerId' | 'maxPrice' | 'minPrice' | 'onlyInStock' | 'apertiOra' | 'creatiDal'>,
  categorie: string[] | null,
  /** La colonna `prezzo_pagato` c'è (migrazione 911): i filtri di prezzo guardano lei. */
  pagato: boolean,
  /** Senza `prezzo_pagato`: chi supera il massimo solo a prezzo pieno (`idsScontatiFinoA`). */
  scontatiSotto: readonly string[],
): Q {
  if (categorie) q = q.in('category_id', categorie);
  if (d.sellerId) q = q.eq('seller_id', d.sellerId);
  if (d.maxPrice !== undefined) {
    // R21-006 R21-004 — Il massimo (lo slider, «Sotto i 10 €») è il prezzo che si paga, come il minimo:
    // con la migrazione 911 lo dice `prezzo_pagato`, senza elenchi di id e senza i loro tetti.
    // R01-008 — Senza la migrazione, chi ci scende solo in promozione entra con i suoi id.
    q = pagato
      ? q.lte(COLONNA_PREZZO_PAGATO, d.maxPrice)
      : scontatiSotto.length > 0
        ? q.or(`price.lte.${d.maxPrice},id.in.(${scontatiSotto.join(',')})`)
        : q.lte('price', d.maxPrice);
  }
  // R21-003 — «Prezzo minimo» è il prezzo che si paga: un 12 € al -25% (9 €) con minimo 10 € non entra.
  // Senza la migrazione 911 resta il prezzo pieno, come prima.
  if (d.minPrice !== undefined) q = q.gte(pagato ? COLONNA_PREZZO_PAGATO : 'price', d.minPrice);
  // #91 — «Solo disponibili» lo decide il database. Attenzione: `stock` a NULL vuol dire
  // disponibilità illimitata.
  if (d.onlyInStock) q = q.or('stock.is.null,stock.gt.0');
  if (d.apertiOra !== undefined) q = q.in('seller_id', d.apertiOra);
  if (d.creatiDal) q = q.gte('created_at', d.creatiDal);
  return q;
}

/**
 * 3/9/2026 — SCEGLIERE «ALIMENTARI» NASCONDEVA IL PANE.
 *
 * Le categorie sono a due piani: nove madri e sessantatré figlie, e la parentela sta SOLO nella
 * tabella `categories` (`parent_id`). Chi filtrava per una madre — dal filtro della ricerca, dalla
 * pagina di una categoria — arrivava qui con un identificativo solo, e la lettura faceva
 * `category_id = quella madre` secco: il pane classificato in «Panificio» non usciva, e la pagina
 * diceva «nessun risultato» su una categoria piena. Merce che c'è e non si trova: l'ordine lo perde
 * il negozio, e nessuno se ne accorge.
 *
 * La cura sta QUI e non in chi chiama, perché a chiamare sono sette punti diversi (il filtro della
 * ricerca, la griglia della categoria, le vetrine per sottocategoria, «Altri prodotti», «Ti
 * potrebbe interessare», i prodotti simili della scheda, i regali): messa in uno solo, la malattia
 * resterebbe possibile negli altri sei.
 *
 * Costa una lettura in più, piccola e solo quando il filtro categoria è acceso: si chiedono gli
 * identificativi delle figlie di UNA categoria, non l'albero intero. Se quella lettura fallisce si
 * resta al comportamento di prima — la madre da sola — invece di lasciare la griglia vuota.
 */
async function conLeSueSottocategorie(supabase: SupabaseClient, id: string): Promise<string[]> {
  const { data, error } = await supabase.from('categories').select('id').eq('parent_id', id);
  if (error) return [id];
  const figlie = ((data ?? []) as Array<{ id: string }>).map((r) => r.id).filter(Boolean);
  return [id, ...figlie];
}

/**
 * 17/11/2026 (R02-010) — IL TAGLIO SUI PRODOTTI RECENSITI, A BLOCCHI.
 *
 * «Più recensiti» e il filtro «voto minimo» arrivano qui con l'elenco degli id che hanno il voto
 * (`idsColVoto`), e quell'elenco finiva in UN `.in('id', …)`: nell'indirizzo, come dice
 * `lib/supabase/blocchi.ts`. Sopra un paio di centinaia di prodotti recensiti l'indirizzo sfonda,
 * il server risponde 414 e la griglia va in errore. Fino a un blocco la domanda resta quella di
 * sempre; oltre, ogni blocco chiede le prime righe fino alla fine della finestra, le righe si
 * riuniscono, si rimettono nello stesso ordine che darebbe il database (lo stesso di `base()` qui
 * sotto: prezzo o data, poi l'id) e si taglia la finestra chiesta.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DomandaOrdinata = any;
type RispostaRighe = { data: RigaGriglia[] | null; error: { message?: string } | null };

function nellOrdineDelDatabase(sort: OrdineGriglia): (a: RigaGriglia, b: RigaGriglia) => number {
  const perPrezzo = sort === 'price_asc' || sort === 'price_desc';
  const crescente = sort === 'price_asc';
  const confronta = (x: string | number, y: string | number) => (x === y ? 0 : x < y ? -1 : 1);
  return (a, b) => {
    // R21-005 R21-014 — Come `base()`: il prezzo che si paga (dove manca, il pieno), poi il pieno, poi l'id.
    const primo = perPrezzo ? confronta(Number(a.prezzo_pagato ?? a.price), Number(b.prezzo_pagato ?? b.price)) : confronta(a.created_at, b.created_at);
    if (primo !== 0) return crescente ? primo : -primo;
    const secondo = perPrezzo ? confronta(Number(a.price), Number(b.price)) : 0;
    if (secondo !== 0) return crescente ? secondo : -secondo;
    return -confronta(a.id, b.id);
  };
}

async function leggiFraGliIdsColVoto(
  domanda: () => DomandaOrdinata,
  ids: readonly string[],
  sort: OrdineGriglia,
  da: number,
  a: number,
  conFinestra: boolean,
): Promise<RispostaRighe> {
  if (ids.length <= DIMENSIONE_BLOCCO) {
    const q = domanda().in('id', ids);
    return conFinestra ? q.range(da, a) : q.limit(a + 1);
  }
  const unici = [...new Set(ids)];
  const { data, error } = await leggiInBlocchi<RigaGriglia>(
    unici,
    (blocco) => domanda().in('id', blocco).limit(a + 1) as PromiseLike<RispostaRighe>,
  );
  if (error) return { data: null, error };
  return { data: data.sort(nellOrdineDelDatabase(sort)).slice(da, a + 1), error: null };
}

/**
 * 27/11/2026 — LE PAGINE DOPO LA PRIMA LEGGONO COME LA PRIMA.
 *
 * Se fra una pagina e l'altra la risposta su `prezzo_pagato` cambiava (la 911 applicata a pagina
 * aperta, la sonda caduta per rete alla prima pagina), la pagina 1 era ordinata sul prezzo pieno e la
 * 2 sul prezzo pagato: doppioni e prodotti saltati. Ora per ogni client si ricorda come è stata letta
 * la prima pagina di ogni domanda (filtri e ordine, senza la finestra) e le pagine dopo leggono
 * uguale; una prima pagina riletta (un nuovo scorrimento) decide di nuovo.
 */
const modiDelloScorrimento = new WeakMap<object, Map<string, boolean>>();
const TETTO_MODI = 50;

function chiaveDelloScorrimento(d: DomandaGriglia): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { finestra, ...resto } = d;
  return JSON.stringify(resto);
}

function ricordaModo(supabase: SupabaseClient, chiave: string, pagato: boolean): void {
  let modi = modiDelloScorrimento.get(supabase);
  if (!modi) { modi = new Map(); modiDelloScorrimento.set(supabase, modi); }
  modi.delete(chiave);
  modi.set(chiave, pagato);
  if (modi.size > TETTO_MODI) modi.delete(modi.keys().next().value as string);
}

export async function leggiProdottiDellaGriglia(
  supabase: SupabaseClient,
  d: DomandaGriglia,
): Promise<PaginaGriglia> {
  if (!guardaIlPrezzo(d)) return leggiLaGriglia(supabase, d, false);
  const chiave = chiaveDelloScorrimento(d);
  const primaPagina = !d.finestra || d.finestra[0] === 0;
  const comeLaPrima = primaPagina ? undefined : modiDelloScorrimento.get(supabase)?.get(chiave);
  const pagato = comeLaPrima ?? (await cePrezzoPagato(supabase));
  try {
    const pagina = await leggiLaGriglia(supabase, d, pagato);
    if (primaPagina) ricordaModo(supabase, chiave, pagato);
    return pagina;
  } catch (errore) {
    // R21-003 — Il ripiego: la colonna non c'è (migrazione 911 non applicata) o il database ha superato
    // il tempo (57014) → la lettura di prima.
    if (!pagato || !prezzoPagatoNonVa(errore)) throw errore;
    // 28/11/2026 (R12-006, onda 2) — Una pagina dopo la prima, letta sul prezzo pagato COME LA PRIMA,
    // non ripiega sul prezzo pieno: la pagina 1 e la 2 sarebbero in due ordini diversi (doppioni e
    // prodotti mai mostrati). Si rilancia l'errore e «Carica altri» propone di riprovare; la stessa
    // regola vale anche col segno dei cinque minuti acceso da un'altra lettura: lo scorrimento resta
    // nell'ordine della sua prima pagina, e un nuovo scorrimento decide di nuovo. Se la colonna manca
    // davvero lo si segna, così la prima pagina dopo lo sa.
    if (comeLaPrima === true) {
      if (mancaPrezzoPagato(errore)) segnaSenzaPrezzoPagato(supabase);
      throw errore;
    }
    // 27/11/2026 — Un 57014 può venire dal carico del database e non da `prezzo_pagato`: allora
    // anche la lettura sul prezzo pieno cade, e il prezzo pagato non si spegne per cinque minuti.
    // Si spegne solo se la lettura sul prezzo pieno riesce (o se la colonna manca davvero).
    const tempoScaduto = !mancaPrezzoPagato(errore);
    if (!tempoScaduto) segnaSenzaPrezzoPagato(supabase);
    const pagina = await leggiLaGriglia(supabase, d, false);
    if (tempoScaduto) segnaSenzaPrezzoPagato(supabase);
    if (primaPagina) ricordaModo(supabase, chiave, false);
    return pagina;
  }
}

async function leggiLaGriglia(
  supabase: SupabaseClient,
  d: DomandaGriglia,
  pagato: boolean,
): Promise<PaginaGriglia> {
  const termine = d.search ? d.search.replace(/[%_]/g, '\\$&').slice(0, 100) : undefined;

  // La pertinenza la sa solo il database: la si chiede prima, e poi si vanno a prendere le righe
  // intere (la funzione non restituisce giacenza, varianti e prezzo barrato, che servono alla scheda).
  let perPertinenza: string[] | null = null;
  if (termine && d.sort === 'relevance' && d.search) {
    // R11-009 — SEMPRE gli stessi (il tetto della funzione), qualunque sia la pagina: l'elenco dei
    // pertinenti deve essere lo stesso a ogni pagina, altrimenti le posizioni si spostano fra una
    // pagina e l'altra (prodotti che non escono mai, doppioni) e la lettura cresce con le pagine.
    const ids = await idsPiuPertinenti(supabase, d.search.slice(0, 100), TETTO_PERTINENZA);
    perPertinenza = ids.length > 0 ? ids : null;
  }

  // Se il chiamante ha già risolto un insieme vuoto, la risposta è vuota senza chiedere niente.
  if (d.apertiOra !== undefined && d.apertiOra.length === 0) return [];
  if (d.idsColVoto !== undefined && d.idsColVoto.length === 0) return [];

  const soloConVoto = d.idsColVoto !== undefined ? new Set(d.idsColVoto) : null;
  if (perPertinenza && soloConVoto) {
    perPertinenza = perPertinenza.filter((id) => soloConVoto.has(id));
    // R11-009 — Nessun pertinente fra i recensiti non vuol dire «nessun risultato»: si torna al
    // ripiego sul nome, che sa trovare anche le parole tagliate a metà.
    if (perPertinenza.length === 0) perPertinenza = null;
  }

  /**
   * Le categorie da leggere, risolte UNA volta: `base()` viene richiamata per ogni blocco di
   * identificativi sul ramo pertinenza, e una lettura dentro di lei sarebbe un viaggio di rete per
   * blocco. `categoryIds` ha la precedenza su `categoryId` e NON allarga alle figlie: chi lo passa
   * decide lui l'elenco esatto. Lo fanno due pagine, per due motivi opposti: Regali (già con le
   * figlie delle categorie regalabili dentro) e «Altri prodotti» della pagina categoria (solo la
   * madre, apposta, perché le figlie hanno già la loro fila e ogni prodotto uscirebbe due volte).
   */
  const categorieDaLeggere =
    d.categoryIds && d.categoryIds.length > 0
      ? d.categoryIds
      : d.categoryId
        ? await conLeSueSottocategorie(supabase, d.categoryId)
        : null;

  // R21-010 — Senza la migrazione 911 il massimo vuole gli id che solo in promozione ci scendono
  // sotto: li chiede la lettura, qui, una volta. Con la migrazione non servono.
  const scontatiSotto = !pagato && d.maxPrice !== undefined ? await idsScontatiFinoA(supabase, d.maxPrice, d.sellerId) : [];

  const perPrezzo = d.sort === 'price_asc' || d.sort === 'price_desc';
  const base = (colonne: string = COLONNE) => {
    // R21-005 — Ordinando per prezzo le righe portano anche il prezzo pagato: serve a rimettere
    // nell'ordine del database le righe lette a blocchi (`leggiFraGliIdsColVoto`).
    const conPagato = pagato && perPrezzo && colonne === COLONNE;
    let q = supabase.from('products').select(conPagato ? `${colonne}, ${COLONNA_PREZZO_PAGATO}` : colonne).eq('status', 'available');

    // R21-005 R21-014 — Con la migrazione 911 si ordina sul prezzo che si paga, quello che la griglia
    // mostra e la cassa addebita; a parità decide il prezzo pieno. Senza, sul pieno come prima.
    switch (d.sort) {
      case 'price_asc':
        q = pagato ? q.order(COLONNA_PREZZO_PAGATO, { ascending: true }).order('price', { ascending: true }) : q.order('price', { ascending: true });
        break;
      case 'price_desc':
        q = pagato ? q.order(COLONNA_PREZZO_PAGATO, { ascending: false }).order('price', { ascending: false }) : q.order('price', { ascending: false });
        break;
      default:           q = q.order('created_at', { ascending: false });
    }
    // 30/8/2026 (R080) — Il secondo criterio d'ordine non e' un dettaglio: con
    // due prodotti allo stesso prezzo (o pubblicati nello stesso istante)
    // l'ordine fra loro lo decide il database come gli pare, e puo' deciderlo
    // in modo diverso a ogni lettura. Su una finestra che si sposta vuol dire
    // una riga saltata o una riga vista due volte fra una pagina e l'altra.
    q = q.order('id', { ascending: false });

    q = applicaFiltriComuni(q, d, categorieDaLeggere, pagato, scontatiSotto);
    // Col ramo pertinenza il filtro sul testo l'ha già fatto il database, meglio di così.
    if (termine && !perPertinenza) q = q.ilike('name', `%${termine}%`);
    // Il taglio sugli id col voto NON sta qui: lo mette `leggiFraGliIdsColVoto`, a blocchi (R02-010).
    return q;
  };

  let rows: RigaGriglia[];
  // R11-009 — Quante righe ha dato il database per la finestra (pertinenti + per nome), prima di
  // togliere i doppioni e il filtro sui negozi: è su queste che si decide «ce n'è un'altra».
  let righeDellaFinestra: number | undefined;
  if (perPertinenza) {
    /**
     * 5/11/2026 — LA PERTINENZA SI CHIEDE SU TUTTO IL SITO, I FILTRI SI APPLICANO DOPO.
     * `search_products_smart` non conosce negozio, categoria e prezzo: restituisce i primi 200 di
     * tutto il catalogo, e dentro la vetrina di un negozio (o con una categoria) quelli del negozio
     * potevano restare fuori dal taglio.
     *
     * R11-009 — LA LISTA UNITA È UNA SOLA, E STABILE FRA LE PAGINE:
     *   L = Pf (i pertinenti che passano i filtri, in ordine di pertinenza) seguiti da
     *       N (i prodotti con la parola nel nome, stessi filtri, per data e id).
     * Pf è sempre quello (si chiedono sempre gli stessi 200 pertinenti), N ha un ordine fisso: la
     * finestra [a, b] di L si legge così: le posizioni sotto |Pf| vengono da Pf, le altre da N con
     * `.range(a − |Pf|, b − |Pf|)`. Ogni pagina legge i suoi id (solo `id`, leggeri), le sue righe
     * di Pf e la sua fetta di N: non crescono con le pagine, e le pagine non si accavallano.
     * I pertinenti che hanno ANCHE la parola nel nome stanno due volte in L (in Pf e in N): la
     * seconda volta si salta, ma la sua posizione conta, così le finestre restano esatte.
     */
    const [da, a] = d.finestra ? [d.finestra[0], d.finestra[1]] : [0, d.tetto - 1];
    // 1) Quali pertinenti passano i filtri (solo gli id): ne esce |Pf| e l'ordine.
    const passano = new Set<string>();
    const conNome = new Set<string>();
    const { data: idsPassano, error: errIds } = await leggiInBlocchi<{ id: string; name: string | null }>(
      perPertinenza,
      (blocco) => base('id, name').in('id', blocco) as unknown as PromiseLike<{ data: Array<{ id: string; name: string | null }> | null; error: { message?: string } | null }>,
    );
    if (errIds) throw errIds;
    const cercato = (d.search ?? '').slice(0, 100).toLowerCase();
    for (const r of idsPassano) {
      passano.add(r.id);
      if (cercato && (r.name ?? '').toLowerCase().includes(cercato)) conNome.add(r.id);
    }
    const pf = perPertinenza.filter((id) => passano.has(id));

    // 2) Le righe di Pf che cadono nella finestra.
    const fettaPf = pf.slice(da, a + 1);
    const { data: righePf, error: errPf } = await leggiInBlocchi<RigaGriglia>(
      fettaPf,
      (blocco) => base().in('id', blocco) as unknown as PromiseLike<{ data: RigaGriglia[] | null; error: { message?: string } | null }>,
    );
    if (errPf) throw errPf;
    const rango = new Map(fettaPf.map((id, i) => [id, i]));
    const ordinati = righePf.sort((x, y) => (rango.get(x.id) ?? 0) - (rango.get(y.id) ?? 0));
    righeDellaFinestra = fettaPf.length;

    // 3) La fetta di N: il ripiego sul nome vale SEMPRE (la ricerca italiana non riconosce «pomo»
    //    per «Pomodori»). Se la lettura sbaglia si mostrano i pertinenti, senza buttare giù la griglia.
    if (termine && a >= pf.length) {
      const dalNome = Math.max(0, da - pf.length);
      const alNome = a - pf.length;
      // I pertinenti che hanno anche la parola nel nome si escludono qui (sono già in Pf): gli scarti
      // sono esatti e le pagine non si accavallano. Gli id vanno nell'indirizzo, quindi al più un
      // blocco, sempre gli stessi a ogni pagina (i primi in ordine di pertinenza); se ne restano
      // fuori, la riga doppia si salta qui sotto, ma la sua posizione conta e le finestre restano esatte.
      const daEscludere = pf.filter((id) => conNome.has(id)).slice(0, DIMENSIONE_BLOCCO);
      const perNome = () => {
        const q = base().ilike('name', `%${termine}%`);
        return daEscludere.length > 0 ? q.or(`id.not.in.(${daEscludere.join(',')})`) : q;
      };
      const { data: altri, error: errNome } = soloConVoto
        ? await leggiFraGliIdsColVoto(perNome, d.idsColVoto!, d.sort, dalNome, alNome, true)
        : await perNome().range(dalNome, alNome);
      if (errNome) {
        console.warn('Ricerca per nome non riuscita, si mostrano solo i risultati più pertinenti:', errNome.message ?? errNome);
      } else {
        const lette = (altri ?? []) as unknown as RigaGriglia[];
        righeDellaFinestra += lette.length;
        for (const r of lette) if (!passano.has(r.id)) ordinati.push(r);
      }
    }
    rows = ordinati;
  } else {
    const { data, error } = soloConVoto
      ? await leggiFraGliIdsColVoto(base, d.idsColVoto!, d.sort, d.finestra ? d.finestra[0] : 0, d.finestra ? d.finestra[1] : d.tetto - 1, !!d.finestra)
      : d.finestra
        ? await base().range(d.finestra[0], d.finestra[1])
        : await base().limit(d.tetto);
    if (error) throw error;
    rows = (data ?? []) as unknown as RigaGriglia[];
  }

  const sellerMap = await fetchSellerPublicMap(
    supabase,
    rows.map((p) => p.seller_id as string),
    'id, store_name, store_hours, is_approved',
  );
  const tenute = attachSellerProfiles(rows, sellerMap).filter((p) => p.profiles?.is_approved) as RigaGriglia[];
  // R02-012 — Quante ne ha date il database, prima del filtro: è su queste che si sa se ce ne sono altre.
  Object.defineProperty(tenute, 'righeLette', { value: righeDellaFinestra ?? rows.length, enumerable: false });
  return tenute;
}

/**
 * 13/11/2026 (R15-011) — QUANTI SONO DAVVERO, NON QUANTI NE SONO ARRIVATI.
 *
 * Il numero sopra la griglia contava le schede già caricate (96, poi 192…): su 345 prodotti
 * diceva «96». Qui il database conta tutti quelli che passano gli stessi filtri della lettura
 * (senza la pertinenza: con un testo si conta per nome). `null` = non lo so: chi chiama ripiega
 * sulle schede caricate invece di scrivere «0».
 */
export async function contaProdottiDellaGriglia(
  supabase: SupabaseClient,
  d: Omit<DomandaGriglia, 'sort' | 'tetto' | 'finestra'>,
): Promise<number | null> {
  if (d.apertiOra !== undefined && d.apertiOra.length === 0) return 0;
  if (d.idsColVoto !== undefined && d.idsColVoto.length === 0) return 0;
  const categorie =
    d.categoryIds && d.categoryIds.length > 0
      ? d.categoryIds
      : d.categoryId
        ? await conLeSueSottocategorie(supabase, d.categoryId)
        : null;
  const termine = d.search ? d.search.replace(/[%_]/g, '\\$&').slice(0, 100) : undefined;
  // R21-003 — Gli stessi filtri di prezzo della lettura, con lo stesso ripiego se `prezzo_pagato` non c'è.
  let pagato = guardaIlPrezzo(d) && (await cePrezzoPagato(supabase));
  // R21-010 — Come nella lettura: senza `prezzo_pagato` il massimo vuole i suoi id.
  const scontatiSenzaPagato = async () => (d.maxPrice !== undefined ? idsScontatiFinoA(supabase, d.maxPrice, d.sellerId) : []);
  let scontatiSotto = pagato ? [] : await scontatiSenzaPagato();
  // R11-010 R11-011 — Il numero conta solo i prodotti dei negozi approvati, come la griglia: il
  // negozio si aggancia con `!inner` alla vista pubblica, NOMINANDO il vincolo (fra products e la
  // vista ci sono due strade: senza nome PostgREST risponde 300). Se l'aggancio non va si conta com'era (`senzaAggancio`) invece di non dare nessun numero.
  let senzaAggancio = false;
  /** Un 57014 su `prezzo_pagato`: si spegne per cinque minuti solo se il conto sul prezzo pieno riesce. */
  let tempoScaduto = false;
  const conta = (blocco?: string[]) => {
    const colonne = senzaAggancio ? 'id' : 'id, negozio:seller_public_profiles!products_seller_id_fkey!inner(id)';
    // R21-003 — Guardando `prezzo_pagato` si conta con una GET senza righe (limit 0) invece che con una HEAD:
    // così l'errore porta il suo codice e il conteggio ripiega solo dove ripiega la lista.
    let q = (pagato
      ? supabase.from('products').select(colonne, { count: 'exact' }).limit(0)
      : supabase.from('products').select(colonne, { count: 'exact', head: true })
    ).eq('status', 'available');
    q = applicaFiltriComuni(q, d, categorie, pagato, scontatiSotto);
    if (termine) q = q.ilike('name', `%${termine}%`);
    if (blocco) q = q.in('id', blocco);
    return q;
  };
  // R02-010 — Il taglio sugli id col voto a blocchi anche qui: i blocchi non si sovrappongono
  // (id unici), quindi i conti si sommano.
  const blocchi = d.idsColVoto !== undefined ? inBlocchi([...new Set(d.idsColVoto)]) : [undefined];
  let totale = 0;
  for (const blocco of blocchi) {
    let { count, error } = await conta(blocco);
    for (;;) {
      if (!error) break;
      // R21-003 — La stessa strada della lista: si conta sul prezzo pieno solo se `prezzo_pagato` manca o
      // ha superato il tempo (57014), e da lì anche la lista legge sul prezzo pieno. Un altro errore non
      // cambia il prezzo su cui si conta: il numero sopra la griglia deve tornare con la lista.
      if (pagato && prezzoPagatoNonVa(error)) {
        pagato = false;
        if (mancaPrezzoPagato(error)) segnaSenzaPrezzoPagato(supabase);
        else tempoScaduto = true;
        scontatiSotto = await scontatiSenzaPagato();
      } else if (!senzaAggancio) {
        // Su una HEAD postgrest-js non dà il codice dell'errore (solo `message: ""`): il ripiego
        // dell'aggancio scatta su QUALSIASI altro errore della lettura agganciata, mai sul codice.
        senzaAggancio = true;
      } else break;
      ({ count, error } = await conta(blocco));
    }
    if (error || count == null) return null;
    totale += count;
  }
  if (tempoScaduto) segnaSenzaPrezzoPagato(supabase);
  return totale;
}
