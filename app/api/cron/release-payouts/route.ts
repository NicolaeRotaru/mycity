import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { isStripeConfigured, getStripe } from '@/lib/stripe/client';
import { ORE_ATTESA_BONIFICO } from '@/lib/stripe/tempi-bonifico';
import {
  releaseOrderPayout,
  releaseRiderPayout,
  FILTRO_RIDER_RITENTABILI,
  STATI_RIDER_RITENTABILI,
} from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
// R044 — l'avviso agli amministratori e' quello gia' usato dal webhook: una casa sola.
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

export const runtime = 'nodejs';

/**
 * R051 — Le ore di attesa non si scrivono piu' qui: stanno in
 * `lib/stripe/tempi-bonifico.ts` insieme alla frase che il negoziante legge
 * nella pagina Guadagni. Erano quattro versioni diverse dello stesso numero,
 * e la piu' bella — «paghiamo entro un'ora dalla consegna» — era l'unica che
 * non dicevamo a nessuno.
 */
const HOLD_HOURS = ORE_ATTESA_BONIFICO;
const BATCH_LIMIT = 200;
/** Oltre questo, un turno preso e non finito si considera abbandonato. */
const MINUTI_TURNO_APPESO = 15;
/**
 * Il giro si ferma da solo prima che lo fermi il tetto di durata della
 * richiesta.
 *
 * 27/8/2026 (R141) — UN BUDGET PER PASSAGGIO, NON UNO SOLO PER TUTTI E TRE.
 *
 * Qui c'erano cinquanta secondi buoni per l'intero giro, mentre `vercel.json`
 * concede 300 secondi a questa rotta: sei volte tanto, buttati via. E il tetto
 * era UNO SOLO condiviso dai tre passaggi in fila — negozi con carta,
 * fattorini, negozi in contanti: se il primo se lo mangiava, il secondo e il
 * terzo non partivano affatto, e nel secondo ci sono i compensi dei fattorini.
 *
 * Novanta secondi l'uno fanno 270 sul tetto di 300, col margine per la
 * chiusura. Se un giorno il piano Vercel scendesse a 60 secondi complessivi,
 * questo numero va rifatto: e' scritto qui apposta, in un posto solo.
 */
const TETTO_DURATA_MS = 90_000;

/** Ore di silenzio fra due avvisi uguali: il giro passa ogni quindici minuti. */
const ORE_SILENZIO_AVVISO = 6;

/**
 * Dice se questo avviso e' gia' stato mandato di recente. La memoria e' la
 * stessa del sorvegliante operativo (`operational_alert_log`, migrazione 084):
 * una chiave, l'ora dell'ultimo invio. Se la lettura non riesce si manda
 * l'avviso: meglio un doppione che un silenzio.
 */
async function avvisoDaMandare(
  admin: ReturnType<typeof getAdminSupabase>,
  chiave: string,
): Promise<boolean> {
  const soglia = new Date(Date.now() - ORE_SILENZIO_AVVISO * 3_600_000).toISOString();
  const { data, error } = await admin
    .from('operational_alert_log')
    .select('alert_key')
    .eq('alert_key', chiave)
    .gte('last_sent_at', soglia)
    .maybeSingle();
  if (!error && data) return false;
  await admin
    .from('operational_alert_log')
    .upsert({ alert_key: chiave, last_sent_at: new Date().toISOString() });
  return true;
}

/** Un cronometro nuovo per ogni passaggio: uno lento non affama gli altri. */
function cronometroDelPasso(): () => boolean {
  const inizio = Date.now();
  return () => Date.now() - inizio > TETTO_DURATA_MS;
}
const OPEN_RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'];
const OPEN_DISPUTE_STATUSES = ['open', 'under_review'];
/**
 * Filtro payout sui chargeback Stripe (colonna orders.dispute_status):
 * solo 'OPEN' blocca il payout. 'WON' (contestazione vinta) deve tornare
 * eleggibile, e 'LOST' è già escluso perché l'ordine viene annullato
 * (delivery_status='CANCELED'). NB: non usare .neq('OPEN'), perché in SQL
 * `dispute_status <> 'OPEN'` è NULL per le righe null → le escluderebbe tutte.
 * Vedi audit 🟠-6.
 */
const PAYOUT_DISPUTE_FILTER = 'dispute_status.is.null,dispute_status.eq.WON';

/**
 * Cron: rilascia automaticamente i payout SCT ai venditori per gli ordini
 * consegnati da almeno HOLD_HOURS ora. Policy: consegna +1h, con claw-back
 * via reversal per rimborsi/recessi tardivi (vedi lib/stripe/payout.ts).
 * NB: hold breve = il venditore incassa quasi subito, ma piu' resi/recessi
 * cadono DOPO il payout e richiedono claw-back (rischio saldo Connect negativo).
 *
 * Eleggibilità (filtri SQL, coperti da orders_payout_release_idx):
 *   payout_status IN ('HELD','PENDING_SELLER_ONBOARDING')
 *   AND payment_method = 'card'        (i COD non passano da Stripe)
 *   AND delivery_status = 'DELIVERED'
 *   AND delivered_at <= now() - 1h
 *   AND (dispute_status IS NULL OR = 'WON')   (nessun chargeback Stripe APERTO)
 * Esclusioni applicative: ordini con un reso aperto o una dispute interna
 * aperta vengono saltati (i fondi restano HELD).
 *
 * Idempotente: releaseOrderPayout è no-op se lo stato non è più HELD.
 * Best-effort per ordine: un transfer fallito non blocca il batch; il giro
 * successivo riprende i rimanenti (limit BATCH_LIMIT per esecuzione).
 *
 * Cadenza: ogni 15 minuti — il cancello è «+1h dalla consegna», quindi si
 * guarda spesso per pagare vicino alla scadenza. Chi la fa partire sta in
 * `vercel.json` → `crons`. A mano si chiama così (gate +1h → schedula frequente, per pagare
 * il venditore entro ~1h dalla consegna):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/release-payouts
 */
export const POST = withCronAuth(async (): Promise<NextResponse> => {
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, error: 'Stripe non configurato' }, { status: 503 });
  }

  const admin = getAdminSupabase();
  const cutoffIso = new Date(Date.now() - HOLD_HOURS * 3_600_000).toISOString();

  /**
   * 22/8/2026 — I TURNI RIMASTI APPESI TORNANO IN CODA.
   *
   * `releaseOrderPayout` prende il turno su un ordine scrivendo PROCESSING e
   * poi chiama Stripe. Se il processo muore in mezzo — questo giro lavora fino
   * a 200 ordini in fila, ognuno con una chiamata da dieci secondi di attesa,
   * quindi un tetto di durata si raggiunge — quello stato resta scritto. E i
   * candidati qui sotto sono solo HELD e PENDING_SELLER_ONBOARDING: quell'ordine
   * non sarebbe ripescato mai piu'. Restava solo l'avviso PAYOUT_STUCK, che
   * segnala e non ripara.
   *
   * Rimetterlo in coda e' sicuro perche' la chiave di idempotenza del bonifico
   * dipende dal numero del tentativo, e QUI QUEL NUMERO NON SI TOCCA: se il
   * trasferimento era davvero partito, Stripe restituisce quello e non ne crea
   * un secondo.
   */
  const turnoScadutoIso = new Date(Date.now() - MINUTI_TURNO_APPESO * 60_000).toISOString();
  let appesiRimessiInCoda = 0;
  const { data: appesi, error: errAppesi } = await admin
    .from('orders')
    .update({ payout_status: 'HELD' })
    .eq('payout_status', 'PROCESSING')
    .lt('payout_claimed_at', turnoScadutoIso)
    .select('id');
  if (errAppesi) {
    // Prima che la migrazione 126 sia applicata la colonna non c'e' e questa
    // lettura fallisce: e' esattamente com'era ieri, non un peggioramento.
    logger.warn('[cron] turni appesi non recuperati', { message: errAppesi.message });
  } else {
    appesiRimessiInCoda = appesi?.length ?? 0;
    if (appesiRimessiInCoda > 0) {
      // 22/8/2026 — `logger.info` in produzione non esce: LOG_LEVEL non e'
      // 'info' e non lo e' mai stato. Un rendiconto sui soldi che nessuno puo'
      // leggere e' come non scriverlo. `spesa` esce sempre, apposta.
      logger.spesa('[cron] bonifici rimasti a meta rimessi in coda', { ordini: appesiRimessiInCoda });
    }
  }

  /**
   * 27/8/2026 (R040) — E LO STESSO PER IL COMPENSO DEL FATTORINO.
   *
   * Il recupero qui sopra esisteva solo per il negozio. Il compenso del
   * fattorino prende il turno allo stesso modo (`rider_payout_status` a
   * PROCESSING) e gli stati da cui si puo' ritentare sono HELD,
   * PENDING_RIDER_ONBOARDING e FAILED: PROCESSING non c'e'. Un processo morto
   * in mezzo lasciava quel compenso fermo per sempre, e l'unico rimedio era
   * una modifica a mano sul database. Il fattorino ha consegnato e non veniva
   * pagato: su chi e' pagato a consegna, questo e' abbandono alla seconda volta.
   *
   * Come per il negozio, il numero del tentativo NON si tocca: e' quello che
   * tiene la chiave di idempotenza e protegge dal doppio bonifico.
   */
  let riderAppesiRimessiInCoda = 0;
  const { data: riderAppesi, error: errRiderAppesi } = await admin
    .from('orders')
    .update({ rider_payout_status: 'HELD' })
    .eq('rider_payout_status', 'PROCESSING')
    .lt('rider_payout_claimed_at', turnoScadutoIso)
    .select('id');
  if (errRiderAppesi) {
    logger.warn('[cron] turni appesi del compenso fattorino non recuperati', { message: errRiderAppesi.message });
  } else {
    riderAppesiRimessiInCoda = riderAppesi?.length ?? 0;
    if (riderAppesiRimessiInCoda > 0) {
      logger.spesa('[cron] compensi fattorino rimasti a meta rimessi in coda', { ordini: riderAppesiRimessiInCoda });
    }
  }

  const { data: candidates, error } = await admin
    .from('orders')
    .select('id')
    .in('payout_status', ['HELD', 'PENDING_SELLER_ONBOARDING'])
    .eq('payment_method', 'card')
    .eq('delivery_status', 'DELIVERED')
    .or(PAYOUT_DISPUTE_FILTER)
    // 050 / 173 — Il reclamo interno ha ora una colonna sua, separata dal
    // chargeback bancario. Un reclamo interno perso trattiene il pagamento
    // senza toccare il flag della banca.
    .or('internal_dispute_status.is.null,internal_dispute_status.eq.RESOLVED')
    .lte('delivered_at', cutoffIso)
    .limit(BATCH_LIMIT);

  if (error) {
    logger.error('[cron] release-payouts query failed', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ids = (candidates ?? []).map((o) => o.id as string);

  // Escludi ordini con un reso aperto o una dispute interna aperta.
  // NB: niente early-return su ids vuoto — i pass rider e COD qui sotto devono
  // girare COMUNQUE (prima, zero payout carta-seller faceva saltare anche quelli).
  const blocked = new Set<string>();
  if (ids.length > 0) {
    const [openReturns, openDisputes] = await Promise.all([
      admin.from('returns').select('order_id').in('order_id', ids).in('status', OPEN_RETURN_STATUSES),
      admin.from('disputes').select('order_id').in('order_id', ids).in('status', OPEN_DISPUTE_STATUSES),
    ]);
    for (const r of openReturns.data ?? []) blocked.add(r.order_id as string);
    for (const d of openDisputes.data ?? []) blocked.add(d.order_id as string);
  }

  let released = 0;
  let skipped = 0;
  let failed = 0;
  let fermatoPerTempo = false;

  // Il giro si ferma da solo prima che lo fermi il tetto di durata della
  // richiesta. Fermarsi a comando lascia gli ordini rimasti in HELD, pronti per
  // il giro dopo; farsi uccidere li lascia a meta', ed e' quello il difetto.
  const tempoFinito = cronometroDelPasso();

  for (const id of ids) {
    if (tempoFinito()) {
      fermatoPerTempo = true;
      logger.warn('[cron] release-payouts: tetto di tempo raggiunto, il resto al prossimo giro', {
        fatti: released + skipped + failed, rimasti: ids.length - (released + skipped + failed),
      });
      break;
    }
    if (blocked.has(id)) {
      skipped++;
      continue;
    }
    try {
      const res = await releaseOrderPayout(id);
      // 046 — Un ordine rimborsato per intero prima del pagamento non produce
      // nessun trasferimento: è saltato, non rilasciato. Contarlo come
      // «pagato» avrebbe mentito nel rendiconto del cron.
      if (res.ok) {
        if ('code' in res) skipped++;
        else released++;
      } else if (res.code === 'SELLER_NOT_READY' || res.code === 'BAD_STATE') skipped++;
      else failed++;
    } catch (e) {
      logger.error('[cron] release-payouts order failed', { id, e });
      failed++;
    }
  }

  // --- COMPENSO RIDER: transfer della quota shipping_cost ai rider ---
  // Ordini card consegnati con rider, non ancora pagati (o da ritentare).
  // Niente blocco su resi (il rider ha comunque effettuato la consegna); i
  // chargeback APERTI sono esclusi via PAYOUT_DISPUTE_FILTER (null o WON ok).
  let riderReleased = 0;
  let riderSkipped = 0;
  let riderFailed = 0;
  const { data: riderCands } = await admin
    .from('orders')
    .select('id')
    .eq('payment_method', 'card')
    .eq('delivery_status', 'DELIVERED')
    .not('rider_id', 'is', null)
    .or(FILTRO_RIDER_RITENTABILI)
    .or(PAYOUT_DISPUTE_FILTER)
    .lte('delivered_at', cutoffIso)
    .limit(BATCH_LIMIT);

  /**
   * 30/8/2026 (R120) — E I COMPENSI IN CONTANTI RIMASTI SCOPERTI.
   *
   * Sul contrassegno il fattorino si tiene il compenso dal contante che ha in
   * mano, quindi qui non c'era niente da cercare: la ricerca chiedeva
   * `payment_method = 'card'` e basta. Ma il credito MyCity puo' portare il
   * contante sotto il compenso — fino a zero — e allora una parte resta
   * dovuta. La conferma dell'incasso la lascia in 'HELD'; questi sono gli
   * ordini che la vengono a prendere.
   *
   * 31/8/2026 (R120) — MA 'HELD' NON E' L'UNICO STATO DA CUI SI RITENTA.
   *
   * Qui la ricerca chiedeva esattamente 'HELD', e bastava un passaggio a
   * vuoto per perdere l'ordine: se il fattorino non ha ancora collegato
   * l'IBAN, `releaseRiderPayout` riscrive quello stato in
   * 'PENDING_RIDER_ONBOARDING'. Da li' in poi l'ordine era fuori da tutte e
   * due le ricerche del giro — quella della carta filtra
   * `payment_method='card'` — e il compenso restava dovuto per sempre. Lo
   * stesso guasto di prima, spostato di un passo: e nessuno vieta a un
   * fattorino di prendere ordini prima di agganciare Stripe, il controllo su
   * Connect esiste solo per i negozi.
   *
   * Gli stati da cui si ritenta sono quelli della carta, che li' erano gia'
   * trattati cosi', e vengono dalla stessa casa (`STATI_RIDER_RITENTABILI`).
   * L'unica differenza e' che qui lo stato vuoto NON entra: sulla carta
   * significa «mai provato», sul contrassegno significa «niente da versare,
   * il contante bastava», e tirarlo dentro riempirebbe il giro di ordini da
   * scartare uno per uno.
   */
  const { data: riderCandsContanti } = await admin
    .from('orders')
    .select('id')
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .in('rider_payout_status', [...STATI_RIDER_RITENTABILI])
    .not('rider_id', 'is', null)
    .or(PAYOUT_DISPUTE_FILTER)
    .lte('delivered_at', cutoffIso)
    .limit(BATCH_LIMIT);

  // R141 — il passaggio dei fattorini ha il suo tempo, non gli avanzi del primo.
  const tempoFinitoRider = cronometroDelPasso();
  for (const o of [...(riderCands ?? []), ...(riderCandsContanti ?? [])]) {
    if (tempoFinitoRider()) {
      fermatoPerTempo = true;
      break;
    }
    const id = o.id as string;
    try {
      const res = await releaseRiderPayout(id);
      if (res.ok) riderReleased++;
      else if (res.code === 'RIDER_NOT_READY' || res.code === 'BAD_STATE') riderSkipped++;
      else riderFailed++;
    } catch (e) {
      logger.error('[cron] release rider payout failed', { id, e });
      riderFailed++;
    }
  }

  // --- PAYOUT VENDITORE COD (🔴-1 slice 3) ---
  // Ordini COD in 'HELD': lo stato è HELD SOLO dopo che un admin ha confermato la
  // rimessa contanti del rider (confirm_cod_remittance), quindi "paga dopo rimessa"
  // è già garantito. Stesso rail dei card: releaseOrderPayout fa un transfer dal
  // saldo piattaforma (senza source_transaction, perché non c'è charge Stripe).
  let codReleased = 0;
  let codSkipped = 0;
  let codFailed = 0;
  let codSaldoInsufficiente = false;
  const { data: codCands } = await admin
    .from('orders')
    .select('id, seller_payout_cents, seller_payout_reversed_cents')
    .eq('payout_status', 'HELD')
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .or(PAYOUT_DISPUTE_FILTER)
    // 27/8/2026 (R124) — IL RECLAMO INTERNO VALE ANCHE QUI.
    // La ricerca degli ordini con carta applica questo stesso filtro cento
    // righe piu' su; questa no. Due negozi con lo stesso reclamo perso finivano
    // trattati in modo opposto solo per come aveva pagato il cliente — e una
    // regola che non torna diventa una discussione col negoziante.
    .or('internal_dispute_status.is.null,internal_dispute_status.eq.RESOLVED')
    .limit(BATCH_LIMIT);
  const codIds = (codCands ?? []).map((o) => o.id as string);
  if (codIds.length > 0) {
    /**
     * 27/8/2026 (R044) — I CONTANTI NON ENTRANO NEL SALDO STRIPE.
     *
     * Il bonifico di un ordine in contanti passa dallo stesso binario della
     * carta, ma senza charge da cui attingere: esce dal saldo della
     * piattaforma. I contanti che il fattorino raccoglie e riporta non entrano
     * mai in quel saldo (in tutto il progetto non esiste nessun versamento su
     * Stripe). Se il contante e' una fetta seria delle vendite, prima o poi il
     * saldo non basta: i bonifici falliscono uno a uno e ogni ordine rimbalza
     * fra «da pagare» e «in lavorazione» a ogni giro, senza che nessuno lo dica.
     *
     * Questo non e' il rimedio vero — quello e' una decisione sui soldi, da
     * prendere con Nicola: o si versa il contante su Stripe alla conferma della
     * rimessa, o i bonifici dei contanti escono per bonifico bancario e non
     * passano di qui. Questo e' il freno: ci si ferma prima, una volta, e lo si
     * dice, invece di accumulare fallimenti in silenzio.
     *
     * Se il saldo non si riesce a leggere si tira dritto: e' il comportamento
     * di ieri, non un peggioramento, e un controllo che non risponde non deve
     * bloccare i pagamenti di tutti.
     */
    try {
      const daPagareCents = (codCands ?? []).reduce((somma, o) => {
        const netto = (o as { seller_payout_cents?: number | null }).seller_payout_cents ?? 0;
        const gia = (o as { seller_payout_reversed_cents?: number | null }).seller_payout_reversed_cents ?? 0;
        return somma + Math.max(0, netto - gia);
      }, 0);
      const saldo = await getStripe().balance.retrieve();
      const disponibile = (saldo.available ?? [])
        .filter((v) => v.currency === 'eur')
        .reduce((somma, v) => somma + v.amount, 0);
      if (daPagareCents > disponibile) {
        codSaldoInsufficiente = true;
        logger.spesa('[cron] saldo Stripe insufficiente per i bonifici dei contanti', {
          servono: daPagareCents, disponibili: disponibile, ordini: codIds.length,
        });
        // Il giro passa ogni quindici minuti: senza silenzio fra un avviso e
        // l'altro sarebbero quasi cento notifiche al giorno per lo stesso
        // problema, e un avviso che arriva cento volte e' un avviso che si
        // impara a saltare. Stessa memoria che usa il sorvegliante operativo.
        if (await avvisoDaMandare(admin, 'PAYOUT_COD_SALDO_INSUFFICIENTE')) {
        await notifyAdmins(
          '⚠️ Saldo Stripe insufficiente per i bonifici in contanti',
          `Servono €${(daPagareCents / 100).toFixed(2)} per pagare ${codIds.length} ordine/i in contanti e sul saldo Stripe ce ne sono €${(disponibile / 100).toFixed(2)}. I contanti raccolti dai fattorini non entrano nel saldo Stripe: finché non si versano, questi bonifici non possono partire.`,
          '/admin/cod-remittance',
        );
        }
      }
    } catch (e) {
      logger.warn('[cron] saldo Stripe non verificato prima dei bonifici in contanti', { e });
    }
  }
  if (codIds.length > 0 && !codSaldoInsufficiente) {
    const codBlocked = new Set<string>();
    const [codReturns, codDisputes] = await Promise.all([
      admin.from('returns').select('order_id').in('order_id', codIds).in('status', OPEN_RETURN_STATUSES),
      admin.from('disputes').select('order_id').in('order_id', codIds).in('status', OPEN_DISPUTE_STATUSES),
    ]);
    for (const r of codReturns.data ?? []) codBlocked.add(r.order_id as string);
    for (const d of codDisputes.data ?? []) codBlocked.add(d.order_id as string);

    const tempoFinitoCod = cronometroDelPasso();
    for (const id of codIds) {
      if (tempoFinitoCod()) {
        fermatoPerTempo = true;
        break;
      }
      if (codBlocked.has(id)) {
        codSkipped++;
        continue;
      }
      try {
        const res = await releaseOrderPayout(id);
        if (res.ok) codReleased++;
        else if (res.code === 'SELLER_NOT_READY' || res.code === 'BAD_STATE') codSkipped++;
        else codFailed++;
      } catch (e) {
        logger.error('[cron] release COD payout failed', { id, e });
        codFailed++;
      }
    }
  }

  if (released > 0 || failed > 0 || riderReleased > 0 || riderFailed > 0 || codReleased > 0 || codFailed > 0) {
    // Il rendiconto dei pagamenti: esce sempre, non solo in sviluppo.
    logger.spesa(
      `[cron] release-payouts: seller released=${released} skipped=${skipped} failed=${failed} · rider released=${riderReleased} skipped=${riderSkipped} failed=${riderFailed} · cod released=${codReleased} skipped=${codSkipped} failed=${codFailed}`,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      released, skipped, failed,
      riderReleased, riderSkipped, riderFailed,
      codReleased, codSkipped, codFailed, codSaldoInsufficiente,
      appesiRimessiInCoda,
      riderAppesiRimessiInCoda,
      fermatoPerTempo,
    },
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
