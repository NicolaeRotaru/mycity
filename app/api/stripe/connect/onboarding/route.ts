import { NextResponse } from 'next/server';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { createConnectOnboardingLink, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Avvia onboarding Stripe Connect Express per il seller corrente.
 * Crea un Connect account (o riusa quello esistente) e ritorna l'URL
 * dell'account link Stripe (KYC + IBAN + accordo TOS).
 *
 * Da chiamare DOPO che il seller ha completato il KYC su MyCity
 * (approval_status = 'approved').
 */
export const POST = withSellerAuth(async ({ user }): Promise<NextResponse> => {
  if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');
  if (!user.email) return ApiErrors.unauthorized();

  const supa = getServerSupabase();
  const { data: profile, error: pErr } = await supa
    .from('profiles')
    .select('approval_status, stripe_account_id, store_name')
    .eq('id', user.id)
    .single();
  if (pErr || !profile) return ApiErrors.notFound('Profilo non trovato.');
  if (profile.approval_status !== 'approved') {
    return ApiErrors.forbidden('Completa prima la verifica KYC del negozio.');
  }

  try {
    const { accountId, url } = await createConnectOnboardingLink({
      sellerEmail: user.email,
      sellerId: user.id,
      existingAccount: profile.stripe_account_id ?? null,
      returnUrl: `${env.appUrl()}/seller/dashboard?stripe=connected`,
      refreshUrl: `${env.appUrl()}/seller/dashboard?stripe=refresh`,
    });

    if (accountId !== profile.stripe_account_id) {
      const admin = getAdminSupabase();
      await admin
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user.id);
    }

    return NextResponse.json({ url }, { status: 200 });
  } catch (err: any) {
    logger.error('[stripe] connect onboarding failed', err);
    return ApiErrors.internal('Errore Stripe');
  }
});
