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
 *  - checkout.session.completed  → crea l'ordine in DB con
 *                                  payment_status PAID, payout_status HELD
 *  - charge.refunded             → annulla l'ordine, marca refund
 *  - account.updated             → aggiorna stato Connect del seller
 *
 * Sicurezza:
 *  - Verifica firma con STRIPE_WEBHOOK_SECRET (constructEvent).
 *  - Idempotenza: l'event.id viene salvato in stripe_event_log
 *    (best-effort: se la insert fallisce per duplicate, abort).
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
  } catch (err: any) {
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
  } catch (err: any) {
    logger.error(err, { context: 'stripe-webhook-handler' });
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const meta = session.metadata ?? {};
  const buyerId = meta.buyer_user_id;
  const sellerId = meta.seller_id;
  if (!buyerId || !sellerId || !session.amount_total) return;

  // Items dal metadata (snapshot al checkout)
  let items: Array<{ productId: string; quantity: number }> = [];
  try {
    items = JSON.parse(meta.items ?? '[]');
  } catch { /* tolerate */ }

  const totalCents = session.amount_total;
  const feeCents = computeApplicationFeeCents(totalCents);
  const payoutCents = totalCents - feeCents;

  // Crea ordine
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .insert({
      user_id: buyerId,
      seller_id: sellerId,
      total_price: totalCents / 100,
      payment_status: 'PAID',
      payment_method: 'card',
      delivery_status: 'NEW',
      stripe_session_id: session.id,
      stripe_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      application_fee_cents: feeCents,
      seller_payout_cents: payoutCents,
      payout_status: 'HELD',
      delivery_full_name: session.customer_details?.name ?? null,
      delivery_phone: session.customer_details?.phone ?? null,
      delivery_address: session.shipping_details?.address?.line1 ?? session.customer_details?.address?.line1 ?? null,
      delivery_city: session.shipping_details?.address?.city ?? session.customer_details?.address?.city ?? null,
      delivery_zip: session.shipping_details?.address?.postal_code ?? session.customer_details?.address?.postal_code ?? null,
    })
    .select('id')
    .single();

  if (orderErr || !order) {
    logger.error(orderErr, { context: 'stripe-order-insert' });
    return;
  }

  // Salva order_items
  if (items.length > 0) {
    const productIds = items.map((i) => i.productId);
    const { data: products } = await admin
      .from('products')
      .select('id, name, price')
      .in('id', productIds);

    const rows = items.map((i) => {
      const p = products?.find((x) => x.id === i.productId);
      return {
        order_id: order.id,
        product_id: i.productId,
        quantity: i.quantity,
        unit_price: p?.price ?? 0,
      };
    });
    await admin.from('order_items').insert(rows);
  }

  // Email buyer + seller (best-effort)
  const buyerEmail = session.customer_details?.email ?? session.customer_email;
  if (buyerEmail) {
    const { data: store } = await admin
      .from('profiles')
      .select('store_name, full_name, id')
      .eq('id', sellerId)
      .single();
    const t = orderConfirmedBuyerTemplate({
      name: session.customer_details?.name ?? null,
      orderId: order.id,
      total: totalCents / 100,
      storeName: store?.store_name ?? store?.full_name ?? 'venditore',
    });
    await sendEmail({ to: buyerEmail, subject: t.subject, html: t.html, text: t.text });
  }

  const { data: seller } = await admin
    .from('profiles')
    .select('id')
    .eq('id', sellerId)
    .single();
  if (seller) {
    const { data: sellerAuth } = await admin.auth.admin.getUserById(seller.id);
    const sellerEmail = sellerAuth?.user?.email;
    if (sellerEmail) {
      const t = newOrderSellerTemplate({
        sellerName: null,
        orderId: order.id,
        total: totalCents / 100,
        itemsCount: items.reduce((s, i) => s + i.quantity, 0),
      });
      await sendEmail({ to: sellerEmail, subject: t.subject, html: t.html, text: t.text });
    }
  }
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const admin = getAdminSupabase();
  // Trova ordine via payment_intent
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!pi) return;
  const { data: order } = await admin
    .from('orders')
    .select('id, user_id, total_price')
    .eq('stripe_payment_intent', pi)
    .single();
  if (!order) return;

  const refundAmount = (charge.amount_refunded ?? 0) / 100;
  await admin
    .from('orders')
    .update({
      payment_status: 'FAILED',
      delivery_status: 'CANCELED',
      payout_status: 'REFUNDED',
      stripe_refund_id: charge.refunds?.data?.[0]?.id ?? null,
      canceled_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  // Email buyer
  const { data: ua } = await admin.auth.admin.getUserById(order.user_id);
  const buyerEmail = ua?.user?.email;
  if (buyerEmail) {
    const t = refundIssuedTemplate({
      orderId: order.id,
      amount: refundAmount,
      reason: charge.refunds?.data?.[0]?.reason ?? null,
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
