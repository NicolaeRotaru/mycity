import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Acquisto di una gift card con pagamento REALE via Stripe.
 *
 * Flusso (volutamente separato dagli ordini):
 *  1. Il buyer sceglie importo + destinatario e chiama questo endpoint.
 *  2. Creiamo una Stripe Checkout Session (mode=payment) con metadata
 *     kind=gift_card. NON creiamo nulla a DB ora (niente carte "gratis").
 *  3. Solo a pagamento avvenuto, il webhook (checkout.session.completed con
 *     metadata.kind=gift_card) crea la riga gift_cards server-side e invia il
 *     codice al destinatario.
 *
 * Rate limit: 10 / 10 min per utente.
 */
const ALLOWED_AMOUNTS = [10, 25, 50, 100]; // euro

const Body = z.object({
  amountEuro: z.number().int().refine((v) => ALLOWED_AMOUNTS.includes(v), 'Importo non valido'),
  recipientName: z.string().min(1).max(120),
  recipientEmail: z.string().email().max(200),
  message: z.string().max(500).optional().nullable(),
});

export const POST = withAuthRateLimit(
  { name: 'gift-card-checkout', max: 10, windowMs: 10 * 60_000 },
  async ({ user, req }): Promise<NextResponse> => {
    if (!isStripeConfigured()) return ApiErrors.unavailable('Pagamenti non disponibili al momento.');
    if (!user.email_confirmed_at) {
      return ApiErrors.forbidden('Conferma la tua email prima di acquistare una gift card.');
    }

    let body: z.infer<typeof Body>;
    try {
      body = Body.parse(await req.json());
    } catch (e) {
      return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
    }

    const amountCents = body.amountEuro * 100;
    const stripe = getStripe();

    try {
      const session = await stripe.checkout.sessions.create(
        {
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
                  name: `Gift Card MyCity €${body.amountEuro}`,
                  description: `Buono regalo per ${body.recipientName}`,
                },
              },
            },
          ],
          metadata: {
            kind: 'gift_card',
            buyer_id: user.id,
            amount_cents: String(amountCents),
            recipient_name: body.recipientName.slice(0, 120),
            recipient_email: body.recipientEmail.slice(0, 200),
            message: (body.message ?? '').slice(0, 500),
          },
          success_url: `${env.appUrl()}/profile/gift-cards?giftcard=success`,
          cancel_url: `${env.appUrl()}/profile/gift-cards?giftcard=canceled`,
        },
        { idempotencyKey: `giftcard_${user.id}_${amountCents}_${body.recipientEmail}_${Date.now()}` },
      );

      return NextResponse.json({ url: session.url }, { status: 200 });
    } catch (e) {
      logger.error('[gift-card] creazione sessione Stripe fallita', e);
      return ApiErrors.internal('Errore nella creazione del pagamento.');
    }
  },
);
