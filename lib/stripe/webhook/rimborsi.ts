/**
 * Rimborsi: quello che Stripe ha già emesso, e quello che la banca del
 * cliente rifiuta dopo.
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
import { getStripe } from '@/lib/stripe/client';
import { reverseOrderTransfer, reverseRiderTransfer } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { logger } from '@/lib/logger';
import { COLONNE_124, conRipiegoSchema, senzaColonne } from '@/lib/db/migrazione-124';
import { refundIssuedTemplate } from '@/lib/email/templates';
import { notifyAdmins } from './comune';

export async function handleChargeRefunded(charge: Stripe.Charge) {
  const admin = getAdminSupabase();
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!pi) return;

  // Multi-seller: una charge può avere N ordini (uno per seller).
  const { data: orders } = await admin
    .from('orders')
    // 054 — serve `delivery_status`: un ordine già consegnato non torna «annullato».
    // 061 — serve `rider_payout_reversed_cents` per il residuo dello storno rider.
    .select('id, user_id, total_price, seller_id, payout_status, payment_status, delivery_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_fee_cents, shipping_cost')
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
  // 048 — Se il recupero dal venditore falliva, l'errore finiva nel log e
  // l'ordine veniva marcato RIMBORSATO lo stesso: la perdita spariva dai conti e
  // nessuno la ripescava più. Ora quegli ordini prendono uno stato loro,
  // restano fuori dai «rimborsati puliti» e gli amministratori lo vengono a
  // sapere.
  const stornoFallito: Array<{ id: string; motivo: string }> = [];
  for (const o of orders) {
    if (o.payout_status === 'TRANSFERRED') {
      try {
        const { reversalId } = await reverseOrderTransfer(o);
        if (reversalId) reversedIds.push(o.id);
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'errore sconosciuto';
        logger.error('[stripe] reversal on charge.refunded failed', { orderId: o.id, e });
        stornoFallito.push({ id: o.id, motivo });
      }
    }

    // 054 — Il compenso del fattorino non veniva mai recuperato per questa
    // strada, mentre lo era per le altre due: su ogni rimborso arrivato da
    // Stripe la piattaforma restituiva tutto al cliente e pagava la consegna di
    // tasca propria.
    if (o.rider_payout_status === 'TRANSFERRED') {
      try {
        await reverseRiderTransfer(o);
      } catch (e) {
        logger.error('[stripe] recupero compenso rider fallito su charge.refunded', { orderId: o.id, e });
      }
    }
  }

  const allIds = orders.map((o) => o.id);
  await admin
    .from('orders')
    .update({
      payment_status: 'REFUNDED',
      stripe_refund_id: refundId,
    })
    .in('id', allIds);

  // 054 — Un ordine già CONSEGNATO non diventa «annullato» perché è stato
  // rimborsato: la consegna c'è stata. Prima si riscriveva lo stato di tutti, e
  // sparivano dalle liste operative consegne realmente effettuate.
  const daAnnullare = orders.filter((o) => o.delivery_status !== 'DELIVERED').map((o) => o.id);
  if (daAnnullare.length > 0) {
    await admin
      .from('orders')
      .update({ delivery_status: 'CANCELED', canceled_at: new Date().toISOString() })
      .in('id', daAnnullare);
  }
  // refunded_amount_cents per ordine (refund pieno = totale ordine).
  for (const o of orders) {
    await admin
      .from('orders')
      .update({ refunded_amount_cents: Math.round(Number(o.total_price) * 100) })
      .eq('id', o.id);
  }

  // payout_status: i pagati sono già 'REVERSED' dal reversal; gli altri 'REFUNDED'.
  const idFalliti = stornoFallito.map((f) => f.id);
  const refundedIds = allIds.filter((id) => !reversedIds.includes(id) && !idFalliti.includes(id));
  if (refundedIds.length > 0) {
    await admin.from('orders').update({ payout_status: 'REFUNDED' }).in('id', refundedIds);
  }
  for (const f of stornoFallito) {
    await admin
      .from('orders')
      .update({ payout_status: 'REVERSAL_FAILED', reversal_error: f.motivo.slice(0, 500) })
      .eq('id', f.id);
  }
  if (stornoFallito.length > 0) {
    await notifyAdmins(
      '⚠️ Storno al venditore non riuscito',
      `Rimborso eseguito ma i soldi non sono rientrati dal venditore su ${stornoFallito.length} ordine/i: ${idFalliti.map((i) => i.slice(0, 8)).join(', ')}. Vanno recuperati a mano.`,
      '/admin/orders',
    );
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

/**
 * 063 — UN RIMBORSO CHE FALLISCE DOPO L'EMISSIONE.
 *
 * `refundOrder` scrive payment_status='REFUNDED' e refunded_amount_cents
 * subito dopo `refunds.create`, cioe' su un rimborso ancora in stato
 * 'pending'. Se poi la banca del cliente lo rifiuta, i soldi rientrano alla
 * piattaforma mentre il database continua a dire che il cliente e' stato
 * rimborsato: lui non riceve niente, chiama, e ai nostri occhi risulta gia'
 * liquidato. E' l'innesco tipico di una contestazione che poi si perde,
 * perche' le nostre prove dicono il contrario di quello che e' successo.
 */
export async function handleRefundUpdated(refund: Stripe.Refund) {
  if (refund.status !== 'failed' && refund.status !== 'canceled') return;

  const admin = getAdminSupabase();
  const paymentIntent = typeof refund.payment_intent === 'string'
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
  if (!paymentIntent) {
    logger.warn('[stripe] rimborso fallito senza payment_intent', { refundId: refund.id });
    return;
  }

  // Prima che la migrazione 124 sia applicata, `gross_total_cents` non esiste e
  // il database rifiuta la lettura INTERA: l'ordine risultava «non trovato», il
  // rimborso rifiutato dalla banca non veniva registrato e nessuno avvisava
  // l'admin. I soldi restavano fermi in silenzio (lib/db/migrazione-124.ts).
  const COLONNE_RIMBORSO_FALLITO = 'id, refunded_amount_cents, gross_total_cents, total_price, payment_status';
  const { data: order } = await conRipiegoSchema(
    'orders.select (rimborso rifiutato)',
    () => admin.from('orders').select(COLONNE_RIMBORSO_FALLITO).eq('stripe_payment_intent', paymentIntent).maybeSingle(),
    () => admin.from('orders').select(senzaColonne(COLONNE_RIMBORSO_FALLITO, COLONNE_124)).eq('stripe_payment_intent', paymentIntent).maybeSingle(),
  );
  if (!order) {
    logger.warn('[stripe] rimborso fallito: nessun ordine trovato', { refundId: refund.id, paymentIntent });
    return;
  }

  const tornatoIndietro = refund.amount ?? 0;
  const restante = Math.max(0, (order.refunded_amount_cents ?? 0) - tornatoIndietro);
  const { error } = await admin
    .from('orders')
    .update({
      refunded_amount_cents: restante,
      payment_status: restante > 0 ? 'PARTIALLY_REFUNDED' : 'PAID',
    })
    .eq('id', order.id);
  if (error) {
    logger.error('[stripe] rimborso fallito non registrato', { orderId: order.id, message: error.message });
  }

  await notifyAdmins(
    '⚠️ Rimborso rifiutato dalla banca',
    `Il rimborso di €${(tornatoIndietro / 100).toFixed(2)} sull'ordine ${order.id} non e' arrivato al cliente (${refund.status}). I soldi sono rientrati: va rimborsato in un altro modo.`,
    '/admin/orders',
  );
}
