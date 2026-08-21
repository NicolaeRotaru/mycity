import { NextResponse, type NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import type Stripe from 'stripe';
import { getStripe, computeOrderSplit } from '@/lib/stripe/client';
import { reverseOrderTransfer, reverseRiderTransfer, applyConnectAccountStatus } from '@/lib/stripe/payout';
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
      // 066 — L'esito buono va registrato quanto quello cattivo: senza i
      // riusciti non esiste un tasso di autorizzazione, esiste solo un conto
      // di fallimenti senza denominatore.
      case 'payment_intent.succeeded': {
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
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
  /** Compenso del fattorino, calcolato al checkout sulla distanza. */
  riderFeeCents?: number;
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
  // 057 — `checkout.session.completed` vuol dire «il cliente ha finito la
  // procedura», non «i soldi sono arrivati». Con carta di credito le due cose
  // coincidono; col primo metodo asincrono che si aggiunge (bonifico, SEPA,
  // Klarna) non più: si creerebbero ordini pagati per denaro mai incassato.
  // Vale per gli ordini e per i tre fratelli (gift card, sponsorizzati,
  // abbonamento), tutti richiamati dallo stesso evento.
  if (!sessionePagata(session)) {
    logger.info('[stripe] sessione completata ma non pagata: nessun ordine creato', {
      sessionId: session.id, stato: session.payment_status,
    });
    return;
  }
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
    .select('id, buyer_id, status, groups, coupon_code, delivery, pickup_in_store, total_cents, stripe_session_id, expires_at')
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

  // Riserva della merce già scaduta: la merce è stata rimessa in vendita e
  // potrebbe essere stata comprata da un altro. Creare l'ordine qui vorrebbe
  // dire vendere due volte la stessa cosa. Il pagamento c'è: si rimborsa.
  //
  // Da qui in avanti la sessione Stripe scade insieme alla riserva (vedi
  // lib/stripe/client.ts), quindi questo caso è la rete di sicurezza per le
  // sessioni create prima di quella modifica e per i casi di confine.
  if (pending.status === 'EXPIRED') {
    // 162 — Prima di rimborsare, guarda se degli ordini sono gia' nati.
    //
    // Il caso: il pagamento riesce, il webhook muore a meta' (creati gli
    // ordini dei primi negozi, non quelli degli ultimi), passano due ore, il
    // record scade. Al tentativo successivo si finiva qui e si rimborsava
    // tutto — mentre il negozio stava preparando un ordine PAID e NEW che
    // nessuno annullava. Un cliente rimborsato a merce in lavorazione.
    const { data: ordiniGiaNati } = await admin
      .from('orders')
      .select('id')
      .eq('stripe_session_id', session.id);
    if (ordiniGiaNati && ordiniGiaNati.length > 0) {
      logger.error('[stripe] riserva scaduta ma con ordini gia creati: nessun rimborso automatico', {
        pendingCheckoutId, ordini: ordiniGiaNati.length,
      });
      await notifyAdmins(
        '⚠️ Carrello scaduto con ordini gia creati',
        `Il carrello ${pendingCheckoutId} risulta scaduto ma ha gia' ${ordiniGiaNati.length} ordine/i in corso. Non e' stato rimborsato niente: va guardato a mano prima di decidere.`,
        '/admin/orders',
      );
      return;
    }

    logger.error('[stripe] pagamento su una riserva scaduta: rimborso', { pendingCheckoutId });
    const importoCents = session.amount_total ?? 0;
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : null;
    if (pi && importoCents > 0) {
      try {
        await stripe.refunds.create(
          { payment_intent: pi, metadata: { motivo: 'riserva_scaduta', pending_checkout_id: pendingCheckoutId } },
          { idempotencyKey: `refund_scaduto_${pendingCheckoutId}` },
        );
      } catch (err) {
        logger.error('[stripe] rimborso su riserva scaduta fallito', { pendingCheckoutId, err });
        throw err;   // Stripe riprova: meglio ritentare che tenere soldi non dovuti
      }
    }
    await notifyAdmins(
      '⚠️ Pagamento su carrello scaduto',
      `Un pagamento è arrivato dopo la scadenza della riserva merce (${pendingCheckoutId}). Rimborsato automaticamente.`,
      '/admin/orders',
    );
    return;
  }

  // 065 — QUADRATURA: QUELLO CHE E' ENTRATO E QUELLO CHE AVEVAMO PREVENTIVATO.
  //
  // Il checkout calcola il totale atteso e lo salva in
  // `pending_checkouts.total_cents`. Il webhook lo leggeva e non lo usava mai.
  // Eppure le due cifre possono divergere: i totali per gruppo passano da un
  // `Math.max(0, …)` mentre Stripe applica lo sconto sull'intera sessione,
  // quindi quando quel taglio scatta la somma dei gruppi non coincide piu' con
  // l'addebito. Non e' sfruttabile da fuori — gli importi li ricalcola il
  // server — ma senza questo confronto nascevano ordini con importi diversi da
  // quanto e' entrato in cassa, e nessuno se ne accorgeva fino alla
  // riconciliazione. E' il controllo piu' economico che esista sul percorso
  // dei soldi: due numeri e una sottrazione.
  const attesoCents = typeof pending.total_cents === 'number' ? pending.total_cents : null;
  const incassatoCents = session.amount_total ?? null;
  if (attesoCents !== null && incassatoCents !== null && Math.abs(incassatoCents - attesoCents) > 1) {
    logger.error('[stripe] incasso diverso dal preventivo: ordini non creati', {
      pendingCheckoutId, attesoCents, incassatoCents,
    });
    await notifyAdmins(
      '⚠️ Incasso diverso dal preventivo',
      `Sul carrello ${pendingCheckoutId} Stripe ha incassato €${(incassatoCents / 100).toFixed(2)} ma il preventivo era €${(attesoCents / 100).toFixed(2)}. Nessun ordine creato: va guardato a mano.`,
      '/admin/orders',
    );
    // Si lancia: l'evento resta non processato, Stripe riprova e nel frattempo
    // nessun ordine nasce con un importo che non torna.
    throw new Error(`quadratura fallita su ${pendingCheckoutId}: incassati ${incassatoCents}, attesi ${attesoCents}`);
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
      // 052 — Questo NON è un dettaglio best-effort. Senza `stripe_charge_id` il
      // pagamento al negozio parte senza `source_transaction`: Stripe lo prende
      // dal saldo della piattaforma, che sui conti nuovi è vuoto, e il
      // trasferimento resta bloccato per sempre. Il negozio non viene pagato e
      // nessuno sa perché.
      // Meglio far fallire l'evento: Stripe lo riconsegna, e la creazione degli
      // ordini è già protetta dall'indice unico su (sessione, negozio).
      logger.error('[stripe] retrieve PI per charge_id fallita: evento respinto per riconsegna', {
        sessionId: session.id, paymentIntent, e,
      });
      throw e;
    }
  }

  const buyerEmail = session.customer_details?.email ?? session.customer_email ?? null;
  const buyerName = session.customer_details?.name ?? delivery.full_name;
  // `nuovo` distingue gli ordini creati adesso da quelli ripescati perche'
  // gia' esistevano da un tentativo precedente (#164): solo i primi meritano
  // email e campanella.
  const createdOrderIds: Array<{ orderId: string; sellerId: string; totalCents: number; itemsCount: number; nuovo: boolean }> = [];

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
        // 055 — Con la carta non c'e' credito MyCity da scomputare, quindi il
        // lordo e il netto coincidono. Si scrive lo stesso, perche' il
        // rimborso divide sempre per questa colonna e non deve chiedersi da
        // quale strada e' arrivato l'ordine.
        gross_total_cents: g.totalCents,
        shipping_cost: g.shippingCents / 100,
        delivery_fee_cents: deliveryFeeCents,
        // Compenso del fattorino: dipende dalla distanza, non da quanto ha
        // pagato il cliente (vedi commento in lib/shipping.ts).
        rider_fee_cents: g.riderFeeCents ?? null,
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
          // 164 — Questo ordine c'era gia': l'ha creato un tentativo
          // precedente, che poi e' morto su un gruppo successivo. Le sue email
          // e la sua campanella sono gia' partite. Se lo si segna come nuovo,
          // al secondo giro il negoziante riceve una seconda «Nuovo ordine» e
          // il cliente una seconda conferma: telefonano per capire se sono due
          // ordini, e il cliente teme il doppio addebito.
          createdOrderIds.push({
            orderId: existing.id,
            sellerId: g.sellerId,
            totalCents: g.totalCents,
            itemsCount: g.items.reduce((s, it) => s + it.quantity, 0),
            nuovo: false,
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
      nuovo: true,
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

  /**
   * #176 — Le email non tengono piu' in ostaggio la risposta a Stripe.
   *
   * Stripe considera fallita una consegna che non riceve risposta entro pochi
   * secondi, la ritenta, e dopo troppi fallimenti disattiva l'endpoint. Qui,
   * per ogni ordine, si aspettavano DUE invii di posta (con un secondo
   * tentativo interno ciascuno) piu' una lettura dell'utente venditore: con un
   * carrello da tre negozi e Resend lento si arrivava tranquillamente oltre il
   * limite. E il lavoro che conta — l'ordine — era gia' fatto.
   *
   * Gli ordini sono creati e registrati sopra: da qui in giu' e' tutto
   * best-effort, e parte senza far aspettare nessuno. Se un'email fallisce si
   * vede nel log, non nel fatto che Stripe smette di parlarci.
   */
  const avvisi = (async () => {
  for (const created of createdOrderIds) {
    // 164 — Solo gli ordini nati adesso. Gli altri le comunicazioni le hanno
    // gia' avute nel tentativo precedente.
    if (!created.nuovo) continue;
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
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
      user_id: created.sellerId,
      title: '📦 Nuovo ordine ricevuto',
      body: `Ordine #${created.orderId.slice(0, 6).toUpperCase()} · €${(created.totalCents / 100).toFixed(2)} · ${created.itemsCount} articoli`,
      link: `/seller/orders/${created.orderId}`,
    });
  }
  })();
  // Non si aspetta: si registra soltanto se qualcosa va storto.
  void avvisi.catch((e) => logger.warn('[webhook] avvisi post-ordine falliti', { message: e instanceof Error ? e.message : 'errore' }));
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
    // `throw`, non `return`: chi chiama interpreta il ritorno come «fatto» e
    // segna l'evento come lavorato, quindi Stripe non riprova mai piu'. Con un
    // errore l'evento resta da rifare e il problema si vede.
    logger.error('[stripe] gift_card senza amount valido', { sessionId: session.id });
    throw new Error(`gift_card senza importo valido (sessione ${session.id})`);
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
    throw new Error(`sponsorizzazione con dati incompleti (sessione ${session.id})`);
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
    throw new Error(`sponsorizzazione non creata (sessione ${session.id}): ${error.message}`);
  }

  await admin.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
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
    throw new Error(`abbonamento con dati incompleti (sessione ${session.id})`);
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
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
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
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
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

async function handleAccountUpdated(acct: Stripe.Account) {
  // Logica condivisa con POST /api/stripe/connect/refresh-status.
  await applyConnectAccountStatus(acct);
}

type DisputeOrderRow = {
  id: string;
  payout_status: string | null;
  stripe_transfer_id: string | null;
  seller_payout_cents: number | null;
  seller_payout_reversed_cents?: number | null;
  rider_payout_reversed_cents?: number | null;
  delivery_status?: string | null;
  stripe_reversal_id: string | null;
  // Servono per recuperare anche il compenso versato al fattorino.
  rider_id?: string | null;
  rider_transfer_id: string | null;
  rider_payout_status: string | null;
  rider_fee_cents?: number | null;
  shipping_cost?: number | string | null;
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

/**
 * 057 — Una sessione «completata» non è per forza una sessione PAGATA. Stripe
 * usa `payment_status`: 'paid' o 'no_payment_required' vogliono dire soldi
 * arrivati (o non dovuti); 'unpaid' vuol dire che il pagamento è ancora per
 * strada, come succede con bonifici e pagamenti differiti.
 */
function sessionePagata(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
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
    'id, payout_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_fee_cents, shipping_cost',
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
    // Anche il compenso del fattorino torna indietro: senza questo la
    // piattaforma restituisce l'incasso al cliente e paga la consegna da se'.
    try {
      await reverseRiderTransfer(o);
    } catch (e) {
      logger.error('[stripe] recupero compenso rider su contestazione fallito', { orderId: o.id, e });
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
  const orders = await findOrdersForDispute(dispute, 'id, payout_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id, payout_tentativo, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_payout_tentativo, rider_fee_cents, shipping_cost');
  if (orders.length === 0) return;
  const admin = getAdminSupabase();
  const ids = orders.map((o) => o.id);

  if (dispute.status === 'won') {
    // Il payout va davvero sbloccato, non solo annunciato. All'apertura della
    // contestazione i soldi del venditore erano stati richiamati indietro
    // (payout_status='REVERSED'): se qui ci si limitasse a scrivere 'WON', il
    // venditore avrebbe consegnato la merce, vinto la causa e non essere mai
    // stato pagato — il cron dei payout non guarda gli ordini 'REVERSED'.
    await admin.from('orders').update({ dispute_status: 'WON' }).in('id', ids);

    const daRipagare = orders.filter((o) => o.payout_status === 'REVERSED');
    if (daRipagare.length > 0) {
      // 158 — Riga per riga, perche' il numero del tentativo sale di uno. E'
      // quel numero a rendere diversa la chiave di idempotenza del bonifico:
      // con la chiave vecchia Stripe avrebbe restituito il transfer gia'
      // stornato, e il venditore avrebbe vinto la causa senza essere pagato.
      for (const o of daRipagare) {
        await admin
          .from('orders')
          .update({
            payout_status: 'HELD',       // torna fra i candidati del prossimo giro
            stripe_transfer_id: null,    // il transfer precedente e' stato stornato
            stripe_reversal_id: null,
            seller_payout_reversed_cents: 0,
            payout_at: null,
            payout_tentativo: ((o as { payout_tentativo?: number }).payout_tentativo ?? 0) + 1,
          })
          .eq('id', o.id);
      }
      logger.info('[stripe] contestazione vinta: payout rimessi in coda', {
        ordini: daRipagare.length,
      });
    }

    // 158 — E IL FATTORINO? All'apertura della contestazione gli veniva
    // richiamato indietro il compenso (`reverseRiderTransfer`, poche righe
    // sopra), ed e' il caso normale: il bonifico parte un'ora dopo la
    // consegna, la contestazione arriva settimane dopo. Poi qui si rimetteva
    // in coda solo il venditore. Il fattorino restava a 'REVERSED' per
    // sempre: la consegna l'aveva fatta, la piattaforma teneva l'incasso, e
    // lui non veniva pagato — senza nessun avviso. Su chi e' pagato a
    // consegna, questo e' abbandono alla seconda volta.
    const riderDaRipagare = orders.filter((o) => o.rider_payout_status === 'REVERSED' && o.rider_id);
    if (riderDaRipagare.length > 0) {
      for (const o of riderDaRipagare) {
        await admin
          .from('orders')
          .update({
            rider_payout_status: 'HELD',
            rider_transfer_id: null,
            rider_payout_reversed_cents: 0,
            rider_payout_at: null,
            rider_payout_tentativo: ((o as { rider_payout_tentativo?: number }).rider_payout_tentativo ?? 0) + 1,
          })
          .eq('id', o.id);
      }
      logger.info('[stripe] contestazione vinta: compensi fattorino rimessi in coda', {
        ordini: riderDaRipagare.length,
      });
    }

    await notifyAdmins('✓ Chargeback vinto', `Contestazione vinta su ordine ${ids[0]}. Payout rimesso in coda.`, '/admin/disputes');
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

  // Stripe manda questo evento a OGNI storno, anche parziale. Marcare
  // 'REVERSED' senza guardare gli importi chiudeva la porta agli storni
  // successivi: reverseOrderTransfer parte solo da 'TRANSFERRED', quindi dopo un
  // rimborso parziale il resto non si poteva piu' recuperare.
  const stornato = transfer.amount_reversed ?? 0;
  const totale = transfer.amount ?? 0;
  const eTotale = totale > 0 ? stornato >= totale : true;

  if (!eTotale) {
    logger.info('[stripe] transfer.reversed parziale: stato invariato', {
      transferId: transfer.id, stornato, totale,
    });
    return;
  }

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
  // 064 — Prima si leggeva, si rilasciava la merce e POI si scriveva EXPIRED:
  // il cron `expire-checkouts` e questo evento potevano passare insieme e
  // rimettere in magazzino la stessa merce due volte, e restituire due volte il
  // codice sconto. La rivendicazione condizionata è la stessa forma già usata
  // nel cron: o la riga passa da PENDING a EXPIRED qui, o non si fa niente.
  const { data: rivendicati } = await admin
    .from('pending_checkouts')
    .update({ status: 'EXPIRED' })
    .eq('id', pid)
    .eq('status', 'PENDING')
    .select('id, groups, coupon_code');
  const pending = rivendicati?.[0];
  if (!pending) return;
  const groups = (pending.groups as PendingGroup[]) ?? [];
  const items = groups.flatMap((g) =>
    (g.items ?? []).map((it) => ({ product_id: it.productId, variant_id: it.variantId ?? null, qty: it.quantity })),
  );
  if (items.length > 0) await admin.rpc('restore_stock', { p_items: items });

  // Il codice sconto torna disponibile: il cliente ha abbandonato il pagamento.
  const codiceAbbandonato = (pending as { coupon_code?: string | null }).coupon_code ?? null;
  if (codiceAbbandonato) {
    const { error: cErr } = await admin.rpc('release_coupon', { p_code: codiceAbbandonato });
    if (cErr) logger.warn('[stripe] codice sconto non restituito', { pid, message: cErr.message });
  }

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
  await registraTentativoPagamento(pi, 'failed');
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  await registraTentativoPagamento(pi, 'succeeded');
}

/**
 * 066 — L'ESITO DI OGNI TENTATIVO DI PAGAMENTO, SCRITTO DOVE SI PUO' CONTARE.
 *
 * Del rifiuto di una carta restava una riga di log e nient'altro: il motivo —
 * fondi insufficienti, rifiuto dell'emittente, 3D Secure non completato —
 * finiva su Sentry e spariva. Cosi' alla domanda base del prodotto pagamenti,
 * «quanti tentativi vanno a buon fine e perche' falliscono gli altri», non si
 * poteva rispondere: ogni intervento sul checkout era una scommessa, e
 * un'interruzione dei pagamenti si sarebbe vista solo dal calo degli ordini.
 *
 * Best-effort: una misura non deve mai far fallire un pagamento.
 */
async function registraTentativoPagamento(
  pi: Stripe.PaymentIntent,
  esito: 'succeeded' | 'failed',
): Promise<void> {
  try {
    const admin = getAdminSupabase();
    const errore = pi.last_payment_error;
    const pendingId = typeof pi.metadata?.pending_checkout_id === 'string'
      ? pi.metadata.pending_checkout_id
      : null;
    // La charge arriva espansa solo se qualcuno l'ha chiesto: quando c'e' si
    // legge l'esito di rete e quello del 3D Secure, quando non c'e' restano
    // vuoti. Meglio un campo vuoto che un campo riempito con la cosa sbagliata.
    const charge = typeof pi.latest_charge === 'object' && pi.latest_charge !== null
      ? (pi.latest_charge as Stripe.Charge)
      : null;
    const { error } = await admin.from('payment_attempts').insert({
      payment_intent_id: pi.id,
      pending_checkout_id: pendingId,
      user_id: typeof pi.metadata?.buyer_user_id === 'string' ? pi.metadata.buyer_user_id : null,
      amount_cents: pi.amount ?? null,
      status: esito,
      decline_code: errore?.decline_code ?? charge?.outcome?.reason ?? null,
      error_code: errore?.code ?? null,
      network_status: charge?.outcome?.network_status ?? null,
      three_d_secure: charge?.payment_method_details?.card?.three_d_secure?.result ?? null,
    });
    // 23505 = lo stesso evento e' gia' stato registrato: e' idempotenza, non un guasto.
    if (error && (error as { code?: string }).code !== '23505') {
      logger.warn('[stripe] tentativo di pagamento non registrato', { paymentIntent: pi.id, message: error.message });
    }
  } catch (e) {
    logger.warn('[stripe] tentativo di pagamento non registrato', { paymentIntent: pi.id, e });
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
async function handleRefundUpdated(refund: Stripe.Refund) {
  if (refund.status !== 'failed' && refund.status !== 'canceled') return;

  const admin = getAdminSupabase();
  const paymentIntent = typeof refund.payment_intent === 'string'
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
  if (!paymentIntent) {
    logger.warn('[stripe] rimborso fallito senza payment_intent', { refundId: refund.id });
    return;
  }

  const { data: order } = await admin
    .from('orders')
    .select('id, refunded_amount_cents, gross_total_cents, total_price, payment_status')
    .eq('stripe_payment_intent', paymentIntent)
    .maybeSingle();
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
