import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { isStripeConfigured } from '@/lib/stripe/client';
import { logger } from '@/lib/logger';
import { ABBONAMENTI } from '@/lib/agenzia/preventivo';
import { apriCassaDalLink } from '@/lib/agenzia/cassa-dal-link';
import { pagamentoOnlineAttivo } from '@/lib/agenzia/pagamento-servizi';
import { accettaPreventivoColCodice, CODICE_VALIDO, leggiPreventivoColCodice } from '@/lib/agenzia/preventivo-col-codice';
import { sessioneDalLink, type SessioneDalLink } from '@/lib/agenzia/entra-dal-link';
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * IL TITOLARE ACCETTA IL PREVENTIVO DAL LINK COL CODICE — 24/11/2026.
 *
 * Nessun accesso: la chiave è il codice del link (256 bit casuali). Il titolare manda l'email,
 * l'abbonamento scelto e il sì alle condizioni; il server accetta (lib/agenzia/preventivo-col-codice.ts)
 * e apre subito la cassa Stripe dell'abbonamento, con l'email appena data. Se la cassa non si apre,
 * l'accettazione vale lo stesso: il titolare paga più tardi dal pulsante «Paga» dello stesso link.
 * Il canone lo rilegge il server; il browser manda solo il nome della fascia.
 *
 * 26/11/2026 — Nicola: per ora si paga in contanti, di persona (lib/agenzia/pagamento-servizi.ts).
 * Con il pagamento online spento si accetta e basta: nessuna cassa, `url` sempre null.
 *
 * 27/11/2026 — Nicola: «dopo il click entra nella sua pagina venditore con l'abbonamento che ha scelto».
 * La risposta apre anche la sessione del titolare (lib/agenzia/entra-dal-link.ts) e dice `entra`: la pagina
 * del negozio (/seller/abbonamento) dove il browser va subito. Se in questo browser c'è già dentro un altro account, o la sessione
 * non si apre, `entra` è null e il titolare entra dall'email, come prima. Ora che la risposta apre una
 * sessione, la richiesta deve partire dal sito stesso.
 */

const Richiesta = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Scrivi un’email valida'),
  abbonamento: z.enum(ABBONAMENTI, { message: 'Scegli uno dei tre abbonamenti' }),
  accettoCondizioni: z.literal(true, { message: 'Per continuare accetta le condizioni e l’informativa privacy' }),
});

export async function POST(req: Request, ctx: { params: Promise<{ codice: string }> }): Promise<NextResponse> {
  const { codice } = await ctx.params;
  // Un codice nella forma sbagliata non tocca nemmeno il database.
  if (!CODICE_VALIDO.test(codice)) return ApiErrors.notFound('Preventivo non trovato');

  // Una richiesta da un altro sito non accetta e non apre sessioni (stessa regola di /auth/confirm).
  const origine = req.headers.get('origin');
  if (origine && origine !== new URL(req.url).origin && origine !== new URL(env.appUrl()).origin) {
    logger.warn('[preventivo-codice] conferma arrivata da un altro sito', { origine });
    return ApiErrors.forbidden('Richiesta non valida');
  }
  // Solo JSON: un modulo «text/plain» di un altro sito non deve poter passare la lettura del corpo
  // (collaudo del 27/11, minore M3). La pagina della conferma manda sempre application/json.
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return ApiErrors.invalidRequest('Richiesta non valida');
  }

  const ip = getClientIp(req);
  const rl = await rateLimitAsync({ key: `preventivo-codice:${ip}`, max: 10, windowMs: 10 * 60_000 });
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
  const { email, abbonamento } = esito.data;

  let preventivo;
  try {
    preventivo = await leggiPreventivoColCodice(codice);
  } catch (errore) {
    logger.error('[preventivo-codice] lettura non riuscita', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere il preventivo in questo momento. Riprova fra poco.');
  }
  if (!preventivo) return ApiErrors.notFound('Preventivo non trovato');

  // La sessione del titolare si apre solo se in questo browser non c'è dentro un altro account.
  const sessione = sessioneDalLink(req.headers.get('cookie'));
  const puoEntrare = sessione !== null && !(await sessione.dentroUnAltro(preventivo.sellerId));

  const accettato = await accettaPreventivoColCodice({
    preventivo,
    codice,
    email,
    fascia: abbonamento,
    entraSubito: puoEntrare && sessione ? sessione.entra : undefined,
  });
  if (!accettato.ok) {
    if (accettato.motivo === 'GUASTO') return ApiErrors.unavailable(accettato.messaggio);
    return ApiErrors.conflict(accettato.messaggio);
  }
  // La pagina dell'abbonamento del negozio, dove vede la fascia scelta attiva: la stessa del link dell'email.
  // Non la dashboard, che a un negozio in revisione mostra solo «in attesa di approvazione» (collaudo del 27/11).
  const entra = accettato.entrato ? PERCORSO_ABBONAMENTO : null;
  const base = { accessoInviato: accettato.accessoInviato, entra };

  if (!pagamentoOnlineAttivo() || !isStripeConfigured()) {
    return conLaSessione({ ok: true, data: { url: null, ...base } }, sessione);
  }
  const cassa = await apriCassaDalLink({ codice, sellerId: accettato.sellerId, email, fascia: abbonamento });
  // Se la cassa non si apre, l'accettazione resta: il titolare paga dal pulsante «Paga» di questo link.
  if (!cassa.ok) {
    return conLaSessione({ ok: true, data: { url: null, ...base } }, sessione);
  }
  const dati = (await cassa.json()) as { data?: { url?: string } };
  return conLaSessione({ ok: true, data: { url: dati.data?.url ?? null, ...base } }, sessione);
}

/** La risposta col corpo e coi cookie della sessione appena aperta (anche le cancellazioni). */
function conLaSessione(corpo: unknown, sessione: SessioneDalLink | null): NextResponse {
  const risposta = NextResponse.json(corpo, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  for (const c of sessione?.scritti ?? []) risposta.cookies.set({ name: c.name, value: c.value, ...c.options });
  return risposta;
}
