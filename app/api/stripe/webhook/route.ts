import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, computeApplicationFeeCents } from '@/lib/stripe/client';
import { reverseOrderTransfer } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email/client';
import { orderConfirmedBuyerTemplate, newOrderSellerTemplate, refundIssuedTemplate } from '@/lib/email/templates';
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

  // Idempotenza basata su event.id (created_at unique)
  const seen = await admin.from('stripe_event_log').insert({ event_id: event.id, type: event.type });
  if (seen.error && seen.error.code === '23505') {
    return NextResponse.json({ received: true, duplicated: true }, { status: 200 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
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
      default:
        // Eventi non gestiti: log e basta
        logger.info('Unhandled Stripe event', { type: event.type });
    }
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    logger.error(err, { context: 'stripe-webhook-handler' });
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }
}

type PendingGroup = {
  sellerId: string;
  storeName: string;
  items: Array<{ productId: string; name: string; quantity: number; unitAmountCents: number; imageUrl?: string }>;
  subtotalCents: number;
  shippingCents: number;
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
};

type PendingB2B = {
  company_name: string;
  vat_number: string;
  sdi_code: string | null;
  pec: string | null;
} | null;

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
    .select('id, buyer_id, status, groups, coupon_code, b2b, delivery, pickup_in_store, total_cents, stripe_session_id')
    .eq('id', pendingCheckoutId)
    .single();

  if (pendErr || !pending) {
    logger.error('[stripe] pending_checkout non trovato', { pendingCheckoutId, err: pendErr });
    return;
  }

  // Idempotenza checkout-level: se già processato, no-op.
  if (pending.status === 'COMPLETED') {
    logger.info('[stripe] pending_checkout già COMPLETED, skip', { pendingCheckoutId });
    return;
  }

  const groups = pending.groups as PendingGroup[];
  const delivery = pending.delivery as PendingDelivery;
  const b2b = pending.b2b as PendingB2B;
  const pickupInStore = !!pending.pickup_in_store;
  const buyerId = pending.buyer_id as string;
  const couponCode = (pending.coupon_code as string | null) ?? null;

  if (!Array.isArray(groups) || groups.length === 0) {
    logger.error('[stripe] pending_checkout senza groups', { pendingCheckoutId });
    return;
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
    const feeCents = computeApplicationFeeCents(g.totalCents);
    const payoutCents = g.totalCents - feeCents;

    const { data: order, error: orderErr } = await admin
      .from('orders')
      .insert({
        user_id: buyerId,
        seller_id: g.sellerId,
        total_price: g.totalCents / 100,
        shipping_cost: g.shippingCents / 100,
        discount_amount: (g.couponPortionCents + g.pickupPortionCents) / 100,
        coupon_code: couponCode,
        pickup_in_store: pickupInStore,
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
        logger.info('[stripe] order già presente per (session, seller), skip', { sessionId: session.id, sellerId: g.sellerId });
        continue;
      }
      logger.error(orderErr, { context: 'stripe-order-insert', sellerId: g.sellerId });
      continue;
    }
    if (!order) continue;

    // order_items
    const orderItemsRows = g.items.map((it) => ({
      order_id: order.id,
      product_id: it.productId,
      quantity: it.quantity,
      unit_price: it.unitAmountCents / 100,
    }));
    const { error: itemsErr } = await admin.from('order_items').insert(orderItemsRows);
    if (itemsErr) {
      logger.error(itemsErr, { context: 'stripe-order-items-insert', orderId: order.id });
    }

    // B2B: dettaglio fattura elettronica (se attivato)
    if (b2b && b2b.company_name && b2b.vat_number) {
      const { error: bErr } = await admin.from('business_orders').insert({
        order_id: order.id,
        company_name: b2b.company_name,
        vat_number: b2b.vat_number,
        sdi_code: b2b.sdi_code,
        pec: b2b.pec,
        invoice_required: true,
      });
      if (bErr && !bErr.message.includes('does not exist')) {
        logger.warn('business_orders insert failed', { message: bErr.message });
      }
    }

    createdOrderIds.push({
      orderId: order.id,
      sellerId: g.sellerId,
      totalCents: g.totalCents,
      itemsCount: g.items.reduce((s, it) => s + it.quantity, 0),
    });
  }

  // Marca pending_checkout come COMPLETED (idempotenza guard per re-delivery webhook)
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
  }
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const admin = getAdminSupabase();
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!pi) return;

  // Multi-seller: una charge può avere N ordini (uno per seller).
  const { data: orders } = await admin
    .from('orders')
    .select('id, user_id, total_price, seller_id, payout_status, stripe_transfer_id, seller_payout_cents, stripe_reversal_id')
    .eq('stripe_payment_intent', pi);

  if (!orders || orders.length === 0) return;

  // Solo i refund PIENI annullano gli ordini a tappeto. I refund parziali
  // (reso/dispute di un singolo ordine) sono già gestiti per-ordine da
  // refundOrder: qui li ignoriamo per non cancellare l'intera charge
  // multi-seller.
  const fullyRefunded = charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? 0);
  if (!fullyRefunded) {
    logger.info('[stripe] charge.refunded parziale: nessun blanket-cancel', { pi, amountRefunded: charge.amount_refunded });
    return;
  }

  const refundAmount = (charge.amount_refunded ?? 0) / 100;
  const refundReason = charge.refunds?.data?.[0]?.reason ?? null;
  const refundId = charge.refunds?.data?.[0]?.id ?? null;

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
      payment_status: 'FAILED',
      delivery_status: 'CANCELED',
      stripe_refund_id: refundId,
      canceled_at: new Date().toISOString(),
    })
    .in('id', allIds);

  // payout_status: i pagati sono già 'REVERSED' dal reversal; gli altri 'REFUNDED'.
  const refundedIds = allIds.filter((id) => !reversedIds.includes(id));
  if (refundedIds.length > 0) {
    await admin.from('orders').update({ payout_status: 'REFUNDED' }).in('id', refundedIds);
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
  const admin = getAdminSupabase();
  await admin
    .from('profiles')
    .update({
      stripe_charges_enabled: !!acct.charges_enabled,
      stripe_payouts_enabled: !!acct.payouts_enabled,
      stripe_details_submitted: !!acct.details_submitted,
    })
    .eq('stripe_account_id', acct.id);
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
        payment_status: 'FAILED',
        canceled_at: new Date().toISOString(),
      })
      .in('id', ids);
    await notifyAdmins('✕ Chargeback perso', `Contestazione persa su ordine ${ids[0]}. Ordine annullato.`, '/admin/disputes');
  } else {
    logger.info('[stripe] dispute.closed: stato non gestito', { status: dispute.status });
  }
}
