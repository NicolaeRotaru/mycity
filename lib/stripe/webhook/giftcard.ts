/**
 * Buoni regalo comprati dal sito.
 *
 * #12 — Perché sta qui e non in `app/api/stripe/webhook/route.ts`.
 *
 * Quel file era uno solo, da mille righe, con dentro otto mestieri senza
 * rapporto fra loro: creazione ordini, buoni regalo, spazi sponsorizzati,
 * abbonamenti, rimborsi, contestazioni, storni, esiti dei pagamenti. Ogni
 * modifica ai buoni regalo si portava dietro il rischio di toccare la
 * creazione degli ordini, perché stavano nello stesso file e la revisione
 * mostrava un diff dentro un blocco da mille righe. È la strada su cui
 * passano tutti i soldi del marketplace: è l'ultimo posto dove si vuole una
 * revisione difficile da leggere.
 *
 * Nessuna logica è cambiata in questo spostamento: le prove esistenti sul
 * webhook sono la dimostrazione che non si è rotto niente.
 */
import type Stripe from 'stripe';
import { createHmac } from 'node:crypto';
import { getAdminSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email/client';
import { logger } from '@/lib/logger';
import { giftCardRecipientTemplate, giftCardBuyerTemplate } from '@/lib/email/templates';

/**
 * Codice gift card DETERMINISTICO dalla session id: HMAC(session.id) con il
 * webhook secret, in base32 senza caratteri ambigui. Vantaggi:
 *  - idempotenza: una re-delivery del webhook produce lo stesso codice → la PK
 *    su `code` rende il secondo insert un no-op (niente carte doppie).
 *  - non indovinabile: serve il secret del server per ricostruirlo.
 */
export function giftCardCodeForSession(sessionId: string): string {
  const secret = env.stripeWebhookSecret() ?? 'mycity-giftcard';
  const digest = createHmac('sha256', secret).update(sessionId).digest();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 simboli, niente 0/O/1/I
  let s = '';
  for (let i = 0; i < 12; i++) s += alphabet[digest[i] % 32];
  return `MC-${s}`;
}

/**
 * Pagamento gift card riuscito → crea la riga `gift_cards` (server-side, service
 * role) e invia il codice al destinatario + conferma al buyer. Best-effort sulle
 * email; idempotente sul codice (PK).
 */
export async function handleGiftCardPurchase(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const m = session.metadata ?? {};
  const amountCents = parseInt(m.amount_cents ?? '0', 10);
  const buyerId = m.buyer_id || null;
  const recipientName = m.recipient_name || null;
  const recipientEmail = m.recipient_email || null;
  const message = m.message || null;

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    // `throw`, non `return`: chi chiama interpreta il ritorno come «fatto» e
    // segna l'evento come lavorato, quindi Stripe non riprova mai piu'. Con un
    // errore l'evento resta da rifare e il problema si vede.
    logger.error('[stripe] gift_card senza amount valido', { sessionId: session.id });
    throw new Error(`gift_card senza importo valido (sessione ${session.id})`);
  }

  const code = giftCardCodeForSession(session.id);
  const { error } = await admin.from('gift_cards').insert({
    code,
    // 27/8/2026 (R045) — LA SESSIONE VA SCRITTA, ALTRIMENTI LA DIFESA E' SPENTA.
    //
    // Il codice qui sopra nasce dal segreto del webhook: se quel segreto viene
    // cambiato e Stripe riconsegna lo stesso evento, il codice che esce e'
    // diverso — e siccome l'unico antidoppione era il codice, nasceva una
    // SECONDA carta sullo stesso incasso. Credito spendibile regalato, a
    // carico nostro. La migrazione 119 aveva gia' messo la difesa giusta (un
    // indice unico su questa colonna), ma nessuno ci scriveva dentro: l'indice
    // non aveva niente da confrontare. Scritta la sessione, il secondo
    // tentativo prende il 23505 gia' gestito qui sotto come no-op.
    stripe_session_id: session.id,
    amount_cents: amountCents,
    balance_cents: amountCents,
    buyer_id: buyerId,
    recipient_name: recipientName,
    recipient_email: recipientEmail,
    message,
  });

  if (error) {
    if (error.code === '23505') {
      // Webhook ri-eseguito: carta già creata (e email già inviate). No-op.
      logger.info('[stripe] gift_card già creata per questa sessione, skip', { sessionId: session.id });
      return;
    }
    logger.error(error, { context: 'stripe-gift-card-insert', sessionId: session.id });
    // Pagamento incassato e carta regalo non creata: senza errore nessuno lo
    // scopre e il cliente resta senza quello che ha pagato.
    throw new Error(`gift_card non creata (sessione ${session.id}): ${error.message}`);
  }

  const amountEuro = amountCents / 100;

  // Nome mittente per l'email al destinatario (best-effort).
  let senderName: string | null = null;
  if (buyerId) {
    const { data: prof } = await admin.from('profiles').select('full_name').eq('id', buyerId).single();
    senderName = prof?.full_name ?? null;
  }

  if (recipientEmail) {
    const t = giftCardRecipientTemplate({ code, amountEuro, senderName, message });
    await sendEmail({ to: recipientEmail, subject: t.subject, html: t.html, text: t.text, tags: [{ name: 'template', value: 'gift_card_recipient' }] });
  }

  const buyerEmail = session.customer_details?.email ?? session.customer_email ?? null;
  if (buyerEmail) {
    const t = giftCardBuyerTemplate({ code, amountEuro, recipientName });
    await sendEmail({ to: buyerEmail, subject: t.subject, html: t.html, text: t.text, tags: [{ name: 'template', value: 'gift_card_buyer' }] });
  }
}
