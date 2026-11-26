import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { arrivaDaUnAltroSito } from '@/lib/api/provenienza';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { traduciErroreAuth } from '@/lib/errors';
import { VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';
import { CODICE_INVITO, faiAgente, improntaCodice, leggiInvito, restituisciInvito, statoInvito, usaInvito } from '@/lib/agenti/inviti';

export const runtime = 'nodejs';

/**
 * L'AGENTE SI ISCRIVE DAL LINK D'INVITO — 26/11/2026 (migrazione 865).
 *
 * L'unica porta per diventare agente: il link creato in Admin → Agenti. Chi lo apre sceglie email e password,
 * e il server crea il suo account MyCity (email già confermata: il link gliel'ha dato Nicola di persona) e la
 * sua riga di agente. Il posto nel link si prende PRIMA di creare l'account, in modo atomico: due persone sullo
 * stesso link monouso, ne entra una. Se l'iscrizione non va in fondo, il posto torna libero.
 * Chi ha già un account MyCity non ne crea un altro: entra e preme «Attiva» (rotta /attiva).
 *
 * Il codice arriva nel corpo, mai nell'indirizzo (perché: lib/agenti/codice.ts).
 */

const Richiesta = z.object({
  codice: z.string().regex(CODICE_INVITO, 'Link non valido'),
  email: z.string().trim().toLowerCase().max(254).email('Scrivi un’email valida'),
  password: z.string().min(8, 'La password deve avere almeno 8 caratteri').max(200, 'Password troppo lunga'),
  accettoCondizioni: z.literal(true, { message: 'Per continuare accetta le condizioni e l’informativa privacy' }),
});

const NON_VALE = 'Questo link non vale più: chiedi a Nicola un link nuovo.';

export async function POST(req: Request): Promise<NextResponse> {
  if (arrivaDaUnAltroSito(req)) return ApiErrors.forbidden('Richiesta non consentita da questa origine');
  const ip = getClientIp(req);
  const rl = await rateLimitAsync({ key: `invito-agente:${ip}`, max: 8, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Richiesta.safeParse(corpo);
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
  const { codice, email, password } = esito.data;

  // Un freno anche sul link, oltre che sull'indirizzo di rete: chi cambia rete non prova all'infinito sullo stesso link.
  const perLink = await rateLimitAsync({ key: `invito-agente-link:${improntaCodice(codice).slice(0, 32)}`, max: 10, windowMs: 10 * 60_000 });
  if (!perLink.allowed) return ApiErrors.rateLimited(perLink.retryAfterSec);

  let invito;
  try {
    invito = await leggiInvito(codice);
  } catch (errore) {
    logger.error('[invito-agente] lettura non riuscita', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere il link in questo momento. Riprova fra poco.');
  }
  const stato = statoInvito(invito);
  if (stato !== 'valido') return ApiErrors.conflict(stato === 'scaduto' ? 'Questo link è scaduto: chiedi a Nicola un link nuovo.' : NON_VALE);

  // 1. Il posto nel link, in modo atomico.
  let invitoId: string | null;
  try {
    invitoId = await usaInvito(codice);
  } catch (errore) {
    logger.error('[invito-agente] uso non riuscito', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a usare il link in questo momento. Riprova fra poco.');
  }
  if (!invitoId) return ApiErrors.conflict(NON_VALE);
  const liberaIlPosto = () => restituisciInvito(invitoId).catch((errore) => logger.error('[invito-agente] posto non restituito', { errore: String(errore), invito: invitoId }));

  // 2. L'account MyCity, già confermato.
  const admin = getAdminSupabase();
  const creato = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'customer', origine: 'invito-agente' } });
  const utente = creato.data?.user;
  if (!utente) {
    await liberaIlPosto();
    const messaggio = creato.error?.message ?? '';
    if (/already|registered|exists/i.test(messaggio)) return ApiErrors.conflict('Questa email ha già un account MyCity: entra con la tua password e riapri questo link per attivarti come agente.');
    // Password troppo corta, troppo semplice o già rubata, email scritta male: è la persona che deve correggere.
    const tradotto = traduciErroreAuth(messaggio);
    if (tradotto) return ApiErrors.invalidRequest(tradotto);
    logger.error('[invito-agente] account non creato', { errore: messaggio });
    return ApiErrors.unavailable('Non riesco a creare l’account in questo momento. Riprova fra poco.');
  }

  // 3. Il «sì» alle condizioni, a verbale come nella registrazione normale (collaudo del 26/11: qui mancava).
  // Se non si scrive, l'iscrizione va avanti lo stesso: senza la data nel profilo il sito chiederà di nuovo
  // l'accettazione al primo accesso (/api/account/accetta-condizioni), quindi il verbale non resta vuoto.
  const { error: errVerbale } = await admin.from('consent_log').insert({
    user_id: utente.id,
    categoria: 'privacy_terms',
    valore: true,
    versione_testo: VERSIONE_TESTI_LEGALI.slice(0, 60),
    ip,
    user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
  });
  if (errVerbale) logger.error('[invito-agente] consenso non messo a verbale', { errore: errVerbale.message, utente: utente.id });
  else {
    const { error: errProfilo } = await admin.from('profiles').update({ tos_accepted_at: new Date().toISOString() }).eq('id', utente.id);
    if (errProfilo) logger.error('[invito-agente] data del consenso non scritta nel profilo', { errore: errProfilo.message, utente: utente.id });
  }

  // 4. La riga di agente. Se non si scrive, il posto torna libero: la persona entra e preme «Attiva» sullo stesso link.
  try {
    await faiAgente({ userId: utente.id, email, invitoId });
  } catch (errore) {
    await liberaIlPosto();
    logger.error('[invito-agente] agente non scritto', { errore: String(errore), utente: utente.id });
    return ApiErrors.unavailable('L’account c’è, ma non riesco ad attivarti come agente: riapri il link, entra e premi «Attiva».');
  }
  return NextResponse.json({ ok: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
