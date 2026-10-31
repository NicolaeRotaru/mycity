import { chiediConTetto } from '@/lib/auth/decisione-portiere';

/**
 * La versione dei testi legali che l'utente sta accettando.
 *
 * Sta in un file suo perché la usano tre punti che prima non si parlavano: il
 * modulo di registrazione, il pulsante Google e la pagina di accettazione per
 * chi è entrato senza passare da nessuno dei due. Quando i testi cambiano, qui
 * si alza il numero e da quel momento le nuove accettazioni portano la versione
 * nuova — che è l'unica cosa che serve il giorno in cui qualcuno contesta una
 * condizione.
 *
 * 31/10/2026 (ondata 6) — terms-3.0: commissione IVA inclusa e canone sospeso, pagamenti
 * come sono al lancio (contanti, bonifico al negozio ogni lunedì), esclusi dal recesso,
 * destinatario del modulo di recesso. La pagina dei Termini stampa questo numero.
 */
export const VERSIONE_TESTI_LEGALI = 'privacy-2.0+terms-3.0';

/**
 * 31/10/2026 (ondata 6) — CHI HA ACCETTATO I TERMINI VECCHI LI RIACCETTA.
 *
 * Fatto legale.termini-riaccettazione (Nicola, 31/10): quando i Termini
 * cambiano, chi è già iscritto li riaccetta prima di ordinare. Fino a oggi
 * «ha accettato» voleva dire solo `profiles.tos_accepted_at` pieno: una data,
 * nessuna versione. Maria, iscritta il 1/9 coi Termini 2.0, arrivava al
 * pagamento sotto i 3.0 senza averli mai visti, e il suo «accetto» riceveva
 * «già accettato» senza nessuna riga nuova. La versione vera sta nell'ultima
 * riga `privacy_terms` del verbale (`consent_log`): si guarda quella.
 */
export function eLaVersioneInVigore(versione: string | null | undefined): boolean {
  return typeof versione === 'string' && versione.trim() === VERSIONE_TESTI_LEGALI;
}

type RigaVerbale = { versione_testo?: string | null } | null;
type LetturaVerbale = {
  select(colonne: string): {
    eq(colonna: string, valore: string): {
      eq(colonna: string, valore: string): {
        order(colonna: string, opzioni: { ascending: boolean }): {
          limit(n: number): { maybeSingle(): PromiseLike<{ data: RigaVerbale; error?: unknown }> };
        };
      };
    };
  };
};

/** Basta un client con le tabelle: quello di servizio, o quello della persona (legge le sue righe). */
export type ClientConVerbale = { from(tabella: string): unknown };

/**
 * L'ultima versione dei testi messa a verbale per questa persona.
 * `null` = nessuna riga. Se la lettura si rompe lancia: «non lo so» non è «nessuna riga».
 */
export async function ultimaVersioneAVerbale(client: ClientConVerbale, utenteId: string): Promise<string | null> {
  const { data, error } = await (client.from('consent_log') as LetturaVerbale)
    .select('versione_testo')
    .eq('user_id', utenteId)
    .eq('categoria', 'privacy_terms')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.versione_testo === 'string' ? data.versione_testo : null;
}

/** Quanto si aspetta il verbale prima di lasciar passare comunque: lo stesso tetto delle porte d'ingresso. */
export const TETTO_RIACCETTAZIONE_MS = 2000;

/**
 * `chiedi` = a verbale c'è un'accettazione, ma di testi che non sono più in vigore.
 * `lascia-entrare` = ha accettato quelli in vigore, oppure non c'è nessuna riga: chi
 * non ha mai accettato lo fermano già le porte d'ingresso, e un verbale che la
 * persona non riesce a leggere non deve diventare un giro senza fine fra il
 * pagamento e la pagina che chiede.
 * `scaduto` / `rotto` = non lo sappiamo: si passa, e si richiede la volta dopo.
 */
export type EsitoRiaccettazione = 'chiedi' | 'lascia-entrare' | 'scaduto' | 'rotto';

export async function vaRiaccettataSenzaTrattenere(
  client: () => ClientConVerbale,
  utenteId: string,
  ms: number = TETTO_RIACCETTAZIONE_MS,
): Promise<EsitoRiaccettazione> {
  const r = await chiediConTetto(() => ultimaVersioneAVerbale(client(), utenteId), ms);
  if (r.stato !== 'ok') return r.stato;
  return r.valore !== null && !eLaVersioneInVigore(r.valore) ? 'chiedi' : 'lascia-entrare';
}
