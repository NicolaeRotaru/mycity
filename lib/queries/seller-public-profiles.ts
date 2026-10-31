import { conRipiegoSchema, senzaColonne, stessaFormaDi, COLONNE_124_VISTA } from '@/lib/db/migrazione-124';
import { logger } from '@/lib/logger';

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

/** Carica le vetrine pubbliche per un insieme di seller id (batch). */
export async function fetchSellerPublicMap(
  supabase: LettoreVista,
  sellerIds: Array<string | null | undefined>,
  select = PUBLIC_SELLER_SELECT,
): Promise<Map<string, SellerPublicProfile>> {
  const unique = [...new Set(sellerIds.filter((s): s is string => !!s))];
  const map = new Map<string, SellerPublicProfile>();
  if (unique.length === 0) return map;

  const colonne = conColonneIndispensabili(select);

  // 22/8/2026 — `stripe_charges_enabled` e `stripe_payouts_enabled` arrivano
  // sulla vista con la migrazione 124. Prima di quella, PostgREST rifiuta la
  // select intera: qui l'errore veniva rilanciato, quindi ogni pagina che
  // passa da questo lettore — prodotti, ordini, vetrine — si fermava del tutto
  // invece di mostrarsi senza due bandierine.
  const conBandierine = (): PromiseLike<{ data: unknown; error: unknown }> =>
    supabase.from('seller_public_profiles').select(colonne).in('id', unique);
  const { data, error } = await conRipiegoSchema(
    'fetchSellerPublicMap',
    conBandierine,
    () =>
      stessaFormaDi<Awaited<ReturnType<typeof conBandierine>>>(
        supabase
          .from('seller_public_profiles')
          .select(senzaColonne(colonne, COLONNE_124_VISTA))
          .in('id', unique),
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
): Promise<Array<T & { profiles: SellerPublicProfile }>> {
  if (rows.length === 0) return [];
  const negozi = await fetchSellerPublicMap(supabase, rows.map((r) => r.seller_id), select);
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
    logger.warn('[nomi] vista nomi_pubblici assente (migrazione 164 non applicata): leggo profiles', vista.error);
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
