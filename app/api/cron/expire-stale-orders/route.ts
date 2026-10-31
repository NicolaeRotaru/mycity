import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
// L'avviso agli amministratori e' quello gia' usato dal giro dei bonifici e dal
// webhook: una casa sola, cosi' i tre percorsi non divergono.
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { ancoraNeiTempi } from '@/lib/ordini/scadenza-accettazione';
import { restaDaRimborsareSullaCarta } from '@/lib/ordini/soldi-sulla-carta';
import { ilCarrelloAspettaLaDivisione } from '@/lib/stripe/rimborsi-da-dividere';
import { avvisaIlClienteDellAnnullo, avvisaLaCampanellaDelCarrello, ricalcolaLaConsegnaDelGiro } from '@/lib/ordini/annulla';
import { righePerChiChiudeAMano, type ComeHaPagato } from '@/lib/email/annullo-nel-carrello';

/**
 * 6/9/2026 — QUALI RIMBORSI FALLITI HA SENSO RITENTARE.
 *
 * `refundOrder` marchia con `ritentabile: false` (classe
 * `RimborsoNonRitentabile`, in lib/stripe/payout.ts) gli errori che non
 * cambieranno mai esito: ordine gia' rimborsato per intero, niente da
 * rimborsare, ordine sparito. Leggiamo il marchio e non il testo del
 * messaggio apposta: una frase si riscrive senza accorgersene, e il giro
 * tornerebbe a rimbalzare per sempre. Leggiamo il campo e non il tipo perche'
 * l'errore attraversa il confine fra due moduli.
 */
function rimborsoSenzaRitorno(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { ritentabile?: unknown }).ritentabile === false;
}

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
 * 30/10/2026 (ondata 24) — NIENTE PIÙ FILTRO DELLE TRE ORE NELLA RICERCA.
 *
 * Qui c'era «fermo da almeno tre ore» come filtro SQL, perché la scadenza non cadeva mai prima.
 * Adesso sì: col negozio che ha gli orari, l'ordine su una fascia scade all'ultimo ritiro
 * possibile. Lunedì alle 12:00 da Pane Quotidiano (9-13, 16:30-19:30) per la «Oggi · 13:00–16:30»
 * l'ultimo ritiro è alle 12:45, e il filtro delle tre ore lo nascondeva fino alle 15:00 (poi la
 * fascia lo teneva vivo fino alle 16:30). Si leggono tutti gli ordini fermi in NEW, con gli orari
 * del negozio, e decide `ancoraNeiTempi` uno per uno: le tre ore restano il minimo per la veloce,
 * per gli ordini senza fascia e per i negozi senza orari.
 */
/** Gli orari del negozio letti insieme all'ordine (PostgREST: un oggetto, o una lista di uno). */
function orariDelNegozio(riga: unknown): unknown {
  const negozio = (riga as { seller?: unknown } | null)?.seller;
  const uno = Array.isArray(negozio) ? negozio[0] : negozio;
  return (uno as { store_hours?: unknown } | null | undefined)?.store_hours;
}

export const POST = withCronAuth(async (): Promise<NextResponse> => {
  const admin = getAdminSupabase();
  const cutoff = new Date().toISOString();

  const { data: candidates, error } = await admin
    .from('orders')
    // 27/8/2026 (R121) — `coupon_code` non veniva nemmeno letto, quindi il
    // codice sconto di un ordine che il negozio non ha mai accettato restava
    // bruciato: il cliente perdeva il buono senza aver comprato niente.
    // 3/9/2026 — `created_at` e `delivery_slot` non venivano nemmeno letti, e
    // sono i due campi che dicono se l'attesa è finita davvero: senza,
    // l'ordine della sera per domani mattina moriva alle 00:15.
    // 16/10/2026 — `internal_dispute_status`: la pausa del carrello, se c'è un
    // rimborso dal cruscotto ancora da dividere (più sotto).
    .select('id, user_id, payment_method, payment_status, stripe_payment_intent, total_price, wallet_applied_cents, coupon_code, created_at, delivery_slot, internal_dispute_status, seller:profiles!orders_seller_id_fkey ( store_hours )')
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
  /** Annullati con un rimborso impossibile: restano fermi, li chiude una persona. */
  let daChiudereAMano = 0;
  /** Lasciati in coda: sul loro pagamento c'è un rimborso dal cruscotto da dividere. */
  let inAttesaDellaDivisione = 0;

  for (const o of candidates ?? []) {
    // 3/9/2026 — L'ORDINE DELLA SERA PER DOMANI MORIVA NELLA NOTTE.
    //
    // Tre ore dalla nascita è la regola giusta per una consegna immediata. Per
    // un ordine con un appuntamento — «Domani · 9:00–12:00», scelto alle 21:15
    // perché la cassa da oggi lo accetta — vuol dire annullarlo alle 00:15, col
    // negozio chiuso e nessuno che potesse accettarlo. Finché la fascia
    // promessa non è passata l'ordine è ancora buono e non si tocca.
    // 30/10/2026 (ondata 24) — Con gli orari del negozio l'ordine su una fascia scade all'ultimo
    // ritiro possibile, non alla fine della fascia: nessuno può più ritirarlo.
    if (ancoraNeiTempi(o, new Date(), orariDelNegozio(o))) {
      rinviati++;
      continue;
    }

    // 16/10/2026 — Qui contava solo «PAID». Un rimborso parziale fatto dal
    // cruscotto Stripe porta l'ordine a «PARTIALLY_REFUNDED»: il giro lo
    // annullava come un contrassegno, senza rimborsare il resto. La regola è
    // la stessa dell'annullo (lib/ordini/soldi-sulla-carta.ts); quanto rendere
    // lo decide `refundOrder`, lordo meno già rimborsato.
    const isCardPaid = restaDaRimborsareSullaCarta(o);

    // 16/10/2026 (riesame del lotto) — PRIMA SI DIVIDE, POI SI ANNULLA.
    // Su un carrello di più negozi un rimborso dal cruscotto non è scritto su
    // nessun ordine finché qualcuno non lo divide: annullare adesso vorrebbe
    // dire rendere il lordo intero, compresa la parte già tornata al cliente.
    // L'ordine resta «nuovo» e non si tocca: lo riprende il giro dopo la
    // divisione, con i numeri giusti (lib/stripe/rimborsi-da-dividere.ts).
    if (isCardPaid && (await ilCarrelloAspettaLaDivisione(admin, o))) {
      inAttesaDellaDivisione++;
      logger.warn('[cron] expire-stale-orders: ordine lasciato in coda, il rimborso dal cruscotto va diviso prima', { id: o.id });
      continue;
    }

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

    // 30/10/2026 — Il negozio che non conferma in tempo esce dal giro: la consegna dei negozi rimasti
    // dello stesso carrello si rifà (consegna.negozio-che-rifiuta), e il rimborso rende il totale nuovo.
    const giro = await ricalcolaLaConsegnaDelGiro(admin, o.id);

    try {
      if (isCardPaid) {
        try {
          await refundOrder({
            orderId: o.id,
            amountCents: giro ? giro.totaleCents : Math.round(Number(o.total_price) * 100),
            reason: 'Ordine annullato: il venditore non lo ha accettato in tempo',
            notifyBuyer: true,
            // L'ordine l'ha annullato questo giro, qui sopra, e la merce non
            // l'ha ancora rimessa nessuno: anche se un rimborso parziale dal
            // cruscotto c'era già (lib/ordini/rimessa-a-scaffale.ts).
            annullatoDaChiChiama: true,
          });
          refunded++;
        } catch (errRimborso) {
          // 6/9/2026 — UN ORDINE CHE NON SI PUO' RIMBORSARE NON SI RIMETTE IN CODA.
          //
          // Rimettere in «nuovo» serve quando il rimborso puo' ancora riuscire:
          // Stripe che non risponde, un limite di richieste, un errore
          // passeggero. Se invece sull'ordine non c'e' piu' niente da
          // rimborsare — un reso lo aveva gia' chiuso, oppure il credito
          // MyCity copriva tutto — ogni tentativo fallira' allo stesso modo:
          // annullato, resuscitato, riannullato mezz'ora dopo, all'infinito. Il
          // negozio se lo vedeva in lista come da accettare, e l'unica traccia
          // era un numero nella risposta del giro che non guarda nessuno.
          //
          // Adesso quell'ordine resta annullato e un avviso arriva agli
          // amministratori: e' un lavoro da fare a mano, non da ritentare per
          // sempre. L'avviso parte una volta sola, perche' l'ordine non torna
          // fra i candidati del giro dopo.
          if (rimborsoSenzaRitorno(errRimborso)) {
            const motivo = errRimborso instanceof Error ? errRimborso.message : String(errRimborso);
            logger.error('[cron] expire-stale-orders: rimborso impossibile, ordine lasciato annullato', {
              id: o.id, message: motivo,
            });
            await notifyAdmins(
              'Ordine annullato da chiudere a mano',
              `L'ordine #${o.id.slice(0, 6).toUpperCase()} e' stato annullato perche' il negozio non lo ha accettato, ma il rimborso non puo' riuscire (${motivo}). Controlla su Stripe se il cliente ha gia' avuto i suoi soldi.` +
                // 30/10/2026 — Il carrello resta riscritto (l'ordine resta annullato): chi chiude a mano
                // deve sapere il conto nuovo, o rende il totale vecchio.
                (giro?.avviso ? ` ${righePerChiChiudeAMano(giro.avviso)}` : ''),
              '/admin/orders',
            ).catch((errAvviso) =>
              logger.error('[cron] expire-stale-orders: avviso agli amministratori non partito', {
                id: o.id, message: errAvviso instanceof Error ? errAvviso.message : String(errAvviso),
              }),
            );
            daChiudereAMano++;
            continue;
          }

          // 30/10/2026 (collaudo) — Prima la consegna del carrello torna com'era: l'ordine che rientra
          // in coda è di nuovo vivo, e col conto rifatto avrebbe 1 € di consegna e il fattorino a 0.
          if (giro) await giro.rimetti();

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

      // 27/10/2026 — La campanella si vede solo riaprendo il sito. Chi paga alla
      // consegna riceve anche la email; sulla carta l'ha gia' mandata refundOrder.
      // 30/10/2026 — Se la consegna del carrello si è rifatta, il cliente legge il conto nuovo degli
      // ordini rimasti: nell'email (sulla carta un'email in più, oltre al «Rimborso emesso») e nella campanella.
      const come: ComeHaPagato = isCardPaid ? 'carta' : o.payment_method === 'cod' ? 'contanti' : 'da-pagare';
      const carrello = giro?.avviso ? { avviso: giro.avviso, come } : null;
      if (!isCardPaid || carrello) {
        await avvisaIlClienteDellAnnullo(admin, o, "Il negozio non ha accettato l'ordine in tempo", carrello);
      }
      await avvisaLaCampanellaDelCarrello(admin, o.user_id, giro?.avviso, come);

      canceled++;
    } catch (e) {
      failed++;
      logger.error('[cron] expire-stale-orders: annullo fallito', {
        id: o.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (canceled > 0 || failed > 0 || daChiudereAMano > 0 || inAttesaDellaDivisione > 0) {
    logger.spesa(
      `[cron] expire-stale-orders: ${canceled} annullati (${refunded} rimborsati), ${failed} falliti, ${daChiudereAMano} da chiudere a mano, ` +
        `${inAttesaDellaDivisione} in attesa della divisione di un rimborso dal cruscotto`,
    );
  }

  return NextResponse.json(
    { ok: true, canceled, refunded, failed, rinviati, daChiudereAMano, inAttesaDellaDivisione },
    { status: 200 },
  );
});

// I lavori periodici di Vercel bussano in GET, sempre — non c'è modo di
// chiedergli un POST. Questa rotta nasceva POST-e-basta, dai tempi del cron
// esterno: su Vercel avrebbe risposto «405 metodo non ammesso» a ogni giro, e
// il lavoro non sarebbe mai partito. Stesso identico handler, stesso controllo
// del segreto: cambia solo la porta da cui si entra. Il POST resta valido
// perché il cron esterno continua a girare finché non lo spegni.
export const GET = POST;
