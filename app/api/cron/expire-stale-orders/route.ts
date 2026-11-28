import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { conFilaPerRichiesta } from '@/lib/api/fila-per-richiesta';
import { withCronAuth } from '@/lib/api/middleware';
import { chiamataDelCalendarioFerma, rispostaDelFermo } from '@/lib/cron/fermo-dei-lavori';
import { refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
// L'avviso agli amministratori e' quello gia' usato dal giro dei bonifici e dal
// webhook: una casa sola, cosi' i tre percorsi non divergono.
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { ancoraNeiTempi } from '@/lib/ordini/scadenza-accettazione';
import { restaDaRimborsareSullaCarta } from '@/lib/ordini/soldi-sulla-carta';
import { ilCarrelloAspettaLaDivisione } from '@/lib/stripe/rimborsi-da-dividere';
import { avvisaIlClienteDelRimborso, avvisaIlClienteDellAnnullo, avvisaIlNegozioDellAnnullo, avvisaLaCampanellaDelCarrello, ricalcolaLaConsegnaDelGiro, restituisciIlCodiceDellOrdine, restituisciIlCreditoDellOrdine } from '@/lib/ordini/annulla';
import { ApiErrors } from '@/lib/api/responses';
import { righePerChiChiudeAMano, type AvvisoDelCarrello, type ComeHaPagato } from '@/lib/email/annullo-nel-carrello';
import { scriviCampanella } from '@/lib/ordini/campanella';

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
 * 26/11/2026 — Dopo quanto una riserva della cassa in contanti senza articoli e'
 * di una funzione morta. E' la vita della riserva della carta
 * (`pending_checkouts.expires_at`, migrazione 042: due ore), molto piu' lunga di
 * qualunque giro della cassa: una cassa ancora al lavoro non perde la sua merce.
 */
const RISERVA_ORFANA_DOPO_MINUTI = 120;

/**
 * R06-006 — La lettura degli ordini fermi in NEW: a pagine da cento, dai più vecchi, finché non si
 * trovano cento scaduti o non si sono lette venti pagine (duemila ordini fermi).
 */
const PAGINA_CANDIDATI = 100;
const PAGINE_MASSIME = 20;
const SCADUTI_PER_GIRO = 100;

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

/**
 * 21/11/2026 (R04-018) — SE IL CARRELLO SCADE TUTTO NELLO STESSO GIRO, IL CLIENTE LEGGE LE CIFRE FINALI.
 *
 * Ogni ordine scaduto rifà la consegna degli altri ordini del suo carrello, e il suo avviso al cliente
 * («il conto del tuo carrello è cambiato») dice le cifre di quel momento. Pane e frutta scaduti nello
 * stesso giro: l'avviso del pane diceva «la frutta ora costa 15 € invece di 13», e un attimo dopo la
 * frutta era annullata anche lei. Ora gli avvisi al cliente partono a fine giro: un ordine annullato
 * anche lui nel giro non si nomina fra quelli che restano; un ordine che resta si dice una volta sola,
 * nell'ultimo avviso che lo nomina, con le cifre di prima del giro e quelle finali; e la cifra «della
 * conferma» di un ordine che il giro aveva già cambiato è quella di prima del giro. Senza ordini che
 * restano, la campanella «il conto è cambiato» non parte, e nell'email resta solo la riga dell'ordine.
 */
function avvisoAFineGiro(
  a: AvvisoDelCarrello,
  tutti: AvvisoDelCarrello[],
  spediti: AvvisoDelCarrello[],
  annullati: ReadonlySet<string>,
): AvvisoDelCarrello {
  const con = (lista: AvvisoDelCarrello[], id: string) => lista.filter((x) => x.rimasti.some((r) => r.ordineId === id));
  const riga = (x: AvvisoDelCarrello | undefined, id: string) => x?.rimasti.find((r) => r.ordineId === id);
  const rimasti = a.rimasti
    .filter((r) => !annullati.has(r.ordineId) && con(spediti, r.ordineId).at(-1) === a)
    .map((r) => {
      const prima = riga(con(tutti, r.ordineId)[0], r.ordineId) ?? r;
      const dopo = riga(con(tutti, r.ordineId).at(-1), r.ordineId) ?? r;
      return { ...dopo, consegnaPrimaCents: prima.consegnaPrimaCents, totalePrimaCents: prima.totalePrimaCents };
    });
  const comeLui = riga(con(tutti, a.ordineId)[0], a.ordineId);
  return { ...a, pagatoCents: comeLui ? comeLui.totalePrimaCents : a.pagatoCents, negoziRimasti: rimasti.length, rimasti };
}

const postSenzaFila = withCronAuth(async (req): Promise<NextResponse> => {
  // 31/10/2026 — Il fermo dei lavori a orario: dopo il segreto, prima di tutto il resto (lib/cron/fermo-dei-lavori.ts).
  if (chiamataDelCalendarioFerma(req)) return rispostaDelFermo();
  // 5/11/2026 — Senza la chiave di servizio il giro risponde 503 «non configurato», non un 500 muto.
  let admin: ReturnType<typeof getAdminSupabase>;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    return ApiErrors.unavailable(e instanceof Error ? e.message : 'config error');
  }

  // 26/11/2026 — LA MERCE DI UNA CASSA MORTA IN MEZZO TORNA A SCAFFALE.
  // La cassa in contanti scala la merce prima di scrivere l'ordine e gli articoli
  // dopo; la riserva resta scritta (migrazione 961) finche' gli articoli non ci
  // sono. Una riga rimasta oltre la soglia e' di una funzione morta: la merce
  // torna, e il credito tolto se l'ordine non e' mai nato. Prima di tutto il
  // resto, e senza fermare il giro se non riesce.
  const { data: riserveLiberate, error: errRiserve } = await admin.rpc('libera_riserve_orfane', {
    p_minuti: RISERVA_ORFANA_DOPO_MINUTI,
  });
  if (errRiserve) {
    if (['PGRST202', '42883'].includes(String((errRiserve as { code?: string }).code))) {
      logger.warn('[cron] expire-stale-orders: migrazione 961 non ancora applicata, niente riserve da liberare', { message: errRiserve.message });
    } else {
      logger.error('[cron] expire-stale-orders: riserve della cassa in contanti non liberate', { message: errRiserve.message });
    }
  } else if (typeof riserveLiberate === 'number' && riserveLiberate > 0) {
    logger.spesa(`[cron] expire-stale-orders: ${riserveLiberate} riserve della cassa in contanti tornate a scaffale`);
  }

  const cutoff = new Date().toISOString();

  // 28/11/2026 (onda 2, R06-006) — SI LEGGE A PAGINE FINCHÉ NON SI TROVANO GLI SCADUTI.
  // La lettura era una sola, i cento NEW più vecchi. Ma i più vecchi sono spesso ordini su una fascia
  // ancora lontana (gli «Domani» della sera prima, i «Dopodomani»), ancora nei tempi: con cento di
  // quelli in testa, la veloce scaduta nata dopo restava fuori dal giro, e dal giro dopo, finché i
  // cento non si svuotavano — con la carta, il cliente addebitato senza che nessuno accettasse.
  // Ora si scorrono le pagine (sempre dai più vecchi, con l'id a spareggio) e decide `ancoraNeiTempi`
  // riga per riga; il giro si ferma a SCADUTI_PER_GIRO scaduti o a PAGINE_MASSIME pagine lette.
  const leggiPagina = (da: number) => {
    const q = admin
      .from('orders')
      // 27/8/2026 (R121) — `coupon_code` non veniva nemmeno letto, quindi il
      // codice sconto di un ordine che il negozio non ha mai accettato restava
      // bruciato: il cliente perdeva il buono senza aver comprato niente.
      // 3/9/2026 — `created_at` e `delivery_slot` non venivano nemmeno letti, e
      // sono i due campi che dicono se l'attesa è finita davvero: senza,
      // l'ordine della sera per domani mattina moriva alle 00:15.
      // 16/10/2026 — `internal_dispute_status`: la pausa del carrello, se c'è un
      // rimborso dal cruscotto ancora da dividere (più sotto).
      // 5/11/2026 — `stripe_session_id`: il carrello, per non restituire un codice sconto che un
      // altro ordine dello stesso carrello tiene ancora. E i più vecchi prima.
      .select('id, user_id, seller_id, payment_method, payment_status, stripe_payment_intent, stripe_session_id, total_price, wallet_applied_cents, coupon_code, created_at, delivery_slot, internal_dispute_status, seller:profiles!orders_seller_id_fkey ( store_hours )')
      .eq('delivery_status', 'NEW')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    return da === 0 ? q.limit(PAGINA_CANDIDATI) : q.range(da, da + PAGINA_CANDIDATI - 1);
  };
  type Candidato = NonNullable<Awaited<ReturnType<typeof leggiPagina>>['data']>[number];

  const candidates: Candidato[] = [];
  let rinviati = 0;
  for (let pagina = 0; pagina < PAGINE_MASSIME && candidates.length < SCADUTI_PER_GIRO; pagina++) {
    const { data: righe, error } = await leggiPagina(pagina * PAGINA_CANDIDATI);
    if (error) {
      // La prima pagina che cade ferma il giro come prima; una successiva lascia lavorare quelle già lette.
      if (pagina === 0) {
        logger.error('[cron] expire-stale-orders: select fallita', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      logger.error('[cron] expire-stale-orders: pagina dei candidati non letta, il giro lavora quelle già lette', { pagina, message: error.message });
      break;
    }
    for (const o of righe ?? []) {
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
      if (candidates.length < SCADUTI_PER_GIRO) candidates.push(o);
    }
    if ((righe ?? []).length < PAGINA_CANDIDATI) break;
  }

  let canceled = 0;
  let refunded = 0;
  let failed = 0;
  /** Annullati con un rimborso impossibile: restano fermi, li chiude una persona. */
  let daChiudereAMano = 0;
  /** Lasciati in coda: sul loro pagamento c'è un rimborso dal cruscotto da dividere. */
  let inAttesaDellaDivisione = 0;
  /** Annullati, ma la merce o il credito non sono tornati: lo sanno gli amministratori. */
  let ripristiniFalliti = 0;
  // R04-018 — Gli avvisi del carrello di questo giro, gli ordini annullati, e gli avvisi al cliente
  // che partono a fine giro.
  const avvisiDelGiro: AvvisoDelCarrello[] = [];
  const annullatiNelGiro = new Set<string>();
  const alCliente: Array<{ o: Candidato; perLEmail: Candidato; avviso: AvvisoDelCarrello | null; come: ComeHaPagato; isCardPaid: boolean }> = [];

  for (const o of candidates) {
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
    annullatiNelGiro.add(o.id);

    // 30/10/2026 — Il negozio che non conferma in tempo esce dal giro: la consegna dei negozi rimasti
    // dello stesso carrello si rifà (consegna.negozio-che-rifiuta), e il rimborso rende il totale nuovo.
    const giro = await ricalcolaLaConsegnaDelGiro(admin, o.id);
    if (giro?.avviso) avvisiDelGiro.push(giro.avviso);

    // 5/11/2026 — Senza il giro rifatto il totale si rilegge adesso: un altro ordine dello stesso
    // carrello scaduto poco prima in questo giro può averlo già cambiato (13 € → 15 €).
    let totaleCents = Math.round(Number(o.total_price) * 100);
    if (!giro && isCardPaid) {
      try {
        const { data: righe, error: errFresco } = await admin.from('orders').select('id, total_price').eq('id', o.id).limit(1);
        const fresco = ((righe ?? []) as Array<{ id: string; total_price?: unknown }>).find((r) => r.id === o.id);
        if (errFresco) throw new Error(errFresco.message);
        if (fresco && fresco.total_price != null && Number.isFinite(Number(fresco.total_price))) {
          totaleCents = Math.round(Number(fresco.total_price) * 100);
        }
      } catch (e) {
        logger.error('[cron] expire-stale-orders: totale non riletto, si rende quello letto a inizio giro', {
          id: o.id, message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const nonTornato: string[] = [];
    // R06-013 — «Rimborso emesso» parte dopo lo storno del credito MyCity, per dire anche quello.
    let rimborsoDaDire: { importoCents: number | null | undefined; motivo: string } | null = null;
    try {
      if (isCardPaid) {
        try {
          const motivoDelRimborso = 'Ordine annullato: il venditore non lo ha accettato in tempo';
          const rimborso = await refundOrder({
            orderId: o.id,
            amountCents: giro ? giro.totaleCents : totaleCents,
            reason: motivoDelRimborso,
            // 21/11/2026 (R02-001) — «Rimborso emesso» parte dopo la risposta (lib/ordini/annulla.ts,
            // `avvisaIlClienteDelRimborso`): il giro non aspetta più l'invio, ordine per ordine.
            notifyBuyer: false,
            // L'ordine l'ha annullato questo giro, qui sopra, e la merce non
            // l'ha ancora rimessa nessuno: anche se un rimborso parziale dal
            // cruscotto c'era già (lib/ordini/rimessa-a-scaffale.ts).
            annullatoDaChiChiama: true,
          });
          refunded++;
          rimborsoDaDire = { importoCents: rimborso?.importoCents, motivo: motivoDelRimborso };
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
          // R04-018 — Il carrello tornato com'era: le cifre di quel ricalcolo non valgono più.
          if (giro && (await giro.rimetti()) && giro.avviso) avvisiDelGiro.splice(avvisiDelGiro.indexOf(giro.avviso), 1);

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
            // 5/11/2026 — Annullato, pagato e fuori dalla coda: senza un avviso nessuno lo riprende.
            await notifyAdmins(
              'Ordine annullato e NON rimborsato',
              `L'ordine #${o.id.slice(0, 6).toUpperCase()} è stato annullato perché il negozio non lo ha accettato, il rimborso non è riuscito e non è tornato in coda. ` +
                'Il giro non lo riprende: rimborsalo a mano e controlla su Stripe.',
              '/admin/orders',
            ).catch((errAvviso) =>
              logger.error('[cron] expire-stale-orders: avviso agli amministratori non partito', {
                id: o.id, message: errAvviso instanceof Error ? errAvviso.message : String(errAvviso),
              }),
            );
            daChiudereAMano++;
          } else {
            logger.warn('[cron] expire-stale-orders: rimborso fallito, ordine rimesso in coda', { id: o.id });
            annullatiNelGiro.delete(o.id);
            failed++;
          }
          continue;
        }
      } else {
        // COD o non pagato: niente da rimborsare, solo il ripristino della merce.
        const { error: rErr } = await admin.rpc('restore_stock_for_order', { p_order_id: o.id });
        if (rErr) {
          logger.warn('[cron] expire-stale-orders: restore_stock fallito', { id: o.id, message: rErr.message });
          nonTornato.push('la merce non è tornata a scaffale');
        }
      }

      // Storno del credito wallet eventualmente speso (entrambi i percorsi).
      const walletCents = Number(o.wallet_applied_cents ?? 0);
      let creditoTornato = true;
      if (walletCents > 0) {
        // 28/11/2026 (onda 2, R06-005) — La stessa restituzione dell'annullo (lib/ordini/annulla.ts), con i
        // suoi tre tentativi sicuri: qui ce n'era uno solo, e un timeout lasciava il credito fermo. L'avviso
        // agli amministratori resta quello del giro, qui sotto, insieme alla merce non tornata.
        const nonTornatoCents = await restituisciIlCreditoDellOrdine(admin, o, 'order_auto_canceled', { avvisaGliAmministratori: false });
        if (nonTornatoCents > 0) {
          logger.warn('[cron] expire-stale-orders: storno wallet fallito', { id: o.id });
          creditoTornato = false;
          nonTornato.push(`il credito MyCity speso (${(walletCents / 100).toFixed(2).replace('.', ',')} €) non è tornato al cliente`);
        }
      }

      // 28/11/2026 (onda 2, R06-013) — Con la carta e il credito insieme, «Rimborso emesso» dice anche il
      // credito tornato davvero. Prima partiva prima dello storno e diceva solo la carta; e se il carrello
      // scadeva tutto nello stesso giro l'email di annullo non parte (R15-013): nessuno diceva del credito.
      if (rimborsoDaDire) {
        await avvisaIlClienteDelRimborso(admin, o, rimborsoDaDire.importoCents, rimborsoDaDire.motivo, creditoTornato ? walletCents : 0);
      }

      // 5/11/2026 — Merce o credito non tornati: l'ordine è già annullato e il giro non lo riprende.
      // Un avviso agli amministratori, una volta per ordine, e il conto nella risposta.
      if (nonTornato.length > 0) {
        ripristiniFalliti++;
        await notifyAdmins(
          'Ordine annullato: qualcosa non è tornato',
          `L'ordine #${o.id.slice(0, 6).toUpperCase()} è stato annullato perché il negozio non lo ha accettato, ma ${nonTornato.join(' e ')}. Va sistemato a mano.`,
          '/admin/orders',
        ).catch((errAvviso) =>
          logger.error('[cron] expire-stale-orders: avviso agli amministratori non partito', {
            id: o.id, message: errAvviso instanceof Error ? errAvviso.message : String(errAvviso),
          }),
        );
      }

      // 27/8/2026 (R121) — Il codice sconto torna disponibile. Il turno
      // sull'ordine e' gia' stato preso qui sopra, quindi la restituzione
      // avviene una volta sola; `release_coupon` non scende comunque sotto zero.
      // 5/11/2026 — Passa dalla stessa restituzione dell'annullo (lib/ordini/annulla.ts): legata
      // all'ordine, e niente restituzione se un altro ordine dello stesso carrello tiene il codice.
      await restituisciIlCodiceDellOrdine(admin, o as { id: string; coupon_code?: string | null; stripe_session_id?: string | null });

      // Notifica in-app al buyer (best-effort: non deve far fallire l'annullo).
      await scriviCampanella(admin, {
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
        user_id: o.user_id,
        title: 'Ordine annullato',
        body: `L'ordine #${o.id.slice(0, 6).toUpperCase()} è stato annullato: il negozio non lo ha accettato in tempo.${isCardPaid ? ' Il rimborso è in corso.' : ''}`,
        link: '/orders',
      }, { dove: 'expire-stale-orders', ordine: o.id });
      // 5/11/2026 — Anche il negozio lo sa: l'ordine sparisce dalla sua lista «da fare».
      const sellerId = (o as { seller_id?: string | null }).seller_id;
      if (sellerId) {
        await scriviCampanella(admin, {
          category: 'order',
          user_id: sellerId,
          title: 'Ordine annullato',
          body: `L'ordine #${o.id.slice(0, 6).toUpperCase()} è stato annullato: non è stato accettato in tempo.`,
          link: `/seller/orders/${o.id}`,
        }, { dove: 'expire-stale-orders (negozio)', ordine: o.id });
      }

      // 27/10/2026 — La campanella si vede solo riaprendo il sito. Chi paga alla
      // consegna riceve anche la email; sulla carta l'ha gia' mandata refundOrder.
      // 30/10/2026 — Se la consegna del carrello si è rifatta, il cliente legge il conto nuovo degli
      // ordini rimasti: nell'email (sulla carta un'email in più, oltre al «Rimborso emesso») e nella campanella.
      // 5/11/2026 — Pagato con la carta e già rimborsato tutto resta «carta», non «da pagare».
      const pagatoConLaCarta =
        isCardPaid || (o.payment_method === 'card' && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(String(o.payment_status)));
      const come: ComeHaPagato = pagatoConLaCarta ? 'carta' : o.payment_method === 'cod' ? 'contanti' : 'da-pagare';
      // 5/11/2026 — Se lo storno del credito è fallito l'email non dice «credito restituito».
      const perLEmail = creditoTornato ? o : { ...o, wallet_applied_cents: 0 };
      // R04-018 — L'email e la campanella del carrello partono a fine giro, con le cifre finali.
      alCliente.push({ o, perLEmail, avviso: giro?.avviso ?? null, come, isCardPaid });
      // R31-023 — Al negozio anche l'email, come per il «Nuovo ordine»: non lancia, l'annullo è già scritto.
      if (sellerId) {
        await avvisaIlNegozioDellAnnullo(admin, { id: o.id, seller_id: sellerId }, `L'ordine #${o.id.slice(0, 6).toUpperCase()} è stato annullato: non è stato accettato in tempo.`);
      }

      canceled++;
    } catch (e) {
      failed++;
      logger.error('[cron] expire-stale-orders: annullo fallito', {
        id: o.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // R04-018 — Gli avvisi al cliente, a fine giro: vedi `avvisoAFineGiro`.
  const spediti = alCliente.map((x) => x.avviso).filter((x): x is AvvisoDelCarrello => !!x);
  for (const x of alCliente) {
    const avviso = x.avviso ? avvisoAFineGiro(x.avviso, avvisiDelGiro, spediti, annullatiNelGiro) : null;
    const carrello = avviso ? { avviso, come: x.come } : null;
    // 22/11/2026 (R15-013) — Con la carta «Rimborso emesso» è già partito: l'email di annullo serve
    // solo se dice gli ordini del carrello che restano. Se il carrello è scaduto tutto in questo giro
    // ripeteva il rimborso senza nessuna riga del carrello. I soldi non cambiano: solo quale email parte.
    if (!x.isCardPaid || (avviso && avviso.rimasti.length > 0)) {
      await avvisaIlClienteDellAnnullo(admin, x.perLEmail, "Il negozio non ha accettato l'ordine in tempo", carrello);
    }
    if (avviso && avviso.rimasti.length > 0) await avvisaLaCampanellaDelCarrello(admin, x.o.user_id, avviso, x.come);
  }

  if (canceled > 0 || failed > 0 || daChiudereAMano > 0 || inAttesaDellaDivisione > 0) {
    logger.spesa(
      `[cron] expire-stale-orders: ${canceled} annullati (${refunded} rimborsati), ${failed} falliti, ${daChiudereAMano} da chiudere a mano, ` +
        `${inAttesaDellaDivisione} in attesa della divisione di un rimborso dal cruscotto`,
    );
  }

  return NextResponse.json(
    { ok: true, canceled, refunded, failed, rinviati, daChiudereAMano, inAttesaDellaDivisione, ripristiniFalliti },
    { status: 200 },
  );
});

// I lavori periodici di Vercel bussano in GET, sempre — non c'è modo di
// chiedergli un POST. Questa rotta nasceva POST-e-basta, dai tempi del cron
// esterno: su Vercel avrebbe risposto «405 metodo non ammesso» a ogni giro, e
// il lavoro non sarebbe mai partito. Stesso identico handler, stesso controllo
// del segreto: cambia solo la porta da cui si entra. Il POST resta valido
// perché il cron esterno continua a girare finché non lo spegni.

// 28/11/2026 (onda 2, R09-006 + R06-012) — Gli avvisi dell'annullo passano dalla fila della richiesta:
// la rotta si avvolge, così le email partono una alla volta e non tutte insieme.
export const POST = conFilaPerRichiesta(postSenzaFila);
export const GET = conFilaPerRichiesta(postSenzaFila);
