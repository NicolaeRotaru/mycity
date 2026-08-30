import { NextResponse, type NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { getAdminSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { sessionePagata } from '@/lib/stripe/webhook/comune';
import { handleCheckoutCompleted, handleCheckoutExpired } from '@/lib/stripe/webhook/ordini';
import { handleGiftCardPurchase } from '@/lib/stripe/webhook/giftcard';
import { handleSponsoredPurchase } from '@/lib/stripe/webhook/sponsorizzati';
import { handleSellerSubscription, handleSubscriptionChanged, handleInvoicePaymentFailed } from '@/lib/stripe/webhook/abbonamenti';
import { handleChargeRefunded, handleRefundUpdated } from '@/lib/stripe/webhook/rimborsi';
import { handleDisputeCreated, handleDisputeClosed } from '@/lib/stripe/webhook/dispute';
import { handleTransferReversed, handlePayoutFailed, handleAccountUpdated } from '@/lib/stripe/webhook/trasferimenti';
import { handlePaymentIntentFailed, handlePaymentIntentSucceeded } from '@/lib/stripe/webhook/pagamenti';

export const runtime = 'nodejs';
// Stripe webhook: leggi raw body, niente parsing automatico Next
export const dynamic = 'force-dynamic';

/**
 * #12 — QUESTO FILE FA UNA COSA SOLA: SMISTA.
 *
 * Prima erano mille righe con dentro otto mestieri: creazione ordini, buoni
 * regalo, spazi sponsorizzati, abbonamenti dei venditori, rimborsi,
 * contestazioni carta, storni di bonifico, esiti dei pagamenti. Ogni modifica
 * a uno si portava dietro il rischio di toccarne un altro, perché stavano
 * nello stesso posto e la revisione mostrava un diff dentro un blocco enorme.
 * È la strada su cui passano tutti i soldi del marketplace: è l'ultimo posto
 * dove si vuole una revisione difficile da leggere.
 *
 * Qui restano tre cose, e solo quelle: la verifica della firma, il controllo
 * anti-doppione e lo smistamento. I gestori vivono in `lib/stripe/webhook/`,
 * un file per mestiere. Nessuna logica è cambiata nello spostamento.
 *
 * Va detto anche ciò che era fatto bene, perché è la parte difficile: il
 * controllo anti-doppione è corretto — l'evento si marca come lavorato solo
 * DOPO che il gestore è riuscito, quindi un nuovo tentativo di Stripe
 * riprocessa invece di rispondere «già visto».
 */
export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const secret = env.stripeWebhookSecret();

  if (!sig || !secret) {
    return NextResponse.json({ error: 'Webhook non configurato' }, { status: 503 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    logger.error(err, { context: 'stripe-webhook-signature' });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = getAdminSupabase();

  // Idempotenza event-level. processed=true viene scritto SOLO a fine handler riuscito:
  // se un tentativo precedente è fallito (processed=false), il retry di Stripe deve
  // riprocessare — prima rispondeva 200 "duplicated" e l'evento andava perso (es.
  // "pagato ma nessun ordine creato").
  // 21/8/2026 — LA RIVENDICAZIONE NASCEVA VUOTA, E LA PRIMA CONSEGNA NON ERA
  // PROTETTA. La riga entrava con `claimed_at` a NULL, e la rivendicazione qui
  // sotto accetta chi trova `claimed_at IS NULL`: mentre la prima consegna
  // lavorava, la seconda passava lo stesso. Il turno si prende adesso, con la
  // riga: la seconda trova un turno gia' preso e se ne va.
  const seen = await admin
    .from('stripe_event_log')
    .insert({ event_id: event.id, type: event.type, claimed_at: new Date().toISOString() });
  if (seen.error) {
    if (seen.error.code === '23505') {
      // 062 — Prima bastava leggere `processed`: due consegne concorrenti dello
      // stesso evento (Stripe ritenta, e il primo tentativo è ancora in corso)
      // leggevano tutte e due «non processato» e creavano tutte e due gli
      // ordini. Ora si rivendica: passa una sola, l'altra risponde 200 e se ne
      // va. Un claim più vecchio di cinque minuti si può riprendere, altrimenti
      // un processo morto a metà bloccherebbe l'evento per sempre.
      const cinqueMinutiFa = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data: rivendicato } = await admin
        .from('stripe_event_log')
        .update({ claimed_at: new Date().toISOString() })
        .eq('event_id', event.id)
        .eq('processed', false)
        .or(`claimed_at.is.null,claimed_at.lt.${cinqueMinutiFa}`)
        .select('event_id');
      if (!rivendicato || rivendicato.length === 0) {
        return NextResponse.json({ received: true, duplicated: true }, { status: 200 });
      }
    } else {
      // 27/8/2026 (R031 · R137) — IL GUARDIANO SI APRIVA DA SOLO QUANDO SI
      // ROMPEVA: su un errore diverso dal doppione (colonna non ancora
      // presente, intoppo del database, permesso) si scriveva un log e si
      // tirava dritto nello `switch`, cioè si lavorava l'evento senza
      // protezione — e la riconsegna di Stripe rifaceva ordine, bonifico e
      // giacenza. Un evento ritentato non fa danno, uno senza guardiano sì.
      logger.error(seen.error, { context: 'stripe-event-log-insert' });
      return NextResponse.json({ error: 'idempotenza non disponibile' }, { status: 503 });
    }
  }

  // 27/8/2026 (R134) — QUANDO IL GESTORE FALLIVA, IL TURNO RESTAVA PRESO: la
  // riconsegna di Stripe entro cinque minuti riceveva `200 { duplicated: true }`,
  // per Stripe la consegna era riuscita, e l'evento spariva. Su una sessione
  // pagata vuol dire cliente addebitato e ordine mai nato.
  async function liberaIlTurno(): Promise<void> {
    const { error } = await admin
      .from('stripe_event_log')
      .update({ claimed_at: null })
      .eq('event_id', event.id)
      .eq('processed', false);
    if (error) logger.error(error, { context: 'stripe-event-log-rilascio-turno' });
  }

  try {
    switch (event.type) {
      // 27/8/2026 (R139) — IL PAGAMENTO ASINCRONO ERA PROMESSO NEI COMMENTI E
      // NON NEL CODICE: finiva nel ramo `default`, cioe' in una riga di log.
      // Con un bonifico SEPA i soldi entrano e l'ordine non nasce mai.
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        /**
         * 22/8/2026 — «COMPLETATA» NON VUOL DIRE «PAGATA».
         *
         * Stripe manda `checkout.session.completed` anche quando il pagamento
         * è ancora in sospeso — un bonifico che deve arrivare, un metodo
         * asincrono che può fallire ore dopo. Il controllo c'era, ma dentro il
         * gestore degli ORDINI: buoni regalo, spazi sponsorizzati e abbonamenti
         * passavano da qui e nessuno guardava se i soldi erano arrivati.
         *
         * Un buono regalo emesso su un pagamento mai andato a buon fine è un
         * buono che qualcuno spende davvero, a spese nostre.
         *
         * Adesso il controllo è uno solo e sta prima dello smistamento: quello
         * che vale per gli ordini vale per tutto il resto, senza doverselo
         * ricordare in quattro posti.
         */
        if (!sessionePagata(session)) {
          logger.warn('[stripe] sessione completata ma non pagata: nessuna azione', {
            session: session.id,
            kind: session.metadata?.kind ?? 'ordine',
            paymentStatus: session.payment_status,
          });
          // 27/8/2026 (R134) — CHIUSURA, NON ABBANDONO: l'uscita lasciava la
          // riga rivendicata e non lavorata per sempre, cioe' un residuo che
          // falsa ogni conta degli eventi arretrati.
          await admin
            .from('stripe_event_log')
            .update({ processed: true, processed_at: new Date().toISOString() })
            .eq('event_id', event.id);
          return NextResponse.json({ received: true, nonPagata: true }, { status: 200 });
        }

        // Flussi separati dagli ordini (nessun pending_checkout).
        if (session.metadata?.kind === 'gift_card') {
          await handleGiftCardPurchase(session);
        } else if (session.metadata?.kind === 'sponsored') {
          await handleSponsoredPurchase(session);
        } else if (session.metadata?.kind === 'seller_subscription') {
          await handleSellerSubscription(session);
        } else {
          await handleCheckoutCompleted(session);
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await handleChargeRefunded(charge);
        break;
      }
      case 'charge.dispute.created': {
        await handleDisputeCreated(event.data.object as Stripe.Dispute);
        break;
      }
      case 'charge.dispute.closed': {
        await handleDisputeClosed(event.data.object as Stripe.Dispute);
        break;
      }
      case 'account.updated': {
        const acct = event.data.object as Stripe.Account;
        await handleAccountUpdated(acct);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await handleSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;
      }
      case 'invoice.payment_failed': {
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      }
      case 'transfer.reversed': {
        await handleTransferReversed(event.data.object as Stripe.Transfer);
        break;
      }
      // 27/8/2026 (R139) — Il pagamento asincrono che non arriva lascia merce
      // riservata e codice sconto bruciato: stesso rimedio del carrello scaduto.
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;
      }
      case 'payout.failed': {
        await handlePayoutFailed(event.data.object as Stripe.Payout);
        break;
      }
      case 'payment_intent.payment_failed': {
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, event.id);
        break;
      }
      // 066 — L'esito buono va registrato quanto quello cattivo: senza i
      // riusciti non esiste un tasso di autorizzazione, esiste solo un conto
      // di fallimenti senza denominatore.
      case 'payment_intent.succeeded': {
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, event.id);
        break;
      }
      // 063 — Un rimborso creato non e' un rimborso arrivato. Se la banca del
      // cliente lo rifiuta (carta chiusa, conto non piu' valido) i soldi
      // rientrano alla piattaforma, ma il database continuava a dichiarare il
      // cliente rimborsato: lui chiama, e per noi risultava gia' liquidato.
      case 'charge.refund.updated': {
        await handleRefundUpdated(event.data.object as Stripe.Refund);
        break;
      }
      default:
        // Eventi non gestiti: log e basta
        logger.info('Unhandled Stripe event', { type: event.type });
    }
    // Marca l'evento come processato SOLO dopo il successo dell'handler.
    await admin
      .from('stripe_event_log')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('event_id', event.id);
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    logger.error(err, { context: 'stripe-webhook-handler' });
    // Il turno torna libero PRIMA di rispondere, cosi' la riconsegna di Stripe
    // trova la riga lavorabile invece di un turno fresco.
    await liberaIlTurno();
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }
}
