import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { chiamataDelCalendarioFerma, rispostaDelFermo } from '@/lib/cron/fermo-dei-lavori';
import { ApiErrors } from '@/lib/api/responses';
import {
  isPushConfigured, iscrizioniPerUtenti, sendPushToUser, type PushDeliveryOptions,
} from '@/lib/push/send';

/**
 * 6/9/2026 — QUANTO A LUNGO VALE UN AVVISO, A SECONDA DI COSA DICE.
 *
 * Il servizio push di Apple/Google/Mozilla tiene in coda il messaggio se il
 * telefono e' spento: senza istruzioni per quattro settimane. «Il tuo ordine e'
 * in consegna» che arriva lunedi' per una consegna di sabato non e' un avviso,
 * e' un motivo per spegnere le notifiche. Un'ora per ordini e avvisi di
 * servizio, un giorno per promozioni, gruppi e newsletter (quelle possono
 * aspettare la prossima volta che lo schermo si accende).
 */
const UNORA = 3_600;
const UNGIORNO = 86_400;
const CONSEGNA_PER_CATEGORIA: Record<string, PushDeliveryOptions> = {
  order:      { TTL: UNORA,    urgency: 'high' },
  system:     { TTL: UNORA,    urgency: 'high' },
  promo:      { TTL: UNGIORNO, urgency: 'normal' },
  group:      { TTL: UNGIORNO, urgency: 'normal' },
  newsletter: { TTL: UNGIORNO, urgency: 'low' },
};

/**
 * 6/9/2026 — UN AVVISO PER ORDINE, NON UNO PER MESSAGGIO.
 *
 * Il contrassegno (`tag`) dice al telefono quale notifica sostituire. Era
 * l'identificativo della notifica, cioe' sempre diverso: «confermato», «in
 * preparazione», «pronto», «in consegna» dello stesso ordine si impilavano in
 * quattro avvisi. Con il collegamento all'ordine l'ultimo stato prende il posto
 * del precedente e `renotify` fa comunque suonare il telefono.
 *
 * Se il collegamento e' generico ('/' o assente) si torna all'identificativo:
 * altrimenti due promozioni diverse si mangerebbero a vicenda.
 */
/*
 * 5/11/2026 — Il link fa da contrassegno solo se porta un id (un ordine, un reclamo). I link di
 * sezione ('/rider', '/admin/sos') valgono per tanti avvisi diversi: col link come contrassegno
 * «Ordine pronto» di un ordine cancellava sul telefono del fattorino quello di un altro ordine.
 */
// Un id è un pezzo del percorso, dopo il primo, che contiene una cifra (un uuid, un numero).
const ID_NEL_LINK = /^\/[^/?#]+\/[^?#]*\d/;
function contrassegno(n: { id: string; link: string | null }): string {
  return n.link && ID_NEL_LINK.test(n.link) ? n.link : n.id;
}

/** Le categorie che possono aspettare: senza la preferenza letta non partono. */
const CATEGORIE_CHE_ASPETTANO = new Set(['promo', 'group', 'newsletter']);
/** Le categorie che passano davanti alle altre (R14-016): ordini e avvisi di servizio. */
const CATEGORIE_CHE_NON_ASPETTANO = ['order', 'system'];
/** Notifiche lavorate al massimo in un giro. */
const LOTTO = 100;

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

const handler = withCronAuth(async (req): Promise<NextResponse> => {
  // 31/10/2026 — Il fermo dei lavori a orario: dopo il segreto, prima di tutto il resto (lib/cron/fermo-dei-lavori.ts).
  if (chiamataDelCalendarioFerma(req)) return rispostaDelFermo();
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

  /**
   * R14-016 — PRIMA GLI AVVISI CHE NON ASPETTANO.
   *
   * Il giro prendeva le cento notifiche più vecchie dell'ultima ora, qualunque cosa dicessero. Un
   * ribasso su un prodotto preferito da trecento persone scrive trecento righe «promo» tutte
   * insieme: il «Nuovo ordine» della panetteria, arrivato un minuto dopo, aspettava tre giri
   * (un quarto d'ora) dietro le promozioni. Adesso si leggono prima ordini e avvisi di servizio,
   * e solo nel posto che resta le altre, sempre dalle più vecchie.
   */
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: urgenti, error: erroreLettura } = await supa
    .from('notifications')
    .select('id, user_id, title, body, link, category')
    .in('category', CATEGORIE_CHE_NON_ASPETTANO)
    .is('pushed_at', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(LOTTO);
  // 5/11/2026 — Una lettura caduta non è «niente da mandare»: il giro risponde 503, come send-emails.
  if (erroreLettura) {
    logger.error('[cron] notifiche push non leggibili', { message: erroreLettura.message });
    return ApiErrors.unavailable('notifiche non leggibili');
  }
  const pending = [...(urgenti ?? [])];
  if (pending.length < LOTTO) {
    // Le altre, nel posto che resta: si leggono tutte le categorie (anche una nuova che qui non
    // fosse ancora scritta) e si scartano quelle già prese qui sopra.
    const { data: altre, error: erroreAltre } = await supa
      .from('notifications')
      .select('id, user_id, title, body, link, category')
      .is('pushed_at', null)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(LOTTO);
    if (erroreAltre) {
      // Ordini e avvisi di servizio partono lo stesso; le altre restano in coda per il giro dopo.
      logger.error('[cron] notifiche push che possono aspettare non leggibili', { message: erroreAltre.message });
    } else {
      const giaPrese = new Set(pending.map((n) => n.id));
      for (const n of altre ?? []) {
        if (pending.length >= LOTTO) break;
        if (giaPrese.has(n.id)) continue;
        giaPrese.add(n.id);
        pending.push(n);
      }
    }
  }

  if (!pending.length) return NextResponse.json({ ok: true, sent: 0, processed: 0 });

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
  let rimandate = 0;
  const nowIso = new Date().toISOString();

  // ① Le preferenze, una volta per persona+categoria invece che per notifica.
  const chiavi = new Map<string, { user: string; categoria: string }>();
  for (const n of notifiche) {
    const categoria = n.category ?? 'order';
    chiavi.set(`${n.user_id}|${categoria}`, { user: n.user_id, categoria });
  }
  const vuoleDavvero = new Map<string, boolean>();
  const nonLette = new Set<string>();
  /**
   * 30/8/2026 (R076) — QUESTE ANDAVANO A GRUPPI DI CENTO, CIOE' SENZA TETTO.
   *
   * Il `Promise.all` qui sopra apriva una domanda per ogni coppia
   * persona+categoria tutte nello stesso istante: col batch pieno sono cento
   * chiamate contemporanee al gestore di connessioni di Supabase. Il tetto a
   * gruppi di dieci esisteva gia', ma solo piu' sotto, per gli invii. Il
   * momento in cui il batch e' pieno e' il picco degli ordini — lo stesso in
   * cui sul database ci sono i clienti veri che navigano.
   */
  const GRUPPO = 10;
  const daChiedere = [...chiavi.entries()];
  for (let i = 0; i < daChiedere.length; i += GRUPPO) {
    await Promise.all(
      daChiedere.slice(i, i + GRUPPO).map(async ([chiave, v]) => {
        const { data, error } = await supa.rpc('vuole_notifica', { p_user_id: v.user, p_category: v.categoria });
        // 5/11/2026 — Preferenza non letta: le categorie che possono aspettare restano in coda
        // (pushed_at resta vuoto, riprova il giro dopo); ordini e avvisi di servizio partono.
        if (error) {
          logger.warn('[cron] preferenza push non letta', { categoria: v.categoria, message: error.message });
          if (CATEGORIE_CHE_ASPETTANO.has(v.categoria)) {
            nonLette.add(chiave);
            return;
          }
        }
        vuoleDavvero.set(chiave, data !== false);
      }),
    );
  }

  const daSegnare: string[] = [];
  const daMandare = notifiche.filter((n) => {
    const chiave = `${n.user_id}|${n.category ?? 'order'}`;
    if (nonLette.has(chiave)) {
      rimandate++;
      return false;
    }
    if (vuoleDavvero.get(chiave) === false) {
      // Segnata come gestita: non e' un errore, e' una scelta di chi la riceve.
      daSegnare.push(n.id);
      saltate++;
      return false;
    }
    return true;
  });

  /**
   * ② Le iscrizioni push: UNA lettura per tutti, non una per notifica.
   *
   * 30/8/2026 (R076) — `sendPushToUser` se le rileggeva da sola ogni volta, e
   * qui la si chiama una volta per notifica: col batch pieno erano cento
   * letture della stessa tabella dove ne basta una. Il commento in cima
   * dichiarava risolte le PREFERENZE, non le iscrizioni: quelle erano rimaste.
   */
  // 5/11/2026 — Se la lettura delle iscrizioni cade non si manda e non si segna niente: riprova il
  // giro dopo. Prima la mappa vuota diceva «nessuno iscritto» e il lotto risultava mandato.
  let iscrizioni: Awaited<ReturnType<typeof iscrizioniPerUtenti>>;
  try {
    iscrizioni = await iscrizioniPerUtenti(supa, [...new Set(daMandare.map((n) => n.user_id))]);
  } catch (e) {
    logger.error('[cron] iscrizioni push non lette: il giro dopo riprova', { message: e instanceof Error ? e.message : String(e) });
    rimandate += daMandare.length;
    daMandare.length = 0;
    iscrizioni = new Map();
  }

  // ③ Gli invii, a gruppi di dieci in parallelo invece che uno per volta.
  for (let i = 0; i < daMandare.length; i += GRUPPO) {
    const gruppo = daMandare.slice(i, i + GRUPPO);
    const esiti = await Promise.allSettled(
      gruppo.map((n) =>
        sendPushToUser(supa, n.user_id, {
          title: n.title,
          body: n.body ?? undefined,
          url: n.link ?? '/',
          tag: contrassegno(n),
          renotify: true,
        }, iscrizioni.get(n.user_id) ?? [], CONSEGNA_PER_CATEGORIA[n.category ?? 'order']),
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

  // ④ Una scrittura sola per tutte quelle gestite.
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

  return NextResponse.json({ ok: true, sent, processed: pending.length, retried, saltate, rimandate });
});

export const GET = handler;
export const POST = handler;
