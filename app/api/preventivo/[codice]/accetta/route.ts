import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { isStripeConfigured } from '@/lib/stripe/client';
import { logger } from '@/lib/logger';
import { ABBONAMENTI, SERVIZI_AGENZIA } from '@/lib/agenzia/preventivo';
import { apriCassaDalLink } from '@/lib/agenzia/cassa-dal-link';
import { pagamentoOnlineAttivo } from '@/lib/agenzia/pagamento-servizi';
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { accettaPreventivoColCodice, CODICE_VALIDO, leggiPreventivoColCodice } from '@/lib/agenzia/preventivo-col-codice';
import { chiaveDelGettone, verificaCodice } from '@/lib/agenzia/codice-dal-link';
import { sessioneDalLink, type SessioneDalLink } from '@/lib/agenzia/entra-dal-link';
import { richiestaDalSito } from '@/lib/agenzia/richiesta-dal-sito';
import { GIORNO_NON_PIU_VALIDO, orarioDellaVisitaValido } from '@/lib/agenzia/visita-sdg';

export const runtime = 'nodejs';

/**
 * IL TITOLARE ACCETTA IL PREVENTIVO DAL LINK COL CODICE — 24/11/2026.
 *
 * Nessun accesso: la chiave è il codice del link (256 bit casuali). Il server accetta
 * (lib/agenzia/preventivo-col-codice.ts) e, col pagamento online acceso, apre la cassa Stripe. Il canone lo
 * rilegge il server; il browser manda solo il nome della fascia. 26/11/2026: per ora si paga in contanti
 * (lib/agenzia/pagamento-servizi.ts), quindi nessuna cassa e `url` null.
 *
 * 27/11/2026 — Nicola: «può toccare un altro abbonamento e confermare quello e dopo il click entra nella sua
 * pagina venditore con l'abbonamento che ha scelto»; sui rischi trovati dai collaudi della sicurezza,
 * «codice dall'email». Ora, nell'ordine:
 *  1. il codice dell'email (chiesto a ../codice) deve tornare giusto col suo gettone, per quell'email e
 *     questo link, entro 10 minuti (lib/agenzia/codice-dal-link.ts): prova che l'email è del titolare.
 *     Sbagliato, scaduto o mancante → niente si accetta. Tentativi: 5 per gettone, 10 per link e per
 *     indirizzo ogni 15 minuti, 30 per link al giorno;
 *  2. si accetta come prima: email sull'utente del negozio (sbloccato solo ora), profilo in revisione,
 *     pagina sbloccata nella fascia confermata, avviso a Nicola, email col link per rientrare;
 *  3. si apre la sessione del titolare (lib/agenzia/entra-dal-link.ts) e la risposta dice `entra`: la pagina
 *     dell'abbonamento del negozio, dove vede la fascia confermata attiva. Se in questo browser c'è già
 *     dentro un altro account, la sua sessione non si tocca: `entra` è null e il titolare entra dall'email.
 * Le richieste devono essere JSON partito dal sito stesso (lib/agenzia/richiesta-dal-sito.ts).
 *
 * 27/11/2026 verso le 17:40 — Nicola: insieme all'abbonamento il titolare sceglie giorno e ora in cui il team
 * creativo di SDG passa da lui. `visita` è uno degli orari che il server propone adesso (lib/agenzia/visita-sdg.ts):
 * un orario passato, troppo vicino o inventato è rifiutato prima di guardare il codice. Si salva col preventivo.
 * Senza `visita` si accetta lo stesso (nessun giorno libero, o pagina vecchia): l'avviso a Nicola lo dice.
 */

const Richiesta = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Scrivi un’email valida'),
  abbonamento: z.enum(ABBONAMENTI, { message: 'Scegli uno dei tre abbonamenti' }),
  accettoCondizioni: z.literal(true, { message: 'Per continuare accetta le condizioni e l’informativa privacy' }),
  codice: z.string().trim().regex(/^[0-9]{6}$/, 'Scrivi il codice di 6 cifre che ti è arrivato per email'),
  gettone: z.string().min(10).max(2000),
  // Facoltativa per il server: senza giorni liberi (o da una pagina aperta prima di oggi) si accetta lo stesso
  // e Nicola nell'avviso legge «chiamalo per fissare la visita». La pagina la chiede sempre quando ci sono giorni.
  visita: z.string().max(40).optional(),
  // 28/11/2026 — I servizi confermati dal titolare: li trova segnati dal venditore e li può cambiare. Almeno uno,
  // solo fra i quattro. Assenti (pagina aperta prima di oggi): restano quelli del venditore.
  servizi: z.array(z.enum(SERVIZI_AGENZIA, { message: 'Un servizio non è fra quelli previsti.' })).min(1, 'Scegli almeno un servizio.').max(SERVIZI_AGENZIA.length).optional(),
});

const QUARTO_D_ORA = 15 * 60_000;
const GIORNO = 24 * 60 * 60_000;
const CODICE_SBAGLIATO = 'Il codice non è giusto. Controlla l’ultima email che ti abbiamo mandato, o chiedine un altro.';

export async function POST(req: Request, ctx: { params: Promise<{ codice: string }> }): Promise<NextResponse> {
  const { codice } = await ctx.params;
  // Un codice nella forma sbagliata non tocca nemmeno il database.
  if (!CODICE_VALIDO.test(codice)) return ApiErrors.notFound('Preventivo non trovato');
  const fuori = richiestaDalSito(req, '[preventivo-codice] conferma');
  if (fuori) return fuori;

  const perIndirizzo = await rateLimitAsync({ key: `preventivo-codice:${getClientIp(req)}`, max: 10, windowMs: QUARTO_D_ORA });
  if (!perIndirizzo.allowed) return ApiErrors.rateLimited(perIndirizzo.retryAfterSec);
  const perLink = await rateLimitAsync({ key: `preventivo-codice-link:${codice}`, max: 10, windowMs: QUARTO_D_ORA });
  if (!perLink.allowed) return ApiErrors.rateLimited(perLink.retryAfterSec);
  // Un tetto anche sul giorno: chi prova a indovinare il codice si ferma dopo 30 tentativi (terzo collaudo, M2).
  const perGiorno = await rateLimitAsync({ key: `preventivo-codice-link-giorno:${codice}`, max: 30, windowMs: GIORNO });
  if (!perGiorno.allowed) return ApiErrors.rateLimited(perGiorno.retryAfterSec);

  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Richiesta.safeParse(corpo);
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
  const { email, abbonamento, codice: codiceEmail, gettone, visita, servizi } = esito.data;
  if (visita !== undefined && !orarioDellaVisitaValido(visita, new Date())) {
    return ApiErrors.invalidRequest(GIORNO_NON_PIU_VALIDO);
  }

  // 1) Il codice dell'email. Al sesto tentativo sullo stesso gettone serve un codice nuovo.
  const perGettone = await rateLimitAsync({ key: `preventivo-codice-gettone:${chiaveDelGettone(gettone)}`, max: 5, windowMs: QUARTO_D_ORA });
  if (!perGettone.allowed) return ApiErrors.invalidRequest('Hai sbagliato il codice troppe volte: chiedine un altro.');
  const verifica = verificaCodice({ link: codice, email, codice: codiceEmail, gettone });
  if (verifica === 'scaduto') return ApiErrors.invalidRequest('Il codice è scaduto: chiedine un altro.');
  if (verifica !== 'giusto') return ApiErrors.invalidRequest(CODICE_SBAGLIATO);

  let preventivo;
  try {
    preventivo = await leggiPreventivoColCodice(codice);
  } catch (errore) {
    logger.error('[preventivo-codice] lettura non riuscita', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere il preventivo in questo momento. Riprova fra poco.');
  }
  if (!preventivo) return ApiErrors.notFound('Preventivo non trovato');

  // 2-3) Si accetta, e si entra se in questo browser non c'è dentro un altro account.
  const sessione = sessioneDalLink(req.headers.get('cookie'));
  const puoEntrare = sessione !== null && !(await sessione.dentroUnAltro(preventivo.sellerId));
  const accettato = await accettaPreventivoColCodice({
    preventivo,
    codice,
    email,
    fascia: abbonamento,
    visita,
    servizi,
    entraSubito: puoEntrare && sessione ? sessione.entra : undefined,
  });
  if (!accettato.ok) {
    if (accettato.motivo === 'GUASTO') return ApiErrors.unavailable(accettato.messaggio);
    return ApiErrors.conflict(accettato.messaggio);
  }
  // Non la dashboard, che a un negozio in revisione mostra solo «in attesa di approvazione» (collaudo del 27/11).
  const base = { accessoInviato: accettato.accessoInviato, entra: accettato.entrato ? PERCORSO_ABBONAMENTO : null };

  if (!pagamentoOnlineAttivo() || !isStripeConfigured()) {
    return conLaSessione({ ok: true, data: { url: null, ...base } }, sessione);
  }
  const cassa = await apriCassaDalLink({ codice, sellerId: accettato.sellerId, email, fascia: abbonamento });
  // Se la cassa non si apre, l'accettazione resta: il titolare paga dal pulsante «Paga» di questo link.
  if (!cassa.ok) return conLaSessione({ ok: true, data: { url: null, ...base } }, sessione);
  const dati = (await cassa.json()) as { data?: { url?: string } };
  return conLaSessione({ ok: true, data: { url: dati.data?.url ?? null, ...base } }, sessione);
}

/** La risposta col corpo e coi cookie della sessione appena aperta (anche le cancellazioni). */
function conLaSessione(corpo: unknown, sessione: SessioneDalLink | null): NextResponse {
  const risposta = NextResponse.json(corpo, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  for (const c of sessione?.scritti ?? []) risposta.cookies.set({ name: c.name, value: c.value, ...c.options });
  return risposta;
}
