import type Stripe from 'stripe';
import { getStripe } from './client';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { refundIssuedTemplate } from '@/lib/email/templates';
import { COLONNE_124, conRipiegoSchema, senzaCampi, senzaColonne } from '@/lib/db/migrazione-124';
import { compensoDalContante } from '@/lib/shipping';
import { formatPriceFromCents } from '@/lib/format';
// La merce che torna a scaffale ha una casa sola: la decisione è pura e
// verificabile, qui si usa e basta (lib/ordini/rimessa-a-scaffale.ts).
import { rimettiLaMerceAScaffale } from '@/lib/ordini/rimessa-a-scaffale';
// R043 — l'avviso agli amministratori e' lo stesso che usa il webhook dei
// rimborsi: una casa sola, cosi' i due percorsi non divergono.
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
// R71 · R76 · R84 — quanto si restituisce, in che modo, e cosa e' «pieno»:
// una regola sola, pura, che le prove eseguono (lib/rimborsi/).
import {
  lordoDellOrdine,
  motivoNienteDaRestituire,
  quantoSiPuoRestituire,
  ripartoDelRimborso,
  tipoDiPagamento,
  type ModoDelRimborso,
  type RipartoDelRimborso,
} from '@/lib/rimborsi/regole-del-rimborso';
import { PAGINA_DEI_BONIFICI_DA_FARE, type ComeTornanoIContanti } from '@/lib/rimborsi/scelta-del-reso';
import { segnoDelBonifico } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * Logica condivisa di payout / reversal / refund per il modello SCT
 * (Separate Charges & Transfers).
 *
 * Casa unica usata da:
 *  - app/api/stripe/payout/route.ts        → releaseOrderPayout (trigger manuale/admin)
 *  - app/api/cron/release-payouts/route.ts → releaseOrderPayout (il giro che
 *    paga un'ora dopo la consegna: le ore stanno in lib/stripe/tempi-bonifico.ts.
 *    R051 — qui c'era scritto «+3gg», e non era vero)
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
export async function applyConnectAccountStatus(acct: Stripe.Account): Promise<{ error: unknown }> {
  const admin = getAdminSupabase();
  // R81 — l'esito torna a chi chiama: il webhook `account.updated` deve poter
  // far riprovare Stripe se la scrittura non passa.
  return admin
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
  // 046 — serve anche quanto è già stato addebitato al venditore: il payout
  // deve versare il residuo, non il netto pieno.
  // Il ripiego copre la finestra fra l'unione del codice e la firma sulla
  // migrazione 124: senza, una `select` che nomina una colonna inesistente
  // fallisce e nessun pagamento partirebbe (lib/db/migrazione-124.ts).
  const COLONNE_PAYOUT = 'id, seller_id, payout_status, seller_payout_cents, seller_payout_reversed_cents, payout_tentativo, stripe_charge_id, stripe_transfer_group, delivery_status';
  const { data: order, error } = await conRipiegoSchema(
    'orders.select (payout venditore)',
    () => admin.from('orders').select(COLONNE_PAYOUT).eq('id', orderId).single(),
    () => admin.from('orders').select(senzaColonne(COLONNE_PAYOUT, COLONNE_124)).eq('id', orderId).single(),
  );

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
  //
  // 22/8/2026 — IL TURNO SI DATA, ALTRIMENTI NON SI PUO' RIPRENDERE.
  // Senza `payout_claimed_at` un processo morto fra il turno e la fine lasciava
  // l'ordine in PROCESSING per sempre: i candidati del giro dopo sono solo HELD
  // e PENDING_SELLER_ONBOARDING, quindi nessuno lo ripescava piu'. Restava solo
  // un avviso che segnalava e non riparava.
  // Il turno resta stretto — solo da HELD/PENDING si passa a PROCESSING, come
  // prima — perche' e' quello che impedisce il doppio bonifico. Cambia solo che
  // adesso il turno porta la sua ora: i turni appesi li rimette in coda il giro
  // (app/api/cron/release-payouts), che e' l'unico posto dove si puo' decidere
  // che «vecchio» vuol dire «chi l'aveva preso e' morto».
  const valoriTurno = { payout_status: 'PROCESSING', payout_claimed_at: new Date().toISOString() };
  const { data: claimed, error: claimErr } = await conRipiegoSchema(
    'orders.update (turno del bonifico)',
    () =>
      admin
        .from('orders')
        .update(valoriTurno)
        .eq('id', order.id)
        .in('payout_status', ['HELD', 'PENDING_SELLER_ONBOARDING'])
        .select('id'),
    () =>
      admin
        .from('orders')
        .update(senzaCampi(valoriTurno, ['payout_claimed_at']))
        .eq('id', order.id)
        .in('payout_status', ['HELD', 'PENDING_SELLER_ONBOARDING'])
        .select('id'),
  );
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

    const tentativo = (order as { payout_tentativo?: number }).payout_tentativo ?? 0;

    /**
     * 27/8/2026 (R050) — SE LA CHIAVE CAMBIA, LA PROTEZIONE VA RIMESSA A MANO.
     *
     * Mettere l'importo nella chiave sblocca l'ordine che rimbalzava
     * all'infinito, ma toglie anche la rete che Stripe tendeva da sola: con una
     * chiave nuova, un bonifico che era PASSATO davvero e la cui risposta si e'
     * persa per strada verrebbe rifatto. Sono soldi che escono due volte.
     *
     * L'importo puo' cambiare solo quando al negozio e' gia' stata addebitata
     * una quota, quindi il controllo serve solo in quel caso: si guarda se per
     * QUESTO tentativo un bonifico esiste gia' e, se c'e', lo si registra
     * invece di farne un altro. Il numero del tentativo sta nell'etichetta del
     * bonifico apposta: dopo una contestazione vinta quel numero sale, e il
     * bonifico vecchio — che era stato stornato — non viene scambiato per
     * quello nuovo.
     */
    if ((order.seller_payout_reversed_cents ?? 0) > 0) {
      const gruppo = order.stripe_transfer_group ?? `order_${order.id}`;
      try {
        const esistenti = await stripe.transfers.list({ transfer_group: gruppo, limit: 100 });
        const giaFatto = (esistenti.data ?? []).find(
          (t) =>
            t.metadata?.order_id === order.id &&
            t.metadata?.kind !== 'rider_fee' &&
            (t.metadata?.tentativo ?? '0') === String(tentativo),
        );
        if (giaFatto) {
          logger.warn('[stripe] bonifico al negozio gia esistente: registrato invece di rifarlo', {
            orderId: order.id, transferId: giaFatto.id,
          });
          const { error: errGia } = await admin
            .from('orders')
            .update({ stripe_transfer_id: giaFatto.id, payout_status: 'TRANSFERRED', payout_at: new Date().toISOString() })
            .eq('id', order.id);
          if (errGia) logger.error('[stripe] bonifico ritrovato ma stato non aggiornato', errGia);
          return { ok: true, transferId: giaFatto.id };
        }
      } catch (e) {
        // Se l'elenco non risponde si tira dritto: la chiave di idempotenza
        // copre comunque il ritentativo con lo stesso importo.
        logger.warn('[stripe] elenco bonifici non consultabile prima del versamento', { orderId: order.id, e });
      }
    }

    const transfer = await stripe.transfers.create(
      {
        amount: daVersare,
        currency: 'eur',
        destination: seller.stripe_account_id,
        ...(order.stripe_charge_id ? { source_transaction: order.stripe_charge_id } : {}),
        transfer_group: order.stripe_transfer_group ?? `order_${order.id}`,
        // Il tentativo nell'etichetta: e' cosi' che il controllo qui sopra
        // distingue un bonifico di adesso da uno vecchio gia' stornato.
        metadata: { order_id: order.id, seller_id: order.seller_id, tentativo: String(tentativo) },
      },
      // Idempotency-Key: anche se DB/processo falliscono e si ritenta, Stripe
      // restituisce lo stesso transfer e NON ne crea un secondo.
      //
      // 158 — Il numero del tentativo fa parte della chiave. Senza, dopo una
      // contestazione VINTA il bonifico non ripartiva: era gia' stato stornato
      // e Stripe, con la stessa chiave, restituiva quello vecchio. Il negozio
      // vinceva la causa e non veniva pagato lo stesso.
      //
      // R050 — E l'importo entra nella chiave insieme al tentativo. Il numero
      // versato e' il RESIDUO del netto, e cala ogni volta che un rimborso
      // parziale ne mette una parte a carico del negozio: con la chiave vecchia
      // un ordine gia' fallito una volta ritentava con lo stesso nome e un
      // importo diverso, Stripe rifiutava, il giro lo rimetteva in HELD e
      // rimbalzava all'infinito. Il ritentativo con lo STESSO importo tiene la
      // stessa chiave, quindi la protezione dal doppio bonifico resta intera.
      { idempotencyKey: `payout_seller_${order.id}_t${tentativo}_c${daVersare}` },
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
 *
 * 31/8/2026 (R120) — E SERVE ANCHE AI CONTRASSEGNI, MA SENZA IL NULL.
 *
 * Il giro dei bonifici cerca i compensi in contanti rimasti scoperti dal
 * credito con questo elenco (`.in('rider_payout_status', ...)`), non col filtro
 * qui sotto: sulla carta lo stato vuoto vuol dire «mai provato» e va cercato,
 * sul contrassegno vuol dire «il contante bastava, niente da versare». Chi
 * aggiunge uno stato lo aggiunge qui e vale per tutte e due le strade; chi un
 * domani usasse il filtro anche per i contanti si porterebbe dietro il null e
 * riempirebbe il giro di ordini da scartare uno per uno.
 */
export const STATI_RIDER_RITENTABILI = ['HELD', 'PENDING_RIDER_ONBOARDING', 'FAILED'] as const;

/** Filtro PostgREST per i candidati rider (null incluso). */
export const FILTRO_RIDER_RITENTABILI =
  `rider_payout_status.is.null,rider_payout_status.in.(${STATI_RIDER_RITENTABILI.join(',')})`;

export async function releaseRiderPayout(orderId: string): Promise<PayoutResult> {
  const admin = getAdminSupabase();
  const COLONNE_RIDER = 'id, rider_id, shipping_cost, rider_fee_cents, payment_method, delivery_status, rider_payout_status, rider_payout_tentativo, stripe_charge_id, stripe_transfer_group, total_price, pickup_in_store, cash_confirmed_at';
  const { data: order, error } = await conRipiegoSchema(
    'orders.select (compenso fattorino)',
    () => admin.from('orders').select(COLONNE_RIDER).eq('id', orderId).single(),
    () => admin.from('orders').select(senzaColonne(COLONNE_RIDER, COLONNE_124)).eq('id', orderId).single(),
  );

  if (error || !order) return { ok: false, code: 'NOT_FOUND', reason: 'Ordine non trovato' };
  if (order.delivery_status !== 'DELIVERED') return { ok: false, code: 'NOT_DELIVERED', reason: 'Ordine non consegnato' };
  if (!order.rider_id) return { ok: false, code: 'BAD_STATE', reason: 'Nessun rider assegnato' };
  if (order.rider_payout_status === 'TRANSFERRED') return { ok: false, code: 'BAD_STATE', reason: 'Compenso rider già versato' };

  // rider_fee_cents (migrazione 111) è disaccoppiato dallo shipping_cost (prezzo
  // buyer). Fallback a shipping_cost*100 per gli ordini antecedenti alla migrazione.
  const feeCents = order.rider_fee_cents != null
    ? order.rider_fee_cents
    : Math.round(Number(order.shipping_cost ?? 0) * 100);
  if (feeCents <= 0) return { ok: false, code: 'INVALID_AMOUNT', reason: 'Compenso di consegna nullo' };

  /**
   * 155 — Sul contrassegno il compenso il fattorino se l'e' tenuto dal contante
   * al momento della conferma dell'incasso (app/api/rider/cash-confirm):
   * l'atteso della rimessa e' il totale MENO il suo compenso. Quando il contante
   * basta non c'e' nessun bonifico da fare, e qui si esce.
   *
   * 30/8/2026 (R120) — MA IL CONTANTE NON C'E' SEMPRE.
   *
   * Qui si usciva su OGNI ordine in contanti, senza guardare quanto contante
   * avesse davvero in mano. `total_price` e' il totale dopo lo scomputo del
   * credito MyCity: se il credito lo copre, il fattorino consegna, non incassa
   * niente, e da qui non gli arrivava piu' nessun bonifico — mentre l'ordine
   * risultava 'CASH_WITHHELD', cioe' pagato. Adesso si versa il residuo: il
   * compenso meno quello che si e' potuto tenere.
   *
   * Prima pero' il contante va confermato: finche' non lo e', non si sa quanto
   * ha in mano, e versare un residuo calcolato su un ordine mai chiuso vorrebbe
   * dire pagarlo due volte.
   */
  const inContanti = order.payment_method !== 'card';
  if (inContanti && !order.cash_confirmed_at) {
    return { ok: false, code: 'BAD_STATE', reason: 'COD: incasso non ancora confermato dal fattorino' };
  }
  const daVersareCents = inContanti ? compensoDalContante(order).residuoDovutoCents : feeCents;
  if (daVersareCents <= 0) {
    return { ok: false, code: 'BAD_STATE', reason: 'COD: il compenso e gia trattenuto dal contante' };
  }

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
  //
  // 27/8/2026 (R040) — E IL TURNO PORTA L'ORA, COME QUELLO DEL NEGOZIO.
  // Senza, un processo morto fra il turno e la fine lasciava il compenso in
  // PROCESSING per sempre: gli stati ritentabili sono HELD,
  // PENDING_RIDER_ONBOARDING e FAILED, quindi nessun giro lo ripescava piu' e
  // il fattorino restava senza il suo. La colonna esiste dalla migrazione 126;
  // semplicemente non ci scriveva nessuno. Chi decide che «vecchio» vuol dire
  // «chi l'aveva preso e' morto» resta il giro (app/api/cron/release-payouts).
  const valoriTurnoRider = { rider_payout_status: 'PROCESSING', rider_payout_claimed_at: new Date().toISOString() };
  const { data: claimed, error: claimErr } = await conRipiegoSchema(
    'orders.update (turno del compenso fattorino)',
    () =>
      admin
        .from('orders')
        .update(valoriTurnoRider)
        .eq('id', order.id)
        .or(FILTRO_RIDER_RITENTABILI)
        .select('id'),
    () =>
      admin
        .from('orders')
        .update(senzaCampi(valoriTurnoRider, ['rider_payout_claimed_at']))
        .eq('id', order.id)
        .or(FILTRO_RIDER_RITENTABILI)
        .select('id'),
  );
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
        amount: daVersareCents,
        currency: 'eur',
        destination: rider.stripe_account_id,
        ...(order.stripe_charge_id ? { source_transaction: order.stripe_charge_id } : {}),
        transfer_group: order.stripe_transfer_group ?? `order_${order.id}`,
        metadata: { order_id: order.id, rider_id: order.rider_id, kind: 'rider_fee' },
      },
      // 158 — Come per il venditore: il numero del tentativo entra nella chiave.
      // R050 — E l'importo con lui: un compenso ricalcolato non deve trovare la
      // porta chiusa dalla chiave del tentativo precedente.
      { idempotencyKey: `payout_rider_${order.id}_t${(order as { rider_payout_tentativo?: number }).rider_payout_tentativo ?? 0}_c${daVersareCents}` },
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
    // 156 — Il ritorno a 'HELD' veniva rifiutato dal database, che quello stato
    // non lo prevedeva (vincolo della 119), e l'errore non lo guardava nessuno:
    // il compenso restava in 'PROCESSING', che nessun giro del cron ripesca.
    // Un bonifico fallito una volta non ripartiva mai piu'. La migrazione 124
    // aggiunge lo stato; qui l'errore si vede.
    const { error: errRitorno } = await admin
      .from('orders')
      .update({ rider_payout_status: 'HELD' })
      .eq('id', order.id);
    if (errRitorno) {
      logger.error('[stripe] compenso fattorino bloccato in PROCESSING', {
        orderId: order.id, message: errRitorno.message,
      });
    }
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
  /**
   * 3/9/2026 — ANNULLARE L'ORDINE E RESTITUIRE TUTTO SONO DUE COSE DIVERSE.
   *
   * Fin qui erano la stessa cosa: solo un rimborso PIENO annullava la consegna
   * e rimetteva la merce a scaffale. Va bene finché le due cose coincidono, ma
   * non coincidono sempre. Il caso vero è «cliente assente»: il fattorino è
   * andato, ha suonato, non ha trovato nessuno. La merce torna al negozio — e
   * quindi va rimessa a magazzino — ma al cliente si restituisce l'ordine AL
   * NETTO della consegna, perché quel viaggio è stato fatto davvero e il
   * fattorino va pagato. Chiedere l'annullo passando meno soldi non
   * funzionava: essendo il rimborso parziale, la merce restava «venduta» e
   * l'ordine restava aperto.
   *
   * Con questo, chi decide dichiara la cosa che sa: «questo ordine è chiuso,
   * la merce è tornata». L'importo resta l'importo.
   *
   * COSA NON DECIDE: il compenso del fattorino non si recupera (il viaggio c'è
   * stato) e lo stato del bonifico al negozio NON viene toccato — dal negozio
   * si è già ripresa la quota proporzionale al rimborso, e se al netto gli
   * resta qualcosa quella resta una decisione di chi governa il caso, non di
   * questa funzione.
   *
   * ⚠️ 8/9/2026 — PRIMA DI COLLEGARE QUESTA BANDIERA A UNA ROTTA VERA, LA
   * MIGRAZIONE 160 DEVE ESSERE APPLICATA.
   * Chiudere l'ordine rimette la merce a scaffale, e `restore_stock_for_order`
   * è una somma senza segno di «già fatto». Finché a chiudere era solo il
   * rimborso pieno la seconda somma era impossibile per costruzione; con
   * l'annullo dichiarato no: 25,00 su 30,00 chiudono l'ordine, e i 5,00 che
   * restano possono uscire dopo. La difesa nel codice
   * (`lib/ordini/rimessa-a-scaffale.ts`) copre gli ordini che l'annullo segna
   * `CANCELED` — cioè il caso per cui la bandiera è nata, il fattorino per
   * strada. NON copre un ordine già `DELIVERED` né uno in contanti: lì la
   * traccia non viene scritta apposta (difetto 054 e riconciliazione del
   * contante), e il segno lo mette solo il database con la 160.
   */
  annullaLOrdine?: boolean;
  /**
   * R71 — ORDINI IN CONTANTI: COME TORNANO I SOLDI.
   *
   * Il credito MyCity arriva solo se il cliente l'ha scelto (`{ modo:
   * 'CREDITO' }`). Senza questo campo, o con `BONIFICO`, il rimborso si registra
   * come bonifico da fare a mano, e chi paga riceve l'avviso. Sugli ordini con
   * carta non conta: i soldi tornano sulla carta.
   */
  contanti?: ComeTornanoIContanti;
}

/** Quello che `refundOrder` restituisce a chi lo chiama. */
export interface EsitoRimborso {
  /** Id del rimborso Stripe, oppure `wallet:<chiave>` / `bonifico:<centesimi>:<chiave>` per i contanti. */
  refundId: string;
  /** Quota ripresa al negozio da questa chiamata, in centesimi. */
  reversedCents: number;
  /**
   * R76 — IL VERDETTO DI CHI HA MOSSO I SOLDI: il cliente ha riavuto l'intero
   * lordo dell'ordine. Chi deve decidere «integrale o no» usa questo, non un
   * secondo conto fatto su un'altra base.
   */
  pieno: boolean;
  /** R71 · R25 — come sono tornati i soldi. */
  modo: ModoDelRimborso;
  /** Quanto e' tornato davvero, in centesimi: puo' essere meno di quanto chiesto. */
  importoCents: number;
  /** Di cui accreditato come credito MyCity (ordini in contanti). */
  creditoCents: number;
  /** Di cui da pagare col bonifico, a mano (ordini in contanti). */
  bonificoCents: number;
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
/**
 * Email best-effort di rimborso al buyer (riusata dal path carta e da quello COD).
 *
 * R25 — L'email dice il modo vero: carta, credito o bonifico. Prima diceva a
 * tutti «arriverà sul tuo metodo di pagamento entro 5-10 giorni», anche a chi
 * aveva gia' il credito in tasca.
 */
async function notifyRefundBuyer(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  orderId: string,
  amountCents: number,
  opts: RefundOrderOpts,
  riparto: RipartoDelRimborso,
): Promise<void> {
  if (!opts.notifyBuyer) return;
  try {
    const { data: ua } = await admin.auth.admin.getUserById(userId);
    const buyerEmail = ua?.user?.email;
    if (buyerEmail) {
      const t = refundIssuedTemplate({
        orderId,
        amount: amountCents / 100,
        reason: opts.reason ?? null,
        modo: riparto.modo,
        creditoEuro: riparto.creditoCents / 100,
        bonificoEuro: riparto.bonificoCents / 100,
        creditoScelto: riparto.creditoScelto,
        ibanFinale: opts.contanti?.modo === 'BONIFICO' ? opts.contanti.ibanFinale ?? null : null,
      });
      await sendEmail({ to: buyerEmail, subject: t.subject, html: t.html, text: t.text });
    }
  } catch (e) {
    logger.warn('[refundOrder] invio email buyer fallito', e);
  }
}

/**
 * LA QUOTA DEL NEGOZIO SU UN RIMBORSO ANTICIPATO, PER TUTTI E DUE I MODI DI PAGARE.
 *
 * Quando si rimborsa un ordine il cui bonifico al negozio NON è ancora partito,
 * `reverseOrderTransfer` non ha niente da stornare e risponde zero: giusto, il
 * bonifico non c'è. Ma se ci si ferma lì, al momento del pagamento il negozio
 * riceve il netto pieno, rimborso compreso, e la differenza la mette MyCity.
 *
 * Questa funzione la registra in `seller_payout_reversed_cents`, così il
 * pagamento successivo versa il residuo, che è quello che al negozio spetta
 * davvero.
 *
 * PERCHÉ È UNA FUNZIONE SOLA (21/8/2026). Questo blocco esisteva solo nel ramo
 * dei contanti. Il ramo della carta non aveva niente di equivalente, e non è il
 * caso raro: il bonifico parte un'ora dopo la consegna, mentre resi e reclami
 * arrivano dopo. Ogni reso pagato con carta prima del bonifico era una perdita
 * della piattaforma, in silenzio. Con due copie il difetto poteva nascere una
 * volta sola; con una copia sola non può nascere affatto.
 *
 * @returns i centesimi effettivamente addebitati al negozio da questa chiamata.
 */
async function addebitaQuotaVenditoreSeNonPagato(
  admin: ReturnType<typeof getAdminSupabase>,
  order: { id: string; payout_status?: string | null; seller_payout_cents?: number | null; seller_payout_reversed_cents?: number | null },
  sellerShare: number,
  giaStornato: number,
): Promise<number> {
  if (giaStornato !== 0 || sellerShare <= 0 || order.payout_status === 'TRANSFERRED') return giaStornato;

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
    return giaStornato;
  }
  return nuovoAddebito - giaAddebitato;
}

/**
 * 6/9/2026 — UN RIMBORSO CHE NON PUO' RIUSCIRE NON SI RITENTA.
 *
 * Il giro delle mezz'ore che annulla gli ordini mai accettati chiede il
 * rimborso e, se il rimborso lancia, rimette l'ordine in «nuovo» per riprovare
 * al giro dopo. Ma non tutti gli errori sono uguali: se Stripe non risponde
 * riprovare e' giusto, mentre se sull'ordine non c'e' piu' niente da
 * rimborsare — perche' un reso lo aveva gia' chiuso — riprovare non servira'
 * mai. Quell'ordine rimbalzava fra annullato e nuovo ogni mezz'ora, per
 * sempre, e il negozio continuava a vederselo in lista come da accettare.
 *
 * Da qui in avanti chi sa PERCHE' il rimborso e' fallito lo dice: gli errori
 * senza ritorno portano il marchio `ritentabile = false`. Chi ritenta lo legge
 * e si ferma, invece di indovinare dal testo del messaggio.
 */
export class RimborsoNonRitentabile extends Error {
  /** Marchio letto da chi ritenta: il messaggio si puo' riscrivere, questo no. */
  readonly ritentabile = false;

  constructor(message: string) {
    super(message);
    this.name = 'RimborsoNonRitentabile';
  }
}

/**
 * Collaudo del 15/10 (R82) — UN TENTATIVO PRECEDENTE HA GIA' DATO AL CLIENTE
 * UNA CIFRA DIVERSA DA QUELLA CHIESTA ADESSO.
 *
 * Non si ritenta con la stessa cifra sbagliata: chi decide deve leggere quanto
 * e' gia' uscito, e il messaggio e' scritto per lui. Le rotte lo mostrano
 * com'e' (la decisione sul reso lo nascondeva dietro «riprova»).
 */
export class AccreditoGiaUscitoConAltroImporto extends RimborsoNonRitentabile {
  constructor(
    readonly giaAccreditatoCents: number,
    readonly richiestoCents: number,
  ) {
    super(
      `Un tentativo precedente di questo rimborso ha già accreditato al cliente ${formatPriceFromCents(giaAccreditatoCents)} ` +
        `di credito MyCity, con un importo diverso da quello di adesso (${formatPriceFromCents(richiestoCents)}). ` +
        "Riprova con l'importo del primo tentativo.",
    );
    this.name = 'AccreditoGiaUscitoConAltroImporto';
  }
}

/**
 * 6/9/2026 (stesso giorno, riparazione) — «L'ORDINE NON C'E'» E «NON SONO
 * RIUSCITO A LEGGERLO» NON SONO LA STESSA COSA.
 *
 * La lettura dell'ordine puo' fallire per due motivi opposti. Il primo: la
 * riga non esiste piu', e nessun tentativo futuro la trovera'. Il secondo: il
 * database non ha risposto — timeout, connessione caduta, PostgREST che
 * risponde 503 — e allora fra mezz'ora lo stesso ordine si legge benissimo.
 *
 * Metterli nella stessa condizione (`if (error || !order)`) lo pagava il
 * cliente: aveva pagato con la carta, l'ordine restava annullato, il rimborso
 * portava il marchio «non ritentare mai piu'», e i soldi restavano a noi
 * finche' una persona non leggeva l'avviso nel pannello. Prima lo stesso
 * intoppo rimetteva l'ordine in coda e mezz'ora dopo il rimborso partiva da
 * solo.
 *
 * Qui si riconosce SOLO il primo caso: PostgREST risponde `PGRST116` quando la
 * `single()` non trova nessuna riga. Qualunque altro codice, e qualunque
 * guasto di rete, resta ritentabile. Sui soldi di chi ha pagato l'incertezza
 * si risolve riprovando, non tenendoli.
 */
function eOrdineInesistente(errore: unknown): boolean {
  if (!errore || typeof errore !== 'object') return false;
  const e = errore as { code?: unknown; details?: unknown; message?: unknown };
  if (e.code === 'PGRST116') return true;
  // Un codice diverso da PGRST116 e' un guasto (57014 timeout, 08006
  // connessione persa, 503): si ritenta, non si giudica.
  if (typeof e.code === 'string' && e.code !== '') return false;
  const testo = `${typeof e.message === 'string' ? e.message : ''} ${
    typeof e.details === 'string' ? e.details : ''
  }`.toLowerCase();
  return /no rows|0 rows|not found|nessuna riga/.test(testo);
}

/**
 * Collaudo del 15/10 (R82, la variante con l'importo cambiato) — L'ACCREDITO
 * GIA' FATTO DEVE ESSERE LO STESSO CHE SI STA CHIEDENDO.
 *
 * La chiave dei resi e dei reclami (`return_<id>`, `dispute_<id>`) non porta
 * l'importo. Il primo tentativo accredita 20 € e perde la risposta; la
 * prenotazione torna indietro e il negozio riprova con 15 €. Il portafoglio
 * riconosce la chiave e non accredita di nuovo — giusto — ma la funzione
 * andava avanti e registrava 15 € di rimborso, mentre il cliente ne aveva
 * ricevuti 20: conti dell'ordine e soldi veri divergevano, in silenzio.
 *
 * Qui si guarda la riga a diario di quella chiave. Stesso importo: e' il
 * ritentativo di prima, il rimborso va a termine. Importo diverso: ci si ferma,
 * la prenotazione torna indietro (lo fa chi chiama, nel suo `catch`) e chi
 * decide legge quanto e' gia' uscito. Stripe fa lo stesso con la sua chiave:
 * una richiesta diversa con una chiave gia' usata e' un errore, non un si'.
 */
/** Quanto credito c'e' a diario per questa chiave: `null` se nessuno. Lancia se non si legge. */
async function accreditoADiario(
  admin: ReturnType<typeof getAdminSupabase>,
  chiave: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from('wallet_ledger')
    .select('delta_cents')
    .eq('reason', 'cod_refund')
    .eq('ref', chiave)
    .maybeSingle();
  if (error) {
    // Non si sa quanto e' uscito: si ferma e si riprova, non si registra a occhio.
    throw new Error(`refundOrder COD: accredito gia' fatto non verificabile: ${error.message}`);
  }
  if (!data) return null;
  return Math.round(Number((data as { delta_cents?: unknown }).delta_cents ?? 0));
}

/** Ferma il rimborso se a diario c'e' gia' un accredito di questa chiave con un'altra cifra. */
function controllaLaCifraGiaAccreditata(giaAccreditato: number | null, richiestoCents: number): void {
  if (giaAccreditato == null) return;
  if (giaAccreditato !== richiestoCents) {
    throw new AccreditoGiaUscitoConAltroImporto(giaAccreditato, richiestoCents);
  }
}

/**
 * Collaudo del 15/10, terzo giro (R82) — QUANDO IL CREDITO E' USCITO, UN
 * DIARIO CHE NON SI LEGGE NON RIMETTE TUTTO INDIETRO.
 *
 * Il caso: `wallet_credit` risponde di si' (o 23505, «questa chiave c'e'
 * gia'»), e subito dopo la lettura del diario, che serve solo a controllare
 * la cifra, va in timeout. Prima quell'errore finiva nel `catch` dei soldi:
 * la prenotazione tornava indietro, il negozio leggeva «Il rimborso non e'
 * partito» e poteva rifiutare il reso. La cliente teneva 40 € di credito,
 * l'ordine risultava rimborsato per 0, e i 40 € li perdeva MyCity, senza
 * nessun avviso. Bastava un guasto solo.
 *
 * Adesso, a credito uscito, si va avanti: il rimborso si registra, e chi
 * amministra riceve l'avviso di controllare la cifra a mano. Si ferma solo una
 * cifra letta e diversa (`AccreditoGiaUscitoConAltroImporto`).
 *
 * Restituisce la cifra a diario, `null` se non c'e' riga, e `'illeggibile'`
 * se il diario non ha risposto.
 */
async function laCifraDelCreditoUscito(
  admin: ReturnType<typeof getAdminSupabase>,
  chiave: string,
  orderId: string,
): Promise<number | null | 'illeggibile'> {
  try {
    return await accreditoADiario(admin, chiave);
  } catch (err) {
    logger.error('[refundOrder] credito uscito ma diario illeggibile: il rimborso si registra, la cifra va controllata a mano', {
      orderId, chiave, err,
    });
    return 'illeggibile';
  }
}

/**
 * Collaudo del 15/10, secondo giro (R82) — LA RISPOSTA PERSA ARRIVA ANCHE COME
 * ERRORE.
 *
 * Il caso: il database scrive l'accredito, e a noi arriva un errore di rete
 * («socket hang up»). Prima ci si fidava dell'errore: la prenotazione tornava
 * indietro, il reso tornava «da decidere», e la cliente aveva gia' il credito
 * in tasca. Il negozio, a quel punto, poteva perfino rifiutare il reso: lei
 * teneva 20 € di credito, l'ordine risultava rimborsato per 0 e il negozio
 * teneva la sua quota.
 *
 * Adesso, prima di tornare indietro, si guarda il diario: se la riga di questa
 * chiave c'e', l'accredito e' avvenuto, e il rimborso va in fondo. Se il diario
 * non si legge, si torna indietro come prima: il ritentativo ritrovera' la riga.
 * (Qui l'accredito ha risposto con un errore: senza diario non si sa se il
 * credito e' uscito. E' il guasto doppio, il residuo dichiarato.)
 *
 * Restituisce la cifra a diario, o `null` se non c'e' riga o il diario non si legge.
 */
async function accreditoAvvenutoNonostanteLErrore(
  admin: ReturnType<typeof getAdminSupabase>,
  chiave: string,
): Promise<number | null> {
  try {
    return await accreditoADiario(admin, chiave);
  } catch (err) {
    logger.error('[refundOrder] diario del credito non leggibile dopo un accredito in errore', { chiave, err });
    return null;
  }
}

export async function refundOrder(opts: RefundOrderOpts): Promise<EsitoRimborso> {
  const admin = getAdminSupabase();
  // R84 — `cash_confirmed_at`, `payment_status` e `wallet_applied_cents` non si
  // leggevano: il ramo dei contanti non poteva sapere se i soldi erano mai
  // arrivati. Esistono tutte e tre da prima della 124.
  const COLONNE_RIMBORSO = 'id, user_id, total_price, gross_total_cents, seller_payout_cents, seller_payout_reversed_cents, payout_status, stripe_payment_intent, stripe_transfer_id, stripe_reversal_id, refunded_amount_cents, payment_method, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_fee_cents, shipping_cost, delivery_status, payment_status, cash_confirmed_at, wallet_applied_cents';
  const { data: order, error } = await conRipiegoSchema(
    'orders.select (rimborso)',
    () => admin.from('orders').select(COLONNE_RIMBORSO).eq('id', opts.orderId).single(),
    () => admin.from('orders').select(senzaColonne(COLONNE_RIMBORSO, COLONNE_124)).eq('id', opts.orderId).single(),
  );

  // Un guasto di lettura NON e' un ordine che non esiste: si riprova (vedi
  // `eOrdineInesistente` qui sopra). Solo la riga davvero assente e' senza
  // ritorno, e il messaggio resta quello che il giro dei rimborsi gia' scrive.
  if (error && !eOrdineInesistente(error)) {
    logger.error('[refundOrder] lettura ordine caduta, il rimborso si ritenta', {
      orderId: opts.orderId,
      code: (error as { code?: string }).code,
      message: (error as { message?: string }).message,
    });
    throw new Error('refundOrder: lettura ordine non riuscita, riprovare');
  }
  if (!order) throw new RimborsoNonRitentabile('refundOrder: ordine non trovato');

  // Carta o contanti, deciso PRIMA di toccare qualunque cosa. Prima il
  // controllo stava dopo la prenotazione del rimborso: un ordine che non si
  // poteva rimborsare la lasciava li', e l'importo risultava restituito.
  const tipo = tipoDiPagamento(order);
  if (!tipo) {
    throw new RimborsoNonRitentabile('refundOrder: ordine senza payment_intent e non COD (non rimborsabile)');
  }

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
  const grossCents = lordoDellOrdine(order);
  const alreadyRefunded = order.refunded_amount_cents ?? 0;

  // R84 — SI RESTITUISCE SOLO QUELLO CHE IL CLIENTE HA DATO DAVVERO.
  //
  // Sui contanti il tetto era il lordo dell'ordine, incassato o no. Un ordine
  // in contanti mai consegnato, un reclamo chiuso a favore del cliente con 24
  // scritto nel campo rimborso, e partivano 24 € di credito MyCity per una cosa
  // che nessuno aveva pagato. La regola (lib/rimborsi/regole-del-rimborso.ts)
  // conta i contanti solo se incassati, e il credito speso solo se l'annullo
  // non l'ha gia' restituito.
  const rimborsabile = quantoSiPuoRestituire(order);
  if (rimborsabile.perche === 'nessun-incasso') {
    throw new RimborsoNonRitentabile(motivoNienteDaRestituire('nessun-incasso'));
  }
  const safeAmountCents = Math.max(0, Math.min(opts.amountCents, rimborsabile.massimoCents));
  if (safeAmountCents <= 0) throw new RimborsoNonRitentabile('refundOrder: importo rimborso non valido');

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
    throw new RimborsoNonRitentabile('refundOrder: rimborso già registrato o oltre il totale dell ordine');
  }

  // payment_status distingue REFUNDED (pieno) da PARTIALLY_REFUNDED (parziale).
  const newRefundedTotal = Number(rivendicato.totale_rimborsato ?? 0);
  const isFull = newRefundedTotal >= grossCents;
  // L'ordine si chiude quando i soldi tornano tutti, OPPURE quando chi decide
  // dice che è chiuso lo stesso (vedi `annullaLOrdine`): «cliente assente» è
  // un ordine finito con un rimborso che non è pieno per scelta.
  const ordineDaChiudere = isFull || opts.annullaLOrdine === true;

  // R71 — IN CHE MODO TORNANO I SOLDI. Carta → sulla carta. Contanti → la
  // parte pagata col credito torna credito; quella dei contanti torna credito
  // SOLO se il cliente l'ha scelto, altrimenti va col bonifico. Una regola
  // sola, pura (lib/rimborsi/regole-del-rimborso.ts). Prima: credito d'ufficio.
  const riparto = ripartoDelRimborso(order, safeAmountCents, opts.contanti?.modo ?? null) as RipartoDelRimborso;
  const modo = riparto.modo;

  // La chiave di idempotenza. 051 — porta il totale cumulato, non l'importo di
  // QUESTO rimborso: due rimborsi parziali uguali sullo stesso ordine (due
  // volte 10 €) avevano la stessa chiave, e il secondo non avveniva. Il totale
  // e' diverso a ogni passo e uguale a se stesso su un ritentativo. R82 — la
  // stessa regola adesso vale anche per i contanti, che usavano l'importo.
  const chiave =
    opts.idempotencyKey ??
    (tipo === 'carta' ? `refund_${order.id}_tot_${newRefundedTotal}` : `cod_refund_${order.id}_tot_${newRefundedTotal}`);

  // ① I SOLDI TORNANO AL CLIENTE. Fin qui non e' uscito niente: se questo passo
  // cade, la prenotazione fatta sopra torna indietro e il rimborso si puo' rifare.
  //
  // 21/8/2026 — SE STRIPE DICE DI NO, IL DATABASE NON PUÒ DIRE DI SÌ. La riga
  // sopra registra il rimborso PRIMA di muovere i soldi, per chiudere la corsa
  // in cui due percorsi partiti insieme li fanno uscire due volte. Ma se il
  // pagamento poi cade — carta scaduta, rete, database in timeout — restava
  // scritto «rimborsato» su un cliente che non aveva ricevuto niente, e il
  // tetto dentro `accumula_rimborso` impediva pure di riprovare.
  //
  // R82 (11/10/2026) — QUELLA RIPARAZIONE STAVA SOLO NEL RAMO DELLA CARTA. Il
  // ramo dei contanti era scritto a parte, e le due riparazioni (21/8 e R043)
  // non ci erano mai arrivate: se l'accredito sul portafoglio cadeva, la
  // prenotazione restava, la cliente non riceveva niente e il negozio, al
  // secondo tentativo, leggeva «gia' rimborsato per intero». E lo storno della
  // quota al negozio, fuori da ogni protezione, avveniva PRIMA dell'accredito:
  // se l'accredito cadeva, il negozio aveva gia' pagato. Adesso il blocco e'
  // uno solo per tutti i modi: prima il cliente, poi — a soldi usciti — il
  // negozio. La classe di difetto «riparato in un ramo solo» non ha piu' due rami.
  let refundId: string;
  let stripeRefundId: string | null = null;
  // Il credito e' uscito ma il diario non ha detto quanto: si registra, e lo
  // si dice a chi amministra (piu' sotto, a rimborso scritto).
  let cifraDelCreditoNonVerificata = false;
  try {
    if (tipo === 'carta') {
      // getStripe sta dentro la protezione: senza chiavi lancia, e prima la
      // prenotazione restava in piedi anche in quel caso.
      const stripe = getStripe();
      const refund: Stripe.Refund = await stripe.refunds.create(
        {
          payment_intent: order.stripe_payment_intent as string,
          amount: safeAmountCents,
          metadata: {
            order_id: order.id,
            ...(opts.reason ? { reason: opts.reason } : {}),
            ...(opts.metadata ?? {}),
          },
        },
        // Idempotency-Key: doppio-click su risoluzione dispute/reso NON genera doppio rimborso.
        { idempotencyKey: chiave },
      );
      refundId = refund.id;
      stripeRefundId = refund.id;
    } else {
      // Contanti. La parte che torna come credito MyCity — quella pagata col
      // credito, piu' i contanti se il cliente ha scelto il credito — si
      // accredita qui. Idempotente sulla chiave: unique index su
      // wallet_ledger(reason, ref), migrazioni 098 e 143.
      if (riparto.creditoCents > 0) {
        const { error: wErr } = await admin.rpc('wallet_credit', {
          p_user: order.user_id,
          p_cents: riparto.creditoCents,
          p_reason: 'cod_refund',
          p_ref: chiave,
        });
        // 23505 = questo accredito c'e' gia': un tentativo precedente era
        // arrivato fin qui e si era persa solo la risposta. Il credito non si
        // ripete (lo stesso fa la 143, che risponde senza errore, col saldo di
        // prima), e il resto del rimborso — che quel tentativo non aveva
        // registrato — va a termine qui. Prima su 23505 la funzione usciva
        // subito: il cliente aveva il credito, l'ordine restava «pagato» e il
        // negozio teneva la sua quota.
        if (wErr && (wErr as { code?: string }).code !== '23505') {
          const aDiario = await accreditoAvvenutoNonostanteLErrore(admin, chiave);
          if (aDiario == null) throw new Error(`refundOrder COD: accredito wallet fallito: ${wErr.message}`);
          controllaLaCifraGiaAccreditata(aDiario, riparto.creditoCents);
        } else {
          // Il credito di questa chiave c'e': l'ha appena scritto `wallet_credit`,
          // o c'era gia' (23505). Dopo la 143 un doppione non si distingue da un
          // accredito nuovo dalla risposta: si guarda la riga a diario di quella
          // chiave, che c'e' una volta sola (indice unico), e deve dire lo stesso
          // importo. Ma se il diario non si legge NON si torna indietro: il
          // credito e' gia' uscito (vedi `laCifraDelCreditoUscito`).
          const aDiario = await laCifraDelCreditoUscito(admin, chiave, order.id);
          if (aDiario === 'illeggibile') cifraDelCreditoNonVerificata = true;
          else controllaLaCifraGiaAccreditata(aDiario, riparto.creditoCents);
        }
      }
      // La parte del bonifico (R71) la paga a mano chi amministra: qui non si
      // muove e non puo' cadere niente. Il rimborso si registra, e piu' sotto
      // parte l'avviso a chi deve pagare. Il segno `bonifico:` sul reso e' quello
      // che la lista dei bonifici da fare cerca, e porta la cifra del bonifico:
      // senza la migrazione 162 e' l'unico posto dove la lista la ritrova
      // (lib/rimborsi/bonifici-da-fare.ts).
      refundId =
        riparto.bonificoCents > 0 ? segnoDelBonifico(chiave, riparto.bonificoCents) : `wallet:${chiave}`;
    }
  } catch (err) {
    // Si toglie esattamente quello che la prenotazione aveva messo, cosi'
    // riprovare e' possibile. Riprovare e' anche sicuro: la chiave dipende dal
    // totale cumulato, che dopo lo storno torna quello di prima — se il
    // rimborso era passato davvero e a cadere e' stata solo la risposta, il
    // secondo tentativo ritrova quello (Stripe con la chiave, il portafoglio
    // con l'indice unico), non ne crea un altro.
    const { error: errStorno } = await admin
      .rpc('storna_rimborso', { p_order_id: order.id, p_delta: safeAmountCents });
    if (errStorno) {
      logger.error('[refundOrder] STORNO FALLITO: l ordine resta segnato come rimborsato senza esserlo', {
        orderId: order.id, centesimi: safeAmountCents, message: errStorno.message,
      });
    }
    throw err;
  }

  // ② DOPO CHE I SOLDI SONO USCITI NON SI TORNA INDIETRO.
  //
  // 27/8/2026 (R043) — Il recupero della quota dal negozio e' un'ALTRA chiamata
  // di rete, e stava fuori da qualsiasi protezione: se Stripe rispondeva male,
  // la funzione moriva lasciando un ordine ancora «pagato», la merce non
  // rimessa a scaffale, il reso aperto e l'importo gia' segnato come
  // rimborsato. Adesso e' best-effort, come il compenso del fattorino: il
  // rimborso va a termine, e i soldi rimasti al negozio diventano un lavoro
  // dichiarato — sull'ordine e sulla scrivania degli amministratori. R82 —
  // vale anche per i contanti, dove lo storno stava senza nessuna protezione.
  const sellerNet = order.seller_payout_cents ?? 0;
  const sellerShare =
    grossCents > 0 ? Math.min(Math.round((safeAmountCents * sellerNet) / grossCents), sellerNet) : 0;

  let stornatoAlNegozio = 0;
  let recuperoNonRiuscito: string | null = null;
  try {
    ({ reversedCents: stornatoAlNegozio } = await reverseOrderTransfer(order, sellerShare));
  } catch (err) {
    recuperoNonRiuscito = err instanceof Error ? err.message : 'errore sconosciuto';
    logger.error('[refundOrder] recupero della quota del negozio fallito dopo il rimborso', {
      orderId: order.id, centesimi: sellerShare, err,
    });
  }
  // 21/8/2026 — Se il bonifico al negozio non e' ancora partito, la sua quota
  // si scala da quello che gli verra' versato (vedi la funzione): una sola
  // copia per tutti i modi di pagare.
  const reversedCents = await addebitaQuotaVenditoreSeNonPagato(admin, order, sellerShare, stornatoAlNegozio);

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
  const { error: errStato } = await admin
    .from('orders')
    .update({
      ...(stripeRefundId ? { stripe_refund_id: stripeRefundId } : {}),
      // `refunded_amount_cents` l'ha già scritto `accumula_rimborso`: riscriverlo
      // qui riaprirebbe la corsa che quella funzione serve a chiudere. (Il ramo
      // dei contanti lo riscriveva: era la stessa corsa, rimasta aperta li'.)
      payment_status: isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      // Lo stato del bonifico segue i SOLDI: solo un rimborso pieno chiude la
      // partita col negozio. Su un rimborso parziale la quota proporzionale è
      // già stata addebitata qui sopra, e il residuo resta dovuto.
      ...(isFull ? { payout_status: wasTransferred ? 'REVERSED' : 'REFUNDED' } : {}),
      // La consegna segue l'ORDINE: si annulla quando l'ordine è chiuso, anche
      // se il rimborso non è pieno (vedi `annullaLOrdine`).
      //
      // 054 — Un ordine già CONSEGNATO non torna «annullato» perché è stato
      // rimborsato: la consegna è avvenuta, il fattorino l'ha fatta, e
      // riscrivere quello stato cancellava dai numeri consegne vere e faceva
      // sparire l'ordine dalle liste operative.
      //
      // NB contanti: la consegna NON si annulla mai qui. Il contante incassato
      // dal fattorino resta dovuto e va riconciliato: annullare l'ordine lo
      // toglierebbe dall'atteso della riconciliazione.
      ...(tipo === 'carta' && ordineDaChiudere && order.delivery_status !== 'DELIVERED'
        ? { delivery_status: 'CANCELED', canceled_at: new Date().toISOString() }
        : {}),
    })
    .eq('id', order.id);
  if (errStato) {
    logger.error('[refundOrder] stato del rimborso non scritto sull ordine', {
      orderId: order.id, message: errStato.message,
    });
  }

  // R043 — Il recupero mancato si scrive DOPO l'aggiornamento buono, e in una
  // riga sua: se il vincolo del database non conoscesse ancora questo stato
  // (vedi migrazione 130), a cadere sarebbe solo il promemoria, non il rimborso.
  if (recuperoNonRiuscito) {
    const { error: errSegno } = await admin
      .from('orders')
      .update({ payout_status: 'REVERSAL_FAILED', reversal_error: recuperoNonRiuscito.slice(0, 500) })
      .eq('id', order.id);
    if (errSegno) {
      logger.error('[refundOrder] recupero mancato non registrato sull ordine', {
        orderId: order.id, message: errSegno.message,
      });
    }
    try {
      await notifyAdmins(
        '⚠️ Storno al venditore non riuscito',
        `Il rimborso sull'ordine ${order.id} è uscito, ma i ${(sellerShare / 100).toFixed(2)}€ di quota del negozio non sono rientrati (${recuperoNonRiuscito}). Vanno recuperati a mano.`,
        '/admin/orders',
      );
    } catch (e) {
      logger.error('[refundOrder] avviso agli admin non inviato', { orderId: order.id, e });
    }
  }

  // R82 (terzo giro) — Il credito e' uscito e il rimborso e' registrato, ma il
  // diario non ha confermato la cifra: se un tentativo precedente avesse dato
  // una cifra diversa, lo vede solo una persona. L'avviso dice cosa guardare.
  if (cifraDelCreditoNonVerificata) {
    try {
      await notifyAdmins(
        '⚠️ Rimborso col credito da controllare',
        `Il rimborso sull'ordine #${order.id.slice(0, 8)} è registrato: ${formatPriceFromCents(riparto.creditoCents)} di credito MyCity al cliente. ` +
          'Il diario del credito in quel momento non ha risposto, quindi la cifra uscita non è stata verificata. ' +
          `Controlla che la riga «cod_refund» con riferimento ${chiave} dica ${formatPriceFromCents(riparto.creditoCents)}.`,
        '/admin/orders',
      );
    } catch (e) {
      logger.error('[refundOrder] avviso del credito da controllare non inviato', { orderId: order.id, e });
    }
  }

  // R71 — IL BONIFICO DA FARE ARRIVA A CHI LO DEVE FARE. Il rimborso e'
  // registrato (sull'ordine e, per i resi, sul reso); questo e' l'avviso.
  if (riparto.bonificoCents > 0) {
    const daContanti = opts.contanti?.modo === 'BONIFICO' ? opts.contanti : undefined;
    const conIban = !!daContanti?.ibanFinale;
    try {
      await notifyAdmins(
        '💶 Bonifico di rimborso da fare',
        `Bonifico di ${formatPriceFromCents(riparto.bonificoCents)} da fare al cliente dell'ordine #${order.id.slice(0, 8)}, pagato in contanti` +
          (riparto.creditoCents > 0
            ? ` (altri ${formatPriceFromCents(riparto.creditoCents)} gli sono già tornati come credito MyCity). `
            : '. ') +
          (conIban
            ? "L'IBAN che ha indicato è nella pagina dei rimborsi da bonificare."
            : 'Il cliente non ha indicato un IBAN: chiediglielo prima di pagare.'),
        daContanti?.doveSiPaga ?? PAGINA_DEI_BONIFICI_DA_FARE,
      );
    } catch (e) {
      logger.error('[refundOrder] avviso del bonifico da fare non inviato', { orderId: order.id, e });
    }
  }

  // Ordine chiuso → la merce torna a scaffale (P0-4). Il rimborso pieno è il
  // caso normale; «cliente assente» è un ordine chiuso con un rimborso che non
  // è pieno per scelta, e la merce torna lo stesso (vedi `annullaLOrdine`).
  //
  // 8/9/2026 — E torna UNA VOLTA SOLA. Finché a chiudere l'ordine era solo il
  // rimborso pieno, la seconda chiamata era impossibile per costruzione: dopo
  // un rimborso pieno non resta niente da rimborsare. Con l'annullo dichiarato
  // no — 25,00 su 30,00 chiudono l'ordine e i 5,00 restanti possono uscire
  // dopo — e la somma sarebbe girata due volte. La regola sta in
  // lib/ordini/rimessa-a-scaffale.ts, dove una prova può eseguirla.
  await rimettiLaMerceAScaffale(admin, order, {
    ordineDaChiudere,
    giaRimborsatoPrimaCents: alreadyRefunded,
  });

  await notifyRefundBuyer(admin, order.user_id, order.id, safeAmountCents, opts, riparto);

  return {
    refundId,
    reversedCents,
    pieno: isFull,
    modo,
    importoCents: safeAmountCents,
    creditoCents: riparto.creditoCents,
    bonificoCents: riparto.bonificoCents,
  };
}
