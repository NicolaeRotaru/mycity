import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuth, withAuthRateLimit, type OpzioniAccesso } from '@/lib/api/middleware';
import { ApiErrors, apiError } from '@/lib/api/responses';
import { stradaAManoPerIDiritti } from '@/lib/legal/titolare';
import { motivoDellAttesa } from '@/lib/privacy/avvisi-a-chi-aspetta';
import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';
import { sendEmail } from '@/lib/email/client';
import { richiestaCancellazioneTemplate } from '@/lib/email/templates';

/**
 * 27/10/2026 — Senza la chiave di servizio le tre porte rispondevano
 * «Servizio non configurato»: vero per noi, un muro per chi vuole cancellarsi.
 * Adesso la risposta dice la strada a mano (la casella privacy, o il modulo
 * dei contatti finché la casella non c'è). Resta 503: il servizio è giù davvero.
 */
const ANNULLA = 'Annullare la richiesta di cancellazione';

function senzaChiave(cosa: string, e: unknown, chi?: { id: string } | null): NextResponse {
  // 5/11/2026 — La riga non diceva chi aveva chiesto: quando la chiave torna,
  // nessuno poteva richiamare la persona. Si annota l'identificativo interno
  // (non l'email) e il diritto chiesto.
  logger.error('[account-delete] cancellazione automatica spenta: manca la chiave di servizio', {
    errore: e instanceof Error ? e.message : 'errore',
    utente: chi?.id ?? null,
    diritto: cosa,
  });
  // 27/10/2026 (secondo giro) — Con la frase viaggia il collegamento
  // (`details.recapito`): la pagina lo offre come pulsante. Senza casella e
  // senza un modulo che arrivi a qualcuno è null, e la frase lo dice.
  // 5/11/2026 — Per annullare non vale «entro un mese»: la cancellazione parte
  // 7 giorni dopo la richiesta, e l'oggetto dell'email deve dire l'urgenza.
  const strada = cosa === ANNULLA
    ? stradaAManoPerIDiritti(cosa, undefined, undefined, {
        oggetto: 'Fermate la cancellazione del mio account',
        chiusa: 'Scrivici subito: la cancellazione definitiva parte 7 giorni dopo la richiesta.',
      })
    : stradaAManoPerIDiritti(cosa);
  return apiError(503, strada.frase, 'SERVICE_UNAVAILABLE', { recapito: strada.recapito });
}

/**
 * 27/10/2026 (quarto giro, fase 2) — PRIMA CHI SEI, POI LA CHIAVE.
 *
 * Qui c'era un involucro che guardava la chiave PRIMA del controllo d'accesso:
 * senza chiave rispondeva 503 con la strada a mano a chiunque bussasse, anche
 * a chi non aveva fatto l'accesso, che deve ricevere 401 nel formato ApiErrors.
 * Adesso decide `withAuth`: prima chi sei (401 se nessuno), poi, se la chiave
 * manca, la strada a mano. Prova:
 * tests/unit/prima-chi-sei-poi-la-chiave-sulle-porte-dei-diritti.test.ts
 */
function sullaPorta(cosa: string): OpzioniAccesso {
  return { seMancaLaChiave: (chi, e) => senzaChiave(cosa, e, chi.user) };
}

export const runtime = 'nodejs';

/**
 * Cancellazione account con COOLDOWN 7 GIORNI (GDPR best practice).
 *
 * Esperti consultati:
 * - Privacy Officer: "GDPR Art.17 non richiede istantaneita'. 7gg di grace
 *   periodo permette recovery accidentale e protegge da takeover."
 * - Trust & Safety: "Soft delete con flag deletion_requested_at, cron poi
 *   hard-delete dopo cutoff. User puo' annullare entro la finestra."
 *
 * Endpoints:
 *  POST  /api/account/delete   → richiede cancellazione (set flag)
 *  DELETE /api/account/delete  → annulla richiesta (unset flag)
 *  GET   /api/account/delete   → stato corrente (deletion_requested_at?)
 *
 * Hard delete: handled by /api/cron/process-deletions (richiede CRON_SECRET)
 */

// Rate limit destructive: 3 richieste / ora — anti-abuse + protezione (GDPR)
const chiedi = withAuthRateLimit({ name: 'account-delete', max: 3, windowMs: 60 * 60_000, ...sullaPorta("Cancellare l'account") }, async ({ user }): Promise<NextResponse> => {
  let admin;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    return senzaChiave("Cancellare l'account", e, user);
  }

  const { data: profile, error: erroreLettura } = await admin
    .from('profiles')
    .select('deletion_requested_at')
    .eq('id', user.id)
    .single();

  // 5/11/2026 — L'errore della lettura veniva buttato: con un guasto passeggero
  // la richiesta già registrata non si vedeva, e la data nuova scriveva sopra
  // quella vecchia (7 giorni e termine dei 30 ripartivano da oggi). Se non
  // sappiamo, non scriviamo niente.
  if (erroreLettura) {
    logger.error('account delete: lettura del profilo non riuscita', { userId: user.id, message: erroreLettura.message });
    return ApiErrors.unavailable('Non riusciamo a leggere lo stato del tuo account. Riprova fra qualche minuto.');
  }

  if (profile?.deletion_requested_at) {
    // 5/11/2026 — Gli stessi campi della lettura dello stato (GET): prima
    // c'erano solo le date, e la pagina tornava a contare «tra 0 giorni»
    // senza il motivo del rinvio.
    return NextResponse.json({
      alreadyRequested: true,
      ...(await statoDellaRichiesta(admin, user.id, profile.deletion_requested_at)),
    }, { status: 200 });
  }

  const requestedAt = new Date().toISOString();
  // Si scrive solo se è ancora vuota: una seconda richiesta non sposta mai la prima.
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: requestedAt })
    .eq('id', user.id)
    .is('deletion_requested_at', null);

  if (error) {
    logger.error('account delete request failed', error);
    return ApiErrors.internal('Impossibile registrare la richiesta. Contatta il supporto.');
  }

  const effectiveAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

  // 5/11/2026 — Dalla richiesta in poi niente più email di ciclo di vita
  // (guida, promozioni, «invita un amico») né il promemoria del carrello: prima
  // continuavano per tutti i 7 giorni. Si chiudono le righe non ancora
  // spedite e si segna il carrello come già gestito. Non blocca la richiesta.
  await smettiDiScrivergli(admin, user.id);

  // 5/11/2026 — Il titolare dell'account riceve subito un avviso col giorno della
  // cancellazione definitiva e la strada per annullarla: una sessione rubata non
  // cancella più un account in silenzio.
  const indirizzo = user.email?.trim();
  if (indirizzo) {
    dopoLaRisposta(async () => {
      const lettera = richiestaCancellazioneTemplate({ effectiveAt });
      const esito = await sendEmail({ to: indirizzo, ...lettera, tipo: 'transazionale' });
      if (!esito.ok) {
        logger.warn('[account-delete] avviso della richiesta non spedito', { userId: user.id });
      }
    }, 'avviso della richiesta di cancellazione');
  }

  return NextResponse.json({
    ok: true,
    requestedAt,
    effectiveAt,
    message: 'Richiesta di cancellazione registrata. Hai 7 giorni per annullarla.',
  }, { status: 200 });
});

/** Chiude le email in coda non ancora spedite e il promemoria del carrello. */
async function smettiDiScrivergli(admin: ReturnType<typeof getAdminSupabase>, userId: string): Promise<void> {
  const adesso = new Date().toISOString();
  try {
    const { error: erroreCoda } = await admin
      .from('email_queue')
      .update({ cancelled_at: adesso })
      .eq('user_id', userId)
      .is('sent_at', null)
      .is('cancelled_at', null);
    if (erroreCoda) logger.warn('[account-delete] coda email non chiusa', { userId, message: erroreCoda.message });
    const { error: erroreCarrello } = await admin
      .from('abandoned_carts')
      .update({ recovery_email_sent_at: adesso })
      .eq('user_id', userId)
      .is('recovery_email_sent_at', null);
    if (erroreCarrello) logger.warn('[account-delete] carrello non segnato', { userId, message: erroreCarrello.message });
  } catch (e) {
    logger.warn('[account-delete] pulizia delle email non riuscita', { userId, errore: e instanceof Error ? e.message : 'errore' });
  }
}

const annulla = withAuth(async ({ user }): Promise<NextResponse> => {
  let admin;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    return senzaChiave(ANNULLA, e, user);
  }

  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: null })
    .eq('id', user.id);

  if (error) {
    logger.error('account delete cancel failed', error);
    return ApiErrors.internal('Impossibile annullare la richiesta. Riprova.');
  }
  return NextResponse.json({ ok: true, message: 'Richiesta annullata.' });
}, sullaPorta(ANNULLA));

const leggiLoStato = withAuth(async ({ user }): Promise<NextResponse> => {
  let admin;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    return senzaChiave('Vedere lo stato della cancellazione', e, user);
  }

  const { data } = await admin
    .from('profiles')
    .select('deletion_requested_at')
    .eq('id', user.id)
    .single();

  if (!data?.deletion_requested_at) {
    return NextResponse.json({ pending: false });
  }
  return NextResponse.json({
    pending: true,
    ...(await statoDellaRichiesta(admin, user.id, data.deletion_requested_at)),
  });
}, sullaPorta('Vedere lo stato della cancellazione'));

/**
 * Lo stato di una richiesta già registrata: date, giorni che restano e il
 * motivo del rinvio. Lo usano la lettura (GET) e la richiesta ripetuta (POST).
 */
async function statoDellaRichiesta(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  chiestaIl: string,
) {
  const requestedAt = new Date(chiestaIl).getTime();
  const effectiveAt = requestedAt + 7 * 86_400_000;
  // 27/10/2026 — Il motivo del rinvio, parola per parola come gliel'ha scritto
  // il giro notturno (stessa riga di `notifications`, nessun ricalcolo). Prima
  // qui c'era solo il conto alla rovescia, che arrivava a zero e restava lì.
  const attesa = await motivoDellAttesa(admin, userId, chiestaIl, logger);
  return {
    requestedAt: chiestaIl,
    effectiveAt: new Date(effectiveAt).toISOString(),
    daysRemaining: Math.max(0, Math.ceil((effectiveAt - Date.now()) / 86_400_000)),
    // 5/11/2026 — `rinviata` vale per tutte e due le tappe; `tappa` dice quale:
    // un rinvio motivato ('rinviata') o il termine di legge passato ('termine-scaduto').
    rinviata: attesa.letturaFallita ? null : attesa.inAttesa,
    tappa: attesa.tappa,
    // Rilettura del motivo caduta: «non lo so», non «nessun rinvio».
    letturaFallita: attesa.letturaFallita === true,
    motivo: attesa.motivo,
    motivoDettoIl: attesa.dettoIl,
  };
}

export const POST = chiedi;
export const DELETE = annulla;
export const GET = leggiLoStato;
