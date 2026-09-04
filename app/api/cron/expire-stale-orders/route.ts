import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
import { ORE_PER_ACCETTARE, ancoraNeiTempi } from '@/lib/ordini/scadenza-accettazione';

export const runtime = 'nodejs';

/**
 * Cron: chiude gli ordini ORFANI fermi in NEW che il venditore non ha mai
 * accettato (es. ordine piazzato di notte). Senza questo restano in limbo a
 * tempo indefinito: nessuno stato di prodotto, stock bloccato, buyer all'oscuro.
 *
 * Quando un ordine è «fermo» lo decide `lib/ordini/scadenza-accettazione.ts`,
 * non l'orologio da solo: se la consegna è promessa per una fascia, l'attesa
 * finisce quando finisce quella fascia. Prima l'ordine della sera per domani
 * mattina veniva annullato alle 00:15, col negozio chiuso.
 *
 * Policy (audit 🟠-16): oltre la scadenza, ancora in NEW →
 *  - claim atomico NEW → CANCELED (idempotente: nessun doppio annullo/rimborso);
 *  - card pagato: rimborso reale via refundOrder (Stripe refund + ripristino
 *    stock + email buyer; reversal no-op perché il payout è ancora HELD);
 *  - COD / non pagato: ripristino stock (restore_stock_for_order);
 *  - storno dell'eventuale credito wallet speso (wallet_credit);
 *  - notifica in-app al buyer.
 *
 * Idempotente: la transizione di stato condizionata fa sì che ogni ordine sia
 * processato una sola volta anche se il cron si sovrappone.
 *
 * Cadenza: ogni 30 minuti. Chi la fa partire sta in `vercel.json` → `crons`.
 * A mano si chiama così:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/expire-stale-orders
 */

/**
 * Ore in NEW sotto le quali un ordine non si tocca MAI.
 *
 * 3/9/2026 — non è più tutta la regola, è solo il minimo. Chi decide davvero è
 * `scadenzaAccettazione`, che guarda la fascia di consegna: questo filtro serve
 * a non tirare su dal database ordini che di sicuro non sono ancora scaduti, e
 * il numero è lo stesso di là apposta (se qui fosse più grande, il cron
 * salterebbe ordini da annullare).
 */
const STALE_NEW_ORDER_HOURS = ORE_PER_ACCETTARE;

export const POST = withCronAuth(async (): Promise<NextResponse> => {
  const admin = getAdminSupabase();
  const cutoff = new Date(Date.now() - STALE_NEW_ORDER_HOURS * 3_600_000).toISOString();

  const { data: candidates, error } = await admin
    .from('orders')
    // 27/8/2026 (R121) — `coupon_code` non veniva nemmeno letto, quindi il
    // codice sconto di un ordine che il negozio non ha mai accettato restava
    // bruciato: il cliente perdeva il buono senza aver comprato niente.
    // 3/9/2026 — `created_at` e `delivery_slot` non venivano nemmeno letti, e
    // sono i due campi che dicono se l'attesa è finita davvero: senza,
    // l'ordine della sera per domani mattina moriva alle 00:15.
    .select('id, user_id, payment_method, payment_status, stripe_payment_intent, total_price, wallet_applied_cents, coupon_code, created_at, delivery_slot')
    .eq('delivery_status', 'NEW')
    .lt('created_at', cutoff)
    .limit(100);

  if (error) {
    logger.error('[cron] expire-stale-orders: select fallita', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let canceled = 0;
  let refunded = 0;
  let failed = 0;
  let rinviati = 0;

  for (const o of candidates ?? []) {
    // 3/9/2026 — L'ORDINE DELLA SERA PER DOMANI MORIVA NELLA NOTTE.
    //
    // Tre ore dalla nascita è la regola giusta per una consegna immediata. Per
    // un ordine con un appuntamento — «Domani · 9:00–12:00», scelto alle 21:15
    // perché la cassa da oggi lo accetta — vuol dire annullarlo alle 00:15, col
    // negozio chiuso e nessuno che potesse accettarlo. Finché la fascia
    // promessa non è passata l'ordine è ancora buono e non si tocca.
    if (ancoraNeiTempi(o)) {
      rinviati++;
      continue;
    }

    const isCardPaid =
      o.payment_method === 'card' && o.payment_status === 'PAID' && !!o.stripe_payment_intent;

    // Il blocco atomico resta (solo una esecuzione prende l'ordine), ma se il
    // rimborso non riesce l'ordine TORNA in coda.
    //
    // Prima non tornava: si annullava, si chiedeva il rimborso, e se Stripe non
    // rispondeva — un timeout, un 5xx, un limite di richieste — l'errore veniva
    // contato e si passava al prossimo. Al giro dopo l'ordine non era piu' in
    // NEW, quindi la ricerca dei candidati non lo ripescava mai: annullato e mai
    // rimborsato, coi soldi del cliente fermi e nessuno che se ne accorgesse.
    const { data: claimed, error: claimErr } = await admin
      .from('orders')
      .update({
        delivery_status: 'CANCELED',
        canceled_at: new Date().toISOString(),
        // 30/8/2026 (R126) — Lo stesso fatto lasciava due forme diverse nel
        // database. Quando e' il cliente ad annullare, `annullaERimborsa` porta
        // il pagamento da «in attesa» a «fallito». Qui no: un contrassegno che
        // il negozio non ha mai accettato restava «in attesa di pagamento» per
        // sempre, e chi conta gli incassi vedeva una coda che non esisteva.
        // La riga e' la stessa di lib/ordini/annulla.ts, apposta.
        ...(o.payment_status === 'PENDING' ? { payment_status: 'FAILED' } : {}),
      })
      .eq('id', o.id)
      .eq('delivery_status', 'NEW')
      .select('id');
    if (claimErr) {
      failed++;
      logger.error('[cron] expire-stale-orders: claim fallito', { id: o.id, message: claimErr.message });
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    try {
      if (isCardPaid) {
        try {
          await refundOrder({
            orderId: o.id,
            amountCents: Math.round(Number(o.total_price) * 100),
            reason: 'Ordine annullato: il venditore non lo ha accettato in tempo',
            notifyBuyer: true,
          });
          refunded++;
        } catch {
          // Rimetti l'ordine in coda: il prossimo giro riprovera'. Senza questo
          // resterebbe annullato e non rimborsato per sempre.
          const { error: errRipristino } = await admin
            .from('orders')
            .update({ delivery_status: 'NEW', canceled_at: null })
            .eq('id', o.id)
            .eq('delivery_status', 'CANCELED');
          if (errRipristino) {
            logger.error('[cron] expire-stale-orders: ordine annullato e NON rimborsato, fuori dalla coda', {
              id: o.id, message: errRipristino.message,
            });
          } else {
            logger.warn('[cron] expire-stale-orders: rimborso fallito, ordine rimesso in coda', { id: o.id });
          }
          failed++;
          continue;
        }
      } else {
        // COD o non pagato: niente da rimborsare, solo il ripristino della merce.
        const { error: rErr } = await admin.rpc('restore_stock_for_order', { p_order_id: o.id });
        if (rErr) logger.warn('[cron] expire-stale-orders: restore_stock fallito', { id: o.id, message: rErr.message });
      }

      // Storno del credito wallet eventualmente speso (entrambi i percorsi).
      const walletCents = Number(o.wallet_applied_cents ?? 0);
      if (walletCents > 0) {
        const { error: wErr } = await admin.rpc('wallet_credit', {
          p_user: o.user_id,
          p_cents: walletCents,
          p_reason: 'order_auto_canceled',
          p_ref: o.id,
        });
        if (wErr) logger.warn('[cron] expire-stale-orders: storno wallet fallito', { id: o.id, message: wErr.message });
      }

      // 27/8/2026 (R121) — Il codice sconto torna disponibile. Il turno
      // sull'ordine e' gia' stato preso qui sopra, quindi la restituzione
      // avviene una volta sola; `release_coupon` non scende comunque sotto zero.
      const codice = (o as { coupon_code?: string | null }).coupon_code?.trim();
      if (codice) {
        const { error: cErr } = await admin.rpc('release_coupon', { p_code: codice });
        if (cErr) logger.warn('[cron] expire-stale-orders: codice sconto non restituito', { id: o.id, message: cErr.message });
      }

      // Notifica in-app al buyer (best-effort: non deve far fallire l'annullo).
      await admin.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
        user_id: o.user_id,
        title: 'Ordine annullato',
        body: `L'ordine #${o.id.slice(0, 6).toUpperCase()} è stato annullato: il negozio non lo ha accettato in tempo.${isCardPaid ? ' Il rimborso è in corso.' : ''}`,
        link: '/orders',
      });

      canceled++;
    } catch (e) {
      failed++;
      logger.error('[cron] expire-stale-orders: annullo fallito', {
        id: o.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (canceled > 0 || failed > 0) {
    logger.spesa(`[cron] expire-stale-orders: ${canceled} annullati (${refunded} rimborsati), ${failed} falliti`);
  }

  return NextResponse.json({ ok: true, canceled, refunded, failed, rinviati }, { status: 200 });
});

// I lavori periodici di Vercel bussano in GET, sempre — non c'è modo di
// chiedergli un POST. Questa rotta nasceva POST-e-basta, dai tempi del cron
// esterno: su Vercel avrebbe risposto «405 metodo non ammesso» a ogni giro, e
// il lavoro non sarebbe mai partito. Stesso identico handler, stesso controllo
// del segreto: cambia solo la porta da cui si entra. Il POST resta valido
// perché il cron esterno continua a girare finché non lo spegni.
export const GET = POST;
