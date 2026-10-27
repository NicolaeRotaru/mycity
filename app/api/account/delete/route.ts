import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuth, withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { stradaAManoPerIDiritti } from '@/lib/legal/titolare';
import { motivoDellAttesa } from '@/lib/privacy/avvisi-a-chi-aspetta';

/**
 * 27/10/2026 — Senza la chiave di servizio le tre porte rispondevano
 * «Servizio non configurato»: vero per noi, un muro per chi vuole cancellarsi.
 * Adesso la risposta dice la strada a mano (la casella privacy, o il modulo
 * dei contatti finché la casella non c'è). Resta 503: il servizio è giù davvero.
 */
function senzaChiave(cosa: string, e: unknown): NextResponse {
  logger.error('[account-delete] cancellazione automatica spenta: manca la chiave di servizio', {
    errore: e instanceof Error ? e.message : 'errore',
  });
  return ApiErrors.unavailable(stradaAManoPerIDiritti(cosa));
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
export const POST = withAuthRateLimit({ name: 'account-delete', max: 3, windowMs: 60 * 60_000 }, async ({ user }): Promise<NextResponse> => {
  let admin;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    return senzaChiave("Cancellare l'account", e);
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('deletion_requested_at')
    .eq('id', user.id)
    .single();

  if (profile?.deletion_requested_at) {
    return NextResponse.json({
      alreadyRequested: true,
      requestedAt: profile.deletion_requested_at,
      effectiveAt: new Date(new Date(profile.deletion_requested_at).getTime() + 7 * 86_400_000).toISOString(),
    }, { status: 200 });
  }

  const requestedAt = new Date().toISOString();
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: requestedAt })
    .eq('id', user.id);

  if (error) {
    logger.error('account delete request failed', error);
    return ApiErrors.internal('Impossibile registrare la richiesta. Contatta il supporto.');
  }

  const effectiveAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return NextResponse.json({
    ok: true,
    requestedAt,
    effectiveAt,
    message: 'Richiesta di cancellazione registrata. Hai 7 giorni per annullarla.',
  }, { status: 200 });
});

export const DELETE = withAuth(async ({ user }): Promise<NextResponse> => {
  let admin;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    return senzaChiave('Annullare la richiesta di cancellazione', e);
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
});

export const GET = withAuth(async ({ user }): Promise<NextResponse> => {
  let admin;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    return senzaChiave('Vedere lo stato della cancellazione', e);
  }

  const { data } = await admin
    .from('profiles')
    .select('deletion_requested_at')
    .eq('id', user.id)
    .single();

  if (!data?.deletion_requested_at) {
    return NextResponse.json({ pending: false });
  }
  const requestedAt = new Date(data.deletion_requested_at).getTime();
  const effectiveAt = requestedAt + 7 * 86_400_000;
  // 27/10/2026 — Il motivo del rinvio, parola per parola come gliel'ha scritto
  // il giro notturno (stessa riga di `notifications`, nessun ricalcolo). Prima
  // qui c'era solo il conto alla rovescia, che arrivava a zero e restava lì.
  const attesa = await motivoDellAttesa(admin, user.id, data.deletion_requested_at, logger);
  return NextResponse.json({
    pending: true,
    requestedAt: data.deletion_requested_at,
    effectiveAt: new Date(effectiveAt).toISOString(),
    daysRemaining: Math.max(0, Math.ceil((effectiveAt - Date.now()) / 86_400_000)),
    rinviata: attesa.inAttesa,
    motivo: attesa.motivo,
    motivoDettoIl: attesa.dettoIl,
  });
});
