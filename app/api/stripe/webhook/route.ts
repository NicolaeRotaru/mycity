import { NextResponse, type NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import type Stripe from 'stripe';
import { getStripe, computeOrderSplit } from '@/lib/stripe/client';
import { reverseOrderTransfer, applyConnectAccountStatus } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email/client';
import { orderConfirmedBuyerTemplate, newOrderSellerTemplate, refundIssuedTemplate, giftCardRecipientTemplate, giftCardBuyerTemplate } from '@/lib/email/templates';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
// Stripe webhook: leggi raw body, niente parsing automatico Next
export const dynamic = 'force-dynamic';

/**
 * Webhook Stripe. Eventi gestiti:
 *
 *  - checkout.session.completed  → legge il pending_checkout linkato
 *                                  e crea N ordini DB (uno per seller)
 *                                  con payment_status PAID, payout_status HELD
 *  - charge.refunded             → su refund PIENO annulla gli ordini della
 *                                  charge + claw-back dei transfer già inviati
 *                                  (refund parziale: gestito da refundOrder)
 *  - charge.dispute.created      → flag dispute_status=OPEN (blocca il payout
 *                                  cron) + auto-reversal se già pagato + alert admin
 *  - charge.dispute.closed       → won: sblocca; lost: annulla l'ordine
 *  - account.updated             → aggiorna stato Connect del seller
 *  - customer.subscription.*     → sincronizza l'abbonamento venditore (€50/mese)
 *  - invoice.payment_failed      → abbonamento venditore past_due + alert
 *
 * Sicurezza:
 *  - Verifica firma con STRIPE_WEBHOOK_SECRET (constructEvent).
 *  - Idempotenza event-level via stripe_event_log (event.id unique).
 *  - Idempotenza order-level via unique index (stripe_session_id, seller_id).
 *  - Idempotenza checkout-level via pending_checkouts.status='COMPLETED'.
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
  const seen = await admin.from('stripe_event_log').insert({ event_id: event.id, type: event.type });
  if (seen.error) {
    if (seen.error.code === '23505') {
      const { data: existing } = await admin
        .from('stripe_event_log')
        .select('processed')
        .eq('event_id', event.id)
        .single();
      if (existing?.processed) {
        return NextResponse.json({ received: true, duplicated: true }, { status: 200 });
      }
      // tentativo precedente non completato → procedi a riprocessare
    } else {
      logger.error(seen.error, { context: 'stripe-event-log-insert' });
    }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
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
      case 'checkout.session.expired': {
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;
      }
      case 'payout.failed': {
        await handlePayoutFailed(event.data.object as Stripe.Payout);
        break;
      }
      case 'payment_intent.payment_failed': {
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
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
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }
}

type PendingGroup = {
  sellerId: string;
  storeName: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitAmountCents: number;
    imageUrl?: string;
    variantId?: string | null;
    variantLabel?: string | null;
  }>;
  subtotalCents: number;
  shippingCents: number;
  deliveryFeeCents?: number;
  couponPortionCents: number;
  pickupPortionCents: number;
  totalCents: number;
};

type PendingDelivery = {
  full_name: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  // Fascia di consegna scelta dal buyer (es. "Oggi · 18:00–20:00"); null per
  // ritiro / non scelta. Scritta su orders.delivery_slot. Opzionale per
  // retro-compatibilità coi pending_checkouts creati prima di questa colonna.
  slot?: string | null;
};

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const stripe = getStripe();
  const pendingCheckoutId = session.client_reference_id ?? session.metadata?.pending_checkout_id;
  if (!pendingCheckoutId) {
    logger.warn('[stripe] checkout.session.completed senza pending_checkout_id', { sessionId: session.id });
    return;
  }

  // Carica il record-of-intent
  const { data: pending, error: pendErr } = await admin
    .from('pending_checkouts')
    .select('id, buyer_id, status, groups, coupon_code, delivery, pickup_in_store, total_cents, stripe_session_id')
    .eq('id', pendingCheckoutId)
    .single();

  if (pendErr || !pending) {
    logger.error('[stripe] pending_checkout non trovato', { pendingCheckoutId, err: pendErr });
    // Throw: Stripe ritenterà il webhook invece di marcare l'evento come processed.
    throw new Error(`pending_checkout non trovato: ${pendingCheckoutId}`);
  }

  // Idempotenza checkout-level: se già processato, no-op.
  if (pending.status === 'COMPLETED') {
    logger.info('[stripe] pending_checkout già COMPLETED, skip', { pendingCheckoutId });
    return;
  }

  const groups = pending.groups as PendingGroup[];
  const delivery = pending.delivery as PendingDelivery;
  const pickupInStore = !!pending.pickup_in_store;
  const buyerId = pending.buyer_id as string;
  const couponCode = (pending.coupon_code as string | null) ?? null;

  if (!Array.isArray(groups) || groups.length === 0) {
    logger.error('[stripe] pending_checkout senza groups', { pendingCheckoutId });
    throw new Error(`pending_checkout ${pendingCheckoutId} senza groups validi`);
  }

  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : null;
  const transferGroup = `mc_${pendingCheckoutId}`;

  // Recupera la latest_charge dal PaymentIntent per popolare stripe_charge_id
  // (serve a /api/stripe/payout per usare source_transaction).
  let stripeChargeId: string | null = null;
  if (paymentIntent) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntent, { expand: ['latest_charge'] });
      const lc = pi.latest_charge;
      stripeChargeId = typeof lc === 'string' ? lc : (lc?.id ?? null);
    } catch (e) {
      logger.warn('[stripe] retrieve PI per charge_id fallita', e);
    }
  }

  const buyerEmail = session.customer_details?.email ?? session.customer_email ?? null;
  const buyerName = session.customer_details?.name ?? delivery.full_name;
  const createdOrderIds: Array<{ orderId: string; sellerId: string; totalCents: number; itemsCount: number }> = [];

  // Crea N ordini, uno per gruppo
  for (const g of groups) {
    const deliveryFeeCents = g.deliveryFeeCents ?? 0;
    // Split del denaro in un'unica funzione pura. La commissione (10%) grava SOLO
    // sul subtotale prodotti: la fee di consegna (alla piattaforma) e la spedizione
    // (g.shippingCents, versata a parte al rider via releaseRiderPayout) NON sono
    // gravate dalla commissione. Il netto venditore = 90% del subtotale.
    const { applicationFeeCents: feeCents, sellerPayoutCents: payoutCents } = computeOrderSplit({
      totalCents: g.totalCents,
      deliveryFeeCents,
      shippingCents: g.shippingCents,
    });

    const { data: order, error: orderErr } = await admin
      .from('orders')
      .insert({
        user_id: buyerId,
        seller_id: g.sellerId,
        total_price: g.totalCents / 100,
        shipping_cost: g.shippingCents / 100,
        delivery_fee_cents: deliveryFeeCents,
        discount_amount: (g.couponPortionCents + g.pickupPortionCents) / 100,
        coupon_code: couponCode,
        pickup_in_store: pickupInStore,
        // Fascia di consegna scelta dal buyer (dal pending_checkout.delivery.slot).
        delivery_slot: pickupInStore ? null : (delivery.slot ?? null),
        payment_status: 'PAID',
        payment_method: 'card',
        delivery_status: 'NEW',
        stripe_session_id: session.id,
        stripe_payment_intent: paymentIntent,
        stripe_charge_id: stripeChargeId,
        stripe_transfer_group: transferGroup,
        application_fee_cents: feeCents,
        seller_payout_cents: payoutCents,
        payout_status: 'HELD',
        delivery_full_name: delivery.full_name,
        delivery_phone: delivery.phone,
        delivery_address: delivery.address,
        delivery_city: delivery.city,
        delivery_zip: delivery.zip,
        delivery_notes: delivery.notes,
        delivery_lat: delivery.lat,
        delivery_lng: delivery.lng,
      })
      .select('id')
      .single();

    // Idempotenza order-level: unique (stripe_session_id, seller_id).
    // Se la riga esiste già (es. webhook ri-eseguito), skip silenzioso.
    if (orderErr) {
      if (orderErr.code === '23505') {
        // Idempotenza retry webhook: ordine già creato in un tentativo precedente.
        const { data: existing } = await admin
          .from('orders')
          .select('id')
          .eq('stripe_session_id', session.id)
          .eq('seller_id', g.sellerId)
          .maybeSingle();
        if (existing?.id) {
          createdOrderIds.push({
            orderId: existing.id,
            sellerId: g.sellerId,
            totalCents: g.totalCents,
            itemsCount: g.items.reduce((s, it) => s + it.quantity, 0),
          });
          continue;
        }
      }
      logger.error(orderErr, { context: 'stripe-order-insert', sellerId: g.sellerId });
      throw new Error(`stripe-order-insert failed for seller ${g.sellerId}`);
    }
    if (!order) {
      throw new Error(`stripe-order-insert returned null for seller ${g.sellerId}`);
    }

    // order_items
    const orderItemsRows = g.items.map((it) => ({
      order_id: order.id,
      product_id: it.productId,
      quantity: it.quantity,
      unit_price: it.unitAmountCents / 100,
      variant_id: it.variantId ?? null,
      variant_label: it.variantLabel ?? null,
    }));
    const { error: itemsErr } = await admin.from('order_items').insert(orderItemsRows);
    if (itemsErr) {
      logger.error(itemsErr, { context: 'stripe-order-items-insert', orderId: order.id });
      await admin.from('orders').delete().eq('id', order.id);
      throw new Error(`stripe-order-items-insert failed for order ${order.id}`);
    }

    createdOrderIds.push({
      orderId: order.id,
      sellerId: g.sellerId,
      totalCents: g.totalCents,
      itemsCount: g.items.reduce((s, it) => s + it.quantity, 0),
    });
  }

  // Solo se TUTTI i gruppi hanno un ordine: altrimenti lascia PENDING e 500 → retry Stripe.
  if (createdOrderIds.length !== groups.length) {
    logger.error('[stripe] checkout parziale: ordini creati insufficienti', {
      pendingCheckoutId,
      expected: groups.length,
      created: createdOrderIds.length,
    });
    throw new Error(`partial checkout: ${createdOrderIds.length}/${groups.length} orders created`);
  }

  // NB: il coupon è già stato claimato atomicamente in /api/stripe/checkout (claim_coupon, fix #36).
  // Non richiamiamo increment_coupon_usage qui per evitare doppio conteggio.

  // Marca pending_checkout come COMPLETED solo a checkout interamente riuscito.
  await admin
    .from('pending_checkouts')
    .update({
      status: 'COMPLETED',
      stripe_payment_intent: paymentIntent,
      processed_at: new Date().toISOString(),
    })
    .eq('id', pendingCheckoutId);

  // Email buyer + seller (best-effort, per ogni ordine creato)
  for (const created of createdOrderIds) {
    const groupForOrder = groups.find((x) => x.sellerId === created.sellerId);
    const storeName = groupForOrder?.storeName ?? 'venditore';

    if (buyerEmail) {
      const t = orderConfirmedBuyerTemplate({
        name: buyerName,
        orderId: created.orderId,
        total: created.totalCents / 100,
        storeName,
      });
      await sendEmail({ to: buyerEmail, subject: t.subject, html: t.html, text: t.text });
    }

    const { data: sellerAuth } = await admin.auth.admin.getUserById(created.sellerId);
    const sellerEmail = sellerAuth?.user?.email;
    if (sellerEmail) {
      const t = newOrderSellerTemplate({
        sellerName: null,
        orderId: created.orderId,
        total: created.totalCents / 100,
        itemsCount: created.itemsCount,
      });
      await sendEmail({ to: sellerEmail, subject: t.subject, html: t.html, text: t.text });
    }

    // Notifica in-app al venditore (campanella) — nuovo ordine ricevuto
    await admin.from('notifications').insert({
      user_id: created.sellerId,
      title: '📦 Nuovo ordine ricevuto',
      body: `Ordine #${created.orderId.slice(0, 6).toUpperCase()} · €${(created.totalCents / 100).toFixed(2)} · ${created.itemsCount} articoli`,
      link: `/seller/orders/${created.orderId}`,
    });
  }
}

/**
 * Codice gift card DETERMINISTICO dalla session id: HMAC(session.id) con il
 * webhook secret, in base32 senza caratteri ambigui. Vantaggi:
 *  - idempotenza: una re-delivery del webhook produce lo stesso codice → la PK
 *    su `code` rende il secondo insert un no-op (niente carte doppie).
 *  - non indovinabile: serve il secret del server per ricostruirlo.
 */
function giftCardCodeForSession(sessionId: string): string {
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
async function handleGiftCardPurchase(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const m = session.metadata ?? {};
  const amountCents = parseInt(m.amount_cents ?? '0', 10);
  const buyerId = m.buyer_id || null;
  const recipientName = m.recipient_name || null;
  const recipientEmail = m.recipient_email || null;
  const message = m.message || null;

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    logger.error('[stripe] gift_card senza amount valido', { sessionId: session.id });
    return;
  }

  const code = giftCardCodeForSession(session.id);
  const { error } = await admin.from('gift_cards').insert({
    code,
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
    return;
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

/**
 * Pagamento sponsorizzazione riuscito → crea la `sponsored_listing` attiva
 * (server-side, service role). Idempotente sullo stripe_session_id.
 */
async function handleSponsoredPurchase(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const m = session.metadata ?? {};
  const sellerId = m.seller_id || null;
  const productId = m.product_id || null;
  const days = parseInt(m.days ?? '0', 10);
  const placement = m.placement || 'search_top';
  const amountCents = parseInt(m.amount_cents ?? '0', 10);

  if (!sellerId || !productId || !Number.isFinite(days) || days <= 0) {
    logger.error('[stripe] sponsored metadata incompleti', { sessionId: session.id });
    return;
  }

  const today = new Date();
  const end = new Date(today.getTime() + days * 86_400_000);
  const startStr = today.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const perDay = days > 0 ? Math.round(amountCents / days) : amountCents;

  const { error } = await admin.from('sponsored_listings').insert({
    product_id: productId,
    seller_id: sellerId,
    placement,
    category_slug: null,
    start_date: startStr,
    end_date: endStr,
    daily_budget_cents: perDay,
    spent_cents: amountCents,
    status: 'active',
    stripe_session_id: session.id,
  });

  if (error) {
    if (error.code === '23505') {
      logger.info('[stripe] sponsored già creata per questa sessione, skip', { sessionId: session.id });
      return;
    }
    logger.error(error, { context: 'stripe-sponsored-insert', sessionId: session.id });
    return;
  }

  await admin.from('notifications').insert({
    user_id: sellerId,
    title: '✨ Sponsorizzazione attiva',
    body: `Il tuo prodotto è "In primo piano" nella ricerca fino al ${endStr}.`,
    link: '/seller/promote',
  });
}

/** Mappa lo stato Stripe della subscription sul nostro enum profili. */
function mapSubscriptionStatus(status: Stripe.Subscription.Status): 'active' | 'past_due' | 'canceled' {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    default: // canceled, incomplete_expired
      return 'canceled';
  }
}

/**
 * Checkout abbonamento venditore riuscito (mode=subscription). Salva i
 * riferimenti Stripe Customer/Subscription sul profilo e attiva l'abbonamento.
 * Idempotente: una re-delivery riscrive gli stessi valori.
 */
async function handleSellerSubscription(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const sellerId = session.metadata?.seller_id || null;
  const customerId = typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : (session.subscription?.id ?? null);

  if (!sellerId || !subscriptionId) {
    logger.error('[stripe] seller_subscription metadata incompleti', { sessionId: session.id });
    return;
  }

  // Recupera periodo di rinnovo (best-effort).
  let renewsAt: string | null = null;
  try {
    const sub = await getStripe().subscriptions.retrieve(subscriptionId);
    if (sub.current_period_end) renewsAt = new Date(sub.current_period_end * 1000).toISOString();
  } catch (e) {
    logger.warn('[stripe] retrieve subscription per renews_at fallita', e);
  }

  await admin
    .from('profiles')
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: 'active',
      subscription_renews_at: renewsAt,
    })
    .eq('id', sellerId);

  await admin.from('notifications').insert({
    user_id: sellerId,
    title: '✅ Abbonamento attivo',
    body: 'Il tuo abbonamento venditore (€50/mese) è attivo. Grazie!',
    link: '/seller/dashboard',
  });
}

/**
 * customer.subscription.updated / .deleted → sincronizza subscription_status e
 * subscription_renews_at sul profilo del venditore (lookup per subscription id).
 */
async function handleSubscriptionChanged(sub: Stripe.Subscription) {
  const admin = getAdminSupabase();
  const status = mapSubscriptionStatus(sub.status);
  const renewsAt = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  await admin
    .from('profiles')
    .update({ subscription_status: status, subscription_renews_at: renewsAt })
    .eq('stripe_subscription_id', sub.id);
}

/**
 * invoice.payment_failed → la carta del venditore è stata rifiutata: marca
 * l'abbonamento past_due (lookup per customer id) e avvisa il venditore.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null);
  if (!customerId) return;
  const admin = getAdminSupabase();
  const { data: rows } = await admin
    .from('profiles')
    .update({ subscription_status: 'past_due' })
    .eq('stripe_customer_id', customerId)
    .select('id');
  for (const r of rows ?? []) {
    await admin.from('notifications').insert({
      user_id: r.id,
      title: '⚠️ Pagamento abbonamento non riuscito',
      body: 'Non siamo riusciti ad addebitare l’abbonamento mensile. Aggiorna il metodo di pagamento.',
      link: '/seller/dashboard',
    });
  }
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const admin = getAdminSupabase();
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!pi) return;

  // Multi-seller: una charge può avere N ordini (uno per seller).
  const { data: orders } = await admin
    .from('orders')
    .select('id, user_id, total_price, seller_id, payout_status, payment_status, stripe_transfer_id, seller_payout_cents, stripe_reversal_id')
    .eq('stripe_payment_intent', pi);

  if (!orders || orders.length === 0) return;

  // Solo i refund PIENI annullano gli ordini a tappeto. I refund parziali
  // (reso/dispute di un singolo ordine) sono già gestiti per-ordine da
  // refundOrder: qui li ignoriamo per non cancellare l'intera charge
  // multi-seller.
  const fullyRefunded = charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? 0);
  if (!fullyRefunded) {
    // 🟡-6: un refund PARZIALE su una charge multi-seller non è auto-riconciliabile
    // qui (Stripe non dice a quale dei N ordini si riferisce). I refund parziali
    // DEVONO passare dal flusso interno (returns/decide, disputes/resolve), che
    // chiama refundOrder con reversal proporzionale per-ordine. Se arriva un
    // parziale "out-of-band" (es. dal Dashboard), lo segnaliamo come warning
    // (→ Sentry) per la riconciliazione manuale, invece di ignorarlo in silenzio.
    logger.warn('[stripe] charge.refunded PARZIALE fuori dal flusso interno: riconciliare a mano', {
      pi,
      chargeId: charge.id,
      amountRefunded: charge.amount_refunded,
      amount: charge.amount,
    });
    return;
  }

  const refundAmount = (charge.amount_refunded ?? 0) / 100;
  // 🟢-1: charge.refunds non è sempre espanso nel payload → fallback via API per
  // non perdere stripe_refund_id (tracciabilità del rimborso).
  let refund: Stripe.Refund | null = charge.refunds?.data?.[0] ?? null;
  if (!refund && charge.id) {
    try {
      const list = await getStripe().refunds.list({ charge: charge.id, limit: 1 });
      refund = list.data[0] ?? null;
    } catch {
      logger.warn('[stripe] refunds.list fallback fallito', { chargeId: charge.id });
    }
  }
  const refundReason = refund?.reason ?? null;
  const refundId = refund?.id ?? null;

  // Claw-back dei transfer già inviati (idempotente: no-op se non TRANSFERRED
  // o già revertito). reverseOrderTransfer porta quelli pagati a 'REVERSED'.
  const reversedIds: string[] = [];
  for (const o of orders) {
    if (o.payout_status === 'TRANSFERRED') {
      try {
        const { reversalId } = await reverseOrderTransfer(o);
        if (reversalId) reversedIds.push(o.id);
      } catch (e) {
        logger.error('[stripe] reversal on charge.refunded failed', { orderId: o.id, e });
      }
    }
  }

  const allIds = orders.map((o) => o.id);
  await admin
    .from('orders')
    .update({
      payment_status: 'REFUNDED',
      delivery_status: 'CANCELED',
      stripe_refund_id: refundId,
      canceled_at: new Date().toISOString(),
    })
    .in('id', allIds);
  // refunded_amount_cents per ordine (refund pieno = totale ordine).
  for (const o of orders) {
    await admin
      .from('orders')
      .update({ refunded_amount_cents: Math.round(Number(o.total_price) * 100) })
      .eq('id', o.id);
  }

  // payout_status: i pagati sono già 'REVERSED' dal reversal; gli altri 'REFUNDED'.
  const refundedIds = allIds.filter((id) => !reversedIds.includes(id));
  if (refundedIds.length > 0) {
    await admin.from('orders').update({ payout_status: 'REFUNDED' }).in('id', refundedIds);
  }

  // Ripristina lo stock solo se refundOrder non l'ha già fatto (evita doppio restore).
  for (const o of orders) {
    if (o.payment_status === 'REFUNDED') continue;
    await admin.rpc('restore_stock_for_order', { p_order_id: o.id });
  }

  // Email buyer (una sola email anche se sono N ordini — è la stessa charge)
  const firstOrder = orders[0];
  const { data: ua } = await admin.auth.admin.getUserById(firstOrder.user_id);
  const buyerEmail = ua?.user?.email;
  if (buyerEmail) {
    const t = refundIssuedTemplate({
      orderId: firstOrder.id,
      amount: refundAmount,
      reason: refundReason,
    });
    await sendEmail({ to: buyerEmail, subject: t.subject, html: t.html, text: t.text });
  }
}

async function handleAccountUpdated(acct: Stripe.Account) {
  // Logica condivisa con POST /api/stripe/connect/refresh-status.
  await applyConnectAccountStatus(acct);
}

type DisputeOrderRow = {
  id: string;
  payout_status: string | null;
  stripe_transfer_id: string | null;
  seller_payout_cents: number | null;
  stripe_reversal_id: string | null;
};

/** Trova gli ordini legati alla charge/PI di una dispute (multi-seller). */
async function findOrdersForDispute(dispute: Stripe.Dispute, columns: string): Promise<DisputeOrderRow[]> {
  const admin = getAdminSupabase();
  const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge?.id ?? null);
  if (pi) {
    const { data } = await admin.from('orders').select(columns).eq('stripe_payment_intent', pi);
    if (data && data.length > 0) return data as unknown as DisputeOrderRow[];
  }
  if (chargeId) {
    const { data } = await admin.from('orders').select(columns).eq('stripe_charge_id', chargeId);
    if (data && data.length > 0) return data as unknown as DisputeOrderRow[];
  }
  return [];
}

/** Inserisce una notifica per tutti gli admin. */
async function notifyAdmins(title: string, body: string, link: string) {
  const admin = getAdminSupabase();
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
  if (!admins || admins.length === 0) return;
  await admin.from('notifications').insert(admins.map((a) => ({ user_id: a.id, title, body, link })));
}

/**
 * charge.dispute.created → chargeback aperto. Stripe ha GIÀ prelevato i fondi
 * dalla piattaforma, quindi NON emettiamo refund (sarebbe doppio): facciamo
 * solo claw-back del transfer se il venditore era già stato pagato, flagghiamo
 * gli ordini (dispute_status='OPEN' blocca il payout cron) e avvisiamo gli admin.
 */
async function handleDisputeCreated(dispute: Stripe.Dispute) {
  const orders = await findOrdersForDispute(
    dispute,
    'id, payout_status, stripe_transfer_id, seller_payout_cents, stripe_reversal_id',
  );
  if (orders.length === 0) {
    logger.warn('[stripe] dispute.created: nessun ordine trovato', { disputeId: dispute.id });
    return;
  }

  for (const o of orders) {
    if (o.payout_status === 'TRANSFERRED') {
      try {
        await reverseOrderTransfer(o);
      } catch (e) {
        logger.error('[stripe] reversal on dispute.created failed', { orderId: o.id, e });
      }
    }
  }

  const admin = getAdminSupabase();
  await admin
    .from('orders')
    .update({ dispute_status: 'OPEN', disputed_at: new Date().toISOString() })
    .in('id', orders.map((o) => o.id));

  await notifyAdmins(
    '⚠️ Chargeback aperto',
    `Contestazione bancaria su ordine ${orders[0].id}${orders.length > 1 ? ` (+${orders.length - 1})` : ''} — ${((dispute.amount ?? 0) / 100).toFixed(2)}€.`,
    '/admin/disputes',
  );
}

/**
 * charge.dispute.closed → won: sblocca (gli ordini HELD tornano eleggibili al
 * payout cron). lost: i fondi sono già stati prelevati da Stripe (reversal già
 * fatto all'apertura) → annulla l'ordine (semantica rimborso).
 */
async function handleDisputeClosed(dispute: Stripe.Dispute) {
  const orders = await findOrdersForDispute(dispute, 'id, payout_status');
  if (orders.length === 0) return;
  const admin = getAdminSupabase();
  const ids = orders.map((o) => o.id);

  if (dispute.status === 'won') {
    await admin.from('orders').update({ dispute_status: 'WON' }).in('id', ids);
    await notifyAdmins('✓ Chargeback vinto', `Contestazione vinta su ordine ${ids[0]}. Payout sbloccato.`, '/admin/disputes');
  } else if (dispute.status === 'lost') {
    await admin
      .from('orders')
      .update({
        dispute_status: 'LOST',
        delivery_status: 'CANCELED',
        payment_status: 'REFUNDED',
        canceled_at: new Date().toISOString(),
      })
      .in('id', ids);
    for (const id of ids) {
      await admin.rpc('restore_stock_for_order', { p_order_id: id });
    }
    await notifyAdmins('✕ Chargeback perso', `Contestazione persa su ordine ${ids[0]}. Ordine annullato.`, '/admin/disputes');
  } else {
    logger.info('[stripe] dispute.closed: stato non gestito', { status: dispute.status });
  }
}

/**
 * transfer.reversed → un transfer al seller/rider è stato revertito (claw-back o
 * azione Stripe). Sincronizza lo stato payout dell'ordine, così il DB non diverge
 * silenziosamente dalla realtà Stripe.
 */
async function handleTransferReversed(transfer: Stripe.Transfer) {
  const admin = getAdminSupabase();
  await admin.from('orders').update({ payout_status: 'REVERSED' }).eq('stripe_transfer_id', transfer.id);
  await admin.from('orders').update({ rider_payout_status: 'REVERSED' }).eq('rider_transfer_id', transfer.id);
  logger.info('[stripe] transfer.reversed sincronizzato', { transferId: transfer.id });
}

/**
 * checkout.session.expired → il buyer ha abbandonato il pagamento. Rilascia lo stock
 * riservato al checkout (immediato, senza attendere il cron expire-checkouts).
 */
async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const pid = session.client_reference_id ?? session.metadata?.pending_checkout_id;
  if (!pid) return;
  const { data: pending } = await admin
    .from('pending_checkouts')
    .select('id, status, groups')
    .eq('id', pid)
    .single();
  if (!pending || pending.status !== 'PENDING') return;
  const groups = (pending.groups as PendingGroup[]) ?? [];
  const items = groups.flatMap((g) =>
    (g.items ?? []).map((it) => ({ product_id: it.productId, variant_id: it.variantId ?? null, qty: it.quantity })),
  );
  if (items.length > 0) await admin.rpc('restore_stock', { p_items: items });
  await admin.from('pending_checkouts').update({ status: 'EXPIRED' }).eq('id', pid);
}

/** payout.failed → il bonifico bancario di un connected account è fallito: alert admin. */
async function handlePayoutFailed(payout: Stripe.Payout) {
  await notifyAdmins(
    '⚠️ Payout bancario fallito',
    `Payout ${payout.id} fallito (${((payout.amount ?? 0) / 100).toFixed(2)}€): ${payout.failure_message ?? 'motivo sconosciuto'}.`,
    '/admin',
  );
  logger.warn('[stripe] payout.failed', { payoutId: payout.id, failure: payout.failure_message });
}

/** payment_intent.payment_failed → pagamento non riuscito: log (l'ordine non viene creato). */
async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  logger.warn('[stripe] payment_intent.payment_failed', {
    paymentIntent: pi.id,
    lastError: pi.last_payment_error?.message ?? null,
  });
}
