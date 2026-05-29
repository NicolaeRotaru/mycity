import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Invio web push reale (VAPID). Server-only: usa la chiave privata VAPID.
 * No-op se le chiavi VAPID non sono configurate (feature opzionale come Stripe/Resend).
 */

let vapidConfigured: boolean | null = null;

export function isPushConfigured(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;
  const pub = env.vapidPublicKey();
  const priv = env.vapidPrivateKey();
  if (pub && priv) {
    webpush.setVapidDetails(env.vapidSubject(), pub, priv);
    vapidConfigured = true;
  } else {
    vapidConfigured = false;
  }
  return vapidConfigured;
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Invia `payload` a tutte le subscription dell'utente. Cancella quelle scadute
 * (404/410). Ritorna il numero di push consegnate. `supa` deve essere un client
 * service-role (così bypassa la RLS su push_subscriptions).
 */
export async function sendPushToUser(supa: SupabaseClient, userId: string, payload: PushPayload): Promise<number> {
  if (!isPushConfigured()) return 0;
  const { data: subs } = await supa
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (!subs?.length) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;
  for (const s of subs as SubRow[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      // Endpoint non più valido → rimuovi la subscription morta.
      if (status === 404 || status === 410) {
        await supa.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
  }
  return sent;
}
