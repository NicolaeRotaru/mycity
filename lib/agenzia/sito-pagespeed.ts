import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  indirizzoPageSpeed,
  inizioDelGiornoDiPiacenza,
  leggiRisultatoSito,
  riassumiPageSpeed,
  sitoDaRifare,
  type RisultatoSito,
} from './analisi';

/**
 * L'ANALISI DEL SITO CON GOOGLE PAGESPEED, IN UN POSTO SOLO — 25/11/2026.
 *
 * Prima la faceva solo /api/seller/analisi-sito, quando il titolare la chiedeva. Nicola, 25/11: «aggiungi
 * anche google pagespeed, così se il sito c'è […] il preventivo si basa sul suo sito». Adesso la fanno
 * anche le porte di n8n (la scheda del cliente, il negozio nuovo dal modulo 12) appena conoscono il sito.
 *
 * Le regole restano quelle del 24/11: gratuito, un tentativo al giorno per negozio (giorno di Piacenza),
 * riuscito o no; se lo stesso sito è già stato analizzato oggi si restituisce quello, senza richiamare Google.
 */

export const ATTESA_PAGESPEED_MS = 55_000;

export type EsitoSito =
  | { ok: true; sito: RisultatoSito; giaFattaOggi: boolean }
  | { ok: false; motivo: 'gia-tentato-oggi' | 'google-male' | 'google-lento' | 'nessun-risultato' | 'guasto' };

export async function analizzaSitoConGoogle(
  admin: SupabaseClient,
  idAttivita: string,
  sito: string,
  opzioni: { adesso?: Date; fetchFn?: typeof fetch } = {},
): Promise<EsitoSito> {
  const adesso = opzioni.adesso ?? new Date();
  const fetchFn = opzioni.fetchFn ?? fetch;

  const salvata = await admin.from('analisi_negozi').select('sito, sito_il').eq('id_attivita', idAttivita).maybeSingle();
  if (salvata.error) {
    logger.error('[pagespeed] analisi salvata non letta', { idAttivita, message: salvata.error.message });
    return { ok: false, motivo: 'guasto' };
  }
  const riga = salvata.data as { sito: unknown; sito_il: string | null } | null;
  const giaFatto = leggiRisultatoSito(riga?.sito);
  if (giaFatto && giaFatto.url === sito && !sitoDaRifare(riga?.sito_il, adesso)) return { ok: true, sito: giaFatto, giaFattaOggi: true };

  // Il tetto, contato sui tentativi: prima la riga del negozio, poi una sola scrittura che segna il
  // tentativo solo se l'ultimo è di un giorno prima. Se non segna niente, oggi Google è già stato chiamato.
  const seNonC = await admin.from('analisi_negozi').upsert({ id_attivita: idAttivita }, { onConflict: 'id_attivita', ignoreDuplicates: true });
  const tentativo = seNonC.error
    ? seNonC
    : await admin
        .from('analisi_negozi')
        .update({ sito_tentato_il: adesso.toISOString() })
        .eq('id_attivita', idAttivita)
        .or(`sito_tentato_il.is.null,sito_tentato_il.lt.${inizioDelGiornoDiPiacenza(adesso)}`)
        .select('id_attivita');
  if (tentativo.error) {
    logger.error('[pagespeed] tentativo non segnato', { idAttivita, message: tentativo.error.message });
    return { ok: false, motivo: 'guasto' };
  }
  if (!((tentativo.data as unknown[] | null) ?? []).length) return { ok: false, motivo: 'gia-tentato-oggi' };

  let json: unknown;
  try {
    const risposta = await fetchFn(indirizzoPageSpeed(sito, process.env.PAGESPEED_API_KEY?.trim() || null), {
      signal: AbortSignal.timeout(ATTESA_PAGESPEED_MS),
      cache: 'no-store',
    });
    json = await risposta.json().catch(() => null);
    if (!risposta.ok) {
      logger.warn('[pagespeed] Google ha risposto male', { idAttivita, status: risposta.status });
      return { ok: false, motivo: 'google-male' };
    }
  } catch (errore) {
    logger.warn('[pagespeed] Google non ha risposto', { idAttivita, errore: String(errore) });
    return { ok: false, motivo: 'google-lento' };
  }
  const risultato = riassumiPageSpeed(json, sito, adesso);
  if (!risultato) return { ok: false, motivo: 'nessun-risultato' };

  const { error } = await admin
    .from('analisi_negozi')
    .upsert({ id_attivita: idAttivita, sito: risultato, sito_il: risultato.fatta_il, aggiornata_il: risultato.fatta_il }, { onConflict: 'id_attivita' });
  if (error) logger.warn('[pagespeed] risultato non salvato', { idAttivita, message: error.message });
  return { ok: true, sito: risultato, giaFattaOggi: false };
}

/**
 * Le porte di n8n non aspettano Google (fino a 55 secondi): rispondono subito e l'analisi parte dopo la
 * risposta, con `after` di Next. Fuori da una richiesta (le prove) `after` non c'è: si lancia e basta.
 * Un errore qui finisce nel log e non tocca la risposta già data.
 */
export function analizzaSitoDopoLaRisposta(admin: SupabaseClient, idAttivita: string, sito: string, avvia: (fn: () => Promise<void>) => void): void {
  const lavoro = async () => {
    try {
      const esito = await analizzaSitoConGoogle(admin, idAttivita, sito);
      logger.info('[pagespeed] analisi del sito del cliente', { idAttivita, esito: esito.ok ? 'fatta' : esito.motivo });
    } catch (errore) {
      logger.warn('[pagespeed] analisi del sito non riuscita', { idAttivita, errore: String(errore) });
    }
  };
  try {
    avvia(lavoro);
  } catch {
    void lavoro();
  }
}
