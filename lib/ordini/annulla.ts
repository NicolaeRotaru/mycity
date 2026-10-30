import type { SupabaseClient } from '@supabase/supabase-js';
import { refundOrder } from '@/lib/stripe/payout';
import { isStripeConfigured } from '@/lib/stripe/client';
import { logger } from '@/lib/logger';
import { restaDaRimborsareSullaCarta } from '@/lib/ordini/soldi-sulla-carta';
import { ilCarrelloAspettaLaDivisione } from '@/lib/stripe/rimborsi-da-dividere';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { sendEmail } from '@/lib/email/client';
import { ordineAnnullatoTemplate } from '@/lib/email/templates';
import { consegnaDopoLAnnullo, type RigaRicalcolata } from '@/lib/ordini/prezzi';
import { eConsegnaVeloce } from '@/lib/ordini/consegna-veloce';
// 30/10/2026 — Il ricalcolo dopo un annullo legge e scrive `gross_total_cents`, che esiste solo dopo
// la migrazione 124: senza ripiego, prima della 124 la lettura falliva intera e la regola del negozio
// che rifiuta non scattava (rimborso pieno, senza che nessuno lo sapesse).
import { CAMPI_124, conRipiegoSchema, senzaCampi, senzaColonne } from '@/lib/db/migrazione-124';
import {
  htmlDelCarrello,
  righeDelCarrello,
  type AvvisoDelCarrello,
  type ComeHaPagato,
} from '@/lib/email/annullo-nel-carrello';

/**
 * ANNULLARE UN ORDINE VUOL DIRE ANCHE RESTITUIRE I SOLDI.
 *
 * Difetto bloccante trovato dalla radiografia del 21/8/2026. L'annullamento del
 * cliente e il rifiuto del negozio passavano da due funzioni del database
 * (`cancel_order`, `seller_reject_order`) che facevano due cose sole: mettere
 * l'ordine in CANCELED e rimettere la merce a magazzino. Del denaro non si
 * occupava nessuno.
 *
 * Un ordine pagato con carta finiva annullato con i soldi ancora da noi. Il
 * cliente leggeva «Niente addebiti» e sull'estratto conto l'addebito c'era.
 * Nessun processo li restituiva: restavano finché qualcuno non se ne accorgeva
 * a mano. Stessa cosa per il credito MyCity speso sull'ordine.
 *
 * La logica giusta esisteva già, ma in un posto solo: la rotta di annullamento
 * dell'amministrazione. Era una copia unica dentro un percorso che il cliente
 * non attraversa mai. Ora sta qui, e la usano tutti e tre.
 */

export type EsitoAnnullo =
  | { ok: true; refundId: string | null }
  | {
      ok: false;
      motivo:
        | 'CONTANTI_INCASSATI'
        | 'STRIPE_NON_CONFIGURATO'
        | 'RIMBORSO_FALLITO'
        | 'ANNULLAMENTO_FALLITO'
        | 'GIA_ANNULLATO'
        // 16/10/2026 — sul pagamento c'è un rimborso dal cruscotto ancora da
        // dividere fra i negozi: quanto rendere si sa solo dopo la divisione.
        | 'RIMBORSO_DA_DIVIDERE';
      dettaglio?: string;
    };

/**
 * I campi che servono per decidere cosa fare dei soldi.
 *
 * 27/8/2026 (R121) — `coupon_code` MANCAVA, quindi il codice sconto non veniva
 * nemmeno letto: chi annullava restava senza buono senza aver comprato niente.
 */
export const COLONNE_ANNULLO =
  'id, user_id, seller_id, total_price, payment_method, payment_status, delivery_status, ' +
  'stripe_payment_intent, wallet_applied_cents, cash_confirmed_at, refunded_amount_cents, coupon_code, ' +
  // 6/9/2026 — La targa del CARRELLO. Un carrello con due negozi diventa due
  // ordini che portano lo stesso codice sconto, rivendicato una volta sola: per
  // sapere se restituirlo bisogna sapere se l'altro ordine lo tiene ancora.
  'stripe_session_id, ' +
  // 16/10/2026 — La pausa del carrello: un rimborso dal cruscotto ancora da
  // dividere fra i negozi (lib/stripe/rimborsi-da-dividere.ts).
  'internal_dispute_status';

export type OrdineDaAnnullare = {
  id: string;
  user_id: string;
  seller_id?: string | null;
  total_price: number | string;
  payment_method: string | null;
  payment_status: string | null;
  delivery_status: string | null;
  stripe_payment_intent: string | null;
  wallet_applied_cents?: number | null;
  cash_confirmed_at?: string | null;
  refunded_amount_cents?: number | null;
  coupon_code?: string | null;
  /** Sugli ordini con carta: la sessione di pagamento, cioè il carrello di origine. */
  stripe_session_id?: string | null;
  /** 'RIMBORSO_DA_RIPARTIRE' = sul pagamento c'è un rimborso dal cruscotto da dividere. */
  internal_dispute_status?: string | null;
};

/**
 * Porta l'ordine ad annullato e rimette a posto il denaro: rimborso sulla carta
 * se era pagato, credito MyCity restituito se ne era stato usato, merce a
 * magazzino. NON decide CHI può annullare: quello resta a chi la chiama.
 */
export async function annullaERimborsa(
  admin: SupabaseClient,
  order: OrdineDaAnnullare,
  opts: { reason: string; metadata?: Record<string, string>; motivoCredito?: string },
): Promise<EsitoAnnullo> {
  // 053 — Un ordine già rimborsato in parte ha stato 'PARTIALLY_REFUNDED':
  // trattarlo come «niente da rimborsare» lasciava indietro il residuo, cioè la
  // parte di soldi che il cliente non aveva mai riavuto. La regola sta in
  // lib/ordini/soldi-sulla-carta.ts: il giro degli ordini mai accettati usa la stessa.
  const isPaidCard = restaDaRimborsareSullaCarta(order);

  // Il credito MyCity speso sull'ordine torna al cliente: senza, l'annullamento
  // gli costa comunque quei soldi. Vale su entrambi i rami, carta compresa.
  // Non lancia mai: sul ramo carta viene chiamata a rimborso gia' emesso, e un
  // errore qui non deve far raccontare al chiamante che il rimborso e' fallito.
  async function restituisciCredito(): Promise<void> {
    const walletCents = Number(order.wallet_applied_cents ?? 0);
    if (walletCents <= 0) return;
    try {
      const { error: wErr } = await admin.rpc('wallet_credit', {
        p_user: order.user_id,
        p_cents: walletCents,
        p_reason: opts.motivoCredito ?? 'order_canceled',
        p_ref: order.id,
      });
      if (wErr) logger.warn('[annullaERimborsa] storno credito fallito', { orderId: order.id, err: wErr.message });
    } catch (err) {
      logger.warn('[annullaERimborsa] storno credito fallito', { orderId: order.id, err });
    }
  }

  /**
   * 27/8/2026 (R121) — IL CODICE SCONTO RESTAVA BRUCIATO.
   *
   * Il codice si consuma in modo atomico prima di creare l'ordine
   * (`claim_coupon`). La restituzione (`release_coupon`) esisteva, ma la
   * chiamavano solo il rifiuto del negozio e i rimbalzi del carrello: dal
   * 21/8 il pulsante «Annulla ordine» del cliente passa di qui, e di qui non
   * la chiamava nessuno. Il cliente perdeva il buono di benvenuto senza aver
   * comprato niente, e lo scopriva premendo «Applica» — cioè mentre stava
   * riprovando a ordinare.
   *
   * 3/9/2026 — «UNA RESTITUZIONE DI TROPPO NON FA DANNO» ERA FALSO.
   *
   * Qui c'era scritto: «`release_coupon` non scende mai sotto zero, quindi una
   * restituzione di troppo non fa danno: è un no-op». Vale solo quando il
   * contatore è già a zero. `greatest(0, uses_count - 1)` toglie un uso VERO
   * ogni volta che il contatore è ≥ 1: su un buono con tetto 2 usato da 2
   * ordini, una restituzione di troppo lo riporta a 0 e il buono accetta altri
   * 2 ordini — 4 sconti su un tetto di 2. Ogni uso in più è uno sconto che
   * nessuno ha deciso di regalare.
   *
   * Il difetto vero era il doppione nella rotta del rifiuto del negozio (tolto).
   * Ma la classe di errore resta finché `release_coupon` è un contatore globale
   * che non sa PER QUALE ORDINE la stanno chiamando: qualunque doppio percorso
   * di annullo la scala due volte.
   *
   * Perciò la chiamata porta anche l'id dell'ordine: la funzione del database
   * scala l'uso solo se `orders.coupon_released_at` è ancora vuoto, e lo marca
   * nella stessa istruzione (lo stesso schema di `claim_coupon`). La seconda
   * chiamata, da qualunque strada arrivi, non scala più niente.
   */
  /**
   * 6/9/2026 — IL CODICE TORNAVA IN CIRCOLO MENTRE UN ALTRO ORDINE LO USAVA ANCORA.
   *
   * Il codice si rivendica UNA volta per carrello (`claim_coupon`, in cassa), ma
   * ogni negozio del carrello diventa un ordine suo, e ognuno porta scritto
   * `coupon_code`. Annullare o farsi rifiutare l'ordine del negozio A
   * restituiva il codice PER INTERO mentre l'ordine del negozio B teneva ancora
   * lo sconto: un codice monouso tornava riutilizzabile, e le campagne «primi
   * 50» duravano piu' di 50.
   *
   * Qui si guarda se un altro ordine dello stesso carrello, non annullato, porta
   * ancora quel codice. In quel caso non si restituisce niente: lo fara'
   * l'ultimo ordine del carrello che se ne va.
   *
   * LIMITE DICHIARATO, e vale solo per i contanti: il carrello pagato alla
   * consegna non ha una targa sulle righe dell'ordine (la chiave del tentativo
   * vive in `cod_checkout_attempts`, e cercarla per ordine sarebbe una
   * scansione senza indice). Li' si restituisce come prima — meglio un uso
   * regalato che un cliente che perde il buono senza aver comprato (R121). La
   * chiusura completa vuole una colonna «carrello» sugli ordini: e' una
   * migrazione, quindi si firma a parte.
   */
  async function unAltroOrdineDelCarrelloTieneIlCodice(codice: string): Promise<boolean> {
    const carrello = order.stripe_session_id?.trim();
    if (!carrello) return false;
    try {
      const { data, error } = await admin
        .from('orders')
        .select('id')
        .eq('stripe_session_id', carrello)
        .eq('coupon_code', codice)
        .neq('id', order.id)
        .neq('delivery_status', 'CANCELED')
        .limit(1);
      if (error) {
        // Non si sa: si restituisce come prima. Un uso in piu' e' un costo
        // nostro, un buono perso e' un cliente che non ricompra.
        logger.warn('[annullaERimborsa] fratelli del carrello non letti', { orderId: order.id, err: error.message });
        return false;
      }
      return (data ?? []).length > 0;
    } catch (err) {
      logger.warn('[annullaERimborsa] fratelli del carrello non letti', { orderId: order.id, err });
      return false;
    }
  }

  async function restituisciCoupon(): Promise<void> {
    const codice = order.coupon_code?.trim();
    if (!codice) return;
    if (await unAltroOrdineDelCarrelloTieneIlCodice(codice)) {
      logger.info('[annullaERimborsa] codice sconto non restituito: un altro ordine dello stesso carrello lo tiene', {
        orderId: order.id,
      });
      return;
    }
    try {
      const { error: cErr } = await admin.rpc('release_coupon', { p_code: codice, p_order_id: order.id });
      if (!cErr) return;

      // La versione con la chiave per ordine non c'è ancora (migrazione non
      // applicata): si restituisce comunque, una volta sola, con la firma
      // vecchia. Perdere il buono senza aver comprato niente è il difetto R121,
      // e non deve tornare mentre si aspetta la firma sulla migrazione.
      //
      // Solo su PGRST202 («funzione inesistente»): è un errore di FORMA della
      // chiamata, quindi non può aver scritto niente. Su ogni altro errore non
      // si ritenta — un errore di rete può aver scalato l'uso davvero, e
      // riprovare lo scalerebbe due volte: esattamente il danno di cui sopra.
      if ((cErr as { code?: string }).code !== 'PGRST202') {
        logger.warn('[annullaERimborsa] codice sconto non restituito', { orderId: order.id, err: cErr.message });
        return;
      }
      const { error: senzaChiave } = await admin.rpc('release_coupon', { p_code: codice });
      if (senzaChiave) {
        logger.warn('[annullaERimborsa] codice sconto non restituito', { orderId: order.id, err: senzaChiave.message });
      }
    } catch (err) {
      logger.warn('[annullaERimborsa] codice sconto non restituito', { orderId: order.id, err });
    }
  }

  // Contanti già incassati dal fattorino: la restituzione è un fatto fisico e la
  // decide una persona. Annullare in silenzio lascerebbe il cliente senza merce
  // e senza soldi.
  if (order.payment_method === 'cod' && !!order.cash_confirmed_at) {
    return { ok: false, motivo: 'CONTANTI_INCASSATI' };
  }

  if (isPaidCard) {
    if (!isStripeConfigured()) return { ok: false, motivo: 'STRIPE_NON_CONFIGURATO' };

    // 16/10/2026 (riesame del lotto) — PRIMA SI DIVIDE, POI SI ANNULLA.
    // Su un carrello di più negozi un rimborso fatto dal cruscotto Stripe non
    // è scritto su nessun ordine finché non viene diviso: il residuo qui sotto
    // (lordo meno già rimborsato) lo ignorava, e si rendeva di nuovo tutto. Il
    // perché e il caso stanno in lib/stripe/rimborsi-da-dividere.ts.
    if (await ilCarrelloAspettaLaDivisione(admin, order)) {
      logger.warn('[annullaERimborsa] annullo fermo: c e un rimborso dal cruscotto da dividere', { orderId: order.id });
      try {
        await notifyAdmins(
          '⚠️ Annullo in attesa: prima va diviso il rimborso dal cruscotto',
          `Qualcuno ha chiesto di annullare l'ordine #${order.id.slice(0, 6).toUpperCase()}, pagato con la carta insieme ad altri negozi. ` +
            "Sullo stesso pagamento c'è un rimborso fatto dal cruscotto Stripe che non è ancora diviso fra i negozi: " +
            "finché non lo è, non si sa quanto rendere e l'ordine non si annulla. Dividilo dalla pagina Ordini, " +
            'riquadro «Rimborsi dal cruscotto da dividere», poi annulla di nuovo.',
          '/admin/orders',
        );
      } catch (err) {
        logger.error('[annullaERimborsa] avviso agli amministratori non partito', { orderId: order.id, err });
      }
      return { ok: false, motivo: 'RIMBORSO_DA_DIVIDERE' };
    }

    let giro: GiroDelCarrello | null = null;
    try {
      // 30/10/2026 — Prima si rifà la consegna dei negozi rimasti: il rimborso rende il totale nuovo.
      giro = await ricalcolaLaConsegnaDelGiro(admin, order.id);
      const totaleCent = giro ? giro.totaleCents : Math.round(Number(order.total_price) * 100);
      const giaRimborsato = Number(order.refunded_amount_cents ?? 0);
      const residuoCent = Math.max(0, totaleCent - giaRimborsato);
      const res = await refundOrder({
        orderId: order.id,
        amountCents: residuoCent,
        reason: opts.reason,
        metadata: opts.metadata,
        notifyBuyer: true,
      });
      // refundOrder ha già impostato CANCELED + canceled_at + payment_status.
      //
      // 28/8/2026 — IL CREDITO TORNA ANCHE QUI. Il rimborso sulla carta copre
      // `total_price`, che è il totale DOPO lo scomputo del credito MyCity: il
      // credito speso sull'ordine è un'altra somma, e su questo ramo non lo
      // restituiva nessuno. Un ordine da 30 € pagato con 20 € di credito e 10 €
      // di carta si annullava restituendo 10 €. La funzione del database che
      // faceva il rifiuto del negozio lo restituiva già: senza questa riga,
      // farlo passare di qui sarebbe un passo indietro per chi compra.
      await restituisciCredito();
      await restituisciCoupon();
      // 30/10/2026 — `refundOrder` manda «Rimborso emesso» con l'importo e basta: se la consegna del
      // carrello si è rifatta, il cliente riceve anche il perché dei 16 € su 18 e il conto della frutta.
      if (giro?.avviso) {
        await avvisaIlClienteDellAnnullo(admin, order, opts.reason, { avviso: giro.avviso, come: 'carta' });
        await avvisaLaCampanellaDelCarrello(admin, order.user_id, giro.avviso, 'carta');
      }
      return { ok: true, refundId: res.refundId };
    } catch (err) {
      logger.error('[annullaERimborsa] rimborso fallito', { orderId: order.id, err });
      // 30/10/2026 (collaudo) — Il rimborso non è partito e l'ordine resta vivo: la consegna del
      // carrello torna com'era. Senza, il pane restava a 1 € di consegna e il fattorino a 0.
      if (giro) await giro.rimetti();
      return { ok: false, motivo: 'RIMBORSO_FALLITO', dettaglio: err instanceof Error ? err.message : undefined };
    }
  }

  /**
   * 27/8/2026 (R131) — IL TURNO SI PRENDE CON LA SCRITTURA, NON PRIMA.
   *
   * L'UPDATE non aveva nessuna condizione sullo stato di partenza: la guardia
   * viveva solo nel `if` JavaScript dei chiamanti, e fra la lettura e la
   * scrittura non c'era niente. Due annulli sovrapposti — il giro degli ordini
   * fermi contro il pulsante del cliente, o un ritentativo di rete — passavano
   * tutti e due, e subito dopo `restore_stock_for_order` (una somma senza
   * guardia) e `wallet_credit` giravano due volte: su un ordine in contanti
   * pagato con 50 € di credito sono 50 € regalati, più pezzi di magazzino che
   * non esistono e che il negozio venderà.
   *
   * `.neq('delivery_status','CANCELED')` invece di un elenco di stati: chi
   * annulla resta chi annullava prima (il cliente solo da NEW, l'amministrazione
   * da qualunque stato non annullato) — quello che cambia è che a passare è
   * uno solo. Il secondo trova zero righe e se ne va senza toccare i soldi.
   */
  const { data: preso, error: updErr } = await admin
    .from('orders')
    .update({
      delivery_status: 'CANCELED',
      canceled_at: new Date().toISOString(),
      ...(order.payment_status === 'PENDING' ? { payment_status: 'FAILED' } : {}),
    })
    .eq('id', order.id)
    .neq('delivery_status', 'CANCELED')
    .select('id');
  if (updErr) return { ok: false, motivo: 'ANNULLAMENTO_FALLITO', dettaglio: updErr.message };
  if (!preso || preso.length === 0) return { ok: false, motivo: 'GIA_ANNULLATO' };

  await admin.rpc('restore_stock_for_order', { p_order_id: order.id });

  // 30/10/2026 — Coi contanti la consegna dei negozi rimasti si rifà: cambia quanto si paga alla porta.
  const giro = await ricalcolaLaConsegnaDelGiro(admin, order.id);

  await restituisciCredito();
  await restituisciCoupon();

  // 27/10/2026 — Sulla carta avvisa `refundOrder` («Rimborso emesso»). Qui,
  // contanti o pagamento mai completato, non avvisava nessuno per email.
  // 30/10/2026 — Se la consegna del carrello si è rifatta, la stessa email dice il conto nuovo degli
  // ordini rimasti («alla porta paghi 15 € invece di 13»), e lo dice anche la campanella.
  const come: ComeHaPagato = order.payment_method === 'cod' ? 'contanti' : 'da-pagare';
  await avvisaIlClienteDellAnnullo(admin, order, opts.reason, giro?.avviso ? { avviso: giro.avviso, come } : null);
  if (giro?.avviso) await avvisaLaCampanellaDelCarrello(admin, order.user_id, giro.avviso, come);

  return { ok: true, refundId: null };
}

/**
 * 27/10/2026 — L'ORDINE ANNULLATO SI DICE PER EMAIL ANCHE A CHI PAGA ALLA CONSEGNA.
 *
 * Sulla carta il cliente riceve «Rimborso emesso» da `refundOrder`. Sul
 * contrassegno non c'era niente da rimborsare, quindi niente email: restava la
 * campanella del sito e una push, che arriva solo a chi l'ha accesa. Chi aveva
 * ordinato il pane per la sera restava a casa ad aspettare il fattorino.
 *
 * E' un avviso sul SUO ordine: parte come transazionale, anche senza consenso
 * commerciale. Non lancia mai, perche' l'annullo e' gia' scritto e una posta
 * giu' non deve far credere al chiamante che sia fallito. Ma non tace: se la
 * email non parte, lo scrive nel registro degli errori col motivo.
 * La usano `annullaERimborsa` e il giro degli ordini scaduti.
 */
export async function avvisaIlClienteDellAnnullo(
  admin: SupabaseClient,
  ordine: { id: string; user_id: string | null; wallet_applied_cents?: number | null },
  motivo: string | null | undefined,
  carrello?: { avviso: AvvisoDelCarrello; come: ComeHaPagato } | null,
): Promise<boolean> {
  try {
    if (!ordine.user_id) return false;
    const { data, error } = await admin.auth.admin.getUserById(ordine.user_id);
    const email = data?.user?.email;
    if (error || !email) {
      logger.error('[annullo] email di annullo non spedita: indirizzo non letto', {
        orderId: ordine.id, message: error?.message ?? 'nessun indirizzo',
      });
      return false;
    }
    const t = ordineAnnullatoTemplate({
      orderId: ordine.id,
      motivo,
      creditoRestituitoEuro: Number(ordine.wallet_applied_cents ?? 0) / 100,
    });
    // 30/10/2026 — Il carrello rifatto: le righe con le cifre nuove, sotto il testo di sempre.
    const html = carrello
      ? t.html.includes('</body>')
        ? t.html.replace('</body>', `${htmlDelCarrello(carrello.avviso, carrello.come)}</body>`)
        : t.html + htmlDelCarrello(carrello.avviso, carrello.come)
      : t.html;
    const text = carrello ? `${t.text}\n\n${righeDelCarrello(carrello.avviso, carrello.come).join('\n')}` : t.text;
    const res = await sendEmail({
      to: email,
      subject: t.subject,
      html,
      text,
      tipo: 'transazionale',
      tags: [{ name: 'template', value: 'order_canceled' }],
    });
    if (!res.ok) {
      logger.error('[annullo] email di annullo NON partita', {
        orderId: ordine.id,
        motivo: 'reason' in res ? res.reason : 'error' in res ? String(res.error) : 'invio fallito',
      });
      return false;
    }
    return true;
  } catch (e) {
    logger.error('[annullo] email di annullo NON partita', {
      orderId: ordine.id, error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/**
 * 30/10/2026 — LA CAMPANELLA DICE IL CONTO NUOVO DEL CARRELLO.
 *
 * Le rotte che annullano scrivono già la loro campanella («ordine annullato», «rimborso emesso»);
 * questa ne aggiunge una sola quando la consegna degli altri ordini dello stesso carrello si è
 * rifatta, con le cifre. Non lancia mai: l'annullo è già scritto. Ma non tace: se non parte, lo
 * scrive nel registro degli errori.
 */
export async function avvisaLaCampanellaDelCarrello(
  admin: SupabaseClient,
  userId: string | null | undefined,
  avviso: AvvisoDelCarrello | null | undefined,
  come: ComeHaPagato,
): Promise<void> {
  if (!avviso || !userId) return;
  try {
    const { error } = await admin.from('notifications').insert({
      category: 'order',
      user_id: userId,
      title: 'Il conto del tuo carrello è cambiato',
      body: righeDelCarrello(avviso, come).join(' '),
      link: '/orders',
    });
    if (error) logger.error('[annullo] campanella del carrello NON scritta', { orderId: avviso.ordineId, message: error.message });
  } catch (e) {
    logger.error('[annullo] campanella del carrello NON scritta', {
      orderId: avviso.ordineId, error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * 30/10/2026 00:35 — L'ORDINE CHE SE NE VA PRIMA DELLA CONSEGNA RIFÀ LA CONSEGNA DEGLI ALTRI
 * (registro dei fatti, consegna.negozio-che-rifiuta). Il conto sta in `consegnaDopoLAnnullo`
 * (lib/ordini/prezzi.ts); qui si leggono gli ordini dello stesso carrello e si riscrivono.
 *
 * Una funzione sola per tutte le strade che annullano prima della consegna: `annullaERimborsa`
 * (rifiuto del negozio, annullo del cliente e dell'amministrazione) e il giro degli ordini scaduti.
 * Va chiamata PRIMA del rimborso: con la carta l'ordine annullato cede agli ordini rimasti la
 * differenza della consegna, e il rimborso (`refundOrder`, che rilegge l'ordine) rende il totale
 * nuovo. Pane 15 + frutta 12, il forno rifiuta: frutta 3 € di consegna e 3 € al fattorino, totale
 * 15 €; il forno rende 16 € invece di 18.
 *
 * Il carrello con la carta è la sessione di pagamento (`stripe_session_id`); quello in contanti è
 * il tentativo di cassa (`cod_checkout_attempts.order_ids`, gli id nell'ordine del carrello). Un
 * reso DOPO la consegna non passa di qui: la consegna è fatta e resta com'è. Per questo, se un
 * ordine del carrello è già consegnato, non si tocca niente.
 *
 * Non lancia mai: se non riesce a leggere il carrello, l'annullo va avanti com'era (rimborso pieno)
 * e resta l'errore nel registro. Ritorna il totale nuovo dell'ordine annullato, o null.
 *
 * 30/10/2026 (collaudo) — Tre regole, perché i soldi tornino giusti anche con due annulli insieme:
 * ① prima del conto l'ordine che se ne va mette il SEGNO (fattorino a 0): chi legge dopo vede un
 * conto fuori regola e non sposta niente su di lui; ② ogni riga si scrive solo se è ancora come la si
 * è letta, contando le righe toccate: se un altro è arrivato prima, quello già scritto torna indietro
 * e si rilegge; ③ si rende il totale scritto adesso, mai quello che il chiamante aveva in mano (il
 * giro degli scaduti rendeva 13 € invece di 15). Se poi il rimborso non parte, `rimetti` riporta il
 * carrello com'era: l'ordine resta vivo con la sua consegna e il suo fattorino.
 *
 * LIMITE DICHIARATO: le scritture sono una per riga, non una transazione. Se il database cade a metà
 * e non si riesce a tornare indietro, parte un avviso agli amministratori con l'ordine da sistemare.
 * La chiusura completa è una funzione nel database che fa tutto il carrello insieme (migrazione,
 * da firmare a parte).
 */
const COLONNE_GIRO =
  'id, user_id, delivery_status, total_price, gross_total_cents, wallet_applied_cents, shipping_cost, ' +
  'delivery_fee_cents, rider_fee_cents, discount_amount, delivery_slot, pickup_in_store, stripe_session_id, created_at, ' +
  'refunded_amount_cents';

type RigaDelGiro = {
  id: string;
  user_id: string;
  delivery_status: string | null;
  total_price: number | string | null;
  gross_total_cents: number | null;
  wallet_applied_cents: number | null;
  shipping_cost: number | string | null;
  delivery_fee_cents: number | null;
  rider_fee_cents: number | null;
  discount_amount: number | string | null;
  delivery_slot: string | null;
  pickup_in_store: boolean | null;
  stripe_session_id: string | null;
  created_at: string | null;
  refunded_amount_cents: number | null;
};

/** Le stesse colonne senza quelle della 124: prima della migrazione `lordoDi` rifà il lordo da totale e credito. */
const COLONNE_GIRO_PRIMA_DELLA_124 = senzaColonne(COLONNE_GIRO, CAMPI_124);
type Risposta = { data: unknown; error: unknown };
/** Ogni lettura del giro passa di qui: con la 124 legge il lordo scritto, senza fa lo stesso conto. */
const leggiIlGiro = (dove: string, q: (colonne: string) => PromiseLike<Risposta>) =>
  conRipiegoSchema<Risposta>(`annulla.${dove}`, () => q(COLONNE_GIRO), () => q(COLONNE_GIRO_PRIMA_DELLA_124));

const centesimi = (euro: number | string | null | undefined) => Math.round(Number(euro ?? 0) * 100);
const lordoDi = (r: RigaDelGiro) =>
  r.gross_total_cents != null ? Number(r.gross_total_cents) : centesimi(r.total_price) + Number(r.wallet_applied_cents ?? 0);

async function ordiniDelCarrello(admin: SupabaseClient, o: RigaDelGiro): Promise<RigaDelGiro[] | null> {
  const sessione = o.stripe_session_id?.trim();
  if (sessione) {
    const { data, error } = await leggiIlGiro('carrello-carta', (c) => admin.from('orders').select(c).eq('stripe_session_id', sessione));
    if (error || !Array.isArray(data)) return null;
    return (data as unknown as RigaDelGiro[]).sort(
      (x, y) => String(x.created_at ?? '').localeCompare(String(y.created_at ?? '')) || x.id.localeCompare(y.id),
    );
  }
  const { data: tentativi, error: errT } = await admin
    .from('cod_checkout_attempts')
    .select('order_ids')
    .eq('user_id', o.user_id)
    .contains('order_ids', JSON.stringify([{ id: o.id }]))
    .limit(1);
  if (errT || !Array.isArray(tentativi) || tentativi.length === 0) return null;
  const elenco = (tentativi[0] as { order_ids: unknown }).order_ids;
  const ids = Array.isArray(elenco)
    ? elenco.map((x) => (x && typeof x === 'object' ? String((x as { id?: unknown }).id ?? '') : String(x))).filter(Boolean)
    : [];
  if (ids.length < 2) return null;
  const { data, error } = await leggiIlGiro('carrello-contanti', (c) => admin.from('orders').select(c).in('id', ids));
  if (error || !Array.isArray(data)) return null;
  const righe = data as unknown as RigaDelGiro[];
  return ids.map((id) => righe.find((r) => r.id === id)).filter((r): r is RigaDelGiro => !!r);
}

/** Quello che `ricalcolaLaConsegnaDelGiro` consegna a chi annulla. */
export type GiroDelCarrello = {
  /** Il totale dell'ordine che se ne va, come sta scritto adesso: è quanto si rende sulla carta. */
  totaleCents: number;
  differenzaCents: number;
  /**
   * Rimette la consegna del carrello com'era. Va chiamata quando il rimborso non parte e l'ordine
   * resta vivo: senza, resterebbe con 1 € di consegna e il fattorino a 0. Torna false se il carrello
   * è cambiato nel frattempo (un rimborso già scritto, un altro annullo): allora lo dice agli
   * amministratori e non tocca niente.
   */
  rimetti: () => Promise<boolean>;
  /**
   * 30/10/2026 — Le cifre per il cliente e per chi chiude a mano: quanto torna dell'ordine che se ne
   * va e il conto nuovo di ogni ordine rimasto. null se la consegna del carrello non si è rifatta
   * (carrello di un negozio solo, ritiro in negozio, un ordine già consegnato): il testo resta quello di oggi.
   */
  avviso: AvvisoDelCarrello | null;
};

type ConsegnaScritta = { delivery_fee_cents: number; rider_fee_cents: number; gross_total_cents: number; total_price: number };
const consegnaDi = (r: RigaDelGiro): ConsegnaScritta => ({
  delivery_fee_cents: Number(r.delivery_fee_cents ?? 0),
  rider_fee_cents: Number(r.rider_fee_cents ?? 0),
  gross_total_cents: lordoDi(r),
  total_price: centesimi(r.total_price) / 100,
});

/**
 * Scrive una riga solo se è ancora come la si è letta — consegna, fattorino, stato e rimborsato —
 * e conta le righe toccate. Zero righe vuol dire che il carrello è cambiato sotto
 * mano: prima l'update tornava senza errore e si rendeva il totale vecchio.
 */
async function scriviSeUguale(
  admin: SupabaseClient,
  r: RigaDelGiro,
  da: ConsegnaScritta,
  a: ConsegnaScritta,
): Promise<boolean> {
  const scrivi = (valori: Partial<ConsegnaScritta>) => {
    let q = admin
      .from('orders')
      .update(valori)
      .eq('id', r.id)
      .eq('delivery_fee_cents', da.delivery_fee_cents)
      .eq('rider_fee_cents', da.rider_fee_cents);
    if (r.delivery_status != null) q = q.eq('delivery_status', r.delivery_status);
    if (r.refunded_amount_cents != null) q = q.eq('refunded_amount_cents', Number(r.refunded_amount_cents));
    return q.select('id');
  };
  // Prima della 124 il lordo non si scrive (la colonna non c'è): consegna, fattorino e totale sì.
  const { data, error } = await conRipiegoSchema<Risposta>('annulla.scriviSeUguale', () => scrivi(a), () => scrivi(senzaCampi(a, CAMPI_124)));
  if (error) throw new Error(`ordine ${r.id}: ${(error as { message?: string }).message ?? String(error)}`);
  return Array.isArray(data) && data.length > 0;
}

/** Un giro solo: 'CAMBIATO' se un'altra scrittura è arrivata prima (niente resta scritto). */
async function rifaiIlGiro(admin: SupabaseClient, orderId: string): Promise<GiroDelCarrello | null | 'CAMBIATO'> {
  const { data: lui, error } = await leggiIlGiro('ordine', (c) => admin.from('orders').select(c).eq('id', orderId).maybeSingle());
  if (error || !lui || typeof lui !== 'object') return null;
  const ordine = lui as unknown as RigaDelGiro;
  // Niente da rifare: si rende il totale letto adesso, non quello che il chiamante aveva in mano.
  const comE: GiroDelCarrello = { totaleCents: centesimi(ordine.total_price), differenzaCents: 0, rimetti: async () => true, avviso: null };
  if (ordine.pickup_in_store || ordine.delivery_status === 'DELIVERED') return comE;
  const nelCarrello = (c: RigaDelGiro[] | null): c is RigaDelGiro[] =>
    !!c && c.length >= 2 && c.some((r) => r.id === orderId) && !c.some((r) => r.delivery_status === 'DELIVERED');
  if (!nelCarrello(await ordiniDelCarrello(admin, ordine))) return comE;

  const scritte: Array<{ r: RigaDelGiro; prima: ConsegnaScritta; dopo: ConsegnaScritta }> = [];
  // Per primo il conto dell'ordine che se ne va: se il suo rimborso è già scritto
  // (`refunded_amount_cents` cambiato) la sua riga non torna e il resto non si tocca.
  // Poi i rimasti all'indietro, per ultimo il segno.
  const rimetti = async (): Promise<boolean> => {
    for (const s of [scritte[1], ...scritte.slice(2).reverse(), scritte[0]].filter((x) => !!x)) {
      const tornata = await scriviSeUguale(admin, s.r, s.dopo, s.prima).catch((err) => {
        logger.error('[ricalcolaLaConsegnaDelGiro] scrittura per rimettere il carrello caduta', { orderId, riga: s.r.id, err });
        return false;
      });
      if (tornata) continue;
      logger.error('[ricalcolaLaConsegnaDelGiro] consegna del carrello NON rimessa com era', { orderId, riga: s.r.id });
      await notifyAdmins(
        '⚠️ Carrello da sistemare a mano',
        `L'annullo dell'ordine #${orderId.slice(0, 6).toUpperCase()} non è andato a buon fine, ma la consegna degli altri ordini dello stesso carrello ` +
          `era già stata spostata e non si è potuta rimettere com'era (l'ordine #${s.r.id.slice(0, 6).toUpperCase()} è cambiato nel frattempo). ` +
          'Controlla consegna, fattorino e totale degli ordini del carrello prima che il negozio li accetti.',
        '/admin/orders',
      ).catch((err) => logger.error('[ricalcolaLaConsegnaDelGiro] avviso agli amministratori non partito', { orderId, err }));
      return false;
    }
    scritte.length = 0;
    return true;
  };
  const passo = async (r: RigaDelGiro, da: ConsegnaScritta, a: ConsegnaScritta): Promise<boolean> => {
    if (!(await scriviSeUguale(admin, r, da, a))) return false;
    scritte.push({ r, prima: da, dopo: a });
    return true;
  };

  let tutto = false;
  let conto: ReturnType<typeof consegnaDopoLAnnullo> = null;
  let carrello: RigaDelGiro[] | null = null;
  try {
    // 1. IL SEGNO, PRIMA DEL CONTO: il fattorino a 0 sull'ordine che se ne va. Ogni altro annullo
    //    dello stesso carrello che legge dopo vede un conto che non è quello della regola e non
    //    tocca niente; chi aveva letto prima trova la riga cambiata e rilegge. Senza, due annulli
    //    quasi insieme si leggevano a vicenda e il secondo rendeva 13 € invece di 15.
    const comEra = consegnaDi(ordine);
    const segno: ConsegnaScritta = { ...comEra, rider_fee_cents: 0 };
    if (!(await passo(ordine, comEra, segno))) return 'CAMBIATO';

    // 2. Il conto sul carrello letto DOPO il segno; l'ordine che se ne va col conto di prima.
    carrello = await ordiniDelCarrello(admin, ordine);
    if (nelCarrello(carrello)) {
      conto = consegnaDopoLAnnullo({
        ordini: carrello.map((c) => {
          const r = c.id === orderId ? ordine : c;
          const consegna = Number(r.delivery_fee_cents ?? 0);
          const spedizione = centesimi(r.shipping_cost);
          const merce = lordoDi(r) - consegna - spedizione;
          return {
            id: r.id,
            spesaCents: merce + centesimi(r.discount_amount),
            merceCents: merce,
            shippingCents: spedizione,
            deliveryFeeCents: consegna,
            riderFeeCents: Number(r.rider_fee_cents ?? 0),
            giaAnnullato: r.delivery_status === 'CANCELED' && r.id !== orderId,
          };
        }),
        annullaId: orderId,
        consegnaVeloce: eConsegnaVeloce({ fascia: ordine.delivery_slot, ritiroInNegozio: false }),
        pickupInStore: false,
      });
    }
    // Niente da spostare: resta il segno (l'ordine se ne va comunque), che `rimetti` toglie.
    if (!conto) return { ...comE, rimetti };

    // 3. Prima l'ordine che se ne va (il rimborso scende), poi quelli che restano.
    const verso = (r: RigaDelGiro, da: ConsegnaScritta, riga: RigaRicalcolata): ConsegnaScritta => ({
      delivery_fee_cents: riga.deliveryFeeCents,
      rider_fee_cents: riga.riderFeeCents,
      gross_total_cents: da.gross_total_cents + riga.deltaCents,
      total_price: Math.max(0, centesimi(r.total_price) + riga.deltaCents) / 100,
    });
    tutto = await passo(ordine, segno, verso(ordine, segno, conto.annullato));
    for (const riga of conto.rimasti) {
      if (!tutto) break;
      const r = carrello?.find((c) => c.id === riga.id);
      if (r && (riga.deltaCents !== 0 || riga.riderFeeCents !== Number(r.rider_fee_cents ?? 0))) {
        tutto = await passo(r, consegnaDi(r), verso(r, consegnaDi(r), riga));
      }
    }
  } catch (err) {
    // Una scrittura a metà non resta: si torna indietro, e si rende il totale com'era.
    logger.error('[ricalcolaLaConsegnaDelGiro] consegna del carrello NON rifatta: rimborso pieno', { orderId, err });
    return (await rimetti()) ? comE : null;
  }
  if (!tutto || !conto) return (await rimetti()) ? 'CAMBIATO' : null;

  logger.info('[ricalcolaLaConsegnaDelGiro] consegna rifatta sui negozi rimasti', {
    orderId, differenzaCents: conto.differenzaCents, rimasti: conto.rimasti.length,
  });
  const tornaCents = Math.round(scritte[1].dopo.total_price * 100);
  const rimasti = conto.rimasti
    .map((riga) => carrello?.find((c) => c.id === riga.id))
    .filter((r): r is RigaDelGiro => !!r)
    .map((r) => {
      const prima = consegnaDi(r);
      const dopo = scritte.find((s) => s.r.id === r.id)?.dopo ?? prima;
      return {
        ordineId: r.id,
        consegnaPrimaCents: prima.delivery_fee_cents,
        consegnaCents: dopo.delivery_fee_cents,
        totalePrimaCents: Math.round(prima.total_price * 100),
        totaleCents: Math.round(dopo.total_price * 100),
      };
    });
  const consegnaCents = scritte[1].dopo.delivery_fee_cents;
  // La spesa si dice pulita solo senza credito né spedizione: con quelli il totale non è merce + consegna.
  const pulita = Number(ordine.wallet_applied_cents ?? 0) === 0 && centesimi(ordine.shipping_cost) === 0;
  return {
    totaleCents: tornaCents,
    differenzaCents: conto.differenzaCents,
    rimetti,
    avviso: {
      ordineId: orderId,
      pagatoCents: centesimi(ordine.total_price),
      tornaCents,
      consegnaCents,
      spesaCents: pulita ? tornaCents - consegnaCents : null,
      negoziRimasti: conto.rimasti.length,
      rimasti,
    },
  };
}

export async function ricalcolaLaConsegnaDelGiro(admin: SupabaseClient, orderId: string): Promise<GiroDelCarrello | null> {
  try {
    // Se un altro annullo dello stesso carrello scrive fra la lettura e la scrittura, si rilegge.
    for (let volta = 0; volta < 3; volta++) {
      const esito = await rifaiIlGiro(admin, orderId);
      if (esito !== 'CAMBIATO') return esito;
    }
    logger.error('[ricalcolaLaConsegnaDelGiro] il carrello cambia a ogni lettura: consegna NON rifatta', { orderId });
    const { data } = await admin.from('orders').select('total_price').eq('id', orderId).maybeSingle();
    if (!data) return null;
    return {
      totaleCents: centesimi((data as { total_price: number | string | null }).total_price),
      differenzaCents: 0,
      rimetti: async () => true,
      avviso: null,
    };
  } catch (err) {
    logger.error('[ricalcolaLaConsegnaDelGiro] consegna del carrello NON rifatta: rimborso pieno', { orderId, err });
    return null;
  }
}
