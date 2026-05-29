import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseService } from '@/lib/env';
import { withCronAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { isPushConfigured, sendPushToUser } from '@/lib/push/send';

/**
 * Cron: invia le web push per le notifiche non ancora inviate (pushed_at NULL)
 * create nell'ultima ora. Ogni notifica viene processata una sola volta
 * (pushed_at marcato dopo il tentativo). Le subscription morte (404/410) vengono
 * rimosse dal sender.
 *
 * Trigger esterno (es. cron-job.org ogni 1-5 min):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yoursite/api/cron/send-push
 */
export const runtime = 'nodejs';

const handler = withCronAuth(async (): Promise<NextResponse> => {
  // Se le chiavi VAPID non sono configurate, non tocchiamo le notifiche
  // (così quando verranno configurate, l'arretrato recente verrà comunque inviato).
  if (!isPushConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'VAPID non configurato', sent: 0 });
  }

  let supaCfg;
  try { supaCfg = requireSupabaseService(); } catch (e) {
    return ApiErrors.unavailable(e instanceof Error ? e.message : 'config error');
  }
  const supa = createClient(supaCfg.url, supaCfg.key, { auth: { persistSession: false, autoRefreshToken: false } });

  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: pending } = await supa
    .from('notifications')
    .select('id, user_id, title, body, link')
    .is('pushed_at', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(100);

  if (!pending?.length) return NextResponse.json({ ok: true, sent: 0, processed: 0 });

  let sent = 0;
  const nowIso = new Date().toISOString();
  for (const n of pending as { id: string; user_id: string; title: string; body: string | null; link: string | null }[]) {
    sent += await sendPushToUser(supa, n.user_id, {
      title: n.title,
      body: n.body ?? undefined,
      url: n.link ?? '/',
      tag: n.id,
    });
    await supa.from('notifications').update({ pushed_at: nowIso }).eq('id', n.id);
  }

  return NextResponse.json({ ok: true, sent, processed: pending.length });
});

export const GET = handler;
export const POST = handler;
