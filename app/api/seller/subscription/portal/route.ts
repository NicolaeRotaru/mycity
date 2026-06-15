import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Apre il Billing Portal Stripe per il venditore: da lì può aggiornare la carta,
 * scaricare le fatture o disdire l'abbonamento mensile. Richiede un
 * stripe_customer_id già creato (cioè un abbonamento attivato almeno una volta).
 * Rate limit: 10 / 10 min per utente.
 */
export const POST = withAuthRateLimit(
  { name: 'seller-subscription-portal', max: 10, windowMs: 10 * 60_000 },
  async ({ user }): Promise<NextResponse> => {
    if (!isStripeConfigured()) return ApiErrors.unavailable('Pagamenti non disponibili al momento.');

    const supa = await getServerSupabase();
    const { data: profile } = await supa
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return ApiErrors.invalidRequest('Nessun abbonamento da gestire.');
    }

    const stripe = getStripe();
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${env.appUrl()}/seller/dashboard`,
      });
      return NextResponse.json({ url: session.url }, { status: 200 });
    } catch (e) {
      logger.error('[seller-subscription] creazione billing portal fallita', e);
      return ApiErrors.internal('Errore nell’apertura del portale.');
    }
  },
);
