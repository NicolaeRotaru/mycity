import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { getAdminSupabase } from '@/lib/supabase/server';
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
 *  2. Scriviamo il tentativo in `gift_card_in_attesa` (nome, email e messaggio
 *     del destinatario) e creiamo una Stripe Checkout Session (mode=payment)
 *     con metadata kind=gift_card e il solo id del tentativo. NON creiamo
 *     nessun buono ora (niente carte "gratis").
 *  3. Solo a pagamento avvenuto, il webhook (checkout.session.completed con
 *     metadata.kind=gift_card) legge il tentativo, crea la riga gift_cards
 *     server-side, cancella il tentativo e invia il codice al destinatario.
 *
 * Rate limit: 10 / 10 min per utente.
 */
const ALLOWED_AMOUNTS = [10, 25, 50, 100]; // euro

/** Impronta corta e stabile di un'email: stessa email, stessa impronta. */
function impronta(testo: string): string {
  return createHash('sha256').update(testo.trim().toLowerCase()).digest('hex').slice(0, 24);
}

type DatiDelRegalo = {
  amount_cents: number;
  recipient_name: string;
  recipient_email: string;
  message: string | null;
};

/**
 * Scrive il tentativo in `gift_card_in_attesa`, o ritrova quello gia' scritto
 * con la stessa chiave. Restituisce l'id della riga; 'diverso' se con la
 * stessa chiave erano stati scritti altri dati (Stripe rifiuterebbe comunque
 * la stessa chiave con parametri diversi); null se la riga non si scrive.
 */
async function tentativoInAttesa(
  buyerId: string,
  chiave: string,
  dati: DatiDelRegalo,
): Promise<{ id: string } | 'diverso' | null> {
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('gift_card_in_attesa')
    .insert({ buyer_id: buyerId, chiave, ...dati })
    .select('id')
    .single();
  if (!error && data) return { id: (data as { id: string }).id };
  if (error?.code !== '23505') {
    logger.error('[gift-card] tentativo non scritto: pagamento non aperto', { error: error?.message });
    return null;
  }
  const { data: prima, error: errLettura } = await admin
    .from('gift_card_in_attesa')
    .select('id, amount_cents, recipient_name, recipient_email, message')
    .eq('buyer_id', buyerId)
    .eq('chiave', chiave)
    .maybeSingle();
  if (errLettura || !prima) {
    logger.error('[gift-card] tentativo gia\' scritto ma non riletto', { error: errLettura?.message });
    return null;
  }
  const r = prima as DatiDelRegalo & { id: string };
  const uguale = r.amount_cents === dati.amount_cents
    && r.recipient_name === dati.recipient_name
    && r.recipient_email === dati.recipient_email
    && (r.message ?? null) === dati.message;
  return uguale ? { id: r.id } : 'diverso';
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
    // Senza intestazione si ripiega sulla finestra di dieci minuti (vedi sotto).
    const chiaveRiga = chiaveTentativo
      || `${amountCents}_${impronta(body.recipientEmail)}_${Math.floor(Date.now() / 600_000)}`;
    const stripe = getStripe();

    // 28/11/2026 (R08-012) — NOME, EMAIL E MESSAGGIO DEL DESTINATARIO NON VANNO A STRIPE.
    //
    // Erano nei metadati della sessione di pagamento, perche' il webhook li
    // ritrovasse a pagamento avvenuto. Il destinatario non e' nostro cliente e
    // non ha mai letto la nostra informativa: da noi quei tre campi si azzerano
    // (cancellazione dell'account, potatura dopo la scadenza), su Stripe
    // restavano per sempre, anche per i pagamenti mai conclusi. Adesso si
    // scrivono qui, in `gift_card_in_attesa`, e a Stripe va solo l'id della riga.
    // Stesso tentativo (doppio clic), stessa riga: l'id resta uguale e Stripe
    // riconosce la richiesta come la stessa invece di rifiutarla.
    // Se la riga non si scrive (migrazione 999j non applicata, database
    // giu') il pagamento non parte: niente ripiego che rimandi i dati a Stripe.
    const attesa = await tentativoInAttesa(user.id, chiaveRiga, {
      amount_cents: amountCents,
      recipient_name: body.recipientName.slice(0, 120),
      recipient_email: body.recipientEmail.slice(0, 200),
      message: body.message ? body.message.slice(0, 500) : null,
    });
    if (attesa === 'diverso') {
      return ApiErrors.conflict('I dati del regalo sono cambiati a metà tentativo: riprova.');
    }
    if (!attesa) return ApiErrors.unavailable('Buoni regalo non disponibili al momento. Riprova più tardi.');

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
                  name: `Gift Card MyCity ${body.amountEuro} €`,
                  // 5/11/2026 — Il nome del destinatario non va sulla ricevuta di Stripe.
                  description: `Buono regalo MyCity ${body.amountEuro} €`,
                },
              },
            },
          ],
          metadata: {
            kind: 'gift_card',
            buyer_id: user.id,
            amount_cents: String(amountCents),
            // Il webhook ritrova destinatario e messaggio da qui (lib/stripe/webhook/giftcard.ts).
            attesa_id: attesa.id,
          },
          // R23-008 — Il segno arriva anche sul pagamento: il tasso dei pagamenti riusciti conta
          // il buono come acquisto di un cliente (lib/stripe/webhook/pagamenti.ts). Il cliente col
          // nome che legge il registro dei tentativi, come la cassa degli ordini: `buyer_user_id`.
          payment_intent_data: { metadata: { kind: 'gift_card', buyer_user_id: user.id } },
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
            : `giftcard_${user.id}_${chiaveRiga}` },
      );

      return NextResponse.json({ url: session.url }, { status: 200 });
    } catch (e) {
      logger.error('[gift-card] creazione sessione Stripe fallita', e);
      return ApiErrors.internal('Errore nella creazione del pagamento.');
    }
  },
);
