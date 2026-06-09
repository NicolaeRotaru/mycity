import { getAdminSupabase } from '@/lib/supabase/server';

/**
 * Helper server-side per scrivere righe in `activity_events` — il firehose di
 * sorveglianza dell'admin. Best-effort come lib/audit.ts: non blocca mai la
 * richiesta se il log fallisce.
 *
 * I cambiamenti dati (insert/update/delete sulle tabelle) sono catturati dai
 * trigger DB (migration 073). Questo helper serve per gli eventi applicativi che
 * non passano dal DB: page view dei visitatori, login/logout, e il mirror delle
 * azioni admin (lib/audit.ts).
 */

export type ActivityCategory =
  | 'visitor'
  | 'auth'
  | 'commerce'
  | 'catalog'
  | 'content'
  | 'user'
  | 'moderation'
  | 'system';

export type ActivityEntry = {
  category: ActivityCategory;
  eventType: string;
  summary?: string;
  actorId?: string | null;
  userId?: string | null;
  anonId?: string | null;
  sessionId?: string | null;
  targetTable?: string | null;
  targetId?: string | null;
  path?: string | null;
  referrer?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  deviceType?: string | null;
  browser?: string | null;
  os?: string | null;
  country?: string | null;
  city?: string | null;
  isBot?: boolean;
  metadata?: Record<string, unknown> | null;
};

export async function recordActivity(entry: ActivityEntry): Promise<void> {
  try {
    const supa = getAdminSupabase();
    await supa.from('activity_events').insert({
      category: entry.category,
      event_type: entry.eventType,
      summary: entry.summary ?? null,
      actor_id: entry.actorId ?? null,
      user_id: entry.userId ?? null,
      anon_id: entry.anonId ?? null,
      session_id: entry.sessionId ?? null,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId ?? null,
      path: entry.path ?? null,
      referrer: entry.referrer ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
      device_type: entry.deviceType ?? null,
      browser: entry.browser ?? null,
      os: entry.os ?? null,
      country: entry.country ?? null,
      city: entry.city ?? null,
      is_bot: entry.isBot ?? false,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    console.error('[activity] write failed:', err);
  }
}
