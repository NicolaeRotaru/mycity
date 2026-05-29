import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { applyConnectAccountStatus } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
import { withSellerAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Risincronizza lo stato Connect del seller leggendolo DIRETTAMENTE da Stripe
 * (accounts.retrieve) e scrivendo i flag su `profiles`.
 *
 * Serve come fallback quando il webhook `account.updated` non arriva (es.
 * endpoint webhook non iscritto agli eventi Connect) o è in ritardo: senza
 * questo il seller resterebbe bloccato su "Completa configurazione pagamenti"
 * pur avendo completato l'onboarding. Chiamata al rientro dall'onboarding
 * (return_url) e dal bottone "Aggiorna stato" in Guadagni.
 */
// Rate limit: 20 / 10 min per seller.
export const POST = withSellerAuthRateLimit({ name: 'stripe-connect-refresh', max: 20, windowMs: 10 * 60_000 }, async ({ user }): Promise<NextResponse> => {
  if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');

  const supa = getServerSupabase();
  const { data: profile, error: pErr } = await supa
    .from('profiles')
    .select('stripe_account_id')
    .eq('id', user.id)
    .single();
  if (pErr || !profile) return ApiErrors.notFound('Profilo non trovato.');

  if (!profile.stripe_account_id) {
    return NextResponse.json(
      { connected: false, charges_enabled: false, payouts_enabled: false, details_submitted: false },
      { status: 200 },
    );
  }

  try {
    const acct = await getStripe().accounts.retrieve(profile.stripe_account_id);
    await applyConnectAccountStatus(acct);
    return NextResponse.json(
      {
        connected: true,
        charges_enabled: !!acct.charges_enabled,
        payouts_enabled: !!acct.payouts_enabled,
        details_submitted: !!acct.details_submitted,
        currently_due: acct.requirements?.currently_due ?? [],
        disabled_reason: acct.requirements?.disabled_reason ?? null,
      },
      { status: 200 },
    );
  } catch (err) {
    logger.error('[stripe] connect refresh-status failed', err);
    return ApiErrors.internal('Errore Stripe');
  }
});
