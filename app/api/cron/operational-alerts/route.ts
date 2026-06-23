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
 * Setup cron esterno (cron-job.org, Render):
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

  // 1) Ordini stuck in NEW da piu' di 1 ora (seller non accetta = bad UX buyer)
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: stuckNew } = await admin
    .from('orders')
    .select('id, created_at, total_price, seller_id, profiles!orders_seller_id_fkey(store_name)')
    .eq('delivery_status', 'NEW')
    .lt('created_at', oneHourAgo)
    .order('created_at', { ascending: true })
    .limit(20);

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
  const { data: stuckRiders } = await admin
    .from('orders')
    .select('id, rider_id, picked_up_at, profiles!orders_rider_id_fkey(full_name)')
    .eq('delivery_status', 'OUT_FOR_DELIVERY')
    .lt('picked_up_at', fortyFiveMinAgo)
    .limit(10);

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
  const { data: codMissing } = await admin
    .from('orders')
    .select('id, total_price, rider_id, profiles!orders_rider_id_fkey(full_name)')
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .is('cash_confirmed_at', null)
    .gte('created_at', yesterday + 'T00:00:00Z')
    .lte('created_at', yesterday + 'T23:59:59Z')
    .limit(20);

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
  const { data: kycPending } = await admin
    .from('profiles')
    .select('id, store_name, kyc_provider_checked_at')
    .eq('role', 'seller')
    .eq('kyc_provider_status', 'PENDING')
    .lt('kyc_provider_checked_at', twoDaysAgo)
    .limit(20);

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
  const { data: payoutStuck } = await admin
    .from('orders')
    .select('id, payout_status, rider_payout_status')
    .eq('delivery_status', 'DELIVERED')
    .or('payout_status.in.(PROCESSING,FAILED),rider_payout_status.in.(PROCESSING,FAILED)')
    .lt('delivered_at', oneHourAgo)
    .limit(20);
  for (const o of payoutStuck ?? []) {
    const r = o as { id: string; payout_status: string | null; rider_payout_status: string | null };
    alerts.push({
      key: `PAYOUT_STUCK|${r.id}`,
      type: 'PAYOUT_STUCK',
      detail: `Ordine #${r.id.slice(0, 8)} payout anomalo (seller=${r.payout_status}, rider=${r.rider_payout_status}) da >1h`,
      url: `/admin/orders/${r.id}`,
    });
  }

  // 6) Consegne in-flight stallate: ASSIGNED ma non ritirato da >30min (consegna orfana)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: stalledAssigned } = await admin
    .from('orders')
    .select('id, ready_at, profiles!orders_rider_id_fkey(full_name)')
    .eq('delivery_status', 'ASSIGNED')
    .lt('ready_at', thirtyMinAgo)
    .limit(10);
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
  const { data: mismatches } = await admin
    .from('cod_reconciliations')
    .select('rider_id, for_date, expected_cents, collected_cents')
    .eq('status', 'MISMATCH')
    .gte('for_date', yesterday)
    .limit(20);
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
  const { data: heartbeats } = await admin.from('cron_heartbeats').select('name, last_run_at');
  for (const c of staleCrons((heartbeats ?? []) as CronHeartbeat[], Date.now())) {
    alerts.push({
      key: `CRON_STALE|${c.name}`,
      type: 'CRON_STALE',
      detail: `Cron "${c.name}" fermo da ${c.staleMin} min (soglia ${c.thresholdMin}): scheduler o deploy down?`,
      url: '/admin/today',
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

  if (alerts.length === 0) {
    return NextResponse.json({ ok: true, alerts: 0, message: 'No anomalies detected' });
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
  const adminEmail = process.env.SUPPORT_EMAIL ?? 'admin@mycity.it';
  const body = `
    <h2>⚠️ Alert operational MyCity</h2>
    <p>Rilevate <strong>${fresh.length}</strong> nuove anomalie:</p>
    <ul>
      ${fresh.map((a) => `<li><strong>[${a.type}]</strong> ${a.detail}${a.url ? ` <a href="${process.env.NEXT_PUBLIC_APP_URL}${a.url}">[apri]</a>` : ''}</li>`).join('\n')}
    </ul>
    <p style="color:#666;font-size:12px">Generato automaticamente dal cron operational-alerts.</p>
  `;

  try {
    await sendEmail({
      to: adminEmail,
      subject: `[MyCity Alert] ${fresh.length} anomalie operative`,
      html: body,
    });
  } catch (err) {
    logger.error('[cron-alerts] email send failed', err);
  }

  // Push notification in-app a tutti gli admin
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin').limit(10);
  if (admins && admins.length > 0) {
    const notifications = admins.map((a: { id: string }) => ({
      user_id: a.id,
      title: `⚠️ ${fresh.length} alert operativi`,
      body: fresh.slice(0, 3).map((al) => al.detail).join('; '),
      link: '/admin/today',
    }));
    await admin.from('notifications').insert(notifications);
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
