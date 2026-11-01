import { logger } from '@/lib/logger';

/**
 * 1/11/2026 — SE GLI ORDINI SI CONSEGNANO E LA POSTA D'ORDINE NON NASCE, LO SI DICE.
 *
 * «Ordine pronto» e «ordine consegnato» non li mette in coda il codice: li scrive
 * in `email_queue` un trigger del database (`trg_enqueue_order_status_email`,
 * migrazione 150). Il giro della coda spedisce solo quello che trova. Se il
 * trigger non c'e' (database indietro con le migrazioni) o se fallisce — e
 * fallisce in silenzio di proposito, `EXCEPTION WHEN OTHERS THEN NULL`, perche'
 * la posta non deve fermare un ordine — la coda resta vuota, il giro risponde
 * «sent: 0» e nessuno se ne accorge: e' la stessa risposta di un giorno senza
 * ordini.
 *
 * Il codice non sa leggere i trigger del database (PostgREST non vede il
 * catalogo, e una funzione apposta sarebbe un'altra migrazione da applicare).
 * Guarda pero' le due cose che il trigger lega insieme: se nelle ultime 24 ore
 * almeno un ordine e' stato consegnato e in coda non e' nata nessuna riga
 * `order_delivered`, la posta d'ordine e' muta. Lo scrive come errore (che va a
 * Sentry), e il giro lo riporta nella sua risposta.
 *
 * Non ripara niente: la riparazione vera e' applicare la migrazione 150.
 * Non ferma mai il giro: se le due letture non riescono, lo dice e basta.
 */

/** Quanto indietro si guarda. */
export const FINESTRA_ORE = 24;
/**
 * Un ordine consegnato da meno di cosi' non conta ancora: il trigger scrive la
 * riga nella stessa transazione, quindi basterebbe zero, ma un margine evita di
 * contare un ordine e una riga a cavallo delle due letture.
 */
export const MARGINE_MINUTI = 5;

export type EsitoSentinella =
  | { stato: 'ok'; consegnati: number; righe: number }
  | { stato: 'nessun-ordine' }
  | { stato: 'muta'; consegnati: number }
  | { stato: 'parziale'; consegnati: number; righe: number }
  | { stato: 'non-letta'; motivo: string };

type Conteggio = { count: number | null; error: { message?: string } | null };

// Acceptable any: client Supabase senza Database type, come nel giro della coda.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function controllaPostaDegliOrdini(supa: any, adesso: Date = new Date()): Promise<EsitoSentinella> {
  const da = new Date(adesso.getTime() - FINESTRA_ORE * 3_600_000).toISOString();
  const fino = new Date(adesso.getTime() - MARGINE_MINUTI * 60_000).toISOString();
  try {
    const consegnati: Conteggio = await supa
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .not('user_id', 'is', null)
      .gte('delivered_at', da)
      .lte('delivered_at', fino);
    if (consegnati.error) throw new Error(String(consegnati.error.message ?? consegnati.error));
    const n = consegnati.count ?? 0;
    if (n === 0) return { stato: 'nessun-ordine' };

    const righe: Conteggio = await supa
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('template', 'order_delivered')
      .gte('created_at', da);
    if (righe.error) throw new Error(String(righe.error.message ?? righe.error));
    const r = righe.count ?? 0;
    // Ogni consegna con un cliente scrive una riga: meno righe che consegne vuol dire che il
    // trigger ne ha perse (la sua eccezione le ingoia). Le righe nate negli ultimi 5 minuti
    // possono solo far salire il conto delle righe, quindi non danno falsi allarmi.
    if (r > 0 && r < n) {
      logger.error(
        "[cron] POSTA D'ORDINE A META': meno email «consegnato» in coda che ordini consegnati.",
        { consegnatiNelleUltime24Ore: n, righeInCoda: r },
      );
      return { stato: 'parziale', consegnati: n, righe: r };
    }
    if (r > 0) return { stato: 'ok', consegnati: n, righe: r };

    logger.error(
      "[cron] POSTA D'ORDINE MUTA: ordini consegnati ma nessuna email «consegnato» in coda. " +
        'Il trigger trg_enqueue_order_status_email (migrazione 150) manca o fallisce: applicare la migrazione.',
      { consegnatiNelleUltime24Ore: n },
    );
    return { stato: 'muta', consegnati: n };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    logger.warn("[cron] controllo della posta d'ordine non riuscito", { motivo });
    return { stato: 'non-letta', motivo };
  }
}
