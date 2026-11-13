/**
 * Contestazioni carta (chargeback): apertura e chiusura.
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
import { logger } from '@/lib/logger';
import { colonnaNonTrovata, type ErroreDatabase } from '@/lib/db/migrazione-148';
import { formatPriceFromCents } from '@/lib/format';
import { findOrdersForDispute, notifyAdmins } from './comune';
import { scritturaObbligatoria } from './esito';
import { scriviConRipiego } from './dispute-ripiego';
import { restituisciLeQuoteParziali } from './contestazione-parziale-vinta';
import { buonoDaRiattivareDopoLaVittoria, richiestaSulBuonoSoloAvviso } from './contestazione-buoni';
import {
  contestazioneDiUnaParte, eUnaRichiestaDiInformazioni, promemoriaOTotale, quotaDelRimborsoSulNetto, stornatoDaQuestaContestazione,
} from './quanto-restituire';

export { promemoriaOTotale };

/** Uno storno al negozio che va guardato a mano, per l'avviso agli amministratori. */
type StornoDaControllare = { orderId: string; testo: string };

/**
 * 15/10/2026 (R81) — Su Stripe c'è già uno storno di questo bonifico fatto da
 * quando la contestazione è nata? Si chiede a Stripe e non al database, perché
 * il database può non averlo registrato (un processo morto fra la risposta di
 * Stripe e la scrittura). Un pagamento contestato Stripe non lo lascia più
 * rimborsare (errore `charge_disputed`), quindi uno storno nato dopo la
 * contestazione è il suo. Se Stripe non risponde si lancia: la rotta risponde
 * 500 e Stripe riprova (prima di questo punto è stata scritta solo la riga OPEN).
 */
async function stornoGiaFattoPerLaContestazione(
  o: { id: string; stripe_transfer_id: string | null; stripe_reversal_id: string | null },
  dispute: Stripe.Dispute,
  daControllare: StornoDaControllare[],
): Promise<boolean> {
  if (!o.stripe_transfer_id) return false;
  const dal = dispute.created ?? 0;
  const storni = await getStripe().transfers.listReversals(o.stripe_transfer_id, { limit: 100 });
  const suo = storni.data.find((r) => r.created >= dal && (r.metadata?.order_id ?? o.id) === o.id);
  if (suo && suo.id !== o.stripe_reversal_id) {
    // Fatto su Stripe, non scritto da noi: non si rifà, ma va visto. Non solo
    // nei log: senza registrazione, a contestazione vinta il negozio non
    // verrebbe ripagato (per il database il bonifico non è mai stato toccato).
    logger.error('[stripe] storno della contestazione fatto su Stripe ma non registrato sull ordine', {
      orderId: o.id, reversalId: suo.id, centesimi: suo.amount,
    });
    daControllare.push({
      orderId: o.id,
      testo: `ordine ${o.id.slice(0, 8)}: lo storno di ${formatPriceFromCents(suo.amount)} (${suo.id}) è su Stripe ma non sull'ordine. Non va rifatto: va solo registrato sull'ordine.`,
    });
  }
  return !!suo;
}

/**
 * charge.dispute.created → chargeback aperto (Stripe ha GIÀ prelevato i fondi: niente refund, sarebbe doppio):
 * claw-back del transfer se il negozio era già pagato, ordini 'OPEN' (il giro dei bonifici li salta), avviso.
 * R23-012 — Anche charge.dispute.funds_withdrawn (`prelievo`): la richiesta di informazioni diventata contestazione
 * vera non ripassava di qui, e al negozio non si toglieva niente. Su un chargeback già lavorato l'avviso non si ripete.
 */
export async function handleDisputeCreated(dispute: Stripe.Dispute, prelievo = false) {
  const orders = await findOrdersForDispute(
    dispute,
    // R052 — serve anche il lordo dell'ordine: la quota da riprendere al
    // negozio si calcola in proporzione a quanto la banca ha contestato.
    // R81 — serve `dispute_status`: 'OPEN' dice che questo avviso PUÒ essere
    // già passato di qui (sotto, perché solo «può»).
    'id, dispute_status, payout_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id, gross_total_cents, total_price, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_fee_cents, shipping_cost',
  );
  if (orders.length === 0) {
    // 31/10/2026 (178) — Senza ordini il pagamento contestato puo' essere quello
    // di un buono regalo: la banca si e' gia' ripresa i soldi, il buono si spegne.
    // Lo spegne il database (`gift_card_void_for_payment`, 178), una volta
    // sola anche se Stripe riconsegna l'evento. Un errore si rilancia, cosi'
    // Stripe riprova.
    // R11-022 — una richiesta di informazioni non toglie soldi: il buono non si annulla.
    if (await richiestaSulBuonoSoloAvviso(dispute)) return;
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : (dispute.payment_intent?.id ?? null);
    if (pi) {
      const { data: buono, error: errBuono } = await getAdminSupabase().rpc('gift_card_void_for_payment', {
        p_session_id: null,
        p_payment_intent: pi,
        p_reason: 'disputed',
      });
      if (errBuono) throw new Error(`[stripe] buono regalo della contestazione non annullato (${pi}): ${errBuono.message}`);
      if ((buono as { esito?: string } | null)?.esito === 'annullato') {
        logger.warn('[stripe] buono regalo annullato: il suo pagamento è contestato in banca', { disputeId: dispute.id, paymentIntent: pi, buono });
        return;
      }
    }
    logger.warn('[stripe] dispute.created: nessun ordine trovato', { disputeId: dispute.id });
    return;
  }

  const admin = getAdminSupabase();

  /**
   * 1/11/2026 — UNA RICHIESTA DI INFORMAZIONI NON E' UN CHARGEBACK.
   *
   * Per Stripe la «richiesta di informazioni» della banca (inquiry) e' una
   * contestazione con stato `warning_needs_response`: i soldi a MyCity NON
   * vengono tolti. Qui era trattata come un chargeback vero: al negozio si
   * stornava il bonifico, e alla chiusura (`warning_closed`) nessuno glielo
   * restituiva. Adesso si ferma solo il bonifico che non e' ancora partito
   * ('OPEN', come sempre) e si avvisa; niente storni. Riparte alla chiusura.
   */
  if (eUnaRichiestaDiInformazioni(dispute)) {
    scritturaObbligatoria(
      await admin
        .from('orders')
        .update({ dispute_status: 'OPEN', disputed_at: new Date().toISOString() })
        .in('id', orders.map((o) => o.id)),
      'richiesta di informazioni aperta sugli ordini',
    );
    await notifyAdmins(
      'ℹ️ La banca chiede informazioni su un pagamento',
      `Richiesta di informazioni ${dispute.id} sull'ordine ${orders[0].id}${orders.length > 1 ? ` (+${orders.length - 1})` : ''} — ${((dispute.amount ?? 0) / 100).toFixed(2)}€. Nessun soldo tolto, nessuno storno al negozio: il bonifico non ancora partito resta fermo finché la banca chiude.`,
      '/admin/disputes',
    );
    return;
  }

  /**
   * 27/8/2026 (R052) — QUANTO HA CONTESTATO DAVVERO LA BANCA.
   *
   * Un chargeback puo' riguardare una PARTE del pagamento. Qui il recupero dal
   * negozio veniva chiesto senza importo, e senza importo quella funzione si
   * prende tutto il residuo: su una contestazione da 20 euro di un ordine da 50
   * al negozio ne toglievamo 45. Piu' di quanto era stato tolto a noi.
   *
   * `dispute.amount` c'era gia', ma finiva solo nel testo dell'avviso agli
   * amministratori. Adesso entra nel conto: la parte contestata del pagamento
   * (che puo' coprire piu' ordini dello stesso carrello) si applica al netto di
   * ciascun negozio. Se il lordo non si sa — ordini nati prima della migrazione
   * 124 — non si indovina: si ricade sul comportamento di prima.
   */
  const contestatoCents = dispute.amount ?? 0;
  const lordoTotale = orders.reduce((somma, o) => {
    const riga = o as { gross_total_cents?: number | null; total_price?: number | string | null };
    return somma + (riga.gross_total_cents ?? Math.round(Number(riga.total_price ?? 0) * 100));
  }, 0);
  const fettaContestata = lordoTotale > 0 && contestatoCents > 0 ? contestatoCents / lordoTotale : 1;
  const quotaDaRiprendere = (o: { seller_payout_cents: number | null }): number | undefined =>
    fettaContestata >= 1 ? undefined : Math.round(fettaContestata * (o.seller_payout_cents ?? 0));

  /**
   * 15/10/2026 (R81) — PRIMA SI FERMA IL GIRO DEI BONIFICI, POI SI STORNA.
   *
   * Il giro paga solo gli ordini con `dispute_status` vuoto o 'WON'. Se questa
   * scrittura fallisce (un timeout del database) e nessuno lo legge, la rotta
   * risponde 200, Stripe non riprova, e al giro dopo il negozio viene pagato su
   * soldi che la banca si è già ripresa. Adesso il gestore fallisce e Stripe
   * ripete l'evento.
   *
   * E sta PRIMA degli storni, non dopo. Il collaudo del 15/10 l'ha misurato:
   * con questa riga in fondo, su una contestazione PARZIALE (20 € su un ordine
   * da 40 €) lo storno registrato al primo passaggio lascia l'ordine
   * 'TRANSFERRED', la chiave anti-doppione dello storno porta il totale
   * stornato, e al secondo passaggio la chiave è nuova: al negozio si toglievano
   * 32,40 € invece di 16,20. Scritta per prima, se fallisce non è ancora
   * successo niente, e ripetere è davvero sicuro.
   */
  // 'OPEN' letto PRIMA di scrivere non vuol dire con certezza «questo avviso è
  // già passato di qui». Fino alla 184 lo scriveva anche il reclamo dall'app (trigger 063): gli
  // ordini di prima possono portarlo ancora. Per questo 'OPEN' fa solo da primo filtro, e la prova vera la dà Stripe
  // (`stornoGiaFattoPerLaContestazione`): uno storno nato dopo la contestazione.
  // Se c'era solo il reclamo, Stripe non ne ha nessuno e lo storno si fa.
  const giaPassati = new Set(orders.filter((o) => o.dispute_status === 'OPEN').map((o) => o.id));
  const daControllare: StornoDaControllare[] = [];
  let stornatoOra = 0; // R23-012 — quanto ha tolto QUESTO passaggio, a negozio e fattorino
  scritturaObbligatoria(
    await admin
      .from('orders')
      .update({ dispute_status: 'OPEN', disputed_at: new Date().toISOString() })
      .in('id', orders.map((o) => o.id)),
    'contestazione aperta sugli ordini',
  );

  for (const o of orders) {
    // 22/8/2026 — SI TIENE DA PARTE QUANTO TORNA INDIETRO PER **QUESTA**
    // CONTESTAZIONE. Alla chiusura vinta il totale stornato veniva azzerato, e
    // dentro quel totale poteva esserci anche un reso rimborsato settimane
    // prima: il negozio si faceva ripagare una cosa che aveva gia' reso. Con
    // questo numero da parte, alla chiusura si sottrae invece di azzerare.
    let stornatoVenditore = 0;
    const quota = quotaDaRiprendere(o);
    if (
      o.payout_status === 'TRANSFERRED' && quota !== undefined && giaPassati.has(o.id) &&
      (await stornoGiaFattoPerLaContestazione(o, dispute, daControllare))
    ) {
      // R81 — Lo stesso avviso consegnato di nuovo, e su Stripe lo storno per
      // questa contestazione c'è già. Uno storno PARZIALE non si rifà: dopo il
      // primo l'ordine resta 'TRANSFERRED' e la chiave anti-doppione cambia,
      // quindi Stripe ne farebbe un secondo. Lo storno pieno invece si rifà
      // senza rischio: se è registrato l'ordine è 'REVERSED' e qui non entra;
      // se non lo è, la chiave è la stessa e Stripe restituisce quello.
      logger.warn('[stripe] contestazione parziale già lavorata: lo storno al negozio non si ripete', {
        orderId: o.id, disputeId: dispute.id,
      });
    } else if (o.payout_status === 'TRANSFERRED') {
      try {
        const esito = await reverseOrderTransfer(o, quota);
        stornatoVenditore = esito.reversedCents;
      } catch (e) {
        // Non si rilancia: un rifiuto di Stripe che si ripete (saldo del negozio
        // insufficiente) bloccherebbe per tre giorni anche il resto, compreso
        // l'avviso qui sotto. Ma l'errore non resta solo nei log: può essere una
        // risposta persa per strada, con lo storno fatto davvero su Stripe.
        logger.error('[stripe] reversal on dispute.created failed', { orderId: o.id, e });
        daControllare.push({
          orderId: o.id,
          testo: `ordine ${o.id.slice(0, 8)}: lo storno della quota del negozio non risulta riuscito (${e instanceof Error ? e.message : 'errore sconosciuto'}). Prima di rifarlo a mano, guarda su Stripe (Connect → il bonifico dell'ordine → Storni): la risposta di Stripe può essersi persa e lo storno può esserci già. Se c'è, va solo registrato sull'ordine.`,
        });
      }
    }
    // Anche il compenso del fattorino torna indietro: senza questo la
    // piattaforma restituisce l'incasso al cliente e paga la consegna da se'.
    let stornatoFattorino = 0; // 5/11/2026 — Contestazione di una parte: al fattorino la stessa fetta, non tutto (mai rifatta se ripetuta).
    const r = o as { rider_fee_cents?: number | null; shipping_cost?: number | string | null; rider_payout_reversed_cents?: number | null };
    const quotaFattorino = fettaContestata >= 1 ? undefined : Math.round(fettaContestata * (r.rider_fee_cents ?? Math.round(Number(r.shipping_cost ?? 0) * 100)));
    const fattorinoGiaStornato = quotaFattorino !== undefined && giaPassati.has(o.id) && Number(r.rider_payout_reversed_cents ?? 0) > 0;
    try {
      const esito = fattorinoGiaStornato ? { reversedCents: 0 } : await reverseRiderTransfer(o, quotaFattorino);
      stornatoFattorino = esito.reversedCents;
    } catch (e) {
      logger.error('[stripe] recupero compenso rider su contestazione fallito', { orderId: o.id, e });
    }

    // Si scrive solo quello che QUESTO passaggio ha stornato: su un avviso
    // ripetuto, uno zero non deve cancellare il promemoria del primo, che alla
    // chiusura vinta dice quanto restituire al negozio.
    const valori: Record<string, number> = {};
    stornatoOra += stornatoVenditore + stornatoFattorino;
    if (stornatoVenditore > 0) valori.dispute_seller_reversed_cents = stornatoVenditore;
    if (stornatoFattorino > 0) valori.dispute_rider_reversed_cents = stornatoFattorino;
    if (Object.keys(valori).length > 0) {
      // Prima che la migrazione 126 sia applicata le colonne non ci sono e
      // l'aggiornamento fallisce: si annota e si tira dritto. Perdere il
      // promemoria e' il comportamento di ieri; perdere la registrazione della
      // contestazione no.
      const { error: errPromemoria } = await admin.from('orders').update(valori).eq('id', o.id);
      if (errPromemoria) {
        logger.warn('[stripe] storni della contestazione non annotati (migrazione 126 non applicata?)', {
          orderId: o.id, message: errPromemoria.message,
        });
        // R11-021 — Un promemoria perso per un errore vero (non la 126 che manca) non si riscrive:
        // al prossimo passaggio lo storno non si rifà. Chi chiude la contestazione deve sapere la cifra.
        if (!colonnaNonTrovata(errPromemoria as ErroreDatabase)) {
          daControllare.push({
            orderId: o.id,
            testo: `ordine ${o.id.slice(0, 8)}: per questa contestazione sono stati stornati ${formatPriceFromCents(stornatoVenditore)} al negozio, ma il promemoria non è stato scritto. Se la contestazione si vince, al negozio va restituita questa cifra, non tutto lo stornato.`,
          });
        }
      }
    }
  }

  if (daControllare.length > 0) {
    await notifyAdmins(
      '⚠️ Storno al negozio da controllare',
      `Contestazione bancaria ${dispute.id}: ${daControllare.map((d) => d.testo).join(' ')}`,
      '/admin/disputes',
    );
  }

  if (!prelievo || stornatoOra > 0) await notifyAdmins(
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
export async function handleDisputeClosed(dispute: Stripe.Dispute) {
  // `dispute_status` serve a non rimettere a scaffale due volte la merce se
  // Stripe ripete l'evento di una contestazione già chiusa come persa (R81).
  //
  // 15/10/2026 (collaudo, giro 2) — E IL PROMEMORIA VA CHIESTO, NON SOLO USATO.
  // `dispute_seller_reversed_cents` e `dispute_rider_reversed_cents` mancavano
  // da questa select: PostgREST restituisce solo le colonne chieste, quindi alla
  // vittoria il promemoria era sempre vuoto e si ricadeva sull'azzeramento del
  // totale. Un reso da 5 € stornato prima, poi una contestazione piena, poi
  // vinta: il negozio si faceva ripagare 32,40 € invece di 27,40. Il database
  // finto delle prove restituiva la riga intera, e il difetto non si vedeva.
  // Sono colonne della 126: dove non c'è, `findOrdersForDispute` le toglie.
  const orders = await findOrdersForDispute(dispute, 'id, seller_id, stripe_charge_id, stripe_transfer_group, gross_total_cents, total_price, refunded_amount_cents, wallet_applied_cents, dispute_status, delivery_status, payment_status, payout_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, dispute_seller_reversed_cents, stripe_reversal_id, payout_tentativo, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, dispute_rider_reversed_cents, rider_payout_tentativo, rider_fee_cents, shipping_cost');
  if (orders.length === 0) return buonoDaRiattivareDopoLaVittoria(dispute); // R11-022
  const admin = getAdminSupabase();
  const ids = orders.map((o) => o.id);

  if (dispute.status === 'won') {
    // Il payout va davvero sbloccato, non solo annunciato. All'apertura della
    // contestazione i soldi del venditore erano stati richiamati indietro
    // (payout_status='REVERSED'): se qui ci si limitasse a scrivere 'WON', il
    // venditore avrebbe consegnato la merce, vinto la causa e non essere mai
    // stato pagato — il cron dei payout non guarda gli ordini 'REVERSED'.
    // R81 — Una contestazione vinta non registrata lascia il bonifico al
    // negozio bloccato per sempre: se la scrittura fallisce, Stripe riprova.
    scritturaObbligatoria(
      await admin.from('orders').update({ dispute_status: 'WON' }).in('id', ids),
      'contestazione vinta sugli ordini',
    );

    const daRipagare = orders.filter((o) => o.payout_status === 'REVERSED');
    if (daRipagare.length > 0) {
      // 158 — Riga per riga, perche' il numero del tentativo sale di uno. E'
      // quel numero a rendere diversa la chiave di idempotenza del bonifico:
      // con la chiave vecchia Stripe avrebbe restituito il transfer gia'
      // stornato, e il venditore avrebbe vinto la causa senza essere pagato.
      for (const o of daRipagare) {
        const stornatoPerLaContestazione = stornatoDaQuestaContestazione(
          o.dispute_seller_reversed_cents, o.seller_payout_reversed_cents,
          (o as { payment_status?: unknown }).payment_status,
          quotaDelRimborsoSulNetto(o as Parameters<typeof quotaDelRimborsoSulNetto>[0]), // R11-021
        );
        // 1/11/2026 — Rimborsato per intero prima della contestazione: lo storno
        // e' del rimborso. Resta 'REVERSED', il giro dei bonifici non lo vede.
        if (stornatoPerLaContestazione === null) {
          logger.info('[stripe] contestazione vinta su un pagamento già rimborsato: niente da ripagare al negozio', { orderId: o.id });
          continue;
        }
        // 22/8/2026 — SI SOTTRAE, NON SI AZZERA.
        //
        // Qui c'era `seller_payout_reversed_cents: 0`. Quel campo e' un totale
        // cumulato: dentro ci puo' essere anche uno storno che con la
        // contestazione non c'entra — un reso parziale rimborsato prima, in cui
        // il negozio aveva gia' restituito la sua quota. Azzerandolo il residuo
        // tornava al netto pieno e il giro dei bonifici versava tutto: il
        // negozio incassava due volte la stessa parte, e la differenza la
        // metteva MyCity.
        //
        // Adesso si toglie solo quello che era stato richiamato indietro PER la
        // contestazione, che e' il numero messo da parte all'apertura. Se quel
        // numero non c'e' si ricade sul comportamento di prima: e' il caso
        // peggiore di ieri, non un peggioramento. «Non c'è» vuol dire anche
        // zero: la 126 crea la colonna con DEFAULT 0, quindi una contestazione
        // aperta prima della 126 la trova a zero e non a vuoto. Usare quello
        // zero vorrebbe dire non ripagare niente.
        const valori = {
          payout_status: 'HELD',       // torna fra i candidati del prossimo giro
          stripe_transfer_id: null,    // il transfer precedente e' stato stornato
          stripe_reversal_id: null,
          seller_payout_reversed_cents: Math.max(
            0,
            (o.seller_payout_reversed_cents ?? 0) - stornatoPerLaContestazione,
          ),
          dispute_seller_reversed_cents: 0,
          payout_at: null,
          payout_tentativo: ((o as { payout_tentativo?: number }).payout_tentativo ?? 0) + 1,
        };
        // Prima della migrazione 124 la colonna del tentativo non esiste e
        // l'aggiornamento fallirebbe intero: il venditore vincerebbe la
        // contestazione e resterebbe comunque a mani vuote. Rimetterlo in
        // coda senza quel numero e' meglio che non rimetterlo affatto.
        //
        // R81 — Se questa scrittura fallisce Stripe riprova, ed è sicuro: chi è
        // già tornato 'HELD' al primo passaggio non è più 'REVERSED' e qui non
        // rientra, quindi il tentativo non sale due volte.
        scritturaObbligatoria(
          await scriviConRipiego(
            'orders.update (contestazione vinta, venditore)',
            valori,
            [['dispute_seller_reversed_cents'], ['payout_tentativo']],
            (campi) => admin.from('orders').update(campi).eq('id', o.id),
          ),
          'bonifico al negozio rimesso in coda dopo la contestazione vinta',
        );
      }
      logger.info('[stripe] contestazione vinta: payout rimessi in coda', {
        ordini: daRipagare.length,
      });
    }

    // R11-007 — la contestazione parziale vinta restituisce al negozio la sua quota.
    await restituisciLeQuoteParziali(dispute, orders);

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
        const stornatoPerLaContestazione = stornatoDaQuestaContestazione(
          o.dispute_rider_reversed_cents, o.rider_payout_reversed_cents,
          (o as { payment_status?: unknown }).payment_status,
        );
        if (stornatoPerLaContestazione === null) {
          logger.info('[stripe] contestazione vinta su un pagamento già rimborsato: niente da ripagare al fattorino', { orderId: o.id });
          continue;
        }
        const valori = {
          rider_payout_status: 'HELD',
          rider_transfer_id: null,
          rider_payout_reversed_cents: Math.max(
            0,
            (o.rider_payout_reversed_cents ?? 0) - stornatoPerLaContestazione,
          ),
          dispute_rider_reversed_cents: 0,
          rider_payout_at: null,
          rider_payout_tentativo: ((o as { rider_payout_tentativo?: number }).rider_payout_tentativo ?? 0) + 1,
        };
        scritturaObbligatoria(
          await scriviConRipiego(
            'orders.update (contestazione vinta, fattorino)',
            valori,
            [['dispute_rider_reversed_cents'], ['rider_payout_tentativo']],
            (campi) => admin.from('orders').update(campi).eq('id', o.id),
          ),
          'compenso del fattorino rimesso in coda dopo la contestazione vinta',
        );
      }
      logger.info('[stripe] contestazione vinta: compensi fattorino rimessi in coda', {
        ordini: riderDaRipagare.length,
      });
    }

    await notifyAdmins('✓ Chargeback vinto', `Contestazione vinta su ordine ${ids[0]}. Payout rimesso in coda.`, '/admin/disputes');
  } else if (dispute.status === 'lost' && contestazioneDiUnaParte(dispute, orders)) {
    // R11-023 — persa su una PARTE del carrello: niente annulli, merce a scaffale o «rimborsato per
    // intero» sugli ordini degli altri negozi. Bonifici fermi (LOST), la perdita la divide Nicola.
    scritturaObbligatoria(
      await admin.from('orders').update({ dispute_status: 'LOST', payment_status: 'PARTIALLY_REFUNDED' })
        .in('id', orders.filter((o) => (o as { payment_status?: string }).payment_status !== 'REFUNDED').map((o) => o.id)),
      'contestazione persa su una parte del carrello',
    );
    await notifyAdmins(
      '✕ Chargeback perso su una parte del carrello',
      `Contestazione ${dispute.id} persa per ${formatPriceFromCents(dispute.amount ?? 0)} su un pagamento di ${ids.length} ordine/i (${ids.map((id) => id.slice(0, 8)).join(', ')}). Nessun ordine annullato: i bonifici di questi ordini sono fermi finché non dividi la perdita fra i negozi.`,
      '/admin/disputes',
    );
  } else if (dispute.status === 'lost') {
    // 22/8/2026 — UNA CONSEGNA AVVENUTA NON TORNA «ANNULLATA», E LA MERCE NON
    // TORNA A MAGAZZINO.
    //
    // Qui si scriveva `delivery_status: 'CANCELED'` su tutti gli ordini della
    // contestazione e si rimetteva a scaffale la merce di tutti. Ma la
    // contestazione arriva quasi sempre SETTIMANE DOPO la consegna: il caso
    // escluso ovunque altrove (rimborsi, storni) era qui il caso normale.
    //
    // Due danni insieme. La merce era uscita davvero dal negozio e la giacenza
    // saliva lo stesso: prodotti fantasma in vendita, cioe' un secondo cliente
    // che compra una cosa che non c'e'. E consegne vere sparivano dalle liste
    // operative e dal conteggio delle consegne, che e' il numero su cui si
    // giudica il progetto.
    //
    // Sui consegnati si tocca il pagamento, non la storia della consegna.
    const consegnati = orders.filter((o) => o.delivery_status === 'DELIVERED').map((o) => o.id);
    const nonConsegnati = ids.filter((id) => !consegnati.includes(id));

    /**
     * 15/10/2026 (R81) — LE SCRITTURE ORA FANNO RIPROVARE STRIPE, QUINDI LA
     * MERCE DEVE TORNARE A SCAFFALE UNA VOLTA SOLA.
     *
     * `restore_stock_for_order` è una somma senza segno di «già fatto». Finché
     * un errore del database veniva ingoiato l'evento non si ripeteva mai; ora
     * si ripete, e al secondo passaggio la giacenza sarebbe salita due volte:
     * prodotti fantasma in vendita. Il segno è lo stato letto PRIMA di
     * scrivere: un ordine che risultava già 'LOST' la sua merce l'ha già avuta.
     */
    const giaChiusiPersi = new Set(
      orders.filter((o) => o.dispute_status === 'LOST').map((o) => o.id),
    );

    if (consegnati.length > 0) {
      scritturaObbligatoria(
        await admin
          .from('orders')
          .update({ dispute_status: 'LOST', payment_status: 'REFUNDED' })
          .in('id', consegnati),
        'contestazione persa sugli ordini consegnati',
      );
    }
    const scaffaleNonRiuscito: string[] = [];
    // 1/11/2026 — Una richiesta di informazioni diventata contestazione non
    // passa da handleDisputeCreated una seconda volta: il bonifico al negozio
    // non e' stato stornato. Persa la contestazione, va ripreso a mano.
    const nonStornati = orders.filter(
      (o) => o.payout_status === 'TRANSFERRED' && !giaChiusiPersi.has(o.id) && (o.dispute_seller_reversed_cents ?? 0) <= 0,
    );
    if (nonConsegnati.length > 0) {
      scritturaObbligatoria(
        await admin
          .from('orders')
          .update({
            dispute_status: 'LOST',
            delivery_status: 'CANCELED',
            payment_status: 'REFUNDED',
            canceled_at: new Date().toISOString(),
          })
          .in('id', nonConsegnati),
        'contestazione persa sugli ordini non consegnati',
      );
      for (const id of nonConsegnati) {
        if (giaChiusiPersi.has(id)) continue;
        // Qui non si lancia: l'ordine è già 'LOST', e un nuovo passaggio la
        // salterebbe. Il guasto va detto agli amministratori, qui sotto.
        const { error: errScaffale } = await admin.rpc('restore_stock_for_order', { p_order_id: id });
        if (errScaffale) {
          logger.error('[stripe] merce non rimessa a scaffale dopo la contestazione persa', {
            orderId: id, message: errScaffale.message,
          });
          scaffaleNonRiuscito.push(id);
        }
      }
    }
    await notifyAdmins(
      '✕ Chargeback perso',
      `Contestazione persa su ordine ${ids[0]}. ${consegnati.length > 0 ? 'La merce era gia stata consegnata: la giacenza non e stata toccata.' : 'Ordine annullato.'}` +
        (scaffaleNonRiuscito.length > 0
          ? ` La merce di ${scaffaleNonRiuscito.length} ordine/i non e tornata a scaffale: la giacenza va sistemata a mano.`
          : '') +
        (nonStornati.length > 0
          ? ` Nessuno storno al negozio registrato per questa contestazione su ${nonStornati.map((o) => `${o.id.slice(0, 8)} (${o.stripe_transfer_id ?? 'senza bonifico'})`).join(', ')}: la quota va ripresa a mano (Stripe → Connect → Trasferimenti → Storna).`
          : ''),
      '/admin/disputes',
    );
  } else if (dispute.status === 'warning_closed') {
    // 1/11/2026 — La richiesta di informazioni si chiude senza contestazione:
    // il bonifico fermo riparte. 'WON' e non vuoto, perche' il giro lo accetta
    // gia'. Solo dove e' ancora 'OPEN': un avviso ripetuto o in ritardo non
    // riscrive un esito vero.
    scritturaObbligatoria(
      await admin.from('orders').update({ dispute_status: 'WON' }).in('id', ids).eq('dispute_status', 'OPEN'),
      'richiesta di informazioni chiusa sugli ordini',
    );
    await notifyAdmins(
      'ℹ️ Richiesta di informazioni chiusa',
      `La banca ha chiuso la richiesta sull'ordine ${ids[0]} senza contestazione: il bonifico al negozio riparte al prossimo giro.`,
      '/admin/disputes',
    );
  } else {
    logger.info('[stripe] dispute.closed: stato non gestito', { status: dispute.status });
  }
}
