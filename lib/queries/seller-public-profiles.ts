import { conRipiegoSchema, senzaColonne, stessaFormaDi, COLONNE_124_VISTA } from '@/lib/db/migrazione-124';
import { logger } from '@/lib/logger';
import { leggiInBlocchi } from '@/lib/supabase/blocchi';

/**
 * IL NEGOZIO PUBBLICO SI LEGGE DALLA VETRINA, NON DALLA TABELLA DEI PROFILI.
 *
 * 15/10/2026 (R3) — Il catalogo agganciava il negozio alla tabella `profiles`
 * dentro la stessa lettura del prodotto (`profiles!products_seller_id_fkey`).
 * Funzionava solo perche' in produzione e' ancora viva la regola «chiunque legge
 * i negozi approvati», riaperta dal ripasso del 9 settembre. La migrazione 161,
 * che aspetta la firma, la toglie: da li' `profiles` si legge solo per la propria
 * riga o da amministratore. Per un cliente, con o senza account, l'aggancio
 * sarebbe tornato vuoto — e ogni scheda prodotto avrebbe detto «il negozio non
 * e' operativo», le fasce della home si sarebbero svuotate. Dentro casa nessuno
 * se ne sarebbe accorto: il negoziante e l'amministratore la propria riga la
 * leggono sempre.
 *
 * La strada giusta e' la vista `seller_public_profiles`: gira coi permessi di chi
 * l'ha creata, mostra solo i negozi approvati e solo le colonne da vetrina, e
 * funziona uguale prima e dopo la 161. Qui ci sono le due mosse che servono a
 * tutto il catalogo: leggere i negozi di un gruppo di righe in UNA domanda, e
 * tenere solo le righe dei negozi approvati.
 *
 * ⚠️ Le colonne chieste alla vista devono esistere ANCHE in produzione, dove la
 * migrazione 126 (ragione sociale, partita IVA, sede) non e' applicata: PostgREST
 * fa fallire la domanda intera per una sola colonna che non c'e'. Le colonne
 * d'impresa le chiede solo «Venduto da», che ha il suo ripiego.
 */

/** Il minimo che serve per leggere: va bene il client del browser e quello del server. */
export type LettoreVista = {
  // I client Supabase hanno tipi generati diversi fra browser e server: qui
  // serve solo la forma della chiamata.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tabella: string) => any;
};

/** Colonne vetrina esposte da seller_public_profiles (migration 107). */
export type SellerPublicProfile = {
  id: string;
  store_name: string | null;
  store_address?: string | null;
  store_lat?: number | null;
  store_lng?: number | null;
  store_phone?: string | null;
  store_logo?: string | null;
  store_hours?: unknown;
  store_media?: unknown;
  store_description?: string | null;
  is_approved?: boolean;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  role?: string | null;
  offers_express?: boolean | null;
  founded_year?: number | null;
  created_at?: string;
};

const PUBLIC_SELLER_SELECT =
  'id, store_name, store_address, store_lat, store_lng, store_phone, store_logo, store_hours, store_media, store_description, is_approved, stripe_charges_enabled, stripe_payouts_enabled, role, offers_express, founded_year, created_at';

/** Quello che serve a una fascia di prodotti: chi vende e se e' approvato. */
export const COLONNE_NEGOZIO_IN_VETRINA = 'id, store_name, is_approved';

/**
 * Aggiunge alla select le colonne senza cui il lettore non funziona.
 *
 * `id` e' la chiave con cui ogni riga ritrova il suo negozio: una select che non
 * la chiede produce una mappa vuota, e ogni prodotto sembra di un negozio non
 * approvato — la vetrina si svuota senza un errore. `is_approved` e' quello su
 * cui si filtra. Dimenticarne una non deve poter spegnere il catalogo.
 */
function conColonneIndispensabili(select: string): string {
  const colonne = select.split(',').map((c) => c.trim()).filter(Boolean);
  for (const necessaria of ['is_approved', 'id']) {
    if (!colonne.includes(necessaria)) colonne.unshift(necessaria);
  }
  return colonne.join(', ');
}

/**
 * Le colonne che una domanda alla vetrina chiede davvero, in un ordine fisso: «id, store_name» e
 * «store_name, id, is_approved» sono la stessa domanda. È la chiave delle domande in volo qui sotto
 * e della memoria nei chiamanti (lib/queries/vetrina-con-memoria.ts, R09-008).
 */
export function colonneDellaDomanda(select: string): string {
  return [...new Set(conColonneIndispensabili(select).split(',').map((c) => c.trim()))].sort().join(',');
}

/**
 * R09-008 — Chi legge i negozi della vetrina per un chiamante: per difetto `fetchSellerPublicMap`;
 * le sezioni della home passano quello con la memoria di React Query (lib/queries/vetrina-con-memoria.ts).
 */
export type LettoreNegozi = (
  sellerIds: Array<string | null | undefined>,
  select: string,
) => Promise<Map<string, SellerPublicProfile>>;

/**
 * 12/11/2026 (R06-009) — LE DOMANDE IN VOLO PER LO STESSO NEGOZIO SI UNISCONO.
 *
 * In home ogni sezione (Drop del giorno, storie, Ordina di nuovo, fasce,
 * tendenze, negozio del mese…) chiedeva alla vetrina gli stessi negozi, ognuna
 * per conto suo. Qui, nel browser, una domanda gia' in volo per lo stesso negozio
 * (stesso client, stesse colonne) si aspetta invece di rifarla, e si chiedono
 * solo i negozi che mancano.
 *
 * Una memoria che duri qualche minuto, come proponeva la voce, qui non si tiene:
 * il modulo non sa quando i dati diventano vecchi (un negozio sospeso, una vista
 * che cade), e chi lo sa e' la cache di React Query dei chiamanti. Quella parte
 * resta da fare nei componenti che chiamano (referto R06).
 *
 * Solo nel browser: sul server una mappa del modulo vive fra richieste di persone
 * diverse.
 */
type VoliDelClient = Map<string, Promise<SellerPublicProfile | null>>;
const voliPerClient = new WeakMap<object, VoliDelClient>();

function voliDi(supabase: LettoreVista): VoliDelClient | null {
  if (typeof window === 'undefined') return null;
  let v = voliPerClient.get(supabase);
  if (!v) {
    v = new Map();
    voliPerClient.set(supabase, v);
  }
  return v;
}

/** Carica le vetrine pubbliche per un insieme di seller id (batch). */
export async function fetchSellerPublicMap(
  supabase: LettoreVista,
  sellerIds: Array<string | null | undefined>,
  select = PUBLIC_SELLER_SELECT,
): Promise<Map<string, SellerPublicProfile>> {
  const unique = [...new Set(sellerIds.filter((s): s is string => !!s))];
  const voli = voliDi(supabase);
  if (!voli || unique.length === 0) return leggiDallaVista(supabase, unique, select);

  // 22/11/2026 (R15-007) — La chiave sono le colonne che la domanda chiede davvero, senza badare
  // all'ordine: «id, store_name» (Drop del giorno, Ordina di nuovo) e «id, store_name, is_approved»
  // (le fasce) diventano la stessa domanda (`conColonneIndispensabili` aggiunge is_approved a tutte),
  // e si uniscono. Colonne diverse restano domande diverse.
  const colonne = colonneDellaDomanda(select);
  const chiave = (id: string) => `${colonne}|${id}`;
  const daChiedere = unique.filter((id) => !voli.has(chiave(id)));
  if (daChiedere.length > 0) {
    const lettura = leggiDallaVista(supabase, daChiedere, select);
    for (const id of daChiedere) {
      const k = chiave(id);
      const volo = lettura.then((letti) => letti.get(id) ?? null);
      voli.set(k, volo);
      // Atterrato (bene o male), il volo si toglie: la prossima domanda va al database.
      void volo.then(
        () => { if (voli.get(k) === volo) voli.delete(k); },
        () => { if (voli.get(k) === volo) voli.delete(k); },
      );
    }
  }
  // Una lettura caduta risale a chi chiama, come prima: niente mappa vuota «senza errore».
  const righe = await Promise.all(unique.map((id) => voli.get(chiave(id)) ?? Promise.resolve(null)));
  const map = new Map<string, SellerPublicProfile>();
  unique.forEach((id, i) => {
    const riga = righe[i];
    if (riga) map.set(id, riga);
  });
  return map;
}

async function leggiDallaVista(
  supabase: LettoreVista,
  unique: string[],
  select: string,
): Promise<Map<string, SellerPublicProfile>> {
  const map = new Map<string, SellerPublicProfile>();
  if (unique.length === 0) return map;

  const colonne = conColonneIndispensabili(select);

  // 22/8/2026 — `stripe_charges_enabled` e `stripe_payouts_enabled` arrivano
  // sulla vista con la migrazione 124. Prima di quella, PostgREST rifiuta la
  // select intera: qui l'errore veniva rilanciato, quindi ogni pagina che
  // passa da questo lettore — prodotti, ordini, vetrine — si fermava del tutto
  // invece di mostrarsi senza due bandierine.
  // R15-014 — Gli id vanno nell'indirizzo (circa 37 caratteri l'uno): un solo `.in` con oltre
  // ~216 negozi diversi dava 414. Si legge a blocchi da cento e le righe si riuniscono; un
  // blocco che cade fa cadere la lettura intera, come prima.
  const conBandierine = (): PromiseLike<{ data: unknown; error: unknown }> =>
    leggiInBlocchi<SellerPublicProfile>(unique, (blocco) =>
      supabase.from('seller_public_profiles').select(colonne).in('id', blocco),
    );
  const { data, error } = await conRipiegoSchema(
    'fetchSellerPublicMap',
    conBandierine,
    () =>
      stessaFormaDi<Awaited<ReturnType<typeof conBandierine>>>(
        leggiInBlocchi<SellerPublicProfile>(unique, (blocco) =>
          supabase
            .from('seller_public_profiles')
            .select(senzaColonne(colonne, COLONNE_124_VISTA))
            .in('id', blocco),
        ),
      ),
  );
  if (error) throw error;

  const rows = (data ?? []) as unknown as SellerPublicProfile[];
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

/** Attacca `profiles` (compat embed) da seller_public_profiles su prodotti/ordini. */
export function attachSellerProfiles<T extends { seller_id?: string | null }>(
  rows: T[],
  sellerMap: Map<string, SellerPublicProfile>,
): Array<T & { profiles: SellerPublicProfile | null }> {
  return rows.map((row) => ({
    ...row,
    profiles: row.seller_id ? sellerMap.get(row.seller_id) ?? null : null,
  }));
}

/** Il negozio letto dalla vetrina e' approvato? Solo un `true` vero conta. */
export function negozioApprovato(negozio: { is_approved?: boolean | null } | null | undefined): boolean {
  return negozio?.is_approved === true;
}

/**
 * Le righe con il loro negozio, e solo quelle dei negozi approvati.
 *
 * Una domanda sola alla vista per tutte le righe, qualunque sia il loro numero:
 * e' quello che rende possibile togliere l'aggancio a `profiles` dalle fasce
 * senza moltiplicare i viaggi di rete. Un negozio che la vista non restituisce
 * — non approvato, sospeso, senza insegna — porta fuori i suoi prodotti: nessuno
 * deve poter comprare da un negozio che non e' operativo.
 */
export async function conNegozioApprovato<T extends { seller_id?: string | null }>(
  supabase: LettoreVista,
  rows: T[],
  select = COLONNE_NEGOZIO_IN_VETRINA,
  leggiNegozi?: LettoreNegozi,
): Promise<Array<T & { profiles: SellerPublicProfile }>> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.seller_id);
  const negozi = await (leggiNegozi ? leggiNegozi(ids, select) : fetchSellerPublicMap(supabase, ids, select));
  return attachSellerProfiles(rows, negozi).filter(
    (r): r is T & { profiles: SellerPublicProfile } => negozioApprovato(r.profiles),
  );
}

/**
 * I NOMI DELLE PERSONE CHE ALTRI DEVONO LEGGERE SI LEGGONO DALLA VISTA, NON DA `profiles`.
 *
 * 31/10/2026 (ondata 1, migrazione 164) — Il nome del fattorino (al cliente e al negozio del suo
 * ordine), chi ha scritto una domanda sotto un prodotto, chi ha scritto una recensione al negozio:
 * tutti e tre si leggevano da `profiles`. Dopo le migrazioni 110, 112 e 161 quella tabella si legge
 * solo per la propria riga, e la lettura torna vuota SENZA errore: «Il tuo rider», «Cliente» per tutti.
 *
 * Qui una domanda sola alla vista `nomi_pubblici` per tutti gli id. Torna solo il nome di battesimo.
 * Prima che la 164 sia applicata la vista non c'e': si legge `profiles` come oggi, e l'avviso nei
 * registri dice che il ripiego e' in corso. Un nome e' un dettaglio: se la lettura cade, la pagina
 * resta in piedi senza nomi e l'errore va nei registri — non si butta.
 */
export const VISTA_NOMI_PUBBLICI = 'nomi_pubblici';

/** La prima parola del nome: mai il cognome. */
export function nomeDiBattesimo(nome: string | null | undefined): string | null {
  const primo = (nome ?? '').trim().split(/\s+/)[0];
  return primo ? primo : null;
}

/** La vista non esiste ancora (migrazione 164 non applicata): PostgREST dice PGRST205, Postgres 42P01. */
function vistaNonAncoraCreata(errore: unknown): boolean {
  const code = (errore as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
}

/** L'avviso «vista assente» è già nel registro di questo processo. */
let avvisoSenzaLaVistaDato = false;

/** id -> nome di battesimo, per le persone che chi legge puo' vedere. Gli id senza nome mancano. */
export async function fetchNomiPubblici(
  supabase: LettoreVista,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unici = [...new Set(ids.filter((i): i is string => !!i))];
  const nomi = new Map<string, string>();
  if (unici.length === 0) return nomi;

  let righe: Array<{ id: string; nome: string | null }>;
  const vista = await supabase.from(VISTA_NOMI_PUBBLICI).select('id, nome').in('id', unici);
  if (!vista.error) {
    righe = (vista.data ?? []) as Array<{ id: string; nome: string | null }>;
  } else if (vistaNonAncoraCreata(vista.error)) {
    // R15-004 — L'avviso si scrive una volta per processo, come quello della 181: finché la vista manca
    // diceva la stessa cosa a ogni chiamata. Il ripiego su `profiles` lavora comunque a ogni chiamata.
    if (!avvisoSenzaLaVistaDato) {
      avvisoSenzaLaVistaDato = true;
      logger.warn('[nomi] vista nomi_pubblici assente (migrazione 164 non applicata): leggo profiles', vista.error);
    }
    const vecchia = await supabase.from('profiles').select('id, full_name').in('id', unici);
    if (vecchia.error) {
      logger.warn('[nomi] nomi non letti nemmeno da profiles: le firme restano generiche', vecchia.error);
      return nomi;
    }
    righe = ((vecchia.data ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => ({ id: p.id, nome: p.full_name }));
  } else {
    logger.warn('[nomi] vista nomi_pubblici non letta: le firme restano generiche', vista.error);
    return nomi;
  }

  for (const r of righe) {
    const nome = nomeDiBattesimo(r.nome);
    if (nome) nomi.set(r.id, nome);
  }
  return nomi;
}

/**
 * 22/11/2026 (R15-014) — IL NEGOZIO LEGGE IL NOME DEI SUOI CLIENTI ANCHE PRIMA DELLA 181.
 *
 * Il nome del cliente, per il negozio (chat, recensioni), lo dà la funzione della migrazione 181
 * `nomi_dei_clienti_del_negozio`. Nel database vero la funzione non c'è ancora: PostgREST risponde
 * «funzione non trovata» e il negoziante legge «Cliente» al posto di Maria.
 *
 * Il ripiego, SOLO quando la funzione manca: il nome di consegna scritto sugli ordini
 * (`orders.delivery_full_name`) di quelle persone. Si legge col client di chi guarda, quindi con le sue
 * regole: il negozio trova solo gli ordini fatti a lui, cioè i nomi che vede già nelle pagine Ordini e
 * Clienti. Niente `profiles`, niente tabelle che non leggeva già. Chi gli ha solo scritto in chat, senza
 * mai ordinare, resta «Cliente» finché la 181 non c'è.
 *
 * Un nome è un dettaglio: se la lettura cade, la mappa è vuota e l'errore va nei registri.
 */
export const FUNZIONE_NOMI_DEI_CLIENTI = 'nomi_dei_clienti_del_negozio';

/** Come `LettoreVista`, più le funzioni del database. */
export type LettoreConFunzioni = LettoreVista & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (nome: string, argomenti: Record<string, unknown>) => any;
};

/** Il tetto di righe di ogni lettura degli ordini nel ripiego senza la 181. */
const RIGHE_PER_LETTURA_DEGLI_ORDINI = 1000;

/** L'avviso «funzione assente» è già nel registro di questo processo. */
let avvisoSenzaLaFunzioneDato = false;

/** La funzione non esiste ancora (migrazione non applicata): PostgREST dice PGRST202, Postgres 42883. */
function funzioneNonAncoraCreata(errore: unknown): boolean {
  const code = (errore as { code?: string } | null)?.code;
  return code === 'PGRST202' || code === '42883';
}

/** id -> nome del cliente, per le persone che chi guarda ha davanti. Gli id senza nome mancano. */
export async function fetchNomiDeiClienti(
  supabase: LettoreConFunzioni,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unici = [...new Set(ids.filter((i): i is string => !!i))];
  const nomi = new Map<string, string>();
  if (unici.length === 0) return nomi;

  let righe: Array<{ id: string; full_name: string | null }>;
  try {
    const { data, error } = await supabase.rpc(FUNZIONE_NOMI_DEI_CLIENTI, { p_ids: unici });
    if (!error) {
      righe = (data ?? []) as Array<{ id: string; full_name: string | null }>;
    } else if (funzioneNonAncoraCreata(error)) {
      // 24/11/2026 — L'avviso si scrive una volta, non a ogni apertura della chat o delle recensioni:
      // finché la funzione manca diceva la stessa cosa a ogni chiamata, solo rumore nel registro.
      if (!avvisoSenzaLaFunzioneDato) {
        avvisoSenzaLaFunzioneDato = true;
        logger.warn('[nomi] funzione nomi_dei_clienti_del_negozio assente (migrazione 181 non applicata): leggo il nome di consegna degli ordini', error);
      }
      // 24/11/2026 — Il tetto di 1000 righe valeva per tutti gli id insieme: un cliente con mille
      // ordini recenti nascondeva chi aveva ordinato una volta, tempo fa. A pagina piena si cercano
      // ancora gli id che non sono usciti; chi è uscito ha già letto i suoi ordini più recenti.
      righe = [];
      let daCercare = unici;
      while (daCercare.length > 0) {
        const ordini = await supabase
          .from('orders')
          .select('user_id, delivery_full_name')
          .in('user_id', daCercare)
          .order('created_at', { ascending: false })
          .limit(RIGHE_PER_LETTURA_DEGLI_ORDINI);
        if (ordini.error) {
          logger.warn('[nomi] nomi dei clienti non letti nemmeno dagli ordini: si legge «Cliente»', ordini.error);
          break;
        }
        const lette = ((ordini.data ?? []) as Array<{ user_id: string | null; delivery_full_name: string | null }>)
          .filter((o): o is { user_id: string; delivery_full_name: string | null } => !!o.user_id)
          .map((o) => ({ id: o.user_id, full_name: o.delivery_full_name }));
        righe.push(...lette);
        if ((ordini.data ?? []).length < RIGHE_PER_LETTURA_DEGLI_ORDINI) break;
        const usciti = new Set(lette.map((r) => r.id));
        const restano = daCercare.filter((id) => !usciti.has(id));
        if (restano.length === daCercare.length) break;
        daCercare = restano;
      }
    } else {
      logger.warn('[nomi] nomi dei clienti non letti: si legge «Cliente»', error);
      return nomi;
    }
  } catch (e) {
    logger.warn('[nomi] nomi dei clienti non letti: si legge «Cliente»', e);
    return nomi;
  }

  // Il primo nome trovato vince: dagli ordini è quello dell'ordine più recente.
  for (const r of righe) {
    const nome = (r.full_name ?? '').trim();
    if (nome && unici.includes(r.id) && !nomi.has(r.id)) nomi.set(r.id, nome);
  }
  return nomi;
}
