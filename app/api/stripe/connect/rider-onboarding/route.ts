import { NextResponse } from 'next/server';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { createConnectOnboardingLink, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Avvia l'onboarding Stripe Connect Express per il RIDER corrente: crea (o
 * riusa) un account Connect e ritorna l'URL hosted per KYC + IBAN + TOS.
 * Il rider riceverà su quell'IBAN il compenso di consegna (transfer SCT).
 * Mirror di /api/stripe/connect/onboarding (seller), ma gated al ruolo rider.
 */
export const POST = withAuthRateLimit(
  { name: 'stripe-rider-onboarding', max: 10, windowMs: 60 * 60_000 },
  async ({ user, profile }): Promise<NextResponse> => {
    if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');
    if (!user.email) return ApiErrors.unauthorized();
    if (profile.role !== 'rider' && profile.role !== 'admin') {
      return ApiErrors.forbidden('Solo rider');
    }

    const supa = getServerSupabase();
    const { data: prof, error: pErr } = await supa
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', user.id)
      .single();
    if (pErr || !prof) return ApiErrors.notFound('Profilo non trovato.');

    try {
      const { accountId, url } = await createConnectOnboardingLink({
        sellerEmail: user.email,
        sellerId: user.id,
        existingAccount: prof.stripe_account_id ?? null,
        returnUrl: `${env.appUrl()}/rider/earnings?stripe=connected`,
        refreshUrl: `${env.appUrl()}/rider/earnings?stripe=refresh`,
      });

      if (accountId !== prof.stripe_account_id) {
        const admin = getAdminSupabase();
        await admin.from('profiles').update({ stripe_account_id: accountId }).eq('id', user.id);
      }

      return NextResponse.json({ url }, { status: 200 });
    } catch (err) {
      logger.error('[stripe] rider connect onboarding failed', err);
      return ApiErrors.internal('Errore Stripe');
    }
  },
);
