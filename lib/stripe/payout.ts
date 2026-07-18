import type Stripe from 'stripe';
import { getStripe } from './client';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { refundIssuedTemplate } from '@/lib/email/templates';

/**
 * Logica condivisa di payout / reversal / refund per il modello SCT
 * (Separate Charges & Transfers).
 *
 * Casa unica usata da:
 *  - app/api/stripe/payout/route.ts        → releaseOrderPayout (trigger manuale/admin)
 *  - app/api/cron/release-payouts/route.ts → releaseOrderPayout (batch +3gg)
 *  - app/api/returns/[id]/decide/route.ts  → refundOrder
 *  - app/api/admin/disputes/[id]/resolve   → refundOrder
 *  - app/api/stripe/webhook (charge.refunded / charge.dispute.*) → reverseOrderTransfer
 *
 * Tutte le funzioni ritornano oggetti-risultato (mai NextResponse), così le
 * route HTTP e i cron possono consumarle in modo diverso.
 */

/**
 * Riflette su `profiles` i flag di stato di un Connect account leggendoli da
 * un oggetto Stripe.Account. Fonte di verità unica usata sia dal webhook
 * `account.updated` sia dalla route di refresh manuale, così lo stato resta
 * corretto anche se il webhook non viene consegnato.
 */
export async function applyConnectAccountStatus(acct: Stripe.Account): Promise<void> {
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

export type PayoutResult =
  | { ok: true; transferId: string }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'NOT_DELIVERED' | 'BAD_STATE' | 'INVALID_AMOUNT' | 'SELLER_NOT_READY' | 'RIDER_NOT_READY' | 'TRANSFER_FAILED';
      reason: string;
    };

/**
 * Rilascia il payout (transfer SCT) al venditore per UN ordine DELIVERED.
 *
 * Guardie (idempotenza inclusa): l'ordine deve essere DELIVERED e in stato
 * payout HELD o PENDING_SELLER_ONBOARDING; una doppia chiamata è no-op
 * (`code: 'BAD_STATE'`). Se il Connect del seller non è pronto, l'ordine resta
 * PENDING_SELLER_ONBOARDING e verrà ritentato al prossimo giro di cron.
 *
 * source_transaction = stripe_charge_id lega il transfer alla charge specifica
 * (cruciale per multi-seller e per evitare fallimenti con balance basso).
 */
export async function releaseOrderPayout(orderId: string): Promise<PayoutResult> {
  const admin = getAdminSupabase();
  const { data: order, error } = await admin
    .from('orders')
    .select('id, seller_id, payout_status, seller_payout_cents, stripe_charge_id, stripe_transfer_group, delivery_status')
    .eq('id', orderId)
    .single();

  if (error || !order) return { ok: false, code: 'NOT_FOUND', reason: 'Ordine non trovato' };
  if (order.delivery_status !== 'DELIVERED') {
    return { ok: false, code: 'NOT_DELIVERED', reason: 'Ordine non ancora consegnato' };
  }
  if (order.payout_status !== 'HELD' && order.payout_status !== 'PENDING_SELLER_ONBOARDING') {
    return { ok: false, code: 'BAD_STATE', reason: `Payout in stato ${order.payout_status}, no-op` };
  }
  if (!order.seller_payout_cents || order.seller_payout_cents <= 0) {
    return { ok: false, code: 'INVALID_AMOUNT', reason: 'Importo payout non valido' };
  }

  const { data: seller } = await admin
    .from('profiles')
    .select('stripe_account_id, stripe_payouts_enabled')
    .eq('id', order.seller_id)
    .single();

  if (!seller?.stripe_account_id || !seller.stripe_payouts_enabled) {
    // Seller pagato ma Connect non completato: trattieni i fondi e marca lo
    // stato così il prossimo cron riprova dopo account.updated.
    await admin.from('orders').update({ payout_status: 'PENDING_SELLER_ONBOARDING' }).eq('id', order.id);
    return { ok: false, code: 'SELLER_NOT_READY', reason: "Seller non ha completato l'onboarding Stripe Connect" };
  }

  // Claim atomico: solo UNA esecuzione concorrente passa da HELD/PENDING a PROCESSING.
  // Elimina il doppio payout quando il cron si sovrappone o coincide col trigger manuale.
  const { data: claimed, error: claimErr } = await admin
    .from('orders')
    .update({ payout_status: 'PROCESSING' })
    .eq('id', order.id)
    .in('payout_status', ['HELD', 'PENDING_SELLER_ONBOARDING'])
    .select('id');
  if (claimErr) {
    // Un errore DB qui (es. violazione di constraint) NON va mascherato da no-op:
    // i fondi resterebbero bloccati in HELD in silenzio. Logga (→ Sentry) e segnala.
    logger.error('[stripe] payout seller: claim update fallito', claimErr);
    return { ok: false, code: 'TRANSFER_FAILED', reason: `Claim payout fallito: ${claimErr.message}` };
  }
  if (!claimed || claimed.length === 0) {
    return { ok: false, code: 'BAD_STATE', reason: 'Payout già in lavorazione o completato, no-op' };
  }

  try {
    const stripe = getStripe();
    const transfer = await stripe.transfers.create(
      {
        amount: order.seller_payout_cents,
        currency: 'eur',
        destination: seller.stripe_account_id,
        ...(order.stripe_charge_id ? { source_transaction: order.stripe_charge_id } : {}),
        transfer_group: order.stripe_transfer_group ?? `order_${order.id}`,
        metadata: { order_id: order.id, seller_id: order.seller_id },
      },
      // Idempotency-Key: anche se DB/processo falliscono e si ritenta, Stripe
      // restituisce lo stesso transfer e NON ne crea un secondo.
      { idempotencyKey: `payout_seller_${order.id}` },
    );

    await admin
      .from('orders')
      .update({ stripe_transfer_id: transfer.id, payout_status: 'TRANSFERRED', payout_at: new Date().toISOString() })
      .eq('id', order.id);

    return { ok: true, transferId: transfer.id };
  } catch (err) {
    logger.error('[stripe] transfer failed', err);
    // Ripristina HELD: il prossimo cron ritenterà con lo stesso idempotencyKey (safe).
    await admin.from('orders').update({ payout_status: 'HELD' }).eq('id', order.id);
    return { ok: false, code: 'TRANSFER_FAILED', reason: 'Transfer failed' };
  }
}

/**
 * Rilascia il compenso di consegna (transfer SCT) al RIDER per UN ordine
 * DELIVERED pagato con CARTA. Il compenso = `shipping_cost` dell'ordine.
 * Idempotente: no-op se già 'TRANSFERRED'. Se il Connect del rider non è
 * pronto → 'PENDING_RIDER_ONBOARDING' (ritentato al prossimo cron).
 * Per gli ordini COD il rider incassa i contanti: nessun transfer qui.
 */
export async function releaseRiderPayout(orderId: string): Promise<PayoutResult> {
  const admin = getAdminSupabase();
  const { data: order, error } = await admin
    .from('orders')
    .select('id, rider_id, shipping_cost, payment_method, delivery_status, rider_payout_status, stripe_charge_id, stripe_transfer_group')
    .eq('id', orderId)
    .single();

  if (error || !order) return { ok: false, code: 'NOT_FOUND', reason: 'Ordine non trovato' };
  if (order.delivery_status !== 'DELIVERED') return { ok: false, code: 'NOT_DELIVERED', reason: 'Ordine non consegnato' };
  if (order.payment_method !== 'card') return { ok: false, code: 'BAD_STATE', reason: 'COD: il rider incassa i contanti' };
  if (!order.rider_id) return { ok: false, code: 'BAD_STATE', reason: 'Nessun rider assegnato' };
  if (order.rider_payout_status === 'TRANSFERRED') return { ok: false, code: 'BAD_STATE', reason: 'Compenso rider già versato' };

  const feeCents = Math.round(Number(order.shipping_cost ?? 0) * 100);
  if (feeCents <= 0) return { ok: false, code: 'INVALID_AMOUNT', reason: 'Compenso di consegna nullo' };

  const { data: rider } = await admin
    .from('profiles')
    .select('stripe_account_id, stripe_payouts_enabled')
    .eq('id', order.rider_id)
    .single();

  if (!rider?.stripe_account_id || !rider.stripe_payouts_enabled) {
    await admin.from('orders').update({ rider_payout_status: 'PENDING_RIDER_ONBOARDING' }).eq('id', order.id);
    return { ok: false, code: 'RIDER_NOT_READY', reason: 'Rider senza Connect/IBAN attivo' };
  }

  // Claim atomico anche per il compenso rider (no doppio transfer da race).
  const { data: claimed, error: claimErr } = await admin
    .from('orders')
    .update({ rider_payout_status: 'PROCESSING' })
    .eq('id', order.id)
    .or('rider_payout_status.is.null,rider_payout_status.in.(HELD,PENDING_RIDER_ONBOARDING,FAILED)')
    .select('id');
  if (claimErr) {
    // Vedi releaseOrderPayout: un errore DB non va mascherato da no-op silenzioso.
    logger.error('[stripe] payout rider: claim update fallito', claimErr);
    return { ok: false, code: 'TRANSFER_FAILED', reason: `Claim payout rider fallito: ${claimErr.message}` };
  }
  if (!claimed || claimed.length === 0) {
    return { ok: false, code: 'BAD_STATE', reason: 'Compenso rider già in lavorazione o versato, no-op' };
  }

  try {
    const stripe = getStripe();
    const transfer = await stripe.transfers.create(
      {
        amount: feeCents,
        currency: 'eur',
        destination: rider.stripe_account_id,
        ...(order.stripe_charge_id ? { source_transaction: order.stripe_charge_id } : {}),
        transfer_group: order.stripe_transfer_group ?? `order_${order.id}`,
        metadata: { order_id: order.id, rider_id: order.rider_id, kind: 'rider_fee' },
      },
      { idempotencyKey: `payout_rider_${order.id}` },
    );

    await admin
      .from('orders')
      .update({ rider_transfer_id: transfer.id, rider_payout_status: 'TRANSFERRED', rider_payout_at: new Date().toISOString() })
      .eq('id', order.id);

    return { ok: true, transferId: transfer.id };
  } catch (err) {
    logger.error('[stripe] rider transfer failed', err);
    await admin.from('orders').update({ rider_payout_status: 'HELD' }).eq('id', order.id);
    return { ok: false, code: 'TRANSFER_FAILED', reason: 'Transfer rider fallito' };
  }
}

/** Campi dell'ordine necessari per il claw-back. */
export interface ReversibleOrder {
  id: string;
  payout_status: string | null;
  stripe_transfer_id: string | null;
  seller_payout_cents: number | null;
  stripe_reversal_id?: string | null;
}

/**
 * Claw-back: recupera (in tutto o in parte) il transfer già inviato al
 * venditore via transfers.createReversal.
 *
 * - Se il payout non è ancora partito (`payout_status !== 'TRANSFERRED'` o
 *   manca `stripe_transfer_id`) → no-op: il chiamante si limita a rimborsare.
 * - Idempotenza: se `stripe_reversal_id` è già presente → no-op.
 * - `amountCents` = quota da recuperare (default: l'intero netto del venditore),
 *   clampata a `seller_payout_cents`. Su reversal pieno → payout_status='REVERSED'.
 *
 * NB: se il saldo del connected account è insufficiente, Stripe consente
 * comunque il reversal portando il conto a saldo negativo, recuperato dalle
 * vendite/payout futuri del venditore. Nessun branch necessario.
 */
export async function reverseOrderTransfer(
  order: ReversibleOrder,
  amountCents?: number,
): Promise<{ reversalId: string | null; reversedCents: number }> {
  if (order.payout_status !== 'TRANSFERRED' || !order.stripe_transfer_id) {
    return { reversalId: null, reversedCents: 0 };
  }
  if (order.stripe_reversal_id) {
    return { reversalId: order.stripe_reversal_id, reversedCents: 0 };
  }

  const maxCents = order.seller_payout_cents ?? 0;
  const reverseCents = Math.min(amountCents ?? maxCents, maxCents);
  if (reverseCents <= 0) return { reversalId: null, reversedCents: 0 };

  const stripe = getStripe();
  const reversal = await stripe.transfers.createReversal(
    order.stripe_transfer_id,
    { amount: reverseCents, metadata: { order_id: order.id } },
    { idempotencyKey: `reversal_${order.id}` },
  );

  const admin = getAdminSupabase();
  const isFull = reverseCents >= maxCents;
  await admin
    .from('orders')
    .update({ stripe_reversal_id: reversal.id, ...(isFull ? { payout_status: 'REVERSED' } : {}) })
    .eq('id', order.id);

  return { reversalId: reversal.id, reversedCents: reverseCents };
}

export interface RefundOrderOpts {
  orderId: string;
  /** Importo da rimborsare al buyer, in centesimi (parziale o totale). */
  amountCents: number;
  reason?: string;
  metadata?: Record<string, string>;
  notifyBuyer?: boolean;
  /** Idempotency-Key Stripe stabile (es. `return_<id>` / `dispute_<id>`). */
  idempotencyKey?: string;
}

/**
 * Routine canonica "rimborso reale + claw-back se già pagato + update DB +
 * email buyer". Usata da resi e dispute interne.
 *
 * Decisione economica: sui rimborsi la piattaforma RESTITUISCE la commissione
 * → dal venditore si recupera SOLO la sua quota netta proporzionale
 * (`amountCents * seller_payout_cents / total_cents`), mai la fee.
 *
 * NON usata dal webhook charge.refunded (lì il refund è già Stripe-initiated:
 * basta reverseOrderTransfer + sync DB).
 */
/** Email best-effort di rimborso al buyer (riusata dal path carta e da quello COD). */
async function notifyRefundBuyer(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  orderId: string,
  amountCents: number,
  opts: RefundOrderOpts,
): Promise<void> {
  if (!opts.notifyBuyer) return;
  try {
    const { data: ua } = await admin.auth.admin.getUserById(userId);
    const buyerEmail = ua?.user?.email;
    if (buyerEmail) {
      const t = refundIssuedTemplate({ orderId, amount: amountCents / 100, reason: opts.reason ?? null });
      await sendEmail({ to: buyerEmail, subject: t.subject, html: t.html, text: t.text });
    }
  } catch (e) {
    logger.warn('[refundOrder] invio email buyer fallito', e);
  }
}

export async function refundOrder(
  opts: RefundOrderOpts,
): Promise<{ refundId: string; reversedCents: number }> {
  const admin = getAdminSupabase();
  const { data: order, error } = await admin
    .from('orders')
    .select('id, user_id, total_price, seller_payout_cents, payout_status, stripe_payment_intent, stripe_transfer_id, stripe_reversal_id, refunded_amount_cents, payment_method')
    .eq('id', opts.orderId)
    .single();

  if (error || !order) throw new Error('refundOrder: ordine non trovato');

  // Clamp di sicurezza: mai rimborsare più del residuo rimborsabile (totale − già rimborsato).
  // Il clamp al solo `orderTotalCents` permetteva un over-accredito wallet su ordini COD con
  // rimborsi parziali multipli (il secondo rimborso ignorava il già accreditato).
  const orderTotalCents = Math.round(Number(order.total_price) * 100);
  const alreadyRefunded = order.refunded_amount_cents ?? 0;
  const safeAmountCents = Math.max(0, Math.min(opts.amountCents, orderTotalCents - alreadyRefunded));
  if (safeAmountCents <= 0) throw new Error('refundOrder: importo rimborso non valido');

  // payment_status distingue REFUNDED (pieno) da PARTIALLY_REFUNDED (parziale).
  const newRefundedTotal = (order.refunded_amount_cents ?? 0) + safeAmountCents;
  const isFull = newRefundedTotal >= orderTotalCents;

  // --- COD (🟠-18): nessuna charge Stripe → accredito sul wallet del buyer.
  // Idempotente: ref stabile (idempotencyKey del chiamante, es. return_<id>) +
  // unique index parziale su wallet_ledger(ref) WHERE reason='cod_refund'. Un
  // secondo tentativo (doppio-click su reso/dispute) è un no-op: niente doppio
  // accredito. Il contante è già stato incassato dal rider → il buyer viene
  // ristorato in credito spendibile, non in contanti.
  if (!order.stripe_payment_intent) {
    if (order.payment_method !== 'cod') {
      throw new Error('refundOrder: ordine senza payment_intent e non COD (non rimborsabile)');
    }
    const ref = opts.idempotencyKey ?? `cod_refund_${order.id}_${safeAmountCents}`;

    // Claw-back del transfer al venditore se il COD era GIÀ stato pagato (il payout
    // COD — slice 3 — fa un transfer dal saldo piattaforma). DEVE avvenire anche
    // per i COD: senza, un rimborso dopo il payout sarebbe una doppia uscita
    // (venditore pagato + buyer accreditato). Idempotente: reverseOrderTransfer è
    // no-op se l'ordine non è TRANSFERRED o è già stato stornato.
    const sellerNet = order.seller_payout_cents ?? 0;
    const sellerShare =
      orderTotalCents > 0 ? Math.min(Math.round((safeAmountCents * sellerNet) / orderTotalCents), sellerNet) : 0;
    const { reversedCents } = await reverseOrderTransfer(order, sellerShare);
    const wasTransferred = order.payout_status === 'TRANSFERRED';

    // Accredito wallet del buyer (idempotente via unique index su ref).
    const { error: wErr } = await admin.rpc('wallet_credit', {
      p_user: order.user_id,
      p_cents: safeAmountCents,
      p_reason: 'cod_refund',
      p_ref: ref,
    });
    if (wErr) {
      // 23505 = unique_violation → già accreditato per questo ref: idempotente.
      if ((wErr as { code?: string }).code === '23505') {
        return { refundId: `wallet:${ref}`, reversedCents };
      }
      throw new Error(`refundOrder COD: accredito wallet fallito: ${wErr.message}`);
    }

    // NB: NON marchiamo delivery_status='CANCELED' per i COD: la consegna è
    // avvenuta e il contante incassato dal rider resta dovuto/riconciliato (lo
    // marcheremmo fuori dall'expected della riconciliazione). Il rimborso è
    // riflesso da payment_status + dal claw-back del payout.
    await admin
      .from('orders')
      .update({
        refunded_amount_cents: newRefundedTotal,
        payment_status: isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        ...(isFull ? { payout_status: wasTransferred ? 'REVERSED' : 'REFUNDED' } : {}),
      })
      .eq('id', order.id);

    if (isFull) await admin.rpc('restore_stock_for_order', { p_order_id: order.id });
    await notifyRefundBuyer(admin, order.user_id, order.id, safeAmountCents, opts);

    return { refundId: `wallet:${ref}`, reversedCents };
  }

  // --- Carta: refund reale Stripe + claw-back del transfer se già pagato.
  const stripe = getStripe();
  const refund = await stripe.refunds.create(
    {
      payment_intent: order.stripe_payment_intent,
      amount: safeAmountCents,
      metadata: {
        order_id: order.id,
        ...(opts.reason ? { reason: opts.reason } : {}),
        ...(opts.metadata ?? {}),
      },
    },
    // Idempotency-Key: doppio-click su risoluzione dispute/reso NON genera doppio rimborso.
    { idempotencyKey: opts.idempotencyKey ?? `refund_${order.id}_${safeAmountCents}` },
  );
  const sellerNet = order.seller_payout_cents ?? 0;
  const sellerShare =
    orderTotalCents > 0 ? Math.min(Math.round((safeAmountCents * sellerNet) / orderTotalCents), sellerNet) : 0;

  const { reversedCents } = await reverseOrderTransfer(order, sellerShare);

  const wasTransferred = order.payout_status === 'TRANSFERRED';
  await admin
    .from('orders')
    .update({
      stripe_refund_id: refund.id,
      refunded_amount_cents: newRefundedTotal,
      payment_status: isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      ...(isFull
        ? {
            payout_status: wasTransferred ? 'REVERSED' : 'REFUNDED',
            delivery_status: 'CANCELED',
            canceled_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq('id', order.id);

  // Rimborso pieno → ordine annullato → ripristina lo stock (P0-4).
  if (isFull) {
    await admin.rpc('restore_stock_for_order', { p_order_id: order.id });
  }

  await notifyRefundBuyer(admin, order.user_id, order.id, safeAmountCents, opts);

  return { refundId: refund.id, reversedCents };
}
