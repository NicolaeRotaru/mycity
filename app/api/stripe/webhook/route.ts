import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, computeApplicationFeeCents } from '@/lib/stripe/client';
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
 *  - charge.refunded             → annulla TUTTI gli ordini legati a quella
 *                                  charge (multi-seller: stesso PI condiviso)
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
  // Annulliamo TUTTI gli ordini legati a quel PaymentIntent.
  const { data: orders } = await admin
    .from('orders')
    .select('id, user_id, total_price, seller_id')
    .eq('stripe_payment_intent', pi);

  if (!orders || orders.length === 0) return;

  const refundAmount = (charge.amount_refunded ?? 0) / 100;
  const refundReason = charge.refunds?.data?.[0]?.reason ?? null;
  const refundId = charge.refunds?.data?.[0]?.id ?? null;

  await admin
    .from('orders')
    .update({
      payment_status: 'FAILED',
      delivery_status: 'CANCELED',
      payout_status: 'REFUNDED',
      stripe_refund_id: refundId,
      canceled_at: new Date().toISOString(),
    })
    .in('id', orders.map((o) => o.id));

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
