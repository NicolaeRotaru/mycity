import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { staleCrons, type CronHeartbeat } from '@/lib/cron-health';

export const runtime = 'nodejs';

/**
 * Cron job operational alerts — segnala anomalie ai admin via email + notifica.
 *
 * Esperti consultati:
 * - SRE: "Senza alerts proattivi gli ordini si bloccano in NEW e tu lo scopri
 *   solo quando il buyer reclama. Cron ogni 15min + email admin se trova
 *   qualcosa = early warning."
 * - Operations: "Tre red flag: ordini stuck >1h, rider fermo >30min con ordine,
 *   cash COD non riconciliato del giorno precedente."
 * - SRE (dedup): "Senza memoria, ad ogni run re-invii lo stesso alert → alert
 *   fatigue. Cooldown per (tipo+entità) via operational_alert_log."
 *
 * Cadenza: ogni 15 minuti. Chi la fa partire sta in `vercel.json` → `crons`.
 * A mano si chiama così:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/operational-alerts
 * Schedule: ogni 15 minuti (per stuck), 1 ora (per riconciliazione)
 */

type AlertRow = {
  // Chiave stabile per il dedup: <TIPO>|<id entità>. NON deve contenere parti
  // variabili (es. "da N minuti"), altrimenti il cooldown non aggancia.
  key: string;
  type: string;
  detail: string;
  url?: string;
};

// Non re-notifichiamo la stessa (tipo+entità) entro questa finestra.
const COOLDOWN_HOURS = 6;

export const POST = withCronAuth(async (_req: NextRequest): Promise<NextResponse> => {
  const admin = getAdminSupabase();
  const alerts: AlertRow[] = [];
  /**
   * 22/8/2026 — IL SORVEGLIANTE FALLIVA IN SILENZIO E SI REGISTRAVA COME SANO.
   *
   * Quattordici letture, e di nessuna si guardava l'esito: una che fallisce
   * lascia `data` vuoto, il ciclo non trova niente da segnalare, e il giro
   * finisce con «nessuna anomalia». Peggio: `withCronAuth` scrive il battito,
   * quindi anche il freno anti-silenzio si dichiara soddisfatto.
   *
   * E' il difetto peggiore di un sorvegliante: non che non veda: che dica di
   * aver visto. Adesso i controlli non eseguiti si contano, si dicono nella
   * risposta, e se ce ne sono la risposta e' un errore — cosi' il battito non
   * conta come «tutto guardato» e il freno anti-silenzio puo' scattare.
   */
  const controlliSaltati: string[] = [];

  // 1) Ordini stuck in NEW da piu' di 1 ora (seller non accetta = bad UX buyer)
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: stuckNew, error: err_stuckNew } = await admin
    .from('orders')
    .select('id, created_at, total_price, seller_id, profiles!orders_seller_id_fkey(store_name)')
    .eq('delivery_status', 'NEW')
    .lt('created_at', oneHourAgo)
    .order('created_at', { ascending: true })
    .limit(20);
  if (err_stuckNew) controlliSaltati.push('ordini fermi in NEW');

  for (const o of stuckNew ?? []) {
    const seller = (o as { profiles?: { store_name?: string } | null }).profiles;
    const id = (o as { id: string }).id;
    const minutesStuck = Math.floor((Date.now() - new Date((o as { created_at: string }).created_at).getTime()) / 60_000);
    alerts.push({
      key: `ORDER_STUCK_NEW|${id}`,
      type: 'ORDER_STUCK_NEW',
      detail: `Ordine #${id.slice(0, 8)} da ${seller?.store_name ?? 'unknown'} bloccato in NEW da ${minutesStuck} min`,
      url: `/admin/orders/${id}`,
    });
  }

  // 2) Rider con ordine OUT_FOR_DELIVERY ma nessun aggiornamento da 45 minuti
  const fortyFiveMinAgo = new Date(Date.now() - 45 * 60_000).toISOString();
  const { data: stuckRiders, error: err_stuckRiders } = await admin
    .from('orders')
    .select('id, rider_id, picked_up_at, profiles!orders_rider_id_fkey(full_name)')
    .eq('delivery_status', 'OUT_FOR_DELIVERY')
    .lt('picked_up_at', fortyFiveMinAgo)
    .limit(10);
  if (err_stuckRiders) controlliSaltati.push('ordini senza fattorino');

  for (const o of stuckRiders ?? []) {
    const rider = (o as { profiles?: { full_name?: string } | null }).profiles;
    const id = (o as { id: string }).id;
    const minutes = Math.floor((Date.now() - new Date((o as { picked_up_at: string }).picked_up_at).getTime()) / 60_000);
    alerts.push({
      key: `RIDER_STUCK|${id}`,
      type: 'RIDER_STUCK',
      detail: `Rider ${rider?.full_name ?? 'unknown'} con ordine #${id.slice(0, 8)} in consegna da ${minutes} min`,
      url: `/admin/orders/${id}`,
    });
  }

  // 3) Cash on delivery non riconciliato del giorno precedente
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const { data: codMissing, error: err_codMissing } = await admin
    .from('orders')
    .select('id, total_price, rider_id, profiles!orders_rider_id_fkey(full_name)')
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .is('cash_confirmed_at', null)
    .gte('created_at', yesterday + 'T00:00:00Z')
    .lte('created_at', yesterday + 'T23:59:59Z')
    .limit(20);
  if (err_codMissing) controlliSaltati.push('incassi in contanti mancanti');

  for (const o of codMissing ?? []) {
    const rider = (o as { profiles?: { full_name?: string } | null }).profiles;
    const id = (o as { id: string }).id;
    alerts.push({
      key: `COD_NOT_CONFIRMED|${id}`,
      type: 'COD_NOT_CONFIRMED',
      detail: `Ordine COD #${id.slice(0, 8)} consegnato ma cash non confermato (rider: ${rider?.full_name ?? 'unknown'})`,
      url: `/admin/orders/${id}`,
    });
  }

  // 4) Seller con KYC pending da piu' di 48h
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data: kycPending, error: err_kycPending } = await admin
    .from('profiles')
    .select('id, store_name, kyc_provider_checked_at')
    .eq('role', 'seller')
    .eq('kyc_provider_status', 'PENDING')
    .lt('kyc_provider_checked_at', twoDaysAgo)
    .limit(20);
  if (err_kycPending) controlliSaltati.push('verifiche identita in attesa');

  for (const p of kycPending ?? []) {
    const id = (p as { id: string }).id;
    alerts.push({
      key: `KYC_PENDING_TOO_LONG|${id}`,
      type: 'KYC_PENDING_TOO_LONG',
      detail: `Seller ${(p as { store_name?: string }).store_name ?? 'unknown'} in KYC PENDING da >48h`,
      url: `/admin/users?id=${id}`,
    });
  }

  // 5) Divergenza denaro: payout bloccati/falliti su ordini consegnati da >1h
  const { data: payoutStuck, error: err_payoutStuck } = await admin
    .from('orders')
    .select('id, payout_status, rider_payout_status')
    .eq('delivery_status', 'DELIVERED')
    .or('payout_status.in.(PROCESSING,FAILED),rider_payout_status.in.(PROCESSING,FAILED)')
    .lt('delivered_at', oneHourAgo)
    .limit(20);
  if (err_payoutStuck) controlliSaltati.push('bonifici anomali');
  for (const o of payoutStuck ?? []) {
    const r = o as { id: string; payout_status: string | null; rider_payout_status: string | null };
    alerts.push({
      key: `PAYOUT_STUCK|${r.id}`,
      type: 'PAYOUT_STUCK',
      detail: `Ordine #${r.id.slice(0, 8)} payout anomalo (seller=${r.payout_status}, rider=${r.rider_payout_status}) da >1h`,
      url: `/admin/orders/${r.id}`,
    });
  }

  // 5b) I DUE STATI IN CUI I SOLDI SI FERMANO E NESSUNO LO SA  (#167)
  //
  // Il giro guardava PROCESSING e FAILED e si fermava li'. Mancavano proprio i
  // due stati in cui oggi un pagamento resta fermo per giorni:
  //  · PENDING_SELLER_ONBOARDING — il negozio non ha completato l'attivazione
  //    dei pagamenti, e nessuno lo chiama;
  //  · AWAITING_REMITTANCE — contanti in mano al fattorino di cui nessun admin
  //    ha confermato la rimessa.
  // Un pagamento bloccato si scopriva quando telefonava il negoziante
  // arrabbiato. Su un marketplace appena partito e' il silenzio che costa un
  // negozio.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: onboardingFermi, error: err_onboardingFermi } = await admin
    .from('orders')
    .select('id, seller_id, profiles!orders_seller_id_fkey(store_name)')
    .eq('payout_status', 'PENDING_SELLER_ONBOARDING')
    .lt('created_at', oneDayAgo)
    .limit(20);
  if (err_onboardingFermi) controlliSaltati.push('attivazioni pagamenti ferme');
  for (const o of onboardingFermi ?? []) {
    const r = o as { id: string; profiles?: { store_name?: string } | null };
    alerts.push({
      key: `PAYOUT_ONBOARDING_FERMO|${r.id}`,
      type: 'PAYOUT_ONBOARDING_FERMO',
      detail: `Ordine #${r.id.slice(0, 8)}: ${r.profiles?.store_name ?? 'il negozio'} non ha finito l'attivazione dei pagamenti, il bonifico e fermo da >24h`,
      url: `/admin/orders/${r.id}`,
    });
  }

  const quarantottOreFa = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  const { data: rimesseFerme, error: err_rimesseFerme } = await admin
    .from('orders')
    .select('id, rider_id')
    .eq('payout_status', 'AWAITING_REMITTANCE')
    .eq('delivery_status', 'DELIVERED')
    .lt('delivered_at', quarantottOreFa)
    .limit(20);
  if (err_rimesseFerme) controlliSaltati.push('rimesse contanti non confermate');
  for (const o of rimesseFerme ?? []) {
    const r = o as { id: string; rider_id: string | null };
    alerts.push({
      key: `RIMESSA_NON_CONFERMATA|${r.id}`,
      type: 'RIMESSA_NON_CONFERMATA',
      detail: `Ordine #${r.id.slice(0, 8)}: contanti consegnati da >48h e rimessa mai confermata (rider ${r.rider_id?.slice(0, 8) ?? '—'})`,
      url: '/admin/orders',
    });
  }

  // 5c) Ordini fermi su «Pronto» senza fattorino: il negozio ha preparato e la
  //     merce e' li' da ore. E' lo stato terminale di ogni consegna che non
  //     trova un fattorino, e prima non lo guardava nessuno.
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const { data: prontiFermi, error: err_prontiFermi } = await admin
    .from('orders')
    .select('id, ready_at, pickup_in_store')
    .eq('delivery_status', 'READY')
    .is('rider_id', null)
    .lt('ready_at', twoHoursAgo)
    .limit(20);
  if (err_prontiFermi) controlliSaltati.push('ordini pronti e fermi');
  for (const o of prontiFermi ?? []) {
    const r = o as { id: string; pickup_in_store: boolean | null };
    alerts.push({
      key: `PRONTO_SENZA_FATTORINO|${r.id}`,
      type: 'PRONTO_SENZA_FATTORINO',
      detail: r.pickup_in_store
        ? `Ordine #${r.id.slice(0, 8)}: pronto da >2h e il cliente non e ancora passato a ritirarlo`
        : `Ordine #${r.id.slice(0, 8)}: pronto da >2h e nessun fattorino l'ha preso`,
      url: `/admin/orders/${r.id}`,
    });
  }

  // 6) Consegne in-flight stallate: ASSIGNED ma non ritirato da >30min (consegna orfana)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: stalledAssigned, error: err_stalledAssigned } = await admin
    .from('orders')
    .select('id, ready_at, profiles!orders_rider_id_fkey(full_name)')
    .eq('delivery_status', 'ASSIGNED')
    .lt('ready_at', thirtyMinAgo)
    .limit(10);
  if (err_stalledAssigned) controlliSaltati.push('ordini assegnati e fermi');
  for (const o of stalledAssigned ?? []) {
    const rider = (o as { profiles?: { full_name?: string } | null }).profiles;
    const id = (o as { id: string }).id;
    alerts.push({
      key: `DELIVERY_STALLED|${id}`,
      type: 'DELIVERY_STALLED',
      detail: `Ordine #${id.slice(0, 8)} ASSIGNED a ${rider?.full_name ?? 'rider'} ma non ritirato da >30min`,
      url: `/admin/orders/${id}`,
    });
  }

  // 7) Riconciliazioni COD in MISMATCH (rider che non quadra)
  const { data: mismatches, error: err_mismatches } = await admin
    .from('cod_reconciliations')
    .select('rider_id, for_date, expected_cents, collected_cents')
    .eq('status', 'MISMATCH')
    .gte('for_date', yesterday)
    .limit(20);
  if (err_mismatches) controlliSaltati.push('quadrature contanti');
  for (const m of mismatches ?? []) {
    const mm = m as { rider_id: string; for_date: string; expected_cents: number; collected_cents: number };
    alerts.push({
      key: `COD_MISMATCH|${mm.rider_id}|${mm.for_date}`,
      type: 'COD_MISMATCH',
      detail: `Riconciliazione COD rider ${mm.rider_id.slice(0, 8)} del ${mm.for_date}: atteso €${(mm.expected_cents / 100).toFixed(2)} vs incassato €${(mm.collected_cents / 100).toFixed(2)}`,
      url: '/admin/orders',
    });
  }

  // 8) Dead-man's switch: cron critici che hanno smesso di girare (audit 🟠-25).
  // I heartbeat sono scritti da withCronAuth; qui segnaliamo chi supera la soglia.
  const { data: heartbeats, error: err_heartbeats } = await admin.from('cron_heartbeats').select('name, last_run_at');
  if (err_heartbeats) controlliSaltati.push('battiti dei lavori periodici');

  /**
   * 22/8/2026 — IL FRENO ANTI-SILENZIO ERA DISINNESCATO.
   *
   * `staleCrons` sa distinguere «fermo da troppo» da «non e' MAI partito», e
   * per il secondo caso vuole sapere da quando esiste il sistema — altrimenti
   * non puo' dire se e' un lavoro morto o solo appena installato. Quel valore
   * non gli veniva passato: senza, il ramo «mai partito» calcola zero minuti e
   * non segnala mai niente.
   *
   * E' il caso peggiore che ci sia: un lavoro periodico configurato male, che
   * non e' partito nemmeno una volta, non ha nessun battito da confrontare —
   * quindi il sorvegliante lo guardava e taceva. Il pagamento ai negozi, le
   * email, la scadenza dei carrelli: fermi, e nessuno avvisato.
   *
   * La data d'installazione e' il battito piu' vecchio che esiste: se il
   * sistema scriveva battiti tre giorni fa, un lavoro senza nessun battito non
   * e' «appena installato».
   */
  const battiti = (heartbeats ?? []) as CronHeartbeat[];
  const quandoBattiti = battiti
    .map((h) => (h.last_run_at ? new Date(h.last_run_at).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const installatoDaMs = quandoBattiti.length > 0 ? Math.min(...quandoBattiti) : undefined;

  for (const c of staleCrons(battiti, Date.now(), undefined, installatoDaMs)) {
    alerts.push({
      key: `CRON_STALE|${c.name}`,
      type: 'CRON_STALE',
      detail: `Cron "${c.name}" fermo da ${c.staleMin} min (soglia ${c.thresholdMin}): scheduler o deploy down?`,
      url: '/admin/today',
    });
  }

  // 8b) IL BONIFICO CHE TORNA SEMPRE IN HELD, E NESSUNO GUARDA HELD  (22/8/2026)
  //
  // Quando un trasferimento a Stripe fallisce, il codice riporta l'ordine a
  // 'HELD' perche' il giro dopo riprovi. Ma se fallisce SEMPRE — un conto
  // bloccato, un IBAN sbagliato — quell'ordine rimbalza fra HELD e PROCESSING
  // all'infinito, e nessun allarme guarda HELD: e' lo stato normale di un
  // pagamento in attesa. Il negozio non viene pagato e nessuno lo sa.
  //
  // Il giro dei bonifici parte un'ora dopo la consegna. Un ordine consegnato da
  // piu' di TRE ore e ancora trattenuto non sta aspettando: e' fermo.
  const treOreFa = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
  const { data: trattenutiTroppo, error: errTrattenuti } = await admin
    .from('orders')
    .select('id, seller_id, delivered_at, profiles!orders_seller_id_fkey(store_name)')
    .eq('payout_status', 'HELD')
    .eq('payment_method', 'card')
    .eq('delivery_status', 'DELIVERED')
    .lt('delivered_at', treOreFa)
    .limit(20);
  if (errTrattenuti) controlliSaltati.push('bonifici trattenuti oltre la finestra');
  for (const o of trattenutiTroppo ?? []) {
    const r = o as { id: string; profiles?: { store_name?: string } | null };
    alerts.push({
      key: `PAYOUT_TRATTENUTO|${r.id}`,
      type: 'PAYOUT_TRATTENUTO',
      detail: `Ordine #${r.id.slice(0, 8)}: consegnato da oltre 3 ore e il bonifico a ${r.profiles?.store_name ?? 'il negozio'} non e ancora partito. Il giro paga a consegna +1h: qui qualcosa lo respinge.`,
      url: `/admin/orders/${r.id}`,
    });
  }

  // 8c) GLI EVENTI STRIPE RIMASTI A META'  (22/8/2026)
  //
  // Ogni evento di Stripe viene scritto in `stripe_event_log` e marcato
  // `processed` solo quando il gestore e' arrivato in fondo. Una riga che resta
  // `processed=false` e' un pagamento, un rimborso o una contestazione che il
  // sito non ha finito di lavorare — e nessuno la guardava. E' il posto dove
  // «i soldi sono entrati e l'ordine non esiste» resta in silenzio.
  const trentaMinutiFa = new Date(Date.now() - 30 * 60_000).toISOString();
  // La riga porta l'ora in cui il turno e' stato preso (`claimed_at`, scritta
  // all'inserimento): su questa tabella non esiste `created_at`, ed e' proprio
  // il tipo di svista che il controllo in tests/unit/nessuna-colonna-che-non-esiste
  // e' li' a fermare.
  const { data: eventiFermi, error: errEventi } = await admin
    .from('stripe_event_log')
    .select('event_id, type, claimed_at')
    .eq('processed', false)
    .lt('claimed_at', trentaMinutiFa)
    .limit(20);
  if (errEventi) controlliSaltati.push('eventi Stripe non lavorati');
  for (const e of eventiFermi ?? []) {
    const r = e as { event_id: string; type: string | null };
    alerts.push({
      key: `STRIPE_EVENT_NON_LAVORATO|${r.event_id}`,
      type: 'STRIPE_EVENT_NON_LAVORATO',
      detail: `Evento Stripe ${r.type ?? '?'} (${r.event_id.slice(0, 14)}) ricevuto da oltre 30 minuti e mai lavorato fino in fondo.`,
      url: '/admin/orders',
    });
  }

  // 9) Backlog coda email (audit 🟡-9): se send-emails non gira o Resend è giù,
  // le email lifecycle si accumulano. Segnaliamo se troppe restano non inviate.
  const emailBacklogCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { count: emailBacklog } = await admin
    .from('email_queue')
    .select('id', { count: 'exact', head: true })
    .is('sent_at', null)
    .is('cancelled_at', null)
    .lte('send_at', emailBacklogCutoff);
  if ((emailBacklog ?? 0) >= 50) {
    alerts.push({
      key: `EMAIL_BACKLOG|${new Date().toISOString().slice(0, 13)}`,
      type: 'EMAIL_BACKLOG',
      detail: `Coda email: ${emailBacklog} messaggi non inviati da oltre 30 min. send-emails fermo o Resend down?`,
      url: '/admin/today',
    });
  }

  /**
   * 10) Resi aperti da troppo tempo.
   *
   * 27/8/2026 (R042) — QUI NON C'ERA NESSUN CONTROLLO SUI RESI, e un reso
   * aperto tiene fermo il bonifico dell'ordine: il giro dei bonifici esclude
   * gli ordini con un reso in REQUESTED, APPROVED, SHIPPED_BACK o RECEIVED.
   * Un cliente apre un reso, il negozio lo approva e aspetta la merce
   * indietro: da quel momento quei soldi sono fermi, e se il reso poi non
   * arriva o si chiude di persona non lo sposta piu' nessuno. Il negozio vede
   * «in attesa» senza scadenza e telefona.
   */
  const setteGiorniFa = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: resiFermi, error: err_resiFermi } = await admin
    .from('returns')
    .select('id, order_id, status, created_at')
    .in('status', ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'])
    .lt('created_at', setteGiorniFa)
    .order('created_at', { ascending: true })
    .limit(20);
  if (err_resiFermi) controlliSaltati.push('resi aperti da troppo tempo');

  for (const r of resiFermi ?? []) {
    const giorni = Math.floor((Date.now() - new Date(r.created_at as string).getTime()) / 86_400_000);
    alerts.push({
      key: `RESO_FERMO|${r.id}`,
      type: 'RESO_FERMO',
      detail: `Reso #${String(r.id).slice(0, 8)} fermo in ${r.status} da ${giorni} giorni: il bonifico dell ordine #${String(r.order_id).slice(0, 8)} resta bloccato finche' non si chiude.`,
      url: `/admin/orders/${r.order_id}`,
    });
  }

  if (controlliSaltati.length > 0) {
    logger.error('[cron] sorvegliante incompleto: NON dichiarare sano quello che non ha guardato', {
      saltati: controlliSaltati,
    });
    return NextResponse.json(
      { ok: false, alerts: alerts.length, controlliSaltati },
      { status: 500 },
    );
  }

  if (alerts.length === 0) {
    return NextResponse.json({ ok: true, alerts: 0, controlliSaltati, message: 'No anomalies detected' });
  }

  // Dedup: scarta gli alert la cui (tipo+entità) è già stata notificata entro
  // il cooldown. Evita di re-inviare lo stesso avviso ad ogni run (alert fatigue).
  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60_000).toISOString();
  const keys = alerts.map((a) => a.key);
  const { data: recent } = await admin
    .from('operational_alert_log')
    .select('alert_key')
    .in('alert_key', keys)
    .gte('last_sent_at', cutoff);
  const recentSet = new Set((recent ?? []).map((r: { alert_key: string }) => r.alert_key));
  const fresh = alerts.filter((a) => !recentSet.has(a.key));

  if (fresh.length === 0) {
    return NextResponse.json({
      ok: true,
      alerts: alerts.length,
      fresh: 0,
      message: 'Anomalie presenti ma già notificate di recente (cooldown attivo)',
    });
  }

  // Notifica admin via email + notification in-app (solo per gli alert "freschi")
  // Nessun indirizzo di ripiego inventato: 'admin@mycity.it' non e' una casella
  // che qualcuno legge, quindi gli allarmi partivano nel vuoto e sembrava che
  // tutto andasse bene. Se la variabile manca lo si dice nei log e si salta
  // l'invio: un allarme non recapitato deve essere visibile come tale.
  const adminEmail = process.env.SUPPORT_EMAIL?.trim() || null;
  if (!adminEmail) {
    // 22/8/2026 — UN ALLARME CHE NON ARRIVA E' UN FALLIMENTO, NON UN AVVISO.
    // Qui si scriveva nel log e si tirava dritto, rispondendo bene: ci sono
    // anomalie fresche, nessuno le riceve, e il giro si dichiara riuscito. Il
    // battito veniva scritto lo stesso, quindi nemmeno il freno anti-silenzio
    // se ne accorgeva. Adesso risponde con un errore: il guasto si vede.
    logger.error('[operational-alerts] SUPPORT_EMAIL non configurata: allarmi non recapitati', {
      anomalie: fresh.length,
    });
    return NextResponse.json(
      { ok: false, alerts: alerts.length, fresh: fresh.length, errore: 'SUPPORT_EMAIL non configurata: nessuno riceve gli allarmi' },
      { status: 500 },
    );
  }
  /**
   * 27/8/2026 (R183) — LE NOTIFICHE IN-APP SI CREANO PRIMA DELL'INVIO EMAIL.
   *
   * Stavano dopo, e se l'invio falliva la funzione usciva con 500 senza
   * arrivarci: con Resend giu' non arrivava proprio niente, nemmeno nel
   * pannello. Ed e' esattamente il caso che questo lavoro deve sorvegliare —
   * l'allarme EMAIL_BACKLOG dice testualmente «send-emails fermo o Resend
   * down?» — quindi il recapito che salta e' quello piu' probabile.
   */
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin').limit(10);
  if (admins && admins.length > 0) {
    const notifications = admins.map((a: { id: string }) => ({
      user_id: a.id,
      // #33 — categoria 'system': un allarme operativo non e' una promozione e
      // non si spegne con gli interruttori del marketing.
      category: 'system',
      title: `⚠️ ${fresh.length} alert operativi`,
      body: fresh.slice(0, 3).map((al) => al.detail).join('; '),
      link: '/admin/today',
    }));
    await admin.from('notifications').insert(notifications);
  }

  const body = `
    <h2>⚠️ Alert operational MyCity</h2>
    <p>Rilevate <strong>${fresh.length}</strong> nuove anomalie:</p>
    <ul>
      ${fresh.map((a) => `<li><strong>[${a.type}]</strong> ${a.detail}${a.url ? ` <a href="${process.env.NEXT_PUBLIC_APP_URL}${a.url}">[apri]</a>` : ''}</li>`).join('\n')}
    </ul>
    <p style="color:#666;font-size:12px">Generato automaticamente dal cron operational-alerts.</p>
  `;

  if (adminEmail) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: `[MyCity Alert] ${fresh.length} anomalie operative`,
        html: body,
      });
    } catch (err) {
      // Stessa ragione: se l'invio fallisce mentre ci sono anomalie fresche,
      // il giro NON e' riuscito.
      logger.error('[cron-alerts] email send failed', err);
      return NextResponse.json(
        { ok: false, alerts: alerts.length, fresh: fresh.length, errore: 'allarmi non recapitati' },
        { status: 500 },
      );
    }
  }

  // Registra l'invio per il cooldown (upsert: aggiorna last_sent_at se esiste).
  await admin
    .from('operational_alert_log')
    .upsert(
      fresh.map((a) => ({ alert_key: a.key, last_sent_at: new Date().toISOString() })),
      { onConflict: 'alert_key' },
    );

  return NextResponse.json({
    ok: true,
    alerts: alerts.length,
    fresh: fresh.length,
    details: fresh,
  });
});

// I lavori periodici di Vercel bussano in GET, sempre — non c'è modo di
// chiedergli un POST. Questa rotta nasceva POST-e-basta, dai tempi del cron
// esterno: su Vercel avrebbe risposto «405 metodo non ammesso» a ogni giro, e
// il lavoro non sarebbe mai partito. Stesso identico handler, stesso controllo
// del segreto: cambia solo la porta da cui si entra. Il POST resta valido
// perché il cron esterno continua a girare finché non lo spegni.
export const GET = POST;
