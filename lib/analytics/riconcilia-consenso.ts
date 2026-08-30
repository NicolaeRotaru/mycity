import { logger } from '@/lib/logger';

/**
 * 27/8/2026 (R159) — IL «SÌ» DATO DA ANONIMO NON VALEVA PIÙ DOPO L'ACCESSO.
 *
 * L'acquisto (`order_placed`) parte solo dal server, e il server lo manda solo
 * se la persona ha detto sì all'analitica. Il consenso però lo si cerca per
 * `user_id`, mentre chi accetta il banner PRIMA di avere un account — cioè il
 * percorso normale: si arriva sul sito, si accettano i cookie, poi ci si
 * registra per comprare — viene registrato con `anon_id` e `user_id` a NULL.
 * Il banner non ricompare più (sei mesi), e nessun codice collegava mai i due.
 *
 * Risultato: l'ordine c'è nel database e non c'è in PostHog. Non «qualche
 * volta»: quasi sempre. Ogni tasso di conversione e ogni ritorno di campagna
 * poggia su un fatturato che non esiste — e diventa un bloccante il giorno in
 * cui parte spesa pubblicitaria vera, perché il budget si decide su quel
 * numero.
 *
 * La cucitura si fa quando la persona compra, che è il momento in cui l'account
 * c'è di sicuro e il browser manda ancora i suoi cookie: le righe anonime di
 * QUESTO browser prendono il nome di chi le ha scritte. Non si aggiunge nessun
 * consenso e non se ne cambia il valore: un no resta un no.
 *
 * Best-effort per costruzione: una misura non deve mai far fallire un ordine.
 */

/**
 * Il tipo minimo di client che serve: la stessa forma che usa
 * `analyticsConsentita` qui accanto, così il tipo generato di Supabase non
 * entra in questo file.
 */
type ClientAmministratore = {
  from: (tabella: string) => any;
};

/**
 * Gli identificativi anonimi che questo browser porta con sé.
 *
 * `mc_vid` nasce quando qualcuno accetta l'analitica; `mc_cid` lo scrive la
 * rotta dei consensi quando `mc_vid` non c'è (serve solo al registro). Sono i
 * due valori che finiscono in `consent_log.anon_id`.
 */
export function identificativiAnonimi(cookie: string | null | undefined): string[] {
  const testo = cookie ?? '';
  const trovati = [
    testo.match(/(?:^|;\s*)mc_vid=([^;]+)/)?.[1],
    testo.match(/(?:^|;\s*)mc_cid=([^;]+)/)?.[1],
  ]
    .map((v) => (v ?? '').trim())
    .filter((v) => v.length > 0 && v.length <= 100);
  return Array.from(new Set(trovati));
}

/**
 * Attacca alla persona i consensi che aveva dato da anonima su questo browser.
 * Non tocca le righe che hanno già un proprietario.
 */
export async function collegaConsensiAnonimi(
  admin: ClientAmministratore,
  userId: string | null | undefined,
  anonIds: string[],
): Promise<void> {
  if (!userId || anonIds.length === 0) return;
  try {
    const { error } = await admin
      .from('consent_log')
      .update({ user_id: userId })
      .is('user_id', null)
      .in('anon_id', anonIds);
    if (error) {
      logger.warn('[analytics] consensi anonimi non collegati alla persona', {
        userId, message: error.message,
      });
    }
  } catch (e) {
    logger.warn('[analytics] consensi anonimi non collegati alla persona', { userId, e });
  }
}
