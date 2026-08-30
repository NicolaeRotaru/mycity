/**
 * Il webhook Stripe che crea gli ordini, e quello che gestisce un carrello
 * scaduto. È la strada su cui passano tutti i soldi del marketplace.
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
import { getStripe, computeOrderSplit } from '@/lib/stripe/client';
import { getAdminSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { logger } from '@/lib/logger';
import { contaAcquisto, analyticsConsentita } from '@/lib/analytics/server';
import { orderConfirmedBuyerTemplate, newOrderSellerTemplate } from '@/lib/email/templates';
import { notifyAdmins, sessionePagata } from './comune';
import { CAMPI_124, conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';
import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';

export type PendingGroup = {
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
  /**
   * 27/8/2026 (R165) — Il gruppo del test A/B letto dai cookie al checkout
   * (`{ home_hero: 'b' }`). Qui il webhook di cookie non ne riceve: se non
   * viaggiasse con la riga di intento, l'acquisto con carta arriverebbe nei
   * conti senza dire a quale variante appartiene.
   */
  esperimenti?: Record<string, string>;
  couponPortionCents: number;
  pickupPortionCents: number;
  totalCents: number;
};

export type PendingDelivery = {
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

export async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
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
    // 22/8/2026 — UNO SCARTO DETERMINISTICO NON SI RITENTA: SI CHIUDE.
    //
    // Qui si lanciava, perche' Stripe riprovasse. Ma questo scarto nasce dal
    // modo in cui i due totali sono calcolati: se c'e' una volta, c'e' tutte le
    // volte. Ogni ritentativo falliva identico, gli amministratori ricevevano lo
    // stesso avviso a ripetizione, e il cliente restava con i soldi presi e
    // nessun ordine — senza che nessun rimborso partisse mai. Nel caso peggiore
    // Stripe, dopo giorni di fallimenti, disattiva l'indirizzo del webhook: da
    // quel momento si fermano TUTTI i pagamenti, non solo questo.
    //
    // Adesso e' uno stato finale: si rimborsa (con la stessa chiave stabile gia'
    // usata per la riserva scaduta, quindi un doppio arrivo non fa due
    // rimborsi), si avvisa una volta sola e si risponde bene, cosi' Stripe non
    // ritenta.
    const pagamento = typeof session.payment_intent === 'string' ? session.payment_intent : null;
    if (pagamento && incassatoCents > 0) {
      try {
        await stripe.refunds.create(
          {
            payment_intent: pagamento,
            metadata: { motivo: 'quadratura_fallita', pending_checkout_id: pendingCheckoutId },
          },
          { idempotencyKey: `refund_quadratura_${pendingCheckoutId}` },
        );
      } catch (err) {
        // Qui il ritentativo ha senso: un rimborso fallito per un motivo
        // tecnico puo' riuscire al secondo colpo.
        logger.error('[stripe] rimborso su quadratura fallita non riuscito', { pendingCheckoutId, err });
        throw err;
      }
    }
    // Prima che la migrazione 126 sia applicata lo stato 'MISMATCH' non e'
    // ammesso dal vincolo e la scrittura fallirebbe: in quel caso si segna
    // 'CANCELED', che il carrello lo chiude comunque.
    await conRipiegoSchema(
      'pending_checkouts.update (quadratura fallita)',
      () => admin.from('pending_checkouts').update({ status: 'MISMATCH' }).eq('id', pendingCheckoutId),
      () => admin.from('pending_checkouts').update({ status: 'CANCELED' }).eq('id', pendingCheckoutId),
    );
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

    // Come nella rotta contanti: se la migrazione 124 non è ancora applicata,
    // l'inserimento si ripete senza i campi nuovi invece di far fallire
    // l'ordine (lib/db/migrazione-124.ts).
    const rigaOrdine = {
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
    };

    const { data: order, error: orderErr } = await conRipiegoSchema(
      'orders.insert (carta)',
      () => admin.from('orders').insert(rigaOrdine).select('id').single(),
      () => admin.from('orders').insert(senzaCampi(rigaOrdine, CAMPI_124)).select('id').single(),
    );

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

      /**
       * 22/8/2026 — LA PULIZIA NON VENIVA VERIFICATA.
       *
       * Quando le righe dell'ordine non entrano, l'ordine appena creato va
       * tolto: senza le sue righe è un ordine vuoto, che il cliente vede nella
       * sua lista e il negozio nella sua, con zero prodotti dentro e un totale
       * che non corrisponde a niente.
       *
       * Ma l'esito della cancellazione non si guardava. Se falliva anche
       * quella — ed è probabile, perché se il database sta rifiutando le righe
       * probabilmente rifiuta anche la cancellazione — restava un ordine
       * fantasma per sempre, e nessuno lo sapeva.
       *
       * Adesso: se la pulizia fallisce, gli amministratori lo scoprono subito,
       * con l'identificativo da cercare.
       */
      const { error: errPulizia } = await admin.from('orders').delete().eq('id', order.id);
      if (errPulizia) {
        logger.error(errPulizia, { context: 'stripe-order-rollback-failed', orderId: order.id });
        await notifyAdmins(
          '⚠️ Ordine fantasma da ripulire a mano',
          `L'ordine ${order.id} è stato creato ma le sue righe non sono entrate, e nemmeno la cancellazione è riuscita. In lista compare un ordine senza prodotti: va tolto a mano.`,
          `/admin/orders`,
        );
      }
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
   * 28/8/2026 — MA «NON ASPETTARE» NON VUOL DIRE «LANCIARE NEL VUOTO».
   *
   * Radiografia del 27/8, terzo bloccante. Il blocco partiva come promessa non
   * attesa (`const avvisi = (async () => {...})()` + `void avvisi.catch`). Su
   * un server che si spegne appena risposto — cioe' il nostro, Vercel — quel
   * lavoro puo' non arrivare mai in fondo. Dentro non c'erano solo le email:
   * c'era anche la campanella del venditore, che e' la riga da cui parte pure
   * la notifica push (app/api/cron/send-push la legge da `notifications`).
   * Risultato possibile: ordine pagato, soldi incassati, cliente che aspetta, e
   * in negozio non squilla niente.
   *
   * Adesso in due tempi, come fa gia' la rotta contanti:
   *   ① la campanella si scrive PRIMA di rispondere. E' una insert sola, non
   *      chiama nessun servizio esterno, e senza di lei il negoziante non sa di
   *      avere un ordine.
   *   ② le email e le misure restano best-effort, ma dentro `after()`: la
   *      piattaforma tiene viva la funzione finche' non finiscono, invece di
   *      spegnerla a meta'.
   */
  const nuovi = createdOrderIds.filter((c) => c.nuovo);

  if (nuovi.length > 0) {
    const { error: errCampanelle } = await admin.from('notifications').insert(
      nuovi.map((created) => ({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
        user_id: created.sellerId,
        title: '📦 Nuovo ordine ricevuto',
        body: `Ordine #${created.orderId.slice(0, 6).toUpperCase()} · €${(created.totalCents / 100).toFixed(2)} · ${created.itemsCount} articoli`,
        link: `/seller/orders/${created.orderId}`,
      })),
    );
    // Non si lancia: l'ordine c'e' ed e' pagato, e far ritentare Stripe
    // ricreerebbe il giro intero. Ma un negozio che non riceve la campanella e'
    // un ordine che nessuno prepara: deve restare scritto dove si guarda.
    if (errCampanelle) {
      logger.error('[stripe] campanella al venditore non scritta: ordine pagato e nessuno avvisato', {
        pendingCheckoutId, ordini: nuovi.map((c) => c.orderId), message: errCampanelle.message,
      });
    }
  }

  // #208 — L'acquisto si conta qui, dove il fatto è certo: gli ordini sono
  // appena stati scritti. Prima partiva solo dal browser, al rientro sulla
  // pagina ordini: chi chiudeva la scheda dopo aver pagato spariva dai conti.
  dopoLaRisposta(async () => {
    const consensoAnalytics = await analyticsConsentita(admin, buyerId);
    await Promise.all(
      nuovi.map((c) =>
        contaAcquisto({
          consensoAnalytics,
          orderId: c.orderId,
          buyerId,
          totalCents: c.totalCents,
          paymentMethod: 'card',
          sellerId: c.sellerId,
          checkoutId: pendingCheckoutId,
          // La variante e' la stessa per tutto il carrello: si legge dal primo
          // gruppo, dove il checkout l'ha scritta.
          varianti: groups[0]?.esperimenti ?? {},
        }),
      ),
    );
  }, 'misura acquisto');

  dopoLaRisposta(async () => {
    for (const created of nuovi) {
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
  }, 'avvisi post-ordine');
}

/**
 * checkout.session.expired → il buyer ha abbandonato il pagamento. Rilascia lo stock
 * riservato al checkout (immediato, senza attendere il cron expire-checkouts).
 */
export async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
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
