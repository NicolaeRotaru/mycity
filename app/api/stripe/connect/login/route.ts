import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { createConnectLoginLink, isStripeConfigured } from '@/lib/stripe/client';
import { logger } from '@/lib/logger';
import { withSellerAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Genera un login link monouso verso la Dashboard Express ospitata da
 * Stripe per il seller corrente. La dashboard permette di gestire saldo,
 * payout reali, IBAN, documenti KYC e dati fiscali — tutto ciò che la
 * pagina Guadagni di MyCity (basata sul nostro DB) non copre.
 *
 * Richiede un Connect account già collegato. Lato UI il bottone va
 * mostrato solo quando charges/payouts sono abilitati (vedi
 * components/seller/StripeDashboardButton).
 */
// Rate limit: 20 / ora per seller (login link monouso, generati a ogni click)
export const POST = withSellerAuthRateLimit({ name: 'stripe-login', max: 20, windowMs: 60 * 60_000 }, async ({ user }): Promise<NextResponse> => {
  if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');

  const supa = await getServerSupabase();
  const { data: profile, error: pErr } = await supa
    .from('profiles')
    .select('stripe_account_id')
    .eq('id', user.id)
    .single();
  if (pErr || !profile) return ApiErrors.notFound('Profilo non trovato.');
  if (!profile.stripe_account_id) {
    return ApiErrors.forbidden('Collega prima il tuo conto per ricevere pagamenti.');
  }

  try {
    const { url } = await createConnectLoginLink(profile.stripe_account_id);
    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    logger.error('[stripe] connect login link failed', err);
    return ApiErrors.internal('Errore Stripe');
  }
});
