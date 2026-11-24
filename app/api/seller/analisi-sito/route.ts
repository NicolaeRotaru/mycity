import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { indirizzoWebPubblico } from '@/lib/indirizzi-pubblici';
import { indirizzoPageSpeed, inizioDelGiornoDiPiacenza, leggiRisultatoSito, riassumiPageSpeed, sitoDaRifare } from '@/lib/agenzia/analisi';

export const runtime = 'nodejs';
// Google PageSpeed impiega anche 30–40 secondi a leggere un sito lento.
export const maxDuration = 60;

/**
 * L'ANALISI DEL SITO — 24/11/2026. Il titolare preme «Analizza il mio sito» nella pagina dell'analisi.
 *
 * Nicola: fonti «solo gratuite». Google PageSpeed Insights è gratuito: il nostro server gli chiede di
 * leggere il sito del negozio (quello scritto in «I tuoi canali», solo https e solo un indirizzo
 * pubblico) e tiene da parte il risultato in `analisi_negozi.sito` (migrazione 711), in parole
 * semplici: velocità, farsi trovare su Google, facile da usare per tutti.
 *
 * Tetto: un tentativo al giorno per negozio (giorno di Piacenza), riuscito o no. Prima si risponde col
 * risultato già tenuto da parte, senza richiamare Google. La chiave di Google è facoltativa
 * (`PAGESPEED_API_KEY`, anch'essa gratuita): senza, Google concede meno richieste al giorno.
 */

const ATTESA_MASSIMA_MS = 55_000;

export const POST = withSellerAnchePendingRateLimit({ name: 'seller-analisi-sito', max: 3, windowMs: 60_000 }, async ({ user }) => {
  const admin = getAdminSupabase();
  const [profilo, analisi] = await Promise.all([
    admin.from('profiles').select('role, store_customization').eq('id', user.id).maybeSingle(),
    admin.from('analisi_negozi').select('sito, sito_il').eq('id_attivita', user.id).maybeSingle(),
  ]);
  if (profilo.error || analisi.error) {
    logger.error('[analisi-sito] lettura non riuscita', { userId: user.id, message: (profilo.error ?? analisi.error)?.message });
    return ApiErrors.unavailable('Non sono riuscito a preparare l’analisi. Riprova fra poco.');
  }
  const p = profilo.data as { role: string | null; store_customization: { socials?: { website?: unknown } } | null } | null;
  if (!p || p.role !== 'seller') return ApiErrors.forbidden('Solo un negozio ha un sito da analizzare.');
  const scritto = typeof p.store_customization?.socials?.website === 'string' ? p.store_customization.socials.website : '';
  const sito = indirizzoWebPubblico(scritto);
  if (!sito) return ApiErrors.invalidRequest('Scrivi prima l’indirizzo pubblico del tuo sito in «I tuoi canali» (solo https).');

  const salvata = analisi.data as { sito: unknown; sito_il: string | null } | null;
  const adesso = new Date();
  const giaFatto = leggiRisultatoSito(salvata?.sito);
  // Lo stesso sito già analizzato oggi: si risponde con quello, senza richiamare Google.
  if (giaFatto && giaFatto.url === sito && !sitoDaRifare(salvata?.sito_il, adesso)) {
    return apiSuccess({ sito: giaFatto, giaFattaOggi: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  // IL TETTO, CONTATO SUI TENTATIVI (collaudo del 24/11): anche un tentativo andato male conta, e due
  // richieste insieme non chiamano Google due volte. Prima la riga del negozio, se non c'è; poi una sola
  // scrittura che segna il tentativo solo se l'ultimo è di un giorno prima: se non segna niente, oggi
  // Google è già stato chiamato (anche per un altro sito).
  const seNonC = await admin.from('analisi_negozi').upsert({ id_attivita: user.id }, { onConflict: 'id_attivita', ignoreDuplicates: true });
  const tentativo = seNonC.error
    ? seNonC
    : await admin
        .from('analisi_negozi')
        .update({ sito_tentato_il: adesso.toISOString() })
        .eq('id_attivita', user.id)
        .or(`sito_tentato_il.is.null,sito_tentato_il.lt.${inizioDelGiornoDiPiacenza(adesso)}`)
        .select('id_attivita');
  if (tentativo.error) {
    logger.error('[analisi-sito] tentativo non segnato', { userId: user.id, message: tentativo.error.message });
    return ApiErrors.unavailable('Non sono riuscito a preparare l’analisi. Riprova fra poco.');
  }
  if (!((tentativo.data as unknown[] | null) ?? []).length) {
    return ApiErrors.rateLimited(3600, 'Il sito si può analizzare una volta al giorno: riprova domani.');
  }

  let json: unknown;
  try {
    const risposta = await fetch(indirizzoPageSpeed(sito, process.env.PAGESPEED_API_KEY?.trim() || null), {
      signal: AbortSignal.timeout(ATTESA_MASSIMA_MS),
      cache: 'no-store',
    });
    json = await risposta.json().catch(() => null);
    if (!risposta.ok) {
      logger.warn('[analisi-sito] PageSpeed ha risposto male', { userId: user.id, status: risposta.status });
      return ApiErrors.badGateway('Google non è riuscito a leggere il tuo sito. Controlla che si apra, e riprova fra poco.');
    }
  } catch (errore) {
    logger.warn('[analisi-sito] PageSpeed non ha risposto', { userId: user.id, errore: String(errore) });
    return ApiErrors.badGateway('Google ci sta mettendo troppo a leggere il tuo sito. Riprova fra qualche minuto.');
  }
  const risultato = riassumiPageSpeed(json, sito, adesso);
  if (!risultato) return ApiErrors.badGateway('Google non ha dato un risultato per il tuo sito. Riprova fra poco.');

  const { error } = await admin
    .from('analisi_negozi')
    .upsert({ id_attivita: user.id, sito: risultato, sito_il: risultato.fatta_il, aggiornata_il: risultato.fatta_il }, { onConflict: 'id_attivita' });
  if (error) logger.warn('[analisi-sito] risultato non salvato', { userId: user.id, message: error.message });
  return apiSuccess({ sito: risultato, giaFattaOggi: false }, { headers: { 'Cache-Control': 'no-store' } });
});
