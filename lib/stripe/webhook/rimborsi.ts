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
import { reverseOrderTransfer, reverseRiderTransfer, type ReversibleOrder } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { logger } from '@/lib/logger';
import { conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';
import { refundIssuedTemplate } from '@/lib/email/templates';
import { notifyAdmins } from './comune';
import { avvisaSeLaPostaNonParte } from './posta-non-partita';
import { formatPriceFromCents } from '@/lib/format';
import { PAUSA_RIMBORSO_DA_DIVIDERE, registraRimborsoParzialeDaFuori } from './rimborsi-da-fuori';
import { elencoDaScrivere, rimborsiGiaScritti } from '@/lib/stripe/elenco-dei-rimborsi';
import { spegniLaSponsorizzazioneDelPagamento } from './sponsorizzati';

// Il rimborso che la banca del cliente respinge dopo: sta in un file suo, `rimborsi.ts` era al tetto di
// righe di tests/unit/webhook-diviso-per-mestiere.test.ts. Chi lo importa da qui lo trova come prima.
export { handleRefundUpdated } from './rimborso-respinto-dalla-banca';

export async function handleChargeRefunded(charge: Stripe.Charge) {
  const admin = getAdminSupabase();
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!pi) return;

  // 26/11/2026 — IL CARRELLO DI QUESTO PAGAMENTO È ANCORA APERTO E NESSUN ORDINE È NATO: l'avviso del pagamento
  // non è passato e l'ordine può nascere fra un attimo. Uscire bene qui (buono, sponsorizzazione) lasciava nascere
  // l'ordine PAID su una carta già rimborsata. Si fa ripetere a Stripe: al giro dopo l'avviso del pagamento avrà
  // visto la carta tornata e chiuso il carrello (ordini.ts), o l'ordine sarà nato e qui si annulla. Il carrello si
  // legge PRIMA degli ordini: COMPLETED si scrive solo quando sono nati tutti. Con ordini già nati si lavora subito:
  // un carrello nato a metà può restare aperto per sempre (expire-checkouts lo lascia a mano).
  const carrello = charge.metadata?.pending_checkout_id ?? (charge.transfer_group?.startsWith('mc_') ? charge.transfer_group.slice(3) : null);
  let carrelloAperto = false;
  if (carrello) {
    const { data: delCarrello, error: errCarrello } = await admin.from('pending_checkouts').select('status').eq('id', carrello).maybeSingle();
    if (errCarrello) throw new Error(`[stripe] carrello del rimborso non letto: ${errCarrello.message}`);
    carrelloAperto = (delCarrello as { status?: string } | null)?.status === 'PENDING';
  }

  // Multi-seller: una charge può avere N ordini (uno per seller).
  const { data: orders, error: errOrdini } = await admin
    .from('orders')
    // 054 — serve `delivery_status`: un ordine già consegnato non torna «annullato».
    // 061 — serve `rider_payout_reversed_cents` per il residuo dello storno rider.
    // 6/9/2026 — serve `coupon_code`: il rimborso fatto a mano su Stripe bruciava il buono del cliente.
    // R85 — serve `refunded_amount_cents`: dice quanto del rimborso è già scritto da noi.
    // 16/10 — serve `stripe_refund_id`: dice QUALI rimborsi dal cruscotto sono già scritti (rimborsi-da-fuori.ts).
    // 16/10 (riesame) — serve `internal_dispute_status`: con una divisione in corso un rimborso già
    // scritto su un ordine del carrello conta ancora, a divisione finita no (rimborsi-da-fuori.ts).
    // 16/10 (settimo riesame) — serve `reversal_error`: dice se uno storno chiesto non è mai stato confermato.
    .select('id, user_id, total_price, refunded_amount_cents, stripe_refund_id, internal_dispute_status, seller_id, payout_status, payment_status, delivery_status, coupon_code, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id, reversal_error, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_fee_cents, shipping_cost')
    .eq('stripe_payment_intent', pi);

  // R81 — Una lettura caduta non è «nessun ordine»: prima il gestore usciva
  // bene, la rotta rispondeva 200, e un rimborso pieno non veniva mai scritto.
  if (errOrdini) throw new Error(`[stripe] ordini del rimborso non letti: ${errOrdini.message}`);
  if (!orders || orders.length === 0) {
    if (carrelloAperto) throw new Error(`[stripe] rimborso su un carrello ancora aperto (${carrello}): l'ordine può ancora nascere, si riprova`);
    // 31/10/2026 (178) — Un pagamento senza ordini puo' essere quello di un
    // buono regalo: rimborsato per intero, il buono si spegne con lui. Su un
    // rimborso parziale non si indovina quanto togliere: lo si dice e basta.
    // Lo spegne il database (`gift_card_void_for_payment`, 178), una volta
    // sola anche se Stripe riconsegna l'evento; 'non_trovato' = nessun buono
    // con quel pagamento (ancora): il database se lo annota e, se il buono
    // nasce dopo, nasce spento. Un errore si rilancia, cosi' Stripe riprova.
    const pieno = charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? 0);
    if (!pieno) {
      logger.warn('[stripe] rimborso parziale su un pagamento senza ordini: nessun annullo automatico del buono', { paymentIntent: pi });
      return;
    }
    const { data: buono, error: errBuono } = await admin.rpc('gift_card_void_for_payment', {
      p_session_id: null,
      p_payment_intent: pi,
      p_reason: 'refunded',
    });
    if (errBuono) throw new Error(`[stripe] buono regalo del rimborso non annullato (${pi}): ${errBuono.message}`);
    if ((buono as { esito?: string } | null)?.esito === 'annullato') {
      logger.warn('[stripe] buono regalo annullato: il suo pagamento è stato rimborsato', { paymentIntent: pi, buono });
      return;
    }
    // R28-016 — o quello di una sponsorizzazione: rimborsata per intero, si chiude (sponsorizzati.ts).
    await spegniLaSponsorizzazioneDelPagamento(pi, 'rimborsata');
    return;
  }

  // Solo i refund PIENI annullano gli ordini a tappeto.
  const fullyRefunded = charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? 0);
  if (!fullyRefunded) {
    // 15/10/2026 (R85) — Un rimborso parziale fatto dal cruscotto Stripe si
    // ignorava con un avviso nei log: il negozio prendeva il bonifico intero e
    // l'annullo dopo chiedeva a Stripe più di quanto restava. Ora si registra
    // sull'ordine (se è uno solo) o ferma i bonifici del carrello (se sono di
    // più). L'eco dei nostri rimborsi (`refundOrder`) non tocca niente: lì
    // l'importo è già scritto. Il perché sta in `rimborsi-da-fuori.ts`.
    await registraRimborsoParzialeDaFuori(charge, orders);
    return;
  }

  // 13/11/2026 (R17-025) — IL BONIFICO AL NEGOZIO E' IN CORSO (PROCESSING): SI ASPETTA, COME PER IL
  // PARZIALE. Lì lo storno (solo TRANSFERRED) non parte, si scriveva REFUNDED e il giro ci scriveva sopra
  // TRANSFERRED col netto al negozio. Si lancia prima di toccare qualunque cosa, Stripe ripete, poi storna.
  const bonificiInCorso = orders.filter((o) => o.payout_status === 'PROCESSING').map((o) => o.id);
  if (bonificiInCorso.length > 0) {
    throw new Error(`[stripe] rimborso pieno con il bonifico al negozio in corso (${bonificiInCorso.join(', ')}): si riprova dopo`);
  }

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

  const idFalliti = stornoFallito.map((f) => f.id);

  /**
   * 22/8/2026 — SEI SCRITTURE SEPARATE PER LA STESSA COSA.
   *
   * Lo stesso ordine veniva aggiornato fino a cinque volte di fila, ogni volta
   * per un campo diverso: prima lo stato del pagamento, poi lo stato della
   * consegna, poi l'importo rimborsato, poi lo stato del versamento, poi
   * l'errore di storno. Nessuna transazione intorno, e nessun rimedio se una
   * delle cinque falliva.
   *
   * Un guasto a metà lasciava l'ordine in uno stato che non esiste: rimborsato
   * ma ancora da versare al negozio, oppure con l'importo rimborsato scritto e
   * il pagamento ancora «pagato». Sono i due stati da cui nascono i soldi
   * pagati due volte.
   *
   * Adesso ogni ordine riceve UNA scrittura sola, con tutti i suoi campi
   * insieme: o passa tutta o non passa niente, e non esiste più il «metà».
   *
   * NON l'ho spostata in una funzione del database, che sarebbe la casa giusta
   * per una transazione vera: significherebbe riscrivere la regola sui soldi in
   * un secondo posto, ed è esattamente il difetto da cui è nato questo lavoro.
   * Quando ci sarà, questa resta una chiamata sola da sostituire.
   */
  const adesso = new Date().toISOString();
  for (const o of orders) {
    const patch: Record<string, unknown> = {
      payment_status: 'REFUNDED',
      // 16/10 (riesame) — Il rimborso si AGGIUNGE all'elenco dei rimborsi già
      // scritti (lib/stripe/elenco-dei-rimborsi.ts): sostituirlo cancellava la
      // memoria dei rimborsi dal cruscotto registrati prima.
      stripe_refund_id: refundId ? elencoDaScrivere(rimborsiGiaScritti(o), [refundId]) : (o.stripe_refund_id ?? null),
      // Il rimborso pieno vale il totale dell'ordine.
      refunded_amount_cents: Math.round(Number(o.total_price) * 100),
    };

    // 16/10 (terzo riesame) — Rimborsato tutto, non c'è più niente da dividere:
    // la pausa messa da un rimborso parziale dal cruscotto (rimborsi-da-fuori.ts)
    // se ne va con la stessa scrittura. Prima restava, e il pannello mostrava un
    // carrello con «Rimborso da dividere: 0,00 €». Solo la pausa: l'esito di un
    // reclamo sulla stessa colonna resta com'è.
    if (o.internal_dispute_status === PAUSA_RIMBORSO_DA_DIVIDERE) patch.internal_dispute_status = null;

    // 054 — Un ordine già CONSEGNATO non diventa «annullato» perché è stato
    // rimborsato: la consegna c'è stata. Prima si riscriveva lo stato di tutti,
    // e sparivano dalle liste operative consegne realmente effettuate.
    if (o.delivery_status !== 'DELIVERED') {
      patch.delivery_status = 'CANCELED';
      patch.canceled_at = adesso;
    }

    // payout_status: i pagati sono già 'REVERSED' dallo storno; gli altri
    // 'REFUNDED'; quelli il cui storno è fallito vanno segnati come tali,
    // perché sono soldi che restano al negozio e vanno recuperati a mano.
    const fallito = stornoFallito.find((f) => f.id === o.id);
    if (fallito) {
      patch.payout_status = 'REVERSAL_FAILED';
      patch.reversal_error = fallito.motivo.slice(0, 500);
    } else if (!reversedIds.includes(o.id) && o.payout_status !== 'REVERSAL_FAILED') {
      // 13/11/2026 (R17-024) — REVERSAL_FAILED resta: è il segno «da recuperare a mano» (avviso qui sotto).
      patch.payout_status = 'REFUNDED';
    }

    /**
     * 27/8/2026 (R038) — UNO STATO SCONOSCIUTO NON PUO' FAR CADERE TUTTA LA RIGA.
     *
     * 'REVERSAL_FAILED' era sparito dall'elenco ammesso dal database: la
     * migrazione 119 ce l'aveva, la 124 — che ha ricreato lo stesso vincolo per
     * aggiungerne un altro — l'ha perso per strada. E siccome quello stato
     * viaggia nella STESSA scrittura di payment_status, dell'importo rimborsato
     * e dello stato della consegna, Postgres rifiutava la riga INTERA: nel caso
     * peggiore — cliente rimborsato, soldi rimasti al negozio — nel database non
     * veniva registrato niente, e l'ordine restava «pagato e da pagare».
     *
     * La migrazione 130 rimette lo stato nell'elenco. Questo e' l'altro lato: se
     * il vincolo su quel database non fosse ancora aggiornato, cade solo il
     * promemoria dello storno mancato — che resta comunque nell'avviso agli
     * amministratori qui sotto — e non tutto il resto del rimborso.
     */
    const { error: errPatch } = await conRipiegoSchema(
      'orders.update (rimborso arrivato da Stripe)',
      () => admin.from('orders').update(patch).eq('id', o.id),
      () => admin.from('orders').update(senzaCampi(patch, ['payout_status', 'reversal_error'])).eq('id', o.id),
    );
    if (errPatch) {
      logger.error(errPatch, { context: 'stripe-refund-patch', orderId: o.id });
      await notifyAdmins(
        '⚠️ Rimborso registrato a metà',
        `Il rimborso ${refundId} è uscito da Stripe ma l'ordine ${o.id} non è stato aggiornato: va sistemato a mano prima che qualcuno lo veda come ancora da pagare.`,
        '/admin/orders',
      );
    }
  }
  // 13/11/2026 (R17-025) — Il giro può aver pagato un ordine letto HELD mentre questo avviso lavorava: la
  // scrittura qui sopra (solo per id) gli ha messo REFUNDED sopra TRANSFERRED. Si rilegge e lo si storna; lo storno mancato va fra quelli a mano.
  const idDaFare = new Set(
    orders.filter((o) => !o.stripe_transfer_id && (o.payout_status === 'HELD' || o.payout_status === 'PENDING_SELLER_ONBOARDING')).map((o) => o.id as string),
  );
  if (idDaFare.size > 0) {
    const { data: dopo } = await admin
      .from('orders')
      .select('id, payout_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id')
      .eq('stripe_payment_intent', pi);
    for (const r of (dopo ?? []) as unknown as ReversibleOrder[]) {
      if (!idDaFare.has(r.id) || r.payout_status !== 'REFUNDED' || !r.stripe_transfer_id) continue;
      try {
        await reverseOrderTransfer({ ...r, payout_status: 'TRANSFERRED' });
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'errore sconosciuto';
        logger.error('[stripe] bonifico pagato durante il rimborso pieno: storno non riuscito', { orderId: r.id, e });
        stornoFallito.push({ id: r.id, motivo });
        idFalliti.push(r.id);
        const { error: errSegno } = await admin
          .from('orders')
          .update({ payout_status: 'REVERSAL_FAILED', reversal_error: motivo.slice(0, 500) })
          .eq('id', r.id);
        if (errSegno) logger.error('[stripe] storno mancato non segnato sull ordine', { orderId: r.id, message: errSegno.message });
      }
    }
  }

  // 13/11/2026 (R17-024) — REVERSAL_FAILED resta (esclusione qui sopra); agli admin la cifra da riprendere.
  for (const o of orders) {
    if (o.payout_status !== 'REVERSAL_FAILED' || o.payment_status === 'REFUNDED') continue;
    const daRiprendere = Math.max(0, Number(o.seller_payout_cents ?? 0) - Number(o.seller_payout_reversed_cents ?? 0));
    if (daRiprendere <= 0) continue;
    await notifyAdmins(
      '⚠️ Quota del negozio da recuperare a mano',
      `L'ordine ${o.id} è stato rimborsato per intero dal cruscotto Stripe. Il bonifico al negozio era già partito e uno storno ` +
        `precedente non è riuscito: al negozio vanno ripresi in tutto ${formatPriceFromCents(daRiprendere)} (il netto meno quanto è ` +
        "già rientrato). Prima di stornarli a mano, guarda su Stripe (Connect → il bonifico → Storni) quanto è già rientrato.",
      '/admin/orders',
      { unaVoltaPer: `quota-a-mano:${o.id}:${refundId ?? charge.id}` },
    );
  }

  if (stornoFallito.length > 0) {
    await notifyAdmins(
      '⚠️ Storno al venditore non riuscito',
      `Rimborso eseguito ma i soldi non risultano rientrati dal venditore su ${stornoFallito.length} ordine/i: ${idFalliti.map((i) => i.slice(0, 8)).join(', ')}. ` +
        "Prima di recuperarli a mano, guarda su Stripe (Connect → il bonifico dell'ordine → Storni): la risposta di Stripe può essersi persa e lo storno può esserci già. Se c'è, non va rifatto.",
      '/admin/orders',
    );
  }

  // Ripristina lo stock solo se refundOrder non l'ha già fatto (evita doppio restore).
  //
  // 15/10/2026 (R81) — L'esito non lo leggeva nessuno. Far riprovare Stripe non
  // servirebbe: l'ordine qui sopra è già 'REFUNDED', e al secondo passaggio
  // questo giro lo salta. Quindi la merce non tornata in vendita si dice agli
  // amministratori, come fa la contestazione persa (dispute.ts).
  const scaffaleNonRiuscito: string[] = [];
  for (const o of orders) {
    if (o.payment_status === 'REFUNDED') continue;
    // 5/11/2026 — Un ordine gia' consegnato: la merce ce l'ha il cliente in casa,
    // non torna in vendita (come la contestazione persa, dispute.ts).
    if (o.delivery_status === 'DELIVERED') continue;
    const { error: errScaffale } = await admin.rpc('restore_stock_for_order', { p_order_id: o.id });
    if (errScaffale) {
      logger.error('[stripe] merce non rimessa a scaffale dopo il rimborso dal cruscotto', { orderId: o.id, message: errScaffale.message });
      scaffaleNonRiuscito.push(o.id);
    }
  }
  if (scaffaleNonRiuscito.length > 0) {
    await notifyAdmins(
      '⚠️ Merce non rimessa in vendita',
      `Rimborso pieno registrato, ma la merce di ${scaffaleNonRiuscito.length} ordine/i (${scaffaleNonRiuscito.map((i) => i.slice(0, 8)).join(', ')}) non è tornata in vendita: la giacenza va sistemata a mano.`,
      '/admin/orders',
    );
  }

  /**
   * 6/9/2026 — E IL CODICE SCONTO TORNA AL CLIENTE, COME PER LE ALTRE STRADE.
   *
   * Il codice si consuma prima di creare l'ordine (`claim_coupon`) e si
   * restituisce quando l'ordine se ne va. La restituzione era stata aggiunta
   * porta per porta — annullo del cliente, rifiuto del negozio, carrello
   * scaduto (R121) — e questa porta era rimasta fuori: chi veniva rimborsato a
   * mano dall'amministrazione perdeva il buono senza aver comprato niente, e
   * lo scopriva premendo «Applica» mentre riprovava a ordinare.
   *
   * DUE COSE LA RENDONO SICURA, e sono la parte difficile:
   *
   * ① `payment_status === 'REFUNDED'` vuol dire che il rimborso l'abbiamo
   *    fatto noi (`refundOrder`), e allora il codice è già stato restituito
   *    da `annullaERimborsa`. Questo evento è solo l'eco di Stripe: se
   *    restituissimo di nuovo, toglieremmo un uso VERO — su un buono con
   *    tetto 2 usato da due ordini il contatore torna a 0 e il buono accetta
   *    altri due sconti che nessuno ha deciso di regalare. È lo stesso
   *    segnale con cui, due righe sopra, si evita di rimettere a scaffale
   *    merce già rimessa.
   * ② Un carrello da due negozi sono due ordini con lo stesso codice, e qui
   *    se ne vanno insieme: si restituisce una volta sola per codice.
   *
   * La chiave per ordine (`p_order_id`) è la cintura: la funzione del
   * database scala l'uso solo se `orders.coupon_released_at` è ancora vuoto.
   * La colonna e la firma nascono con la migrazione 200 (5/11/2026, da
   * applicare a mano). Finché non è applicata si ripiega sulla firma vecchia,
   * ma SOLO su PGRST202 («funzione inesistente»), che è un errore di forma e
   * non può aver scritto niente — su un errore di rete riprovare scalerebbe
   * due volte (stessa regola di lib/ordini/annulla.ts).
   */
  const daRestituire = new Map<string, string>();
  for (const o of orders) {
    if (o.payment_status === 'REFUNDED') continue;
    const codice = o.coupon_code?.trim();
    if (codice && !daRestituire.has(codice)) daRestituire.set(codice, o.id);
  }
  for (const [codice, orderId] of daRestituire) {
    try {
      const { error: cErr } = await admin.rpc('release_coupon', { p_code: codice, p_order_id: orderId });
      if (!cErr) continue;
      if ((cErr as { code?: string }).code !== 'PGRST202') {
        logger.warn('[stripe] codice sconto non restituito dopo il rimborso', { orderId, err: cErr.message });
        continue;
      }
      const { error: senzaChiave } = await admin.rpc('release_coupon', { p_code: codice });
      if (senzaChiave) {
        logger.warn('[stripe] codice sconto non restituito dopo il rimborso', { orderId, err: senzaChiave.message });
      }
    } catch (err) {
      logger.warn('[stripe] codice sconto non restituito dopo il rimborso', { orderId, err });
    }
  }

  // Email buyer (una sola email anche se sono N ordini — è la stessa charge)
  //
  // 5/11/2026 — SOLO PER QUELLO CHE NON ABBIAMO GIA' DETTO NOI.
  // `refundOrder` manda gia' «Rimborso emesso» per i rimborsi fatti dal sito:
  // qui il cliente ne riceveva un secondo, identico. Se tutti gli ordini della
  // carica erano gia' REFUNDED questo evento e' solo l'eco: niente email. Se no
  // (un rimborso dal cruscotto) l'email dice la parte non ancora scritta da noi.
  const giaScrittoCents = orders.reduce((somma, o) => somma + Number(o.refunded_amount_cents ?? 0), 0);
  const nonScrittoCents = Math.max(0, (charge.amount_refunded ?? 0) - giaScrittoCents);
  const eco = orders.every((o) => o.payment_status === 'REFUNDED') || nonScrittoCents === 0;
  const firstOrder = orders.find((o) => o.payment_status !== 'REFUNDED') ?? orders[0];
  const { data: ua } = eco ? { data: null } : await admin.auth.admin.getUserById(firstOrder.user_id);
  const buyerEmail = ua?.user?.email;
  if (buyerEmail) {
    const t = refundIssuedTemplate({
      orderId: firstOrder.id,
      amount: nonScrittoCents / 100,
      reason: refundReason,
    });
    // R03-003 — un rifiuto della posta non lancia: si legge l'esito.
    // R03-002 — L'indirizzo è quello dell'account (getUserById qui sopra): se Resend rifiuta, la coda la rimanda a lui.
    await avvisaSeLaPostaNonParte('email di rimborso al cliente', { orderId: firstOrder.id },
      await sendEmail({ to: buyerEmail, subject: t.subject, html: t.html, text: t.text, rimandaA: firstOrder.user_id }));
  }
}
