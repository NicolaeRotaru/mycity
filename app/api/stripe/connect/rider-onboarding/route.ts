import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { createConnectOnboardingLink, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { ContoNonSalvato, salvaIlConto } from '@/lib/stripe/salva-conto';
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

    const supa = await getServerSupabase();
    const { data: prof, error: pErr } = await supa
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', user.id)
      .single();
    if (pErr || !prof) return ApiErrors.notFound('Profilo non trovato.');

    try {
      const { url } = await createConnectOnboardingLink({
        sellerEmail: user.email,
        sellerId: user.id,
        existingAccount: prof.stripe_account_id ?? null,
        returnUrl: `${env.appUrl()}/rider/earnings?stripe=connected`,
        refreshUrl: `${env.appUrl()}/rider/earnings?stripe=refresh`,
        // R048 — al fattorino non si chiede di poter incassare carte: non lo
        // fara' mai, e quella capacita' gli impone una verifica molto piu' pesante.
        ruolo: 'fattorino',
        salvaConto: (id) => salvaIlConto(user.id, id),
      });

      return NextResponse.json({ url }, { status: 200 });
    } catch (err) {
      // 5/11/2026 — l'id del conto non si e' salvato: non si manda a Stripe.
      if (err instanceof ContoNonSalvato) return ApiErrors.unavailable(err.message);
      logger.error('[stripe] rider connect onboarding failed', err);
      return ApiErrors.internal('Errore Stripe');
    }
  },
);
