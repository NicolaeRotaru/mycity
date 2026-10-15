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
import { reverseOrderTransfer, reverseRiderTransfer } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';
import { findOrdersForDispute, notifyAdmins } from './comune';
import { scritturaObbligatoria } from './esito';

/**
 * charge.dispute.created → chargeback aperto. Stripe ha GIÀ prelevato i fondi
 * dalla piattaforma, quindi NON emettiamo refund (sarebbe doppio): facciamo
 * solo claw-back del transfer se il venditore era già stato pagato, flagghiamo
 * gli ordini (dispute_status='OPEN' blocca il payout cron) e avvisiamo gli admin.
 */
export async function handleDisputeCreated(dispute: Stripe.Dispute) {
  const orders = await findOrdersForDispute(
    dispute,
    // R052 — serve anche il lordo dell'ordine: la quota da riprendere al
    // negozio si calcola in proporzione a quanto la banca ha contestato.
    'id, payout_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id, gross_total_cents, total_price, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_fee_cents, shipping_cost',
  );
  if (orders.length === 0) {
    logger.warn('[stripe] dispute.created: nessun ordine trovato', { disputeId: dispute.id });
    return;
  }

  const admin = getAdminSupabase();

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

  for (const o of orders) {
    // 22/8/2026 — SI TIENE DA PARTE QUANTO TORNA INDIETRO PER **QUESTA**
    // CONTESTAZIONE. Alla chiusura vinta il totale stornato veniva azzerato, e
    // dentro quel totale poteva esserci anche un reso rimborsato settimane
    // prima: il negozio si faceva ripagare una cosa che aveva gia' reso. Con
    // questo numero da parte, alla chiusura si sottrae invece di azzerare.
    let stornatoVenditore = 0;
    if (o.payout_status === 'TRANSFERRED') {
      try {
        const esito = await reverseOrderTransfer(o, quotaDaRiprendere(o));
        stornatoVenditore = esito.reversedCents;
      } catch (e) {
        logger.error('[stripe] reversal on dispute.created failed', { orderId: o.id, e });
      }
    }
    // Anche il compenso del fattorino torna indietro: senza questo la
    // piattaforma restituisce l'incasso al cliente e paga la consegna da se'.
    let stornatoFattorino = 0;
    try {
      const esito = await reverseRiderTransfer(o);
      stornatoFattorino = esito.reversedCents;
    } catch (e) {
      logger.error('[stripe] recupero compenso rider su contestazione fallito', { orderId: o.id, e });
    }

    if (stornatoVenditore > 0 || stornatoFattorino > 0) {
      const valori = {
        dispute_seller_reversed_cents: stornatoVenditore,
        dispute_rider_reversed_cents: stornatoFattorino,
      };
      // Prima che la migrazione 126 sia applicata le colonne non ci sono e
      // l'aggiornamento fallisce: si annota e si tira dritto. Perdere il
      // promemoria e' il comportamento di ieri; perdere la registrazione della
      // contestazione no.
      const { error: errPromemoria } = await admin.from('orders').update(valori).eq('id', o.id);
      if (errPromemoria) {
        logger.warn('[stripe] storni della contestazione non annotati (migrazione 126 non applicata?)', {
          orderId: o.id, message: errPromemoria.message,
        });
      }
    }
  }

  /**
   * 15/10/2026 (R81) — È LA RIGA CHE FERMA IL GIRO DEI BONIFICI.
   *
   * Il giro paga solo gli ordini con `dispute_status` vuoto o 'WON'. Se questa
   * scrittura fallisce (un timeout del database) e nessuno lo legge, la rotta
   * risponde 200, Stripe non riprova, e al giro dopo il negozio viene pagato
   * su soldi che la banca si è già ripresa. Adesso il gestore fallisce e
   * Stripe ripete l'evento. Ripeterlo è sicuro: gli storni qui sopra ripartono
   * dallo stato scritto nel database, quindi uno storno già registrato non si
   * rifà, e uno non registrato si richiede con la stessa chiave anti-doppione,
   * cioè Stripe restituisce lo stesso storno invece di farne un altro.
   */
  scritturaObbligatoria(
    await admin
      .from('orders')
      .update({ dispute_status: 'OPEN', disputed_at: new Date().toISOString() })
      .in('id', orders.map((o) => o.id)),
    'contestazione aperta sugli ordini',
  );

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
export async function handleDisputeClosed(dispute: Stripe.Dispute) {
  // `dispute_status` serve a non rimettere a scaffale due volte la merce se
  // Stripe ripete l'evento di una contestazione già chiusa come persa (R81).
  const orders = await findOrdersForDispute(dispute, 'id, dispute_status, delivery_status, payout_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id, payout_tentativo, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_payout_tentativo, rider_fee_cents, shipping_cost');
  if (orders.length === 0) return;
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
        // numero non c'e' (contestazione aperta prima della migrazione 126) si
        // ricade sul comportamento di prima: e' il caso peggiore di ieri, non
        // un peggioramento.
        const stornatoPerLaContestazione =
          (o as { dispute_seller_reversed_cents?: number }).dispute_seller_reversed_cents ??
          (o.seller_payout_reversed_cents ?? 0);
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
          await conRipiegoSchema(
            'orders.update (contestazione vinta, venditore)',
            () => admin.from('orders').update(valori).eq('id', o.id),
            () => admin.from('orders').update(senzaCampi(valori, ['payout_tentativo', 'dispute_seller_reversed_cents'])).eq('id', o.id),
          ),
          'bonifico al negozio rimesso in coda dopo la contestazione vinta',
        );
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
        const stornatoPerLaContestazione =
          (o as { dispute_rider_reversed_cents?: number }).dispute_rider_reversed_cents ??
          (o.rider_payout_reversed_cents ?? 0);
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
          await conRipiegoSchema(
            'orders.update (contestazione vinta, fattorino)',
            () => admin.from('orders').update(valori).eq('id', o.id),
            () => admin.from('orders').update(senzaCampi(valori, ['rider_payout_tentativo', 'dispute_rider_reversed_cents'])).eq('id', o.id),
          ),
          'compenso del fattorino rimesso in coda dopo la contestazione vinta',
        );
      }
      logger.info('[stripe] contestazione vinta: compensi fattorino rimessi in coda', {
        ordini: riderDaRipagare.length,
      });
    }

    await notifyAdmins('✓ Chargeback vinto', `Contestazione vinta su ordine ${ids[0]}. Payout rimesso in coda.`, '/admin/disputes');
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
          : ''),
      '/admin/disputes',
    );
  } else {
    logger.info('[stripe] dispute.closed: stato non gestito', { status: dispute.status });
  }
}
