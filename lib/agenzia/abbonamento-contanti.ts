import type { SupabaseClient } from '@supabase/supabase-js';
import { ABBONAMENTI, FASCE, leggiImpostazioniAgenzia, type Abbonamento } from './preventivo';

/**
 * L'ABBONAMENTO IN CONTANTI SBLOCCA LA PAGINA DEL NEGOZIO — 27/11/2026.
 *
 * Nicola, 27/11 02:26, sul riquadro «Il titolare di … ha detto sì?» della pagina dell'agente: «in questo
 * punto bisogna selezionare di che abbonamento ha scelto l'imprenditore», e «in automatico deve sbloccarsi
 * la pagina del venditore in base all'abbonamento». Le sue scelte dello stesso minuto:
 *  · la pagina si sblocca SUBITO, al «Sì» dell'agente: i contanti si ritirano dopo, al primo servizio
 *    (fatto `sdg.pagamento`). Se non paga, Nicola lo ferma lui;
 *  · lo sblocco dura FINO ALLA DISDETTA, come l'abbonamento online.
 *
 * Lo sblocco è una riga di `abbonamenti_servizi` con `origine = 'contanti'` (migrazione 999): tutto quello
 * che già si apre con un abbonamento attivo (vetrina dopo l'approvazione, scheda, rapporto, riquadro della
 * dashboard) la legge da sé, nella fascia scelta. Un negozio ne ha al massimo una in corso.
 * Il canone scritto è quello del listino (`site_settings.agenzia`, o il prezzo di Nicola nel codice): è il
 * promemoria di quanto incassare, non un addebito. Nessun soldo si muove da qui.
 */

export const fasciaValida = (v: unknown): v is Abbonamento => typeof v === 'string' && (ABBONAMENTI as readonly string[]).includes(v);

export type EsitoSblocco =
  /** Riga nuova: la pagina si apre adesso. */
  | { esito: 'sbloccata'; fascia: Abbonamento }
  /** C'era già, nella stessa fascia: niente da fare. */
  | { esito: 'gia-sbloccata'; fascia: Abbonamento }
  /** C'era già in un'altra fascia: ora è nella nuova. */
  | { esito: 'cambiata'; fascia: Abbonamento; da: Abbonamento }
  /** Ha già un abbonamento pagato online: quello vale, e qui non si scrive niente. */
  | { esito: 'gia-online'; fascia: Abbonamento }
  | { esito: 'guasto'; dettaglio: string };

const IN_CORSO = ['active', 'past_due'] as const;

/** Il canone del listino per quella fascia, in centesimi: le impostazioni dell'agenzia, o il prezzo di Nicola. */
async function canoneDiListino(admin: SupabaseClient, fascia: Abbonamento): Promise<number> {
  const { data, error } = await admin.from('site_settings').select('agenzia').eq('id', 1).maybeSingle();
  const scritto = error ? null : leggiImpostazioniAgenzia((data as { agenzia?: unknown } | null)?.agenzia).prezzi[fascia];
  // «Su richiesta» o impostazioni non lette: la colonna vuole un numero, e il promemoria resta il prezzo di Nicola.
  return scritto ?? FASCE[fascia].prezzoMese;
}

type Riga = { id: string; fascia: string; origine: string | null };

async function righeInCorso(admin: SupabaseClient, sellerId: string): Promise<{ righe: Riga[] } | { errore: string }> {
  const { data, error } = await admin
    .from('abbonamenti_servizi')
    .select('id, fascia, origine')
    .eq('seller_id', sellerId)
    .in('stato', [...IN_CORSO])
    .limit(20);
  if (error) return { errore: error.message };
  return { righe: (data ?? []) as Riga[] };
}

/**
 * Sblocca la pagina del negozio nella fascia scelta, in contanti. Si può chiamare più volte: la seconda
 * volta non crea una riga nuova, e se la fascia è cambiata la aggiorna. Non tocca mai un abbonamento Stripe.
 */
export async function sbloccaInContanti(admin: SupabaseClient, sellerId: string, fascia: Abbonamento): Promise<EsitoSblocco> {
  if (!fasciaValida(fascia)) return { esito: 'guasto', dettaglio: `fascia non valida: ${String(fascia)}` };
  const prima = await righeInCorso(admin, sellerId);
  if ('errore' in prima) return { esito: 'guasto', dettaglio: prima.errore };

  // Un abbonamento pagato online vale più di qualunque scelta a voce: non si affianca una seconda riga.
  const online = prima.righe.find((r) => (r.origine ?? 'stripe') !== 'contanti');
  if (online && fasciaValida(online.fascia)) return { esito: 'gia-online', fascia: online.fascia };

  const contanti = prima.righe.find((r) => r.origine === 'contanti');
  const adesso = new Date().toISOString();
  if (contanti) {
    if (contanti.fascia === fascia) return { esito: 'gia-sbloccata', fascia };
    const da = fasciaValida(contanti.fascia) ? contanti.fascia : fascia;
    const canone = await canoneDiListino(admin, fascia);
    const { error } = await admin
      .from('abbonamenti_servizi')
      .update({ fascia, canone_centesimi: canone, aggiornato_il: adesso })
      .eq('id', contanti.id);
    if (error) return { esito: 'guasto', dettaglio: error.message };
    return { esito: 'cambiata', fascia, da };
  }

  const canone = await canoneDiListino(admin, fascia);
  const { error } = await admin.from('abbonamenti_servizi').insert({
    seller_id: sellerId,
    fascia,
    canone_centesimi: canone,
    origine: 'contanti',
    stato: 'active',
    rinnovo_il: null,
    aggiornato_il: adesso,
  });
  if (error) {
    // Due pressioni insieme: la riga l'ha scritta l'altra (indice unico della 999). Si rilegge.
    if (String((error as { code?: string }).code) === '23505') {
      const dopo = await righeInCorso(admin, sellerId);
      const sua = 'righe' in dopo ? dopo.righe.find((r) => r.origine === 'contanti') : undefined;
      if (sua && sua.fascia === fascia) return { esito: 'gia-sbloccata', fascia };
    }
    return { esito: 'guasto', dettaglio: error.message };
  }
  return { esito: 'sbloccata', fascia };
}

/** Lo sblocco è andato a buon fine (la pagina del negozio è aperta in quella fascia, o in una pagata online). */
export const sbloccoRiuscito = (e: EsitoSblocco): e is Exclude<EsitoSblocco, { esito: 'guasto' }> => e.esito !== 'guasto';

/**
 * La scelta dell'agente sul preventivo col link (colonna `fascia_scelta`), solo finché è aperto: così il
 * link apre il preventivo su quella fascia e Admin → Preventivi col link la mostra. Quando il titolare
 * accetta, vale la sua (lib/agenzia/preventivo-col-codice.ts).
 */
export async function segnaLaSceltaSulPreventivo(admin: SupabaseClient, sellerId: string, fascia: Abbonamento): Promise<boolean> {
  const { error } = await admin.from('preventivi_con_codice').update({ fascia_scelta: fascia }).eq('seller_id', sellerId).eq('stato', 'aperto');
  return !error;
}

/**
 * Ferma l'abbonamento in contanti di un negozio (Nicola, 27/11: «se non paga, fermalo tu»; o la disdetta del
 * titolare). La riga non si cancella: passa a `canceled` e resta nello storico. La pagina torna in demo da sola,
 * perché i lettori guardano solo gli abbonamenti in corso. Un abbonamento Stripe non si tocca mai da qui.
 * Restituisce quante righe ha fermato (0 se non ce n'era una in corso), o `null` per un guasto.
 */
export async function fermaInContanti(admin: SupabaseClient, sellerId: string): Promise<number | null> {
  const { data, error } = await admin
    .from('abbonamenti_servizi')
    .update({ stato: 'canceled', aggiornato_il: new Date().toISOString() })
    .eq('seller_id', sellerId)
    .eq('origine', 'contanti')
    .in('stato', [...IN_CORSO])
    .select('id');
  if (error) return null;
  return (data ?? []).length;
}

/**
 * Il primo mese a metà vale ancora? Sì se il negozio non ha mai avuto un abbonamento, OPPURE se l'unico che ha
 * è quello in contanti in corso: è proprio il primo, sbloccato al «Sì» e non ancora pagato (collaudo del 27/11:
 * la riga scritta al «Sì» toglieva dal link il «primo mese a metà»). Un abbonamento in contanti già fermato,
 * o uno Stripe, è già stato avuto: niente sconto.
 */
export function primoMeseAncoraScontato(righe: { stato?: string | null; origine?: string | null }[]): boolean {
  return righe.every((r) => r.origine === 'contanti' && (IN_CORSO as readonly string[]).includes(String(r.stato)));
}
