import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuth, withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { sullaPortaDeiDiritti } from '@/lib/privacy/porta-dei-diritti';
import { motivoDellAttesa } from '@/lib/privacy/avvisi-a-chi-aspetta';
import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';
import { sendEmail } from '@/lib/email/client';
import { NOMI_TEMPLATE_CICLO_DI_VITA, TEMPLATE_DI_SERVIZIO, richiestaCancellazioneTemplate } from '@/lib/email/templates';

/**
 * 27/10/2026 — Senza la chiave di servizio le tre porte rispondevano
 * «Servizio non configurato»: vero per noi, un muro per chi vuole cancellarsi.
 * Adesso la risposta dice la strada a mano (la casella privacy, o il modulo
 * dei contatti finché la casella non c'è). Resta 503: il servizio è giù davvero.
 *
 * 27/10/2026 (quarto giro, fase 2) — PRIMA CHI SEI, POI LA CHIAVE: decide
 * `withAuth` (401 se nessuno), poi, se la chiave manca, la strada a mano. Prova:
 * tests/unit/prima-chi-sei-poi-la-chiave-sulle-porte-dei-diritti.test.ts
 *
 * R23-002 (13/11/2026) — La risposta senza chiave sta in lib/privacy/porta-dei-diritti.ts,
 * una copia sola per queste tre porte e per quella dell'esportazione. E dentro le porte non
 * c'è più un `try { getAdminSupabase() } catch`: la chiave l'ha già chiesta `withAuth`, e
 * senza chiave la porta non arriva mai qui.
 */
const REGISTRO = '[account-delete] cancellazione automatica spenta';
const ANNULLA = 'Annullare la richiesta di cancellazione';
// 5/11/2026 — Per annullare non vale «entro un mese»: la cancellazione parte
// 7 giorni dopo la richiesta, e l'oggetto dell'email deve dire l'urgenza.
const ANNULLA_SUBITO = {
  oggetto: 'Fermate la cancellazione del mio account',
  chiusa: 'Scrivici subito: la cancellazione definitiva parte 7 giorni dopo la richiesta.',
};

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
const chiedi = withAuthRateLimit({ name: 'account-delete', max: 3, windowMs: 60 * 60_000, ...sullaPortaDeiDiritti(REGISTRO, "Cancellare l'account") }, async ({ user }): Promise<NextResponse> => {
  const admin = getAdminSupabase();

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
  const { data: scritte, error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: requestedAt })
    .eq('id', user.id)
    .is('deletion_requested_at', null)
    .select('id');

  if (error) {
    logger.error('account delete request failed', error);
    return ApiErrors.internal('Impossibile registrare la richiesta. Contatta il supporto.');
  }

  // 12/11/2026 (R12-024) — DUE RICHIESTE QUASI INSIEME MANDAVANO DUE EMAIL.
  // La seconda trovava ancora il campo vuoto alla lettura, la scrittura con
  // `.is(null)` non toccava niente (l'aveva già scritto la prima), ma la rotta
  // rispondeva «registrata» e spediva un secondo avviso con date non vere. Zero
  // righe scritte = la richiesta c'era già: si risponde con quella, e niente email.
  if (Array.isArray(scritte) && scritte.length === 0) {
    const { data: giaScritto } = await admin
      .from('profiles')
      .select('deletion_requested_at')
      .eq('id', user.id)
      .single();
    const quando = (giaScritto as { deletion_requested_at?: string | null } | null)?.deletion_requested_at;
    if (quando) {
      return NextResponse.json({
        alreadyRequested: true,
        ...(await statoDellaRichiesta(admin, user.id, quando)),
      }, { status: 200 });
    }
    return ApiErrors.conflict('La richiesta è cambiata nel frattempo: ricarica la pagina.');
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
      // Solo guida e promozioni: «ordine pronto» e «consegnato» sono avvisi di servizio e restano.
      .in('template', NOMI_TEMPLATE_CICLO_DI_VITA.filter((n) => !TEMPLATE_DI_SERVIZIO.has(n)))
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
  const admin = getAdminSupabase();

  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: null })
    .eq('id', user.id);

  if (error) {
    logger.error('account delete cancel failed', error);
    return ApiErrors.internal('Impossibile annullare la richiesta. Riprova.');
  }
  return NextResponse.json({ ok: true, message: 'Richiesta annullata.' });
}, sullaPortaDeiDiritti(REGISTRO, ANNULLA, ANNULLA_SUBITO));

const leggiLoStato = withAuth(async ({ user }): Promise<NextResponse> => {
  const admin = getAdminSupabase();

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
}, sullaPortaDeiDiritti(REGISTRO, 'Vedere lo stato della cancellazione'));

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
