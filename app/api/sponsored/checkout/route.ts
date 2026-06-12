import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Acquisto di una sponsorizzazione ("In primo piano" nella ricerca) con
 * pagamento REALE via Stripe. La campagna si attiva SOLO dopo il pagamento
 * (webhook, metadata.kind=sponsored): niente più auto-attivazione gratuita.
 *
 * Prezzo: €4,90 / 7 giorni = €0,70/giorno. Durate ammesse: 7, 14, 30 giorni.
 * Rate limit: 15 / 10 min per utente.
 */
const SPONSORED_PER_DAY_CENTS = 70;
const ALLOWED_DAYS = [7, 14, 30];

const Body = z.object({
  productId: z.string().uuid(),
  days: z.number().int().refine((v) => ALLOWED_DAYS.includes(v), 'Durata non valida'),
});

export const POST = withAuthRateLimit(
  { name: 'sponsored-checkout', max: 15, windowMs: 10 * 60_000 },
  async ({ user, req }): Promise<NextResponse> => {
    if (!isStripeConfigured()) return ApiErrors.unavailable('Pagamenti non disponibili al momento.');

    let body: z.infer<typeof Body>;
    try {
      body = Body.parse(await req.json());
    } catch (e) {
      return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
    }

    // Il prodotto deve essere del venditore corrente e in vendita.
    const supa = await getServerSupabase();
    const { data: product } = await supa
      .from('products')
      .select('id, name, seller_id, status')
      .eq('id', body.productId)
      .single();
    if (!product || product.seller_id !== user.id) return ApiErrors.forbidden('Prodotto non valido.');
    if (product.status !== 'available') {
      return ApiErrors.invalidRequest('Il prodotto deve essere in vendita per sponsorizzarlo.');
    }

    const amountCents = body.days * SPONSORED_PER_DAY_CENTS;
    const stripe = getStripe();

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: user.email ?? undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: amountCents,
              product_data: {
                name: `Sponsorizzazione "In primo piano" · ${body.days} giorni`,
                description: product.name,
              },
            },
          },
        ],
        metadata: {
          kind: 'sponsored',
          seller_id: user.id,
          product_id: product.id,
          days: String(body.days),
          placement: 'search_top',
          amount_cents: String(amountCents),
        },
        success_url: `${env.appUrl()}/seller/promote?sponsor=success`,
        cancel_url: `${env.appUrl()}/seller/promote?sponsor=canceled`,
      });
      return NextResponse.json({ url: session.url }, { status: 200 });
    } catch (e) {
      logger.error('[sponsored] creazione sessione Stripe fallita', e);
      return ApiErrors.internal('Errore nella creazione del pagamento.');
    }
  },
);
