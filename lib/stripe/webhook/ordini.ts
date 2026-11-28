/**
 * Il webhook Stripe che crea gli ordini, e quello che gestisce un carrello
 * scaduto. È la strada su cui passano tutti i soldi del marketplace.
 *
 * #12 — Sta qui e non in `app/api/stripe/webhook/route.ts`: quel file era uno solo, da mille
 * righe, con otto mestieri senza rapporto fra loro (il perché intero in testa a `rimborsi.ts`).
 */
import type Stripe from 'stripe';
import { getStripe, computeOrderSplit } from '@/lib/stripe/client';
import { formatPriceFromCents } from '@/lib/format';
import { marcaCarrelloRecuperato } from '@/lib/carrelli-abbandonati';
import { togliIlPagatoDalCarrelloSalvato } from '@/lib/carrello-sul-server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { logger } from '@/lib/logger';
import { contaAcquisto, analyticsConsentita } from '@/lib/analytics/server';
import { clientIdGaValido } from '@/lib/analytics/ga-client-id';
import { orderConfirmedBuyerTemplate, newOrderSellerTemplate } from '@/lib/email/templates';
import { notifyAdmins, provaAMandare, sessionePagata, suonaLaCampanellaAiNegozi } from './comune';
import { scritturaObbligatoria } from './esito';
import { chiudiIlCarrelloPerQuadratura, merceDelCarrello } from './quadratura';
import { CAMPI_124, conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';
import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';
import { motivoFasciaRifiutata } from '@/lib/quando-arriva';
import { fasciaAlGiornoDellOrdine } from '@/lib/ordini/fascia-leggibile';
import { orariDeiNegozi, rimborsaLaFasciaPersa, diciAlClienteDelCarrelloRimborsato, avvisaIlClienteDelRimborsoAutomatico } from './fascia-al-pagamento';
import { completaGliArticoliDelTentativoMorto, righeDegliArticoli } from './articoli-del-tentativo-morto';

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
  /**
   * 30/8/2026 (R163) — La chiave del checkout nata nel browser: lega
   * `checkout_started` (uno per carrello) agli `order_placed` (uno per ordine).
   */
  chiaveCheckout?: string | null;
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
    const { data: ordiniGiaNati, error: errGiaNati } = await admin
      .from('orders')
      .select('id')
      .eq('stripe_session_id', session.id);
    // R81 — una lettura caduta non è «nessun ordine»: si rimborserebbe merce in lavorazione.
    if (errGiaNati) throw new Error(`[stripe] riserva scaduta: ordini non letti (${errGiaNati.message})`);
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
    if (pi && importoCents > 0) await diciAlClienteDelCarrelloRimborsato(admin, session, 'riserva-scaduta', pendingCheckoutId, pending.buyer_id as string | null, importoCents);
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
    logger.error('[stripe] incasso diverso dal preventivo: ordini non creati', { pendingCheckoutId, attesoCents, incassatoCents });
    await notifyAdmins(
      '⚠️ Incasso diverso dal preventivo',
      `Sul carrello ${pendingCheckoutId} Stripe ha incassato ${formatPriceFromCents(incassatoCents)} ma il preventivo era ${formatPriceFromCents(attesoCents)}. Nessun ordine creato: va guardato a mano.`,
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
    // Prima della migrazione 126 'MISMATCH' non è ammesso: si segna 'CANCELED'.
    // Se il segno non passa Stripe NON riprova: il perché in quadratura.ts (R81).
    await chiudiIlCarrelloPerQuadratura(admin, pendingCheckoutId);
    if (pagamento && incassatoCents > 0) await diciAlClienteDelCarrelloRimborsato(admin, session, 'quadratura', pendingCheckoutId, pending.buyer_id as string | null, incassatoCents);
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

  // La latest_charge dà stripe_charge_id (il bonifico al negozio usa source_transaction) e dice
  // se la carta è già tornata indietro mentre questo avviso falliva.
  let stripeChargeId: string | null = null;
  let carta: Stripe.Charge | null = null;
  if (paymentIntent) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntent, { expand: ['latest_charge'] });
      const lc = pi.latest_charge;
      stripeChargeId = typeof lc === 'string' ? lc : (lc?.id ?? null);
      carta = lc && typeof lc === 'object' ? lc : null;
    } catch (e) {
      // 052 — Non è best-effort: senza `stripe_charge_id` il bonifico al negozio parte dal saldo
      // della piattaforma (vuoto sui conti nuovi) e resta bloccato per sempre. Stripe riconsegna
      // l'evento, e gli ordini sono già protetti dall'indice unico su (sessione, negozio).
      logger.error('[stripe] retrieve PI per charge_id fallita: evento respinto per riconsegna', {
        sessionId: session.id, paymentIntent, e,
      });
      throw e;
    }
  }

  // 26/11/2026 — LA CARTA GIÀ TORNATA. Rimborsata o contestata mentre questo avviso falliva: rileggerla solo per l'id
  // faceva nascere l'ordine PAID, e il giro pagava il negozio con soldi già tornati al cliente. Tutta o contestata:
  // non nasce niente (i nati li lavorano rimborso e contestazione). In parte e nessun ordine nato: il resto torna al
  // cliente. In parte con ordini nati (un nostro annullo in un carrello nato a metà, o il cruscotto, che lavora
  // rimborsi-da-fuori.ts): il resto nasce, come prima.
  const giaTornati = carta?.amount_refunded ?? 0;
  const tutta = !!carta && (carta.refunded || carta.disputed || (giaTornati > 0 && giaTornati >= carta.amount));
  if (carta && paymentIntent && (tutta || giaTornati > 0)) {
    const { data: nati, error: errNati } = await admin.from('orders').select('seller_id').eq('stripe_session_id', session.id);
    if (errNati) throw new Error(`[stripe] carta già tornata: ordini non letti (${errNati.message})`);
    const natiDa = new Set((nati ?? []).map((o) => o.seller_id as string));
    if (tutta || natiDa.size === 0) {
      // Senza importo e con la chiave stabile: Stripe rimborsa quello che manca, e la riconsegna non ne fa un altro.
      if (!tutta) await stripe.refunds.create({ payment_intent: paymentIntent, metadata: { motivo: 'carta_tornata', pending_checkout_id: pendingCheckoutId } }, { idempotencyKey: `refund_carta_tornata_${pendingCheckoutId}` });
      if (natiDa.size === 0) await chiudiIlCarrelloPerQuadratura(admin, pendingCheckoutId);
      // Nato a metà: si chiude, e torna in vendita la merce dei soli negozi non nati (quella dei nati la rimette il loro rimborso).
      else if ((await admin.from('pending_checkouts').update({ status: 'CANCELED' }).eq('id', pendingCheckoutId).eq('status', 'PENDING').select('id')).data?.length) {
        const { error } = await admin.rpc('restore_stock', { p_items: merceDelCarrello(groups.filter((g) => !natiDa.has(g.sellerId))) });
        if (error) logger.error('[stripe] carta già tornata: merce dei negozi non nati non rimessa in vendita', { pendingCheckoutId, message: error.message });
      }
      await notifyAdmins('⚠️ Pagamento senza ordine: carta già tornata', `Sul carrello ${pendingCheckoutId} la carta risulta ${carta.disputed ? 'contestata in banca (se è solo una richiesta di informazioni i soldi ci sono ancora: il cliente va rimborsato a mano)' : tutta ? 'rimborsata per intero' : 'rimborsata in parte (il resto è stato rimborsato adesso)'}${natiDa.size ? `, con ${natiDa.size} ordine/i già nati: il resto non nasce` : ''}. Nessun ordine nuovo creato: guarda su Stripe.`, '/admin/orders', { unaVoltaPer: `carta-tornata:${pendingCheckoutId}` });
      if (!tutta) await avvisaIlClienteDelRimborsoAutomatico(admin, session, { chiave: `carta-tornata-cliente:${pendingCheckoutId}`, buyerId, traccia: { pendingCheckoutId },
        frase: "Una parte del pagamento ti era già stata rimborsata prima che l'ordine nascesse: ti abbiamo rimborsato anche il resto e nessun ordine è stato creato.",
        invito: "Puoi rifare l'ordine dal carrello.", oggetto: '💶 Pagamento rimborsato: il tuo ordine non è stato creato', motivo: 'il pagamento era già stato rimborsato in parte.' });
      return;
    }
  }

  // 31/10/2026 — LA FASCIA SI GUARDA QUANDO SI PAGA, E SI SCRIVE DAL GIORNO DELL'ORDINE.
  // La rotta la controlla quando apre la pagina di Stripe, che resta pagabile per ore; l'ordine
  // nasce qui. ① «Domani» scelto alle 23:50 e pagato alle 00:10 si riporta al giorno dell'ordine
  // ② la regola unica dei contanti si rifà adesso: se dice no, rimborso e nessun ordine.
  // Il perché intero in lib/stripe/webhook/fascia-al-pagamento.ts.
  const fasciaScelta = pickupInStore ? null : (delivery.slot ?? null);
  let fasciaDellOrdine = fasciaScelta;
  if (fasciaScelta) {
    const sceltaIl = typeof session.created === 'number' ? new Date(session.created * 1000) : new Date();
    const riportata = fasciaAlGiornoDellOrdine(fasciaScelta, sceltaIl, new Date());
    const motivo = riportata === null
      ? 'La fascia scelta è già passata quando è arrivato il pagamento.'
      : motivoFasciaRifiutata(riportata, await orariDeiNegozi(admin, groups));
    if (motivo && await rimborsaLaFasciaPersa(admin, session, pendingCheckoutId, motivo, { buyerId, fascia: fasciaScelta })) return;
    fasciaDellOrdine = riportata ?? fasciaScelta;
  }

  const buyerEmail = session.customer_details?.email ?? session.customer_email ?? null;
  const buyerName = session.customer_details?.name ?? delivery.full_name;
  // `nuovo` distingue gli ordini creati adesso da quelli ripescati perche'
  // gia' esistevano da un tentativo precedente (#164): solo i primi meritano
  // email e campanella.
  const createdOrderIds: Array<{ orderId: string; sellerId: string; totalCents: number; itemsCount: number; nuovo: boolean; fascia: string | null; ritiro: boolean }> = [];

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
      // Fascia di consegna scelta dal buyer, detta dal giorno in cui nasce l'ordine.
      delivery_slot: fasciaDellOrdine,
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
          // 164 — Questo ordine c'era gia': l'ha creato un tentativo precedente, morto dopo. Non e'
          // «nuovo» (niente seconda «Nuovo ordine»: le email le decide la campanella a id fisso).
          // R03-001 — Se quel tentativo e' morto fra l'ordine e gli articoli, gli articoli si scrivono
          // adesso: un ordine pagato e vuoto teneva la merce che nessun annullo rimetteva.
          const completato = await completaGliArticoliDelTentativoMorto(admin, existing.id, g);
          createdOrderIds.push({
            orderId: existing.id,
            sellerId: g.sellerId,
            totalCents: g.totalCents,
            itemsCount: g.items.reduce((s, it) => s + it.quantity, 0),
            nuovo: completato, fascia: fasciaDellOrdine, ritiro: pickupInStore, // R31-025: per la campanella
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

    // order_items (le stesse righe che una riconsegna scrive se questo tentativo muore qui: R03-001)
    const { error: itemsErr } = await admin.from('order_items').insert(righeDegliArticoli(order.id, g));
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
      nuovo: true, fascia: fasciaDellOrdine, ritiro: pickupInStore, // R31-025: per la campanella
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

  /**
   * #176 — Le email non tengono piu' in ostaggio la risposta a Stripe, che considera fallita una
   * consegna senza risposta entro pochi secondi, la ritenta e dopo troppi fallimenti disattiva
   * l'endpoint: due invii di posta per ordine, con tre negozi e Resend lento, andavano oltre il
   * limite a ordine gia' fatto.
   *
   * 28/8/2026 — MA «NON ASPETTARE» NON VUOL DIRE «LANCIARE NEL VUOTO». Una promessa non attesa, su
   * un server che si spegne appena risposto (Vercel), puo' non arrivare in fondo: e dentro c'era
   * anche la campanella del venditore, da cui parte pure la push (app/api/cron/send-push legge
   * `notifications`). Ordine pagato, e in negozio non squillava niente. Adesso in due tempi, come
   * la rotta contanti:
   *   ① la campanella si scrive PRIMA di rispondere: una insert sola, senza servizi esterni;
   *   ② le email e le misure restano best-effort, ma dentro `after()`, che tiene viva la funzione.
   */
  // 5/11/2026 — Campanella per tutti gli ordini (id fisso): anche quelli di un tentativo morto prima degli avvisi.
  if (createdOrderIds.some((c) => c.nuovo)) {
    // 30/8/2026 (R164) — Il carrello di questa persona e' tornato: e' diventato
    // un ordine. Lo marca anche il browser, ma il browser puo' chiudersi — chi
    // paga e chiude la scheda non passa mai di li'. Qui il fatto e' certo.
    await marcaCarrelloRecuperato(admin, buyerId);
    // R10-006 — Anche dal carrello salvato sul server, che chi non torna da Stripe ritrovava pieno
    // (il perché in lib/carrello-sul-server.ts). Solo con ordini nuovi: un avviso ripetuto non ritocca.
    await togliIlPagatoDalCarrelloSalvato(admin, buyerId, groups.flatMap((g) => g.items));
  }
  const daAvvisare = await suonaLaCampanellaAiNegozi(admin, createdOrderIds, pendingCheckoutId);
  const nuovi = createdOrderIds.filter((c) => daAvvisare.has(c.orderId));

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
          // R163 — la chiave usata dal browser per `checkout_started`, se c'e'.
          checkoutId: groups[0]?.chiaveCheckout ?? pendingCheckoutId,
          // 30/8/2026 (R166) — L'id del browser per Google, rimesso dentro le
          // etichette dalla rotta del checkout: qui i cookie non arrivano.
          gaClientId: clientIdGaValido(session.metadata?.ga_client_id),
          // La variante e' la stessa per tutto il carrello: si legge dal primo
          // gruppo, dove il checkout l'ha scritta.
          varianti: groups[0]?.esperimenti ?? {},
        }),
      ),
    );
  }, 'misura acquisto');

  // 30/8/2026 (R005) — Un intoppo sul primo negozio non zittisce gli altri: il
  // ciclo stava sotto un solo `.catch()`. Il riparo per invio: `provaAMandare`.
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
          deliverySlot: fasciaDellOrdine, pickupInStore, paymentMethod: 'card', // R28-010: quando arriva e come si è pagato
        });
        await provaAMandare('conferma al cliente', { orderId: created.orderId }, () =>
          sendEmail({ to: buyerEmail, subject: t.subject, html: t.html, text: t.text, rimandaA: buyerEmail.toLowerCase() === session.customer_email?.toLowerCase() ? buyerId : null })); // R03-002: in coda solo all'indirizzo dell'account (customer_email = user.email al checkout)
      }

      // Anche la lettura dell'indirizzo del negozio sta nel riparo: e' una
      // chiamata di rete, e se va storta prima portava via con se' gli ordini
      // rimasti.
      await provaAMandare('avviso al negozio', { orderId: created.orderId, sellerId: created.sellerId }, async () => {
        const { data: sellerAuth } = await admin.auth.admin.getUserById(created.sellerId);
        const sellerEmail = sellerAuth?.user?.email;
        if (!sellerEmail) return;
        // 30/10/2026 (ondata 24) — Gli orari del negozio, per dire nell'email l'ultimo ritiro e non
        // la fine della fascia. Se la lettura cade l'email parte lo stesso, con la fine della fascia.
        let orari: unknown;
        try {
          const { data: negozio } = await admin
            .from('profiles')
            .select('store_hours')
            .eq('id', created.sellerId)
            .maybeSingle();
          orari = (negozio as { store_hours?: unknown } | null)?.store_hours;
        } catch (e) {
          logger.warn('[webhook] orari del negozio non letti per l email «Nuovo ordine»', { orderId: created.orderId, e });
        }
        const t = newOrderSellerTemplate({
          sellerName: null,
          orderId: created.orderId,
          total: created.totalCents / 100,
          itemsCount: created.itemsCount,
          // 30/10/2026 — La fascia e la nascita dell'ordine (nato adesso, in questo webhook): senza,
          // l'email diceva sempre «appena puoi» invece della scadenza vera.
          deliverySlot: fasciaDellOrdine,
          createdAt: new Date(),
          storeHours: orari,
        });
        return sendEmail({ to: sellerEmail, subject: t.subject, html: t.html, text: t.text, rimandaA: created.sellerId }); // R03-002: se non parte, la coda la rimanda
      });
    }
  }, 'avvisi post-ordine');

  // COMPLETED per ultima (R81): se non passa Stripe riprova, gli ordini ci sono (23505) e nessun avviso riparte.
  scritturaObbligatoria(await admin
    .from('pending_checkouts')
    .update({
      status: 'COMPLETED',
      stripe_payment_intent: paymentIntent,
      processed_at: new Date().toISOString(),
    })
    .eq('id', pendingCheckoutId), 'carrello segnato come completato');
}

// Il carrello scaduto ha il suo file (R81, 15/10/2026): questo era a una riga
// dal tetto delle 600, e la riparazione di R81 ne aggiungeva. Si riesporta da
// qui perché la rotta e le prove lo cercano qui.
export { handleCheckoutExpired } from './carrello-scaduto';
