import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { isPushConfigured, sendPushToUser } from '@/lib/push/send';

/**
 * Cron: invia le web push per le notifiche non ancora inviate (pushed_at NULL)
 * create nell'ultima ora. Ogni notifica viene processata una sola volta
 * (pushed_at marcato dopo il tentativo). Le subscription morte (404/410) vengono
 * rimosse dal sender.
 *
 * Cadenza: ogni 5 minuti. Chi la fa partire sta in `vercel.json` → `crons`.
 * A mano si chiama così:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yoursite/api/cron/send-push
 */
export const runtime = 'nodejs';

const handler = withCronAuth(async (): Promise<NextResponse> => {
  // Se le chiavi VAPID non sono configurate, non tocchiamo le notifiche
  // (così quando verranno configurate, l'arretrato recente verrà comunque inviato).
  if (!isPushConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'VAPID non configurato', sent: 0 });
  }

  // 27/8/2026 (R009) — IL CLIENT AMMINISTRATIVO SI PRENDE DA UN POSTO SOLO.
  // Qui se ne costruiva uno a mano: cinque copie in giro per il progetto, e
  // ognuna e' un posto in piu' da ricordare il giorno in cui la chiave di
  // servizio va ruotata o vanno cambiate le opzioni del client (per esempio per
  // mettere un tetto di tempo). Dimenticarne una vuol dire una rotta che smette
  // di funzionare in silenzio. `getAdminSupabase()` tiene da parte un client
  // solo (#245: ogni client porta la sua coda di connessioni e i suoi timer).
  let supa;
  try { supa = getAdminSupabase(); } catch (e) {
    return ApiErrors.unavailable(e instanceof Error ? e.message : 'config error');
  }

  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: pending } = await supa
    .from('notifications')
    .select('id, user_id, title, body, link, category')
    .is('pushed_at', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(100);

  if (!pending?.length) return NextResponse.json({ ok: true, sent: 0, processed: 0 });

  /**
   * 22/8/2026 — TRE VIAGGI AL DATABASE PER OGNI SINGOLA NOTIFICA.
   *
   * Il ciclo faceva tutto in fila: per ognuna delle cento notifiche una lettura
   * delle preferenze, una lettura delle iscrizioni push dentro `sendPushToUser`,
   * e una scrittura. Trecento viaggi in sequenza, ognuno con la sua attesa di
   * rete. Il giro dura minuti, e le notifiche che dovrebbero dire «il tuo
   * ordine e' pronto» arrivano quando non servono piu'.
   *
   * Adesso: le preferenze si leggono una volta per PERSONA (le cento notifiche
   * sono di molte meno persone), gli invii vanno a gruppi di dieci in
   * parallelo, e le notifiche gestite si segnano con due sole scritture.
   */
  const notifiche = pending as {
    id: string; user_id: string; title: string; body: string | null;
    link: string | null; category: string | null;
  }[];

  let sent = 0;
  let retried = 0;
  let saltate = 0;
  const nowIso = new Date().toISOString();

  // ① Le preferenze, una volta per persona+categoria invece che per notifica.
  const chiavi = new Map<string, { user: string; categoria: string }>();
  for (const n of notifiche) {
    const categoria = n.category ?? 'order';
    chiavi.set(`${n.user_id}|${categoria}`, { user: n.user_id, categoria });
  }
  const vuoleDavvero = new Map<string, boolean>();
  await Promise.all(
    [...chiavi.entries()].map(async ([chiave, v]) => {
      const { data } = await supa.rpc('vuole_notifica', { p_user_id: v.user, p_category: v.categoria });
      vuoleDavvero.set(chiave, data !== false);
    }),
  );

  const daSegnare: string[] = [];
  const daMandare = notifiche.filter((n) => {
    const chiave = `${n.user_id}|${n.category ?? 'order'}`;
    if (vuoleDavvero.get(chiave) === false) {
      // Segnata come gestita: non e' un errore, e' una scelta di chi la riceve.
      daSegnare.push(n.id);
      saltate++;
      return false;
    }
    return true;
  });

  // ② Gli invii, a gruppi di dieci in parallelo invece che uno per volta.
  const GRUPPO = 10;
  for (let i = 0; i < daMandare.length; i += GRUPPO) {
    const gruppo = daMandare.slice(i, i + GRUPPO);
    const esiti = await Promise.allSettled(
      gruppo.map((n) =>
        sendPushToUser(supa, n.user_id, {
          title: n.title,
          body: n.body ?? undefined,
          url: n.link ?? '/',
          tag: n.id,
        }),
      ),
    );
    esiti.forEach((esito, k) => {
      if (esito.status !== 'fulfilled') {
        retried++;
        return;
      }
      const r = esito.value;
      sent += r.delivered;
      // 🟠-10: si segna SOLO se almeno una push e' arrivata, o se non c'era
      // niente da consegnare. Se c'erano iscrizioni e zero consegne e' un
      // guasto passeggero: si ritenta al giro dopo.
      if (r.delivered > 0 || r.total === 0) daSegnare.push(gruppo[k].id);
      else retried++;
    });
  }

  // ③ Una scrittura sola per tutte quelle gestite.
  if (daSegnare.length > 0) {
    const { error } = await supa
      .from('notifications')
      .update({ pushed_at: nowIso })
      .in('id', daSegnare);
    if (error) {
      logger.error('[cron] push mandate ma non registrate: il prossimo giro le rimanda', {
        quante: daSegnare.length, message: error.message,
      });
    }
  }

  return NextResponse.json({ ok: true, sent, processed: pending.length, retried, saltate });
});

export const GET = handler;
export const POST = handler;
