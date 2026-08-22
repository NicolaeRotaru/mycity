import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { isStripeConfigured } from '@/lib/stripe/client';
import { releaseOrderPayout, releaseRiderPayout, FILTRO_RIDER_RITENTABILI } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const HOLD_HOURS = 1;
const BATCH_LIMIT = 200;
/** Oltre questo, un turno preso e non finito si considera abbandonato. */
const MINUTI_TURNO_APPESO = 15;
/** Il giro si ferma da solo prima che lo fermi il tetto di durata della richiesta. */
const TETTO_DURATA_MS = 50_000;
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
 * Setup esterno (gate +1h → schedula frequente, es. ogni 15 min, per pagare
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
      logger.info('[cron] bonifici rimasti a meta rimessi in coda', { ordini: appesiRimessiInCoda });
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
  const inizio = Date.now();
  const tempoFinito = () => Date.now() - inizio > TETTO_DURATA_MS;

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

  for (const o of riderCands ?? []) {
    if (tempoFinito()) {
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
  const { data: codCands } = await admin
    .from('orders')
    .select('id')
    .eq('payout_status', 'HELD')
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .or(PAYOUT_DISPUTE_FILTER)
    .limit(BATCH_LIMIT);
  const codIds = (codCands ?? []).map((o) => o.id as string);
  if (codIds.length > 0) {
    const codBlocked = new Set<string>();
    const [codReturns, codDisputes] = await Promise.all([
      admin.from('returns').select('order_id').in('order_id', codIds).in('status', OPEN_RETURN_STATUSES),
      admin.from('disputes').select('order_id').in('order_id', codIds).in('status', OPEN_DISPUTE_STATUSES),
    ]);
    for (const r of codReturns.data ?? []) codBlocked.add(r.order_id as string);
    for (const d of codDisputes.data ?? []) codBlocked.add(d.order_id as string);

    for (const id of codIds) {
      if (tempoFinito()) {
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
    logger.info(
      `[cron] release-payouts: seller released=${released} skipped=${skipped} failed=${failed} · rider released=${riderReleased} skipped=${riderSkipped} failed=${riderFailed} · cod released=${codReleased} skipped=${codSkipped} failed=${codFailed}`,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      released, skipped, failed,
      riderReleased, riderSkipped, riderFailed,
      codReleased, codSkipped, codFailed,
      appesiRimessiInCoda,
      fermatoPerTempo,
    },
    { status: 200 },
  );
});
