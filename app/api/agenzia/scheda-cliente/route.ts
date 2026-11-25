import { NextResponse, after } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta } from '@/lib/api/corpo';
import { segretiCombaciano } from '@/lib/api/segreti';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { SchedaInArrivo } from '@/lib/agenzia/scheda-cliente';
import { analizzaSitoDopoLaRisposta } from '@/lib/agenzia/sito-pagespeed';
import { indirizzoWebPubblico } from '@/lib/indirizzi-pubblici';

export const runtime = 'nodejs';
// 25/11/2026 — Dopo la risposta può partire l'analisi del sito con Google PageSpeed (fino a 55 secondi).
export const maxDuration = 60;

/**
 * N8N MANDA LA SCHEDA DEL CLIENTE AL SITO — 24/11/2026.
 *
 * Nicola: «n8n li manda al sito». Il flusso 16 di n8n, finita la ricerca, fa POST qui con la scheda
 * dell'attività (formato in lib/agenzia/scheda-cliente.ts). Il sito la tiene pronta in
 * schede_clienti e la usa quando il titolare accetta il preventivo. Rimandarla la sovrascrive.
 *
 * La porta è chiusa da un segreto suo, `N8N_SCHEDA_CLIENTE_SEGRETO`, nell'intestazione
 * `x-mycity-segreto` (qui è il sito che deve fidarsi di n8n, quindi non è quello delle iscrizioni).
 * Senza segreto configurato la porta resta chiusa (503). Solo https fuori dal computer di prova.
 * Non accetta schede per i negozi di sistema (MyCity, SDG: id che comincia con 11111111-1111-1111-1111-)
 * né per chi non è un venditore.
 *
 * 25/11/2026 — Nicola: l'analisi parte subito, la scheda del cliente nasce solo dopo l'abbonamento. La
 * porta non cambia: la scheda arriva all'iscrizione e si conserva intera, ma il sito la legge chiusa
 * (solo la sezione `analisi`) finché il negozio non ha pagato un abbonamento ai servizi
 * (lib/agenzia/scheda-dopo-abbonamento.ts). Il sito della scheda va lo stesso a Google PageSpeed: è analisi.
 */

const INTESTAZIONE = 'x-mycity-segreto';
/** Sotto il limite del database (200.000 byte, migrazione 708): oltre, si risponde 413 e n8n non riprova a vuoto. */
const TETTO_SCHEDA = 190 * 1024;
const PREFISSO_DI_SISTEMA = '11111111-1111-1111-1111-';

function arrivaInHttps(req: Request): boolean {
  const url = new URL(req.url);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return (proto ?? url.protocol.replace(':', '')) === 'https';
}

export async function POST(req: Request): Promise<NextResponse> {
  const segreto = process.env.N8N_SCHEDA_CLIENTE_SEGRETO?.trim();
  if (!segreto) return ApiErrors.unavailable('La porta delle schede non è ancora collegata.');
  if (!arrivaInHttps(req)) return ApiErrors.forbidden('Solo https.');

  const rl = await rateLimitAsync({ key: `scheda-cliente:${getClientIp(req)}`, max: 60, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  if (!segretiCombaciano(req.headers.get(INTESTAZIONE)?.trim(), segreto)) return ApiErrors.unauthorized();

  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_SCHEDA);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Corpo non leggibile');
  }
  const esito = SchedaInArrivo.safeParse(corpo);
  if (!esito.success) {
    const primo = esito.error.issues[0];
    return ApiErrors.invalidRequest(`Scheda non valida: ${primo?.path.join('.') || 'corpo'} — ${primo?.message ?? ''}`.trim());
  }
  const scheda = esito.data;
  const id = scheda.id_attivita.toLowerCase();
  if (id.startsWith(PREFISSO_DI_SISTEMA)) return ApiErrors.invalidRequest('I negozi di sistema non hanno una scheda cliente.');

  const admin = getAdminSupabase();
  const profilo = await admin.from('profiles').select('id, role').eq('id', id).maybeSingle();
  if (profilo.error) {
    logger.error('[scheda-cliente] profilo non letto', { id, message: profilo.error.message });
    return ApiErrors.unavailable('Riprova fra poco.');
  }
  if (!profilo.data || (profilo.data as { role?: string }).role !== 'seller') {
    return ApiErrors.notFound('Nessuna attività con questo id.');
  }

  const adesso = new Date().toISOString();
  const { error } = await admin.from('schede_clienti').upsert(
    { id_attivita: id, scheda: { ...scheda, id_attivita: id }, origine: (scheda.origine ?? 'n8n-16').slice(0, 40), aggiornata_il: adesso },
    { onConflict: 'id_attivita' },
  );
  if (error && String((error as { code?: string }).code) === '23514') {
    return ApiErrors.payloadTooLarge('La scheda è troppo grande: accorcia il testo del menu o le note.');
  }
  if (error) {
    logger.error('[scheda-cliente] scheda non salvata', { id, message: error.message });
    return ApiErrors.unavailable('Non sono riuscito a salvare la scheda. Riprova fra poco.');
  }
  logger.info('[scheda-cliente] scheda salvata', { id, campi: Object.keys(scheda.campi).length });
  // 25/11/2026 — Nicola: «se il sito c'è […] il preventivo si basa sul suo sito». Se la scheda porta il sito
  // del locale, Google PageSpeed lo analizza dopo la risposta: n8n non aspetta.
  const sito = indirizzoWebPubblico(String(scheda.campi.sito_ufficiale?.valore ?? ''));
  if (sito) analizzaSitoDopoLaRisposta(admin, id, sito, after);
  return NextResponse.json({ ok: true }, { status: 200 });
}
