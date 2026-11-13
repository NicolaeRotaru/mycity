import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { BUONI_REGALO_IN_VENDITA } from '@/lib/funzioni-al-lancio';

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

/** Impronta corta e stabile di un'email: stessa email, stessa impronta. */
function impronta(testo: string): string {
  return createHash('sha256').update(testo.trim().toLowerCase()).digest('hex').slice(0, 24);
}

const Body = z.object({
  amountEuro: z.number().int().refine((v) => ALLOWED_AMOUNTS.includes(v), 'Importo non valido'),
  recipientName: z.string().min(1).max(120),
  recipientEmail: z.string().email().max(200),
  message: z.string().max(500).optional().nullable(),
});

export const POST = withAuthRateLimit(
  { name: 'gift-card-checkout', max: 10, windowMs: 10 * 60_000 },
  async ({ user, req }): Promise<NextResponse> => {
    // Il freno vero della vendita spenta (carta #209): prima di Stripe, così una
    // richiesta fatta a mano non incassa soldi di terzi senza regole né parere.
    if (!BUONI_REGALO_IN_VENDITA) return ApiErrors.unavailable('I buoni regalo non sono ancora in vendita.');
    if (!isStripeConfigured()) return ApiErrors.unavailable('Pagamenti non disponibili al momento.');
    if (!user.email_confirmed_at) {
      return ApiErrors.forbidden('Conferma la tua email prima di acquistare una gift card.');
    }

    let body: z.infer<typeof Body>;
    try {
      body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
    } catch (e) {
      return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
    }

    const amountCents = body.amountEuro * 100;
    // La chiave del tentativo, mandata dal browser: una per apertura del
    // modulo, rigenerata dopo ogni esito.
    const chiaveTentativo = (req.headers.get('idempotency-key') ?? '').trim().slice(0, 100);
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
                  // 5/11/2026 — Il nome del destinatario non va sulla ricevuta di Stripe.
                  description: `Buono regalo MyCity €${body.amountEuro}`,
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
          // R23-008 — Il segno arriva anche sul pagamento: il tasso dei pagamenti riusciti conta
          // il buono come acquisto di un cliente (lib/stripe/webhook/pagamenti.ts).
          payment_intent_data: { metadata: { kind: 'gift_card', buyer_id: user.id } },
          success_url: `${env.appUrl()}/profile/gift-cards?giftcard=success`,
          cancel_url: `${env.appUrl()}/profile/gift-cards?giftcard=canceled`,
        },
        // 187 — Con `Date.now()` dentro, la chiave era diversa a ogni chiamata:
        // cioè non proteggeva da niente, che è il contrario di una chiave di
        // idempotenza. Due clic sul pulsante «Regala» aprivano due sessioni di
        // pagamento per la stessa carta. Ora la finestra è di dieci minuti: due
        // tentativi ravvicinati sono lo stesso tentativo, uno domani è un altro.
        // 22/8/2026 — LA FINESTRA DI DIECI MINUTI ERA UNA SCELTA SBAGLIATA IN
        // TUTTE E DUE LE DIREZIONI.
        //
        // Due regali identici alla stessa persona nella stessa finestra — due
        // fratelli, due colleghi che si fanno il regalo di gruppo — venivano
        // fusi in uno: il secondo non nasceva mai, e nessuno lo diceva. E due
        // clic a undici minuti di distanza aprivano due pagamenti veri.
        //
        // La chiave giusta la manda il browser: una per tentativo, rigenerata
        // dopo ogni esito. È lo stesso meccanismo del percorso in contanti.
        // Senza intestazione si ripiega sulla finestra di prima, che è meglio
        // di niente.
        { idempotencyKey: chiaveTentativo
            ? `giftcard_${user.id}_${chiaveTentativo}`
            // 5/11/2026 — L'email non entra in chiaro nella chiave: con un'email
            // lunga superava i 255 caratteri ammessi da Stripe, e restava
            // scritta su Stripe per sempre. Al suo posto un'impronta corta.
            : `giftcard_${user.id}_${amountCents}_${impronta(body.recipientEmail)}_${Math.floor(Date.now() / 600_000)}` },
      );

      return NextResponse.json({ url: session.url }, { status: 200 });
    } catch (e) {
      logger.error('[gift-card] creazione sessione Stripe fallita', e);
      return ApiErrors.internal('Errore nella creazione del pagamento.');
    }
  },
);
