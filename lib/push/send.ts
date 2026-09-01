import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

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

/** Esito dell'invio push a un utente (audit 🟠-10). */
export type PushSendResult = {
  /** Quante push sono state consegnate con successo. */
  delivered: number;
  /** Quante subscription sono state tentate (0 = nessuna subscription). */
  total: number;
};

/**
 * 30/8/2026 (R076) — LE ISCRIZIONI DI TANTE PERSONE, IN UNA LETTURA SOLA.
 *
 * `sendPushToUser` le rileggeva ogni volta, e il giro delle notifiche la chiama
 * una volta per notifica: cento notifiche = cento letture della stessa tabella,
 * dove ne basta una. Non e' un guasto, e' il costo che si presenta al picco
 * degli ordini — cioe' quando la notifica «il tuo ordine e' pronto» serve
 * davvero, e sullo stesso database ci sono i clienti veri che navigano.
 *
 * Restituisce una mappa persona → sue iscrizioni. Chi non ne ha non compare.
 */
export async function iscrizioniPerUtenti(
  supa: SupabaseClient,
  userIds: string[],
): Promise<Map<string, SubRow[]>> {
  const mappa = new Map<string, SubRow[]>();
  if (userIds.length === 0) return mappa;
  const { data } = await supa
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', userIds);
  for (const riga of (data ?? []) as Array<SubRow & { user_id: string }>) {
    const gia = mappa.get(riga.user_id);
    if (gia) gia.push(riga);
    else mappa.set(riga.user_id, [riga]);
  }
  return mappa;
}

/**
 * Invia `payload` a tutte le subscription dell'utente. Cancella quelle scadute
 * (404/410) e logga i fallimenti transitori (es. 429/5xx) invece di silenziarli.
 * Ritorna { delivered, total } così il chiamante può distinguere "niente da
 * consegnare" (total=0) da "tutte fallite per errore transitorio" (delivered=0,
 * total>0) e decidere se ritentare. `supa` deve essere un client service-role
 * (così bypassa la RLS su push_subscriptions).
 *
 * R076 — Se le iscrizioni le ha gia' lette il chiamante (con
 * `iscrizioniPerUtenti`), gliele passa e qui non si torna al database. Chi
 * chiama per una persona sola puo' continuare a non passarle.
 */
export async function sendPushToUser(
  supa: SupabaseClient,
  userId: string,
  payload: PushPayload,
  iscrizioniGiaLette?: SubRow[],
): Promise<PushSendResult> {
  if (!isPushConfigured()) return { delivered: 0, total: 0 };
  const subs = iscrizioniGiaLette ?? (await supa
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)).data;
  if (!subs?.length) return { delivered: 0, total: 0 };

  const body = JSON.stringify(payload);
  let delivered = 0;
  for (const s of subs as SubRow[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      delivered++;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      // Endpoint non più valido → rimuovi la subscription morta (permanente).
      if (status === 404 || status === 410) {
        await supa.from('push_subscriptions').delete().eq('id', s.id);
      } else {
        // Fallimento transitorio (es. 429/5xx): non silenziare, così il
        // chiamante può ritentare e l'errore è visibile in Sentry.
        logger.warn('[push] invio fallito (transitorio)', { status: status ?? 'unknown' });
      }
    }
  }
  return { delivered, total: subs.length };
}
