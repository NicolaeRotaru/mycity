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
  // 046 — Rimborsato per intero prima che il pagamento partisse: non c'è niente
  // da versare, e non è un errore.
  | { ok: true; code: 'NOTHING_TO_PAY'; reason: string }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'NOT_DELIVERED' | 'BAD_STATE' | 'INVALID_AMOUNT' | 'SELLER_NOT_READY' | 'RIDER_NOT_READY' | 'TRANSFER_FAILED' | 'NOTHING_TO_PAY';
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
    // 046 — serve anche quanto è già stato addebitato al venditore: il payout
    // deve versare il residuo, non il netto pieno.
    .select('id, seller_id, payout_status, seller_payout_cents, seller_payout_reversed_cents, payout_tentativo, stripe_charge_id, stripe_transfer_group, delivery_status')
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
    // 046 — Prima qui si trasferiva `seller_payout_cents`, cioè il netto pieno
    // dell'ordine, anche quando una parte era già stata rimborsata al cliente
    // PRIMA che il payout partisse. In quel caso lo storno non aveva niente da
    // stornare (nessun transfer ancora inviato) e il venditore incassava
    // comunque il cento per cento: la differenza la metteva la piattaforma.
    // `residuoRecuperabile` toglie dal netto quanto è già stato messo a carico
    // del venditore, ed è la stessa funzione che governa gli storni.
    const daVersare = residuoRecuperabile(order as unknown as ReversibleOrder);
    if (daVersare <= 0) {
      const { error: errNulla } = await admin
        .from('orders')
        .update({ payout_status: 'REVERSED', payout_at: new Date().toISOString() })
        .eq('id', order.id);
      if (errNulla) logger.error('[stripe] payout a zero non registrato', errNulla);
      return { ok: true, code: 'NOTHING_TO_PAY', reason: 'Rimborsato per intero prima del pagamento: niente da versare' };
    }

    const transfer = await stripe.transfers.create(
      {
        amount: daVersare,
        currency: 'eur',
        destination: seller.stripe_account_id,
        ...(order.stripe_charge_id ? { source_transaction: order.stripe_charge_id } : {}),
        transfer_group: order.stripe_transfer_group ?? `order_${order.id}`,
        metadata: { order_id: order.id, seller_id: order.seller_id },
      },
      // Idempotency-Key: anche se DB/processo falliscono e si ritenta, Stripe
      // restituisce lo stesso transfer e NON ne crea un secondo.
      //
      // 158 — Il numero del tentativo fa parte della chiave. Senza, dopo una
      // contestazione VINTA il bonifico non ripartiva: era gia' stato stornato
      // e Stripe, con la stessa chiave, restituiva quello vecchio. Il negozio
      // vinceva la causa e non veniva pagato lo stesso.
      { idempotencyKey: `payout_seller_${order.id}_t${(order as { payout_tentativo?: number }).payout_tentativo ?? 0}` },
    );

    const { error: errFine } = await admin
      .from('orders')
      .update({ stripe_transfer_id: transfer.id, payout_status: 'TRANSFERRED', payout_at: new Date().toISOString() })
      .eq('id', order.id);
    if (errFine) {
      // Il bonifico e' partito ma l'ordine resta in PROCESSING: senza questo
      // avviso nessuno lo scopre, e il recupero automatico non saprebbe che
      // il transfer esiste gia'. L'id serve per riconciliare a mano.
      logger.error('[stripe] payout eseguito ma stato non aggiornato', {
        orderId: order.id, transferId: transfer.id, message: errFine.message,
      });
    }

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
/**
 * Stati dai quali un compenso rider si puo' ancora ritentare.
 *
 * Perche' sta qui e non nel cron: il claim accettava anche 'HELD' (dove finisce
 * un transfer fallito), ma la query del cron che cerca i candidati NON lo
 * includeva. Risultato: un compenso fallito una volta non veniva mai piu'
 * ritentato, perche' nessuno lo ripescava. Ora l'elenco e' uno solo.
 */
export const STATI_RIDER_RITENTABILI = ['HELD', 'PENDING_RIDER_ONBOARDING', 'FAILED'] as const;

/** Filtro PostgREST per i candidati rider (null incluso). */
export const FILTRO_RIDER_RITENTABILI =
  `rider_payout_status.is.null,rider_payout_status.in.(${STATI_RIDER_RITENTABILI.join(',')})`;

export async function releaseRiderPayout(orderId: string): Promise<PayoutResult> {
  const admin = getAdminSupabase();
  const { data: order, error } = await admin
    .from('orders')
    .select('id, rider_id, shipping_cost, rider_fee_cents, payment_method, delivery_status, rider_payout_status, rider_payout_tentativo, stripe_charge_id, stripe_transfer_group')
    .eq('id', orderId)
    .single();

  if (error || !order) return { ok: false, code: 'NOT_FOUND', reason: 'Ordine non trovato' };
  if (order.delivery_status !== 'DELIVERED') return { ok: false, code: 'NOT_DELIVERED', reason: 'Ordine non consegnato' };
  if (order.payment_method !== 'card') return { ok: false, code: 'BAD_STATE', reason: 'COD: il rider incassa i contanti' };
  if (!order.rider_id) return { ok: false, code: 'BAD_STATE', reason: 'Nessun rider assegnato' };
  if (order.rider_payout_status === 'TRANSFERRED') return { ok: false, code: 'BAD_STATE', reason: 'Compenso rider già versato' };

  // rider_fee_cents (migrazione 111) è disaccoppiato dallo shipping_cost (prezzo
  // buyer). Fallback a shipping_cost*100 per gli ordini antecedenti alla migrazione.
  const feeCents = order.rider_fee_cents != null
    ? order.rider_fee_cents
    : Math.round(Number(order.shipping_cost ?? 0) * 100);
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
    .or(FILTRO_RIDER_RITENTABILI)
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
      // 158 — Come per il venditore: il numero del tentativo entra nella chiave.
      { idempotencyKey: `payout_rider_${order.id}_t${(order as { rider_payout_tentativo?: number }).rider_payout_tentativo ?? 0}` },
    );

    const { error: errFineRider } = await admin
      .from('orders')
      .update({ rider_transfer_id: transfer.id, rider_payout_status: 'TRANSFERRED', rider_payout_at: new Date().toISOString() })
      .eq('id', order.id);
    if (errFineRider) {
      logger.error('[stripe] compenso rider eseguito ma stato non aggiornato', {
        orderId: order.id, transferId: transfer.id, message: errFineRider.message,
      });
    }

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
  /** Totale gia' recuperato con storni precedenti. */
  seller_payout_reversed_cents?: number | null;
  stripe_reversal_id?: string | null;
}

/**
 * Quanto si puo' ancora recuperare dal venditore su questo ordine.
 *
 * Prima il residuo si teneva DENTRO `seller_payout_cents`, decrementandolo a
 * ogni storno. Ma quel campo e' il netto dell'ordine, e lo leggono i guadagni
 * del negoziante, i rendiconti dell'amministrazione e — peggio — il calcolo
 * della quota da recuperare al rimborso successivo: dopo il primo storno
 * parziale tutti quei numeri erano sbagliati. Ora il netto resta fermo e il
 * recuperato si accumula in un campo suo.
 */
export function residuoRecuperabile(order: ReversibleOrder): number {
  const netto = order.seller_payout_cents ?? 0;
  const giaStornato = order.seller_payout_reversed_cents ?? 0;
  return Math.max(0, netto - giaStornato);
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

  // Residuo ancora da stornare: netto dell'ordine meno quanto gia' recuperato.
  const maxCents = residuoRecuperabile(order);
  const reverseCents = Math.min(amountCents ?? maxCents, maxCents);
  if (reverseCents <= 0) return { reversalId: null, reversedCents: 0 };

  const stripe = getStripe();
  const reversal = await stripe.transfers.createReversal(
    order.stripe_transfer_id,
    { amount: reverseCents, metadata: { order_id: order.id } },
    // La chiave contiene il TOTALE stornato dopo questa operazione, non
    // l'importo della singola chiamata. Con l'importo singolo due rimborsi
    // parziali dello stesso valore — 20 euro e poi altri 20 — producevano la
    // stessa chiave: Stripe restituiva il primo storno e il secondo non
    // avveniva, lasciando al venditore soldi che andavano recuperati.
    { idempotencyKey: `reversal_${order.id}_tot_${(order.seller_payout_reversed_cents ?? 0) + reverseCents}` },
  );

  const admin = getAdminSupabase();
  const isFull = reverseCents >= maxCents;
  const { error: errAggiorna } = await admin
    .from('orders')
    .update({
      stripe_reversal_id: reversal.id,
      // Si accumula il recuperato; il netto dell'ordine non si tocca.
      seller_payout_reversed_cents: (order.seller_payout_reversed_cents ?? 0) + reverseCents,
      ...(isFull ? { payout_status: 'REVERSED' } : {}),
    })
    .eq('id', order.id);
  if (errAggiorna) {
    // Lo storno su Stripe e' avvenuto: se il database non lo registra, il
    // prossimo giro rischia di stornare due volte. Va visto, non ingoiato.
    logger.error('[stripe] storno registrato su Stripe ma non nel database', {
      orderId: order.id, reversalId: reversal.id, message: errAggiorna.message,
    });
  }

  return { reversalId: reversal.id, reversedCents: reverseCents };
}

/** Campi necessari per recuperare il compenso versato al fattorino. */
export interface RiderReversibleOrder {
  id: string;
  rider_id?: string | null;
  rider_transfer_id: string | null;
  rider_payout_status: string | null;
  /** 061 — quanto del compenso è già rientrato: serve al residuo e alla chiave. */
  rider_payout_reversed_cents?: number | null;
  rider_fee_cents?: number | null;
  shipping_cost?: number | string | null;
}

/**
 * Recupera il compenso già versato al fattorino.
 *
 * Perché serviva: su un rimborso totale o su una contestazione persa il codice
 * stornava soltanto il transfer del VENDITORE. Il compenso del fattorino
 * restava versato: la piattaforma restituiva l'intero incasso al cliente e
 * teneva la perdita su di sé, ordine dopo ordine. In tutto il codice
 * `rider_transfer_id` compariva in due punti soli — quando si scrive e quando
 * Stripe conferma uno storno — segno che nessuno lo aveva mai recuperato.
 */
export async function reverseRiderTransfer(
  order: RiderReversibleOrder,
  amountCents?: number,
): Promise<{ reversalId: string | null; reversedCents: number }> {
  if (order.rider_payout_status !== 'TRANSFERRED' || !order.rider_transfer_id) {
    return { reversalId: null, reversedCents: 0 };
  }

  const versato = order.rider_fee_cents != null
    ? order.rider_fee_cents
    : Math.round(Number(order.shipping_cost ?? 0) * 100);
  // 061 — Il residuo si calcola come per il venditore: quanto è stato versato
  // meno quanto è già rientrato. Senza contatore, due storni parziali sullo
  // stesso ordine si sommavano oltre il versato.
  const giaStornato = order.rider_payout_reversed_cents ?? 0;
  const residuo = Math.max(0, versato - giaStornato);
  const reverseCents = Math.min(amountCents ?? residuo, residuo);
  if (reverseCents <= 0) return { reversalId: null, reversedCents: 0 };

  const stripe = getStripe();
  const reversal = await stripe.transfers.createReversal(
    order.rider_transfer_id,
    { amount: reverseCents, metadata: { order_id: order.id, kind: 'rider_fee' } },
    // 061 — La chiave portava l'importo del singolo storno: due storni dello
    // stesso importo sullo stesso ordine avevano la stessa chiave e il secondo
    // non avveniva. Ora porta il totale cumulato, come per il venditore.
    { idempotencyKey: `reversal_rider_${order.id}_tot_${giaStornato + reverseCents}` },
  );

  const admin = getAdminSupabase();
  const totaleStornato = giaStornato + reverseCents;
  const { error } = await admin
    .from('orders')
    .update({
      rider_payout_reversed_cents: totaleStornato,
      // 049 — 'REVERSED' era rifiutato dal vincolo del database (migrazione 081)
      // e l'errore veniva solo scritto nel log: uno storno che nei conti non
      // esisteva. La migrazione 119 aggiunge lo stato; qui l'errore si vede.
      rider_payout_status: totaleStornato >= versato ? 'REVERSED' : 'TRANSFERRED',
    })
    .eq('id', order.id);
  if (error) {
    logger.error('[stripe] storno compenso rider non registrato nel database', {
      orderId: order.id, reversalId: reversal.id, message: error.message,
    });
    throw new Error(`storno rider non registrato: ${error.message}`);
  }

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
    .select('id, user_id, total_price, gross_total_cents, seller_payout_cents, seller_payout_reversed_cents, payout_status, stripe_payment_intent, stripe_transfer_id, stripe_reversal_id, refunded_amount_cents, payment_method, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_fee_cents, shipping_cost, delivery_status')
    .eq('id', opts.orderId)
    .single();

  if (error || !order) throw new Error('refundOrder: ordine non trovato');

  // 055 — DUE BASI DIVERSE, E IL CONTO NON TORNAVA.
  //
  // `total_price` e' la cassa attesa: il totale DOPO lo scomputo del credito
  // MyCity. `seller_payout_cents` invece nasce sul LORDO, prima del credito.
  // La quota da recuperare dal negozio si calcolava come
  // `rimborso × netto_venditore / total_price`: numeratore e denominatore da
  // due basi diverse. Su un ordine da 50 euro pagato con 20 euro di credito,
  // un rimborso da 10 euro recuperava dal negozio 10×netto/30 invece di
  // 10×netto/50 — il 67% in piu' del dovuto, tolto al negoziante senza motivo.
  //
  // E un ordine coperto per intero dal credito (gift card da 50 su un ordine
  // da 50) aveva total_price = 0: il tetto era zero, quindi quell'ordine non
  // era rimborsabile in nessun modo, ne' dal reso ne' dal reclamo.
  //
  // Ora il lordo e' una colonna sua (migrazione 124). Il ripiego su
  // total_price serve solo agli ordini nati prima.
  const grossCents = order.gross_total_cents ?? Math.round(Number(order.total_price) * 100);
  const alreadyRefunded = order.refunded_amount_cents ?? 0;
  const safeAmountCents = Math.max(0, Math.min(opts.amountCents, grossCents - alreadyRefunded));
  if (safeAmountCents <= 0) throw new Error('refundOrder: importo rimborso non valido');

  // 051 — LA RIVENDICAZIONE VIENE PRIMA DEI SOLDI.
  // Prima il totale rimborsato veniva letto qui, sommato in memoria e riscritto
  // più sotto. Due percorsi partiti insieme sullo stesso ordine — la decisione
  // su un reso e la risoluzione di una contestazione — leggevano entrambi
  // «zero rimborsato» e chiamavano Stripe entrambi: il denaro usciva due volte,
  // e uscire è irreversibile.
  // Ora la somma la fa il database in una riga sola, con il tetto dentro la
  // stessa istruzione. Se non rivendica, non si chiama Stripe: si esce.
  const { data: claimRimborso, error: errClaim } = await admin
    .rpc('accumula_rimborso', { p_order_id: order.id, p_delta: safeAmountCents });
  if (errClaim) {
    logger.error('[refundOrder] accumulo rimborso fallito', { orderId: order.id, message: errClaim.message });
    throw new Error('refundOrder: impossibile registrare il rimborso');
  }
  const rivendicato = Array.isArray(claimRimborso) ? claimRimborso[0] : claimRimborso;
  if (!rivendicato) {
    throw new Error('refundOrder: rimborso già registrato o oltre il totale dell ordine');
  }

  // payment_status distingue REFUNDED (pieno) da PARTIALLY_REFUNDED (parziale).
  const newRefundedTotal = Number(rivendicato.totale_rimborsato ?? 0);
  const isFull = newRefundedTotal >= grossCents;

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
      grossCents > 0 ? Math.min(Math.round((safeAmountCents * sellerNet) / grossCents), sellerNet) : 0;
    let { reversedCents } = await reverseOrderTransfer(order, sellerShare);

  // 046 — Se il payout NON è ancora partito, `reverseOrderTransfer` è un no-op:
  // giusto, non c'è niente da stornare. Ma prima finiva lì, e la quota del
  // venditore non veniva registrata da nessuna parte: al momento del pagamento
  // il cron gli versava il netto pieno, rimborso compreso. La perdita restava
  // alla piattaforma, in silenzio, su ogni rimborso parziale anticipato.
  // Ora la quota si accumula lo stesso: il pagamento successivo verserà il
  // residuo, che è quello che gli spetta davvero.
  if (reversedCents === 0 && sellerShare > 0 && order.payout_status !== 'TRANSFERRED') {
    const giaAddebitato = order.seller_payout_reversed_cents ?? 0;
    const nettoVenditore = order.seller_payout_cents ?? 0;
    const nuovoAddebito = Math.min(giaAddebitato + sellerShare, nettoVenditore);
    const { error: errQuota } = await admin
      .from('orders')
      .update({ seller_payout_reversed_cents: nuovoAddebito })
      .eq('id', order.id);
    if (errQuota) {
      logger.error('[refundOrder] quota venditore non addebitata', {
        orderId: order.id, message: errQuota.message,
      });
    } else {
      reversedCents = nuovoAddebito - giaAddebitato;
    }
  }

  // Rimborso totale: si recupera anche il compenso del fattorino, altrimenti la
  // piattaforma restituisce tutto al cliente e paga la consegna di tasca sua.
  if (isFull) {
    try {
      await reverseRiderTransfer(order as unknown as RiderReversibleOrder);
    } catch (err) {
      logger.error('[stripe] recupero compenso rider fallito', { orderId: order.id, err });
    }
  }
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
    // 051 — La chiave portava solo l'importo di QUESTO rimborso: due rimborsi
    // parziali uguali sullo stesso ordine (due volte 10 €) avevano la stessa
    // chiave, e il secondo non avveniva. Ora porta il totale cumulato, che è
    // diverso a ogni passo e uguale a se stesso su un ritentativo.
    { idempotencyKey: opts.idempotencyKey ?? `refund_${order.id}_tot_${newRefundedTotal}` },
  );
  const sellerNet = order.seller_payout_cents ?? 0;
  const sellerShare =
    grossCents > 0 ? Math.min(Math.round((safeAmountCents * sellerNet) / grossCents), sellerNet) : 0;

  const { reversedCents } = await reverseOrderTransfer(order, sellerShare);

  // Rimborso totale: si recupera anche il compenso del fattorino, altrimenti la
  // piattaforma restituisce tutto al cliente e paga la consegna di tasca sua.
  if (isFull) {
    try {
      await reverseRiderTransfer(order as unknown as RiderReversibleOrder);
    } catch (err) {
      logger.error('[stripe] recupero compenso rider fallito', { orderId: order.id, err });
    }
  }

  const wasTransferred = order.payout_status === 'TRANSFERRED';
  await admin
    .from('orders')
    .update({
      stripe_refund_id: refund.id,
      // `refunded_amount_cents` l'ha già scritto `accumula_rimborso`: riscriverlo
      // qui riaprirebbe la corsa che quella funzione serve a chiudere.
      payment_status: isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      ...(isFull
        ? {
            payout_status: wasTransferred ? 'REVERSED' : 'REFUNDED',
            // 054 — Un ordine già CONSEGNATO non torna «annullato» perché è
            // stato rimborsato: la consegna è avvenuta, il fattorino l'ha
            // fatta, e riscrivere quello stato cancellava dai numeri consegne
            // vere e faceva sparire l'ordine dalle liste operative.
            // Si tocca il pagamento, non la storia della consegna.
            ...(order.delivery_status === 'DELIVERED'
              ? {}
              : { delivery_status: 'CANCELED', canceled_at: new Date().toISOString() }),
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
