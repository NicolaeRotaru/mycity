import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/client';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';

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
 *
 * Setup cron esterno (cron-job.org, Render):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/operational-alerts
 * Schedule: ogni 15 minuti (per stuck), 1 ora (per riconciliazione)
 */

type AlertRow = {
  type: string;
  detail: string;
  url?: string;
};

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
    const minutesStuck = Math.floor((Date.now() - new Date((o as { created_at: string }).created_at).getTime()) / 60_000);
    alerts.push({
      type: 'ORDER_STUCK_NEW',
      detail: `Ordine #${(o as { id: string }).id.slice(0, 8)} da ${seller?.store_name ?? 'unknown'} bloccato in NEW da ${minutesStuck} min`,
      url: `/admin/orders/${(o as { id: string }).id}`,
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
    const minutes = Math.floor((Date.now() - new Date((o as { picked_up_at: string }).picked_up_at).getTime()) / 60_000);
    alerts.push({
      type: 'RIDER_STUCK',
      detail: `Rider ${rider?.full_name ?? 'unknown'} con ordine #${(o as { id: string }).id.slice(0, 8)} in consegna da ${minutes} min`,
      url: `/admin/orders/${(o as { id: string }).id}`,
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
    alerts.push({
      type: 'COD_NOT_CONFIRMED',
      detail: `Ordine COD #${(o as { id: string }).id.slice(0, 8)} consegnato ma cash non confermato (rider: ${rider?.full_name ?? 'unknown'})`,
      url: `/admin/orders/${(o as { id: string }).id}`,
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
    alerts.push({
      type: 'KYC_PENDING_TOO_LONG',
      detail: `Seller ${(p as { store_name?: string }).store_name ?? 'unknown'} in KYC PENDING da >48h`,
      url: `/admin/users?id=${(p as { id: string }).id}`,
    });
  }

  if (alerts.length === 0) {
    return NextResponse.json({ ok: true, alerts: 0, message: 'No anomalies detected' });
  }

  // Notifica admin via email + notification in-app
  const adminEmail = process.env.SUPPORT_EMAIL ?? 'admin@mycity.it';
  const body = `
    <h2>⚠️ Alert operational MyCity</h2>
    <p>Rilevate <strong>${alerts.length}</strong> anomalie:</p>
    <ul>
      ${alerts.map((a) => `<li><strong>[${a.type}]</strong> ${a.detail}${a.url ? ` <a href="${process.env.NEXT_PUBLIC_APP_URL}${a.url}">[apri]</a>` : ''}</li>`).join('\n')}
    </ul>
    <p style="color:#666;font-size:12px">Generato automaticamente dal cron operational-alerts.</p>
  `;

  try {
    await sendEmail({
      to: adminEmail,
      subject: `[MyCity Alert] ${alerts.length} anomalie operative`,
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
      title: `⚠️ ${alerts.length} alert operativi`,
      body: alerts.slice(0, 3).map((al) => al.detail).join('; '),
      link: '/admin/today',
    }));
    await admin.from('notifications').insert(notifications);
  }

  return NextResponse.json({
    ok: true,
    alerts: alerts.length,
    details: alerts,
  });
});
